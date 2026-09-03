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
  started.saved && started.onDisk && started.onDisk.currentNight === 1 && started.onDisk.version === 3,
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

/* ================================================================
   STAGE 3 -- persistent customer memory.

   The store remembers its regulars. These check the memory API in isolation,
   the outcome-reader that interprets a finished encounter, the live commit
   through the real Game on despawn, that it survives a night boundary and
   rolls back a failed one, that Graveyard and Casual never touch it, and that
   an old save reads forward.
   ================================================================ */

/* ---------- the memory API, in isolation ---------- */
const api = await ev(() => {
  const C = window.__campaign;
  const cam = C.freshCampaign(1);
  const out = {};
  const blank = C.getCustomerState(cam, 'MANAGER');
  out.blank = blank.met === false && blank.encounters === 0 && blank.lastOutcome === null
    && blank.lastNight === 0 && blank.flags && typeof blank.flags === 'object';
  C.recordCustomerOutcome(cam, 'MANAGER', 'helped', { night: 2, flags: { gotManager: true } });
  const s1 = C.getCustomerState(cam, 'MANAGER');
  out.recorded = s1.met === true && s1.encounters === 1 && s1.lastOutcome === 'helped'
    && s1.lastNight === 2 && s1.flags.gotManager === true;
  C.recordCustomerOutcome(cam, 'MANAGER', 'dismissed', { night: 6 });
  const s2 = C.getCustomerState(cam, 'MANAGER');
  out.incremented = s2.encounters === 2 && s2.lastOutcome === 'dismissed' && s2.lastNight === 6
    && s2.flags.gotManager === true;           // earlier flags survive a later outcome
  C.setCustomerFlag(cam, 'POPCORN', 'seen', true);
  out.flag = C.getCustomerFlag(cam, 'POPCORN', 'seen') === true
    && C.getCustomerFlag(cam, 'POPCORN', 'missing', 'dflt') === 'dflt';
  out.metHelper = C.customerMet(cam, 'MANAGER') === true && C.customerMet(cam, 'AUDITOR') === false;
  return out;
});
check('an unseen regular reads back as a blank default', api.blank);
check('recording an outcome marks them met, counts it, and keeps the flags', api.recorded);
check('a later encounter increments the count and merges flags, not clobbers', api.incremented);
check('per-character flags set, read, and default correctly', api.flag);
check('customerMet reflects whether anyone has an encounter on record', api.metHelper);

/* ---------- malformed entries fail safe ---------- */
const safe = await ev(() => {
  const C = window.__campaign;
  const cam = C.freshCampaign(1);
  cam.customerStates.MANAGER = 'not an object';
  cam.customerStates.POPCORN = { encounters: -5, flags: 'nope', met: 'yes', lastNight: 'x' };
  const a = C.getCustomerState(cam, 'MANAGER');
  const b = C.getCustomerState(cam, 'POPCORN');
  return {
    a: a.encounters === 0 && a.met === false && typeof a.flags === 'object',
    b: b.encounters === 0 && b.met === false && b.lastNight === 0 && typeof b.flags === 'object',
  };
});
check('a mangled customer entry normalizes to a blank rather than crashing',
  safe.a && safe.b, JSON.stringify(safe));

/* ---------- the outcome reader maps runtime state to a broad label ---------- */
const outcomes = await ev(() => {
  const S = window.__specials;
  const r = (c) => { const o = S.readSpecialOutcome(c); return o && o.outcome; };
  return {
    mgrHelped: r({ special: 'MANAGER', gotManager: true }),
    mgrStormed: r({ special: 'MANAGER', stormedOut: true }),
    mgrDismissed: r({ special: 'MANAGER', wasDismissed: true, mood: 20 }),
    couponIndulged: r({ special: 'COUPON', gaveFreebie: true }),
    couponCompromised: r({ special: 'COUPON', checkedOut: true, mood: 70 }),
    couponRefused: r({ special: 'COUPON', stormedOut: true }),
    ricky: r({ special: 'POPCORN', mood: 60 }),
    rickyScolded: r({ special: 'POPCORN', threatened: true }),
    vernaLiked: r({ special: 'AUDITOR', resolvedAnger: true, mood: 80 }),
    vernaSnubbed: r({ special: 'AUDITOR', stormedOut: true }),
    untracked: S.readSpecialOutcome({ special: 'BOOMBOX' }),
    freebieFlag: S.readSpecialOutcome({ special: 'COUPON', gaveFreebie: true }).flags.gaveFreebie,
  };
});
check('Cheryl: got the phone -> helped, otherwise dismissed',
  outcomes.mgrHelped === 'helped' && outcomes.mgrStormed === 'dismissed' && outcomes.mgrDismissed === 'dismissed',
  JSON.stringify(outcomes));
check('Otis: freebie -> indulged, paid something -> compromised, walkout -> refused',
  outcomes.couponIndulged === 'indulged' && outcomes.couponCompromised === 'compromised'
  && outcomes.couponRefused === 'refused');
check('Ricky: laughed off -> indulged, threatened -> scolded',
  outcomes.ricky === 'indulged' && outcomes.rickyScolded === 'scolded');
check('Verna: kept sweet -> liked, snapped at -> snubbed',
  outcomes.vernaLiked === 'liked' && outcomes.vernaSnubbed === 'snubbed');
check('a customer nobody remembers yields no outcome, and flags come through',
  outcomes.untracked === null && outcomes.freebieFlag === true);

/* ---------- the live commit: a resolved special is remembered on despawn --- */
const commit = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory(); g.nightNo = 2;
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  const first = C.getCustomerState(g.campaign, 'MANAGER');
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100, _memoryCommitted: true });
  const second = C.getCustomerState(g.campaign, 'MANAGER');
  g.ctx.despawn({ special: 'COUPON' });   // never dealt with
  const otis = C.getCustomerState(g.campaign, 'COUPON');
  return {
    encounters: first.encounters, outcome: first.lastOutcome, night: first.lastNight,
    noDouble: second.encounters === 1, idleUnseen: otis.encounters === 0,
  };
});
check('a resolved special is remembered in the live campaign on despawn',
  commit.encounters === 1 && commit.outcome === 'helped' && commit.night === 2, JSON.stringify(commit));
check('the commit is once-per-customer, never double-counted', commit.noDouble);
check('a regular who drifts out without being dealt with is not remembered', commit.idleUnseen);

/* ---------- it survives a night boundary, and comes back on Continue ------- */
const survives = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory(); g.nightNo = 2;
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  g.grade = { letter: 'B', score: 1200 }; g.stats = { served: 3, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();                         // saves BEFORE night 3
  const disk = JSON.parse(localStorage.getItem('finalrental.campaign'));
  g.toTitle(); g.continueStory();           // reload from disk
  const reloaded = C.getCustomerState(g.campaign, 'MANAGER');
  return {
    onDisk: disk.customerStates && disk.customerStates.MANAGER && disk.customerStates.MANAGER.encounters,
    reloaded: reloaded.encounters, outcome: reloaded.lastOutcome,
  };
});
check('a remembered encounter is written to disk when the night advances',
  survives.onDisk === 1, `disk encounters ${survives.onDisk}`);
check('and it comes back through Continue', survives.reloaded === 1 && survives.outcome === 'helped');

/* ---------- retry rollback: a failed night forgets its encounters --------- */
const rollback = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  g.campaign.currentNight = 5; g.nightNo = 5; C.saveCampaign(g.campaign);   // clean night-5 boundary
  const before = C.getCustomerState(g.campaign, 'POPCORN').encounters;
  g.ctx.despawn({ special: 'POPCORN', talkedTo: true, mood: 60 });          // mid-shift, in memory only
  const midShift = C.getCustomerState(g.campaign, 'POPCORN').encounters;
  g.toTitle();                              // died / quit: drops the in-memory copy
  g.continueStory();                        // reloads the disk save (start of night 5)
  const afterRetry = C.getCustomerState(g.campaign, 'POPCORN').encounters;
  return { before, midShift, afterRetry, night: g.nightNo };
});
check('an encounter mutates the in-memory campaign during the shift',
  rollback.before === 0 && rollback.midShift === 1, JSON.stringify(rollback));
check('but a failed night rolls back on Continue -- the encounter is forgotten',
  rollback.afterRetry === 0 && rollback.night === 5, JSON.stringify(rollback));

/* ---------- mode isolation: memory is Story-only, both ways ---------- */
const iso = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  // Graveyard: no campaign, despawn is a memory no-op and must not crash; and
  // customerHistory reads blank even though we will put a real save on disk.
  g.beginRun(window.__night.MODE.HORROR);
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  const gvWroteSave = C.hasCampaignSave();
  const gvHistoryBlank = g.ctx.customerHistory('MANAGER').encounters === 0;
  // A real Story campaign with Cheryl remembered, saved to disk.
  C.deleteCampaignSave();
  g.newStory(); g.nightNo = 2;
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  g.grade = { letter: 'A', score: 1 }; g.stats = { served: 1, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();                         // Cheryl now on disk
  // Leave for a Casual shift and "serve" Cheryl again: must not touch the save.
  g.beginRun(window.__night.MODE.CASUAL);
  const casHistoryBlank = g.ctx.customerHistory('MANAGER').encounters === 0;
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  const disk = C.loadCampaign();
  return {
    gvWroteSave, gvHistoryBlank, casHistoryBlank,
    storyEncounters: disk.customerStates.MANAGER ? disk.customerStates.MANAGER.encounters : 0,
  };
});
check('a Graveyard encounter writes no campaign and no save',
  iso.gvWroteSave === false, JSON.stringify(iso));
check('Story memory never leaks into Graveyard or Casual dialogue',
  iso.gvHistoryBlank && iso.casHistoryBlank);
check('a Casual encounter leaves the Story campaign on disk untouched (still 1)',
  iso.storyEncounters === 1, `disk encounters ${iso.storyEncounters}`);

/* ---------- save compatibility: an old save reads forward ---------- */
const compat = await ev(() => {
  const C = window.__campaign;
  const v1 = {
    version: 1, mode: 'STORY', seed: 123, currentNight: 3, started: true, completed: false,
    history: { grades: ['A'], scores: [100] }, cooldown: { calmUntil: 0, standDownNight: 0 },
    stats: { arrests: 0, customersServed: 5, walkouts: 0, cashDiscrepancy: 0 },
    storyFlags: {}, customerStates: {}, environmentFlags: {},
  };
  localStorage.setItem('finalrental.campaign', JSON.stringify(v1));
  const loaded = C.loadCampaign();
  const blank = loaded && C.getCustomerState(loaded, 'MANAGER');
  const v2bad = { ...v1, version: 2, customerStates: 'not an object' };
  localStorage.setItem('finalrental.campaign', JSON.stringify(v2bad));
  const loaded2 = C.loadCampaign();
  return {
    v1loads: !!loaded && loaded.currentNight === 3 && loaded.version === 3,
    v1blank: !!blank && blank.encounters === 0,
    v1keeps: !!loaded && loaded.history.grades[0] === 'A' && loaded.stats.customersServed === 5,
    v2badloads: !!loaded2 && typeof loaded2.customerStates === 'object'
      && Object.keys(loaded2.customerStates).length === 0,
  };
});
check('a Stage 1/2 save (v1, empty memory) loads and upgrades forward',
  compat.v1loads && compat.v1blank && compat.v1keeps, JSON.stringify(compat));
check('a v2 save with a broken memory bag loads with a clean one', compat.v2badloads);

/* ---------- scheduling: Nights 5-8 guarantee the returning regulars ------- */
const sched = await ev(() => {
  const S = window.__story, C = window.__campaign;
  const scan = (n) => {
    const cfg = C.nightConfig(n);
    const req = cfg.requiredSpecials.slice().sort();
    let hasReq = 0, overCap = 0, maxSp = 0, deputies = 0, killers = 0;
    const SEEDS = 200;
    for (let i = 0; i < SEEDS; i++) {
      const nt = S.night(20000 + i, n);
      const sp = S.specials(nt);
      maxSp = Math.max(maxSp, sp.length);
      if (cfg.specialCap != null && sp.length > cfg.specialCap) overCap++;
      if (req.every((id) => sp.includes(id))) hasReq++;
      if (nt.deputy) deputies++;
      if (nt.plan.appears) killers++;
    }
    return { req, cap: cfg.specialCap, hasReq, overCap, maxSp, deputies, killers, seeds: SEEDS };
  };
  return { n5: scan(5), n6: scan(6), n7: scan(7), n8: scan(8) };
});
check('Night 5 guarantees Little Ricky every seed, capped at two',
  sched.n5.hasReq === 200 && sched.n5.overCap === 0 && sched.n5.req.join() === 'POPCORN' && sched.n5.cap === 2,
  JSON.stringify(sched.n5));
check('Night 6 guarantees Cheryl\'s return, capped at two',
  sched.n6.hasReq === 200 && sched.n6.overCap === 0 && sched.n6.req.join() === 'MANAGER' && sched.n6.cap === 2);
check('Night 7 guarantees Otis, capped at two',
  sched.n7.hasReq === 200 && sched.n7.overCap === 0 && sched.n7.req.join() === 'COUPON' && sched.n7.cap === 2);
check('Night 8 guarantees both returns together, capped at three',
  sched.n8.hasReq === 200 && sched.n8.overCap === 0
  && sched.n8.req.join() === 'COUPON,POPCORN' && sched.n8.cap === 3, JSON.stringify(sched.n8));
check('Nights 5-8 leave the killer procedural (neither forbidden nor forced)',
  sched.n5.killers > 0 && sched.n5.killers < 200 && sched.n6.killers > 0 && sched.n6.killers < 200,
  `n5 ${sched.n5.killers}/200, n6 ${sched.n6.killers}/200`);

/* ---------- determinism: memory cannot move the schedule ---------- */
const detMem = await ev(() => {
  const S = window.__story;
  const fp = (nt) => JSON.stringify(nt.schedule.map((e) => [e.t, e.decoy, e.special || null]));
  const out = {};
  for (const n of [5, 6, 7, 8]) out[n] = fp(S.night(77, n)) === fp(S.night(77, n));
  return out;
});
check('the same seed rebuilds each Night 5-8 schedule identically',
  [5, 6, 7, 8].every((n) => detMem[n]), JSON.stringify(detMem));

/* ---------- the point of all of it: memory changes what they SAY --------- */
/* Data in customerStates is not the deliverable; the player noticing is. This
   builds the real opening node of each regular's encounter, in Story, with a
   chosen history, and confirms the words on screen actually differ. */
const dlgText = await ev(() => {
  const g = window.__game, C = window.__campaign, D = window.__dlg;
  g.newStory();                            // STORY: live campaign, rng + ctx
  const openText = (special, outcome, night) => {
    if (g.campaign.customerStates) delete g.campaign.customerStates[special];
    if (outcome) C.recordCustomerOutcome(g.campaign, special, outcome, { night: night || 2 });
    const c = { special, name: special, mood: 100, hasMoney: true };
    const node = D.specialRoot(c, g.ctx);
    return (node && node.text) || '';
  };
  return {
    mgrFirst: openText('MANAGER', null),
    mgrHelped: openText('MANAGER', 'helped'),
    mgrDismissed: openText('MANAGER', 'dismissed'),
    otisFirst: openText('COUPON', null),
    otisIndulged: openText('COUPON', 'indulged'),
    otisRefused: openText('COUPON', 'refused'),
    rickyFirst: openText('POPCORN', null),
    rickyScolded: openText('POPCORN', 'scolded'),
    rickyIndulged: openText('POPCORN', 'indulged'),
    vernaFirst: openText('AUDITOR', null),
    vernaLiked: openText('AUDITOR', 'liked'),
  };
});
const filled = (s) => typeof s === 'string' && s.length > 0;
check('Cheryl greets a first-timer and a returning player differently',
  filled(dlgText.mgrFirst) && filled(dlgText.mgrHelped) && dlgText.mgrFirst !== dlgText.mgrHelped);
check('and a helped history reads differently from a dismissed one (both react)',
  dlgText.mgrHelped !== dlgText.mgrDismissed
  && dlgText.mgrHelped !== dlgText.mgrFirst && dlgText.mgrDismissed !== dlgText.mgrFirst);
check('Otis opens differently once he has a history, by which way it went',
  filled(dlgText.otisFirst) && dlgText.otisFirst !== dlgText.otisIndulged
  && dlgText.otisIndulged !== dlgText.otisRefused);
check('Ricky recognizes the player, warily or warmly by prior handling',
  filled(dlgText.rickyFirst) && dlgText.rickyFirst !== dlgText.rickyScolded
  && dlgText.rickyScolded !== dlgText.rickyIndulged);
check('Verna knows a returning regular',
  filled(dlgText.vernaFirst) && dlgText.vernaFirst !== dlgText.vernaLiked);

/* ================================================================
   STAGE 4 -- persistent environmental and store changes.

   The store remembers too. These check the environment API, the story
   consequence layer that turns campaign state into store facts, that the
   floodlight arrives at the right night (by state, not the calendar) and
   survives, that a failed night rolls it back, that there is only ever one of
   each piece, that Cheryl and Verna read the change, that Graveyard and Casual
   are untouched, that a new game resets, and that none of it moves the night.
   ================================================================ */

/* ---------- the environment API, in isolation ---------- */
const envApi = await ev(() => {
  const C = window.__campaign;
  C.deleteCampaignSave();
  const cam = C.freshCampaign(1);              // a detached campaign, never saved
  const out = {};
  out.missing = C.getEnvironmentFlag(cam, 'rearFloodlightInstalled') === false
    && C.environmentFlag(cam, 'nope') === false
    && C.getEnvironmentFlag(cam, 'x', 'dflt') === 'dflt';
  C.setEnvironmentFlag(cam, 'rearFloodlightInstalled', true);
  out.set = C.environmentFlag(cam, 'rearFloodlightInstalled') === true;
  out.onlyInMemory = JSON.stringify(cam.environmentFlags) === '{"rearFloodlightInstalled":true}'
    && localStorage.getItem('finalrental.campaign') === null;   // nothing written to disk
  // reads against a campaign with no bag (every non-Story run) are blank
  out.noBag = C.getEnvironmentFlag(null, 'rearFloodlightInstalled') === false
    && C.environmentFlag({}, 'rearFloodlightInstalled') === false;
  return out;
});
check('an unset environmental flag reads its default (false)', envApi.missing);
check('setting a flag changes only the in-memory campaign, not the disk', envApi.set && envApi.onlyInMemory);
check('a campaign with no environment bag reads every flag blank', envApi.noBag);

/* ---------- malformed environment state cannot crash load ---------- */
const envSafe = await ev(() => {
  const C = window.__campaign;
  const bad = {
    version: 2, mode: 'STORY', seed: 5, currentNight: 4, started: true, completed: false,
    history: { grades: [], scores: [] }, cooldown: { calmUntil: 0, standDownNight: 0 },
    stats: { arrests: 0, customersServed: 0, walkouts: 0, cashDiscrepancy: 0 },
    storyFlags: {}, customerStates: {},
    // objects, arrays, functions have no business here -- they must be dropped
    environmentFlags: { rearFloodlightInstalled: true, junk: { a: 1 }, arr: [1, 2], n: 3, s: 'ok' },
  };
  localStorage.setItem('finalrental.campaign', JSON.stringify(bad));
  const loaded = C.loadCampaign();
  const ef = loaded.environmentFlags;
  return {
    kept: ef.rearFloodlightInstalled === true && ef.n === 3 && ef.s === 'ok',
    dropped: !('junk' in ef) && !('arr' in ef),
    flagStillReads: C.environmentFlag(loaded, 'rearFloodlightInstalled') === true,
  };
});
check('a plain environmental fact survives load; an object/array is dropped',
  envSafe.kept && envSafe.dropped, JSON.stringify(envSafe));
check('and the surviving flag still reads true', envSafe.flagStillReads);

/* ---------- the story consequence layer: state -> store facts ---------- */
const cons = await ev(() => {
  const C = window.__campaign;
  const flags = (encM, encP) => {
    const cam = C.freshCampaign(1);
    if (encM) C.recordCustomerOutcome(cam, 'MANAGER', 'helped', { night: 2 });
    for (let i = 1; i < encM; i++) C.recordCustomerOutcome(cam, 'MANAGER', 'helped', { night: 6 });
    for (let i = 0; i < encP; i++) C.recordCustomerOutcome(cam, 'POPCORN', 'indulged', { night: 5 });
    C.applyStoryConsequences(cam);
    return cam.environmentFlags;
  };
  return {
    none: flags(0, 0),
    cherylOnce: flags(1, 0),
    cherylTwice: flags(2, 0),
    ricky: flags(0, 1),
  };
});
check('a fresh campaign has no environmental changes',
  Object.keys(cons.none).length === 0, JSON.stringify(cons.none));
check('one Cheryl complaint is not enough to get the light fixed',
  !cons.cherylOnce.rearFloodlightInstalled);
check('the second Cheryl complaint gets the landlord to act (state, not night)',
  cons.cherylTwice.rearFloodlightInstalled === true);
check('dealing with Ricky once posts the notice and leaves the stain',
  cons.ricky.popcornNoticePosted === true && cons.ricky.popcornStainLeft === true);

/* ---------- floodlight progression through the real game ---------- */
const prog = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  const out = {};
  // Night 1: nothing installed.
  g.startNight(1);
  out.n1 = g.env.rearFloodlight;
  // Cheryl on Night 2 (encounter 1). Finish the night: the complaint alone
  // must NOT install the light.
  g.nightNo = 2; g.startNight(2);
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  g.grade = { letter: 'B', score: 1 }; g.stats = { served: 1, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();                          // -> night 3, saved
  out.afterN2 = C.environmentFlag(g.campaign, 'rearFloodlightInstalled');
  // Jump to her Night 6 return. DURING night 6 the light is still absent.
  g.campaign.currentNight = 6; g.nightNo = 6; C.saveCampaign(g.campaign);
  g.startNight(6);
  out.duringN6 = g.env.rearFloodlight;
  // Deal with Cheryl again (encounter 2) and finish the night.
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  g.grade = { letter: 'B', score: 1 }; g.stats = { served: 1, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();                          // -> night 7, consequence applied + saved
  out.installedOnDisk = JSON.parse(localStorage.getItem('finalrental.campaign'))
    .environmentFlags.rearFloodlightInstalled === true;
  out.n7env = g.env.rearFloodlight;          // night 7 is now live
  out.n7hasMesh = !!g.world.floodMesh;
  // later nights keep it
  g.startNight(8);
  out.n8env = g.env.rearFloodlight;
  return out;
});
check('a new Story night 1 has no floodlight', prog.n1 === false);
check('Cheryl\'s first complaint (Night 2) does not install it', prog.afterN2 === false);
check('and her Night 6 return still walks into a dark lot', prog.duringN6 === false);
check('finishing Night 6 installs the light for Night 7 (on disk and live)',
  prog.installedOnDisk === true && prog.n7env === true && prog.n7hasMesh, JSON.stringify(prog));
check('and later nights keep it lit', prog.n8env === true);

/* ---------- retry rollback: a failed night un-installs nothing it earned,
   but a night that never finished never earns it ---------- */
const envRollback = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  // A clean Night 6 boundary with Cheryl met once (from Night 2), light absent.
  C.recordCustomerOutcome(g.campaign, 'MANAGER', 'helped', { night: 2 });
  g.campaign.currentNight = 6; g.nightNo = 6; C.saveCampaign(g.campaign);
  const before = C.environmentFlag(g.campaign, 'rearFloodlightInstalled');
  // During Night 6 deal with Cheryl (encounter 2) -- but the flag is only set
  // at the advance, so mid-shift it is still absent.
  g.startNight(6);
  g.ctx.despawn({ special: 'MANAGER', talkedTo: true, gotManager: true, mood: 100 });
  const midShift = C.environmentFlag(g.campaign, 'rearFloodlightInstalled');
  // Die before finishing: toTitle drops the in-memory campaign.
  g.toTitle();
  g.continueStory();                         // reload the Night 6 save
  g.startNight(g.campaign.currentNight);
  const afterRetry = g.env.rearFloodlight;
  return { before, midShift, afterRetry, night: g.nightNo };
});
check('mid-shift, a consequence has not been committed yet',
  envRollback.before === false && envRollback.midShift === false);
check('and a failed Night 6 rebuilds a dark lot -- the light was never earned',
  envRollback.afterRetry === false && envRollback.night === 6, JSON.stringify(envRollback));

/* ---------- idempotency: one of each piece, however many starts ---------- */
const idem = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  C.setEnvironmentFlag(g.campaign, 'rearFloodlightInstalled', true);
  C.setEnvironmentFlag(g.campaign, 'popcornNoticePosted', true);
  C.setEnvironmentFlag(g.campaign, 'popcornStainLeft', true);
  const flood = g.world.floodMesh, notice = g.world.noticeMesh, stain = g.world.stainMesh;
  g.startNight(7);
  g.startNight(8);
  g.startNight(8);                           // a retry of the same night
  // The meshes are prebuilt once: the references never change, and applying
  // the environment builds nothing, so there is exactly one of each.
  return {
    sameFlood: g.world.floodMesh === flood,
    sameNotice: g.world.noticeMesh === notice,
    sameStain: g.world.stainMesh === stain,
    allOn: g.env.rearFloodlight && g.env.popcornNotice && g.env.popcornStain,
  };
});
check('starting and retrying nights never duplicates an environmental piece',
  idem.sameFlood && idem.sameNotice && idem.sameStain, JSON.stringify(idem));
check('and all applied pieces are switched on', idem.allOn);

/* ---------- Cheryl and Verna read the environment ---------- */
const envDlg = await ev(() => {
  const g = window.__game, C = window.__campaign, D = window.__dlg;
  g.newStory();
  const line = (special, outcome, lit) => {
    g.campaign.customerStates = {};
    g.campaign.environmentFlags = {};
    C.recordCustomerOutcome(g.campaign, special, outcome, { night: 2 });
    if (lit) C.setEnvironmentFlag(g.campaign, 'rearFloodlightInstalled', true);
    // Verna's aside is a coin-flip; try a few builds so a "lit" line is found.
    let best = '';
    for (let i = 0; i < 6; i++) {
      const c = { special, name: special, mood: 100, hasMoney: true };
      const t = (D.specialRoot(c, g.ctx) || {}).text || '';
      best = t;
      if (special === 'AUDITOR' && /light|lit|lot/i.test(t)) break;
    }
    return best;
  };
  return {
    cherylDark: line('MANAGER', 'helped', false),
    cherylLit: line('MANAGER', 'helped', true),
    cherylDismDark: line('MANAGER', 'dismissed', false),
    cherylDismLit: line('MANAGER', 'dismissed', true),
    vernaDark: line('AUDITOR', 'liked', false),
    vernaLit: line('AUDITOR', 'liked', true),
  };
});
check('Cheryl says the lot is still dark before the light, and not after',
  /dark|still out/i.test(envDlg.cherylDark) && !/still (dark|out)/i.test(envDlg.cherylLit)
  && envDlg.cherylDark !== envDlg.cherylLit, JSON.stringify({ d: envDlg.cherylDark.slice(0, 40), l: envDlg.cherylLit.slice(0, 40) }));
check('the pre/post distinction holds for a dismissed history too',
  envDlg.cherylDismDark !== envDlg.cherylDismLit
  && /light in the lot|light in the/i.test(envDlg.cherylDismLit));
check('Verna does not claim the lot is dark once it is lit',
  envDlg.vernaDark !== envDlg.vernaLit, JSON.stringify({ d: envDlg.vernaDark.slice(0, 40), l: envDlg.vernaLit.slice(0, 40) }));

/* ---------- mode isolation: Graveyard and Casual get the original store ---- */
const envIso = await ev(() => {
  const g = window.__game, C = window.__campaign, N = window.__night;
  C.deleteCampaignSave();
  // A real Story campaign with the light installed, saved to disk.
  g.newStory();
  C.setEnvironmentFlag(g.campaign, 'rearFloodlightInstalled', true);
  C.setEnvironmentFlag(g.campaign, 'popcornNoticePosted', true);
  C.saveCampaign(g.campaign);
  // Graveyard: original store, no flags read, and no way to write them.
  g.beginRun(N.MODE.HORROR);
  g.startNight(7);
  const gv = { flood: g.env.rearFloodlight, notice: g.env.popcornNotice,
    flagRead: g.ctx.environmentFlag('rearFloodlightInstalled') };
  // advancing a Graveyard night must not run the consequence layer or touch
  // the story save on disk.
  g.advanceNight();
  const diskAfterGv = C.loadCampaign();
  // Casual: same.
  g.beginRun(N.MODE.CASUAL);
  g.startNight(3);
  const cas = { flood: g.env.rearFloodlight, flagRead: g.ctx.environmentFlag('rearFloodlightInstalled') };
  return {
    gvOriginal: !gv.flood && !gv.notice && gv.flagRead === false,
    casOriginal: !cas.flood && cas.flagRead === false,
    storyIntact: diskAfterGv && diskAfterGv.environmentFlags.rearFloodlightInstalled === true,
  };
});
check('Graveyard builds the original store and reads no Story environment',
  envIso.gvOriginal, JSON.stringify(envIso));
check('Casual builds the original store and reads no Story environment', envIso.casOriginal);
check('and neither can touch the Story campaign\'s environment on disk', envIso.storyIntact);

/* ---------- a new game resets the store ---------- */
const envReset = await ev(() => {
  const g = window.__game, C = window.__campaign;
  // Leave a progressed save with everything installed.
  const done = C.freshCampaign(9);
  C.setEnvironmentFlag(done, 'rearFloodlightInstalled', true);
  C.setEnvironmentFlag(done, 'popcornNoticePosted', true);
  C.setEnvironmentFlag(done, 'popcornStainLeft', true);
  done.currentNight = 8;
  C.saveCampaign(done);
  // New Game over it: fresh campaign, original store on Night 1.
  g.newStory();
  g.startNight(1);
  return {
    flags: g.campaign.environmentFlags,
    env: g.env,
  };
});
check('New Game starts from the original store -- no installed changes',
  Object.keys(envReset.flags).length === 0
  && !envReset.env.rearFloodlight && !envReset.env.popcornNotice && !envReset.env.popcornStain,
  JSON.stringify(envReset));

/* ---------- determinism: environment flags do not move the night ---------- */
const envDet = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory();
  const fingerprint = () => JSON.stringify({
    suspect: g.night.caseFile.name,
    appears: g.night.plan.appears, visitAt: g.night.plan.visitAt,
    deputy: g.night.deputy, busAt: g.night.busAt,
    schedule: g.night.schedule.map((e) => [e.t, e.decoy, e.special || null]),
  });
  g.campaign.environmentFlags = {};
  g.startNight(7);
  const dark = fingerprint();
  C.setEnvironmentFlag(g.campaign, 'rearFloodlightInstalled', true);
  C.setEnvironmentFlag(g.campaign, 'popcornNoticePosted', true);
  g.startNight(7);
  const lit = fingerprint();
  return { same: dark === lit };
});
check('installing environmental changes does not alter the night for the same seed',
  envDet.same);

/* ================================================================
   STAGE 5 -- the investigation begins.

   The first half of the mystery: the player catches someone, the town
   relaxes, a clipping goes up, and then a real second threat walks in while
   that clipping still says SUSPECT HELD. These check the story-flag/case API,
   the arrest record, the conditional second-threat night, the deputy's
   evolving briefing, the newspaper prop, the repeated-tape clue, save
   migration, mode isolation, and that none of it moves the shift or leaks.
   ================================================================ */

/* ---------- story flags + case history in isolation ---------- */
const invApi = await ev(() => {
  const C = window.__campaign;
  const cam = C.freshCampaign(1);
  const out = {};
  out.flagDefault = C.getStoryFlag(cam, 'firstArrestMade') === false
    && C.storyFlag(cam, 'nope') === false
    && C.getStoryFlag(cam, 'x', 'd') === 'd';
  C.setStoryFlag(cam, 'firstArrestMade', true);
  out.flagSet = C.storyFlag(cam, 'firstArrestMade') === true;
  // fresh has no cases and no arrests
  out.freshCases = Array.isArray(cam.cases) && cam.cases.length === 0;
  const inv0 = C.investigationState(cam);
  out.inv0 = inv0.priorArrests === 0 && inv0.caughtSomeone === false && inv0.lastCase === null
    && inv0.signatureTape === C.INVESTIGATION_TAPE;
  // record two arrests on different nights; a repeat of a night is ignored
  C.recordCase(cam, { night: 4, result: 'arrested', name: 'A', profile: { height: 'tall' }, signatureTape: C.INVESTIGATION_TAPE });
  C.recordCase(cam, { night: 4, result: 'arrested', name: 'A-again' });   // same night -> ignored
  cam.stats.arrests = 1;
  const inv1 = C.investigationState(cam);
  out.oneCase = cam.cases.length === 1 && inv1.caughtSomeone === true && inv1.priorArrests === 1
    && inv1.lastCase && inv1.lastCase.name === 'A';
  return out;
});
check('a story flag defaults false, sets, and reads back', invApi.flagDefault && invApi.flagSet);
check('a fresh campaign has an empty case file and no arrests', invApi.freshCases && invApi.inv0);
check('recording an arrest adds one row and de-duplicates by night', invApi.oneCase);

/* ---------- malformed story/case data normalizes ---------- */
const invSafe = await ev(() => {
  const C = window.__campaign;
  const base = C.freshCampaign(5);
  base.currentNight = 8; base.stats.arrests = 1;
  const bad = {
    ...base, version: 3,
    storyFlags: { firstArrestMade: true, junk: { a: 1 }, arr: [1] },
    cases: [{ night: 4, name: 'ok', profile: { height: 'tall', junk: {} } }, 'not a row', 42, { night: 'x' }],
  };
  localStorage.setItem('finalrental.campaign', JSON.stringify(bad));
  const loaded = C.loadCampaign();
  return {
    flagsClean: loaded.storyFlags.firstArrestMade === true && !('junk' in loaded.storyFlags) && !('arr' in loaded.storyFlags),
    casesClean: Array.isArray(loaded.cases) && loaded.cases.length === 4
      && loaded.cases[0].name === 'ok' && loaded.cases[0].night === 4
      && loaded.cases[3].night === 0,   // {night:'x'} coerced
    stillReads: C.storyFlag(loaded, 'firstArrestMade') === true,
  };
});
check('a mangled story-flag bag loads clean (objects/arrays dropped)', invSafe.flagsClean, JSON.stringify(invSafe));
check('a mangled case list normalizes row by row rather than crashing', invSafe.casesClean);
check('and the surviving flag still reads', invSafe.stillReads);

/* ---------- save v2 -> v3 loads forward ---------- */
const v2compat = await ev(() => {
  const C = window.__campaign;
  const v2 = {
    version: 2, mode: 'STORY', seed: 7, currentNight: 5, started: true, completed: false,
    history: { grades: ['B'], scores: [1] }, cooldown: { calmUntil: 0, standDownNight: 0 },
    stats: { arrests: 1, customersServed: 3, walkouts: 0, cashDiscrepancy: 0 },
    storyFlags: {}, customerStates: {}, environmentFlags: {},   // no `cases` at all
  };
  localStorage.setItem('finalrental.campaign', JSON.stringify(v2));
  const loaded = C.loadCampaign();
  return {
    loads: !!loaded && loaded.version === 3 && loaded.currentNight === 5,
    cases: Array.isArray(loaded.cases) && loaded.cases.length === 0,
    arrestsKept: loaded.stats.arrests === 1,
  };
});
check('a Stage 4 (v2) save loads and upgrades to v3 with an empty case file',
  v2compat.loads && v2compat.cases && v2compat.arrestsKept, JSON.stringify(v2compat));

/* ---------- consequences: arrest -> flag + clipping; second case ---------- */
const invCons = await ev(() => {
  const C = window.__campaign;
  const flags = (arrests, completed) => {
    const cam = C.freshCampaign(1);
    cam.stats.arrests = arrests;
    C.applyStoryConsequences(cam, completed);
    return { story: cam.storyFlags, env: cam.environmentFlags };
  };
  return { none: flags(0, 5), after: flags(1, 5), escalated: flags(1, 8) };
});
check('no arrest means no clipping and no investigation flags',
  Object.keys(invCons.none.story).length === 0 && !invCons.none.env.arrestClippingPosted,
  JSON.stringify(invCons.none));
check('a banked arrest posts the clipping and marks the first arrest',
  invCons.after.story.firstArrestMade === true && invCons.after.env.arrestClippingPosted === true);
check('working the escalation night with an arrest opens the second case',
  invCons.escalated.story.secondCaseOpened === true);

/* ---------- the second-threat night: conditional, and a full plan --------- */
const secondThreat = await ev(() => {
  const C = window.__campaign, N = window.__night;
  const buildN8 = (seed, arrests, calmBase) => {
    const cam = C.freshCampaign(1); cam.stats.arrests = arrests;
    const cfg = C.nightConfig(8), inv = C.investigationPolicy(cam, 8);
    return N.makeNight(seed, 8, 'STORY', {
      calm: inv.calmOverride != null ? inv.calmOverride : calmBase,
      standDown: false,
      killerPolicy: inv.killerPolicy || cfg.killerPolicy,
      deputyPolicy: cfg.deputyPolicy, coachPolicy: cfg.coachPolicy,
      requiredSpecials: cfg.requiredSpecials, specialCap: cfg.specialCap,
    });
  };
  let withArrest = 0, without = 0, visitsT = 0, visitsF = 0, stub = 0, fullPlan = 0;
  for (let i = 0; i < 300; i++) {
    // cooldown WOULD keep tonight quiet -- the second-threat override breaks it.
    const a = buildN8(1000 + i, 1, true);
    if (a.plan.appears) withArrest++;
    if (a.plan.appears) { if (a.plan.visits) visitsT++; else visitsF++; }
    // a forced killer must be a real plan, never the {appears,at,asCustomer} stub
    if (typeof a.plan.prowlFor === 'number' && typeof a.plan.visitAt === 'number') fullPlan++;
    else stub++;
    // no arrest, no cooldown -> an ordinary probability
    const b = buildN8(2000 + i, 0, false);
    if (b.plan.appears) without++;
  }
  return { withArrest, without, visitsT, visitsF, stub, fullPlan, seeds: 300 };
});
check('Night 8 forces the killer for every seed once an arrest is on record, overriding the quiet',
  secondThreat.withArrest === 300, `${secondThreat.withArrest}/300`);
check('and it is a full killer plan, never an appears-stub',
  secondThreat.fullPlan === 300 && secondThreat.stub === 0, JSON.stringify({ full: secondThreat.fullPlan, stub: secondThreat.stub }));
check('the forced killer\'s staging stays procedural (visits still varies)',
  secondThreat.visitsT > 0 && secondThreat.visitsF > 0, `polite ${secondThreat.visitsT}, straight ${secondThreat.visitsF}`);
check('with no arrest on record, Night 8 is an ordinary probability, not forced',
  secondThreat.without > 0 && secondThreat.without < 300, `${secondThreat.without}/300`);

/* ---------- the arrest is recorded through the real game, and rolls back --- */
const arrestFlow = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory(); g.nightNo = 4; g.startNight(4);
  // stand in for a caught killer: the ending's CAUGHT branch records the case.
  g.rng = g.night.rng;
  g.ending('CAUGHT', {});
  const midCase = g.campaign.cases.length;
  const midArrests = g.run.arrests;
  const cool = { calm: g.run.calmUntil, stand: g.run.standDownNight };
  // Bank the night: sync + save happen in advanceNight.
  g.grade = { letter: 'A', score: 1 }; g.stats = { served: 1, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();
  const onDisk = JSON.parse(localStorage.getItem('finalrental.campaign'));
  return {
    midCase, midArrests,
    cooldownSet: cool.calm > 4 && cool.stand === 5,
    diskCases: onDisk.cases.length, diskArrests: onDisk.stats.arrests,
    clip: onDisk.environmentFlags.arrestClippingPosted === true,
    tape: onDisk.cases[0] && onDisk.cases[0].signatureTape,
  };
});
check('a Story arrest records a case and bumps the arrest count in memory',
  arrestFlow.midCase === 1 && arrestFlow.midArrests === 1);
check('and the existing arrest cooldown is untouched (quiet nights + stand-down)',
  arrestFlow.cooldownSet, JSON.stringify(arrestFlow));
check('finishing the night banks the case and posts the clipping to disk',
  arrestFlow.diskCases === 1 && arrestFlow.diskArrests === 1 && arrestFlow.clip
  && arrestFlow.tape === 'THE LAST CUSTOMER', JSON.stringify(arrestFlow));

const arrestRollback = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory(); g.nightNo = 4; g.startNight(4);
  C.saveCampaign(g.campaign);              // a clean Night 4 boundary, no arrest
  g.rng = g.night.rng;
  g.ending('CAUGHT', {});                   // arrest in memory only
  const midCase = g.campaign.cases.length;
  g.toTitle();                              // died/quit before banking
  g.continueStory();
  return { midCase, afterRetry: g.campaign.cases.length, arrests: g.campaign.stats.arrests };
});
check('an arrest not banked rolls back on Continue -- no case, no arrest',
  arrestRollback.midCase === 1 && arrestRollback.afterRetry === 0 && arrestRollback.arrests === 0,
  JSON.stringify(arrestRollback));

/* ---------- the newspaper clipping ---------- */
const clipping = await ev(() => {
  const g = window.__game, C = window.__campaign;
  C.deleteCampaignSave();
  g.newStory(); g.startNight(1);
  const before = g.env.arrestClipping;
  // arrest on Night 4, banked.
  g.nightNo = 4; g.startNight(4); g.rng = g.night.rng; g.ending('CAUGHT', {});
  g.grade = { letter: 'A', score: 1 }; g.stats = { served: 1, stormedOut: 0, cashLoose: 0 };
  g.advanceNight();                         // -> night 5, clipping posted
  const n5 = g.env.arrestClipping;
  const mesh = g.world.clippingMesh;
  g.startNight(6); g.startNight(6);         // later + a retry: no duplication
  const n6 = g.env.arrestClipping;
  return { before, n5, n6, sameMesh: g.world.clippingMesh === mesh, hasMesh: !!mesh };
});
check('the clipping is absent before any arrest', clipping.before === false);
check('it appears the night after the arrest is banked, and persists',
  clipping.n5 === true && clipping.n6 === true, JSON.stringify(clipping));
check('and it is a single prebuilt mesh, never duplicated', clipping.sameMesh && clipping.hasMesh);

/* ---------- the deputy's briefing evolves with the investigation ---------- */
const deputyDlg = await ev(() => {
  const g = window.__game, C = window.__campaign, D = window.__dlg;
  // Collect the reachable briefing text, following every reply a few levels
  // deep. fn()s mutate harmless closure/ctx state; errors are ignored.
  const allText = (root) => {
    const out = [];
    const walk = (node, depth) => {
      if (!node || depth > 10 || out.length > 80) return;
      if (node.text) out.push(node.text);
      for (const c of (node.choices || [])) {
        let next = null; try { next = c.fn ? c.fn() : null; } catch (e) { /* ignore */ }
        walk(next, depth + 1);
      }
    };
    walk(root, 0);
    return out.join('\n');
  };
  const brief = () => allText(D.buildOfficerIntro({ name: 'Deputy' }, g.night.bulletin, g.night.caseFile, g.ctx));

  // No arrest yet: a Story Night 8 must not reference an arrest at all.
  C.deleteCampaignSave(); g.newStory(); g.nightNo = 8; g.startNight(8);
  const noArrest = brief();

  // With an arrest on record: Night 8 is the second-threat briefing.
  g.campaign.stats.arrests = 1;
  C.recordCase(g.campaign, { night: 4, result: 'arrested', name: 'Earl', profile: { height: 'tall' }, signatureTape: C.INVESTIGATION_TAPE });
  g.startNight(8);
  const secondCase = brief();
  return {
    noArrestClean: !/copycat|we took a man|caught a man|Elkhart/i.test(noArrest),
    secondMentionsArrest: /Elkhart|we took a man|caught A man/i.test(secondCase),
    secondCopycat: /copycat/i.test(secondCase),
    secondTape: secondCase.includes('THE LAST CUSTOMER'),
    secondContradiction: /never in the paper|never gave it out|didn't read it/i.test(secondCase),
  };
});
check('with no arrest on record the deputy never references one', deputyDlg.noArrestClean);
check('after an arrest, the second-threat briefing acknowledges it', deputyDlg.secondMentionsArrest);
check('it offers the copycat theory as the first comfortable answer', deputyDlg.secondCopycat);
check('it surfaces the repeated tape and the "not in the paper" contradiction',
  deputyDlg.secondTape && deputyDlg.secondContradiction, JSON.stringify(deputyDlg));

/* ---------- the repeated clue is a STORY clue, not a gameplay one ---------- */
const clueSeparation = await ev(() => {
  const C = window.__campaign, N = window.__night;
  // Across many Night 8 shifts, the signature tape must never appear on the
  // gameplay bulletin (the description the player matches customers against).
  let inBulletin = 0;
  for (let i = 0; i < 200; i++) {
    const nt = N.makeNight(3000 + i, 8, 'STORY', { killerPolicy: 'forced', calm: false });
    if ((nt.bulletin.description || '').includes(C.INVESTIGATION_TAPE)) inBulletin++;
    if ((nt.caseFile.name || '').includes(C.INVESTIGATION_TAPE)) inBulletin++;
  }
  return { inBulletin, tape: C.INVESTIGATION_TAPE };
});
check('the repeated tape never leaks into the gameplay bulletin', clueSeparation.inBulletin === 0);

/* ---------- determinism: the investigation moves nothing for a fixed state - */
const invDet = await ev(() => {
  const C = window.__campaign, N = window.__night;
  const fp = () => {
    const cam = C.freshCampaign(9); cam.stats.arrests = 1;
    const inv = C.investigationPolicy(cam, 8), cfg = C.nightConfig(8);
    const nt = N.makeNight(42, 8, 'STORY', {
      calm: inv.calmOverride != null ? inv.calmOverride : false, standDown: false,
      killerPolicy: inv.killerPolicy || cfg.killerPolicy,
      requiredSpecials: cfg.requiredSpecials, specialCap: cfg.specialCap,
    });
    return JSON.stringify({
      suspect: nt.caseFile.name, appears: nt.plan.appears, visitAt: nt.plan.visitAt,
      schedule: nt.schedule.map((e) => [e.t, e.decoy, e.special || null]),
    });
  };
  return { same: fp() === fp() };
});
check('the same seed + same investigation state rebuilds Night 8 identically', invDet.same);

/* ---------- mode isolation ---------- */
const invIso = await ev(() => {
  const g = window.__game, C = window.__campaign, N = window.__night;
  C.deleteCampaignSave();
  // Graveyard: no investigation object, and the deputy keeps night-based logic.
  g.beginRun(N.MODE.HORROR); g.startNight(8);
  const gvInv = g.investigation;                       // should be null
  const gvCtx = g.ctx.investigation();                 // should be null
  // A CAUGHT arrest in Graveyard writes no campaign case (there is no campaign).
  g.rng = g.night.rng; g.ending('CAUGHT', {});
  const gvNoCampaign = g.campaign === null;
  // Casual: safe, no investigation.
  g.beginRun(N.MODE.CASUAL); g.startNight(3);
  const casInv = g.investigation;
  return { gvInvNull: gvInv === null, gvCtxNull: gvCtx === null, gvNoCampaign, casInvNull: casInv === null };
});
check('Graveyard runs with no investigation state and keeps its night-based deputy',
  invIso.gvInvNull && invIso.gvCtxNull, JSON.stringify(invIso));
check('a Graveyard arrest writes no Story case (there is no campaign)', invIso.gvNoCampaign);
check('Casual carries no investigation state', invIso.casInvNull);

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
