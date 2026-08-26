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

  /* ---- the title screen ---- */
  check(`${label}: the left stick moves the title cursor`,
    await (async () => { const a = (await st()).menu; await flick(1, 1); return (await st()).menu === (a + 1) % 4; })(),
    `now on item ${(await st()).menu}`);
  await flick(1, -1);
  check(`${label}: and moves it back up`, (await st()).menu === 0);
  check(`${label}: the pad is recognised as the right family`,
    (await st()).scheme === expectScheme, (await st()).scheme);

  await flick(1, 1); await flick(1, 1); await flick(1, 1);   // down to OPTIONS
  check(`${label}: stick navigation wraps and holds`, (await st()).menu === 3, `item ${(await st()).menu}`);

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
  check(`${label}: the d-pad still moves the cursor`, (await st()).menu === (before + 1) % 4);
  await tap(12);
  check(`${label}: both ways`, (await st()).menu === before);

  /* ---- start a shift and pause it, all on the pad ---- */
  await ev(() => { window.__game.menuSel = 0; });
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

  /* ---- the stick must still drive the player, not just menus ---- */
  await ev(() => { window.__pad.axes[1] = -1; });
  await wait(400);
  const moved = await ev(() => ({ z: window.__game.player.z, mz: window.__game.input.moveZ }));
  await ev(() => { window.__pad.axes[1] = 0; });
  check(`${label}: and in play the same stick is analog movement, not arrow keys`,
    moved.mz > 0.3 && moved.mz < 1.01, `moveZ ${moved.mz.toFixed(2)}`);

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
  await ev(() => { window.__game.menuSel = 3; });
  await tap(11);
  check('odd pad: a button the standard table does not know still works a menu',
    (await st()).state === 'OPTIONS', (await st()).state);

  // Down to the Controller row and into it.
  await ev(() => { window.__game.optSel = 7; window.__ui && 0; });
  await ev(() => { window.__game.ui.panelSelect(7); });
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

  // Down to Back and out, on the pad alone. Walk it one line at a time and
  // stop on the last row rather than counting -- stepping onto "Reset to
  // defaults" and pressing a button does exactly what it says on the tin.
  for (let k = 0; k < 12 && (await st()).padSel !== 8; k++) await flick(1, 1);
  check('odd pad: the stick reaches the bottom of the screen', (await st()).padSel === 8, `row ${(await st()).padSel}`);
  await tap(11);
  check('odd pad: and the newly bound select gets you out', (await st()).state === 'OPTIONS', (await st()).state);

  // Now the bindings should behave like any other pad's.
  await tap(12);
  check('odd pad: the newly bound back button leaves options', (await st()).state === 'TITLE', (await st()).state);
  await ev(() => { window.__game.menuSel = 0; });
  await tap(11);
  check('odd pad: and select starts a run', (await st()).state === 'ESTABLISH', (await st()).state);

  // And it is remembered.
  const saved = await ev(() => {
    try { return JSON.parse(localStorage.getItem('finalrental.padbinds') || 'null'); } catch (e) { return null; }
  });
  check('odd pad: the binding is written down for next time',
    saved && saved['11'] === 'confirm' && saved['12'] === 'back',
    saved ? JSON.stringify(saved).slice(0, 60) : 'nothing saved');

  await page.close();
}
await oddPad();

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\npadmenu FAILED (${fails})` : '\npadmenu clean');
process.exit(fails ? 1 : 0);
