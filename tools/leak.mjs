/* Stage 13: performance and resource-lifecycle audit.
 *
 * Two questions this stage has to answer with numbers rather than adjectives:
 *   1. does the game hold frame pace under the heaviest procedural pressure it
 *      ever intends (an Overtime shift at the effective-night cap -- a full
 *      floor, the killer very likely, the longest bulletin)?
 *   2. does anything -- DOM panels, customers, timers, audio, closures -- keep
 *      growing across many night/mode transitions, i.e. does starting and
 *      ending shifts leak?
 *
 * Frame numbers here are from this headless SwiftShader (software GL)
 * environment, so they are a REGRESSION signal, not a hardware promise: real
 * integrated-GPU hardware renders this faster. The leak check is hardware-
 * independent and is the load-bearing assertion.
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  // --expose-gc lets us settle the heap before measuring; precise-memory-info
  // turns off the usual bucketing so the trend is readable.
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage',
    '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => { window.__game.sound.muted = true; });

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* ---------- frame pace under maximum procedural pressure ---------- */
async function measure(mode, night) {
  return page.evaluate(async ([mode, night]) => {
    const g = window.__game;
    g.sound.muted = true;
    g.beginRun(mode);
    g.startNight(night);
    // Skip the establishing shot and any deputy briefing, then fill the floor.
    g.estT = 99;
    if (g.officer) { g.officer.hidden = true; g.officerDone = true; }
    g.player.frozen = false;
    g.state = 'PLAY';
    g.customers.length = 0;
    for (let i = 0; i < 10; i++) {
      const c = window.__cust.createCustomer(g.rng, { intent: i % 2 ? 'RENT' : 'RETURN' });
      c.state = 'WAITING'; c.path = null; c.hidden = false; c.moveSpeed = 1.1;
      c.x = 2 + (i % 5) * 1.6; c.z = 2.4 + (i % 3) * 0.7; c.yaw = Math.PI;
      g.customers.push(c);
    }
    g.player.x = 6.5; g.player.z = 0.9; g.player.yaw = 0; g.player.pitch = 0;
    await new Promise((r) => setTimeout(r, 500));
    const frames = [];
    let last = performance.now();
    await new Promise((res) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last); last = now;
        if (++n < 120) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    frames.sort((a, b) => a - b);
    return {
      tris: g.raster.tris, res: `${g.raster.w}x${g.raster.h}`, people: g.customers.length,
      median: +frames[Math.floor(frames.length / 2)].toFixed(2),
      p90: +frames[Math.floor(frames.length * 0.9)].toFixed(2),
    };
  }, [mode, night]);
}

console.log('  -- frame pace (headless software GL; regression signal only) --');
// Overtime shift 10 maps to effective night 14 -- the intended maximum pressure.
const maxPressure = await measure('OVERTIME', 14);
console.log(`     effN14 crowd: ${maxPressure.people} people, ${maxPressure.tris} tris @ ${maxPressure.res}`
  + ` -- median ${maxPressure.median}ms, p90 ${maxPressure.p90}ms`);
const night1 = await measure('HORROR', 1);
console.log(`     night 1:      ${night1.people} people, ${night1.tris} tris`
  + ` -- median ${night1.median}ms, p90 ${night1.p90}ms`);
// A regression gate loose enough to survive a noisy CI box but tight enough to
// catch a real blow-up: a median frame should be well under a quarter second
// even in software rendering.
check('the heaviest shift still renders at an interactive pace in software GL',
  maxPressure.median < 260, `${maxPressure.median}ms median`);

/* ---------- resource lifecycle across many transitions ---------- */
console.log('\n  -- leak audit: 24 night/mode transitions --');
await page.evaluate(() => { window.__game.toTitle(); });
await page.waitForTimeout(200);

const settleHeap = () => page.evaluate(async () => {
  if (window.gc) { window.gc(); await new Promise((r) => setTimeout(r, 30)); window.gc(); }
  await new Promise((r) => setTimeout(r, 30));
  return {
    heap: (performance.memory && performance.memory.usedJSHeapSize) || 0,
    dom: document.querySelectorAll('*').length,
    customers: window.__game.customers.length,
  };
});

const before = await settleHeap();
await page.evaluate(async () => {
  const g = window.__game;
  try { ['finalrental.campaign', 'finalrental.profile', 'finalrental.overtime'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ }
  for (let i = 0; i < 24; i++) {
    // Story: a couple of nights, then back to title.
    g.newStory();
    for (let n = 0; n < 3; n++) {
      g.grade = { letter: 'B', score: 110 }; g.stats = { served: 6, stormedOut: 1, cashLoose: 0 };
      g.advanceNight();
    }
    g.toTitle();
    // Graveyard, then title.
    g.beginRun('HORROR'); g.startNight(7); g.toTitle();
    // Casual, then title.
    g.beginRun('CASUAL'); g.startNight(2); g.toTitle();
    await new Promise((r) => setTimeout(r, 0));
  }
});
await page.waitForTimeout(200);
const after = await settleHeap();

const domGrew = after.dom - before.dom;
const heapGrewMB = (after.heap - before.heap) / (1024 * 1024);
console.log(`     DOM nodes: ${before.dom} -> ${after.dom} (${domGrew >= 0 ? '+' : ''}${domGrew})`);
console.log(`     JS heap:   ${(before.heap / 1048576).toFixed(1)}MB -> ${(after.heap / 1048576).toFixed(1)}MB`
  + ` (${heapGrewMB >= 0 ? '+' : ''}${heapGrewMB.toFixed(1)}MB)`);
console.log(`     live customers after settling: ${after.customers}`);

// DOM must not accumulate: the panels and HUD are reused, not re-created per
// night. A handful of nodes of drift is fine; hundreds would be a leak.
check('DOM node count does not grow across 24 transitions', domGrew < 60, `+${domGrew}`);
// Customers from a finished night must not survive to the next.
check('no customers leak across a night boundary', after.customers === 0, `${after.customers} left`);
// Heap is noisy under software GL; only a large, clearly-unbounded climb fails.
check('JS heap does not climb unboundedly across 24 transitions', heapGrewMB < 40, `+${heapGrewMB.toFixed(1)}MB`);

await browser.close();
console.log(fails ? `\nleak FAILED (${fails})` : '\nleak clean');
process.exit(fails ? 1 : 0);
