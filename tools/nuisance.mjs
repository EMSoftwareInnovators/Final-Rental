/* Three of the regulars make the store unfit to do business in, and none
   of them stops doing it at the moment they agree to stop.

   The man with the stereo puts it on the carpet and leaves it running. Talk
   him into renting something instead of throwing him out and he goes
   shopping, queues, pays and walks out -- and it is still playing the whole
   time, because the only thing that ever switched it off was the eject
   path. The two who smell are the same shape of bug the other way round:
   the smell used to stop existing the instant they entered LEAVING, so the
   whole store walked up to the counter behind a man still crossing the
   carpet.

   What this holds down: nobody carries a tape to the counter until the
   music is off and the smell is gone, the killer included -- with the store
   hanging back at the shelves, the one man walking up was him. */
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

/* Shared setup: an empty store with the deputy and the killer out of it,
   and a helper that runs the floor without touching the render loop. */
await ev(() => {
  const g = window.__game;
  window.__nz = {
    clear() {
      g.customers.length = 0; g.queue.length = 0;
      g.boombox = null; g.stenchT = 0;
      g.sound.boomboxStop();
      g.officerDone = true;
      if (g.officer) { g.officer.state = 'DONE'; g.officer.hidden = true; }
      if (g.killer) { g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true; }
    },
    /** Run the floor for `sec` of store time. */
    run(sec) {
      const n = Math.round(sec * 30);
      for (let i = 0; i < n; i++) {
        g.updateStench(1 / 30);
        g.customers.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
        g.customers = g.customers.filter((c) => c.state !== 'GONE');
        g.updateDoor(1 / 30);
      }
    },
    /** An ordinary customer who has come in to rent something. */
    shopper(x, z) {
      const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
      c.script = 'rent'; c.hasMoney = true;
      c.x = x; c.z = z; c.state = 'BROWSING'; c.path = null;
      g.customers.push(c);
      return c;
    },
    /** Where everybody who is not a special has got to. */
    states() {
      const out = {};
      g.customers.filter((c) => !c.special).forEach((c) => { out[c.state] = (out[c.state] || 0) + 1; });
      return out;
    },
    atCounter() {
      return g.customers.filter((c) => !c.special
        && (c.state === 'TO_COUNTER' || c.state === 'WAITING')).length;
    },
    /* The most who were ever at the counter at once over `sec`. A single
       reading is no good on the far side of these tests: somebody who
       walks up and is then never served runs out of patience and walks
       back out, so a long enough window comes back empty either way. */
    peakAtCounter(sec) {
      let peak = 0;
      for (let t = 0; t < sec; t += 5) { this.run(5); peak = Math.max(peak, this.atCounter()); }
      return peak;
    },
  };
});

/* ================================================================
   1. THE MAN WITH THE STEREO
   ================================================================ */

/* He walks to his spot, crouches, puts it down and turns it up. */
const setUp = await ev(async () => {
  const g = window.__game;
  window.__nz.clear();
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('BOOMBOX'));
  c.x = 6.0; c.z = 1.0; c.state = 'ACTING';
  g.customers.push(c);
  window.__nz.run(30);
  return { rigUp: !!c.rigUp, playing: !!g.boombox, owner: g.boombox && g.boombox.owner === c.id };
});
check('he sets the boombox down and turns it on', setUp.rigUp && setUp.playing && setUp.owner,
  `rigUp ${setUp.rigUp}, playing ${setUp.playing}`);

/* And while it plays, nobody else brings a tape to the counter. */
const held = await ev(() => {
  const g = window.__game;
  for (let i = 0; i < 4; i++) window.__nz.shopper(3.0 + i * 1.6, 4.0 + (i % 2) * 1.8);
  window.__nz.run(150);
  return { at: window.__nz.atCounter(), states: window.__nz.states(), playing: !!g.boombox };
});
check('and while it is playing nobody carries a tape to the counter',
  held.playing && held.at === 0,
  `${held.at} at the counter, states ${JSON.stringify(held.states)}`);

/* Talking him into renting one instead does NOT switch it off. That part is
   correct behavior -- he leaves it running while he shops -- so the store
   has to go on holding off through his whole trip. */
const shopping = await ev(() => {
  const g = window.__game;
  const boom = g.customers.find((c) => c.special === 'BOOMBOX');
  g.ctx.sendToShop(boom, {});
  window.__nz.run(120);
  return {
    playing: !!g.boombox,
    ownerStill: !!(g.boombox && g.boombox.owner === boom.id),
    boomState: boom.state,
    at: window.__nz.atCounter(),
  };
});
check('sending him off to find a tape leaves it playing where it is',
  shopping.playing && shopping.ownerStill, `playing ${shopping.playing}`);
check('so the rest of the store is still held off while he shops',
  shopping.at === 0, `${shopping.at} at the counter, he is ${shopping.boomState}`);

/* He checks out, and only on the way out does he go back for it. */
const packedUp = await ev(() => {
  const g = window.__game;
  const boom = g.customers.find((c) => c.special === 'BOOMBOX');
  // ring him up and let him go
  boom.served = true; boom.checkedOut = true;
  boom.state = 'WAITING'; boom.path = null; boom.doneTimer = 0;
  window.__nz.run(60);
  return {
    playing: !!g.boombox,
    state: boom.state,
    carrying: boom.carrying || null,
  };
});
check('he goes back for it on his way out and switches it off',
  !packedUp.playing, `still playing: ${packedUp.playing}, he is ${packedUp.state}`);

/* With the music off, the people who have been waiting it out go and pay. */
const released = await ev(() => ({
  peak: window.__nz.peakAtCounter(120),
  states: window.__nz.states(),
}));
check('and only then does the store go to the counter',
  released.peak > 0, `peak ${released.peak}, ended ${JSON.stringify(released.states)}`);

/* Every way out of the building collects it, not just the two that used to.
   Checkout is the one that did not, and is covered above; this is the
   backstop for the rest. */
const everyExit = await ev(() => {
  const g = window.__game;
  const out = {};
  for (const how of ['storm', 'leave', 'lockedOut', 'plain']) {
    window.__nz.clear();
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('BOOMBOX'));
    c.x = 6.0; c.z = 1.0; c.state = 'ACTING';
    g.customers.push(c);
    window.__nz.run(30);
    if (!g.boombox) { out[how] = 'never started'; continue; }
    if (how === 'storm') g.ctx.storm(c);
    else if (how === 'leave') g.ctx.leave(c);
    else { c.leaving = true; c.state = 'LEAVING'; c.path = null; }   // closing, patience, lock-out
    window.__nz.run(90);
    out[how] = g.boombox ? 'STILL PLAYING' : 'off';
  }
  return out;
});
check('every way out of the building collects it',
  Object.values(everyExit).every((v) => v === 'off'), JSON.stringify(everyExit));

/* ================================================================
   2. THE TWO WHO SMELL
   ================================================================ */

for (const id of ['REEKER', 'SMOKER']) {
  const smell = await ev(async (who) => {
    const g = window.__game;
    window.__nz.clear();
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById(who));
    c.x = 5.0; c.z = 4.0; c.state = 'ACTING';
    g.customers.push(c);
    for (let i = 0; i < 4; i++) window.__nz.shopper(3.0 + i * 1.6, 5.0 + (i % 2) * 1.6);
    window.__nz.run(150);
    const standing = { active: g.ctx.stenchActive(), at: window.__nz.atCounter() };

    // he agrees to go. He is still in the middle of the floor.
    g.ctx.leave(c);
    window.__nz.run(0.5);
    const agreed = { active: g.ctx.stenchActive(), z: +c.z.toFixed(2), state: c.state };

    /* Walk him out a second at a time so the readings land where he is
       rather than where a fixed number of seconds guessed he would be --
       these two move at noticeably different speeds. */
    let crossed = 0;
    const walking = { active: true, at: 0, z: 0 };
    for (let t = 0; t < 40 && !crossed; t += 0.5) {
      window.__nz.run(0.5);
      if (c.z > 0.6) { walking.active = walking.active && g.ctx.stenchActive(); walking.at = window.__nz.atCounter(); walking.z = +c.z.toFixed(2); }
      if (c.z < 0.15) crossed = t;
    }
    // he is out of the building. The room has not aired out yet.
    const outside = { active: g.ctx.stenchActive(), z: +c.z.toFixed(2), left: +g.stenchT.toFixed(1) };
    // how long it takes to
    let lingered = 0;
    for (let t = 0; t < 40 && g.ctx.stenchActive(); t += 0.5) { window.__nz.run(0.5); lingered = t + 0.5; }
    const cleared = { active: g.ctx.stenchActive(), lingered };
    return { standing, agreed, walking, outside, cleared, peak: window.__nz.peakAtCounter(120) };
  }, id);

  check(`${id}: while he is standing there nobody comes to the counter`,
    smell.standing.active && smell.standing.at === 0,
    `active ${smell.standing.active}, ${smell.standing.at} at the counter`);
  check(`${id}: agreeing to go does not clear the room`,
    smell.agreed.active, `active ${smell.agreed.active} at z ${smell.agreed.z} (${smell.agreed.state})`);
  check(`${id}: nor does walking to the door`,
    smell.walking.active && smell.walking.at === 0,
    `active ${smell.walking.active} at z ${smell.walking.z}, ${smell.walking.at} at the counter`);
  check(`${id}: it hangs there a while after he is out`,
    smell.outside.z < 0.15 && smell.outside.active && smell.outside.left > 8,
    `he is at z ${smell.outside.z}, ${smell.outside.left}s of it left`);
  check(`${id}: and then the air clears, in seconds rather than minutes`,
    !smell.cleared.active && smell.cleared.lingered > 6 && smell.cleared.lingered < 20,
    `cleared after ${smell.cleared.lingered}s on the sidewalk`);
  check(`${id}: and the store pays up`,
    smell.peak > 0, `peak ${smell.peak} at the counter`);
}

/* ================================================================
   3. AND THE KILLER GETS NO FREE PASS
   ================================================================ */

const noTell = await ev(() => {
  const g = window.__game;
  window.__nz.clear();
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('REEKER'));
  c.x = 5.0; c.z = 4.0; c.state = 'ACTING';
  g.customers.push(c);
  // the killer, in as a customer, doing exactly what everybody else is doing
  const k = g.killer;
  k.plan.appears = true; k.phase = 'CUSTOMER';
  k.ent.hidden = false; k.ent.script = 'rent'; k.ent.hasMoney = true;
  k.ent.x = 4.0; k.ent.z = 6.0; k.ent.state = 'BROWSING'; k.ent.path = null;
  g.customers.push(k.ent);
  for (let i = 0; i < 3; i++) window.__nz.shopper(3.0 + i * 1.6, 5.4);
  window.__nz.run(200);
  const out = {
    stench: g.ctx.stenchActive(),
    killerAt: k.ent.state === 'TO_COUNTER' || k.ent.state === 'WAITING',
    killerState: k.ent.state,
    othersAt: g.customers.filter((x) => !x.special && !x.isKiller
      && (x.state === 'TO_COUNTER' || x.state === 'WAITING')).length,
  };
  g.customers = g.customers.filter((x) => x !== k.ent);
  k.ent.hidden = true; k.phase = 'ABSENT';
  return out;
});
check('the killer hangs back with everybody else rather than walking up alone',
  noTell.stench && !noTell.killerAt && noTell.othersAt === 0,
  `killer ${noTell.killerState}, ${noTell.othersAt} others at the counter`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
if (errors.length) fails++;
console.log(fails ? `\nnuisance FAILED (${fails})` : '\nnuisance clean');
await browser.close();
process.exit(fails ? 1 : 0);
