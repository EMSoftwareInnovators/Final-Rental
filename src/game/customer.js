/* ============================================================
   customer.js -- one person, from the moment they step off the
   sidewalk to the moment they walk back into the dark.
   ============================================================ */
import { angleTowards, dist } from '../engine/mathx.js';
import { collide, SHELVES, SPOTS } from './world.js';
import { navPath } from './nav.js';
import { makeAnim, updateAnim } from './actor.js';
import { randomAppearance, randomName, paintSkin, VISIBLE_KEYS } from './appearance.js';
import { pickPersonality, line } from './personality.js';
import { GENRES, makeTape, tapeLabel } from './tapes.js';
import { LOST_PREMISES, DIM_PREMISES } from './dialogue.js';

export const CS = {
  ARRIVING: 'ARRIVING', ENTERING: 'ENTERING', BROWSING: 'BROWSING', PICKING: 'PICKING',
  TO_COUNTER: 'TO_COUNTER', WAITING: 'WAITING', TALKING: 'TALKING',
  LEAVING: 'LEAVING', GONE: 'GONE',
};

let nextId = 1;

export function createCustomer(rng, opts = {}) {
  const app = opts.app || randomAppearance(rng);
  const personality = opts.personality || pickPersonality(rng);
  const c = {
    id: nextId++,
    name: opts.name || randomName(rng, app.gender),
    app,
    personality,
    skin: paintSkin(app),
    portraitDirty: true,
    x: SPOTS.street.x + rng.range(-2.4, 2.4), y: 0, z: SPOTS.street.z + rng.range(-0.5, 0.5),
    yaw: 0,
    r: 0.30,
    anim: makeAnim(),
    speed: 1.28 * personality.speed * (app.gait.speed || 1),
    state: CS.ARRIVING,
    path: null, pathI: 0,
    timer: 0,
    moveSpeed: 0,

    intent: opts.intent || 'RENT',
    script: null,
    tape: opts.tape || null,
    wantGenre: opts.wantGenre || personality.prefers || rng.pick(GENRES),
    hasMoney: opts.hasMoney !== undefined ? opts.hasMoney
      : !personality.alwaysBroke && rng() < personality.wealth,

    mood: 100,
    moodMax: 100,
    resolvedAnger: false,
    saidSmallTalk: false,
    gaveTape: false,
    feeSettled: false,
    checkedOut: false,
    served: false,
    flareTimer: 4 + rng() * 8,
    barked: 0,

    isKiller: !!opts.isKiller,
    observed: new Set(),
    talkedTo: false,
    smelled: false,

    slotIndex: -1,
    queueIndex: -1,
    _stepSide: 0, _stepTimer: 0,
  };
  c.phoneLabel = `The one in the ${app.jacket.color.name} ${app.jacket.kind}`;
  if (c.intent === 'RETURN' || c.intent === 'BOTH') {
    c.tape = c.tape || makeTape(rng.pick(GENRES), rng, {
      rewound: rng.chance(0.42),
      daysLate: rng.chance(0.45) ? 1 + rng.int(4) : 0,
    });
    c.script = 'return';
  } else {
    c.script = 'rent';
  }
  // Some people are not here for any of that.
  if (personality.confused) {
    c.script = 'confused';
    const table = personality.confused === 'lost' ? LOST_PREMISES : DIM_PREMISES;
    c.premise = rng.pick(Object.keys(table));
    c.browsesFirst = personality.confused === 'dim' && rng.chance(0.6);
    // the ones in the wrong building are not carrying one of your tapes
    if (personality.confused === 'lost') c.tape = null;
    else if (c.premise === 'wedding' || c.premise === 'otherchain') {
      c.tape = makeTape(rng.pick(GENRES), rng, { rewound: rng.chance(0.3), daysLate: 0 });
      c.browsesFirst = false;
    }
  }
  return c;
}

/* ---------------- movement ---------------- */
function setDest(c, x, z, ctx) {
  c.path = navPath(c.x, c.z, x, z, ctx.solids, c.r + 0.06);
  c.pathI = 0;
}

function step(c, dt, ctx) {
  c.moveSpeed = 0;
  if (!c.path || c.pathI >= c.path.length) return true;
  const wp = c.path[c.pathI];
  const dx = wp.x - c.x, dz = wp.z - c.z;
  const d = Math.hypot(dx, dz);
  const last = c.pathI === c.path.length - 1;
  if (d < (last ? 0.16 : 0.34)) {
    c.pathI++;
    if (c.pathI >= c.path.length) { c.path = null; return true; }
    return false;
  }
  const sp = c.speed * (c.rushing ? 1.5 : 1);
  const nx = c.x + (dx / d) * sp * dt;
  const nz = c.z + (dz / d) * sp * dt;
  const [px, pz] = collide(nx, nz, c.r, ctx.solids, ctx.doorPassable(c));
  const moved = Math.hypot(px - c.x, pz - c.z);
  c.x = px; c.z = pz;
  c.moveSpeed = moved / Math.max(dt, 0.0001);
  if (d > 0.05) c.yaw = angleTowards(c.yaw, Math.atan2(dx, dz), dt * 7.5);
  // footsteps
  c._stepTimer -= dt * Math.max(0.2, c.moveSpeed);
  if (c._stepTimer <= 0) {
    c._stepTimer = 0.62;
    ctx.footstep(c);
  }
  return false;
}

/* ---------------- per-frame update ---------------- */
export function updateCustomer(c, dt, ctx) {
  const rng = ctx.rng;

  switch (c.state) {
    case CS.ARRIVING: {
      if (!c.path) setDest(c, SPOTS.outsideDoor.x + (c.id % 3 - 1) * 0.25, SPOTS.outsideDoor.z, ctx);
      if (step(c, dt, ctx)) {
        if (ctx.doorLocked) {
          c.timer += dt;
          c.yaw = angleTowards(c.yaw, 0, dt * 4);
          if (c.timer > 1.0 && !c.knocked) { c.knocked = true; ctx.knock(c); }
          if (c.timer > 7) { c.state = CS.LEAVING; c.path = null; c.timer = 0; ctx.lockedOut(c); }
        } else {
          c.state = CS.ENTERING; c.path = null; c.timer = 0;
          ctx.openDoor(c);
        }
      }
      break;
    }

    case CS.ENTERING: {
      if (!c.path) setDest(c, SPOTS.door.x, SPOTS.door.z + 0.9, ctx);
      if (step(c, dt, ctx)) {
        const browses = c.script === 'rent' || c.browsesFirst;
        if (browses) { c.state = CS.BROWSING; c.path = null; c.timer = 0; }
        else { c.state = CS.TO_COUNTER; c.path = null; }
      }
      break;
    }

    case CS.BROWSING: {
      /* People do not walk in knowing what they want. They drift to a
         section, read the backs of a few boxes, pull one out, turn it over,
         put it back, and try somewhere else. The picky ones do that three
         times before they settle.                                          */
      if (!c.browse) {
        c.browse = {
          visits: 1 + rng.int(rng.chance(0.45) ? 3 : 2),
          seen: 0, phase: 'GOTO', t: 0, shelf: null, spot: null,
        };
        c.browse.genre = c.wantGenre;
      }
      const B = c.browse;
      B.t += dt;

      if (B.phase === 'GOTO') {
        if (!B.shelf) {
          B.shelf = SHELVES.find((s) => s.genre === B.genre) || SHELVES[rng.int(SHELVES.length)];
          B.spot = B.shelf.browse[rng.int(B.shelf.browse.length)];
          setDest(c, B.spot.x, B.spot.z, ctx);
        }
        if (step(c, dt, ctx)) { B.phase = 'SCAN'; B.t = 0; B.dur = 2.4 + rng() * c.personality.browse * 0.45; }
        break;
      }

      c.yaw = angleTowards(c.yaw, B.spot.yaw, dt * 4);

      if (B.phase === 'SCAN') {
        // eyes tracking along the spines
        c.anim.headYaw = Math.sin(B.t * 1.15) * 0.46;
        c.anim.headPitch = -0.10 + Math.sin(B.t * 0.74) * 0.22;
        if (B.t > B.dur) {
          B.phase = 'PULL'; B.t = 0;
          c.anim.headYaw = 0; c.anim.headPitch = 0;
        }
      } else if (B.phase === 'PULL') {
        c.anim.headPitch = -0.05;
        if (B.t > 0.65) {
          c.tape = makeTape(B.shelf.genre, rng, { rewound: true });
          c.tape.heldBy = c.id;
          ctx.tookFromShelf(c);
          B.phase = 'READ'; B.t = 0; B.dur = 1.9 + rng() * 2.6;
        }
      } else if (B.phase === 'READ') {
        // holding it up, reading the back
        c.anim.headPitch = 0.16;
        c.anim.headYaw = Math.sin(B.t * 0.6) * 0.08;
        if (B.t > B.dur) {
          B.seen++;
          const lastChance = B.seen >= B.visits;
          const keep = lastChance || rng() < 0.30 + B.seen * 0.22;
          if (keep) {
            c.anim.headPitch = 0;
            ctx.chose(c);
            c.state = CS.TO_COUNTER; c.path = null; c.timer = 0;
          } else {
            B.phase = 'PUTBACK'; B.t = 0;
          }
        }
      } else if (B.phase === 'PUTBACK') {
        c.anim.headPitch = -0.05;
        if (B.t > 0.6) {
          c.tape = null;
          ctx.putBack(c);
          // try somewhere else -- often a different section entirely
          B.genre = rng.chance(0.55) ? rng.pick(GENRES) : B.genre;
          B.shelf = null; B.spot = null;
          B.phase = 'GOTO'; B.t = 0;
          c.anim.headPitch = 0; c.anim.headYaw = 0;
        }
      }
      break;
    }

    case CS.TO_COUNTER: {
      if (!c.path) {
        const spot = ctx.claimCounterSpot(c);
        c.targetSpot = spot;
        setDest(c, spot.x, spot.z, ctx);
      }
      if (step(c, dt, ctx)) { c.state = CS.WAITING; c.path = null; }
      break;
    }

    case CS.WAITING: {
      // people shuffle forward as the queue moves
      const spot = ctx.claimCounterSpot(c);
      if (spot !== c.targetSpot || dist(c.x, c.z, spot.x, spot.z) > 0.5) {
        c.targetSpot = spot;
        setDest(c, spot.x, spot.z, ctx);
        step(c, dt, ctx);
        break;
      }
      c.yaw = angleTowards(c.yaw, c.queueIndex === 0 ? 0 : 0.2, dt * 4);
      if (c.awaitingChange) {
        // they are not going anywhere until the drawer opens
        c.changeTimer = (c.changeTimer || 0) + dt;
        c.mood -= (100 / c.personality.patience) * 0.55 * dt;
        if (c.changeTimer > 60) {
          ctx.stiffed(c);
          c.awaitingChange = false; c.changeDue = 0;
          c.mood = 0; c.wentAngry = true;
          ctx.wentAngry(c);
          c.leaving = true; c.state = CS.LEAVING; c.path = null; ctx.releaseCounterSpot(c);
        }
        break;
      }
      if (c.served) {
        c.doneTimer = (c.doneTimer || 0) + dt;
        if (c.doneTimer > 10) { c.leaving = true; c.state = CS.LEAVING; c.path = null; ctx.releaseCounterSpot(c); }
        break;
      }
      {
        const rate = (100 / c.personality.patience) * (c.queueIndex === 0 ? 1 : 0.55);
        c.mood -= rate * dt;
        // minor grievances: some people just need something to be annoyed about
        c.flareTimer -= dt;
        if (c.flareTimer <= 0) {
          c.flareTimer = 7 + rng() * 10;
          if (rng() < c.personality.irascibility * 0.55) {
            c.mood -= 9 + rng() * 12;
            ctx.grumble(c);
          }
        }
        if (c.mood <= 0 && !c.wentAngry) {
          c.wentAngry = true; c.mood = 0;
          ctx.wentAngry(c);
        }
      }
      break;
    }

    case CS.TALKING: {
      c.yaw = angleTowards(c.yaw, Math.atan2(ctx.player.x - c.x, ctx.player.z - c.z), dt * 5);
      break;
    }

    case CS.LEAVING: {
      if (!c.path) {
        ctx.releaseCounterSpot(c);
        setDest(c, SPOTS.street.x + (c.id % 5 - 2) * 1.1, SPOTS.street.z - 1.2, ctx);
      }
      if (step(c, dt, ctx)) { c.state = CS.GONE; ctx.despawn(c); }
      else if (c.z < 0.2 && !c.exited) { c.exited = true; ctx.openDoor(c); }
      break;
    }
    default: break;
  }

  const talking = c.state === CS.TALKING && ctx.speaking === c;
  const reading = c.state === CS.BROWSING && c.browse
    && (c.browse.phase === 'READ' || c.browse.phase === 'PULL' || c.browse.phase === 'PUTBACK');
  updateAnim(c.anim, dt, c.moveSpeed, c.app, {
    talking,
    reading,
    reach: c.state === CS.TALKING && c.tape && !c.gaveTape && !c.checkedOut,
    headYaw: c.anim.headYaw, headPitch: c.anim.headPitch,
  });
  c.reading = reading;

  // proximity reveals what you cannot see from across the room
  if (!c.smelled && dist(c.x, c.z, ctx.player.x, ctx.player.z) < 1.9) {
    c.smelled = true; c.observed.add('smell');
  }
}

/** The player looked at them long enough to take in the obvious things. */
export function observeVisible(c) {
  for (const k of VISIBLE_KEYS) c.observed.add(k);
}

export function moodLabel(c) {
  if (c.mood > 72) return { text: 'CONTENT', cls: 'ok' };
  if (c.mood > 42) return { text: 'WAITING', cls: '' };
  if (c.mood > 16) return { text: 'IMPATIENT', cls: '' };
  if (c.mood > 0) return { text: 'ABOUT TO BLOW', cls: 'warn' };
  return { text: 'FURIOUS', cls: 'warn' };
}

export function customerSummary(c) {
  const bits = [];
  if (c.script === 'return' && c.tape) {
    bits.push(`returning ${tapeLabel(c.tape)}`);
    if (c.tape.daysLate) bits.push(`${c.tape.daysLate} day${c.tape.daysLate > 1 ? 's' : ''} late`);
  } else if (c.tape) bits.push(`renting ${tapeLabel(c.tape)}`);
  else bits.push('browsing');
  return bits.join(' - ');
}

export function bark(c, key, rng) { return line(c, key, rng, '...'); }
