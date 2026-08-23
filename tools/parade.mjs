import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
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
  g.customers.length = 0;
  g.killer.ent.hidden = true;
  const { makeRng } = window.__mathx;
  const rng = makeRng(20260822);
  window.__parade = [];
  const out = [];
  for (let i = 0; i < 5; i++) {
    const c = window.__cust.createCustomer(rng, { intent: 'RENT' });
    c.state = 'WAITING'; c.path = null; c.moveSpeed = 0; c.hidden = false;
    c.z = 5.55; c.x = 6.62; c.yaw = Math.PI;
    c.anim.legSwing = 0.34; c.anim.armL = -0.30; c.anim.armR = 0.30; c.anim.bob = 0;
    c.anim.headYaw = 0.12;
    window.__parade.push(c);
    out.push({ name: c.name, tag: c.personality.tag, g: c.app.gender.id, h: c.app.height.id, build: c.app.build.id,
      hair: c.app.hair.label, hat: c.app.hat.id, glasses: c.app.glasses.id, mark: c.app.mark.id,
      jacket: c.app.jacket.label, pants: c.app.pants.label, carry: c.app.carry.id, gait: c.app.gait.id });
  }
  g.player.x = 6.62; g.player.z = 1.55; g.player.yaw = 0.0; g.player.pitch = -0.03;
  g.lights = 1;
  if (window.__clean) {
    g.opts.res = 2; g.opts.grain = 0; g.layout();
    g.raster.fogNear = 30; g.raster.fogFar = 60;
    g.distress = 0; g.tension = 0;
  }
  return out;
});
for (let i = 0; i < 5; i++) {
  await page.evaluate((n) => {
    const g = window.__game;
    g.customers.length = 0;
    g.customers.push(window.__parade[n]);
  }, i);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `shots/char-${i + 1}.png`, clip: { x: 300, y: 130, width: 424, height: 560 } });
}
console.log(info.map((c, i) => `${i + 1}. ${c.name} [${c.g}] (${c.tag})\n   ${c.h}/${c.build} | ${c.hair} | hat:${c.hat} glasses:${c.glasses} mark:${c.mark}\n   ${c.jacket} + ${c.pants} | carrying:${c.carry}`).join('\n'));
await browser.close();
