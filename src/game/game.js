/* ============================================================
   game.js -- the shift itself. Owns the render loop, the night
   state machine, and every callback the customers, the dialogue
   and the killer reach back into.
   ============================================================ */
import { Raster } from '../engine/raster.js';
import { PostFX } from '../engine/postfx.js';
import { Input } from '../engine/input.js';
import { Sound } from '../engine/audio.js';
import { buildTextures } from '../engine/texture.js';
import { mat, mul, setPosYaw, setRotX, setRotY, setTranslate, invertRigid, clamp } from '../engine/mathx.js';
import {
  buildWorld, collide, SHELVES, SPOTS, COUNTER, COUNTER_SLOTS, PROPS, lightAt, outdoorLightAt,
  DOOR_X0, DOOR_X1, D,
} from './world.js';
import { buildActorMeshes, drawActor, ACTOR_HEIGHT, makeAnim, updateAnim } from './actor.js';
import { createPlayer, updatePlayer, buildCamera, castInteract, canCarry, takeTape, topTape, heldTapeMatrix, forwardOf } from './player.js';
import { createCustomer, updateCustomer, CS, observeVisible, moodLabel } from './customer.js';
import { createKiller, updateKiller, KP, killerActive, killerInView, addIntel } from './killer.js';
import { makeNight, makeDecoyAppearance, sanitizeInnocent, clockString, gradeNight } from './night.js';
import { DialogueRunner, buildOfficerIntro, talkTo, buildPhoneCall } from './dialogue.js';
import { UI, howToHtml, optionsHtml, reportHtml, endingHtml } from './ui.js';
import { randomAppearance, paintSkin } from './appearance.js';
import { OFFICER } from './personality.js';
import { GENRE_LABEL } from './tapes.js';

const ST = {
  BOOT: 'BOOT', TITLE: 'TITLE', HOWTO: 'HOWTO', OPTIONS: 'OPTIONS',
  ESTABLISH: 'ESTABLISH', PLAY: 'PLAY', REPORT: 'REPORT', ENDING: 'ENDING', PAUSE: 'PAUSE',
};

const RES = [[256, 192, '256x192'], [320, 240, '320x240'], [400, 300, '400x300']];

export class Game {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.ui = new UI();
    this.input = new Input(this.canvas);
    this.sound = new Sound();
    this.state = ST.BOOT;
    this.opts = {
      sens: 0.5, invert: false, vol: 0.8, res: 1, snap: true, grain: 0.5,
    };
    this.menuSel = 0;
    this.optSel = 0;
    this.dlg = new DialogueRunner();
    this.phone = new DialogueRunner();
    this.notesOpen = false;
    this.fade = 1;
    this.fadeTo = 0;
    this.flash = 0;
    this.time = 0;
    this.timeScale = 1;          // debug/testing fast-forward
    this.nightNo = 1;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this._mats = { view: mat(), cam: mat(), m: mat(), tmp: mat() };
    this.frame = this.frame.bind(this);   // handed straight to requestAnimationFrame
    // safe defaults so the attract-mode camera can render before a shift starts
    this.customers = [];
    this.queue = [];
    this.counterSlots = [];
    this.bin = [];
    this.rewinder = { tape: null, t: 0, dur: 6.5, done: false, running: false };
    this.door = { locked: false, swing: 0, target: 0, holdOpen: 0 };
    this.officer = null;
    this.killer = null;
    this.lights = 1; this.flickerAmt = 0; this.flickerT = 4;
    this.distress = 0; this.tension = 0;
    this.staticFrame = 0; this.staticT = 0;
    this.till = 0;
    this._lastTyped = -1;
  }

  /* ============================================================
     BOOT
     ============================================================ */
  async boot() {
    const [rw, rh] = RES[this.opts.res];
    this.raster = new Raster(rw, rh);
    this.post = new PostFX(this.canvas, rw, rh);
    this.T = buildTextures();
    this.world = buildWorld(this.T);
    this.actorMeshes = buildActorMeshes();
    this.solids = this.world.solids;

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === ST.PLAY && !this.dlg.active && !this.phone.active) this.pause();
    };
    addEventListener('resize', () => this.layout());
    this.layout();

    this.state = ST.TITLE;
    this.ui.showTitle(true);
    this.ui.setHudVisible(false);
    this.ui.titleSelect(0);
    this.fadeTo = 0;

    // idle camera drifting through the empty store behind the title
    this.player = createPlayer();
    this.player.x = 6.4; this.player.z = 6.2; this.player.yaw = 0.4;
    this.titleT = 0;

    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  layout() {
    const [rw, rh] = RES[this.opts.res];
    if (this.raster.w !== rw) { this.raster.resize(rw, rh); this.post.resize(rw, rh); }
  }

  /* ============================================================
     NIGHT SETUP
     ============================================================ */
  startNight(n) {
    this.nightNo = n;
    this.night = makeNight(this.seed, n);
    this.rng = this.night.rng;
    this.elapsed = 0;
    this.player = createPlayer();
    this.player.frozen = true;

    this.customers = [];
    this.queue = [];
    this.counterSlots = COUNTER_SLOTS.map(() => null);
    this.bin = [];
    this.rewinder = { tape: null, t: 0, dur: 6.5, done: false, running: false };
    this.till = 0;
    this.owedTotal = 0;
    this.stats = {
      served: 0, rentalsRung: 0, feesCollected: 0, feesWaived: 0,
      shelvedRight: 0, shelvedWrong: 0, shelvedUnrewound: 0, unshelved: 0,
      angered: 0, stormedOut: 0, turnedAway: 0,
    };

    this.door = { locked: false, swing: 0, target: 0, holdOpen: 0 };
    this.lights = 1; this.flickerT = 0; this.flickerAmt = 0;
    this.distress = 0; this.tension = 0;
    this.speaking = null;
    this.blipT = 0;
    this.staticFrame = 0; this.staticT = 0;

    // the deputy
    const oapp = this.night.officerApp;
    this.officer = {
      id: -1, name: this.night.officerName, app: oapp, personality: OFFICER,
      skin: paintSkin(oapp), x: SPOTS.street.x, y: 0, z: SPOTS.street.z - 0.9, yaw: 0, r: 0.30,
      anim: makeAnim(), speed: 1.45, moveSpeed: 0, state: 'ARRIVE', observed: new Set(),
      mood: 100, phoneLabel: 'The deputy', isKiller: false, timer: 0,
    };
    this.officerDone = false;
    this.briefingStarted = false;

    // the suspect
    this.killer = createKiller(this.rng, this.night.suspect, this.night.plan, this.night.length);
    this.killerSpottedOnce = false;
    this.suspectSeen = false;

    // opening shot from the sidewalk
    this.state = ST.ESTABLISH;
    this.estT = 0;
    this.ui.showTitle(false);
    this.ui.hidePanel();
    this.ui.setHudVisible(false);
    this.ui.cinema(true);
    this.ui.setObjective('');
    this.fadeTo = 0;
    this.sound.setTension(0);
    this.sound.setLights(1);
  }

  beginPlay() {
    this.state = ST.PLAY;
    this.player.frozen = false;
    this.ui.setHudVisible(true);
    this.ui.cinema(false);
    this.input.requestLock();
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    dt *= this.timeScale;
    this.time += dt;

    this.fade += (this.fadeTo - this.fade) * Math.min(1, dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 3.4);

    switch (this.state) {
      case ST.TITLE: this.updateTitle(dt); break;
      case ST.HOWTO: case ST.OPTIONS: this.updatePanelMenu(dt); break;
      case ST.ESTABLISH: this.updateEstablish(dt); break;
      case ST.PLAY: this.updatePlay(dt); break;
      case ST.PAUSE: this.updatePause(dt); break;
      case ST.REPORT: this.updateReport(dt); break;
      case ST.ENDING: this.updateEnding(dt); break;
      default: break;
    }

    this.sound.update(dt);
    const typed = this.ui.update(dt);
    if (typed >= 0) {
      if (Math.floor(typed / 3) > Math.floor(this._lastTyped / 3)) {
        const node = this.phone.active ? this.phone.node : this.dlg.node;
        const v = node && !node.asPlayer && node.person && node.person.app
          ? node.person.app.voice : { pitch: 1.05, rough: 0.5 };
        this.sound.blip(v.pitch, v.rough);
      }
      this._lastTyped = typed;
    } else this._lastTyped = -1;
    this.render(dt);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  }

  /* ---------------- title ---------------- */
  updateTitle(dt) {
    this.titleT += dt;
    const p = this.player;
    p.yaw = 0.35 + Math.sin(this.titleT * 0.09) * 0.55;
    p.x = 6.4 + Math.sin(this.titleT * 0.06) * 1.6;
    p.z = 6.2 + Math.cos(this.titleT * 0.05) * 0.9;
    p.pitch = -0.04 + Math.sin(this.titleT * 0.11) * 0.03;
    this.staticT += dt;

    const i = this.input;
    let n = 3;
    if (i.hit('ArrowUp', 'KeyW')) { this.menuSel = (this.menuSel + n - 1) % n; this.sound.init(); this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.menuSel = (this.menuSel + 1) % n; this.sound.init(); this.sound.uiMove(); }
    this.ui.titleSelect(this.menuSel);
    if (i.hit('Enter', 'KeyE', 'Space') || i.mousePressed[0]) {
      this.sound.init(); this.sound.resume(); this.sound.uiSelect();
      if (this.menuSel === 0) { this.nightNo = 1; this.seed = (Math.random() * 0xffffffff) >>> 0; this.startNight(1); }
      else if (this.menuSel === 1) { this.state = ST.HOWTO; this.ui.showPanel(howToHtml()); }
      else { this.state = ST.OPTIONS; this.optSel = 0; this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(0); }
    }
  }

  optView() {
    return {
      sens: this.opts.sens, invert: this.opts.invert, vol: this.opts.vol,
      resLabel: RES[this.opts.res][2], snap: this.opts.snap, grain: this.opts.grain,
    };
  }

  updatePanelMenu() {
    const i = this.input;
    if (this.state === ST.HOWTO) {
      if (i.hit('Enter', 'KeyE', 'Escape', 'Space') || i.mousePressed[0]) {
        this.sound.uiBack(); this.ui.hidePanel(); this.state = ST.TITLE;
      }
      return;
    }
    const N = 7;
    if (i.hit('ArrowUp', 'KeyW')) { this.optSel = (this.optSel + N - 1) % N; this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.optSel = (this.optSel + 1) % N; this.sound.uiMove(); }
    const d = (i.hit('ArrowRight', 'KeyD') ? 1 : 0) - (i.hit('ArrowLeft', 'KeyA') ? 1 : 0);
    if (d) {
      this.sound.uiMove();
      switch (this.optSel) {
        case 0: this.opts.sens = clamp(this.opts.sens + d * 0.1, 0.1, 1.0); break;
        case 1: this.opts.invert = !this.opts.invert; break;
        case 2: this.opts.vol = clamp(this.opts.vol + d * 0.1, 0, 1); break;
        case 3: this.opts.res = clamp(this.opts.res + d, 0, RES.length - 1); this.layout(); break;
        case 4: this.opts.snap = !this.opts.snap; break;
        case 5: this.opts.grain = clamp(this.opts.grain + d * 0.1, 0, 1); break;
        default: break;
      }
      this.applyOptions();
      this.ui.showPanel(optionsHtml(this.optView()));
    }
    this.ui.panelSelect(this.optSel);
    if (i.hit('Enter', 'KeyE', 'Escape') || i.mousePressed[0]) {
      if (this.optSel === 6 || i.hit('Escape')) {
        this.sound.uiBack();
        if (this._fromPause) { this._fromPause = false; this.pause(); }
        else { this.ui.hidePanel(); this.state = ST.TITLE; }
      } else if (this.optSel === 1 || this.optSel === 4) {
        if (this.optSel === 1) this.opts.invert = !this.opts.invert; else this.opts.snap = !this.opts.snap;
        this.applyOptions(); this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(this.optSel);
      }
    }
  }

  applyOptions() {
    this.input.sensitivity = 0.0009 + this.opts.sens * 0.0032;
    this.input.invertY = this.opts.invert;
    this.sound.masterVol = this.opts.vol;
    if (this.sound.master) this.sound.master.gain.value = this.opts.vol;
    this.raster.snap = this.opts.snap ? 1 : 0;
  }

  /* ---------------- establishing shot ---------------- */
  updateEstablish(dt) {
    this.estT += dt;
    const t = this.estT;
    const p = this.player;
    p.x = 6.0 + Math.sin(t * 0.25) * 1.2;
    p.z = -6.4 + t * 0.30;
    p.eye = 1.68;
    p.yaw = Math.atan2(6.2 - p.x, 0.4 - p.z);
    p.pitch = 0.06;
    this.staticT += dt;
    this.door.swing += (0 - this.door.swing) * Math.min(1, dt * 4);

    if (t > 0.4 && !this._estSound) { this._estSound = true; this.sound.tvHiss(0); }
    if (t > 4.6 || this.input.hit('KeyE', 'Enter', 'Space')) {
      this._estSound = false;
      const s = SPOTS.playerStart;
      this.player = createPlayer();
      this.player.x = s.x; this.player.z = s.z; this.player.yaw = s.yaw;
      this.player.pitch = s.pitch || 0;
      this.beginPlay();
      this.ui.toast(`NIGHT ${this.nightNo} - SUNSET VIDEO`, '');
      this.ui.toast(`Shift ends at midnight.`, '');
    }
  }

  /* ============================================================
     PLAY
     ============================================================ */
  updatePlay(dt) {
    const i = this.input;

    // ---- pause / notepad ----
    if (i.hit('Escape')) {
      if (this.phone.active) { this.hangUp(); return; }
      if (this.dlg.active) { this.dlg.cancel(); return; }
      this.pause(); return;
    }
    if (i.hit('Tab')) {
      this.notesOpen = !this.notesOpen;
      this.sound.paper();
      if (!this.notesOpen) this.ui.hideNotes();
    }

    const talking = this.dlg.active || this.phone.active;
    this.player.frozen = talking;

    // ---- conversation input ----
    if (talking) this.updateConversation();

    // ---- world clock ----
    const holdClock = killerActive(this.killer);
    if (!holdClock) this.elapsed += dt;

    // ---- systems ----
    this.updateDoor(dt);
    updatePlayer(this.player, dt, i, this.ctx);
    this.updateRewinder(dt);
    this.updateOfficer(dt);
    this.spawnDue();
    for (const c of this.customers) if (!c.hidden) updateCustomer(c, dt, this.ctx);
    this.customers = this.customers.filter((c) => c.state !== CS.GONE);
    updateKiller(this.killer, dt, this.ctx);
    this.checkKillerProximity();
    this.updateObservation(dt);
    this.updateAtmosphere(dt);

    // ---- interaction ----
    if (!talking) this.updateInteraction();
    else this.ui.setPrompt('');

    // ---- HUD ----
    this.ui.setClock(clockString(this.elapsed, this.night.length), this.nightNo);
    this.ui.setTill(this.till);
    this.ui.setHands(this.player.held, this.rewinder);
    if (this.notesOpen) this.ui.showNotes(this.night.bulletin, this.player.lookTarget);

    // ---- night end ----
    if (this.elapsed >= this.night.length && !holdClock && !talking) this.endNight();
  }

  pause() {
    this.state = ST.PAUSE;
    this.input.exitLock();
    this.ui.setPrompt('');
    this.ui.hideNotes(); this.notesOpen = false;
    this.ui.showPanel(`<h2>SHIFT PAUSED</h2>
      <ul><li class="opt sel">Back to the counter</li><li class="opt">Options</li><li class="opt">Quit to title</li></ul>
      <p class="pad-foot">[E] select</p>`);
    this.pauseSel = 0;
    this.ui.panelSelect(0);
  }

  updatePause() {
    const i = this.input;
    const N = 3;
    if (i.hit('ArrowUp', 'KeyW')) { this.pauseSel = (this.pauseSel + N - 1) % N; this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.pauseSel = (this.pauseSel + 1) % N; this.sound.uiMove(); }
    this.ui.panelSelect(this.pauseSel);
    if (i.hit('Escape')) { this.ui.hidePanel(); this.state = ST.PLAY; this.input.requestLock(); return; }
    if (i.hit('Enter', 'KeyE', 'Space') || i.mousePressed[0]) {
      this.sound.uiSelect();
      if (this.pauseSel === 0) { this.ui.hidePanel(); this.state = ST.PLAY; this.input.requestLock(); }
      else if (this.pauseSel === 1) { this.state = ST.OPTIONS; this.optSel = 0; this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(0); this._fromPause = true; }
      else { this.ui.hidePanel(); this.ui.hideDialogue(); this.ui.hideNotes(); this.ui.setHudVisible(false); this.ui.showTitle(true); this.state = ST.TITLE; this.menuSel = 0; }
    }
  }

  /* ---------------- doors ---------------- */
  updateDoor(dt) {
    this.door.holdOpen = Math.max(0, this.door.holdOpen - dt);
    this.door.target = this.door.holdOpen > 0 ? 1.25 : 0;
    const k = this.door.target > this.door.swing ? 7 : 3.2;
    this.door.swing += (this.door.target - this.door.swing) * Math.min(1, dt * k);
  }

  /* ---------------- rewinder ---------------- */
  updateRewinder(dt) {
    const r = this.rewinder;
    if (r.tape && r.running) {
      r.t += dt;
      this.sound.rewindPitch(Math.min(1, r.t / r.dur));
      if (r.t >= r.dur) {
        r.running = false; r.done = true; r.tape.rewound = true;
        this.sound.rewindStop();
        this.ui.toast(`${r.tape.title} rewound`, 'good');
      }
    }
  }

  /* ---------------- the deputy ---------------- */
  updateOfficer(dt) {
    const o = this.officer;
    if (!o || o.state === 'DONE') return;

    if (o.state === 'ARRIVE') {
      o.timer += dt;
      if (o.timer < 1.4) { o.moveSpeed = 0; updateAnim(o.anim, dt, 0, o.app, {}); return; }
      if (!o.path) o.path = [SPOTS.outsideDoor, { x: SPOTS.door.x, z: 0.85 }, SPOTS.officerStand];
      if (this.followPath(o, dt)) {
        o.state = 'BRIEF';
      } else if (o.z > -0.6 && !o.entered) { o.entered = true; this.openDoorFor(); }
    } else if (o.state === 'BRIEF') {
      o.moveSpeed = 0;
      o.yaw += (SPOTS.officerStand.yaw - o.yaw) * Math.min(1, dt * 4);
      if (!this.briefingStarted) {
        this.briefingStarted = true;
        this.beginDialogue(o, buildOfficerIntro(o, this.night.bulletin, this.ctx));
      }
    } else if (o.state === 'LEAVE') {
      if (!o.path) o.path = [{ x: SPOTS.door.x, z: 0.85 }, SPOTS.outsideDoor, { x: SPOTS.street.x - 2.2, z: SPOTS.street.z - 1.4 }];
      if (this.followPath(o, dt)) { o.state = 'DONE'; }
      else if (o.z < 1.0 && !o.exited) { o.exited = true; this.openDoorFor(); }
    }
    updateAnim(o.anim, dt, o.moveSpeed, o.app, { talking: this.speaking === o });
  }

  /** Walk an NPC along a fixed list of points. Returns true when it runs out. */
  followPath(o, dt) {
    if (!o.path || !o.path.length) return true;
    o.pathI = o.pathI || 0;
    if (o.pathI >= o.path.length) { o.path = null; o.pathI = 0; return true; }
    const wp = o.path[o.pathI];
    const dx = wp.x - o.x, dz = wp.z - o.z, d = Math.hypot(dx, dz);
    const last = o.pathI === o.path.length - 1;
    if (d < (last ? 0.2 : 0.34)) { o.pathI++; return false; }
    const nx = o.x + (dx / d) * o.speed * dt, nz = o.z + (dz / d) * o.speed * dt;
    const [px, pz] = collide(nx, nz, o.r, this.solids, true);
    o.moveSpeed = Math.hypot(px - o.x, pz - o.z) / Math.max(dt, 0.0001);
    o.x = px; o.z = pz;
    o.yaw += (Math.atan2(dx, dz) - o.yaw) * Math.min(1, dt * 6);
    o._st = (o._st || 0) - dt * Math.max(0.2, o.moveSpeed);
    if (o._st <= 0) { o._st = 0.55; this.ctx.footstep(o); }
    return false;
  }

  /* ---------------- spawning ---------------- */
  spawnDue() {
    // nobody jumps the deputy in the queue
    if (!this.officerDone && this.elapsed < 55) return;
    for (const s of this.night.schedule) {
      if (s.spawned || this.elapsed < s.t) continue;
      s.spawned = true;
      if (this.customers.length > 5) { s.t = this.elapsed + 12; s.spawned = false; continue; }
      const rng = this.rng;
      let app;
      if (s.decoy) app = makeDecoyAppearance(rng, this.night.suspect, this.night.bulletin.keys, s.forced);
      else app = sanitizeInnocent(rng, randomAppearance(rng), this.night.suspect, this.night.bulletin.keys);
      const c = createCustomer(rng, { app, intent: s.intent, wantGenre: s.genre });
      this.customers.push(c);
    }
  }

  /* ---------------- observation ---------------- */
  updateObservation(dt) {
    const p = this.player;
    const people = this.people();
    const [fx, fy, fz] = forwardOf(p);
    let best = null, bestDot = 0.955;
    for (const c of people) {
      if (c.hidden) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      const dy = (ACTOR_HEIGHT * c.app.height.scale * 0.72) - p.eye;
      const d = Math.hypot(dx, dy, dz);
      if (d > 11) continue;
      const dot = (dx * fx + dy * fy + dz * fz) / (d || 1);
      if (dot > bestDot) { bestDot = dot; best = c; }
    }
    if (best) {
      best._look = (best._look || 0) + dt;
      if (best._look > 0.55) observeVisible(best);
      p.lookTarget = best;
      p.lookTargetT = 0;
    } else if (p.lookTarget) {
      p.lookTargetT = (p.lookTargetT || 0) + dt;
      if (p.lookTargetT > 6) p.lookTarget = null;
    }
  }

  /**
   * Two things the killer state machine can't see: the player wandering out
   * onto his pavement, and the player actually laying eyes on him.
   */
  checkKillerProximity() {
    const k = this.killer;
    if (!k || k.ent.hidden) return;
    const p = this.player;
    const outsidePhases = k.phase === KP.STALK || k.phase === KP.APPROACH || k.phase === KP.TRY_DOOR;
    if (outsidePhases && p.z < 0.15) {
      const d = Math.hypot(k.ent.x - p.x, k.ent.z - p.z);
      if (d < 2.0) { k.phase = KP.HUNT; this.ui.setObjective('', false); return; }
      if (!this._outsideWarned) {
        this._outsideWarned = true;
        this.ui.toast('You are outside. He is out here with you.', 'bad');
      }
    }
    if (outsidePhases && !k.spotted && killerInView(k, p, 1.18, this.raster.w / this.raster.h)) {
      const d = Math.hypot(k.ent.x - p.x, k.ent.z - p.z);
      if (d < 13) {
        k.spotted = true;
        this.sound.stinger(0.45);
        this.ui.setObjective(this.door.locked
          ? 'HE IS OUTSIDE. THE DOOR IS LOCKED.\nGET TO THE PHONE.'
          : 'THERE IS SOMEONE OUTSIDE.\nLOCK THE DOOR.', true);
      }
    }
  }

  /* ---------------- atmosphere ---------------- */
  updateAtmosphere(dt) {
    const k = this.killer;
    let tension = 0;
    if (k) {
      if (k.phase === KP.CUSTOMER) tension = 0.24;
      else if (k.phase === KP.STALK) tension = 0.55;
      else if (k.phase === KP.APPROACH) tension = 0.72;
      else if (k.phase === KP.TRY_DOOR) tension = this.door.locked ? 0.82 : 0.9;
      else if (k.phase === KP.BREACH || k.phase === KP.HUNT) tension = 1;
    }
    // the store itself gets quieter and darker as the night runs down
    tension = Math.max(tension, Math.min(0.22, this.elapsed / this.night.length * 0.22));
    this.tension += (tension - this.tension) * Math.min(1, dt * 0.8);
    this.sound.setTension(this.tension);

    this.distress += ((this.tension > 0.5 ? (this.tension - 0.5) * 1.6 : 0) * this.opts.grain * 2 - this.distress) * Math.min(1, dt * 1.5);

    // flicker
    this.flickerT -= dt;
    if (this.flickerT <= 0) {
      const base = this.tension > 0.5 ? 1.6 : 9;
      this.flickerT = base + Math.random() * base * 1.4;
      this.flickerAmt = 0.10 + Math.random() * (this.tension > 0.5 ? 0.75 : 0.22);
      this.sound.flicker();
    }
    this.flickerAmt = Math.max(0, this.flickerAmt - dt * 2.6);
    const target = 1 - this.flickerAmt * (0.4 + Math.random() * 0.6);
    this.lights += (target - this.lights) * Math.min(1, dt * 22);
    this.sound.setLights(this.lights);

    // heartbeat when he is close and inside
    if (k && (k.phase === KP.HUNT || k.phase === KP.BREACH)) {
      this._hb = (this._hb || 0) - dt;
      if (this._hb <= 0) { this._hb = Math.max(0.42, 1.05 - k.proximity * 0.6); this.sound.heartbeat(); }
    }

    // fog closes in with the dread
    this.raster.fogNear = 4.2 - this.tension * 1.6;
    this.raster.fogFar = 17 - this.tension * 5.5;

    this.staticT += dt;
    if (this.staticT > 0.09) { this.staticT = 0; this.staticFrame = (this.staticFrame + 1) % this.T.staticFrames.length; }
  }

  /* ============================================================
     INTERACTION
     ============================================================ */
  buildTargets() {
    const t = [];
    for (const s of SHELVES) {
      t.push({ kind: 'shelf', genre: s.genre, aabb: { x0: s.x0 - 0.12, x1: s.x1 + 0.12, y0: 0.2, y1: s.top, z0: s.z0 - 0.12, z1: s.z1 + 0.12 } });
    }
    COUNTER_SLOTS.forEach((s, i) => {
      t.push({ kind: 'slot', i, aabb: { x0: s.x - 0.13, x1: s.x + 0.13, y0: s.y - 0.02, y1: s.y + 0.16, z0: s.z - 0.14, z1: s.z + 0.14 } });
    });
    t.push({ kind: 'bin', aabb: box(PROPS.bin) });
    t.push({ kind: 'rewinder', aabb: box(PROPS.rewinder) });
    t.push({ kind: 'register', aabb: box(PROPS.register) });
    t.push({ kind: 'phone', aabb: box(PROPS.phone) });
    t.push({ kind: 'door', aabb: { x0: DOOR_X0 - 0.2, x1: DOOR_X1 + 0.2, y0: 0.2, y1: 2.1, z0: -0.35, z1: 0.35 } });
    for (const c of this.people()) {
      if (c.hidden) continue;
      const h = ACTOR_HEIGHT * c.app.height.scale;
      t.push({ kind: 'person', c, cyl: { x: c.x, z: c.z, r: 0.42, y0: 0.1, y1: h } });
    }
    return t;
  }

  people() {
    const out = this.customers.slice();
    if (this.officer && this.officer.state !== 'DONE') out.push(this.officer);
    if (this.killer && !this.killer.ent.hidden) out.push(this.killer.ent);
    return out;
  }

  updateInteraction() {
    const tgt = castInteract(this.player, this.buildTargets());
    this.hover = tgt;
    this.ui.setReticle(!!tgt);
    if (!tgt) { this.ui.setPrompt(''); return; }
    const held = topTape(this.player);
    const K = (s) => `<span class="key">${s}</span>`;
    let prompt = '';
    let act = null;

    switch (tgt.kind) {
      case 'shelf': {
        if (held) {
          const ok = held.genre === tgt.genre;
          prompt = `${K('E')}Shelve ${held.title}\n<span class="sub">${GENRE_LABEL[tgt.genre]} run ${ok ? '- correct section' : "- this is not its section"}${held.rewound ? '' : ' - NOT REWOUND'}</span>`;
          act = () => this.shelve(held, tgt.genre);
        } else {
          prompt = `<span class="sub">${GENRE_LABEL[tgt.genre]}</span>`;
        }
        break;
      }
      case 'slot': {
        const cur = this.counterSlots[tgt.i];
        if (cur) { prompt = `${K('E')}Pick up ${cur.title}\n<span class="sub">${GENRE_LABEL[cur.genre]} / ${cur.rewound ? 'rewound' : 'NOT rewound'}</span>`; act = () => this.pickSlot(tgt.i); }
        else if (held) { prompt = `${K('E')}Set down ${held.title}`; act = () => this.putSlot(tgt.i); }
        break;
      }
      case 'bin': {
        if (held) { prompt = `${K('E')}Drop ${held.title} in returns`; act = () => this.binFromHand(); }
        else if (this.bin.length) { prompt = `${K('E')}Take from returns\n<span class="sub">${this.bin.length} waiting</span>`; act = () => this.takeFromBin(); }
        else prompt = `<span class="sub">RETURNS - empty</span>`;
        break;
      }
      case 'rewinder': {
        const r = this.rewinder;
        if (!r.tape && held) { prompt = held.rewound ? `${K('E')}Load ${held.title}\n<span class="sub">already rewound</span>` : `${K('E')}Load ${held.title}`; act = () => this.loadRewinder(); }
        else if (r.tape && r.running) prompt = `<span class="sub">REWINDING ${r.tape.title}...</span>`;
        else if (r.tape) { prompt = `${K('E')}Take ${r.tape.title}`; act = () => this.unloadRewinder(); }
        else prompt = `<span class="sub">REWINDER - empty</span>`;
        break;
      }
      case 'register': {
        prompt = `${K('E')}Count the drawer\n<span class="sub">$${this.till.toFixed(2)} tonight${this.owedTotal ? ` / $${this.owedTotal.toFixed(2)} on accounts` : ''}</span>`;
        act = () => { this.sound.cashDrawer(); this.ui.toast(`Drawer: $${this.till.toFixed(2)}`, ''); };
        break;
      }
      case 'phone': {
        prompt = `${K('E')}Pick up the phone`;
        act = () => this.pickUpPhone();
        break;
      }
      case 'door': {
        prompt = this.door.locked ? `${K('E')}Unlock the front door` : `${K('E')}Lock the front door`;
        act = () => this.toggleLock();
        break;
      }
      case 'person': {
        const c = tgt.c;
        const m = c === this.officer ? null : moodLabel(c);
        prompt = `${K('E')}Talk to ${c.name}${m ? `\n<span class="sub">${m.text}</span>` : ''}`;
        act = () => this.talkToPerson(c);
        break;
      }
      default: break;
    }
    if (held && tgt.kind !== 'shelf') prompt += `\n<span class="sub">${K('G')}put it down</span>`;
    this.ui.setPrompt(prompt);
    if (act && (this.input.hit('KeyE') || this.input.mousePressed[0])) act();
    if (this.input.hit('KeyG') && held) this.dropHeld();
  }

  /* ---------------- tape handling ---------------- */
  shelve(tape, genre) {
    this.player.held.pop();
    const right = tape.genre === genre;
    if (right && tape.rewound) {
      this.stats.shelvedRight++;
      this.sound.shelve(true);
      this.ui.toast(`Shelved: ${tape.title}`, 'good');
    } else if (!right) {
      this.stats.shelvedWrong++;
      this.sound.shelve(false);
      this.ui.toast(`${tape.title} is ${GENRE_LABEL[tape.genre]}, not ${GENRE_LABEL[genre]}`, 'bad');
    } else {
      this.stats.shelvedUnrewound++;
      this.sound.shelve(false);
      this.ui.toast(`Shelved without rewinding: ${tape.title}`, 'bad');
    }
  }
  pickSlot(i) {
    if (!canCarry(this.player)) { this.sound.error(); this.ui.toast('Hands full', 'bad'); return; }
    takeTape(this.player, this.counterSlots[i]);
    this.counterSlots[i] = null;
    this.sound.pickup();
  }
  putSlot(i) {
    const t = this.player.held.pop();
    this.counterSlots[i] = t;
    this.sound.drop();
  }
  binFromHand() { const t = this.player.held.pop(); this.bin.push(t); this.sound.drop(); }
  takeFromBin() {
    if (!canCarry(this.player)) { this.sound.error(); this.ui.toast('Hands full', 'bad'); return; }
    takeTape(this.player, this.bin.pop());
    this.sound.pickup();
  }
  loadRewinder() {
    const t = this.player.held.pop();
    this.rewinder.tape = t; this.rewinder.t = 0; this.rewinder.done = false;
    if (t.rewound) { this.rewinder.done = true; this.rewinder.running = false; this.sound.registerBeep(); }
    else { this.rewinder.running = true; this.sound.rewindStart(); }
  }
  unloadRewinder() {
    if (!canCarry(this.player)) { this.sound.error(); this.ui.toast('Hands full', 'bad'); return; }
    if (this.rewinder.running) { this.rewinder.running = false; this.sound.rewindStop(); }
    takeTape(this.player, this.rewinder.tape);
    this.rewinder.tape = null; this.rewinder.t = 0; this.rewinder.done = false;
    this.sound.pickup();
  }
  dropHeld() {
    const t = this.player.held.pop();
    if (!t) return;
    const free = this.counterSlots.findIndex((s) => !s);
    const nearCounter = this.player.x > COUNTER.x0 - 1.5 && this.player.z < 3.4;
    if (free >= 0 && nearCounter) this.counterSlots[free] = t;
    else this.bin.push(t);
    this.sound.drop();
  }

  toggleLock() {
    this.door.locked = !this.door.locked;
    this.sound.lockClick(this.door.locked);
    this.ui.toast(this.door.locked ? 'FRONT DOOR LOCKED' : 'Front door unlocked', this.door.locked ? 'good' : '');
    if (this.door.locked && killerActive(this.killer)) {
      this.ui.setObjective('DOOR IS LOCKED. GET TO THE PHONE.', true);
    } else if (!this.door.locked && killerActive(this.killer)) {
      this.ui.setObjective('HE IS OUTSIDE.', true);
    }
  }

  /* ---------------- conversation ---------------- */
  beginDialogue(person, node) {
    this.speaking = person;
    this.dlg.start(person, node, (p) => this.endDialogue(p));
    this.ui.showDialogue(node, 0, this.ctx);
    this.input.exitLock();
    if (person.observed) person.observed.add('voice');
  }
  endDialogue(p) {
    this.speaking = null;
    this.ui.hideDialogue();
    if (p && p.state === CS.TALKING) {
      p.state = p.leaving ? CS.LEAVING : (p._prevState || CS.WAITING);
      p.served = p.served || p.gaveTape || p.checkedOut;
    }
    if (this.state === ST.PLAY) this.input.requestLock();
  }
  talkToPerson(c) {
    if (c === this.officer) {
      this.ui.toast(this.briefingStarted ? `"I've told you what I know."` : `"Hold on, son."`, '');
      return;
    }
    if (c.isKiller && this.killer.phase !== KP.CUSTOMER) { this.sound.error(); return; }
    c._prevState = c.state;
    c.state = CS.TALKING;
    this.beginDialogue(c, talkTo(c, this.ctx));
  }

  updateConversation() {
    const i = this.input;
    const run = this.phone.active ? this.phone : this.dlg;
    const node = run.node;
    if (!node) return;

    if (this.ui.typing) {
      if (i.hit('KeyE', 'Enter', 'Space') || i.mousePressed[0]) this.ui.finishTyping();
    } else {
      const n = node.choices ? node.choices.length : 0;
      if (n) {
        if (i.hit('ArrowUp', 'KeyW')) { run.move(-1); this.sound.uiMove(); }
        if (i.hit('ArrowDown', 'KeyS')) { run.move(1); this.sound.uiMove(); }
        for (let k = 0; k < Math.min(n, 4); k++) {
          if (i.hit(`Digit${k + 1}`)) { run.sel = k; this.sound.uiSelect(); this.advance(run); return; }
        }
      }
      if (i.hit('KeyE', 'Enter', 'Space') || i.mousePressed[0]) { this.sound.uiSelect(); this.advance(run); return; }
    }
    if (this.phone.active) this.ui.showPhone(run.node, run.sel);
    else this.ui.showDialogue(run.node, run.sel, this.ctx);
  }

  advance(run) {
    const isPhone = run === this.phone;
    const alive = run.pick();
    if (!alive) { if (isPhone) this.hangUp(); return; }
    if (isPhone) this.ui.showPhone(run.node, run.sel);
    else this.ui.showDialogue(run.node, run.sel, this.ctx);
  }

  /* ---------------- phone ---------------- */
  pickUpPhone() {
    this.sound.phonePickup();
    const node = buildPhoneCall(this.ctx);
    this.phone.start({ name: 'DISPATCH' }, node, () => { });
    this.player.frozen = true;
    this.ui.showPhone(node, 0);
    this.input.exitLock();
  }
  hangUp() {
    this.phone.node = null;
    this.ui.hidePhone();
    this.player.frozen = false;
    this.sound.phoneHang();
    if (this.state === ST.PLAY) this.input.requestLock();
  }

  accuse(target) {
    this.ui.hidePhone();
    this.phone.node = null;
    this.sound.ringback();
    const isKiller = target.isKiller === true;
    setTimeout(() => {
      if (isKiller) this.ending('CAUGHT', { name: target.name, nights: this.nightNo });
      else this.ending('FIRED', {
        name: target.name,
        reason: describeInnocent(target, this.night.bulletin),
      });
    }, 1400);
    this.player.frozen = true;
    this.flash = 0.5;
  }

  /* ---------------- endings ---------------- */
  ending(kind, data) {
    this.state = ST.ENDING;
    this.endKind = kind;
    this.input.exitLock();
    this.ui.hideDialogue(); this.ui.hideNotes(); this.ui.hidePhone();
    this.ui.setHudVisible(false);
    this.ui.setObjective('');
    this.ui.cinema(true);
    this.endTimer = 0;
    data.night = this.nightNo;
    this.endData = data;
    if (kind === 'CAUGHT') { this.sound.siren(); this.sound.chimeGood(); }
    if (kind === 'ATTACKED') { this.sound.attack(); this.flash = 1; }
    if (kind === 'FIRED') { this.sound.siren(); this.sound.chimeBad(); }
    setTimeout(() => { if (this.state === ST.ENDING) this.ui.showPanel(endingHtml(kind, data)); }, kind === 'ATTACKED' ? 2200 : 1600);
  }

  updateEnding(dt) {
    this.endTimer += dt;
    if (this.endKind === 'ATTACKED') {
      this.player.pitch = Math.max(-1.2, this.player.pitch - dt * 0.55);
      this.player.eye = Math.max(0.35, this.player.eye - dt * 0.75);
      this.player.roll = Math.min(0.5, this.player.roll + dt * 0.25);
      this.distress = Math.min(1, this.distress + dt * 0.6);
    }
    if (this.endTimer > 2.6 && (this.input.hit('KeyE', 'Enter', 'Space') || this.input.mousePressed[0])) {
      this.ui.hidePanel(); this.ui.cinema(false);
      this.ui.showTitle(true); this.state = ST.TITLE; this.menuSel = 0; this.titleT = 0;
      this.player = createPlayer(); this.player.x = 6.4; this.player.z = 6.2;
      this.sound.setTension(0);
    }
  }

  endNight() {
    // anything still in your hands, on the counter or in the bin is a black mark
    this.stats.unshelved = this.player.held.length + this.bin.length
      + this.counterSlots.filter(Boolean).length + (this.rewinder.tape ? 1 : 0);
    const grade = gradeNight(this.stats);
    this.grade = grade;
    this.state = ST.REPORT;
    this.input.exitLock();
    this.ui.setHudVisible(false);
    this.ui.setObjective('');
    this.ui.cinema(true);
    this.sound.nightEnd();
    this.reportTimer = 0;
    const k = this.killer;
    let note;
    if (!k || k.phase === KP.ABSENT && !k.seenAsCustomer) note = `Nobody came for you tonight. The deputy will be back tomorrow with less to go on.`;
    else if (k.seenAsCustomer) note = `Somebody in that store tonight matched the bulletin, and you let them walk out with a tape.`;
    else note = `Quiet night. That is not the same as a safe one.`;
    this.ui.showPanel(reportHtml(this.nightNo, this.stats, grade, note));
  }

  updateReport(dt) {
    this.reportTimer += dt;
    if (this.reportTimer > 1.0 && (this.input.hit('KeyE', 'Enter', 'Space') || this.input.mousePressed[0])) {
      this.ui.hidePanel();
      this.startNight(this.nightNo + 1);
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  render(dt) {
    const rz = this.raster, p = this.player;
    rz.clear(0xFF0A0704);
    const M = this._mats;
    buildCamera(p, M.cam);
    if (p.roll) {
      // a little camera roll while walking, applied after the yaw/pitch
      const c = Math.cos(p.roll), s = Math.sin(p.roll);
      const r = M.tmp;
      r[0] = c; r[1] = -s; r[2] = 0; r[3] = 0;
      r[4] = s; r[5] = c; r[6] = 0; r[7] = 0;
      r[8] = 0; r[9] = 0; r[10] = 1; r[11] = 0;
      mul(M.cam, M.cam, r);
    }
    invertRigid(M.view, M.cam);
    rz.setCamera(M.view, 1.18);

    const L = this.state === ST.PLAY || this.state === ST.PAUSE || this.state === ST.ENDING || this.state === ST.REPORT
      ? this.lights : 1;

    // ---- static world ----
    setTranslate(M.m, 0, 0, 0);
    rz.drawMesh(this.world.mesh, M.m, { shade: L });

    // ---- TV playing static ----
    const tv = this.world.tvPos;
    setPosYaw(M.m, tv.x, tv.y, tv.z, tv.yaw);
    rz.drawMesh(this.world.tvMesh, M.m, {
      shade: L,
      textures: [this.world.tvMesh.textures[0], this.T.staticFrames[this.staticFrame]],
    });

    // ---- doors ----
    const swing = this.door ? this.door.swing : 0;
    const dm = (this.door && this.door.locked) ? this.world.doorLockedMesh : this.world.doorOpenMesh;
    setPosYaw(M.m, DOOR_X0, 0, 0, swing);
    rz.drawMesh(dm, M.m, { shade: L * 0.95 });
    setPosYaw(M.m, DOOR_X1, 0, 0, Math.PI - swing);
    rz.drawMesh(dm, M.m, { shade: L * 0.95 });

    // ---- tapes sitting around ----
    for (let i = 0; this.counterSlots && i < this.counterSlots.length; i++) {
      const t = this.counterSlots[i];
      if (!t) continue;
      const s = COUNTER_SLOTS[i];
      this.drawTape(t, s.x, s.y + 0.015, s.z, 0.25 + i * 0.4, Math.PI / 2);
    }
    if (this.bin) {
      for (let i = 0; i < Math.min(3, this.bin.length); i++) {
        const t = this.bin[this.bin.length - 1 - i];
        this.drawTape(t, PROPS.bin.x0 + 0.34, PROPS.bin.y1 - 0.06 - i * 0.035, PROPS.bin.z0 + 0.28, 0.1 + i * 0.15, 0.28);
      }
    }
    if (this.rewinder && this.rewinder.tape) {
      this.drawTape(this.rewinder.tape, 11.88, PROPS.rewinder.y1 + 0.02, 1.58, 0, Math.PI / 2);
    }

    // ---- people ----
    for (const c of this.people()) {
      if (c.hidden) continue;
      const shade = (c.z < 0.05 ? outdoorLightAt(c.x, 1.1, c.z) : lightAt(c.x, 1.1, c.z) * L);
      drawActor(rz, this.actorMeshes, c, shade);
      if (c.tape && !c.gaveTape && !c.checkedOut) this.drawHeldByNpc(c, shade);
    }

    // ---- your hands ----
    if (p.held) {
      for (let i = 0; i < p.held.length; i++) {
        heldTapeMatrix(p, i, M.m, Math.sin(p.bobPhase) * 0.6);
        rz.drawMesh(this.world.tapeMesh[p.held[i].genre], M.m, { shade: Math.min(1.1, lightAt(p.x, 1.2, p.z) * L * 1.15) });
      }
    }

    // ---- post ----
    const k = this.killer;
    const nearPanic = k && (k.phase === KP.HUNT || k.phase === KP.BREACH) ? k.proximity : 0;
    this.post.render(rz.color, {
      dt,
      dither: true,
      bleed: 1 + (this.distress > 0.5 ? 1 : 0),
      scan: 0.80,
      ghost: 0.18 + this.distress * 0.12,
      grain: 8 + this.opts.grain * 14 + this.distress * 18,
      warp: this.distress * 1.5 + nearPanic * 2.2,
      fade: this.fade,
      flash: this.flash,
      dark: (1.06 + (L - 1) * 0.55) * (1 - nearPanic * 0.15),
      tintR: 1 + nearPanic * 0.25, tintG: 1 - nearPanic * 0.08, tintB: 1 - nearPanic * 0.05,
      distress: Math.min(1, this.distress + nearPanic * 0.5) * this.opts.grain * 1.4,
    });
  }

  drawTape(t, x, y, z, yaw, pitch) {
    const M = this._mats;
    setPosYaw(M.m, x, y, z, yaw);
    const r = M.tmp;
    setRotX(r, pitch);
    mul(M.m, M.m, r);
    this.raster.drawMesh(this.world.tapeMesh[t.genre], M.m, { shade: lightAt(x, y, z) * this.lights });
  }

  drawHeldByNpc(c, shade) {
    const hs = c.app.height.scale;
    const reach = (c.state === CS.TALKING && !c.gaveTape) ? 0.30 : 0;
    const lx = (0.21 * c.app.build.w + 0.10) * hs;
    const ly = (1.42 - 0.52) * hs;
    const lz = (0.10 + reach) * hs;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const x = c.x + lx * cy + lz * sy;
    const z = c.z - lx * sy + lz * cy;
    const M = this._mats;
    setPosYaw(M.m, x, ly, z, c.yaw + 0.3);
    const r = M.tmp; setRotX(r, 1.3); mul(M.m, M.m, r);
    this.raster.drawMesh(this.world.tapeMesh[c.tape.genre], M.m, { shade });
  }

  /* ============================================================
     CTX -- everything the other systems call back into
     ============================================================ */
  get ctx() {
    if (this._ctx) return this._ctx;
    const g = this;
    this._ctx = {
      get rng() { return g.rng; },
      get solids() { return g.solids; },
      get player() { return g.player; },
      get elapsed() { return g.elapsed; },
      get doorLocked() { return g.door.locked; },
      get speaking() { return g.speaking; },
      // A thumb latch lets anyone already inside leave. The deadbolt is only
      // ever a problem for whoever is on the pavement.
      doorPassable: (who) => !g.door.locked || (!!who && who.z > 0.15),
      doorPassableForPlayer: () => !g.door.locked || g.player.z > 0.15,

      /* --- sound / feedback --- */
      footstep: (c, heavy) => {
        const s = g.sound.spatial(g.player.x, g.player.z, g.player.yaw, c.x, c.z, heavy ? 16 : 11);
        if (s.gain > 0.02) g.sound.footstep(s.pan, heavy);
      },
      playerStep: (run) => g.sound.footstep(0, run),
      openDoor: () => g.openDoorFor(),
      knock: (c) => { g.sound.knock(3); g.ui.toast(`Someone is knocking.`, ''); },
      lockedOut: (c) => {
        g.stats.turnedAway++;
        g.sound.chimeBad();
        g.ui.toast(`${c.name} found the door locked and left.`, 'bad');
      },

      /* --- queue --- */
      claimCounterSpot: (c) => g.claimCounterSpot(c),
      releaseCounterSpot: (c) => g.releaseCounterSpot(c),
      despawn: (c) => g.releaseCounterSpot(c),

      tookFromShelf: (c) => {
        const s = g.sound.spatial(g.player.x, g.player.z, g.player.yaw, c.x, c.z);
        if (s.gain > 0.02) g.sound.pickup();
      },

      grumble: (c) => {
        g.sound.blip(c.app.voice.pitch, c.app.voice.rough);
        g.ui.toast(`${c.name}: "${pickGrumble(c, g.rng)}"`, '');
        c.observed.add('voice');
      },
      wentAngry: (c) => {
        g.stats.angered++;
        g.sound.error();
        g.ui.toast(`${c.name} has lost patience.`, 'bad');
      },
      storm: (c) => {
        g.stats.stormedOut++;
        c.leaving = true; c.rushing = true; c.state = CS.LEAVING; c.path = null;
        g.releaseCounterSpot(c);
        g.sound.chimeBad();
        g.ui.toast(`${c.name} walked out.`, 'bad');
      },
      leave: (c) => {
        c.leaving = true;
        c.state = CS.LEAVING; c.path = null;
        g.releaseCounterSpot(c);
        if (c.served || c.checkedOut || c.gaveTape) g.stats.served++;
      },

      /* --- money --- */
      pay: (amt, why) => {
        g.till += amt;
        if (why === 'late fee') g.stats.feesCollected += amt;
        g.sound.kaching();
        g.ui.toast(`+$${amt.toFixed(2)} ${why || ''}`.trim(), 'good');
      },
      waive: (amt) => { g.stats.feesWaived += amt; g.ui.toast(`Waived $${amt.toFixed(2)}`, ''); },
      owed: (c, amt) => { g.owedTotal += amt; g.ui.toast(`$${amt.toFixed(2)} on ${c.name}'s account`, ''); },
      mood: (c, d) => { c.mood = Math.max(0, Math.min(100, c.mood + d)); if (d > 0) c.resolvedAnger = c.mood > 25 ? true : c.resolvedAnger; },

      /* --- tapes --- */
      canTakeTape: () => canCarry(g.player) || g.counterSlots.some((s) => !s),
      takeTape: (tape, c) => {
        if (canCarry(g.player)) takeTape(g.player, tape);
        else { const i = g.counterSlots.findIndex((s) => !s); g.counterSlots[i] = tape; }
        c.tape = null;
        g.sound.pickup();
      },
      binTape: (tape, c) => { g.bin.push(tape); c.tape = null; g.sound.drop(); },
      checkout: (tape, c, unpaid) => {
        g.stats.rentalsRung++;
        if (!unpaid) { g.till += tape.price; g.sound.kaching(); g.ui.toast(`+$${tape.price.toFixed(2)} rental`, 'good'); }
        else g.sound.registerBeep();
      },
      returnToShelf: (c) => { c.tape = null; g.ui.toast(`Tape goes back on the shelf.`, ''); },

      /* --- suspect --- */
      killerIntel: (n) => addIntel(g.killer, n),
      addBulletinDetail: (e) => {
        g.night.bulletin.known.add(e.key);
        g.ui.toast(`Added to your notes: ${e.key}`, '');
        g.sound.paper();
      },
      finishIntro: () => {
        g.officer.state = 'LEAVE';
        g.officer.path = null; g.officer.pathI = 0;
        g.officerDone = true;
        g.ui.toast(`Press TAB to read your notes.`, '');
      },

      /* --- phone --- */
      phoneTargets: () => g.phoneTargets(),
      accuse: (t) => g.accuse(t),
      hangUp: () => g.hangUp(),

      /* --- killer beats --- */
      onKillerArrives: () => { },
      onKillerVanishes: () => { },
      onStalkBegins: () => {
        g.sound.stinger(0.7);
        g.flickerAmt = 0.9;
        g.ui.toast(`The lights dip.`, '');
      },
      onKillerMoves: () => { g.flickerAmt = Math.max(g.flickerAmt, 0.35); },
      onKillerApproaches: () => { g.sound.stinger(0.5); },
      onKillerAtDoor: () => {
        g.sound.doorOpen(0);
        if (!g.door.locked) g.ui.setObjective('SOMEONE IS AT THE DOOR', true);
      },
      killerTriesHandle: () => {
        g.sound.noise({ filter: 'bandpass', freq: 800, q: 3, gain: 0.16, a: 0.002, d: 0.22 });
        g.ui.setObjective('THE HANDLE IS TURNING', true);
      },
      killerBangs: () => {
        g.sound.knock(2 + g.rng.int(3));
        g.ui.setObjective('LOCKED. HE IS STILL THERE.\nGET TO THE PHONE.', true);
      },
      onKillerEnters: (broke) => {
        if (broke) { g.sound.glassBreak(); g.flash = 0.7; }
        else g.sound.doorChime(0);
        g.door.holdOpen = 2.2;
        g.flickerAmt = 1.0;
        g.ui.setObjective('HE IS INSIDE', true);
      },
      onKillerAttacks: () => g.ending('ATTACKED', {}),
    };
    return this._ctx;
  }

  openDoorFor() { this.door.holdOpen = Math.max(this.door.holdOpen, 1.6); this.sound.doorChime(0); }

  claimCounterSpot(c) {
    if (!this.queue.includes(c)) this.queue.push(c);
    const i = this.queue.indexOf(c);
    c.queueIndex = i;
    if (i === 0) return SPOTS.service;
    const q = SPOTS.queue[Math.min(i - 1, SPOTS.queue.length - 1)];
    return { x: q.x - Math.max(0, i - SPOTS.queue.length) * 0.9, z: q.z };
  }
  releaseCounterSpot(c) {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
  }

  phoneTargets() {
    const out = [];
    for (const c of this.customers) if (c.z > -0.5 && c.z < D) out.push(c);
    const k = this.killer;
    if (k && !k.ent.hidden) {
      if (k.phase === KP.CUSTOMER) { if (!out.includes(k.ent)) out.push(k.ent); }
      else if (killerActive(k)) {
        const e = k.ent;
        e.phoneLabel = k.phase === KP.HUNT || k.phase === KP.BREACH
          ? `THE MAN WHO JUST CAME THROUGH THE DOOR`
          : `The one standing outside the window`;
        out.push(e);
      }
    }
    return out;
  }
}

/* ---------------- helpers ---------------- */
function box(p) { return { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z0, z1: p.z1 }; }

function pickGrumble(c, rng) {
  const G = [
    `Is anyone actually working here?`,
    `The carpet in here smells like a wet dog.`,
    `You've got a tape shelved wrong. Right there. I can see it.`,
    `Hello? I'm a paying customer.`,
    `This is why people buy tapes.`,
    `Your clock's ten minutes fast, you know that?`,
    `I've been here longer than the movie runs.`,
  ];
  return G[rng.int(G.length)];
}

function describeInnocent(t, bulletin) {
  const miss = [...bulletin.known].filter((k) => {
    const a = t.app[k], b = bulletin.app[k];
    return (a && a.id) !== (b && b.id);
  });
  if (!miss.length) return `The description fit. It fit almost perfectly. It was not them.`;
  const words = miss.slice(0, 2).map((k) => k.toLowerCase()).join(' and the ');
  return `The ${words} never matched. It was in your notes the whole time.`;
}
