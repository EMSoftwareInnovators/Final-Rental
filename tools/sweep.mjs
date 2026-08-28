/* You named him, the cruiser came, and he was gone before it got here.
   A deputy walks in and says so -- and says that the man you described and
   the man on their sheet are the same man. */
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

/* ---------- 1. he hears the siren and goes ---------- */
const fled = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  g.officerDone = true;
  if (g.officer) { g.officer.state = 'DONE'; g.officer.hidden = true; }
  // stand the killer in the store and force the "walks out" branch
  const k = g.killer;
  k.plan.appears = true;
  k.phase = 'CUSTOMER';
  k.ent.hidden = false;
  k.ent.x = 6; k.ent.z = 3;
  g.police = { called: true, target: k.ent, eta: 19 };
  const roll = g.rng;
  g.rng = Object.assign(() => 0.1, roll);        // the flee branch
  for (const key of Object.keys(roll)) if (typeof roll[key] === 'function') g.rng[key] = roll[key].bind(roll);
  g.updatePolice(1.5);                            // crosses the siren mark
  const out = { fled: !!g.police.fled, phase: k.phase };
  g.rng = roll;
  return out;
});
check('hearing the siren, he can walk out before the unit arrives',
  fled.fled === true, `fled ${fled.fled}, phase ${fled.phase}`);

/* ---------- 2. and a deputy comes in about it ---------- */
const arrives = await ev(async () => {
  const g = window.__game;
  g.police.eta = 0.01;
  g.updatePolice(0.5);                            // eta runs out -> the visit
  const started = !!g.sweep;
  // let him walk in, with the clerk deliberately away from the counter
  g.player.x = 3; g.player.z = 6;
  for (let i = 0; i < 1200; i++) {
    g.updateSweep(1 / 30);
    if (g.sweep && g.sweep.state === 'WAIT' && g.sweep.waitTimer > 0.2) break;
  }
  return {
    started, ended: g.state,
    state: g.sweep && g.sweep.state,
    at: g.sweep ? [+g.sweep.x.toFixed(2), +g.sweep.z.toFixed(2)] : null,
    drawn: g.people().some((p) => p === g.sweep),
    obj: g.ui.el.objective ? g.ui.el.objective.textContent : '',
  };
});
check('the unit finding nobody brings a deputy inside, not two lines of text',
  arrives.started === true && arrives.state === 'WAIT',
  `state ${arrives.state} at ${arrives.at}`);
check('he is a person in the room, not a message',
  arrives.drawn === true && arrives.at[1] > 0.4, `standing at ${arrives.at}`);
check('and the shift does not end on it', arrives.ended === 'PLAY', arrives.ended);
check('he waits at the counter rather than shouting across the store',
  /DEPUTY IS AT THE COUNTER/.test(arrives.obj), arrives.obj);

/* ---------- 3. the clock does not charge you for him ---------- */
const clock = await ev(async () => {
  const g = window.__game;
  const runFor = async (frames) => {
    const a = g.elapsed;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    return +(g.elapsed - a).toFixed(2);
  };
  const held = await runFor(20);
  return { held, present: g.sweepPresent() };
});
check('the shift clock waits while he is in the building',
  clock.held === 0 && clock.present, `${clock.held}s while he stood there`);

/* ---------- 4. what he actually says ---------- */
const said = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  // put something in the notepad so he can cite it back
  for (const k of g.night.bulletin.keys) g.night.bulletin.known.add(k);
  const seen = [];
  const walk = (node, depth) => {
    if (!node || depth > 6) return;
    seen.push(node.text || '');
    (node.choices || []).forEach((r) => {
      seen.push(r.label || '');
      if (depth < 5 && r.fn) walk(r.fn(), depth + 1);
    });
  };
  const lines = [];
  for (let i = 0; i < 40; i++) {
    const t = D.buildSweepReport(g.sweep, g.night.bulletin, g.ctx);
    seen.length = 0;
    walk(t, 0);
    lines.push(seen.join(' ¶ '));
  }
  const all = lines.join(' ');
  return {
    n: lines.length,
    empty: lines.filter((l) => !l.trim()).length,
    undef: /undefined|\[object/.test(all),
    nobody: lines.filter((l) => /nobody|empty out there|not on this block|isn't out there/i.test(l)).length,
    /* Three ways of saying the same thing: he matched us, all of it.
       Not one phrasing -- the point is that every walk of the tree tells
       you the description was a perfect match, however he puts it. */
    matched: lines.filter((l) => /matched (what|ours|us)|the same man|match(ed)? .*to the letter/i.test(l)).length,
    vigilant: lines.filter((l) => /eyes on|keep the door|see the block|pick that phone up/i.test(l)).length,
    sample: lines[0].slice(0, 240),
  };
});
check('every telling of it is written all the way through',
  said.empty === 0 && !said.undef, said.undef ? 'a hole in the tree' : `${said.n} walks`);
check('he says the street was empty', said.nobody === said.n, `${said.nobody} of ${said.n}`);
check('and that the description matched to the letter', said.matched === said.n, `${said.matched} of ${said.n}`);
check('and tells you to stay watching the door', said.vigilant === said.n, `${said.vigilant} of ${said.n}`);
console.log('      "' + said.sample.replace(/\n/g, ' ') + '"');

/* ---------- 5. and then he leaves ---------- */
const left = await ev(() => {
  const g = window.__game;
  g.ctx.sweepDone();
  const leaving = g.sweep && g.sweep.state;
  let gone = false;
  for (let i = 0; i < 4000; i++) {
    g.updateSweep(1 / 30);
    g.updateDoor(1 / 30);
    if (!g.sweep) { gone = true; break; }
  }
  return { leaving, gone, present: g.sweepPresent() };
});
check('saying his piece sends him back out', left.leaving === 'LEAVE', left.leaving);
check('and he actually goes', left.gone === true && !left.present);

const after = await ev(async () => {
  const g = window.__game;
  const a = g.elapsed;
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  return +(g.elapsed - a).toFixed(2);
});
check('the shift picks back up once he is gone', after > 0.05, `${after}s`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nsweep FAILED (${fails})` : '\nsweep clean');
process.exit(fails ? 1 : 0);
