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
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);

await ev(() => {
  const g = window.__game;
  g.officer.state = 'DONE'; g.officerDone = true;
  g.customers.length = 0; g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true;
  g.timeScale = 1;
});

// --- a shopper reading the back of a box ---
await ev(() => {
  const g = window.__game;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.personality = { ...c.personality, confused: null };
  c.script = 'rent'; c.browsesFirst = false;
  c.x = 4.85; c.z = 5.2; c.yaw = Math.PI / 2;
  c.state = 'BROWSING'; c.path = null; c.moveSpeed = 0; c.hidden = false;
  c.browse = { visits: 3, seen: 1, phase: 'READ', t: 0.5, dur: 99,
    shelf: null, spot: { x: 4.85, z: 5.2, yaw: Math.PI / 2 }, genre: 'ACTION' };
  c.tape = { id: 1, title: 'STEEL RAIN', genre: 'ACTION', rewound: true, price: 2.99, daysLate: 0 };
  c.reading = true;
  g.customers.push(c);
  g.player.x = 4.7; g.player.z = 3.5; g.player.yaw = 0.10; g.player.pitch = -0.01;
});
await wait(900);
await page.screenshot({ path: 'shots/n1-perusing.png' });

// --- cash in hand, before it reaches the drawer ---
await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RETURN' });
  c.personality = { ...c.personality, confused: null };
  c.script = 'return';
  c.x = 10.75; c.z = 0.80; c.yaw = 0; c.state = 'WAITING'; c.path = null; c.moveSpeed = 0;
  c.awaitingChange = true; c.changeDue = 1.5; c.served = true;
  g.customers.push(c);
  g.player.cash = { tendered: 5, owed: 3.5 };
  g.player.changeInHand = 0;
  g.player.held = [{ id: 9, title: 'THE CRAWL', genre: 'HORROR', rewound: false, price: 3.5, daysLate: 3 }];
  g.player.x = 11.6; g.player.z = 2.85; g.player.yaw = Math.PI - 0.55; g.player.pitch = -0.30;
});
await wait(700);
await page.screenshot({ path: 'shots/n2-cash.png' });

// --- somebody in the wrong building ---
await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  const arch = window.__pers.ARCHETYPES.find((a) => a.id === 'LOST');
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT', personality: arch });
  c.premise = 'laundromat';
  c.x = 10.75; c.z = 0.80; c.yaw = 0; c.state = 'WAITING'; c.path = null; c.moveSpeed = 0;
  g.customers.push(c);
  g.player.cash = { tendered: 0, owed: 0 }; g.player.held = [];
  g.player.x = 10.75; g.player.z = 3.05; g.player.yaw = Math.PI; g.player.pitch = -0.02;
  g.talkToPerson(c);
});
await wait(250);
await ev(() => window.__game.ui.finishTyping());
await wait(350);
await page.screenshot({ path: 'shots/n3-lost.png' });

// --- and the DIM one, mid-conversation ---
await ev(() => {
  const g = window.__game;
  if (g.dlg.node) g.dlg.cancel();
  g.customers.length = 0;
  const arch = window.__pers.ARCHETYPES.find((a) => a.id === 'DIM');
  const c = window.__cust.createCustomer(g.rng, { intent: 'RETURN', personality: arch });
  c.premise = 'wedding';
  c.x = 10.75; c.z = 0.80; c.yaw = 0; c.state = 'WAITING'; c.path = null; c.moveSpeed = 0;
  g.customers.push(c);
  g.talkToPerson(c);
});
await wait(250);
await ev(() => window.__game.ui.finishTyping());
await wait(350);
await page.screenshot({ path: 'shots/n4-dim.png' });

// --- notepad, now with sex on the bulletin ---
await ev(() => {
  const g = window.__game;
  if (g.dlg.node) g.dlg.cancel();
  const c = g.customers[0];
  if (c) { window.__app.VISIBLE_KEYS.forEach((k) => c.observed.add(k)); c.observed.add('voice'); g.player.lookTarget = c; }
  g.notesOpen = true;
});
await wait(500);
await page.screenshot({ path: 'shots/n5-notes.png' });
await browser.close();
