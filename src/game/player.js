/* ============================================================
   player.js -- the clerk. Movement, head bob, what's in your
   hands, and the interaction ray.
   ============================================================ */
import { mat, mul, setRotX, setRotY, setTranslate, clamp } from '../engine/mathx.js';
import { collide, EYE, SPOTS, DOOR_X0, DOOR_X1 } from './world.js';

export const MAX_CARRY = 3;
export const REACH = 2.25;

export function createPlayer() {
  return {
    x: SPOTS.playerStart.x, z: SPOTS.playerStart.z, yaw: SPOTS.playerStart.yaw, pitch: 0,
    vx: 0, vz: 0,
    r: 0.28,
    eye: EYE,
    bob: 0, bobPhase: 0, roll: 0,
    held: [],                 // tapes in hand, newest last
    cash: { tendered: 0, owed: 0 },   // taken across the counter, not yet rung up
    changeInHand: 0,                  // counted out of the drawer, owed back
    lookTarget: null,
    stepTimer: 0,
    tension: 0,
    frozen: false,
  };
}

const _cam = mat(), _t = mat(), _r = mat();

export function buildCamera(p, out) {
  setTranslate(_t, p.x, p.eye + p.bob, p.z);
  setRotY(_r, p.yaw);
  mul(_cam, _t, _r);
  setRotX(_r, -p.pitch);
  mul(out, _cam, _r);
  return out;
}

export function forwardOf(p) {
  const cp = Math.cos(p.pitch);
  return [Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp];
}

export function updatePlayer(p, dt, input, ctx) {
  if (!p.frozen && input.locked) {
    p.yaw += input.mdx * input.sensitivity;
    p.pitch -= input.mdy * input.sensitivity * (input.invertY ? -1 : 1);
    p.pitch = clamp(p.pitch, -1.28, 1.28);
  }

  let mx = 0, mz = 0;
  if (!p.frozen) {
    if (input.isDown('KeyW', 'ArrowUp')) mz += 1;
    if (input.isDown('KeyS', 'ArrowDown')) mz -= 1;
    if (input.isDown('KeyA')) mx -= 1;
    if (input.isDown('KeyD')) mx += 1;
  }
  const run = input.isDown('ShiftLeft', 'ShiftRight');
  const len = Math.hypot(mx, mz);
  const speed = run ? 3.05 : 1.72;
  let ax = 0, az = 0;
  if (len > 0) {
    mx /= len; mz /= len;
    // forward is +Z at yaw 0; right is +X
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    ax = (fx * mz + rx * mx) * speed;
    az = (fz * mz + rz * mx) * speed;
  }
  const accel = len > 0 ? 13 : 15;
  p.vx += (ax - p.vx) * Math.min(1, dt * accel);
  p.vz += (az - p.vz) * Math.min(1, dt * accel);

  const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
  const [cx, cz] = collide(nx, nz, p.r, ctx.solids,
    ctx.doorPassableForPlayer(), ctx.storagePassableForPlayer());
  // pushing at the front door is a thing the player will try; say something
  if (nz < p.z && p.z < 1.2 && Math.abs(cz - nz) > 1e-4
      && nx > DOOR_X0 - 0.4 && nx < DOOR_X1 + 0.4) ctx.pushedExit();
  // kill velocity into the surface we just slid along
  if (Math.abs(cx - nx) > 1e-6) p.vx *= 0.2;
  if (Math.abs(cz - nz) > 1e-6) p.vz *= 0.2;
  p.x = cx; p.z = cz;

  const sp = Math.hypot(p.vx, p.vz);
  if (sp > 0.25) {
    p.bobPhase += dt * (run ? 12.5 : 8.4);
    p.bob = Math.sin(p.bobPhase) * (run ? 0.045 : 0.026);
    p.roll = Math.cos(p.bobPhase * 0.5) * (run ? 0.014 : 0.008);
    p.stepTimer -= dt * sp;
    if (p.stepTimer <= 0) { p.stepTimer = run ? 0.82 : 0.62; ctx.playerStep(run); }
  } else {
    p.bob += (Math.sin(performance.now() * 0.0011) * 0.004 - p.bob) * Math.min(1, dt * 4);
    p.roll += (0 - p.roll) * Math.min(1, dt * 6);
  }
  return sp;
}

/* ---------------- interaction ray ---------------- */
export function castInteract(p, targets) {
  const [dx, dy, dz] = forwardOf(p);
  const ox = p.x, oy = p.eye + p.bob, oz = p.z;
  let best = null, bestT = REACH;
  for (const t of targets) {
    let hit = -1;
    if (t.aabb) hit = rayAabb(ox, oy, oz, dx, dy, dz, t.aabb);
    else if (t.cyl) hit = rayCylinder(ox, oy, oz, dx, dy, dz, t.cyl);
    if (hit >= 0 && hit < bestT) { bestT = hit; best = t; }
  }
  return best;
}

function rayAabb(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = 1e9;
  for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return -1; continue; }
    const inv = 1 / d;
    let t1 = (lo - o) * inv, t2 = (hi - o) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Upright capsule-ish cylinder, used for people. */
function rayCylinder(ox, oy, oz, dx, dy, dz, c) {
  const px = ox - c.x, pz = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (px * dx + pz * dz);
  const cc = px * px + pz * pz - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return -1;
  const y = oy + dy * t;
  if (y < c.y0 || y > c.y1) return -1;
  return t;
}

/* ---------------- hands ---------------- */
export function canCarry(p) { return p.held.length < MAX_CARRY; }
export function topTape(p) { return p.held.length ? p.held[p.held.length - 1] : null; }
export function takeTape(p, tape) { if (!canCarry(p)) return false; p.held.push(tape); return true; }
export function dropTop(p) { return p.held.pop() || null; }

/** Cash rides in the lower-left, opposite the tapes. */
export function heldCashMatrix(p, out, sway) {
  const s = sway || 0;
  setTranslate(_t, p.x, p.eye + p.bob, p.z);
  setRotY(_r, p.yaw);
  mul(out, _t, _r);
  setRotX(_r, -p.pitch * 0.35);
  mul(out, out, _r);
  setTranslate(_t, -0.205 + s * 0.015, -0.205, 0.46);
  mul(out, out, _t);
  setRotY(_r, 0.55);
  mul(out, out, _r);
  setRotX(_r, 1.24);          // tipped up so you can see it is money
  mul(out, out, _r);
  return out;
}

/** Held tapes ride in the lower-right of the frame, stacked. */
export function heldTapeMatrix(p, i, out, sway) {
  const s = sway || 0;
  setTranslate(_t, p.x, p.eye + p.bob, p.z);
  setRotY(_r, p.yaw);
  mul(out, _t, _r);
  setRotX(_r, -p.pitch * 0.35);
  mul(out, out, _r);
  setTranslate(_t, 0.215 + s * 0.015, -0.235 + i * 0.032, 0.54);
  mul(out, out, _t);
  setRotY(_r, -0.5 + s * 0.06);
  mul(out, out, _r);
  setRotX(_r, 1.15 + i * 0.02);
  mul(out, out, _r);
  return out;
}
