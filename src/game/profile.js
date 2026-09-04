/* ============================================================
   profile.js -- the permanent player profile.

   Everything else the game saves is about ONE thing that is happening now:
   the Story campaign in progress (campaign.js), the settings in force
   (prefs), the controller binds, the active Overtime run (overtime.js). This
   file owns the one save that outlives all of those -- what the player has
   *accomplished*, across every campaign they have ever played and thrown
   away: that Story was cleared, which endings they have seen, their best
   completed campaign, and their Overtime lifetime records.

   It is deliberately its own key and its own tiny module, for the same
   reason campaign.js is: the day this moves to a desktop/Steam-Cloud save
   file, this is the only file that changes, and a future Steam achievement
   layer has one clean, game-owned object to observe.

   The hard rules, all of which the tests enforce:
     - Starting or deleting a Story campaign must NEVER touch this.
     - Nothing in here is ever a runtime object, a DOM node, an AudioNode, a
       game-world reference, or the gameplay RNG. Plain JSON only.
     - A malformed field is normalized to a safe default rather than crashing
       the title screen.
   ============================================================ */

/* Bump when the shape below changes incompatibly. Independent of the
   campaign save version and the overtime save version on purpose -- these
   are unrelated schemas and tying them together only creates false
   migrations. */
export const PROFILE_VERSION = 1;

const SAVE_KEY = 'finalrental.profile';

/* The two Story endings that exist (the real ids the campaign records in
   storyFlags.endingId). Kept here so `endingsSeen` can be normalized to the
   known set and the title can show "x / 2" without hard-coding 2 elsewhere. */
export const STORY_ENDINGS = ['ARREST', 'SURVIVED'];
export const STORY_ENDING_COUNT = STORY_ENDINGS.length;

/* Letter grade -> grade points, so "best average grade" and "grade streak"
   have a stable ordering to compare on. The game's grades are A B C D F. */
const GPA = { A: 4, B: 3, C: 2, D: 1, F: 0 };
export function gradePoints(letter) {
  return Object.prototype.hasOwnProperty.call(GPA, letter) ? GPA[letter] : 0;
}
/* The nearest letter to a grade-point average, for display. */
export function gpaLetter(gpa) {
  if (gpa == null) return '—';
  return gpa >= 3.5 ? 'A' : gpa >= 2.5 ? 'B' : gpa >= 1.5 ? 'C' : gpa >= 0.5 ? 'D' : 'F';
}

/**
 * A brand-new, never-accomplished-anything profile.
 *
 * Records that measure "the most you ever did" start at null / 0 so the first
 * real result always sets them. `fewestWalkouts` is the one where LOWER is
 * better: it starts null (no record yet) rather than 0, or a player who has
 * never finished Story would appear to hold an unbeatable zero-walkout record.
 */
export function freshProfile() {
  return {
    version: PROFILE_VERSION,
    story: {
      completed: false,          // has Story ever been finished, ever
      completions: 0,            // how many times
      endingsSeen: [],           // subset of STORY_ENDINGS, unique
      firstCompletedAt: null,    // ISO timestamp of the first clear
      lastCompletedAt: null,     // ISO timestamp of the most recent clear
      legacyImported: false,     // did we bootstrap from a pre-profile completed save
      records: {
        bestScore: null,         // best total campaign score (higher better)
        bestAvgGrade: null,      // best campaign grade-point average (higher better)
        mostArrests: null,       // most arrests in one completed campaign (higher)
        mostCustomers: null,     // most customers served in one campaign (higher)
        fewestWalkouts: null,    // fewest walkouts in one campaign (LOWER better)
      },
    },
    overtime: {
      records: {
        highestShift: 0,         // highest shift ever CLEARED (not reached)
        bestRunScore: 0,         // best cumulative score in one run
        mostArrests: 0,          // most arrests in one run
        bestGradeStreak: 0,      // longest run of top-grade shifts
        totalShifts: 0,          // lifetime shifts cleared across all runs
        totalRuns: 0,            // lifetime runs started
      },
      /* One compact snapshot of the best run, for the records screen. Not a
         history of every run -- one is enough. */
      bestRun: null,             // { highestShift, score, arrests, averageGrade, seed, date }
    },
  };
}

/* ------------------------------------------------------------
   Normalization. A hand-edited or future-versioned blob must come back as a
   valid profile, never as a shape the title screen has to guard against.
   ------------------------------------------------------------ */

function num(v, dflt) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : dflt;
}
/* A "most you ever did" value: a finite number, or null for "no record". */
function numOrNull(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}
function isoOrNull(v) {
  // A timestamp is metadata only; store whatever string was there, else null.
  return (typeof v === 'string' && v) ? v : null;
}

function normalizeStoryRecords(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    bestScore: numOrNull(r.bestScore),
    bestAvgGrade: numOrNull(r.bestAvgGrade),
    mostArrests: numOrNull(r.mostArrests),
    mostCustomers: numOrNull(r.mostCustomers),
    fewestWalkouts: numOrNull(r.fewestWalkouts),
  };
}

function normalizeEndings(list) {
  const out = [];
  if (Array.isArray(list)) {
    for (const e of list) {
      if (STORY_ENDINGS.includes(e) && !out.includes(e)) out.push(e);
    }
  }
  return out;
}

function normalizeStory(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const completions = Math.max(0, Math.floor(num(s.completions, 0)));
  const endings = normalizeEndings(s.endingsSeen);
  return {
    // completed is true if the flag says so OR the evidence (a completion) says so.
    completed: s.completed === true || completions > 0,
    completions,
    endingsSeen: endings,
    firstCompletedAt: isoOrNull(s.firstCompletedAt),
    lastCompletedAt: isoOrNull(s.lastCompletedAt),
    legacyImported: s.legacyImported === true,
    records: normalizeStoryRecords(s.records),
  };
}

function normalizeBestRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const highestShift = Math.max(0, Math.floor(num(raw.highestShift, 0)));
  if (highestShift <= 0) return null;       // a best run that cleared nothing is no run
  return {
    highestShift,
    score: Math.round(num(raw.score, 0)),
    arrests: Math.max(0, Math.floor(num(raw.arrests, 0))),
    averageGrade: numOrNull(raw.averageGrade),
    seed: num(raw.seed, 0) >>> 0,
    date: isoOrNull(raw.date),
  };
}

function normalizeOvertimeRecords(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const nn = (v) => Math.max(0, Math.floor(num(v, 0)));
  return {
    highestShift: nn(r.highestShift),
    bestRunScore: Math.round(Math.max(0, num(r.bestRunScore, 0))),
    mostArrests: nn(r.mostArrests),
    bestGradeStreak: nn(r.bestGradeStreak),
    totalShifts: nn(r.totalShifts),
    totalRuns: nn(r.totalRuns),
  };
}

function normalizeOvertime(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  return {
    records: normalizeOvertimeRecords(o.records),
    bestRun: normalizeBestRun(o.bestRun),
  };
}

/** Coerce any blob into a valid profile. Never throws, never returns null. */
export function normalizeProfile(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  return {
    version: PROFILE_VERSION,
    story: normalizeStory(p.story),
    overtime: normalizeOvertime(p.overtime),
  };
}

/* ------------------------------------------------------------
   Reads the rest of the game is allowed to ask.
   ------------------------------------------------------------ */

/** Has Story been completed at least once? The Overtime unlock gate. */
export function overtimeUnlocked(profile) {
  return !!(profile && profile.story && profile.story.completed === true);
}

/** Has a particular ending been seen? */
export function endingSeen(profile, id) {
  return !!(profile && profile.story && Array.isArray(profile.story.endingsSeen)
    && profile.story.endingsSeen.includes(id));
}

/** How many distinct Story endings have been seen (for "x / 2"). */
export function endingsSeenCount(profile) {
  return (profile && profile.story && Array.isArray(profile.story.endingsSeen))
    ? profile.story.endingsSeen.length : 0;
}

/* ------------------------------------------------------------
   Writes. Each mutates the in-memory profile and returns it (or a small
   result). The caller saves; keeping the write and the save separate lets a
   caller batch or test without disk.
   ------------------------------------------------------------ */

/* higher-is-better record update: null starts at the first value. */
function bumpHigh(recs, key, val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  if (recs[key] == null || val > recs[key]) { recs[key] = val; return true; }
  return false;
}
/* lower-is-better: null (no record) always accepts the first value. */
function bumpLow(recs, key, val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  if (recs[key] == null || val < recs[key]) { recs[key] = val; return true; }
  return false;
}

/**
 * The grade-point average of a finished campaign, from its per-night grade
 * letters. Null if nothing was graded (which never happens for a real
 * completion but keeps the math safe).
 */
export function campaignGpa(campaign) {
  const grades = (campaign && campaign.history && Array.isArray(campaign.history.grades))
    ? campaign.history.grades : [];
  if (!grades.length) return null;
  const sum = grades.reduce((s, g) => s + gradePoints(g), 0);
  return sum / grades.length;
}

/**
 * Observe a legitimately-finished Story campaign.
 *
 * The campaign completes FIRST (game.js/completeCampaign); this only reads the
 * finished result and folds it into the permanent record. Never the source of
 * truth for the ending itself -- `endingId` comes from the campaign.
 *
 * Idempotency is the caller's job via the completion funnel; this always
 * counts a completion, so call it exactly once per finished campaign.
 *
 * Returns the list of record keys that were newly set/beaten, so the caller
 * can show a subtle "new record" without recomputing.
 */
export function recordStoryCompletion(profile, campaign, opts = {}) {
  const s = profile.story;
  const now = (typeof opts.now === 'string' && opts.now) ? opts.now : nowIso();
  s.completed = true;
  s.completions += 1;
  if (!s.firstCompletedAt) s.firstCompletedAt = now;   // never overwrite the first
  s.lastCompletedAt = now;

  const endingId = opts.endingId
    || (campaign && campaign.storyFlags && campaign.storyFlags.endingId);
  if (STORY_ENDINGS.includes(endingId) && !s.endingsSeen.includes(endingId)) {
    s.endingsSeen.push(endingId);
  }

  const st = (campaign && campaign.stats) || {};
  const scores = (campaign && campaign.history && Array.isArray(campaign.history.scores))
    ? campaign.history.scores : [];
  const totalScore = scores.reduce((a, b) => a + (num(b, 0)), 0);
  const gpa = campaignGpa(campaign);

  const beaten = [];
  const R = s.records;
  if (bumpHigh(R, 'bestScore', Math.round(totalScore))) beaten.push('bestScore');
  if (gpa != null && bumpHigh(R, 'bestAvgGrade', gpa)) beaten.push('bestAvgGrade');
  if (bumpHigh(R, 'mostArrests', Math.max(0, Math.floor(num(st.arrests, 0))))) beaten.push('mostArrests');
  if (bumpHigh(R, 'mostCustomers', Math.max(0, Math.floor(num(st.customersServed, 0))))) beaten.push('mostCustomers');
  if (bumpLow(R, 'fewestWalkouts', Math.max(0, Math.floor(num(st.walkouts, 0))))) beaten.push('fewestWalkouts');

  return beaten;
}

/**
 * Bootstrap the permanent profile from a pre-existing completed Story campaign.
 *
 * A player who finished the campaign under a Stage 8-11 build has a completed
 * save on disk but no profile, and should not have to replay Night 12 to
 * unlock Overtime. On the first boot after this stage, if the profile has
 * never recorded a completion AND the campaign save is already completed, fold
 * that one legacy completion in.
 *
 * Idempotent by the completions guard: once anything has been recorded
 * (legacy import or a real completion), this never fires again, so booting
 * repeatedly does not inflate the count. Returns true if it imported.
 */
export function bootstrapFromCampaign(profile, campaign) {
  if (!profile || !campaign) return false;
  if (profile.story.completions > 0) return false;         // already have a record
  if (campaign.completed !== true) return false;           // nothing finished to import
  recordStoryCompletion(profile, campaign);
  profile.story.legacyImported = true;
  return true;
}

/* ---- Overtime records ---- */

/** A new Overtime run has begun. Counts a lifetime run. */
export function recordOvertimeRunStarted(profile) {
  profile.overtime.records.totalRuns += 1;
}

/**
 * A shift was just cleared and banked. Safe to record the earned progress now
 * (rather than waiting for the run to end), so a player who quits mid-run
 * keeps their high-water mark. `run` is the active overtime run object.
 */
export function recordOvertimeShiftCleared(profile, run) {
  const R = profile.overtime.records;
  const rs = (run && run.runStats) || {};
  const cleared = Math.max(0, Math.floor(num(rs.shiftsCleared, 0)));
  R.totalShifts += 1;
  if (cleared > R.highestShift) R.highestShift = cleared;
  const streak = Math.max(0, Math.floor(num(rs.bestGradeStreak, 0)));
  if (streak > R.bestGradeStreak) R.bestGradeStreak = streak;
}

/**
 * An Overtime run ended (death, firing, or deliberate replacement). Fold its
 * totals into the lifetime records and update the single best-run snapshot.
 *
 * `abandoned` runs still count their earned shifts/score as records (a good
 * run the player walked away from was still a good run) but the caller decides
 * whether to call this at all for a bare quit -- a manual quit that KEEPS the
 * run must not end it. Returns the list of lifetime records newly beaten.
 */
export function recordOvertimeRunEnd(profile, run, opts = {}) {
  const R = profile.overtime.records;
  const rs = (run && run.runStats) || {};
  const cleared = Math.max(0, Math.floor(num(rs.shiftsCleared, 0)));
  const score = Math.round(Math.max(0, num(rs.score, 0)));
  const arrests = Math.max(0, Math.floor(num(rs.arrests, 0)));
  const streak = Math.max(0, Math.floor(num(rs.bestGradeStreak, 0)));

  const beaten = [];
  if (cleared > R.highestShift) { R.highestShift = cleared; beaten.push('highestShift'); }
  if (score > R.bestRunScore) { R.bestRunScore = score; beaten.push('bestRunScore'); }
  if (arrests > R.mostArrests) { R.mostArrests = arrests; beaten.push('mostArrests'); }
  if (streak > R.bestGradeStreak) { R.bestGradeStreak = streak; beaten.push('bestGradeStreak'); }

  /* Keep the best run by shifts cleared, tie-broken by score. */
  const prev = profile.overtime.bestRun;
  const better = !prev || cleared > prev.highestShift
    || (cleared === prev.highestShift && score > prev.score);
  if (better && cleared > 0) {
    profile.overtime.bestRun = {
      highestShift: cleared,
      score,
      arrests,
      averageGrade: numOrNull(rs.avgGrade),
      seed: num(run && run.seed, 0) >>> 0,
      date: (typeof opts.now === 'string' && opts.now) ? opts.now : nowIso(),
    };
  }
  return beaten;
}

/* A timestamp that never affects gameplay. If the clock is strange the game
   still works -- a bad Date just yields a string or, at worst, a caught throw
   and a null date. */
function nowIso() {
  try { return new Date().toISOString(); } catch { return null; }
}

/* ------------------------------------------------------------
   Storage. Fails soft, exactly like campaign.js: a missing or broken profile
   is a fresh one, never a crash. localStorage can itself throw.
   ------------------------------------------------------------ */

function store() {
  try { return window.localStorage; } catch { return null; }
}

/** Read the profile, always returning a valid one (fresh if absent/broken). */
export function loadProfile() {
  const ls = store();
  if (!ls) return freshProfile();
  let raw;
  try { raw = ls.getItem(SAVE_KEY); } catch { return freshProfile(); }
  if (!raw) return freshProfile();
  let data;
  try { data = JSON.parse(raw); } catch {
    console.warn('Final Rental: profile was corrupt and has been reset to defaults.');
    return freshProfile();
  }
  // A profile from a newer build: do not guess at a future shape, start clean.
  if (data && typeof data === 'object' && typeof data.version === 'number'
    && data.version > PROFILE_VERSION) {
    console.warn(`Final Rental: profile version ${data.version} is newer than this build; using defaults.`);
    return freshProfile();
  }
  return normalizeProfile(data);
}

/** Write the profile. Called at accomplishment boundaries, never mid-shift. */
export function saveProfile(profile) {
  const ls = store();
  if (!ls || !profile) return false;
  try {
    ls.setItem(SAVE_KEY, JSON.stringify(profile));
    return true;
  } catch (err) {
    console.warn('Final Rental: could not save profile —', err && err.message);
    return false;
  }
}

/** Throw the profile away. Not used by normal play -- here for tests and a
    future "erase all data" option. Deliberately does NOT touch campaign,
    overtime, prefs, or pad binds. */
export function deleteProfile() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing we can do */ }
}
