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
import { planKiller } from './killer.js';
import { GENRES } from './tapes.js';

export const SHIFT_START_HOUR = 21;   // 9:00 PM
export const SHIFT_HOURS = 3;         // to midnight

export function nightLength(n) { return Math.min(470, 300 + (n - 1) * 22); }

/* Which traits the deputy actually got out of the witness. */
function bulletinKeyCount(n) {
  return Math.max(3, 6 - Math.floor((n - 1) / 1.6));
}
function extraKeyCount(n) { return n <= 1 ? 3 : n <= 3 ? 2 : n <= 5 ? 1 : 0; }
function decoyCount(n) { return Math.min(4, 1 + Math.floor(n / 2)); }
function decoyOverlap(n, keyCount) { return Math.min(keyCount - 1, 1 + Math.floor(n / 2)); }

/* Traits that make good bulletin material -- things a witness would notice. */
const PRIORITY = ['jacket', 'height', 'build', 'hair', 'mark', 'hat', 'facial', 'glasses', 'gait', 'carry', 'pants', 'smell', 'voice'];

export function makeNight(seed, n) {
  const rng = makeRng(seed ^ (n * 0x9e3779b1));
  const length = nightLength(n);

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

  const plan = planKiller(rng, n, length);

  const bulletin = {
    app: suspect,
    keys,
    extra: extras,
    known: new Set(keys),
    certain: plan.appears || rng.chance(0.5),
    description: composeBulletin(suspect, keys, rng, n),
  };

  /* ---- customers ---- */
  const count = Math.min(13, 5 + n);
  const decoys = decoyCount(n);
  const overlap = decoyOverlap(n, keys.length);
  const schedule = [];
  const windowEnd = length * 0.84;
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

  return {
    n, seed, rng, length, bulletin, suspect, plan, schedule,
    officerApp: makeOfficerApp(rng),
    officerName: `Deputy ${randomName(rng).split(' ')[1]}`,
    overlap,
  };
}

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
  a.pants = { id: 'khaki', color: { id: 'khaki', name: 'khaki', hex: '#4a4632' }, label: 'Khaki uniform trousers', bulletin: 'khaki uniform pants' };
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
