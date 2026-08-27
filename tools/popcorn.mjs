/* The man who gets behind the counter and empties the tub into the kettle.
   Getting him out is the first half; the floor is the second. */
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
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await ev(() => { window.__game.estT = 99; });
await page.waitForTimeout(700);
await ev(() => {
  window.__pop = {
    reset() {
      const g = window.__game;
      g.customers.length = 0; g.queue.length = 0;
      g.spills.length = 0;
      g.popper = { running: false, spilled: 0 };
      g.vacuum = { out: false, held: false, x: 0, z: 0, yaw: 0, running: false };
      g.storage.locked = true; g.storage.open = false; g.storage.broken = false;
      g.officerDone = true; g.closing = false; g.elapsed = 10;
      if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; }
    },
    him() {
      const g = window.__game;
      const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('POPCORN'));
      g.customers.push(c);
      return c;
    },
  };
});

/* ---------- 1. he gets behind the counter and starts it ---------- */
const started = await ev(() => {
  const g = window.__game;
  window.__pop.reset();
  const c = window.__pop.him();
  let t = 0;
  for (let i = 0; i < 30000 && !g.popper.running; i++) {
    window.__cust.updateCustomer(c, 1 / 30, g.ctx);
    t += 1 / 30;
  }
  return {
    running: g.popper.running, seconds: Math.round(t),
    at: [+c.x.toFixed(2), +c.z.toFixed(2)], act: c.act, state: c.state,
    /* The clerk's side of the counter, which is exactly where a customer
       has no business being. */
    behindCounter: c.x > 9.0 && c.z > 1.95,
  };
});
check('he goes behind the counter, where nobody goes',
  started.behindCounter, `${started.act} at ${started.at}`);
check('and gets the machine going', started.running === true, `after ${started.seconds}s`);
check('but not the instant he arrives', started.seconds > 3, `${started.seconds}s`);

/* ---------- 2. and it goes everywhere ---------- */
const mess = await ev(() => {
  const g = window.__game;
  const at = [];
  for (const n of [10, 30, 60, 120]) {
    while (g.popper.t < n) g.updatePopper(1 / 30);
    at.push({ n, piles: g.spills.length });
  }
  const xs = g.spills.map((s) => s.x), zs = g.spills.map((s) => s.z);
  return {
    at, piles: g.spills.length,
    spread: [+Math.min(...xs).toFixed(1), +Math.max(...xs).toFixed(1),
      +Math.min(...zs).toFixed(1), +Math.max(...zs).toFixed(1)],
    sizes: new Set(g.spills.map((s) => Math.round(s.s * 20))).size,
    yaws: new Set(g.spills.map((s) => Math.round(s.yaw * 4))).size,
  };
});
check('leaving it running keeps making more of it',
  mess.at[0].piles < mess.at[3].piles && mess.at[3].piles > 8,
  mess.at.map((a) => `${a.n}s:${a.piles}`).join(' '));
check('and it spreads out across the floor rather than sitting in a heap',
  mess.spread[1] - mess.spread[0] > 1.5 && mess.spread[3] - mess.spread[2] > 1.5,
  `x ${mess.spread[0]}-${mess.spread[1]}, z ${mess.spread[2]}-${mess.spread[3]}`);
check('with no two piles the same', mess.sizes > 3 && mess.yaws > 3,
  `${mess.sizes} sizes, ${mess.yaws} angles`);

/* ---------- 3. he takes some shifting ---------- */
const eject = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const c = g.customers.find((x) => x.special === 'POPCORN');
  let goes = 0, landed = 0, said = 0;
  const lines = new Set();
  for (let i = 0; i < 200 && c.state !== 'LEAVING' && c.state !== 'GONE'; i++) {
    goes++;
    const before = c.resist === undefined ? 99 : c.resist;
    let node = D.talkTo(c, g.ctx, { atCounter: true });
    for (let k = 0; k < 6 && node; k++) {
      if (node.text) { lines.add(node.text); said++; }
      const ch = node.choices || [];
      if (!ch.length) break;
      const r = ch[0];
      node = r.fn ? r.fn() : null;
    }
    if (c.resist < before) landed++;
    // and time passes between goes, the way it does when you walk away
    for (let k = 0; k < 400; k++) window.__cust.updateCustomer(c, 1 / 30, g.ctx);
  }
  return { goes, landed, said, distinct: lines.size, state: c.state };
});
check('he can be got out of the shop', eject.state === 'LEAVING' || eject.state === 'GONE',
  `after ${eject.goes} goes`);
check('but not in one or two goes', eject.goes > 4, `${eject.goes} goes, ${eject.landed} of them landed`);
check('and he has plenty to say while it happens',
  eject.distinct >= 8, `${eject.distinct} distinct lines`);

/* ---------- 4. the machine does not stop itself ---------- */
const stop = await ev(() => {
  const g = window.__game;
  const before = g.popper.running;
  for (let i = 0; i < 3000; i++) g.updatePopper(1 / 30);
  const stillOn = g.popper.running;
  const grew = g.spills.length;
  g.stopPopper();
  const after = g.popper.running;
  for (let i = 0; i < 3000; i++) g.updatePopper(1 / 30);
  return { before, stillOn, after, grew, settled: g.spills.length, floor: g.floorClear() };
});
check('it keeps going after he has gone', stop.stillOn === true);
check('and only stops when you switch it off', stop.after === false);
check('after which nothing more lands on the floor',
  stop.settled === stop.grew, `${stop.grew} then ${stop.settled}`);
check('and the floor is still not clear', stop.floor === false);

/* ---------- 5. the vacuum is in the back room ---------- */
const vac = await ev(() => {
  const g = window.__game;
  const beforeDoor = g.vacuum.out;
  // it is not a thing in the world until somebody opens that door
  g.storage.locked = true; g.storage.open = false;
  g.toggleStorage();                       // unlock
  const afterUnlock = g.vacuum.out;
  const home = [+g.vacuum.x.toFixed(2), +g.vacuum.z.toFixed(2)];
  const inBackRoom = g.vacuum.z > 9.6;
  // and it is something you can look at and pick up
  const targets = g.hoverTargets ? g.hoverTargets() : null;
  g.takeVacuum();
  const held = g.vacuum.held;
  g.dropVacuum();
  const dropped = !g.vacuum.held;
  const where = [+g.vacuum.x.toFixed(2), +g.vacuum.z.toFixed(2)];
  g.takeVacuum();
  return { beforeDoor, afterUnlock, home, inBackRoom, held, dropped, where };
});
check('the vacuum is not in the world until you open the back room',
  vac.beforeDoor === false && vac.afterUnlock === true);
/* And you can actually look at it and pick it up, which for a while you
   could not: the target list returns early in the back room, and the one
   object in the building that deals with a floor full of popcorn was not
   on the short list it returns. */
const reach = await ev(async () => {
  const g = window.__game;
  g.vacuum.held = false;
  const seen = [];
  for (const [dx, dz, pitch] of [[0.9, -0.2, -0.6], [1.4, 0, -0.45], [0.6, 0, -0.8], [1.0, 0.6, -0.5]]) {
    g.player.x = g.vacuum.x + dx; g.player.z = g.vacuum.z + dz;
    g.player.yaw = Math.atan2(g.vacuum.x - g.player.x, g.vacuum.z - g.player.z);
    g.player.pitch = pitch;
    for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
    seen.push((g.hover && g.hover.kind) || 'nothing');
  }
  const prompt = g.ui.el.prompt.textContent;
  g.takeVacuum();                       // and pick it back up for what follows
  return { seen, prompt: prompt.slice(0, 40), hits: seen.filter((k) => k === 'vacuum').length };
});
check('and it can be looked at from where it stands, in the back room',
  reach.hits >= 3, reach.seen.join(', '));
check('and looking at it offers to take it',
  /Take the vacuum/.test(reach.prompt), reach.prompt);
check('and it is in the back room, not on the shop floor',
  vac.inBackRoom, `standing at ${vac.home}`);
check('you can pick it up and put it down again',
  vac.held && vac.dropped, `put down at ${vac.where}`);

/* ---------- 6. and it actually cleans up ---------- */
const clean = await ev(() => {
  const g = window.__game;
  const started = g.spills.length;
  // holding it and doing nothing does nothing
  g.player.x = g.spills[0].x; g.player.z = g.spills[0].z - 0.55; g.player.yaw = 0;
  for (let i = 0; i < 300; i++) g.updateVacuum(1 / 30);
  const idle = g.spills.length;

  // standing on the far side of the shop with it running does nothing either
  g.input.down.add('KeyE');
  g.player.x = 2.0; g.player.z = 6.0;
  for (let i = 0; i < 300; i++) g.updateVacuum(1 / 30);
  const away = g.spills.length;

  // and pushing it over each pile clears them, one at a time
  let guard = 0;
  const order = [];
  while (g.spills.length && guard++ < 400) {
    const s = g.spills[0];
    g.player.x = s.x; g.player.z = s.z - 0.55; g.player.yaw = 0;
    let f = 0;
    for (let i = 0; i < 200 && g.spills[0] === s; i++) { g.updateVacuum(1 / 30); f++; }
    order.push(f);
  }
  g.input.down.delete('KeyE');
  const noise = g.vacuum.running;
  // letting go stops it
  for (let i = 0; i < 10; i++) g.updateVacuum(1 / 30);
  return {
    started, idle, away, left: g.spills.length,
    perPile: Math.round(order.reduce((a, b) => a + b, 0) / Math.max(1, order.length)),
    wasRunning: noise, nowRunning: g.vacuum.running,
    floor: g.floorClear(),
  };
});
check('holding it without running it cleans nothing', clean.idle === clean.started);
/* And it runs off whatever interact is bound to, rather than two keys
   written down here -- rebinding interact used to leave the vacuum
   running on a button the player no longer uses. */
const bound = await ev(() => {
  const g = window.__game;
  const A = window.__input.PAD_ACTIONS;
  return { keys: A.confirm.keys, hasPadA: A.confirm.keys.includes('PadA') };
});
check('and it runs off the interact binding, not a hardcoded key',
  bound.hasPadA, bound.keys.join(' '));
check('and running it across the room from the mess cleans nothing', clean.away === clean.started);
check('pushing it over the popcorn is what clears it',
  clean.left === 0, `${clean.started} piles down to ${clean.left}`);
check('a pile takes a moment, not a frame',
  clean.perPile > 10, `about ${clean.perPile} frames each`);
check('and letting go switches it off',
  clean.wasRunning === true && clean.nowRunning === false);
check('the floor is clear', clean.floor === true);

/* ---------- 7. you do not lock up on a floor like that ---------- */
const closing = await ev(() => {
  const g = window.__game;
  const obj = () => (g.ui.el.objective ? g.ui.el.objective.textContent : '');
  const put = () => {
    g.player.held.length = 0; g.bin.length = 0;
    g.counterSlots = g.counterSlots.map(() => null);
    g.rewinder.tape = null;
  };
  const run = () => {
    g.state = 'PLAY';
    g.closing = false; g.closingT = 0;
    g.elapsed = g.night.length + 1;
    g.customers.length = 0;
    put();
    for (let i = 0; i < 400; i++) {
      g.updateClosing(0.05, false, false);
      if (g.state !== 'PLAY') break;
    }
    return { state: g.state, obj: obj() };
  };
  // a clean shop closes
  g.spills.length = 0; g.popper.running = false;
  const clean = run();

  // popcorn on the floor does not
  g.state = 'PLAY';
  g.spills.push({ x: 11, z: 3, yaw: 0, s: 1 }, { x: 11.5, z: 3.5, yaw: 1, s: 1 });
  const messy = run();

  // nor does the machine still running
  g.state = 'PLAY';
  g.spills.length = 0; g.popper.running = true;
  const noisy = run();
  g.popper.running = false;
  return { clean, messy, noisy };
});
check('a tidy shop closes', closing.clean.state === 'REPORT', closing.clean.state);
check('a floor covered in popcorn does not',
  closing.messy.state === 'PLAY' && /popcorn all over the floor/.test(closing.messy.obj),
  closing.messy.obj);
check('and neither does a machine you left running',
  closing.noisy.state === 'PLAY' && /popper is still on/.test(closing.noisy.obj),
  closing.noisy.obj);

/* ---------- 8. the shift does not pay for him ---------- */
const clock = await ev(async () => {
  const g = window.__game;
  window.__pop.reset();
  g.state = 'PLAY'; g.elapsed = 10;
  const runFor = async (frames) => {
    const a = g.elapsed;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    return +(g.elapsed - a).toFixed(2);
  };
  const before = await runFor(20);
  const c = window.__pop.him();
  c.x = 12.05; c.z = 6.10; c.state = 'ACTING'; c.parked = true; c.tipped = true;
  const held = await runFor(20);
  g.customers.length = 0;
  const after = await runFor(20);
  return { before, held, after };
});
check('the clock runs before he arrives', clock.before > 0.05, `${clock.before}s`);
check('and stops while he is in the building', clock.held === 0, `${clock.held}s`);
check('and runs again once he has gone', clock.after > 0.05, `${clock.after}s`);

await ev(() => window.__pop.reset());
console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\npopcorn FAILED (${fails})` : '\npopcorn clean');
process.exit(fails ? 1 : 0);
