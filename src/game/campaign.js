/* ============================================================
   campaign.js -- Story Mode: a finite, saved run of nights.

   The rest of the game does not persist. You start a shift, you work it,
   you get a grade, and the next shift is generated fresh -- HORROR runs
   like that forever and CASUAL is the same store with nobody coming for
   you. Story Mode is the one that remembers: a fixed number of nights,
   one seed for the whole campaign so the sequence is the player's to keep,
   and a small record that survives closing the tab.

   This module owns two things and only two things:

     1. the SHAPE of that record (freshCampaign, and what a night's config
        looks like), and
     2. the DOOR to storage (save/load/has/delete).

   Gameplay talks to the four functions at the bottom. It never touches
   localStorage for campaign data itself, so the day this moves to a
   desktop/Steam save file, this is the only file that changes.

   Everything in the campaign object is plain serializable data -- numbers,
   strings, arrays, and bags of those. No DOM nodes, no class instances, no
   timers, no audio. If it cannot survive JSON.stringify and come back the
   same, it does not belong in here.
   ============================================================ */

/* Bump this when the shape below changes in a way an old save cannot be
   read as. loadCampaign() refuses a version it does not understand rather
   than handing gameplay a half-broken object. */
export const SAVE_VERSION = 1;

/* Its own key. Deliberately nothing to do with 'finalrental.padbinds',
   which the controller settings own -- wiping one must never touch the
   other. */
const SAVE_KEY = 'finalrental.campaign';

/* How long the story is. One number, here, so the day it becomes 10 or 14
   nothing else has to be told. */
export const STORY_NIGHT_COUNT = 12;

/**
 * How a Story night may steer three things that would otherwise be rolled:
 * the killer, the deputy, and the coach.
 *
 *   NORMAL     leave it to the procedural generator, exactly as an endless
 *              shift of the same number would.
 *   FORBIDDEN  it does not happen tonight.
 *   FORCED     it happens tonight.
 *
 * FORCED means only that: the outcome. It does not script HOW. A forced
 * killer still decides for himself -- through the existing systems -- whether
 * he comes as a customer first, when he arrives, whether he stalks, and how
 * the encounter unfolds. The campaign guarantees the beat; the game still
 * plays it.
 */
export const POLICY = { NORMAL: 'normal', FORBIDDEN: 'forbidden', FORCED: 'forced' };

/**
 * What a single Story night is allowed to be.
 *
 * A NORMAL night on every axis with no required specials and no cap is
 * exactly what the procedural generator already produces -- so a Story night
 * with no entry in the table below generates the same as an endless shift of
 * the same number. The table is the only place that says otherwise, which is
 * what keeps `if (night === 4)` out of the rest of the game.
 *
 * The fields:
 *   killerPolicy / deputyPolicy / coachPolicy  -- POLICY, above.
 *   requiredSpecials  -- ids of specials guaranteed to appear (they take an
 *                        ordinary customer's slot, never a suspect decoy's).
 *   specialCap        -- the most specials the night may contain, required
 *                        ones included. null means no cap (the endless
 *                        default). Pacing, so an early night is not swarmed.
 */
export function nightConfig(n) {
  const base = {
    night: n,
    killerPolicy: POLICY.NORMAL,
    deputyPolicy: POLICY.NORMAL,
    coachPolicy: POLICY.NORMAL,
    requiredSpecials: [],
    specialCap: null,
  };
  return Object.assign(base, NIGHTS[n] || {});
}

/* Act I. Four authored nights that teach the job, then the neighborhood,
   then the warning, then the first real threat -- while everything inside
   those boundaries (which customers, what they rent, the suspect, how the
   killer behaves) stays procedural.

   Nights with no entry here inherit the all-NORMAL defaults above, which is
   Nights 5-12 for now: still procedural, still finite, not yet authored. */
const NIGHTS = {
  // Night 1 -- the normal job. No threat, no deputy, no coach; at most one
  // regular so the place has personality without being chaos.
  1: {
    killerPolicy: POLICY.FORBIDDEN,
    deputyPolicy: POLICY.FORBIDDEN,
    coachPolicy: POLICY.FORBIDDEN,
    specialCap: 1,
  },
  // Night 2 -- something is off. Cheryl Vandermeer (the MANAGER special)
  // is guaranteed; her complaint about the dark rear lot is the first note
  // that the neighborhood is not safe. Still no killer, still no deputy.
  2: {
    killerPolicy: POLICY.FORBIDDEN,
    deputyPolicy: POLICY.FORBIDDEN,
    coachPolicy: POLICY.FORBIDDEN,
    requiredSpecials: ['MANAGER'],
    specialCap: 2,
  },
  // Night 3 -- the warning. The deputy arrives and reads the first bulletin;
  // the decoys make the identification game real. But there is no killer
  // tonight, so a first-timer can learn the mechanic without being punished
  // for misreading it.
  3: {
    killerPolicy: POLICY.FORBIDDEN,
    deputyPolicy: POLICY.FORCED,
    coachPolicy: POLICY.FORBIDDEN,
    specialCap: 1,
  },
  // Night 4 -- the first real threat. The deputy comes and the killer is
  // guaranteed to appear. HOW he appears is still his own.
  4: {
    killerPolicy: POLICY.FORCED,
    deputyPolicy: POLICY.FORCED,
    coachPolicy: POLICY.FORBIDDEN,
    specialCap: 1,
  },
};

/**
 * A brand-new campaign.
 *
 * `seed` fixes the whole run: given the same seed, night 1 through the last
 * come out the same every time, which is what lets Continue rebuild a night
 * exactly rather than storing the night itself.
 */
export function freshCampaign(seed) {
  return {
    version: SAVE_VERSION,
    mode: 'STORY',
    seed: seed >>> 0,

    /* The night the player is on. Written the moment a night begins, so a
       quit mid-shift resumes at the start of that same night rather than
       somewhere in the middle of it. */
    currentNight: 1,
    started: true,
    completed: false,

    /* One row per finished night. Parallel arrays rather than objects so a
       later task can chart them without reshaping anything. */
    history: {
      grades: [],   // 'A'..'F' per completed night
      scores: [],   // points per completed night
    },

    /* The arrest cooldown the run already tracks. Lives here in Story so it
       survives a quit: catch someone on night 5 and the quiet nights it
       buys are still owed to you after you close the tab. */
    cooldown: {
      calmUntil: 0,
      standDownNight: 0,
    },

    /* Running totals across the campaign. Cheap to keep and the beginning
       of an end-of-campaign summary. */
    stats: {
      arrests: 0,
      customersServed: 0,
      walkouts: 0,
      cashDiscrepancy: 0,
    },

    /* Deliberately empty, deliberately extensible. Later tasks hang state
       off these without touching the save format:
         storyFlags.deputyMentionedCopycats = true
         customerStates.managerWoman = { lastOutcome: 'refunded', met: 2 }
         environmentFlags.backCounterLightBroken = true
       Keeping them as plain objects is the whole point -- a new key is a
       new feature, not a migration. */
    storyFlags: {},
    customerStates: {},
    environmentFlags: {},
  };
}

/* ------------------------------------------------------------
   Storage. The four functions gameplay is allowed to know about.
   Everything here fails soft: a missing or broken save is a fresh start,
   never a crash. localStorage itself can throw (private mode, quota, a
   browser that refuses it in a frame), so every call is wrapped.
   ------------------------------------------------------------ */

function store() {
  // Reached through a getter so a throwing localStorage is caught, not
  // thrown at module load.
  try { return window.localStorage; } catch { return null; }
}

/** Write the campaign. Called at night boundaries, never mid-shift. */
export function saveCampaign(state) {
  const ls = store();
  if (!ls || !state) return false;
  try {
    ls.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    // Out of quota, or storage denied. The run continues in memory; only
    // the persistence is lost, which is not worth ending a shift over.
    console.warn('Final Rental: could not save campaign —', err && err.message);
    return false;
  }
}

/**
 * Read the campaign back, or null if there is nothing usable.
 *
 * "Usable" is doing real work here: absent, unparseable, wrong version, or
 * the wrong shape all come back as null with a note in the console rather
 * than as a campaign object that blows up three frames into a shift.
 */
export function loadCampaign() {
  const ls = store();
  if (!ls) return null;
  let raw;
  try { raw = ls.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;

  let data;
  try { data = JSON.parse(raw); } catch {
    console.warn('Final Rental: campaign save was corrupt and has been ignored.');
    return null;
  }
  return migrate(data);
}

/** Is there a campaign worth offering CONTINUE for? A finished one is not. */
export function hasCampaignSave() {
  const c = loadCampaign();
  return !!(c && c.started && !c.completed);
}

/** Throw the campaign away. Used before a New Game overwrites it. */
export function deleteCampaignSave() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing we can do, nothing worth doing */ }
}

/**
 * Bring a loaded blob up to the current shape, or reject it.
 *
 * There is only one version so far, so this mostly validates. It exists now
 * so that when version 2 arrives, the place to translate a v1 save is
 * obvious and the rest of the game never learns that migrations happen.
 */
function migrate(data) {
  if (!data || typeof data !== 'object') return null;

  // A save from a newer build than this one: do not guess at a shape from
  // the future.
  if (typeof data.version !== 'number' || data.version > SAVE_VERSION) {
    console.warn(`Final Rental: campaign save version ${data && data.version} is not one this build understands; ignoring it.`);
    return null;
  }

  // (Future: if (data.version < SAVE_VERSION) step it up, field by field.)

  // The few fields gameplay actually relies on have to be right. Anything
  // the player-facing code reads directly is checked; the extensible bags
  // are only required to be objects.
  const n = data.currentNight;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) {
    console.warn('Final Rental: campaign save was missing a valid night; ignoring it.');
    return null;
  }
  // Fold anything in fresh() that the save predates. Cheap insurance so a
  // save written before a field existed reads back with that field present.
  const clean = freshCampaign(data.seed >>> 0);
  return {
    ...clean,
    ...data,
    version: SAVE_VERSION,
    history: { ...clean.history, ...(data.history || {}) },
    cooldown: { ...clean.cooldown, ...(data.cooldown || {}) },
    stats: { ...clean.stats, ...(data.stats || {}) },
    storyFlags: { ...clean.storyFlags, ...(data.storyFlags || {}) },
    customerStates: { ...clean.customerStates, ...(data.customerStates || {}) },
    environmentFlags: { ...clean.environmentFlags, ...(data.environmentFlags || {}) },
  };
}
