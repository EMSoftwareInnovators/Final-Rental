/* Stage 12: the permanent profile and the Overtime run, driven through the
 * real game. Profile records outlive campaigns; Overtime is its own seeded,
 * saved, failure-ends-the-run survival mode that shares nothing with Story.
 *
 * Runs the actual Game object and the two storage-owner modules, and asks the
 * questions a player's sessions would: does clearing Story unlock Overtime and
 * survive a New Story, does a completed pre-profile save import once (and only
 * once), does an Overtime run bank and rebuild deterministically, does failure
 * end it while keeping the records, and is every mode sealed off from every
 * other.
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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

const clearAll = () => ev(() => {
  try { ['finalrental.profile', 'finalrental.overtime', 'finalrental.campaign'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* fine */ }
});
await clearAll();
await ev(() => { window.__game.sound.muted = true; });

/* A completed-campaign blob, as the game writes one. */
const completedCampaign = (over = {}) => ({
  version: 3, mode: 'STORY', seed: 4242, currentNight: 12, started: true, completed: true,
  history: { grades: ['A', 'B', 'A', 'C', 'B', 'A', 'B', 'A', 'C', 'B', 'A', 'A'],
    scores: [160, 120, 155, 80, 110, 170, 105, 150, 70, 115, 160, 158] },
  cooldown: { calmUntil: 0, standDownNight: 0 },
  stats: { arrests: 3, customersServed: 84, walkouts: 2, cashDiscrepancy: 0 },
  storyFlags: { endingId: 'ARREST' }, customerStates: {}, environmentFlags: {}, cases: [],
  ...over,
});

/* ============================================================
   1. PROFILE -- defaults, normalization, malformed safety.
   ============================================================ */
console.log('\n  -- profile shape --');
const defs = await ev(() => {
  const P = window.__profile;
  const p = P.freshProfile();
  return { v: p.version, completed: p.story.completed, comp: p.story.completions,
    endings: p.story.endingsSeen.length, walk: p.story.records.fewestWalkouts,
    otHigh: p.overtime.records.highestShift, unlocked: P.overtimeUnlocked(p) };
});
check('fresh profile: not completed, no records, overtime locked',
  defs.completed === false && defs.comp === 0 && defs.endings === 0 && defs.otHigh === 0 && defs.unlocked === false);
check('fresh profile: fewestWalkouts starts as null (no unbeatable zero)', defs.walk === null);

const norm = await ev(() => {
  const P = window.__profile;
  const junk = {
    version: 1,
    story: { completed: 'yes', completions: -4, endingsSeen: ['ARREST', 'ARREST', 'NONSENSE', 42],
      firstCompletedAt: 999, lastCompletedAt: 'when', records: { mostArrests: 'lots', fewestWalkouts: {} } },
    overtime: { records: { highestShift: -3, totalRuns: 2.7 }, bestRun: { highestShift: 0 } },
  };
  const p = P.normalizeProfile(junk);
  return {
    completions: p.story.completions,
    endings: p.story.endingsSeen,           // deduped + filtered to known
    firstDate: p.story.firstCompletedAt,    // 999 is not a string -> null
    lastDate: p.story.lastCompletedAt,      // 'when' kept as string (metadata only)
    mostArrests: p.story.records.mostArrests,
    fewestWalkouts: p.story.records.fewestWalkouts,
    highestShift: p.overtime.records.highestShift,
    totalRuns: p.overtime.records.totalRuns,
    bestRun: p.overtime.bestRun,            // highestShift 0 -> null
  };
});
check('malformed profile normalizes safely without crashing',
  norm.completions === 0 && JSON.stringify(norm.endings) === '["ARREST"]'
  && norm.firstDate === null && norm.mostArrests === null && norm.fewestWalkouts === null
  && norm.highestShift === 0 && norm.totalRuns === 2 && norm.bestRun === null,
  JSON.stringify(norm));

/* ============================================================
   2. STORY COMPLETION -- first, repeat, dates, ending merge, records.
   ============================================================ */
console.log('\n  -- story completion --');
const comp = await ev(() => {
  const P = window.__profile;
  const p = P.freshProfile();
  // First completion (arrest ending).
  const beaten1 = P.recordStoryCompletion(p, {
    history: { grades: ['A', 'B'], scores: [160, 120] },
    stats: { arrests: 3, customersServed: 84, walkouts: 2 },
    storyFlags: { endingId: 'ARREST' },
  }, { now: '2026-01-01T00:00:00.000Z' });
  const afterFirst = JSON.parse(JSON.stringify(p.story));
  // Second completion: survived ending, better on some records, worse on others.
  const beaten2 = P.recordStoryCompletion(p, {
    history: { grades: ['A', 'A'], scores: [170, 170] },
    stats: { arrests: 1, customersServed: 99, walkouts: 5 },
    storyFlags: { endingId: 'SURVIVED' },
  }, { now: '2026-02-02T00:00:00.000Z' });
  return {
    beaten1, beaten2,
    completions: p.story.completions,
    endings: p.story.endingsSeen,
    firstDate: p.story.firstCompletedAt,
    lastDate: p.story.lastCompletedAt,
    firstDateAfterFirst: afterFirst.firstCompletedAt,
    records: p.story.records,
    unlocked: P.overtimeUnlocked(p),
  };
});
check('first completion records completion, ending, dates',
  comp.completions === 2 && comp.firstDate === '2026-01-01T00:00:00.000Z', JSON.stringify({ c: comp.completions, f: comp.firstDate }));
check('both endings merge, uniquely', JSON.stringify(comp.endings) === '["ARREST","SURVIVED"]');
check('first-completion date is never overwritten; last-completion date advances',
  comp.firstDate === comp.firstDateAfterFirst && comp.lastDate === '2026-02-02T00:00:00.000Z');
check('records keep the BEST across completions (higher-better and lower-better)',
  comp.records.mostArrests === 3            // 3 beat 1
  && comp.records.mostCustomers === 99      // 99 beat 84
  && comp.records.fewestWalkouts === 2      // 2 beat 5 (lower better)
  && comp.records.bestScore === 340,        // 170+170 beat 160+120
  JSON.stringify(comp.records));
check('completing Story unlocks Overtime', comp.unlocked === true);

/* ============================================================
   3. LEGACY IMPORT -- a completed pre-profile save, on boot, once only.
   ============================================================ */
console.log('\n  -- legacy import --');
// Seed a completed campaign and NO profile, then reload so real boot runs.
await ev((c) => {
  try {
    localStorage.removeItem('finalrental.profile');
    localStorage.removeItem('finalrental.overtime');
    localStorage.setItem('finalrental.campaign', JSON.stringify(c));
  } catch (e) { /* fine */ }
}, completedCampaign());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await ev(() => { window.__game.sound.muted = true; });
const imported = await ev(() => {
  const g = window.__game, P = window.__profile;
  return { completed: g.profile.story.completed, comp: g.profile.story.completions,
    legacy: g.profile.story.legacyImported, endings: g.profile.story.endingsSeen.slice(),
    unlocked: P.overtimeUnlocked(g.profile),
    persisted: (JSON.parse(localStorage.getItem('finalrental.profile') || '{}').story || {}).completions };
});
check('boot imports a completed pre-profile campaign exactly once',
  imported.completed && imported.comp === 1 && imported.legacy === true && imported.persisted === 1,
  JSON.stringify(imported));
check('legacy import unlocks Overtime and remembers the ending',
  imported.unlocked && imported.endings.includes('ARREST'));
// Reload again: the count must NOT climb (idempotent).
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await ev(() => { window.__game.sound.muted = true; });
const reimport = await ev(() => window.__game.profile.story.completions);
check('re-booting does not duplicate the legacy completion', reimport === 1, `completions ${reimport}`);

/* ============================================================
   4. LOCKED / UNLOCKED menu, and mode availability.
   ============================================================ */
console.log('\n  -- menu gate --');
await clearAll();
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await ev(() => { window.__game.sound.muted = true; });
const locked = await ev(() => {
  const g = window.__game; g.refreshTitleMenu();
  const ot = g._titleMenu.find((m) => /OVERTIME/.test(m.label));
  const grave = g._titleMenu.find((m) => m.label === 'GRAVEYARD SHIFT');
  const casual = g._titleMenu.find((m) => m.label === 'CASUAL SHIFT');
  // Selecting it while locked must NOT start a run.
  ot.run();
  return { label: ot.label, locked: !!ot.locked, state: g.state, mode: g.mode,
    graveyard: !!grave, casual: !!casual,
    statusHidden: document.getElementById('title-status').hidden };
});
check('locked: Overtime row is present, marked locked, and says how to unlock',
  locked.locked && /COMPLETE STORY TO UNLOCK/.test(locked.label));
check('locked: selecting Overtime does not start it', locked.state === 'TITLE' && locked.mode !== 'OVERTIME');
check('locked: Graveyard and Casual are still available', locked.graveyard && locked.casual);
check('locked: no STORY CLEARED status line before completion', locked.statusHidden === true);

/* ============================================================
   5. UNLOCKED -- start a run, independent seed, active save, no Story state.
   ============================================================ */
console.log('\n  -- new overtime run --');
const run = await ev(() => {
  const g = window.__game, P = window.__profile, O = window.__overtime;
  // Unlock by recording a completion, then start a run.
  g.profile = P.freshProfile();
  P.recordStoryCompletion(g.profile, completedForTest(), { now: '2026-03-03T00:00:00.000Z' });
  P.saveProfile(g.profile);
  g.refreshTitleMenu();
  g.newOvertime();
  return {
    mode: g.mode, shift: g.nightNo, hasRun: !!g.otRun, seed: g.seed,
    saved: !!O.loadOvertimeRun(),
    campaignNull: g.campaign === null,
    investigationNull: g.investigation === null,
    envFlags: { flood: g.env.rearFloodlight, clip: g.env.arrestClipping, memo: g.env.scheduleMemo },
    storyCall: g.storyCall,
    nightMode: g.night.mode,
    runsCounted: g.profile.overtime.records.totalRuns,
  };
  function completedForTest() {
    return { history: { grades: ['A'], scores: [160] }, stats: { arrests: 2, customersServed: 50, walkouts: 1 }, storyFlags: { endingId: 'ARREST' } };
  }
});
check('new run: OVERTIME mode, shift 1, its own seed, active save written',
  run.mode === 'OVERTIME' && run.shift === 1 && run.hasRun && run.saved, JSON.stringify({ m: run.mode, s: run.shift }));
check('new run: no Story campaign, investigation, environment, or anonymous call inherited',
  run.campaignNull && run.investigationNull && !run.envFlags.flood && !run.envFlags.clip && !run.envFlags.memo && run.storyCall === null,
  JSON.stringify(run.envFlags));
check('new run: the night is generated in OVERTIME mode and the run is counted',
  run.nightMode === 'OVERTIME' && run.runsCounted === 1);

/* ============================================================
   6. CONTINUE -- clear a shift, bank it, quit mid-next, rebuild identically.
   ============================================================ */
console.log('\n  -- continue / determinism --');
const cont = await ev(() => {
  const g = window.__game, O = window.__overtime;
  const sig = () => JSON.stringify({
    j: g.night.suspect.jacket.id,
    sched: g.night.schedule.map((e) => Math.round(e.t)),
    keys: g.night.bulletin.keys.slice(),
    plan: [g.night.plan.appears, Math.round(g.night.plan.visitAt || 0)],
    deputy: g.night.deputy, busAt: g.night.busAt === Infinity ? -1 : Math.round(g.night.busAt),
  });
  // Clear shift 1 as a graded report.
  g.grade = { letter: 'A', score: 160 }; g.stats = { served: 10, stormedOut: 1 }; g.endKind = null;
  g.advanceNight();
  const afterShift = g.nightNo;
  const banked = { cleared: g.otRun.runStats.shiftsCleared, savedShift: O.loadOvertimeRun().shift,
    score: g.otRun.runStats.score, streak: g.otRun.runStats.gradeStreak };
  // Signature of shift 2, then quit + continue, and compare.
  const s2a = sig();
  g.continueOvertime();     // simulate quit-to-title then CONTINUE
  const s2b = sig();
  return { afterShift, banked, s2a, s2b, determ: s2a === s2b };
});
check('clearing a shift advances the player-facing shift and banks one cleared',
  cont.afterShift === 2 && cont.banked.cleared === 1 && cont.banked.savedShift === 2, JSON.stringify(cont.banked));
check('a cleared A-grade shift scores and starts a top-grade streak',
  cont.banked.score === 160 && cont.banked.streak === 1, JSON.stringify(cont.banked));
check('CONTINUE rebuilds the current shift byte-identically (deterministic)',
  cont.determ, cont.determ ? 'identical' : `${cont.s2a}\n${cont.s2b}`);

/* Quitting mid-shift keeps the run (the boundary save is untouched). */
const quitKeeps = await ev(() => {
  const g = window.__game, O = window.__overtime;
  const before = O.loadOvertimeRun().shift;
  g.quitToTitle();              // manual quit
  const stillThere = !!O.loadOvertimeRun();
  const sameShift = O.loadOvertimeRun().shift === before;
  return { stillThere, sameShift, otRunInMem: !!g.otRun };
});
check('manual quit mid-shift keeps the run for CONTINUE (not a failure)',
  quitKeeps.stillThere && quitKeeps.sameShift);

/* ============================================================
   7. FAILURE ends the run; records retained; Story save untouched.
   ============================================================ */
console.log('\n  -- failure ends the run --');
const fail = await ev(() => {
  const g = window.__game, O = window.__overtime, P = window.__profile;
  // Put a Story save on disk to prove Overtime failure never touches it.
  const storyBlob = JSON.stringify({ version: 3, mode: 'STORY', seed: 7, currentNight: 5, started: true, completed: false,
    history: { grades: [], scores: [] }, cooldown: { calmUntil: 0, standDownNight: 0 },
    stats: { arrests: 0, customersServed: 0, walkouts: 0, cashDiscrepancy: 0 }, storyFlags: {}, customerStates: {}, environmentFlags: {}, cases: [] });
  localStorage.setItem('finalrental.campaign', storyBlob);
  // Resume the run and get onto a shift.
  g.continueOvertime();
  const shiftAtDeath = g.nightNo;
  const highBefore = g.profile.overtime.records.highestShift;
  // Death.
  g.endKind = 'ATTACKED'; g.mode = 'OVERTIME';
  g.endOvertimeRun();
  const summaryShown = g.state === 'OTSUMMARY';
  const runGone = !O.loadOvertimeRun();
  const highAfter = g.profile.overtime.records.highestShift;
  const runsAfter = g.profile.overtime.records.totalRuns;
  const storyUntouched = localStorage.getItem('finalrental.campaign') === storyBlob;
  return { shiftAtDeath, highBefore, highAfter, summaryShown, runGone, runsAfter, storyUntouched,
    persistedHigh: (JSON.parse(localStorage.getItem('finalrental.profile')).overtime.records.highestShift) };
});
check('death ends the run: summary shown, active save removed', fail.summaryShown && fail.runGone);
check('records survive the run ending and are persisted',
  fail.highAfter >= 1 && fail.persistedHigh === fail.highAfter, JSON.stringify({ high: fail.highAfter, persisted: fail.persistedHigh }));
check('the Story save is completely untouched by an Overtime death', fail.storyUntouched === true);

/* A wrong call (FIRED) ends the run the same way. */
const fired = await ev(() => {
  const g = window.__game, O = window.__overtime;
  g.otRun = null; g.newOvertime();
  g.endKind = 'FIRED'; g.mode = 'OVERTIME';
  g.endOvertimeRun();
  return { state: g.state, runGone: !O.loadOvertimeRun() };
});
check('a wrong call (firing) also ends the Overtime run', fired.state === 'OTSUMMARY' && fired.runGone);

/* Story failure STILL retries Story (unchanged) -- a death in Story goes to
   title, and the campaign save (started, not completed) still offers Continue. */
const storyRetry = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  const night = g.nightNo;
  g.mode = 'STORY';
  g.endKind = 'ATTACKED';
  g.endTimer = 99;
  // The Story path: a death confirm goes to title, not an overtime summary.
  g.toTitle();
  return { hasSave: C.hasCampaignSave(), sameNight: (C.loadCampaign() || {}).currentNight === night, state: g.state };
});
check('Story death still retries Story (campaign save intact, Continue available)',
  storyRetry.hasSave && storyRetry.sameNight && storyRetry.state === 'TITLE');

/* ============================================================
   8. RECORD CALCULATIONS -- highest shift, streak, lifetime totals, ties.
   ============================================================ */
console.log('\n  -- record calculations --');
const rec = await ev(() => {
  const O = window.__overtime, P = window.__profile;
  const p = P.freshProfile();
  // Build a run that clears 3 shifts (A, B via report, arrest), then dies on 4.
  let run = O.freshOvertimeRun(111);
  P.recordOvertimeRunStarted(p);
  run = O.bankShift(run, { grade: 'A', score: 160, served: 10, walkouts: 0 }); P.recordOvertimeShiftCleared(p, run);
  run = O.bankShift(run, { grade: 'A', score: 150, served: 9, walkouts: 1 }); P.recordOvertimeShiftCleared(p, run);
  run = O.bankShift(run, { arrested: true, served: 8, walkouts: 0 }); P.recordOvertimeShiftCleared(p, run);   // arrest = A
  const midStreak = run.runStats.gradeStreak;
  run = O.bankShift(run, { grade: 'C', score: 60, served: 7, walkouts: 3 }); P.recordOvertimeShiftCleared(p, run); // breaks streak
  // Now on shift 5, dies. shiftsCleared = 4, reached = 5.
  const reached = run.shift;
  const cleared = run.runStats.shiftsCleared;
  P.recordOvertimeRunEnd(p, run);
  const R = p.overtime.records;
  return {
    reached, cleared, midStreak,
    highestShift: R.highestShift, bestStreak: R.bestGradeStreak, arrests: R.mostArrests,
    totalShifts: R.totalShifts, totalRuns: R.totalRuns, bestRunScore: R.bestRunScore,
    bestRunHigh: p.overtime.bestRun ? p.overtime.bestRun.highestShift : null,
  };
});
check('highest shift cleared counts CLEARED shifts, not the one you died on',
  rec.reached === 5 && rec.cleared === 4 && rec.highestShift === 4, JSON.stringify({ reached: rec.reached, cleared: rec.cleared, high: rec.highestShift }));
check('a top-grade streak counts A/arrest shifts and breaks on a lower grade',
  rec.midStreak === 3 && rec.bestStreak === 3, `mid ${rec.midStreak}, best ${rec.bestStreak}`);
check('lifetime totals accumulate (shifts cleared, runs, arrests, best score)',
  rec.totalShifts === 4 && rec.totalRuns === 1 && rec.arrests === 1 && rec.bestRunScore === 370, JSON.stringify(rec));
check('the best-run snapshot captures the run', rec.bestRunHigh === 4);

/* A weaker later run must NOT lower any record (ties/regressions). */
const noRegress = await ev(() => {
  const O = window.__overtime, P = window.__profile;
  const p = P.freshProfile();
  p.overtime.records = { highestShift: 4, bestRunScore: 370, mostArrests: 1, bestGradeStreak: 3, totalShifts: 4, totalRuns: 1 };
  p.overtime.bestRun = { highestShift: 4, score: 370, arrests: 1, averageGrade: 3.2, seed: 111, date: 'x' };
  let run = O.freshOvertimeRun(222);
  run = O.bankShift(run, { grade: 'D', score: 20, served: 3, walkouts: 6 });
  P.recordOvertimeRunEnd(p, run);
  const R = p.overtime.records;
  return { highestShift: R.highestShift, bestRunScore: R.bestRunScore, bestRunHigh: p.overtime.bestRun.highestShift };
});
check('a weaker later run never lowers a record or replaces a better best-run',
  noRegress.highestShift === 4 && noRegress.bestRunScore === 370 && noRegress.bestRunHigh === 4, JSON.stringify(noRegress));

/* ============================================================
   9. DIFFICULTY -- Overtime uses procedural mapping, never Story config.
   ============================================================ */
console.log('\n  -- difficulty isolation --');
const diff = await ev(() => {
  const O = window.__overtime, N = window.__night;
  // Overtime shift 7 must NOT be Story Night 7 (forced coach, COUPON regular).
  const effN = O.effectiveNight(7);
  let forcedCoach = 0, hasCoupon = 0, guaranteedRegular = 0;
  const SEEDS = 80;
  for (let i = 0; i < SEEDS; i++) {
    const nt = N.makeNight(O.shiftSeed(1234, 7), effN, N.MODE.OVERTIME, {});
    if (nt.busAt !== Infinity) forcedCoach++;
    if (nt.schedule.some((e) => e.special === 'COUPON')) hasCoupon++;
    if (nt.schedule.some((e) => e.special)) guaranteedRegular++;
    break; // one representative; coach/coupon are the point
  }
  // Sample coach rate across seeds to prove it is a probability, not forced.
  let coach = 0;
  for (let i = 0; i < 200; i++) {
    const nt = N.makeNight(O.shiftSeed(1000 + i, 7), effN, N.MODE.OVERTIME, {});
    if (nt.busAt !== Infinity) coach++;
  }
  return { effN, coachRate: coach / 200 };
});
check('Overtime shift 7 is NOT Story Night 7 (coach is a probability, never forced)',
  diff.coachRate > 0 && diff.coachRate < 0.5, `coach ${(diff.coachRate * 100).toFixed(0)}% at effN ${diff.effN}`);

/* ============================================================
   10. ACCESSIBILITY / audio settings are generation-neutral.
   ============================================================ */
console.log('\n  -- settings neutrality --');
const acc = await ev(() => {
  const g = window.__game, O = window.__overtime, N = window.__night;
  const sig = (shift) => {
    const nt = N.makeNight(O.shiftSeed(55, shift), O.effectiveNight(shift), N.MODE.OVERTIME, {});
    return JSON.stringify({ j: nt.suspect.jacket.id, sched: nt.schedule.map((e) => Math.round(e.t)), busAt: nt.busAt });
  };
  const base = [1, 3, 10].map(sig).join('|');
  g.opts.reduceFlicker = true; g.opts.reduceMotion = true; g.opts.textScale = 1.3;
  g.opts.vhsMode = 'reduced'; g.opts.invert = true; g.opts.sens = 0.9;
  g.opts.vol = 0.2; g.opts.volSfx = 0.1; g.applyOptions();
  const after = [1, 3, 10].map(sig).join('|');
  g.opts.reduceFlicker = false; g.opts.reduceMotion = false; g.opts.textScale = 1.0;
  g.opts.vhsMode = 'full'; g.opts.invert = false; g.opts.sens = 0.5; g.applyOptions();
  return { same: base === after };
});
check('no accessibility or audio setting changes the shifts Overtime generates', acc.same);

/* ============================================================
   11. GRAVEYARD / CASUAL isolation -- no Overtime records, unchanged failure.
   ============================================================ */
console.log('\n  -- graveyard / casual isolation --');
const graveyard = await ev(() => {
  const g = window.__game, P = window.__profile;
  P.saveProfile(g.profile);
  const before = JSON.stringify(g.profile.overtime);
  g.beginRun('HORROR');
  const modeH = g.mode;
  // A death in Graveyard goes to title and writes NO overtime record.
  g.endKind = 'ATTACKED'; g.endTimer = 99; g.toTitle();
  const afterH = JSON.stringify(g.profile.overtime);
  g.beginRun('CASUAL');
  const modeC = g.mode;
  g.endKind = 'ATTACKED'; g.endTimer = 99; g.toTitle();
  const afterC = JSON.stringify(g.profile.overtime);
  return { modeH, modeC, unchangedH: before === afterH, unchangedC: before === afterC, otRun: !!g.otRun };
});
check('Graveyard runs in HORROR mode and writes no Overtime record on death',
  graveyard.modeH === 'HORROR' && graveyard.unchangedH);
check('Casual runs in CASUAL mode and writes no Overtime record on death',
  graveyard.modeC === 'CASUAL' && graveyard.unchangedC);
check('neither Graveyard nor Casual ever creates an Overtime run', graveyard.otRun === false);

/* tidy up so a real player's machine is not left mid-run by the tests */
await clearAll();

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
if (errors.length) fails++;
console.log(fails ? `\novertime FAILED (${fails})` : '\novertime clean');
await browser.close();
process.exit(fails ? 1 : 0);
