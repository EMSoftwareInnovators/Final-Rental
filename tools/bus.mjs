/* The coach. Two dozen people who all look the same come through the door
   at once, they all want a movie, and some of them want to tell you about
   the journey first. He does not work a night the bus comes. */
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

/* ---------- 1. how often it happens ---------- */
const rota = await ev(() => {
  const M = window.__night;
  let with_ = 0, early = 0, tries = 600;
  const nights = {};
  for (let i = 0; i < tries; i++) {
    const n = 1 + (i % 12);
    const p = M.makeNight(9000 + i, n, 'HORROR');
    const has = p.busAt !== Infinity;
    if (has) {
      with_++;
      nights[n] = (nights[n] || 0) + 1;
      if (n < 3) early++;
      if (p.busAt < 0 || p.busAt > p.length) return { bad: `busAt ${p.busAt} of ${p.length}` };
    }
  }
  return { rate: with_ / tries, early, nights };
});
check('the coach is a rare night, not most nights',
  !rota.bad && rota.rate > 0.03 && rota.rate < 0.20, rota.bad || `${(rota.rate * 100).toFixed(1)}% of nights`);
check('and never on the first couple, before you can run a shift',
  rota.early === 0, `${rota.early} early ones`);
check('and it lands inside the shift, not after closing', !rota.bad);

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await ev(() => { window.__game.estT = 99; });
await page.waitForTimeout(800);
await ev(() => {
  window.__bus = {
    reset(killerIn) {
      const g = window.__game;
      g.customers.length = 0; g.queue.length = 0;
      g.bus = null; g.officerDone = true; g.closing = false;
      g.night.busAt = 0; g.sim = 1;
      const k = g.killer;
      if (k) {
        k.plan.appears = true;
        k.phase = killerIn ? 'CUSTOMER' : 'ABSENT';
        k.ent.hidden = !killerIn;
        k.ent.x = 6; k.ent.z = 3;
      }
    },
    land() {
      const g = window.__game;
      for (let i = 0; i < 1200 && (!g.bus || g.bus.made < g.bus.total); i++) g.updateBus(1 / 30);
    },
  };
});

/* ---------- 2. he does not work a night the bus comes ---------- */
const clash = await ev(() => {
  const g = window.__game;
  window.__bus.reset(true);                       // he is in the store
  const before = Math.round(g.night.busAt);
  g.updateBus(0.1);
  const held = { came: !!g.bus, pushed: Math.round(g.night.busAt) > before };

  // and once he goes, it comes
  g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true;
  g.sim = g.night.busAt + 1;
  g.updateBus(0.1);
  return { held, came: !!g.bus, appears: g.killer.plan.appears, phase: g.killer.phase };
});
check('the coach does not pull in while he is in the building',
  clash.held.came === false && clash.held.pushed === true);
check('it comes once he has gone', clash.came === true);
check('and then he is not coming back tonight',
  clash.appears === false && clash.phase === 'ABSENT', `${clash.phase}, appears ${clash.appears}`);

/* ---------- 3. two dozen of one person ---------- */
const crowd = await ev(() => {
  const g = window.__game;
  window.__bus.reset(false);
  g.updateBus(0.1);
  window.__bus.land();
  const riders = g.customers.filter((c) => c.fromBus);
  const key = (c) => [c.app.jacket.id, c.app.hair.id, c.app.height.id, c.app.build.id,
    c.app.facial.id, c.app.hat.id, c.app.glasses.id, c.app.gender.id].join('/');
  return {
    n: riders.length,
    faces: new Set(riders.map(key)).size,
    names: new Set(riders.map((c) => c.name)).size,
    surnames: new Set(riders.map((c) => c.name.split(' ')[1])).size,
    wantRent: riders.filter((c) => c.intent === 'RENT' || c.script === 'rent').length,
    ramblers: riders.filter((c) => c.rambles >= 0).length,
    personalities: new Set(riders.map((c) => c.personality.id)).size,
    outside: riders.filter((c) => c.z < 0).length,
    sample: riders.slice(0, 3).map((c) => c.name),
  };
});
check('three to four dozen of them get off it',
  crowd.n >= 36 && crowd.n <= 48, `${crowd.n} riders`);
check('and every one of them looks exactly the same', crowd.faces === 1,
  `${crowd.faces} distinct faces`);
check('with their own names, off one family', crowd.names > 10 && crowd.surnames === 1,
  `${crowd.names} names, all ${crowd.sample[0].split(' ')[1]}`);
check('they all start outside, not inside', crowd.outside === crowd.n);
check('they all want to rent something', crowd.wantRent === crowd.n);
check('and they are not the same person underneath it',
  crowd.personalities > 3, `${crowd.personalities} temperaments`);
/* Across several coaches, not one. How many talkers are on any single bus
   is a dice roll, and asserting on one roll is asserting on the dice. */
const talkers = await ev(() => {
  const g = window.__game;
  let riders = 0, ramblers = 0, buses = 0;
  const per = [];
  for (let k = 0; k < 12; k++) {
    window.__bus.reset(false);
    g.updateBus(0.1);
    window.__bus.land();
    const r = g.customers.filter((c) => c.fromBus);
    const n = r.filter((c) => c.rambles >= 0).length;
    riders += r.length; ramblers += n; buses++;
    per.push(n);
  }
  g.customers.length = 0; g.queue.length = 0; g.bus = null;
  return { riders, ramblers, buses, per, share: ramblers / riders };
});
check('about a quarter of any coach wants to talk about the journey',
  talkers.share > 0.12 && talkers.share < 0.45,
  `${talkers.ramblers} of ${talkers.riders} over ${talkers.buses} coaches (${talkers.per.join(',')})`);
check('and no coach is all talkers or none of them',
  talkers.per.filter((n) => n === 0).length <= 2,
  `${talkers.per.filter((n) => n === 0).length} coaches with nobody`);

/* ---------- 4. the whole store tries to get served ---------- */
const served = await ev(() => {
  const g = window.__game;
  window.__bus.reset(false);
  g.updateBus(0.1);
  window.__bus.land();
  const riders = g.customers.filter((c) => c.fromBus);
  riders.forEach((c) => { c.hasMoney = true; });
  let inside = 0, queued = 0;
  for (let i = 0; i < 30000; i++) {
    riders.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateDoor(1 / 30);
    inside = riders.filter((c) => c.z > 0.4).length;
    queued = g.queue.length;
    if (queued >= 3 && inside > 10) break;
  }
  const states = {};
  riders.forEach((c) => { states[c.state] = (states[c.state] || 0) + 1; });
  return { inside, queued, states, tape: riders.filter((c) => c.tape).length };
});
check('they come in and fill the store', served.inside > 10, `${served.inside} inside`);
check('and a line forms', served.queued >= 3, `${served.queued} in the line`);
check('with people still shopping behind it',
  (served.states.BROWSING || 0) + (served.states.PICKING || 0) > 0,
  Object.entries(served.states).map(([k, v]) => `${k}:${v}`).join(' '));

/* ---------- 5. the talkers hold the counter ---------- */
const talk = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const T = window.__tapes;
  const out = { runs: [], stories: new Set() };
  for (let k = 0; k < 20; k++) {
    g.customers.length = 0; g.queue.length = 0;
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.fromBus = true; c.rambles = 0; c.script = 'rent'; c.hasMoney = true;
    c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
    c.x = 10.75; c.z = 0.8; c.state = 'WAITING'; c.queueIndex = 0;
    g.customers.push(c);

    // hear them out, nodding along
    let node = D.talkTo(c, g.ctx, { atCounter: true });
    const said = [];
    let turns = 0;
    for (; turns < 30 && node && c.rambles >= 0; turns++) {
      said.push(node.text || '');
      const ch = node.choices || [];
      if (!ch.length) break;
      node = ch[0].fn ? ch[0].fn() : null;
    }
    out.stories.add(said[0] || '');
    out.runs.push({ turns, done: c.rambles < 0, said: said.join(' ¶ ') });
  }

  // and the same person, cut off
  g.customers.length = 0; g.queue.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.fromBus = true; c.rambles = 0; c.script = 'rent'; c.hasMoney = true;
  c.tape = T.makeTape('HORROR', g.rng, { rewound: true });
  c.x = 10.75; c.z = 0.8; c.state = 'WAITING'; c.queueIndex = 0;
  g.customers.push(c);
  let node = D.talkTo(c, g.ctx, { atCounter: true });
  const cut = (node.choices || []).find((r) => /look at the line/i.test(r.label));
  const after = cut ? cut.fn() : null;
  const cutOff = { had: !!cut, done: c.rambles < 0, mood: Math.round(c.mood) };
  g.customers.length = 0; g.queue.length = 0;
  return {
    n: out.runs.length,
    stories: out.stories.size,
    everyDone: out.runs.every((r) => r.done),
    shortest: Math.min(...out.runs.map((r) => r.turns)),
    holes: out.runs.filter((r) => /undefined|\[object/.test(r.said)).length,
    cutOff,
    sample: out.runs[0].said.slice(0, 170),
  };
});
check('a talker will not be rung up until they have said their piece',
  talk.shortest >= 3, `shortest was ${talk.shortest} beats`);
check('and there is more than one story', talk.stories > 2, `${talk.stories} of them`);
check('every one of them finishes', talk.everyDone && talk.holes === 0);
check('you can cut them off, and it costs you their good opinion',
  talk.cutOff.had && talk.cutOff.done && talk.cutOff.mood < 100,
  `mood ${talk.cutOff.mood}`);
console.log('      "' + talk.sample.replace(/\n/g, ' ') + '"');

/* ---------- 6. and the phone can still tell them apart ---------- */
/* He is not here, so it does not matter for catching anybody -- but a
   list with the same line on it twenty times over is still broken. */
const named = await ev(() => {
  const g = window.__game;
  window.__bus.reset(false);
  g.updateBus(0.1);
  window.__bus.land();
  g.customers.forEach((c, i) => { c.x = 4 + (i % 6); c.z = 1 + i * 0.2; });
  const labels = g.phoneTargets().map((s) => s.phoneLabel);
  g.customers.length = 0; g.queue.length = 0; g.bus = null;
  return { n: labels.length, unique: new Set(labels).size, sample: labels.slice(0, 3) };
});
check('and no two of them read the same on the phone',
  named.n > 0 && named.unique === named.n, `${named.unique} of ${named.n}`);

/* ---------- 7. every one of them gets through the door ---------- */
/* The coach is only an event if the coach gets in. Four dozen people meet
   two things a handful never did: a doorway that has to pass all of them,
   and a line longer than the counter is. */
const allIn = await ev(() => {
  const g = window.__game;
  window.__bus.reset(false);
  g.updateBus(0.1);
  window.__bus.land();
  const riders = g.customers.filter((c) => c.fromBus);
  const spawnBad = riders.filter((c) => !g.onOpenFloor(c.x, c.z)).length;
  /* Two and a half minutes: long enough for the whole coach to get in and
     form a line, well short of the shortest fuse any of them carries. The
     old version ran for thirty-three minutes of store time and then asked
     whether they were all still standing there, which was a fine question
     when the answer was allowed to be yes. */
  for (let i = 0; i < 30 * 150; i++) {
    riders.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateDoor(1 / 30);
    g.updateLine(1 / 30);
  }
  const st = {};
  riders.forEach((c) => { st[c.state] = (st[c.state] || 0) + 1; });
  return {
    n: riders.length, spawnBad,
    inside: riders.filter((c) => c.z > 0.35).length,
    /* "Inside a shelf run" has to mean what the game means by it: the
       collision solver, at the person's own radius, would push them out.
       This used to ask onOpenFloor, which clears a wider circle than a
       customer is -- it is the standard for dropping popcorn on the floor,
       not for standing -- so a rider legitimately pressed up against the
       end of a shelf failed it about one run in four. */
    inSolid: riders.filter((c) => {
      const [px, pz] = window.__world.collide(c.x, c.z, c.r, g.solids, true, true);
      return Math.hypot(px - c.x, pz - c.z) > 1e-6;
    }).length,
    st, inLine: g.queue.length,
    soured: riders.filter((c) => c.wentAngry || c.mood < 100).length,
    gone: riders.filter((c) => c.state === 'GONE').length,
  };
});
check('they get off the coach onto sidewalk they can stand on',
  allIn.spawnBad === 0, `${allIn.spawnBad} in the road`);
check('and every last one of them gets through the door',
  allIn.inside === allIn.n, `${allIn.inside} of ${allIn.n} inside`);
check('with nobody left standing inside a shelf run',
  allIn.inSolid === 0, `${allIn.inSolid} in the furniture`);
check('the line takes all of them', allIn.inLine >= allIn.n * 0.5,
  `${allIn.inLine} in the line, states ${Object.entries(allIn.st).map(([k, v]) => `${k}:${v}`).join(' ')}`);
check('and not one of them gets impatient',
  allIn.soured === 0 && allIn.gone === 0,
  `${allIn.soured} soured, ${allIn.gone} walked out`);

/* ---------- 7b. and not one of them waits forever either ---------- */
/* "Patient" was written as no clock at all, which put forty-odd people in
   the building who would stand in that line until midnight moved them. One
   head of the line that could not be served and everybody behind it was
   there for the rest of the night, saying they were in no hurry, because
   they genuinely were. They have a fuse now: minutes long, a different
   length each, and it ends in going back to the coach rather than in a
   tantrum. */
const giveUp = await ev(() => {
  const g = window.__game;
  window.__bus.reset(false);
  g.updateBus(0.1);
  window.__bus.land();
  const riders = g.customers.filter((c) => c.fromBus);
  const n = riders.length;
  /* Serve nobody at all, for as long as a whole shift. */
  const leftBy = [];
  let angry = 0;
  for (let i = 0; i < 30 * 900; i++) {
    riders.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateDoor(1 / 30);
    g.updateLine(1 / 30);
    if (i % 30 === 0) leftBy.push([i / 30, riders.filter((c) => c.state === 'GONE').length]);
    angry += riders.filter((c) => c.wentAngry).length ? 1 : 0;
  }
  /* When did the first go, when did the last, and did they go in a block? */
  const first = (leftBy.find(([, k]) => k > 0) || [Infinity])[0];
  const last = (leftBy.find(([, k]) => k >= n) || [Infinity])[0];
  let biggestStep = 0;
  for (let i = 1; i < leftBy.length; i++) biggestStep = Math.max(biggestStep, leftBy[i][1] - leftBy[i - 1][1]);
  const st = {};
  riders.forEach((c) => { st[c.state] = (st[c.state] || 0) + 1; });
  g.customers.length = 0; g.queue.length = 0; g.bus = null;
  return { n, gone: riders.filter((c) => c.state === 'GONE').length, first, last, biggestStep, angry, st };
});
check('a coach nobody ever serves does not stand there all night',
  giveUp.gone === giveUp.n,
  `${giveUp.gone} of ${giveUp.n} gave up and went, states ${JSON.stringify(giveUp.st)}`);
check('they hold out for minutes first, not seconds',
  giveUp.first > 120, `the first went at ${giveUp.first}s`);
check('and they go in ones and twos rather than emptying the store at once',
  giveUp.biggestStep <= Math.max(3, giveUp.n * 0.15),
  `${giveUp.biggestStep} of them in one second, over ${(giveUp.last - giveUp.first).toFixed(0)}s`);
check('and none of it is a tantrum', giveUp.angry === 0, `${giveUp.angry} lost their temper`);

/* ---------- 7c. and one bad head does not stop the whole line ---------- */
/* Everything behind the head of a line reads as "waiting in line" and
   cannot be rung up, so a head that never becomes servable is not one
   stuck customer, it is a stopped store. */
const badHead = await ev(() => {
  const g = window.__game;
  g.customers.length = 0; g.queue.length = 0;
  const made = [];
  for (let i = 0; i < 5; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.script = 'rent'; c.hasMoney = true;
    c.tape = window.__tapes.makeTape('HORROR', g.rng, { rewound: true });
    c.x = 9.0 - i * 0.9; c.z = 0.8; c.state = 'WAITING'; c.path = null;
    g.customers.push(c); made.push(c);
    g.claimCounterSpot(c);
  }
  const head = made[0];
  /* Wedge him: at the head of the line, and nowhere near the window. There
     is no supported way to get here, which is the point -- if one ever
     turns up, the line has to survive it. */
  const before = { head: head.name, why: g.cannotServe(head), second: g.cannotServe(made[1]) };
  const park = () => { head.x = 3.0; head.z = 5.0; head.targetSpot = { x: 3.0, z: 5.0 }; };
  park();
  let freed = -1;
  for (let i = 0; i < 30 * 90; i++) {
    park();                                   // he cannot get back, ever
    made.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
    g.updateLine(1 / 30);
    if (freed < 0 && g.queue[0] && g.queue[0] !== head && !g.cannotServe(g.queue[0])) freed = i / 30;
  }
  const out = { before, freed, headIndex: g.queue.indexOf(head), newHead: g.queue[0] ? g.queue[0].name : null };
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('a head of the line that cannot be served blocks everybody behind it',
  badHead.before.why !== '' && badHead.before.second === 'waiting in line',
  `head: "${badHead.before.why}", next: "${badHead.before.second}"`);
check('so the line gives up on them and moves on',
  badHead.freed > 0 && badHead.freed < 40,
  badHead.freed < 0 ? 'it never did' : `${badHead.freed}s later, ${badHead.newHead} is servable`);

/* And the line itself is somewhere a person can stand. */
const line = await ev(() => {
  const g = window.__game;
  const all = g.queueSpots();
  const pts = [];
  for (let i = 0; i < 50; i++) pts.push(g.queueSpot(i));
  let close = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 0.55) close++;
    }
  }
  return {
    capacity: all.length,
    inSolid: pts.filter((q) => !g.onOpenFloor(q.x, q.z)).length,
    outside: pts.filter((q) => q.x < 0.6 || q.x > 12.9 || q.z < 0.3 || q.z > 9.3).length,
    close,
  };
});
check('the line has room for a coach', line.capacity >= 48, `${line.capacity} places`);
check('and every place in it is inside the store, on the floor',
  line.inSolid === 0 && line.outside === 0,
  `${line.inSolid} in furniture, ${line.outside} outside the building`);
check('and no two people are sent to the same tile', line.close === 0);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nbus FAILED (${fails})` : '\nbus clean');
process.exit(fails ? 1 : 0);
