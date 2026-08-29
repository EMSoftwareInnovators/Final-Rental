/* The list dispatch reads back. Two people in the same coat used to appear
   on it as the same line twice, which made naming the killer a coin toss
   rather than a look at the pair of them. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const ev = (fn, arg) => page.evaluate(fn, arg);
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await ev(() => { window.__game.estT = 99; });
await page.waitForTimeout(700);

/* ---------- 1. the exact case: matching coats ---------- */
const twins = await ev(() => {
  const g = window.__game;
  
  g.customers.length = 0; g.queue.length = 0;
  if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; }
  const suspect = g.night.bulletin.app;
  const made = [];
  for (let i = 0; i < 4; i++) {
    const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    // everybody in the suspect's coat, which is the night this breaks on
    c.app.jacket = suspect.jacket;
    c.x = 4 + i; c.z = 2 + i * 0.7;
    g.customers.push(c); made.push(c);
  }
  const labels = g.phoneTargets().map((s) => s.phoneLabel);
  g.customers.length = 0; g.queue.length = 0;
  return { labels, unique: new Set(labels).size, coat: `${suspect.jacket.color.name} ${suspect.jacket.kind}` };
});
check('four people in the same coat get four different names',
  twins.unique === 4, `${twins.unique} of ${twins.labels.length} distinct`);
console.log('      all in a ' + twins.coat + ':');
twins.labels.forEach((l) => console.log('        - ' + l));

/* ---------- 2. and it does not over-explain a quiet store ---------- */
const plain = await ev(() => {
  const g = window.__game;
  g.customers.length = 0; g.queue.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  c.x = 5; c.z = 3;
  g.customers.push(c);
  const label = g.phoneTargets()[0].phoneLabel;
  g.customers.length = 0;
  return { label };
});
check('one person on their own is still just the one in the coat',
  /^The one in the [a-z ]+$/.test(plain.label), plain.label);

/* ---------- 3. the honest case, over and over ---------- */
const many = await ev(() => {
  const g = window.__game;
  const bad = [];
  let rooms = 0, clashes = 0;
  for (let trial = 0; trial < 300; trial++) {
    g.customers.length = 0; g.queue.length = 0;
    const n = 2 + (trial % 5);
    for (let i = 0; i < n; i++) {
      const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
      // half the rooms are stacked with the suspect's coat on purpose
      if (trial % 2 === 0) c.app.jacket = g.night.bulletin.app.jacket;
      c.x = 3 + i * 0.8; c.z = 1.5 + i * 0.6;
      g.customers.push(c);
    }
    const labels = g.phoneTargets().map((s) => s.phoneLabel);
    rooms++;
    if (new Set(labels).size !== labels.length) {
      clashes++;
      if (bad.length < 3) bad.push(labels.join(' / '));
    }
  }
  g.customers.length = 0; g.queue.length = 0;
  return { rooms, clashes, bad };
});
check('no room in three hundred has the same name on the list twice',
  many.clashes === 0, many.clashes ? many.bad.join(' | ') : `${many.rooms} rooms`);

/* ---------- 4. it separates people; it does not finger anybody ---------- */
/* The strongest way to say "the list does not know who he is": build the
   room, read the names, swap which of the two is the killer, and read them
   again. If guilt had any bearing on how somebody is described, the second
   reading would differ. */
const fair = await ev(() => {
  const g = window.__game;
  const out = { rooms: 0, changed: [] };
  for (let trial = 0; trial < 200; trial++) {
    g.customers.length = 0; g.queue.length = 0;
    const suspect = g.night.bulletin.app;
    const a = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    a.app = JSON.parse(JSON.stringify(suspect));
    a.x = 4; a.z = 2;
    const b = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
    b.app.jacket = suspect.jacket;
    b.x = 6; b.z = 3;
    g.customers.push(a, b);

    a.isKiller = true; b.isKiller = false;
    const first = g.phoneTargets().map((s) => s.phoneLabel).join(' | ');
    a.isKiller = false; b.isKiller = true;
    const second = g.phoneTargets().map((s) => s.phoneLabel).join(' | ');
    out.rooms++;
    if (first !== second && out.changed.length < 3) out.changed.push(`${first}  vs  ${second}`);
  }
  g.customers.length = 0; g.queue.length = 0;
  return out;
});
check('and swapping which of the two is him changes nothing about the names',
  fair.rooms > 0 && fair.changed.length === 0,
  fair.changed.length ? fair.changed.join(' || ') : `${fair.rooms} rooms read twice`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nphonelist FAILED (${fails})` : '\nphonelist clean');
process.exit(fails ? 1 : 0);
