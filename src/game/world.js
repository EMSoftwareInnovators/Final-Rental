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

/* The back room. Reached through the gap the two rear shelf runs leave in
   the back wall, and the only door in the building you can put between
   yourself and someone else. */
export const STORAGE = { x0: 4.30, x1: 8.90, z0: D, z1: 12.90, H: 2.60 };
export const SDOOR_X0 = 5.45, SDOOR_X1 = 6.45, SDOOR_H = 2.05;

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

/** The single bare bulb in the back room, kept out of LIGHTS so the sales
    floor's baked lighting is unchanged. */
export const STORAGE_LIGHT = { x: 6.6, y: 2.45, z: 11.1, r: 6.4, i: 1.0 };

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
  if (z > D - 0.4) {
    const L = STORAGE_LIGHT;
    const dx = L.x - x, dy = L.y - y, dz = L.z - z;
    const a = Math.max(0, 1 - Math.hypot(dx, dy, dz) / L.r);
    s += L.i * a * a;
  }
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
  // pulled clear of the back-room doorway, which it used to overlap
  { genre: 'FAMILY', axis: 'x', x0: 6.70, x1: 12.40, z0: 9.15, z1: 9.60, top: 2.20, browse: [{ x: 8.1, z: 8.62, yaw: 0 }, { x: 10.6, z: 8.62, yaw: 0 }] },
  /* The left wall was a second ACTION run: decorative, unbrowsable, and
     confusing next to the real one. It is the games section now -- 1996 is
     exactly when a video shop started renting cartridges alongside tapes. */
  { genre: 'GAMES', axis: 'z', wall: true, x0: 0.02, x1: 0.56, z0: 2.40, z1: 8.40, top: 2.05, browse: [{ x: 1.06, z: 3.9, yaw: -Math.PI / 2 }, { x: 1.06, z: 6.8, yaw: -Math.PI / 2 }] },
];

/* Fixed spots the simulation steers people to. */
export const SPOTS = {
  street: { x: 6.0, z: -2.6 },
  outsideDoor: { x: 6.0, z: -0.9 },
  door: { x: 6.0, z: 0.55 },
  lobby: { x: 6.6, z: 2.2 },
  service: { x: 10.75, z: 0.80, yaw: 0 },
  queue: [{ x: 9.70, z: 0.78 }, { x: 8.70, z: 0.80 }, { x: 7.80, z: 0.84 }],
  playerStart: { x: 10.75, z: 3.35, yaw: Math.PI, pitch: -0.13 },
  officerStand: { x: 10.05, z: 0.85, yaw: 0.22 },
  officerWait: { x: 9.30, z: 1.05, yaw: 0.30 },
  storageDoor: { x: 5.95, z: 9.2 },
  storageHide: { x: 6.6, z: 11.2 },
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
  // Sitting on the back counter (top at y 0.92), within the clerk's reach.
  phone: { x0: 12.44, x1: 12.86, y0: 0.92, y1: 1.10, z0: 4.16, z1: 4.62, label: 'PHONE' },
  door: { x0: DOOR_X0, x1: DOOR_X1, y0: 0, y1: DOOR_H, z0: -0.09, z1: 0.09, label: 'FRONT DOOR' },
  storageDoor: { x0: SDOOR_X0, x1: SDOOR_X1, y0: 0, y1: SDOOR_H, z0: D - 0.12, z1: D + 0.12, label: 'BACK ROOM' },
};

/* ============================================================ */
export function buildWorld(T) {
  const mb = new MeshBuilder();
  mb.light = lightAt;

  const tape = makeTapeTextures();

  /* ---------------- floor + ceiling ----------------
     The worn path used to be a second quad laid five millimetres over the
     carpet, and the welcome mat a third over that. At a metre and a half of
     eye height and a near plane of eight centimetres, five millimetres is
     well inside the 1/z depth buffer's resolution out across the room, so
     the two surfaces traded pixels as you walked -- the glitching in front
     of the door and along the walk-up to the counter. There is one floor
     now, tiled a square at a time, and each tile picks the texture that
     belongs to where it is. */
  carpetFloor(mb, T);
  ceilingGrid(mb, T, 0, 0, W, D, H, 0);

  // fluorescent panels, recessed and emissive
  for (const L of LIGHTS) {
    mb.quad([L.x - 0.62, H - 0.02, L.z - 0.28], [L.x + 0.62, H - 0.02, L.z - 0.28],
      [L.x + 0.62, H - 0.02, L.z + 0.28], [L.x - 0.62, H - 0.02, L.z + 0.28],
      T.lightPanel, [0, 0, 64, 64], F_EMIT);
  }

  /* ---------------- perimeter walls ----------------
     The wainscot, its cap rail and the painted wall above it each own a
     distinct band of height. They used to be three quads on one plane,
     which is a depth-buffer coin toss: the upper wall's texture won at
     random across the bottom half and flickered as you walked.          */
  wallSeg(mb, T, 0, D, 0, 0);          // left wall, facing +X
  wallSeg(mb, T, W, 0, W, D);          // right wall, facing -X
  // back wall, facing -Z, broken by the doorway into the back room
  wallSeg(mb, T, W, D, SDOOR_X1, D);
  wallSeg(mb, T, SDOOR_X0, D, 0, D);
  backRoomOpening(mb, T);
  // front wall: two piers either side of the door, plus header and knee walls
  frontWall(mb, T);

  /* ---------------- the street outside ---------------- */
  outside(mb, T);

  /* ---------------- the back room ---------------- */
  backRoom(mb, T);

  /* ---------------- shelving ---------------- */
  for (const s of SHELVES) buildShelf(mb, T, s);


  /* ---------------- service counter ---------------- */
  const C = COUNTER;
  mb.box(C.x0, 0, C.z0, C.x1, C.y, C.z1, {
    all: { tex: T.counterFront, uv: [0, 0, 64, 64], sub: [4, 1, true] },
    py: { tex: T.counterTop, uv: [0, 0, 64, 64], sub: [6, 1, true] },
    px: null, ny: null,
  });
  // kick rail and the sign taped to the front
  mb.box(C.x0, 0, C.z0 - 0.03, C.x1, 0.09, C.z0, { all: { tex: T.wallLowerTrim, uv: [0, 0, 64, 16], sub: [5, 1, true] } });
  /* Taped to the FRONT of the counter, so they are read from the shop floor
     -- which is the -Z side, and that is yaw PI. At yaw 0 they were wound
     for a reader standing behind the counter, so from where the customers
     queue "PLEASE REWIND" came out as "DNIWER ESAELP". */
  mb.plate(10.25, 0.44, C.z0 - 0.012, 0.66, 0.33, Math.PI, T.rewindSign, [0, 0, 64, 32], 0);
  mb.plate(11.75, 0.44, C.z0 - 0.012, 0.64, 0.32, Math.PI, T.lateFeeSign, [0, 0, 64, 32], 0);

  /* Back counter behind the clerk. Only the face against the wall is
     skipped: the short end by the popcorn cart was being skipped too, and
     from the shop floor that read as a hole in the side of the counter. */
  mb.box(12.30, 0, 3.70, 12.98, 0.92, 5.60, {
    all: { tex: T.counterFront, uv: [0, 0, 64, 64], sub: [3, 1, true] },
    py: { tex: T.counterTop, uv: [0, 0, 64, 64], sub: [4, 1, true] },
    nz: { tex: T.counterFront, uv: [0, 0, 48, 64], sub: [2, 1, true] },
    pz: { tex: T.counterFront, uv: [0, 0, 48, 64], sub: [2, 1, true] },
    px: null,
  });

  /* ---------------- counter props ---------------- */
  const P = PROPS;
  /* The word only goes on the face the clerk reads it from. It used to be
     on all four, and a word printed on all four sides of a box reads
     backwards on two of them. */
  mb.box(P.bin.x0, P.bin.y0, P.bin.z0, P.bin.x1, P.bin.y1, P.bin.z1, {
    all: { tex: T.binSide, uv: [0, 0, 64, 64] },
    pz: { tex: T.binFront, uv: [0, 0, 64, 64] },
    py: { tex: T.binSide, uv: [0, 0, 64, 20] },
  });
  mb.box(P.rewinder.x0, P.rewinder.y0, P.rewinder.z0, P.rewinder.x1, P.rewinder.y1, P.rewinder.z1, {
    all: { tex: T.rewinder, uv: [0, 0, 64, 64] },
  });
  buildRegister(mb, T, P.register);
  buildDeskPhone(mb, T, P.phone);

  /* ---------------- dressing ---------------- */
  /* Candy rack. It used to stand square in the only lane between the aisles
     and the till, and every shopper coming to the counter clipped a corner
     of it and spent a second sliding round. It lives by the door now, off
     the walk-up line entirely, where an impulse rack belongs anyway. */
  buildCandyRack(mb, T, 3.15, 0.12, 3.85, 0.68);
  // Floor-standing, in the gap between the back counter and the poster run.
  buildPopcornCart(mb, T, 12.24, 5.80, 12.96, 6.52);

  // wall clock behind the counter -- on its own stretch of wall, well clear
  // of the poster run, which it used to sit inside and behind
  mb.quad([12.955, 1.74, 4.98], [12.955, 1.74, 5.62], [12.955, 2.38, 5.62], [12.955, 2.38, 4.98],
    T.clock, [0, 0, 32, 32], 0, [2, 2, false]);
  mb.box(12.96, 1.70, 4.94, 13.0, 2.42, 5.66, { all: { tex: T.wallLowerTrim, uv: [0, 0, 32, 16] }, nx: null });
  // exit sign over the door
  mb.quad([5.72, 2.28, 0.10], [6.28, 2.28, 0.10], [6.28, 2.50, 0.10], [5.72, 2.50, 0.10],
    T.exitSign, [0, 0, 32, 16], F_EMIT);
  // posters on the walls
  const posterAt = (x, y, z, yaw, i) => mb.plate(x, y, z, 0.58, 1.1, yaw, T.posters[i % T.posters.length], [0, 0, 32, 64], 0);
  posterAt(0.06, 1.25, 1.5, Math.PI / 2, 0);
  posterAt(0.06, 1.25, 9.0, Math.PI / 2, 3);
  posterAt(12.94, 1.30, 7.15, -Math.PI / 2, 1);
  posterAt(12.94, 1.30, 8.25, -Math.PI / 2, 2);
  // These two used to hang across the back wall exactly where the back-room
  // doorway now is, so they floated in the opening.
  posterAt(0.06, 1.25, 6.30, Math.PI / 2, 2);
  posterAt(4.55, 1.35, 9.55, Math.PI, 1);
  posterAt(7.30, 1.35, 9.55, Math.PI, 0);
  // trash can
  mb.box(0.22, 0, 1.0, 0.62, 0.72, 1.4, { all: { tex: T.wainscot, uv: [0, 0, 32, 32] } });

  /* ---------------- ceiling-hung monitor ---------------- */
  const tvMesh = buildTelevision(T);
  const tvTextures = tvMesh.textures.slice();   // scratch for the static swap
  const tvPos = { x: 1.30, y: 2.16, z: 2.15, yaw: -0.62 };

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

  // a folded wad of bills, for the hand and the drawer
  const cashB = new MeshBuilder();
  cashB.light = () => 1;
  for (let i = 0; i < 3; i++) {
    cashB.box(-0.075, i * 0.004, -0.033, 0.075, i * 0.004 + 0.003, 0.033, {
      all: { tex: T.cash, uv: [2, 2, 62, 30] },
      py: { tex: T.cash, uv: [0, 0, 64, 32] },
    });
  }
  const cashMesh = cashB.build();

  /* The boombox. Built as its own mesh because it is not part of the shop:
     a man carries it in, puts it down, and carries it out again. */
  const boomB = new MeshBuilder();
  boomB.light = () => 1;
  {
    const HW = 0.26, HH = 0.155, HD = 0.095;
    boomB.box(-HW, 0, -HD, HW, HH * 2, HD, {
      all: { tex: T.boomShell, uv: [0, 0, 64, 40] },
      nz: { tex: T.boomFront, uv: [0, 0, 64, 64], sub: [3, 2, false] },
      py: { tex: T.boomTop, uv: [0, 0, 64, 32], sub: [3, 1, false] },
      ny: null,
    });
    // carry handle, up over the top
    boomB.box(-0.10, HH * 2, -0.012, 0.10, HH * 2 + 0.022, 0.012,
      { all: { tex: T.boomShell, uv: [0, 0, 32, 8] } });
    boomB.box(-0.115, HH * 2 - 0.05, -0.012, -0.092, HH * 2 + 0.01, 0.012,
      { all: { tex: T.boomShell, uv: [0, 0, 8, 16] } });
    boomB.box(0.092, HH * 2 - 0.05, -0.012, 0.115, HH * 2 + 0.01, 0.012,
      { all: { tex: T.boomShell, uv: [0, 0, 8, 16] } });
    // little rubber feet
    boomB.box(-HW + 0.03, -0.016, -HD + 0.02, -HW + 0.09, 0, HD - 0.02,
      { all: { tex: T.boomShell, uv: [0, 0, 12, 6] } });
    boomB.box(HW - 0.09, -0.016, -HD + 0.02, HW - 0.03, 0, HD - 0.02,
      { all: { tex: T.boomShell, uv: [0, 0, 12, 6] } });
  }
  const boomMesh = boomB.build();

  /* A drift of popcorn on the carpet. Built once and drawn wherever a mess
     landed, at whatever yaw and scale, so no two piles read the same. Two
     crossed quads rather than a box: from standing height a heap of corn
     is a shape on the floor, and a box would have visible walls. */
  const spillB = new MeshBuilder();
  spillB.light = () => 1;
  {
    const R = 0.34;
    // the flat of it, lying on the carpet
    spillB.quad([-R, 0.012, -R], [R, 0.012, -R], [R, 0.012, R], [-R, 0.012, R],
      T.popSpill, [0, 0, 64, 64], F_DOUBLE, [2, 2, false]);
    // and a low mound through the middle, so it is not a decal
    const H = 0.075;
    spillB.quad([-R * 0.8, 0, 0], [R * 0.8, 0, 0], [R * 0.8, H, 0], [-R * 0.8, H, 0],
      T.popSpill, [8, 8, 48, 30], F_DOUBLE);
    spillB.quad([0, 0, -R * 0.8], [0, 0, R * 0.8], [0, H, R * 0.8], [0, H, -R * 0.8],
      T.popSpill, [12, 6, 48, 30], F_DOUBLE);
  }
  const spillMesh = spillB.build();

  /* One airborne clump, for the corn coming over the front of the case.
     A pair of crossed quads so it has a face from any angle, blended so it
     is a burst rather than a slab. */
  const puffB = new MeshBuilder();
  puffB.light = () => 1;
  {
    const R = 0.11;
    puffB.quad([-R, -R, 0], [R, -R, 0], [R, R, 0], [-R, R, 0],
      T.popBurst, [0, 0, 64, 64], F_BLEND | F_DOUBLE);
    puffB.quad([0, -R, -R], [0, -R, R], [0, R, R], [0, R, -R],
      T.popBurst, [0, 0, 64, 64], F_BLEND | F_DOUBLE);
  }
  const puffMesh = puffB.build();

  /* The vacuum out of the back room. An upright, the kind with a cloth bag
     up the handle -- 1996, and it has been in a stockroom since 1984. */
  const vacB = new MeshBuilder();
  vacB.light = () => 1;
  {
    // the foot: a wide flat head with a brush strip along the front
    vacB.box(-0.19, 0, -0.13, 0.19, 0.11, 0.13,
      { all: { tex: T.vacBody, uv: [0, 0, 48, 16] }, ny: null });
    vacB.box(-0.19, 0, -0.15, 0.19, 0.035, -0.13,
      { all: { tex: T.vacMetal, uv: [0, 0, 48, 6] } });
    // motor housing sat on top of it
    vacB.box(-0.13, 0.11, -0.10, 0.13, 0.27, 0.10,
      { all: { tex: T.vacBody, uv: [0, 0, 40, 24] } });
    // the handle, raked back, with the bag hung off it
    vacB.box(-0.028, 0.27, 0.02, 0.028, 0.95, 0.075,
      { all: { tex: T.vacMetal, uv: [0, 0, 8, 64] } });
    vacB.box(-0.105, 0.34, 0.075, 0.105, 0.86, 0.175,
      { all: { tex: T.vacBag, uv: [0, 0, 32, 64], sub: [1, 3, false] } });
    // the grip across the top
    vacB.box(-0.10, 0.95, 0.01, 0.10, 1.00, 0.085,
      { all: { tex: T.vacMetal, uv: [0, 0, 24, 10] } });
  }
  const vacMesh = vacB.build();

  /* A large, from Bertucci's on the parade. Corrugated card, printed
     badly, and warm. Built as its own mesh because it is carried in,
     put down on the counter and carried out again. */
  const pizzaB = new MeshBuilder();
  pizzaB.light = () => 1;
  {
    const R = 0.23, H = 0.055;
    pizzaB.box(-R, 0, -R, R, H, R, {
      all: { tex: T.pizzaSide, uv: [0, 0, 64, 10], sub: [2, 1, false] },
      py: { tex: T.pizzaTop, uv: [0, 0, 64, 64], sub: [2, 2, false] },
      ny: null,
    });
  }
  const pizzaMesh = pizzaB.build();

  return {
    mesh,
    boomMesh,
    spillMesh,
    puffMesh,
    vacMesh,
    pizzaMesh,
    tvMesh, tvPos, tvTextures,
    cashMesh,
    doorOpenMesh: doorLeaf(T.doorGlass),
    doorLockedMesh: doorLeaf(T.doorLocked),
    storageDoorMesh: storageLeaf(T, false),
    storageDoorHitMesh: storageLeaf(T, true),
    tapeTex: tape,
    tapeMesh: buildTapeMesh(tape),
    solids: buildSolids(),
    T,
  };
}

/* ---------------- the floor ----------------
   One coplanar sheet of tiles. Which texture a tile gets depends on where
   it is: the mat inside the door, the worn track from the door to the
   counter, plain carpet everywhere else. Nothing overlaps anything, so
   there is nothing for the depth buffer to be uncertain about. */
function carpetFloor(mb, T) {
  /* The grid is chosen so the mat's rectangle falls on exact tile edges:
     the mat is then those tiles, with the texture sliced across them,
     rather than a second surface laid on top of them. */
  const NX = 26, NZ = 20;
  const dx = W / NX, dz = D / NZ;
  const MAT = { i0: 10, i1: 14, j0: 0, j1: 3 };          // 5.0..7.0 x 0.0..1.44
  const PATH = [4.90, 0.05, 12.95, 2.60];
  const inMat = (i, j) => i >= MAT.i0 && i < MAT.i1 && j >= MAT.j0 && j < MAT.j1;

  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const x0 = i * dx, x1 = x0 + dx;
      const z0 = j * dz, z1 = z0 + dz;
      const p = [[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]];

      if (inMat(i, j)) {
        // one slice of the mat: u runs with -x, v runs with -z, so the
        // lettering reads the right way up to somebody walking in
        const cu = (i - MAT.i0) / (MAT.i1 - MAT.i0), cu1 = (i + 1 - MAT.i0) / (MAT.i1 - MAT.i0);
        const cv = (j - MAT.j0) / (MAT.j1 - MAT.j0), cv1 = (j + 1 - MAT.j0) / (MAT.j1 - MAT.j0);
        mb.quad(p[0], p[1], p[2], p[3], T.mat,
          [cu1 * 64, cv1 * 64, cu * 64, cv * 64], 0);
        continue;
      }
      const cx = x0 + dx / 2, cz = z0 + dz / 2;
      const worn = cx > PATH[0] && cx < PATH[2] && cz > PATH[1] && cz < PATH[3];
      const k = hash2(i * 13.1 + j * 2.7, i);
      const fu = (k >> 4) & 1, fv = (k >> 5) & 1;
      const uv = [fu ? 64 : 0, fv ? 64 : 0, fu ? 0 : 64, fv ? 0 : 64];
      mb.quad(p[0], p[1], p[2], p[3], worn ? T.carpetWorn : T.carpet, uv, 0);
    }
  }
}

/* ---------------- one run of perimeter wall ----------------
   Three stacked bands, none of them sharing a plane with another, and the
   painted band above the rail dealt out of the panel set so a long wall
   never repeats one texture end to end. */
function wallSeg(mb, T, x0, z0, x1, z1) {
  const RAIL = 1.05, CAP = 1.14;
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.01) return;
  const panels = T.wallPanels || [T.wall];
  const n = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const ax = x0 + (x1 - x0) * a, az = z0 + (z1 - z0) * a;
    const bx = x0 + (x1 - x0) * b, bz = z0 + (z1 - z0) * b;
    const seg = Math.hypot(bx - ax, bz - az);
    const k = hash2(ax * 7.3 + az * 3.1, i);
    const tex = panels[k % panels.length];
    // flipping the rect horizontally doubles the apparent variety for free
    const uv = (k >> 3) & 1 ? [64, 0, 0, 64] : [0, 0, 64, 64];
    mb.quad([ax, CAP, az], [bx, CAP, bz], [bx, H, bz], [ax, H, az],
      tex, uv, 0, [Math.max(1, Math.round(seg * 0.7)), 2, true]);
  }
  mb.quad([x0, 0, z0], [x1, 0, z1], [x1, RAIL, z1], [x0, RAIL, z0],
    T.wainscot, [0, 0, 64, 64], 0, [Math.max(1, Math.round(len * 1.3)), 1, true]);
  mb.quad([x0, RAIL, z0], [x1, RAIL, z1], [x1, CAP, z1], [x0, CAP, z0],
    T.wallLowerTrim, [0, 0, 64, 16], 0, [Math.max(1, Math.round(len)), 1, true]);
}

/** Deterministic small integer from a pair of numbers. */
function hash2(a, b) {
  let h = Math.imul(Math.round(a * 977) ^ Math.imul(b + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0);
}

/* ---------------- drop ceiling ----------------
   Emitted a tile at a time out of the variant set. One texture stamped
   across the whole ceiling put the same water stain in the same corner of
   all hundred and thirty tiles. */
function ceilingGrid(mb, T, x0, z0, x1, z1, y, salt) {
  const tiles = T.ceilingTiles || [T.ceiling];
  const nx = Math.max(1, Math.round((x1 - x0) / 1.0));
  const nz = Math.max(1, Math.round((z1 - z0) / 0.96));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + (x1 - x0) * (i / nx), bx = x0 + (x1 - x0) * ((i + 1) / nx);
      const az = z0 + (z1 - z0) * (j / nz), bz = z0 + (z1 - z0) * ((j + 1) / nz);
      const k = hash2(i * 31.7 + j * 5.9 + salt, j);
      // most of a ceiling is unremarkable; weight the plain tiles heavily
      const r = k % 100;
      let t = r < 34 ? 0 : r < 60 ? 1 : r < 72 ? 2 : r < 80 ? 3 : r < 87 ? 4 : r < 92 ? 5 : r < 96 ? 6 : 7;
      if (t >= tiles.length) t = 0;
      const flipU = (k >> 7) & 1, flipV = (k >> 8) & 1;
      const uv = [flipU ? 64 : 0, flipV ? 64 : 0, flipU ? 0 : 64, flipV ? 0 : 64];
      mb.quad([ax, y, az], [bx, y, az], [bx, y, bz], [ax, y, bz], tiles[t], uv, 0);
    }
  }
}


/* ============================================================
   THE BACK ROOM
   Breeze block, a concrete floor, a bare bulb and a steel door that
   is the only thing in the building you can put between yourself and
   somebody else.
   ============================================================ */
function backRoomOpening(mb, T) {
  // jambs and header framing the doorway punched through the back wall
  mb.box(SDOOR_X0 - 0.10, 0, D - 0.10, SDOOR_X0, H, D + 0.10, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
  mb.box(SDOOR_X1, 0, D - 0.10, SDOOR_X1 + 0.10, H, D + 0.10, { all: { tex: T.doorFrame, uv: [0, 0, 16, 64] } });
  mb.box(SDOOR_X0 - 0.10, SDOOR_H, D - 0.10, SDOOR_X1 + 0.10, SDOOR_H + 0.10, D + 0.10,
    { all: { tex: T.doorFrame, uv: [0, 0, 64, 10] } });
  // the sliver of wall above the header, seen from the sales floor
  mb.quad([SDOOR_X1 + 0.10, SDOOR_H + 0.10, D], [SDOOR_X0 - 0.10, SDOOR_H + 0.10, D],
    [SDOOR_X0 - 0.10, H, D], [SDOOR_X1 + 0.10, H, D], T.wall, [0, 0, 64, 24], 0);
}

function backRoom(mb, T) {
  const S = STORAGE, y = S.H;
  const dim = mb.light;
  mb.quad([S.x0, 0, S.z1], [S.x1, 0, S.z1], [S.x1, 0, S.z0], [S.x0, 0, S.z0],
    T.storeFloor, [0, 0, 64, 64], 0, [5, 4, true]);
  ceilingGrid(mb, T, S.x0, S.z0, S.x1, S.z1, y, 91);

  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    mb.quad([x0, 0, z0], [x1, 0, z1], [x1, y, z1], [x0, y, z0],
      T.storeWall, [0, 0, 64, 64], 0, [Math.max(1, Math.round(len * 0.9)), 2, true]);
  };
  wall(S.x0, S.z1, S.x0, S.z0);        // left, facing +X
  wall(S.x1, S.z0, S.x1, S.z1);        // right, facing -X
  wall(S.x1, S.z1, S.x0, S.z1);        // rear, facing -Z
  // the sales-floor side of the back wall, either side of the doorway
  wall(S.x0, S.z0, SDOOR_X0, S.z0);
  wall(SDOOR_X1, S.z0, S.x1, S.z0);
  mb.quad([SDOOR_X0, SDOOR_H, S.z0], [SDOOR_X1, SDOOR_H, S.z0],
    [SDOOR_X1, y, S.z0], [SDOOR_X0, y, S.z0], T.storeWall, [0, 0, 64, 20], 0);

  // bare bulb on a flex
  const L = STORAGE_LIGHT;
  mb.light = () => 0.4;
  mb.box(L.x - 0.012, L.y, L.z - 0.012, L.x + 0.012, y, L.z + 0.012, { all: { tex: T.doorFrame, uv: [0, 0, 4, 32] } });
  mb.light = () => 1;
  mb.box(L.x - 0.075, L.y - 0.11, L.z - 0.075, L.x + 0.075, L.y, L.z + 0.075,
    { all: { tex: T.bareBulb, uv: [0, 0, 16, 16], flags: F_EMIT } });
  mb.light = dim;

  // utility racking down the left-hand wall, loaded with stock cartons
  for (let i = 0; i < 3; i++) {
    const z = S.z0 + 0.75 + i * 1.05;
    mb.box(S.x0 + 0.06, 0.05, z, S.x0 + 0.66, 1.92, z + 0.86, {
      all: { tex: T.steelShelf, uv: [0, 0, 64, 64] }, px: null, ny: null,
    });
    for (let k = 0; k < 3; k++) {
      const yy = 0.42 + k * 0.52;
      mb.box(S.x0 + 0.05, yy, z - 0.02, S.x0 + 0.70, yy + 0.04, z + 0.88,
        { all: { tex: T.steelShelf, uv: [0, 0, 64, 6] } });
      if ((i + k) % 3 !== 2) {
        mb.box(S.x0 + 0.12, yy + 0.04, z + 0.08, S.x0 + 0.58, yy + 0.42, z + 0.62,
          { all: { tex: T.cardboard, uv: [0, 0, 64, 64] } });
      }
    }
  }
  // a stack of cartons against the back wall, and a mop bucket
  mb.box(7.55, 0, S.z1 - 0.72, 8.35, 0.46, S.z1 - 0.06, { all: { tex: T.cardboard, uv: [0, 0, 64, 48] } });
  mb.box(7.62, 0.46, S.z1 - 0.66, 8.28, 0.90, S.z1 - 0.12, { all: { tex: T.cardboard, uv: [0, 0, 64, 48] } });
  mb.box(8.42, 0, S.z0 + 0.35, 8.80, 0.34, S.z0 + 0.73, { all: { tex: T.steelShelf, uv: [0, 0, 32, 32] } });
}

/** One leaf of the back-room door, hinged on its left edge at x = SDOOR_X0. */
function storageLeaf(T, damaged) {
  const b = new MeshBuilder();
  b.light = () => 0.72;
  const w = SDOOR_X1 - SDOOR_X0;
  const face = damaged ? T.steelDoorHit : T.steelDoor;
  /* Subdivided. A metre wide and two metres tall is a big quad, and the
     rasteriser maps texture affinely across whatever a triangle covers --
     so the whole face slid about as you walked past it, which is the same
     thing that used to happen to the popcorn sign and the counter front.
     Splitting it into a grid keeps each cell near enough square on screen
     that there is nothing left to see. The tall thin frame edges get the
     same treatment down their length. */
  b.box(0, 0, -0.035, w, SDOOR_H, 0.035, {
    all: { tex: T.doorFrame, uv: [0, 0, 8, 64], sub: [3, 6, false] },
    pz: { tex: face, uv: [0, 0, 64, 64], sub: [3, 6, false] },
    nz: { tex: face, uv: [64, 0, 0, 64], sub: [3, 6, false] },
  });
  // lever handle and the deadbolt escutcheon, both sides
  b.light = () => 0.95;
  b.box(w - 0.20, 0.96, -0.09, w - 0.06, 1.04, 0.09, { all: { tex: T.popGold, uv: [0, 0, 24, 12] } });
  b.box(w - 0.15, 1.18, -0.055, w - 0.07, 1.28, 0.055, { all: { tex: T.popGold, uv: [0, 0, 12, 12] } });
  return b.build();
}

/* ============================================================
   COUNTER PROPS -- modelled, not printed on cubes
   ============================================================ */
/* An electronic cash register, in the parts one is actually made of.
   The customer is at low z and the clerk at high z, so: drawer face and
   display toward -Z, keyboard tilted up toward +Z.

   The last version put the display head on a thin post in the middle of
   the keyboard, and the keyboard was a single unbacked quad -- so the head
   hung in the air over nothing. The keydeck is three solid tiers now and
   the display grows out of the machine's front edge. */
function buildRegister(mb, T, P) {
  const x0 = P.x0, x1 = P.x1, z0 = P.z0, z1 = P.z1, y = P.y0;
  const cx = (x0 + x1) / 2;

  // ---- cash drawer ----
  mb.box(x0, y, z0, x1, y + 0.115, z1, {
    all: { tex: T.regBody, uv: [0, 0, 64, 22] },
    nz: { tex: T.regDrawer, uv: [0, 0, 64, 30] },
    ny: null,
  });
  // ---- body shell, set back off the drawer face ----
  mb.box(x0 + 0.012, y + 0.115, z0 + 0.022, x1 - 0.012, y + 0.195, z1, {
    all: { tex: T.regBody, uv: [0, 0, 64, 16] }, ny: null,
  });

  /* ---- keydeck: three solid tiers stepping up away from the clerk ----
     The key texture is sliced across them so the rows line up: v is small
     at low z, which is the far edge of the keyboard. */
  const kx0 = x0 + 0.028, kx1 = x1 - 0.028;
  const TIERS = [
    { z0: z1 - 0.175, z1: z1 - 0.020, top: y + 0.232, uv: [0, 42, 64, 64] },
    { z0: z1 - 0.330, z1: z1 - 0.175, top: y + 0.262, uv: [0, 21, 64, 42] },
    { z0: z0 + 0.030, z1: z1 - 0.330, top: y + 0.292, uv: [0, 0, 64, 21] },
  ];
  for (const t of TIERS) {
    mb.box(kx0, y + 0.195, t.z0, kx1, t.top, t.z1, {
      all: { tex: T.regBody, uv: [0, 0, 64, 12] },
      py: { tex: T.regKeys, uv: t.uv, sub: [3, 2, false] },
      ny: null,
    });
  }

  // ---- the neck the display sits on, rising out of the front edge ----
  mb.box(cx - 0.062, y + 0.195, z0 + 0.014, cx + 0.062, y + 0.335, z0 + 0.070, {
    all: { tex: T.regBody, uv: [0, 0, 26, 30] }, ny: null,
  });
  // ---- customer display head ----
  const dim = mb.light;
  mb.light = (px, py, pz) => Math.min(0.9, lightAt(px, py, pz));
  mb.box(x0 + 0.030, y + 0.335, z0 - 0.012, x1 - 0.030, y + 0.475, z0 + 0.078, {
    all: { tex: T.regBody, uv: [0, 0, 64, 20] },
    nz: { tex: T.regDisplay, uv: [0, 0, 64, 32], flags: F_EMIT, sub: [3, 2, false] },
    py: { tex: T.regTop, uv: [0, 0, 64, 18] },
  });
  mb.light = dim;

  // ---- receipt printer, tucked on the clerk's right ----
  mb.box(x1 - 0.135, y + 0.195, z0 + 0.030, x1 - 0.020, y + 0.300, z0 + 0.150, {
    all: { tex: T.regBody, uv: [0, 0, 30, 24] },
    py: { tex: T.regTop, uv: [0, 0, 64, 24] },
    ny: null,
  });
}

/**
 * The telephone.
 *
 * It used to hang on the wall behind the clerk, which put it nowhere near
 * anything and left the back counter with nothing on it. It is a desk set
 * now, sitting on that counter: base, keypad on the top face, handset
 * across the cradle, and the cord running off the back.
 */
function buildDeskPhone(mb, T, P) {
  const { x0, x1, z0, z1 } = P;
  const y0 = P.y0;                       // the countertop it stands on
  const BODY = 0.085;                    // the shell
  const CRADLE = x1 - 0.17;              // the raised strip along the wall side

  /* The shell. The keypad faces the ceiling on the half nearest the clerk;
     the wall half is the raised cradle, built separately above. */
  mb.box(x0, y0, z0, x1, y0 + BODY, z1, {
    all: { tex: T.phoneBody, uv: [0, 0, 64, 26] },
    py: { tex: T.phoneKeys, uv: [0, 0, 64, 64], sub: [2, 2, false] },
    ny: null,
  });

  // Raised cradle along the wall side, with the hooks moulded into its top.
  mb.box(CRADLE, y0 + BODY, z0, x1, y0 + 0.135, z1, {
    all: { tex: T.phoneBody, uv: [0, 0, 24, 16] },
    py: { tex: T.phoneCradle, uv: [0, 0, 32, 64] },
    ny: null,
  });

  /* Handset lying in the cradle, long axis running along the counter:
     mouthpiece, bar, earpiece, with the ends proud of the middle. */
  const hx0 = CRADLE + 0.012, hx1 = x1 - 0.012;
  const hy = y0 + 0.135;
  mb.box(hx0, hy, z0 + 0.085, hx1, hy + 0.042, z1 - 0.085,
    { all: { tex: T.phoneHandset, uv: [0, 0, 64, 18] }, ny: null });
  mb.box(hx0 - 0.008, hy - 0.010, z0 + 0.012, hx1 + 0.008, hy + 0.052, z0 + 0.098,
    { all: { tex: T.phoneHandset, uv: [0, 0, 30, 40] } });
  mb.box(hx0 - 0.008, hy - 0.010, z1 - 0.098, hx1 + 0.008, hy + 0.052, z1 - 0.012,
    { all: { tex: T.phoneHandset, uv: [0, 0, 30, 40] } });

  // Coiled cord, a flat card off the wall side, heading for the skirting.
  mb.plate(x1 + 0.005, y0 + 0.035, (z0 + z1) / 2 - 0.02, 0.22, 0.14, Math.PI / 2,
    T.phoneCord, [0, 0, 32, 40], F_BLEND);
}

function buildCandyRack(mb, T, x0, z0, x1, z1) {
  // a slim rack with chamfered corners: nothing for a shopper to snag on
  const c = 0.10;
  mb.box(x0, 0.10, z0 + c, x1, 1.45, z1 - c, {
    all: { tex: T.candyRack, uv: [0, 0, 64, 64], sub: [1, 2, true] }, ny: null,
  });
  mb.box(x0 + c, 0.10, z0, x1 - c, 1.45, z1, {
    all: { tex: T.candyRack, uv: [0, 0, 64, 64], sub: [1, 2, true] }, ny: null,
  });
  mb.box(x0 + 0.02, 0, z0 + 0.02, x1 - 0.02, 0.10, z1 - 0.02,
    { all: { tex: T.wallLowerTrim, uv: [0, 0, 64, 16] } });
  mb.box(x0 - 0.01, 1.45, z0 - 0.01, x1 + 0.01, 1.50, z1 + 0.01,
    { all: { tex: T.popGold, uv: [0, 0, 32, 8] } });
}

function buildPopcornCart(mb, T, x0, z0, x1, z1) {
  const BASE = 0.92, CASE = 1.62, TOP = 1.80;
  // enamelled base cabinet
  mb.box(x0, 0, z0, x1, BASE, z1, { all: { tex: T.popRed, uv: [0, 0, 64, 64] }, ny: null });
  mb.box(x0 - 0.02, BASE, z0 - 0.02, x1 + 0.02, BASE + 0.05, z1 + 0.02,
    { all: { tex: T.popGold, uv: [0, 0, 48, 10] } });
  // heap of popped corn filling the bottom third of the case
  mb.box(x0 + 0.05, BASE + 0.05, z0 + 0.05, x1 - 0.05, BASE + 0.30, z1 - 0.05,
    { all: { tex: T.popCorn, uv: [0, 0, 64, 40] }, ny: null });
  mb.box(x0 + 0.13, BASE + 0.30, z0 + 0.12, x1 - 0.13, BASE + 0.40, z1 - 0.12,
    { all: { tex: T.popCorn, uv: [8, 8, 56, 40] }, ny: null });
  // kettle slung from the case roof
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  mb.box(cx - 0.13, CASE - 0.30, cz - 0.13, cx + 0.13, CASE - 0.06, cz + 0.13,
    { all: { tex: T.popKettle, uv: [0, 0, 64, 48] } });
  mb.box(cx - 0.02, CASE - 0.08, cz - 0.02, cx + 0.02, CASE, cz + 0.02,
    { all: { tex: T.popGold, uv: [0, 0, 8, 10] } });
  // brass corner posts
  for (const [px, pz] of [[x0, z0], [x1 - 0.045, z0], [x0, z1 - 0.045], [x1 - 0.045, z1 - 0.045]]) {
    mb.box(px, BASE + 0.05, pz, px + 0.045, CASE, pz + 0.045, { all: { tex: T.popGold, uv: [0, 0, 8, 40] } });
  }
  // glazing, last so it blends over everything inside
  mb.box(x0 + 0.01, BASE + 0.06, z0 + 0.01, x1 - 0.01, CASE - 0.01, z1 - 0.01, {
    all: { tex: T.popGlass, uv: [0, 0, 64, 64], flags: F_BLEND | F_DOUBLE }, ny: null, py: null,
  });
  // case roof and the lit marquee across the front
  mb.box(x0 - 0.03, CASE, z0 - 0.03, x1 + 0.03, TOP, z1 + 0.03, {
    all: { tex: T.popRed, uv: [0, 0, 64, 22] },
    /* Subdivided. A single quad this size is affine-mapped across its
       whole width, so the lettering slid about as you walked past it. */
    nx: { tex: T.popSign, uv: [0, 0, 64, 32], flags: F_EMIT, sub: [5, 2, false] },
  });
  mb.box(x0 + 0.06, TOP, z0 + 0.06, x1 - 0.06, TOP + 0.10, z1 - 0.06,
    { all: { tex: T.popGold, uv: [0, 0, 32, 12] } });
}

/* ---------------- ceiling-hung monitor ----------------
   The picture used to be wound the wrong way round, so it was culled as a
   back face from the only side you could ever see it from, and the whole
   set read as a plain brown box bolted to nothing. It is now a bezelled
   tube on a proper ceiling arm, and the screen faces the shop floor. */
function buildTelevision(T) {
  const b = new MeshBuilder();
  b.light = () => 0.9;
  const HW = 0.42, HH = 0.34, DZ = 0.52;
  // shell: bezel forward, louvred sides and back
  b.box(-HW, -HH, -DZ * 0.42, HW, HH, DZ * 0.58, {
    all: { tex: T.tvVent, uv: [0, 0, 64, 64] },
    nz: null,
  });
  // the bezel is its own frame around the tube, so the picture is inset
  const IZ = -DZ * 0.42;
  // wound to face -Z: p0 is the bottom-RIGHT corner as seen from the front
  const frame = (ax, ay, bx, by) => b.quad([bx, ay, IZ], [ax, ay, IZ], [ax, by, IZ], [bx, by, IZ],
    T.tvBezel, [0, 0, 64, 64], 0);
  const SW = 0.335, SH = 0.255;
  frame(-HW, -HH, HW, -SH);            // below the tube
  frame(-HW, SH, HW, HH);              // above
  frame(-HW, -SH, -SW, SH);            // left
  frame(SW, -SH, HW, SH);              // right
  // the picture, wound to face -Z so it is visible from the shop floor
  b.quad([SW, -SH, IZ - 0.004], [-SW, -SH, IZ - 0.004], [-SW, SH, IZ - 0.004], [SW, SH, IZ - 0.004],
    T.staticFrames[0], [2, 2, 62, 62], F_EMIT);
  // the arm it hangs off, running up to the ceiling
  b.light = () => 0.55;
  b.box(-0.05, HH, 0.02, 0.05, HH + 0.72, 0.12, { all: { tex: T.tvBracket, uv: [0, 0, 12, 64] } });
  b.box(-0.20, HH + 0.66, -0.04, 0.20, HH + 0.76, 0.26, { all: { tex: T.tvBracket, uv: [0, 0, 32, 12] } });
  b.box(-0.11, HH - 0.03, 0.00, 0.11, HH + 0.04, 0.20, { all: { tex: T.tvBracket, uv: [0, 0, 24, 10] } });
  const mesh = b.build();
  // the renderer swaps exactly this slot for the current frame of static
  mesh.screenSlot = mesh.textures.indexOf(T.staticFrames[0]);
  return mesh;
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
    // a run against a wall has no back to browse
    faces.nx = s.wall ? null : { tex: spine, uv: [0, 0, 64, 64], sub: [reps, 3, true] };
  } else {
    faces.nz = { tex: spine, uv: [0, 0, 64, 64], sub: [reps, 3, true] };
    faces.pz = null;
  }
  faces.ny = null;
  mb.box(s.x0, 0.14, s.z0, s.x1, s.top, s.z1, faces);
  // toe kick
  mb.box(s.x0 + 0.04, 0, s.z0 + 0.04, s.x1 - 0.04, 0.14, s.z1 - 0.04,
    { all: { tex: T.wallLowerTrim, uv: [0, 0, 64, 16], sub: [reps, 1, true] } });
  /* Protruding shelf boards, to break up the flat spine wall.

     They are inset from the ends of the run and do not overhang the side
     that is against a wall. They used to run the full length and stick out
     three centimetres on BOTH faces, so the end of a gondola was a comb of
     little tabs rather than a flat side panel -- and on the games wall the
     inward set of tabs went straight through the wall. A real shelf's
     boards sit between the uprights. */
  const levels = s.top > 2 ? 5 : 4;
  const END = 0.05;                          // held back from the end panels
  const OUT = 0.03;                          // proud of the browsing face
  for (let i = 1; i <= levels; i++) {
    const y = 0.14 + (s.top - 0.14) * (i / (levels + 0.4));
    const face = { all: { tex: T.shelfWood, uv: [0, 0, 64, 8], sub: [reps, 1, true] } };
    if (s.axis === 'z') {
      // a run against a wall is only browsed from +x, so only that side juts
      mb.box(s.x0 - (s.wall ? 0 : OUT), y, s.z0 + END, s.x1 + OUT, y + 0.035, s.z1 - END, face);
    } else {
      mb.box(s.x0 + END, y, s.z0 - OUT, s.x1 - END, y + 0.035, s.z1 + OUT, face);
    }
  }
  /* Header sign.
     Affine texture mapping splits a quad into two triangles and interpolates
     u,v linearly across each: on a wide, flat sign viewed from an angle the
     seam between them visibly kinks and the lettering shears. Chopping the
     sign into a strip of small quads keeps each one nearly square on screen,
     which is exactly what a PS1 title did with its own signage.            */
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
  const sign = T.signs[s.genre];
  const SIGN_SUB = [8, 1, false];
  if (s.axis === 'z') {
    if (!s.wall) {
      mb.quad([s.x0 - 0.045, s.top, cz - 0.7], [s.x0 - 0.045, s.top, cz + 0.7],
        [s.x0 - 0.045, s.top + 0.30, cz + 0.7], [s.x0 - 0.045, s.top + 0.30, cz - 0.7],
        sign, [0, 0, 64, 16], F_EMIT, SIGN_SUB);
    }
    mb.quad([s.x1 + 0.045, s.top, cz + 0.7], [s.x1 + 0.045, s.top, cz - 0.7],
      [s.x1 + 0.045, s.top + 0.30, cz - 0.7], [s.x1 + 0.045, s.top + 0.30, cz + 0.7],
      sign, [0, 0, 64, 16], F_EMIT, SIGN_SUB);
    mb.box(s.x0 - 0.04, s.top, cz - 0.72, s.x1 + 0.04, s.top + 0.32, cz + 0.72,
      { all: { tex: T.shelfWood, uv: [0, 0, 32, 8] }, px: null, nx: null });
  } else {
    mb.quad([cx + 1.0, s.top, s.z0 - 0.055], [cx - 1.0, s.top, s.z0 - 0.055],
      [cx - 1.0, s.top + 0.30, s.z0 - 0.055], [cx + 1.0, s.top + 0.30, s.z0 - 0.055],
      sign, [0, 0, 64, 16], F_EMIT, [10, 1, false]);
    mb.box(cx - 1.02, s.top, s.z0 - 0.05, cx + 1.02, s.top + 0.32, s.z0 - 0.01,
      { all: { tex: T.shelfWood, uv: [0, 0, 32, 8] }, nz: null });
  }
}

/* ---------------- VHS textures + mesh ---------------- */
function makeTapeTextures() {
  const out = {};
  const COL = {
    HORROR: ['#3a0a0a', '#ff4b3a'], COMEDY: ['#3a2c05', '#ffd447'],
    ACTION: ['#08203a', '#4fa8ff'], SCIFI: ['#0a2a33', '#5cf0ff'],
    DRAMA: ['#2a2418', '#e8d9ae'], FAMILY: ['#0a2e18', '#7cf09a'],
    GAMES: ['#1a0a2e', '#c9a4ff'],
  };
  for (const g of GENRES) {
    const [bg, fg] = COL[g];
    if (g === 'GAMES') {
      out[g] = makeTex(64, 64, (c) => {
        c.fillStyle = '#0f0f16'; c.fillRect(0, 0, 64, 64);
        c.fillStyle = bg; c.fillRect(3, 3, 58, 58);
        const gr = c.createLinearGradient(0, 8, 0, 46);
        gr.addColorStop(0, fg + '55'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr; c.fillRect(3, 3, 58, 58);
        // chunky logotype band across the top, the way a cart box shouts
        c.fillStyle = fg; c.fillRect(6, 8, 52, 9);
        c.fillStyle = bg;
        c.font = 'bold 7px "Courier New",monospace'; c.textAlign = 'center';
        c.fillText('GAME PAK', 32, 15);
        // a screenshot window
        c.fillStyle = '#05050a'; c.fillRect(9, 22, 46, 24);
        c.fillStyle = fg;
        for (let i = 0; i < 26; i++) {
          c.globalAlpha = 0.25 + Math.random() * 0.5;
          c.fillRect(10 + Math.floor(Math.random() * 44), 23 + Math.floor(Math.random() * 22), 3, 2);
        }
        c.globalAlpha = 1;
        c.fillStyle = '#d8cfae'; c.fillRect(6, 50, 52, 8);
        c.fillStyle = '#2a2418';
        c.font = 'bold 6px "Courier New",monospace';
        c.fillText('RENTAL COPY', 32, 56);
        c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeRect(2.5, 2.5, 59, 59);
        const d = c.getImageData(0, 0, 64, 64), p = d.data;
        for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - 0.5) * 14; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
        c.putImageData(d, 0, 0);
      });
      continue;
    }
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

/**
 * A VHS clamshell: 0.19 x 0.11 x 0.028 m, origin at its centre.
 * A cartridge box is a different object -- shorter, wider and much
 * thicker -- so it reads as one across the shop and in your hands.
 */
function buildTapeMesh(tapeTex) {
  const out = {};
  for (const g of GENRES) {
    const b = new MeshBuilder();
    b.light = () => 1;
    const game = g === 'GAMES';
    const hw = game ? 0.062 : 0.055;
    const hh = game ? 0.072 : 0.095;
    const hd = game ? 0.024 : 0.014;
    b.box(-hw, -hh, -hd, hw, hh, hd, {
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
  // back wall, with the doorway into the back room left open
  add(0, D, SDOOR_X0, D + 0.14); add(SDOOR_X1, D, W, D + 0.14);
  // the back room's own shell
  add(STORAGE.x0 - T, STORAGE.z0, STORAGE.x0, STORAGE.z1 + T);
  add(STORAGE.x1, STORAGE.z0, STORAGE.x1 + T, STORAGE.z1 + T);
  add(STORAGE.x0 - T, STORAGE.z1, STORAGE.x1 + T, STORAGE.z1 + T);
  add(STORAGE.x0, STORAGE.z0 + 0.55, STORAGE.x0 + 0.72, STORAGE.z0 + 3.45, 'shelf');
  add(7.55, STORAGE.z1 - 0.72, 8.35, STORAGE.z1 - 0.06, 'shelf');
  // front wall either side of the door
  add(0, -T, DOOR_X0, 0.06); add(DOOR_X1, -T, W, 0.06);
  // counter
  add(COUNTER.x0, COUNTER.z0, COUNTER.x1, COUNTER.z1, 'counter');
  add(12.30, 3.70, 12.98, 5.60, 'counter');
  add(12.24, 5.80, 12.96, 6.52, 'popcorn');
  add(3.15, 0.12, 3.85, 0.68, 'candy');
  add(0.22, 1.0, 0.62, 1.4, 'trash');
  for (const s of SHELVES) add(s.x0, s.z0, s.x1, s.z1, 'shelf');
  // keep people out of the street beyond the sidewalk
  add(-9, -4.9, 22, -4.6, 'curb');
  add(-9, -4.9, -6.5, 1, 'curb'); add(19.5, -4.9, 22, 1, 'curb');
  return S;
}

/* ---------------- collision resolution ----------------
   `frontOpen` and `storageOpen` say whether each door is a hole or a slab
   for whoever is being moved. A locked front door still lets anyone already
   inside out; the back-room door is a slab for everybody who has not been
   told otherwise. */
export function collide(x, z, r, solids, doorOpen, storageOpen) {
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
  const slab = (sx0, sx1, sz0, sz1) => {
    const cx = Math.max(sx0, Math.min(x, sx1));
    const cz = Math.max(sz0, Math.min(z, sz1));
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.0001;
      x = cx + (dx / d) * r; z = cz + (dz / d) * r;
    }
  };
  if (!doorOpen) slab(DOOR_X0 - 0.1, DOOR_X1 + 0.1, -0.08, 0.08);
  if (!storageOpen) slab(SDOOR_X0 - 0.06, SDOOR_X1 + 0.06, D - 0.07, D + 0.07);
  return [x, z];
}

/** A flat sign that stays flat: a plate chopped along its length so affine
    mapping cannot shear the lettering as you walk past it. */
export function signPlate(mb, cx, y0, cz, w, h, yaw, tex, flags) {
  const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2;
  const ax = cx - c * hw, az = cz + s * hw;
  const bx = cx + c * hw, bz = cz - s * hw;
  mb.quad([ax, y0, az], [bx, y0, bz], [bx, y0 + h, bz], [ax, y0 + h, az],
    tex, [0, 0, 64, 16], (flags | 0) | F_DOUBLE, [8, 1, false]);
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
