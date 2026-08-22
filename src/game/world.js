/* ============================================================
   world.js -- SUNSET VIDEO, 4412 Delaney Ave. Built once at boot
   into a single static mesh, plus a handful of dynamic pieces
   (the doors, tapes, the TV) that move or swap textures.

   Floor plan, metres:
       x: 0 .. 13      z: 0 .. 9.6      ceiling: 3.0
       front wall (glass + door) at z = 0, street beyond
       service counter along the right at z = 1.2 .. 1.95
       four gondolas running front-to-back, two wall runs at the back
   ============================================================ */
import { MeshBuilder } from '../engine/mesh.js';
import { F_DOUBLE, F_EMIT, F_BLEND } from '../engine/raster.js';
import { makeTex } from '../engine/texture.js';
import { GENRES, GENRE_LABEL } from './tapes.js';

export const W = 13.0, D = 9.6, H = 3.0;
export const DOOR_X0 = 5.2, DOOR_X1 = 6.8, DOOR_H = 2.15;
export const COUNTER = { x0: 9.0, x1: 12.9, z0: 1.20, z1: 1.95, y: 1.05 };
export const EYE = 1.66;

/* Where the ceiling fluorescents are. Also drives the baked vertex light. */
export const LIGHTS = [
  { x: 2.5, y: 2.86, z: 2.6, r: 8.6, i: 1.02 },
  { x: 6.5, y: 2.86, z: 2.6, r: 8.6, i: 1.02 },
  { x: 10.5, y: 2.86, z: 2.6, r: 8.6, i: 1.10 },
  { x: 2.5, y: 2.86, z: 5.6, r: 8.2, i: 0.92 },
  { x: 6.5, y: 2.86, z: 5.6, r: 8.2, i: 0.92 },
  { x: 10.5, y: 2.86, z: 5.6, r: 8.2, i: 0.86 },
  { x: 2.5, y: 2.86, z: 8.5, r: 7.4, i: 0.66 },
  { x: 6.5, y: 2.86, z: 8.5, r: 7.4, i: 0.66 },
  { x: 10.5, y: 2.86, z: 8.5, r: 7.4, i: 0.60 },
];
const AMBIENT = 0.30;

export function lightAt(x, y, z, nx, ny, nz) {
  let s = AMBIENT;
  for (let i = 0; i < LIGHTS.length; i++) {
    const L = LIGHTS[i];
    const dx = L.x - x, dy = L.y - y, dz = L.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2) || 0.0001;
    let a = 1 - d / L.r;
    if (a <= 0) continue;
    a *= a;
    let ndl = 1;
    if (nx !== undefined) ndl = Math.max(0, (dx * nx + dy * ny + dz * nz) / d) * 0.8 + 0.2;
    s += L.i * a * ndl;
  }
  // the street sign bleeds a little pink through the front glass
  const fd = Math.max(0, 1 - Math.hypot(x - 6, z + 0.5) / 7);
  s += fd * fd * 0.1;
  return Math.min(1.55, s);
}

/** Streetlamps and the spill out of the store's own windows. */
export const LAMPS = [{ x: 1.8, z: -3.0 }, { x: 10.8, z: -3.0 }];
export function outdoorLightAt(x, y, z) {
  let s = 0.11;
  s += Math.max(0, 1 - Math.hypot(x - 6, z) / 8.5) * 0.44;          // window spill
  for (const L of LAMPS) {
    const a = Math.max(0, 1 - Math.hypot(x - L.x, z - L.z) / 5.0);
    s += a * a * 0.62;
  }
  return Math.min(1.25, s);
}

/* Shelf runs. Each is one genre and one interaction target. */
export const SHELVES = [
  { genre: 'HORROR', axis: 'z', x0: 1.30, x1: 1.92, z0: 3.2, z1: 7.2, top: 1.95, browse: [{ x: 0.86, z: 5.1, yaw: Math.PI / 2 }, { x: 2.42, z: 5.6, yaw: -Math.PI / 2 }] },
  { genre: 'COMEDY', axis: 'z', x0: 3.30, x1: 3.92, z0: 3.2, z1: 7.2, top: 1.95, browse: [{ x: 2.84, z: 4.6, yaw: Math.PI / 2 }, { x: 4.42, z: 6.0, yaw: -Math.PI / 2 }] },
  { genre: 'ACTION', axis: 'z', x0: 5.30, x1: 5.92, z0: 3.2, z1: 7.2, top: 1.95, browse: [{ x: 4.84, z: 5.4, yaw: Math.PI / 2 }, { x: 6.42, z: 4.4, yaw: -Math.PI / 2 }] },
  { genre: 'SCIFI', axis: 'z', x0: 7.30, x1: 7.92, z0: 3.2, z1: 7.2, top: 1.95, browse: [{ x: 6.84, z: 6.2, yaw: Math.PI / 2 }, { x: 8.44, z: 5.0, yaw: -Math.PI / 2 }] },
  { genre: 'DRAMA', axis: 'x', x0: 0.60, x1: 5.20, z0: 9.15, z1: 9.60, top: 2.20, browse: [{ x: 2.0, z: 8.62, yaw: 0 }, { x: 4.1, z: 8.62, yaw: 0 }] },
  { genre: 'FAMILY', axis: 'x', x0: 6.40, x1: 12.40, z0: 9.15, z1: 9.60, top: 2.20, browse: [{ x: 7.8, z: 8.62, yaw: 0 }, { x: 10.6, z: 8.62, yaw: 0 }] },
];

/* Fixed spots the simulation steers people to. */
export const SPOTS = {
  street: { x: 6.0, z: -2.6 },
  outsideDoor: { x: 6.0, z: -0.9 },
  door: { x: 6.0, z: 0.55 },
  lobby: { x: 6.6, z: 2.2 },
  service: { x: 10.75, z: 0.80, yaw: 0 },
  queue: [{ x: 9.70, z: 0.78 }, { x: 8.70, z: 0.82 }, { x: 7.80, z: 1.10 }],
  playerStart: { x: 10.75, z: 3.35, yaw: Math.PI, pitch: -0.13 },
  officerStand: { x: 10.05, z: 0.85, yaw: 0.22 },
  stalkPosts: [
    { x: 3.2, z: -1.3 }, { x: 9.6, z: -1.35 }, { x: 6.1, z: -1.7 },
    { x: 1.4, z: -1.2 }, { x: 11.6, z: -1.2 },
  ],
};

/* Counter-top slots where tapes physically sit. */
export const COUNTER_SLOTS = [
  { x: 10.05, y: COUNTER.y, z: 1.57 },
  { x: 10.50, y: COUNTER.y, z: 1.57 },
  { x: 10.95, y: COUNTER.y, z: 1.57 },
  { x: 11.40, y: COUNTER.y, z: 1.57 },
];

export const PROPS = {
  bin: { x0: 9.10, x1: 9.74, y0: COUNTER.y, y1: COUNTER.y + 0.42, z0: 1.30, z1: 1.86, label: 'RETURN BIN' },
  rewinder: { x0: 11.72, x1: 12.28, y0: COUNTER.y, y1: COUNTER.y + 0.20, z0: 1.34, z1: 1.82, label: 'REWINDER' },
  register: { x0: 12.36, x1: 12.88, y0: COUNTER.y, y1: COUNTER.y + 0.34, z0: 1.32, z1: 1.84, label: 'REGISTER' },
  phone: { x0: 12.82, x1: 13.0, y0: 1.15, y1: 1.62, z0: 2.90, z1: 3.34, label: 'PHONE' },
  door: { x0: DOOR_X0, x1: DOOR_X1, y0: 0, y1: DOOR_H, z0: -0.09, z1: 0.09, label: 'FRONT DOOR' },
};

/* ============================================================ */
export function buildWorld(T) {
  const mb = new MeshBuilder();
  mb.light = lightAt;

  const tape = makeTapeTextures();

  /* ---------------- floor + ceiling ---------------- */
  mb.quad([0, 0, D], [W, 0, D], [W, 0, 0], [0, 0, 0], T.carpet, [0, 0, 64, 64], 0, [13, 10, true]);
  // worn path from the door to the counter
  mb.quad([4.9, 0.005, 2.6], [12.9, 0.005, 2.6], [12.9, 0.005, 0.1], [4.9, 0.005, 0.1],
    T.carpetWorn, [0, 0, 64, 64], 0, [8, 3, true]);
  mb.quad([0, H, 0], [W, H, 0], [W, H, D], [0, H, D], T.ceiling, [0, 0, 64, 64], 0, [13, 10, true]);

  // fluorescent panels, recessed and emissive
  for (const L of LIGHTS) {
    mb.quad([L.x - 0.62, H - 0.02, L.z - 0.28], [L.x + 0.62, H - 0.02, L.z - 0.28],
      [L.x + 0.62, H - 0.02, L.z + 0.28], [L.x - 0.62, H - 0.02, L.z + 0.28],
      T.lightPanel, [0, 0, 64, 64], F_EMIT);
  }

  /* ---------------- perimeter walls ---------------- */
  const wallSeg = (x0, z0, x1, z1) => {
    // inward-facing wall panel from (x0,z0) to (x1,z1)
    const len = Math.hypot(x1 - x0, z1 - z0);
    mb.quad([x0, 0, z0], [x1, 0, z1], [x1, H, z1], [x0, H, z0], T.wall, [0, 0, 64, 64], 0, [Math.max(1, Math.round(len * 1.1)), 3, true]);
    mb.quad([x0, 0, z0], [x1, 0, z1], [x1, 1.05, z1], [x0, 1.05, z0], T.wainscot, [0, 0, 64, 64], 0, [Math.max(1, Math.round(len * 1.3)), 1, true]);
    mb.quad([x0, 1.05, z0], [x1, 1.05, z1], [x1, 1.14, z1], [x0, 1.14, z0], T.wallLowerTrim, [0, 0, 64, 16], 0, [Math.max(1, Math.round(len)), 1, true]);
  };
  wallSeg(0, D, 0, 0);          // left wall, facing +X
  wallSeg(W, 0, W, D);          // right wall, facing -X
  wallSeg(W, D, 0, D);          // back wall, facing -Z
  // front wall: two piers either side of the door, plus header and knee walls
  frontWall(mb, T);

  /* ---------------- the street outside ---------------- */
  outside(mb, T);

  /* ---------------- shelving ---------------- */
  for (const s of SHELVES) buildShelf(mb, T, s);

  // decorative NEW RELEASES run on the left wall
  mb.box(0.02, 0.10, 2.4, 0.48, 2.05, 8.4, {
    all: { tex: T.shelfWood, uv: [0, 0, 64, 64] },
    px: { tex: T.spines.ACTION, uv: [0, 0, 64, 64], sub: [6, 2, true] },
    nx: null,
  });
  for (let i = 0; i < 4; i++) {
    mb.box(0.02, 0.42 + i * 0.42, 2.4, 0.52, 0.47 + i * 0.42, 8.4, { all: { tex: T.shelfWood, uv: [0, 0, 32, 12] } });
  }
  mb.plate(0.30, 2.10, 5.4, 1.3, 0.28, Math.PI / 2, T.signs.ACTION, [0, 0, 64, 16], F_EMIT);

  /* ---------------- service counter ---------------- */
  const C = COUNTER;
  mb.box(C.x0, 0, C.z0, C.x1, C.y, C.z1, {
    all: { tex: T.counterFront, uv: [0, 0, 64, 64], sub: [4, 1, true] },
    py: { tex: T.counterTop, uv: [0, 0, 64, 64], sub: [6, 1, true] },
    px: null, ny: null,
  });
  // kick rail and the sign taped to the front
  mb.box(C.x0, 0, C.z0 - 0.03, C.x1, 0.09, C.z0, { all: { tex: T.wallLowerTrim, uv: [0, 0, 64, 16], sub: [5, 1, true] } });
  mb.plate(10.25, 0.44, C.z0 - 0.012, 0.66, 0.33, 0, T.beKind, [0, 0, 64, 32], 0);
  mb.plate(11.75, 0.44, C.z0 - 0.012, 0.64, 0.32, 0, T.lateFeeSign, [0, 0, 64, 32], 0);

  // back counter behind the clerk
  mb.box(12.30, 0, 3.70, 12.98, 0.92, 5.60, {
    all: { tex: T.counterFront, uv: [0, 0, 64, 64], sub: [3, 1, true] },
    py: { tex: T.counterTop, uv: [0, 0, 64, 64], sub: [4, 1, true] },
    px: null, nz: null,
  });

  /* ---------------- counter props ---------------- */
  const P = PROPS;
  mb.box(P.bin.x0, P.bin.y0, P.bin.z0, P.bin.x1, P.bin.y1, P.bin.z1, {
    all: { tex: T.binFront, uv: [0, 0, 64, 64] },
    py: { tex: T.binFront, uv: [0, 0, 64, 20] },
  });
  mb.box(P.rewinder.x0, P.rewinder.y0, P.rewinder.z0, P.rewinder.x1, P.rewinder.y1, P.rewinder.z1, {
    all: { tex: T.rewinder, uv: [0, 0, 64, 64] },
  });
  mb.box(P.register.x0, P.register.y0, P.register.z0, P.register.x1, P.register.y1, P.register.z1, {
    all: { tex: T.register, uv: [0, 0, 64, 64] },
    py: { tex: T.register, uv: [0, 28, 64, 64] },
  });
  // wall phone
  mb.box(P.phone.x0 - 0.02, P.phone.y0, P.phone.z0, P.phone.x0 + 0.10, P.phone.y1, P.phone.z1, {
    all: { tex: T.phone, uv: [0, 0, 64, 64] },
    px: null,
  });

  /* ---------------- dressing ---------------- */
  // candy rack + popcorn machine by the counter
  mb.box(8.28, 0, 1.24, 8.82, 1.45, 1.90, { all: { tex: T.candyRack, uv: [0, 0, 64, 64], sub: [1, 2, true] } });
  mb.box(12.36, 0.92, 4.10, 12.94, 1.62, 4.80, { all: { tex: T.popcorn, uv: [0, 0, 64, 64] } });
  // wall clock behind the counter
  mb.quad([12.96, 1.78, 5.85], [12.96, 1.78, 6.45], [12.96, 2.38, 6.45], [12.96, 2.38, 5.85],
    T.clock, [0, 0, 32, 32], 0);
  // exit sign over the door
  mb.quad([5.72, 2.28, 0.10], [6.28, 2.28, 0.10], [6.28, 2.50, 0.10], [5.72, 2.50, 0.10],
    T.exitSign, [0, 0, 32, 16], F_EMIT);
  // welcome mat
  mb.quad([6.95, 0.006, 0.12], [5.05, 0.006, 0.12], [5.05, 0.006, 1.35], [6.95, 0.006, 1.35],
    T.mat, [0, 0, 64, 64], 0, [2, 1, true]);
  // posters on the walls
  const posterAt = (x, y, z, yaw, i) => mb.plate(x, y, z, 0.58, 1.1, yaw, T.posters[i % T.posters.length], [0, 0, 32, 64], 0);
  posterAt(0.06, 1.25, 1.5, Math.PI / 2, 0);
  posterAt(0.06, 1.25, 9.0, Math.PI / 2, 3);
  posterAt(12.94, 1.30, 6.4, -Math.PI / 2, 1);
  posterAt(12.94, 1.30, 7.6, -Math.PI / 2, 2);
  posterAt(6.2, 1.35, 9.55, Math.PI, 0);
  posterAt(5.6, 1.35, 9.55, Math.PI, 1);
  // trash can
  mb.box(0.22, 0, 1.0, 0.62, 0.72, 1.4, { all: { tex: T.wainscot, uv: [0, 0, 32, 32] } });

  // ceiling-hung TV in the corner, playing static
  const tv = new MeshBuilder();
  tv.light = () => 1;
  tv.box(-0.30, -0.24, -0.20, 0.30, 0.24, 0.20, { all: { tex: T.tvShell, uv: [0, 0, 64, 64] }, nz: null });
  tv.quad([-0.26, -0.20, -0.205], [0.26, -0.20, -0.205], [0.26, 0.20, -0.205], [-0.26, 0.20, -0.205],
    T.staticFrames[0], [2, 2, 62, 62], F_EMIT);
  const tvMesh = tv.build();
  const tvPos = { x: 1.05, y: 2.42, z: 2.05, yaw: -0.5 };

  /* ---------------- doors (dynamic, two leaves) ---------------- */
  const doorLeaf = (tex) => {
    const b = new MeshBuilder();
    b.light = () => 0.95;
    const w = (DOOR_X1 - DOOR_X0) / 2;
    b.box(0, 0, -0.03, w, DOOR_H, 0.03, {
      all: { tex: T.doorFrame, uv: [0, 0, 8, 64] },
      pz: { tex, uv: [0, 0, 64, 64], flags: F_BLEND },
      nz: { tex, uv: [0, 0, 64, 64], flags: F_BLEND },
    });
    // stiles so the glass reads as a door, not a floating pane
    b.box(0, 0, -0.035, 0.07, DOOR_H, 0.035, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
    b.box(w - 0.07, 0, -0.035, w, DOOR_H, 0.035, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
    b.box(0, 0, -0.035, w, 0.16, 0.035, { all: { tex: T.doorFrame, uv: [0, 0, 64, 16] } });
    b.box(0, DOOR_H - 0.12, -0.035, w, DOOR_H, 0.035, { all: { tex: T.doorFrame, uv: [0, 0, 64, 16] } });
    return b.build();
  };

  const mesh = mb.build();

  return {
    mesh,
    tvMesh, tvPos,
    doorOpenMesh: doorLeaf(T.doorGlass),
    doorLockedMesh: doorLeaf(T.doorLocked),
    tapeTex: tape,
    tapeMesh: buildTapeMesh(tape),
    solids: buildSolids(),
    T,
  };
}

/* ---------------- front wall with glass ---------------- */
function frontWall(mb, T) {
  const SILL = 0.92, TOP = 2.34;
  const seg = (x0, x1) => {
    // knee wall
    mb.quad([x0, 0, 0], [x1, 0, 0], [x1, SILL, 0], [x0, SILL, 0], T.wainscot, [0, 0, 64, 64], 0, [Math.round((x1 - x0) * 1.4), 1, true]);
    mb.quad([x0, SILL, 0], [x1, SILL, 0], [x1, SILL + 0.08, 0], [x0, SILL + 0.08, 0], T.wallLowerTrim, [0, 0, 64, 16], 0, [Math.round(x1 - x0), 1, true]);
    // glass
    mb.quad([x0, SILL + 0.08, 0.01], [x1, SILL + 0.08, 0.01], [x1, TOP, 0.01], [x0, TOP, 0.01],
      T.glass, [0, 0, 64, 64], F_BLEND | F_DOUBLE, [Math.round((x1 - x0) / 1.2), 1, true]);
    // mullions
    const n = Math.max(1, Math.round((x1 - x0) / 1.2));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n);
      mb.box(x - 0.035, SILL, -0.04, x + 0.035, TOP, 0.04, { all: { tex: T.doorFrame, uv: [0, 0, 8, 64] } });
    }
    mb.box(x0, TOP, -0.05, x1, TOP + 0.08, 0.05, { all: { tex: T.doorFrame, uv: [0, 0, 64, 8] } });
    // header above the glass
    mb.quad([x0, TOP + 0.08, 0], [x1, TOP + 0.08, 0], [x1, H, 0], [x0, H, 0], T.wall, [0, 0, 64, 64], 0, [Math.round(x1 - x0), 1, true]);
  };
  seg(0.0, DOOR_X0 - 0.12);
  seg(DOOR_X1 + 0.12, W);
  // door jambs and header
  mb.box(DOOR_X0 - 0.14, 0, -0.07, DOOR_X0, H, 0.07, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
  mb.box(DOOR_X1, 0, -0.07, DOOR_X1 + 0.14, H, 0.07, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
  mb.box(DOOR_X0 - 0.14, DOOR_H, -0.07, DOOR_X1 + 0.14, DOOR_H + 0.12, 0.07, { all: { tex: T.doorFrame, uv: [0, 0, 64, 12] } });
  mb.quad([DOOR_X0 - 0.14, DOOR_H + 0.12, 0], [DOOR_X1 + 0.14, DOOR_H + 0.12, 0],
    [DOOR_X1 + 0.14, H, 0], [DOOR_X0 - 0.14, H, 0], T.wall, [0, 0, 64, 32], 0);
}

/* ---------------- the street ---------------- */
function outside(mb, T) {
  const OX0 = -8, OX1 = 21, OZ = -9.5;
  const dim = mb.light;
  mb.light = outdoorLightAt;
  // sidewalk + road
  mb.quad([OX0, 0, 0], [OX1, 0, 0], [OX1, 0, -3.6], [OX0, 0, -3.6], T.sidewalk, [0, 0, 64, 64], 0, [14, 2, true]);
  mb.quad([OX0, -0.12, -3.6], [OX1, -0.12, -3.6], [OX1, -0.12, OZ], [OX0, -0.12, OZ], T.asphalt, [0, 0, 64, 64], 0, [14, 3, true]);
  mb.box(OX0, -0.12, -3.72, OX1, 0.02, -3.6, { all: { tex: T.sidewalk, uv: [0, 0, 64, 8], sub: [14, 1, true] } });
  // backdrop -- emissive so distance fog does not swallow the skyline
  mb.light = () => 1;
  mb.quad([OX0, -0.5, OZ], [OX1, -0.5, OZ], [OX1, 7.5, OZ], [OX0, 7.5, OZ], T.nightStreet, [0, 0, 128, 64], F_EMIT, [3, 1, true]);
  mb.light = () => 0.2;
  mb.quad([OX0, -0.5, 0], [OX0, -0.5, OZ], [OX0, 7.5, OZ], [OX0, 7.5, 0], T.dark, [0, 0, 8, 8], 0);
  mb.quad([OX1, -0.5, OZ], [OX1, -0.5, 0], [OX1, 7.5, 0], [OX1, 7.5, OZ], T.dark, [0, 0, 8, 8], 0);
  mb.quad([OX0, 7.5, 0], [OX0, 7.5, OZ], [OX1, 7.5, OZ], [OX1, 7.5, 0], T.black, [0, 0, 8, 8], 0);
  // storefront exterior above the glass + the neon sign
  mb.light = () => 0.5;
  mb.quad([W, 2.42, -0.02], [0, 2.42, -0.02], [0, 3.9, -0.02], [W, 3.9, -0.02], T.wall, [0, 0, 64, 64], 0, [13, 2, true]);
  mb.quad([-0.4, 0, -0.03], [-0.4, 3.9, -0.03], [0, 3.9, -0.03], [0, 0, -0.03], T.wall, [0, 0, 8, 64], 0);
  mb.light = () => 1;
  mb.quad([9.6, 2.72, -0.10], [3.4, 2.72, -0.10], [3.4, 3.52, -0.10], [9.6, 3.52, -0.10],
    T.neon, [0, 0, 128, 32], F_EMIT);
  // sodium street lamps -- the only reason you can see anything out there
  for (const L of LAMPS) {
    mb.light = () => 0.5;
    mb.box(L.x - 0.06, 0, L.z - 0.06, L.x + 0.06, 3.4, L.z + 0.06, { all: { tex: T.doorFrame, uv: [0, 0, 8, 64] } });
    mb.box(L.x - 0.05, 3.34, L.z - 0.05, L.x + 0.05, 3.42, L.z + 0.62, { all: { tex: T.doorFrame, uv: [0, 0, 8, 16] } });
    mb.light = () => 1;
    mb.box(L.x - 0.22, 3.10, L.z + 0.36, L.x + 0.22, 3.34, L.z + 0.82, {
      all: { tex: T.lightPanel, uv: [0, 0, 64, 64], flags: F_EMIT },
    });
  }
  mb.light = dim;
}

/* ---------------- one shelf run ---------------- */
function buildShelf(mb, T, s) {
  const spine = T.spines[s.genre];
  const along = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0;
  const reps = Math.max(2, Math.round(along * 1.6));
  const faces = { all: { tex: T.shelfWood, uv: [0, 0, 64, 64] } };
  if (s.axis === 'z') {
    faces.px = { tex: spine, uv: [0, 0, 64, 64], sub: [reps, 3, true] };
    faces.nx = { tex: spine, uv: [0, 0, 64, 64], sub: [reps, 3, true] };
  } else {
    faces.nz = { tex: spine, uv: [0, 0, 64, 64], sub: [reps, 3, true] };
    faces.pz = null;
  }
  faces.ny = null;
  mb.box(s.x0, 0.14, s.z0, s.x1, s.top, s.z1, faces);
  // toe kick
  mb.box(s.x0 + 0.04, 0, s.z0 + 0.04, s.x1 - 0.04, 0.14, s.z1 - 0.04,
    { all: { tex: T.wallLowerTrim, uv: [0, 0, 64, 16], sub: [reps, 1, true] } });
  // protruding shelf boards break up the flat spine wall
  const levels = s.top > 2 ? 5 : 4;
  for (let i = 1; i <= levels; i++) {
    const y = 0.14 + (s.top - 0.14) * (i / (levels + 0.4));
    if (s.axis === 'z') {
      mb.box(s.x0 - 0.03, y, s.z0, s.x1 + 0.03, y + 0.035, s.z1,
        { all: { tex: T.shelfWood, uv: [0, 0, 64, 8], sub: [reps, 1, true] } });
    } else {
      mb.box(s.x0, y, s.z0 - 0.03, s.x1, y + 0.035, s.z1 + 0.03,
        { all: { tex: T.shelfWood, uv: [0, 0, 64, 8], sub: [reps, 1, true] } });
    }
  }
  // header sign
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
  const sign = T.signs[s.genre];
  if (s.axis === 'z') {
    mb.quad([s.x0 - 0.04, s.top, cz - 0.7], [s.x0 - 0.04, s.top, cz + 0.7],
      [s.x0 - 0.04, s.top + 0.30, cz + 0.7], [s.x0 - 0.04, s.top + 0.30, cz - 0.7], sign, [0, 0, 64, 16], F_EMIT);
    mb.quad([s.x1 + 0.04, s.top, cz + 0.7], [s.x1 + 0.04, s.top, cz - 0.7],
      [s.x1 + 0.04, s.top + 0.30, cz - 0.7], [s.x1 + 0.04, s.top + 0.30, cz + 0.7], sign, [0, 0, 64, 16], F_EMIT);
    mb.box(s.x0 - 0.05, s.top, cz - 0.72, s.x1 + 0.05, s.top + 0.32, cz + 0.72,
      { all: { tex: T.shelfWood, uv: [0, 0, 32, 8] }, px: null, nx: null });
  } else {
    mb.quad([cx + 1.0, s.top, s.z0 - 0.05], [cx - 1.0, s.top, s.z0 - 0.05],
      [cx - 1.0, s.top + 0.30, s.z0 - 0.05], [cx + 1.0, s.top + 0.30, s.z0 - 0.05], sign, [0, 0, 64, 16], F_EMIT);
  }
}

/* ---------------- VHS textures + mesh ---------------- */
function makeTapeTextures() {
  const out = {};
  const COL = {
    HORROR: ['#3a0a0a', '#ff4b3a'], COMEDY: ['#3a2c05', '#ffd447'],
    ACTION: ['#08203a', '#4fa8ff'], SCIFI: ['#0a2a33', '#5cf0ff'],
    DRAMA: ['#2a2418', '#e8d9ae'], FAMILY: ['#0a2e18', '#7cf09a'],
  };
  for (const g of GENRES) {
    const [bg, fg] = COL[g];
    out[g] = makeTex(64, 64, (c) => {
      c.fillStyle = '#141418'; c.fillRect(0, 0, 64, 64);
      // sleeve face
      c.fillStyle = bg; c.fillRect(2, 2, 60, 60);
      const gr = c.createRadialGradient(32, 24, 2, 32, 24, 30);
      gr.addColorStop(0, fg + '55'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(2, 2, 60, 60);
      c.fillStyle = '#000';
      c.beginPath(); c.ellipse(32, 28, 7, 13, 0, 0, 7); c.fill();
      // spine label
      c.fillStyle = '#d8cfae'; c.fillRect(4, 46, 56, 14);
      c.fillStyle = '#2a2418';
      c.font = 'bold 8px "Courier New",monospace'; c.textAlign = 'center';
      c.fillText(GENRE_LABEL[g], 32, 56);
      c.fillStyle = fg; c.fillRect(4, 44, 56, 2);
      c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeRect(2.5, 2.5, 59, 59);
      const d = c.getImageData(0, 0, 64, 64), p = d.data;
      for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - 0.5) * 16; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
      c.putImageData(d, 0, 0);
    });
  }
  return out;
}

/** A VHS clamshell: 0.19 x 0.11 x 0.028 m, origin at its centre. */
function buildTapeMesh(tapeTex) {
  const out = {};
  for (const g of GENRES) {
    const b = new MeshBuilder();
    b.light = () => 1;
    b.box(-0.055, -0.095, -0.014, 0.055, 0.095, 0.014, {
      all: { tex: tapeTex[g], uv: [4, 4, 60, 60] },
      pz: { tex: tapeTex[g], uv: [2, 2, 62, 62] },
      nz: { tex: tapeTex[g], uv: [2, 2, 62, 62] },
    });
    out[g] = b.build();
  }
  return out;
}

/* ---------------- collision ---------------- */
function buildSolids() {
  const S = [];
  const add = (x0, z0, x1, z1, tag) => S.push({ x0, z0, x1, z1, tag: tag || 'wall' });
  const T = 0.4;
  // perimeter
  add(-T, -T, 0, D + T); add(W, -T, W + T, D + T);
  add(0, D, W, D + T);
  // front wall either side of the door
  add(0, -T, DOOR_X0, 0.06); add(DOOR_X1, -T, W, 0.06);
  // counter
  add(COUNTER.x0, COUNTER.z0, COUNTER.x1, COUNTER.z1, 'counter');
  add(12.30, 3.70, 12.98, 5.60, 'counter');
  add(8.28, 1.24, 8.82, 1.90, 'candy');
  add(0.22, 1.0, 0.62, 1.4, 'trash');
  add(0.0, 2.4, 0.52, 8.4, 'shelf');
  for (const s of SHELVES) add(s.x0, s.z0, s.x1, s.z1, 'shelf');
  // keep people out of the street beyond the sidewalk
  add(-9, -4.9, 22, -4.6, 'curb');
  add(-9, -4.9, -6.5, 1, 'curb'); add(19.5, -4.9, 22, 1, 'curb');
  return S;
}

/* ---------------- collision resolution ---------------- */
export function collide(x, z, r, solids, doorOpen) {
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const cx = Math.max(s.x0, Math.min(x, s.x1));
    const cz = Math.max(s.z0, Math.min(z, s.z1));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2);
      if (d > 0.0001) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
      else {
        // dead centre: push out along the shallowest axis
        const px = Math.min(x - s.x0, s.x1 - x), pz = Math.min(z - s.z0, s.z1 - z);
        if (px < pz) x = (x - s.x0 < s.x1 - x) ? s.x0 - r : s.x1 + r;
        else z = (z - s.z0 < s.z1 - z) ? s.z0 - r : s.z1 + r;
      }
    }
  }
  if (!doorOpen) {
    // locked door: a solid slab across the opening
    const cx = Math.max(DOOR_X0 - 0.1, Math.min(x, DOOR_X1 + 0.1));
    const cz = Math.max(-0.08, Math.min(z, 0.08));
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.0001;
      x = cx + (dx / d) * r; z = cz + (dz / d) * r;
    }
  }
  return [x, z];
}

/** Straight-line walkability test, used by the simple navigator. */
export function clearPath(x0, z0, x1, z1, solids, r) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    for (const s of solids) {
      if (s.tag === 'curb') continue;
      if (x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r) return false;
    }
  }
  return true;
}
