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
 * Standard-mapping button index -> the keys it stands in for.
 *
 * The bottom face button confirms and the right one goes back, which is
 * the same physical button on both families: A / cross to select, B /
 * circle to back out. Both sit at indices 0 and 1 under the standard
 * mapping, so one table serves both.
 */
const PAD_KEYS = {
  0: ['PadA', 'KeyE', 'Enter', 'Space'], // A / cross      -- interact, confirm
  1: ['PadB', 'Escape'],                 // B / circle     -- back, pause
  2: ['PadX', 'KeyG'],                   // X / square     -- put it down
  3: ['PadY', 'Tab'],                    // Y / triangle   -- the notepad
  4: ['PadLB', 'ShiftLeft'],             // LB / L1        -- hurry
  5: ['PadRB', 'KeyF'],                  // RB / R1        -- throw the bolt
  6: ['PadLT'],
  7: ['PadRT', 'KeyE'],
  8: ['PadBack'],
  9: ['PadStart', 'Escape'],             // start / options
  10: ['PadL3', 'ShiftLeft'],
  11: ['PadR3'],
  12: ['PadUp', 'ArrowUp'],
  13: ['PadDown', 'ArrowDown'],
  14: ['PadLeft', 'ArrowLeft'],
  15: ['PadRight', 'ArrowRight'],
};

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
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const on = typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5;
      const keys = PAD_KEYS[i];
      if (!keys) continue;
      const id = keys[0];
      if (on) {
        used = true;
        if (!this._padDown.has(id)) {
          this._padDown.add(id);
          for (const k of keys) this.pressed.add(k);
        }
        for (const k of keys) this.down.add(k);
      } else if (this._padDown.has(id)) {
        this._padDown.delete(id);
        for (const k of keys) this.down.delete(k);
      }
    }
    if (this._padDown.has('PadLB') || this._padDown.has('PadL3')) this.run = true;
    /* Some pads report the D-pad as a hat switch on a ninth axis instead of
       as four buttons. Fold that in so those pads can drive a menu too. */
    if (ax.length > 9) {
      const hat = ax[9];
      if (hat >= -1.2 && hat <= 1.2) {
        const HAT = [['PadUp', 'ArrowUp'], ['PadRight', 'ArrowRight'],
          ['PadDown', 'ArrowDown'], ['PadLeft', 'ArrowLeft']];
        // -1 is up, and it sweeps clockwise through the eight positions.
        const oct = Math.round((hat + 1) * 3.5);
        const live = hat > 1.05 ? -1 : oct;
        HAT.forEach((keys, q) => {
          const on = live >= 0 && (live === q * 2 || live === (q * 2 + 7) % 8 || live === (q * 2 + 1) % 8);
          const id = 'Hat' + keys[0];
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

  requestLock() { if (!this.locked && this.target.requestPointerLock) this.target.requestPointerLock(); }
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
