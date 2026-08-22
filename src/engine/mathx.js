/* ============================================================
   mathx.js -- tiny affine 3x4 matrix / vector math.
   A matrix is a Float32Array(12) laid out row-major:
       [ m0  m1  m2  m3 ]      x' = m0*x + m1*y + m2*z + m3
       [ m4  m5  m6  m7 ]      y' = m4*x + m5*y + m6*z + m7
       [ m8  m9  m10 m11]      z' = m8*x + m9*y + m10*z + m11
   No projection matrix: the rasterizer divides by view-z itself,
   which is exactly what the PlayStation's GTE did.
   ============================================================ */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
/** Shortest signed angular difference from a to b, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
/** Move `a` toward `b` by at most `maxStep`, wrapping correctly. */
export function angleTowards(a, b, maxStep) {
  const d = angleDelta(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}
export const dist2 = (ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  return dx * dx + dz * dz;
};
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

export function mat() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]); }

export function identity(m) {
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  return m;
}

/** out = a * b  (apply b first, then a). `out` may alias a or b. */
export function mul(out, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  const a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
  const a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  const b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
  const b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
  out[0] = a0 * b0 + a1 * b4 + a2 * b8;
  out[1] = a0 * b1 + a1 * b5 + a2 * b9;
  out[2] = a0 * b2 + a1 * b6 + a2 * b10;
  out[3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  out[4] = a4 * b0 + a5 * b4 + a6 * b8;
  out[5] = a4 * b1 + a5 * b5 + a6 * b9;
  out[6] = a4 * b2 + a5 * b6 + a6 * b10;
  out[7] = a4 * b3 + a5 * b7 + a6 * b11 + a7;
  out[8] = a8 * b0 + a9 * b4 + a10 * b8;
  out[9] = a8 * b1 + a9 * b5 + a10 * b9;
  out[10] = a8 * b2 + a9 * b6 + a10 * b10;
  out[11] = a8 * b3 + a9 * b7 + a10 * b11 + a11;
  return out;
}

export function setTranslate(m, x, y, z) {
  identity(m); m[3] = x; m[7] = y; m[11] = z; return m;
}

export function setRotY(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = 0; m[2] = s; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = -s; m[9] = 0; m[10] = c; m[11] = 0;
  return m;
}

export function setRotX(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = c; m[6] = -s; m[7] = 0;
  m[8] = 0; m[9] = s; m[10] = c; m[11] = 0;
  return m;
}

export function setRotZ(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = -s; m[2] = 0; m[3] = 0;
  m[4] = s; m[5] = c; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  return m;
}

export function setScale(m, x, y, z) {
  identity(m); m[0] = x; m[5] = y; m[10] = z; return m;
}

/** Position + yaw, the common case for props and actors. */
export function setPosYaw(m, x, y, z, yaw) {
  setRotY(m, yaw); m[3] = x; m[7] = y; m[11] = z; return m;
}

/** Inverse of a rigid (rotation + translation) matrix -- i.e. a view matrix. */
export function invertRigid(out, m) {
  const t0 = m[3], t1 = m[7], t2 = m[11];
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8];
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9];
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10];
  out[3] = -(out[0] * t0 + out[1] * t1 + out[2] * t2);
  out[7] = -(out[4] * t0 + out[5] * t1 + out[6] * t2);
  out[11] = -(out[8] * t0 + out[9] * t1 + out[10] * t2);
  return out;
}

/* ---- deterministic RNG so a night can be replayed / seeded ---- */
export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const rng = () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (a, b) => a + rng() * (b - a);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  /** Pull `n` distinct entries without mutating the source. */
  rng.sample = (arr, n) => rng.shuffle(arr.slice()).slice(0, n);
  return rng;
}
