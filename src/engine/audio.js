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
    this.master.connect(ctx.destination);

    /* The limiter sits on the effects path only.
       It used to sit across the whole mix, which meant every footstep
       transient ducked the fluorescent hum and the room tone with it. At a
       walk that is a wobble; at a sprint the steps land every four tenths
       of a second and the entire background pumps in and out of the mix,
       which is what "the audio skips while moving" was. The beds now run
       straight to the master and nothing gates them. */
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4;
    comp.attack.value = 0.006; comp.release.value = 0.14;
    if (comp.knee) comp.knee.value = 14;
    comp.connect(this.master);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(comp);
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
    if (!this.ready || this.muted || this._busy()) return;
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

  /** True if we are already running as many one-shots as the graph wants. */
  _busy() {
    const now = this.ctx.currentTime;
    if (now - (this._voiceWindow || 0) > 0.1) { this._voiceWindow = now; this._voices = 0; }
    if (this._voices >= 14) return true;
    this._voices = (this._voices || 0) + 1;
    return false;
  }

  noise(o = {}) {
    if (!this.ready || this.muted || this._busy()) return;
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

  /**
   * Ambience upkeep.
   *
   * Every one of these is a scheduled automation event, and pushing five of
   * them per frame at sixty frames a second gives the audio thread a queue
   * it has to walk on every render quantum. They are only sent when the
   * value has actually moved enough to hear.
   */
  update(dt) {
    if (!this.ready) return;
    // Keep the boombox's loop fed a beat or two ahead of the audio clock.
    if (this.boom) this._boomTick();
    this.tension += (this._tensionTarget - this.tension) * Math.min(1, dt * 1.2);
    const t = this.t;

    const dread = this.muted ? 0 : this.tension * this.tension * 0.16;
    if (!this._ducked && Math.abs(dread - (this._dreadSent || 0)) > 0.002) {
      this._dreadSent = dread;
      this.dreadGain.gain.setTargetAtTime(dread, t, 0.2);
    }
    const cut = 180 + this.tension * 700;
    if (Math.abs(cut - (this._cutSent || 0)) > 8) {
      this._cutSent = cut;
      this.dreadFilter.frequency.setTargetAtTime(cut, t, 0.4);
      for (let i = 0; i < this.dreadOscs.length; i++) {
        this.dreadOscs[i].detune.setTargetAtTime((i - 1) * (6 + this.tension * 34), t, 0.5);
      }
    }
    if (this._ducked) return;
    const hum = this.muted ? 0 : 0.035 * this.lightLevel();
    if (this.humGain && Math.abs(hum - (this._humSent || 0)) > 0.0006) {
      this._humSent = hum;
      this.humGain.gain.setTargetAtTime(hum, t, 0.1);
    }
  }

  /** Put the room back after duckRoom(), at the top of the next shift. */
  restoreRoom() {
    if (!this.ready || !this._ducked) return;
    this._ducked = false;
    this._humSent = this.muted ? 0 : 0.035;
    if (this.humGain) this.humGain.gain.setTargetAtTime(this._humSent, this.t, 0.3);
    if (this.roomGain) this.roomGain.gain.setTargetAtTime(this.muted ? 0 : 0.05, this.t, 0.3);
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
  /* ---------------- the rewinder ----------------
     A tabletop rewinder is not a hiss. It is a small DC motor with a belt,
     a reel of tape whipping through a guide, and a bearing that is not
     quite true -- so: a motor whine that climbs as the take-up reel fills
     and its diameter grows, a tape-rush band above it, a slow flutter from
     the off-centre reel, and a solenoid clack at each end.               */
  rewindStart() {
    if (!this.ready || this.rewindNode || this.muted) return;
    const ctx = this.ctx, t0 = this.t;

    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.9, t0 + 0.18);
    out.connect(this.sfxBus);

    // the motor: a squarish whine plus its own octave, through a lowpass
    const motor = ctx.createGain(); motor.gain.value = 0.055;
    const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 1400; mlp.Q.value = 1.2;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 112;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 224;
    const o2g = ctx.createGain(); o2g.gain.value = 0.35;
    o1.connect(mlp); o2.connect(o2g).connect(mlp);
    mlp.connect(motor).connect(out);

    // tape rushing over the guides: a narrow noise band that rides with it
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.6;
    const hiss = ctx.createGain(); hiss.gain.value = 0.075;
    src.connect(bp).connect(hiss).connect(out);

    // a reel that is fractionally off true, wobbling everything once a turn
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.4;
    const lfoG = ctx.createGain(); lfoG.gain.value = 7;
    lfo.connect(lfoG).connect(o1.frequency);
    const lfoH = ctx.createGain(); lfoH.gain.value = 150;
    lfo.connect(lfoH).connect(bp.frequency);

    o1.start(t0); o2.start(t0); src.start(t0); lfo.start(t0);
    // the clack of the mechanism engaging
    this.noise({ filter: 'bandpass', freq: 1500, q: 3, gain: 0.16, a: 0.001, d: 0.05 });
    this.tone({ freq: 130, type: 'square', gain: 0.12, a: 0.001, d: 0.09, filter: 'lowpass', cutoff: 700 });
    this.rewindNode = { src, o1, o2, lfo, out, bp, mlp, motor, hiss };
  }

  /**
   * @param p 0..1 through the rewind. The take-up reel is getting fatter,
   * so the same motor speed pulls more tape per turn: the whine rises, the
   * rush brightens, and the flutter slows down.
   */
  rewindPitch(p) {
    const n = this.rewindNode;
    if (!n) return;
    const t = this.t;
    n.o1.frequency.setTargetAtTime(104 + p * 78, t, 0.25);
    n.o2.frequency.setTargetAtTime((104 + p * 78) * 2, t, 0.25);
    n.bp.frequency.setTargetAtTime(1900 + p * 2100, t, 0.25);
    n.mlp.frequency.setTargetAtTime(1200 + p * 1500, t, 0.3);
    n.lfo.frequency.setTargetAtTime(5.6 - p * 2.4, t, 0.4);
    n.hiss.gain.setTargetAtTime(0.06 + p * 0.05, t, 0.3);
  }

  /** Pulled out mid-rewind: the motor just stops. */
  rewindStop() {
    const n = this.rewindNode;
    if (!n) return;
    const t = this.t;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(Math.max(0.0002, n.out.gain.value), t);
    n.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    for (const node of [n.o1, n.o2, n.lfo, n.src]) { try { node.stop(t + 0.3); } catch (e) { /* already stopped */ } }
    this.rewindNode = null;
    this.noise({ filter: 'bandpass', freq: 1100, q: 3, gain: 0.12, a: 0.001, d: 0.06 });
  }

  /** Ran to the end: the reel hits the leader and the machine kicks out. */
  rewindEnd() {
    this.rewindStop();
    this.noise({ filter: 'lowpass', freq: 900, gain: 0.2, a: 0.001, d: 0.12, when: 0.02 });
    this.tone({ freq: 96, type: 'square', gain: 0.16, a: 0.001, d: 0.16, when: 0.02, filter: 'lowpass', cutoff: 600 });
    this.noise({ filter: 'bandpass', freq: 2600, q: 2, gain: 0.1, a: 0.001, d: 0.07, when: 0.13 });
    this.tone({ freq: 1320, type: 'square', gain: 0.05, a: 0.002, d: 0.08, when: 0.3 });
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
  /**
   * The phone on the counter, ringing at you.
   *
   * Not the ringback you hear down a line you have dialled -- this is the
   * bell in the set itself. A 1996 desk phone still has a real gong in it:
   * two hammers, a shade out of tune with each other, struck about twenty
   * times a second for two seconds, with the whole thing sat in a plastic
   * box that takes the top off it.
   */
  phoneBell() {
    const T = 2.0, HZ = 19;
    for (let i = 0; i * (1 / HZ) < T; i++) {
      const when = i * (1 / HZ);
      const g = 0.055 * (i % 2 ? 0.85 : 1);
      this.tone({ freq: 1040, type: 'triangle', gain: g, a: 0.001, d: 0.055,
        filter: 'bandpass', cutoff: 1600, when });
      this.tone({ freq: 1355, type: 'triangle', gain: g * 0.7, a: 0.001, d: 0.045,
        filter: 'bandpass', cutoff: 2000, when });
      this.noise({ filter: 'bandpass', freq: 2600, q: 3, gain: g * 0.5,
        a: 0.001, d: 0.03, when });
    }
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
  /* ---------------- the death of you ----------------
     One `attack()` thump was a sound effect. This is a sequence: the room
     is yanked out from under the mix, a dry inhale of silence, and then
     everything at once -- a sub hit you feel more than hear, three
     detuned screams, and the tape itself starting to chew.               */

  /** Yank the ambience out. Nothing but the sequence from here on. */
  duckRoom(dur = 0.06) {
    if (!this.ready) return;
    this._ducked = true;
    this._humSent = 0; this._dreadSent = 0;
    if (this.humGain) this.humGain.gain.setTargetAtTime(0, this.t, dur);
    if (this.roomGain) this.roomGain.gain.setTargetAtTime(0, this.t, dur);
    if (this.dreadGain) this.dreadGain.gain.setTargetAtTime(0, this.t, dur);
    this._tensionTarget = 0; this.tension = 0;
  }

  /** The hit. Everything lands on the same frame on purpose. */
  jumpscare() {
    if (!this.ready || this.muted) return;
    // the floor dropping out
    this.tone({ freq: 92, to: 24, type: 'sine', gain: 0.85, a: 0.001, d: 1.5, slide: 1.2 });
    this.tone({ freq: 61, to: 18, type: 'square', gain: 0.4, a: 0.001, d: 1.1, filter: 'lowpass', cutoff: 220 });
    // three detuned shrieks a hair apart, which is what makes it a scream
    for (const [f, when, det] of [[1720, 0, 0], [1690, 0.012, -30], [2310, 0.026, 40]]) {
      this.tone({ freq: f, to: f * 0.42, type: 'sawtooth', gain: 0.30, a: 0.001, d: 0.85,
        filter: 'bandpass', cutoff: f, q: 2.5, detune: det, when });
    }
    // the transient: a slab of broadband noise with no attack at all
    this.noise({ filter: 'highpass', freq: 900, gain: 0.55, a: 0.0005, d: 0.5, rate: 1.4 });
    this.noise({ filter: 'bandpass', freq: 3400, to: 260, q: 0.7, gain: 0.34, a: 0.001, d: 0.9 });
  }

  /** Tape being eaten by the transport, under the whole death shot. */
  tapeChew(intensity = 1) {
    if (!this.ready || this.muted) return;
    this.noise({ filter: 'bandpass', freq: 220 + Math.random() * 900, q: 6,
      gain: 0.13 * intensity, a: 0.004, d: 0.16, rate: 0.5 + Math.random() * 1.6 });
    this.tone({ freq: 70 + Math.random() * 90, type: 'sawtooth', gain: 0.07 * intensity,
      a: 0.003, d: 0.2, filter: 'lowpass', cutoff: 400 });
  }

  /** The deck giving up: a solenoid clunk and the capstan winding down. */
  tapeStop() {
    if (!this.ready || this.muted) return;
    this.noise({ filter: 'lowpass', freq: 400, gain: 0.4, a: 0.001, d: 0.22 });
    this.tone({ freq: 150, to: 30, type: 'square', gain: 0.22, a: 0.001, d: 0.6,
      filter: 'lowpass', cutoff: 500 });
    this.tone({ freq: 44, type: 'sine', gain: 0.3, a: 0.002, d: 1.1, when: 0.05 });
  }

  /** A single wet impact, for the blows that land after the first. */
  impact(k = 1) {
    if (!this.ready || this.muted) return;
    this.noise({ filter: 'lowpass', freq: 260 + Math.random() * 200, gain: 0.34 * k, a: 0.001, d: 0.24 });
    this.tone({ freq: 58 + Math.random() * 24, to: 26, type: 'sine', gain: 0.35 * k, a: 0.001, d: 0.4 });
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
  /* ============================================================
     THE BOOMBOX

     A man brings his own music in, puts it on the floor and turns it up.
     It is a four bar loop at 96 to the minute -- kick, snare, hats, a bass
     line and a two-note stab -- scheduled a beat or two ahead off the audio
     clock rather than the frame clock, so it does not stutter when the
     renderer does.

     It runs on its own path into the master with a cheap-speaker lowpass
     across it. It deliberately does not go through the effects limiter:
     the whole point of the man is that he is too loud, and a limiter would
     politely turn him down every time somebody took a step.
     ============================================================ */
  boomboxStart() {
    this.init();
    if (!this.ready || this.boom) return;
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7;
    // a little box resonance, so it sounds like plastic on a carpet
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking'; peak.frequency.value = 180; peak.Q.value = 1.1; peak.gain.value = 5;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    lp.connect(peak).connect(out);
    if (pan) out.connect(pan).connect(this.master); else out.connect(this.master);
    this.boom = { out, lp, peak, pan, bus: lp, next: ctx.currentTime + 0.08, step: 0, vol: 0.34 };
  }

  boomboxStop() {
    const b = this.boom;
    if (!b) return;
    const t = this.ctx.currentTime;
    b.out.gain.cancelScheduledValues(t);
    b.out.gain.setValueAtTime(Math.max(0.0001, b.out.gain.value), t);
    b.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const dead = b;
    setTimeout(() => { try { dead.out.disconnect(); } catch (e) { /* already gone */ } }, 600);
    this.boom = null;
  }

  /** Where it is, relative to the listener. Called every frame by the game. */
  boomboxAt(gain, pan) {
    const b = this.boom;
    if (!b || this.muted) return;
    const t = this.ctx.currentTime;
    const want = Math.max(0.0001, gain * b.vol);
    b.out.gain.setTargetAtTime(want, t, 0.08);
    if (b.pan) b.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.08);
    // it gets duller and boomier the further off it is
    b.lp.frequency.setTargetAtTime(1100 + gain * 2200, t, 0.15);
  }

  /** Schedule whatever falls in the next fraction of a second. */
  _boomTick() {
    const b = this.boom;
    if (!b || this.muted) return;
    const ctx = this.ctx;
    const SPB = 60 / 96;                 // 96 beats to the minute
    const SIXTEENTH = SPB / 4;
    const AHEAD = 0.35;
    while (b.next < ctx.currentTime + AHEAD) {
      const t = b.next;
      const s = b.step % 64;             // four bars of sixteenths
      const beat = Math.floor(s / 4) % 4;
      const sub = s % 4;

      // kick: one, the and of two, and a pickup at the end of the bar
      if (sub === 0 && (beat === 0 || beat === 2)) this._boomKick(t);
      if (s % 16 === 10) this._boomKick(t, 0.7);
      if (s === 62) this._boomKick(t, 0.55);
      // snare on two and four
      if (sub === 0 && (beat === 1 || beat === 3)) this._boomSnare(t);
      // hats on every eighth, with an open one at the end of each bar
      if (s % 2 === 0) this._boomHat(t, s % 16 === 14 ? 0.16 : 0.055, s % 16 === 14);
      // bass: a five-note figure that moves every bar
      const BASS = [55, 55, 73.42, 55, 61.74, 55, 49, 55];
      if (s % 4 === 0) {
        const bar = Math.floor(s / 16);
        this._boomBass(t, BASS[(Math.floor(s / 4) + bar) % BASS.length], SPB * 0.9);
      }
      // a two-note stab off the beat, only in the second half of the loop
      if (s >= 32 && (s % 16 === 6 || s % 16 === 12)) {
        this._boomStab(t, s % 16 === 6 ? 293.66 : 349.23);
      }
      b.next += SIXTEENTH;
      b.step++;
    }
  }

  _boomKick(t, amp = 1) {
    const ctx = this.ctx, b = this.boom;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g).connect(b.bus); o.start(t); o.stop(t + 0.34);
  }

  _boomSnare(t) {
    const ctx = this.ctx, b = this.boom;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1750; f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(f).connect(g).connect(b.bus); n.start(t); n.stop(t + 0.22);
    // a bit of body under it
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.3, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    o.connect(g2).connect(b.bus); o.start(t); o.stop(t + 0.13);
  }

  _boomHat(t, amp, open) {
    const ctx = this.ctx, b = this.boom;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    n.playbackRate.value = 2.4;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200;
    const g = ctx.createGain();
    const len = open ? 0.20 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, amp), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f).connect(g).connect(b.bus); n.start(t); n.stop(t + len + 0.03);
  }

  _boomBass(t, freq, len) {
    const ctx = this.ctx, b = this.boom;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(110, t + len * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
    g.gain.setValueAtTime(0.42, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(b.bus); o.start(t); o.stop(t + len + 0.04);
  }

  _boomStab(t, freq) {
    const ctx = this.ctx, b = this.boom;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    for (const [mult, detune] of [[1, -7], [1, 7], [1.5, 4]]) {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = freq * mult; o.detune.value = detune;
      o.connect(g); o.start(t); o.stop(t + 0.30);
    }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    g.connect(f).connect(b.bus);
  }

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
