/* ============================================================
   mesh.js -- mesh construction. Front faces wind counter-clockwise
   when seen from outside. Large surfaces are subdivided on purpose:
   affine texture mapping warps badly across big polygons, and the
   PS1 fix was exactly this -- chop the floor into tiles.
   ============================================================ */
import { F_DOUBLE } from './raster.js';

export class MeshBuilder {
  constructor(textures) {
    this.textures = textures || [];
    this.px = []; this.uv = []; this.sh = [];
    this.idx = []; this.tex = []; this.flg = [];
    /** Override to bake vertex lighting: (x,y,z,nx,ny,nz) -> 0..1+ */
    this.light = null;
    this.shadeBias = 1;
  }

  slot(texture) {
    let i = this.textures.indexOf(texture);
    if (i < 0) { i = this.textures.length; this.textures.push(texture); }
    return i;
  }

  vert(x, y, z, u, v, nx, ny, nz) {
    const i = this.sh.length;
    this.px.push(x, y, z);
    this.uv.push(u, v);
    this.sh.push(this.light ? this.light(x, y, z, nx, ny, nz) * this.shadeBias : this.shadeBias);
    return i;
  }

  tri(a, b, c, slot, flags) {
    this.idx.push(a, b, c);
    this.tex.push(slot); this.flg.push(flags | 0);
  }

  /**
   * Counter-clockwise quad p0->p1->p2->p3 seen from the front.
   *
   * `uv` is a plain canvas rect in texel units: [left, top, right, bottom].
   * Because p0 lands at the viewer's bottom-RIGHT for a front-facing quad
   * (screen +X is world -X once you are looking at the face), the rect is
   * unpacked corner-swapped here so art comes out upright and unmirrored
   * on every wall, box side and sign in the game.
   */
  quad(p0, p1, p2, p3, tex, uv, flags, sub) {
    const slot = typeof tex === 'number' ? tex : this.slot(tex);
    const u0 = uv[2], v0 = uv[3], u1 = uv[0], v1 = uv[1];
    const n = normalOf(p0, p1, p2);
    const S = Math.max(1, sub ? sub[0] : 1), T = Math.max(1, sub ? sub[1] : 1);
    // bilinear corner interpolation lets one call emit a subdivided grid
    const P = (s, t) => {
      const a0 = 1 - s, a1 = s, b0 = 1 - t, b1 = t;
      return [
        (p0[0] * a0 + p1[0] * a1) * b0 + (p3[0] * a0 + p2[0] * a1) * b1,
        (p0[1] * a0 + p1[1] * a1) * b0 + (p3[1] * a0 + p2[1] * a1) * b1,
        (p0[2] * a0 + p1[2] * a1) * b0 + (p3[2] * a0 + p2[2] * a1) * b1,
      ];
    };
    const grid = [];
    for (let t = 0; t <= T; t++) {
      const row = [];
      for (let s = 0; s <= S; s++) {
        const p = P(s / S, t / T);
        const uu = u0 + (u1 - u0) * (s / S) * (sub && sub[2] ? S : 1);
        const vv = v0 + (v1 - v0) * (t / T) * (sub && sub[2] ? T : 1);
        row.push(this.vert(p[0], p[1], p[2], uu, vv, n[0], n[1], n[2]));
      }
      grid.push(row);
    }
    for (let t = 0; t < T; t++) {
      for (let s = 0; s < S; s++) {
        const a = grid[t][s], b = grid[t][s + 1], c = grid[t + 1][s + 1], d = grid[t + 1][s];
        this.tri(a, b, c, slot, flags);
        this.tri(a, c, d, slot, flags);
      }
    }
  }

  /**
   * Axis-aligned box from (x0,y0,z0) to (x1,y1,z1).
   * `faces` maps side -> {tex, uv, flags, sub} ; `faces.all` is the fallback.
   * A side set to null is skipped (handy for open-backed shelving).
   */
  box(x0, y0, z0, x1, y1, z1, faces) {
    const all = faces.all;
    const side = (k) => (k in faces ? faces[k] : all);
    const put = (f, p0, p1, p2, p3) => {
      if (!f) return;
      this.quad(p0, p1, p2, p3, f.tex, f.uv || [0, 0, 64, 64], f.flags | 0, f.sub);
    };
    // +Z (front, looking toward -Z)
    put(side('pz'), [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    // -Z (back)
    put(side('nz'), [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    // +X (right)
    put(side('px'), [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    // -X (left)
    put(side('nx'), [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    // +Y (top)
    put(side('py'), [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    // -Y (bottom)
    put(side('ny'), [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  /** Flat billboard-ish plate standing on the XY plane at z, double sided. */
  plate(cx, y0, cz, w, h, yaw, tex, uv, flags) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2;
    const ax = cx - c * hw, az = cz + s * hw;
    const bx = cx + c * hw, bz = cz - s * hw;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y0 + h, bz], [ax, y0 + h, az],
      tex, uv, (flags | 0) | F_DOUBLE);
  }

  merge(other, dx = 0, dy = 0, dz = 0) {
    const base = this.sh.length;
    for (let i = 0; i < other.sh.length; i++) {
      this.px.push(other.px[i * 3] + dx, other.px[i * 3 + 1] + dy, other.px[i * 3 + 2] + dz);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      this.sh.push(other.sh[i]);
    }
    const map = other.textures.map((t) => this.slot(t));
    for (let t = 0; t < other.tex.length; t++) {
      this.idx.push(other.idx[t * 3] + base, other.idx[t * 3 + 1] + base, other.idx[t * 3 + 2] + base);
      this.tex.push(map[other.tex[t]]);
      this.flg.push(other.flg[t]);
    }
  }

  build() {
    const n = this.sh.length;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    for (let i = 0; i < n; i++) {
      const x = this.px[i * 3], y = this.px[i * 3 + 1], z = this.px[i * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
    const r = n ? Math.hypot(maxx - cx, maxy - cy, maxz - cz) : 0;
    return {
      count: n,
      vx: new Float32Array(this.px),
      vu: new Float32Array(this.uv),
      vs: new Float32Array(this.sh),
      idx: n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      tex: new Uint8Array(this.tex),
      flg: new Uint8Array(this.flg),
      textures: this.textures,
      bounds: { x: cx, y: cy, z: cz, r },
      triCount: this.tex.length,
    };
  }
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
