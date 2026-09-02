/* Story Mode: the campaign lifecycle, driven through the real game.
 *
 * The save system only means anything in a browser -- localStorage is where
 * it lives -- so this runs the actual Game object and asks it the questions
 * a player's session would: does NEW GAME start a campaign, does it persist,
 * does CONTINUE come back to the right night, does night twelve end the
 * story instead of starting night thirteen, and does none of it touch the
 * controller settings or the endless modes.
 *
 * It calls the lifecycle methods directly rather than playing twelve real
 * shifts -- advanceNight() is the seam every "night ended" path funnels
 * through, so exercising it is exercising the thing under test without
 * waiting out forty minutes of simulated counter work.
 */
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

/* A clean slate, and a note of the controller binding so we can prove later
   that campaign writes never touch it. */
await ev(() => {
  window.__campaign.deleteCampaignSave();
  localStorage.setItem('finalrental.padbinds', '{"probe":["kept"]}');
  window.__game.sound.muted = true;
});

/* ---------- 1. the menu, before there is anything to continue ---------- */
const menu0 = await ev(() => {
  window.__game.refreshTitleMenu();
  return window.__game._titleMenu.map((m) => m.label);
});
check('with no save, the menu leads with NEW GAME and has no CONTINUE',
  menu0[0] === 'NEW GAME' && !menu0.includes('CONTINUE'), menu0.join(' / '));
check('and the endless and casual modes are still on it',
  menu0.includes('GRAVEYARD SHIFT') && menu0.includes('CASUAL SHIFT'), menu0.join(' / '));

/* ---------- 2. NEW GAME starts and persists a campaign ---------- */
const started = await ev(() => {
  const g = window.__game;
  g.startStory();
  return {
    mode: g.mode, night: g.nightNo, hasCampaign: !!g.campaign,
    saved: window.__campaign.hasCampaignSave(),
    onDisk: JSON.parse(localStorage.getItem('finalrental.campaign')),
  };
});
check('NEW GAME begins a Story campaign on night 1',
  started.mode === 'STORY' && started.night === 1 && started.hasCampaign, JSON.stringify({ mode: started.mode, night: started.night }));
check('and it is on disk before the first night is even played',
  started.saved && started.onDisk && started.onDisk.currentNight === 1 && started.onDisk.version === 1,
  `currentNight ${started.onDisk && started.onDisk.currentNight}, version ${started.onDisk && started.onDisk.version}`);
check('the seed is fixed for the whole run',
  typeof started.onDisk.seed === 'number', String(started.onDisk && started.onDisk.seed));

/* ---------- 3. finishing a night advances and saves BEFORE the next ------ */
const advanced = await ev(() => {
  const g = window.__game;
  // Stand in for a graded shift: a report grade and some stats, the way
  // endNight() would leave them.
  g.grade = { letter: 'B', score: 1500 };
  g.stats = { served: 20, stormedOut: 3, cashLoose: 0 };
  g.advanceNight();
  const disk = JSON.parse(localStorage.getItem('finalrental.campaign'));
  return {
    liveNight: g.nightNo, diskNight: disk.currentNight,
    grades: disk.history.grades, served: disk.stats.customersServed,
    walkouts: disk.stats.walkouts,
  };
});
check('finishing night 1 advances to night 2 and writes it down',
  advanced.liveNight === 2 && advanced.diskNight === 2,
  `live ${advanced.liveNight}, disk ${advanced.diskNight}`);
check('the night just played is recorded in the campaign history',
  advanced.grades.length === 1 && advanced.grades[0] === 'B'
  && advanced.served === 20 && advanced.walkouts === 3,
  JSON.stringify(advanced));

/* ---------- 4. CONTINUE comes back, at the right night, same seed -------- */
const continued = await ev(() => {
  const g = window.__game;
  const seedBefore = g.seed;
  const suspectAtTwo = (() => { g.startNight(2); return g.night.caseFile.name; })();
  // Back to the title -- CONTINUE should now be there.
  g.toTitle();
  const menu = g._titleMenu.map((m) => m.label);
  const contItem = g._titleMenu.find((m) => m.label === 'CONTINUE');
  // And resume.
  g.continueStory();
  const suspectAgain = (() => { g.startNight(g.nightNo); return g.night.caseFile.name; })();
  return {
    menu, sub: contItem && contItem.sub,
    seedBefore, seedAfter: g.seed, night: g.nightNo,
    deterministic: suspectAtTwo === suspectAgain,
  };
});
check('once a night is done, CONTINUE appears on the title',
  continued.menu[0] === 'CONTINUE', continued.menu.join(' / '));
check('and it names the night it will resume',
  /night 2 of 12/.test(continued.sub || ''), continued.sub);
check('CONTINUE resumes at the start of the current night',
  continued.night === 2, `night ${continued.night}`);
check('the campaign seed survives the round-trip, so nights regenerate the same',
  continued.seedBefore === continued.seedAfter && continued.deterministic,
  `seed ${continued.seedBefore} -> ${continued.seedAfter}, same suspect: ${continued.deterministic}`);

/* ---------- 5. an arrest night carries no stale grade ---------- */
const arrestNight = await ev(() => {
  const g = window.__game;
  // startNight clears the grade; an arrest night never files a report, so
  // advanceNight must not push last night's grade for it.
  g.startNight(g.nightNo);          // clears g.grade
  g.stats = { served: 5, stormedOut: 0, cashLoose: 0 };
  const before = JSON.parse(localStorage.getItem('finalrental.campaign')).history.grades.length;
  g.advanceNight();
  const after = JSON.parse(localStorage.getItem('finalrental.campaign')).history.grades.length;
  return { before, after };
});
check('a night with no report adds stats but no phantom grade',
  arrestNight.after === arrestNight.before, `grades ${arrestNight.before} -> ${arrestNight.after}`);

/* ---------- 6. night twelve ends the campaign, not into thirteen -------- */
const finale = await ev(() => {
  const g = window.__game;
  // Jump to the last night and finish it.
  g.campaign.currentNight = 12; g.nightNo = 12;
  g.grade = { letter: 'C', score: 900 };
  g.stats = { served: 10, stormedOut: 1, cashLoose: 0 };
  g.advanceNight();
  const disk = JSON.parse(localStorage.getItem('finalrental.campaign'));
  return {
    state: g.state, completed: disk.completed,
    stillOffersContinue: window.__campaign.hasCampaignSave(),
  };
});
check('finishing the last night ends the story rather than starting night 13',
  finale.state === 'STORYDONE', finale.state);
check('the campaign is marked complete and saved',
  finale.completed === true, `completed ${finale.completed}`);
check('and a finished campaign no longer offers CONTINUE',
  finale.stillOffersContinue === false, `hasCampaignSave ${finale.stillOffersContinue}`);

const doneMenu = await ev(() => {
  const g = window.__game;
  g.toTitle();
  return g._titleMenu.map((m) => m.label);
});
check('the title after completion is back to NEW GAME with no CONTINUE',
  doneMenu[0] === 'NEW GAME' && !doneMenu.includes('CONTINUE'), doneMenu.join(' / '));

/* ---------- 7. NEW GAME over an in-progress campaign asks first --------- */
const overwrite = await ev(() => {
  const g = window.__game;
  window.__campaign.deleteCampaignSave();
  g.newStory();                 // a fresh in-progress campaign
  g.toTitle();
  g.refreshTitleMenu();
  // Selecting NEW GAME should now route through the confirm, not start.
  g.startStory();
  const confirming = g.state;
  // Say no (selection defaults to 0 = keep) by feeding the confirm a real
  // keypress through the input layer the handler reads.
  g.input.pressed.add('Enter');
  g.updateNewGameConfirm();
  g.input.pressed.delete('Enter');
  const keptState = g.state;
  const keptSave = window.__campaign.hasCampaignSave();
  return { confirming, keptState, keptSave };
});
check('NEW GAME with a campaign in progress opens a confirm, not a wipe',
  overwrite.confirming === 'NEWGAME', overwrite.confirming);
check('choosing to keep it returns to the title with the save intact',
  overwrite.keptState === 'TITLE' && overwrite.keptSave, JSON.stringify(overwrite));

/* ---------- 8. corrupt / alien saves fail safe ---------- */
const robustness = await ev(() => {
  const out = {};
  localStorage.setItem('finalrental.campaign', 'not json at all {');
  out.corrupt = window.__campaign.loadCampaign();
  out.corruptHas = window.__campaign.hasCampaignSave();
  localStorage.setItem('finalrental.campaign', JSON.stringify({ version: 999, currentNight: 3 }));
  out.futureVersion = window.__campaign.loadCampaign();
  localStorage.setItem('finalrental.campaign', JSON.stringify({ version: 1 }));  // no currentNight
  out.shapeless = window.__campaign.loadCampaign();
  return out;
});
check('a corrupt save reads as no save, not a crash',
  robustness.corrupt === null && robustness.corruptHas === false);
check('a save from a newer build is refused rather than half-read',
  robustness.futureVersion === null);
check('a save missing the fields gameplay relies on is refused',
  robustness.shapeless === null);

/* ---------- 9. serializable-only, and settings kept separate ------------ */
const hygiene = await ev(() => {
  const g = window.__game;
  window.__campaign.deleteCampaignSave();
  g.newStory();
  // Round-trip the live campaign: if anything runtime-only slipped in, it
  // would not come back the same.
  const round = JSON.parse(JSON.stringify(g.campaign));
  const keys = Object.keys(g.campaign).sort().join(',');
  const roundKeys = Object.keys(round).sort().join(',');
  // No functions or DOM anywhere in the tree.
  let clean = true;
  const walk = (o) => {
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'function' || (v && v.nodeType)) { clean = false; return; }
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(g.campaign);
  // Controller binding untouched by all of the above.
  const pad = localStorage.getItem('finalrental.padbinds');
  window.__campaign.deleteCampaignSave();
  const padAfterDelete = localStorage.getItem('finalrental.padbinds');
  return { same: keys === roundKeys, clean, pad, padAfterDelete };
});
check('the campaign state is pure serializable data',
  hygiene.same && hygiene.clean, `keys match ${hygiene.same}, no runtime objects ${hygiene.clean}`);
check('campaign save and delete never touch the controller settings',
  hygiene.pad === '{"probe":["kept"]}' && hygiene.padAfterDelete === '{"probe":["kept"]}',
  `pad ${hygiene.pad} -> ${hygiene.padAfterDelete}`);

/* ---------- 10. the endless modes stay stateless ---------- */
const endless = await ev(() => {
  const g = window.__game;
  window.__campaign.deleteCampaignSave();
  g.beginRun(window.__night.MODE.HORROR);
  const horrorCampaign = g.campaign;
  const wroteSave = window.__campaign.hasCampaignSave();
  g.advanceNight();               // in HORROR this is just the next night
  return { mode: g.mode, campaign: horrorCampaign, wroteSave, night: g.nightNo };
});
check('GRAVEYARD SHIFT carries no campaign and writes no save',
  endless.mode === 'HORROR' && endless.campaign === null && endless.wroteSave === false,
  JSON.stringify({ mode: endless.mode, campaign: endless.campaign, save: endless.wroteSave }));
check('and it still just rolls into the next night',
  endless.night === 2, `night ${endless.night}`);

/* ================================================================
   ACT I -- the authored pacing of Story Nights 1-4.

   These build the night the same way game.js does: nightConfig(n) turned
   into makeNight opts. Structural facts (deputy present, killer forced,
   coach forbidden, specials capped) are read straight off the generated
   night, which is what the game reads too.
   ================================================================ */
await ev(() => {
  const N = window.__night, C = window.__campaign;
  // Mirror game.js's opts construction exactly, minus any cooldown.
  window.__story = {
    night(seed, n, over = {}) {
      const cfg = C.nightConfig(n);
      return N.makeNight(seed, n, 'STORY', {
        calm: false, standDown: false,
        killerPolicy: cfg.killerPolicy,
        deputyPolicy: cfg.deputyPolicy,
        coachPolicy: cfg.coachPolicy,
        requiredSpecials: cfg.requiredSpecials,
        specialCap: cfg.specialCap,
        ...over,
      });
    },
    specials(nt) { return nt.schedule.filter((e) => e.special).map((e) => e.special); },
  };
});

/* Sample a night across many seeds and report what stayed constant and what
   varied. `over` lets a check force a cooldown flag on. */
const survey = (n, over = {}) => ev(([n, over]) => {
  const S = window.__story;
  let appears = 0, visitsT = 0, visitsF = 0, deputies = 0, coaches = 0;
  let overCap = 0, managerCounts = [], maxSpecials = 0, managerOnDecoy = 0;
  const cap = window.__campaign.nightConfig(n).specialCap;
  const SEEDS = 400;
  for (let i = 0; i < SEEDS; i++) {
    const nt = S.night(1000 + i, n, over);
    if (nt.plan.appears) appears++;
    if (nt.plan.appears) { if (nt.plan.visits) visitsT++; else visitsF++; }
    if (nt.deputy) deputies++;
    if (nt.busAt !== Infinity) coaches++;
    const sp = S.specials(nt);
    maxSpecials = Math.max(maxSpecials, sp.length);
    if (cap != null && sp.length > cap) overCap++;
    const mgr = sp.filter((id) => id === 'MANAGER').length;
    managerCounts.push(mgr);
    // MANAGER (when present) must never sit in a decoy slot.
    nt.schedule.forEach((e) => { if (e.special === 'MANAGER' && e.decoy) managerOnDecoy++; });
  }
  return {
    seeds: SEEDS, appears, visitsT, visitsF, deputies, coaches,
    overCap, maxSpecials, managerOnDecoy,
    managerAlways: managerCounts.every((c) => c === 1),
    managerNever: managerCounts.every((c) => c === 0),
    managerDupe: managerCounts.some((c) => c > 1),
  };
}, [n, over]);

/* ---------- Night 1: the normal job ---------- */
const N1 = await survey(1);
check('Night 1 never has the deputy', N1.deputies === 0, `${N1.deputies}/${N1.seeds}`);
check('Night 1 can never contain the killer', N1.appears === 0, `${N1.appears}/${N1.seeds}`);
check('Night 1 can never contain the coach', N1.coaches === 0, `${N1.coaches}/${N1.seeds}`);
/* "Injects none" means the config requires nobody -- a random pick may
   still happen to be MANAGER, which is fine; what matters is that no
   special is guaranteed. */
const n1required = await ev(() => window.__campaign.nightConfig(1).requiredSpecials.length);
check('Night 1 holds at most one special, and guarantees none',
  N1.maxSpecials <= 1 && N1.overCap === 0 && n1required === 0 && !N1.managerAlways,
  `most specials ${N1.maxSpecials}, over cap ${N1.overCap}, required ${n1required}`);

/* ---------- Night 2: something is off ---------- */
const N2 = await survey(2);
check('Night 2 never has the deputy', N2.deputies === 0, `${N2.deputies}/${N2.seeds}`);
check('Night 2 can never contain the killer', N2.appears === 0);
check('Night 2 can never contain the coach', N2.coaches === 0);
check('Night 2 has MANAGER every night, exactly once',
  N2.managerAlways && !N2.managerDupe, `dupe seen: ${N2.managerDupe}`);
check('Night 2 never exceeds two specials',
  N2.maxSpecials <= 2 && N2.overCap === 0, `most specials ${N2.maxSpecials}`);
check('Night 2 never puts MANAGER in a suspect decoy slot',
  N2.managerOnDecoy === 0, `${N2.managerOnDecoy} decoy collisions`);

/* And that the second special is still procedural: over the sample, some
   Night 2 runs are MANAGER alone and some are MANAGER-plus-one. */
const n2variety = await ev(() => {
  const S = window.__story;
  let alone = 0, plusOne = 0;
  for (let i = 0; i < 400; i++) {
    const c = S.specials(S.night(5000 + i, 2)).length;
    if (c === 1) alone++; else if (c === 2) plusOne++;
  }
  return { alone, plusOne };
});
check('Night 2 keeps procedural variation in the second special',
  n2variety.alone > 0 && n2variety.plusOne > 0,
  `MANAGER alone ${n2variety.alone}, MANAGER + 1 ${n2variety.plusOne}`);

/* ---------- Night 3: the warning ---------- */
const N3 = await survey(3);
check('Night 3 always has the deputy', N3.deputies === N3.seeds, `${N3.deputies}/${N3.seeds}`);
check('Night 3 still has no killer behind the warning', N3.appears === 0, `${N3.appears}/${N3.seeds}`);
check('Night 3 has no coach', N3.coaches === 0);
check('Night 3 respects the one-special cap', N3.maxSpecials <= 1 && N3.overCap === 0);
/* The decoys are the identification game -- they must still be generated. */
const n3decoys = await ev(() => {
  const S = window.__story;
  let min = 99;
  for (let i = 0; i < 50; i++) min = Math.min(min, S.night(9000 + i, 3).schedule.filter((e) => e.decoy).length);
  return min;
});
check('Night 3 still seeds suspect decoys for the notepad to work against',
  n3decoys >= 1, `fewest decoys in a run: ${n3decoys}`);

/* ---------- Night 4: the first real threat ---------- */
const N4 = await survey(4);
check('Night 4 always has the deputy', N4.deputies === N4.seeds);
check('Night 4 guarantees the killer appears, every seed',
  N4.appears === N4.seeds, `${N4.appears}/${N4.seeds}`);
check('Night 4 has no coach', N4.coaches === 0);
check('Night 4 respects the one-special cap', N4.maxSpecials <= 1 && N4.overCap === 0);
/* Forced forces the outcome only: he still sometimes skips the polite
   customer phase, so visits is a mix rather than pinned true. */
check('Night 4 keeps the killer\'s behavior procedural (visits still varies)',
  N4.visitsT > 0 && N4.visitsF > 0,
  `polite ${N4.visitsT}, straight-to-it ${N4.visitsF}`);

/* ---------- cooldown wins over a forced threat ---------- */
const cooled = await survey(4, { calm: true, standDown: true });
check('an arrest cooldown overrides Night 4\'s forced killer',
  cooled.appears === 0, `${cooled.appears}/${cooled.seeds} still appeared`);

/* ---------- determinism: a retry rebuilds the night exactly ---------- */
const deterministic = await ev(() => {
  const S = window.__story;
  const fingerprint = (nt) => JSON.stringify({
    suspect: nt.caseFile.name,
    appears: nt.plan.appears, visits: nt.plan.visits, visitAt: nt.plan.visitAt,
    deputy: nt.deputy, busAt: nt.busAt,
    schedule: nt.schedule.map((e) => [e.t, e.decoy, e.special || null, e.forced]),
  });
  const out = {};
  for (const n of [1, 2, 3, 4]) {
    const a = fingerprint(S.night(42, n));
    const b = fingerprint(S.night(42, n));
    out[n] = a === b;
  }
  return out;
});
check('the same seed rebuilds each Act I night identically (Continue is safe)',
  [1, 2, 3, 4].every((n) => deterministic[n]), JSON.stringify(deterministic));

/* ---------- mode isolation: none of this leaks ---------- */
const modes = await ev(() => {
  const N = window.__night;
  // Graveyard passes no policy: killer on night 4 is a probability, not a
  // guarantee, and specials are not capped at one.
  let gvAppears = 0, gvMaxSpecials = 0, gvCoach = 0;
  for (let i = 0; i < 400; i++) {
    const nt = N.makeNight(7000 + i, 4, 'HORROR', {});
    if (nt.plan.appears) gvAppears++;
    gvMaxSpecials = Math.max(gvMaxSpecials, nt.schedule.filter((e) => e.special).length);
    if (nt.busAt !== Infinity) gvCoach++;
  }
  // Casual is never a killer's night.
  let casAppears = 0;
  for (let i = 0; i < 200; i++) {
    if (N.makeNight(8000 + i, 6, 'CASUAL', {}).plan.appears) casAppears++;
  }
  return { gvAppears, gvMaxSpecials, gvCoach, casAppears };
});
check('Graveyard night 4 keeps the killer a probability, not a certainty',
  modes.gvAppears > 0 && modes.gvAppears < 400, `${modes.gvAppears}/400 appeared`);
check('Graveyard is not capped to one special or robbed of its coach',
  modes.gvMaxSpecials >= 2 && modes.gvCoach > 0, `most specials ${modes.gvMaxSpecials}, coaches ${modes.gvCoach}`);
check('Casual stays safe from the killer', modes.casAppears === 0, `${modes.casAppears}/200`);

/* tidy up so a real player's machine is not left mid-campaign by the tests */
await ev(() => {
  window.__campaign.deleteCampaignSave();
  localStorage.removeItem('finalrental.padbinds');
});

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
if (errors.length) fails++;
console.log(fails ? `\ncampaign FAILED (${fails})` : '\ncampaign clean');
await browser.close();
process.exit(fails ? 1 : 0);
