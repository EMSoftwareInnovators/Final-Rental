/* The cruiser arriving. He may run, go to ground, or decide there is no
   longer any reason to be careful -- and if they get him, a deputy has to
   walk in and put the cuffs on where you can see it. */
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
await page.keyboard.press('Enter');
await wait(500);
await ev(() => { window.__game.estT = 99; });
await wait(700);

/* Put him in the shop as a customer, call it in, and hold the sirens. */
const arm = () => ev(() => {
  const g = window.__game;
  g.state = 'PLAY';
  g.arrest = null; g.police = null; g.endKind = null; g.death = null;
  g.ui.hidePanel(); g.ui.cinema(false); g.ui.setHudVisible(true);
  g.customers.length = 0;
  const k = g.killer;
  k.plan.appears = true;
  k.phase = 'CUSTOMER';
  k.fled = false; k.frozen = false;
  k.ent.hidden = false;
  k.ent.x = 9.6; k.ent.z = 1.5; k.ent.yaw = Math.PI; k.ent.cuffed = false;
  k.ent.anim = window.__actor ? k.ent.anim : k.ent.anim;
  g.accuse(k.ent);
  return { eta: Math.round(g.police.eta) };
});

/* ---------- 1. what he does about the sirens ---------- */
const outcomes = await ev(() => {
  const g = window.__game;
  const tally = { fled: 0, hidden: 0, hunt: 0 };
  const etas = [];
  // One continuous stream of rolls: reseeding per iteration would only ever
  // sample the first number each generator produces.
  g.rng = window.__mathx.makeRng(0xBEEF);
  for (let i = 0; i < 300; i++) {
    const k = g.killer;
    k.plan.appears = true; k.phase = 'CUSTOMER'; k.fled = false;
    k.ent.hidden = false;
    g.police = { called: true, target: k.ent, eta: 30 };
    g.killerHearsSirens();
    if (g.police.fled) tally.fled++;
    else if (g.police.hidden) { tally.hidden++; etas.push(g.police.eta); }
    else if (k.phase === 'HUNT') tally.hunt++;
  }
  g.police = null;
  return { tally, avgHideEta: etas.length ? etas.reduce((a, b) => a + b, 0) / etas.length : 0 };
});
const T = outcomes.tally;
check('he does not always do the same thing about a siren',
  T.fled > 40 && T.hidden > 40 && T.hunt > 40,
  `of 300: ${T.fled} ran, ${T.hidden} went to ground, ${T.hunt} stopped pretending`);
check('and going to ground buys him time from the search',
  outcomes.avgHideEta > 50, `${Math.round(outcomes.avgHideEta)}s for them to find him, up from 30`);

const pressing = await ev(() => {
  const g = window.__game;
  const k = g.killer;
  k.plan.appears = true; k.phase = 'HUNT'; k.fled = false;
  g.police = { called: true, target: k.ent, eta: 30 };
  g.killerHearsSirens();
  const out = { fled: !!g.police.fled, phase: k.phase };
  g.police = null;
  return out;
});
check('somebody already coming for you does not stop for a siren',
  !pressing.fled && pressing.phase === 'HUNT');

/* ---------- 2. running means there is nothing to arrest ---------- */
const ranOff = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0;
  const k = g.killer;
  k.plan.appears = true; k.phase = 'CUSTOMER'; k.ent.hidden = false;
  k.ent.x = 9.6; k.ent.z = 1.5;
  g.police = { called: true, target: k.ent, eta: 0.05, reacted: true, fled: true };
  g.updatePolice(0.1);
  await new Promise((r) => setTimeout(r, 60));
  return { state: g.state, police: !!g.police, arrest: !!g.arrest };
});
check('if he ran, the unit finds nobody and the shift carries on',
  ranOff.state === 'PLAY' && !ranOff.police && !ranOff.arrest,
  `state ${ranOff.state}`);

/* ---------- 3. the arrest itself ---------- */
await arm();
const cuffed = await ev(async () => {
  const g = window.__game;
  const k = g.killer;
  k.phase = 'CUSTOMER'; k.ent.hidden = false;
  k.ent.x = 9.6; k.ent.z = 1.5;
  g.police = { called: true, target: k.ent, eta: 0.05, reacted: true };
  g.updatePolice(0.1);
  const started = !!g.arrest;
  const seen = new Set();
  let sawDeputyInside = false, sawCuffPose = false, frozenDuring = false;
  let cuffedFlag = false;
  for (let i = 0; i < 3000 && g.arrest; i++) {
    g.updateArrest(1 / 30);
    const A = g.arrest;
    if (!A) break;
    seen.add(A.phase);
    if (A.deputy.z > 0.4) sawDeputyInside = true;
    if (A.ent.anim.armL > 0.8 && A.ent.anim.armR > 0.8) sawCuffPose = true;
    if (g.player.frozen) frozenDuring = true;
    if (A.ent.cuffed) cuffedFlag = true;
  }
  await new Promise((r) => setTimeout(r, 2200));
  const panel = g.ui.el.panelBody ? g.ui.el.panelBody.textContent : '';
  return { started, phases: [...seen], sawDeputyInside, sawCuffPose, cuffedFlag,
    frozenDuring, state: g.state, kind: g.endKind, panel };
});
check('a deputy is dispatched into the shop rather than a line of text',
  cuffed.started && cuffed.sawDeputyInside);
check('he walks in, cuffs him, and walks him out',
  cuffed.phases.includes('IN') && cuffed.phases.includes('CUFF') && cuffed.phases.includes('OUT'),
  cuffed.phases.join(' -> '));
check('and you can see the cuffs go on', cuffed.sawCuffPose && cuffed.cuffedFlag);
check('the clerk stands still and watches it', cuffed.frozenDuring);
check('then the night ends on the arrest', cuffed.state === 'ENDING' && cuffed.kind === 'CAUGHT');

/* ---------- 4. and you are asked whether to carry on ---------- */
check('the panel asks whether you are taking tomorrow',
  /Take tomorrow/i.test(cuffed.panel) && /Hand in the keys/i.test(cuffed.panel),
  cuffed.panel.replace(/\s+/g, ' ').slice(-72));

const carried = await ev(async () => {
  const g = window.__game;
  const night = g.nightNo;
  g.endTimer = 9;
  g.endSel = 0;
  g.input.pressed.add('Enter');
  g.updateEnding(0.016);
  g.input.pressed.clear();
  await new Promise((r) => setTimeout(r, 200));
  return { state: g.state, night: g.nightNo, was: night,
    calm: g.run ? g.run.calmUntil : 0, standDown: g.run ? g.run.standDownNight : 0 };
});
check('taking the shift starts the next night rather than dropping you at the title',
  carried.night === carried.was + 1 && carried.state !== 'TITLE',
  `night ${carried.was} -> ${carried.night}, state ${carried.state}`);
check('and the arrest bought the town a few quiet ones',
  carried.calm >= carried.was + 3 && carried.standDown === carried.was + 1,
  `calm through night ${carried.calm}, deputy stands down on ${carried.standDown}`);

/* ---------- 5. the panel has to fit on the screen ---------- */
const fits = [];
for (const [w, h] of [[640, 480], [1024, 768], [1280, 720], [800, 600]]) {
  await page.setViewportSize({ width: w, height: h });
  await wait(220);
  const over = await ev(() => {
    const g = window.__game;
    g.state = 'ENDING'; g.endKind = 'CAUGHT'; g.endTimer = 9; g.endSel = 0;
    g.ui.cinema(true);
    g.ui.showPanel(window.__ui.endingHtml('CAUGHT', {
      name: 'Raymond Whitlock', night: 9, nights: 9, calmNights: 4,
      caseFile: { caughtLast: true }, hid: true, broke: false,
    }));
    g.ui.panelSelect(0);
    const el = document.querySelector('.pad');
    const host = el.parentElement;
    return {
      overflow: Math.max(0, el.scrollHeight - el.clientHeight),
      past: Math.max(0, Math.round(el.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom)),
      top: Math.max(0, Math.round(host.getBoundingClientRect().top - el.getBoundingClientRect().top)),
    };
  });
  fits.push({ w, h, ...over });
}
check('the arrest panel fits the window at every shape',
  fits.every((f) => f.overflow === 0 && f.past === 0 && f.top === 0),
  fits.map((f) => `${f.w}x${f.h}: ${f.overflow}px scroll, ${f.past}px past the bottom`).join(' | '));

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\narrest FAILED (${fails})` : '\narrest clean');
process.exit(fails ? 1 : 0);
