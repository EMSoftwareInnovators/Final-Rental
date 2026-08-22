/* ============================================================
   audio.js -- every sound is synthesised. No samples, no files.
   Fluorescent hum, a rewinder motor, a rotary phone, dialogue
   blips pitched per character, and a dread bed that tightens as
   the night goes wrong.
   ============================================================ */

export class Sound {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.masterVol = 0.8;
    this.tension = 0;
    this._tensionTarget = 0;
    this.muted = false;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;
    // a gentle limiter keeps stacked stingers from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 6; comp.attack.value = 0.004;
    this.master.connect(comp).connect(ctx.destination);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.master);

    // shared noise buffer (2s of white noise)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.ready = true;
    this._startBeds();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  get t() { return this.ctx.currentTime; }

  /* ---------------- primitive voices ---------------- */
  _env(node, t0, gain, a, d, s = 0, sT = 0, r = 0.02) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + a);
    if (sT > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * s), t0 + a + d);
      g.gain.setValueAtTime(Math.max(0.0002, gain * s), t0 + a + d + sT);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + sT + r);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    }
    node.connect(g);
    return g;
  }

  tone(o = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t0 = (o.when || 0) + this.t;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq || 440, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + (o.slide || (o.a || 0.005) + (o.d || 0.2)));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter; f.frequency.value = o.cutoff || 1200; f.Q.value = o.q || 1;
      osc.connect(f); node = f;
    }
    const g = this._env(node, t0, (o.gain === undefined ? 0.25 : o.gain), o.a || 0.005, o.d || 0.2, o.s, o.sT, o.r);
    g.connect(o.bus || this.sfxBus);
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = o.pan;
      g.disconnect(); g.connect(p); p.connect(o.bus || this.sfxBus);
    }
    osc.start(t0); osc.stop(t0 + (o.a || 0.005) + (o.d || 0.2) + (o.sT || 0) + (o.r || 0.02) + 0.05);
  }

  noise(o = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t0 = (o.when || 0) + this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.a || 0.005) + (o.d || 0.2));
    f.Q.value = o.q || 1;
    src.connect(f);
    const g = this._env(f, t0, o.gain === undefined ? 0.2 : o.gain, o.a || 0.005, o.d || 0.2, o.s, o.sT, o.r);
    let out = g;
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p;
    }
    out.connect(o.bus || this.sfxBus);
    src.start(t0); src.stop(t0 + (o.a || 0.005) + (o.d || 0.2) + (o.sT || 0) + (o.r || 0.02) + 0.05);
  }

  /* ---------------- looping beds ---------------- */
  _startBeds() {
    const ctx = this.ctx;
    // fluorescent hum: 120Hz buzz + a little 240
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0.035;
    this.humGain.connect(this.ambBus);
    for (const [f, g] of [[120, 1], [240, 0.4], [360, 0.15]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 700;
      const gg = ctx.createGain(); gg.gain.value = g * 0.25;
      o.connect(bp).connect(gg).connect(this.humGain); o.start();
    }
    // room tone: very low filtered noise
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    this.roomGain = ctx.createGain(); this.roomGain.gain.value = 0.05;
    n.connect(lp).connect(this.roomGain).connect(this.ambBus); n.start();

    // dread bed: two detuned saws through a slow filter, silent until tension rises
    this.dreadGain = ctx.createGain(); this.dreadGain.gain.value = 0;
    this.dreadFilter = ctx.createBiquadFilter();
    this.dreadFilter.type = 'lowpass'; this.dreadFilter.frequency.value = 200; this.dreadFilter.Q.value = 3;
    this.dreadFilter.connect(this.dreadGain).connect(this.ambBus);
    this.dreadOscs = [];
    for (const [f, dt] of [[55, -7], [55, 9], [82.5, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = dt;
      const g = ctx.createGain(); g.gain.value = 0.3;
      o.connect(g).connect(this.dreadFilter); o.start();
      this.dreadOscs.push(o);
    }
    // slow tremolo on the dread bed
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 60;
    lfo.connect(lg).connect(this.dreadFilter.frequency); lfo.start();
  }

  setTension(x) { this._tensionTarget = Math.max(0, Math.min(1, x)); }

  update(dt) {
    if (!this.ready) return;
    this.tension += (this._tensionTarget - this.tension) * Math.min(1, dt * 1.2);
    const g = this.tension * this.tension * 0.16;
    this.dreadGain.gain.setTargetAtTime(this.muted ? 0 : g, this.t, 0.2);
    this.dreadFilter.frequency.setTargetAtTime(180 + this.tension * 700, this.t, 0.4);
    for (let i = 0; i < this.dreadOscs.length; i++) {
      this.dreadOscs[i].detune.setTargetAtTime((i - 1) * (6 + this.tension * 34), this.t, 0.5);
    }
    if (this.humGain) this.humGain.gain.setTargetAtTime(this.muted ? 0 : 0.035 * this.lightLevel(), this.t, 0.1);
  }

  lightLevel() { return this._lights === undefined ? 1 : this._lights; }
  setLights(v) { this._lights = v; }

  /* ---------------- the sound library ---------------- */
  doorChime(pan = 0) {
    this.tone({ freq: 1318, type: 'sine', gain: 0.18, a: 0.004, d: 0.5, pan });
    this.tone({ freq: 1046, type: 'sine', gain: 0.16, a: 0.004, d: 0.7, when: 0.16, pan });
    this.tone({ freq: 2637, type: 'sine', gain: 0.05, a: 0.004, d: 0.3, pan });
  }
  doorOpen(pan = 0) { this.noise({ filter: 'bandpass', freq: 500, to: 220, q: 2, gain: 0.16, a: 0.01, d: 0.4, pan }); }
  doorBell() { this.doorChime(0); }
  lockClick(locked) {
    this.tone({ freq: locked ? 180 : 240, type: 'square', gain: 0.16, a: 0.001, d: 0.06, filter: 'lowpass', cutoff: 900 });
    this.noise({ freq: 2400, q: 3, gain: 0.14, a: 0.001, d: 0.05 });
    this.tone({ freq: locked ? 90 : 130, type: 'square', gain: 0.12, a: 0.001, d: 0.09, when: 0.07 });
  }
  footstep(pan = 0, run = false) {
    this.noise({ filter: 'lowpass', freq: run ? 380 : 260, q: 1, gain: run ? 0.09 : 0.055, a: 0.002, d: run ? 0.09 : 0.13, pan, rate: 0.6 + Math.random() * 0.3 });
  }
  pickup() { this.noise({ filter: 'bandpass', freq: 1800, q: 1.4, gain: 0.11, a: 0.002, d: 0.09 }); this.tone({ freq: 520, type: 'triangle', gain: 0.06, a: 0.002, d: 0.07 }); }
  drop() { this.noise({ filter: 'lowpass', freq: 700, q: 1, gain: 0.13, a: 0.002, d: 0.13 }); }
  shelve(ok) {
    this.noise({ filter: 'bandpass', freq: 1200, q: 2, gain: 0.1, a: 0.002, d: 0.14 });
    if (ok) { this.tone({ freq: 880, type: 'sine', gain: 0.1, a: 0.004, d: 0.1, when: 0.05 }); this.tone({ freq: 1320, type: 'sine', gain: 0.08, a: 0.004, d: 0.14, when: 0.11 }); }
    else { this.tone({ freq: 220, type: 'square', gain: 0.1, a: 0.004, d: 0.22, when: 0.05, filter: 'lowpass', cutoff: 700 }); }
  }
  registerBeep() { this.tone({ freq: 1760, type: 'square', gain: 0.09, a: 0.002, d: 0.05, filter: 'lowpass', cutoff: 3000 }); }
  kaching() {
    this.tone({ freq: 1568, type: 'triangle', gain: 0.13, a: 0.002, d: 0.28 });
    this.tone({ freq: 2093, type: 'triangle', gain: 0.1, a: 0.002, d: 0.35, when: 0.04 });
    this.noise({ filter: 'lowpass', freq: 900, gain: 0.12, a: 0.002, d: 0.2, when: 0.02 });
  }
  cashDrawer() { this.noise({ filter: 'lowpass', freq: 500, gain: 0.16, a: 0.003, d: 0.3 }); this.tone({ freq: 130, type: 'square', gain: 0.1, a: 0.003, d: 0.2, when: 0.14 }); }
  paper() { this.noise({ filter: 'highpass', freq: 2600, q: 0.7, gain: 0.09, a: 0.004, d: 0.22, rate: 1.6 }); }
  rewindStart() {
    if (!this.ready || this.rewindNode) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.11, this.t + 0.25);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 74;
    const og = ctx.createGain(); og.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    src.connect(bp).connect(g).connect(this.sfxBus);
    osc.connect(og).connect(lp).connect(this.sfxBus);
    src.start(); osc.start();
    this.rewindNode = { src, osc, g, og, bp };
  }
  rewindPitch(p) {
    if (!this.rewindNode) return;
    this.rewindNode.bp.frequency.setTargetAtTime(700 + p * 1400, this.t, 0.15);
    this.rewindNode.osc.frequency.setTargetAtTime(66 + p * 40, this.t, 0.15);
  }
  rewindStop() {
    if (!this.rewindNode) return;
    const { src, osc, g, og } = this.rewindNode;
    g.gain.setTargetAtTime(0.0001, this.t, 0.08);
    og.gain.setTargetAtTime(0.0001, this.t, 0.08);
    src.stop(this.t + 0.5); osc.stop(this.t + 0.5);
    this.rewindNode = null;
    this.tone({ freq: 1200, type: 'square', gain: 0.08, a: 0.002, d: 0.06, when: 0.45 });
    this.noise({ filter: 'lowpass', freq: 400, gain: 0.14, a: 0.002, d: 0.16, when: 0.5 });
  }
  phonePickup() { this.noise({ filter: 'bandpass', freq: 1400, q: 2, gain: 0.12, a: 0.002, d: 0.1 }); this.tone({ freq: 350, type: 'sine', gain: 0.06, a: 0.05, d: 0.9, when: 0.15 }); this.tone({ freq: 440, type: 'sine', gain: 0.06, a: 0.05, d: 0.9, when: 0.15 }); }
  phoneHang() { this.tone({ freq: 200, type: 'square', gain: 0.1, a: 0.002, d: 0.08, filter: 'lowpass', cutoff: 800 }); this.noise({ filter: 'bandpass', freq: 900, gain: 0.1, a: 0.002, d: 0.12 }); }
  dialTone(digit) {
    const LOW = [941, 697, 697, 697, 770, 770, 770, 852, 852, 852];
    const HIGH = [1336, 1209, 1336, 1477, 1209, 1336, 1477, 1209, 1336, 1477];
    const i = digit % 10;
    this.tone({ freq: LOW[i], type: 'sine', gain: 0.09, a: 0.005, d: 0.16 });
    this.tone({ freq: HIGH[i], type: 'sine', gain: 0.09, a: 0.005, d: 0.16 });
  }
  ringback() {
    for (let k = 0; k < 2; k++) {
      this.tone({ freq: 440, type: 'sine', gain: 0.07, a: 0.02, d: 0.02, s: 1, sT: 1.6, r: 0.05, when: k * 3 });
      this.tone({ freq: 480, type: 'sine', gain: 0.07, a: 0.02, d: 0.02, s: 1, sT: 1.6, r: 0.05, when: k * 3 });
    }
  }
  /** Character voice: short blips whose pitch encodes the speaker. */
  blip(pitch = 1, rough = 0) {
    const f = 180 * pitch * (0.94 + Math.random() * 0.12);
    this.tone({ freq: f, type: rough > 0.5 ? 'sawtooth' : 'square', gain: 0.045, a: 0.004, d: 0.055, filter: 'lowpass', cutoff: 900 + rough * 1400 });
    this.tone({ freq: f * 2, type: 'sine', gain: 0.018, a: 0.004, d: 0.04 });
  }
  stinger(intensity = 1) {
    this.tone({ freq: 90, to: 40, type: 'sawtooth', gain: 0.2 * intensity, a: 0.005, d: 1.4, filter: 'lowpass', cutoff: 400 });
    this.tone({ freq: 1600, to: 200, type: 'sawtooth', gain: 0.1 * intensity, a: 0.002, d: 0.9, filter: 'bandpass', cutoff: 1200, q: 6 });
    this.noise({ filter: 'highpass', freq: 3000, to: 400, gain: 0.14 * intensity, a: 0.002, d: 1.0 });
  }
  heartbeat(pan = 0) {
    this.tone({ freq: 62, to: 40, type: 'sine', gain: 0.22, a: 0.006, d: 0.16, pan });
    this.tone({ freq: 54, to: 34, type: 'sine', gain: 0.15, a: 0.006, d: 0.2, when: 0.21, pan });
  }
  knock(n = 3) {
    for (let i = 0; i < n; i++) {
      this.noise({ filter: 'lowpass', freq: 260, q: 1, gain: 0.26, a: 0.001, d: 0.16, when: i * 0.19 });
      this.tone({ freq: 70 + Math.random() * 20, type: 'sine', gain: 0.16, a: 0.001, d: 0.12, when: i * 0.19 });
    }
  }
  glassBreak() {
    this.noise({ filter: 'highpass', freq: 2200, gain: 0.3, a: 0.001, d: 0.9, rate: 1.4 });
    for (let i = 0; i < 12; i++) {
      this.tone({ freq: 1800 + Math.random() * 4000, type: 'triangle', gain: 0.05, a: 0.001, d: 0.12 + Math.random() * 0.3, when: Math.random() * 0.45 });
    }
    this.tone({ freq: 120, to: 50, type: 'sine', gain: 0.22, a: 0.002, d: 0.7 });
  }
  attack() {
    this.noise({ filter: 'bandpass', freq: 3000, to: 300, q: 1.2, gain: 0.34, a: 0.001, d: 0.5 });
    this.tone({ freq: 200, to: 30, type: 'sawtooth', gain: 0.3, a: 0.002, d: 1.6, filter: 'lowpass', cutoff: 600 });
    this.tone({ freq: 3400, to: 900, type: 'square', gain: 0.1, a: 0.001, d: 0.28 });
  }
  siren() {
    for (let k = 0; k < 4; k++) {
      this.tone({ freq: 620, to: 980, type: 'sawtooth', gain: 0.09, a: 0.15, d: 0.55, when: k * 1.1, filter: 'bandpass', cutoff: 1200, q: 2 });
      this.tone({ freq: 980, to: 620, type: 'sawtooth', gain: 0.09, a: 0.15, d: 0.55, when: k * 1.1 + 0.55, filter: 'bandpass', cutoff: 1200, q: 2 });
    }
  }
  flicker() { this.noise({ filter: 'bandpass', freq: 5200, q: 6, gain: 0.07, a: 0.001, d: 0.09 }); }
  clockTick() { this.noise({ filter: 'bandpass', freq: 3200, q: 8, gain: 0.03, a: 0.001, d: 0.03 }); }
  uiMove() { this.tone({ freq: 660, type: 'square', gain: 0.05, a: 0.002, d: 0.04, filter: 'lowpass', cutoff: 2200 }); }
  uiSelect() { this.tone({ freq: 880, type: 'square', gain: 0.07, a: 0.002, d: 0.07, filter: 'lowpass', cutoff: 2600 }); this.tone({ freq: 1320, type: 'square', gain: 0.05, a: 0.002, d: 0.09, when: 0.05 }); }
  uiBack() { this.tone({ freq: 320, type: 'square', gain: 0.06, a: 0.002, d: 0.09, filter: 'lowpass', cutoff: 1400 }); }
  error() { this.tone({ freq: 160, type: 'square', gain: 0.12, a: 0.002, d: 0.18, filter: 'lowpass', cutoff: 900 }); this.tone({ freq: 120, type: 'square', gain: 0.1, a: 0.002, d: 0.24, when: 0.12, filter: 'lowpass', cutoff: 700 }); }
  chimeGood() { [784, 988, 1319].forEach((f, i) => this.tone({ freq: f, type: 'sine', gain: 0.1, a: 0.005, d: 0.35, when: i * 0.08 })); }
  chimeBad() { [330, 262, 196].forEach((f, i) => this.tone({ freq: f, type: 'triangle', gain: 0.12, a: 0.005, d: 0.5, when: i * 0.13 })); }
  nightEnd() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: 'triangle', gain: 0.1, a: 0.01, d: 0.5, when: i * 0.16 })); }
  tvHiss(pan = 0) { this.noise({ filter: 'highpass', freq: 3200, gain: 0.03, a: 0.4, d: 0.1, s: 1, sT: 2.5, r: 0.6, pan }); }

  /** Distance/direction attenuation helper for world sounds. */
  spatial(px, pz, yaw, x, z, maxDist = 12) {
    const dx = x - px, dz = z - pz;
    const d = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - d / maxDist);
    // yaw 0 looks toward -Z; right vector is +X rotated by yaw
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pan = d < 0.001 ? 0 : Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
    return { gain: gain * gain, pan, dist: d };
  }
}
