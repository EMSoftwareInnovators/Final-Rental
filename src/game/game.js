/* ============================================================
   game.js -- the shift itself. Owns the render loop, the night
   state machine, and every callback the customers, the dialogue
   and the killer reach back into.
   ============================================================ */
import { Raster } from '../engine/raster.js';
import { PostFX } from '../engine/postfx.js';
import { Input, PAD_ACTIONS, BINDABLE, normaliseBinds } from '../engine/input.js';
import { Sound } from '../engine/audio.js';
import { buildTextures } from '../engine/texture.js';
import { mat, mul, setPosYaw, setRotX, setRotY, setTranslate, invertRigid, clamp, angleTowards } from '../engine/mathx.js';
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
import { DialogueRunner, buildOfficerIntro, buildSweepReport, talkTo, buildPhoneCall } from './dialogue.js';
import { UI, howToHtml, optionsHtml, padHtml, reportHtml, endingHtml, glyph, glyphText, setScheme, setPadBinds } from './ui.js';
import { randomAppearance, paintSkin, voicePitchOf, pronounOf, describeApart, randomName } from './appearance.js';
import { OFFICER } from './personality.js';
import { GENRE_LABEL, GENRES, makeTape, tapeLabel, mediaWord } from './tapes.js';

const ST = {
  BOOT: 'BOOT', TITLE: 'TITLE', HOWTO: 'HOWTO', OPTIONS: 'OPTIONS', PADCFG: 'PADCFG',
  ESTABLISH: 'ESTABLISH', PLAY: 'PLAY', REPORT: 'REPORT', ENDING: 'ENDING', PAUSE: 'PAUSE',
  /* Are you sure. Quitting is the only thing in here that cannot be undone. */
  QUIT: 'QUIT',
};

const RES = [[256, 192, '256x192'], [320, 240, '320x240'], [400, 300, '400x300']];

/** Arm's length of a shelf run, and how long squaring a box away takes. */
/** The three who cost you minutes, and hold the shift clock while they do. */
/* The ones who cost you minutes rather than money. While any of them is
   in the building the shift clock waits, so getting rid of them is the
   player's time and the player's job rather than something to shrug at
   and let the night run out on.
   Note what this does NOT cover: the popcorn on the floor afterwards.
   He is free; his mess is not. */
const GRINDERS = { REEKER: true, SMOKER: true, SOVEREIGN: true, POPCORN: true };

const SHELVE_REACH = 1.05;
const SHELVE_TIME = 1.5;

/* How long somebody who was already inside at midnight gets to finish up
   before they give up and go home. Deliberately far longer than anything
   should take: it exists so a shift can always end, not to hurry anyone.
   Seven minutes of shop-floor time is several transactions' worth. */
const CLOSING_LIMIT = 420;

/* How far the phone flex goes, in metres from the cradle on the back
   counter. Enough for both service positions and the end of the counter;
   nothing like enough for the shop floor. */
const CORD_REACH = 4.6;

/* Whatever "interact" speaks, for the one action that is held down rather
   than tapped. Read off the binding table so it follows a rebind. */
const INTERACT_KEYS = PAD_ACTIONS.confirm.keys.concat(['KeyE']);

/* Her side of a call you only hear one half of. She came in loud and she
   does not stay loud, which is the whole shape of it. */
/* Where the kid puts the box down: the customer side of the counter, in
   front of the service window, so it is between the two of them. */
const PIZZA_DROP = { x: 10.75, z: 0.95 };

/* The machine will bury the shop if you let it, but not past the point
   where the frame rate is the horror. */
const MAX_SPILLS = 26;

/* A pile has to sit far enough off the furniture that the vacuum head can
   get to the middle of it. Slightly wider than the player's own radius. */
const SPILL_CLEAR = 0.34;

/* Where a line longer than the counter goes. Three rows across the front
   of the shop, clear of the aisles, which start at z 3.2. It doubles back
   on itself rather than running out of the building. */
const QUEUE_ROWS = [0.84, 1.78, 2.72];
const QUEUE_X0 = 2.00, QUEUE_X1 = 7.60, QUEUE_STEP = 0.86;

/* Where the vacuum stands in the back room. Against the shelf, by the
   door, exactly where it has stood since 1984. */
const VACUUM_HOME = { x: 5.15, z: 10.6, yaw: 0.4 };

const PIZZA_BYE = [
  `See? Was that so hard?`,
  `Told you. Told you it'd be quicker to just make it.`,
  `Appreciate it. You want to get some signs up, though.`,
  `Good pizza place, this. Slow, but good.`,
];

const MANAGER_CALL_BEATS = [
  `Yes — hello. Am I speaking to the regional manager? ...Right. Right.`,
  `No, the young man has been perfectly polite. That isn't what this is about.`,
  `It's the LOT. It's the lot and the alley behind it. There's no light back there at all.`,
  `Because a woman was followed to her car on this parade in March, that's why.`,
  `...No. No, I know it isn't his to fix. That's why I asked for you.`,
  `A light. One light, on the back of the building. That's the whole of it.`,
  `...You'll put it in writing. To the landlord. On Monday.`,
  `Well. Thank you. That's — thank you. I've been trying to say that to somebody for a month.`,
];

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
    this.padSel = 0;
    this.wantLock = false;
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
    this.sweep = null;
    /* The phone on the back counter, and how far its cord goes. */
    this.managerCall = null;
    this.pizza = null;
    /* The popcorn machine, what came out of it, and the thing in the back
       room that is the only way of dealing with what came out of it. */
    this.popper = { running: false, spilled: 0 };
    this.spills = [];
    this.puffs = [];
    this.bus = null;
    this.vacuum = { out: false, held: false, x: 0, z: 0, yaw: 0, running: false };
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

    /* Losing the pointer means the player alt-tabbed or hit Escape, and
       the shift should stop rather than carry on behind a window they are
       not looking at.

       It does NOT mean the lock we let go of on purpose, or one the
       browser refused to hand back. Hanging up the phone asks for the
       lock again, and a request made without a fresh user gesture is
       simply denied -- which arrived here as "the pointer is not locked"
       and paused the shift every time you put the receiver down. */
    this.input.onLockChange = (locked) => {
      const ours = this.time - (this._lockAskedT || -99) < 0.6;
      if (locked) { this.wantLock = true; return; }
      if (ours) return;
      if (this.state === ST.PLAY && !this.dlg.active && !this.phone.active) this.pause();
    };
    /* A pointer-lock request is only granted off the back of a user gesture,
       or shortly after the last one was released. The end of the
       establishing shot is neither -- by then the click that started the
       night is many seconds old -- so the request was quietly refused and
       the camera did not move for the whole shift. Whoever wants the lock
       says so, and the next keystroke or click, which IS a gesture, takes
       it. */
    this.input.onGesture = () => {
      if (!this.wantLock || this.input.locked) return;
      if (this.state !== ST.PLAY || this.dlg.active || this.phone.active) return;
      this.grabLock();
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
    if (!this.run) this.run = { calmUntil: 0, standDownNight: 0, arrests: 0 };
    const R = this.run;
    this.night = makeNight(this.seed, n, this.mode, {
      calm: n <= R.calmUntil,
      standDown: n === R.standDownNight,
    });
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
    this.closing = false;
    this.closingT = 0;
    this.closingClear = 0;
    this.walkInAt = 0;
    this.boombox = null;
    this.arrest = null;
    this.sound.boomboxStop();
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
    this.sweep = null;
    this.managerCall = null;
    this.pizza = null;
    /* The popcorn machine, what came out of it, and the thing in the back
       room that is the only way of dealing with what came out of it. */
    this.popper = { running: false, spilled: 0 };
    this.spills = [];
    this.puffs = [];
    this.bus = null;
    this.vacuum = { out: false, held: false, x: 0, z: 0, yaw: 0, running: false };
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
    this.wantLock = true;
    this.grabLock();
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  frame(now) {
    this.input.poll();
    if (this.input.scheme !== this._scheme) {
      this._scheme = this.input.scheme;
      setScheme(this._scheme);
      /* And which buttons those things are actually on, so the how-to
         page describes this player's pad rather than a copy of the
         default table somebody kept up to date by hand. */
      setPadBinds(this.input.bindsAreUser ? this.input.binds : null);
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
      case ST.PADCFG: this.updatePadMenu(dt); break;
      case ST.ESTABLISH: this.updateEstablish(dt); break;
      case ST.PLAY: this.updatePlay(dt); break;
      case ST.PAUSE: this.updatePause(dt); break;
      case ST.QUIT: this.updateQuitConfirm(); break;
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

  /**
   * A menu confirm.
   *
   * 'PadAny' is any pad button that is not bound to anything. On a pad the
   * standard mapping does not describe, that may well be the button under
   * the player's thumb -- and a menu is a safe place to let it through,
   * where nothing worse can happen than selecting the thing you were
   * already looking at.
   */
  confirmHit() {
    const i = this.input;
    if (i.hit('Enter', 'KeyE', 'Space')) return true;
    /* Every unbound button announces itself as PadAny, and menus accept it
       so that somebody whose pad the browser will not vouch for can still
       get through the front end with no working button. That escape hatch
       is only needed when there is no working button: with a bound confirm
       sitting right there, letting every spare shoulder button count as
       one meant LB resumed a paused game. */
    return !i.bindsFor('confirm').length && i.hit('PadAny');
  }

  /** Backing out of whatever is on screen: Escape, or B on a pad.
      Deliberately not the same test as pausing. Escape does both jobs on a
      keyboard because it is the only key there for either, but a pad has a
      Start button for pausing, so B is only ever a step backwards. */
  backHit() {
    return this.input.hit('Escape', 'UiBack');
  }

  /** The same, for the screens where clicking has always been allowed.
      The pause menu is deliberately not one of them. */
  confirmOrClick() {
    return this.confirmHit() || this.input.mousePressed[0];
  }

  /** Run something for its noise only. If it fails, the game carries on. */
  quietly(fn) {
    try { fn(); } catch (err) { this._audioDead = err; }
  }

  /** Redraw whatever panel is open so its button art matches the new device. */
  onSchemeChanged() {
    if (this.state === ST.HOWTO) this.ui.showPanel(howToHtml());
    else if (this.state === ST.OPTIONS) { this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(this.optSel); }
    else if (this.state === ST.PADCFG) this.showPadMenu();
    else if (this.state === ST.PAUSE) this.showPauseMenu();
    else if (this.state === ST.QUIT) this.showQuitConfirm(this.quitSel);
    this._promptCache = null;
  }

  /* Taking the pointer, and giving it back, on purpose.
     Both are stamped so onLockChange can tell a lock we asked about from
     one the player took away by alt-tabbing. */
  grabLock() { this._lockAskedT = this.time; this.input.requestLock(); }
  dropLock() { this._lockAskedT = this.time; this.input.exitLock(); }

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
    /* What the run knows that a single night does not. An arrest buys a few
       quiet nights, and the first of those is the one the deputy comes by to
       say so. After that visit he stays away until there is a reason. */
    this.run = { calmUntil: 0, standDownNight: 0, arrests: 0 };
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
    if (i.hit('ArrowUp', 'KeyW')) { this.menuSel = (this.menuSel + n - 1) % n; this.quietly(() => { this.sound.init(); this.sound.uiMove(); }); }
    if (i.hit('ArrowDown', 'KeyS')) { this.menuSel = (this.menuSel + 1) % n; this.quietly(() => { this.sound.init(); this.sound.uiMove(); }); }
    this.ui.titleSelect(this.menuSel);
    if (this.confirmOrClick()) {
      // Bringing the mixer up is the first thing a menu press does, and on a
      // pad there has been no click or keystroke to unlock audio with. If the
      // browser refuses, that is a silent title screen -- not a dead one.
      this.quietly(() => { this.sound.init(); this.sound.resume(); this.sound.uiSelect(); });
      items[this.menuSel]();
    }
  }

  optView() {
    return {
      sens: this.opts.sens, invert: this.opts.invert, vol: this.opts.vol,
      resLabel: RES[this.opts.res][2], snap: this.opts.snap, grain: this.opts.grain,
      vhs: this.opts.vhs,
      // Named here so a pad that behaves oddly can at least be identified.
      pad: this.input.padId,
      padNeedsSetup: !!this.input.padId && !this.input.padTrusted && !this.input.bindsAreUser,
    };
  }

  updatePanelMenu() {
    const i = this.input;
    if (this.state === ST.HOWTO) {
      if (this.confirmHit() || this.backHit()) {
        this.sound.uiBack();
        this.ui.hidePanel();
        if (this._fromPause) { this._fromPause = false; this.showPauseMenu(); }
        else this.state = ST.TITLE;
      }
      return;
    }
    const N = 9;
    const BACK = N - 1;
    const PADROW = N - 2;
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
    const back = this.backHit();
    if (this.confirmHit() || back) {
      if (this.optSel === BACK || back) {
        this.sound.uiBack();
        if (this._fromPause) { this._fromPause = false; this.showPauseMenu(); }
        else { this.ui.hidePanel(); this.state = ST.TITLE; }
      } else if (this.optSel === PADROW) {
        this.quietly(() => this.sound.uiSelect());
        this.state = ST.PADCFG; this.padSel = 0;
        this.input.cancelCapture();
        this.showPadMenu();
      } else if (TOGGLES[this.optSel]) {
        this.opts[TOGGLES[this.optSel]] = !this.opts[TOGGLES[this.optSel]];
        this.applyOptions(); this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(this.optSel);
      }
    }
  }

  /* ---------------- the controller screen ----------------
     Built so that it works with a pad whose buttons all do nothing, which
     is the only situation in which anybody needs it: the stick moves the
     highlight, and any button press binds itself to the highlighted line. */
  padView() {
    const i = this.input;
    return {
      name: i.padId, mapping: i.padMapping, count: i.padButtonCount,
      trusted: i.padTrusted, custom: i.bindsAreUser,
      down: i.padDownIndices.slice(),
      known: i.knownAs || '',
      /* Every axis, live. A pad we do not have a layout for keeps its
         d-pad somewhere unguessable -- on a hat, on a pair of axes, on
         four buttons -- and the only reliable way to find it is to watch
         the numbers move while somebody presses it. */
      axes: i.padAxes.map((v) => Math.round(v * 100) / 100),
      rows: BINDABLE.map((id) => ({
        id, label: PAD_ACTIONS[id].label,
        buttons: i.bindsFor(id),
        // what else that same button does, so sharing one is visible
        shared: i.bindsFor(id).flatMap((b) => i.actionsOn(b))
          .filter((a) => a !== id).map((a) => PAD_ACTIONS[a].label),
        capturing: i.capturing === id,
      })),
    };
  }

  showPadMenu() {
    this.ui.showPanel(padHtml(this.padView()));
    this.ui.panelSelect(this.padSel);
  }

  updatePadMenu() {
    const i = this.input;
    const N = BINDABLE.length + 2;          // the actions, plus reset and back
    const RESET = N - 2;
    const BACK = N - 1;
    const leave = () => {
      i.cancelCapture();
      this.quietly(() => this.sound.uiBack());
      this.state = ST.OPTIONS;
      this.ui.showPanel(optionsHtml(this.optView()));
      this.ui.panelSelect(this.optSel);
    };

    // The keyboard always works, whatever the pad is doing.
    if (this.backHit()) { leave(); return; }

    let moved = false;
    if (i.hit('ArrowUp', 'KeyW')) { this.padSel = (this.padSel + N - 1) % N; moved = true; }
    if (i.hit('ArrowDown', 'KeyS')) { this.padSel = (this.padSel + 1) % N; moved = true; }
    if (moved) {
      i.cancelCapture();
      this.quietly(() => this.sound.uiMove());
      this.showPadMenu();
      return;
    }

    if (this.padSel === RESET || this.padSel === BACK) {
      // Any button at all, plus the keyboard, works these two.
      if (this.confirmHit() || i.hit('PadAny') || i.hit('Enter')) {
        if (this.padSel === BACK) { leave(); return; }
        i.resetBinds();
        this.savePadBinds();
        this.quietly(() => this.sound.uiSelect());
        this.showPadMenu();
      }
      return;
    }

    /* An action line. Arm the capture, and the next button pressed becomes
       that action -- no working button required to get there. */
    const action = BINDABLE[this.padSel];
    if (i.capturing !== action) {
      i.capture(action);
      i.onCaptured = () => {
        i.onCaptured = null;
        this.savePadBinds();
        this.quietly(() => this.sound.uiSelect());
        if (this.state === ST.PADCFG) this.showPadMenu();
        this.onSchemeChanged();
      };
      this.showPadMenu();
    }
  }

  /** Bindings are the one setting worth remembering between sessions. */
  savePadBinds() {
    /* The how-to page names buttons off these, so it has to be told when
       they move -- otherwise rebinding sprint leaves the page describing
       where sprint used to be. */
    setPadBinds(this.input.bindsAreUser ? this.input.binds : null);
    try { localStorage.setItem('finalrental.padbinds', JSON.stringify(this.input.binds)); }
    catch (err) { /* private browsing, or no storage at all. Not fatal. */ }
  }

  loadPadBinds() {
    try {
      const raw = localStorage.getItem('finalrental.padbinds');
      if (!raw) return;
      const b = JSON.parse(raw);
      if (b && typeof b === 'object' && Object.keys(b).length) {
        // Saves from before a button could carry more than one job.
        this.input.binds = normaliseBinds(b);
        this.input.bindsAreUser = true;
        setPadBinds(this.input.binds);
      }
    } catch (err) { /* a corrupt entry just means the defaults */ }
  }

  applyOptions() {
    this.loadPadBinds();
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
      /* The same line every night, whatever tonight turns out to be.
         This used to say "the clock over the door has stopped again" on
         deputy nights and "shift ends at midnight" on the rest, which
         told the player before anybody had come through the door whether
         tonight was a night the killer might be working.

         And it is the doors that close at midnight, not the shift: whoever
         is inside when the bolt goes across is still yours to serve. */
      this.ui.toast(`Doors close at midnight.`, '');
    }
  }

  /* ============================================================
     PLAY
     ============================================================ */
  updatePlay(dt) {
    const i = this.input;

    // ---- pause / notepad ----
    /* Escape only, never the pad's back button. Pausing is Start's job;
       B pulling up the pause menu as well was the whole complaint. */
    if (i.hit('Escape')) { this.pause(); return; }
    // What there is to back out of during a shift is the notepad.
    if (this.notesOpen && this.backHit()) {
      this.notesOpen = false;
      this.ui.hideNotes();
      this.sound.paper();
    }
    /* Before the bulletin exists there is nothing on the page and nobody to
       compare anybody against, so the notepad simply is not a thing yet. */
    if (i.hit('Tab')) {
      if (!this.night.bulletin.known.size) {
        this.sound.error();
        /* One line either way. "Nothing to write down tonight" told the
           player no deputy was coming, which told them no killer was
           coming, which is the whole question the shift is asking. */
        this.ui.toast(`Nothing in the notebook yet.`, '');
      } else {
        this.notesOpen = !this.notesOpen;
        this.sound.paper();
        if (!this.notesOpen) this.ui.hideNotes();
      }
    }
    /* Putting down what you are carrying, wherever you happen to be
       looking.

       This used to live at the bottom of the interaction pass, which
       returns early twice before it -- once when the browser has not
       given us the pointer, and once when the reticle is not on anything.
       So pushing the vacuum across an empty stretch of floor and pressing
       drop did nothing at all, and neither did dropping a tape while
       looking at a wall. What is in your hands is not a question about
       what you are looking at. */
    if (i.hit('KeyG')) {
      if (this.vacuum.held) this.dropVacuum();
      else if (topTape(this.player)) this.dropHeld();
    }

    // Throwing the bolt is the one thing you may need to do without lining
    // up a crosshair first, so it gets its own key anywhere in the room.
    /* The from-anywhere bolt. If the reticle is already on the door then
       interacting with it does the same job, and on a pad where one button
       carries both that would toggle it twice and leave it as it was. */
    const onDoor = this.hover && this.hover.kind === 'storage';
    if (i.hit('KeyF') && !onDoor && this.player.z > D + 0.05 && !this.storage.broken) {
      if (this.storage.locked) this.toggleStorage(); else this.lockStorage();
    }

    const talking = this.dlg.active || this.phone.active;
    this.player.frozen = talking;

    // ---- conversation input ----
    if (talking) this.updateConversation();

    // ---- clocks ----
    this.sim += dt;
    /* The clock also stops while one of the three who will not be told is
       still in the building. They cost minutes, and charging those minutes
       to the shift made the right play "ignore him and eat the smell" --
       which is not a decision, it is a shrug. Getting rid of him is now the
       player's job, on the player's time, and the shift resumes when the
       door shuts behind him. */
    /* A deputy who has walked in to tell you the parade was empty is
       not the player's doing, so the shift does not pay for the walk to
       the counter and the conversation. Same rule as the briefing. */
    const holdClock = killerActive(this.killer) || !this.officerDone
      || this.grinderPresent() || this.sweepPresent() || this.managerBusy() || this.pizzaPending();
    if (!holdClock) this.elapsed += dt;
    this.updatePolice(dt);

    // ---- systems ----
    this.updateDoor(dt);
    /* Everything that MOVES runs in sub-steps.

       A frame's dt is capped at a tenth of a second and then multiplied by
       timeScale, so a fast-forward hands the simulation whole seconds at a
       time. Walking is integrated per step and arrival is "within 16cm of
       the waypoint" -- give that a six second step and a customer covers
       eight metres in one go, sails past the waypoint, gets pushed back off
       a wall, and oscillates around the doorway forever without ever
       arriving. A shop full of people who cannot find the exit is what that
       looks like from the outside.

       Input, the HUD and the interaction ray stay at one per frame: they
       read edges, and running them per sub-step would fire every keypress
       several times over. */
    const SUB = 1 / 30;
    let remain = dt;
    while (remain > 0.0001) {
      const h = Math.min(remain, SUB);
      remain -= h;
      updatePlayer(this.player, h, i, this.ctx);
      this.updateRewinder(h);
      this.updateOfficer(h);
      this.updateSweep(h);
      this.updateHandedPhone(h);
      this.updatePizza(h);
      this.updatePopper(h);
      this.updatePuffs(h);
      this.updateBus(h);
      this.updateVacuum(h);
      for (const c of this.customers) if (!c.hidden) updateCustomer(c, h, this.ctx);
      this.customers = this.customers.filter((c) => c.state !== CS.GONE);
      updateKiller(this.killer, h, this.ctx);
      this.swingForKiller();
      this.checkKillerProximity();
    }
    this.updateArrest(dt);
    // Once a frame, not once a sub-step: this decides whether somebody new
    // walks in, which is not something to integrate thirty times over.
    this.spawnDue();
    this.updateObservation(dt);
    this.updateAtmosphere(dt);
    this.updateBoomboxAudio();

    // ---- interaction ----
    if (!talking) this.updateInteraction();
    else this.ui.setPrompt('');

    // ---- HUD ----
    this.ui.setClock(clockString(this.elapsed, this.night.length), this.nightNo, holdClock);
    this.ui.setTill(this.till);
    this.ui.setHands(this.player.held, this.rewinder, this.player, this.changeOwedOut(), this.vacuum);
    if (this.notesOpen) this.ui.showNotes(this.night.bulletin, this.player.lookTarget);

    // ---- night end ----
    this.updateClosing(dt, holdClock, talking);
  }

  /**
   * Midnight, and what still has to happen before you can go home.
   *
   * The clock reaching the end of the shift used to end the night on the
   * spot, mid-sentence, with three people in the queue and a tape still in
   * the rewinder. Midnight is a lock on the door instead, and only that:
   * nobody else comes in, and the shift is not over until the last customer
   * is out of the building one way or another and every tape is back in a
   * run.
   */
  updateClosing(dt, holdClock, talking) {
    if (this.elapsed < this.night.length || holdClock) return;

    if (!this.closing) {
      this.closing = true;
      this.closingT = 0;
      this.door.locked = true;
      this.sound.chimeGood();
      this.ui.toast(`Midnight. Door's shut.`, '');
      this.ui.toast(`Nobody else comes in. Everyone already here still gets served.`, '');
    }
    this.closingT += dt;

    /* Midnight turns the sign round; it does not clear the room.

       This used to march the whole shop out at the stroke of twelve, which
       meant a woman four feet from the counter with a tape in her hand and
       her money out got turned round and sent home, and the last minutes of
       a shift were spent watching people you had been serving all night
       file past you. Anybody who was inside before the bolt went across
       still gets to pick something out and pay for it.

       All they are told is that the shop is shutting, which makes them
       settle for the aisle they are already standing in rather than doing
       another lap. After that they finish in their own time, and they leave
       when they are done, the way they would have anyway. */
    for (const c of this.customers) {
      if (c.hidden || c.state === CS.GONE || c.state === CS.LEAVING) continue;
      if (!c._toldClosing) { c._toldClosing = true; c._closingT = 0; this.ctx.hurry(c); }
      c._closingT = (c._closingT || 0) + dt;
      /* A backstop and nothing else. Every state a customer can be in has
         its own way out, so this should never fire -- but a shift that
         cannot end because one person is wedged in an aisle is worse than
         one customer going home unserved, and the player is not owed an
         unwinnable room at half past midnight. */
      if (c._closingT > CLOSING_LIMIT) {
        if (c.tape && !c.checkedOut && c.script !== 'return') this.ctx.abandonTape(c);
        this.ctx.leave(c);
        this.ui.toast(`${c.name} gave up waiting and left.`, 'bad');
      }
    }

    /* "Out of the shop" means out through the front door, not gone from the
       simulation. They carry on down the pavement afterwards, well out of
       the window, and the shift used to sit there waiting for that -- a
       silent half minute staring at an empty room. */
    const inside = this.customers.filter((c) => !c.hidden && c.state !== CS.GONE && c.z > 0.15);
    const strays = this.strayMedia();
    /* You do not lock up on a floor covered in popcorn with the machine
       still running. That is tomorrow's problem only if there is a
       tomorrow, and there is a man in this town who makes that a real
       question. */
    const mess = this.spills.length;
    const popping = this.popper.running;

    if (inside.length || strays.n || mess || popping) {
      this.closingClear = 0;
      const bits = [];
      if (inside.length) bits.push(`${inside.length} still in the shop`);
      if (strays.n) bits.push(`${strays.n} ${strays.word} not shelved`);
      if (popping) bits.push(`the popper is still on`);
      if (mess) bits.push(`popcorn all over the floor`);
      this.ui.setObjective(`CLOSING — ${bits.join(' · ')}`, this.closingT > 60);
      return;
    }
    if (talking) return;

    // Empty and tidy. Give it a few seconds, then lock up.
    this.closingClear = (this.closingClear || 0) + dt;
    const LOCK_UP = 4;
    if (this.closingClear < LOCK_UP) {
      this.ui.setObjective(`CLOSING — LOCKING UP`);
      return;
    }
    this.ui.setObjective('');
    this.endNight();
  }

  /**
   * What is still out of its run, and what to call it.
   *
   * A cartridge is not a tape and the shift should not say it is, so this
   * counts them separately and picks the word that covers what is actually
   * lying about.
   */
  strayMedia() {
    const out = this.player.held
      .concat(this.bin, this.counterSlots.filter(Boolean), this.rewinder.tape ? [this.rewinder.tape] : []);
    const games = out.filter((t) => t && t.game).length;
    const tapes = out.length - games;
    const word = games && tapes ? 'items'
      : games ? (games === 1 ? 'cartridge' : 'cartridges')
        : (tapes === 1 ? 'tape' : 'tapes');
    return { n: out.length, games, tapes, word };
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
    this.wantLock = false;
    this.dropLock();
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

  /**
   * Asking twice before throwing a shift away.
   *
   * Quitting from the pause menu is one button away from resuming, and it
   * is the only thing in the game you cannot undo -- the night goes, and
   * whatever you had worked out about who is in the shop goes with it. It
   * asks first, and the cursor starts on "no".
   */
  showQuitConfirm(sel = 0) {
    this.state = ST.QUIT;
    this.quitSel = sel;
    this.ui.showPanel(`<h2>QUIT TO TITLE?</h2>
      <p class="quiet">Tonight's shift ends here. Night ${this.nightNo} will not be finished, and what you have written down goes with it.</p>
      <ul><li class="opt sel">No &mdash; back to the shift</li><li class="opt">Yes, quit</li></ul>
      <p class="pad-foot">${this.ui.keyHint('confirm')} select &nbsp;&middot;&nbsp; ${this.ui.keyHint('back')} back</p>`);
    this.ui.panelSelect(this.quitSel);
  }

  updateQuitConfirm() {
    const i = this.input;
    const N = 2;
    if (i.hit('ArrowUp', 'KeyW')) { this.quitSel = (this.quitSel + N - 1) % N; this.sound.uiMove(); }
    if (i.hit('ArrowDown', 'KeyS')) { this.quitSel = (this.quitSel + 1) % N; this.sound.uiMove(); }
    this.ui.panelSelect(this.quitSel);
    /* Backing out of the question is the same as saying no. */
    if (this.backHit()) {
      this.quietly(() => this.sound.uiBack());
      this.pauseSel = 2;
      this.showPauseMenu();
      return;
    }
    if (!this.confirmHit()) return;
    this.quietly(() => this.sound.uiSelect());
    if (this.quitSel === 0) { this.pauseSel = 2; this.showPauseMenu(); return; }
    this.quitToTitle();
  }

  /** Put the whole night down and go back to the front screen. */
  quitToTitle() {
    this.dlg.node = null; this.phone.node = null; this._heldTalk = null; this.speaking = null;
    this.ui.hidePanel(); this.ui.hideDialogue(); this.ui.hidePhone(); this.ui.hideNotes();
    this.ui.setHudVisible(false); this.ui.cinema(false); this.ui.showTitle(true);
    this.state = ST.TITLE; this.menuSel = 0; this.titleT = 0;
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
      this.wantLock = true;
      this.grabLock();
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
    if (this.backHit()) { this.resume(); return; }
    if (this.confirmHit()) {
      this.quietly(() => this.sound.uiSelect());
      if (this.pauseSel === 0) this.resume();
      else if (this.pauseSel === 1) { this.state = ST.OPTIONS; this.optSel = 0; this.ui.showPanel(optionsHtml(this.optView())); this.ui.panelSelect(0); this._fromPause = true; }
      /* Not straight out. It is the one thing in here you cannot take
         back, and it sits one row under "back to the counter". */
      else this.showQuitConfirm();
    }
  }

  /* ---------------- doors ---------------- */
  updateDoor(dt) {
    const d = this.door;
    d.holdOpen = Math.max(0, d.holdOpen - dt);
    if (d.holdOpen <= 0) d.fromInside = false;
    /* A thrown deadbolt stops people getting IN. It does not stop anybody
       already inside working the thumb latch and walking out -- and the
       leaves have to swing when they do, or the shop empties at closing
       time with everybody walking through a shut door. The rule the doors
       are drawn by and the rule people are moved by are the same rule. */
    d.target = (d.holdOpen > 0 && (!d.locked || d.fromInside)) ? 1.25 : 0;
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
    /* Whatever else is in there, the vacuum is in there. It only becomes
       a thing in the world once somebody has had that door open. */
    if (!s.locked || s.open) this.revealVacuum();
    if (s.locked) {
      s.locked = false; s.open = true;
      this.sound.lockClick(false);
      this.ui.toast('Back room unlocked', '');
      this.revealVacuum();
      return;
    }
    if (s.open) {
      s.open = false;
      this.sound.doorOpen(0);
      return;
    }
    s.open = true;
    this.sound.doorOpen(0);
    this.revealVacuum();
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
    /* A little slack on the radius. The window is one spot but a person is
       not a point, and somebody who has come round the end of the counter
       can settle a few inches off it without having failed to arrive. */
    const atWindow = c.queueIndex === 0
      && (c.state === CS.WAITING || c.state === CS.TO_COUNTER)
      && Math.hypot(c.x - SPOTS.service.x, c.z - SPOTS.service.z) < 1.45;
    if (atWindow) return '';
    if (c.queueIndex > 0) return 'waiting in line';
    return 'not at the counter';
  }

  /**
   * Is one of the ones who will not be told still in here?
   *
   * The arguer, the smell and the man at the television. Somebody on their
   * way out through the door does not count -- the clock starts again the
   * moment the last of them is leaving, not when they finish crossing the
   * pavement.
   */
  grinderPresent() {
    for (const c of this.customers) {
      if (!GRINDERS[c.special] || c.hidden) continue;
      if (c.state === CS.LEAVING || c.state === CS.GONE) continue;
      return true;
    }
    return false;
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
    this.ui.toast(`Clock's running. Doors close at midnight.`, '');
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
    // Once the door is shut for the night nobody else comes in.
    if (this.closing) return;
    for (const s of this.night.schedule) {
      if (s.spawned || this.sim < s.t) continue;
      s.spawned = true;
      if (this.customers.length > 5) { s.t = this.sim + 12; s.spawned = false; continue; }
      const rng = this.rng;
      if (s.special) {
        const sp = specialById(s.special);
        if (sp && sp.id === 'PIZZA') {
          /* He does not walk in. He rings first, from the payphone
             outside the laundrette, and turns up afterwards. */
          this.beginPizzaCall(sp);
          continue;
        }
        if (sp) { this.customers.push(makeSpecial(rng, sp)); continue; }
      }
      let app;
      if (s.decoy) app = makeDecoyAppearance(rng, this.night.suspect, this.night.bulletin.keys, s.forced);
      else app = sanitizeInnocent(rng, randomAppearance(rng), this.night.suspect, this.night.bulletin.keys);
      const c = createCustomer(rng, { app, intent: s.intent, wantGenre: s.genre });
      this.customers.push(c);
    }
    /* And when the rota runs dry, people keep turning up anyway, because a
       video shop at half eleven on a Friday is not empty. The planned rota
       is what the night is built around -- the decoys, the specials, the
       one who might be him -- and this is the ordinary traffic on top of
       it, right up to the moment the door is shut. */
    this.walkInAt = this.walkInAt || 0;
    if (this.officerDone && this.sim >= this.walkInAt
      && this.night.schedule.length && this.night.schedule.every((s) => s.spawned)
      && this.customers.length <= 4) {
      const rng = this.rng;
      this.walkInAt = this.sim + rng.range(16, 38);
      const app = sanitizeInnocent(rng, randomAppearance(rng), this.night.suspect, this.night.bulletin.keys);
      this.customers.push(createCustomer(rng, {
        app, intent: rng.chance(0.42) ? 'RETURN' : 'RENT', wantGenre: rng.pick(GENRES),
      }));
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
    /* The vacuum is reachable from whichever side of that wall it is
       actually standing on. It lives in the back room, and the back-room
       branch below used to list the door and the people in there and
       nothing else -- so the one object in the building that deals with a
       floor full of popcorn could not be picked up, from any angle, ever. */
    const v = this.vacuum;
    const vacTarget = (v.out && !v.held)
      ? { kind: 'vacuum', aabb: { x0: v.x - 0.40, x1: v.x + 0.40, y0: 0, y1: 1.15, z0: v.z - 0.40, z1: v.z + 0.40 } }
      : null;

    if (inBackRoom) {
      t.push({ kind: 'storage', aabb: { x0: SDOOR_X0 - 0.25, x1: SDOOR_X1 + 0.25, y0: 0.2, y1: 2.0, z0: D - 0.45, z1: D + 0.45 } });
      if (vacTarget && v.z > D) t.push(vacTarget);
      for (const c of this.people()) {
        if (c.hidden || c.z < D) continue;
        const h = ACTOR_HEIGHT * c.app.height.scale;
        t.push({ kind: 'person', c, cyl: { x: c.x, z: c.z, r: 0.46, y0: 0.05, y1: Math.max(h + 0.30, 1.90) } });
      }
      return t;
    }
    if (vacTarget && v.z <= D) t.push(vacTarget);
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
    /* The cart itself, so there is something to switch off, and the
       vacuum wherever it happens to be standing. */
    t.push({ kind: 'popper', aabb: { x0: 12.14, x1: 13.0, y0: 0.8, y1: 1.9, z0: 5.70, z1: 6.62 } });

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
    if (this.sweep && !this.sweep.hidden) out.push(this.sweep);
    if (this.pizza && this.pizza.driver && !this.pizza.driver.hidden) out.push(this.pizza.driver);
    if (this.killer && !this.killer.ent.hidden) out.push(this.killer.ent);
    if (this.arrest && this.arrest.deputy && !this.arrest.deputy.hidden) out.push(this.arrest.deputy);
    return out;
  }

  updateInteraction() {
    /* If the browser has not given us the pointer, looking around does not
       work, and a dead camera with no explanation is the worst possible
       version of that. Say so, and the next click takes it. */
    if (this.wantLock && !this.input.locked && this.input.scheme === 'kbm') {
      this.hover = null;
      this.ui.setReticle(false);
      this.ui.setPrompt(`Click to look around`);
      if (this.hold) { this.hold = null; this.ui.setHold(0); }
      return;
    }
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
      case 'popper': {
        if (this.popper.running) {
          prompt = `${K()}Switch the popper off\n<span class="sub">it is still going</span>`;
          act = () => this.stopPopper();
        } else if (this.spills.length) {
          prompt = `<span class="sub">POPCORN MACHINE - off. The floor is another matter</span>`;
        } else {
          prompt = `<span class="sub">POPCORN MACHINE</span>`;
        }
        break;
      }
      case 'vacuum': {
        prompt = `${K()}Take the vacuum`;
        act = () => this.takeVacuum();
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
          /* Shut, and you are on the inside of it. Interact opens the
             door, the way interact opens every other door in the
             building. Bolting it is its own verb on its own key.

             It used to be the other way round -- the only thing this
             offered was the bolt -- so getting back out to the counter
             meant bolting yourself in and then unbolting, and there was
             no way to simply open the door you were standing behind. */
          prompt = `${K()}Open the back room door`
            + `\n<span class="sub">${glyph('bolt')} throws the bolt instead</span>`;
          act = () => this.toggleStorage();
        } else {
          prompt = `${K()}Open the back room`;
          act = () => this.toggleStorage();
        }
        break;
      }
      case 'person': {
        const c = tgt.c;
        /* The receiver is live and she is the one who asked for it. That
           beats anything else you could say to her -- and there is nothing
           else you could say to her that helps. */
        const MC = this.managerCall;
        if (MC && MC.connected && !MC.handedTo && c.special === 'MANAGER') {
          const near = this.cordReaches(c);
          prompt = near
            ? `${K()}Hand ${c.name} the phone\n<span class="sub">the regional manager is on the line</span>`
            : `<span class="sub">the cord will not reach ${c.name}</span>`;
          if (near) act = () => this.handOverPhone(c);
          break;
        }
        const m = c === this.officer ? null : moodLabel(c);
        const why = this.cannotServe(c);
        prompt = `${K()}Talk to ${c.name}`
          + (why ? `\n<span class="sub">${why}</span>` : (m ? `\n<span class="sub">${m.text}</span>` : ''));
        act = () => this.talkToPerson(c);
        break;
      }
      default: break;
    }
    if (held && tgt.kind !== 'shelf') {
      prompt += `\n<span class="sub">${glyph('drop')}put the ${mediaWord(held)} down</span>`;
    }
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
      /* Both hands are on the vacuum. Interact is its throttle while you
         are pushing it and nothing else -- holding it down to clean the
         run behind the counter used to pick up the telephone on the way
         past, because the first frame of that hold is also a press. */
      if (act && !this.vacuum.held
        && (this.input.hit('KeyE') || this.input.mousePressed[0])) act();
    }
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
    this.dropLock();
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
    if (this.state === ST.PLAY) { this.wantLock = true; this.grabLock(); }
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
    /* Read the gate BEFORE putting them into a conversation. cannotServe()
       waves through anyone already talking -- so that an open conversation
       is not re-gated line by line -- which meant asking it after setting
       TALKING always answered "yes, serve them", from anywhere in the shop. */
    const servable = !this.cannotServe(c);
    c._prevState = c.state;
    c.state = CS.TALKING;
    this.beginDialogue(c, talkTo(c, this.ctx, { atCounter: servable }));
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
    this.dropLock();
  }
  hangUp() {
    this.phone.node = null;
    this.ui.hidePhone();
    this.player.frozen = false;
    this.sound.phoneHang();
    if (this.state === ST.PLAY) { this.wantLock = true; this.grabLock(); }
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
    if (this.state === ST.PLAY) { this.wantLock = true; this.grabLock(); }
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
      this.killerHearsSirens();
    }
    if (P.eta <= 0) {
      P.eta = 0;
      if (P.fled) {
        /* Nothing to arrest. A man who walks out before the cruiser turns
           the corner is a man the county cannot do anything about.

           It used to end there, on two lines of text over an empty shop,
           which made getting it right feel like getting it wrong. A deputy
           comes in and says it to your face now. */
        this.police = null;
        this.ui.setObjective('');
        this.beginSweep();
        return;
      }
      this.beginArrest(P.target);
    }
  }

  /**
   * He hears the sirens too.
   *
   * Somebody who is already coming for you does not stop for a siren -- if
   * anything it puts a clock on him. Everybody else takes a view: walk out
   * now while there is still a street to walk out into, go still somewhere
   * in the building and let them sweep past, or decide there is no point in
   * being careful any more.
   */
  killerHearsSirens() {
    const k = this.killer;
    const P = this.police;
    if (!k || !P || P.reacted) return;
    P.reacted = true;
    if (!k.plan.appears || k.phase === KP.ABSENT) return;

    // Already in the building and working: he finishes what he started.
    if (k.phase === KP.HUNT || k.phase === KP.SIEGE || k.phase === KP.ATTACK) {
      this.ui.toast(`Something in the back gets faster, not quieter.`, 'bad');
      return;
    }

    const roll = this.rng();
    if (roll < 0.34) {
      // Gone. Out the door and down the parade before the lights arrive.
      P.fled = true;
      k.phase = KP.ABSENT;
      k.ent.hidden = true;
      k.fled = true;
      this.door.holdOpen = 1.1;
      this.sound.doorChime();
      this.ui.toast(`The chime goes. Whoever was in here just left.`, '');
      this.ui.setObjective('');
      return;
    }
    if (roll < 0.64) {
      // Gone to ground. They will find him, but it takes them longer.
      P.eta += 26 + this.rng.range(0, 10);
      P.hidden = true;
      k.phase = KP.GONE_QUIET;
      this.ui.toast(`Everything goes quiet. Too quiet to be nobody.`, 'bad');
      this.ui.setObjective('UNIT SEARCHING\nSTAY WHERE THEY CAN SEE YOU', true);
      return;
    }
    // He decides there is no longer any reason to be careful.
    k.phase = KP.HUNT;
    if (k.ent) k.ent.hidden = false;
    this.sound.impact();
    this.ui.toast(`Something stops pretending.`, 'bad');
    this.ui.setObjective('UNIT ON THE WAY\nSTAY ALIVE', true);
  }

  /* ============================================================
     THE ARREST

     The cruiser used to arrive as a line of text. It arrives as a man now:
     a deputy comes through the front door, crosses the shop, puts him
     against the nearest flat surface, cuffs him, and walks him out past
     you. The clerk stands where he is and watches it happen, which is the
     whole of his part in it.
     ============================================================ */
  beginArrest(target) {
    if (this.arrest) return;
    const k = this.killer;
    const e = (k && k.ent && !k.ent.hidden) ? k.ent : target;
    // If he is not physically in the shop, there is nobody to put cuffs on.
    if (!e || e.hidden || e.z > D || e.z < -1) {
      this.finishArrest(target, { offscreen: true });
      return;
    }
    const app = this.night.officerApp || (this.officer && this.officer.app);
    const deputy = {
      id: -2, name: `Deputy ${this.night.officerName ? this.night.officerName.split(' ')[1] : 'Hollis'}`,
      app, skin: paintSkin(app), personality: OFFICER,
      x: SPOTS.door.x + 0.4, y: 0, z: -0.8, yaw: 0, r: 0.30,
      anim: makeAnim(), speed: 1.9, moveSpeed: 0, observed: new Set(),
      mood: 100, phoneLabel: 'The deputy', isKiller: false, hidden: false,
    };
    this.arrest = { phase: 'IN', t: 0, deputy, ent: e, target, path: null, pathI: 0 };
    e.leaving = false;
    e.rushing = false;
    this.door.holdOpen = 2.4;
    this.door.fromInside = true;
    this.sound.doorChime();
    this.sound.siren();
    this.player.frozen = true;
    this.ui.setPrompt('');
    this.ui.setObjective('');
    this.ui.toast(`${deputy.name} comes through the door.`, 'good');
    if (k) { k.phase = KP.CAUGHT; k.frozen = true; }
  }

  updateArrest(dt) {
    const A = this.arrest;
    if (!A) return;
    A.t += dt;
    const d = A.deputy, e = A.ent;
    const walk = (tx, tz, speed) => {
      const dx = tx - d.x, dz = tz - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) { d.moveSpeed = 0; return true; }
      const step = Math.min(dist, speed * dt);
      d.x += (dx / dist) * step;
      d.z += (dz / dist) * step;
      d.moveSpeed = step / Math.max(dt, 0.0001);
      d.yaw = angleTowards(d.yaw, Math.atan2(dx, dz), dt * 8);
      return false;
    };
    updateAnim(d.anim, dt, d.moveSpeed, d.app);

    switch (A.phase) {
      case 'IN': {
        /* Straight at him, at a pace that is not a stroll, stopping an
           arm's length short. The stand-off point is measured along the
           deputy's own approach rather than off the man's facing -- he
           turns to face the deputy as he comes, so a point behind him
           walks away around the circle and never gets stood on. */
        const ax = d.x - e.x, az = d.z - e.z;
        const ad = Math.hypot(ax, az) || 1;
        if (walk(e.x + (ax / ad) * 0.62, e.z + (az / ad) * 0.62, 2.2)) {
          A.phase = 'CUFF'; A.t = 0;
          this.sound.impact(0.5);
          this.ui.toast(`"Hands. HANDS."`, 'good');
        }
        e.moveSpeed = 0;
        e.yaw = angleTowards(e.yaw, Math.atan2(d.x - e.x, d.z - e.z), dt * 4);
        break;
      }
      case 'CUFF': {
        // arms pulled back, head down, and the ratchet twice
        const k = Math.min(1, A.t / 0.8);
        e.moveSpeed = 0;
        e.anim.armL = 0.95 * k; e.anim.armR = 0.95 * k;
        e.anim.armLz = -0.55 * k; e.anim.armRz = 0.55 * k;
        e.anim.lean = 0.30 * k;
        e.anim.headPitch = 0.45 * k;
        d.anim.armL = -0.85 * k; d.anim.armR = -0.85 * k;
        if (!A.clicked && A.t > 0.9) { A.clicked = true; this.sound.registerBeep(); }
        if (A.t > 1.9) {
          A.phase = 'OUT'; A.t = 0;
          e.cuffed = true;
          this.ui.toast(`${A.target.name} does not resist.`, 'good');
        }
        break;
      }
      case 'OUT': {
        // walked out in front of the deputy, still cuffed
        const tx = SPOTS.door.x, tz = -2.2;
        const ex = e.x, ez = e.z;
        const dx = tx - ex, dz = tz - ez;
        const dist = Math.hypot(dx, dz) || 1;
        const step = Math.min(dist, 1.25 * dt);
        e.x += (dx / dist) * step; e.z += (dz / dist) * step;
        e.moveSpeed = step / Math.max(dt, 0.0001);
        e.yaw = angleTowards(e.yaw, Math.atan2(dx, dz), dt * 4);
        e.anim.armL = 0.95; e.anim.armR = 0.95;
        e.anim.armLz = -0.55; e.anim.armRz = 0.55;
        e.anim.lean = 0.22; e.anim.headPitch = 0.35;
        updateAnim(e.anim, dt, e.moveSpeed, e.app, { keep: true });
        walk(ex - Math.sin(e.yaw) * 0.55, ez - Math.cos(e.yaw) * 0.55, 1.5);
        this.door.holdOpen = 1.2;
        this.door.fromInside = true;
        if (e.z < -1.9 || A.t > 14) {
          A.phase = 'DONE';
          e.hidden = true; d.hidden = true;
          this.finishArrest(A.target, { hid: this.hiding, broke: this.storage.broken });
        }
        break;
      }
      default: break;
    }
  }

  /* ============================================================
     THE SWEEP THAT FOUND NOTHING

     He heard the siren and left. The unit turns up to an empty parade,
     and a deputy comes in to tell you so -- and to tell you that the man
     you described and the man on their sheet are the same man, which is
     the part worth walking inside to say.

     Built on the same bones as the briefing visit: he lets himself in,
     stands at the counter, and waits for you to actually be there rather
     than shouting it across the shop.
     ============================================================ */
  beginSweep() {
    if (this.sweep) return;
    const app = this.night.officerApp || (this.officer && this.officer.app) || randomAppearance(this.rng);
    const name = this.night.officerName || 'Deputy Hollis';
    this.sweep = {
      id: -3, name, app, personality: OFFICER, skin: paintSkin(app),
      x: SPOTS.street.x - 1.2, y: 0, z: SPOTS.street.z - 1.2, yaw: 0, r: 0.30,
      anim: makeAnim(), speed: 1.45, moveSpeed: 0, state: 'ARRIVE', observed: new Set(),
      mood: 100, phoneLabel: 'The deputy', isKiller: false, timer: 0,
      hidden: false, nagTimer: 3.0, waitTimer: 0, started: false,
    };
    this.sound.doorOpen(0);
    this.ui.toast(`A county cruiser pulls up outside.`, '');
  }

  /** Is a deputy in the building on sweep business? The clock waits on him. */
  sweepPresent() { return !!this.sweep && this.sweep.state !== 'DONE'; }

  updateSweep(dt) {
    const o = this.sweep;
    if (!o || o.state === 'DONE') return;

    if (o.state === 'ARRIVE') {
      o.timer += dt;
      if (o.timer < 1.2) { o.moveSpeed = 0; updateAnim(o.anim, dt, 0, o.app, {}); return; }
      if (!o.path) o.path = [SPOTS.outsideDoor, { x: SPOTS.door.x, z: 0.85 }, SPOTS.officerStand];
      if (this.followPath(o, dt)) { o.state = 'WAIT'; o.waitTimer = 0; o.nagTimer = 2.5; }
      else if (o.z > -0.6 && !o.entered) { o.entered = true; this.openDoorFor(); }
    } else if (o.state === 'WAIT') {
      o.moveSpeed = 0;
      o.yaw += angleDelta(o.yaw, Math.atan2(this.player.x - o.x, this.player.z - o.z)) * Math.min(1, dt * 3);
      o.waitTimer += dt;
      if (this.atCounter() && !this.dlg.active && !this.phone.active) {
        o.state = 'TELL';
      } else {
        this.ui.setObjective('THE DEPUTY IS AT THE COUNTER', false);
        o.nagTimer -= dt;
        if (o.nagTimer <= 0) {
          o.nagTimer = 11 + this.rng.range(0, 7);
          this.ui.toast(`${o.name}: "${this.rng.pick(SWEEP_NAGS)}"`, '');
          this.sound.blip(voicePitchOf(o.app), o.app.voice.rough);
        }
        /* He has a shift of his own. If you never come to the counter he
           says the important half of it from where he is standing and
           goes -- you still get told, you just get told worse. */
        if (o.waitTimer > 150) {
          this.ui.toast(`${o.name}: "Nobody out there. Whoever that was matched us to the letter."`, '');
          this.ui.toast(`Keep your eyes on that door.`, 'bad');
          this.sweepDone();
        }
      }
    } else if (o.state === 'TELL') {
      o.moveSpeed = 0;
      this.ui.setObjective('', false);
      o.yaw += (SPOTS.officerStand.yaw - o.yaw) * Math.min(1, dt * 4);
      if (!o.started) {
        o.started = true;
        this.beginDialogue(o, buildSweepReport(o, this.night.bulletin, this.ctx));
      }
    } else if (o.state === 'LEAVE') {
      if (!o.path) o.path = [{ x: SPOTS.door.x, z: 0.85 }, SPOTS.outsideDoor, { x: SPOTS.street.x - 2.0, z: SPOTS.street.z - 1.2 }];
      if (this.followPath(o, dt)) { o.state = 'DONE'; o.hidden = true; this.sweep = null; }
      else if (o.z < 1.0 && !o.exited) { o.exited = true; this.openDoorFor(); }
    }
    updateAnim(o.anim, dt, o.moveSpeed, o.app, { talking: this.speaking === o });
  }

  /** He has said his piece. Out he goes, and the shift picks back up. */
  sweepDone() {
    const o = this.sweep;
    this.ui.setObjective('', false);
    if (!o) return;
    o.state = 'LEAVE'; o.path = null; o.pathI = 0; o.started = true;
  }

  /** The paperwork: what it cost, what it bought, and whether you carry on. */
  finishArrest(target, extra = {}) {
    this.arrest = null;
    this.player.frozen = false;
    this.police = null;
    this.ending('CAUGHT', Object.assign({
      name: target.name,
      nights: this.nightNo,
      hid: this.hiding,
      broke: this.storage.broken,
      caseFile: this.night.caseFile,
    }, extra));
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
    this.dropLock();
    this.ui.hideDialogue(); this.ui.hideNotes(); this.ui.hidePhone();
    this.ui.setHudVisible(false);
    this.ui.setObjective('');
    this.ui.cinema(true);
    this.endTimer = 0;
    data.night = this.nightNo;
    this.endData = data;
    data.mode = this.mode;
    this.endSel = 0;
    if (kind === 'CAUGHT') {
      this.sound.siren(); this.sound.chimeGood();
      /* An arrest buys the town a breather. The next few nights have nobody
         working them, and the first of those is the one a deputy comes by
         to say so -- after which he stays away until there is a reason to
         come back. */
      const R = this.run || (this.run = { calmUntil: 0, standDownNight: 0, arrests: 0 });
      R.arrests++;
      R.standDownNight = this.nightNo + 1;
      R.calmUntil = this.nightNo + 3 + this.rng.int(3);
      data.calmNights = R.calmUntil - this.nightNo;
    }
    if (kind === 'FIRED') { this.sound.siren(); this.sound.chimeBad(); }
    // ATTACKED runs its own soundtrack out of updateDeath()
    setTimeout(() => {
      if (this.state !== ST.ENDING) return;
      this.ui.showPanel(endingHtml(kind, data));
      if (kind === 'CAUGHT') this.ui.panelSelect(0);
    }, kind === 'ATTACKED' ? 4200 : 1600);
  }

  updateEnding(dt) {
    this.endTimer += dt;
    if (this.endKind === 'ATTACKED') {
      this.updateDeath(dt);
      this.distress = 1;
    }
    const gate = this.endKind === 'ATTACKED' ? 4.4 : 2.6;

    /* An arrest is not the end of the run unless you want it to be. The
       town gets a few quiet nights out of it and the job is still there
       tomorrow, so the panel asks rather than dropping you at the title. */
    if (this.endKind === 'CAUGHT' && this.endTimer > gate) {
      const i = this.input;
      if (i.hit('ArrowUp', 'KeyW')) { this.endSel = 0; this.quietly(() => this.sound.uiMove()); this.ui.panelSelect(0); }
      if (i.hit('ArrowDown', 'KeyS')) { this.endSel = 1; this.quietly(() => this.sound.uiMove()); this.ui.panelSelect(1); }
      if (this.confirmOrClick()) {
        this.quietly(() => this.sound.uiSelect());
        if (this.endSel === 1) { this.toTitle(); return; }
        this.ui.hidePanel(); this.ui.cinema(false);
        this.death = null; this.shake = 0;
        this.startNight(this.nightNo + 1);
        return;
      }
      return;
    }

    if (this.endTimer > gate && this.confirmOrClick()) this.toTitle();
  }

  /** Back to the attract screen, with the world put back how it started. */
  toTitle() {
    this.ui.hidePanel(); this.ui.cinema(false);
    this.ui.showTitle(true); this.state = ST.TITLE; this.menuSel = 0; this.titleT = 0;
    this.death = null; this.shake = 0;
    this.arrest = null;
    this.sound.boomboxStop();
    this.player = createPlayer(); this.player.x = 6.4; this.player.z = 6.2;
    this.sound.setTension(0);
    this.sound.restoreRoom();
  }

  endNight() {
    // anything still in your hands, on the counter or in the bin is a black mark
    this.stats.unshelved = this.player.held.length + this.bin.length
      + this.counterSlots.filter(Boolean).length + (this.rewinder.tape ? 1 : 0);
    this.stats.cashLoose = round2(this.player.cash.owed + this.player.changeInHand);
    const grade = gradeNight(this.stats);
    this.grade = grade;
    this.state = ST.REPORT;
    this.dropLock();
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
      note = `Nobody came for you tonight. The deputy will be back tomorrow with more to go on, which is not the comfort it sounds like.`;
    } else if (k.seenAsCustomer) {
      note = `Somebody in that store tonight matched the bulletin, and you let them walk out with a tape.`;
    } else {
      note = `Quiet night. That is not the same as a safe one.`;
    }
    this.ui.showPanel(reportHtml(this.nightNo, this.stats, grade, note));
  }

  updateReport(dt) {
    this.reportTimer += dt;
    if (this.reportTimer > 1.0 && this.confirmOrClick()) {
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

    const L = this.state === ST.PLAY || this.state === ST.PAUSE || this.state === ST.QUIT
      || this.state === ST.ENDING || this.state === ST.REPORT
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
    this.drawBoombox();
    this.drawFloorMess();

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

  /** The boombox on the floor, and the same thing under his arm. */
  drawBoombox() {
    const M = this._mats;
    const b = this.boombox;
    if (b) {
      setPosYaw(M.m, b.x, 0, b.z, b.yaw);
      this.raster.drawMesh(this.world.boomMesh, M.m,
        { shade: lightAt(b.x, 0.3, b.z) * this.lights });
    }
    for (const c of this.customers) {
      if (c.hidden || c.carrying !== 'BOOMBOX') continue;
      // carried low against the hip, tucked under the arm
      const hs = c.app.height.scale;
      const lx = 0.30 * c.app.build.w * hs, ly = 0.78 * hs, lz = 0.06 * hs;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      setPosYaw(M.m, c.x + lx * cy + lz * sy, ly, c.z - lx * sy + lz * cy, c.yaw + 0.35);
      this.raster.drawMesh(this.world.boomMesh, M.m,
        { shade: lightAt(c.x, 0.9, c.z) * this.lights });
    }
  }

  /**
   * What is on the carpet, and what you clean it up with.
   *
   * Each drift of corn is the same mesh at its own yaw and scale, so a
   * floor covered in it does not read as a tiled pattern. The vacuum is
   * either standing where it was left or out in front of the player,
   * head-down, the way you actually push one.
   */
  drawFloorMess() {
    const M = this._mats;
    for (const sp of this.spills) {
      setPosYaw(M.m, sp.x, 0, sp.z, sp.yaw);
      /* Scale by writing the rotation columns short. A pile that has been
         half hoovered up is a smaller pile. */
      const k = sp.s;
      M.m[0] *= k; M.m[2] *= k; M.m[8] *= k; M.m[10] *= k;
      M.m[5] = Math.min(1, k * 1.2);
      this.raster.drawMesh(this.world.spillMesh, M.m,
        { shade: lightAt(sp.x, 0.1, sp.z) * this.lights });
    }
    for (const q of this.puffs) {
      setPosYaw(M.m, q.x, q.y, q.z, q.yaw);
      this.raster.drawMesh(this.world.puffMesh, M.m,
        { shade: lightAt(q.x, q.y, q.z) * this.lights });
    }
    /* The pizza: on the counter, under the delivery kid's arm on the way
       in, and under the customer's on the way out. */
    const P = this.pizza;
    if (P) {
      if (P.box) {
        setPosYaw(M.m, P.box.x, P.box.y, P.box.z, P.box.yaw);
        this.raster.drawMesh(this.world.pizzaMesh, M.m,
          { shade: lightAt(P.box.x, P.box.y, P.box.z) * this.lights });
      }
      const carriers = [];
      if (P.driver && P.driver.carrying && !P.driver.hidden) carriers.push(P.driver);
      if (P.customer && P.customer.carryingPizza && !P.customer.hidden) carriers.push(P.customer);
      for (const who of carriers) {
        const hs = who.app.height.scale;
        const lx = 0.26 * who.app.build.w * hs, ly = 1.02 * hs, lz = 0.16 * hs;
        const cy = Math.cos(who.yaw), sy = Math.sin(who.yaw);
        setPosYaw(M.m, who.x + lx * cy + lz * sy, ly, who.z - lx * sy + lz * cy, who.yaw + 0.2);
        this.raster.drawMesh(this.world.pizzaMesh, M.m,
          { shade: lightAt(who.x, ly, who.z) * this.lights });
      }
    }
    const v = this.vacuum;
    if (!v.out) return;
    if (v.held) {
      const p = this.player;
      /* Out in front and tilted away, with a little sway when it is
         running -- a vacuum being pushed rather than a vacuum being
         carried. */
      const sway = v.running ? Math.sin(this.time * 7) * 0.10 : 0;
      const ax = p.x + Math.sin(p.yaw) * 0.52 + Math.cos(p.yaw) * sway * 0.3;
      const az = p.z + Math.cos(p.yaw) * 0.52 - Math.sin(p.yaw) * sway * 0.3;
      setPosYaw(M.m, ax, 0, az, p.yaw + Math.PI + sway);
      this.raster.drawMesh(this.world.vacMesh, M.m,
        { shade: lightAt(ax, 0.5, az) * this.lights });
      return;
    }
    setPosYaw(M.m, v.x, 0, v.z, v.yaw);
    this.raster.drawMesh(this.world.vacMesh, M.m,
      { shade: lightAt(v.x, 0.5, v.z) * this.lights });
  }

  /** Where the music is coming from, from where the player is standing. */
  updateBoomboxAudio() {
    const b = this.boombox;
    if (!b) return;
    const p = this.player;
    const s = this.sound.spatial(p.x, p.z, p.yaw, b.x, b.z, 16);
    // it is a loud machine in a small shop: audible everywhere, just duller
    this.sound.boomboxAt(0.32 + s.gain * 0.68, s.pan);
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
      /* A thumb latch lets anyone already inside leave. The deadbolt is only
         ever a problem for whoever is on the pavement.

         The `leaving` half matters: testing position alone flips the answer
         exactly at the threshold, so somebody on their way out could pass
         while their feet were inside and was blocked the instant they
         crossed it -- which pushed them back inside, where they could pass
         again. At midnight, with the door bolted and the whole shop trying
         to leave at once, that was a room full of people bouncing off the
         doorway forever and a shift that never ended. Once you have been
         told to go, the latch works wherever you are standing. */
      doorPassable: (who) => !g.door.locked || (!!who && (who.z > 0.15 || who.leaving || who.exited)),
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
      openDoor: (who) => g.openDoorFor(who),
      knock: (c) => { g.sound.knock(3); g.ui.toast(`Someone is knocking.`, ''); },
      lockedOut: (c) => {
        /* Turning somebody away costs you -- unless it is past midnight and
           the shop is shut, in which case it is not a mistake, it is the
           end of the shift doing what it is for. */
        if (g.closing) {
          g.ui.toast(`${c.name} tried the door. Too late.`, '');
          return;
        }
        g.stats.turnedAway++;
        g.sound.chimeBad();
        g.ui.toast(`${c.name} found the door locked and left.`, 'bad');
      },

      /* --- queue --- */
      claimCounterSpot: (c) => g.claimCounterSpot(c),
      lineTail: (c) => g.lineTail(c),
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

      /** Is anybody in here making the shop genuinely hard to stand in? */
      stenchActive: () => g.customers.some((c) => !c.hidden && c.nuisance
        && (c.nuisance === 'stench' || c.nuisance === 'skunk')
        && c.state !== CS.LEAVING && c.state !== CS.GONE),
      /** He is being worn down, and the shop can see it. */
      wearingDown: (c, gone) => {
        const step = Math.floor(gone * 5);
        if (c._wearStep === step) return;
        c._wearStep = step;
        if (step <= 0) return;
        g.sound.blip(voicePitchOf(c.app), c.app.voice.rough);
        g.ui.toast(step >= 4
          ? `${c.name} is going. Actually going.`
          : `${c.name} is running out of reasons to stay.`, '');
      },

      /** Somebody decides they will wait until the air clears. */
      stenchHoldsOff: (c) => {
        g.ui.toast(g.rng.pick([
          `${c.name} looks at the counter, looks at the smell, and stays where they are.`,
          `${c.name} is not coming any closer while that is in here.`,
          `${c.name} would like to pay, and is not walking through that to do it.`,
        ]), 'bad');
      },
      /** Where the returns bin is, for somebody walking a stray tape over. */
      binSpot: () => ({ x: (PROPS.bin.x0 + PROPS.bin.x1) / 2, z: PROPS.bin.z0 - 0.85 }),

      /** The one at the television has picked something up again. */
      stonerTook: (c) => {
        g.ui.toast(`${c.name} takes something off the shelf and wanders off with it.`, '');
      },

      /* He puts it down, finds the switch, and the shop is his. */
      /* He has found the tub and worked out that the lid comes off. */
      startPopper: (c) => g.startPopper(c),

      boomboxDown: (c) => {
        const yaw = c.yaw + Math.PI;
        g.boombox = {
          x: c.x + Math.sin(c.yaw) * 0.34,
          z: c.z + Math.cos(c.yaw) * 0.34,
          yaw, owner: c.id,
        };
        c.carrying = null;
        g.sound.boomboxStart();
        g.ui.toast(`${c.name} sets a boombox down and turns it up.`, 'bad');
      },
      /** He picks it up again on his way out, and the shop goes quiet. */
      boomboxUp: (c) => {
        if (!g.boombox || (c && g.boombox.owner !== c.id)) return;
        g.boombox = null;
        g.sound.boomboxStop();
        if (c) c.carrying = 'BOOMBOX';
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
        if (g.boombox && g.boombox.owner === c.id) {
          c.packUp = { x: g.boombox.x, z: g.boombox.z, phase: 'GO', t: 0, off: false };
        }
        g.stats.stormedOut++;
        c.leaving = true; c.rushing = true; c.state = CS.LEAVING; c.path = null;
        g.releaseCounterSpot(c);
        g.sound.chimeBad();
        g.ui.toast(`${c.name} walked out.`, 'bad');
      },
      leave: (c) => {
        /* Whatever he brought in, he takes back out -- on foot. It used to
           reappear under his arm the instant he agreed to go, which is not
           how carrying something works. */
        if (g.boombox && g.boombox.owner === c.id) {
          c.packUp = { x: g.boombox.x, z: g.boombox.z, phase: 'GO', t: 0, off: false };
        }
        /* And whatever he picked up and forgot about goes in the returns
           bin on the way past, which makes it the clerk's problem. */
        if (c.special === 'SMOKER' && c.tape && !c.checkedOut) {
          g.bin.push(c.tape); c.tape = null;
          g.sound.drop();
          g.ui.toast(`${c.name} drops a tape in the returns bin on his way out.`, 'bad');
        }
        // Not while you are holding their change. They go and stand at the
        // window until the drawer opens, and get angry about it in their
        // own time -- which is the player's failure to make, not a line of
        // dialogue's. This is how a special could be paid in the middle of
        // the floor and then walk out on the change she was owed.
        if (c.awaitingChange && c.changeDue > 0.001) {
          c.state = CS.TO_COUNTER; c.path = null; c.timer = 0;
          c.act = null; c.script = c.script === 'special' ? 'rent' : c.script;
          return;
        }
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
      checkout: (tape, c, unpaid, price) => {
        g.stats.rentalsRung++;
        if (unpaid) { g.sound.registerBeep(); return null; }
        return g.takeCashFrom(price != null ? price : tape.price, c, 'rental');
      },
      /**
       * They changed their mind, or ran out of patience holding it.
       *
       * It used to vanish out of their hands and reappear in its run, which
       * is not a thing that happens in a video shop. They put it in the
       * returns bin like everybody else and it is the clerk's to shelve.
       */
      returnToShelf: (c) => g.ctx.abandonTape(c),
      abandonTape: (c) => {
        const t = c.tape;
        if (!t) return;
        c.tape = null;
        g.bin.push(t);
        g.sound.drop();
        g.ui.toast(`${c.name} drops ${tapeLabel(t)} in the returns bin.`, '');
      },

      /**
       * They came in to do something else and have talked themselves into
       * renting. Nobody is served where they stand: this stops whatever
       * they were doing, sends them off to pick something off an actual
       * shelf, and puts them in the queue like anybody else. The money and
       * the change then happen at the window, under the ordinary rules.
       */
      sendToShop: (c, opts = {}) => {
        c.script = 'rent';
        c.act = null; c.actSpot = null; c.parked = false;
        c.nuisance = null;              // a shopper is not a nuisance any more
        c.asked = 0;
        c.tape = null; c.browse = null;
        c.confusionResolved = true;
        if (opts.genre) c.wantGenre = opts.genre;
        // A price agreed in conversation travels with them to the counter.
        if (opts.price != null) c.priceAgreed = opts.price;
        else if (opts.discount) c.priceDiscount = opts.discount;
        c.state = CS.BROWSING; c.path = null; c.timer = 0;
        g.releaseCounterSpot(c);
        g.ui.toast(`${c.name} goes to find something.`, '');
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
      /* The deputy who swept the parade has finished saying it. */
      sweepDone: () => g.sweepDone(),

      /* --- the woman who wants a manager --- */
      /** Who, if anyone, is standing here asking for one. */
      wantsManager: () => g.wantsManager(),
      /** Which go at ringing him this is. Counts up across the night. */
      managerAttempt: () => {
        g.managerCall = g.managerCall || { attempts: 0, connected: false, handedTo: null };
        g.managerCall.attempts++;
        return g.managerCall.attempts;
      },
      managerConnected: () => !!(g.managerCall && g.managerCall.connected),
      managerConnect: () => {
        g.managerCall = g.managerCall || { attempts: 1, connected: false, handedTo: null };
        g.managerCall.connected = true;
      },
      toast: (text, kind) => g.ui.toast(text, kind || ''),

      /* --- the pizza --- */
      pizzaState: () => g.pizza,
      /** The bell stops the moment you lift the receiver. */
      pizzaAnswered: () => {
        if (!g.pizza) return;
        g.pizza.phase = 'ANSWERED';
        g.ui.setObjective('');
      },
      /** He has settled on something the parlour actually stocks. */
      pizzaAgree: (topping) => {
        if (!g.pizza) return;
        g.pizza.agreed = topping;
        g.ui.toast(`He'll take ${topping}. Ring them back.`, '');
      },
      /** Ordered. It is in an oven on the parade now. */
      pizzaCook: (seconds) => {
        if (!g.pizza) return;
        g.pizza.phase = 'COOKING';
        g.pizza.t = 0;
        g.pizza.cookTime = seconds;
      },
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

  /** Somebody works the door. `who` decides whether the bolt is in their way. */
  openDoorFor(who) {
    this.door.holdOpen = Math.max(this.door.holdOpen, 1.6);
    if (!who || who.z > 0.15 || who.leaving || who.exited) this.door.fromInside = true;
    this.sound.doorChime(0);
  }

  /**
   * The back of the line, for somebody still walking to it.
   *
   * An empty counter means walk to the window. Otherwise it is one place
   * behind whoever is currently last -- and it moves while you are walking,
   * which is why the walker re-aims at it rather than setting off once.
   */
  /**
   * Where the Nth person in the line stands.
   *
   * The window, then the three marked spots along the counter, and then it
   * doubles back across the front of the shop the way a queue in a small
   * room actually does -- and when it outgrows even that, it keeps filling
   * outward from the counter.
   *
   * Every position past the marked three is checked against the same
   * solids that stop the player walking, so nobody is ever sent to stand
   * inside a shelf run or the candy stand. The old version stepped ninety
   * centimetres west per person and never turned: fine for the four or
   * five a normal night puts in the line, and absurd for a coach party --
   * the twenty-eighth person stood at x -13.8, through the wall and most
   * of the way across the parade.
   */
  queueSpots() {
    if (this._queueSpots) return this._queueSpots;
    const out = [SPOTS.service].concat(SPOTS.queue.map((q) => ({ x: q.x, z: q.z })));
    const far = (x, z) => out.every((p) => Math.hypot(p.x - x, p.z - z) > 0.68);
    const take = (x, z) => {
      if (!this.onOpenFloor(x, z) || !far(x, z)) return;
      out.push({ x, z });
    };
    // the snake across the front of the shop: a real line, doubling back
    QUEUE_ROWS.forEach((z, row) => {
      const n = Math.floor((QUEUE_X1 - QUEUE_X0) / QUEUE_STEP);
      for (let k = 0; k <= n; k++) {
        take(row % 2 === 0 ? QUEUE_X1 - k * QUEUE_STEP : QUEUE_X0 + k * QUEUE_STEP, z);
      }
    });
    /* And past that it stops being a line and becomes a shop with too many
       people in it. Fill outward from the counter across whatever floor is
       actually standable -- the aisle mouths, the gap by the door, the
       middle of the room. */
    const spare = [];
    for (let x = 1.2; x < 12.6; x += 0.8) {
      for (let z = 0.5; z < 8.8; z += 0.8) spare.push({ x, z });
    }
    spare.sort((a, b) => Math.hypot(a.x - SPOTS.service.x, a.z - SPOTS.service.z)
      - Math.hypot(b.x - SPOTS.service.x, b.z - SPOTS.service.z));
    for (const p of spare) take(p.x, p.z);
    this._queueSpots = out;
    return out;
  }

  queueSpot(i) {
    if (i <= 0) return SPOTS.service;
    const all = this.queueSpots();
    return all[Math.min(i, all.length - 1)];
  }

  lineTail(c) {
    const others = this.queue.filter((q) => q !== c);
    if (!others.length) return SPOTS.service;
    return this.queueSpot(others.length);       // the place they would take
  }

  claimCounterSpot(c) {
    if (!this.queue.includes(c)) this.queue.push(c);
    const i = this.queue.indexOf(c);
    c.queueIndex = i;
    return this.queueSpot(i);
  }
  releaseCounterSpot(c) {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /* ============================================================
     THE CORD

     It is a wired phone on the back counter and it is 1996, so the
     receiver goes as far as the flex goes and not one inch further. That
     is most of the counter -- both service positions and the end of it --
     and none of the shop floor. Somebody who wants to speak to the
     regional manager has to come and stand where the phone can reach.
     ============================================================ */
  cordReaches(who) {
    if (!who) return false;
    const P = PROPS.phone;
    const px = (P.x0 + P.x1) / 2, pz = (P.z0 + P.z1) / 2;
    return Math.hypot(who.x - px, who.z - pz) <= CORD_REACH;
  }

  /**
   * Put the receiver in somebody's hand.
   *
   * The line has to be live, they have to be within the flex, and after
   * that it is their conversation and not yours -- which is the whole
   * point of the woman who wants a manager. You cannot fix her problem.
   * You can hand her somebody who is paid more than you.
   */
  handOverPhone(who) {
    const M = this.managerCall;
    if (!M || !M.connected || M.handedTo) return;
    if (!this.cordReaches(who)) {
      this.ui.toast(`The cord won't reach that far.`, 'bad');
      this.sound.error();
      return;
    }
    M.handedTo = who;
    who.onPhone = true;
    who.phoneT = 0;
    this.ui.hidePhone();
    this.phone.node = null;
    this.player.frozen = false;
    if (this.state === ST.PLAY) { this.wantLock = true; this.grabLock(); }
    this.sound.blip(voicePitchOf(who.app), who.app.voice.rough);
    this.ui.toast(`You hand ${who.name} the receiver.`, 'good');
  }

  /**
   * Her half of a call you can only hear one side of.
   *
   * It runs on its own once the receiver is in her hand: a long, quiet,
   * increasingly deflated conversation with a man in a dressing gown
   * forty minutes away, and then she puts it down and goes.
   */
  updateHandedPhone(dt) {
    const M = this.managerCall;
    if (!M || !M.handedTo) return;
    const c = M.handedTo;
    if (c.hidden || c.state === CS.GONE) { this.managerCall = null; return; }
    c.phoneT += dt;
    const beats = MANAGER_CALL_BEATS;
    const step = Math.floor(c.phoneT / 7.5);
    if (step !== c._phoneStep && step < beats.length) {
      c._phoneStep = step;
      this.sound.blip(voicePitchOf(c.app), c.app.voice.rough);
      this.ui.toast(`${c.name}: "${beats[step]}"`, '');
    }
    if (c.phoneT > 7.5 * beats.length + 3) {
      c.onPhone = false;
      this.sound.phoneHang();
      this.ui.toast(`She puts the receiver down. Gently, which is new.`, 'good');
      this.ctx.mood(c, +40);
      this.ctx.leave(c);
      this.managerCall = null;
    }
  }

  /** Is somebody mid-call with the regional manager? The clock waits. */
  managerBusy() {
    const M = this.managerCall;
    return !!(M && M.handedTo && M.handedTo.onPhone);
  }

  /** Who in the shop is standing here demanding one. */
  wantsManager() {
    for (const c of this.customers) {
      if (c.special !== 'MANAGER' || c.hidden) continue;
      if (c.state === CS.LEAVING || c.state === CS.GONE) continue;
      return c;
    }
    return null;
  }

  /* ============================================================
     THE PIZZA

     A man rings the shop from a payphone and orders a pizza. He is not
     confused about the number -- he is certain, and the certainty is the
     problem. He turns up to collect it, he will not be told, and there is
     exactly one thing that ends it: an actual pizza, on the counter, with
     his toppings on it.

     Which means the phone twice. Once to order, and once more when the
     parlour tells you they have not got half of what he asked for and you
     have to go back and get him to choose again.
     ============================================================ */
  /** The state of tonight's order, or null if nobody has rung. */
  pizzaState() { return this.pizza; }

  /** He is in the building and has not got his food. */
  pizzaPending() {
    const P = this.pizza;
    if (!P || P.done) return false;
    const c = P.customer;
    return !!c && !c.hidden && c.state !== CS.GONE && c.state !== CS.LEAVING;
  }

  /**
   * The bell, until somebody picks it up.
   *
   * A phone that rings and is never answered is a phone that rings all
   * night, so it gives up after a while and he simply turns up anyway --
   * which is worse for you, because then you have not even heard the
   * order.
   */
  updatePizza(dt) {
    const P = this.pizza;
    if (!P) return;

    if (P.phase === 'RINGING') {
      P.t += dt;
      P.bellT -= dt;
      if (P.bellT <= 0) {
        P.bellT = 4.2;
        P.rings++;
        this.sound.phoneBell();
        this.ui.setObjective('THE PHONE IS RINGING', P.rings > 3);
      }
      /* Twelve rings and whoever it was gives up. He still comes. */
      if (P.rings > 12) {
        P.phase = 'UNHEARD';
        P.t = 0;
        this.ui.setObjective('');
        this.ui.toast(`The phone stops ringing.`, '');
      }
      return;
    }

    /* You picked it up and then put it down again without letting him
       finish. He still ordered, as far as he is concerned. */
    if (P.phase === 'ANSWERED') {
      P.t += dt;
      if (P.t > 25) { P.phase = 'ORDERED'; P.t = 0; }
      return;
    }

    if (P.phase === 'ORDERED' || P.phase === 'UNHEARD') {
      /* He is on his way. Give it a beat so the call and the man are not
         the same moment. */
      P.t += dt;
      if (P.t > (P.phase === 'UNHEARD' ? 30 : 22) && !P.arrived) {
        P.arrived = true;
        P.phase = 'WAITING';
        this.spawnPizzaMan();
      }
      return;
    }

    if (P.phase === 'COOKING') {
      P.t += dt;
      if (P.t > P.cookTime && !P.driver) this.spawnDriver();
      return;
    }

    if (P.phase === 'DELIVERING') this.updateDriver(dt);
  }

  /** Somebody rings the shop. Tonight, it is him. */
  beginPizzaCall(sp) {
    if (this.pizza) return;
    this.pizza = {
      phase: 'RINGING', t: 0, rings: 0, bellT: 0.6,
      spec: sp, customer: null, driver: null,
      wants: null, refused: null, agreed: null,
      placed: false, arrived: false, done: false, cookTime: 0,
    };
  }

  /** He walks in expecting food. */
  spawnPizzaMan() {
    const P = this.pizza;
    if (!P || P.customer) return;
    const c = makeSpecial(this.rng, P.spec);
    this.customers.push(c);
    P.customer = c;
    this.ui.toast(`Somebody comes in and does not look at the shelves.`, '');
  }

  /**
   * A kid from Bertucci's, with a box.
   *
   * Built the way the deputy is: a body walked along a fixed path rather
   * than a customer with wants of his own. He comes in, puts the box on
   * the counter, gets paid by the man who ordered it, and goes.
   */
  spawnDriver() {
    const P = this.pizza;
    if (!P || P.driver) return;
    const app = randomAppearance(this.rng, { gender: this.rng.chance(0.5) ? 'm' : 'f' });
    P.driver = {
      id: -4, name: `The delivery kid`, app, skin: paintSkin(app), personality: OFFICER,
      x: SPOTS.street.x + 1.1, y: 0, z: SPOTS.street.z - 0.8, yaw: 0, r: 0.30,
      anim: makeAnim(), speed: 1.6, moveSpeed: 0, observed: new Set(),
      mood: 100, phoneLabel: 'The delivery kid', isKiller: false, hidden: false,
      state: 'IN', timer: 0, path: null, pathI: 0,
      /* He comes in with it under one arm. */
      carrying: true,
    };
    P.phase = 'DELIVERING';
    P.t = 0;
    this.ui.toast(`Headlights on the lot. Somebody gets out with a box.`, 'good');
  }

  updateDriver(dt) {
    const P = this.pizza;
    const d = P && P.driver;
    if (!d || d.state === 'DONE') return;
    d.timer += dt;

    if (d.state === 'IN') {
      if (!d.path) d.path = [SPOTS.outsideDoor, { x: SPOTS.door.x, z: 0.85 }, PIZZA_DROP];
      if (this.followPath(d, dt)) { d.state = 'DROP'; d.timer = 0; }
      else if (d.z > -0.6 && !d.entered) { d.entered = true; this.openDoorFor(); }
    } else if (d.state === 'DROP') {
      d.moveSpeed = 0;
      d.yaw = angleTowards(d.yaw, Math.PI, dt * 5);
      if (!d.dropped && d.timer > 0.9) {
        d.dropped = true;
        d.carrying = false;
        this.sound.impact(0.25);
        this.ui.toast(`The box goes on the counter. It is a real pizza and it is warm.`, 'good');
        P.onCounter = true;
        /* An actual box, on the actual counter, between the two of them. */
        P.box = { x: PIZZA_DROP.x, y: COUNTER.y, z: PIZZA_DROP.z + 0.55, yaw: this.rng.range(-0.3, 0.3) };
      }
      if (d.timer > 2.4) { d.state = 'PAID'; d.timer = 0; }
    } else if (d.state === 'PAID') {
      d.moveSpeed = 0;
      const c = P.customer;
      if (!d.paid) {
        d.paid = true;
        this.sound.cashDrawer();
        this.ui.toast(c ? `${c.name} pays the kid, in cash, without being asked.` : `The kid gets paid.`, 'good');
      }
      if (d.timer > 2.0) {
        d.state = 'OUT'; d.path = null; d.pathI = 0;
        if (c) {
          c.onPhone = false;
          this.ctx.mood(c, +50);
          /* He takes it off the counter and it goes with him. */
          P.box = null;
          c.carryingPizza = true;
          this.sound.pickup();
          this.ui.toast(`${c.name}: "${this.rng.pick(PIZZA_BYE)}"`, '');
          this.ctx.leave(c);
        }
        P.done = true;
        this.ui.setObjective('');
      }
    } else if (d.state === 'OUT') {
      if (!d.path) d.path = [{ x: SPOTS.door.x, z: 0.85 }, SPOTS.outsideDoor, { x: SPOTS.street.x + 2.0, z: SPOTS.street.z - 1.0 }];
      if (this.followPath(d, dt)) { d.state = 'DONE'; d.hidden = true; }
      else if (d.z < 1.0 && !d.exited) { d.exited = true; this.openDoorFor(); }
    }
    updateAnim(d.anim, dt, d.moveSpeed, d.app, {});
  }

  /* ============================================================
     THE POPCORN

     He gets behind the counter -- which nobody does -- and tips the whole
     tub of kernels into the kettle. Then he stands there giggling while
     it comes over the sides and goes across the floor.

     Getting him out is the first half. The machine is still running and
     there is popcorn from the back counter to the front door, and the
     shift does not end with a floor like that. The vacuum is in the back
     room, where it has been since 1984.
     ============================================================ */
  /** He has started it. It keeps going until somebody switches it off. */
  startPopper(c) {
    if (this.popper.running) return;
    this.popper.running = true;
    this.popper.spilled = 0;
    this.popper.t = 0;
    this.popper.by = c || null;
    this.sound.popperOn();
    this.ui.toast(`He tips the whole tub in. The whole tub.`, 'bad');
  }

  stopPopper() {
    if (!this.popper.running) return;
    this.popper.running = false;
    this.sound.popperOff();
    this.ui.toast(`You get the switch. It winds down, and stops.`, 'good');
  }

  /** More corn on the floor, for as long as it is running. */
  updatePopper(dt) {
    const P = this.popper;
    if (!P.running) return;
    P.t = (P.t || 0) + dt;
    P.popT = (P.popT || 0) - dt;
    if (P.popT <= 0) {
      P.popT = 0.09 + this.rng() * 0.14;
      this.sound.popKernel();
    }
    /* Corn coming over the front of the case: thrown up out of the
       kettle, arcing out across the counter, and landing. It is what
       makes the machine read as overflowing rather than as a box that
       occasionally spawns a pile on the floor. */
    P.puffT = (P.puffT || 0) - dt;
    if (P.puffT <= 0) {
      P.puffT = 0.05 + this.rng() * 0.07;
      /* Out over the front of the case and down the clerk's side, which is
         where it would actually go. The spread used to reach far enough
         round that half of it flew into the back wall behind the cart. */
      const a = this.rng.range(-1.0, 0.7);
      const sp = this.rng.range(0.9, 2.3);
      this.puffs.push({
        x: 12.60 + this.rng.range(-0.16, 0.16),
        y: 1.50,
        z: 6.10 + this.rng.range(-0.14, 0.14),
        vx: Math.sin(a) * sp * 0.7,
        vz: -Math.cos(a) * sp,
        vy: this.rng.range(1.4, 2.6),
        spin: this.rng.range(-7, 7), yaw: this.rng() * 6.28,
        t: 0,
      });
    }
    P.spillT = (P.spillT || 0) - dt;
    /* It piles up fast at first and then keeps going, so leaving it while
       you deal with him costs you real floor. */
    if (P.spillT <= 0 && this.spills.length < MAX_SPILLS) {
      P.spillT = 1.5 + this.rng() * 1.6;
      this.dropSpill();
    }
  }

  /**
   * The corn that is in the air right now.
   *
   * Simple ballistics and then it is gone -- where it lands is not what
   * builds the mess up, the piles are. These are the ones you watch come
   * over the glass while he stands there laughing.
   */
  updatePuffs(dt) {
    const list = this.puffs;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.t += dt;
      q.vy -= 7.2 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.yaw += q.spin * dt;
      if (q.y <= 0.03) {
        // it bounces once, badly, and stops being worth drawing
        if (q.vy < -0.6 && !q.bounced) {
          q.bounced = true; q.y = 0.03; q.vy = -q.vy * 0.28;
          q.vx *= 0.4; q.vz *= 0.4;
        } else { list.splice(i, 1); continue; }
      }
      if (q.t > 4) list.splice(i, 1);
    }
  }

  /** One more drift of it, thrown out from the cart. */
  dropSpill() {
    const rng = this.rng;
    /* Out from the machine and along the clerk's side, because that is
       where it would actually go: it comes over the front of the case and
       spreads down the run behind the counter.

       And it has to land on floor you can stand on. It used to go under
       the cart and under both counters, where you cannot see it and the
       vacuum head cannot reach it, so a shift could not be finished --
       the ask was to clean a floor with half the mess inside the
       furniture. Candidates are tested against the same solids that stop
       the player walking, and one that is inside something is thrown away
       and rolled again. */
    for (let tries = 0; tries < 14; tries++) {
      const a = rng.range(-1.5, 1.5);
      const d = 0.5 + rng() * (1.2 + Math.min(3.4, this.spills.length * 0.22));
      const x = clamp(12.35 + Math.sin(a) * d - d * 0.25, 9.2, 12.8);
      const z = clamp(6.10 - Math.cos(a) * d * 0.85, 1.4, 7.2);
      if (!this.onOpenFloor(x, z)) continue;
      this.spills.push({ x, z, yaw: rng.range(0, Math.PI * 2), s: 0.75 + rng() * 0.5 });
      this.popper.spilled++;
      return;
    }
  }

  /**
   * Is this a patch of floor, or the inside of a cupboard?
   *
   * Asked of the same solid list that stops the player walking through
   * things: push a small circle out of the world at that point, and if it
   * moves, the point was inside something.
   */
  onOpenFloor(x, z) {
    const [px, pz] = collide(x, z, SPILL_CLEAR, this.solids, true);
    return Math.hypot(px - x, pz - z) < 0.001;
  }

  /** How much of it is still down. */
  spillCount() { return this.spills.length; }

  /** The mess and the machine, as one question: is the floor dealt with? */
  floorClear() { return !this.popper.running && !this.spills.length; }

  /* ---------------- the vacuum ---------------- */
  /** It lives in the back room, against the shelf, where it always has. */
  putVacuumBack() {
    const v = this.vacuum;
    v.held = false; v.running = false;
    v.x = VACUUM_HOME.x; v.z = VACUUM_HOME.z; v.yaw = VACUUM_HOME.yaw;
    v.out = true;
  }

  /* It is in the back room and it is not going to walk out. The first
     time you open that door it is standing there against the shelf. */
  revealVacuum() {
    if (this.vacuum.out) return;
    this.putVacuumBack();
  }

  takeVacuum() {
    const v = this.vacuum;
    if (v.held) return;
    v.held = true; v.out = true;
    this.sound.pickup();
    this.ui.toast(`You wheel the vacuum out of the back.`, '');
  }

  dropVacuum() {
    const v = this.vacuum;
    if (!v.held) return;
    v.held = false; v.running = false;
    v.x = this.player.x; v.z = this.player.z; v.yaw = this.player.yaw;
    this.sound.drop();
  }

  /**
   * Running it.
   *
   * Held down rather than tapped: you push it over the mess and the mess
   * goes, a pile at a time, which is what a vacuum is. Let go and it
   * stops.
   */
  updateVacuum(dt) {
    const v = this.vacuum;
    if (!v.held) { v.running = false; return; }
    /* Held, not tapped -- and held on whatever interact is bound to.
       Naming two keys here meant rebinding interact left the vacuum
       running on a button the player no longer uses. */
    const want = INTERACT_KEYS.some((k) => this.input.down.has(k)) || this.input.mouse[0];
    if (want && !v.running) { v.running = true; this.sound.vacuumOn(); }
    if (!want && v.running) { v.running = false; this.sound.vacuumOff(); }
    if (!v.running) return;

    this.sound.vacuumAt(dt);
    /* The head is out in front of him, not under his feet. */
    const hx = this.player.x + Math.sin(this.player.yaw) * 0.55;
    const hz = this.player.z + Math.cos(this.player.yaw) * 0.55;
    for (let i = this.spills.length - 1; i >= 0; i--) {
      const sp = this.spills[i];
      const d = Math.hypot(sp.x - hx, sp.z - hz);
      if (d > 0.42) continue;
      sp.s -= dt * 1.6;
      if (sp.s <= 0.12) {
        this.spills.splice(i, 1);
        this.stats.popcornCleared = (this.stats.popcornCleared || 0) + 1;
        this.sound.vacuumEat();
        if (!this.spills.length) {
          this.ui.toast(this.popper.running
            ? `That's the floor. The machine is still going.`
            : `That's the last of it.`, 'good');
        }
      }
    }
  }

  /* ============================================================
     THE BUS

     A coach comes off the highway and two dozen people get out of it,
     and every one of them looks exactly the same -- same coat, same hair,
     same everything, because they are all going to the same thing and
     they have all dressed for it. They come through the door together,
     they all want a film, and some of them will tell you about their
     journey while the line behind them grows.

     He does not work a night the bus comes. Two dozen identical people is
     no night to be picking a face out of a room, and a man who wants to
     be remembered as nobody in particular does not walk into a shop where
     everybody already is. If he is in the building when the coach is due,
     the coach waits -- it can circle the lot, or it can be a bit late.
     ============================================================ */
  /** Is the coach still to come, and can it come now? */
  busDue() {
    const N = this.night;
    if (!N || this.bus || this.sim < N.busAt) return false;
    if (this.closing) return false;
    return true;
  }

  updateBus(dt) {
    if (this.bus) {
      /* They arrive over a handful of seconds rather than all landing on
         one tile, which is a doorway full of people wedged in each other. */
      const B = this.bus;
      B.t += dt;
      /* Four dozen at half a second each is half a minute of doorway, so
         they come in a good deal faster than that -- close to as fast as
         the door will pass them. */
      while (B.made < B.total && B.t > B.made * 0.26) {
        this.customers.push(this.makeBusRider(B, B.made));
        B.made++;
      }
      return;
    }
    if (!this.busDue()) return;

    const k = this.killer;
    /* He is in the shop, or on his way in. The coach is late tonight. */
    if (k && k.plan.appears && (killerActive(k) || killerInside(k)
      || (k.phase === KP.CUSTOMER && k.ent && !k.ent.hidden))) {
      this.night.busAt = this.sim + 20;
      return;
    }
    this.beginBus();
  }

  beginBus() {
    const rng = this.rng;
    /* One face, worn by all of them. */
    const app = randomAppearance(rng);
    this.bus = {
      app, skin: paintSkin(app),
      /* Three to four dozen. Enough that the shop stops being a shop with
         a queue in it and becomes a room you cannot cross. */
      total: 36 + rng.int(13),
      made: 0, t: 0,
      /* Their name, which is also all the same, give or take. */
      surname: randomName(rng, app.gender).split(' ')[1],
    };
    /* And he stays away. Not "hides" -- does not come. */
    const k = this.killer;
    if (k) { k.plan.appears = false; k.phase = KP.ABSENT; if (k.ent) k.ent.hidden = true; }
    this.sound.doorChime();
    this.ui.toast(`A coach pulls into the lot. It does not look like it is passing through.`, 'bad');
    this.ui.toast(`They are all wearing the same coat.`, '');
  }

  /** One of them. They differ in temperament and in nothing else. */
  makeBusRider(B, i) {
    const rng = this.rng;
    const c = createCustomer(rng, {
      app: B.app,
      name: `${randomName(rng, B.app.gender).split(' ')[0]} ${B.surname}`,
      intent: 'RENT',
    });
    /* Same face, same coat, same everything -- and each of them their own
       person underneath it, which is what makes some of them quick and
       some of them the reason the line is not moving. */
    c.fromBus = true;
    /* They are not in a hurry and they are not going to get shirty with
       you. They have been on a coach for four hours together and they are
       all waiting for each other anyway -- and forty of them running down
       their patience at once would empty the shop through the one door
       just as you got on top of it. Whatever else the coach is, it is not
       a crowd that storms out. */
    c.patient = true;
    /* Along the sidewalk, not out in the road. The curb is at z -4.6 and
       there is a solid behind it, so spreading four dozen people backwards
       off the pavement pinned most of the coach against that wall with
       nowhere to path from -- eighteen of them stacked on one tile in the
       middle of the street, not moving, for the rest of the night.
       They spread sideways instead, which is where a pavement goes. */
    const spread = this.busSpawn(i, B.total);
    c.x = spread.x;
    c.z = spread.z;
    /* About one in four wants to tell you about the journey. */
    c.rambles = rng.chance(0.26) ? 0 : -1;
    return c;
  }

  /**
   * Where the Nth person off the coach is standing when they get out.
   *
   * Strung along the pavement in front of the shop, on floor they can
   * actually walk on -- checked against the same solids as everything
   * else, because the curb has a wall behind it.
   */
  busSpawn(i, total) {
    const S = SPOTS.street;
    const lanes = 3;
    const lane = i % lanes;
    const along = Math.floor(i / lanes);
    const perLane = Math.max(1, Math.ceil(total / lanes));
    const t = perLane <= 1 ? 0.5 : along / (perLane - 1);
    for (let give = 0; give < 4; give++) {
      const x = S.x + (t - 0.5) * (9.0 - give * 1.8);
      const z = S.z + 0.45 - lane * 0.62 + give * 0.25;
      if (this.onOpenFloor(x, z)) return { x, z };
    }
    return { x: S.x + (i % 5 - 2) * 0.4, z: S.z };
  }

  /** Are we in the middle of it? The shop is a different place while we are. */
  busPresent() {
    if (!this.bus) return false;
    return this.customers.some((c) => c.fromBus && !c.hidden
      && c.state !== CS.GONE && c.state !== CS.LEAVING);
  }

  phoneTargets() {
    // Nobody is coming in a casual shift, so nobody can be called in either
    // -- and getting fired for accusing a customer is not a thing that
    // belongs in the mode you picked to avoid all of that.
    if (this.mode === MODE.CASUAL) return [];
    const out = [];
    for (const c of this.customers) if (c.z > -0.5 && c.z < D) out.push(c);
    /* Names are built against the room rather than fixed when somebody is
       created. Two people in the same coat used to read as the same line
       twice, so choosing between them was a coin toss rather than a look
       at the pair of them -- and on a night whose bulletin is about a coat,
       two of them in the same coat is exactly the night you get. */
    describeApart(out).forEach((label, i) => { out[i].phoneLabel = label; });

    const k = this.killer;
    if (k && !k.ent.hidden) {
      if (k.phase === KP.CUSTOMER) {
        /* He is working the floor as a customer. He was in the list above
           and got named with everybody else -- unless he has slipped out
           of the customer list, in which case he still needs a name. */
        if (!out.includes(k.ent)) {
          out.push(k.ent);
          describeApart(out).forEach((label, i) => { out[i].phoneLabel = label; });
        }
      } else if (killerActive(k)) {
        // Not a description any more. You are watching him come through it.
        const e = k.ent;
        e.phoneLabel = killerInside(k)
          ? `THE ONE WHO JUST CAME THROUGH THE DOOR`
          : `The one out on the sidewalk`;
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
  mess: [
    `There is popcorn as far as the returns bin.`,
    `You can hear it hitting the carpet from here.`,
    `Something under your shoe. Then something else.`,
    `The machine does not sound like it is going to stop on its own.`,
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

/* He is not here to read a bulletin this time. He is here to tell you the
   street is empty and that it should not have been. */
const SWEEP_NAGS = [
  `Clerk. I've got something you'll want to hear.`,
  `When you're done there. It's about the call you made.`,
  `Over here. Won't take a minute.`,
  `I came in to say this to your face. So come here.`,
  `You called us. Least you can do is listen to what we found.`,
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
