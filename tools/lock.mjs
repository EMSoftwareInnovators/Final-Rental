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
   so the store has to empty and the tapes have to be away before a report
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

/* ---------- the back room door, from the inside ---------- */
/* Standing behind it with it shut, the only thing on offer used to be the
   bolt -- so getting back out to the counter meant bolting yourself in and
   then unbolting, and there was no way to simply open the door you were
   standing behind. Interact opens doors. Bolt is its own verb. */
const doorInside = await ev(async () => {
  const g = window.__game;
  g.state = 'PLAY';
  g.customers.length = 0;
  g.storage.locked = false; g.storage.open = false; g.storage.broken = false;
  g.player.x = 5.95; g.player.z = 10.2; g.player.yaw = Math.PI; g.player.pitch = 0;
  for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
  const hover = g.hover && g.hover.kind;
  const prompt = g.ui.el.prompt.textContent;
  // and take it: interact must open, not bolt
  g.toggleStorage();
  return { hover, prompt: prompt.replace(/\s+/g, ' ').slice(0, 80),
    open: g.storage.open, locked: g.storage.locked };
});
check('the back room door can be seen from inside', doorInside.hover === 'storage');
check('and interact opens it rather than bolting you in',
  /Open the back room door/.test(doorInside.prompt) && doorInside.open && !doorInside.locked,
  doorInside.prompt);
check('with the bolt named as the other thing you could do',
  /throws the bolt/.test(doorInside.prompt));

/* And the bolt goes across when the key for it is pressed -- with the door
   under the reticle, which is where you are looking when you are hiding
   behind it, and with your back to it. Pressed for real, through the
   browser, because the bug this covers was a guard in the input path and
   not in anything a prompt string would have shown. */
const boltAt = async (yaw) => {
  await ev((y) => {
    const g = window.__game;
    g.state = 'PLAY';
    g.customers.length = 0;
    g.storage.locked = false; g.storage.open = false; g.storage.broken = false;
    g.player.x = 5.95; g.player.z = 10.2; g.player.yaw = y; g.player.pitch = 0;
    g.player.frozen = false;
  }, yaw);
  await page.waitForTimeout(160);
  const hover = await ev(() => window.__game.hover && window.__game.hover.kind);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(160);
  const thrown = await ev(() => window.__game.storage.locked);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(160);
  return { hover, thrown, drawn: await ev(() => window.__game.storage.locked) };
};
const fAtDoor = await boltAt(Math.PI);
check('F throws the bolt with the door right in front of you',
  fAtDoor.hover === 'storage' && fAtDoor.thrown === true && fAtDoor.drawn === false,
  `looking at ${fAtDoor.hover}, thrown ${fAtDoor.thrown}, then ${fAtDoor.drawn}`);
const fAway = await boltAt(0);
check('and with your back to it, without lining it up',
  fAway.hover !== 'storage' && fAway.thrown === true && fAway.drawn === false,
  `looking at ${fAway.hover}, thrown ${fAway.thrown}, then ${fAway.drawn}`);

/* Out on the floor it does nothing: it is the back room's bolt, not a
   remote control for it. */
const fOutside = await ev(async () => {
  const g = window.__game;
  g.storage.locked = false; g.storage.open = false;
  g.player.x = 10.75; g.player.z = 3.0; g.player.yaw = Math.PI;
  await new Promise((r) => requestAnimationFrame(r));
  return true;
});
void fOutside;
await page.keyboard.press('KeyF');
await page.waitForTimeout(160);
check('but not from out on the store floor',
  (await ev(() => window.__game.storage.locked)) === false);

const boltKeys = await ev(() => {
  const A = window.__input.PAD_ACTIONS;
  const d = window.__input.defaultBinds();
  return { bolt: A.bolt.def, confirm: A.confirm.def, onA: (d[0] || []).join('+') };
});
check('and the button that opens doors is not also the one that bolts them',
  !boltKeys.bolt.includes(0) && !boltKeys.onA.includes('bolt'),
  `bolt on ${boltKeys.bolt.join(',')}, select on ${boltKeys.confirm.join(',')} (${boltKeys.onA})`);

/* ---------- the door is not one big quad ---------- */
/* A meter wide and two meters tall in a single quad is mapped affinely
   across whatever a triangle covers, so the whole face slid about as you
   walked past it. The fix is the same one the popcorn sign and the counter
   front got: split it up until each cell is near enough square on screen
   that there is nothing left to see. */
const doorGeom = await ev(() => {
  const worst = {};
  const scan = (name, mesh) => {
    if (!mesh) return;
    let max = 0;
    for (let t = 0; t < mesh.triCount; t++) {
      const a = mesh.idx[t * 3], b = mesh.idx[t * 3 + 1], c = mesh.idx[t * 3 + 2];
      const P = (i) => [mesh.vx[i * 3], mesh.vx[i * 3 + 1], mesh.vx[i * 3 + 2]];
      const [p, q, r] = [P(a), P(b), P(c)];
      const e = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
      max = Math.max(max, e(p, q), e(q, r), e(r, p));
    }
    worst[name] = { edge: +max.toFixed(3), tris: mesh.triCount };
  };
  scan('shut', window.__game.world.storageDoorMesh);
  scan('kicked in', window.__game.world.storageDoorHitMesh);
  return worst;
});
check('the back room door is subdivided, not one big quad',
  Object.values(doorGeom).every((d) => d.edge < 0.62),
  Object.entries(doorGeom).map(([k, d]) => `${k}: longest edge ${d.edge}m over ${d.tris} tris`).join(' · '));

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nlock FAILED (${fails})` : '\nlock clean');
process.exit(fails ? 1 : 0);
