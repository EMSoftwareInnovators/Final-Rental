/* ============================================================
   night.js -- the shift director. Rolls the suspect, writes the
   deputy's bulletin, seeds decoys who match most of it but never
   all of it, schedules arrivals, and turns real seconds into the
   clock above the door.
   ============================================================ */
import { makeRng } from '../engine/mathx.js';
import {
  randomAppearance, randomName, pronounOf, ALL_KEYS, VISIBLE_KEYS,
  traitBulletin, sameTrait, HATS, GLASSES, HEIGHTS, BUILDS, MARKS, GAITS, CARRY, GENDERS,
} from './appearance.js';
import { planKiller, KILLER_FIRST_NIGHT, killerChance } from './killer.js';
import { GENRES } from './tapes.js';
import { planSpecials } from './specials.js';
import {
  MORE_DETAIL, PRIOR_ARREST, DIFFERENT_MAN, HOW_MANY, WHY_MORE_HELPS,
  CERTAIN_YES, CERTAIN_NO, GREETINGS, ALL_CLEAR, ALL_CLEAR_WHY, pick as pickFor, voice,
} from './briefing.js';

export { KILLER_FIRST_NIGHT, killerChance };

export const SHIFT_START_HOUR = 21;   // 9:00 PM
export const SHIFT_HOURS = 3;         // to midnight

/* HORROR is the endless graveyard shift. STORY is the finite campaign --
   it generates nights exactly like HORROR (it is not CASUAL, so the deputy
   and the killer are both in play), and everything that makes it a campaign
   rather than an endless run lives in campaign.js, not here. CASUAL is the
   same store with nobody coming for you. */
export const MODE = { HORROR: 'HORROR', STORY: 'STORY', CASUAL: 'CASUAL' };

/* The deputy turns up the night before the threat can. He is the reason
   there is never a night where someone could walk in and you would have
   nothing to hold them against -- and he stays away entirely while the odds
   of anyone coming for you are still flat zero. */
export const DEPUTY_FIRST_NIGHT = KILLER_FIRST_NIGHT - 1;

export function nightLength(n) { return Math.min(470, 300 + (n - 1) * 22); }

/** Does a deputy come tonight? Never while the killer's odds are still zero. */
export function deputyComes(n, mode) {
  if (mode === MODE.CASUAL) return false;
  return n >= DEPUTY_FIRST_NIGHT;
}

/* Which traits the deputy actually got out of the witness. */
/**
 * How much of the description the deputy has tonight.
 *
 * It grows. The county takes somebody off the street most nights, and each
 * one talks, so the picture gets fuller: three things to check on the first
 * night with a bulletin, ten by the end of a long run.
 *
 * That is harder, not easier. A short list is quick to clear somebody
 * against. A long one means every ordinary customer now matches four or
 * five of it, and the question stops being "does he match" and becomes
 * "does he match ALL of it" -- which takes time you do not have with three
 * people in line.
 */
function bulletinKeyCount(n) {
  return Math.min(10, 3 + Math.floor((n - DEPUTY_FIRST_NIGHT) / 1.15));
}
/** Extra traits he will give up if you ask. Also grows. */
function extraKeyCount(n) { return Math.min(4, 1 + Math.floor((n - DEPUTY_FIRST_NIGHT) / 2.5)); }
function decoyCount(n) { return Math.min(4, 1 + Math.floor(n / 2)); }
function decoyOverlap(n, keyCount) { return Math.min(keyCount - 1, 1 + Math.floor(n / 2)); }

/* Traits that make good bulletin material -- things a witness would notice. */
const PRIORITY = ['jacket', 'height', 'build', 'hair', 'mark', 'hat', 'facial', 'glasses', 'gait', 'carry', 'pants', 'smell', 'voice'];

/**
 * One night.
 *
 * `opts` carries what the RUN knows and a single night does not: whether an
 * arrest has bought a few quiet nights, and whether tonight is the one the
 * deputy comes by to say so.
 */
export function makeNight(seed, n, mode = MODE.HORROR, opts = {}) {
  const rng = makeRng(seed ^ (n * 0x9e3779b1));
  const length = nightLength(n);
  /* A stand-down visit is still a visit. A calm night with no visit due has
     nobody from the county in it at all -- and, importantly, the deputy does
     not come back the following night either, because there is nothing for
     him to say. */
  /* The deputy. Cooldown wins first -- a stand-down night must announce the
     all-clear, a calm night has nobody from the county in it -- then Story
     policy (forced/forbidden), then the ordinary night-based rule. Graveyard
     and Casual pass no policy, so they fall straight through to that rule. */
  let deputy;
  if (opts.standDown) deputy = true;
  else if (opts.calm) deputy = false;
  else if (opts.deputyPolicy === 'forbidden') deputy = false;
  else if (opts.deputyPolicy === 'forced') deputy = true;
  else deputy = deputyComes(n, mode);

  /* ---- the suspect ---- */
  const suspect = randomAppearance(rng);
  // guarantee at least one strong tell on the early nights
  if (n <= 2 && suspect.mark.id === 'none' && rng.chance(0.7)) {
    suspect.mark = MARKS[1 + rng.int(MARKS.length - 1)];
  }

  const nKeys = bulletinKeyCount(n);
  const pool = PRIORITY.slice();
  // jacket is nearly always in a witness statement; keep the rest weighted but random
  // Sex and outerwear are what a witness leads with, every time.
  const keys = ['gender', 'jacket'];
  const rest = rng.shuffle(pool.filter((k) => k !== 'jacket' && k !== 'gender'));
  // bias toward the visible ones early, let hidden ones creep in later
  rest.sort((a, b) => {
    const av = VISIBLE_KEYS.includes(a) ? 0 : 1, bv = VISIBLE_KEYS.includes(b) ? 0 : 1;
    return (av - bv) * (n <= 2 ? 1 : 0);
  });
  for (const k of rest) { if (keys.length >= nKeys) break; keys.push(k); }

  const extras = [];
  const extraPool = rng.shuffle(ALL_KEYS.filter((k) => !keys.includes(k)));
  for (let i = 0; i < extraKeyCount(n) && i < extraPool.length; i++) {
    const k = extraPool[i];
    extras.push({ key: k, officerLine: officerExtraLine(k, suspect, rng) });
  }

  /* A stand-down night is a calm night by definition: he is not going to
     walk in and tell you it is over while somebody is working the block.

     Story `killerPolicy` steers the rest -- but cooldown wins over it, so an
     arrest's quiet nights are never overridden by an ordinary threat config.
     FORCED guarantees only the outcome: planKiller still rolls how he shows
     (customer first or not, when, whether he stalks), and that is left
     untouched. Graveyard/Casual pass no policy and fall through to the roll. */
  const quiet = opts.calm || opts.standDown;
  const killerPolicy = opts.killerPolicy || 'normal';
  const forbidKiller = quiet || killerPolicy === 'forbidden';
  let plan;
  if (forbidKiller) {
    plan = { appears: false, at: Infinity, asCustomer: false };
  } else {
    plan = planKiller(rng, n, length, mode);
    if (killerPolicy === 'forced') plan.appears = true;
  }
  const caseFile = makeCaseFile(rng, n, suspect, { standDown: !!opts.standDown });

  /* The deputy is not the first person through the door any more. He comes
     when he comes, somewhere in the first third of the shift, and there may
     well be two people at the counter when he does. */
  const deputyAt = deputy ? rng.range(22, Math.min(150, length * 0.26)) : Infinity;

  const bulletin = {
    app: suspect,
    keys,
    extra: extras,
    /* Empty until somebody actually tells you. The notepad used to open on
       night one already listing a jacket and a limp that no one had said a
       word about -- and in casual mode, where nobody ever will, it listed
       them anyway. */
    known: new Set(),
    certain: plan.appears || rng.chance(0.5),
    description: composeBulletin(suspect, keys, rng, n),
  };

  /* ---- customers ---- */
  const count = Math.min(13, 5 + n);
  const decoys = decoyCount(n);
  const overlap = decoyOverlap(n, keys.length);
  const schedule = [];
  /* People come in right up to closing. The rota used to stop at 84% of
     the night, so the last stretch of every shift was an empty store. */
  const windowEnd = length * 0.97;
  for (let i = 0; i < count; i++) {
    const base = (i / count) * windowEnd;
    const t = Math.max(14, base + rng.range(-9, 14) - n * 0.6);
    const isDecoy = i < decoys;
    schedule.push({
      t,
      decoy: isDecoy,
      forced: isDecoy ? sampleKeys(rng, keys, overlap) : null,
      intent: rng.chance(0.5) ? 'RETURN' : 'RENT',
      genre: rng.pick(GENRES),
      spawned: false,
    });
  }
  schedule.sort((a, b) => a.t - b.t);

  /* The people who are not here to rent anything.
     They take an ordinary customer's slot rather than adding to the rota,
     so a night with four of them is a night with four fewer normal ones --
     which is exactly what makes it feel like a bad night. Decoy slots are
     left alone: they are load-bearing for the identification game. */
  const specials = planSpecials(rng, n, count, {
    requiredSpecials: opts.requiredSpecials,
    specialCap: opts.specialCap,
  });
  // Read the flag, not the index: the rota was sorted by arrival time above,
  // so the decoys are no longer the first few entries. `open` is therefore in
  // arrival-time order.
  const open = [];
  schedule.forEach((e, i) => { if (!e.decoy) open.push(i); });
  // Shuffle a COPY, so the same RNG is drawn as before but `open` stays in
  // arrival-time order for the position map below (rng.shuffle mutates).
  const shuffledOpen = rng.shuffle(open.slice());
  const reqN = specials.requiredCount || 0;
  let slots;
  if (reqN >= 2) {
    /* Two or more GUARANTEED specials in one night (an authored Story climax
       like Night 8's Ricky + Otis). Left to a plain shuffle they land in the
       same minute about one night in seven, which -- on a night that also has
       a deputy briefing and a killer -- reads as a pile-up. So walk the
       shuffled slots (for per-seed variety, no extra RNG) and only accept one
       that is at least `minSep` arrival-slots away from the ones already
       taken; `open` is time-ordered, so slot distance is arrival-time
       distance. If the constraint cannot be met, the remaining picks fall back
       to whatever slots are left. Only ever runs for a night that guarantees
       2+ specials -- every other mode and night falls through to the slice. */
    const pos = new Map(open.map((s, i) => [s, i]));
    const minSep = Math.max(1, Math.floor(open.length / (reqN + 1)));
    slots = [];
    const used = new Set();
    for (const s of shuffledOpen) {
      if (slots.length >= specials.picks.length) break;
      if (slots.every((c) => Math.abs(pos.get(c) - pos.get(s)) >= minSep)) { slots.push(s); used.add(s); }
    }
    for (const s of shuffledOpen) {                // fill any shortfall
      if (slots.length >= specials.picks.length) break;
      if (!used.has(s)) { slots.push(s); used.add(s); }
    }
  } else {
    slots = shuffledOpen.slice(0, specials.picks.length);
  }
  slots.forEach((slot, i) => { schedule[slot].special = specials.picks[i]; });

  /* The bus. Once in a while a coach pulls in off the highway and two dozen
     people who all look the same come through the door at once. Story
     `coachPolicy` can forbid it outright (Act I keeps its establishing
     nights clear) or force it; NORMAL, and every other mode, keeps the
     ordinary roll -- which already never fires before night 3. */
  const coachPolicy = opts.coachPolicy || 'normal';
  let busAt;
  if (coachPolicy === 'forbidden') busAt = Infinity;
  else if (coachPolicy === 'forced') busAt = rng.range(length * 0.22, length * 0.58);
  else busAt = busNight(rng, n) ? rng.range(length * 0.22, length * 0.58) : Infinity;

  return {
    n, seed, rng, mode, length, bulletin, suspect, plan, schedule, caseFile,
    deputy, deputyAt, swarm: specials.swarm,
    busAt,
    calm: quiet, standDown: !!opts.standDown,
    officerApp: makeOfficerApp(rng),
    officerName: `Deputy ${randomName(rng).split(' ')[1]}`,
    overlap,
  };
}

/* ============================================================
   THE CASE FILE
   A different person every night, which the deputy has to account for,
   because a player who is paying attention will notice that the man
   they helped arrest on Tuesday is not the man outside on Wednesday.
   ============================================================ */

/* How the county is explaining it to itself this week. */
const ANGLES = [
  {
    id: 'copycat',
    lead: `The one we took Tuesday is in a cell in Elkhart and he is not going anywhere. This is somebody else.`,
    prior: `We charged a man last night. He confessed to two of them and he could not tell us a thing about the third.`,
    why: `Somebody's reading the same papers you are and liking what they read.`,
    press: 'copycat',
  },
  {
    id: 'release',
    lead: `Marion let forty-one men out in August on a paperwork ruling. We have been picking them back up one at a time ever since.`,
    prior: `Last night's is back inside. That is one of forty-one.`,
    why: `Half of them came straight back to the county they were sentenced in. This is a county with a lot of late-night counters in it.`,
    press: 'the Marion list',
  },
  {
    id: 'ring',
    lead: `We do not think this is one man. We have never thought it was one man.`,
    prior: `The one you helped us with is talking, and what he is saying is that he was not working alone.`,
    why: `Different height, different jacket, same hour of the night, same kind of store. Draw your own conclusions.`,
    press: 'the crew',
  },
  {
    id: 'road',
    lead: `Everything about this says somebody passing through. Different face each time, same road.`,
    prior: `The one from last night gave a Missouri address that turned out to be a laundromat.`,
    why: `They come off the interstate, they find a place still lit, and they are two states away by breakfast.`,
    press: 'the interstate thing',
  },
  {
    id: 'inside',
    lead: `I am going to say something the sheriff would not want me saying. We think somebody local is pointing them at the stores.`,
    prior: `We arrested a man last night who had never been to this town before and knew exactly which door was unlocked.`,
    why: `Somebody is doing the picking. Whoever comes through your door tonight is the one holding the address.`,
    press: 'the list',
  },
  {
    id: 'imitator',
    lead: `The first four were one man and he is dead. Since then it has been whoever wants the name.`,
    prior: `We closed the original file in September. Everything since has been somebody borrowing it.`,
    why: `That is worse, not better. The original had a pattern. These do not.`,
    press: 'the name',
  },
];

const PRESS_NAMES = [
  'the Delaney Prowler', 'the Late Show', 'the Graveyard Man',
  'the Nine-to-Midnight', 'the Counter Killer', 'the Closing Hour',
];

export function makeCaseFile(rng, n, suspect, opts = {}) {
  const angle = ANGLES[(n - 1) % ANGLES.length];
  /* Every line the deputy says about the person he is looking for goes
     through the pronoun expander on the way out, so a night whose suspect
     is a woman gets a deputy who says she. */
  const line = (list, salt) => voice(pickFor(list, n, salt), suspect);
  /* Drawn by night rather than by roll, so a given night always reads the
     same however many times you play it -- and so consecutive nights never
     hand you the same account of the same arrest twice running. */
  return {
    name: randomName(rng, suspect.gender),
    alias: rng.pick(PRESS_NAMES),
    angle,
    // Nights one and two of the manhunt have no yesterday to account for.
    first: n <= KILLER_FIRST_NIGHT,
    caughtLast: n > KILLER_FIRST_NIGHT,
    /** Tonight's reason the description got longer. */
    moreDetail: line(MORE_DETAIL, 1),
    /** What happened to the one from last night, and why it does not help. */
    priorArrest: line(PRIOR_ARREST, 2),
    differentMan: line(DIFFERENT_MAN, 3),
    whyMoreHelps: line(WHY_MORE_HELPS, 4),
    howMany: line(HOW_MANY, 5),
    greeting: line(GREETINGS, 6),
    certainYes: line(CERTAIN_YES, 7),
    certainNo: line(CERTAIN_NO, 8),
    /** The night he comes to say it is over. */
    allClear: line(ALL_CLEAR, 9),
    allClearWhy: line(ALL_CLEAR_WHY, 10),
    /** How many things are on tonight's list, for his own commentary on it. */
    detailCount: bulletinKeyCount(n),
    grew: n > DEPUTY_FIRST_NIGHT,
    standDown: !!opts.standDown,
  };
}

/* How often the coach turns up. Rare enough to be an event, common enough
   that a long run will see a few. */
function busNight(rng, n) { return n >= 3 && rng.chance(0.13); }

function sampleKeys(rng, keys, k) { return rng.sample(keys, Math.max(1, Math.min(k, keys.length - 1))); }

/**
 * A decoy shares `forced` traits with the suspect but is guaranteed to
 * differ on at least one bulletin trait, so the description is always
 * enough to clear them -- if you actually check all of it.
 */
export function makeDecoyAppearance(rng, suspect, keys, forced) {
  for (let attempt = 0; attempt < 40; attempt++) {
    // decoys always share the suspect's sex -- otherwise the very first line
    // of the bulletin clears them and they are not decoys at all
    const a = randomAppearance(rng, { gender: suspect.gender });
    for (const k of forced) a[k] = suspect[k];
    const differs = keys.some((k) => !sameTrait(a, suspect, k));
    if (differs) return a;
  }
  const a = randomAppearance(rng);
  for (const k of forced) a[k] = suspect[k];
  const k0 = keys.find((k) => !forced.includes(k)) || keys[0];
  a[k0] = pickDifferent(rng, suspect, k0);
  return a;
}

function pickDifferent(rng, suspect, key) {
  const TABLES = { hat: HATS, glasses: GLASSES, height: HEIGHTS, build: BUILDS, mark: MARKS, gait: GAITS, carry: CARRY, gender: GENDERS };
  const tbl = TABLES[key];
  if (tbl) {
    const opts = tbl.filter((t) => t.id !== suspect[key].id);
    return opts[rng.int(opts.length)];
  }
  let a;
  do { a = randomAppearance(rng); } while (sameTrait(a, suspect, key));
  return a[key];
}

/** A person who is NOT a decoy still shouldn't accidentally be a perfect match. */
export function sanitizeInnocent(rng, app, suspect, keys) {
  const matchesAll = keys.every((k) => sameTrait(app, suspect, k));
  if (!matchesAll) return app;
  const k = keys[rng.int(keys.length)];
  app[k] = pickDifferent(rng, suspect, k);
  return app;
}

/* ---------------- the deputy's speech ---------------- */
function composeBulletin(a, keys, rng, n) {
  const has = (k) => keys.includes(k);
  const P = pronounOf(a);
  const S = [];

  const physical = [];
  if (has('gender')) physical.push(traitBulletin(a, 'gender'));
  if (has('height')) physical.push(traitBulletin(a, 'height'));
  if (has('build')) physical.push(traitBulletin(a, 'build'));
  if (physical.length) S.push(`Suspect is ${physical.join(', ')}.`);

  const head = [];
  if (has('hair')) head.push(traitBulletin(a, 'hair'));
  if (has('facial')) head.push(traitBulletin(a, 'facial'));
  if (has('glasses') && a.glasses.id !== 'none') head.push(traitBulletin(a, 'glasses'));
  if (has('hat') && a.hat.id !== 'none') head.push(traitBulletin(a, 'hat'));
  if (head.length) S.push(`${cap(head.join('. '))}.`);
  else if (has('hat') && a.hat.id === 'none') S.push(`No hat, nothing on the head.`);

  const worn = [];
  if (has('jacket')) worn.push(traitBulletin(a, 'jacket'));
  if (has('pants')) worn.push(traitBulletin(a, 'pants'));
  if (worn.length) S.push(`Wearing ${worn.join(' and ')}.`);

  if (has('mark')) {
    S.push(a.mark.id === 'none'
      ? `Nothing distinctive on the face. That's the trouble.`
      : `And this is the one that matters: ${traitBulletin(a, 'mark')}.`);
  }
  if (has('carry') && a.carry.id !== 'none') S.push(`Carrying ${traitBulletin(a, 'carry')}.`);
  if (has('gait')) S.push(`Witness says ${P.subj} ${traitBulletin(a, 'gait')}.`);
  if (has('voice')) S.push(`Voice is ${traitBulletin(a, 'voice')}.`);
  if (has('smell') && a.smell.id !== 'none') S.push(`One more thing, and I know how it sounds: ${traitBulletin(a, 'smell')}.`);

  const tail = n >= 4
    ? `\n\nThat's less than I'd like. It's what we have.`
    : `\n\nThat's the description. Word for word off the statement.`;
  return S.join(' ') + tail;
}

function officerExtraLine(key, a, rng) {
  const frag = traitBulletin(a, key);
  const T = [
    `Hang on — yeah. Witness added this after: ${frag}.`,
    `There is one more line here. ${cap(frag)}.`,
    `Since you asked: ${frag}. Not in the bulletin yet. It will be tomorrow.`,
    `Off the record, because it's thin: ${frag}.`,
  ];
  return T[rng.int(T.length)];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- the deputy's own look ---------------- */
function makeOfficerApp(rng) {
  const a = randomAppearance(rng);
  a.facial = a.gender.id === 'f' ? a.facial : a.facial;
  a.jacket = {
    id: 'sheriff', color: { id: 'navy', name: 'sheriff navy', hex: '#141c33' }, kind: 'sheriff jacket',
    label: 'Sheriff department jacket', bulletin: 'a sheriff department jacket',
  };
  a.pants = { id: 'khaki', color: { id: 'khaki', name: 'khaki', hex: '#4a4632' }, label: 'Khaki uniform pants', bulletin: 'khaki uniform pants' };
  a.shirt = { id: 'tan', name: 'tan', hex: '#6b6142' };
  a.hat = HATS.find((h) => h.id === 'cap');
  a.carry = CARRY[0];
  a.gait = GAITS.find((g) => g.id === 'stiff');
  a.height = HEIGHTS[2];
  a.build = BUILDS[3];
  a.mark = MARKS[0];
  return a;
}

/* ---------------- the clock ---------------- */
export function clockString(elapsed, length) {
  const frac = Math.max(0, Math.min(1, elapsed / length));
  const total = frac * SHIFT_HOURS * 60;
  let h = SHIFT_START_HOUR + Math.floor(total / 60);
  const m = Math.floor(total % 60);
  const ampm = h >= 24 ? 'AM' : h >= 12 ? 'PM' : 'AM';
  let hh = h % 24; if (hh === 0) hh = 12; if (hh > 12) hh -= 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

/* ---------------- end-of-night grading ---------------- */
export function gradeNight(stats) {
  let score = 0;
  score += stats.feesCollected * 4;
  score += stats.rentalsRung * 6;
  score += stats.shelvedRight * 12;
  score -= stats.shelvedWrong * 18;
  score -= stats.shelvedUnrewound * 10;
  score -= stats.feesWaived * 3;
  score -= stats.angered * 14;
  score -= stats.stormedOut * 25;
  score -= stats.unshelved * 8;
  score -= stats.turnedAway * 22;
  score -= stats.changeStiffed * 20;
  score -= stats.cashLoose * 6;
  score += stats.tips * 3;
  score += stats.served * 8;
  const letter = score >= 150 ? 'A' : score >= 100 ? 'B' : score >= 55 ? 'C' : score >= 15 ? 'D' : 'F';
  return { score: Math.round(score), letter };
}
