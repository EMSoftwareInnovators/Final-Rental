/* ============================================================
   actor.js -- the low-poly humanoid.

   Not boxes. Every part is a stack of cross-sections skinned into a
   tapered, faceted solid, the way PS1 character meshes were actually
   built: a torso that narrows at the waist and slopes at the shoulders,
   an eight-sided skull with a flat panel for the face, limbs that thin
   toward the wrist and ankle. About 240 triangles a person, which is
   roughly what a mid-90s NPC cost.

   Silhouette carries description. Build and gender are baked into
   separate torso/limb variants rather than squashed in with a matrix,
   so "heavy set" and "thin, narrow shoulders" read from across the
   store -- which they have to, because the deputy will describe them.
   ============================================================ */
import { MeshBuilder } from '../engine/mesh.js';
import { mat, mul, setPosYaw, setRotX, setRotY, setRotZ, setScale, setTranslate } from '../engine/mathx.js';
import { ATLAS } from './appearance.js';

/* body metrics for a 1.75 m person, in meters */
const LEG_LEN = 0.74, SHOE_H = 0.085, HIP_Y = 0.90;
const TORSO_H = 0.58, TORSO_W = 0.205, TORSO_D = 0.125;
const SHOULDER_Y = 1.40, ARM_LEN = 0.58, ARM_R = 0.056;
const HEAD_Y = 1.47, HEAD_H = 0.255, HEAD_W = 0.098, HEAD_D = 0.105;
export const ACTOR_HEIGHT = HEAD_Y + HEAD_H;

/** atlas rect (x,y,w,h) -> the quad uv rect the mesh builder wants */
const uv = (r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]];
const F = (region, flags) => ({ tex: 0, uv: uv(region), flags: flags | 0 });

/* ---------------- cross-sections ----------------
   Traversed front-left -> front-right -> around the right side to the
   back and home. Side i spans point i to point i+1.                    */

const SEC8 = [
  [-0.62, 1.00], [0.62, 1.00],      // flat front panel (the face / the chest)
  [1.00, 0.30], [1.00, -0.42],
  [0.55, -1.00], [-0.55, -1.00],
  [-1.00, -0.42], [-1.00, 0.30],
];
const SEC5 = [
  [-0.72, 0.92], [0.72, 0.92],
  [1.00, -0.28], [0.00, -1.00], [-1.00, -0.28],
];
const SEC4 = [[-1, 1], [1, 1], [1, -1], [-1, -1]];

const SIDES8 = (f, r, b, l) => [f, r, r, b, b, b, l, l];

/* ============================================================ */
export function buildActorMeshes() {
  const flat = () => { const b = new MeshBuilder(); b.light = () => 1; return b; };
  const M = {};

  /* ---------------- torso: one variant per gender x build ----------------
     Shoulder and hip width are the two things a witness actually notices,
     so they are geometry, not a scale factor.                            */
  const BUILD = {
    thin: { sh: 0.84, ch: 0.86, wa: 0.78, hp: 0.86, dep: 0.86, limb: 0.82 },
    average: { sh: 1.00, ch: 1.00, wa: 0.94, hp: 0.98, dep: 1.00, limb: 1.00 },
    heavy: { sh: 1.10, ch: 1.22, wa: 1.30, hp: 1.26, dep: 1.34, limb: 1.24 },
    broad: { sh: 1.26, ch: 1.18, wa: 0.98, hp: 1.02, dep: 1.06, limb: 1.14 },
  };
  const GENDER = {
    m: { sh: 1.05, hp: 0.94, chest: 1.00, neck: 0.66, jaw: 1.00, headW: 1.00 },
    f: { sh: 0.90, hp: 1.10, chest: 1.02, neck: 0.58, jaw: 0.90, headW: 0.94 },
  };

  M.torso = {};
  for (const g of ['m', 'f']) {
    M.torso[g] = {};
    for (const [bname, B] of Object.entries(BUILD)) {
      const G = GENDER[g];
      const b = flat();
      const w = TORSO_W, d = TORSO_D * B.dep;
      const rings = [
        { y: 0.00 * TORSO_H, w: w * B.hp * G.hp, d: d * 0.92 },
        { y: 0.24 * TORSO_H, w: w * B.wa, d: d * 0.88 },
        { y: 0.58 * TORSO_H, w: w * B.ch * G.chest, d: d },
        { y: 0.88 * TORSO_H, w: w * B.sh * G.sh, d: d * 0.94 },
        { y: 1.00 * TORSO_H, w: w * B.sh * G.sh * G.neck, d: d * 0.62 },
      ];
      b.loft(rings, SEC8,
        SIDES8(F(ATLAS.torsoF), F(ATLAS.torsoR), F(ATLAS.torsoB), F(ATLAS.torsoL)),
        { top: F(ATLAS.torsoT), bottom: F(ATLAS.torsoD) });
      const mesh = b.build();
      mesh.shoulderX = w * B.sh * G.sh;
      mesh.hipX = w * B.hp * G.hp;
      mesh.limb = B.limb;
      M.torso[g][bname] = mesh;
    }
  }

  /* ---------------- head: two jaw shapes ---------------- */
  M.head = {};
  for (const g of ['m', 'f']) {
    const G = GENDER[g];
    const b = flat();
    const w = HEAD_W * G.headW, d = HEAD_D;
    b.loft([
      { y: 0.00, w: w * 0.70 * G.jaw, d: d * 0.78, oz: 0.006 },
      { y: 0.30 * HEAD_H, w: w * 0.94 * G.jaw, d: d * 0.97, oz: 0.004 },
      { y: 0.60 * HEAD_H, w: w * 1.00, d: d * 1.00 },
      { y: 0.86 * HEAD_H, w: w * 0.97, d: d * 0.96 },
      { y: 1.00 * HEAD_H, w: w * 0.76, d: d * 0.76, oz: -0.004 },
    ], SEC8,
      SIDES8(F(ATLAS.headF), F(ATLAS.headR), F(ATLAS.headB), F(ATLAS.headL)),
      { top: F(ATLAS.headT), bottom: F(ATLAS.headD) });
    M.head[g] = b.build();
  }

  /* ---------------- arms and legs, thinned per build ---------------- */
  M.arm = {}; M.leg = {};
  for (const [bname, B] of Object.entries(BUILD)) {
    const k = B.limb;
    const a = flat();
    a.loft([
      { y: -ARM_LEN, w: ARM_R * 0.72 * k, d: ARM_R * 0.72 * k },
      { y: -ARM_LEN * 0.52, w: ARM_R * 0.84 * k, d: ARM_R * 0.86 * k },
      { y: -ARM_LEN * 0.08, w: ARM_R * 1.06 * k, d: ARM_R * 1.02 * k },
      { y: 0, w: ARM_R * 1.10 * k, d: ARM_R * 1.04 * k },
    ], SEC5, [F(ATLAS.arm)], { top: F(ATLAS.torsoT), bottom: F(ATLAS.hand) });
    M.arm[bname] = a.build();

    const l = flat();
    const lw = 0.072 * k, ld = 0.080 * k;
    l.loft([
      { y: -LEG_LEN, w: lw * 0.62, d: ld * 0.66 },
      { y: -LEG_LEN * 0.55, w: lw * 0.78, d: ld * 0.82 },
      { y: -LEG_LEN * 0.18, w: lw * 1.02, d: ld * 1.00 },
      { y: 0, w: lw * 1.12, d: ld * 1.06 },
    ], SEC5, [F(ATLAS.leg)], { top: F(ATLAS.torsoD), bottom: null });
    M.leg[bname] = l.build();
  }

  /* ---------------- shoe: a wedge with a sloped toe ---------------- */
  {
    const b = flat();
    b.loft([
      { y: -LEG_LEN - SHOE_H, w: 0.078, d: 0.125, oz: 0.020 },
      { y: -LEG_LEN - SHOE_H * 0.35, w: 0.076, d: 0.115, oz: 0.012 },
      { y: -LEG_LEN, w: 0.070, d: 0.072, oz: -0.028 },
    ], SEC4, [F(ATLAS.shoe)], { top: F(ATLAS.shoeT), bottom: F(ATLAS.shoe) });
    M.shoe = b.build();
  }

  /* ---------------- hair, as actual geometry ----------------
     A witness who says "long, past the shoulders" has to be able to see
     that on the model, not just in a texture.                         */
  const hairShell = (b, k, top) => {
    // Sits from the brow up, hugging the skull profile. The hairline itself
    // is painted on the head; the mesh is only here to give the silhouette
    // volume -- otherwise "curly and thick" and "buzzed" look identical from
    // across the store.
    b.loft([
      { y: HEAD_H * 0.78, w: HEAD_W * 1.01 * k, d: HEAD_D * 1.01 * k },
      { y: HEAD_H * 0.93, w: HEAD_W * 0.95 * k, d: HEAD_D * 0.95 * k },
      { y: HEAD_H * top, w: HEAD_W * 0.70 * k, d: HEAD_D * 0.72 * k },
    ], SEC8, [F(ATLAS.hair)], { top: F(ATLAS.hair) });
  };
  /** Hair falling down the back of the head and neck. */
  const backSlab = (b, yBot, depth, wide) => {
    b.loft([
      { y: yBot, w: HEAD_W * wide * 0.86, d: depth * 0.55, oz: -HEAD_D * 0.74 },
      { y: HEAD_H * 0.35, w: HEAD_W * wide, d: depth, oz: -HEAD_D * 0.70 },
      { y: HEAD_H * 0.86, w: HEAD_W * 1.00, d: depth * 0.85, oz: -HEAD_D * 0.58 },
    ], SEC4, [F(ATLAS.hair)], { top: null, bottom: F(ATLAS.hair) });
  };
  M.hair = {};
  { const b = flat(); hairShell(b, 1.00, 1.06); M.hair.short = b.build(); }
  { const b = flat(); hairShell(b, 0.985, 1.02); M.hair.buzz = b.build(); }
  { const b = flat(); hairShell(b, 1.17, 1.19); M.hair.curly = b.build(); }
  { const b = flat(); hairShell(b, 0.99, 1.03); M.hair.greasy = b.build(); }
  { const b = flat(); hairShell(b, 1.03, 1.07); backSlab(b, -0.30, HEAD_D * 0.36, 1.00); M.hair.long = b.build(); }
  { const b = flat(); hairShell(b, 1.02, 1.05); backSlab(b, -0.12, HEAD_D * 0.30, 0.70); M.hair.mullet = b.build(); }
  {
    const b = flat(); hairShell(b, 1.02, 1.06);
    b.loft([
      { y: -0.17, w: 0.032, d: 0.032, oz: -HEAD_D * 1.30 },
      { y: 0.01, w: 0.042, d: 0.042, oz: -HEAD_D * 1.18 },
      { y: HEAD_H * 0.50, w: 0.034, d: 0.034, oz: -HEAD_D * 0.94 },
    ], SEC4, [F(ATLAS.hair)], { top: F(ATLAS.hair), bottom: F(ATLAS.hair) });
    M.hair.ponytail = b.build();
  }
  M.hair.bald = null;

  /* ---------------- headwear ---------------- */
  {
    const b = flat();
    b.loft([
      { y: 0.00, w: HEAD_W * 1.10, d: HEAD_D * 1.08 },
      { y: 0.055, w: HEAD_W * 1.08, d: HEAD_D * 1.05 },
      { y: 0.098, w: HEAD_W * 0.66, d: HEAD_D * 0.68 },
    ], SEC8, [F(ATLAS.hatS)], { top: F(ATLAS.hatT), bottom: null });
    // peak
    b.loft([
      { y: 0.000, w: HEAD_W * 0.95, d: 0.062, oz: HEAD_D * 1.62 },
      { y: 0.016, w: HEAD_W * 1.02, d: 0.070, oz: HEAD_D * 1.30 },
    ], SEC4, [F(ATLAS.hatB)], { top: F(ATLAS.hatT), bottom: F(ATLAS.hatB) });
    M.cap = b.build();
  }
  {
    const b = flat();
    b.loft([
      { y: -0.062, w: HEAD_W * 1.13, d: HEAD_D * 1.11 },
      { y: 0.020, w: HEAD_W * 1.15, d: HEAD_D * 1.12 },
      { y: 0.082, w: HEAD_W * 0.92, d: HEAD_D * 0.92 },
      { y: 0.112, w: HEAD_W * 0.46, d: HEAD_D * 0.48 },
    ], SEC8, [F(ATLAS.hatS)], { top: F(ATLAS.hatT), bottom: null });
    M.beanie = b.build();
  }
  {
    const b = flat();
    b.loft([
      { y: -0.30, w: HEAD_W * 1.34, d: HEAD_D * 1.30, oz: -HEAD_D * 0.30 },
      { y: -0.05, w: HEAD_W * 1.40, d: HEAD_D * 1.36, oz: -HEAD_D * 0.26 },
      { y: 0.070, w: HEAD_W * 1.20, d: HEAD_D * 1.18, oz: -HEAD_D * 0.30 },
      { y: 0.115, w: HEAD_W * 0.60, d: HEAD_D * 0.60, oz: -HEAD_D * 0.40 },
    ], SEC8,
      // leave the face panel open so you can still read who is under it
      [null, F(ATLAS.hatS), F(ATLAS.hatS), F(ATLAS.hatS), F(ATLAS.hatS), F(ATLAS.hatS), F(ATLAS.hatS), F(ATLAS.hatS)],
      { top: F(ATLAS.hatT), bottom: null });
    M.hood = b.build();
  }

  /* ---------------- carried things ---------------- */
  {
    const b = flat();
    b.loft([
      { y: -0.13, w: 0.115, d: 0.075 },
      { y: 0.00, w: 0.145, d: 0.095 },
      { y: 0.13, w: 0.105, d: 0.070 },
    ], SEC8, [F(ATLAS.bag)], { top: F(ATLAS.bag), bottom: F(ATLAS.bag) });
    M.bag = b.build();
  }
  {
    const b = flat();
    b.loft([
      { y: -0.055, w: 0.042, d: 0.016 },
      { y: 0.055, w: 0.042, d: 0.016 },
    ], SEC4, [F(ATLAS.prop)], { top: F(ATLAS.prop), bottom: F(ATLAS.prop) });
    M.walkman = b.build();
  }
  {
    const b = flat();
    b.loft([
      { y: -0.34, w: 0.013, d: 0.013 },
      { y: 0.10, w: 0.020, d: 0.020 },
      { y: 0.16, w: 0.028, d: 0.028 },
      { y: 0.20, w: 0.011, d: 0.011 },
    ], SEC5, [F(ATLAS.prop)], { top: F(ATLAS.prop), bottom: F(ATLAS.prop) });
    M.umbrella = b.build();
  }

  return M;
}

/* ---------------- scratch ---------------- */
const _root = mat(), _tmp = mat(), _tmp2 = mat(), _part = mat(), _rot = mat();
// torso and skull frames are kept in their own matrices: things hang off them
// (the walkman, the hair, the hat) long after _part has been reused.
const _torsoM = mat(), _skullM = mat(), _scale = mat();

const BUILD_IDS = { thin: 1, average: 1, heavy: 1, broad: 1 };
const genderOf = (app) => ((app.gender && app.gender.id) || app.gender) === 'f' ? 'f' : 'm';
const variant = (app) => ({
  g: genderOf(app),
  b: BUILD_IDS[app.build.id] ? app.build.id : 'average',
});

/**
 * @param rz    Raster
 * @param M     part meshes from buildActorMeshes()
 * @param a     actor: { x, z, yaw, app, skin, anim }
 * @param shade 0..1 light level at the actor
 */
export function drawActor(rz, M, a, shade) {
  const app = a.app;
  const hs = app.height.scale;
  const an = a.anim;
  const opt = { shade, textures: [a.skin] };
  const V = variant(app);
  const torso = M.torso[V.g][V.b];
  const head = M.head[V.g];
  const arm = M.arm[V.b];
  const leg = M.leg[V.b];

  if (!rz.sphereVisible(a.x, ACTOR_HEIGHT * hs * 0.5, a.z, 1.2 * hs)) return;

  setPosYaw(_tmp, a.x, a.y || 0, a.z, a.yaw);
  setScale(_scale, hs, hs, hs);
  mul(_root, _tmp, _scale);

  const bob = an.bob || 0;
  const crouch = an.crouch || 0;
  const hipX = torso.hipX * 0.52;

  // ---- legs ----
  const swing = an.legSwing || 0;
  const limpK = an.limp ? 0.45 : 1;
  drawPart(rz, leg, _root, -hipX, HIP_Y - crouch, 0, swing * limpK, 0, opt, M.shoe);
  drawPart(rz, leg, _root, hipX,
    HIP_Y - crouch - (an.limp ? 0.035 * Math.max(0, Math.sin(an.phase)) : 0), 0, -swing, 0, opt, M.shoe);

  // ---- torso ----
  setTranslate(_tmp, 0, HIP_Y + bob - crouch, 0);
  mul(_part, _root, _tmp);
  setRotX(_rot, an.lean || 0);
  mul(_part, _part, _rot);
  rz.drawMesh(torso, _part, opt);
  _torsoM.set(_part);                        // kept: the walkman clips to it

  // ---- arms ----
  const ax = torso.shoulderX + ARM_R * 0.95;
  drawPart(rz, arm, _root, -ax, SHOULDER_Y + bob - crouch, 0, an.armL || 0, an.armLz || 0, opt);
  drawPart(rz, arm, _root, ax, SHOULDER_Y + bob - crouch, 0, an.armR || 0, an.armRz || 0, opt);

  // ---- head ----
  setTranslate(_tmp, 0, HEAD_Y + bob - crouch, 0);
  mul(_part, _root, _tmp);
  setRotY(_rot, an.headYaw || 0);
  mul(_part, _part, _rot);
  setRotX(_rot, an.headPitch || 0);
  mul(_part, _part, _rot);
  rz.drawMesh(head, _part, opt);
  _skullM.set(_part);                        // kept: hair and hat ride on it

  // ---- hair, then whatever is on top of it ----
  const hairMesh = M.hair[app.hair.style.id];
  if (hairMesh) rz.drawMesh(hairMesh, _skullM, opt);

  const hat = app.hat.id;
  if (hat !== 'none') {
    const hm = hat === 'beanie' ? M.beanie : hat === 'hood' ? M.hood : M.cap;
    setTranslate(_tmp, 0, HEAD_H * (hat === 'hood' ? 0.86 : 0.90), 0);
    mul(_tmp2, _skullM, _tmp);
    rz.drawMesh(hm, _tmp2, opt);
  }

  // ---- what they are carrying, so the bulletin can mention it ----
  const carry = app.carry.id;
  if (carry === 'duffel') {
    setTranslate(_tmp, ax + 0.05, SHOULDER_Y - ARM_LEN - 0.02 + bob, 0.03);
    mul(_tmp2, _root, _tmp);
    rz.drawMesh(M.bag, _tmp2, opt);
  } else if (carry === 'backpack') {
    setTranslate(_tmp, 0, 1.14 + bob, -TORSO_D - 0.10);
    mul(_tmp2, _root, _tmp);
    rz.drawMesh(M.bag, _tmp2, opt);
  } else if (carry === 'walkman') {
    setTranslate(_tmp, hipX + 0.055, 0.10, TORSO_D * 0.55);
    mul(_tmp2, _torsoM, _tmp);
    rz.drawMesh(M.walkman, _tmp2, opt);
  } else if (carry === 'umbrella') {
    setTranslate(_tmp, -ax - 0.03, SHOULDER_Y - ARM_LEN + 0.30 + bob, 0.04);
    mul(_tmp2, _root, _tmp);
    setRotZ(_rot, 0.22);
    mul(_tmp2, _tmp2, _rot);
    rz.drawMesh(M.umbrella, _tmp2, opt);
  }
}

function drawPart(rz, mesh, root, ox, oy, oz, rotX, rotZ, opt, alsoShoe) {
  setTranslate(_tmp, ox, oy, oz);
  mul(_part, root, _tmp);
  if (rotZ) { setRotZ(_rot, rotZ); mul(_part, _part, _rot); }
  setRotX(_rot, rotX);
  mul(_part, _part, _rot);
  rz.drawMesh(mesh, _part, opt);
  if (alsoShoe) rz.drawMesh(alsoShoe, _part, opt);
}

/* ============================================================
   Animation driver -- shared by customers, the deputy and the killer.
   ============================================================ */
export function makeAnim() {
  return {
    phase: Math.random() * 6.28, legSwing: 0, armL: 0, armR: 0, armLz: 0, armRz: 0,
    lean: 0, bob: 0, headYaw: 0, headPitch: 0, crouch: 0, limp: false,
    reach: 0, talk: 0, _talkT: 0,
  };
}

export function updateAnim(an, dt, moveSpeed, app, opts = {}) {
  /* `keep` means somebody else is driving the rig this frame -- a special
     customer performing whatever it is they came in to perform -- so the
     idle and walk cycles stay out of it and only the legs settle. */
  if (opts.keep) {
    an.phase += dt * 1.4;
    an.legSwing += (0 - an.legSwing) * Math.min(1, dt * 8);
    an.crouch = 0;
    return;
  }
  an.limp = app.gait.id === 'limp';
  const stiff = app.gait.id === 'stiff';
  const shuffle = app.gait.id === 'shuffle';

  if (moveSpeed > 0.02) {
    an.phase += dt * (5.2 + moveSpeed * 2.4) * (shuffle ? 0.72 : 1);
    const amp = Math.min(0.62, moveSpeed * 0.46) * (shuffle ? 0.45 : 1);
    an.legSwing = Math.sin(an.phase) * amp;
    const armAmp = stiff ? amp * 0.12 : amp * 0.85;
    an.armL = -Math.sin(an.phase) * armAmp;
    an.armR = Math.sin(an.phase) * armAmp;
    an.bob = Math.abs(Math.sin(an.phase)) * 0.022 - 0.011;
    an.lean = shuffle ? 0.13 : stiff ? -0.03 : 0.045 + moveSpeed * 0.012;
    if (an.limp) an.bob += Math.max(0, Math.sin(an.phase)) * 0.03;
  } else {
    an.phase += dt * 1.4;
    an.legSwing += (0 - an.legSwing) * Math.min(1, dt * 8);
    an.bob = Math.sin(an.phase * 0.9) * 0.006;
    an.lean += ((stiff ? -0.04 : 0.02) - an.lean) * Math.min(1, dt * 5);
    const idleArm = Math.sin(an.phase * 0.7) * 0.03;
    an.armL += (idleArm - an.armL) * Math.min(1, dt * 6);
    an.armR += (-idleArm - an.armR) * Math.min(1, dt * 6);
  }

  // reaching across the counter, or holding a box up to read the back of it
  if (opts.reach) {
    an.armR += (-1.35 - an.armR) * Math.min(1, dt * 7);
    an.armRz += (0.28 - an.armRz) * Math.min(1, dt * 7);
  } else if (opts.reading) {
    an.armR += (-1.05 - an.armR) * Math.min(1, dt * 5);
    an.armRz += (0.55 - an.armRz) * Math.min(1, dt * 5);
    an.armL += (-0.55 - an.armL) * Math.min(1, dt * 5);
  } else {
    an.armRz += (0 - an.armRz) * Math.min(1, dt * 6);
  }

  if (opts.talking) {
    an._talkT += dt * 9;
    an.headPitch = Math.sin(an._talkT) * 0.07;
    an.headYaw += ((Math.sin(an._talkT * 0.31) * 0.14) - an.headYaw) * Math.min(1, dt * 4);
  } else {
    an.headPitch += ((opts.headPitch || 0) - an.headPitch) * Math.min(1, dt * 5);
    an.headYaw += ((opts.headYaw || 0) - an.headYaw) * Math.min(1, dt * 5);
  }
}
