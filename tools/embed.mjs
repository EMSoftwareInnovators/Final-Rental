/* The game as itch.io serves it: in an iframe, on another origin.
 *
 * That is the whole difference between the browser build working on your
 * own machine and working on a store page. A cross-origin frame does not
 * get pointer lock, the gamepad, fullscreen or storage unless the page
 * around it hands them over, and the page around it is not ours. A
 * first-person game that cannot capture the mouse is not a game.
 *
 * So this serves the game on one origin, embeds it from another, and
 * reports what survives -- under the permissions a host might plausibly
 * give it, and under none at all, which is the failure worth designing
 * for. It asserts nothing about itch's own markup, which is theirs to
 * change; it establishes what the game needs, so the answer to "will this
 * work embedded" is a measurement rather than a hope.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const GAME_PORT = 8113;          // where the game lives
const HOST_PORT = 8114;          // the "store page" it is embedded in

/* By default the repo. Point it at what `npm run web` unpacked and it
   checks the thing that actually ships:
     npm run web && node tools/embed.mjs dist/final-rental-web        */
const ROOT = path.resolve(process.argv[2] || process.cwd());
console.log(`  serving ${ROOT}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
};

/* localhost and 127.0.0.1 are different origins to a browser, which is all
   the cross-origin this needs. */
const games = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  /* A frame with nothing in it but a key counter, on the game's own
     origin. The one question the game itself cannot answer cleanly: a
     click on its canvas grabs the pointer, and after that this browser
     stops routing synthesized keys into the frame -- which a real one
     does not do. So the keyboard gets asked on its own, plainly. */
  if (p === '/probe') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#333">'
      + '<script>window.__k=[];addEventListener("keydown",e=>window.__k.push(e.code))<\/script>');
  }
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
}).listen(GAME_PORT);

/* The variants worth knowing about. The first is roughly what a host that
   wants games to work hands over; the last is what you get if it does
   not, and is the one that decides whether this can ship embedded. */
const CASES = [
  {
    id: 'permissive',
    what: 'a host that grants what a game needs',
    sandbox: 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms',
    allow: 'autoplay; fullscreen; gamepad; pointer-lock',
  },
  {
    id: 'no-pointer-lock',
    what: 'the same, minus pointer lock',
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-modals allow-forms',
    allow: 'autoplay; fullscreen; gamepad',
  },
  {
    id: 'bare',
    what: 'a plain iframe, nothing granted',
    sandbox: null,
    allow: null,
  },
];

const host = createServer((req, res) => {
  const id = new URL(req.url, 'http://x').searchParams.get('case') || 'permissive';
  const c = CASES.find((x) => x.id === id) || CASES[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>host</title>
    <body style="margin:0;background:#222">
    <iframe id="f" src="http://localhost:${GAME_PORT}/index.html"
      width="960" height="720" frameborder="0"
      ${c.sandbox ? `sandbox="${c.sandbox}"` : ''}
      ${c.allow ? `allow="${c.allow}"` : ''}></iframe>`);
}).listen(HOST_PORT);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const results = {};
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${HOST_PORT}/?case=${c.id}`, { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  const frame = page.frames().find((f) => f.url().includes(`:${GAME_PORT}`));
  const out = { errs };
  if (!frame) {
    results[c.id] = Object.assign(out, { booted: false });
    await page.close();
    continue;
  }

  out.booted = await frame.evaluate(() => !!window.__game);
  out.tris = out.booted ? await frame.evaluate(() => window.__game.raster.tris) : 0;

  /* Storage: partitioned per top-level site in a third-party frame, and
     refused outright under some privacy settings. The game already wraps
     both calls, so the question is whether options persist, not whether
     it survives. */
  out.storage = await frame.evaluate(() => {
    try {
      localStorage.setItem('__p', '1');
      const v = localStorage.getItem('__p'); localStorage.removeItem('__p');
      return v === '1' ? 'works' : 'silently lost';
    } catch (e) { return `refused (${e.name})`; }
  });

  /* What the frame has been granted. Chrome reports this directly, which
     beats inferring it from behavior. */
  out.policy = await frame.evaluate(() => {
    const fp = document.featurePolicy || document.permissionsPolicy;
    if (!fp || !fp.allowsFeature) return 'not reported';
    return ['gamepad', 'fullscreen', 'autoplay']
      .map((f) => `${f}:${fp.allowsFeature(f) ? 'yes' : 'no'}`).join(' ');
  });

  /* And the one that decides it.

     Click into the frame before anything else. An iframe has no keyboard
     focus until it is clicked, so a key sent to the page around it goes
     nowhere -- which is a real thing about being embedded and not a bug,
     and is why hosts put a "click to start" splash in front. Sending
     Enter first and then wondering why the game had not started is a way
     to conclude the mouse is broken when it is only a cutscene. */
  if (out.booted) {
    await frame.evaluate(() => { window.__game.sound.muted = true; });
    const box = await page.locator('#f').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    out.started = await frame.evaluate(() => window.__game.state !== 'TITLE');
    await frame.evaluate(() => { window.__game.estT = 99; });
    await frame.waitForFunction(() => window.__game.state === 'PLAY', null, { timeout: 8000 })
      .catch(() => { });
    await frame.evaluate(() => {
      window.__diag = [];
      const orig = Element.prototype.requestPointerLock;
      Element.prototype.requestPointerLock = function (...a) {
        window.__diag.push('requested on #' + (this.id || this.tagName));
        try {
          const r = orig.apply(this, a);
          if (r && r.catch) r.catch((e) => window.__diag.push('rejected: ' + e.message));
          return r;
        } catch (e) { window.__diag.push('threw: ' + e.message); }
      };
      document.addEventListener('pointerlockerror', () => window.__diag.push('pointerlockerror event'));
      document.addEventListener('pointerlockchange', () => window.__diag.push(
        'change -> ' + (document.pointerLockElement ? 'LOCKED' : 'released')));
    });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    out.locked = await frame.evaluate(() => !!document.pointerLockElement);
    out.state = await frame.evaluate(() => window.__game.state);

    out.diag = await frame.evaluate(() => window.__diag);
    /* If the page refused, does the game say so -- or does it go on
       telling the player to click? */
    out.blocked = await frame.evaluate(() => !!window.__game.input.lockBlocked);
    out.prompt = await frame.evaluate(() => {
      const el = document.querySelector('#prompt');
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    out.target = await frame.evaluate(() => {
      const t = window.__game.input.target;
      return t ? '#' + (t.id || t.tagName) : 'none';
    });
  }
  results[c.id] = out;
  await page.close();
}

/* The keyboard, asked plainly. */
const kb = await (async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`http://127.0.0.1:${HOST_PORT}/?case=permissive`, { waitUntil: 'load' });
  await page.evaluate((port) => {
    document.body.innerHTML = `<iframe id="f" src="http://localhost:${port}/probe"
      width="600" height="300" frameborder="0"></iframe>`;
  }, GAME_PORT);
  await page.waitForTimeout(500);
  const f = page.frames().find((x) => x.url().includes('/probe'));
  await page.keyboard.press('KeyA');
  await page.waitForTimeout(200);
  const before = await f.evaluate(() => window.__k.slice());
  const box = await page.locator('#f').boundingBox();
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(200);
  const after = await f.evaluate(() => window.__k.slice());
  await page.close();
  return { before, after };
})();

for (const c of CASES) {
  const r = results[c.id];
  console.log(`\n  -- ${c.what} --`);
  check(`${c.id}: the game loads and draws`,
    r.booted && r.tris > 200, `${r.tris} triangles`);
  console.log(`       policy   ${r.policy}`);
  console.log(`       storage  ${r.storage}`);
  console.log(`       starts   ${r.started ? 'a night begins from inside the frame' : 'NEVER GETS GOING'}`);
  console.log(`       mouse    ${r.locked ? 'captured' : 'NOT captured'}  (state ${r.state}, target ${r.target})`);
  if (r.diag && r.diag.length) console.log(`       lock     ${r.diag.join(' | ')}`);
  else if (r.diag) console.log('       lock     never asked for');
  if (r.errs.length) console.log(`       errors   ${r.errs.join(' | ')}`);
}

/* What has to be true for this to be worth shipping embedded at all. */
console.log('');
check('embedded on another origin, the game still loads and runs',
  CASES.every((c) => results[c.id].booted && results[c.id].tris > 200));
check('and a night can be started from inside the frame',
  CASES.every((c) => results[c.id].started === true),
  CASES.map((c) => `${c.id}:${results[c.id].started}`).join(' '));
check('a cross-origin frame gets the keyboard, but only after a click',
  kb.before.length === 0 && kb.after.includes('KeyB'),
  `before the click ${JSON.stringify(kb.before)}, after it ${JSON.stringify(kb.after)}`);
check('and given pointer lock, it captures the mouse',
  results.permissive.locked === true,
  (results.permissive.diag || []).join(' | '));
check('and where it is not given, it fails quietly rather than breaking',
  results['no-pointer-lock'].locked === false
  && results['no-pointer-lock'].errs.length === 0
  && results['no-pointer-lock'].state === 'PLAY',
  `state ${results['no-pointer-lock'].state}`);
check('and tells the player that, rather than telling them to keep clicking',
  results['no-pointer-lock'].blocked === true
  && /will not let the game take the mouse/.test(results['no-pointer-lock'].prompt || ''),
  `"${results['no-pointer-lock'].prompt}"`);
check('and says nothing of the kind when the mouse is there to be had',
  results.permissive.blocked === false,
  `blocked: ${results.permissive.blocked}`);
check('and nothing about being in a frame throws',
  CASES.every((c) => results[c.id].errs.length === 0),
  CASES.map((c) => `${c.id}:${results[c.id].errs.length}`).join(' '));

console.log(fails ? `\nembed FAILED (${fails})` : '\nembed clean');
await browser.close();
games.close(); host.close();
process.exit(fails ? 1 : 0);
