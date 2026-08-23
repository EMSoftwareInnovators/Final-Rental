import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message, e.stack));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.evaluate(() => { window.__game.estT = 99; });
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const g = window.__game;
  g.timeScale = 0.0001;
  g.officer.state = 'DONE'; g.officerDone = true;
  g.customers.length = 0; g.killer.ent.hidden = true;
  g.opts.grain = 0; g.distress = 0; g.tension = 0; g.lights = 1;
  g.raster.fogNear = 20; g.raster.fogFar = 50;
  const { makeRng } = window.__mathx;
  const rng = makeRng(777);
  const A = window.__app;
  const mk = (force, name) => {
    const app = A.randomAppearance(rng, force);
    const c = window.__cust.createCustomer(rng, { app, intent: 'RENT', name });
    c.state = 'WAITING'; c.path = null; c.moveSpeed = 0; c.hidden = false;
    c.anim.legSwing = 0.28; c.anim.armL = -0.24; c.anim.armR = 0.24; c.anim.bob = 0;
    return c;
  };
  const H = A.HEIGHTS, B = A.BUILDS, HA = A.HATS, GL = A.GLASSES, CA = A.CARRY, MK = A.MARKS;
  const cast = [
    mk({ gender: 'm', build: B[3], height: H[2], hat: HA[0], glasses: GL[0], carry: CA[0], mark: MK[1] }, 'M broad'),
    mk({ gender: 'm', build: B[0], height: H[0], hat: HA[1], glasses: GL[2], carry: CA[4], mark: MK[0] }, 'M thin'),
    mk({ gender: 'f', build: B[2], height: H[1], hat: HA[0], glasses: GL[0], carry: CA[5], mark: MK[0] }, 'F heavy'),
    mk({ gender: 'f', build: B[0], height: H[1], hat: HA[0], glasses: GL[0], carry: CA[0], mark: MK[0] }, 'F thin'),
  ];
  window.__cast = cast;
  g.player.y = 0;
  return cast.map((c) => `${c.name}: ${c.app.gender.id} ${c.app.build.id} ${c.app.height.id} hair=${c.app.hair.style.id}`);
});

const views = [
  { n: 'front', px: 6.62, pz: 4.55, yaw: 0.0, pitch: 0.06, cz: 5.9 },
  { n: 'quarter', px: 5.85, pz: 4.60, yaw: 0.62, pitch: 0.06, cz: 5.9 },
  { n: 'back', px: 6.62, pz: 6.95, yaw: Math.PI, pitch: 0.06, cz: 5.9 },
];
for (let i = 0; i < 4; i++) {
  for (const v of views) {
    await page.evaluate(({ i, v }) => {
      const g = window.__game;
      const c = window.__cast[i];
      g.customers.length = 0; g.customers.push(c);
      c.x = 6.62; c.z = v.cz; c.yaw = v.n === "back" ? 0 : Math.PI;
      g.player.x = v.px; g.player.z = v.pz; g.player.yaw = v.yaw; g.player.pitch = v.pitch;
      g.player.eye = 1.35;
    }, { i, v });
    await page.waitForTimeout(320);
    await page.screenshot({ path: `shots/model-${i}-${v.n}.png`, clip: { x: 260, y: 60, width: 380, height: 700 } });
  }
}
console.log(info.join('\n'));
await browser.close();
