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

/** How far along the pavement somebody has to get before they stop existing.
    The storefront glass ends at x = 0 and x = 13, so this is comfortably
    past the frame from anywhere inside the shop. */
const DESPAWN_X = 11.5;

export const CS = {
  ARRIVING: 'ARRIVING', ENTERING: 'ENTERING', BROWSING: 'BROWSING', PICKING: 'PICKING',
  TO_COUNTER: 'TO_COUNTER', WAITING: 'WAITING', TALKING: 'TALKING',
  /** doing whatever they came in to do instead of shopping */
  ACTING: 'ACTING',
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

/**
 * One of the regulars nobody wants.
 *
 * Same face, same coat, same problem, every time they turn up -- so the
 * appearance and personality come straight off the roster rather than
 * being rolled, and they carry an `act`: a thing they do in the shop
 * instead of queueing politely.
 */
export function makeSpecial(rng, sp) {
  const c = createCustomer(rng, {
    app: sp.app,
    personality: sp.personality,
    name: sp.name,
    intent: sp.script === 'WRONGSTORE' ? 'RETURN' : 'RENT',
    hasMoney: sp.wealth > 0.5,
  });
  c.special = sp.id;
  c.act = sp.act || null;
  c.specialScript = sp.script || null;
  c.nuisance = sp.nuisance || null;
  c.complaints = sp.complaints || null;
  c.blocksLine = !!sp.blocksLine;
  c.asked = 0;                 // how many times you have asked them to go
  c.actTimer = 0;
  // He arrives with it under one arm and does not put it down until he
  // reaches his spot.
  if (sp.act === 'DANCE') { c.carrying = 'BOOMBOX'; c.rigUp = false; c.setupT = 0; }
  // All of them run their own tree rather than the ordinary rent/return one.
  c.script = 'special';
  // Only the man who wandered in with somebody else's tape is carrying
  // anything; the rest are not here to rent and never browse for one.
  if (sp.script !== 'WRONGSTORE') c.tape = null;
  return c;
}

/**
 * Is the shop currently unbearable?
 *
 * Two of the regulars make the place genuinely hard to stand in -- the one
 * who has not washed and the one who smells like a bonfire in a hedge. An
 * ordinary customer will keep shopping, at a distance, but will not walk up
 * to a counter and hold a conversation next to it. Nobody checks out and
 * nobody hands a tape back until whoever it is has gone.
 */
function repelled(c, ctx) {
  if (c.special || c.isKiller || c === ctx.officer) return false;
  return ctx.stenchActive();
}

/* Where each act happens. */
const ACT_SPOT = {
  DANCE: { x: 6.6, z: 3.4, yaw: Math.PI },
  TV: { x: 2.3, z: 2.8, yaw: -0.9 },
  LINGER: null,          // wanders the shelves
  AUDIT: null,           // wanders the shelves, slowly, tutting
  PHONE: { x: 8.4, z: 4.6, yaw: 0.4 },
  /* At the end of the counter, alongside the window rather than in front of
     it. He is in the way, which is the point, but the line can still move
     past him -- he used to take the head of the queue and hold it, and
     since nothing could ever be sold to him, the queue behind him never
     moved again for the rest of the night. */
  WINDOW: { x: 11.6, z: 0.62, yaw: -0.55 },
};

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

/**
 * Close the last bit by hand.
 *
 * A route can run out short of where it was going -- somebody standing on
 * the end of it, a corner the graph does not describe -- and a customer who
 * only ever moves along a route then stands wherever it stopped. Usually
 * that is against the counter, a foot from the window, close enough to look
 * like they are at it and far enough that they are not. This walks the
 * remaining gap directly, sliding off whatever is in the way.
 */
function directStep(c, dt, ctx, to) {
  const dx = to.x - c.x, dz = to.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.02) return true;
  const sp = c.speed * 0.85;
  const nx = c.x + (dx / d) * Math.min(d, sp * dt);
  const nz = c.z + (dz / d) * Math.min(d, sp * dt);
  const [px, pz] = collide(nx, nz, c.r, ctx.solids, ctx.doorPassable(c));
  const moved = Math.hypot(px - c.x, pz - c.z);
  c.x = px; c.z = pz;
  c.moveSpeed = moved / Math.max(dt, 0.0001);
  if (d > 0.05) c.yaw = angleTowards(c.yaw, Math.atan2(dx, dz), dt * 6);
  return d < 0.02;
}

/* ---------------- per-frame update ---------------- */
export function updateCustomer(c, dt, ctx) {
  const rng = ctx.rng;
  /* Standing still is the default.

     step() was the only thing that ever zeroed this, so the moment somebody
     stopped being walked anywhere -- settled on their place in the queue,
     say -- their last recorded speed stayed on the books forever, and the
     rig kept playing the walk cycle at it. Anybody who had hurried to the
     counter stood at the window sprinting on the spot for the rest of the
     night. Whoever moves this frame will say so; everybody else is still. */
  c.moveSpeed = 0;
  if (c.stenchGripe > 0) c.stenchGripe -= dt;
  // The two who will not be told go back to what they were doing between
  // goes, and are not listening again for a while.
  if (c.brushT > 0) c.brushT -= dt;

  /* Somebody who is owed change goes to the window and stays there. It used
     to be handled inside the queue state alone, which meant anyone paid
     anywhere else -- a special, mid-floor -- was owed money in a state that
     had no idea what to do about it, and simply wandered off with it. */
  if (c.awaitingChange && c.changeDue > 0.001
    && c.state !== CS.WAITING && c.state !== CS.TALKING && c.state !== CS.TO_COUNTER
    && c.state !== CS.LEAVING && c.state !== CS.GONE) {
    // Only if they are not already on their way. Redirecting somebody who
    // is already walking there tears up their route every frame.
    c.state = CS.TO_COUNTER; c.path = null; c.timer = 0;
  }

  switch (c.state) {
    case CS.ARRIVING: {
      // Spread along the pavement rather than stacking on one flagstone --
      // on a busy night the queue outside jams itself before the door does.
      if (!c.path) {
        setDest(c, SPOTS.outsideDoor.x + (c.id % 5 - 2) * 0.34,
          SPOTS.outsideDoor.z - (c.id % 3) * 0.28, ctx);
      }
      c.arriveT = (c.arriveT || 0) + dt;
      // If somebody is standing where they were headed, close enough.
      if (step(c, dt, ctx) || (c.arriveT > 6 && !ctx.doorLocked)) {
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
      // Fan out a little on the way in. On a busy night a dozen people all
      // aiming at the same tile inside the door simply wedge there.
      if (!c.path) {
        setDest(c, SPOTS.door.x + (c.id % 5 - 2) * 0.22, SPOTS.door.z + 0.9 + (c.id % 3) * 0.2, ctx);
      }
      c.timer += dt;
      // Wherever they got to, they are inside now.
      if (step(c, dt, ctx) || c.timer > 5) {
        c.path = null; c.timer = 0;
        if (c.act) { c.state = CS.ACTING; }
        else if (c.script === 'rent' || c.browsesFirst) c.state = CS.BROWSING;
        else if (repelled(c, ctx)) c.state = CS.BROWSING;
        else c.state = CS.TO_COUNTER;
      }
      break;
    }

    /* ---- the ones who came in to do something else ---- */
    case CS.ACTING: {
      c.actTimer += dt;
      /* Nobody stays all night. Even the ones you never speak to run out of
         whatever brought them in -- otherwise a player who decides to
         ignore one is stuck with him until closing forces the issue. */
      if (c.actTimer > (c.special === 'SOVEREIGN' ? 600 : 420)) {
        ctx.storm(c);
        break;
      }
      const spot = ACT_SPOT[c.act];
      if (spot) {
        if (!c.path && !c.parked && dist(c.x, c.z, spot.x, spot.z) > 0.4) {
          setDest(c, spot.x, spot.z, ctx);
          c.walkT = 0;
        }
        if (c.path) {
          c.walkT = (c.walkT || 0) + dt;
          // Somebody is in the way and is not moving. Near enough is near enough.
          if (step(c, dt, ctx) || c.walkT > 12) { c.path = null; c.parked = true; }
          else break;
        }
        c.yaw = angleTowards(c.yaw, spot.yaw, dt * 3);
        c.moveSpeed = 0;
        /* He does not start dancing the moment he arrives. He is carrying
           the thing: he has to crouch, put it down, find the switch, and
           stand back up. The music starts when it starts, not before. */
        if (c.act === 'DANCE' && !c.rigUp) {
          c.setupT = (c.setupT || 0) + dt;
          if (c.setupT > 2.6) { c.rigUp = true; ctx.boomboxDown(c); }
          break;
        }
      } else {
        // no fixed spot: drift along the shelves indefinitely
        if (!c.path) {
          const sh = SHELVES[rng.int(SHELVES.length)];
          const b = sh.browse[rng.int(sh.browse.length)];
          setDest(c, b.x, b.z, ctx);
          c.actSpot = b;
        }
        if (step(c, dt, ctx)) { c.path = null; c.dwell = 3 + rng() * 6; }
        if (c.actSpot && !c.path) {
          c.yaw = angleTowards(c.yaw, c.actSpot.yaw, dt * 3);
          c.dwell -= dt;
          if (c.dwell <= 0) c.actSpot = null;
        }
      }
      /* He is at the television, and every so often something on a shelf
         occurs to him. He goes and gets it, brings it back, and by the time
         he is back he has no idea why he is holding it. */
      if (c.act === 'TV' && !c.errand) {
        c.errandT = (c.errandT || 30 + rng() * 40) - dt;
        if (c.errandT <= 0 && !c.tape) {
          const sh = SHELVES[rng.int(SHELVES.length)];
          const b = sh.browse[rng.int(sh.browse.length)];
          c.errand = { shelf: sh, spot: b, phase: 'GO' };
          c.parked = false;
          setDest(c, b.x, b.z, ctx);
        }
      }
      /* He has been holding it for a while now and has no idea why. It goes
         in the returns bin, which makes it the clerk's problem -- and he
         does that whether or not anybody ever gets him out of the shop. */
      if (c.act === 'TV' && c.tape && !c.errand) {
        c.holdT = (c.holdT || 0) + dt;
        if (c.holdT > 55) { c.holdT = 0; c.binRun = { phase: 'GO' }; }
      }
      if (c.binRun) {
        const B = ctx.binSpot();
        if (!c.path && dist(c.x, c.z, B.x, B.z) > 0.7) setDest(c, B.x, B.z, ctx);
        B.t = 0;
        c.binRun.t = (c.binRun.t || 0) + dt;
        if (c.path && !step(c, dt, ctx) && c.binRun.t < 20) { performAct(c, dt); break; }
        c.path = null;
        if (c.tape) ctx.binTape(c.tape, c);
        c.binRun = null;
        c.parked = false;
        performAct(c, dt);
        break;
      }
      if (c.errand) {
        const E = c.errand;
        if (E.phase === 'GO') {
          if (step(c, dt, ctx)) {
            c.tape = makeTape(E.shelf.genre, rng, { rewound: true });
            c.tape.heldBy = c.id;
            ctx.tookFromShelf(c);
            ctx.stonerTook(c);
            E.phase = 'BACK';
            c.path = null; c.parked = false;
          }
          performAct(c, dt);
          break;
        }
        // back to the screen, still holding it, no longer sure why
        const home = ACT_SPOT[c.act];
        if (!c.path && dist(c.x, c.z, home.x, home.z) > 0.4) setDest(c, home.x, home.z, ctx);
        if (c.path) { step(c, dt, ctx); performAct(c, dt); break; }
        c.errand = null;
        c.errandT = 90 + rng() * 90;
        c.parked = true;
      }
      // the performance itself, in the animation
      performAct(c, dt);
      // they are a nuisance, and the room notices
      if (c.nuisance) {
        c.gripeT = (c.gripeT || 6 + rng() * 6) - dt;
        if (c.gripeT <= 0) { c.gripeT = 9 + rng() * 10; ctx.nuisanceGripe(c); }
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
          if (keep && repelled(c, ctx)) {
            /* They have picked something and they are not going anywhere
               near the counter with THAT in the building. They hang back
               and wait it out. */
            B.phase = 'GOTO'; B.shelf = null; B.spot = null; B.t = 0; B.seen = 0;
            c.path = null;
            if (!c.stenchGripe || c.stenchGripe <= 0) {
              c.stenchGripe = 12 + rng() * 12;
              ctx.stenchHoldsOff(c);
            }
          } else if (keep) {
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
      /* You do not have a place in the line until you reach the line.

         This used to claim a place the moment somebody decided to head for
         the counter, so a man who set off first from the far end of the
         shop held first place while somebody standing next to the till
         walked up and got put behind him. A queue is decided by who gets
         there, not by who thought of it first. */
      const tail = ctx.lineTail(c);
      /* Re-aim only when the back of the line has actually moved. Rebuilding
         the path every half second restarted it at its first waypoint, which
         for anybody already under way is behind them -- so they shuffled on
         the spot and never arrived anywhere. */
      const moved = !c.tailAt || Math.hypot(c.tailAt.x - tail.x, c.tailAt.z - tail.z) > 0.35;
      if (!c.path || moved) {
        setDest(c, tail.x, tail.z, ctx);
        c.tailAt = { x: tail.x, z: tail.z };
        c.approachBest = undefined; c.approachT = 0;
      }
      /* And a backstop. If the walk to the back of the line cannot be
         completed -- somebody parked in the way, a route that will not
         resolve -- they join it from where they are rather than grinding
         against a counter for the rest of the night. WAITING walks them to
         their proper place from wherever that turns out to be.

         It has to be a backstop against a walk that is not happening, not
         against a walk that is taking a while. Nine seconds flat is less
         than it takes somebody slow to cross the shop from the far corner,
         so they claimed a place in the line from over by the horror shelf
         and then covered the rest of the floor already standing in it --
         holding first place against somebody stood at the till, which is
         the opposite of what a queue is for. Closing real ground resets
         it; only genuinely getting nowhere runs it out. */
      const gap = dist(c.x, c.z, tail.x, tail.z);
      if (c.approachBest === undefined || gap < c.approachBest - 0.3) {
        c.approachBest = gap; c.approachT = 0;
      }
      c.approachT = (c.approachT || 0) + dt;
      const arrived = step(c, dt, ctx);
      if (arrived || gap < 0.8 || c.approachT > 9) {
        ctx.claimCounterSpot(c);
        c.state = CS.WAITING; c.path = null; c.tailAt = null;
        c.approachT = 0; c.approachBest = undefined;
      }
      break;
    }

    case CS.WAITING: {
      // people shuffle forward as the queue moves
      const spot = ctx.claimCounterSpot(c);
      /* Compare the place, not the object.

         Only the person at the window gets handed the same object twice;
         everybody further back is handed a freshly built one on every
         single frame, so an identity test said "your spot has changed"
         thirty times a second, tore up the route each time, and left them
         walking on the spot at the counter forever. Which is the customer
         who would not stop shuffling next to the till.

         Settle properly on it, too. Half a metre of slack was fine when
         people walked all the way to the spot before joining the line; now
         that they join it from wherever they reach it, that slack is where
         they stayed -- out of reach of somebody looking straight at the
         place they are supposed to be standing. */
      const moved = !c.targetSpot || dist(c.targetSpot.x, c.targetSpot.z, spot.x, spot.z) > 0.05;
      const off = c.targetSpot ? dist(c.x, c.z, c.targetSpot.x, c.targetSpot.z) : Infinity;
      if (moved || off > 0.22) {
        if (moved) { c.targetSpot = { x: spot.x, z: spot.z }; c.shuffleT = 0; setDest(c, spot.x, spot.z, ctx); }
        c.shuffleT = (c.shuffleT || 0) + dt;
        /* Follow the route, and when it runs out before the spot does, walk
           the rest of the way directly. Giving up here was what left people
           parked against the counter a foot short of the window -- near
           enough to look served, far enough that they could not be. */
        if (step(c, dt, ctx)) directStep(c, dt, ctx, c.targetSpot);
        // and if it is taking absurdly long, try the route again from here
        if (c.shuffleT > 6) { c.shuffleT = 0; setDest(c, c.targetSpot.x, c.targetSpot.z, ctx); }
        break;
      }
      // Whatever they were hurrying for, they have arrived.
      c.rushing = false;
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
        c.mood = Math.max(0, c.mood - rate * dt);
        // minor grievances: some people just need something to be annoyed about
        c.flareTimer -= dt;
        if (c.flareTimer <= 0) {
          c.flareTimer = 7 + rng() * 10;
          if (rng() < c.personality.irascibility * 0.55) {
            c.mood = Math.max(0, c.mood - (9 + rng() * 12));
            ctx.grumble(c);
          }
        }
        /* Running out of patience has to end in them going.

           It used to fire once, set a flag, and stop -- and because the
           flag was the guard, nothing ever happened again. A queue whose
           head could not be served (a special parked at the window, say)
           stood there for the rest of the night with a mood of minus three
           hundred, and everybody behind it stood there too. Nobody in a
           video shop waits forever. */
        if (c.mood <= 0 && !c.wentAngry) {
          c.wentAngry = true;
          c.fuse = 18 + rng() * 22;
          ctx.wentAngry(c);
        } else if (c.wentAngry) {
          c.fuse -= dt;
          if (c.fuse <= 0) {
            if (c.tape && !c.checkedOut && c.script !== 'return') ctx.abandonTape(c);
            ctx.storm(c);
          }
        }
      }
      break;
    }

    case CS.TALKING: {
      c.yaw = angleTowards(c.yaw, Math.atan2(ctx.player.x - c.x, ctx.player.z - c.z), dt * 5);
      break;
    }

    case CS.LEAVING: {
      /* He does not leave without his music. He walks back to it, crouches,
         turns it off -- the shop goes quiet there, not the moment he agreed
         to go -- picks it up, and only then heads for the door. */
      if (c.packUp) {
        const B = c.packUp;
        if (B.phase === 'GO') {
          if (!c.path && dist(c.x, c.z, B.x, B.z) > 0.45) setDest(c, B.x, B.z, ctx);
          B.t = (B.t || 0) + dt;
          if (c.path && !step(c, dt, ctx) && B.t < 14) break;
          c.path = null;
          B.phase = 'STOP'; B.t = 0;
          c.yaw = angleTowards(c.yaw, Math.atan2(B.x - c.x, B.z - c.z), dt * 6);
        }
        // crouched over it, reaching for the switch
        B.t += dt;
        c.moveSpeed = 0;
        const k = Math.min(1, B.t / 0.5);
        c.anim.bob = -0.16 * k; c.anim.lean = 0.42 * k;
        c.anim.armL = 0.9 * k; c.anim.armR = 0.9 * k;
        c.anim.headPitch = 0.5 * k;
        if (!B.off && B.t > 0.9) { B.off = true; ctx.boomboxUp(c); }
        if (B.t > 1.9) {
          c.packUp = null;
          c.anim.bob = 0; c.anim.lean = 0; c.anim.headPitch = 0;
          c.anim.armL = 0; c.anim.armR = 0;
        }
        updateAnim(c.anim, dt, c.moveSpeed, c.app, { keep: true });
        break;
      }
      /* They used to stop a couple of paces past the kerb and blink out of
         existence in full view of the window. They now walk off down the
         pavement, left or right, and are only removed once they are past
         the edge of the storefront and well behind the glass. */
      if (!c.path) {
        ctx.releaseCounterSpot(c);
        if (!c.exitSide) c.exitSide = (c.id % 2) ? 1 : -1;
        setDest(c, SPOTS.street.x + c.exitSide * (2.0 + (c.id % 3) * 0.6), SPOTS.street.z - 0.7, ctx);
        c.leg = 1;
      }
      if (step(c, dt, ctx)) {
        if (c.leg === 1) {
          // turn along the pavement and keep going until they are gone
          c.leg = 2;
          setDest(c, SPOTS.street.x + c.exitSide * DESPAWN_X, SPOTS.street.z - 0.9, ctx);
        } else {
          c.state = CS.GONE; ctx.despawn(c);
        }
      } else if (c.z < 0.2 && !c.exited) { c.exited = true; ctx.openDoor(c); }
      // a hard backstop, in case a path ever fails to reach its end
      if (Math.abs(c.x - SPOTS.street.x) > DESPAWN_X + 1.5 || c.z < -6) {
        c.state = CS.GONE; ctx.despawn(c);
      }
      break;
    }
    default: break;
  }

  if (c.state === CS.ACTING && !c.path) {
    // performAct() owns the rig this frame; only the feet get the usual pass
    updateAnim(c.anim, dt, 0, c.app, { keep: true });
    c.reading = false;
    if (!c.smelled && dist(c.x, c.z, ctx.player.x, ctx.player.z) < 1.9) {
      c.smelled = true; c.observed.add('smell');
    }
    return;
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

/**
 * What an act looks like from across the shop.
 *
 * These are the only customers you can identify by silhouette alone,
 * which is the point of them: the dancing is visible from the counter.
 */
function performAct(c, dt) {
  const a = c.anim;
  c.actPhase = (c.actPhase || 0) + dt;
  const t = c.actPhase;
  switch (c.act) {
    case 'DANCE':
      if (!c.rigUp) {
        // crouched over it, both hands down, working the switch
        const k = Math.min(1, (c.setupT || 0) / 0.5);
        a.bob = -0.16 * k;
        a.lean = 0.42 * k;
        a.armL = 0.9 * k; a.armR = 0.9 * k;
        a.headPitch = 0.5 * k;
        a.armLz = 0.2 * k; a.armRz = -0.2 * k;
        break;
      }
      a.bob = Math.abs(Math.sin(t * 5.2)) * 0.09;
      a.lean = Math.sin(t * 2.6) * 0.16;
      a.armL = -1.5 + Math.sin(t * 5.2) * 1.1;
      a.armR = -1.5 + Math.sin(t * 5.2 + 2.1) * 1.1;
      a.armLz = Math.sin(t * 3.1) * 0.7;
      a.armRz = -Math.sin(t * 3.1) * 0.7;
      a.headYaw = Math.sin(t * 2.6) * 0.5;
      a.headPitch = Math.sin(t * 5.2) * 0.18;
      c.yaw += Math.sin(t * 0.9) * dt * 1.6;
      break;
    case 'TV':
      // absolutely still, head tipped back at the screen
      a.headPitch = -0.34 + Math.sin(t * 0.5) * 0.03;
      a.armL = -0.42 + Math.sin(t * 0.35) * 0.06;   // the hand comes up now and then
      a.armR = 0;
      a.bob = Math.sin(t * 0.6) * 0.006;
      break;
    case 'PHONE':
      a.armL = -2.3;                                 // handset clamped to the ear
      a.armLz = 0.5;
      a.headYaw = Math.sin(t * 0.8) * 0.35;
      a.lean = Math.sin(t * 0.5) * 0.06;
      break;
    case 'AUDIT':
      a.headPitch = 0.22 + Math.sin(t * 0.7) * 0.12;
      a.headYaw = Math.sin(t * 0.4) * 0.5;
      break;
    case 'WINDOW':
      // planted, one hand holding a folder up, the other making a point
      a.armL = -1.15 + Math.sin(t * 0.5) * 0.05;
      a.armLz = 0.30;
      a.armR = -0.35 + Math.sin(t * 1.7) * 0.55;
      a.armRz = -0.18;
      a.headPitch = 0.20 + Math.sin(t * 1.7) * 0.10;
      a.lean = Math.sin(t * 0.7) * 0.05;
      break;
    case 'LINGER':
    default:
      a.headPitch = 0.1 + Math.sin(t * 0.4) * 0.1;
      break;
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
