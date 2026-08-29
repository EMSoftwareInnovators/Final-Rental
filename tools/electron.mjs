/* The desktop build, launched for real.

   The one thing that can quietly break here is the origin. A downloaded
   folder is file://, browsers refuse to load ES modules from file://, and
   the failure mode is a black window with one line in a console the player
   does not have. So the app serves itself over its own scheme, and this
   checks the parts of that nobody would notice were wrong until it was
   shipped: that the page loaded from `game://`, that a module actually
   ran (which only happens if it was served as JavaScript), that the
   stylesheet arrived, and that nothing outside the game is reachable
   through the same door.

   Run under a virtual display on a headless machine:
     xvfb-run -a node tools/electron.mjs

   Pass a built executable to check the packaged article instead of the
   repo. That is the run that matters: packaged, the game lives inside
   app.asar and `__dirname` points into it, which is exactly the kind of
   thing that works from a folder and does not from an archive.
     npx electron-builder --linux --dir
     xvfb-run -a node tools/electron.mjs dist/linux-unpacked/final-rental
*/
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUILT = process.argv[2];
if (BUILT && !existsSync(BUILT)) {
  console.error(`no such executable: ${BUILT}`);
  process.exit(1);
}
console.log(BUILT ? `  -- packaged: ${BUILT} --` : '  -- from the repo --');

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* The reachability probes below deliberately ask for things that are not
   there, and Chromium logs every one as a console error. Collected, but
   not counted as the app's. */
const errors = [];
let probing = false;
const app = await electron.launch(BUILT
  ? { executablePath: BUILT, args: ['--no-sandbox'] }
  : { args: ['.', '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const page = await app.firstWindow();
page.on('pageerror', (e) => { if (!probing) errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !probing) errors.push('[console] ' + m.text()); });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

/* ---------- 1. it came up, and it came up from the right place ---------- */
check('the app opens a window', !!page);
check('and the game is served over its own scheme, not file://',
  page.url().startsWith('game://app/'), page.url());

/* ---------- 2. the modules ran ---------- */
/* This is the whole reason the scheme exists. `window.__game` is set by
   src/main.js, which is an ES module importing a dozen others -- if any
   of it had been served as the wrong content type, or off an origin
   modules are not allowed on, none of it would exist. */
const booted = await page.evaluate(() => ({
  game: typeof window.__game === 'object' && !!window.__game,
  modules: ['__cust', '__ui', '__world', '__specials', '__input'].filter((k) => !!window[k]).length,
  canvas: (() => { const c = document.querySelector('#screen'); return c ? [c.width, c.height] : null; })(),
  /* And the stylesheet: if the CSS 404'd the cabinet would have no size. */
  styled: getComputedStyle(document.querySelector('#cabinet')).position === 'relative',
  title: document.title,
}));
check('the game booted', booted.game);
check('and every module it imports came through',
  booted.modules === 5, `${booted.modules} of 5 dev hooks present`);
check('the stylesheet arrived too', booted.styled);
check('and the screen is a 320x240 buffer',
  JSON.stringify(booted.canvas) === '[320,240]', JSON.stringify(booted.canvas));

/* ---------- 3. it plays ---------- */
/* Not a full playthrough -- that is what the other sixteen are for. Just
   far enough to prove the renderer, the input and the clock are alive
   inside Electron and not only inside a browser tab. */
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const running = await page.evaluate(() => {
  const g = window.__game;
  g.sound.muted = true;
  return { state: g.state, tris: g.raster.tris, night: g.nightNo };
});
check('a shift starts', running.state === 'ESTABLISH' || running.state === 'PLAY', running.state);
check('and the renderer is drawing the store',
  running.tris > 200, `${running.tris} triangles`);

/* The mouse. A first-person game that cannot capture the pointer is not
   playable, and pointer lock is a permission -- the app grants that one,
   and the camera and the microphone are refused.

   Past the establishing shot first. The game does not reach for the mouse
   during it, deliberately, and clicking through a cutscene and then
   reporting that pointer lock is broken is a way to spend an afternoon. */
await page.evaluate(() => { window.__game.estT = 99; });
await page.waitForFunction(() => window.__game.state === 'PLAY', null, { timeout: 8000 });
await page.mouse.click(400, 300);
await page.waitForTimeout(900);
const locked = await page.evaluate(() => ({
  locked: !!document.pointerLockElement,
  onCanvas: document.pointerLockElement === document.querySelector('#screen')
    || document.pointerLockElement === document.body
    || document.pointerLockElement === document.documentElement,
}));
check('clicking the screen captures the mouse', locked.locked, JSON.stringify(locked));

/* And the game remembers your options and your pad between runs, which
   needs a real origin -- an opaque one gets no storage at all. */
const store = await page.evaluate(() => {
  try {
    localStorage.setItem('__probe', 'kept');
    const back = localStorage.getItem('__probe');
    localStorage.removeItem('__probe');
    return back;
  } catch (e) { return `threw: ${e.name}`; }
});
check('and the origin has storage, so options survive a restart',
  store === 'kept', String(store));

/* ---------- 4. and only the game is behind that door ---------- */
/* The handler serves the page and src/, and resolves every request before
   it decides -- so the `..` spellings below have already collapsed into
   ordinary paths by the time anything is looked up, and land outside what
   is served. package.json sits next to index.html in the asar and is the
   honest test of that: it is right there, and it is not the game. */
probing = true;
const reach = await page.evaluate(async () => {
  const out = {};
  for (const [name, url] of [
    ['the page', 'game://app/index.html'],
    ['a module', 'game://app/src/main.js'],
    ['the manifest next to it', 'game://app/package.json'],
    ['dot-dot', 'game://app/../package.json'],
    ['encoded dot-dot', 'game://app/%2e%2e/package.json'],
    ['deep dot-dot', 'game://app/src/%2e%2e/%2e%2e/%2e%2e/etc/passwd'],
    ['the electron shell itself', 'game://app/electron/main.js'],
    ['a game file that is not there', 'game://app/src/nope.js'],
  ]) {
    try { out[name] = (await fetch(url)).status; } catch { out[name] = 'threw'; }
  }
  return out;
});
probing = false;
check('the page and the game are served',
  reach['the page'] === 200 && reach['a module'] === 200,
  `page ${reach['the page']}, module ${reach['a module']}`);
check('and nothing else in the folder is, however it is spelled',
  ['the manifest next to it', 'dot-dot', 'encoded dot-dot', 'deep dot-dot',
    'the electron shell itself'].every((k) => reach[k] === 403),
  JSON.stringify(reach));
check('a missing game file is a 404, not a crash',
  reach['a game file that is not there'] === 404);
if (BUILT) {
  check('and the whole thing came out of the archive',
    reach['the page'] === 200 && booted.game,
    'app.asar');
}

/* ---------- 4b. and the page cannot phone home ---------- */
const headers = await page.evaluate(async () => {
  const r = await fetch('game://app/index.html');
  return r.headers.get('content-security-policy');
});
check('the page is served under a policy that allows it nothing remote',
  !!headers && /default-src 'none'/.test(headers) && !/unsafe-eval/.test(headers),
  headers || '(no policy)');

/* ---------- 5. the window is a game's window ---------- */
const win = await app.evaluate(async ({ BrowserWindow, Menu }) => {
  const w = BrowserWindow.getAllWindows()[0];
  const before = w.isFullScreen();
  w.setFullScreen(true);
  const full = w.isFullScreen();
  w.setFullScreen(before);
  return {
    title: w.getTitle(),
    menu: Menu.getApplicationMenu(),
    visible: w.isVisible(),
    bg: w.getBackgroundColor(),
    full,
    ratio: (() => { const [x, y] = w.getContentSize(); return +(x / y).toFixed(2); })(),
  };
});
check('the window carries the game\'s own title', win.title === 'FINAL RENTAL', win.title);
check('there is no menu bar to reload the page from', win.menu === null);
check('the window was shown once there was something in it', win.visible === true);
check('it is black behind the picture', /^#0{6}$/i.test(win.bg), win.bg);
check('and it can go fullscreen', win.full === true);

/* ---------- 6. and it remembers the window ---------- */
/* The one thing in the shell that keeps state. Opened twice, into a
   user-data directory of its own so this cannot read or write a real
   player's. */
const userData = mkdtempSync(join(tmpdir(), 'fr-app-'));
const launch = () => electron.launch(BUILT
  ? { executablePath: BUILT, args: ['--no-sandbox', `--user-data-dir=${userData}`] }
  : {
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });

const WANT = { width: 900, height: 675 };
const first = await launch();
await (await first.firstWindow()).waitForLoadState('domcontentloaded');
await first.evaluate(async ({ BrowserWindow }, want) => {
  BrowserWindow.getAllWindows()[0].setContentSize(want.width, want.height);
}, WANT);
await new Promise((r) => setTimeout(r, 1200));      // past the save debounce
await first.close();

const second = await launch();
await (await second.firstWindow()).waitForLoadState('domcontentloaded');
const again = await second.evaluate(async ({ BrowserWindow }) => {
  const [x, y] = BrowserWindow.getAllWindows()[0].getContentSize();
  return { width: x, height: y };
});
await second.close();
rmSync(userData, { recursive: true, force: true });
/* Slack for whatever the window manager rounds it to; the point is that
   it came back near where it was left and not at the default. */
check('it opens where you left it',
  Math.abs(again.width - WANT.width) <= 40 && Math.abs(again.height - WANT.height) <= 40,
  `left it at ${WANT.width}x${WANT.height}, came back ${again.width}x${again.height}`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
if (errors.length) fails++;
console.log(fails ? `\nelectron FAILED (${fails})` : '\nelectron clean');
await app.close();
process.exit(fails ? 1 : 0);
