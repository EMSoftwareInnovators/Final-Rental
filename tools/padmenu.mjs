/* Drives the front-end menus with a controller and nothing else.
   A synthetic standard-mapping pad stands in for the hardware: the left
   stick and the D-pad move the cursor, the bottom face button selects,
   the right one goes back. Runs the whole thing twice, once reporting
   itself as an Xbox pad and once as a DualSense, to check the button art
   follows the device. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});

let fails = 0;
const errors = [];
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* A fake pad, installed before any of the game's code runs. */
const padScript = (id, mapping = 'standard', count = 17) => `
  const st = { buttons: new Array(${count}).fill(0), axes: [0, 0, 0, 0], id: ${JSON.stringify(id)} };
  window.__pad = st;
  navigator.getGamepads = () => [{
    index: 0, connected: true, id: st.id, mapping: ${JSON.stringify(mapping)},
    axes: st.axes.slice(),
    buttons: st.buttons.map((v) => ({ pressed: v > 0.5, value: v })),
  }];
`;

async function session(id, expectScheme, expectSelect) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('pageerror', (e) => errors.push(`[${id}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });
  await page.addInitScript(padScript(id));
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  await ev(() => { window.__game.sound.muted = true; window.__game.input._padIndex = 0; });

  // No keyboard and no mouse from here on. Everything below is the pad.
  const tap = async (i) => {
    await ev((b) => { window.__pad.buttons[b] = 1; }, i);
    await wait(120);
    await ev((b) => { window.__pad.buttons[b] = 0; }, i);
    await wait(160);
  };
  const flick = async (axis, v) => {
    await ev(([a, x]) => { window.__pad.axes[a] = x; }, [axis, v]);
    await wait(140);
    await ev(([a]) => { window.__pad.axes[a] = 0; }, [axis, 0]);
    await wait(160);
  };
  const st = () => ev(() => ({
    state: window.__game.state, menu: window.__game.menuSel,
    opt: window.__game.optSel, pause: window.__game.pauseSel,
    scheme: window.__game.input.scheme,
  }));

  const label = id.split(' ')[0];
  console.log(`\n  -- ${id} --`);

  /* ---- the title screen ----
     The menu is built at runtime (CONTINUE only exists with a save), so
     the count and the index of OPTIONS are read from the game rather than
     assumed. */
  const menu = await ev(() => ({
    n: window.__game._titleMenu.length,
    options: window.__game._titleMenu.findIndex((m) => m.label === 'OPTIONS'),
  }));
  check(`${label}: the left stick moves the title cursor`,
    await (async () => { const a = (await st()).menu; await flick(1, 1); return (await st()).menu === (a + 1) % menu.n; })(),
    `now on item ${(await st()).menu}`);
  await flick(1, -1);
  check(`${label}: and moves it back up`, (await st()).menu === 0);
  check(`${label}: the pad is recognized as the right family`,
    (await st()).scheme === expectScheme, (await st()).scheme);

  for (let k = 0; k < menu.options; k++) await flick(1, 1);   // down to OPTIONS
  check(`${label}: stick navigation lands on OPTIONS`, (await st()).menu === menu.options, `item ${(await st()).menu} of ${menu.n}`);

  /* ---- select with the bottom face button ---- */
  await tap(0);
  check(`${label}: ${expectSelect} opens the highlighted item`,
    (await st()).state === 'OPTIONS', (await st()).state);

  /* ---- and it draws the right art for this pad ---- */
  const art = await ev(() => {
    const p = document.querySelector('.paper') || document.body;
    return { html: p.innerHTML.slice(0, 4000) };
  });
  check(`${label}: the options footer is drawn in this pad's language`,
    art.html.includes(expectScheme === 'xbox' ? 'x-a' : 'p-x')
    && art.html.includes(expectScheme === 'xbox' ? 'x-b' : 'p-o'));
  check(`${label}: and it names the controller it found`,
    art.html.includes(id.slice(0, 12)), id);

  /* ---- the stick works sliders too ---- */
  const sens0 = await ev(() => window.__game.opts.sens);
  await flick(0, 1);
  const sens1 = await ev(() => window.__game.opts.sens);
  check(`${label}: pushing right adjusts the highlighted setting`, sens1 !== sens0,
    `${sens0.toFixed(2)} -> ${sens1.toFixed(2)}`);
  await flick(1, 1);
  check(`${label}: and down moves to the next one`, (await st()).opt === 1, `row ${(await st()).opt}`);

  /* ---- back out with the right face button ---- */
  await tap(1);
  check(`${label}: the back button leaves the panel`, (await st()).state === 'TITLE', (await st()).state);

  /* ---- the D-pad still does everything the stick does ---- */
  const before = (await st()).menu;
  await tap(13);
  check(`${label}: the d-pad still moves the cursor`, (await st()).menu === (before + 1) % menu.n);
  await tap(12);
  check(`${label}: both ways`, (await st()).menu === before);

  /* ---- start a shift and pause it, all on the pad ----
     The endless shift, chosen by name: it is the stateless one, so the
     test leaves no campaign save behind. */
  await ev(() => { const g = window.__game; g.menuSel = g._titleMenu.findIndex((m) => m.label === 'GRAVEYARD SHIFT'); });
  await tap(0);
  check(`${label}: it can start a run`, (await st()).state === 'ESTABLISH', (await st()).state);
  await ev(() => { window.__game.estT = 99; });
  await wait(800);
  check(`${label}: which reaches the shift`, (await st()).state === 'PLAY', (await st()).state);

  await tap(9);                       // start / options button
  check(`${label}: start pauses the game`, (await st()).state === 'PAUSE', (await st()).state);
  await flick(1, 1);
  check(`${label}: the stick moves the pause cursor`, (await st()).pause === 1, `row ${(await st()).pause}`);
  await tap(0);
  check(`${label}: and selects into options from the pause menu`,
    (await st()).state === 'OPTIONS', (await st()).state);
  await tap(1);
  check(`${label}: backing out of those returns to the pause menu, not the title`,
    (await st()).state === 'PAUSE', (await st()).state);
  await tap(1);
  check(`${label}: and backing out again resumes the shift`, (await st()).state === 'PLAY', (await st()).state);

  /* Back is not pause. It shares Escape's job in menus, but Escape also
     pauses a shift, and for a while that meant B pulled up the pause menu
     as well as Start did. During play the back button must do nothing. */
  await tap(1);
  check(`${label}: back does not pause the shift -- that is start's job`,
    (await st()).state === 'PLAY', (await st()).state);
  await tap(1); await tap(1);
  check(`${label}: still nothing, however many times it is pressed`,
    (await st()).state === 'PLAY', (await st()).state);
  await tap(9);
  check(`${label}: while start still pauses`, (await st()).state === 'PAUSE', (await st()).state);
  await tap(1);
  check(`${label}: and back still resumes from the pause menu`,
    (await st()).state === 'PLAY', (await st()).state);

  /* ---- the stick must still drive the player, not just menus ---- */
  await ev(() => { window.__pad.axes[1] = -1; });
  await wait(400);
  const moved = await ev(() => ({ z: window.__game.player.z, mz: window.__game.input.moveZ }));
  await ev(() => { window.__pad.axes[1] = 0; });
  check(`${label}: and in play the same stick is analog movement, not arrow keys`,
    moved.mz > 0.3 && moved.mz < 1.01, `moveZ ${moved.mz.toFixed(2)}`);

  /* ---- the whole d-pad walks, not just half of it ---- */
  /* Up and down worked and left and right did nothing: the d-pad speaks
     arrow keys, and the movement fold only strafed on A and D. */
  const dpad = {};
  for (const [name, btn] of [['forward', 12], ['back', 13], ['left', 14], ['right', 15]]) {
    await ev((b) => { window.__pad.buttons[b] = 1; }, btn);
    await wait(160);
    dpad[name] = await ev(() => ({ x: window.__game.input.moveX, z: window.__game.input.moveZ }));
    await ev((b) => { window.__pad.buttons[b] = 0; }, btn);
    await wait(140);
  }
  check(`${label}: the d-pad walks forwards and backwards`,
    dpad.forward.z > 0.5 && dpad.back.z < -0.5,
    `fwd ${dpad.forward.z}, back ${dpad.back.z}`);
  check(`${label}: and strafes left and right`,
    dpad.left.x < -0.5 && dpad.right.x > 0.5,
    `left ${dpad.left.x}, right ${dpad.right.x}`);

  /* ---- a spare shoulder button is not a confirm ---- */
  /* Every unbound button announces itself as PadAny so that a pad the
     browser will not vouch for can still work a menu. With a perfectly
     good A button sitting there that hatch is not needed, and it meant a
     stray LB resumed a paused game. */
  await tap(9);
  check(`${label}: start pauses so the strays can be tried`,
    (await st()).state === 'PAUSE', (await st()).state);
  for (const spare of [4, 8, 10, 11, 16]) {
    await tap(spare);
  }
  check(`${label}: no unbound button resumes a paused game`,
    (await st()).state === 'PAUSE', (await st()).state);
  await tap(5);
  check(`${label}: nor does the shoulder button that throws the bolt`,
    (await st()).state === 'PAUSE', (await st()).state);
  await tap(0);
  check(`${label}: but the select button still does`,
    (await st()).state === 'PLAY', (await st()).state);

  /* ---- the shoulder button throws the bolt, in the room it is for ---- */
  /* On the pad, through the real loop, standing where a player stands when
     they want it: in the back room, looking at the door they are hiding
     behind. The from-anywhere bolt used to be suppressed whenever the
     reticle was on that door -- correct when interacting with the door WAS
     the bolt, and dead wrong once interacting opened it instead, which left
     the button doing nothing at all in the one place it matters. */
  const boltRun = async (yaw) => {
    await ev((y) => {
      const g = window.__game;
      g.state = 'PLAY';
      g.customers.length = 0;
      g.storage.locked = false; g.storage.open = false; g.storage.broken = false;
      g.player.x = 5.95; g.player.z = 10.2; g.player.yaw = y; g.player.pitch = 0;
      g.player.frozen = false;
    }, yaw);
    await wait(200);
    const hover = await ev(() => window.__game.hover && window.__game.hover.kind);
    await tap(5);
    const thrown = await ev(() => window.__game.storage.locked);
    await tap(5);
    const drawn = await ev(() => window.__game.storage.locked);
    return { hover, thrown, drawn };
  };
  const atDoor = await boltRun(Math.PI);      // looking straight at it
  check(`${label}: ${expectScheme === 'xbox' ? 'RB' : 'R1'} throws the bolt from inside the back room`,
    atDoor.hover === 'storage' && atDoor.thrown === true && atDoor.drawn === false,
    `looking at ${atDoor.hover}, thrown ${atDoor.thrown}, then ${atDoor.drawn}`);
  const away = await boltRun(0);              // and with your back to it
  check(`${label}: and does it without lining the door up first`,
    away.hover !== 'storage' && away.thrown === true && away.drawn === false,
    `looking at ${away.hover}, thrown ${away.thrown}, then ${away.drawn}`);
  await ev(() => {
    const g = window.__game;
    g.storage.locked = false; g.storage.open = false;
    g.player.x = 10.75; g.player.z = 3.0;
  });

  /* ---- and the how-to page names the buttons it is actually on ---- */
  const named = await ev(() => {
    const U = window.__ui;
    const out = {};
    for (const a of ['run', 'interact', 'notes', 'drop', 'bolt', 'pause', 'back', 'move', 'look']) {
      out[a] = U.glyphText(a);
    }
    out.html = U.howToHtml();
    return out;
  });
  const TRIG = expectScheme === 'xbox' ? 'LT/RT' : 'L2/R2';
  check(`${label}: the how-to page puts hurry on the triggers`,
    named.run === TRIG, `hurry: ${named.run}`);
  check(`${label}: and names every other control off the real bindings`,
    named.interact === (expectScheme === 'xbox' ? 'A' : '\u2715')
    && named.notes === (expectScheme === 'xbox' ? 'Y' : '\u25B3')
    && named.drop === (expectScheme === 'xbox' ? 'X' : '\u25A1')
    && named.back === (expectScheme === 'xbox' ? 'B' : '\u25CB')
    && named.pause === '\u2630',
    Object.entries(named).filter(([k]) => k !== 'html').map(([k, v]) => `${k}:${v}`).join(' '));
  check(`${label}: and says so on the page itself`,
    named.html.includes('hurry') && !/LB<\/span>\s*hurry/.test(named.html));

  /* ---- sprint is on either trigger, or both ---- */
  const trig = async (list) => {
    await ev((bs) => { bs.forEach((b) => { window.__pad.buttons[b] = 1; }); }, list);
    await wait(160);
    const r = await ev(() => window.__game.input.run);
    await ev((bs) => { bs.forEach((b) => { window.__pad.buttons[b] = 0; }); }, list);
    await wait(140);
    return r;
  };
  const lt = await trig([6]), rt = await trig([7]), both = await trig([6, 7]);
  check(`${label}: either trigger sprints, and so do both together`,
    lt === true && rt === true && both === true, `LT ${lt}, RT ${rt}, both ${both}`);
  /* And the right trigger does nothing else. It used to be a second
     confirm, which would have picked a reply every time you ran. */
  await ev(() => { window.__game.state = 'PAUSE'; window.__game.pauseSel = 2; });
  await wait(120);
  await tap(7);
  check(`${label}: and the right trigger no longer doubles as select`,
    (await st()).state === 'PAUSE', (await st()).state);
  await ev(() => { window.__game.resume(); });
  await wait(160);

  await page.close();
}

await session('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', 'xbox', 'A');
await session('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)', 'playstation', 'cross');

/* ============================================================
   A pad that does not follow the standard mapping.

   Its face buttons are at 11, 12, 13, 14 rather than 0-3, so every
   binding the standard table hands out is pointing at the wrong thing:
   'A' does nothing at all, and what the table thinks is the d-pad is
   somewhere else. This is a pad the player has to be able to fix, and
   fix without any working button to fix it with.
   ============================================================ */
/* ============================================================
   One button, several jobs -- and the layouts we know by name.
   ============================================================ */
{
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('pageerror', (e) => errors.push(`[binds] ${e.message}`));
  await page.addInitScript(padScript('Xbox Wireless Controller', '', 16));
  // Stand in for the machine this actually happens on.
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); }
    catch (e) { /* already fixed */ }
  });
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => {
    window.__game.sound.muted = true;
    window.__game.input._padIndex = 0;
    try { localStorage.removeItem('finalrental.padbinds'); } catch (e) { /* fine */ }
  });

  console.log('\n  -- one button, several jobs --');

  const multi = await ev(() => {
    const I = window.__game.input;
    I.bindsAreUser = false;
    I.binds = window.__input.defaultBinds();
    // start them apart, then put the bolt on the same button as interact
    I.bindButton(5, 'bolt');
    const before = { confirm: I.bindsFor('confirm'), bolt: I.bindsFor('bolt') };
    I.bindButton(before.confirm[0], 'bolt');
    const after = { confirm: I.bindsFor('confirm'), bolt: I.bindsFor('bolt'),
      on: I.actionsOn(before.confirm[0]) };
    // and pressing it again on that row takes it back off
    I.bindButton(before.confirm[0], 'bolt');
    const toggled = { bolt: I.bindsFor('bolt'), on: I.actionsOn(before.confirm[0]) };
    return { before, after, toggled };
  });
  check('interact and the bolt can share one button',
    multi.after.on.includes('confirm') && multi.after.on.includes('bolt')
    && multi.after.confirm.length > 0,
    `button ${multi.before.confirm[0]} does ${multi.after.on.join(' + ')}`);
  check('and pressing the same button again takes that job back off',
    !multi.toggled.on.includes('bolt'), multi.toggled.on.join(' + '));

  const keys = await ev(() => {
    const I = window.__game.input;
    const A = window.__input.PAD_ACTIONS;
    const btn = I.bindsFor('confirm')[0];
    I.bindButton(btn, 'bolt');
    const on = I.actionsOn(btn);
    const sends = new Set();
    on.forEach((a) => A[a].keys.forEach((k) => sends.add(k)));
    return { btn, on, sends: [...sends] };
  });
  check('and one press sends the keys for everything on it',
    keys.sends.includes('KeyE') && keys.sends.includes('KeyF'),
    `button ${keys.btn} sends ${keys.sends.filter((k) => /^Key|Enter|Escape|Tab|Shift/.test(k)).join(' ')}`);

  const mac = await ev(() => {
    const K = window.__input.knownLayout;
    const onMac = K('Xbox Wireless Controller', 'MacIntel');
    const onPc = K('Xbox Wireless Controller', 'Win32');
    const other = K('Some Unknown Pad', 'MacIntel');
    const b = onMac ? onMac.binds : {};
    return {
      known: !!onMac, notOnPc: !onPc, notOther: !other,
      a: b['1'] || [], bBtn: b['2'] || [], x: b['3'] || [], y: b['5'] || [], r3: b['11'] || [],
    };
  });
  check('an Xbox pad on a Mac is recognized even though the browser will not describe it',
    mac.known && mac.notOnPc && mac.notOther);
  check('and its buttons are where they actually are on that machine',
    mac.a.includes('confirm') && mac.bBtn.includes('back') && mac.x.includes('drop')
    && mac.y.includes('notes') && mac.r3.length > 0,
    `A=1 ${mac.a.join('+')} · B=2 ${mac.bBtn.join('+')} · X=3 ${mac.x.join('+')} · Y=5 ${mac.y.join('+')} · R3=11 ${mac.r3.join('+')}`);
  check('with the bolt on A, the way E throws it on the keyboard',
    mac.a.includes('bolt'), mac.a.join(' + '));

  // and it is actually applied when such a pad turns up
  const applied = await ev(async () => {
    const g = window.__game;
    g.input.bindsAreUser = false;
    g.input._laidOutFor = null;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return { known: g.input.knownAs, trusted: g.input.padTrusted,
      confirm: g.input.bindsFor('confirm') };
  });
  check('so a Mac Xbox pad works the moment it is plugged in',
    applied.known === 'xbox-macos' && !applied.trusted && applied.confirm.includes(1),
    `recognized as ${applied.known || 'nothing'}, select on ${applied.confirm.join(',')}`);

  /* ---- the right stick ---- */
  const look = await ev(() => {
    const g = window.__game;
    const I = g.input;
    const out = {};
    for (const [name, v] of [['half', 0.5], ['full', 1.0]]) {
      window.__pad.axes[2] = v;
      I._pollPad();
      out[name] = +I.lookX.toFixed(3);
    }
    window.__pad.axes[2] = 0;
    I._pollPad();
    out.sens = I.padSensitivity;
    return out;
  });
  check('a half-pushed look stick is worth something',
    look.half > 0.15, `half deflection gives ${look.half}`);
  check('and the stick turns you at a usable rate',
    look.sens >= 3.5, `${look.sens} radians a second at full lock`);

  await page.close();
}

/* ============================================================
   The phantom d-pad, and what a button we have never seen does.
   ============================================================ */
{
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('pageerror', (e) => errors.push(`[hat] ${e.message}`));
  // Ten axes, none of them a hat -- axis 9 sits at zero like all the others.
  await page.addInitScript(`
    const st = { buttons: new Array(17).fill(0), axes: new Array(10).fill(0),
      id: 'Xbox Wireless Controller' };
    window.__pad = st;
    navigator.getGamepads = () => [{
      index: 0, connected: true, id: st.id, mapping: '',
      axes: st.axes.slice(),
      buttons: st.buttons.map((v) => ({ pressed: v > 0.5, value: v })),
    }];
  `);
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  await ev(() => { window.__game.sound.muted = true; window.__game.input._padIndex = 0; });

  console.log('\n  -- a pad with ten axes and no hat --');

  const phantom = await ev(async () => {
    const g = window.__game;
    const seen = [];
    const before = g.menuSel;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach((k) => {
        if (g.input.pressed.has(k)) seen.push(k);
      });
    }
    return { seen: [...new Set(seen)], moved: g.menuSel !== before, sel: g.menuSel };
  });
  check('an axis that is not a hat does not press the d-pad',
    phantom.seen.length === 0 && !phantom.moved,
    phantom.seen.join(' ') || 'nothing pressed, cursor still on ' + phantom.sel);

  // Now a real hat: neutral outside [-1,1], and up is -1.
  const realHat = await ev(async () => {
    const g = window.__game;
    const I = g.input;
    // Presses are cleared at the end of every frame, so watch from inside it.
    const seen = new Set();
    const realEnd = I.endFrame.bind(I);
    I.endFrame = () => { I.pressed.forEach((k) => seen.add(k)); realEnd(); };
    I._hatSeenNeutral = false;
    window.__pad.axes[9] = 3.2857;              // the usual resting value
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const idle = seen.has('ArrowUp') || seen.has('ArrowDown');
    seen.clear();
    window.__pad.axes[9] = -1;                  // up
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    const up = seen.has('ArrowUp');
    window.__pad.axes[9] = 3.2857;
    I.endFrame = realEnd;
    return { idle, up };
  });
  check('but a real hat still works, once it has shown itself to be one',
    !realHat.idle && realHat.up, `idle pressed something: ${realHat.idle}`);

  /* ---- nothing is bound to a button nobody has checked ---- */
  const unknown = await ev(() => {
    const I = window.__game.input;
    const K = window.__input.knownLayout('Xbox Wireless Controller', 'MacIntel');
    const b = K ? K.binds : {};
    const listed = Object.keys(b).map(Number).sort((x, y) => x - y);
    return { listed, four: b['4'] || [], six: b['6'] || [], twelve: b['12'] || [],
      notes: Object.keys(b).filter((k) => (b[k] || []).includes('notes')).map(Number) };
  });
  check('the layout only claims the buttons somebody actually read off the pad',
    unknown.listed.join(',') === '1,2,3,5,11', unknown.listed.join(','));
  check('so a shoulder button does nothing until it is bound',
    unknown.four.length === 0 && unknown.six.length === 0,
    `4: ${unknown.four.join('+') || 'nothing'} · 6: ${unknown.six.join('+') || 'nothing'}`);
  check('and only one button opens the notepad', unknown.notes.length === 1,
    `notepad on ${unknown.notes.join(',')}`);

  /* ---- sprint on the trigger ---- */
  const sprint = await ev(() => {
    const A = window.__input.PAD_ACTIONS;
    const d = window.__input.defaultBinds();
    const on = (i) => (d[i] || []).join('+');
    return { run: A.run.def, keys: A.run.keys, confirm: A.confirm.def,
      four: on(4), six: on(6), seven: on(7), ten: on(10) };
  });
  check('sprint is on both triggers, not a stick click',
    sprint.run.length === 2 && sprint.six.includes('run') && sprint.seven.includes('run'),
    `run on ${sprint.run.join(',')} (${sprint.keys.join(' ')})`);
  check('and the right trigger is a trigger and nothing else',
    !sprint.seven.includes('confirm') && !sprint.confirm.includes(7),
    `RT: ${sprint.seven || 'nothing'} · select on ${sprint.confirm.join(',')}`);
  check('and neither LB nor L3 runs any more',
    !sprint.four.includes('run') && !sprint.ten.includes('run'),
    `LB: ${sprint.four || 'nothing'} · L3: ${sprint.ten || 'nothing'}`);

  const pulled = await ev(async () => {
    const g = window.__game;
    // Pin the standard layout on, so the poll does not swap it out for the
    // empty one it uses on a pad it cannot describe.
    g.input.binds = window.__input.defaultBinds();
    g.input.bindsAreUser = true;
    window.__pad.buttons[6] = 0.72;            // a trigger, past halfway
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const running = g.input.isDown('ShiftLeft');
    window.__pad.buttons[6] = 0;
    return running;
  });
  check('and pulling it actually makes you run', pulled === true);

  /* ---- the screen shows the axes, so an unknown d-pad can be found ---- */
  const readout = await ev(() => {
    const g = window.__game;
    window.__pad.axes[7] = -1;
    g.input._pollPad();
    const v = g.padView();
    window.__pad.axes[7] = 0;
    return { axes: v.axes.length, seven: v.axes[7] };
  });
  check('and the controller screen shows every axis live',
    readout.axes >= 10 && readout.seven === -1,
    `${readout.axes} axes, axis 7 reading ${readout.seven}`);

  await page.close();
}

async function oddPad() {
  const id = 'Generic USB Gamepad (Vendor: 0079 Product: 0006)';
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('pageerror', (e) => errors.push(`[odd] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });
  await page.addInitScript(padScript(id, '', 15));
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  await ev(() => {
    window.__game.sound.muted = true;
    window.__game.input._padIndex = 0;
    try { localStorage.removeItem('finalrental.padbinds'); } catch (e) { /* fine */ }
    window.__game.input.resetBinds();
  });
  const tap = async (i) => {
    await ev((b) => { window.__pad.buttons[b] = 1; }, i);
    await wait(140);
    await ev((b) => { window.__pad.buttons[b] = 0; }, i);
    await wait(180);
  };
  const flick = async (axis, v) => {
    await ev(([a, x]) => { window.__pad.axes[a] = x; }, [axis, v]);
    await wait(140);
    await ev(([a]) => { window.__pad.axes[a] = 0; }, [axis, 0]);
    await wait(180);
  };
  const st = () => ev(() => ({
    state: window.__game.state, menu: window.__game.menuSel,
    opt: window.__game.optSel, padSel: window.__game.padSel,
    confirm: window.__game.input.bindsFor('confirm'),
    back: window.__game.input.bindsFor('back'),
  }));

  console.log(`\n  -- ${id} (face buttons at 11-14) --`);

  // The stick still navigates: axes are axes on any pad.
  await flick(1, 1);
  check('odd pad: the stick still moves the cursor', (await st()).menu === 1, `item ${(await st()).menu}`);

  // Nothing is bound, because the browser would not vouch for the layout.
  // Laying the standard table over a pad that does not follow it is how A
  // ends up on Escape and X on the notepad.
  check('odd pad: a layout the browser will not vouch for starts unbound',
    (await st()).confirm.length === 0 && (await st()).back.length === 0
    && await ev(() => window.__game.input.padTrusted) === false,
    `select ${JSON.stringify((await st()).confirm)}, back ${JSON.stringify((await st()).back)}`);
  check('odd pad: and the game says so rather than misbehaving quietly',
    await ev(() => window.__game.optView().padNeedsSetup) === true);

  // An unbound button is let through as a confirm rather than doing nothing.
  await ev(() => { const g = window.__game; g.menuSel = g._titleMenu.findIndex((m) => m.label === 'OPTIONS'); });
  await tap(11);
  check('odd pad: a button the standard table does not know still works a menu',
    (await st()).state === 'OPTIONS', (await st()).state);

  // Down to the Controller row and into it. (Options rows, in order: sens,
  // invert, volume, resolution, jitter, VHS, tape damage, first-shift hints,
  // reset hints, CONTROLLER, back -- so the pad row is index 9.)
  await ev(() => { window.__game.optSel = 9; window.__ui && 0; });
  await ev(() => { window.__game.ui.panelSelect(9); });
  await tap(11);
  check('odd pad: the controller screen opens', (await st()).state === 'PADCFG', (await st()).state);

  const seen = await ev(() => {
    const v = window.__game.padView();
    return { name: v.name, mapping: v.mapping, count: v.count, rows: v.rows.map((r) => r.id) };
  });
  check('odd pad: and it reports what the pad actually says about itself',
    seen.name === id && seen.count === 15, `${seen.count} buttons, "${seen.mapping || 'non-standard'}" mapping`);

  // Bind select to 11 and back to 12, with nothing but the stick and those buttons.
  check('odd pad: select is armed as soon as its line is highlighted',
    await ev(() => window.__game.input.capturing === 'confirm'),
    await ev(() => String(window.__game.input.capturing)));
  await tap(11);
  check('odd pad: pressing a button on that line binds it',
    (await st()).confirm.join(',') === '11', `select = ${(await st()).confirm.join(',')}`);
  await flick(1, 1);
  await tap(12);
  check('odd pad: and the next line takes the next button',
    (await st()).back.join(',') === '12', `back = ${(await st()).back.join(',')}`);

  /* Down to Back and out, on the pad alone. The Back row is the last one,
     whatever the screen happens to list -- walking a counted number of steps
     broke the moment the directions became bindable and the screen grew four
     rows. Stepping onto "Reset to defaults" and pressing a button does
     exactly what it says on the tin, so stop on the last row, not near it. */
  const BACK_ROW = await ev(() => window.__input.BINDABLE.length + 1);
  for (let k = 0; k < 20 && (await st()).padSel !== BACK_ROW; k++) await flick(1, 1);
  check('odd pad: the stick reaches the bottom of the screen',
    (await st()).padSel === BACK_ROW, `row ${(await st()).padSel} of ${BACK_ROW}`);
  await tap(11);
  check('odd pad: and the newly bound select gets you out', (await st()).state === 'OPTIONS', (await st()).state);

  // Now the bindings should behave like any other pad's.
  await tap(12);
  check('odd pad: the newly bound back button leaves options', (await st()).state === 'TITLE', (await st()).state);
  await ev(() => { const g = window.__game; g.menuSel = g._titleMenu.findIndex((m) => m.label === 'GRAVEYARD SHIFT'); });
  await tap(11);
  check('odd pad: and select starts a run', (await st()).state === 'ESTABLISH', (await st()).state);

  // And it is remembered.
  const saved = await ev(() => {
    try { return JSON.parse(localStorage.getItem('finalrental.padbinds') || 'null'); } catch (e) { return null; }
  });
  // A button holds a list of jobs now, not a single one.
  check('odd pad: the binding is written down for next time',
    saved && (saved['11'] || []).includes('confirm') && (saved['12'] || []).includes('back'),
    saved ? JSON.stringify(saved).slice(0, 70) : 'nothing saved');

  await page.close();
}
await oddPad();

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\npadmenu FAILED (${fails})` : '\npadmenu clean');
process.exit(fails ? 1 : 0);
