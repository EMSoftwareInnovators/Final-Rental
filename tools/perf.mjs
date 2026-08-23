import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.evaluate(() => { window.__game.estT = 99; });
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const g = window.__game;
  g.officer.state = 'DONE'; g.officerDone = true;
  g.customers.length = 0;
  for (let i = 0; i < 6; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    c.state = 'WAITING'; c.path = null; c.hidden = false; c.moveSpeed = 1.2;
    c.x = 2 + i * 1.7; c.z = 3.0 + (i % 2) * 0.6; c.yaw = Math.PI;
    g.customers.push(c);
  }
  g.player.x = 6.5; g.player.z = 0.9; g.player.yaw = 0.0; g.player.pitch = 0;
  // let it settle, then sample
  await new Promise((res) => setTimeout(res, 600));
  const t0 = performance.now();
  const frames = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last); last = now;
      if (++n < 90) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  return {
    tris: g.raster.tris, spans: g.raster.spans,
    res: `${g.raster.w}x${g.raster.h}`,
    people: g.customers.length,
    medianMs: +frames[Math.floor(frames.length / 2)].toFixed(2),
    p90Ms: +frames[Math.floor(frames.length * 0.9)].toFixed(2),
  };
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: 'shots/perf-crowd.png' });
await browser.close();
