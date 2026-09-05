/* ============================================================
   overtime.js -- the post-game challenge: the active run.

   Overtime is the ordinary graveyard shift turned into a survival run. You
   clear one increasingly ugly shift after another; a death or a wrong call
   ends the run for good. Story stays forgiving (retry the night); Overtime is
   where the mastery lives.

   Two things live here and only two:
     1. the SHAPE of an active run (a seed, which shift you are on, the
        running tally), and
     2. the DOOR to its own storage key.

   Permanent records -- highest shift ever, best run, lifetime totals -- do
   NOT live here. They belong to the profile (profile.js), which outlives any
   one run. This file is only ever the run you are in the middle of.

   Overtime is emphatically NOT seeded from, and shares nothing with, the
   Story campaign: its own seed, its own stats, no customer memory, no
   investigation, no environment progression. The night GENERATOR is reused
   (that is the whole point -- reuse the real game), but every input to it here
   is Overtime's own.

   Everything is plain JSON. Same discipline as campaign.js and profile.js.
   ============================================================ */

/* Independent of the campaign and profile save versions -- unrelated schema. */
import { storage } from '../engine/storage.js';

export const OVERTIME_VERSION = 1;

const SAVE_KEY = 'finalrental.overtime';

/* ------------------------------------------------------------
   Difficulty mapping.

   The night generator (night.js) already scales everything -- customer count,
   killer odds, bulletin length, decoys, the coach, the killer's speed -- off a
   single night number, and most of those quantities hit a natural cap in the
   authored Story range (customers at 13, killer odds at 0.92, bulletin at 10
   traits). Overtime reuses that mapping wholesale rather than inventing a
   second difficulty framework.

   Two numbers do the whole job:

     effectiveNight(shift) -- the night number handed to the generator, which
       sets the PRESSURE. The player has just finished the twelve-night Story,
       so Overtime opens at an experienced tier, not tutorial Night 1: shift 1
       generates like a mid/late procedural night. It then climbs one night per
       shift until it reaches a cap and PLATEAUS there. The cap exists because
       one generator value -- the killer's hunt speed -- is the only thing that
       does not naturally level off, and letting it climb forever would tip the
       run from "hard" into "unfair". At the cap the game is at its natural
       maximum pressure and stays there while procedural variety keeps shifts
       from feeling identical.

     shiftSeed(runSeed, shift) -- a per-shift seed so two shifts that map to the
       SAME capped effective night still generate different stores. Without
       this every shift past the plateau would be byte-identical.
   ============================================================ */

/* Shift 1 opens as if it were this many nights in, plus the shift number.
   BASE 5 => shift 1 generates like night 6 (a mid/late Story night: killer
   very likely, a full-ish bulletin, a busy floor), shift 2 like night 7, and
   so on. */
export const OVERTIME_BASE_NIGHT = 5;

/* The effective night never exceeds this. Chosen just past Story's hardest
   authored night (12) so the plateau is a touch tougher than the campaign
   finale and no tougher: at 14 the killer's hunt speed is a hair above the
   Night 12 attacker's and every other generator quantity is already at its
   own cap. Beyond here, more shift number buys variety, not runaway numbers. */
export const OVERTIME_NIGHT_CAP = 14;

/** The generator night for a given player-facing shift (1-based). */
export function effectiveNight(shift) {
  const s = Math.max(1, Math.floor(shift || 1));
  return Math.min(OVERTIME_NIGHT_CAP, OVERTIME_BASE_NIGHT + s);
}

/** A distinct, deterministic seed per shift within a run. */
export function shiftSeed(runSeed, shift) {
  const s = Math.max(1, Math.floor(shift || 1));
  // A cheap integer hash of (runSeed, shift). Deterministic and well-spread so
  // consecutive shifts do not produce visibly similar stores.
  let h = (runSeed >>> 0) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* ------------------------------------------------------------
   The run.
   ------------------------------------------------------------ */

/**
 * A brand-new Overtime run. `seed` fixes the whole run: given the run seed and
 * a shift number, every shift rebuilds identically, so Continue can rebuild
 * the current shift exactly rather than storing the store.
 */
export function freshOvertimeRun(seed) {
  return {
    version: OVERTIME_VERSION,
    seed: seed >>> 0,
    /* The shift the player is ON. Written when a shift begins, so a quit
       mid-shift resumes at the start of that same shift. Mirrors Story's
       currentNight exactly. */
    shift: 1,
    started: true,
    runStats: {
      shiftsCleared: 0,     // how many shifts fully cleared (the record metric)
      score: 0,             // cumulative shift score
      arrests: 0,           // killers called in correctly
      customersServed: 0,
      walkouts: 0,
      gradeStreak: 0,       // current run of top-grade shifts
      bestGradeStreak: 0,   // best such run this run
      gradeSum: 0,          // grade points, for the average
      gradeCount: 0,        // shifts that carried a grade (for the average)
      avgGrade: null,       // grade-point average so far (derived, stored for summary)
    },
    /* A short, capped tail of recent shift grades -- enough for a summary
       line without growing without bound on a marathon run. */
    history: [],
  };
}

const HISTORY_CAP = 40;

function num(v, dflt) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : dflt;
}

function normalizeRunStats(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const nn = (v) => Math.max(0, Math.floor(num(v, 0)));
  const gradeCount = nn(r.gradeCount);
  const gradeSum = Math.max(0, num(r.gradeSum, 0));
  return {
    shiftsCleared: nn(r.shiftsCleared),
    score: Math.round(num(r.score, 0)),
    arrests: nn(r.arrests),
    customersServed: nn(r.customersServed),
    walkouts: nn(r.walkouts),
    gradeStreak: nn(r.gradeStreak),
    bestGradeStreak: nn(r.bestGradeStreak),
    gradeSum,
    gradeCount,
    avgGrade: gradeCount > 0 ? gradeSum / gradeCount : null,
  };
}

/** Coerce any blob into a valid run, or null if it is not a usable run. */
export function normalizeOvertimeRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shift = Math.floor(num(raw.shift, 0));
  if (!Number.isFinite(shift) || shift < 1) return null;   // no valid shift => not a run
  const history = Array.isArray(raw.history)
    ? raw.history.filter((g) => typeof g === 'string').slice(-HISTORY_CAP)
    : [];
  return {
    version: OVERTIME_VERSION,
    seed: num(raw.seed, 0) >>> 0,
    shift,
    started: raw.started !== false,
    runStats: normalizeRunStats(raw.runStats),
    history,
  };
}

/* Letter grade -> points, matching profile.js. A cleared shift with no report
   (an arrest night skips the grade) counts as the top grade: catching the
   killer is the best a shift can go. */
const GPA = { A: 4, B: 3, C: 2, D: 1, F: 0 };
export function gradePoints(letter) {
  return Object.prototype.hasOwnProperty.call(GPA, letter) ? GPA[letter] : 0;
}

/**
 * Bank a cleared shift into the run, in memory. Pure bookkeeping -- the caller
 * saves at the boundary. `result` carries what the shift produced:
 *   { grade: 'A'..'F' | null, score, served, walkouts, arrested: bool }
 * An arrested shift (no report) is treated as a top-grade clear.
 *
 * Returns the run for chaining. After this, run.shift has advanced to the next
 * shift and run.runStats.shiftsCleared counts the one just cleared.
 */
export function bankShift(run, result = {}) {
  const rs = run.runStats;
  const cleared = run.shift;                 // the shift number just finished
  rs.shiftsCleared = Math.max(rs.shiftsCleared, cleared);
  rs.score += Math.round(num(result.score, 0));
  rs.customersServed += Math.max(0, Math.floor(num(result.served, 0)));
  rs.walkouts += Math.max(0, Math.floor(num(result.walkouts, 0)));
  if (result.arrested) rs.arrests += 1;

  // Grade: an arrest counts as an A; a graded report uses its letter.
  const letter = result.arrested ? 'A' : (typeof result.grade === 'string' ? result.grade : null);
  if (letter) {
    rs.gradeSum += gradePoints(letter);
    rs.gradeCount += 1;
    rs.avgGrade = rs.gradeSum / rs.gradeCount;
    run.history.push(letter);
    if (run.history.length > HISTORY_CAP) run.history = run.history.slice(-HISTORY_CAP);
    // Top-grade streak.
    if (letter === 'A') {
      rs.gradeStreak += 1;
      if (rs.gradeStreak > rs.bestGradeStreak) rs.bestGradeStreak = rs.gradeStreak;
    } else {
      rs.gradeStreak = 0;
    }
  }

  run.shift = cleared + 1;
  return run;
}

/* ------------------------------------------------------------
   Storage. Fails soft, same discipline as campaign.js / profile.js.
   ------------------------------------------------------------ */

function store() { return storage; }   // engine/storage.js -- web localStorage or desktop FS

/** Write the active run. Called at shift boundaries, never mid-shift. */
export function saveOvertimeRun(run) {
  const ls = store();
  if (!ls || !run) return false;
  try {
    ls.setItem(SAVE_KEY, JSON.stringify(run));
    return true;
  } catch (err) {
    console.warn('Final Rental: could not save overtime run —', err && err.message);
    return false;
  }
}

/** Read the active run, or null if there is nothing usable. */
export function loadOvertimeRun() {
  const ls = store();
  if (!ls) return null;
  let raw;
  try { raw = ls.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch {
    console.warn('Final Rental: overtime run was corrupt and has been ignored.');
    return null;
  }
  if (data && typeof data.version === 'number' && data.version > OVERTIME_VERSION) {
    console.warn(`Final Rental: overtime run version ${data.version} is not one this build understands; ignoring it.`);
    return null;
  }
  return normalizeOvertimeRun(data);
}

/** Is there an active Overtime run to continue? */
export function hasOvertimeRun() {
  return !!loadOvertimeRun();
}

/** End/clear the active run. The RECORDS survive in the profile; only the
    active-run save is removed. */
export function deleteOvertimeRun() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing we can do */ }
}
