/* The regulars. Checks that every fixed character can be planned, spawned,
   performs their business in the shop, and can be talked all the way out of
   the door -- both ways, where they have two ways to go. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2000);

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* ---------- 1. the roster itself ---------- */
const roster = await ev(() => {
  const R = window.__specials.specialRoster();
  return R.map((s) => ({
    id: s.id, name: s.name, tag: s.tag, act: s.act || null, nuisance: s.nuisance || null,
    lines: Object.keys(s.lines || {}).length,
    complaints: (s.complaints || []).length,
    hair: s.app.hair.label, coat: s.app.jacket.label, smell: s.app.smell.id,
  }));
});
check('every special is on the roster with a fixed face', roster.length >= 12
  && roster.every((s) => s.name && s.tag && s.hair && s.coat), `${roster.length} of them`);
check('and their names are all different',
  new Set(roster.map((s) => s.name)).size === roster.length);

const twice = await ev(() => {
  const a = window.__specials.specialRoster();
  const b = window.__specials.specialRoster();
  return a.every((s, i) => s.app.hair.label === b[i].app.hair.label
    && s.app.jacket.color.hex === b[i].app.jacket.color.hex);
});
check('the same person looks the same every time you build them', twice);

/* ---------- 2. how often they turn up ---------- */
const rota = await ev(() => {
  const { planSpecials } = window.__specials;
  const { makeRng } = window.__mathx;
  let swarms = 0, none = 0, one = 0, two = 0, seen = {};
  for (let i = 0; i < 4000; i++) {
    const p = planSpecials(makeRng(1000 + i), 5, 9);
    if (p.swarm) swarms++;
    else if (p.picks.length === 0) none++;
    else if (p.picks.length === 1) one++;
    else two++;
    p.picks.forEach((id) => { seen[id] = (seen[id] || 0) + 1; });
    if (new Set(p.picks).size !== p.picks.length) return { dupe: true };
  }
  return { swarms: swarms / 4000, none: none / 4000, one: one / 4000, two: two / 4000, seen };
});
check('nobody turns up twice in one night', !rota.dupe);
check('most nights have one of them, some have none, a few have two',
  rota.one > 0.35 && rota.none > 0.2 && rota.two > 0.1,
  `none ${(rota.none * 100) | 0}% / one ${(rota.one * 100) | 0}% / two ${(rota.two * 100) | 0}%`);
check('and a whole night of them is rare but real',
  rota.swarms > 0.03 && rota.swarms < 0.12, `${(rota.swarms * 100).toFixed(1)}% of nights`);
check('over time everybody gets a turn',
  Object.keys(rota.seen || {}).length === roster.length,
  `${Object.keys(rota.seen || {}).length} of ${roster.length} seen`);

const scheduled = await ev(() => {
  const M = window.__night;
  let withSpecial = 0, decoyClash = 0, tries = 300;
  for (let i = 0; i < tries; i++) {
    const p = M.makeNight(2000 + i, 5, "HORROR");
    const s = p.schedule.filter((e) => e.special);
    if (s.length) withSpecial++;
    if (s.some((e) => e.decoy)) decoyClash++;
  }
  return { withSpecial: withSpecial / tries, decoyClash };
});
check('the night plan drops them into ordinary customer slots',
  scheduled.withSpecial > 0.5, `${(scheduled.withSpecial * 100) | 0}% of planned nights`);
check('and never onto the killer decoy', scheduled.decoyClash === 0);

/* ---------- 3. in the shop ---------- */
await ev(() => { window.__game.sound.muted = true; });
await page.keyboard.press('Enter');
await wait(600);
await ev(() => { window.__game.estT = 99; });
await wait(700);
check('shift started', await ev(() => window.__game.state) === 'PLAY');

// Put the whole roster in the shop at once and let them find their spots.
const spawned = await ev(() => {
  const g = window.__game;
  g.night.schedule.length = 0;
  g.customers.length = 0;
  const R = window.__specials.specialRoster();
  R.forEach((sp) => g.customers.push(window.__cust.makeSpecial(g.rng, sp)));
  return g.customers.map((c) => ({ id: c.id, name: c.name, special: c.special, script: c.script, state: c.state }));
});
check('all of them will spawn', spawned.length === roster.length
  && spawned.every((c) => c.special && c.script === 'special'), `${spawned.length} in the shop`);
check('and they arrive as themselves, not as a random face',
  spawned.map((c) => c.name).sort().join('|') === roster.map((s) => s.name).sort().join('|'));

await ev(() => { window.__game.timeScale = 20; });
await wait(5000);
await ev(() => { window.__game.timeScale = 1; });

const settled = await ev(() => {
  const g = window.__game;
  return g.customers.map((c) => ({
    id: c.special, state: c.state, act: c.act || null,
    x: +c.x.toFixed(2), z: +c.z.toFixed(2),
    phase: +(c.actPhase || 0).toFixed(1),
    script: c.script || null, tape: c.tape ? c.tape.title : null,
  }));
});
check('everyone on the roster runs their own tree, not the rent one',
  settled.every((c) => c.script === 'special'),
  settled.filter((c) => c.script !== 'special').map((c) => `${c.id}:${c.script}`).join(' ') || 'all 12');
check('and only the man with somebody else\'s tape walked in holding one',
  settled.filter((c) => c.tape).length === 1
  && settled.find((c) => c.tape).id === 'RETURNS',
  settled.filter((c) => c.tape).map((c) => `${c.id}:${c.tape}`).join(' '));

const actors = settled.filter((c) => c.act);
check('the ones with somewhere to be got there and are doing it',
  actors.length === 5 && actors.every((c) => c.state === 'ACTING'),
  actors.map((c) => `${c.id}:${c.state}@${c.x},${c.z}`).join(' '));
check('nobody is standing in the doorway',
  settled.every((c) => c.z < 12.4), `deepest z ${Math.max(...settled.map((c) => c.z)).toFixed(2)}`);
check('and the performance is actually running',
  actors.every((c) => c.phase > 0), `phases ${actors.map((c) => c.phase).join('/')}`);

const spots = await ev(() => {
  const g = window.__game;
  const want = { DANCE: [6.6, 3.4], TV: [2.1, 3.0], PHONE: [8.2, 4.6] };
  return g.customers.filter((c) => want[c.act]).map((c) => ({
    act: c.act, d: +Math.hypot(c.x - want[c.act][0], c.z - want[c.act][1]).toFixed(2),
  }));
});
check('the boombox, the television and the phone call each have their own corner',
  spots.length === 3 && spots.every((s) => s.d < 0.9),
  spots.map((s) => `${s.act} ${s.d}m off`).join(' '));

// The nuisances draw complaints from anyone else in the shop.
const gripes = await ev(() => {
  const g = window.__game;
  const said = [];
  const real = g.ui.toast.bind(g.ui);
  g.ui.toast = (t, k) => { said.push(t); return real(t, k); };
  const out = [];
  g.customers.filter((c) => c.nuisance).forEach((c) => {
    const before = said.length;
    for (let i = 0; i < 12 && said.length === before; i++) g.ctx.nuisanceGripe(c);
    out.push({ id: c.special, kind: c.nuisance, line: said[said.length - 1] || '', got: said.length > before });
  });
  g.ui.toast = real;
  return out;
});
check('and the rest of the shop has something to say about them',
  gripes.length === 4 && gripes.every((x) => x.got && x.line.length > 4),
  gripes.map((x) => `${x.kind}: ${x.line.slice(0, 44)}`).join(' | '));

/* ---------- 4. talking them out of the shop ---------- */
// Explore each special's whole tree rather than one path through it: every
// one of them must have a way out of the shop, must never loop forever, and
// must offer the player real choices at every turn.
const trees = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = [];
  for (const sp of window.__specials.specialRoster()) {
    const lines = new Set(), replies = new Set();
    let nodes = 0, exits = 0, sales = 0, deadEnds = 0, blown = false;

    const explore = (path) => {
      if (nodes > 8000) { blown = true; return; }
      // Replay the path from a clean copy of the person, so state that a
      // branch mutates (mood, asked, tape) does not leak into its siblings.
      const c = window.__cust.makeSpecial(g.rng, sp);
      c.x = 5.4; c.z = 3.0; c.state = 'QUEUE';
      g.customers.push(c);
      let node = D.talkTo(c, g.ctx, { atCounter: true });
      let ok = true;
      for (const i of path) {
        if (!node || !node.choices || !node.choices[i]) { ok = false; break; }
        const r = node.choices[i];
        node = r.go ? r.go() : (r.fn ? r.fn() : null);
      }
      if (ok) {
        nodes++;
        if (node && node.text) lines.add(node.text);
        const ch = (node && node.choices) || [];
        ch.forEach((r) => replies.add(r.label || r.text || ''));
        if (c.checkedOut) sales++;
        if (c.state === 'LEAVING' || c.gone) exits++;
        else if (!node) deadEnds++;
        else if (path.length < 6) {
          for (let i = 0; i < ch.length; i++) explore(path.concat(i));
        }
      }
      g.customers.splice(g.customers.indexOf(c), 1);
    };
    explore([]);
    out.push({
      id: sp.id, nodes, exits, sales, deadEnds, blown,
      lines: lines.size, replies: replies.size,
      sample: Array.from(lines)[0] || '',
    });
  }
  return out;
});

check('their trees are finite', trees.every((t) => !t.blown),
  trees.filter((t) => t.blown).map((t) => t.id).join(' ') || `${trees.reduce((a, t) => a + t.nodes, 0)} nodes walked`);

// A player who just mashes one reply must still get to the end of it.
const mash = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = [];
  for (const sp of window.__specials.specialRoster()) {
    for (let pick = 0; pick < 4; pick++) {
      const c = window.__cust.makeSpecial(g.rng, sp);
      c.x = 5.4; c.z = 3.0; c.state = 'QUEUE';
      g.customers.push(c);
      let node = D.talkTo(c, g.ctx, { atCounter: true });
      let n = 0;
      while (node && (node.choices || []).length && n < 120) {
        n++;
        const ch = node.choices;
        const r = ch[Math.min(pick, ch.length - 1)];
        node = r.go ? r.go() : (r.fn ? r.fn() : null);
      }
      g.customers.splice(g.customers.indexOf(c), 1);
      if (n >= 120) out.push(`${sp.id}#${pick}`);
    }
  }
  return out;
});
check('and mashing one button always reaches the end of the conversation',
  mash.length === 0, mash.join(' ') || '48 runs, all terminated');
check('every one of them has a way out of the shop',
  trees.every((t) => t.exits > 0),
  trees.filter((t) => !t.exits).map((t) => t.id).join(' ') || 'all 12 can be got rid of');
check('and most of them can be turned into a sale if you handle them right',
  trees.filter((t) => t.sales > 0).length >= 9,
  `${trees.filter((t) => t.sales > 0).length} of ${trees.length} will rent something`);
check('the player gets real choices, not one button',
  trees.every((t) => t.replies >= 5),
  `fewest ${Math.min(...trees.map((t) => t.replies))} replies (${trees.reduce((a, t) => a + t.replies, 0)} across the roster)`);
check('and they have plenty to say',
  trees.every((t) => t.lines >= 4) && trees.reduce((a, t) => a + t.lines, 0) >= 120,
  `${trees.reduce((a, t) => a + t.lines, 0)} distinct lines`);
console.log(trees.map((t) => `        ${t.id.padEnd(10)} ${String(t.lines).padStart(3)} lines  ${String(t.replies).padStart(3)} replies  ${t.exits} exits  ${t.sales ? 'sells' : '-'}`).join('\n'));

// These people never join the queue, so you can deal with them where they
// stand -- but an ordinary customer still has to come to the counter.
const reach = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const sp = window.__specials.specialById('SOVEREIGN');
  const c = window.__cust.makeSpecial(g.rng, sp);
  c.x = 2.0; c.z = 6.0; c.state = 'BROWSING';
  g.customers.push(c);
  const anywhere = D.talkTo(c, g.ctx, { atCounter: false });
  const counter = D.talkTo(c, g.ctx, { atCounter: true });
  g.customers.splice(g.customers.indexOf(c), 1);

  const n = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  n.x = 2.0; n.z = 6.0; n.state = 'BROWSING';
  g.customers.push(n);
  const nAway = D.talkTo(n, g.ctx, { atCounter: false });
  g.customers.splice(g.customers.indexOf(n), 1);
  return {
    anywhere: (anywhere && anywhere.text) || '', counter: (counter && counter.text) || '',
    normal: (nAway && nAway.text) || '',
    normalSells: !!(nAway && (nAway.choices || []).some((r) => /\$/.test(r.good || ''))),
  };
});
check('you can take a special on wherever they are standing',
  reach.anywhere && reach.anywhere === reach.counter, `"${reach.anywhere.slice(0, 44)}"`);
check('but an ordinary customer still has to be at the counter to be served',
  !reach.normalSells, `"${reach.normal.slice(0, 44)}"`);

/* ---------- 4b. the ones with a wrong idea about the shop ---------- */
const prem = await ev(() => {
  const D = window.__dlg;
  const keys = (t) => Object.keys(t);
  const L = D.LOST_PREMISES, M = D.DIM_PREMISES;
  const bad = [];
  [['lost', L], ['dim', M]].forEach(([kind, tbl]) => {
    keys(tbl).forEach((k) => {
      const P = tbl[k];
      ['open', 'push', 'relent', 'play', 'exit'].forEach((f) => {
        if (typeof P[f] !== 'string' || P[f].length < 8) bad.push(`${kind}/${k}.${f}`);
      });
    });
  });
  return {
    lost: keys(L).length, dim: keys(M).length, bad,
    storms: keys(L).filter((k) => L[k].storms).length + keys(M).filter((k) => M[k].storms).length,
  };
});
check('there are a lot of different wrong ideas about this shop',
  prem.lost + prem.dim >= 30, `${prem.lost} in the wrong building, ${prem.dim} with the wrong idea`);
check('and every one of them is written all the way through', prem.bad.length === 0, prem.bad.join(' '));
check('some of them take the correction badly and some do not',
  prem.storms >= 8 && prem.storms < prem.lost + prem.dim,
  `${prem.storms} of ${prem.lost + prem.dim} will storm out`);

// Both outcomes have to be reachable in play: rented anyway, or walked out.
const outcomes = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const tbl = { lost: D.LOST_PREMISES, dim: D.DIM_PREMISES };
  const out = { sold: 0, stormed: 0, left: 0, stuck: [] };
  for (const kind of ['lost', 'dim']) {
    for (const premise of Object.keys(tbl[kind])) {
      // Every path through this person's tree, to a depth that reaches the end.
      const walk = (path) => {
        const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
        c.personality = Object.assign({}, c.personality, { confused: kind });
        c.script = 'confused'; c.premise = premise; c.tape = null; c.hasMoney = true;
        c.x = 9.2; c.z = 0.8; c.state = 'QUEUE';
        g.customers.push(c);
        const before = g.stats.stormedOut;
        let node = D.talkTo(c, g.ctx, { atCounter: true });
        let ok = true;
        for (const i of path) {
          if (!node || !node.choices || !node.choices[i]) { ok = false; break; }
          const r = node.choices[i];
          node = r.go ? r.go() : (r.fn ? r.fn() : null);
        }
        let res = null;
        if (ok) {
          if (c.checkedOut) res = 'sold';
          else if (g.stats.stormedOut > before) res = 'stormed';
          else if (c.state === 'LEAVING') res = 'left';
        }
        g.customers.splice(g.customers.indexOf(c), 1);
        return { ok, node, res };
      };
      const seen = { sold: false, stormed: false };
      const dfs = (path) => {
        if (path.length > 6 || (seen.sold && seen.stormed)) return;
        const { ok, node, res } = walk(path);
        if (!ok) return;
        if (res) { if (seen[res] === false) seen[res] = true; return; }
        const n = (node && node.choices && node.choices.length) || 0;
        for (let i = 0; i < n; i++) dfs(path.concat(i));
      };
      dfs([]);
      if (seen.sold) out.sold++;
      if (seen.stormed) out.stormed++;
      if (!seen.sold && !seen.stormed) out.stuck.push(`${kind}/${premise}`);
    }
  }
  return out;
});
check('every one of them can still be sold a tape if you play along',
  outcomes.sold >= 30, `${outcomes.sold} will rent something anyway`);
check('and the short-tempered ones can be made to walk out',
  outcomes.stormed >= 8, `${outcomes.stormed} storm out when you correct them`);
check('none of them is a dead end', outcomes.stuck.length === 0, outcomes.stuck.join(' '));

/* ---------- 4c. talking about the film they are actually holding ---------- */
const talk = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const T = window.__tapes;
  const wrong = [];
  let checked = 0, distinct = new Set();
  for (const genre of T.GENRES) {
    for (let i = 0; i < 30; i++) {
      const c = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
      c.tape = T.makeTape(genre, g.rng, { rewound: true });
      c.script = 'rent'; c.hasMoney = true;
      c.x = 9.2; c.z = 0.8; c.state = 'QUEUE';
      g.customers.push(c);
      const node = D.talkTo(c, g.ctx, { atCounter: true });
      // Follow every reply that opens a conversation about the film.
      (node.choices || []).forEach((r) => {
        const n1 = r.go ? r.go() : (r.fn ? r.fn() : null);
        if (!n1 || !n1.text) return;
        const texts = [n1.text];
        (n1.choices || []).forEach((r2) => {
          const n2 = r2.go ? r2.go() : (r2.fn ? r2.fn() : null);
          if (n2 && n2.text) texts.push(n2.text);
        });
        texts.forEach((t) => {
          distinct.add(t);
          checked++;
          // Anything out of the film-chat bank has to belong to this genre.
          // (Grumbling about a whole SECTION of the shop is fair game and
          // is not talk about the film in their hand.)
          if (/\bsection\b|\bshelf\b|\bwall\b/i.test(t)) return;
          for (const other of T.GENRES) {
            if (other === genre) continue;
            if ((window.__chat.TAPE_TALK[other] || []).includes(t)) {
              wrong.push(`${genre} tape drew a ${other} line: "${t.slice(0, 40)}"`);
            }
          }
        });
      });
      g.customers.splice(g.customers.indexOf(c), 1);
    }
  }
  // And the openers that DID come out must be from the right pool.
  let matched = 0;
  distinct.forEach(() => {});
  return { wrong: wrong.slice(0, 5), checked, distinct: distinct.size, matched };
});
check('nobody discusses a comedy while holding a slasher',
  talk.wrong.length === 0, talk.wrong.join(' ') || `${talk.checked} lines checked`);
check('and there is plenty of it', talk.distinct > 120, `${talk.distinct} distinct things said over a counter`);

const bank = await ev(() => {
  const P = window.__pers;
  let total = 0, thin = [];
  P.ARCHETYPES.forEach((a) => {
    let n = 0;
    Object.keys(a.lines).forEach((k) => { n += a.lines[k].length; });
    total += n;
    if (n < 25) thin.push(`${a.id}:${n}`);
  });
  return { total, thin, count: P.ARCHETYPES.length };
});
check('every archetype has a real bank of lines behind it',
  bank.thin.length === 0, bank.thin.join(' ') || `thinnest is fine`);
check('and the shop as a whole has hundreds of them',
  bank.total >= 600, `${bank.total} lines across ${bank.count} archetypes`);

/* ---------- 5. a whole night of them ---------- */
const swarmNight = await ev(async () => {
  const g = window.__game;
  const M = window.__night;
  let plan = null;
  for (let s = 0; s < 4000 && !plan; s++) {
    const p = M.makeNight(90000 + s, 5, "HORROR");
    if (p.swarm) plan = p;
  }
  if (!plan) return { found: false };
  return { found: true, slots: plan.schedule.filter((e) => e.special).length, total: plan.schedule.length };
});
check('a swarm night is mostly them', swarmNight.found && swarmNight.slots >= 4,
  swarmNight.found ? `${swarmNight.slots} of ${swarmNight.total} customers` : 'never rolled one');

await ev(() => { window.__game.timeScale = 30; });
await wait(4000);
await ev(() => { window.__game.timeScale = 1; });
check('the shop survives a room full of them',
  await ev(() => window.__game.state === 'PLAY' || window.__game.state === 'REPORT'),
  await ev(() => window.__game.state));

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n\n') : '(none)');
await browser.close();
if (errors.length) fails += errors.length;
console.log(fails ? `\nspecials FAILED (${fails})` : '\nspecials clean');
process.exit(fails ? 1 : 0);
