// Headless correctness check for texture orientation and face culling.
import { Raster } from '../src/engine/raster.js';
import { MeshBuilder } from '../src/engine/mesh.js';
import { mat, setPosYaw, invertRigid } from '../src/engine/mathx.js';

const W = 8, H = 8;
const px = new Uint32Array(W * H);
const RED = 0xFF0000FF, GREEN = 0xFF00FF00, BLUE = 0xFFFF0000, WHITE = 0xFFFFFFFF;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // top-left = RED, top-right = GREEN, bottom-left = BLUE, bottom-right = WHITE
  px[y * W + x] = y < 4 ? (x < 4 ? RED : GREEN) : (x < 4 ? BLUE : WHITE);
}
const tex = { px, w: W, h: H, wMask: 7, hMask: 7, shift: 3 };

function render(quadPts, camPos, camYaw) {
  const mb = new MeshBuilder();
  mb.light = () => 1;
  mb.quad(quadPts[0], quadPts[1], quadPts[2], quadPts[3], tex, [0, 0, 8, 8], 0);
  const mesh = mb.build();
  const rz = new Raster(64, 64);
  rz.snap = 0; rz.fogNear = 100; rz.fogFar = 200;
  rz.clear(0xFF000000);
  const cam = mat(), view = mat();
  setPosYaw(cam, camPos[0], camPos[1], camPos[2], camYaw);
  invertRigid(view, cam);
  rz.setCamera(view, 1.2);
  const m = mat();
  rz.drawMesh(mesh, m, {});
  return rz;
}

const name = (c) => ({ [RED]: 'RED(tex TL)', [GREEN]: 'GREEN(tex TR)', [BLUE]: 'BLUE(tex BL)', [WHITE]: 'WHITE(tex BR)', 0xFF000000: 'empty' }[c >>> 0] || '0x' + (c >>> 0).toString(16));
const sample = (rz, x, y) => name(rz.color[y * 64 + x]);

let fails = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}: ${got}${ok ? '' : `   (expected ${want})`}`);
}

// ---- Case 1: wall facing +Z, camera on the +Z side looking -Z (yaw = PI) ----
// Written as [bottom-left, bottom-right, top-right, top-left] in WORLD +X order.
{
  const rz = render([[-1, 0, 0], [1, 0, 0], [1, 2, 0], [-1, 2, 0]], [0, 1, 4], Math.PI);
  console.log('\n-- wall at z=0 facing +Z, viewed from +Z (screen-right = world -X) --');
  check('screen top-left    -> texture top-left', sample(rz, 25, 25), 'RED(tex TL)');
  check('screen top-right   -> texture top-right', sample(rz, 39, 25), 'GREEN(tex TR)');
  check('screen bottom-left -> texture bottom-left', sample(rz, 25, 39), 'BLUE(tex BL)');
  check('screen bottom-right-> texture bottom-right', sample(rz, 39, 39), 'WHITE(tex BR)');
}

// ---- Case 2: same wall from behind: must be culled ----
{
  const rz = render([[-1, 0, 0], [1, 0, 0], [1, 2, 0], [-1, 2, 0]], [0, 1, -4], 0);
  const any = rz.color.some((c) => (c >>> 0) !== 0xFF000000);
  if (any) { let n = 0; for (const c of rz.color) if ((c >>> 0) !== 0xFF000000) n++; console.log('   drew', n, 'px'); }
  check('back face is culled', any ? 'drew something' : 'culled', 'culled');
}

// ---- Case 3: box side faces (the case every prop texture depends on) ----
{
  const mb = new MeshBuilder();
  mb.light = () => 1;
  mb.box(-1, 0, -0.5, 1, 2, 0.5, { all: { tex, uv: [0, 0, 8, 8] } });
  const mesh = mb.build();
  const rz = new Raster(64, 64);
  rz.snap = 0; rz.fogNear = 100; rz.fogFar = 200;
  rz.clear(0xFF000000);
  const cam = mat(), view = mat();
  setPosYaw(cam, 0, 1, 4, Math.PI);            // look at the box's +Z face
  invertRigid(view, cam);
  rz.setCamera(view, 1.2);
  rz.drawMesh(mesh, mat(), {});
  console.log('\n-- box +Z face, viewed head on --');
  check('screen top-left    -> texture top-left', sample(rz, 26, 25), 'RED(tex TL)');
  check('screen top-right   -> texture top-right', sample(rz, 38, 25), 'GREEN(tex TR)');
  check('screen bottom-left -> texture bottom-left', sample(rz, 26, 39), 'BLUE(tex BL)');
  check('screen bottom-right-> texture bottom-right', sample(rz, 38, 39), 'WHITE(tex BR)');
}

// ---- Case 4: box -X face, viewed from -X ----
{
  const mb = new MeshBuilder();
  mb.light = () => 1;
  mb.box(-0.5, 0, -1, 0.5, 2, 1, { all: { tex, uv: [0, 0, 8, 8] } });
  const mesh = mb.build();
  const rz = new Raster(64, 64);
  rz.snap = 0; rz.fogNear = 100; rz.fogFar = 200;
  rz.clear(0xFF000000);
  const cam = mat(), view = mat();
  setPosYaw(cam, -4, 1, 0, Math.PI / 2);        // forward = +X
  invertRigid(view, cam);
  rz.setCamera(view, 1.2);
  rz.drawMesh(mesh, mat(), {});
  console.log('\n-- box -X face, viewed head on --');
  check('screen top-left    -> texture top-left', sample(rz, 26, 25), 'RED(tex TL)');
  check('screen bottom-right-> texture bottom-right', sample(rz, 38, 39), 'WHITE(tex BR)');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall orientation checks passed');
process.exit(fails ? 1 : 0);
