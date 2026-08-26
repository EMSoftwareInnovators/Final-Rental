/* Closing time. People come in right up to midnight; the shift is not over
   until the last of them is out and every tape is back in a run. */
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

/* ---------- 1. the rota runs to the end of the night ---------- */
const rota = await ev(() => {
  const M = window.__night;
  const out = [];
  for (const n of [3, 6, 10]) {
    const x = M.makeNight(555, n, 'HORROR');
    const last = Math.max(...x.schedule.map((s) => s.t));
    out.push({ n, len: Math.round(x.length), last: Math.round(last), frac: last / x.length });
  }
  return out;
});
check('the planned rota keeps arriving into the last stretch of the shift',
  rota.every((r) => r.frac > 0.8),
  rota.map((r) => `night ${r.n}: last at ${r.last}s of ${r.len}s`).join(', '));

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(500);
await ev(() => { window.__game.estT = 99; });
await wait(700);
check('shift started', await ev(() => window.__game.state) === 'PLAY');

/* ---------- 2. people keep coming once the rota is spent ---------- */
const walkIns = await ev(async () => {
  const g = window.__game;
  g.night.schedule.forEach((s) => { s.spawned = true; });
  g.customers.length = 0;
  g.officerDone = true;
  g.walkInAt = 0;
  g.timeScale = 40;
  const seen = new Set();
  for (let i = 0; i < 140; i++) {
    await new Promise((r) => setTimeout(r, 25));
    g.customers.forEach((c) => seen.add(c.id));
  }
  g.timeScale = 1;
  return { seen: seen.size, sim: Math.round(g.sim) };
});
check('the shop does not go empty once the rota is spent',
  walkIns.seen >= 3, `${walkIns.seen} walked in over ${walkIns.sim}s of shop time`);

/* ---------- 3. midnight shuts the door ---------- */
const shut = await ev(() => {
  const g = window.__game;
  g.elapsed = g.night.length + 1;
  g.officerDone = true;
  const before = g.customers.length;
  g.updateClosing(0.016, false, false);
  return { closing: g.closing, locked: g.door.locked, before,
    obj: g.ui.el.objective ? g.ui.el.objective.textContent : '' };
});
check('reaching midnight shuts the door rather than ending the night',
  shut.closing === true && shut.locked === true);

const noMore = await ev(async () => {
  const g = window.__game;
  const before = g.customers.length;
  g.night.schedule.forEach((s) => { s.spawned = false; s.t = 0; });
  g.walkInAt = 0;
  for (let i = 0; i < 30; i++) { g.spawnDue(); await new Promise((r) => setTimeout(r, 5)); }
  return { before, after: g.customers.length };
});
check('and nobody else comes in after it', noMore.after === noMore.before,
  `${noMore.before} in the shop, ${noMore.after} after thirty spawn ticks`);

/* ---------- 4. the night waits for the shop to clear ---------- */
const waits = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  // one customer still browsing, and a tape left in the rewinder
  g.customers.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 3; c.z = 6; c.state = 'BROWSING';
  g.customers.push(c);
  g.rewinder.tape = T.makeTape('HORROR', g.rng, { rewound: false });
  const seen = [];
  for (let i = 0; i < 8; i++) { g.updateClosing(0.5, false, false); seen.push(g.state); }
  const objWithBoth = g.ui.el.objective ? g.ui.el.objective.textContent : '';
  // let them walk out
  // Walking out of the shop and off down the pavement takes a while.
  for (let i = 0; i < 4000; i++) {
    g.customers.forEach((x) => { if (!x.hidden) window.__cust.updateCustomer(x, 1 / 20, g.ctx); });
    g.customers = g.customers.filter((x) => x.state !== 'GONE');
    g.updateClosing(1 / 20, false, false);
    if (!g.customers.length) break;
  }
  const objTapeOnly = g.ui.el.objective ? g.ui.el.objective.textContent : '';
  const stateWithTape = g.state;
  // and finally shelve the stray
  g.rewinder.tape = null;
  g.updateClosing(0.5, false, false);
  return { seen, objWithBoth, objTapeOnly, stateWithTape, ended: g.state };
});
check('a shop with people in it does not close', waits.seen.every((s) => s === 'PLAY'));
check('and it says what is still outstanding', /still in the shop/.test(waits.objWithBoth)
  && /not shelved/.test(waits.objWithBoth), waits.objWithBoth);
check('the last customer leaving is still not enough on its own',
  waits.stateWithTape === 'PLAY' && /not shelved/.test(waits.objTapeOnly), waits.objTapeOnly);
check('and shelving the last tape is what ends the shift',
  waits.ended === 'REPORT', waits.ended);

/* ---------- 5. and a stubborn customer cannot hold it open forever ---------- */
const stubborn = await ev(() => {
  const g = window.__game;
  g.state = 'PLAY';
  g.closing = false; g.closingT = 0;
  g.elapsed = g.night.length + 1;
  g.customers.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 10.75; c.z = 0.8; c.state = 'WAITING'; c.queueIndex = 0;
  g.customers.push(c);
  let leftAt = -1;
  for (let i = 0; i < 12000; i++) {
    g.updateClosing(1 / 30, false, false);
    if (c.state === 'LEAVING' || c.state === 'GONE') { leftAt = i / 30; break; }
  }
  return { leftAt: Math.round(leftAt) };
});
check('somebody parked at the counter is eventually shown the door',
  stubborn.leftAt > 60 && stubborn.leftAt < 300,
  `sent home after ${stubborn.leftAt}s of closing`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nclosing FAILED (${fails})` : '\nclosing clean');
process.exit(fails ? 1 : 0);
