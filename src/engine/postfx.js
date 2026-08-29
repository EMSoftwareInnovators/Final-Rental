/* ============================================================
   postfx.js -- the tape deck. Takes the raw framebuffer and puts
   it through 1996: 15-bit ordered dithering (PS1 did this in
   hardware), chroma bleed, head-switching noise at the bottom of
   the frame, rolling tracking bands, scanlines and phosphor decay.
   ============================================================ */

// 4x4 Bayer, biased to +/- half a quantization step
const BAYER = new Int32Array([
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
].map((v) => v - 8));

export class PostFX {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.resize(w, h);
    this.t = 0;
    this.trackY = -1;
    this.trackTimer = 2 + Math.random() * 5;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.out = new Uint32Array(this.img.data.buffer);
    this.prev = new Uint32Array(w * h);
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * @param src Uint32Array framebuffer (0xAABBGGRR)
   * @param p   { dt, dither, bleed, scan, ghost, grain, warp, fade, flash,
   *              tintR,tintG,tintB, dark, distress, roll, tear, invert }
   *
   * roll   -- vertical frame slip, in pixels, wrapping: the picture losing
   *           vertical hold and rolling through itself.
   * tear   -- 0..1, how often a scanline is displaced far enough to rip the
   *           image sideways rather than merely wobble it.
   * invert -- 0..1 mix toward a photographic negative.
   * vhs    -- false to switch off everything that belongs to the tape
   *           rather than to the console: the rolling head-switching band,
   *           the garbage line along the bottom of the frame, and the
   *           dropout flecks. The dither, the vignette and the scanlines
   *           are the PlayStation on a CRT and stay.
   */
  render(src, p) {
    const w = this.w, h = this.h, out = this.out, prev = this.prev;
    this.t += p.dt || 0.016;
    const t = this.t;

    const vhs = p.vhs !== false;

    // --- rolling head-switching band -------------------------------------
    if (!vhs) { this.trackY = -100; this.trackTimer = 99; }
    this.trackTimer -= p.dt || 0.016;
    if (this.trackTimer <= 0) {
      this.trackTimer = (2.5 + Math.random() * 6) / (1 + (p.distress || 0) * 3);
      this.trackY = h + 8;
      this.trackH = 4 + Math.random() * 12;
      this.trackAmp = 2 + Math.random() * 7 + (p.distress || 0) * 10;
    }
    if (this.trackY > -20) this.trackY -= (60 + (p.distress || 0) * 220) * (p.dt || 0.016);

    const dither = p.dither !== false;
    const bleed = p.bleed === undefined ? 1 : p.bleed;
    const scan = p.scan === undefined ? 0.82 : p.scan;
    const ghost = p.ghost === undefined ? 0.20 : p.ghost;
    const grain = p.grain === undefined ? 10 : p.grain;
    const warp = p.warp || 0;
    const fade = p.fade === undefined ? 0 : p.fade;       // 0 = normal, 1 = black
    const flash = p.flash || 0;                            // 0..1 white
    const dark = p.dark === undefined ? 1 : p.dark;        // global gain
    const tr = p.tintR === undefined ? 1 : p.tintR;
    const tg = p.tintG === undefined ? 1 : p.tintG;
    const tb = p.tintB === undefined ? 1 : p.tintB;
    const distress = p.distress || 0;
    const roll = (p.roll || 0) | 0;
    const tear = p.tear || 0;
    const invert = p.invert || 0;
    const invK = (invert * 256) | 0, invKeep = 256 - invK;

    const gain = dark * (1 - fade);
    const gR = gain * tr * 256 | 0, gG = gain * tg * 256 | 0, gB = gain * tb * 256 | 0;
    const flashAdd = (flash * 255) | 0;
    const ghostK = (ghost * 256) | 0, keepK = 256 - ghostK;

    // vignette: precompute per-row/col falloff
    if (!this._vig || this._vig.length !== w * h) this._buildVignette();
    const vig = this._vig;

    for (let y = 0; y < h; y++) {
      // horizontal displacement of this scanline
      let shift = 0;
      if (warp) shift += Math.sin(y * 0.21 + t * 4.7) * warp;
      const inBand = this.trackY > -20 && y >= this.trackY && y < this.trackY + this.trackH;
      if (inBand) shift += (Math.random() - 0.5) * this.trackAmp * 2;
      // a torn line: the head losing the track completely for one scanline
      if (tear && Math.random() < tear * 0.20) shift += (Math.random() - 0.5) * w * 0.7;
      // head-switching garbage in the last few lines, like a real VHS
      const hsw = vhs && y >= h - 4;
      if (hsw) shift += (Math.random() - 0.5) * 10;
      const sh = shift | 0;

      // vertical hold: the frame slipping, wrapping round on itself
      let sy = y;
      if (roll) { sy = (y + roll) % h; if (sy < 0) sy += h; }
      const row = sy * w;
      const outRow = y * w;
      const scanK = ((y & 1) ? scan : 1) * 256 | 0;
      const bandBoost = inBand ? 40 : 0;

      for (let x = 0; x < w; x++) {
        const i = outRow + x;
        // chroma bleed: red lags, blue leads (composite video, roughly)
        let xr = x + sh - bleed, xg = x + sh, xb = x + sh + bleed;
        xr = xr < 0 ? 0 : xr >= w ? w - 1 : xr;
        xg = xg < 0 ? 0 : xg >= w ? w - 1 : xg;
        xb = xb < 0 ? 0 : xb >= w ? w - 1 : xb;
        const cr = src[row + xr], cg = src[row + xg], cb = src[row + xb];

        let r = cr & 255, g = (cg >> 8) & 255, b = (cb >> 16) & 255;

        // phosphor / tape ghosting from the previous frame
        if (ghostK) {
          const pv = prev[i];
          r = (r * keepK + (pv & 255) * ghostK) >> 8;
          g = (g * keepK + ((pv >> 8) & 255) * ghostK) >> 8;
          b = (b * keepK + ((pv >> 16) & 255) * ghostK) >> 8;
        }

        // gain, tint, scanline, vignette
        const v = vig[i];
        let R = (((r * gR) >> 8) * scanK >> 8) * v >> 8;
        let G = (((g * gG) >> 8) * scanK >> 8) * v >> 8;
        let B = (((b * gB) >> 8) * scanK >> 8) * v >> 8;

        // grain + band boost
        if (grain) {
          const n = ((Math.random() * grain) | 0) - (grain >> 1) + bandBoost;
          R += n; G += n; B += n;
        } else if (bandBoost) { R += bandBoost; G += bandBoost; B += bandBoost; }

        if (hsw) { const n = (Math.random() * 190) | 0; R = n; G = n; B = n + 10; }
        if (invK) {
          R = (R * invKeep + (255 - R) * invK) >> 8;
          G = (G * invKeep + (255 - G) * invK) >> 8;
          B = (B * invKeep + (255 - B) * invK) >> 8;
        }
        if (flashAdd) { R += flashAdd; G += flashAdd; B += flashAdd; }

        // 15-bit quantization with ordered dither -- the PS1 signature
        if (dither) {
          const d = BAYER[((y & 3) << 2) | (x & 3)];
          R += d; G += d; B += d;
          R = (R < 0 ? 0 : R > 255 ? 255 : R) & 0xF8;
          G = (G < 0 ? 0 : G > 255 ? 255 : G) & 0xF8;
          B = (B < 0 ? 0 : B > 255 ? 255 : B) & 0xF8;
        } else {
          R = R < 0 ? 0 : R > 255 ? 255 : R;
          G = G < 0 ? 0 : G > 255 ? 255 : G;
          B = B < 0 ? 0 : B > 255 ? 255 : B;
        }
        out[i] = 0xFF000000 | (B << 16) | (G << 8) | R;
      }
    }

    // dropout flecks -- brief white/black specks like a worn tape
    if (vhs && distress > 0.01) {
      const n = (distress * 120) | 0;
      for (let k = 0; k < n; k++) {
        const x = (Math.random() * w) | 0, y = (Math.random() * h) | 0;
        const len = 1 + ((Math.random() * 6 * distress) | 0);
        const c = Math.random() < 0.5 ? 0xFFFFFFFF : 0xFF101010;
        for (let i = 0; i < len && x + i < w; i++) out[y * w + x + i] = c;
      }
    }

    prev.set(out);
    this.ctx.putImageData(this.img, 0, 0);
  }

  _buildVignette() {
    const w = this.w, h = this.h;
    const v = new Uint8Array(w * h);
    const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxd;
        const k = 1 - 0.42 * Math.pow(d, 2.2);
        v[y * w + x] = Math.max(0, Math.min(255, k * 255)) | 0;
      }
    }
    this._vig = v;
  }
}
