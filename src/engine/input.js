/* ============================================================
   input.js -- keyboard, mouse look with pointer lock, gamepads,
   and a one-shot "pressed this frame" edge buffer for menus.

   Pad buttons are folded into the same key set the rest of the
   game already tests, so every existing `hit('KeyE')` works with
   a controller without knowing a controller exists. What the pad
   does add is `scheme`, which the UI reads to decide whether to
   draw a keyboard cap, an Xbox face button or a PlayStation shape.
   ============================================================ */

/**
 * The things a pad can be asked to do, and the keys each one stands in for.
 *
 * Pad buttons are folded into the same key set the rest of the game already
 * tests, so every existing `hit('KeyE')` works with a controller without
 * knowing a controller exists.
 *
 * `def` is where the button sits under the standard mapping -- the bottom
 * face button confirms and the right one goes back, which is the same
 * physical button on both families: A / cross to select, B / circle to back
 * out. Pads that do not follow the standard mapping put them somewhere else
 * entirely, which is what the binding table below is for.
 */
export const PAD_ACTIONS = {
  /* The bottom face button, and only that. It used to carry the right
     trigger as well, which is where sprint now lives -- and a sprint that
     also picks the highlighted reply is not a sprint. */
  confirm: { label: 'Select / interact', keys: ['PadA', 'KeyE', 'Enter', 'Space'], def: [0] },
  /* B stands in for a back key of its own rather than for Escape. Escape
     both backs out of a menu and pauses the shift, so while B spoke as
     Escape it paused the game too -- there was no way for the play loop to
     tell the two apart. The keyboard is unchanged: every screen that goes
     back still tests Escape as well. */
  back: { label: 'Back / cancel', keys: ['PadB', 'UiBack'], def: [1] },
  drop: { label: 'Put it down', keys: ['PadX', 'KeyG'], def: [2] },
  notes: { label: 'Notepad', keys: ['PadY', 'Tab'], def: [3] },
  /* On both triggers: either one, or both at once. It used to be LB and
     L3; holding a stick click down to run the length of the store is hard on
     a thumb, and a trigger is what a trigger is for. Which hand you reach
     with is nobody's business. A trigger reads as pressed past halfway. */
  run: { label: 'Hurry', keys: ['PadLT', 'ShiftLeft'], def: [6, 7] },
  /* Its own button, and not the one that opens doors.

     It used to sit on interact as well, which read as consistent with the
     keyboard -- but it meant that the button you press to open the back
     room door was also the button that bolts it, and which of the two you
     got depended on where you were standing. Interact opens doors. This
     bolts them, from anywhere in the back room, which is the whole point
     of having it on a button of its own when somebody is coming. */
  bolt: { label: 'Throw the bolt', keys: ['PadRB', 'KeyF'], def: [5] },
  pause: { label: 'Pause', keys: ['PadStart', 'Escape'], def: [9] },
  up: { label: 'Up', keys: ['PadUp', 'ArrowUp'], def: [12] },
  down: { label: 'Down', keys: ['PadDown', 'ArrowDown'], def: [13] },
  left: { label: 'Left', keys: ['PadLeft', 'ArrowLeft'], def: [14] },
  right: { label: 'Right', keys: ['PadRight', 'ArrowRight'], def: [15] },
};

/** The actions worth putting in front of a player, in a sensible order. */
export const BINDABLE = ['confirm', 'back', 'drop', 'notes', 'run', 'bolt', 'pause',
  'up', 'down', 'left', 'right'];

/**
 * The keyboard, made rebindable the same way the pad is.
 *
 * The rest of the game tests CANONICAL keys ('KeyE' for interact, 'KeyW' for
 * forward, and so on) -- the same physical codes movement and interaction have
 * always used. A rebind does not touch any of those call sites: it just makes
 * the player's chosen physical key PRODUCE the canonical one, and stops the old
 * key from producing it. So `hit('KeyE')` keeps working after INTERACT moves to
 * F, because pressing F now emits 'KeyE'.
 *
 * Only real gameplay actions are here. Menu navigation (the arrows, Enter,
 * Escape) is deliberately NOT rebindable and always works, so a player can
 * never bind themselves out of the menus -- see KEY_RESERVED.
 */
export const KEY_ACTIONS = {
  forward: { label: 'Walk forward', canon: 'KeyW', def: 'KeyW' },
  back: { label: 'Walk back', canon: 'KeyS', def: 'KeyS' },
  left: { label: 'Step left', canon: 'KeyA', def: 'KeyA' },
  right: { label: 'Step right', canon: 'KeyD', def: 'KeyD' },
  interact: { label: 'Interact / talk', canon: 'KeyE', def: 'KeyE' },
  notes: { label: 'Notepad', canon: 'Tab', def: 'Tab' },
  drop: { label: 'Put it down', canon: 'KeyG', def: 'KeyG' },
  run: { label: 'Hurry', canon: 'ShiftLeft', def: 'ShiftLeft' },
  bolt: { label: 'Throw the bolt', canon: 'KeyF', def: 'KeyF' },
};
export const KEY_BINDABLE = ['forward', 'back', 'left', 'right', 'interact', 'notes', 'drop', 'run', 'bolt'];

/* Keys that run the menus, pause, and the safety fallbacks -- never assignable
   to a gameplay action, so the player cannot trap themselves out of Settings or
   lose the ability to walk (the arrows always move as well). */
const KEY_RESERVED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Space',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'F1',
]);

/* Human-readable cap for a physical code, for the prompts and the rebind
   screen. Falls back to the bare code for anything exotic. */
export function codeLabel(code) {
  if (!code) return '?';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const named = {
    Tab: 'TAB', Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'RSHIFT',
    ControlLeft: 'CTRL', ControlRight: 'RCTRL', AltLeft: 'ALT', AltRight: 'RALT',
    Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  };
  return named[code] || code.toUpperCase();
}

/** Default keyboard binds: each action on its default physical code. */
export function defaultKeyBinds() {
  const out = {};
  for (const a of Object.keys(KEY_ACTIONS)) out[a] = KEY_ACTIONS[a].def;
  return out;
}

/**
 * button index -> the actions on it, as the standard mapping lays it out.
 *
 * A list rather than a single id: one button can carry several jobs, the
 * way E on the keyboard both interacts and throws the bolt. An action still
 * lives on one button at a time, but a button can hold as many as you like.
 */
export function defaultBinds() {
  const out = {};
  for (const id of Object.keys(PAD_ACTIONS)) {
    for (const i of PAD_ACTIONS[id].def) (out[i] = out[i] || []).push(id);
  }
  return out;
}

/** Old saves stored one action per button. Bring those forward. */
export function normaliseBinds(b) {
  const out = {};
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    const list = Array.isArray(v) ? v.slice() : (v ? [v] : []);
    if (list.length) out[k] = list;
  }
  return out;
}

const DEAD = 0.22;
const EMPTY = [];

/**
 * Layouts we know about that the browser will not describe.
 *
 * Chrome and Safari on macOS report an Xbox pad with a non-standard mapping
 * and shuffled indices: A lands on 1, B on 2, X on 3, Y on 5, and the right
 * stick click on 11. Rather than leaving a first-party controller unbound
 * until the player sets it up by hand, recognize it and lay the buttons out
 * properly -- while still letting them change any of it.
 */
const KNOWN_LAYOUTS = [
  {
    id: 'xbox-macos',
    match: (id) => /xbox|045e|microsoft/i.test(id),
    mac: true,
    /* Only the buttons somebody has actually sat down and read off this
       machine. The first version of this filled in the rest from the
       standard mapping, which is how LB ended up opening the notepad: a
       guessed binding on an index nobody had checked. Anything not listed
       does nothing until the player binds it, which is the right default
       for a layout we are only half sure of. */
    binds: {
      1: ['confirm', 'bolt'],
      2: ['back'],
      3: ['drop'],
      5: ['notes'],
      11: ['run'],
    },
  },
];

/** The layout for a pad the browser will not vouch for, or null. */
export function knownLayout(id, platform) {
  const onMac = /mac|iphone|ipad/i.test(String(platform || ''));
  for (const L of KNOWN_LAYOUTS) {
    if (L.mac && !onMac) continue;
    if (L.match(String(id || ''))) return { id: L.id, binds: normaliseBinds(L.binds) };
  }
  return null;
}

/* Menu navigation off the stick. A stick is not a key, so it gets an
   explicit edge: push past NAV_ON to fire, fall back under NAV_OFF before
   it can fire again, and hold it to repeat at a readable rate. */
const NAV_ON = 0.55;
const NAV_OFF = 0.35;
const NAV_DELAY = 420;    // ms before a held direction starts repeating
const NAV_REPEAT = 150;   // ms between repeats after that

/** Which family of button art a pad wants, from whatever it calls itself. */
export function schemeFor(id) {
  const s = String(id || '').toLowerCase();
  /* Order matters. Microsoft's own pads report as "Xbox Wireless
     Controller", and Sony's report as "Wireless Controller" with nothing
     else to go on -- so the explicit vendors are tested first and the bare
     phrase is only taken as Sony once Xbox has been ruled out. */
  if (/xbox|xinput|045e|microsoft/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|sony|054c/.test(s)) return 'playstation';
  if (/wireless controller/.test(s)) return 'playstation';
  // Nintendo-style pads have their face buttons the other way round, but the
  // standard mapping still reports them by position, so Xbox art is right.
  return 'xbox';
}

export class Input {
  constructor(target) {
    this.target = target;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mdx = 0; this.mdy = 0;
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.locked = false;
    this.sensitivity = 0.0022;
    this.padSensitivity = 4.2;          // radians per second at full deflection
    this.invertY = false;
    this.enabled = true;
    /* Set once the page has made clear it will not hand over the mouse.
       See lockRefused(). */
    this.lockBlocked = false;
    this.refusals = 0;

    /* Analog state, merged from keyboard and stick so movement code never
       has to care which one is driving. */
    this.moveX = 0; this.moveZ = 0;
    this.lookX = 0; this.lookY = 0;
    this.run = false;

    /** 'kbm' until a pad is actually used, then 'xbox' or 'playstation'. */
    this.scheme = 'kbm';
    this.padId = '';
    this._padIndex = -1;
    this._padDown = new Set();
    /** Per-direction stick-nav state: held flag and next-fire timestamp. */
    this._nav = { u: 0, d: 0, l: 0, r: 0 };
    /** What the pad calls itself and how it says it is laid out. */
    this.padMapping = '';
    /** button index -> action id. Rebindable, because not every pad agrees. */
    this.binds = defaultBinds();
    /** True once the player has bound something, or we loaded their layout. */
    this.bindsAreUser = false;
    /** False when the browser will not vouch for the pad's layout. */
    this.padTrusted = true;
    this._laidOutFor = null;
    /** Live state, for the controller screen: which indices are down now. */
    this.padDownIndices = [];
    /** True once axis 9 has read outside [-1,1], which only a hat does. */
    this._hatSeenNeutral = false;
    this.padAxes = [];
    this.padButtonCount = 0;
    /** When set, the next button pressed is bound to this action instead. */
    this.capturing = null;
    this.onCaptured = null;
    /* Keyboard remapping. keyBinds is action -> physical code; the handlers
       translate a pressed physical key into the canonical key(s) the game
       tests, via the maps _rebuildKeyMap() builds. */
    this.keyBinds = defaultKeyBinds();
    this.keyBindsUser = false;
    this.capturingKey = null;
    this.onKeyCaptured = null;
    this._rebuildKeyMap();
    this._bind();
  }

  /* Build the physical->canonical translation from the current keyBinds.
     _emit maps a physical code to the canonical codes it should produce;
     _canon is the set of all canonical gameplay codes, so a canonical key that
     has been rebound AWAY produces nothing. */
  _rebuildKeyMap() {
    this._emit = {};
    this._canon = new Set();
    for (const a of Object.keys(KEY_ACTIONS)) {
      const canon = KEY_ACTIONS[a].canon;
      this._canon.add(canon);
      const code = this.keyBinds[a] || KEY_ACTIONS[a].def;
      (this._emit[code] = this._emit[code] || []).push(canon);
    }
  }

  /* Translate one physical code into the logical codes to register. A bound
     key emits its action's canonical code(s); a reserved/menu key or any key
     the game reads raw passes through; a canonical key that was rebound away
     emits nothing. */
  _translate(code) {
    if (this._emit[code]) return this._emit[code];
    if (this._canon.has(code)) return EMPTY;   // a canonical key, unbound from its action
    return [code];                              // arrows, Enter, Escape, digits, debug, etc.
  }

  /**
   * Put a gameplay action on a physical key.
   *
   * Refuses the reserved menu/pause keys. If the key already carries another
   * gameplay action, the two SWAP -- the displaced action takes the key this
   * one was on -- so a rebind never silently leaves two actions on one key or
   * an action on nothing.
   */
  bindKey(action, code) {
    if (!KEY_ACTIONS[action] || !code || KEY_RESERVED.has(code)) return false;
    const old = this.keyBinds[action];
    for (const a of Object.keys(this.keyBinds)) {
      if (a !== action && this.keyBinds[a] === code) this.keyBinds[a] = old;
    }
    this.keyBinds[action] = code;
    this.keyBindsUser = true;
    this._rebuildKeyMap();
    return true;
  }

  /** Load a saved keyboard map, validated action by action; unknown actions
      and reserved keys are ignored, missing ones keep their default. */
  setKeyBinds(map) {
    if (!map || typeof map !== 'object') return;
    const next = defaultKeyBinds();
    let any = false;
    for (const a of Object.keys(KEY_ACTIONS)) {
      const c = map[a];
      if (typeof c === 'string' && c && !KEY_RESERVED.has(c)) { next[a] = c; any = true; }
    }
    this.keyBinds = next;
    this.keyBindsUser = any;
    this._rebuildKeyMap();
  }

  /** Back to the default keyboard layout. Never touches the pad binds. */
  resetKeyBinds() {
    this.keyBinds = defaultKeyBinds();
    this.keyBindsUser = false;
    this._rebuildKeyMap();
  }

  /** The next keyboard key pressed is bound to `action` rather than acting. */
  captureKey(action) { this.capturingKey = action; }
  cancelCaptureKey() { this.capturingKey = null; }

  /** action -> readable cap, for prompts and the rebind screen. */
  keyCaps() {
    const out = {};
    for (const a of Object.keys(KEY_ACTIONS)) out[a] = codeLabel(this.keyBinds[a]);
    // interact doubles as the menu-confirm cap the prompts call 'interact'.
    out.confirm = out.interact;
    return out;
  }

  _bind() {
    const norm = (e) => {
      // Use physical key codes so WASD works on any layout.
      if (e.code) return e.code;
      return e.key.length === 1 ? 'Key' + e.key.toUpperCase() : e.key;
    };
    addEventListener('keydown', (e) => {
      const phys = norm(e);
      if (BLOCK.has(phys)) e.preventDefault();
      this.scheme = 'kbm';
      /* A keyboard rebind swallows the next press: bind it and act on nothing.
         Repeats fire while a key is held, so only the first (a real edge) binds. */
      if (this.capturingKey && !e.repeat) {
        const act = this.capturingKey;
        this.capturingKey = null;
        if (this.bindKey(act, phys) && this.onKeyCaptured) this.onKeyCaptured(act, phys);
        e.preventDefault();
        return;
      }
      // Translate the physical key into the logical key(s) the game reads.
      for (const k of this._translate(phys)) {
        if (!this.down.has(k)) this.pressed.add(k);
        this.down.add(k);
      }
      if (this.onGesture) this.onGesture();
    });
    addEventListener('keyup', (e) => {
      const phys = norm(e);
      for (const k of this._translate(phys)) { this.down.delete(k); this.released.add(k); }
    });
    addEventListener('blur', () => {
      this.down.clear(); this.mouse = [false, false, false];
      this._padDown.clear(); this.moveX = 0; this.moveZ = 0; this.lookX = 0; this.lookY = 0;
      this._nav.u = this._nav.d = this._nav.l = this._nav.r = 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (this.locked) { this.refusals = 0; this.lockBlocked = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    /* A refusal that is not going to change its mind.
       Asking at the wrong moment is normal and the next gesture fixes it,
       so a single failure means nothing. But the page around the game can
       refuse outright -- an embed on somebody else's site, in a frame
       that was not granted pointer lock -- and then the camera never
       moves, and "Click to look around" is advice the player can follow
       for the rest of the night without it ever working. */
    document.addEventListener('pointerlockerror', () => this.lockRefused());
    this.target.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mdx += e.movementX || 0;
      this.mdy += e.movementY || 0;
    });
    this.target.addEventListener('mousedown', (e) => {
      if (e.button < 3) { if (!this.mouse[e.button]) this.mousePressed[e.button] = true; this.mouse[e.button] = true; }
      this.scheme = 'kbm';
      /* Fired from inside the real event, which is the only place the
         browser will honor a pointer-lock request. */
      if (this.onGesture) this.onGesture();
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => { if (e.button < 3) this.mouse[e.button] = false; });
    this.target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', (e) => { this._padIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this._padIndex = -1; });
  }

  /** Call once per frame, before anything reads input. */
  poll() {
    this._pollPad();
    // keyboard movement, folded in with whatever the stick is doing
    let kx = 0, kz = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) kz += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) kz -= 1;
    /* The arrows strafe as well as walk. The d-pad speaks arrow keys, so
       left and right on it used to reach a fold that only listened for A
       and D -- which is why up and down worked on a pad and the other two
       did nothing at all. */
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) kx -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) kx += 1;
    if (kx || kz) { this.moveX = kx; this.moveZ = kz; }
    this.run = this.run || this.down.has('ShiftLeft') || this.down.has('ShiftRight');
  }

  _pollPad() {
    this.moveX = 0; this.moveZ = 0; this.lookX = 0; this.lookY = 0; this.run = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!pads) return;
    let pad = this._padIndex >= 0 ? pads[this._padIndex] : null;
    if (!pad || !pad.connected) {
      pad = null;
      for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; this._padIndex = i; break; }
    }
    if (!pad) { this._padDown.clear(); return; }

    /* Decide what this pad's buttons mean, once per pad.

       If the browser reports the standard mapping, the indices are the
       standard ones and the default table is right. If it does not -- and
       Safari and Chrome on macOS routinely do not, even for a first-party
       Xbox pad -- then the indices are whatever the driver felt like, and
       laying the standard table over them is worse than laying nothing over
       them: it does not merely fail to select, it does the wrong thing,
       putting A on Escape and X on the notepad. So a pad we cannot vouch
       for starts with nothing bound. Every button then reads as PadAny,
       which works any menu, and the player is pointed at the controller
       screen to say which button is which. */
    if (this._laidOutFor !== pad.id) {
      this._laidOutFor = pad.id;
      this.padTrusted = pad.mapping === 'standard';
      this._hatSeenNeutral = false;
      const known = this.padTrusted ? null
        : knownLayout(pad.id, typeof navigator !== 'undefined' ? navigator.platform : '');
      this.knownAs = known ? known.id : '';
      if (!this.bindsAreUser) {
        this.binds = this.padTrusted ? defaultBinds() : (known ? known.binds : {});
      }
      this._padDown.clear();
    }

    let used = false;
    const ax = pad.axes || [];
    const curve = (v) => {
      const a = Math.abs(v);
      if (a < DEAD) return 0;
      const t = (a - DEAD) / (1 - DEAD);
      return Math.sign(v) * t * t;              // squared, for fine control near center
    };
    const rawX = ax[0] || 0, rawY = ax[1] || 0;
    /* Movement wants a squared curve -- it buys fine control near the
       center, and you are only ever walking. Looking does not: squaring it
       meant half a stick gave a quarter of the speed, and turning around took
       an age unless you pinned it to the edge. The look axes get a much
       gentler shape. */
    const lookCurve = (v) => {
      const a = Math.abs(v);
      if (a < DEAD) return 0;
      const t = (a - DEAD) / (1 - DEAD);
      return Math.sign(v) * t * (0.35 + 0.65 * t);
    };
    const lx = curve(rawX), ly = curve(rawY);
    const rx = lookCurve(ax[2] || 0), ry = lookCurve(ax[3] || 0);
    if (lx || ly) { this.moveX = lx; this.moveZ = -ly; used = true; }
    if (rx || ry) { this.lookX = rx; this.lookY = ry; used = true; }
    // The left stick drives menus as well as the player. Feeding it in as
    // arrow-key edges means every menu that already reads the keyboard gets
    // stick navigation without knowing a stick exists.
    if (this._stickNav(rawX, rawY)) used = true;

    const btns = pad.buttons || [];
    this.padButtonCount = btns.length;
    this.padAxes = Array.prototype.slice.call(ax);
    const live = [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const on = typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5;
      if (on) live.push(i);
      const actions = this.binds[i] || [];
      /* Every button announces its own index whether it is bound or not, so
         the controller screen can show a pad the standard mapping does not
         describe -- and so an unbound button can still work a menu. A button
         carrying several actions sends the keys for all of them. */
      let keys = ['Pad#' + i];
      if (actions.length) {
        for (const a of actions) if (PAD_ACTIONS[a]) keys = keys.concat(PAD_ACTIONS[a].keys);
      } else keys.push('PadAny');
      const id = 'Btn' + i;
      if (on) {
        used = true;
        if (!this._padDown.has(id)) {
          this._padDown.add(id);
          if (this.capturing) {
            // A rebind swallows the press rather than acting on it.
            const act = this.capturing;
            this.capturing = null;
            this.bindButton(i, act);
            if (this.onCaptured) this.onCaptured(act, i);
          } else {
            for (const k of keys) this.pressed.add(k);
          }
        }
        for (const k of keys) this.down.add(k);
      } else if (this._padDown.has(id)) {
        this._padDown.delete(id);
        for (const k of keys) this.down.delete(k);
      }
    }
    this.padDownIndices = live;
    /* Running comes in as ShiftLeft with everything else, folded in by
       poll(). This used to look for held ids that the button loop stopped
       producing when bindings became rebindable, so it had quietly done
       nothing for a while. */
    /* Some pads report the D-pad as a hat switch on a ninth axis instead of
       as four buttons. Fold that in so those pads can drive a menu too --
       but only once the axis has proved it really is a hat.

       A hat at rest reads outside [-1, 1]: 3.29 is the usual value. An axis
       that is not a hat at all sits at 0, which is dead center of the range
       this used to accept, and 0 decodes to "down". Every pad with ten or
       more axes therefore had a phantom d-pad holding down. That is what
       "the d-pad acts weird in menus" was. */
    if (ax.length > 9) {
      const hat = ax[9];
      if (hat > 1.05 || hat < -1.05) this._hatSeenNeutral = true;
      if (this._hatSeenNeutral && hat >= -1.0 && hat <= 1.0) {
        const HAT = [PAD_ACTIONS.up.keys, PAD_ACTIONS.right.keys,
          PAD_ACTIONS.down.keys, PAD_ACTIONS.left.keys];
        // -1 is up, and it sweeps clockwise through the eight positions.
        const live = Math.round((hat + 1) * 3.5);
        HAT.forEach((keys, q) => {
          const on = live === q * 2 || live === (q * 2 + 7) % 8 || live === (q * 2 + 1) % 8;
          const id = 'Hat' + keys[1];
          if (on) {
            used = true;
            if (!this._padDown.has(id)) { this._padDown.add(id); for (const k of keys) this.pressed.add(k); }
          } else this._padDown.delete(id);
        });
      }
    }

    if (used) {
      this.scheme = schemeFor(pad.id);
      this.padId = pad.id;
      this.padMapping = pad.mapping || '';
    }
  }

  /**
   * Turn stick deflection into repeating arrow-key edges.
   *
   * These go into `pressed` only, never `down`: a menu asks `hit()` and
   * gets one press per push, while the analog movement values the player
   * uses stay untouched by it.
   */
  _stickNav(x, y) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const DIRS = [
      ['u', -y, 'ArrowUp'], ['d', y, 'ArrowDown'],
      ['l', -x, 'ArrowLeft'], ['r', x, 'ArrowRight'],
    ];
    let any = false;
    for (const [id, v, key] of DIRS) {
      if (v >= NAV_ON) {
        any = true;
        if (!this._nav[id]) { this._nav[id] = now + NAV_DELAY; this.pressed.add(key); }
        else if (now >= this._nav[id]) { this._nav[id] = now + NAV_REPEAT; this.pressed.add(key); }
      } else if (v < NAV_OFF) {
        this._nav[id] = 0;
      }
    }
    return any;
  }

  /**
   * Put an action on a button.
   *
   * The action comes off whatever button had it, and goes onto this one
   * alongside whatever that button already does. Pressing the button a
   * second time on the same row takes it off again, which is how you clear
   * one without a separate control for it.
   */
  bindButton(index, action) {
    if (!PAD_ACTIONS[action]) return;
    const had = (this.binds[index] || []).includes(action);
    for (const k of Object.keys(this.binds)) {
      const list = this.binds[k].filter((a) => a !== action);
      if (list.length) this.binds[k] = list; else delete this.binds[k];
    }
    if (!had) (this.binds[index] = this.binds[index] || []).push(action);
    this.bindsAreUser = true;
    /* The button that did this is still held. Leaving it in the held set
       means it has to be released before it counts as a press again --
       clearing it here made the very next frame see a fresh press, which
       re-armed the capture and toggled the binding straight back off. */
  }

  /** The indices currently standing for an action, for the settings screen. */
  bindsFor(action) {
    return Object.keys(this.binds)
      .filter((k) => this.binds[k].includes(action))
      .map(Number).sort((a, b) => a - b);
  }

  /** Everything one button does, for the settings screen. */
  actionsOn(index) { return (this.binds[index] || []).slice(); }

  /** The next button PRESSED is bound to `action` rather than acting.
      A button already held when you arrive on the row does not count. */
  capture(action) { this.capturing = action; }
  cancelCapture() { this.capturing = null; }

  /** Back to whatever this pad's layout deserves: the standard table if the
      browser vouched for it, nothing if it did not. */
  resetBinds() {
    this.bindsAreUser = false;
    this.binds = this.padTrusted ? defaultBinds() : {};
    this._padDown.clear();
  }

  /**
   * Ask for the pointer.
   *
   * The browser only grants this off the back of a user gesture, or shortly
   * after a previous lock was released. Asking from anywhere else -- the end
   * of a cinematic, say -- fails silently, and in Chrome the returned
   * promise rejects, so swallow it rather than logging on every night
   * change. Whoever wanted the lock should also set a flag and try again on
   * the next keystroke or click.
   */
  requestLock() {
    if (this.locked || !this.target.requestPointerLock) return;
    try {
      const p = this.target.requestPointerLock();
      if (p && p.catch) p.catch((e) => this.lockRefused(e && e.message));
    } catch (err) { this.lockRefused(err && err.message); }
  }

  /**
   * The browser said no. Twice is bad luck; three times is a policy.
   *
   * Chrome says why, and when the reason is the frame's permissions there
   * is no point waiting for a better moment -- that is decided once, by
   * the page doing the embedding, and it is not going to change. Other
   * browsers only fire the bare error event, so a run of refusals counts
   * for the same thing.
   */
  lockRefused(why) {
    this.refusals = (this.refusals || 0) + 1;
    if (this.refusals >= 3 || /sandbox|permission|disallow|not allowed/i.test(why || '')) {
      this.lockBlocked = true;
    }
  }
  exitLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }

  isDown(...keys) { return keys.some((k) => this.down.has(k)); }
  hit(...keys) { return keys.some((k) => this.pressed.has(k)); }

  /** Call once per frame, after all systems have read input. */
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mdx = 0; this.mdy = 0;
    this.mousePressed[0] = this.mousePressed[1] = this.mousePressed[2] = false;
  }
}

const BLOCK = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'F1', 'Slash', 'Quote']);
