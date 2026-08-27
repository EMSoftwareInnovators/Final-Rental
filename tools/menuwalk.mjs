// Walks the pause menu in and out of Options and back, the way a player
// would, and checks that a stray click cannot touch it.
//
// Backing out of Options used to land on the title screen, because pause()
// refused to run unless the state was PLAY and so returned to nothing.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.evaluate(() => { window.__game.estT = 99; }); await page.waitForTimeout(700);
let fails = 0;
const st = () => page.evaluate(() => ({ s: window.__game.state,
  panel: !document.getElementById('panel').classList.contains('hidden'),
  head: (document.querySelector('#panel-body h2') || {}).textContent || '' }));
const check = (l, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };

await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('escape pauses', (await st()).s === 'PAUSE', (await st()).head);
// down to Options, enter
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120);
await page.keyboard.press('Enter'); await page.waitForTimeout(300);
check('options opens from pause', (await st()).s === 'OPTIONS', (await st()).head);
// toggle the VHS filter while in there
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80); }
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const vhs = await page.evaluate(() => window.__game.opts.vhs);
check('VHS toggles from the pause options', vhs === false);
// back out: should land on the PAUSE menu, not the title
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
let s2 = await st();
check('backing out returns to the pause menu', s2.s === 'PAUSE' && /PAUSED/.test(s2.head), `${s2.s} / ${s2.head}`);
// in and out a few more times
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(90);
  await page.keyboard.press('Enter'); await page.waitForTimeout(220);
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
}
s2 = await st();
check('and survives doing it repeatedly', s2.s === 'PAUSE' && /PAUSED/.test(s2.head), `${s2.s} / ${s2.head}`);
// a stray click must not select anything
const before = await page.evaluate(() => window.__game.pauseSel);
await page.mouse.click(400, 300); await page.waitForTimeout(250);
s2 = await st();
check('a click does nothing in the pause menu',
  s2.s === 'PAUSE' && (await page.evaluate(() => window.__game.pauseSel)) === before, s2.s);
/* Quitting is the one thing in here you cannot take back, and it sits one
   row under "back to the counter". It asks first. */
const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(240); };
const sel = () => page.evaluate(() => ({ q: window.__game.quitSel, p: window.__game.pauseSel }));
/* Walk down to the quit row rather than assuming where the cursor is --
   an earlier check in this file leaves it wherever it left it. */
const toQuit = async () => {
  for (let i = 0; i < 6 && (await sel()).p !== 2; i++) await key('ArrowDown');
};
await toQuit();
check('the quit row can be reached from the pause menu', (await sel()).p === 2);
await key('Enter');
check('choosing quit asks whether you are sure', (await st()).s === 'QUIT', (await st()).s);
check('and the cursor starts on no', (await sel()).q === 0);
const asks = await page.evaluate(() => document.getElementById('panel-body').textContent);
check('and it says what quitting costs',
  /QUIT TO TITLE\?/.test(asks) && /will not be finished/.test(asks));
await key('Enter');
check('saying no goes back to the pause menu', (await st()).s === 'PAUSE', (await st()).s);
check('with the cursor still on quit, where you left it', (await sel()).p === 2);
await key('Enter');
check('and asks again the next time', (await st()).s === 'QUIT', (await st()).s);
await key('Escape');
check('and backing out of the question is also no', (await st()).s === 'PAUSE', (await st()).s);
await key('Enter'); await key('ArrowDown'); await key('Enter');
check('saying yes quits to the title', (await st()).s === 'TITLE', (await st()).s);

console.log(logs.length ? logs.join('\n') : 'no page errors');
await browser.close();
process.exit(fails ? 1 : 0);
