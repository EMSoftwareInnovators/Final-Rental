/* Stage 13: the storage abstraction on the browser build, and the
 * production/debug separation.
 *
 * Part A runs against the dev server: the web backend is live localStorage,
 * every domain round-trips through it, and remove works -- exactly as the game
 * always behaved, which is why the rest of the suite is untouched.
 *
 * Part B builds a throwaway PRODUCTION web copy (the same injection tools/web.mjs
 * does), serves it, and proves a shipped build hides its debug globals and the
 * timeScale cheat while the game still boots and still saves.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});

/* ============================================================
   PART A -- the web backend, on the dev server (development mode).
   ============================================================ */
{
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__game.sound.muted = true; try { ['finalrental.campaign', 'finalrental.profile', 'finalrental.overtime', 'finalrental.prefs', 'finalrental.padbinds'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ } });

  console.log('  -- web backend (dev) --');
  const be = await page.evaluate(() => window.__storage.backend);
  check('the browser build uses the web (localStorage) backend', be === 'web', be);

  // The abstraction is live localStorage: a value set through it is readable
  // via localStorage and vice versa, so nothing that pokes localStorage broke.
  const rt = await page.evaluate(() => {
    const S = window.__storage;
    S.setItem('finalrental.prefs', '{"x":1}');
    const viaLs = localStorage.getItem('finalrental.prefs');
    localStorage.setItem('finalrental.campaign', '{"y":2}');
    const viaStore = S.getItem('finalrental.campaign');
    S.removeItem('finalrental.prefs');
    const gone = S.getItem('finalrental.prefs');
    return { viaLs, viaStore, gone };
  });
  check('setItem is visible to localStorage and vice versa (live pass-through)',
    rt.viaLs === '{"x":1}' && rt.viaStore === '{"y":2}');
  check('removeItem clears the value', rt.gone === null);

  // The domain owners persist through the abstraction end-to-end.
  const domain = await page.evaluate(() => {
    const g = window.__game, C = window.__campaign, O = window.__overtime, P = window.__profile;
    C.deleteCampaignSave();
    g.newStory();                             // writes campaign via storage
    const campOnDisk = !!localStorage.getItem('finalrental.campaign');
    g.profile = P.freshProfile();
    P.recordStoryCompletion(g.profile, { history: { grades: ['A'], scores: [160] }, stats: { arrests: 1, customersServed: 30, walkouts: 0 }, storyFlags: { endingId: 'ARREST' } });
    P.saveProfile(g.profile);
    const profOnDisk = !!localStorage.getItem('finalrental.profile');
    g.otRun = null; g.newOvertime();
    const otOnDisk = !!localStorage.getItem('finalrental.overtime');
    return { campOnDisk, profOnDisk, otOnDisk, backend: window.__storage.backend };
  });
  check('every domain persists through the abstraction on the web backend',
    domain.campOnDisk && domain.profOnDisk && domain.otOnDisk, JSON.stringify(domain));

  check('no page errors on the web backend', errs.length === 0, errs.join(' | '));
  await page.evaluate(() => { try { ['finalrental.campaign', 'finalrental.profile', 'finalrental.overtime', 'finalrental.prefs', 'finalrental.padbinds'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ } });
  await page.close();
}

/* ============================================================
   PART B -- a production web build hides its debug hooks.
   ============================================================ */
{
  console.log('\n  -- production build (debug hooks gated) --');
  // Build a throwaway production copy the same way tools/web.mjs does: the src
  // tree plus an index.html carrying the production marker.
  const stage = mkdtempSync(path.join(tmpdir(), 'fr-prod-'));
  let html = readFileSync('index.html', 'utf8');
  html = html.replace('</head>', '  <script>window.__FR_PROD__=true;</script>\n</head>');
  writeFileSync(path.join(stage, 'index.html'), html);
  cpSync('src', path.join(stage, 'src'), { recursive: true });

  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(stage, p);
    if (!file.startsWith(stage)) { res.writeHead(403); res.end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const prod = await page.evaluate(() => ({
    game: typeof window.__game,
    campaign: typeof window.__campaign,
    profile: typeof window.__profile,
    storage: typeof window.__storage,
    input: typeof window.__input,
    // The game still booted and drew, even with no globals exposed.
    booted: (() => { const c = document.querySelector('#screen'); return !!c && c.width === 320; })(),
    titled: document.title,
    // localStorage still works, so a shipped web build still saves.
    saves: (() => { try { localStorage.setItem('__p', '1'); const v = localStorage.getItem('__p'); localStorage.removeItem('__p'); return v === '1'; } catch (e) { return false; } })(),
  }));
  check('a production build exposes no window.__game (no timeScale cheat, no test hooks)',
    prod.game === 'undefined' && prod.campaign === 'undefined' && prod.profile === 'undefined'
    && prod.storage === 'undefined' && prod.input === 'undefined', JSON.stringify(prod));
  check('but the game still boots and renders in production', prod.booted && /FINAL RENTAL/.test(prod.titled));
  check('and a shipped web build can still save (localStorage)', prod.saves);
  check('no page errors in the production build', errs.length === 0, errs.join(' | '));

  await page.close();
  await new Promise((r) => server.close(r));
  rmSync(stage, { recursive: true, force: true });
}

await browser.close();
console.log(fails ? `\nstorage FAILED (${fails})` : '\nstorage clean');
process.exit(fails ? 1 : 0);
