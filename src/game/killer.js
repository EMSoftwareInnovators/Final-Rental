/* ============================================================
   killer.js -- the thing the deputy warned you about.

   He gets two acts. In the first he is a customer: he browses,
   he is polite, he pays, he asks you what time you lock up. In
   the second he is outside in the dark, and the only two things
   that matter are the deadbolt and the phone.

   Some nights he never comes at all.
   ============================================================ */
import { angleTowards, dist } from '../engine/mathx.js';
import { collide, SPOTS, DOOR_X0, DOOR_X1 } from './world.js';
import { navPath } from './nav.js';
import { updateAnim } from './actor.js';
import { updateCustomer, createCustomer, CS } from './customer.js';
import { KILLER_MASK } from './personality.js';

export const KP = {
  ABSENT: 'ABSENT', WAITING: 'WAITING', CUSTOMER: 'CUSTOMER', GONE_QUIET: 'GONE_QUIET',
  STALK: 'STALK', APPROACH: 'APPROACH', TRY_DOOR: 'TRY_DOOR',
  BREACH: 'BREACH', HUNT: 'HUNT', ATTACK: 'ATTACK', CAUGHT: 'CAUGHT',
};

export function planKiller(rng, night, nightLength) {
  // Every field is always present, even on a night he never shows: nothing
  // downstream should ever have to guess whether a tuning value exists.
  const appearChance = Math.min(0.92, 0.42 + (night - 1) * 0.13);
  const visitAt = nightLength * rng.range(0.18, 0.55);
  const stalkAt = Math.max(visitAt + 55, nightLength * rng.range(0.55, 0.86) - night * 8);
  return {
    appears: rng() < appearChance,
    visits: rng() < 0.86,                            // sometimes he skips the polite part
    stalks: rng() < Math.min(0.95, 0.68 + night * 0.06),
    visitAt,
    stalkAt,
    postDwell: Math.max(4.5, 11 - night * 0.7),      // seconds at each window
    doorDelay: Math.max(5.5, 15 - night * 1.1),      // dithering outside an unlocked door
    breachLocked: Math.max(20, 48 - night * 3.6),    // how long the deadbolt holds him
    huntSpeed: 1.55 + night * 0.09,
  };
}

export function createKiller(rng, app, plan, nightLength) {
  const ent = createCustomer(rng, {
    app,
    personality: KILLER_MASK,
    isKiller: true,
    intent: rng.chance(0.82) ? 'RENT' : 'RETURN',
    hasMoney: true,
    name: 'THE CUSTOMER',
  });
  ent.speed = 1.16;
  ent.phoneLabel = `The one in the ${app.jacket.color.name} ${app.jacket.kind}`;
  ent.state = CS.GONE;
  ent.hidden = true;
  return {
    ent,
    app,
    plan,
    phase: plan.appears ? KP.WAITING : KP.ABSENT,
    timer: 0,
    intel: 0,
    spotted: false,
    seenAsCustomer: false,
    postIndex: 0,
    postTimer: 0,
    knockTimer: 0,
    nightLength,
    proximity: 0,
    everSeenTonight: false,
  };
}

/** Answering his questions badly brings him back sooner and makes him bolder. */
export function addIntel(k, n) {
  if (!k) return;
  k.intel = Math.max(-4, Math.min(6, k.intel + n));
}

export function killerActive(k) {
  return k && (k.phase === KP.STALK || k.phase === KP.APPROACH || k.phase === KP.TRY_DOOR
    || k.phase === KP.BREACH || k.phase === KP.HUNT || k.phase === KP.ATTACK);
}

export function killerPresent(k) {
  return k && (k.phase === KP.CUSTOMER || killerActive(k));
}

export function updateKiller(k, dt, ctx) {
  if (!k || k.phase === KP.ABSENT || k.phase === KP.CAUGHT) return;
  const e = k.ent;
  const t = ctx.elapsed;
  k.timer += dt;

  switch (k.phase) {
    case KP.WAITING: {
      if (k.plan.visits && t >= k.plan.visitAt) {
        k.phase = KP.CUSTOMER;
        e.hidden = false;
        e.state = CS.ARRIVING;
        ctx.onKillerArrives();
      } else if (!k.plan.visits && t >= k.plan.stalkAt) {
        beginStalk(k, ctx);
      }
      break;
    }

    case KP.CUSTOMER: {
      updateCustomer(e, dt, ctx);
      // he will not stand at your counter all night; if you never serve him
      // he simply leaves, and comes back the other way
      if (e.state === CS.WAITING && !e.served) {
        k.counterWait = (k.counterWait || 0) + dt;
        if (k.counterWait > 80) { e.leaving = true; e.state = CS.LEAVING; e.path = null; ctx.releaseCounterSpot(e); }
      }
      if (e.state === CS.GONE) {
        e.hidden = true;
        k.phase = k.plan.stalks ? KP.GONE_QUIET : KP.ABSENT;
        k.seenAsCustomer = true;
        k.timer = 0;
        if (k.phase === KP.ABSENT) ctx.onKillerVanishes();
      }
      break;
    }

    case KP.GONE_QUIET: {
      // Fixed the moment he leaves, not re-derived each frame -- otherwise the
      // deadline runs away from the clock and he never comes back.
      if (k.stalkTime === undefined) {
        k.stalkTime = Math.max(t + 6, k.plan.stalkAt - k.intel * 9);
      }
      if (t >= k.stalkTime) beginStalk(k, ctx);
      break;
    }

    case KP.STALK: {
      e.hidden = false;
      const post = SPOTS.stalkPosts[k.postIndex];
      const d = dist(e.x, e.z, post.x, post.z);
      if (d > 0.3) {
        stepTo(e, post.x, post.z, dt, 0.85, ctx);
      } else {
        e.moveSpeed = 0;
        // face the store, then the player specifically
        const tx = ctx.player.x, tz = ctx.player.z;
        e.yaw = angleTowards(e.yaw, Math.atan2(tx - e.x, tz - e.z), dt * 1.6);
        k.postTimer += dt;
        const dwell = k.plan.postDwell / (1 + Math.max(0, k.intel) * 0.14);
        if (k.postTimer > dwell) {
          k.postTimer = 0;
          if (k.timer > 26 + Math.max(0, 3 - k.intel) * 6) {
            k.phase = KP.APPROACH; k.timer = 0; e.path = null;
            ctx.onKillerApproaches();
          } else {
            let n = k.postIndex;
            while (n === k.postIndex) n = ctx.rng.int(SPOTS.stalkPosts.length);
            k.postIndex = n;
            ctx.onKillerMoves();
          }
        }
      }
      break;
    }

    case KP.APPROACH: {
      const tx = SPOTS.outsideDoor.x, tz = SPOTS.outsideDoor.z + 0.25;
      if (stepTo(e, tx, tz, dt, 0.95, ctx)) {
        k.phase = KP.TRY_DOOR; k.timer = 0; k.knockTimer = 0;
        ctx.onKillerAtDoor();
      }
      break;
    }

    case KP.TRY_DOOR: {
      e.moveSpeed = 0;
      e.yaw = angleTowards(e.yaw, 0, dt * 3);
      k.knockTimer -= dt;
      if (!ctx.doorLocked) {
        if (k.timer > k.plan.doorDelay / (1 + Math.max(0, k.intel) * 0.2)) {
          k.phase = KP.BREACH; k.timer = 0; e.path = null;
          ctx.onKillerEnters(false);
        } else if (k.knockTimer <= 0) {
          k.knockTimer = 2.6; ctx.killerTriesHandle();
        }
      } else {
        if (k.knockTimer <= 0) { k.knockTimer = 3.1; ctx.killerBangs(); }
        if (k.timer > k.plan.breachLocked) {
          k.phase = KP.BREACH; k.timer = 0; e.path = null;
          ctx.onKillerEnters(true);
        }
      }
      break;
    }

    case KP.BREACH: {
      const tx = SPOTS.door.x, tz = SPOTS.door.z + 0.7;
      if (stepTo(e, tx, tz, dt, 1.25, ctx, true)) { k.phase = KP.HUNT; k.timer = 0; e.path = null; }
      break;
    }

    case KP.HUNT: {
      const p = ctx.player;
      const d = dist(e.x, e.z, p.x, p.z);
      if (d < 1.15) {
        k.phase = KP.ATTACK; e.moveSpeed = 0;
        ctx.onKillerAttacks();
      } else {
        // Only repath when the old one no longer leads to the player -- a blind
        // repath every frame resets the cursor to a waypoint already behind him
        // and he paces on the spot forever.
        const end = e.path && e.path[e.path.length - 1];
        if (!e.path || e.pathI >= e.path.length || !end || dist(end.x, end.z, p.x, p.z) > 1.0) {
          e.path = navPath(e.x, e.z, p.x, p.z, ctx.solids, e.r + 0.05);
          e.pathI = 0;
          while (e.pathI < e.path.length - 1 && dist(e.x, e.z, e.path[e.pathI].x, e.path[e.pathI].z) < 0.6) e.pathI++;
        }
        const wp = e.path[Math.min(e.pathI, e.path.length - 1)];
        const lastLeg = e.pathI >= e.path.length - 1;
        if (stepTo(e, wp.x, wp.z, dt, k.plan.huntSpeed, ctx, true, lastLeg ? 0.12 : 0.34)) {
          if (!lastLeg) e.pathI++;
        }
      }
      break;
    }
    default: break;
  }

  if (!e.hidden) {
    updateAnim(e.anim, dt, e.moveSpeed, e.app, {
      talking: ctx.speaking === e,
      reach: e.state === CS.TALKING && e.tape && !e.gaveTape && !e.checkedOut,
      headPitch: k.phase === KP.HUNT ? -0.10 : 0,
    });
    if (k.phase === KP.HUNT || k.phase === KP.BREACH) {
      e.anim.lean = 0.16;
      e.anim.armL = -0.55 + e.anim.armL * 0.3;
      e.anim.armR = -0.28 + e.anim.armR * 0.3;
    }
    k.proximity = 1 - Math.min(1, dist(e.x, e.z, ctx.player.x, ctx.player.z) / 12);
  }
}

function beginStalk(k, ctx) {
  k.phase = KP.STALK;
  k.timer = 0; k.postTimer = 0;
  k.postIndex = ctx.rng.int(SPOTS.stalkPosts.length);
  const p = SPOTS.stalkPosts[(k.postIndex + 2) % SPOTS.stalkPosts.length];
  k.ent.x = p.x + ctx.rng.range(-1.5, 1.5);
  k.ent.z = -3.1;
  k.ent.hidden = false;
  k.ent.state = 'STALK';
  ctx.onStalkBegins();
}

function stepTo(e, tx, tz, dt, speed, ctx, canEnter, thresh) {
  const dx = tx - e.x, dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  if (d < (thresh || 0.12)) { e.moveSpeed = 0; return true; }
  const nx = e.x + (dx / d) * speed * dt;
  const nz = e.z + (dz / d) * speed * dt;
  const [px, pz] = collide(nx, nz, e.r, ctx.solids, canEnter ? true : ctx.doorPassable(e));
  const moved = Math.hypot(px - e.x, pz - e.z);
  e.x = px; e.z = pz;
  e.moveSpeed = moved / Math.max(dt, 0.0001);
  e.yaw = angleTowards(e.yaw, Math.atan2(dx, dz), dt * 4.5);
  e._stepTimer = (e._stepTimer || 0) - dt * Math.max(0.2, e.moveSpeed);
  if (e._stepTimer <= 0) { e._stepTimer = 0.58; ctx.footstep(e, true); }
  return false;
}

/** True when the killer's silhouette is inside the player's view cone. */
export function killerInView(k, player, fovY, aspect) {
  if (!k || k.ent.hidden) return false;
  const e = k.ent;
  const dx = e.x - player.x, dz = e.z - player.z;
  const d = Math.hypot(dx, dz);
  if (d > 16) return false;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const cosA = (dx * fx + dz * fz) / (d || 1);
  const half = Math.atan(Math.tan(fovY / 2) * aspect);
  return cosA > Math.cos(half * 1.05);
}

/** Does the player have line of sight to the door area? Used for pacing hints. */
export function facingDoor(player) {
  const dx = (DOOR_X0 + DOOR_X1) / 2 - player.x, dz = 0 - player.z;
  const d = Math.hypot(dx, dz) || 1;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  return (dx * fx + dz * fz) / d > 0.5;
}
