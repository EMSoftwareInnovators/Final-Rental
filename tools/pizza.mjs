/* A man rings the video shop and orders a pizza. He is not confused about
   the number -- he is certain -- and the only thing that ends it is a real
   pizza on the counter with his toppings on it. */
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

/* Everything below drives the game the way a player would: the phone
   tree, the man's own tree, and the clock. Nothing reaches in to skip a
   step. */
await ev(() => {
  window.__helpers = {
    reset() {
      const g = window.__game;
      g.customers.length = 0; g.queue.length = 0;
      g.pizza = null; g.officerDone = true; g.closing = false; g.elapsed = 10;
      if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; }
    },
    /* Walk a tree taking the first reply that matches, or the first one. */
    walk(node, re) {
      const said = [];
      for (let k = 0; k < 25 && node; k++) {
        said.push(node.text || '');
        const cs = node.choices || [];
        if (!cs.length) break;
        let i = re ? cs.findIndex((r) => re.test(r.label)) : -1;
        if (i < 0) i = 0;
        said.push(cs[i].label || '');
        node = cs[i].fn ? cs[i].fn() : null;
      }
      return said.join(' ¶ ');
    },
  };
});

/* ---------- 1. the phone rings, and it is not dispatch ---------- */
const rang = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  window.__helpers.reset();
  g.beginPizzaCall(window.__specials.specialById('PIZZA'));
  const before = g.pizza.rings;
  for (let i = 0; i < 300; i++) g.updatePizza(1 / 30);
  const obj = g.ui.el.objective ? g.ui.el.objective.textContent : '';
  const rings = g.pizza.rings;
  // picking it up answers it, whatever else the phone could have done
  const node = D.buildPhoneCall(g.ctx);
  return {
    before, rings, obj, phase: g.pizza.phase,
    opener: node.text || '',
    who: (node.person && node.person.name) || '',
  };
});
check('the phone rings at you, over and over',
  rang.rings >= 2, `${rang.rings} rings in ten seconds`);
check('and the shop says so', /PHONE IS RINGING/.test(rang.obj), rang.obj);
check('picking it up gets the caller, not dispatch',
  rang.who === 'A MAN ON A PAYPHONE' && rang.phase === 'ANSWERED', `${rang.who}, ${rang.phase}`);
console.log('      "' + rang.opener.replace(/\n/g, ' ').slice(0, 90) + '"');

/* ---------- 2. he will not be told, and comes anyway ---------- */
const insisted = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = { runs: [], unheard: null };
  for (let k = 0; k < 20; k++) {
    window.__helpers.reset();
    g.beginPizzaCall(window.__specials.specialById('PIZZA'));
    for (let i = 0; i < 60; i++) g.updatePizza(1 / 30);
    // tell him, every single time, that this is a video shop
    const said = window.__helpers.walk(D.buildPhoneCall(g.ctx), /video|wrong number|don't (do|sell)|no kitchen/i);
    out.runs.push({ phase: g.pizza.phase, said, wants: g.pizza.wants });
  }
  // and if you never pick it up at all
  window.__helpers.reset();
  g.beginPizzaCall(window.__specials.specialById('PIZZA'));
  for (let i = 0; i < 4000; i++) g.updatePizza(1 / 30);
  out.unheard = { phase: g.pizza.phase, came: !!g.pizza.customer };
  return out;
});
check('telling him it is a video shop does not stop him ordering',
  insisted.runs.every((r) => r.phase === 'ORDERED'),
  `${insisted.runs.filter((r) => r.phase === 'ORDERED').length} of ${insisted.runs.length}`);
check('and every order has something normal and something insane on it',
  insisted.runs.every((r) => r.wants && r.wants.ok && r.wants.odd),
  [...new Set(insisted.runs.map((r) => r.wants.odd))].slice(0, 4).join(', '));
check('never answering it is worse, not better -- he comes regardless',
  insisted.unheard.came === true, `phase ${insisted.unheard.phase}`);

/* ---------- 3. he arrives, and nothing you say moves him ---------- */
const wall = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  window.__helpers.reset();
  g.beginPizzaCall(window.__specials.specialById('PIZZA'));
  for (let i = 0; i < 60; i++) g.updatePizza(1 / 30);
  window.__helpers.walk(D.buildPhoneCall(g.ctx));
  let arrived = -1;
  for (let i = 0; i < 4000 && !g.pizza.customer; i++) { g.updatePizza(1 / 30); arrived = i; }
  const c = g.pizza.customer;
  if (!c) return { none: true };
  c.x = 7.05; c.z = 0.45; c.state = 'ACTING'; c.parked = true;
  const runs = [];
  for (let k = 0; k < 20; k++) {
    c.pizzaAsked = 0;
    const said = window.__helpers.walk(D.talkTo(c, g.ctx, { atCounter: true }),
      /video|leave|no pizza|don't do food/i);
    runs.push({ said, state: c.state });
  }
  return {
    arrived: Math.round(arrived / 30), state: c.state, act: c.act,
    at: [+c.x.toFixed(2), +c.z.toFixed(2)],
    gone: runs.filter((r) => r.state === 'LEAVING' || r.state === 'GONE').length,
    holes: runs.filter((r) => /undefined|\[object/.test(r.said)).length,
    mood: Math.round(c.mood),
    sample: runs[0].said.slice(0, 170),
  };
});
check('he turns up a while after the call, not instantly',
  !wall.none && wall.arrived > 15, `${wall.arrived}s later`);
check('and waits at the window watching for a car, not in the line',
  wall.act === 'HATCH', `${wall.act} at ${wall.at}`);
check('nothing you say to him gets him out of the shop',
  wall.gone === 0, `${wall.gone} of 20 conversations moved him`);
check('and arguing with him costs you', wall.mood < 90, `mood ${wall.mood}`);
check('with no hole in any of it', wall.holes === 0);
console.log('      "' + wall.sample.replace(/\n/g, ' ') + '"');

/* ---------- 4. the parlour has not got half of it ---------- */
const parlour = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = [];
  for (let k = 0; k < 12; k++) {
    window.__helpers.reset();
    g.beginPizzaCall(window.__specials.specialById('PIZZA'));
    for (let i = 0; i < 60; i++) g.updatePizza(1 / 30);
    window.__helpers.walk(D.buildPhoneCall(g.ctx));
    for (let i = 0; i < 4000 && !g.pizza.customer; i++) g.updatePizza(1 / 30);
    const c = g.pizza.customer;
    c.x = 7.05; c.z = 0.45; c.state = 'ACTING'; c.parked = true;

    // first call to the parlour
    let n = D.buildPhoneCall(g.ctx);
    let row = (n.choices || []).find((r) => /Bertucci/.test(r.label));
    const heard = row ? window.__helpers.walk(row.fn()) : '';
    const refused = g.pizza.refused;

    // go back to him and get him to pick something they have
    c.pizzaAsked = 0;
    const settle = window.__helpers.walk(D.talkTo(c, g.ctx, { atCounter: true }));
    const agreed = g.pizza.agreed;

    // ring them back
    n = D.buildPhoneCall(g.ctx);
    row = (n.choices || []).find((r) => /Bertucci/.test(r.label));
    const second = row ? window.__helpers.walk(row.fn()) : '';
    out.push({
      hadRow: !!heard, refused, agreed, second,
      phase: g.pizza.phase, cook: Math.round(g.pizza.cookTime || 0),
      wants: g.pizza.wants,
    });
  }
  return out;
});
check('the parlour is on the phone list once he is in the shop',
  parlour.every((r) => r.hadRow), `${parlour.filter((r) => r.hadRow).length} of ${parlour.length}`);
check('and they have never got the strange half of what he asked for',
  parlour.every((r) => r.refused === r.wants.odd),
  [...new Set(parlour.map((r) => r.refused))].slice(0, 4).join(', '));
check('so he has to choose again, out of what they do have',
  parlour.every((r) => r.agreed && r.agreed !== r.wants.odd),
  [...new Set(parlour.map((r) => r.agreed))].join(', '));
check('and ringing them back is what actually puts it in an oven',
  parlour.every((r) => r.phase === 'COOKING' && r.cook > 30),
  `${parlour.filter((r) => r.phase === 'COOKING').length} of ${parlour.length} cooking`);

/* ---------- 5. somebody brings it, he pays, they both go ---------- */
const delivered = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  window.__helpers.reset();
  g.beginPizzaCall(window.__specials.specialById('PIZZA'));
  for (let i = 0; i < 60; i++) g.updatePizza(1 / 30);
  window.__helpers.walk(D.buildPhoneCall(g.ctx));
  for (let i = 0; i < 4000 && !g.pizza.customer; i++) g.updatePizza(1 / 30);
  const c = g.pizza.customer;
  c.x = 7.05; c.z = 0.45; c.state = 'ACTING'; c.parked = true;
  const par = () => {
    const n = D.buildPhoneCall(g.ctx);
    const row = (n.choices || []).find((r) => /Bertucci/.test(r.label));
    if (row) window.__helpers.walk(row.fn());
    return !!row;
  };
  par();
  c.pizzaAsked = 0;
  window.__helpers.walk(D.talkTo(c, g.ctx, { atCounter: true }));
  par();

  const heard = [];
  const real = g.ui.toast;
  g.ui.toast = (t) => { heard.push(String(t)); };
  let drawnWhileIn = false, doorSwung = 0;
  for (let i = 0; i < 30000 && !g.pizza.done; i++) {
    g.updatePizza(1 / 30);
    g.updateDoor(1 / 30);
    doorSwung = Math.max(doorSwung, g.door.swing);
    const d = g.pizza.driver;
    if (d && !d.hidden && d.z > 0.2) drawnWhileIn = drawnWhileIn || g.people().includes(d);
  }
  // and out he goes
  for (let i = 0; i < 6000 && g.pizza.driver && g.pizza.driver.state !== 'DONE'; i++) {
    g.updatePizza(1 / 30); g.updateDoor(1 / 30);
  }
  g.ui.toast = real;
  return {
    done: g.pizza.done, onCounter: !!g.pizza.onCounter,
    drawnWhileIn, doorSwung: +doorSwung.toFixed(2),
    driver: g.pizza.driver && g.pizza.driver.state,
    custState: c.state, mood: Math.round(c.mood),
    box: heard.some((h) => /box goes on the counter/i.test(h)),
    paid: heard.some((h) => /pays the kid/i.test(h)),
    pending: g.pizzaPending(),
  };
});
check('a delivery kid actually walks in with it', delivered.drawnWhileIn === true);
check('and opens the door doing it', delivered.doorSwung > 0.6, `swing ${delivered.doorSwung}`);
check('the box goes on the counter', delivered.box && delivered.onCounter);
check('he pays the kid himself', delivered.paid === true);
check('and then they both leave',
  (delivered.custState === 'LEAVING' || delivered.custState === 'GONE')
  && delivered.driver === 'DONE' && delivered.done,
  `him: ${delivered.custState}, kid: ${delivered.driver}`);
check('and he goes happy', delivered.mood > 90, `mood ${delivered.mood}`);
check('nothing is left pending afterwards', delivered.pending === false);

/* ---------- 6. the shift does not pay for him ---------- */
const clock = await ev(async () => {
  const g = window.__game;
  const D = window.__dlg;
  const runFor = async (frames) => {
    const a = g.elapsed;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    return +(g.elapsed - a).toFixed(2);
  };
  window.__helpers.reset();
  const before = await runFor(20);
  g.beginPizzaCall(window.__specials.specialById('PIZZA'));
  for (let i = 0; i < 60; i++) g.updatePizza(1 / 30);
  window.__helpers.walk(D.buildPhoneCall(g.ctx));
  for (let i = 0; i < 4000 && !g.pizza.customer; i++) g.updatePizza(1 / 30);
  const held = await runFor(20);
  g.pizza = null; g.customers.length = 0;
  const after = await runFor(20);
  return { before, held, after };
});
check('the clock runs before he turns up', clock.before > 0.05, `${clock.before}s`);
check('and stops while he is in the building', clock.held === 0, `${clock.held}s`);
check('and starts again once he has his pizza', clock.after > 0.05, `${clock.after}s`);

await ev(() => { window.__game.pizza = null; window.__game.customers.length = 0; });

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\npizza FAILED (${fails})` : '\npizza clean');
process.exit(fails ? 1 : 0);
