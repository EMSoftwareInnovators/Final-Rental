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
const padScript = (id) => `
  const st = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0], id: ${JSON.stringify(id)} };
  window.__pad = st;
  navigator.getGamepads = () => [{
    index: 0, connected: true, id: st.id, mapping: 'standard',
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

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\npadmenu FAILED (${fails})` : '\npadmenu clean');
process.exit(fails ? 1 : 0);
