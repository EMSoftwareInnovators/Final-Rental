import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2200);
await page.screenshot({ path: 'shots/m1-title.png' });
const go = async (sel) => {
  await page.evaluate((n) => { const g = window.__game; g.menuSel = n; g.ui.titleSelect(n); }, sel);
  await page.keyboard.press('Enter'); await page.waitForTimeout(450);
};
await go(1);
await page.screenshot({ path: 'shots/m2-howto.png' });
await page.keyboard.press('Enter'); await page.waitForTimeout(350);
await go(2);
await page.screenshot({ path: 'shots/m3-options.png' });
await page.evaluate(() => { const g = window.__game; g.optSel = 6; });
await page.keyboard.press('Enter'); await page.waitForTimeout(350);
await go(0);
await page.waitForTimeout(400);
await page.evaluate(() => { const g = window.__game; g.sound.muted = true; g.estT = 99; g.timeScale = 30; g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; });
for (let i = 0; i < 220; i++) {
  const s = await page.evaluate(() => { const g = window.__game; if (g.dlg.node) g.dlg.pick(); return g.state; });
  if (s === 'REPORT') break;
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/m4-report.png' });
await browser.close();
