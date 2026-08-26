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
  confirm: { label: 'Select / interact', keys: ['PadA', 'KeyE', 'Enter', 'Space'], def: [0, 7] },
  back: { label: 'Back / cancel', keys: ['PadB', 'Escape'], def: [1] },
  drop: { label: 'Put it down', keys: ['PadX', 'KeyG'], def: [2] },
  notes: { label: 'Notepad', keys: ['PadY', 'Tab'], def: [3] },
  run: { label: 'Hurry', keys: ['PadLB', 'ShiftLeft'], def: [4, 10] },
  bolt: { label: 'Throw the bolt', keys: ['PadRB', 'KeyF'], def: [5] },
  pause: { label: 'Pause', keys: ['PadStart', 'Escape'], def: [9] },
  up: { label: 'Up', keys: ['PadUp', 'ArrowUp'], def: [12] },
  down: { label: 'Down', keys: ['PadDown', 'ArrowDown'], def: [13] },
  left: { label: 'Left', keys: ['PadLeft', 'ArrowLeft'], def: [14] },
  right: { label: 'Right', keys: ['PadRight', 'ArrowRight'], def: [15] },
};

/** The actions worth putting in front of a player, in a sensible order. */
export const BINDABLE = ['confirm', 'back', 'drop', 'notes', 'run', 'bolt', 'pause'];

/** button index -> action id, as the standard mapping lays it out. */
export function defaultBinds() {
  const out = {};
  for (const id of Object.keys(PAD_ACTIONS)) {
    for (const i of PAD_ACTIONS[id].def) out[i] = id;
  }
  return out;
}

const DEAD = 0.22;

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
    this.padSensitivity = 2.6;          // radians per second at full deflection
    this.invertY = false;
    this.enabled = true;

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
    this.padAxes = [];
    this.padButtonCount = 0;
    /** When set, the next button pressed is bound to this action instead. */
    this.capturing = null;
    this.onCaptured = null;
    this._bind();
  }

  _bind() {
    const norm = (e) => {
      // Use physical key codes so WASD works on any layout.
      if (e.code) return e.code;
      return e.key.length === 1 ? 'Key' + e.key.toUpperCase() : e.key;
    };
    addEventListener('keydown', (e) => {
      const k = norm(e);
      if (BLOCK.has(k)) e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      this.scheme = 'kbm';
      if (this.onGesture) this.onGesture();
    });
    addEventListener('keyup', (e) => {
      const k = norm(e);
      this.down.delete(k); this.released.add(k);
    });
    addEventListener('blur', () => {
      this.down.clear(); this.mouse = [false, false, false];
      this._padDown.clear(); this.moveX = 0; this.moveZ = 0; this.lookX = 0; this.lookY = 0;
      this._nav.u = this._nav.d = this._nav.l = this._nav.r = 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    this.target.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mdx += e.movementX || 0;
      this.mdy += e.movementY || 0;
    });
    this.target.addEventListener('mousedown', (e) => {
      if (e.button < 3) { if (!this.mouse[e.button]) this.mousePressed[e.button] = true; this.mouse[e.button] = true; }
      this.scheme = 'kbm';
      /* Fired from inside the real event, which is the only place the
         browser will honour a pointer-lock request. */
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
    if (this.down.has('KeyA')) kx -= 1;
    if (this.down.has('KeyD')) kx += 1;
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
      if (!this.bindsAreUser) this.binds = this.padTrusted ? defaultBinds() : {};
      this._padDown.clear();
    }

    let used = false;
    const ax = pad.axes || [];
    const curve = (v) => {
      const a = Math.abs(v);
      if (a < DEAD) return 0;
      const t = (a - DEAD) / (1 - DEAD);
      return Math.sign(v) * t * t;              // squared, for fine control near centre
    };
    const rawX = ax[0] || 0, rawY = ax[1] || 0;
    const lx = curve(rawX), ly = curve(rawY);
    const rx = curve(ax[2] || 0), ry = curve(ax[3] || 0);
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
      const action = this.binds[i];
      // Every button announces its own index whether it is bound or not, so
      // the controller screen can show a pad the standard mapping does not
      // describe -- and so an unbound button can still work a menu.
      const keys = action ? PAD_ACTIONS[action].keys.concat('Pad#' + i) : ['Pad#' + i, 'PadAny'];
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
    if (this._padDown.has('PadLB') || this._padDown.has('PadL3')) this.run = true;
    /* Some pads report the D-pad as a hat switch on a ninth axis instead of
       as four buttons. Fold that in so those pads can drive a menu too. */
    if (ax.length > 9) {
      const hat = ax[9];
      if (hat >= -1.2 && hat <= 1.2) {
        const HAT = [PAD_ACTIONS.up.keys, PAD_ACTIONS.right.keys,
          PAD_ACTIONS.down.keys, PAD_ACTIONS.left.keys];
        // -1 is up, and it sweeps clockwise through the eight positions.
        const oct = Math.round((hat + 1) * 3.5);
        const live = hat > 1.05 ? -1 : oct;
        HAT.forEach((keys, q) => {
          const on = live >= 0 && (live === q * 2 || live === (q * 2 + 7) % 8 || live === (q * 2 + 1) % 8);
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

  /** Bind one button index to one action, taking it off whatever had it. */
  bindButton(index, action) {
    if (!PAD_ACTIONS[action]) return;
    for (const k of Object.keys(this.binds)) {
      if (this.binds[k] === action) delete this.binds[k];
    }
    this.binds[index] = action;
    this.bindsAreUser = true;
    this._padDown.clear();
  }

  /** The indices currently standing for an action, for the settings screen. */
  bindsFor(action) {
    return Object.keys(this.binds).filter((k) => this.binds[k] === action).map(Number).sort((a, b) => a - b);
  }

  /** The next button pressed is bound to `action` rather than acting. */
  capture(action) { this.capturing = action; this._padDown.clear(); }
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
      if (p && p.catch) p.catch(() => { });
    } catch (err) { /* not granted; the next gesture will try again */ }
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
