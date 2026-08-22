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

/* ---------- 1. boot to a shift ---------- */
await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(600);
await ev(() => { window.__game.estT = 99; });
await wait(400);
check('shift started', await ev(() => window.__game.state) === 'PLAY');

/* ---------- 2. the deputy briefs you ---------- */
await ev(() => { window.__game.timeScale = 4; });
let briefed = false;
for (let i = 0; i < 60; i++) {
  const st = await ev(() => ({ dlg: !!window.__game.dlg.node, done: window.__game.officerDone }));
  if (st.done) { briefed = true; break; }
  if (st.dlg) await page.keyboard.press('Enter');
  await wait(160);
}
if (!briefed) {
  const dbg = await ev(() => {
    const g = window.__game;
    const o = g.officer;
    return { state: o.state, x: +o.x.toFixed(2), z: +o.z.toFixed(2), pathI: o.pathI,
      pathLen: o.path && o.path.length, briefingStarted: g.briefingStarted,
      dlgNode: g.dlg.node ? g.dlg.node.text.slice(0, 60) : null,
      choices: g.dlg.node && (g.dlg.node.choices || []).map((c) => c.label.slice(0, 30)),
      typing: g.ui.typing };
  });
  console.log('      officer debug:', JSON.stringify(dbg));
}
check('deputy delivered the bulletin and left', briefed);
const bull = await ev(() => {
  const b = window.__game.night.bulletin;
  return { keys: [...b.known], text: b.description.slice(0, 90), suspect: b.app.jacket.label };
});
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
await ev(() => { window.__game.timeScale = 12; });
await wait(1200);
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
await ev(() => { window.__game.timeScale = 8; });
const phases = [];
for (let i = 0; i < 200; i++) {
  const p = await ev(() => window.__game.killer && window.__game.killer.phase);
  if (p && phases[phases.length - 1] !== p) phases.push(p);
  if (p === 'TRY_DOOR') await ev(() => { window.__game.door.locked = true; });
  const st = await ev(() => window.__game.state);
  if (st === 'ENDING') break;
  await wait(200);
}
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
await ev(() => {
  const g = window.__game;
  g.ui.hidePanel(); g.ui.cinema(false);
  g.startNight(1);
});
await wait(400);
await ev(() => { const g = window.__game; g.estT = 99; g.timeScale = 4; });
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
  return { found: true, label: k.phoneLabel };
});
await wait(2200);
check('dispatch can be pointed at the man outside', win.found, win.label || '');
check('correct call ends the game as a win', (await ev(() => window.__game.endKind)) === 'CAUGHT');

/* ---------- 7. calling the police on an innocent ---------- */
await ev(() => { const g = window.__game; g.ui.hidePanel(); g.startNight(2); });
await wait(400);
await ev(() => { const g = window.__game; g.estT = 99; g.timeScale = 8; g.officerDone = true; g.officer.state = 'DONE'; });
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

/* ---------- 8. a whole night to the closing bell ---------- */
await ev(() => { const g = window.__game; g.ui.hidePanel(); g.startNight(1); });
await wait(400);
await ev(() => {
  const g = window.__game;
  g.estT = 99; g.timeScale = 25;
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
await page.keyboard.press('Enter');
await wait(800);
check('report advances to the next night',
  (await ev(() => window.__game.nightNo)) === 2 && ['ESTABLISH', 'PLAY'].includes(await ev(() => window.__game.state)));

/* ---------- done ---------- */
console.log('\n--- page errors ---');
console.log(errors.length ? errors.slice(0, 12).join('\n\n') : '(none)');
if (errors.length) fails += errors.length;
console.log(fails ? `\n${fails} PROBLEM(S)` : '\nsoak clean');
await browser.close();
process.exit(fails ? 1 : 0);
