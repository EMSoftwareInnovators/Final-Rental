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
  started.saved && started.onDisk && started.onDisk.currentNight === 1 && started.onDisk.version === 2,
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
    v1loads: !!loaded && loaded.currentNight === 3 && loaded.version === 2,
    v1blank: !!blank && blank.encounters === 0,
    v1keeps: !!loaded && loaded.history.grades[0] === 'A' && loaded.stats.customersServed === 5,
    v2badloads: !!loaded2 && typeof loaded2.customerStates === 'object'
      && Object.keys(loaded2.customerStates).length === 0,
  };
});
check('a Stage 1/2 save (v1, empty memory) loads and upgrades to v2',
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
