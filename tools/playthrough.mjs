// Plays one real transaction with real key presses through the real
// interaction ray: take a return, collect the fee, rewind it, shelve it.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message + '\n' + (e.stack || '').split('\n')[1]));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const check = (l, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };
const look = (x, z, yaw, pitch = 0) => ev(({ x, z, yaw, pitch }) => {
  const g = window.__game;
  g.player.x = x; g.player.z = z; g.player.yaw = yaw; g.player.pitch = pitch;
  g.player.vx = 0; g.player.vz = 0;
}, { x, z, yaw, pitch });
const prompt = () => ev(() => document.getElementById('prompt').textContent.replace(/\s+/g, ' ').trim());

await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(500);
await ev(() => { window.__game.estT = 99; window.__game.timeScale = 5; });
await wait(500);

// clear the briefing
for (let i = 0; i < 40; i++) {
  if (await ev(() => window.__game.officerDone)) break;
  if (await ev(() => !!window.__game.dlg.node)) { await page.keyboard.press('Enter'); await wait(110); await page.keyboard.press('Enter'); }
  await wait(150);
}
check('briefing done', await ev(() => window.__game.officerDone));

/* Force a returning customer with a late, unrewound HORROR tape, and hold
   the door on everybody else -- customers are scheduled against the shop
   floor clock, so one could otherwise wander in and take index zero. */
const SUBJECT = await ev(() => {
  const g = window.__game;
  g.night.schedule.length = 0;
  g.customers.length = 0;
  const c = window.__cust.createCustomer(g.rng, { intent: 'RETURN' });
  c.tape = { id: 5150, title: 'BLOOD ORCHARD', genre: 'HORROR', rewound: false, price: 3.5, daysLate: 3, heldBy: c.id };
  c.script = 'return'; c.hasMoney = true; c.personality = { ...c.personality, honesty: 1, chattiness: 0 };
  g.customers.push(c);
  return c.id;
});
const subject = () => ev((id) => {
  const c = window.__game.customers.find((x) => x.id === id);
  return c ? { state: c.state, name: c.name } : null;
}, SUBJECT);
for (let i = 0; i < 80; i++) {
  const st = await subject();
  if (st && st.state === 'WAITING') break;
  await wait(200);
}
check('customer walked in and queued', ((await subject()) || {}).state === 'WAITING');

await ev(() => { window.__game.timeScale = 1; });
await look(10.75, 3.05, Math.PI, 0.0);
await wait(300);
const p1 = await prompt();
check('looking at them offers a conversation', /Talk to/.test(p1), p1.slice(0, 60));

// talk: pick "Before anything - this one's 3 days late." then pay, then take the tape
const pickByText = async (re) => {
  for (let tries = 0; tries < 3; tries++) {
    const idx = await ev((src) => {
      const g = window.__game;
      if (!g.dlg.node || !g.dlg.node.choices) return -1;
      return g.dlg.node.choices.findIndex((c) => new RegExp(src, 'i').test(c.label));
    }, re);
    if (idx >= 0) { await page.keyboard.press(`Digit${idx + 1}`); await wait(250); return true; }
    await page.keyboard.press('Enter'); await wait(200);
  }
  return false;
};

await page.keyboard.press('KeyE');   // start the conversation
await wait(350);
check('dialogue opened', await ev(() => !!window.__game.dlg.node));
await ev(() => window.__game.ui.finishTyping());
await wait(150);

check('late-fee line offered up front', await pickByText('days? late'));
await ev(() => window.__game.ui.finishTyping()); await wait(200);
await page.keyboard.press('Enter'); await wait(300);          // dispatch the "that's $3.00" node
await ev(() => window.__game.ui.finishTyping()); await wait(200);
check('they agree to pay', await pickByText("I'll take that|Thank you"));
await wait(300);
const hand = await ev(() => ({
  cash: window.__game.player.cash.tendered,
  owed: window.__game.player.cash.owed,
  till: window.__game.till,
}));
check('the cash is in your hand, not the till', hand.cash >= 3 && hand.owed >= 3 && hand.till === 0,
  `hand $${hand.cash.toFixed(2)} / owed $${hand.owed.toFixed(2)} / till $${hand.till.toFixed(2)}`);

await ev(() => window.__game.ui.finishTyping()); await wait(200);
await page.keyboard.press('Enter'); await wait(300);
await ev(() => window.__game.ui.finishTyping()); await wait(200);
check('you can take the tape', await pickByText("I'll take it"));
await wait(400);
const inHand = await ev(() => window.__game.player.held.map((t) => `${t.title}/${t.rewound ? 'rewound' : 'NOT rewound'}`));
check('tape is in your hands, unrewound', inHand.length === 1 && /NOT rewound/.test(inHand[0]), inHand.join());

// close out the conversation
for (let i = 0; i < 8; i++) {
  if (!(await ev(() => !!window.__game.dlg.node))) break;
  await ev(() => window.__game.ui.finishTyping()); await wait(120);
  await page.keyboard.press('Enter'); await wait(220);
}

// the money has to be walked to the register
await look(12.6, 2.75, Math.PI, -0.45);
await wait(250);
const pReg = await prompt();
check('the register offers to take the cash', /Ring up/.test(pReg), pReg.slice(0, 60));
await page.keyboard.press('KeyE');
await wait(300);
const after = await ev(() => ({
  till: window.__game.till,
  cash: window.__game.player.cash.owed,
  change: window.__game.changeOwed === undefined ? window.__game.player.changeInHand : 0,
}));
check('ringing up moves it into the drawer', after.till >= 3 && after.cash === 0,
  `till $${after.till.toFixed(2)}`);

// if they overpaid, they are still standing there waiting
const owedChange = await ev((id) => {
  const c = window.__game.customers.find((x) => x.id === id);
  return c ? { waiting: !!c.awaitingChange, due: c.changeDue || 0, inHand: window.__game.player.changeInHand } : null;
}, SUBJECT);
if (owedChange && owedChange.waiting) {
  check('change was counted out of the drawer', owedChange.inHand >= owedChange.due - 0.001,
    `$${owedChange.inHand.toFixed(2)} for $${owedChange.due.toFixed(2)} owed`);
  await look(10.75, 3.05, Math.PI, 0.0);
  await wait(250);
  await page.keyboard.press('KeyE');
  await wait(350);
  await ev(() => window.__game.ui.finishTyping()); await wait(150);
  const gave = await pickByText('Sorry about that');
  await wait(300);
  check('you can hand the change back', gave);
  check('and it leaves your hand',
    (await ev(() => window.__game.player.changeInHand)) < 0.001);
  for (let i = 0; i < 8; i++) {
    if (!(await ev(() => !!window.__game.dlg.node))) break;
    await ev(() => window.__game.ui.finishTyping()); await wait(110);
    await page.keyboard.press('Enter'); await wait(200);
  }
} else {
  console.log('      (exact change this run - skipped the change leg)');
}

// rewind it
await look(11.95, 2.7, Math.PI, -0.42);
await wait(250);
const p2 = await prompt();
check('rewinder is reachable from behind the counter', /Load BLOOD ORCHARD/.test(p2), p2.slice(0, 60));
await page.keyboard.press('KeyE');
await wait(200);
await ev(() => { window.__game.timeScale = 10; });
await wait(1400);
await ev(() => { window.__game.timeScale = 1; });
check('the tape rewound', await ev(() => window.__game.rewinder.done));
await page.keyboard.press('KeyE');
await wait(250);
check('and came back out rewound',
  await ev(() => window.__game.player.held.length === 1 && window.__game.player.held[0].rewound));

// shelve it on HORROR
await look(2.45, 5.2, -Math.PI / 2, -0.05);
await wait(250);
const p3 = await prompt();
check('the horror run offers the right shelf', /Shelve BLOOD ORCHARD/.test(p3) && /correct section/.test(p3), p3.slice(0, 80));
await page.keyboard.press('KeyE');
await wait(300);
check('shelved and scored',
  await ev(() => window.__game.stats.shelvedRight === 1 && window.__game.player.held.length === 0));

// the phone and the door are both reachable from the clerk's side
await look(12.2, 3.1, Math.PI / 2, -0.05);
await wait(250);
check('phone is reachable', /Pick up the phone/.test(await prompt()), (await prompt()).slice(0, 40));
await look(6.0, 1.3, Math.PI, -0.15);
await wait(250);
const p5 = await prompt();
check('front door can be locked', /Lock the front door/.test(p5), p5.slice(0, 40));
await page.keyboard.press('KeyE');
await wait(250);
check('and it locks', await ev(() => window.__game.door.locked));

console.log('\n--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
if (errs.length) fails += errs.length;
console.log(fails ? `\n${fails} PROBLEM(S)` : '\nplaythrough clean');
await browser.close();
process.exit(fails ? 1 : 0);
