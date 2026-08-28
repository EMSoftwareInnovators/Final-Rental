/* Renders docs/cover.html to a PNG. The picture on it is a still taken
   out of the running game by tools/shots.mjs. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8080/docs/cover.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/cover.png' });
console.log('docs/cover.png');
console.log('errors:', errs.join(' | ') || '(none)');
await browser.close();
