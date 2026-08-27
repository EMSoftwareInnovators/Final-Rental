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
  // and finally shelve the strays. Locking up takes a few seconds once the
  // shop is empty and tidy, so give it those.
  g.rewinder.tape = null;
  g.player.held.length = 0; g.bin.length = 0;
  g.counterSlots = g.counterSlots.map(() => null);
  let lockUp = -1;
  for (let i = 0; i < 400; i++) {
    g.updateClosing(0.05, false, false);
    if (g.state !== 'PLAY') { lockUp = +(i * 0.05).toFixed(2); break; }
  }
  return { seen, objWithBoth, objTapeOnly, stateWithTape, ended: g.state, lockUp };
});
check('a shop with people in it does not close', waits.seen.every((s) => s === 'PLAY'));
check('and it says what is still outstanding', /still in the shop/.test(waits.objWithBoth)
  && /not shelved/.test(waits.objWithBoth), waits.objWithBoth);
check('the last customer leaving is still not enough on its own',
  waits.stateWithTape === 'PLAY' && /not shelved/.test(waits.objTapeOnly), waits.objTapeOnly);
check('and shelving the last one is what ends the shift',
  waits.ended === 'REPORT', waits.ended);
check('with a few seconds to lock up rather than the lights going out mid-step',
  waits.lockUp >= 3 && waits.lockUp <= 6, `${waits.lockUp}s after the shop was clear`);

/* ---------- 4b. nobody in a video shop waits forever ---------- */
/* A queue whose head cannot be served used to stand there for the rest of
   the night. Patience ran out, a flag was set, and because the flag was the
   guard, nothing ever happened again: moods went to minus three hundred and
   six people stood at the counter until the heat death of the shift. */
const patience = await ev(() => {
  const g = window.__game;
  g.state = 'PLAY';
  g.closing = false; g.closingT = 0; g.elapsed = 0;
  g.customers.length = 0; g.queue.length = 0;
  const T = window.__tapes;
  // somebody at the window who can never be sold anything, and a line behind
  const sov = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SOVEREIGN'));
  sov.x = 10.75; sov.z = 0.8; sov.state = 'WAITING';
  g.customers.push(sov);
  for (let i = 0; i < 4; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
    c.script = 'rent'; c.x = 9.7 - i * 0.9; c.z = 0.8; c.state = 'WAITING';
    g.customers.push(c);
  }
  g.customers.forEach((c) => g.claimCounterSpot(c));
  const start = g.customers.length;

  let worstMood = 100;
  let clearedAt = -1;
  for (let i = 0; i < 40000; i++) {
    g.customers.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.customers = g.customers.filter((c) => c.state !== 'GONE');
    g.customers.forEach((c) => { worstMood = Math.min(worstMood, c.mood); });
    if (!g.customers.length) { clearedAt = Math.round(i / 30); break; }
  }
  const leftBehind = g.customers.length;
  g.customers.length = 0; g.queue.length = 0;
  return { start, leftBehind, clearedAt, worstMood: Math.round(worstMood), binned: g.bin.length };
});
check('a queue that cannot be served does not stand there forever',
  patience.leftBehind === 0,
  patience.clearedAt >= 0 ? `all ${patience.start} gave up within ${patience.clearedAt}s`
    : `${patience.leftBehind} still there`);
check('and nobody is left in a mood the scale does not go to',
  patience.worstMood >= 0, `worst mood seen ${patience.worstMood}`);
check('what they were holding ends up in the returns bin, not back on a shelf',
  patience.binned > 0, `${patience.binned} left in the bin`);

const beside = await ev(() => {
  const g = window.__game;
  // An earlier check bolted the door for closing; open the shop again.
  g.closing = false; g.closingT = 0; g.elapsed = 0; g.door.locked = false;
  g.customers.length = 0; g.queue.length = 0;
  const sov = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SOVEREIGN'));
  g.customers.push(sov);
  const c = window.__cust.createCustomer(g.rng, { intent: 'RETURN' });
  c.x = 6; c.z = 2; c.state = 'TO_COUNTER';
  g.customers.push(c);
  for (let i = 0; i < 6000; i++) {
    g.customers.forEach((x) => { if (!x.hidden) window.__cust.updateCustomer(x, 1 / 20, g.ctx); });
    if (sov.state === 'ACTING' && !sov.path && c.state === 'WAITING') break;
  }
  const out = { sovState: sov.state, sovQueue: sov.queueIndex,
    sovAt: [+sov.x.toFixed(2), +sov.z.toFixed(2)],
    otherState: c.state, otherQueue: c.queueIndex };
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('the one who argues stands at the end of the counter, not in the line',
  beside.sovState === 'ACTING' && beside.sovQueue < 0,
  `${beside.sovState} at ${beside.sovAt.join(',')}, queue index ${beside.sovQueue}`);
check('so the line behind him still moves',
  beside.otherState === 'WAITING' && beside.otherQueue === 0,
  `${beside.otherState} at the front`);

/* ---------- 4c. a cartridge is not a tape ---------- */
const words = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  const set = (items) => {
    g.player.held.length = 0; g.bin.length = 0;
    g.counterSlots = g.counterSlots.map(() => null);
    g.rewinder.tape = null;
    items.forEach((t) => g.bin.push(t));
    return g.strayMedia();
  };
  const tape = () => T.makeTape('HORROR', g.rng, { rewound: true });
  const game = () => T.makeTape('GAMES', g.rng, { rewound: true });
  const out = {
    oneTape: set([tape()]).word,
    twoTapes: set([tape(), tape()]).word,
    oneGame: set([game()]).word,
    twoGames: set([game(), game()]).word,
    mixed: set([tape(), game()]).word,
  };
  set([]);
  return out;
});
check('one tape is a tape and two are tapes',
  words.oneTape === 'tape' && words.twoTapes === 'tapes');
check('and a cartridge is never called a tape',
  words.oneGame === 'cartridge' && words.twoGames === 'cartridges',
  `${words.oneGame} / ${words.twoGames}`);
check('with a word that covers both when it is both', words.mixed === 'items', words.mixed);

const said = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const T = window.__tapes;
  const lines = { tape: [], game: [] };
  for (const [kind, genre] of [['tape', 'HORROR'], ['game', 'GAMES']]) {
    for (let i = 0; i < 40; i++) {
      const c = window.__cust.createCustomer(g.rng, { intent: 'RETURN' });
      c.tape = T.makeTape(genre, g.rng, { rewound: true, daysLate: 3 });
      c.script = 'return'; c.hasMoney = true; c.queueIndex = 0;
      c.x = 10.75; c.z = 0.8; c.state = 'WAITING';
      g.customers.push(c);
      const walk = (node, depth) => {
        if (!node || depth > 4) return;
        if (node.text) lines[kind].push(node.text);
        (node.choices || []).forEach((r) => {
          lines[kind].push(r.label || '');
          if (r.good) lines[kind].push(String(r.good));
          if (depth < 2) walk(r.go ? r.go() : (r.fn ? r.fn() : null), depth + 1);
        });
      };
      walk(D.talkTo(c, g.ctx, { atCounter: true }), 0);
      g.customers.splice(g.customers.indexOf(c), 1);
    }
  }
  // "tape rewinder", "shelf of tapes" and the like are about the shop, not
  // about what is in their hand.
  const ABOUT_THE_SHOP = /rewinder|shelf of tapes|videotapes|tape it|chew tapes|my tapes/i;
  const bad = lines.game.filter((t) => /\btapes?\b/i.test(t) && !ABOUT_THE_SHOP.test(t));
  return { gameLines: lines.game.length, bad: [...new Set(bad)].slice(0, 4) };
});
check('and nobody handing back a game calls it a tape',
  said.bad.length === 0, said.bad.join(' | ') || `${said.gameLines} lines checked`);

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
