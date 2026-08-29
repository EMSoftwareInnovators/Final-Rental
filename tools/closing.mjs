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
check('the store does not go empty once the rota is spent',
  walkIns.seen >= 3, `${walkIns.seen} walked in over ${walkIns.sim}s of store time`);

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
  `${noMore.before} in the store, ${noMore.after} after thirty spawn ticks`);

/* ---------- 3b. it locks the door; it does not clear the room ---------- */
/* Midnight used to march the whole store out at the stroke of twelve.
   Everybody who was inside before the bolt went across still gets to pick
   something out and pay for it -- all closing does is stop anyone else
   coming in. */
const finishUp = await ev(() => {
  const g = window.__game;
  g.state = 'PLAY';
  g.customers.length = 0; g.queue.length = 0;
  g.closing = false; g.closingT = 0;
  g.elapsed = g.night.length + 1;
  g.officerDone = true;

  // Three people mid-browse when the clock turns over.
  const crowd = [];
  for (let i = 0; i < 3; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.hasMoney = true;
    c.x = 3.0 + i * 1.4; c.z = 6.0; c.state = 'BROWSING'; c.path = null;
    g.customers.push(c); crowd.push(c);
  }
  g.updateClosing(1 / 30, false, false);
  const rightAfter = crowd.map((c) => c.state);

  /* A hundred seconds is a long browse and nowhere near long enough for
     anybody to run out of patience at the counter, which is a separate
     thing from closing and has its own check further down. */
  let took = -1;
  for (let i = 0; i < 3000; i++) {
    crowd.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateClosing(1 / 30, false, false);
    if (crowd.every((c) => c.state === 'WAITING')) { took = Math.round(i / 30); break; }
  }
  /* Let the line settle before asking whether it can be served. Places are
     handed out as people arrive, so for a frame or two after the last of
     them lands the front of the line can still be somebody walking. */
  for (let i = 0; i < 300; i++) {
    crowd.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateClosing(1 / 30, false, false);
  }
  const front = g.queue[0];
  const out = {
    rightAfter,
    states: crowd.map((c) => c.state),
    picked: crowd.filter((c) => !!c.tape).length,
    why: front ? (g.cannotServe(front) || 'can be served') : 'nobody at the counter',
    idx: crowd.map((c) => c.queueIndex).sort((a, b) => a - b).join(','),
    took,
  };
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('midnight does not turn the people already inside out of the store',
  finishUp.rightAfter.every((s) => s !== 'LEAVING'), finishUp.rightAfter.join(', '));
check('they still get to pick something off the shelf',
  finishUp.picked === 3, `${finishUp.picked} of 3 came away with something`);
check('and still line up to pay for it',
  finishUp.states.every((s) => s === 'WAITING') && finishUp.idx === '0,1,2',
  `${finishUp.states.join(', ')} at places ${finishUp.idx} after ${finishUp.took}s`);
check('and the one at the front can be rung up like any other customer',
  finishUp.why === 'can be served', finishUp.why);

/* ---------- 4. the night waits for the store to clear ---------- */
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
  /* Now let them finish and go. Closing no longer sends anybody home, so
     this stands in for the customer being served and heading out on their
     own -- what the shift is waiting on is the room emptying, however it
     empties.
     Walking out of the store and off down the sidewalk takes a while. */
  g.customers.forEach((x) => g.ctx.leave(x));
  for (let i = 0; i < 4000; i++) {
    g.customers.forEach((x) => { if (!x.hidden) window.__cust.updateCustomer(x, 1 / 20, g.ctx); });
    g.customers = g.customers.filter((x) => x.state !== 'GONE');
    g.updateClosing(1 / 20, false, false);
    if (!g.customers.length) break;
  }
  const objTapeOnly = g.ui.el.objective ? g.ui.el.objective.textContent : '';
  const stateWithTape = g.state;
  // and finally shelve the strays. Locking up takes a few seconds once the
  // store is empty and tidy, so give it those.
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
check('a store with people in it does not close', waits.seen.every((s) => s === 'PLAY'));
check('and it says what is still outstanding', /still in the store/.test(waits.objWithBoth)
  && /not shelved/.test(waits.objWithBoth), waits.objWithBoth);
check('the last customer leaving is still not enough on its own',
  waits.stateWithTape === 'PLAY' && /not shelved/.test(waits.objTapeOnly), waits.objTapeOnly);
check('and shelving the last one is what ends the shift',
  waits.ended === 'REPORT', waits.ended);
check('with a few seconds to lock up rather than the lights going out mid-step',
  waits.lockUp >= 3 && waits.lockUp <= 6, `${waits.lockUp}s after the store was clear`);

/* ---------- 4b. nobody in a video store waits forever ---------- */
/* A line whose head cannot be served used to stand there for the rest of
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
check('a line that cannot be served does not stand there forever',
  patience.leftBehind === 0,
  patience.clearedAt >= 0 ? `all ${patience.start} gave up within ${patience.clearedAt}s`
    : `${patience.leftBehind} still there`);
check('and nobody is left in a mood the scale does not go to',
  patience.worstMood >= 0, `worst mood seen ${patience.worstMood}`);
check('what they were holding ends up in the returns bin, not back on a shelf',
  patience.binned > 0, `${patience.binned} left in the bin`);

const beside = await ev(() => {
  const g = window.__game;
  // An earlier check bolted the door for closing; open the store again.
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
  `${beside.sovState} at ${beside.sovAt.join(',')}, place ${beside.sovQueue}`);
check('so the line behind him still moves',
  beside.otherState === 'WAITING' && beside.otherQueue === 0,
  `${beside.otherState} at the front`);

/* ---------- 4b2. the line is decided by who gets there ---------- */
/* Somebody who sets off first from the far end of the store used to hold
   first place while a man standing next to the register walked up and was put
   behind him. A line is decided by who reaches it. */
const line = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  g.customers.length = 0; g.queue.length = 0;
  g.closing = false; g.elapsed = 0; g.door.locked = false;

  const make = (x, z) => {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
    c.script = 'rent'; c.hasMoney = true;
    c.x = x; c.z = z; c.state = 'TO_COUNTER'; c.path = null;
    g.customers.push(c);
    return c;
  };

  // Far sets off first, from the other end of the store.
  const far = make(1.0, 8.0);
  far.name = 'Far Away';
  for (let i = 0; i < 20; i++) window.__cust.updateCustomer(far, 1 / 20, g.ctx);
  const farClaimedEarly = g.queue.includes(far);

  // Near sets off a beat later, from right beside the counter.
  const near = make(9.6, 1.6);
  near.name = 'Right There';

  let order = null;
  for (let i = 0; i < 4000; i++) {
    [far, near].forEach((c) => window.__cust.updateCustomer(c, 1 / 20, g.ctx));
    if (far.state === 'WAITING' && near.state === 'WAITING') {
      order = g.queue.map((c) => c.name);
      break;
    }
  }
  const out = {
    farClaimedEarly, order,
    nearIndex: near.queueIndex, farIndex: far.queueIndex,
    nearAt: [+near.x.toFixed(2), +near.z.toFixed(2)],
  };
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('setting off first does not reserve you a place',
  line.farClaimedEarly === false, `claimed while still walking: ${line.farClaimedEarly}`);
check('the one who actually reaches the counter first is first in the line',
  line.order && line.order[0] === 'Right There' && line.nearIndex === 0 && line.farIndex === 1,
  line.order ? line.order.join(' then ') : 'neither of them ever got there');

/* Nor does a slow walker join it from the other end of the store. The walk
   to the back of the line had a nine-second backstop on it, and nine
   seconds is less than it takes the slowest personality in the game to
   cross the floor from the far corner -- so they took their place in the
   line while they were still up by the horror shelf and covered the rest
   of the room standing in it, holding first place against somebody already
   at the register. */
const slowWalk = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  const far = [];
  for (let trial = 0; trial < 400 && far.length < 12; trial++) {
    g.customers.length = 0; g.queue.length = 0;
    g.closing = false; g.elapsed = 0; g.door.locked = false;
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    // The slowest people in the store are the ones this used to catch.
    if (c.personality.speed > 0.75) continue;
    c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
    c.script = 'rent'; c.hasMoney = true;
    c.x = 1.0; c.z = 8.0; c.state = 'TO_COUNTER'; c.path = null;
    g.customers.push(c);
    for (let i = 0; i < 4000; i++) {
      window.__cust.updateCustomer(c, 1 / 30, g.ctx);
      if (c.state === 'WAITING') break;
    }
    far.push({ speed: +c.personality.speed.toFixed(2),
      gap: +Math.hypot(c.x - 10.75, c.z - 0.8).toFixed(2) });
  }
  g.customers.length = 0; g.queue.length = 0;
  const worst = far.reduce((a, b) => (b.gap > a.gap ? b : a), { gap: -1 });
  return { n: far.length, worst };
});
check('a slow walker joins the line when they reach it, not when a timer says so',
  slowWalk.n > 0 && slowWalk.worst.gap < 1.0,
  `${slowWalk.n} slow walkers, worst joined ${slowWalk.worst.gap}m from the window`);

/* And a line still forms properly when everybody starts from the same place. */
const stack = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  g.customers.length = 0; g.queue.length = 0;
  const made = [];
  for (let i = 0; i < 4; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
    c.script = 'rent'; c.hasMoney = true;
    c.x = 6.4 + i * 0.1; c.z = 2.6; c.state = 'TO_COUNTER'; c.path = null;
    g.customers.push(c); made.push(c);
  }
  for (let i = 0; i < 6000; i++) {
    made.forEach((c) => window.__cust.updateCustomer(c, 1 / 20, g.ctx));
    if (made.every((c) => c.state === 'WAITING')) break;
  }
  const idx = made.map((c) => c.queueIndex).sort((a, b) => a - b);
  const spread = made.map((c) => +c.x.toFixed(1));
  g.customers.length = 0; g.queue.length = 0;
  return { idx, spread, waiting: made.filter((c) => c.state === 'WAITING').length };
});
check('four people arriving together make one line, not a heap',
  stack.waiting === 4 && stack.idx.join(',') === '0,1,2,3',
  `places ${stack.idx.join(',')} at x ${stack.spread.join(', ')}`);

/* ---------- 4b3. they cost you their time, not the shift's ---------- */
const clockHold = await ev(async () => {
  const g = window.__game;
  g.state = 'PLAY';
  g.customers.length = 0; g.queue.length = 0;
  g.closing = false; g.closingT = 0; g.elapsed = 10; g.officerDone = true;
  g.door.locked = false;
  if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; }

  const runFor = async (frames) => {
    const a = g.elapsed;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    return +(g.elapsed - a).toFixed(2);
  };

  const before = await runFor(20);
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SOVEREIGN'));
  c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
  g.customers.push(c);
  const held = await runFor(20);
  const presentWhileHeld = g.grinderPresent();

  // on his way out, the shift starts again -- no waiting for the sidewalk
  c.state = 'LEAVING'; c.leaving = true;
  const leaving = await runFor(20);
  const presentWhileLeaving = g.grinderPresent();

  g.customers.length = 0;
  const after = await runFor(20);
  return { before, held, leaving, after, presentWhileHeld, presentWhileLeaving };
});
check('an ordinary shift clock runs', clockHold.before > 0.05, `${clockHold.before}s in 20 frames`);
check('and stops dead while one of the three is in the building',
  clockHold.held === 0 && clockHold.presentWhileHeld,
  `${clockHold.held}s while he stood there`);
check('it starts again the moment he is on his way out, not when he is off the sidewalk',
  clockHold.leaving > 0.05 && !clockHold.presentWhileLeaving,
  `${clockHold.leaving}s once he was leaving`);
check('and keeps running once he has gone', clockHold.after > 0.05, `${clockHold.after}s`);

const ignoredEnds = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SOVEREIGN'));
  c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
  g.customers.push(c);
  let t = 0;
  for (let i = 0; i < 60000 && g.grinderPresent(); i++) {
    window.__cust.updateCustomer(c, 1 / 20, g.ctx);
    t += 1 / 20;
  }
  const out = { cleared: !g.grinderPresent(), minutes: +(t / 60).toFixed(1) };
  g.customers.length = 0;
  return out;
});
check('so a player who simply ignores him is not stuck forever either',
  ignoredEnds.cleared, `he gave up after ${ignoredEnds.minutes} minutes`);

/* ---------- 4b4. nobody parks against the counter ---------- */
const settle = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  const out = { stuck: [], running: [], notServable: [] };
  g.closing = false; g.elapsed = 0; g.door.locked = false;

  // Lines of every length, started from awkward places -- including right
  // up against the counter face, which is where they used to wedge.
  const starts = [
    [10.6, 1.05], [11.9, 1.05], [9.2, 1.05], [12.4, 1.0],
    [6.0, 2.2], [1.0, 8.0], [10.75, 0.4], [8.9, 1.1],
  ];
  for (let n = 1; n <= 4; n++) {
    for (const [sx, sz] of starts) {
      g.customers.length = 0; g.queue.length = 0;
      const crowd = [];
      for (let i = 0; i < n; i++) {
        const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
        c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
        c.script = 'rent'; c.hasMoney = true;
        c.x = i === 0 ? sx : 6.0 + i * 0.4;
        c.z = i === 0 ? sz : 2.2;
        c.state = 'TO_COUNTER'; c.path = null;
        if (i % 2) c.rushing = true;
        g.customers.push(c); crowd.push(c);
      }
      for (let i = 0; i < 12000; i++) {
        crowd.forEach((c) => window.__cust.updateCustomer(c, 1 / 30, g.ctx));
        if (crowd.every((c) => c.state === 'WAITING')) break;
      }
      /* Let them settle, then watch. A customer shuffling into place moves
         for a moment and stops; one that is oscillating never stops, so
         count the frames each of them is moving on rather than the total,
         and look at the worst of them. */
      const busy = crowd.map(() => 0);
      const SETTLE = 400, WATCH = 200;
      for (let i = 0; i < SETTLE + WATCH; i++) {
        crowd.forEach((c) => window.__cust.updateCustomer(c, 1 / 30, g.ctx));
        if (i >= SETTLE) crowd.forEach((c, j) => { if (c.moveSpeed > 0.02) busy[j]++; });
      }
      const moving = Math.max(...busy) > WATCH * 0.1 ? Math.max(...busy) : 0;
      const tag = `${n}@${sx},${sz}`;
      crowd.forEach((c) => {
        const off = c.targetSpot ? Math.hypot(c.x - c.targetSpot.x, c.z - c.targetSpot.z) : 99;
        if (off > 0.3) out.stuck.push(`${tag} off by ${off.toFixed(2)}`);
      });
      if (moving) out.running.push(`${tag} still moving on ${moving} of 200 frames`);
      const front = g.queue[0];
      if (front && g.cannotServe(front)) out.notServable.push(`${tag} ${g.cannotServe(front)}`);
    }
  }
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('everybody in the line ends up on their spot, from anywhere',
  settle.stuck.length === 0, settle.stuck.slice(0, 3).join(' | ') || '32 lines settled');
check('and stops walking once they are on it',
  settle.running.length === 0, settle.running.slice(0, 3).join(' | ') || 'nobody jogging on the spot');
check('and the one at the front can always actually be served',
  settle.notServable.length === 0, settle.notServable.slice(0, 3).join(' | '));

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
  // "tape rewinder", "shelf of tapes" and the like are about the store, not
  // about what is in their hand.
  const ABOUT_THE_SHOP = /rewinder|shelf of tapes|videotapes|tape it|chew tapes|my tapes/i;
  const bad = lines.game.filter((t) => /\btapes?\b/i.test(t) && !ABOUT_THE_SHOP.test(t));
  return { gameLines: lines.game.length, bad: [...new Set(bad)].slice(0, 4) };
});
check('and nobody handing back a game calls it a tape',
  said.bad.length === 0, said.bad.join(' | ') || `${said.gameLines} lines checked`);

/* ---------- 4d. the doors have to actually open ---------- */
/* The deadbolt stops people getting IN. Anybody already inside works the
   thumb latch and walks out -- and the leaves have to swing when they do,
   or the store empties at closing with everybody walking through a shut
   door. The rule the doors are drawn by and the rule people are moved by
   have to be the same rule. */
const doors = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0; g.queue.length = 0;
  g.door.locked = true; g.door.holdOpen = 0; g.door.swing = 0; g.door.fromInside = false;
  for (let i = 0; i < 60; i++) g.updateDoor(1 / 30);
  const shut = +g.door.swing.toFixed(3);

  // somebody outside tries it: it stays shut
  const outside = { z: -0.6, leaving: false };
  g.ctx.openDoor(outside);
  for (let i = 0; i < 20; i++) g.updateDoor(1 / 30);
  const afterOutside = +g.door.swing.toFixed(3);

  g.door.holdOpen = 0; g.door.fromInside = false;
  for (let i = 0; i < 90; i++) g.updateDoor(1 / 30);

  // somebody on their way out works it: it opens
  const leaver = { z: 0.4, leaving: true };
  g.ctx.openDoor(leaver);
  for (let i = 0; i < 20; i++) g.updateDoor(1 / 30);
  const afterLeaver = +g.door.swing.toFixed(3);

  // and it shuts itself again afterwards
  for (let i = 0; i < 200; i++) g.updateDoor(1 / 30);
  const settled = +g.door.swing.toFixed(3);
  const stillInside = g.door.fromInside;
  g.door.locked = false;
  return { shut, afterOutside, afterLeaver, settled, stillInside };
});
check('a bolted door stays shut for somebody on the sidewalk',
  doors.shut < 0.02 && doors.afterOutside < 0.02, `swing ${doors.afterOutside}`);
check('but swings open for somebody on their way out of it',
  doors.afterLeaver > 0.6, `swing ${doors.afterLeaver}`);
check('and shuts itself again behind them',
  doors.settled < 0.02 && !doors.stillInside, `swing ${doors.settled}`);

const walkedThrough = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  g.door.locked = true; g.door.holdOpen = 0; g.door.swing = 0; g.door.fromInside = false;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 6; c.z = 2.4; c.state = 'BROWSING';
  g.customers.push(c);
  g.ctx.leave(c);
  let maxSwing = 0, wasOpenAtDoor = false;
  for (let i = 0; i < 3000; i++) {
    window.__cust.updateCustomer(c, 1 / 30, g.ctx);
    g.updateDoor(1 / 30);
    maxSwing = Math.max(maxSwing, g.door.swing);
    // the moment they are in the doorway, is it open?
    if (Math.abs(c.z) < 0.25 && g.door.swing > 0.5) wasOpenAtDoor = true;
    if (c.state === 'GONE' || c.z < -1.5) break;
  }
  g.door.locked = false;
  g.customers.length = 0;
  return { maxSwing: +maxSwing.toFixed(2), wasOpenAtDoor, out: c.z < 0.2 };
});
check('so a customer leaving a shut store opens it rather than phasing through',
  walkedThrough.out && walkedThrough.wasOpenAtDoor && walkedThrough.maxSwing > 0.6,
  `door reached ${walkedThrough.maxSwing} and was open as they crossed: ${walkedThrough.wasOpenAtDoor}`);

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
  for (let i = 0; i < 30000; i++) {
    g.updateClosing(1 / 30, false, false);
    if (c.state === 'LEAVING' || c.state === 'GONE') { leftAt = i / 30; break; }
  }
  return { leftAt: Math.round(leftAt) };
});
/* Generously long, on purpose: it is a backstop against a shift that cannot
   end, not a bell. Somebody who was inside at midnight gets several
   transactions' worth of time before they give up on being served. */
check('but somebody parked at the counter all night is eventually shown the door',
  stubborn.leftAt > 300 && stubborn.leftAt < 480,
  `gave up after ${stubborn.leftAt}s of closing`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nclosing FAILED (${fails})` : '\nclosing clean');
process.exit(fails ? 1 : 0);
