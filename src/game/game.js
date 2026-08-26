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
  DOOR_X0, DOOR_X1, D, W, EYE, STORAGE, SDOOR_X0, SDOOR_X1,
} from './world.js';
import { buildActorMeshes, drawActor, ACTOR_HEIGHT, makeAnim, updateAnim } from './actor.js';
import { createPlayer, updatePlayer, buildCamera, castInteract, canCarry, takeTape, topTape, heldTapeMatrix, heldCashMatrix, forwardOf } from './player.js';
import { createCustomer, updateCustomer, CS, observeVisible, moodLabel, makeSpecial } from './customer.js';
import { specialById } from './specials.js';
import { createKiller, updateKiller, KP, killerActive, killerInside, killerInView, addIntel } from './killer.js';
import { makeNight, makeDecoyAppearance, sanitizeInnocent, clockString, gradeNight, MODE } from './night.js';
import { DialogueRunner, buildOfficerIntro, talkTo, buildPhoneCall } from './dialogue.js';
import { UI, howToHtml, optionsHtml, reportHtml, endingHtml, glyph, glyphText, setScheme } from './ui.js';
import { randomAppearance, paintSkin, voicePitchOf, pronounOf } from './appearance.js';
import { OFFICER } from './personality.js';
import { GENRE_LABEL, GENRES, makeTape } from './tapes.js';

const ST = {
  BOOT: 'BOOT', TITLE: 'TITLE', HOWTO: 'HOWTO', OPTIONS: 'OPTIONS',
  ESTABLISH: 'ESTABLISH', PLAY: 'PLAY', REPORT: 'REPORT', ENDING: 'ENDING', PAUSE: 'PAUSE',
};

const RES = [[256, 192, '256x192'], [320, 240, '320x240'], [400, 300, '400x300']];

/** Arm's length of a shelf run, and how long squaring a box away takes. */
const SHELVE_REACH = 1.05;
const SHELVE_TIME = 1.5;

export class Game {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.ui = new UI();
    this.input = new Input(this.canvas);
    this.sound = new Sound();
    this.state = ST.BOOT;
    this.opts = {
      sens: 0.5, invert: false, vol: 0.8, res: 1, snap: true, grain: 0.5,
      vhs: true,
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
    this.mode = MODE.HORROR;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this._mats = { view: mat(), cam: mat(), m: mat(), tmp: mat() };
    this.frame = this.frame.bind(this);   // handed straight to requestAnimationFrame
    // safe defaults so the attract-mode camera can render before a shift starts
    this.customers = [];
    this.queue = [];
    this.counterSlots = [];
    this.bin = [];
    this.rewinder = { tape: null, t: 0, dur: 20, done: false, running: false };
    this.door = { locked: false, swing: 0, target: 0, holdOpen: 0 };
    this.storage = freshStorageDoor();
    this.officer = null;
    this.killer = null;
    this.lights = 1; this.flickerAmt = 0; this.flickerT = 4;
    this.distress = 0; this.tension = 0;
    this.staticFrame = 0; this.staticT = 0;
    this.shake = 0;
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
    this.night = makeNight(this.seed, n, this.mode);
    this.rng = this.night.rng;
    /* Two clocks.
       `sim` is real time on the shop floor: it runs from the moment you
       take the counter and it is what customers and the killer are
       scheduled against.
       `elapsed` is the clock over the door, and it does not start until
       the deputy has said his piece. Otherwise the whole identification
       half of the game -- the part you need time for -- was being spent
       out of the same three hours as the shift, and a slow briefing cost
       you the night. */
    this.sim = 0;
    this.elapsed = 0;
    this.player = createPlayer();
    this.player.frozen = true;

    this.customers = [];
    this.queue = [];
    this.counterSlots = COUNTER_SLOTS.map(() => null);
    this.bin = [];
    this.rewinder = { tape: null, t: 0, dur: 20, done: false, running: false };
    this.till = 0;
    this.owedTotal = 0;
    this.stats = {
      served: 0, rentalsRung: 0, feesCollected: 0, feesWaived: 0,
      shelvedRight: 0, shelvedWrong: 0, shelvedUnrewound: 0, unshelved: 0,
      angered: 0, stormedOut: 0, turnedAway: 0,
      cashLoose: 0, changeStiffed: 0, tips: 0,
    };

    this.door = { locked: false, swing: 0, target: 0, holdOpen: 0 };
    this.storage = freshStorageDoor();
    // whatever the last night ended as, none of it belongs to this one
    this.death = null; this.shake = 0; this.endKind = null; this.endData = null;
    this.hold = null;
    this.flash = 0; this._exitNagT = -99; this._heldTalk = null;
    this.lights = 1; this.flickerT = 0; this.flickerAmt = 0;
    this.distress = 0; this.tension = 0;
    this.speaking = null;
    this.blipT = 0;
    this.staticFrame = 0; this.staticT = 0;

    /* The deputy. He is no longer waiting on the pavement when the shift
       starts; he turns up when he turns up, and there may well be two
       people at the counter when he does. */
    if (this.night.deputy) {
      const oapp = this.night.officerApp;
      this.officer = {
        id: -1, name: this.night.officerName, app: oapp, personality: OFFICER,
        skin: paintSkin(oapp), x: SPOTS.street.x - 1.4, y: 0, z: SPOTS.street.z - 1.6, yaw: 0, r: 0.30,
        anim: makeAnim(), speed: 1.45, moveSpeed: 0, state: 'PENDING', observed: new Set(),
        mood: 100, phoneLabel: 'The deputy', isKiller: false, timer: 0,
        hidden: true, nagTimer: 0, waitTimer: 0,
      };
      this.officerDone = false;
    } else {
      this.officer = null;
      this.officerDone = true;           // nothing to wait on; the clock runs
    }
    this.briefingStarted = false;

    // the suspect
    this.killer = createKiller(this.rng, this.night.suspect, this.night.plan,
      this.night.length, this.night.caseFile);
    this.killerSpottedOnce = false;
    this.suspectSeen = false;
    this.police = { called: false, eta: 0, target: null };

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
    this.input.poll();
    if (this.input.scheme !== this._scheme) {
      this._scheme = this.input.scheme;
      setScheme(this._scheme);
      this.onSchemeChanged();
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    dt *= this.timeScale;
    this.time += dt;
    this._dt = dt;

    this.fade += (this.fadeTo - this.fade) * Math.min(1, dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 3.4);
    this.shake = Math.max(0, (this.shake || 0) - dt * 2.6);

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
        const app = node && !node.asPlayer && node.person && node.person.app;
        if (app) this.sound.blip(voicePitchOf(app), app.voice.rough);
        else this.sound.blip(1.05, 0.5);
      }
      this._lastTyped = typed;
    } else this._lastTyped = -1;
    this.render(dt);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  }

  /** Redraw whatever panel is open so its button art matches the new device. */
  onSchemeChanged() {
    if (this.state === ST.HOWTO) this.ui.showPanel(howToHtml());
    else if (this.state === ST.OPTIONS) { this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(this.optSel); }
    else if (this.state === ST.PAUSE) this.showPauseMenu();
    this._promptCache = null;
  }

  /* ---------------- title ---------------- */
  get titleItems() {
    return [
      () => { this.beginRun(MODE.HORROR); },
      () => { this.beginRun(MODE.CASUAL); },
      () => { this.state = ST.HOWTO; this.ui.showPanel(howToHtml()); },
      () => {
        this.state = ST.OPTIONS; this.optSel = 0;
        this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(0);
      },
    ];
  }

  beginRun(mode) {
    this.mode = mode;
    this.nightNo = 1;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.startNight(1);
  }

  updateTitle(dt) {
    this.titleT += dt;
    const p = this.player;
    p.yaw = 0.35 + Math.sin(this.titleT * 0.09) * 0.55;
    p.x = 6.4 + Math.sin(this.titleT * 0.06) * 1.6;
    p.z = 6.2 + Math.cos(this.titleT * 0.05) * 0.9;
    p.pitch = -0.04 + Math.sin(this.titleT * 0.11) * 0.03;
    this.staticT += dt;

    const i = this.input;
    const items = this.titleItems;
    const n = items.length;
    if (i.hit('ArrowUp', 'KeyW')) { this.menuSel = (this.menuSel + n - 1) % n; this.sound.init(); this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.menuSel = (this.menuSel + 1) % n; this.sound.init(); this.sound.uiMove(); }
    this.ui.titleSelect(this.menuSel);
    if (i.hit('Enter', 'KeyE', 'Space') || i.mousePressed[0]) {
      this.sound.init(); this.sound.resume(); this.sound.uiSelect();
      items[this.menuSel]();
    }
  }

  optView() {
    return {
      sens: this.opts.sens, invert: this.opts.invert, vol: this.opts.vol,
      resLabel: RES[this.opts.res][2], snap: this.opts.snap, grain: this.opts.grain,
      vhs: this.opts.vhs,
    };
  }

  updatePanelMenu() {
    const i = this.input;
    if (this.state === ST.HOWTO) {
      if (i.hit('Enter', 'KeyE', 'Escape', 'Space')) {
        this.sound.uiBack();
        this.ui.hidePanel();
        if (this._fromPause) { this._fromPause = false; this.showPauseMenu(); }
        else this.state = ST.TITLE;
      }
      return;
    }
    const N = 8;
    const BACK = N - 1;
    const TOGGLES = { 1: 'invert', 4: 'snap', 5: 'vhs' };
    if (i.hit('ArrowUp', 'KeyW')) { this.optSel = (this.optSel + N - 1) % N; this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.optSel = (this.optSel + 1) % N; this.sound.uiMove(); }
    const d = (i.hit('ArrowRight', 'KeyD') ? 1 : 0) - (i.hit('ArrowLeft', 'KeyA') ? 1 : 0);
    if (d) {
      this.sound.uiMove();
      switch (this.optSel) {
        case 0: this.opts.sens = clamp(this.opts.sens + d * 0.1, 0.1, 1.0); break;
        case 2: this.opts.vol = clamp(this.opts.vol + d * 0.1, 0, 1); break;
        case 3: this.opts.res = clamp(this.opts.res + d, 0, RES.length - 1); this.layout(); break;
        case 6: this.opts.grain = clamp(this.opts.grain + d * 0.1, 0, 1); break;
        default:
          if (TOGGLES[this.optSel]) this.opts[TOGGLES[this.optSel]] = !this.opts[TOGGLES[this.optSel]];
          break;
      }
      this.applyOptions();
      this.ui.showPanel(optionsHtml(this.optView()));
    }
    this.ui.panelSelect(this.optSel);
    if (i.hit('Enter', 'KeyE', 'Escape')) {
      if (this.optSel === BACK || i.hit('Escape')) {
        this.sound.uiBack();
        if (this._fromPause) { this._fromPause = false; this.showPauseMenu(); }
        else { this.ui.hidePanel(); this.state = ST.TITLE; }
      } else if (TOGGLES[this.optSel]) {
        this.opts[TOGGLES[this.optSel]] = !this.opts[TOGGLES[this.optSel]];
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

  /* ---------------- establishing shot ----------------
     This used to be a single dolly toward the door, timed so that the
     deputy walked in behind you. He does not arrive with you any more, so
     the shot is the clerk's own: a beat held on the storefront from across
     the pavement while the sign buzzes, then a walk in under the sign, and
     the doors close behind you.                                          */
  updateEstablish(dt) {
    this.estT += dt;
    const t = this.estT;
    const p = this.player;
    const HOLD = 2.0, WALK = 3.4;

    if (t < HOLD) {
      // held wide, drifting a little, taking the place in
      const f = t / HOLD;
      p.x = 4.2 + f * 0.55;
      p.z = -7.1 + f * 0.25;
      p.eye = 1.70;
      p.yaw = Math.atan2(6.3 - p.x, 1.4 - p.z);
      p.pitch = 0.16 - f * 0.06;
    } else {
      // in under the sign
      const f = Math.min(1, (t - HOLD) / WALK);
      const e = f * f * (3 - 2 * f);                 // ease, so it starts as a step
      p.x = 4.75 + (6.05 - 4.75) * e + Math.sin(t * 5.4) * 0.035 * (1 - f);
      p.z = -6.85 + (-0.55 + 6.85) * e;
      p.eye = 1.70 + Math.sin(t * 10.8) * 0.014;
      p.yaw = Math.atan2(6.1 - p.x, 0.9 - p.z) + Math.sin(t * 3.1) * 0.02;
      p.pitch = 0.10 - e * 0.10;
      this._estStep = (this._estStep || 0) - dt;
      if (this._estStep <= 0 && f < 0.96) { this._estStep = 0.58; this.sound.footstep(0, false); }
    }
    this.staticT += dt;
    this.door.swing += ((t > HOLD + WALK * 0.72 ? 1.1 : 0) - this.door.swing) * Math.min(1, dt * 6);

    if (t > 0.35 && !this._estSound) { this._estSound = true; this.sound.tvHiss(0); }
    if (t > HOLD + WALK * 0.74 && !this._estChime) { this._estChime = true; this.sound.doorChime(0); }

    if (t > HOLD + WALK || this.input.hit('KeyE', 'Enter', 'Space')) {
      this._estSound = false; this._estChime = false; this._estStep = 0;
      /* Hand over standing exactly where the camera stopped, just inside
         the door. Cutting to behind the counter made the shot look like it
         had teleported you across the shop; the walk to the till is now
         yours, and it is the first thing you do on shift. */
      const at = { x: p.x, z: Math.max(p.z, 0.62), yaw: p.yaw, pitch: p.pitch };
      this.player = createPlayer();
      this.player.x = at.x; this.player.z = at.z;
      this.player.yaw = at.yaw; this.player.pitch = at.pitch;
      this.door.holdOpen = 0.9;
      this.beginPlay();
      this.sound.restoreRoom();
      this.ui.toast(`NIGHT ${this.nightNo} — SUNSET VIDEO`, '');
      this.ui.toast(`Get behind the counter.`, '');
      // What the clock is doing, and why, said plainly the first time.
      if (this.night.deputy) {
        this.ui.toast(`The clock over the door has stopped again.`, '');
      } else {
        this.ui.toast(`Shift ends at midnight.`, '');
      }
    }
  }

  /* ============================================================
     PLAY
     ============================================================ */
  updatePlay(dt) {
    const i = this.input;

    // ---- pause / notepad ----
    if (i.hit('Escape')) { this.pause(); return; }
    /* Before the bulletin exists there is nothing on the page and nobody to
       compare anybody against, so the notepad simply is not a thing yet. */
    if (i.hit('Tab')) {
      if (!this.night.bulletin.known.size) {
        this.sound.error();
        this.ui.toast(this.night.deputy
          ? `Nothing in the notebook yet.`
          : `Nothing to write down tonight.`, '');
      } else {
        this.notesOpen = !this.notesOpen;
        this.sound.paper();
        if (!this.notesOpen) this.ui.hideNotes();
      }
    }
    // Throwing the bolt is the one thing you may need to do without lining
    // up a crosshair first, so it gets its own key anywhere in the room.
    if (i.hit('KeyF') && this.player.z > D + 0.05 && !this.storage.broken) {
      if (this.storage.locked) this.toggleStorage(); else this.lockStorage();
    }

    const talking = this.dlg.active || this.phone.active;
    this.player.frozen = talking;

    // ---- conversation input ----
    if (talking) this.updateConversation();

    // ---- clocks ----
    this.sim += dt;
    const holdClock = killerActive(this.killer) || !this.officerDone;
    if (!holdClock) this.elapsed += dt;
    this.updatePolice(dt);

    // ---- systems ----
    this.updateDoor(dt);
    updatePlayer(this.player, dt, i, this.ctx);
    this.updateRewinder(dt);
    this.updateOfficer(dt);
    this.spawnDue();
    for (const c of this.customers) if (!c.hidden) updateCustomer(c, dt, this.ctx);
    this.customers = this.customers.filter((c) => c.state !== CS.GONE);
    updateKiller(this.killer, dt, this.ctx);
    this.swingForKiller();
    this.checkKillerProximity();
    this.updateObservation(dt);
    this.updateAtmosphere(dt);

    // ---- interaction ----
    if (!talking) this.updateInteraction();
    else this.ui.setPrompt('');

    // ---- HUD ----
    this.ui.setClock(clockString(this.elapsed, this.night.length), this.nightNo, holdClock);
    this.ui.setTill(this.till);
    this.ui.setHands(this.player.held, this.rewinder, this.player, this.changeOwedOut());
    if (this.notesOpen) this.ui.showNotes(this.night.bulletin, this.player.lookTarget);

    // ---- night end ----
    if (this.elapsed >= this.night.length && !holdClock && !talking) this.endNight();
  }

  /* Pausing used to run through DialogueRunner.cancel(), which threw the
     conversation away. Do that to the deputy mid-briefing and he was left
     standing at the counter with briefingStarted already true and nothing
     left to start: he never spoke or moved again. The conversation is now
     held intact behind the pause panel and put back on resume. */
  /* Pausing, and coming back to it out of the options page.
     `pause()` used to refuse to run unless the state was PLAY, so backing
     out of Options returned to nothing: the options panel stayed up, the
     state stayed OPTIONS, and the next press dropped you to the title
     screen. Entering the pause menu and returning to it are now separate
     things, and only the first one touches the world. */
  pause() {
    if (this.state !== ST.PLAY) return;
    this.input.exitLock();
    this.ui.setPrompt('');
    this.ui.hideNotes(); this.notesOpen = false;
    this._heldTalk = this.phone.active ? 'phone' : this.dlg.active ? 'dlg' : null;
    if (this._heldTalk) { this.ui.hideDialogue(); this.ui.hidePhone(); }
    this.pauseSel = 0;
    this.showPauseMenu();
  }

  showPauseMenu() {
    this.state = ST.PAUSE;
    this.ui.showPanel(`<h2>SHIFT PAUSED</h2>
      <ul><li class="opt sel">${this._heldTalk ? 'Back to the conversation' : 'Back to the counter'}</li>`
      + `<li class="opt">Options</li><li class="opt">Quit to title</li></ul>
      <p class="pad-foot">${this.ui.keyHint('confirm')} select &nbsp;&middot;&nbsp; ${this.ui.keyHint('up')}${this.ui.keyHint('down')} move</p>`);
    this.ui.panelSelect(this.pauseSel || 0);
  }

  resume() {
    this.ui.hidePanel();
    this._fromPause = false;
    this.state = ST.PLAY;
    if (this._heldTalk === 'phone' && this.phone.node) {
      this.ui.showPhone(this.phone.node, this.phone.sel);
    } else if (this._heldTalk === 'dlg' && this.dlg.node) {
      this.ui.showDialogue(this.dlg.node, this.dlg.sel, this.ctx);
    } else {
      this.input.requestLock();
    }
    this._heldTalk = null;
  }

  /* Pause and options take no mouse input at all.
     Pointer lock is released while paused, so the canvas sees ordinary
     clicks -- and a single click anywhere both picked whatever the cursor
     happened to be over and grabbed the pointer again. */
  updatePause() {
    const i = this.input;
    const N = 3;
    if (i.hit('ArrowUp', 'KeyW')) { this.pauseSel = (this.pauseSel + N - 1) % N; this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.pauseSel = (this.pauseSel + 1) % N; this.sound.uiMove(); }
    this.ui.panelSelect(this.pauseSel);
    if (i.hit('Escape')) { this.resume(); return; }
    if (i.hit('Enter', 'KeyE', 'Space')) {
      this.sound.uiSelect();
      if (this.pauseSel === 0) this.resume();
      else if (this.pauseSel === 1) { this.state = ST.OPTIONS; this.optSel = 0; this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(0); this._fromPause = true; }
      else {
        this.dlg.node = null; this.phone.node = null; this._heldTalk = null; this.speaking = null;
        this.ui.hidePanel(); this.ui.hideDialogue(); this.ui.hidePhone(); this.ui.hideNotes();
        this.ui.setHudVisible(false); this.ui.cinema(false); this.ui.showTitle(true);
        this.state = ST.TITLE; this.menuSel = 0; this.titleT = 0;
      }
    }
  }

  /* ---------------- doors ---------------- */
  updateDoor(dt) {
    const d = this.door;
    d.holdOpen = Math.max(0, d.holdOpen - dt);
    // A thrown deadbolt is a thrown deadbolt: the leaves stay shut even if
    // something was mid-swing when you turned it.
    d.target = (d.holdOpen > 0 && !d.locked) ? 1.25 : 0;
    const k = d.target > d.swing ? 7 : 3.2;
    d.swing += (d.target - d.swing) * Math.min(1, dt * k);

    const s = this.storage;
    s.hitFlash = Math.max(0, s.hitFlash - dt * 2.4);
    s.target = (s.open && !s.broken) ? 1.35 : (s.broken ? 1.55 : 0);
    s.swing += (s.target - s.swing) * Math.min(1, dt * (s.broken ? 9 : 5));
  }

  /** True while the player is shut inside the back room. */
  get hiding() {
    const s = this.storage;
    return this.player.z > D + 0.05 && s.locked && !s.broken;
  }

  toggleStorage() {
    const s = this.storage;
    if (s.broken) { this.sound.error(); return; }
    if (s.locked) {
      s.locked = false; s.open = true;
      this.sound.lockClick(false);
      this.ui.toast('Back room unlocked', '');
      return;
    }
    if (s.open) {
      s.open = false;
      this.sound.doorOpen(0);
      return;
    }
    s.open = true;
    this.sound.doorOpen(0);
  }

  lockStorage() {
    const s = this.storage;
    if (s.broken) { this.sound.error(); return; }
    s.open = false; s.locked = true;
    this.sound.lockClick(true);
    this.ui.toast('BACK ROOM LOCKED', 'good');
  }

  /* ---------------- rewinder ---------------- */
  updateRewinder(dt) {
    const r = this.rewinder;
    if (r.tape && r.running) {
      r.t += dt;
      this.sound.rewindPitch(Math.min(1, r.t / r.dur));
      if (r.t >= r.dur) {
        r.running = false; r.done = true; r.tape.rewound = true;
        this.sound.rewindEnd();
        this.ui.toast(`${r.tape.title} rewound`, 'good');
      }
    }
  }

  /* ---------------- the deputy ----------------
     He is a man with a bulletin to read out, not a cutscene. He arrives
     part-way through the shift, walks to the counter, and then waits --
     silently -- until the clerk is actually standing there. Being ambushed
     by a wall of dialogue from across the shop while three people queue
     was never the intent.                                                */
  updateOfficer(dt) {
    const o = this.officer;
    if (!o || o.state === 'DONE') return;

    if (o.state === 'PENDING') {
      if (this.sim < this.night.deputyAt) return;
      o.state = 'ARRIVE'; o.hidden = false; o.timer = 0;
      this.ui.toast(`A county cruiser pulls up outside.`, '');
      this.sound.doorOpen(0);
      return;
    }

    if (o.state === 'ARRIVE') {
      o.timer += dt;
      if (o.timer < 1.4) { o.moveSpeed = 0; updateAnim(o.anim, dt, 0, o.app, {}); return; }
      if (!o.path) o.path = [SPOTS.outsideDoor, { x: SPOTS.door.x, z: 0.85 }, SPOTS.officerStand];
      if (this.followPath(o, dt)) { o.state = 'WAIT'; o.waitTimer = 0; o.nagTimer = 2.5; }
      else if (o.z > -0.6 && !o.entered) { o.entered = true; this.openDoorFor(); }
    } else if (o.state === 'WAIT') {
      o.moveSpeed = 0;
      o.yaw += (angleDelta(o.yaw, Math.atan2(this.player.x - o.x, this.player.z - o.z))) * Math.min(1, dt * 3);
      o.waitTimer += dt;
      if (this.atCounter() && !this.dlg.active && !this.phone.active) {
        o.state = 'BRIEF';
      } else {
        this.ui.setObjective('THE DEPUTY IS AT THE COUNTER', false);
        o.nagTimer -= dt;
        if (o.nagTimer <= 0) {
          o.nagTimer = 11 + this.rng.range(0, 7);
          this.ui.toast(`${o.name}: "${this.rng.pick(OFFICER_NAGS)}"`, '');
          this.sound.blip(voicePitchOf(o.app), o.app.voice.rough);
        }
        // He is not going to stand here all night waiting for you to notice.
        if (o.waitTimer > 190) {
          this.ui.toast(`${o.name} leaves the bulletin on the counter and goes.`, 'bad');
          for (const k of this.night.bulletin.keys) this.night.bulletin.known.add(k);
          this.finishBriefing();
        }
      }
    } else if (o.state === 'BRIEF') {
      o.moveSpeed = 0;
      this.ui.setObjective('', false);
      o.yaw += (SPOTS.officerStand.yaw - o.yaw) * Math.min(1, dt * 4);
      if (!this.briefingStarted) {
        this.briefingStarted = true;
        this.beginDialogue(o, buildOfficerIntro(o, this.night.bulletin, this.night.caseFile, this.ctx));
      }
    } else if (o.state === 'LEAVE') {
      if (!o.path) o.path = [{ x: SPOTS.door.x, z: 0.85 }, SPOTS.outsideDoor, { x: SPOTS.street.x - 2.2, z: SPOTS.street.z - 1.4 }];
      if (this.followPath(o, dt)) { o.state = 'DONE'; }
      else if (o.z < 1.0 && !o.exited) { o.exited = true; this.openDoorFor(); }
    }
    updateAnim(o.anim, dt, o.moveSpeed, o.app, { talking: this.speaking === o });
  }

  /** He does not open doors politely, but he does open them. */
  swingForKiller() {
    const k = this.killer;
    if (!k || k.ent.hidden) return;
    const st = this.storage;
    if (st.open || st.broken || st.locked) return;
    if (k.ent.z > D - 0.9 && k.ent.x > SDOOR_X0 - 0.7 && k.ent.x < SDOOR_X1 + 0.7) {
      st.open = true;
      this.sound.doorOpen(0);
    }
  }

  /**
   * Why this person cannot be rung up yet, or '' if they can.
   *
   * Business happens at the counter, at the front of the line. You could
   * previously check somebody out from the middle of the SCI-FI aisle,
   * which made the queue -- and everyone's patience with it -- decorative.
   */
  cannotServe(c) {
    if (!c || c === this.officer) return '';
    if (c.state === CS.TALKING) return '';
    if (c.awaitingChange) return '';
    const atWindow = c.queueIndex === 0
      && (c.state === CS.WAITING || c.state === CS.TO_COUNTER)
      && Math.hypot(c.x - SPOTS.service.x, c.z - SPOTS.service.z) < 1.1;
    if (atWindow) return '';
    if (c.queueIndex > 0) return 'waiting in line';
    return 'not at the counter';
  }

  /** Within arm's length of the run itself, not merely pointed at it. */
  nearShelf(sh) {
    if (!sh) return false;
    const p = this.player;
    const cx = Math.max(sh.x0, Math.min(p.x, sh.x1));
    const cz = Math.max(sh.z0, Math.min(p.z, sh.z1));
    return Math.hypot(p.x - cx, p.z - cz) < SHELVE_REACH;
  }

  /** Is the clerk actually behind his own counter? */
  atCounter() {
    const p = this.player;
    return p.x > COUNTER.x0 - 0.35 && p.z > COUNTER.z1 - 0.25 && p.z < 4.8;
  }

  /** The bulletin is in hand: release the clock and let him go. */
  finishBriefing() {
    const o = this.officer;
    if (o && o.state !== 'DONE') { o.state = 'LEAVE'; o.path = null; o.pathI = 0; }
    this.ui.setObjective('', false);
    if (this.officerDone) return;
    this.officerDone = true;
    this.ui.toast(`${glyphText('notes')} reads your notes.`, '');
    this.ui.toast(`Clock's running. Shift ends at midnight.`, '');
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

  /* ---------------- spawning ----------------
     Scheduled against the shop-floor clock, not the one over the door: the
     store does not stop having customers because a deputy is talking. */
  spawnDue() {
    for (const s of this.night.schedule) {
      if (s.spawned || this.sim < s.t) continue;
      s.spawned = true;
      if (this.customers.length > 5) { s.t = this.sim + 12; s.spawned = false; continue; }
      const rng = this.rng;
      if (s.special) {
        const sp = specialById(s.special);
        if (sp) { this.customers.push(makeSpecial(rng, sp)); continue; }
      }
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
  /**
   * Laying eyes on him.
   *
   * This used to raise a banner reading THERE IS SOMEONE OUTSIDE, which in
   * a video shop on a main road is true of most of the evening and told the
   * player, in so many words, that the man under the streetlamp was the one.
   * Nothing is announced now. The lights dip, the hum drops out of the
   * room, and you are left to decide for yourself whether that shape at the
   * glass was a shape at the glass.
   */
  checkKillerProximity() {
    const k = this.killer;
    if (!k || k.ent.hidden) return;
    const p = this.player;
    const outsidePhases = k.phase === KP.STALK || k.phase === KP.APPROACH || k.phase === KP.TRY_DOOR;
    if (outsidePhases && !k.spotted && killerInView(k, p, 1.18, this.raster.w / this.raster.h)) {
      const d = Math.hypot(k.ent.x - p.x, k.ent.z - p.z);
      if (d < 13) {
        k.spotted = true;
        this.sound.stinger(0.28);
        this.flickerAmt = Math.max(this.flickerAmt, 0.65);
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
      else if (k.phase === KP.BREACH || k.phase === KP.HUNT || k.phase === KP.SIEGE) tension = 1;
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
    if (k && (k.phase === KP.HUNT || k.phase === KP.BREACH || k.phase === KP.SIEGE)) {
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
    /* Standing in the back room you could still put a tape on the FAMILY
       run through a breeze-block wall, because the interaction ray does not
       care what is between you and the box. Nothing on the sales floor is
       reachable from in there. */
    const inBackRoom = this.player.z > D + 0.02;
    if (inBackRoom) {
      t.push({ kind: 'storage', aabb: { x0: SDOOR_X0 - 0.25, x1: SDOOR_X1 + 0.25, y0: 0.2, y1: 2.0, z0: D - 0.45, z1: D + 0.45 } });
      for (const c of this.people()) {
        if (c.hidden || c.z < D) continue;
        const h = ACTOR_HEIGHT * c.app.height.scale;
        t.push({ kind: 'person', c, cyl: { x: c.x, z: c.z, r: 0.46, y0: 0.05, y1: Math.max(h + 0.30, 1.90) } });
      }
      return t;
    }
    for (const s of SHELVES) {
      t.push({ kind: 'shelf', genre: s.genre, shelf: s, aabb: { x0: s.x0 - 0.12, x1: s.x1 + 0.12, y0: 0.2, y1: s.top, z0: s.z0 - 0.12, z1: s.z1 + 0.12 } });
    }
    COUNTER_SLOTS.forEach((s, i) => {
      t.push({ kind: 'slot', i, aabb: { x0: s.x - 0.13, x1: s.x + 0.13, y0: s.y - 0.02, y1: s.y + 0.16, z0: s.z - 0.14, z1: s.z + 0.14 } });
    });
    t.push({ kind: 'bin', aabb: box(PROPS.bin) });
    t.push({ kind: 'rewinder', aabb: box(PROPS.rewinder) });
    t.push({ kind: 'register', aabb: box(PROPS.register) });
    t.push({ kind: 'phone', aabb: pad(PROPS.phone, 0.14, 0.22, 0.16) });
    t.push({ kind: 'door', aabb: { x0: DOOR_X0 - 0.2, x1: DOOR_X1 + 0.2, y0: 0.2, y1: 2.1, z0: -0.35, z1: 0.35 } });
    t.push({ kind: 'storage', aabb: { x0: SDOOR_X0 - 0.25, x1: SDOOR_X1 + 0.25, y0: 0.2, y1: 2.0, z0: D - 0.45, z1: D + 0.45 } });
    for (const c of this.people()) {
      if (c.hidden || c.z > D + 0.02) continue;
      const h = ACTOR_HEIGHT * c.app.height.scale;
      // Deliberately taller and wider than the person. A five-foot customer's
      // head sits below the clerk's eye line, and looking straight ahead at
      // someone should always offer to talk to them.
      t.push({ kind: 'person', c, cyl: { x: c.x, z: c.z, r: 0.46, y0: 0.05, y1: Math.max(h + 0.30, 1.90) } });
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
    if (!tgt) {
      this.ui.setPrompt('');
      if (this.hold) { this.hold = null; this.ui.setHold(0); }
      return;
    }
    const held = topTape(this.player);
    const K = () => glyph('interact');
    let prompt = '';
    let act = null;

    switch (tgt.kind) {
      case 'shelf': {
        const near = this.nearShelf(tgt.shelf);
        if (held && near) {
          const ok = held.genre === tgt.genre;
          const bad = !held.game && !held.rewound;
          prompt = `${K()}<span class="hold">Hold</span> to shelve ${held.title}`
            + `\n<span class="sub">${GENRE_LABEL[tgt.genre]} run ${ok ? '- correct section' : '- this is not its section'}`
            + `${bad ? ' - NOT REWOUND' : ''}</span>`;
          act = 'HOLD';
        } else if (held) {
          prompt = `<span class="sub">${GENRE_LABEL[tgt.genre]} - step up to the shelf</span>`;
        } else {
          prompt = `<span class="sub">${GENRE_LABEL[tgt.genre]}</span>`;
        }
        break;
      }
      case 'slot': {
        const cur = this.counterSlots[tgt.i];
        if (cur) {
          const state = cur.game ? 'cartridge' : (cur.rewound ? 'rewound' : 'NOT rewound');
          prompt = `${K()}Pick up ${cur.title}\n<span class="sub">${GENRE_LABEL[cur.genre]} / ${state}</span>`;
          act = () => this.pickSlot(tgt.i);
        }
        else if (held) { prompt = `${K()}Set down ${held.title}`; act = () => this.putSlot(tgt.i); }
        break;
      }
      case 'bin': {
        if (held) { prompt = `${K()}Drop ${held.title} in returns`; act = () => this.binFromHand(); }
        else if (this.bin.length) { prompt = `${K()}Take from returns\n<span class="sub">${this.bin.length} waiting</span>`; act = () => this.takeFromBin(); }
        else prompt = `<span class="sub">RETURNS - empty</span>`;
        break;
      }
      case 'rewinder': {
        const r = this.rewinder;
        if (!r.tape && held && held.game) prompt = `<span class="sub">REWINDER - ${held.title} is a cartridge</span>`;
        else if (!r.tape && held) { prompt = held.rewound ? `${K()}Load ${held.title}\n<span class="sub">already rewound</span>` : `${K()}Load ${held.title}`; act = () => this.loadRewinder(); }
        else if (r.tape && r.running) prompt = `<span class="sub">REWINDING ${r.tape.title}...</span>`;
        else if (r.tape) { prompt = `${K()}Take ${r.tape.title}`; act = () => this.unloadRewinder(); }
        else prompt = `<span class="sub">REWINDER - empty</span>`;
        break;
      }
      case 'register': {
        const cash = this.player.cash;
        const owedOut = this.changeOwedOut();
        if (cash.owed > 0.001) {
          prompt = `${K()}Ring up $${cash.owed.toFixed(2)}\n<span class="sub">$${cash.tendered.toFixed(2)} in your hand`
            + `${cash.tendered - cash.owed > 0.001 ? ` &middot; $${(cash.tendered - cash.owed).toFixed(2)} to count back` : ''}</span>`;
          act = () => this.ringUp();
        } else if (owedOut.total > 0.001) {
          /* The drawer used to offer to swallow whatever was in your hand
             on the grounds that "nobody was waiting on it", without ever
             checking. One press and the customer standing three feet away
             could never be paid. */
          prompt = `<span class="sub">$${this.player.changeInHand.toFixed(2)} in your hand`
            + `\n${owedOut.who} waiting on $${owedOut.total.toFixed(2)}</span>`;
        } else if (this.player.changeInHand > 0.001) {
          prompt = `${K()}Put $${this.player.changeInHand.toFixed(2)} back in the drawer\n<span class="sub">nobody waiting on it</span>`;
          act = () => {
            this.till = round2(this.till + this.player.changeInHand);
            this.ui.toast(`Returned $${this.player.changeInHand.toFixed(2)} to the drawer`, '');
            this.player.changeInHand = 0;
            this.sound.cashDrawer();
          };
        } else {
          prompt = `${K()}Count the drawer\n<span class="sub">$${this.till.toFixed(2)} tonight${this.owedTotal ? ` / $${this.owedTotal.toFixed(2)} on accounts` : ''}</span>`;
          act = () => { this.sound.cashDrawer(); this.ui.toast(`Drawer: $${this.till.toFixed(2)}`, ''); };
        }
        break;
      }
      case 'phone': {
        prompt = `${K()}Pick up the phone`;
        act = () => this.pickUpPhone();
        break;
      }
      case 'door': {
        prompt = this.door.locked ? `${K()}Unlock the front door` : `${K()}Lock the front door`;
        act = () => this.toggleLock();
        break;
      }
      case 'storage': {
        const st = this.storage;
        const inside = this.player.z > D;
        if (st.broken) {
          prompt = `<span class="sub">BACK ROOM - the frame is bent, it will not shut</span>`;
        } else if (st.locked) {
          prompt = `${K()}Unlock the back room`;
          act = () => this.toggleStorage();
        } else if (st.open) {
          prompt = `${K()}Pull the back room door to`;
          act = () => this.toggleStorage();
        } else if (inside) {
          // shut and standing on the inside: the only thing worth doing
          prompt = `${K()}Throw the bolt`
            + `\n<span class="sub">${glyph('bolt')} does it from anywhere in here &middot; press again to open up</span>`;
          act = () => this.lockStorage();
        } else {
          prompt = `${K()}Open the back room`;
          act = () => this.toggleStorage();
        }
        break;
      }
      case 'person': {
        const c = tgt.c;
        const m = c === this.officer ? null : moodLabel(c);
        const why = this.cannotServe(c);
        prompt = `${K()}Talk to ${c.name}`
          + (why ? `\n<span class="sub">${why}</span>` : (m ? `\n<span class="sub">${m.text}</span>` : ''));
        act = () => this.talkToPerson(c);
        break;
      }
      default: break;
    }
    if (held && tgt.kind !== 'shelf') prompt += `\n<span class="sub">${glyph('drop')}put it down</span>`;
    this.ui.setPrompt(prompt);
    /* A held action rather than a tap. Sliding a box back into a run and
       squaring it up is a couple of seconds of work, and making it a tap
       from two metres away meant a whole shelf could be cleared without
       ever stopping walking. */
    if (act === 'HOLD') {
      const holding = this.input.isDown('KeyE') || this.input.mouse[0];
      if (holding && this.hold && this.hold.tgt === tgt.kind + ':' + tgt.genre) {
        this.hold.t += this._dt;
        if (this.hold.t >= SHELVE_TIME) {
          this.hold = null;
          this.shelve(held, tgt.genre);
        }
      } else if (holding) {
        this.hold = { tgt: tgt.kind + ':' + tgt.genre, t: 0 };
        this.sound.pickup();
      } else if (this.hold) {
        this.hold = null;
      }
      this.ui.setHold(this.hold ? this.hold.t / SHELVE_TIME : 0);
    } else {
      if (this.hold) { this.hold = null; this.ui.setHold(0); }
      if (act && (this.input.hit('KeyE') || this.input.mousePressed[0])) act();
    }
    if (this.input.hit('KeyG') && held) this.dropHeld();
  }

  /* ---------------- tape handling ---------------- */
  shelve(tape, genre) {
    this.player.held.pop();
    const right = tape.genre === genre;
    // a cartridge is always "rewound", so it can only ever be right or wrong shelf
    if (right && (tape.game || tape.rewound)) {
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
    this.sound.footstep(0, false);
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
    const t = topTape(this.player);
    if (!t) return;
    if (t.game) { this.sound.error(); this.ui.toast(`${t.title} is a cartridge. It does not rewind.`, 'bad'); return; }
    this.player.held.pop();
    const r = this.rewinder;
    r.tape = t; r.t = 0; r.done = false;
    /* How long depends on how far through it was left, which the customer
       is not going to tell you. A machine that took six seconds was a
       formality; one that takes half a minute is a thing to plan around. */
    r.dur = t.rewindDur || (t.rewindDur = 13 + this.rng.range(0, 16));
    if (t.rewound) { r.done = true; r.running = false; this.sound.registerBeep(); }
    else { r.running = true; this.sound.rewindStart(); }
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

  /* ---------------- cash ----------------
     Nothing goes straight into the till. A customer hands you paper, it sits
     in your hand until you walk it to the register, and if they gave you a
     twenty for a three dollar rental they are standing there until you count
     their change back.                                                      */
  takeCashFrom(owed, c, why, exact) {
    const tendered = (exact || this.rng.chance(0.42)) ? owed : nextBill(owed);
    const change = Math.round((tendered - owed) * 100) / 100;
    this.player.cash.tendered = round2(this.player.cash.tendered + tendered);
    this.player.cash.owed = round2(this.player.cash.owed + owed);
    if (why === 'late fee') this.stats.feesCollected += owed;
    if (change > 0.001) {
      c.awaitingChange = true;
      c.changeDue = round2((c.changeDue || 0) + change);
      c.changeTimer = 0;
    }
    this.sound.paper();
    this.ui.toast(change > 0.001
      ? `Took $${tendered.toFixed(2)} — $${change.toFixed(2)} change owed`
      : `Took $${tendered.toFixed(2)}`, 'good');
    return { tendered, change };
  }

  /** Everyone still standing there waiting to be paid, and what they are owed. */
  changeOwedOut() {
    let total = 0;
    const names = [];
    // people() rather than customers: he pays cash like anyone else, and a
    // register that forgets him is a register that pockets his change
    for (const c of this.people()) {
      if (!c.awaitingChange || !(c.changeDue > 0.001)) continue;
      total = round2(total + c.changeDue);
      names.push(c.name);
    }
    const who = names.length === 0 ? ''
      : names.length === 1 ? names[0]
        : `${names.length} people`;
    return { total, who, names };
  }

  ringUp() {
    const cash = this.player.cash;
    if (cash.owed <= 0.001) return;
    this.till = round2(this.till + cash.owed);
    const surplus = round2(cash.tendered - cash.owed);
    this.ui.toast(`Drawer: +$${cash.owed.toFixed(2)}`, 'good');
    this.player.cash = { tendered: 0, owed: 0 };
    this.player.changeInHand = round2(this.player.changeInHand + surplus);
    this.sound.cashDrawer();
    this.sound.kaching();
    if (surplus > 0.001) {
      const owed = this.changeOwedOut();
      this.ui.toast(owed.who
        ? `$${surplus.toFixed(2)} counted out — take it to ${owed.who}`
        : `$${surplus.toFixed(2)} counted out of the drawer`, '');
    }
  }

  toggleLock() {
    this.door.locked = !this.door.locked;
    this.sound.lockClick(this.door.locked);
    this.ui.toast(this.door.locked ? 'FRONT DOOR LOCKED' : 'Front door unlocked', this.door.locked ? 'good' : '');
    // Only ever say anything once he is physically at the glass. Before
    // that, locking up is just a thing a clerk does, not a tell.
    const k = this.killer;
    if (k && (k.phase === KP.TRY_DOOR || k.phase === KP.APPROACH)) {
      this.ui.setObjective(this.door.locked ? 'THE DOOR IS HOLDING' : '', this.door.locked);
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
    // If the briefing ended without finishing, he has to be able to offer it
    // again -- otherwise the shift clock never starts.
    if (p && p === this.officer && !this.officerDone) {
      this.briefingStarted = false;
      if (p.state === 'BRIEF') { p.state = 'WAIT'; p.nagTimer = 4; }
    }
    if (this.state === ST.PLAY) this.input.requestLock();
  }
  talkToPerson(c) {
    if (c === this.officer) {
      if (this.officerDone || this.briefingStarted) {
        this.ui.toast(`${c.name}: "I've told you what I know."`, '');
      } else if (c.state === 'WAIT') {
        c.state = 'BRIEF';                 // you came to him; that will do
      } else {
        this.ui.toast(`${c.name}: "Hold on, son. Let me get inside."`, '');
      }
      return;
    }
    if (c.isKiller && this.killer.phase !== KP.CUSTOMER) { this.sound.error(); return; }
    c._prevState = c.state;
    c.state = CS.TALKING;
    this.beginDialogue(c, talkTo(c, this.ctx, { atCounter: !this.cannotServe(c) }));
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

  /**
   * Calling it in.
   *
   * Dispatch does not teleport a cruiser onto the forecourt the instant you
   * put the receiver down. Getting it right starts a clock; whether you are
   * alive when that clock runs out is a separate question, and the answer
   * is the reason there is a bolt on the back room.
   */
  accuse(target) {
    this.ui.hidePhone();
    this.phone.node = null;
    this.player.frozen = false;
    if (this.state === ST.PLAY) this.input.requestLock();
    this.sound.ringback();

    if (target.isKiller !== true) {
      this.player.frozen = true;
      this.flash = 0.5;
      setTimeout(() => {
        if (this.state !== ST.PLAY) return;
        this.ending('FIRED', {
          name: target.name,
          reason: describeInnocent(target, this.night.bulletin),
        });
      }, 1400);
      return;
    }

    const k = this.killer;
    const chasing = k && killerInside(k);
    /* Timed against the back room, deliberately. The bolt buys you roughly
       what the cruiser costs, so hiding while he is actually in the building
       is the right call and hiding while he is not is a hole in your shift
       that the queue at the counter will happily fill. */
    this.police = {
      called: true,
      target,
      eta: chasing ? 32 : killerActive(k) ? 30 : 26,
    };
    this.ui.toast(`Dispatch is rolling a unit. Stay on your feet.`, 'good');
    if (chasing) this.ui.setObjective('UNIT ON THE WAY\nSTAY ALIVE', true);
  }

  updatePolice(dt) {
    const P = this.police;
    if (!P || !P.called || P.eta <= 0) return;
    const before = P.eta;
    P.eta -= dt;
    // one spoken beat at the halfway mark, and the sirens before they arrive
    if (before > 18 && P.eta <= 18) {
      this.sound.siren();
      this.ui.toast(`Sirens, somewhere east of here.`, 'good');
    }
    if (P.eta <= 0) {
      P.eta = 0;
      this.ending('CAUGHT', {
        name: P.target.name,
        nights: this.nightNo,
        hid: this.hiding,
        broke: this.storage.broken,
        caseFile: this.night.caseFile,
      });
    }
  }

  /* ============================================================
     THE DEATH SHOT

     The old version of this was a white flash, a slow tilt toward the
     carpet, and a panel of text two seconds later. It read as a fade-out
     with an apology. What follows is built as a shot instead: the room is
     cut out from under the audio, the camera is whipped onto his face at
     arm's length, and then the tape itself starts coming apart -- the
     picture rolls, tears sideways off the head, flips negative, and the
     transport finally gives up and clunks to a stop.
     ============================================================ */
  beginDeath() {
    if (this.state === ST.ENDING) return;
    const k = this.killer;
    const e = k ? k.ent : null;
    this.death = {
      t: 0,
      ent: e,
      beat: 0,
      // where the camera whips to: his face, close enough to be a problem
      yaw0: this.player.yaw,
      pitch0: this.player.pitch,
    };
    if (e) {
      const h = ACTOR_HEIGHT * e.app.height.scale;
      this.death.headY = h * 0.93;
      // pull him the rest of the way in, so he fills the frame
      const dx = this.player.x - e.x, dz = this.player.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      e.x = this.player.x - (dx / d) * 0.52;
      e.z = this.player.z - (dz / d) * 0.52;
      e.yaw = Math.atan2(this.player.x - e.x, this.player.z - e.z);
      e.moveSpeed = 0;
    }
    this.sound.duckRoom(0.04);
    this.ending('ATTACKED', { name: e ? e.name : 'He', night: this.nightNo });
  }

  updateDeath(dt) {
    const D2 = this.death;
    if (!D2) return;
    const prev = D2.t;
    D2.t += dt;
    const t = D2.t;
    const e = D2.ent;
    const p = this.player;

    // aim: hard whip onto his face over the first fifth of a second
    if (e) {
      const tx = Math.atan2(e.x - p.x, e.z - p.z);
      const dy = (D2.headY || 1.6) - p.eye;
      const dd = Math.hypot(e.x - p.x, e.z - p.z) || 0.4;
      const tp = Math.atan2(dy, dd);
      const k = Math.min(1, dt * (t < 0.22 ? 34 : 9));
      p.yaw += angleDelta(p.yaw, tx) * k;
      p.pitch += (tp - p.pitch) * k;
      if (e.anim) {
        e.anim.lean = 0.34;
        e.anim.armL = -1.5; e.anim.armR = -1.35;
        e.anim.headPitch = -0.16;
      }
    }

    // the hit, once, on the frame the face lands
    if (prev < 0.10 && t >= 0.10) {
      this.sound.jumpscare();
      this.shake = 2.6;
      this.flash = 1;
    }
    // and the blows after it, while the picture is still being held together
    for (const at of [0.62, 1.02, 1.44]) {
      if (prev < at && t >= at) { this.sound.impact(1 - (at - 0.62) * 0.3); this.shake = Math.max(this.shake, 1.5); }
    }
    // the transport eating the tape, all the way down
    D2.chew = (D2.chew || 0) - dt;
    if (t > 0.5 && t < 3.4 && D2.chew <= 0) {
      D2.chew = 0.10 + Math.random() * 0.16;
      this.sound.tapeChew(Math.min(1, (t - 0.5) / 1.6));
    }
    if (prev < 3.35 && t >= 3.35) this.sound.tapeStop();

    // the camera going down with you
    if (t > 1.5) {
      const f = Math.min(1, (t - 1.5) / 1.9);
      p.eye = Math.max(0.28, EYE - f * 1.30);
      p.roll += (0.9 * f - p.roll) * Math.min(1, dt * 3);
      p.pitch -= dt * 0.5 * f;
    }
  }

  /** Post-processing overrides for the frames of the death shot. */
  deathFx() {
    const D2 = this.death;
    if (!D2) return null;
    const t = D2.t;

    /* Glitching in bursts rather than continuously.
       A first pass tore and rolled every single frame, which is a very
       loud way of showing the player nothing at all: the face never
       resolved and the whole thing read as coloured noise. The picture
       has to stay legible enough to be looked at. The damage comes in
       short bursts with clean, over-bright frames between them, and only
       takes the image over completely at the very end. */
    const burst = (period, width, seed) => {
      const ph = ((t * period) + seed) % 1;
      return ph < width ? 1 - ph / width : 0;
    };

    // 0.00-0.08  the room drops out and the frame goes black
    if (t < 0.08) return { fade: 1, grain: 4, ghost: 0, dark: 0.1 };

    const a = t - 0.08;

    // 0.08-0.55  the hit. His face, lit far too hard, held still enough
    //            to register, with the tape kicking twice underneath it.
    if (a < 0.47) {
      const g1 = Math.max(burst(4.5, 0.11, 0), burst(2.7, 0.07, 0.55));
      return {
        // one real negative strobe on the impact and almost none after it:
        // a frame you cannot read is a frame that is not frightening anybody
        invert: a < 0.055 ? 0.9 : 0,
        roll: g1 > 0.6 ? ((Math.random() - 0.5) * 70 * g1) | 0 : 0,
        tear: g1 * 0.4,
        warp: 1.0 + g1 * 4,
        grain: 20 + g1 * 34,
        ghost: 0.10,
        bleed: 2 + g1 * 3,
        distress: 0.4 + g1 * 0.5,
        // Enough push to be lurid, not so much that his face clips to white.
        // At 1.5 gain with a 1.5 red tint the whole shot was a flat orange
        // rectangle and you could not see what you were being shown.
        dark: 1.16 - g1 * 0.08,
        tintR: 1.38, tintG: 0.74, tintB: 0.70,
        scan: 0.62,
      };
    }

    // 0.55-2.2   held on him while the blows land. Still a picture, but a
    //            picture that keeps losing its footing.
    if (a < 2.1) {
      const f = (a - 0.47) / 1.63;
      const g2 = Math.max(burst(2.4, 0.18, 0.1), burst(5.1, 0.08, 0.6)) * (0.45 + f * 0.55);
      return {
        invert: g2 > 0.92 ? 0.85 : 0,
        roll: g2 > 0.35 ? ((Math.random() - 0.5) * (40 + f * 150) * g2) | 0 : 0,
        tear: g2 * (0.35 + f * 0.5),
        warp: 1.6 + g2 * 9,
        grain: 24 + f * 26 + g2 * 40,
        ghost: 0.22 + f * 0.2,
        bleed: 2 + g2 * 3,
        distress: 0.5 + g2 * 0.5,
        dark: 1.12 - f * 0.24,
        tintR: 1.34, tintG: 0.7 - f * 0.16, tintB: 0.66 - f * 0.16,
        scan: 0.64,
      };
    }

    // 2.2-3.4    now it goes. The head loses the track for good.
    if (a < 3.3) {
      const f = (a - 2.1) / 1.2;
      return {
        invert: Math.random() < 0.18 * f ? 1 : 0,
        roll: ((Math.random() - 0.5) * (60 + f * 420)) | 0,
        tear: 0.25 + f * 0.75,
        warp: 6 + f * 26,
        grain: 55 + f * 130,
        ghost: 0.5,
        bleed: 4 + f * 3,
        distress: 1,
        dark: Math.max(0, 0.95 - f * 0.95),
        tintR: 1.2, tintG: 0.46, tintB: 0.46,
        scan: 0.52,
      };
    }

    // and stop
    return { fade: 1, grain: 2, ghost: 0, dark: 0, distress: 0 };
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
    data.mode = this.mode;
    if (kind === 'CAUGHT') { this.sound.siren(); this.sound.chimeGood(); }
    if (kind === 'FIRED') { this.sound.siren(); this.sound.chimeBad(); }
    // ATTACKED runs its own soundtrack out of updateDeath()
    setTimeout(() => { if (this.state === ST.ENDING) this.ui.showPanel(endingHtml(kind, data)); },
      kind === 'ATTACKED' ? 4200 : 1600);
  }

  updateEnding(dt) {
    this.endTimer += dt;
    if (this.endKind === 'ATTACKED') {
      this.updateDeath(dt);
      this.distress = 1;
    }
    const gate = this.endKind === 'ATTACKED' ? 4.4 : 2.6;
    if (this.endTimer > gate && (this.input.hit('KeyE', 'Enter', 'Space') || this.input.mousePressed[0])) {
      this.ui.hidePanel(); this.ui.cinema(false);
      this.ui.showTitle(true); this.state = ST.TITLE; this.menuSel = 0; this.titleT = 0;
      this.death = null; this.shake = 0;
      this.player = createPlayer(); this.player.x = 6.4; this.player.z = 6.2;
      this.sound.setTension(0);
      this.sound.restoreRoom();
    }
  }

  endNight() {
    // anything still in your hands, on the counter or in the bin is a black mark
    this.stats.unshelved = this.player.held.length + this.bin.length
      + this.counterSlots.filter(Boolean).length + (this.rewinder.tape ? 1 : 0);
    this.stats.cashLoose = round2(this.player.cash.owed + this.player.changeInHand);
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
    if (this.mode === MODE.CASUAL) {
      note = this.rng.pick([
        `You locked up, you counted the drawer, and you went home. That is the whole job.`,
        `Nothing happened tonight. Nothing is supposed to happen tonight.`,
        `Somebody will have taken the good horror titles by Friday. They always do.`,
      ]);
    } else if (!this.night.deputy) {
      note = `Nobody from the county came by tonight. Nobody had anything to tell you.`;
    } else if (!k || (k.phase === KP.ABSENT && !k.seenAsCustomer)) {
      note = `Nobody came for you tonight. The deputy will be back tomorrow with less to go on.`;
    } else if (k.seenAsCustomer) {
      note = `Somebody in that store tonight matched the bulletin, and you let them walk out with a tape.`;
    } else {
      note = `Quiet night. That is not the same as a safe one.`;
    }
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
    /* Camera shake. Applied to the eye rather than the world so it survives
       everything downstream, and kept as a high-frequency jitter -- a slow
       wobble reads as a bad handheld, not as being hit. */
    const sk = this.shake || 0;
    let restore = null;
    if (sk > 0.001) {
      restore = { yaw: p.yaw, pitch: p.pitch, eye: p.eye, roll: p.roll };
      const a = sk * 0.055, t = this.time * 47;
      p.yaw += Math.sin(t * 1.7) * a + (Math.random() - 0.5) * a * 0.8;
      p.pitch += Math.cos(t * 2.3) * a * 0.8 + (Math.random() - 0.5) * a * 0.7;
      p.eye += Math.sin(t * 3.1) * a * 0.12;
      p.roll += Math.sin(t * 1.1) * a * 0.6;
    }
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
    if (restore) { p.yaw = restore.yaw; p.pitch = restore.pitch; p.eye = restore.eye; p.roll = restore.roll; }
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
    const tvTex = this.world.tvTextures;
    tvTex[this.world.tvMesh.screenSlot] = this.T.staticFrames[this.staticFrame];
    rz.drawMesh(this.world.tvMesh, M.m, { shade: L, textures: tvTex });

    // ---- doors ----
    const swing = this.door ? this.door.swing : 0;
    const dm = (this.door && this.door.locked) ? this.world.doorLockedMesh : this.world.doorOpenMesh;
    setPosYaw(M.m, DOOR_X0, 0, 0, swing);
    rz.drawMesh(dm, M.m, { shade: L * 0.95 });
    setPosYaw(M.m, DOOR_X1, 0, 0, Math.PI - swing);
    rz.drawMesh(dm, M.m, { shade: L * 0.95 });

    // ---- back room ----
    if (this.storage) {
      const st = this.storage;
      const sm = st.damage > 0 ? this.world.storageDoorHitMesh : this.world.storageDoorMesh;
      setPosYaw(M.m, SDOOR_X0, 0, D, -st.swing);
      rz.drawMesh(sm, M.m, { shade: Math.min(1.2, L * (0.9 + st.hitFlash * 0.9)) });
    }

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

    // ---- cash in your hand ----
    if (p.cash && (p.cash.tendered > 0.001 || p.changeInHand > 0.001)) {
      heldCashMatrix(p, M.m, Math.sin(p.bobPhase) * 0.6);
      rz.drawMesh(this.world.cashMesh, M.m, { shade: Math.min(1.1, lightAt(p.x, 1.2, p.z) * L * 1.15) });
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
    const nearPanic = k && (k.phase === KP.HUNT || k.phase === KP.BREACH || k.phase === KP.SIEGE)
      ? k.proximity : 0;
    /* With the tape switched off you get the console and the CRT it was
       plugged into -- dither, vignette, scanlines, vertex wobble -- and
       none of the things that belong to a worn VHS: no chroma bleed, no
       phosphor trail, no tracking damage. */
    const tape = this.opts.vhs;
    const base = {
      dt,
      dither: true,
      vhs: tape,
      bleed: tape ? 1 + (this.distress > 0.5 ? 1 : 0) : 0,
      scan: tape ? 0.80 : 0.90,
      ghost: tape ? 0.18 + this.distress * 0.12 : 0,
      grain: tape ? 8 + this.opts.grain * 14 + this.distress * 18 : 3,
      warp: tape ? this.distress * 1.5 + nearPanic * 2.2 : 0,
      fade: this.fade,
      flash: this.flash,
      dark: (1.06 + (L - 1) * 0.55) * (1 - nearPanic * 0.15),
      tintR: 1 + nearPanic * 0.25, tintG: 1 - nearPanic * 0.08, tintB: 1 - nearPanic * 0.05,
      distress: tape ? Math.min(1, this.distress + nearPanic * 0.5) * this.opts.grain * 1.4 : 0,
    };
    const death = this.state === ST.ENDING && this.endKind === 'ATTACKED' ? this.deathFx() : null;
    // the death shot still gets to wreck the picture; without the tape it
    // wrecks it the way a console losing sync would, not the way a tape does
    this.post.render(rz.color, death ? Object.assign(base, death, { dt, vhs: tape }) : base);
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
    const reading = !!c.reading;
    // reading pose: up in front of the chest, tilted back toward the face
    const lx = (reading ? 0.13 : 0.21 * c.app.build.w + 0.10) * hs;
    const ly = (reading ? 1.22 : 0.90) * hs;
    const lz = (reading ? 0.26 : 0.10 + reach) * hs;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const x = c.x + lx * cy + lz * sy;
    const z = c.z - lx * sy + lz * cy;
    const M = this._mats;
    setPosYaw(M.m, x, ly, z, c.yaw + (reading ? 0.12 : 0.3));
    const r = M.tmp; setRotX(r, reading ? 0.28 : 1.3); mul(M.m, M.m, r);
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
      get elapsed() { return g.sim; },
      get shiftClock() { return g.elapsed; },
      get doorLocked() { return g.door.locked; },
      get speaking() { return g.speaking; },
      // A thumb latch lets anyone already inside leave. The deadbolt is only
      // ever a problem for whoever is on the pavement.
      doorPassable: (who) => !g.door.locked || (!!who && who.z > 0.15),
      /* The clerk does not leave. There is a shift on, the till is open and
         the tapes are his problem until midnight -- and letting the player
         wander into the street turned the back half of the map into a place
         to stand and watch nothing happen. The doorway is a wall to him. */
      doorPassableForPlayer: () => false,
      /* Two different questions.
         The clerk has to physically open the door before he can walk
         through it. Anyone else just turns the handle -- which is the whole
         point of the bolt: pulling the door to behind you buys nothing, and
         a player who does only that has not actually hidden. */
      storagePassable: () => g.storage.broken || !g.storage.locked,
      storagePassableForPlayer: () => g.storage.broken || g.storage.open,

      /* --- sound / feedback --- */
      footstep: (c, heavy) => {
        const s = g.sound.spatial(g.player.x, g.player.z, g.player.yaw, c.x, c.z, heavy ? 16 : 11);
        if (s.gain > 0.02) g.sound.footstep(s.pan, heavy);
      },
      playerStep: (run) => g.sound.footstep(0, run),
      pushedExit: () => {
        if (g.time - (g._exitNagT || -99) < 6) return;
        g._exitNagT = g.time;
        g.ui.toast(g.door.locked
          ? `The bolt's thrown. You threw it.`
          : `Not until midnight. The store's yours till then.`, '');
      },
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
      putBack: (c) => {
        const s = g.sound.spatial(g.player.x, g.player.z, g.player.yaw, c.x, c.z);
        if (s.gain > 0.02) g.sound.shelve(true);
      },
      chose: (c) => {
        const s = g.sound.spatial(g.player.x, g.player.z, g.player.yaw, c.x, c.z);
        if (s.gain > 0.05) g.ui.toast(`${c.name} picked something out.`, '');
      },
      /** A recommendation ends the browsing then and there. */
      nudgeChoice: (c) => {
        if (c.browse) c.browse.visits = 0;
      },
      /** Being told you close soon makes them settle for whatever is in hand. */
      hurry: (c) => {
        if (c.browse) c.browse.visits = Math.min(c.browse.visits, c.browse.seen + 1);
        c.speed *= 1.12;
      },

      /* The rest of the room reacting to whoever is ruining it. Only people
         who are actually in the shop and can actually perceive it. */
      nuisanceGripe: (c) => {
        const near = g.customers.filter((o) => o !== c && !o.hidden
          && o.state !== CS.ARRIVING && o.state !== CS.GONE
          && Math.hypot(o.x - c.x, o.z - c.z) < 7.5);
        const lines = c.complaints || [];
        if (!lines.length) return;
        if (near.length) {
          const who = g.rng.pick(near);
          who.mood = Math.max(0, who.mood - 7);
          g.ui.toast(`${who.name}: "${g.rng.pick(lines)}"`, '');
          g.sound.blip(voicePitchOf(who.app), who.app.voice.rough);
        } else if (g.rng.chance(0.4)) {
          // nobody else in: the player gets it straight
          g.ui.toast(g.rng.pick(NUISANCE_SOLO[c.nuisance] || ['...']), '');
        }
      },

      grumble: (c) => {
        g.sound.blip(voicePitchOf(c.app), c.app.voice.rough);
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
      takeCash: (owed, c, why, exact) => g.takeCashFrom(owed, c, why, exact),
      cashInHand: () => g.player.cash.owed,
      changeInHand: () => g.player.changeInHand,
      giveChange: (c) => {
        const due = c.changeDue || 0;
        g.player.changeInHand = Math.max(0, round2(g.player.changeInHand - due));
        c.awaitingChange = false; c.changeDue = 0; c.changeTimer = 0;
        g.sound.paper();
        g.ui.toast(`Counted $${due.toFixed(2)} back to ${c.name}`, 'good');
      },
      keepChange: (c) => {
        const due = c.changeDue || 0;
        g.player.changeInHand = Math.max(0, round2(g.player.changeInHand - due));
        g.till = round2(g.till + due);
        g.stats.tips += due;
        c.awaitingChange = false; c.changeDue = 0; c.changeTimer = 0;
        g.sound.kaching();
        g.ui.toast(`${c.name} let you keep $${due.toFixed(2)}`, 'good');
      },
      needRegister: (unrung, due) => g.ui.toast(unrung
        ? `Ring it up at the register first — the change comes out of the drawer.`
        : `You need $${(due || 0).toFixed(2)} out of the drawer before you can pay them.`, 'bad'),
      stiffed: (c) => {
        g.stats.changeStiffed++;
        g.ui.toast(`${c.name} gave up on their change and left.`, 'bad');
        g.ui.toast(`$${(c.changeDue || 0).toFixed(2)} of theirs is still in your hand.`, 'bad');
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
        if (unpaid) { g.sound.registerBeep(); return null; }
        return g.takeCashFrom(tape.price, c, 'rental');
      },
      returnToShelf: (c) => { c.tape = null; g.ui.toast(`Tape goes back on the shelf.`, ''); },
      /** You pick something out for someone who cannot pick for themselves. */
      giveShelfPick: (c) => {
        const t = makeTape(g.rng.pick(GENRES), g.rng, { rewound: true });
        t.heldBy = c.id;
        return t;
      },

      /* --- suspect --- */
      killerIntel: (n) => addIntel(g.killer, n),
      notesKey: () => glyphText('notes'),
      learnBulletin: () => {
        const b = g.night.bulletin;
        for (const k of b.keys) b.known.add(k);
        g.sound.paper();
      },
      addBulletinDetail: (e) => {
        g.night.bulletin.known.add(e.key);
        g.ui.toast(`Added to your notes: ${e.key}`, '');
        g.sound.paper();
      },
      finishIntro: () => g.finishBriefing(),

      /* --- phone --- */
      phoneTargets: () => g.phoneTargets(),
      accuse: (t) => g.accuse(t),
      hangUp: () => g.hangUp(),

      /* --- killer beats --- */
      onKillerArrives: () => { },
      onKillerVanishes: () => { },
      /* The cues. Nothing here names him or tells you what to do about him
         until he is physically at the door, and even then it is one line.
         Up to that point the store just gets wrong: the strip lights sag,
         the hum in the ceiling cuts out, something scuffs the pavement. */
      onStalkBegins: () => {
        g.sound.stinger(0.42);
        g.flickerAmt = 0.85;
        g.sound.setLights(0.4);
      },
      onKillerMoves: () => { g.flickerAmt = Math.max(g.flickerAmt, 0.4); },
      onKillerApproaches: () => {
        g.sound.stinger(0.35);
        g.flickerAmt = Math.max(g.flickerAmt, 0.55);
      },
      onKillerAtDoor: () => { g.sound.doorOpen(0); },
      killerTriesHandle: () => {
        g.sound.noise({ filter: 'bandpass', freq: 800, q: 3, gain: 0.16, a: 0.002, d: 0.22 });
        g.ui.setObjective('THE HANDLE IS TURNING', true);
      },
      killerBangs: () => {
        g.sound.knock(2 + g.rng.int(3));
        g.ui.setObjective('THE DOOR IS HOLDING', true);
      },
      onKillerEnters: (broke) => {
        if (broke) {
          g.sound.glassBreak(); g.flash = 0.7;
          // the deadbolt is academic once the glass is on the pavement
          g.door.locked = false; g.door.forced = true;
        } else g.sound.doorChime(0);
        g.door.holdOpen = 2.2;
        g.flickerAmt = 1.0;
        g.ui.setObjective('HE IS INSIDE', true);
      },
      /* --- the back room --- */
      get playerHidden() { return g.hiding; },
      get storageDoorSpot() { return { x: (SDOOR_X0 + SDOOR_X1) / 2, z: D - 0.62 }; },
      get briefingDone() { return g.officerDone; },
      killerHitsStorage: (frac) => {
        const st = g.storage;
        st.damage = frac;
        st.hitFlash = 1;
        g.flash = Math.max(g.flash, 0.10 + frac * 0.16);
        g.sound.knock(1);
        g.sound.stinger(0.18 + frac * 0.3);
        g.shake = Math.max(g.shake || 0, 0.35 + frac * 0.5);
        if (frac > 0.55) g.ui.setObjective('IT IS NOT GOING TO HOLD', true);
      },
      storageGivesWay: () => {
        g.storage.broken = true;
        g.storage.locked = false;
        g.sound.glassBreak();
        g.flash = 0.85;
        g.shake = 1.4;
        g.ui.setObjective('', false);
      },
      onKillerAttacks: () => g.beginDeath(),
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
    // Nobody is coming in a casual shift, so nobody can be called in either
    // -- and getting fired for accusing a customer is not a thing that
    // belongs in the mode you picked to avoid all of that.
    if (this.mode === MODE.CASUAL) return [];
    const out = [];
    for (const c of this.customers) if (c.z > -0.5 && c.z < D) out.push(c);
    const k = this.killer;
    if (k && !k.ent.hidden) {
      if (k.phase === KP.CUSTOMER) { if (!out.includes(k.ent)) out.push(k.ent); }
      else if (killerActive(k)) {
        const e = k.ent;
        e.phoneLabel = killerInside(k)
          ? `THE ONE WHO JUST CAME THROUGH THE DOOR`
          : `The one out on the pavement`;
        out.push(e);
      }
    }
    return out;
  }
}

/* ---------------- helpers ---------------- */
const round2 = (v) => Math.round(v * 100) / 100;

/** Shortest signed way round from a to b. */
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* With nobody else in the shop, the nuisance is just yours to sit with. */
const NUISANCE_SOLO = {
  noise: [
    `The bass is coming up through the counter.`,
    `You can feel it in the tape racks.`,
    `Something on the shelf behind you is buzzing in sympathy.`,
  ],
  stench: [
    `It has reached the counter.`,
    `You breathe through your mouth for a while.`,
    `The smell has found the corner you are standing in.`,
  ],
  skunk: [
    `The whole front of the shop smells like a greenhouse fire.`,
    `That is going to be in the carpet tomorrow.`,
    `Your eyes water a little.`,
  ],
};

/* What he says while he is standing at your counter and you are not. */
const OFFICER_NAGS = [
  `Clerk? When you've got a minute.`,
  `I'll wait. I've got all the time in the world, apparently.`,
  `Whenever you're ready. This is county business.`,
  `Son. Over here.`,
  `Two minutes of your night. That's all I want.`,
];

/** Fresh state for the back-room door at the top of a shift. */
function freshStorageDoor() {
  return {
    open: false, locked: false, broken: false,
    swing: 0, target: 0,
    damage: 0, hitFlash: 0, hitTimer: 0,
  };
}

/** What people actually hand over: the smallest bill that covers it. */
function nextBill(owed) {
  for (const b of [1, 2, 5, 10, 20]) if (b >= owed - 0.001) return b;
  return Math.ceil(owed / 10) * 10;
}

function box(p) { return { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z0, z1: p.z1 }; }

/** Grow an interaction volume past the thing it belongs to. */
function pad(p, dx, dy, dz) {
  return { x0: p.x0 - dx, x1: p.x1 + dx, y0: p.y0 - dy, y1: p.y1 + dy, z0: p.z0 - dz, z1: p.z1 + dz };
}

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
