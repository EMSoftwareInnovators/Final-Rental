/* ============================================================
   raster.js -- software triangle rasterizer that reproduces the
   PlayStation 1 / Nintendo 64 look on purpose, not by filter:

     * integer vertex snapping        -> the famous polygon wobble
     * AFFINE texture mapping         -> textures swim on big polys
     * per-vertex shade + black fog   -> vertex lighting, no lightmaps
     * nearest-neighbor texels        -> no bilinear smear
     * 1/z depth buffer               -> keeps it sane at 60fps

   Everything writes into one Uint32Array in 0xAABBGGRR order so it
   can be handed straight to ImageData.
   ============================================================ */

export const F_DOUBLE = 1;   // don't backface-cull
export const F_EMIT = 2;     // full bright, ignores light + fog
export const F_BLEND = 4;    // 50% blend, no depth write (glass)
export const F_ADD = 8;      // additive, no depth write (glow)

const NEAR = 0.08;

export class Raster {
  constructor(w, h) {
    this.resize(w, h);
    this.fogNear = 3.0;
    this.fogFar = 14.0;
    this.snap = 1;            // 1 = full pixel snap (max wobble), 0 = smooth
    this.view = null;
    this.focal = 1;
    this.tris = 0;            // per-frame stats
    this.spans = 0;
    // vertex scratch, grown on demand
    this._n = 0;
    this._grow(4096);
    // clip scratch (max 4 verts after one plane)
    this._cx = new Float32Array(8); this._cy = new Float32Array(8);
    this._cz = new Float32Array(8); this._cu = new Float32Array(8);
    this._cv = new Float32Array(8); this._cs = new Float32Array(8);
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.color = new Uint32Array(w * h);
    this.depth = new Float32Array(w * h);
    this.cx = w * 0.5; this.cy = h * 0.5;
  }

  _grow(n) {
    if (n <= this._n) return;
    this._n = n;
    this.tvx = new Float32Array(n); this.tvy = new Float32Array(n); this.tvz = new Float32Array(n);
    this.tsx = new Float32Array(n); this.tsy = new Float32Array(n); this.tiz = new Float32Array(n);
    this.tsh = new Float32Array(n);
  }

  clear(bg) {
    this.color.fill(bg >>> 0);
    this.depth.fill(0);
    this.tris = 0; this.spans = 0;
  }

  /** @param view inverse camera matrix (3x4)  @param fovY vertical fov in radians */
  setCamera(view, fovY) {
    this.view = view;
    this.focal = (this.h * 0.5) / Math.tan(fovY * 0.5);
    // side-plane slopes for sphere culling, in view space
    const fx = this.focal / (this.w * 0.5), fy = this.focal / (this.h * 0.5);
    this._planeX = 1 / Math.sqrt(1 + fx * fx);
    this._planeY = 1 / Math.sqrt(1 + fy * fy);
    this._slopeX = 1 / fx;
    this._slopeY = 1 / fy;
  }

  /** Rough bounding-sphere frustum test in view space. */
  sphereVisible(x, y, z, r) {
    const m = this.view;
    const vz = m[8] * x + m[9] * y + m[10] * z + m[11];
    if (vz < -r) return false;
    if (vz - r > this.fogFar * 1.6) return false;
    const vx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const vy = m[4] * x + m[5] * y + m[6] * z + m[7];
    // distance to left/right planes: (vz*slope - |vx|) normalized
    if ((vz * this._slopeX - Math.abs(vx)) * this._planeX < -r) return false;
    if ((vz * this._slopeY - Math.abs(vy)) * this._planeY < -r) return false;
    return true;
  }

  /**
   * @param mesh   see mesh.js
   * @param m      model->world 3x4
   * @param opt    { shade, textures, flags, fogScale }
   */
  drawMesh(mesh, m, opt) {
    const view = this.view;
    const n = mesh.count;
    this._grow(n);
    const vx = mesh.vx, vu = mesh.vu, vs = mesh.vs;
    const tvx = this.tvx, tvy = this.tvy, tvz = this.tvz;
    const tsx = this.tsx, tsy = this.tsy, tiz = this.tiz, tsh = this.tsh;

    // model -> view, collapsed into one 3x4
    const a0 = view[0], a1 = view[1], a2 = view[2], a3 = view[3];
    const a4 = view[4], a5 = view[5], a6 = view[6], a7 = view[7];
    const a8 = view[8], a9 = view[9], a10 = view[10], a11 = view[11];
    const m0 = a0 * m[0] + a1 * m[4] + a2 * m[8];
    const m1 = a0 * m[1] + a1 * m[5] + a2 * m[9];
    const m2 = a0 * m[2] + a1 * m[6] + a2 * m[10];
    const m3 = a0 * m[3] + a1 * m[7] + a2 * m[11] + a3;
    const m4 = a4 * m[0] + a5 * m[4] + a6 * m[8];
    const m5 = a4 * m[1] + a5 * m[5] + a6 * m[9];
    const m6 = a4 * m[2] + a5 * m[6] + a6 * m[10];
    const m7 = a4 * m[3] + a5 * m[7] + a6 * m[11] + a7;
    const m8 = a8 * m[0] + a9 * m[4] + a10 * m[8];
    const m9 = a8 * m[1] + a9 * m[5] + a10 * m[9];
    const m10 = a8 * m[2] + a9 * m[6] + a10 * m[10];
    const m11 = a8 * m[3] + a9 * m[7] + a10 * m[11] + a11;

    const focal = this.focal, ccx = this.cx, ccy = this.cy;
    const shade = (opt && opt.shade !== undefined) ? opt.shade : 1;
    const fogN = this.fogNear, fogRange = 1 / Math.max(0.001, this.fogFar - this.fogNear);
    const snap = this.snap;

    for (let i = 0, p = 0, q = 0; i < n; i++, p += 3, q += 2) {
      const x = vx[p], y = vx[p + 1], z = vx[p + 2];
      const zz = m8 * x + m9 * y + m10 * z + m11;
      tvx[i] = m0 * x + m1 * y + m2 * z + m3;
      tvy[i] = m4 * x + m5 * y + m6 * z + m7;
      tvz[i] = zz;
      if (zz > NEAR) {
        const iz = 1 / zz;
        let sx = ccx + tvx[i] * focal * iz;
        let sy = ccy - tvy[i] * focal * iz;
        if (snap) { sx = Math.round(sx); sy = Math.round(sy); }
        tsx[i] = sx; tsy[i] = sy; tiz[i] = iz;
      }
      // shade = baked vertex light * distance fog, folded into one scalar
      let f = 1 - (zz - fogN) * fogRange;
      if (f > 1) f = 1; else if (f < 0) f = 0;
      let s = vs[i] * shade * f * 256;
      tsh[i] = s > 256 ? 256 : s < 0 ? 0 : s;
    }

    const idx = mesh.idx, tex = mesh.tex, flg = mesh.flg;
    const texes = (opt && opt.textures) || mesh.textures;
    const extra = (opt && opt.flags) || 0;
    const nt = idx.length;
    for (let t = 0, j = 0; j < nt; t++, j += 3) {
      const i0 = idx[j], i1 = idx[j + 1], i2 = idx[j + 2];
      const z0 = tvz[i0], z1 = tvz[i1], z2 = tvz[i2];
      if (z0 <= NEAR && z1 <= NEAR && z2 <= NEAR) continue;
      const flags = flg[t] | extra;
      const T = texes[tex[t]];
      if (!T) continue;
      if (z0 > NEAR && z1 > NEAR && z2 > NEAR) {
        this._tri(
          tsx[i0], tsy[i0], tiz[i0], vu[i0 * 2], vu[i0 * 2 + 1], tsh[i0],
          tsx[i1], tsy[i1], tiz[i1], vu[i1 * 2], vu[i1 * 2 + 1], tsh[i1],
          tsx[i2], tsy[i2], tiz[i2], vu[i2 * 2], vu[i2 * 2 + 1], tsh[i2],
          T, flags);
      } else {
        this._clipTri(i0, i1, i2, vu, T, flags);
      }
    }
  }

  /** Sutherland-Hodgman against the near plane, then fan-triangulate. */
  _clipTri(i0, i1, i2, vu, T, flags) {
    const tvx = this.tvx, tvy = this.tvy, tvz = this.tvz, tsh = this.tsh;
    const ix = [i0, i1, i2];
    const cx = this._cx, cy = this._cy, cz = this._cz, cu = this._cu, cv = this._cv, cs = this._cs;
    let nOut = 0;
    for (let e = 0; e < 3; e++) {
      const a = ix[e], b = ix[(e + 1) % 3];
      const za = tvz[a], zb = tvz[b];
      const ina = za > NEAR, inb = zb > NEAR;
      if (ina) {
        cx[nOut] = tvx[a]; cy[nOut] = tvy[a]; cz[nOut] = za;
        cu[nOut] = vu[a * 2]; cv[nOut] = vu[a * 2 + 1]; cs[nOut] = tsh[a]; nOut++;
      }
      if (ina !== inb) {
        const t = (NEAR - za) / (zb - za);
        cx[nOut] = tvx[a] + (tvx[b] - tvx[a]) * t;
        cy[nOut] = tvy[a] + (tvy[b] - tvy[a]) * t;
        cz[nOut] = NEAR;
        cu[nOut] = vu[a * 2] + (vu[b * 2] - vu[a * 2]) * t;
        cv[nOut] = vu[a * 2 + 1] + (vu[b * 2 + 1] - vu[a * 2 + 1]) * t;
        cs[nOut] = tsh[a] + (tsh[b] - tsh[a]) * t;
        nOut++;
      }
    }
    if (nOut < 3) return;
    const focal = this.focal, ccx = this.cx, ccy = this.cy, snap = this.snap;
    const sx = this._psx || (this._psx = new Float32Array(8));
    const sy = this._psy || (this._psy = new Float32Array(8));
    const iz = this._piz || (this._piz = new Float32Array(8));
    for (let k = 0; k < nOut; k++) {
      const z = cz[k], q = 1 / z;
      let x = ccx + cx[k] * focal * q, y = ccy - cy[k] * focal * q;
      if (snap) { x = Math.round(x); y = Math.round(y); }
      sx[k] = x; sy[k] = y; iz[k] = q;
    }
    for (let k = 1; k < nOut - 1; k++) {
      this._tri(
        sx[0], sy[0], iz[0], cu[0], cv[0], cs[0],
        sx[k], sy[k], iz[k], cu[k], cv[k], cs[k],
        sx[k + 1], sy[k + 1], iz[k + 1], cu[k + 1], cv[k + 1], cs[k + 1],
        T, flags);
    }
  }

  _tri(x0, y0, z0, u0, v0, s0, x1, y1, z1, u1, v1, s1, x2, y2, z2, u2, v2, s2, T, flags) {
    // signed area -> backface cull (screen space, y-down so CW is front)
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    // camera looks down +Z, so front faces come out counter-clockwise (area > 0)
    if (area < 0 && !(flags & F_DOUBLE)) return;
    if (area < 0) { // double-sided back face: swap to keep winding consistent
      let t;
      t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; t = z1; z1 = z2; z2 = t;
      t = u1; u1 = u2; u2 = t; t = v1; v1 = v2; v2 = t; t = s1; s1 = s2; s2 = t;
    }
    if (flags & F_EMIT) { s0 = s1 = s2 = 256; }
    this.tris++;

    // sort by y: a = top, b = mid, c = bottom
    let ax = x0, ay = y0, az = z0, au = u0, av = v0, as = s0;
    let bx = x1, by = y1, bz = z1, bu = u1, bv = v1, bs = s1;
    let cx = x2, cy = y2, cz = z2, cu = u2, cv = v2, cs = s2;
    let t;
    if (ay > by) { t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = az; az = bz; bz = t; t = au; au = bu; bu = t; t = av; av = bv; bv = t; t = as; as = bs; bs = t; }
    if (by > cy) { t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bz; bz = cz; cz = t; t = bu; bu = cu; cu = t; t = bv; bv = cv; cv = t; t = bs; bs = cs; cs = t; }
    if (ay > by) { t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = az; az = bz; bz = t; t = au; au = bu; bu = t; t = av; av = bv; bv = t; t = as; as = bs; bs = t; }
    if (ay === cy) return;
    if (cy < 0 || ay > this.h) return;

    const solid = !(flags & (F_BLEND | F_ADD));
    const hAC = cy - ay;
    const dxAC = (cx - ax) / hAC, dzAC = (cz - az) / hAC;
    const duAC = (cu - au) / hAC, dvAC = (cv - av) / hAC, dsAC = (cs - as) / hAC;

    // upper half: A->B and A->C
    if (by > ay) {
      const hAB = by - ay;
      this._half(ay, by, ax, az, au, av, as, dxAC, dzAC, duAC, dvAC, dsAC,
        ax, az, au, av, as, (bx - ax) / hAB, (bz - az) / hAB, (bu - au) / hAB, (bv - av) / hAB, (bs - as) / hAB,
        T, flags, solid);
    }
    // lower half: B->C, with A->C continued from B's y
    if (cy > by) {
      const hBC = cy - by;
      const k = by - ay;
      this._half(by, cy, ax + dxAC * k, az + dzAC * k, au + duAC * k, av + dvAC * k, as + dsAC * k,
        dxAC, dzAC, duAC, dvAC, dsAC,
        bx, bz, bu, bv, bs, (cx - bx) / hBC, (cz - bz) / hBC, (cu - bu) / hBC, (cv - bv) / hBC, (cs - bs) / hBC,
        T, flags, solid);
    }
  }

  _half(y0, y1, lx, lz, lu, lv, ls, dlx, dlz, dlu, dlv, dls,
    rx, rz, ru, rv, rs, drx, drz, dru, drv, drs, T, flags, solid) {
    const H = this.h, W = this.w;
    // Scanlines are integers; step both edges up to the first covered one.
    // (Without this, un-snapped vertices produce fractional row indices and
    // every write silently vanishes into a typed array.)
    let y = Math.ceil(y0);
    let pre = y - y0;
    if (y < 0) { pre = -y0; y = 0; }
    if (pre > 0) {
      lx += dlx * pre; lz += dlz * pre; lu += dlu * pre; lv += dlv * pre; ls += dls * pre;
      rx += drx * pre; rz += drz * pre; ru += dru * pre; rv += drv * pre; rs += drs * pre;
    }
    const yEnd = Math.min(Math.ceil(y1), H);
    const color = this.color, depth = this.depth;
    const tw = T.wMask, th = T.hMask, tsh = T.shift, tp = T.px;
    const add = (flags & F_ADD) !== 0;

    for (; y < yEnd; y++) {
      let x0f = lx, x1f = rx, z0f = lz, z1f = rz, u0f = lu, u1f = ru, v0f = lv, v1f = rv, s0f = ls, s1f = rs;
      if (x0f > x1f) {
        let t;
        t = x0f; x0f = x1f; x1f = t; t = z0f; z0f = z1f; z1f = t;
        t = u0f; u0f = u1f; u1f = t; t = v0f; v0f = v1f; v1f = t; t = s0f; s0f = s1f; s1f = t;
      }
      const span = x1f - x0f;
      let xs = Math.ceil(x0f);
      let xe = Math.min(Math.ceil(x1f), W);
      if (span > 0 && xe > 0 && xs < W) {
        const inv = 1 / span;
        const dz = (z1f - z0f) * inv, du = (u1f - u0f) * inv, dv = (v1f - v0f) * inv, ds = (s1f - s0f) * inv;
        let stepX = xs - x0f;
        if (xs < 0) { stepX = -x0f; xs = 0; }
        let z = z0f + dz * stepX, u = u0f + du * stepX, v = v0f + dv * stepX, s = s0f + ds * stepX;
        let idx = y * W + xs;
        this.spans++;
        if (solid) {
          for (let x = xs; x < xe; x++, idx++) {
            if (z > depth[idx]) {
              const texel = tp[(((v | 0) & th) << tsh) + ((u | 0) & tw)];
              if (texel & 0xFF000000) {
                const q = s | 0;
                color[idx] = 0xFF000000 |
                  ((((texel & 0x00FF00FF) * q) >>> 8) & 0x00FF00FF) |
                  ((((texel & 0x0000FF00) * q) >>> 8) & 0x0000FF00);
                depth[idx] = z;
              }
            }
            z += dz; u += du; v += dv; s += ds;
          }
        } else {
          for (let x = xs; x < xe; x++, idx++) {
            if (z > depth[idx]) {
              const texel = tp[(((v | 0) & th) << tsh) + ((u | 0) & tw)];
              if (texel & 0xFF000000) {
                const q = s | 0;
                const src = ((((texel & 0x00FF00FF) * q) >>> 8) & 0x00FF00FF) |
                  ((((texel & 0x0000FF00) * q) >>> 8) & 0x0000FF00);
                const dst = color[idx];
                if (add) {
                  let r = (src & 255) + (dst & 255); if (r > 255) r = 255;
                  let g = ((src >> 8) & 255) + ((dst >> 8) & 255); if (g > 255) g = 255;
                  let b = ((src >> 16) & 255) + ((dst >> 16) & 255); if (b > 255) b = 255;
                  color[idx] = 0xFF000000 | (b << 16) | (g << 8) | r;
                } else {
                  color[idx] = 0xFF000000 | ((((src & 0xFEFEFE) >> 1) + ((dst & 0xFEFEFE) >> 1)) & 0xFFFFFF);
                }
              }
            }
            z += dz; u += du; v += dv; s += ds;
          }
        }
      }
      lx += dlx; lz += dlz; lu += dlu; lv += dlv; ls += dls;
      rx += drx; rz += drz; ru += dru; rv += drv; rs += drs;
    }
  }

  /** World point -> screen pixel, or null if behind/offscreen. Used for UI anchors. */
  project(x, y, z, out) {
    const m = this.view;
    const vz = m[8] * x + m[9] * y + m[10] * z + m[11];
    if (vz <= NEAR) return null;
    const vx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const vy = m[4] * x + m[5] * y + m[6] * z + m[7];
    const q = this.focal / vz;
    out.x = this.cx + vx * q; out.y = this.cy - vy * q; out.z = vz;
    return out;
  }
}
