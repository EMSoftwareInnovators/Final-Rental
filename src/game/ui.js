/* ============================================================
   ui.js -- everything drawn as DOM on top of the framebuffer:
   HUD, dialogue box, the notepad you compare faces against,
   the phone, and the screens that end a night.
   ============================================================ */
import { paintPortrait } from './appearance.js';
import { KEY_LABEL, VISIBLE_KEYS, traitLabel, sameTrait } from './appearance.js';
import { GENRE_LABEL } from './tapes.js';

const $ = (id) => document.getElementById(id);

/* ============================================================
   BUTTON GLYPHS
   Every prompt in the game names a control, and which control it is
   depends on what is plugged in. One table, three columns: a keyboard
   cap, an Xbox face button, a PlayStation shape.
   ============================================================ */
const GLYPHS = {
  //           keyboard      xbox                     playstation
  interact:  ['E',          ['A', 'x-a'],            ['\u2715', 'p-x']],
  confirm:   ['E',          ['A', 'x-a'],            ['\u2715', 'p-x']],
  back:      ['ESC',        ['B', 'x-b'],            ['\u25CB', 'p-o']],
  pause:     ['ESC',        ['\u2630', 'x-m'],       ['\u2630', 'p-m']],
  notes:     ['TAB',        ['Y', 'x-y'],            ['\u25B3', 'p-t']],
  drop:      ['G',          ['X', 'x-x'],            ['\u25A1', 'p-s']],
  bolt:      ['F',          ['RB', 'x-b'],           ['R1', 'p-o']],
  run:       ['SHIFT',      ['LB', 'x-b'],           ['L1', 'p-o']],
  up:        ['\u2191',     ['\u2191', 'x-d'],       ['\u2191', 'p-d']],
  down:      ['\u2193',     ['\u2193', 'x-d'],       ['\u2193', 'p-d']],
  left:      ['\u2190',     ['\u2190', 'x-d'],       ['\u2190', 'p-d']],
  right:     ['\u2192',     ['\u2192', 'x-d'],       ['\u2192', 'p-d']],
  move:      ['WASD',       ['\u25CE L', 'x-d'],     ['\u25CE L', 'p-d']],
  look:      ['MOUSE',      ['\u25CE R', 'x-d'],     ['\u25CE R', 'p-d']],
};

let SCHEME = 'kbm';
/** Told by the game whenever the active input device changes. */
export function setScheme(s) { SCHEME = s || 'kbm'; }
export function currentScheme() { return SCHEME; }

/** The markup for one control, in whatever language the player's hands speak. */
export function glyph(action) {
  const row = GLYPHS[action];
  if (!row) return `<span class="key">${escape(String(action).toUpperCase())}</span>`;
  if (SCHEME === 'kbm') return `<span class="key">${row[0]}</span>`;
  const [label, cls] = SCHEME === 'playstation' ? row[2] : row[1];
  // NB: not "pad" -- that is the paper-panel class, and a glyph wearing it
  // inherited the panel's absolute positioning and 78cqw width.
  return `<span class="key btn ${cls}">${label}</span>`;
}

/** Bare text form, for places that cannot take markup. */
export function glyphText(action) {
  const row = GLYPHS[action];
  if (!row) return String(action).toUpperCase();
  if (SCHEME === 'kbm') return row[0];
  return (SCHEME === 'playstation' ? row[2] : row[1])[0];
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), clockTime: $('clock-time'), clockNight: $('clock-night'), till: $('till-amt'),
      hands: $('hands'), reticle: $('reticle'), prompt: $('prompt'), toasts: $('toasts'),
      objective: $('objective'),
      dialogue: $('dialogue'), dlgFace: $('dlg-face'), dlgName: $('dlg-name'),
      dlgText: $('dlg-text'), dlgChoices: $('dlg-choices'),
      notes: $('notes'), notesSuspect: $('notes-suspect'), notesTarget: $('notes-target'),
      notesTargetHdr: $('notes-target-hdr'),
      phone: $('phone-ui'), phoneHdr: $('phone-hdr'), phoneText: $('phone-text'), phoneChoices: $('phone-choices'),
      title: $('title'), titleMenu: $('title-menu'),
      panel: $('panel'), panelBody: $('panel-body'),
      fade: $('fade'),
    };
    this._portraitOf = null;
    this._toasts = [];
    this._typed = '';
    this._typeTarget = '';
    this._typeT = 0;
  }

  /* ---------------- HUD ---------------- */
  /**
   * The clock over the door.
   *
   * It does stop -- while the deputy still has something to say, and while
   * the killer is in the building -- but it does not SAY that it has
   * stopped, and it is not dimmed while it is. It used to be marked
   * "STOPPED", which told the player, before anybody had walked through the
   * door, that tonight was a night with a deputy in it, and therefore a
   * night the killer might be working. That is the one thing the shift is
   * supposed to keep from them. A clock that seems slow is ambience; a
   * clock that announces it has been held is the answer to the question.
   */
  setClock(time, night, held) {
    this.el.clockTime.textContent = time;
    this.el.clockNight.textContent = `NIGHT ${night}`;
    this.el.clockTime.parentElement.classList.remove('held');
    void held;
  }
  setTill(v) { this.el.till.textContent = v.toFixed(2); }

  setHands(tapes, rewinder, player, owedOut) {
    const rows = [];
    if (player) {
      if (player.cash && player.cash.owed > 0.001) {
        rows.push(`<span class="warn">CASH IN HAND $${player.cash.tendered.toFixed(2)}`
          + ` — $${player.cash.owed.toFixed(2)} NOT RUNG UP</span>`);
      }
      if (player.changeInHand > 0.001) {
        const to = owedOut && owedOut.who ? ` FOR ${owedOut.who.toUpperCase()}` : '';
        rows.push(`<span class="warn">CHANGE IN HAND $${player.changeInHand.toFixed(2)}${to}</span>`);
      } else if (owedOut && owedOut.total > 0.001) {
        rows.push(`<span class="warn">${owedOut.who.toUpperCase()} IS OWED `
          + `$${owedOut.total.toFixed(2)} — RING IT UP</span>`);
      }
    }
    if (rewinder && rewinder.tape) {
      const pct = Math.min(100, Math.round(rewinder.t / rewinder.dur * 100));
      rows.push(rewinder.done
        ? `<span class="ok">REWINDER: ${rewinder.tape.title} - DONE</span>`
        : `REWINDER: ${rewinder.tape.title} [${'='.repeat(Math.floor(pct / 10)).padEnd(10, '.')}]`);
    }
    if (!tapes.length) rows.push('<span class="tape-line">HANDS EMPTY</span>');
    for (let i = tapes.length - 1; i >= 0; i--) {
      const t = tapes[i];
      // a cartridge has no reel, so it is never rewound or otherwise
      const state = t.game ? 'CARTRIDGE' : (t.rewound ? 'REWOUND' : 'NOT REWOUND');
      rows.push(`<span class="tape-line">${i === tapes.length - 1 ? '>' : ' '} ${t.title}</span> `
        + `<span class="${t.game || t.rewound ? 'ok' : 'warn'}">${GENRE_LABEL[t.genre]} / ${state}</span>`);
    }
    this.el.hands.innerHTML = rows.join('\n');
  }

  setPrompt(html) {
    if (this.el.prompt.innerHTML !== (html || '')) this.el.prompt.innerHTML = html || '';
  }
  setReticle(hot) { this.el.reticle.classList.toggle('hot', !!hot); }

  /** Ring round the reticle that fills while a held action runs. 0 clears it. */
  setHold(f) {
    const on = f > 0.001;
    if (on !== this._holdOn) {
      this._holdOn = on;
      this.el.reticle.classList.toggle('holding', on);
    }
    if (on) this.el.reticle.style.setProperty('--hold', String(Math.min(1, f)));
  }
  setObjective(text, pulse) {
    this.el.objective.textContent = text || '';
    this.el.objective.classList.toggle('pulse', !!pulse);
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    const rec = { el: d, t: 3.4 };
    this._toasts.push(rec);
    while (this._toasts.length > 5) { const o = this._toasts.shift(); o.el.remove(); }
  }

  update(dt) {
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const r = this._toasts[i];
      r.t -= dt;
      if (r.t < 0.5) r.el.classList.add('fade');
      if (r.t <= 0) { r.el.remove(); this._toasts.splice(i, 1); }
    }
    // typewriter for dialogue
    if (this._typed.length < this._typeTarget.length) {
      this._typeT += dt;
      const cps = 62;
      const n = Math.min(this._typeTarget.length, Math.floor(this._typeT * cps));
      if (n !== this._typed.length) {
        this._typed = this._typeTarget.slice(0, n);
        this.el.dlgText.textContent = this._typed;
        return this._typed.length; // caller uses this to fire voice blips
      }
    }
    return -1;
  }

  get typing() { return this._typed.length < this._typeTarget.length; }
  finishTyping() { this._typed = this._typeTarget; this.el.dlgText.textContent = this._typed; }

  /* ---------------- dialogue ---------------- */
  showDialogue(node, sel, ctx) {
    this.el.dialogue.classList.remove('hidden');
    document.body.classList.add('talking');
    const p = node.person;
    const isPlayer = !!node.asPlayer;
    const name = isPlayer ? 'YOU' : (p && p.name) || '';
    const tag = !isPlayer && p && p.personality ? `<span class="tag"> - ${p.personality.tag}</span>` : '';
    this.el.dlgName.innerHTML = `${name}${tag}`;

    if (this._typeTarget !== node.text) {
      this._typeTarget = node.text; this._typed = ''; this._typeT = 0;
      this.el.dlgText.textContent = '';
    }

    if (p && p.app && this._portraitOf !== p) {
      this._portraitOf = p;
      paintPortrait(p.app, this.el.dlgFace);
    }

    const ch = node.choices || [];
    const html = ch.map((c, i) => {
      // markers go in front of the line so a long reply never orphans them
      const bits = [];
      if (c.risk) bits.push('<span class="risk">!</span>');
      if (c.cost) bits.push(`<span class="cost">${escape(c.cost)}</span>`);
      if (c.good) bits.push(`<span class="cost">+${escape(c.good)}</span>`);
      const tag = bits.length ? `<span class="tag-in">[${bits.join(' ')}]</span> ` : '';
      return `<li class="${i === sel ? 'sel' : ''}">${i + 1}. ${tag}${escape(c.label)}</li>`;
    }).join('');
    this.el.dlgChoices.innerHTML = ch.length ? html : `<li class="sel">[E] continue</li>`;
  }
  hideDialogue() {
    this.el.dialogue.classList.add('hidden');
    document.body.classList.remove('talking');
    this._typeTarget = ''; this._typed = ''; this._portraitOf = null;
  }

  /* ---------------- notepad ---------------- */
  showNotes(bulletin, target) {
    this.el.notes.classList.remove('hidden');
    const keys = [...bulletin.known];
    this.el.notesSuspect.innerHTML = keys.map((k) => {
      const match = target && target.observed.has(k) && sameTrait(target.app, bulletin.app, k);
      return `<li class="${match ? 'match' : ''}"><b>${KEY_LABEL[k]}:</b> ${escape(traitLabel(bulletin.app, k))}</li>`;
    }).join('') || `<li class="plain quiet">Nothing on file.</li>`;

    if (target) {
      this.el.notesTargetHdr.textContent = 'PERSON IN VIEW';
      const rows = [];
      rows.push(`<li class="plain"><b>${escape(target.name)}</b> <span class="quiet">- ${escape(target.personality.tag)}</span></li>`);
      // Bulletin traits first: those are the ones you are actually comparing,
      // and the pad has a bottom edge.
      const keys = [...VISIBLE_KEYS, 'smell', 'voice']
        .filter((k) => target.observed.has(k))
        .sort((x, y) => (bulletin.known.has(y) ? 1 : 0) - (bulletin.known.has(x) ? 1 : 0));
      for (const k of keys) {
        const inBulletin = bulletin.known.has(k);
        const match = inBulletin && sameTrait(target.app, bulletin.app, k);
        rows.push(`<li class="${match ? 'match' : ''}"><b>${KEY_LABEL[k]}:</b> ${escape(traitLabel(target.app, k))}</li>`);
      }
      const unknown = [...bulletin.known].filter((k) => !target.observed.has(k));
      if (unknown.length) rows.push(`<li class="plain quiet">Not yet observed: ${unknown.map((k) => KEY_LABEL[k].toLowerCase()).join(', ')}</li>`);
      this.el.notesTarget.innerHTML = rows.join('');
    } else {
      this.el.notesTargetHdr.textContent = 'PERSON IN VIEW';
      this.el.notesTarget.innerHTML = `<li class="plain quiet">Nobody in front of you. Look at someone to take them in.</li>`;
    }
  }
  hideNotes() { this.el.notes.classList.add('hidden'); }

  /* ---------------- phone ---------------- */
  showPhone(node, sel) {
    this.el.phone.classList.remove('hidden');
    document.body.classList.add('talking');
    this.el.phoneHdr.textContent = node.person ? node.person.name : 'DISPATCH';
    this.el.phoneText.textContent = node.text;
    const ch = node.choices || [];
    this.el.phoneChoices.innerHTML = ch.map((c, i) =>
      `<li class="${i === sel ? 'sel' : ''}">${i + 1}. ${c.risk ? '<span class="rec">[ON RECORD]</span> ' : ''}${escape(c.label)}</li>`).join('');
  }
  hidePhone() { this.el.phone.classList.add('hidden'); document.body.classList.remove('talking'); }

  /* ---------------- panels ---------------- */
  showPanel(html) { this.el.panel.classList.remove('hidden'); this.el.panelBody.innerHTML = html; }
  hidePanel() { this.el.panel.classList.add('hidden'); }
  panelSelect(i) {
    const opts = this.el.panelBody.querySelectorAll('li.opt');
    opts.forEach((o, n) => o.classList.toggle('sel', n === i));
    return opts.length;
  }
  panelOptions() { return this.el.panelBody.querySelectorAll('li.opt'); }

  showTitle(show) { this.el.title.classList.toggle('hidden', !show); }
  titleSelect(i) {
    const items = this.el.titleMenu.querySelectorAll('li');
    items.forEach((o, n) => o.classList.toggle('sel', n === i));
    return items.length;
  }

  keyHint(action) { return glyph(action); }

  setHudVisible(v) { this.el.hud.classList.toggle('hidden', !v); }
  /** DOM-level blackout, used for hard cuts between scenes. 0 = clear. */
  fade(to, flash) {
    this.el.fade.classList.toggle('flash', !!flash);
    this.el.fade.style.opacity = String(to);
  }
  cinema(on) { document.body.classList.toggle('cine', !!on); }
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ============================================================
   Panel content
   ============================================================ */
/* The whole thing has to fit one screen without scrolling: it is a pause
   menu on a 4:3 CRT, not a web page. Three tight columns of key bindings
   over two short columns of prose does it. */
export function howToHtml() {
  const key = (g, what) => `<li class="plain">${glyph(g)} ${what}</li>`;
  const onPad = SCHEME !== 'kbm';
  return `<div class="howto">
  <h2>WORKING THE COUNTER${onPad ? ` <span class="quiet">&mdash; ${SCHEME === 'playstation' ? 'PLAYSTATION' : 'XBOX'} PAD</span>` : ''}</h2>
  <div class="keys">
    <ul>
      ${key('move', 'walk')}
      ${key('run', 'hurry')}
      ${key('look', 'look')}
      ${key('pause', 'pause')}
    </ul>
    <ul>
      ${key('interact', 'interact / talk')}
      ${onPad ? key('up', 'pick a reply') : `<li class="plain"><span class="key">1-4</span> pick a reply</li>`}
      ${key('down', 'move the cursor')}
      ${key('notes', 'the notepad')}
    </ul>
    <ul>
      ${key('drop', 'put down what you are holding')}
      ${key('bolt', 'bolt the back room')}
    </ul>
  </div>
  <div class="cols">
    <ul>
      <li><b>Returns.</b> Take the tape &mdash; or the cartridge, if it came off the games wall. Late fees are $1 a day, $2 on a game.</li>
      <li><b>Rewind.</b> An unwound tape goes in the rewinder before it goes on a shelf. Cartridges do not rewind.</li>
      <li><b>Shelve.</b> Every tape belongs on its own genre run.</li>
      <li><b>Rentals.</b> People pull their own tapes. Ring them up, take the money.</li>
    </ul>
    <ul>
      <li><b>Change.</b> Cash sits in your hand until you ring it up. The drawer pays the change; the customer waits for it.</li>
      <li><b>The bulletin.</b> A deputy reads you a description. ${glyphText('notes')} holds it against whoever is in front of you.</li>
      <li><b>If you are sure.</b> Lock the front door, then the phone. Call it in on the wrong person and you are finished here.</li>
      <li><b>The back room.</b> The one door in the building with a bolt. It does not hold forever.</li>
    </ul>
  </div>
  <p class="pad-foot">${glyph('back')} back</p></div>`;
}

export function optionsHtml(o) {
  const bar = (v) => `[${'#'.repeat(Math.round(v * 10)).padEnd(10, '.')}]`;
  return `<h2>OPTIONS</h2>
  <ul>
    <li class="opt sel">Look sensitivity &nbsp; ${bar(o.sens)}</li>
    <li class="opt">Invert look &nbsp; ${o.invert ? 'ON' : 'OFF'}</li>
    <li class="opt">Master volume &nbsp; ${bar(o.vol)}</li>
    <li class="opt">Internal resolution &nbsp; ${o.resLabel}</li>
    <li class="opt">Polygon jitter &nbsp; ${o.snap ? 'PS1 (ON)' : 'SMOOTH'}</li>
    <li class="opt">VHS tape &nbsp; ${o.vhs ? 'ON' : 'OFF &mdash; clean PS1'}</li>
    <li class="opt">Tape damage &nbsp; ${bar(o.grain)}${o.vhs ? '' : ' <span class="quiet">(tape off)</span>'}</li>
    <li class="opt">Controller${o.pad ? '' : ' <span class="quiet">(none connected)</span>'}</li>
    <li class="opt">Back</li>
  </ul>
  <p class="pad-foot">${glyph('left')}${glyph('right')} adjust &nbsp;&middot;&nbsp; ${glyph('confirm')} select &nbsp;&middot;&nbsp; ${glyph('back')} back</p>
  <p class="pad-foot quiet">${o.pad
    ? `Controller: ${escape(o.pad)}${o.padNeedsSetup ? ' &mdash; layout not recognised, set it up below' : ''}`
    : 'No controller detected'}</p>`;
}

/**
 * The controller screen.
 *
 * Deliberately usable with a pad that has no working buttons at all: the
 * stick moves the highlight, and pressing ANY button while an action is
 * highlighted binds it to that action. Nothing here needs a button that
 * already works, which is the entire point of the screen.
 */
export function padHtml(p) {
  const row = (r) => {
    const on = r.capturing;
    const val = on ? '<span class="k">press a button&hellip;</span>'
      : r.buttons.length ? r.buttons.map((b) => `<span class="key btn">${b}</span>`).join(' ')
        : '<span class="quiet">unbound</span>';
    // One button can do several jobs, the way E does on the keyboard.
    const also = !on && r.shared && r.shared.length
      ? ` <span class="quiet">(also ${escape(r.shared.join(', ').toLowerCase())})</span>` : '';
    return `<li class="opt">${escape(r.label)} &nbsp; ${val}${also}</li>`;
  };
  const live = p.down.length
    ? p.down.map((i) => `<span class="key btn">${i}</span>`).join(' ')
    : '<span class="quiet">nothing pressed</span>';
  // Axes that are actually doing something, so a d-pad on a hat is findable.
  const moving = (p.axes || []).map((v, i) => [i, v]).filter(([, v]) => Math.abs(v) > 0.12);
  const axes = moving.length
    ? moving.map(([i, v]) => `<span class="key btn">${i}</span>&#8202;${v.toFixed(2)}`).join(' &nbsp; ')
    : '<span class="quiet">all centred</span>';
  const warn = p.name && !p.trusted && !p.custom
    ? (p.known
      ? `<p class="pad-foot">This browser does not describe your controller's layout, but it is
         one we know &mdash; laid out below. Change anything that is wrong.</p>`
      : `<p class="pad-foot k">This browser does not recognise your controller's layout, so
         nothing is bound yet &mdash; any button will work a menu until you set it up here.</p>`)
    : '';
  return `<h2>CONTROLLER</h2>
  <p class="pad-foot">${p.name ? escape(p.name) : 'Nothing connected'}${
  p.name ? ` &nbsp;&middot;&nbsp; ${escape(p.mapping || 'non-standard')} mapping &nbsp;&middot;&nbsp; ${p.count} buttons` : ''}</p>
  ${warn}
  <ul>
    ${p.rows.map(row).join('\n    ')}
    <li class="opt">Reset to defaults</li>
    <li class="opt">Back</li>
  </ul>
  <p class="pad-foot">Held down now: ${live}</p>
  <p class="pad-foot">Axes moving: ${axes}</p>
  <p class="pad-foot quiet">Move with the stick or ${glyphText('up')}${glyphText('down')}.
  Highlight a line and press the button you want for it &mdash; one button can do
  several jobs, and pressing the same one again takes that job off it.
  ESC on the keyboard leaves at any time.</p>`;
}

export function reportHtml(night, stats, grade, next) {
  const row = (k, v, cls = '') => `<tr><td>${k}</td><td class="n ${cls}">${v}</td></tr>`;
  return `<h2>END OF SHIFT &mdash; NIGHT ${night}</h2>
  <div class="report">
    <table>
      ${row('Customers served', stats.served)}
      ${row('Rentals rung up', stats.rentalsRung)}
      ${row('Late fees collected', `$${stats.feesCollected.toFixed(2)}`)}
      ${row('Fees waived', `-$${stats.feesWaived.toFixed(2)}`)}
      ${row('Shelved correctly', stats.shelvedRight)}
      ${row('Shelved WRONG', stats.shelvedWrong, stats.shelvedWrong ? 'k' : '')}
      ${row('Shelved unrewound', stats.shelvedUnrewound, stats.shelvedUnrewound ? 'k' : '')}
      ${row('Left out at close', stats.unshelved, stats.unshelved ? 'k' : '')}
      ${row('Customers angered', stats.angered, stats.angered ? 'k' : '')}
      ${row('Walked out furious', stats.stormedOut, stats.stormedOut ? 'k' : '')}
      ${row('Found the door locked', stats.turnedAway, stats.turnedAway ? 'k' : '')}
      ${row('Left without their change', stats.changeStiffed, stats.changeStiffed ? 'k' : '')}
      ${row('Cash never rung up', `$${stats.cashLoose.toFixed(2)}`, stats.cashLoose ? 'k' : '')}
      ${row('Tips', `$${stats.tips.toFixed(2)}`)}
    </table>
    <div>
      <div class="grade"><span class="big">${grade.letter}</span>${grade.score} pts</div>
      <p class="note">${next}</p>
    </div>
  </div>
  <p class="pad-foot">[E] clock in for night ${night + 1}</p>`;
}

export function endingHtml(kind, data) {
  switch (kind) {
    case 'CAUGHT': {
      const where = data.offscreen
        ? `<p>They took him on the pavement outside, before he reached the corner.</p>`
        : data.broke
          ? `<p>They came through the front while he was still working on the stock room door.</p>`
          : data.hid
            ? `<p>You heard the doors, the shouting, then a knock on the stock room door and a badge number, twice, before you would open it.</p>`
            : `<p>He was against the returns bin with his hands behind him before he had finished turning round.</p>`;
      const more = data.caseFile && data.caseFile.caughtLast
        ? `<p class="quiet">The deputy said what he said last night: that they had got him. You have started counting how many times a week somebody has got him.</p>`
        : '';
      const calm = data.calmNights
        ? `<p class="quiet">Nobody will be working this parade for ${data.calmNights} night${data.calmNights > 1 ? 's' : ''}. Nobody they know about.</p>`
        : '';
      return `<h2>UNITS RESPONDING</h2>
        <p>You gave dispatch the jacket, the walk, the mark on the face. Everything the deputy read you, back the other way.</p>
        ${where}
        <p><b>${escape(data.name || 'He')}</b> did not resist.</p>
        ${more}${calm}
        <p class="big">CASE CLOSED &mdash; NIGHT ${data.night}</p>
        <ul>
          <li class="opt sel">Take tomorrow's shift</li>
          <li class="opt">Hand in the keys</li>
        </ul>`;
    }
    case 'ATTACKED':
      return `<h2>PLEASE REWIND BEFORE RETURNING</h2>
        <p>The chime over the door goes off the way it always does. Two notes, cheerful, made in 1981.</p>
        <p>He does not hurry. There is no reason to hurry.</p>
        <p class="quiet">The store stays open until midnight. The tape in the deck keeps turning until somebody stops it.</p>
        <p class="big">NIGHT ${data.night} &mdash; SHIFT ENDED</p>
        <p class="pad-foot">[E] rewind</p>`;
    case 'FIRED':
      return `<h2>TERMINATED</h2>
        <p>Two units, lights, the whole street awake. They put <b>${data.name}</b> face down on the carpet by the returns bin in front of six people.</p>
        <p>${data.reason}</p>
        <p>The district manager drove in at two in the morning to say it in person. You handed over the keys and the little pin with the film reel on it.</p>
        <p class="quiet">Somewhere out there, the actual one is still renting tapes.</p>
        <p class="big">BAD ENDING &mdash; YOU'RE DONE HERE</p>
        <p class="pad-foot">[E] new tape</p>`;
    default: return '';
  }
}
