/* ============================================================
   actor.js -- the low-poly humanoid. One shared set of part
   meshes (roughly 90 triangles a person, which is about what an
   N64 crowd character cost) drawn with a per-person skin atlas
   and per-person scale. Limbs are separate parts so they can
   swing, limp, reach across the counter, and lunge.
   ============================================================ */
import { MeshBuilder } from '../engine/mesh.js';
import { mat, mul, setPosYaw, setRotX, setRotY, setScale, setTranslate } from '../engine/mathx.js';
import { ATLAS } from './appearance.js';

/* body metrics for a 1.75 m person, in metres */
const LEG_LEN = 0.74, SHOE_H = 0.08, HIP_Y = 0.90;
const TORSO_H = 0.58, TORSO_W = 0.21, TORSO_D = 0.12;
const SHOULDER_Y = 1.42, ARM_LEN = 0.56, ARM_W = 0.055, ARM_D = 0.065;
const HEAD_Y = 1.49, HEAD_H = 0.25, HEAD_W = 0.10, HEAD_D = 0.10;
export const ACTOR_HEIGHT = HEAD_Y + HEAD_H;

/** atlas rect (x,y,w,h) -> the quad uv rect the mesh builder wants */
const uv = (r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]];

export function buildActorMeshes() {
  const flat = (b) => { b.light = () => 1; return b; };

  // ---- torso: pivot at the hips ----
  const torso = flat(new MeshBuilder());
  torso.box(-TORSO_W, 0, -TORSO_D, TORSO_W, TORSO_H, TORSO_D, {
    pz: { tex: 0, uv: uv(ATLAS.torsoF) }, nz: { tex: 0, uv: uv(ATLAS.torsoB) },
    px: { tex: 0, uv: uv(ATLAS.torsoR) }, nx: { tex: 0, uv: uv(ATLAS.torsoL) },
    py: { tex: 0, uv: uv(ATLAS.torsoT) }, ny: { tex: 0, uv: uv(ATLAS.torsoD) },
  });

  // ---- head: pivot at the neck ----
  const head = flat(new MeshBuilder());
  head.box(-HEAD_W, 0, -HEAD_D, HEAD_W, HEAD_H, HEAD_D, {
    pz: { tex: 0, uv: uv(ATLAS.headF) }, nz: { tex: 0, uv: uv(ATLAS.headB) },
    px: { tex: 0, uv: uv(ATLAS.headR) }, nx: { tex: 0, uv: uv(ATLAS.headL) },
    py: { tex: 0, uv: uv(ATLAS.headT) }, ny: { tex: 0, uv: uv(ATLAS.headD) },
  });

  // ---- arm: pivot at the shoulder, hangs down -Y ----
  const arm = flat(new MeshBuilder());
  arm.box(-ARM_W, -ARM_LEN, -ARM_D, ARM_W, 0, ARM_D, {
    all: { tex: 0, uv: uv(ATLAS.arm) },
    ny: { tex: 0, uv: uv(ATLAS.hand) },
    py: { tex: 0, uv: uv(ATLAS.torsoT) },
  });

  // ---- leg + shoe: pivot at the hip ----
  const leg = flat(new MeshBuilder());
  leg.box(-0.075, -LEG_LEN, -0.085, 0.075, 0, 0.085, {
    all: { tex: 0, uv: uv(ATLAS.leg) },
    py: { tex: 0, uv: uv(ATLAS.torsoD) }, ny: null,
  });
  leg.box(-0.082, -LEG_LEN - SHOE_H, -0.10, 0.082, -LEG_LEN, 0.135, {
    all: { tex: 0, uv: uv(ATLAS.shoe) },
    py: { tex: 0, uv: uv(ATLAS.shoeT) },
  });

  // ---- headwear: pivot at the top of the head ----
  const cap = flat(new MeshBuilder());
  cap.box(-0.108, 0, -0.108, 0.108, 0.095, 0.108, {
    all: { tex: 0, uv: uv(ATLAS.hatS) },
    py: { tex: 0, uv: uv(ATLAS.hatT) }, ny: { tex: 0, uv: uv(ATLAS.hatB) },
  });
  cap.box(-0.10, -0.012, 0.10, 0.10, 0.012, 0.235, {
    all: { tex: 0, uv: uv(ATLAS.hatB) },
    py: { tex: 0, uv: uv(ATLAS.hatT) },
  });

  const beanie = flat(new MeshBuilder());
  beanie.box(-0.112, -0.055, -0.112, 0.112, 0.10, 0.112, {
    all: { tex: 0, uv: uv(ATLAS.hatS) },
    py: { tex: 0, uv: uv(ATLAS.hatT) }, ny: null,
  });

  const hood = flat(new MeshBuilder());
  hood.box(-0.135, -0.30, -0.150, 0.135, 0.075, 0.085, {
    all: { tex: 0, uv: uv(ATLAS.hatS) },
    py: { tex: 0, uv: uv(ATLAS.hatT) },
    pz: null, ny: null,
  });

  // ---- carried bag ----
  const bag = flat(new MeshBuilder());
  bag.box(-0.14, -0.12, -0.09, 0.14, 0.12, 0.09, { all: { tex: 0, uv: uv(ATLAS.bag) } });

  return {
    torso: torso.build(), head: head.build(), arm: arm.build(), leg: leg.build(),
    cap: cap.build(), beanie: beanie.build(), hood: hood.build(), bag: bag.build(),
  };
}

/* ---------------- scratch matrices ---------------- */
const _root = mat(), _tmp = mat(), _tmp2 = mat(), _part = mat(), _scale = mat(), _rot = mat();

/**
 * @param rz    Raster
 * @param M     part meshes from buildActorMeshes()
 * @param a     actor: { x, z, yaw, app, skin, anim:{phase,speed,armR,armL,lean,headYaw,headPitch,crouch} }
 * @param shade 0..1 light level at the actor
 */
export function drawActor(rz, M, a, shade) {
  const app = a.app;
  const hs = app.height.scale;
  const bw = app.build.w, bd = app.build.d;
  const an = a.anim;
  const tex = [a.skin];
  const opt = { shade, textures: tex };

  if (!rz.sphereVisible(a.x, ACTOR_HEIGHT * hs * 0.5, a.z, 1.15 * hs)) return;

  // root: position, facing, overall height
  setPosYaw(_tmp, a.x, a.y || 0, a.z, a.yaw);
  setScale(_scale, hs, hs, hs);
  mul(_root, _tmp, _scale);

  const bob = an.bob || 0;
  const crouch = an.crouch || 0;

  // ---- legs ----
  const swing = an.legSwing || 0;
  const limpL = an.limp ? 0.45 : 1;
  drawPart(rz, M.leg, _root, -0.098, HIP_Y - crouch, 0, swing * limpL, 0, opt);
  drawPart(rz, M.leg, _root, 0.098, HIP_Y - crouch - (an.limp ? 0.035 * Math.max(0, Math.sin(an.phase)) : 0), 0, -swing, 0, opt);

  // ---- torso ----
  setTranslate(_tmp, 0, HIP_Y + bob - crouch, 0);
  mul(_part, _root, _tmp);
  setRotX(_rot, an.lean || 0);
  mul(_part, _part, _rot);
  setScale(_scale, bw, 1, bd);
  mul(_part, _part, _scale);
  rz.drawMesh(M.torso, _part, opt);

  // ---- arms ----
  const ax = TORSO_W * bw + ARM_W + 0.008;
  drawPart(rz, M.arm, _root, -ax, SHOULDER_Y + bob - crouch, 0, an.armL || 0, an.armLz || 0, opt);
  drawPart(rz, M.arm, _root, ax, SHOULDER_Y + bob - crouch, 0, an.armR || 0, an.armRz || 0, opt);

  // ---- head ----
  setTranslate(_tmp, 0, HEAD_Y + bob - crouch, 0);
  mul(_part, _root, _tmp);
  setRotY(_rot, an.headYaw || 0);
  mul(_part, _part, _rot);
  setRotX(_rot, an.headPitch || 0);
  mul(_part, _part, _rot);
  rz.drawMesh(M.head, _part, opt);

  // ---- hat sits on top of the head, inheriting its rotation ----
  const hat = app.hat.id;
  if (hat !== 'none') {
    const hm = hat === 'beanie' ? M.beanie : hat === 'hood' ? M.hood : M.cap;
    setTranslate(_tmp, 0, HEAD_H, 0);
    mul(_tmp2, _part, _tmp);
    rz.drawMesh(hm, _tmp2, opt);
  }

  // ---- bag hangs off the right hand ----
  if (app.carry.id === 'duffel' || app.carry.id === 'backpack') {
    const back = app.carry.id === 'backpack';
    setTranslate(_tmp, back ? 0 : ax + 0.04, back ? 1.18 + bob : SHOULDER_Y - ARM_LEN + 0.02 + bob, back ? -TORSO_D - 0.09 : 0.02);
    mul(_tmp2, _root, _tmp);
    rz.drawMesh(M.bag, _tmp2, opt);
  }
}

function drawPart(rz, mesh, root, ox, oy, oz, rotX, rotZ, opt) {
  setTranslate(_tmp, ox, oy, oz);
  mul(_part, root, _tmp);
  if (rotZ) {
    setRotY(_rot, 0);
    _rot[0] = Math.cos(rotZ); _rot[1] = -Math.sin(rotZ);
    _rot[4] = Math.sin(rotZ); _rot[5] = Math.cos(rotZ);
    mul(_part, _part, _rot);
  }
  setRotX(_rot, rotX);
  mul(_part, _part, _rot);
  rz.drawMesh(mesh, _part, opt);
}

/* ============================================================
   Animation driver -- shared by customers, the officer and the
   killer, so everyone moves out of the same rig.
   ============================================================ */
export function makeAnim() {
  return {
    phase: Math.random() * 6.28, legSwing: 0, armL: 0, armR: 0, armLz: 0, armRz: 0,
    lean: 0, bob: 0, headYaw: 0, headPitch: 0, crouch: 0, limp: false,
    reach: 0, talk: 0, _talkT: 0,
  };
}

export function updateAnim(an, dt, moveSpeed, app, opts = {}) {
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

  // reaching across the counter overrides the right arm
  if (opts.reach) {
    an.armR += (-1.35 - an.armR) * Math.min(1, dt * 7);
    an.armRz += (0.28 - an.armRz) * Math.min(1, dt * 7);
  } else {
    an.armRz += (0 - an.armRz) * Math.min(1, dt * 6);
  }

  // talking: a small head nod, timed off the blip rate
  if (opts.talking) {
    an._talkT += dt * 9;
    an.headPitch = Math.sin(an._talkT) * 0.07;
    an.headYaw += ((Math.sin(an._talkT * 0.31) * 0.14) - an.headYaw) * Math.min(1, dt * 4);
  } else {
    an.headPitch += ((opts.headPitch || 0) - an.headPitch) * Math.min(1, dt * 5);
    an.headYaw += ((opts.headYaw || 0) - an.headYaw) * Math.min(1, dt * 5);
  }
}
