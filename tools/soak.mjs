// Drives a whole shift headlessly, several times, watching for exceptions and
// for the simulation getting stuck. Also forces each ending on purpose.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2000);

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* ---------- 0. the shape of the run ---------- */
const shape = await ev(() => {
  const g = window.__game;
  const M = window.__night;
  const out = { horror: [], casual: [] };
  for (let n = 1; n <= 7; n++) {
    out.horror.push({ n, deputy: M.deputyComes(n, 'HORROR'), chance: +M.killerChance(n, false).toFixed(2) });
  }
  for (let n = 1; n <= 3; n++) {
    out.casual.push({ n, deputy: M.deputyComes(n, 'CASUAL'), chance: +M.killerChance(n, true).toFixed(2) });
  }
  out.first = M.KILLER_FIRST_NIGHT;
  void g;
  return out;
});
check('the killer cannot appear on the first nights',
  shape.horror.slice(0, shape.first - 1).every((r) => r.chance === 0),
  `zero through night ${shape.first - 1}`);
check('the deputy stays away while the odds are zero',
  shape.horror.every((r) => (r.chance === 0 && r.n < shape.first - 1) === (!r.deputy && r.n < shape.first - 1))
  && !shape.horror[0].deputy && !shape.horror[1].deputy,
  `first deputy on night ${(shape.horror.find((r) => r.deputy) || {}).n}`);
check('casual mode has neither', shape.casual.every((r) => !r.deputy && r.chance === 0));

const KILLER_NIGHT = shape.first + 2;   // by here the odds are comfortably non-zero

/* ---------- 1. boot to a shift ---------- */
await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(600);
await ev(() => { window.__game.estT = 99; });
await wait(700);
check('shift started', await ev(() => window.__game.state) === 'PLAY');
check('night one has nobody in it but customers',
  await ev(() => !window.__game.officer && !window.__game.night.plan.appears));
check('and its clock is running from the off',
  await ev(() => window.__game.officerDone === true));

/* ---------- 2. the deputy briefs you, but only at the counter ---------- */
const DEPUTY_NIGHT = shape.first - 1;
await ev((n) => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false);
  g.startNight(n);
}, DEPUTY_NIGHT);
await wait(400);
await ev(() => { const g = window.__game; g.estT = 99; g.timeScale = 6; });
await wait(500);

// stand well away from the counter and let him come all the way in
await ev(() => {
  const g = window.__game;
  g.player.x = 3.0; g.player.z = 5.0;
  g.night.deputyAt = 1;
});
let waited = null;
for (let i = 0; i < 90; i++) {
  waited = await ev(() => {
    const g = window.__game;
    return { st: g.officer && g.officer.state, dlg: !!g.dlg.node, done: g.officerDone,
      elapsed: +g.elapsed.toFixed(1), sim: +g.sim.toFixed(1) };
  });
  if (waited.st === 'WAIT' && waited.sim > 12) break;
  await wait(150);
}
check('the deputy walks in and waits without saying a word',
  waited.st === 'WAIT' && !waited.dlg, `state ${waited.st}`);
check('and the clock over the door has not moved',
  waited.elapsed < 0.5, `shift clock ${waited.elapsed}s of ${waited.sim}s on the floor`);

// walk to the counter; now he talks
await ev(() => { const g = window.__game; g.player.x = 10.8; g.player.z = 2.6; });
let opened = false;
for (let i = 0; i < 40; i++) {
  if (await ev(() => !!window.__game.dlg.node)) { opened = true; break; }
  await wait(150);
}
check('coming to the counter is what starts him talking', opened);

// pausing used to leave him frozen forever
await ev(() => { window.__game.pause(); });
await wait(300);
const pausedOk = await ev(() => ({ st: window.__game.state, held: window.__game._heldTalk, node: !!window.__game.dlg.node }));
await ev(() => { window.__game.resume(); });
await wait(300);
const afterPause = await ev(() => ({ st: window.__game.state, node: !!window.__game.dlg.node }));
check('pausing mid-briefing keeps the conversation',
  pausedOk.st === 'PAUSE' && pausedOk.held === 'dlg' && pausedOk.node
  && afterPause.st === 'PLAY' && afterPause.node);

let briefed = false;
for (let i = 0; i < 90; i++) {
  const st = await ev(() => ({ dlg: !!window.__game.dlg.node, done: window.__game.officerDone }));
  if (st.done) { briefed = true; break; }
  if (st.dlg) await page.keyboard.press('Enter');
  await wait(160);
}
if (!briefed) {
  const dbg = await ev(() => {
    const g = window.__game;
    const o = g.officer;
    return { state: o && o.state, x: o && +o.x.toFixed(2), z: o && +o.z.toFixed(2), pathI: o && o.pathI,
      pathLen: o && o.path && o.path.length, briefingStarted: g.briefingStarted,
      dlgNode: g.dlg.node ? g.dlg.node.text.slice(0, 60) : null,
      choices: g.dlg.node && (g.dlg.node.choices || []).map((c) => c.label.slice(0, 30)),
      typing: g.ui.typing };
  });
  console.log('      officer debug:', JSON.stringify(dbg));
}
check('deputy delivered the bulletin and left', briefed);
const ranOn = await ev(async () => {
  const g = window.__game;
  const a = g.elapsed;
  await new Promise((r) => setTimeout(r, 400));
  return { a: +a.toFixed(2), b: +g.elapsed.toFixed(2) };
});
check('and the clock starts once he has', ranOn.b > ranOn.a, `${ranOn.a}s -> ${ranOn.b}s`);
const bull = await ev(() => {
  const b = window.__game.night.bulletin;
  return { keys: [...b.known], text: b.description.slice(0, 90), suspect: b.app.jacket.label };
});
check('and reading it out is what puts it in your notes', bull.keys.length > 0);
console.log('      bulletin keys:', bull.keys.join(', '));
console.log('      "' + bull.text.replace(/\n/g, ' ') + '..."');

/* ---------- 3. serve a customer end to end ---------- */
await ev(() => { window.__game.timeScale = 6; });
let served = null;
for (let i = 0; i < 120; i++) {
  const r = await ev(() => {
    const g = window.__game;
    const c = g.customers.find((x) => x.state === 'WAITING');
    if (!c) return null;
    g.talkToPerson(c);
    return { name: c.name, script: c.script, tag: c.personality.tag, late: c.tape ? c.tape.daysLate : 0 };
  });
  if (r) { served = r; break; }
  await wait(200);
}
check('a customer reached the counter', !!served, served ? `${served.name} (${served.tag}) - ${served.script}` : '');

const lines = [];
for (let i = 0; i < 40; i++) {
  const n = await ev(() => {
    const g = window.__game;
    if (!g.dlg.node) return null;
    return { text: g.dlg.node.text, choices: (g.dlg.node.choices || []).map((c) => c.label) };
  });
  if (!n) break;
  lines.push(n);
  await page.keyboard.press('Enter');   // finish typing
  await wait(120);
  await page.keyboard.press('Enter');   // take reply 1
  await wait(200);
}
check('conversation ran to a natural end', lines.length > 1, `${lines.length} nodes`);
if (lines[0]) {
  console.log('      them: "' + lines[0].text.replace(/\n/g, ' ').slice(0, 90) + '"');
  console.log('      you:  ' + (lines[0].choices || []).map((c) => `[${c}]`).join(' ').slice(0, 150));
}

/* ---------- 4. tape handling: take, rewind, shelve ---------- */
const tapes = await ev(() => {
  const g = window.__game;
  const { makeTape } = g.__tapes || {};
  // put an unrewound HORROR tape in hand directly
  const t = { id: 999, title: 'THE CRAWL', genre: 'HORROR', rewound: false, price: 3.5, daysLate: 2, heldBy: null };
  g.player.held = [t];
  g.loadRewinder();
  return { loaded: !!g.rewinder.tape, running: g.rewinder.running };
});
check('unrewound tape loads into the rewinder', tapes.loaded && tapes.running);
console.log(`      rewind takes ${await ev(() => Math.round(window.__game.rewinder.dur))}s of shift time`);
await ev(() => { window.__game.timeScale = 30; });
await wait(2400);
const rew = await ev(() => {
  const g = window.__game;
  const done = g.rewinder.done && g.rewinder.tape.rewound;
  g.unloadRewinder();
  const held = g.player.held.length === 1 && g.player.held[0].rewound;
  const before = g.stats.shelvedRight;
  g.shelve(g.player.held[g.player.held.length - 1], 'HORROR');
  return { done, held, shelved: g.stats.shelvedRight === before + 1, hands: g.player.held.length };
});
check('rewinder finishes and marks the tape rewound', rew.done);
check('tape comes back out into your hands', rew.held);
check('shelving on the right genre scores', rew.shelved && rew.hands === 0);

/* ---------- 4a2. a cartridge is not a tape ---------- */
const cart = await ev(() => {
  const g = window.__game;
  const t = window.__tapes.makeTape('GAMES', g.rng, {});
  g.player.held = [t];
  const before = g.rewinder.tape;
  g.loadRewinder();
  const refused = g.rewinder.tape === before && g.player.held.length === 1;
  const b = g.stats.shelvedRight;
  g.shelve(g.player.held[0], 'GAMES');
  return { refused, isGame: t.game, rewound: t.rewound, price: t.price,
    shelved: g.stats.shelvedRight === b + 1, title: t.title };
});
check('games are their own genre and never need rewinding',
  cart.isGame && cart.rewound === true, `${cart.title} $${cart.price.toFixed(2)}`);
check('the rewinder refuses a cartridge', cart.refused);
check('and the games run takes it', cart.shelved);

const wrong = await ev(() => {
  const g = window.__game;
  g.player.held = [{ id: 998, title: 'ORBIT ZERO', genre: 'SCIFI', rewound: true, price: 3, daysLate: 0 }];
  const b = g.stats.shelvedWrong;
  g.shelve(g.player.held[0], 'COMEDY');
  return g.stats.shelvedWrong === b + 1;
});
check('shelving on the wrong genre is penalised', wrong);

/* ---------- 4b. the mask: his questions, and what your answers cost ---------- */
await ev(() => {
  const g = window.__game;
  const k = g.killer;
  k.plan.appears = true;
  k.phase = 'CUSTOMER';
  k.ent.hidden = false;
  k.ent.state = 'WAITING';
  k.ent.x = 10.75; k.ent.z = 0.8; k.ent.yaw = 0;
  k.ent.tape = { id: 77, title: 'THE REWIND', genre: 'HORROR', rewound: true, price: 3.5, daysLate: 0 };
  k.ent.script = 'rent';
  k.ent.saidSmallTalk = false;
  k.intel = 0;
  g.player.x = 10.75; g.player.z = 3.05; g.player.yaw = Math.PI;
  g.talkToPerson(k.ent);
});
await wait(300);
const mask = await ev(() => {
  const g = window.__game;
  return { name: g.dlg.node.person.name, tag: g.dlg.node.person.personality.tag,
    text: g.dlg.node.text, choices: (g.dlg.node.choices || []).map((c) => c.label) };
});
check('the killer can be served like anyone else', !!mask.text, `${mask.name} - ${mask.tag}`);
console.log('      him: "' + mask.text + '"');

// walk into his small talk and answer badly
let probe = null;
for (let i = 0; i < 12; i++) {
  const n = await ev(() => {
    const g = window.__game;
    if (!g.dlg.node) return null;
    return { text: g.dlg.node.text, choices: (g.dlg.node.choices || []).map((c) => c.label) };
  });
  if (!n) break;
  if (n.choices.some((c) => /just me tonight/i.test(c))) { probe = n; break; }
  await ev(() => window.__game.ui.finishTyping());
  await wait(80);
  await page.keyboard.press('Enter');
  await wait(220);
}
check('he probes you while you ring him up', !!probe);
if (probe) {
  console.log('      him: "' + probe.text + '"');
  console.log('      you:  ' + probe.choices.map((c) => `[${c}]`).join(' '));
  const idx = probe.choices.findIndex((c) => /just me tonight/i.test(c));
  await page.keyboard.press(`Digit${idx + 1}`);
  await wait(300);
  check('telling him you are alone hands him something', await ev(() => window.__game.killer.intel) > 0,
    `intel ${await ev(() => window.__game.killer.intel)}`);
}
await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); });

/* ---------- 4c. names have to match the people wearing them ---------- */
const nameCheck = await ev(() => {
  const { makeRng } = window.__mathx;
  const A = window.__app;
  const rng = makeRng(4242);
  const MALE = new Set(['Marty','Curtis','Ray','Ed','Duane','Vern','Gil','Stan','Dale','Kenny','Norm','Hank','Terry','Dwight','Rudy','Wes','Lonnie','Merle','Bud','Lyle','Chet','Roy','Clyde','Dennis','Gary','Ron','Walt','Otis','Earl','Delbert','Marv','Sal','Gene','Howie','Ike']);
  const FEMALE = new Set(['Denise','Lorraine','Patty','Sheila','Bobbi','Wanda','Charlene','Roberta','Yvette','Trish','Marcy','Faye','Colleen','Janine','Bev','Arlene','Doreen','Joanne','Rhonda','Peggy','Lynette','Gail','Maureen','Dot','Sherri','Carla','Nadine','Verna','Cheryl','Marlene','Ruthie','Sondra','Elaine']);
  let bad = 0, n = 0, beards = 0, unknown = 0;
  for (let i = 0; i < 400; i++) {
    const c = window.__cust.createCustomer(rng, { intent: 'RENT' });
    const first = c.name.split(' ')[0];
    const g = c.app.gender.id;
    n++;
    if (g === 'm' && FEMALE.has(first)) bad++;
    else if (g === 'f' && MALE.has(first)) bad++;
    else if (!MALE.has(first) && !FEMALE.has(first)) unknown++;
    if (g === 'f' && c.app.facial.id !== 'clean') beards++;
  }
  return { n, bad, unknown, beards };
});
check('names match the person', nameCheck.bad === 0 && nameCheck.unknown === 0,
  `${nameCheck.n} people, ${nameCheck.bad} mismatched, ${nameCheck.unknown} off-list`);
check('no bearded women', nameCheck.beards === 0);

/* ---------- 4d. they actually shop ---------- */
const peruse = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0;
  g.killer.ent.hidden = true; g.killer.phase = 'ABSENT';
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.personality = { ...c.personality, confused: null };
  c.script = 'rent'; c.browsesFirst = false;
  g.customers.push(c);
  window.__watch = { pulls: 0, putbacks: 0, shelves: new Set(), phases: new Set() };
  return true;
});
await ev(() => { window.__game.timeScale = 8; });
for (let i = 0; i < 200; i++) {
  const st = await ev(() => {
    const g = window.__game;
    const c = g.customers[0];
    if (!c) return { gone: true };
    const w = window.__watch;
    if (c.browse) {
      w.phases.add(c.browse.phase);
      if (c.browse.shelf) w.shelves.add(c.browse.shelf.genre);
      w.pulls = Math.max(w.pulls, c.browse.seen);
    }
    return { state: c.state, holding: !!c.tape,
      shelves: [...w.shelves], phases: [...w.phases], seen: w.pulls };
  });
  if (st.gone || st.state === 'WAITING' || st.state === 'TALKING') {
    check('a shopper browses, pulls boxes and puts them back',
      st.phases && st.phases.includes('READ') && st.phases.includes('SCAN'),
      `phases ${(st.phases || []).join('/')}`);
    check('and comes to the counter holding what they picked', !!st.holding);
    console.log(`      visited: ${(st.shelves || []).join(', ')} | put back ${st.seen} before deciding`);
    break;
  }
  await wait(150);
}

/* ---------- 4e. the ones who are in the wrong building ---------- */
const lost = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  const A = window.__app;
  const P = window.__dlg;
  const arch = window.__pers.ARCHETYPES.find((a) => a.id === 'LOST');
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT', personality: arch });
  c.state = 'WAITING'; c.path = null; c.hidden = false; c.moveSpeed = 0;
  c.x = 10.75; c.z = 0.8; c.yaw = 0;
  g.customers.push(c);
  g.player.x = 10.75; g.player.z = 3.05; g.player.yaw = Math.PI;
  g.talkToPerson(c);
  return { premise: c.premise, script: c.script, tag: c.personality.tag,
    text: g.dlg.node.text, choices: g.dlg.node.choices.map((x) => x.label) };
});
check('someone walks in thinking this is another shop entirely',
  lost.script === 'confused' && !!lost.premise, `premise: ${lost.premise}`);
console.log('      them: "' + lost.text.replace(/\n/g, ' ') + '"');
console.log('      you:  ' + lost.choices.map((x) => `[${x}]`).join(' '));
const lostRun = [];
for (let i = 0; i < 10; i++) {
  const n = await ev(() => {
    const g = window.__game;
    if (!g.dlg.node) return null;
    return { text: g.dlg.node.text, choices: (g.dlg.node.choices || []).map((c) => c.label) };
  });
  if (!n) break;
  lostRun.push(n.text);
  await ev(() => window.__game.ui.finishTyping());
  await wait(70);
  await page.keyboard.press('Enter');
  await wait(190);
}
check('the misunderstanding plays out to an ending', lostRun.length >= 3, `${lostRun.length} beats`);
console.log('      -> "' + (lostRun[lostRun.length - 1] || '').replace(/\n/g, ' ').slice(0, 90) + '"');
await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); g.customers.length = 0; g.timeScale = 4; });

/* ---------- 5. the killer's whole arc ---------- */
const arc = await ev(async () => {
  const g = window.__game;
  const K = g.killer;
  K.plan.appears = true; K.plan.stalks = true;
  K.plan.breachLocked = 3; K.plan.doorDelay = 2; K.plan.postDwell = 0.6;
  K.phase = 'GONE_QUIET';
  K.plan.stalkAt = 0;
  return { phase: K.phase };
});
/* Sampled inside the page, once a frame. The beats are short enough now
   that polling from here walked straight past TRY_DOOR. */
await ev(() => {
  const g = window.__game;
  window.__phases = [];
  const tick = () => {
    const p = g.killer && g.killer.phase;
    const seen = window.__phases;
    if (p && seen[seen.length - 1] !== p) seen.push(p);
    if (p === 'TRY_DOOR') g.door.locked = true;
    if (window.__sampling) requestAnimationFrame(tick);
  };
  window.__sampling = true;
  tick();
});
await ev(() => { window.__game.timeScale = 8; });
for (let i = 0; i < 200; i++) {
  if ((await ev(() => window.__game.state)) === 'ENDING') break;
  await wait(200);
}
const phases = await ev(() => { window.__sampling = false; return window.__phases; });
console.log('      killer phases:', phases.join(' -> '));
check('killer stalks, tries the door and breaks in', phases.includes('STALK') && phases.includes('TRY_DOOR'));
const endKind = await ev(() => window.__game.endKind);
if (endKind !== 'ATTACKED') {
  console.log('      hunt debug:', JSON.stringify(await ev(() => {
    const g = window.__game, e = g.killer.ent;
    return { phase: g.killer.phase, kx: +e.x.toFixed(2), kz: +e.z.toFixed(2),
      px: +g.player.x.toFixed(2), pz: +g.player.z.toFixed(2),
      path: (e.path || []).map((w) => `${w.x.toFixed(1)},${w.z.toFixed(1)}`), pathI: e.pathI };
  })));
}
check('reaching the player ends the night', (await ev(() => window.__game.state)) === 'ENDING' && endKind === 'ATTACKED', endKind || '');

/* ---------- 6. calling the police on the right person ---------- */
await ev((n) => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false);
  g.startNight(n);
}, KILLER_NIGHT);
await wait(400);
await ev(() => { const g = window.__game; g.estT = 99; g.timeScale = 4; g.officerDone = true; if (g.officer) g.officer.state = 'DONE'; });
await wait(500);
const win = await ev(async () => {
  const g = window.__game;
  g.killer.phase = 'STALK';
  g.killer.ent.hidden = false;
  g.killer.ent.x = 6; g.killer.ent.z = -1.5;
  const targets = g.phoneTargets();
  const k = targets.find((t) => t.isKiller);
  if (!k) return { found: false };
  g.accuse(k);
  return { found: true, label: k.phoneLabel, eta: Math.round(g.police.eta), name: k.name };
});
await wait(600);
check('dispatch can be pointed at the man outside', win.found, win.label || '');
check('the killer has a name like everyone else',
  !!win.name && !/^THE /.test(win.name), win.name || '');
check('the call rolls a unit rather than ending the night',
  (await ev(() => window.__game.state)) === 'PLAY' && win.eta > 0, `ETA ${win.eta}s`);
// take him off the board and let the cruiser arrive on its own
await ev(() => {
  const g = window.__game;
  g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true;
  g.timeScale = 20;
});
let arrested = null;
for (let i = 0; i < 70; i++) {
  arrested = await ev(() => ({ end: window.__game.endKind, eta: +window.__game.police.eta.toFixed(1) }));
  if (arrested.end === 'CAUGHT') break;
  await wait(200);
}
check('and the unit arriving is what ends it as a win', arrested.end === 'CAUGHT',
  `ETA ran ${win.eta}s -> ${arrested.eta}s`);
await ev(() => { window.__game.timeScale = 1; });

/* ---------- 7. calling the police on an innocent ---------- */
await ev((n) => { const g = window.__game; g.ui.hidePanel(); g.startNight(n); }, KILLER_NIGHT);
await wait(400);
await ev(() => { const g = window.__game; g.estT = 99; g.timeScale = 8; g.officerDone = true; if (g.officer) g.officer.state = 'DONE'; });
for (let i = 0; i < 60; i++) {
  if (await ev(() => window.__game.customers.length > 0)) break;
  await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); });
  await wait(200);
}
const fired = await ev(async () => {
  const g = window.__game;
  const c = g.customers[0];
  if (!c) return { none: true };
  g.accuse(c);
  return { name: c.name };
});
await wait(2200);
check('calling it in on a regular customer gets you fired',
  (await ev(() => window.__game.endKind)) === 'FIRED', fired.name || '(no customer available)');

/* ---------- 7b. talking to people who have no tape in their hands ---------- */
await ev((n) => { const g = window.__game; g.ui.hidePanel(); g.ui.cinema(false); g.startNight(n); }, 1);
await wait(400);
await ev(() => {
  const g = window.__game;
  g.estT = 99; g.timeScale = 3;
  g.customers.length = 0;
  if (g.killer) { g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true; }
});
await wait(500);
const midBrowse = await ev(async () => {
  const g = window.__game;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 4.8; c.z = 5.4; c.state = 'BROWSING';
  g.customers.push(c);
  // let them get as far as standing at a shelf with nothing in hand
  await new Promise((r) => setTimeout(r, 900));
  const before = { state: c.state, tape: !!c.tape };
  g.talkToPerson(c);
  return { before, opened: !!g.dlg.node, text: g.dlg.node && g.dlg.node.text.slice(0, 60) };
});
check('talking to somebody still choosing does not blow up',
  midBrowse.opened, `holding a tape: ${midBrowse.before.tape}`);
if (midBrowse.text) console.log('      them: "' + midBrowse.text + '"');
await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); });

const afterServe = await ev(() => {
  const g = window.__game;
  const c = g.customers[0];
  if (!c) return { none: true };
  // the state you are in the moment after handing a tape over
  c.tape = null; c.gaveTape = true; c.served = true; c.state = 'WAITING';
  g.talkToPerson(c);
  return { opened: !!g.dlg.node, text: g.dlg.node && g.dlg.node.text.slice(0, 50) };
});
check('and neither does talking to somebody you already served', !!afterServe.opened);
await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); g.customers.length = 0; });

/* ---------- 7c. change owed to somebody standing right there ---------- */
const chg = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 10.7; c.z = 0.8; c.state = 'WAITING'; c.hasMoney = true;
  g.customers.push(c);
  g.till = 0; g.player.cash = { tendered: 0, owed: 0 }; g.player.changeInHand = 0;
  /* Roughly half of people pay to the cent, which is realistic and useless
     for a test. Keep serving fresh ones until somebody breaks a note. */
  let t = null;
  for (let i = 0; i < 40 && !(c.changeDue > 0.001); i++) {
    g.player.cash = { tendered: 0, owed: 0 };
    t = g.takeCashFrom(2.99, c, 'rental');
  }
  const held = { tendered: g.player.cash.tendered, owed: g.player.cash.owed, due: c.changeDue };
  g.ringUp();
  const after = { till: g.till, inHand: g.player.changeInHand, owedOut: g.changeOwedOut().total };
  // the register must refuse to swallow it while they are waiting
  g.player.x = 12.5; g.player.z = 2.2; g.player.yaw = Math.PI; g.player.pitch = -0.5;
  return { t, held, after };
});
check('a big bill leaves change owed', chg.held.due > 0.001,
  `tendered $${chg.held.tendered.toFixed(2)} for $${chg.held.owed.toFixed(2)}`);
check('ringing up moves the sale to the drawer and the change to your hand',
  Math.abs(chg.after.till - 2.99) < 0.001 && Math.abs(chg.after.inHand - chg.held.due) < 0.001,
  `till $${chg.after.till.toFixed(2)} / hand $${chg.after.inHand.toFixed(2)}`);
check('and the game knows who is waiting on it',
  Math.abs(chg.after.owedOut - chg.held.due) < 0.001);
const sweep = await ev(() => {
  const g = window.__game;
  // aim at the register and try every interaction it offers
  const tgt = g.buildTargets().find((t) => t.kind === 'register');
  const a = tgt.aabb;
  g.player.x = (a.x0 + a.x1) / 2 - 1.1; g.player.z = 3.0;
  g.player.yaw = Math.atan2((a.x0 + a.x1) / 2 - g.player.x, (a.z0 + a.z1) / 2 - g.player.z);
  g.player.pitch = Math.atan2(1.2 - g.player.eye, 1.6);
  const before = g.player.changeInHand;
  for (let i = 0; i < 6; i++) { g.input.keys = g.input.keys || {}; g.updateInteraction(); }
  return { before, after: g.player.changeInHand, prompt: document.getElementById('prompt').textContent.replace(/\s+/g, ' ').trim() };
});
check('the drawer will not swallow change somebody is waiting for',
  Math.abs(sweep.after - sweep.before) < 0.001, sweep.prompt.slice(0, 70));
const paid = await ev(() => {
  const g = window.__game;
  const c = g.customers[0];
  g.ctx.giveChange(c);
  return { inHand: g.player.changeInHand, awaiting: c.awaitingChange, owedOut: g.changeOwedOut().total };
});
check('and paying them clears it', Math.abs(paid.inHand) < 0.001 && !paid.awaiting && paid.owedOut < 0.001);
await ev(() => { const g = window.__game; g.customers.length = 0; g.player.changeInHand = 0; });

/* ---------- 7d. the back room ---------- */
const room = await ev(async () => {
  const g = window.__game;
  const W = window.__world;
  g.customers.length = 0;
  g.officerDone = true; if (g.officer) g.officer.state = 'DONE';
  // stand in the back room and throw the bolt
  g.player.x = W.SPOTS.storageHide.x; g.player.z = W.SPOTS.storageHide.z;
  g.lockStorage();
  const hidden = g.hiding;
  // put him in the shop, hunting
  const k = g.killer;
  k.plan.appears = true;
  k.plan.breakStorage = 2.2;
  k.phase = 'HUNT'; k.ent.hidden = false;
  k.ent.x = 6.0; k.ent.z = 2.0;
  await new Promise((r) => setTimeout(r, 300));
  return { hidden, locked: g.storage.locked, phase: k.phase };
});
check('the back room can be bolted from the inside', room.hidden && room.locked);
// merely pulling the door to is not hiding: he opens doors
const shutOnly = await ev(() => {
  const g = window.__game;
  g.storage.locked = false; g.storage.open = false; g.storage.broken = false;
  return { hiding: g.hiding, killerCanPass: g.ctx.storagePassable(), playerCanPass: g.ctx.storagePassableForPlayer() };
});
check('pulling it to without bolting is not hiding',
  !shutOnly.hiding && shutOnly.killerCanPass && !shutOnly.playerCanPass);
await ev(() => { const g = window.__game; g.lockStorage(); });
const bolted = await ev(() => ({ hiding: window.__game.hiding, killerCanPass: window.__game.ctx.storagePassable() }));
check('and throwing the bolt is', bolted.hiding && !bolted.killerCanPass);
await ev(() => { window.__game.timeScale = 6; });
let siege = null;
for (let i = 0; i < 80; i++) {
  siege = await ev(() => {
    const g = window.__game;
    return { phase: g.killer.phase, dmg: +g.storage.damage.toFixed(2), broken: g.storage.broken,
      state: g.state, end: g.endKind };
  });
  if (siege.phase === 'SIEGE' && siege.dmg > 0.05) break;
  if (siege.state === 'ENDING') break;
  await wait(150);
}
check('and he comes and works on the door instead of giving up',
  siege.phase === 'SIEGE', `phase ${siege.phase}, damage ${siege.dmg}`);
let broke = null;
for (let i = 0; i < 90; i++) {
  broke = await ev(() => ({ broken: window.__game.storage.broken, state: window.__game.state,
    end: window.__game.endKind, phase: window.__game.killer.phase }));
  if (broke.broken || broke.state === 'ENDING') break;
  await wait(150);
}
check('given long enough the door goes', broke.broken || broke.state === 'ENDING',
  `broken ${broke.broken}, phase ${broke.phase}`);
await ev(() => { window.__game.timeScale = 1; });

/* ---------- 7e. the death shot actually plays ---------- */
await ev((n) => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false);
  g.startNight(n);
}, KILLER_NIGHT);
await wait(400);
await ev(() => {
  const g = window.__game;
  g.estT = 99; g.timeScale = 1;
  g.officerDone = true; if (g.officer) g.officer.state = 'DONE';
});
await wait(500);
const struck = await ev(() => {
  const g = window.__game;
  const k = g.killer;
  k.phase = 'HUNT'; k.ent.hidden = false;
  k.ent.x = g.player.x + 0.7; k.ent.z = g.player.z + 0.3;
  g.ctx.onKillerAttacks();
  return { state: g.state, end: g.endKind, t: g.death && g.death.t, shake: g.shake };
});
check('reaching you starts the death sequence, not a fade',
  struck.state === 'ENDING' && struck.end === 'ATTACKED' && struck.t === 0);
/* The damage comes in bursts, not on every frame -- a picture you can
   never read is not frightening -- so this samples a window of it. */
const mid = await ev(async () => {
  const g = window.__game;
  let tear = 0, roll = 0, invert = 0, grain = 0, shake = 0, n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 1300) {
    const fx = g.deathFx();
    if (fx) {
      tear = Math.max(tear, fx.tear || 0);
      roll = Math.max(roll, Math.abs(fx.roll || 0));
      invert = Math.max(invert, fx.invert || 0);
      grain = Math.max(grain, fx.grain || 0);
      shake = Math.max(shake, g.shake || 0);
      n++;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { t: g.death && +g.death.t.toFixed(2), n, tear: +tear.toFixed(2), roll, invert, grain: Math.round(grain), shake: +shake.toFixed(2) };
});
check('it shakes the camera and tears the picture apart',
  mid.t > 0.9 && mid.tear > 0.1 && mid.roll > 0 && mid.invert > 0 && mid.grain > 25 && mid.shake > 0.2,
  `over ${mid.n} frames: tear ${mid.tear}, roll ${mid.roll}px, invert ${mid.invert}, grain ${mid.grain}, shake ${mid.shake}`);
await wait(3200);
const settled = await ev(() => {
  const g = window.__game;
  const fx = g.deathFx() || {};
  return { t: g.death && +g.death.t.toFixed(2), dark: fx.dark, panel: !document.getElementById('panel').classList.contains('hidden') };
});
check('and it plays all the way out to black and a panel',
  settled.t > 4 && settled.dark === 0 && settled.panel, `t=${settled.t}s`);

/* ---------- 7f0. the notepad only knows what you were told ---------- */
const notes = await ev(async () => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false); g.death = null; g.shake = 0;
  g.startNight(1);                                   // no deputy on night one
  await new Promise((r) => setTimeout(r, 400));
  g.estT = 99;
  await new Promise((r) => setTimeout(r, 500));
  return { known: [...g.night.bulletin.known].length, keys: g.night.bulletin.keys.length };
});
check('a night with no deputy leaves the notepad empty',
  notes.known === 0 && notes.keys > 0, `${notes.known} of ${notes.keys} traits on file`);

/* ---------- 7f. a casual shift has nothing in it ---------- */
await ev(() => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false); g.death = null; g.shake = 0;
  g.beginRun('CASUAL');
});
await wait(500);
await ev(() => { window.__game.estT = 99; });
await wait(600);
const casual = await ev(() => {
  const g = window.__game;
  return { mode: g.mode, deputy: !!g.officer, appears: g.night.plan.appears,
    phase: g.killer && g.killer.phase, state: g.state };
});
check('casual mode runs the store and nothing else',
  casual.mode === 'CASUAL' && !casual.deputy && !casual.appears && casual.phase === 'ABSENT',
  `state ${casual.state}`);

/* ---------- 8. a whole night to the closing bell ---------- */
await ev(() => { const g = window.__game; g.ui.hidePanel(); g.startNight(1); });
await wait(400);
await ev(() => {
  const g = window.__game;
  g.estT = 99; g.timeScale = 25;
  g.officerDone = true; if (g.officer) g.officer.state = 'DONE';
  g.killer.plan.appears = false; g.killer.phase = 'ABSENT';
});
let reached = false;
for (let i = 0; i < 140; i++) {
  const st = await ev(() => ({ s: window.__game.state, e: Math.round(window.__game.elapsed), n: window.__game.nightNo }));
  if (st.s === 'REPORT') { reached = true; break; }
  if (st.s === 'ENDING') break;
  // keep clearing any dialogue the customers open
  await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); });
  await wait(200);
}
check('a quiet night runs to close and produces a report', reached);
const rep = await ev(() => ({ stats: window.__game.stats, grade: window.__game.grade }));
console.log('      ', JSON.stringify(rep.stats), rep.grade);
let advanced = false;
for (let i = 0; i < 25; i++) {
  await page.keyboard.press('Enter');
  await wait(220);
  const st = await ev(() => ({ n: window.__game.nightNo, s: window.__game.state }));
  if (st.n === 2 && (st.s === 'ESTABLISH' || st.s === 'PLAY')) { advanced = true; break; }
}
check('report advances to the next night', advanced);

/* ---------- done ---------- */
console.log('\n--- page errors ---');
console.log(errors.length ? errors.slice(0, 12).join('\n\n') : '(none)');
if (errors.length) fails += errors.length;
console.log(fails ? `\n${fails} PROBLEM(S)` : '\nsoak clean');
await browser.close();
process.exit(fails ? 1 : 0);
