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
   than handing gameplay a half-broken object.

   v2 added persistent customer memory (customerStates entries). A v1 save
   has customerStates:{} already, so it reads forward with nobody remembered
   yet -- no data is lost, and migrate() below normalizes the bag either way.

   v3 added the investigation: a compact `cases` list of successful Story
   arrests, and real use of storyFlags. A v2 save has neither; migrate() folds
   in an empty cases list and leaves storyFlags as it found it, so nothing is
   lost and the game simply reads "no arrests on record yet". */
export const SAVE_VERSION = 3;

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

  /* Act II. The nights after the first real threat, paced as a set: relief,
     something-like-normal, a night the JOB is chaos, and then the floor
     dropping out again. The threat is authored at the campaign level (which
     nights can hold a killer, when the coach comes) while everything inside a
     shift stays procedural. Cooldown and the investigation resolver still have
     the final say where they apply -- these are the broad shape, not an
     override of the state-aware systems Stage 5 built. */

  // Night 5 -- aftermath. Guaranteed breathing room: no killer, no coach,
  // whatever you did on Night 4. The deputy is left state-driven (NORMAL), so
  // an arrest surfaces the stand-down "it's over" visit and an unresolved case
  // still gets an ordinary warning -- the same night reads differently by
  // history. Little Ricky and the popcorn are the tonal contrast: you nearly
  // died last night, and tonight's problem is a man in your kettle.
  5: {
    killerPolicy: POLICY.FORBIDDEN,
    coachPolicy: POLICY.FORBIDDEN,
    requiredSpecials: ['POPCORN'],
    specialCap: 2,
  },
  // Night 6 -- almost normal. Cheryl returns; the rear lot is still dark
  // through this shift (the light installs at the 6->7 boundary if earned).
  // Killer left NORMAL on purpose: a prior arrest's cooldown suppresses it,
  // but an unresolved case keeps the underlying danger a live probability.
  6: {
    coachPolicy: POLICY.FORBIDDEN,
    requiredSpecials: ['MANAGER'],
    specialCap: 2,
  },
  // Night 7 -- the busy night. The store is safe; the JOB is not. No killer,
  // no deputy to interrupt, but the coach is FORCED -- a guaranteed rush on top
  // of Otis and the floodlight the player may just now be noticing. Heavy
  // pressure, no actual danger. The game teaches that not every bad night is a
  // killer night, which is what makes the next one land.
  7: {
    killerPolicy: POLICY.FORBIDDEN,
    deputyPolicy: POLICY.FORBIDDEN,
    coachPolicy: POLICY.FORCED,
    requiredSpecials: ['COUPON'],
    specialCap: 2,
  },
  // Night 8 -- the second problem. A genuine threat every time (killer and
  // deputy FORCED), but its MEANING is state-aware: with a prior arrest it is
  // the Stage 5 second threat -- someone who should not still be out there --
  // and without one it is simply the unresolved case escalating. Coach
  // forbidden and cap held at two (Ricky + Otis, no random extras) so the
  // horror and the two returning regulars have room and the night does not
  // turn into a receiving line.
  8: {
    killerPolicy: POLICY.FORCED,
    deputyPolicy: POLICY.FORCED,
    coachPolicy: POLICY.FORBIDDEN,
    requiredSpecials: ['POPCORN', 'COUPON'],
    specialCap: 2,
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

    /* The case file the county is building, from the player's side of it: one
       compact row per successful Story arrest. Not the runtime killer -- a
       handful of plain traits the deputy can talk about later ("last one was
       six-two; this one isn't"), plus the tape that keeps turning up. Capped,
       so a long campaign cannot grow the save without bound. */
    cases: [],
  };
}

/* ============================================================
   CUSTOMER MEMORY

   Sunset Video remembers its regulars. Not with a friendship meter or a
   relationship screen -- this is invisible narrative state, a few plain
   fields per person that later dialogue can read to sound like it happened
   before.

   All of it lives in campaign.customerStates, keyed by the special's roster
   id ('MANAGER', 'POPCORN', ...). One campaign, one save; nothing about a
   customer is kept anywhere else. Gameplay never reaches into the bag
   directly -- it goes through the five helpers below, which default an unseen
   customer to a sane blank rather than undefined, and which refuse to crash
   on a save whose entry got mangled.

   The distinction these keep clean:
     - persistent history (here) is what happened on previous nights;
     - runtime encounter state (on the live customer object) is what is
       happening right now;
     - scheduling (nightConfig, above) is whether they turn up tonight.
   Those are three different things and this is only the first.
   ============================================================ */

/* What a never-before-seen regular looks like. `encounters` counts the
   Story nights their encounter actually resolved on -- so "is this a first
   meeting or a return" is a question about state, never about the calendar. */
function blankCustomerState() {
  return { met: false, encounters: 0, lastOutcome: null, lastNight: 0, flags: {} };
}

/* Coerce whatever is in the save (or nothing) into a valid state object.
   A malformed entry -- someone hand-edited the save, or a future field
   arrived as the wrong type -- becomes a blank rather than a landmine. */
function normalizeCustomerState(raw) {
  const base = blankCustomerState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    met: raw.met === true,
    encounters: (typeof raw.encounters === 'number' && raw.encounters >= 0)
      ? Math.floor(raw.encounters) : 0,
    lastOutcome: (typeof raw.lastOutcome === 'string') ? raw.lastOutcome : null,
    lastNight: (typeof raw.lastNight === 'number' && raw.lastNight >= 0)
      ? Math.floor(raw.lastNight) : 0,
    flags: (raw.flags && typeof raw.flags === 'object') ? { ...raw.flags } : {},
  };
}

/** Normalize the whole bag on load. Anything that is not a plain object of
    entries collapses to empty rather than propagating a bad shape. */
function normalizeCustomerStates(bag) {
  const out = {};
  if (bag && typeof bag === 'object') {
    for (const id of Object.keys(bag)) out[id] = normalizeCustomerState(bag[id]);
  }
  return out;
}

/**
 * Read a regular's history. Always returns a valid object -- an unseen
 * customer (or any lookup against a campaign that has no memory bag, which
 * is every non-Story run) comes back blank, so callers never branch on
 * undefined. The returned object is a copy; write through the helpers below.
 */
export function getCustomerState(campaign, id) {
  if (!campaign || !campaign.customerStates || !id) return blankCustomerState();
  return normalizeCustomerState(campaign.customerStates[id]);
}

/** Has this regular ever been dealt with before? */
export function customerMet(campaign, id) {
  return getCustomerState(campaign, id).encounters > 0;
}

/**
 * Record that an encounter with `id` just resolved.
 *
 * This is the one write that advances a relationship: it marks them met,
 * counts the encounter, remembers the broad outcome and the night, and folds
 * in any per-character flags. It mutates the in-memory campaign only -- the
 * disk save happens at the night boundary (advanceNight), so an encounter on
 * a night the player then fails is rolled back with the rest of that night.
 *
 * No-ops safely if there is no campaign (non-Story modes never call it, but
 * belt and braces). Returns the updated state.
 */
export function recordCustomerOutcome(campaign, id, outcome, opts = {}) {
  if (!campaign || !id) return blankCustomerState();
  if (!campaign.customerStates || typeof campaign.customerStates !== 'object') {
    campaign.customerStates = {};
  }
  const s = normalizeCustomerState(campaign.customerStates[id]);
  s.met = true;
  s.encounters += 1;
  if (typeof outcome === 'string') s.lastOutcome = outcome;
  if (typeof opts.night === 'number' && opts.night >= 0) s.lastNight = Math.floor(opts.night);
  if (opts.flags && typeof opts.flags === 'object') s.flags = { ...s.flags, ...opts.flags };
  campaign.customerStates[id] = s;
  return s;
}

/** Set one persistent per-character flag. */
export function setCustomerFlag(campaign, id, key, value = true) {
  if (!campaign || !id || !key) return;
  if (!campaign.customerStates || typeof campaign.customerStates !== 'object') {
    campaign.customerStates = {};
  }
  const s = normalizeCustomerState(campaign.customerStates[id]);
  s.flags[key] = value;
  campaign.customerStates[id] = s;
}

/** Read one persistent per-character flag, or `dflt` if it was never set. */
export function getCustomerFlag(campaign, id, key, dflt = undefined) {
  const s = getCustomerState(campaign, id);
  return (key in s.flags) ? s.flags[key] : dflt;
}

/* ============================================================
   ENVIRONMENT MEMORY

   The people remember; so, now, does the building. environmentFlags is a flat
   bag of plain facts about what has become true of the store -- a floodlight
   went in, a notice got taped up, a stain never came out. Data only: never a
   light, a mesh, a texture, or a node. The campaign says "the floodlight is
   installed"; night startup reads that and builds one; the renderer draws it.

   Deliberately neutral -- a flag can mean a repair OR new damage OR a notice --
   so the store can get worse as easily as better in a later stage. Values are
   whatever survives JSON (usually just booleans); everything defaults to a
   sane blank so an old save, or any non-Story run, reads "nothing has changed".
   ============================================================ */

/* Only plain JSON primitives belong in the bag. A value that is an object,
   array, or function (a mesh or callback that should never have been put here)
   is dropped on load rather than trusted. */
function normalizeEnvironmentFlags(bag) {
  const out = {};
  if (bag && typeof bag === 'object') {
    for (const k of Object.keys(bag)) {
      const v = bag[k];
      const t = typeof v;
      if (t === 'boolean' || t === 'number' || t === 'string' || v === null) out[k] = v;
    }
  }
  return out;
}

/** Read one environmental fact, or `dflt` (false) if it was never set. Blank
    for any campaign with no bag -- which is every non-Story run. */
export function getEnvironmentFlag(campaign, key, dflt = false) {
  if (!campaign || !campaign.environmentFlags || !key) return dflt;
  const v = campaign.environmentFlags[key];
  return (v === undefined) ? dflt : v;
}

/** A shorter read alias, for call sites that just want the truthiness. */
export function environmentFlag(campaign, key) {
  return getEnvironmentFlag(campaign, key, false);
}

/** Set one environmental fact on the in-memory campaign. Persisted only when
    the campaign is next saved (a night boundary), like everything else here. */
export function setEnvironmentFlag(campaign, key, value = true) {
  if (!campaign || !key) return;
  if (!campaign.environmentFlags || typeof campaign.environmentFlags !== 'object') {
    campaign.environmentFlags = {};
  }
  campaign.environmentFlags[key] = value;
}

/**
 * The Story consequence layer: turn what has happened in the campaign into
 * facts about the store. Called at a night boundary, on the in-memory
 * campaign, BEFORE the save -- so a consequence earned by finishing a night
 * is written with that night and rolls back with a failed one.
 *
 * It reads campaign STATE, never the calendar: the floodlight answers Cheryl
 * having complained twice (her encounter is the complaint), not "night >= 7".
 * A later branch could set the same flag from a different cause and the rest
 * of the game would not know the difference. Idempotent -- setting a flag that
 * is already true is a no-op -- and it consumes no RNG.
 */
export function applyStoryConsequences(campaign, completedNight = 0) {
  if (!campaign) return;

  /* The landlord finally responds. Cheryl's encounter IS the dark-lot
     complaint; two of them (Night 2, then her Night 6 return) is enough that
     something gets done between shifts. State, not night number. */
  if (getCustomerState(campaign, 'MANAGER').encounters >= 2) {
    setEnvironmentFlag(campaign, 'rearFloodlightInstalled', true);
  }

  /* The popcorn incident leaves two marks: a corporate notice taped up where
     the clerk will see it, and a butter stain the mop never quite got. Both
     follow from having actually dealt with Little Ricky once. */
  if (getCustomerState(campaign, 'POPCORN').encounters >= 1) {
    setEnvironmentFlag(campaign, 'popcornNoticePosted', true);
    setEnvironmentFlag(campaign, 'popcornStainLeft', true);
  }

  /* The investigation. All of it keys off real arrest history, never the
     calendar -- "has the player actually caught someone" -- so a run that
     reached the same night by a different route reads differently, and a
     failed night that never banked its arrest never sets any of it. */
  const arrests = (campaign.stats && campaign.stats.arrests) | 0;
  if (arrests >= 1) {
    // The paper runs it. The clipping goes up behind the counter -- the
    // comfortable proof that it was handled, which a later bulletin will make
    // uncomfortable.
    setStoryFlag(campaign, 'firstArrestMade', true);
    setEnvironmentFlag(campaign, 'arrestClippingPosted', true);
  }
  /* The second case is "open" once the player has actually worked a night at
     or past the escalation point with an arrest already behind them -- i.e.
     they have met the threat that should not have still been out there. */
  if (arrests >= 1 && completedNight >= SECOND_THREAT_NIGHT) {
    setStoryFlag(campaign, 'secondCaseOpened', true);
  }

  /* Act II is behind the player the night the second problem is worked,
     whichever way the campaign got there -- with an arrest or without one. A
     single structural marker, banked at the boundary like the rest and rolled
     back with a failed night, so Nights 9-12 can ask "is Act II done" without
     caring how it went. */
  if (completedNight >= SECOND_THREAT_NIGHT) {
    setStoryFlag(campaign, 'actTwoComplete', true);
  }
}

/* ============================================================
   THE INVESTIGATION

   Story Mode's long game. Stage 5 lays the first half: the player catches
   someone, the town relaxes, and then the thing they thought was finished
   walks back in. None of the answer lives here -- only the bookkeeping that
   lets the deputy, a bulletin, and a newspaper clipping quietly disagree with
   each other.

   Three plain-data pieces, all in the one save:
     storyFlags   what the campaign believes has happened (booleans, mostly).
     cases        a compact list of the player's successful arrests.
     stats.arrests the count the cooldown already kept.

   Everything reads STATE, not the night number, so retries and later
   branching behave.
   ============================================================ */

/* The night the second threat is authored to break the post-arrest quiet.
   A number, here, so the day it moves nothing else has to be told. */
export const SECOND_THREAT_NIGHT = 8;

/* The tape that keeps turning up. An obscure horror title already on the
   shelves (catalog.js) -- the deputy will tell the player the arrested man had
   asked after it, and later that the new one has too. It is a rental
   preference, which is the whole point: unsettling, and completely mundane. */
export const INVESTIGATION_TAPE = 'THE LAST CUSTOMER';

/* At most this many arrest rows are kept. The mystery needs the last one or
   two, not a ledger. */
const MAX_CASES = 6;

/* Only plain primitives survive in a flag bag -- same rule as the environment
   bag, for the same reason. */
function normalizeStoryFlags(bag) {
  const out = {};
  if (bag && typeof bag === 'object') {
    for (const k of Object.keys(bag)) {
      const v = bag[k];
      const t = typeof v;
      if (t === 'boolean' || t === 'number' || t === 'string' || v === null) out[k] = v;
    }
  }
  return out;
}

/** One arrest row, coerced to a compact, safe shape. Anything odd becomes a
    blank field rather than a landmine three nights later. */
function normalizeCase(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const s = (v) => (typeof v === 'string' ? v : '');
  const p = (raw && typeof raw.profile === 'object') ? raw.profile : {};
  return {
    night: (typeof r.night === 'number' && r.night >= 0) ? Math.floor(r.night) : 0,
    result: s(r.result) || 'arrested',
    name: s(r.name),
    alias: s(r.alias),
    signatureTape: s(r.signatureTape),
    profile: {
      gender: s(p.gender), height: s(p.height), build: s(p.build),
      hair: s(p.hair), jacket: s(p.jacket),
    },
  };
}

/** Normalize the whole list on load; drop anything that is not a row. */
function normalizeCases(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-MAX_CASES).map(normalizeCase);
}

/** Read one story flag, or `dflt` (false) if never set. Blank for any
    campaign with no bag -- which is every non-Story run. */
export function getStoryFlag(campaign, key, dflt = false) {
  if (!campaign || !campaign.storyFlags || !key) return dflt;
  const v = campaign.storyFlags[key];
  return (v === undefined) ? dflt : v;
}

/** A shorter read alias, for call sites that just want the truthiness. */
export function storyFlag(campaign, key) { return getStoryFlag(campaign, key, false); }

/** Set one story flag on the in-memory campaign. Persisted only at the next
    boundary save, like everything else here. */
export function setStoryFlag(campaign, key, value = true) {
  if (!campaign || !key) return;
  if (!campaign.storyFlags || typeof campaign.storyFlags !== 'object') campaign.storyFlags = {};
  campaign.storyFlags[key] = value;
}

/**
 * Record a successful Story arrest. Compact plain data only -- a few traits
 * and the tape -- never the runtime killer. In-memory; the boundary save
 * persists it, so an arrest on a night the player then fails rolls back with
 * the night. De-duplicated by night so a re-played night cannot stack rows.
 */
export function recordCase(campaign, caseData) {
  if (!campaign) return;
  if (!Array.isArray(campaign.cases)) campaign.cases = [];
  const row = normalizeCase(caseData);
  if (campaign.cases.some((c) => c.night === row.night)) return;   // once per night
  campaign.cases.push(row);
  if (campaign.cases.length > MAX_CASES) campaign.cases = campaign.cases.slice(-MAX_CASES);
}

/**
 * The compact investigation picture the dialogue reads. Story only -- a
 * campaign with no history (or none at all, i.e. Graveyard/Casual) comes back
 * "nothing has happened", so a deputy line can never reference an arrest that
 * did not occur.
 *
 * `secondThreat` is decided by the caller (the night resolver knows whether
 * tonight is the authored escalation); this only reports what is on record.
 */
export function investigationState(campaign) {
  const arrests = (campaign && campaign.stats && campaign.stats.arrests) | 0;
  const cases = (campaign && Array.isArray(campaign.cases)) ? campaign.cases : [];
  const last = cases.length ? cases[cases.length - 1] : null;
  return {
    priorArrests: arrests,
    caughtSomeone: arrests >= 1,
    cases: cases.slice(),
    lastCase: last,
    signatureTape: INVESTIGATION_TAPE,
    secondCaseOpened: storyFlag(campaign, 'secondCaseOpened') === true,
  };
}

/**
 * State-aware night policy on top of the static nightConfig. The one place a
 * Story night's threat can depend on what the player has already done rather
 * than on the calendar.
 *
 * Today it authors exactly one beat: the second threat. On the escalation
 * night, IF the player has already caught someone, the killer is forced and
 * the post-arrest quiet is deliberately overridden -- this is the night the
 * quiet ends. With no prior arrest there is nothing to contradict, so it
 * returns nothing and the night stays as the base config and cooldown left it.
 *
 * Returns overrides only; an empty object means "no change". Never forces an
 * `appears`-stub: forcing the killer here runs through the same FORCED policy
 * that builds a full plan.
 */
export function investigationPolicy(campaign, n) {
  if (!campaign) return {};
  const arrests = (campaign.stats && campaign.stats.arrests) | 0;
  if (n === SECOND_THREAT_NIGHT && arrests >= 1) {
    return {
      killerPolicy: POLICY.FORCED,
      calmOverride: false,        // the quiet is over
      standDownOverride: false,
      secondThreat: true,
    };
  }
  return {};
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

  // v1 -> v2: nothing to translate. v1 already carried customerStates:{}
  // (Stage 1 shipped the empty bag), so a v1 save simply reads forward with
  // nobody remembered yet. normalizeCustomerStates below handles the bag for
  // every version, including a v2 save whose entries got mangled.

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
    /* Story flags: only plain facts survive, same as the environment bag. A v2
       save simply had few of them; nothing is lost. */
    storyFlags: normalizeStoryFlags(data.storyFlags),
    /* Not a plain merge: every entry is normalized, so a save with a bad or
       missing memory bag comes back with a clean one rather than a shape the
       dialogue code has to guard against. */
    customerStates: normalizeCustomerStates(data.customerStates),
    /* Same treatment: only plain facts survive, so a save whose environment
       bag was hand-edited or carries a stray object cannot crash a shift. */
    environmentFlags: normalizeEnvironmentFlags(data.environmentFlags),
    /* The arrest list (v3+). A v2 save has none, and reads back as an empty
       file; a mangled list normalizes row by row rather than crashing. */
    cases: normalizeCases(data.cases),
  };
}
