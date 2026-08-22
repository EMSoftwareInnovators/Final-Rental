import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 560, height: 620 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const g = window.__game;
  const { randomAppearance, paintSkin } = window.__app;
  const { makeRng } = window.__mathx;
  const rng = makeRng(1234);
  const a = randomAppearance(rng);
  const tex = paintSkin(a);
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:#222;color:#ffb641;font:12px monospace;padding:8px';
  const big = document.createElement('canvas');
  big.width = 512; big.height = 512;
  const bg = big.getContext('2d');
  bg.imageSmoothingEnabled = false;
  bg.drawImage(tex.canvas, 0, 0, 512, 512);
  // label the atlas regions
  const A = window.__app.ATLAS;
  bg.strokeStyle = '#00ff88'; bg.font = 'bold 11px monospace'; bg.fillStyle = '#00ff88';
  for (const [k, r] of Object.entries(A)) {
    bg.strokeRect(r[0] * 4, r[1] * 4, r[2] * 4, r[3] * 4);
    bg.fillText(k, r[0] * 4 + 2, r[1] * 4 + 11);
  }
  wrap.appendChild(big);
  const info = document.createElement('div');
  info.textContent = `skin=${a.skin} pants=${a.pants.color.hex} jacket=${a.jacket.color.hex} hair=${a.hair.color.hex}`;
  wrap.appendChild(info);
  document.body.appendChild(wrap);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/atlas.png' });
await browser.close();
