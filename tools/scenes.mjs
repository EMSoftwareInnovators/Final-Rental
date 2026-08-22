import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2000);
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(500);
await ev(() => { window.__game.estT = 99; window.__game.timeScale = 3; });
await wait(500);

// --- the deputy at the counter, mid briefing ---
for (let i = 0; i < 40; i++) {
  if (await ev(() => !!window.__game.dlg.node)) break;
  await wait(200);
}
await ev(() => { window.__game.timeScale = 1; window.__game.ui.finishTyping(); });
await wait(300);
await shot('s1-deputy');

// clear the briefing
for (let i = 0; i < 24; i++) {
  if (!(await ev(() => !!window.__game.dlg.node))) break;
  await page.keyboard.press('Enter'); await wait(120);
  await page.keyboard.press('Enter'); await wait(160);
}
await wait(400);

// --- a customer at the counter ---
await ev(() => { window.__game.timeScale = 6; });
for (let i = 0; i < 90; i++) {
  const ok = await ev(() => {
    const g = window.__game;
    const c = g.customers.find((x) => x.state === 'WAITING');
    if (!c) return false;
    g.player.x = 10.75; g.player.z = 3.0; g.player.yaw = Math.PI; g.player.pitch = -0.02;
    g.timeScale = 1;
    return true;
  });
  if (ok) break;
  await wait(200);
}
await wait(600);
await shot('s2-customer');

// --- talking to them ---
await ev(() => {
  const g = window.__game;
  const c = g.customers.find((x) => x.state === 'WAITING');
  if (c) g.talkToPerson(c);
});
await wait(200);
await ev(() => window.__game.ui.finishTyping());
await wait(300);
await shot('s3-dialogue');

// --- notepad, comparing them against the bulletin ---
await ev(() => { const g = window.__game; if (g.dlg.node) g.dlg.cancel(); });
await wait(200);
await ev(() => { const g = window.__game; g.notesOpen = true; });
await wait(500);
await shot('s4-notes');
await ev(() => { const g = window.__game; g.notesOpen = false; g.ui.hideNotes(); });

// --- a tape in your hands at the shelves ---
await ev(() => {
  const g = window.__game;
  g.player.held = [
    { id: 1, title: 'THE CRAWL', genre: 'HORROR', rewound: false, price: 3.5, daysLate: 3 },
    { id: 2, title: 'ORBIT ZERO', genre: 'SCIFI', rewound: true, price: 3, daysLate: 0 },
  ];
  g.player.x = 2.55; g.player.z = 5.2; g.player.yaw = -Math.PI / 2; g.player.pitch = 0.02;
});
await wait(500);
await shot('s5-hands');

// --- the killer outside the window ---
await ev(() => {
  const g = window.__game;
  const k = g.killer;
  k.phase = 'STALK'; k.ent.hidden = false;
  k.ent.x = 4.6; k.ent.z = -1.5; k.ent.yaw = 0; k.ent.moveSpeed = 0;
  g.player.x = 6.2; g.player.z = 3.4; g.player.yaw = Math.PI; g.player.pitch = -0.02;
  g.tension = 0.8; g.lights = 0.55; g.distress = 0.5;
  g.ui.setObjective('SOMEONE IS OUTSIDE', true);
});
await wait(700);
await shot('s6-killer-window');

// --- him at the door ---
await ev(() => {
  const g = window.__game;
  g.killer.phase = 'TRY_DOOR';
  g.killer.ent.x = 6.0; g.killer.ent.z = -0.75; g.killer.ent.yaw = 0;
  g.door.locked = true;
  g.player.x = 6.2; g.player.z = 2.6; g.player.yaw = Math.PI; g.player.pitch = 0.0;
  g.lights = 0.4;
  g.ui.setObjective('LOCKED. HE IS STILL THERE.\nGET TO THE PHONE.', true);
});
await wait(700);
await shot('s7-at-the-door');

// --- the phone ---
await ev(() => { const g = window.__game; g.pickUpPhone(); });
await wait(400);
await shot('s8-phone');

// --- browsing customer in an aisle ---
await ev(() => {
  const g = window.__game;
  if (g.phone.node) g.hangUp();
  g.killer.ent.hidden = true;
  g.ui.setObjective('');
  g.lights = 1; g.tension = 0.1; g.distress = 0.05;
  const c = g.customers[0];
  if (c) {
    c.state = 'BROWSING'; c.path = null; c.browseSpot = { x: 4.85, z: 5.4, yaw: Math.PI / 2 };
    c.browseShelf = null; c.x = 4.85; c.z = 5.4; c.yaw = Math.PI / 2; c.browseTime = 999;
  }
  g.player.x = 4.7; g.player.z = 2.6; g.player.yaw = 0.06; g.player.pitch = -0.02;
  g.player.held = [];
});
await wait(900);
await shot('s9-aisle');

console.log(errs.length ? errs.join('\n') : 'clean');
await browser.close();
