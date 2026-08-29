/* Publicity stills, taken out of the running game.

   Every one of these is the real thing: the scene is set up through the
   simulation, given time to settle, and photographed at the highest
   internal resolution the renderer offers. Nothing is composited and
   nothing is posed by hand that the game would not pose itself. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/* --clean takes the same set with the tape emulation switched off: no
   quantization, no dither, no chroma bleed, no scanlines. Same geometry,
   same lighting, same 320x240 buffer -- just the picture the renderer
   actually produces, before it is put through a VCR. */
const CLEAN = process.argv.includes('--clean');
const OUT = CLEAN ? 'docs/shots/clean' : 'docs/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const ev = (fn, arg) => page.evaluate(fn, arg);

/* Clear the toasts, and park the rolling head-switching band off the top of
   the frame. The band is the right thing for the game and the wrong thing
   for a still: it rolls up the picture every few seconds and lands wherever
   it lands, so half a set comes back with a white bar through the middle of
   it. Everything else about the tape emulation stays on. */
const hush = () => ev(() => {
  const g = window.__game;
  g.ui._toasts.forEach((t) => t.el.remove());
  g.ui._toasts.length = 0;
  g.post.trackY = -100; g.post.trackTimer = 99;
});

const shot = async (name) => {
  await hush();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  ', name);
};

await ev((clean) => {
  window.__game.sound.muted = true;
  if (clean) { window.__game.opts.vhs = false; window.__game.applyOptions(); }
}, CLEAN);

/* ---- 1. the title card ---- */
await shot('01-title');

/* ---- into a shift ---- */
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await ev(() => { window.__game.estT = 99; });
await page.waitForTimeout(900);
await ev(() => {
  const g = window.__game;
  g.opts.res = 2; g.applyOptions();
  g.officerDone = true; if (g.officer) { g.officer.state = 'DONE'; g.officer.hidden = true; }
  if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; g.killer.ent.hidden = true; }
  window.__pose = {
    /* Put the camera somewhere and let the world catch up. */
    async cam(x, z, yaw, pitch) {
      const p = window.__game.player;
      p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch;
      for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
    },
    /* Run the simulation for a while so people are where people would be. */
    async settle(sec) {
      const g = window.__game;
      const n = Math.round(sec * 30);
      for (let i = 0; i < n; i++) {
        g.customers.forEach((c) => { if (!c.hidden) window.__cust.updateCustomer(c, 1 / 30, g.ctx); });
        g.updateDoor(1 / 30);
      }
      for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
    },
    clear() {
      const g = window.__game;
      g.customers.length = 0; g.queue.length = 0;
      g.spills.length = 0; g.puffs.length = 0;
      g.popper.running = false;
      g.pizza = null; g.bus = null; g.managerCall = null;
      g.player.held.length = 0;
    },
  };
});

/* ---- 2. the store from just inside the door. The whole floor in one
        frame, and nobody on it yet: genre wall, free racks, counter. ---- */
await ev(() => window.__pose.clear());
await ev(() => window.__pose.cam(2.2, 1.10, 1.06, -0.08));
await shot('02-the-store');

/* ---- 3. behind the counter, a customer at the window ---- */
await ev(async () => {
  const g = window.__game;
  const T = window.__tapes;
  window.__pose.clear();
  for (let i = 0; i < 3; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: i ? 'RENT' : 'RETURN' });
    c.tape = T.makeTape(['HORROR', 'COMEDY', 'ACTION'][i], g.rng, { rewound: i !== 0 });
    c.script = i ? 'rent' : 'return'; c.hasMoney = true;
    c.x = 8.0 + i * 0.6; c.z = 2.4; c.state = 'TO_COUNTER'; c.path = null;
    g.customers.push(c);
  }
  await window.__pose.settle(13);
  g.player.held.push(T.makeTape('HORROR', g.rng, { rewound: false }));
  g.rewinder.tape = T.makeTape('SCIFI', g.rng, { rewound: false });
  g.rewinder.t = 2.1;
  g.drawer = 14.5;
});
await ev(() => window.__pose.cam(10.78, 3.05, Math.PI - 0.03, -0.15));
await shot('03-the-counter');

/* ---- 4. the notepad, held against the person in front of you ---- */
await ev(async () => {
  const g = window.__game;
  for (const k of g.night.bulletin.keys) g.night.bulletin.known.add(k);
  const front = g.queue[0] || g.customers[0];
  g.player.lookTarget = front;
  g.notesOpen = true;
  g.ui.showNotes(g.night.bulletin, front);
});
await shot('04-the-notepad');

/* ---- 5. the aisles ---- */
await ev(() => { const g = window.__game; g.notesOpen = false; g.ui.hideNotes(); });
await ev(() => window.__pose.cam(4.55, 6.6, -0.30, -0.10));
await shot('05-the-aisles');

/* ---- 6. the phone ---- */
await ev(async () => {
  const g = window.__game;
  window.__pose.clear();
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 10.75; c.z = 0.8; c.state = 'WAITING'; c.queueIndex = 0;
  g.customers.push(c);
  g.queue.push(c);
  g.pickUpPhone();
  await new Promise((r) => requestAnimationFrame(r));
});
await ev(() => window.__pose.cam(11.6, 3.9, Math.PI * 0.86, -0.14));
await shot('06-the-phone');

/* ---- 7. the popcorn, and the machine still going ---- */
await ev(async () => {
  const g = window.__game;
  g.hangUp();
  window.__pose.clear();
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('POPCORN'));
  c.x = 12.05; c.z = 6.10; c.yaw = Math.PI / 2;
  c.state = 'ACTING'; c.parked = true; c.tipped = true; c.actTimer = 9;
  g.customers.push(c);
  g.startPopper(c);
  for (let i = 0; i < 1500; i++) { g.updatePopper(1 / 30); g.updatePuffs(1 / 30); }
  g.revealVacuum();
  await new Promise((r) => requestAnimationFrame(r));
});
await ev(() => window.__pose.cam(10.3, 3.0, 0.52, -0.26));
await shot('07-the-popcorn');

/* ---- 8. the coach ---- */
await ev(async () => {
  const g = window.__game;
  g.popper.running = false; g.spills.length = 0; g.puffs.length = 0;
  window.__pose.clear();
  g.night.busAt = 0; g.sim = 1;
  g.updateBus(0.1);
  for (let i = 0; i < 3000 && (!g.bus || g.bus.made < g.bus.total); i++) g.updateBus(1 / 30);
  await window.__pose.settle(300);
});
await ev(() => window.__pose.cam(10.75, 3.30, -1.82, -0.13));
await shot('08-the-coach');

/* ---- 9. the storefront, from the street ---- */
await ev(() => { const g = window.__game; window.__pose.clear(); g.ui.setHudVisible(false); });
await ev(() => window.__pose.cam(6.4, -4.35, 0.03, 0.04));
await shot('09-the-storefront');

/* ---- and the same, framed for a cover ----
   Taken off the canvas itself rather than off the page, so there are no
   letterbox bands baked into the picture. */
await ev(() => window.__pose.cam(6.15, -4.30, 0.02, 0.02));
await hush();
await page.waitForTimeout(500);
await page.locator('#screen').screenshot({ path: `${OUT}/cover-base.png` });
console.log('   cover-base (canvas only)');

console.log('errors:', errs.join(' | ') || '(none)');
await browser.close();
