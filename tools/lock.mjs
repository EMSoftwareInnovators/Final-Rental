/* The pointer, across a night boundary.

   A pointer-lock request is only granted off the back of a user gesture.
   The end of the establishing shot is not one, so the request was refused
   and the camera did not move for the whole shift. This drives two nights
   through the real thing -- no calling requestLock() by hand -- and checks
   the camera is live at the start of each. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

await ev(() => { window.__game.sound.muted = true; });

/* Headless Chromium will not hand out a real pointer lock, so stand in for
   the browser: record who asked and when, and only grant it when the ask
   came from inside a genuine user gesture -- which is exactly the rule the
   real thing applies, and exactly the rule the old code broke. */
await ev(() => {
  const g = window.__game;
  window.__lock = { asks: [], granted: false, gestureAt: -1e9 };
  const el = g.input.target;
  addEventListener('keydown', () => { window.__lock.gestureAt = performance.now(); }, true);
  el.addEventListener('mousedown', () => { window.__lock.gestureAt = performance.now(); }, true);
  el.requestPointerLock = () => {
    const L = window.__lock;
    const fresh = performance.now() - L.gestureAt < 1000;
    L.asks.push({ t: Math.round(performance.now()), fresh });
    if (!fresh) return Promise.reject(new Error('no user activation'));
    L.granted = true;
    g.input.locked = true;
    if (g.input.onLockChange) g.input.onLockChange(true);
    return Promise.resolve();
  };
  document.exitPointerLock = () => {
    window.__lock.granted = false;
    g.input.locked = false;
    if (g.input.onLockChange) g.input.onLockChange(false);
  };
});

const state = () => ev(() => ({
  state: window.__game.state, locked: window.__game.input.locked,
  want: window.__game.wantLock, yaw: +window.__game.player.yaw.toFixed(3),
  asks: window.__lock.asks.length, stale: window.__lock.asks.filter((a) => !a.fresh).length,
}));

// Start a run the way a player does.
await page.keyboard.press('Enter');
await wait(500);
check('the establishing shot is running', (await state()).state === 'ESTABLISH', (await state()).state);

// Let it play out. This is the gap that kills the request: by the time the
// shot ends, the keystroke that started it is long gone.
await wait(1200);
await ev(() => { window.__game.estT = 99; });
await wait(900);
let s = await state();
check('and it reaches the shift', s.state === 'PLAY', s.state);
check('the shift knows it wants the pointer', s.want === true);
check('and the browser refused the request made at the end of the shot',
  s.stale > 0, `${s.stale} of ${s.asks} asks had no gesture behind them`);
check('so the player is told what to do about it',
  /click/i.test(await ev(() => window.__game.ui.el.prompt.textContent || '')),
  await ev(() => (window.__game.ui.el.prompt.textContent || '').slice(0, 40)));

// One click, which IS a gesture, and the camera is live.
await page.mouse.click(320, 240);
await wait(300);
s = await state();
check('one click takes the pointer', s.locked === true);

const moved = await ev(async () => {
  const g = window.__game;
  const before = g.player.yaw;
  for (let i = 0; i < 20; i++) {
    g.input.mdx = 40;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return Math.abs(g.player.yaw - before);
});
check('and the camera turns', moved > 0.05, `yaw moved ${moved.toFixed(3)}`);

/* ---- now the part that was actually broken: the next night ---- */
/* Run the night out. Midnight shuts the door rather than ending the shift,
   so the shop has to empty and the tapes have to be away before a report
   appears -- put the strays back as they turn up. */
await ev(() => { window.__game.timeScale = 60; });
for (let i = 0; i < 260; i++) {
  if ((await state()).state === 'REPORT') break;
  await ev(() => {
    const g = window.__game;
    if (g.dlg.node) g.dlg.cancel();
    if (!g.closing) return;
    g.player.held.length = 0; g.bin.length = 0;
    g.counterSlots = g.counterSlots.map(() => null);
    g.rewinder.tape = null;
  });
  await wait(200);
}
await ev(() => { window.__game.timeScale = 1; });
check('the night runs to a report', (await state()).state === 'REPORT', (await state()).state);

const asksBefore = (await state()).asks;
// Clear the report panel and be sure the next night actually started before
// timing anything against it.
for (let i = 0; i < 12 && (await state()).state === 'REPORT'; i++) {
  await page.keyboard.press('Enter');
  await wait(250);
}
check('the report advances to the next night', (await state()).state !== 'REPORT', (await state()).state);
// Sit through the shot properly. This is the case that was broken: by the
// time it ends, the keystroke that started the night is ancient history.
await wait(2400);
await ev(() => { window.__game.estT = 99; });
await wait(900);
s = await state();
check('night two reaches the shift', s.state === 'PLAY', s.state);
check('and the shot outlasted the gesture that started the night',
  s.stale >= 2, `${s.asks - asksBefore} asks this night, ${s.stale} stale in total`);
check('the second night says so too rather than going quiet',
  s.locked === false && /click/i.test(await ev(() => window.__game.ui.el.prompt.textContent || '')),
  await ev(() => (window.__game.ui.el.prompt.textContent || '').slice(0, 40)));
await page.mouse.click(320, 240);
await wait(300);
s = await state();
check('and one click gets the camera back', s.locked === true);

const moved2 = await ev(async () => {
  const g = window.__game;
  const before = g.player.yaw;
  for (let i = 0; i < 20; i++) {
    g.input.mdx = 40;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return Math.abs(g.player.yaw - before);
});
check('so the camera works on the second night too', moved2 > 0.05, `yaw moved ${moved2.toFixed(3)}`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nlock FAILED (${fails})` : '\nlock clean');
process.exit(fails ? 1 : 0);
