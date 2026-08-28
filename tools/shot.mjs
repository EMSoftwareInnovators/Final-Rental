// Headless capture harness. Drives the game through a scripted sequence and
// dumps PNGs so the renderer can be eyeballed without a display.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(90); } };

const script = process.argv[2] || 'default';

await shot('01-title');

// enter the shift
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
await shot('02-establish');
await page.waitForTimeout(4200);
await shot('03-inside');

// let the deputy walk in and start the briefing
await page.waitForTimeout(6000);
await shot('04-briefing');
await key('Enter', 3);
await page.waitForTimeout(600);
await shot('05-briefing2');

// blow through the rest of the briefing
for (let i = 0; i < 8; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(400); }
await shot('06-postbriefing');

// notepad
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
await shot('07-notes');
await page.keyboard.press('Tab');

// look around the store
const state = await page.evaluate(() => {
  const g = window.__game;
  g.player.frozen = false;
  g.player.x = 6.4; g.player.z = 4.2; g.player.yaw = 0.0; g.player.pitch = 0;
  return { state: g.state, tris: g.raster.tris, night: g.nightNo };
});
await page.waitForTimeout(500);
await shot('08-aisles');

await page.evaluate(() => { const g = window.__game; g.player.yaw = Math.PI; g.player.x = 6.4; g.player.z = 4.0; });
await page.waitForTimeout(400);
await shot('09-back');

await page.evaluate(() => { const g = window.__game; g.player.x = 10.6; g.player.z = 3.0; g.player.yaw = Math.PI; g.player.pitch = -0.05; });
await page.waitForTimeout(400);
await shot('10-counter');

await page.evaluate(() => { const g = window.__game; g.player.x = 6.0; g.player.z = 3.2; g.player.yaw = Math.PI; g.player.pitch = 0.05; });
await page.waitForTimeout(400);
await shot('11-storefront');

// force a customer to the counter and talk
const diag = await page.evaluate(async () => {
  const g = window.__game;
  g.elapsed = 40;
  return { customers: g.customers.length, killerPhase: g.killer && g.killer.phase };
});
await page.waitForTimeout(9000);
await shot('12-customers');

const info = await page.evaluate(() => {
  const g = window.__game;
  return {
    state: g.state, elapsed: Math.round(g.elapsed), customers: g.customers.map((c) => ({ n: c.name, s: c.state, m: Math.round(c.mood) })),
    killer: g.killer && { phase: g.killer.phase, x: +g.killer.ent.x.toFixed(1), z: +g.killer.ent.z.toFixed(1) },
    tris: g.raster.tris, drawer: g.drawer, fps: g._fps,
  };
});

console.log(JSON.stringify(info, null, 1));
console.log('--- console ---');
console.log(logs.slice(0, 60).join('\n') || '(clean)');
await browser.close();
