/* The woman who wants a manager, and the wired phone she has to be handed.
   Talking to her is a wall on purpose; the regional manager is asleep
   forty minutes away; and the flex only goes as far as the flex goes. */
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

/* ---------- 1. talking to her does nothing, at length ---------- */
const wall = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const runs = [];
  for (let k = 0; k < 25; k++) {
    g.customers.length = 0; g.queue.length = 0;
    g.managerCall = null;
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('MANAGER'));
    c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
    g.customers.push(c);
    let node = D.talkTo(c, g.ctx, { atCounter: true });
    const said = [];
    let turns = 0;
    for (; turns < 60 && node; turns++) {
      said.push(node.text || '');
      const ch = node.choices || [];
      if (!ch.length) break;
      const r = ch[(k + turns) % ch.length];
      said.push(r.label || '');
      node = r.fn ? r.fn() : null;
      if (c.state === 'LEAVING' || c.state === 'GONE' || c.state === 'BROWSING') break;
      if (!node) node = D.talkTo(c, g.ctx, { atCounter: true });
    }
    runs.push({ gone: c.state === 'LEAVING' || c.state === 'GONE', turns,
      text: said.join(' ¶ ') });
  }
  g.customers.length = 0; g.queue.length = 0;
  const all = runs.map((r) => r.text).join(' ');
  return {
    n: runs.length,
    gone: runs.filter((r) => r.gone).length,
    holes: runs.filter((r) => /undefined|\[object/.test(r.text)).length,
    shortest: Math.min(...runs.map((r) => r.turns)),
    asksManager: runs.filter((r) => /manager|somebody above you|district|regional/i.test(r.text)).length,
    // she will tell you what it is actually about, if you ask
    reason: /no light|black hole|followed to her car|alley/i.test(all),
    notYourFault: /not about you|not asking YOU|isn't a complaint about you/i.test(all),
  };
});
check('no conversation with her ever gets her out of the store',
  wall.gone === 0, `${wall.gone} of ${wall.n} left by talking`);
check('and she keeps asking for a manager whatever you say',
  wall.asksManager === wall.n, `${wall.asksManager} of ${wall.n}`);
check('she is clear it is not about the clerk', wall.notYourFault);
check('and she will say what it is about if you ask', wall.reason);
check('there is no hole anywhere in it', wall.holes === 0);
check('it is not a two-line conversation', wall.shortest > 4, `shortest ${wall.shortest}`);

/* ---------- 2. the regional manager is asleep ---------- */
const ring = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const runs = [];
  for (let k = 0; k < 40; k++) {
    g.customers.length = 0; g.queue.length = 0;
    g.managerCall = null;
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('MANAGER'));
    c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
    g.customers.push(c);
    const heard = [];
    for (let i = 0; i < 10 && !g.ctx.managerConnected(); i++) {
      const t = D.buildPhoneCall(g.ctx);
      const row = (t.choices || []).find((r) => /regional manager/i.test(r.label));
      if (!row) { heard.push('NO ROW'); break; }
      const n = row.fn();
      heard.push((n && n.person && n.person.name) || '?');
    }
    runs.push({ attempts: g.managerCall ? g.managerCall.attempts : 0, heard,
      connected: g.ctx.managerConnected() });
  }
  const voices = new Set();
  runs.forEach((r) => r.heard.forEach((h) => voices.add(h)));
  g.customers.length = 0; g.queue.length = 0; g.managerCall = null;
  return {
    n: runs.length,
    all: runs.every((r) => r.connected),
    min: Math.min(...runs.map((r) => r.attempts)),
    max: Math.max(...runs.map((r) => r.attempts)),
    voices: [...voices],
  };
});
check('he does not answer the first time, or the second',
  ring.min >= 3, `earliest he answered was go ${ring.min}`);
check('and he always answers in the end',
  ring.all && ring.max <= 5, `latest was go ${ring.max}, all connected: ${ring.all}`);
check('with somebody different on the end of it each go',
  ring.voices.length >= 4, ring.voices.join(', '));

/* ---------- 3. the row is only there when she is ---------- */
const gated = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  g.customers.length = 0; g.queue.length = 0; g.managerCall = null;
  const empty = (D.buildPhoneCall(g.ctx).choices || []).some((r) => /regional manager/i.test(r.label));
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('MANAGER'));
  c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
  g.customers.push(c);
  const withHer = (D.buildPhoneCall(g.ctx).choices || []).some((r) => /regional manager/i.test(r.label));
  g.ctx.managerConnect();
  const once = (D.buildPhoneCall(g.ctx).choices || []).some((r) => /regional manager/i.test(r.label));
  g.customers.length = 0; g.managerCall = null;
  return { empty, withHer, once };
});
check('you cannot ring the regional manager for no reason',
  gated.empty === false && gated.withHer === true,
  `no her: ${gated.empty}, her: ${gated.withHer}`);
check('and you do not ring him twice once he is holding', gated.once === false);

/* ---------- 4. the cord goes as far as the cord goes ---------- */
const cord = await ev(() => {
  const g = window.__game;
  const at = (x, z) => g.cordReaches({ x, z });
  return {
    window: at(10.75, 0.80),          // the service position
    endOfCounter: at(11.6, 0.62),     // where she stands
    behindRegister: at(12.4, 2.0),        // the clerk's side
    lobby: at(6.6, 2.2),              // the middle of the store
    horror: at(2.4, 5.6),             // the far aisle
    door: at(6.0, 0.55),              // the doorway
  };
});
check('the flex reaches the counter, both sides of it',
  cord.window && cord.endOfCounter && cord.behindRegister,
  `window ${cord.window}, end ${cord.endOfCounter}, register ${cord.behindRegister}`);
check('and reaches none of the store floor',
  !cord.lobby && !cord.horror && !cord.door,
  `lobby ${cord.lobby}, aisle ${cord.horror}, door ${cord.door}`);

/* ---------- 5. handing it over, and what happens then ---------- */
const hand = await ev(() => {
  const g = window.__game;
  g.customers.length = 0; g.queue.length = 0; g.managerCall = null;
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('MANAGER'));
  c.x = 2.4; c.z = 5.6; c.state = 'ACTING';         // out in the aisle
  g.customers.push(c);
  g.ctx.managerAttempt(); g.ctx.managerConnect();

  g.handOverPhone(c);
  const outOfRange = !g.managerCall.handedTo;

  c.x = 11.6; c.z = 0.62;
  g.handOverPhone(c);
  const handed = !!g.managerCall.handedTo && !!c.onPhone;

  const heard = [];
  const seen = g.ui.toast;
  g.ui.toast = (t) => { heard.push(String(t)); };
  let t = 0;
  for (let i = 0; i < 12000 && g.managerCall; i++) { g.updateHandedPhone(1 / 30); t += 1 / 30; }
  g.ui.toast = seen;
  const out = {
    outOfRange, handed, seconds: Math.round(t),
    beats: heard.length,
    left: c.state, mood: Math.round(c.mood),
    said: heard.slice(0, 3).join(' | '),
    thanks: heard.some((h) => /thank you/i.test(h)),
    lot: heard.some((h) => /LOT|light|alley/i.test(h)),
  };
  g.customers.length = 0; g.managerCall = null;
  return out;
});
check('you cannot hand the receiver to somebody across the store',
  hand.outOfRange === true);
check('but you can when she is at the counter', hand.handed === true);
check('she has a whole conversation with him, and it takes a while',
  hand.beats >= 8 && hand.seconds > 45, `${hand.beats} things said over ${hand.seconds}s`);
check('and it is about the lot, not about you', hand.lot === true);
check('she thanks him, and she goes',
  hand.thanks && (hand.left === 'LEAVING' || hand.left === 'GONE'), `${hand.left}, mood ${hand.mood}`);
console.log('      ' + hand.said.slice(0, 190));

/* ---------- 6. the shift does not pay for her call ---------- */
const clock = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0; g.queue.length = 0; g.managerCall = null;
  g.officerDone = true; g.closing = false; g.elapsed = 10;
  if (g.killer) { g.killer.plan.appears = false; g.killer.phase = 'ABSENT'; }
  const runFor = async (frames) => {
    const a = g.elapsed;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    return +(g.elapsed - a).toFixed(2);
  };
  const before = await runFor(20);
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('MANAGER'));
  c.x = 11.6; c.z = 0.62; c.state = 'ACTING'; c.parked = true;
  g.customers.push(c);
  g.ctx.managerAttempt(); g.ctx.managerConnect();
  g.handOverPhone(c);
  const onCall = await runFor(20);
  g.customers.length = 0; g.managerCall = null; c.onPhone = false;
  const after = await runFor(20);
  return { before, onCall, after };
});
check('the clock runs normally before she picks it up', clock.before > 0.05, `${clock.before}s`);
check('and stops while she is on the phone to him', clock.onCall === 0, `${clock.onCall}s`);
check('and starts again once she has gone', clock.after > 0.05, `${clock.after}s`);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\nmanager FAILED (${fails})` : '\nmanager clean');
process.exit(fails ? 1 : 0);
