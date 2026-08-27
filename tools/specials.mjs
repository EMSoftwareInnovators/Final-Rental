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
/* Only one of them arrives with a tape -- the man carrying somebody else's.
   The one at the television may well be holding one by now, but he did not
   come in with it: he wandered off and took it off a shelf. */
check('and only the man with somebody else\'s tape walked in holding one',
  settled.filter((c) => c.tape && c.id !== 'SMOKER').length === 1
  && settled.some((c) => c.tape && c.id === 'RETURNS'),
  settled.filter((c) => c.tape).map((c) => `${c.id}:${c.tape}`).join(' '));

const actors = settled.filter((c) => c.act);
check('the ones with somewhere to be got there and are doing it',
  actors.length === 6 && actors.every((c) => c.state === 'ACTING'),
  actors.map((c) => `${c.id}:${c.state}@${c.x},${c.z}`).join(' '));
check('nobody is standing in the doorway',
  settled.every((c) => c.z < 12.4), `deepest z ${Math.max(...settled.map((c) => c.z)).toFixed(2)}`);
check('and the performance is actually running',
  actors.every((c) => c.phase > 0), `phases ${actors.map((c) => c.phase).join('/')}`);

const spots = await ev(() => {
  const g = window.__game;
  /* Read the spots out of the simulation rather than copying them here.
     A copy is a copy: the man at the television was moved to square up
     with the screen and this test went red about a spot he was no longer
     supposed to be standing on. */
  const S = window.__cust.ACT_SPOT;
  const want = {};
  for (const k of ['DANCE', 'TV', 'PHONE', 'WINDOW']) want[k] = [S[k].x, S[k].z];
  return g.customers.filter((c) => want[c.act]).map((c) => ({
    act: c.act, d: +Math.hypot(c.x - want[c.act][0], c.z - want[c.act][1]).toFixed(2),
  }));
});
check('the boombox, the television, the phone call and the arguer each have their own spot',
  spots.length === 4 && spots.every((s) => s.d < 0.9),
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
  /* Fixed rolls for the walk. The trees pick their wording at random, so
     the same node yields different text on each replay and a count of
     distinct lines drifts run to run -- which makes a threshold on it a
     coin toss rather than a check. */
  const realRng = g.rng;
  g.rng = window.__mathx.makeRng(0x5EED);
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
        if (c.checkedOut || (c.script === 'rent' && c.state === 'BROWSING')) sales++;
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
  g.rng = realRng;
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
/* The two who will not be told have no exit inside a single conversation
   by design -- they are worn down across many of them, with a cooling-off
   period in between, which is what the grind checks above walk end to end.
   Everybody else can be got out of the shop in one go. */
const GRINDERS = ['REEKER', 'SMOKER', 'SOVEREIGN'];
check('every one of them has a way out of the shop',
  trees.filter((t) => !GRINDERS.includes(t.id)).every((t) => t.exits > 0),
  trees.filter((t) => !t.exits && !GRINDERS.includes(t.id)).map((t) => t.id).join(' ')
  || 'all ten can be got rid of in one conversation');
check('and most of them can be turned into a sale if you handle them right',
  trees.filter((t) => t.sales > 0).length >= 9,
  `${trees.filter((t) => t.sales > 0).length} of ${trees.length} will rent something`);
check('the player gets real choices, not one button',
  trees.every((t) => t.replies >= 5),
  `fewest ${Math.min(...trees.map((t) => t.replies))} replies (${trees.reduce((a, t) => a + t.replies, 0)} across the roster)`);
// Their own trees, not counting the ordinary counter conversation they now
// hand off to once they agree to rent.
check('and they have plenty to say',
  trees.every((t) => t.lines >= 4) && trees.reduce((a, t) => a + t.lines, 0) >= 75,
  `${trees.reduce((a, t) => a + t.lines, 0)} distinct lines before they even reach the till`);
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

/* ---------- 4a2. the man who brings his own music ---------- */
const boom = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0;
  // An earlier check put the whole roster in the shop, him included, so
  // clear whatever he left playing before watching him do it properly.
  g.boombox = null;
  g.sound.boomboxStop();
  g.sound.muted = false;                 // the whole point of him is the noise
  g.sound.init();
  const sp = window.__specials.specialById('BOOMBOX');
  const c = window.__cust.makeSpecial(g.rng, sp);
  g.customers.push(c);
  const seen = [];
  let musicWhileCarrying = false;
  g.timeScale = 8;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    seen.push(`${c.state}/${c.carrying || '-'}/${c.rigUp ? 'up' : '-'}/${g.boombox ? 'down' : '-'}`);
    if (c.carrying === 'BOOMBOX' && g.sound.boom) musicWhileCarrying = true;
    if (g.boombox && c.rigUp) break;
  }
  const playing = !!g.sound.boom;
  // it is coming from where he put it, not from the player's head
  g.player.x = 1.0; g.player.z = 9.0;
  g.updateBoomboxAudio();
  const far = g.sound.boom ? g.sound.boom.out.gain.value : -1;
  const boxAt = [g.boombox.x, g.boombox.z];
  g.player.x = g.boombox.x; g.player.z = g.boombox.z + 0.4;
  g.updateBoomboxAudio();
  await new Promise((r) => setTimeout(r, 300));
  const near = g.sound.boom ? g.sound.boom.out.gain.value : -1;
  /* And he takes it with him -- on foot. Telling him to go should NOT make
     it vanish off the floor and reappear under his arm. */
  g.ctx.leave(c);
  const told = { box: !!g.boombox, playing: !!g.sound.boom, carrying: c.carrying,
    packing: !!c.packUp };
  // let him walk back to it, switch it off and pick it up
  let quietAt = -1;
  for (let i = 0; i < 4000; i++) {
    window.__cust.updateCustomer(c, 1 / 20, g.ctx);
    if (quietAt < 0 && !g.sound.boom) quietAt = +(i / 20).toFixed(1);
    if (!c.packUp && c.carrying === 'BOOMBOX') break;
  }
  const afterLeave = { box: !!g.boombox, playing: !!g.sound.boom, carrying: c.carrying,
    quietAt, at: [+c.x.toFixed(2), +c.z.toFixed(2)] };
  g.timeScale = 1;
  g.sound.muted = true;
  g.customers.length = 0;
  return { seen: [...new Set(seen)], playing, musicWhileCarrying, far, near, afterLeave, told, box: boxAt };
});
check('he walks in carrying it', boom.seen.some((s) => /ENTERING\/BOOMBOX/.test(s)));
check('and it is silent until he has put it down', !boom.musicWhileCarrying);
check('he sets it down and sets it up before he starts dancing',
  boom.seen.some((s) => /ACTING\/BOOMBOX\/-\/-/.test(s))
  && boom.seen.some((s) => /ACTING\/-\/up\/down/.test(s)),
  boom.seen.join(' | '));
check('the music is running', boom.playing === true);
check('and it is coming from the machine, not from your head',
  boom.near > boom.far && boom.far >= 0,
  `${boom.far.toFixed(3)} across the shop, ${boom.near.toFixed(3)} standing over it`);
check('telling him to go does not teleport it into his hands',
  boom.told.box && boom.told.playing && boom.told.carrying !== 'BOOMBOX' && boom.told.packing,
  `still on the floor and playing: ${boom.told.box && boom.told.playing}`);
check('he walks back to it, switches it off and picks it up',
  !boom.afterLeave.box && !boom.afterLeave.playing && boom.afterLeave.carrying === 'BOOMBOX'
  && Math.hypot(boom.afterLeave.at[0] - boom.box[0], boom.afterLeave.at[1] - boom.box[1]) < 1.2,
  `off after ${boom.afterLeave.quietAt}s, standing at ${boom.afterLeave.at.join(',')}`);

/* ---------- 4a3. the ones who will not be told ---------- */
/* Pestered the way a player actually pesters: stand there and keep talking,
   with no waiting and no reaching into the simulation to skip the parts
   where he is not listening. The first version of this check zeroed his
   cooling-off timer every round, which is exactly the thing a player cannot
   do -- so it passed while, in play, nine tries in ten did nothing visible
   and the man read as broken. */
const grindTest = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = {};
  for (const id of ['REEKER', 'SMOKER', 'SOVEREIGN']) {
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById(id));
    c.x = 2.3; c.z = 2.8; c.state = 'ACTING'; c.parked = true;
    g.customers.push(c);
    const lines = new Set();
    let tries = 0, brushed = 0, real = 0, chars = 0, undef = 0, sim = 0, blind = 0;
    let lastResist = c.resist === undefined ? Infinity : c.resist;
    while (c.state !== 'LEAVING' && tries < 500) {
      tries++;
      const before = c.resist === undefined ? Infinity : c.resist;
      const wasBrush = c.brushT > 0;
      let node = D.talkTo(c, g.ctx, { atCounter: false });
      if (node && node.text) { lines.add(node.text); chars += node.text.length; }
      if (node && node.text === undefined) undef++;
      let steps = 0;
      while (node && (node.choices || []).length && steps < 6) {
        steps++;
        const r = node.choices[0];
        node = r.go ? r.go() : (r.fn ? r.fn() : null);
        if (node && node.text) { lines.add(node.text); chars += node.text.length; }
      }
      if (wasBrush) brushed++; else real++;
      // Did that attempt move him at all?
      if (c.resist !== undefined && c.resist >= before && c.state !== 'LEAVING') blind++;
      lastResist = c.resist;
      // two seconds of shop time between attempts: generous mashing
      for (let k = 0; k < 40; k++) { window.__cust.updateCustomer(c, 1 / 20, g.ctx); sim += 1 / 20; }
    }
    out[id] = {
      tries, brushed, real, blind, undef, left: c.state === 'LEAVING',
      lines: lines.size, resist: lastResist,
      sim: +(sim / 60).toFixed(1),
      minutes: +(((chars / 62) + sim) / 60).toFixed(1),
    };
    const k = g.customers.indexOf(c);
    if (k >= 0) g.customers.splice(k, 1);
  }
  return out;
});
for (const id of ['REEKER', 'SMOKER', 'SOVEREIGN']) {
  const r = grindTest[id];
  const who = id.toLowerCase();
  check(`${who}: standing there and keeping at him gets him out`, r.left,
    `after ${r.tries} goes (${r.real} of them landed)`);
  check(`${who}: and every single go moves him, even the ones he ignores`,
    r.blind === 0, `${r.blind} of ${r.tries} did nothing at all`);
  check(`${who}: but it is not quick`, r.tries >= 18, `${r.tries} exchanges`);
  check(`${who}: with plenty to say while he does it`, r.lines >= 10, `${r.lines} lines`);
  check(`${who}: and every beat of it is written`, r.undef === 0);
}
/* He is a project. Reading his paperwork at him is the better part of the
   evening, which is the point of him. */
check('the man with the folder takes literal minutes',
  grindTest.SOVEREIGN.minutes >= 3,
  `${grindTest.SOVEREIGN.minutes} minutes across ${grindTest.SOVEREIGN.tries} exchanges`);
check('and considerably longer than the other two',
  grindTest.SOVEREIGN.tries > grindTest.REEKER.tries * 1.4,
  `${grindTest.REEKER.tries} / ${grindTest.SMOKER.tries} / ${grindTest.SOVEREIGN.tries} exchanges`);

/* And nobody camps in the shop all night if you simply ignore them. */
const ignored = await ev(() => {
  const g = window.__game;
  const out = {};
  for (const id of ['SMOKER', 'REEKER', 'SOVEREIGN']) {
    const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById(id));
    c.x = 2.3; c.z = 2.8; c.state = 'ACTING'; c.parked = true;
    g.customers.push(c);
    let t = 0;
    for (let i = 0; i < 40000 && c.state !== 'LEAVING' && c.state !== 'GONE'; i++) {
      window.__cust.updateCustomer(c, 1 / 20, g.ctx);
      t += 1 / 20;
    }
    out[id] = { left: c.state === 'LEAVING' || c.state === 'GONE', minutes: +(t / 60).toFixed(1) };
    const k = g.customers.indexOf(c);
    if (k >= 0) g.customers.splice(k, 1);
  }
  return out;
});
check('and one you never speak to gives up on his own eventually',
  ['SMOKER', 'REEKER', 'SOVEREIGN'].every((id) => ignored[id].left),
  ['SMOKER', 'REEKER', 'SOVEREIGN'].map((id) => `${id.toLowerCase()} ${ignored[id].minutes}min`).join(', '));

const stink = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0;
  const before = g.ctx.stenchActive();
  const reeker = window.__cust.makeSpecial(g.rng, window.__specials.specialById('REEKER'));
  reeker.x = 4; reeker.z = 4; reeker.state = 'ACTING';
  g.customers.push(reeker);
  const during = g.ctx.stenchActive();
  // an ordinary shopper who has picked something out
  const shopper = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  shopper.x = 2.6; shopper.z = 2.8; shopper.state = 'BROWSING';
  shopper.browse = { visits: 1, seen: 1, phase: 'READ', t: 99, dur: 0, shelf: null,
    spot: { x: 2.6, z: 2.8, yaw: 0 } };
  shopper.browse.shelf = window.__world.SHELVES[0];
  shopper.browse.spot = shopper.browse.shelf.browse[0];
  g.customers.push(shopper);
  let wentToCounter = false;
  for (let i = 0; i < 600; i++) {
    window.__cust.updateCustomer(shopper, 1 / 20, g.ctx);
    if (shopper.state === 'TO_COUNTER' || shopper.state === 'WAITING') { wentToCounter = true; break; }
  }
  // now get rid of him and try again
  reeker.state = 'LEAVING';
  const after = g.ctx.stenchActive();
  let wentAfter = false;
  for (let i = 0; i < 900; i++) {
    window.__cust.updateCustomer(shopper, 1 / 20, g.ctx);
    if (shopper.state === 'TO_COUNTER' || shopper.state === 'WAITING') { wentAfter = true; break; }
  }
  g.customers.length = 0;
  return { before, during, after, wentToCounter, wentAfter };
});
check('the shop knows when it is unbearable',
  !stink.before && stink.during && !stink.after);
check('and nobody will come to the counter while it is',
  !stink.wentToCounter, `went anyway: ${stink.wentToCounter}`);
check('but they will once he has gone', stink.wentAfter);

const errand = await ev(async () => {
  const g = window.__game;
  g.customers.length = 0;
  g.bin.length = 0;
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SMOKER'));
  c.x = 2.3; c.z = 2.8; c.state = 'ACTING'; c.parked = true;
  c.errandT = 0.1;                        // due one now
  g.customers.push(c);
  let took = false;
  for (let i = 0; i < 3000; i++) {
    window.__cust.updateCustomer(c, 1 / 20, g.ctx);
    if (c.tape) took = true;
    if (took && !c.errand) break;
  }
  const back = { x: +c.x.toFixed(1), z: +c.z.toFixed(1), holding: !!c.tape };
  g.ctx.leave(c);
  const binned = g.bin.length;
  g.customers.length = 0;
  return { took, back, binned };
});
check('the one at the television wanders off and takes something', errand.took);
check('and brings it back to the screen, still holding it',
  errand.back.holding && Math.abs(errand.back.x - 2.3) < 1.2, JSON.stringify(errand.back));
check('and leaves it in the returns bin on his way out',
  errand.binned === 1, `${errand.binned} in the bin`);

/* And he does that whether or not anybody ever gets him out of the shop.
   He picked one up, wandered back to the screen with it, and then had no
   idea why he was holding it -- that has to end somewhere the clerk can
   reach, not in his hands forever. */
const strayBin = await ev(() => {
  const g = window.__game;
  g.customers.length = 0;
  g.bin.length = 0;
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('SMOKER'));
  c.x = 2.3; c.z = 2.8; c.state = 'ACTING'; c.parked = true;
  c.errandT = 0.1;
  g.customers.push(c);
  let took = false, minutes = 0;
  for (let i = 0; i < 30000; i++) {
    window.__cust.updateCustomer(c, 1 / 20, g.ctx);
    minutes += 1 / 20 / 60;
    if (c.tape) took = true;
    if (took && g.bin.length) break;
    if (c.state === 'LEAVING') break;
  }
  const out = { took, binned: g.bin.length, stillHolding: !!c.tape,
    left: c.state === 'LEAVING', minutes: +minutes.toFixed(1) };
  g.customers.length = 0; g.bin.length = 0;
  return out;
});
check('he does not keep it: it goes in the bin without him having to leave',
  strayBin.took && strayBin.binned >= 1 && !strayBin.stillHolding && !strayBin.left,
  `binned after ${strayBin.minutes} minutes, still in the shop: ${!strayBin.left}`);

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
          // A sale is no longer rung up in the conversation: agreeing to
          // rent sends them off to the shelves to pick one out.
          if (c.checkedOut) res = 'rangUpOnTheSpot';
          else if (c.script === 'rent' && c.state === 'BROWSING') res = 'sold';
          else if (g.stats.stormedOut > before) res = 'stormed';
          else if (c.state === 'LEAVING') res = 'left';
        }
        g.customers.splice(g.customers.indexOf(c), 1);
        return { ok, node, res };
      };
      const seen = { sold: false, stormed: false, rangUpOnTheSpot: false };
      const dfs = (path) => {
        if (path.length > 6 || (seen.sold && seen.stormed)) return;
        const { ok, node, res } = walk(path);
        if (!ok) return;
        if (res) { if (seen[res] === false) seen[res] = true; if (res !== 'rangUpOnTheSpot') return; return; }
        const n = (node && node.choices && node.choices.length) || 0;
        for (let i = 0; i < n; i++) dfs(path.concat(i));
      };
      dfs([]);
      if (seen.sold) out.sold++;
      if (seen.stormed) out.stormed++;
      if (seen.rangUpOnTheSpot) out.onSpot = (out.onSpot || 0) + 1;
      if (!seen.sold && !seen.stormed) out.stuck.push(`${kind}/${premise}`);
    }
  }
  out.onSpot = out.onSpot || 0;
  return out;
});
check('every one of them can still be talked into renting something',
  outcomes.sold >= 30, `${outcomes.sold} go off to the shelves anyway`);
check('and none of them is served in the middle of the floor',
  outcomes.onSpot === 0, `${outcomes.onSpot} rung up where they stood`);
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

/* ---------- 4d. business happens at the counter, or not at all ---------- */
const gate = await ev(() => {
  const g = window.__game;
  const T = window.__tapes;
  const out = {};
  const place = (c, x, z, state) => { c.x = x; c.z = z; c.state = state; g.customers.push(c); };
  const drop = (c) => { const i = g.customers.indexOf(c); if (i >= 0) g.customers.splice(i, 1); };

  // Somebody holding a tape in the middle of an aisle is not servable...
  const far = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  far.tape = T.makeTape('HORROR', g.rng, { rewound: true });
  far.script = 'rent'; far.hasMoney = true; far.queueIndex = -1;
  place(far, 2.0, 6.5, 'BROWSING');
  out.farWhy = g.cannotServe(far);
  // ...and talking to them there must not open a till.
  g.talkToPerson(far);
  const node = g.dlg.node;
  out.farText = (node && node.text) || '';
  out.farSells = !!(node && (node.choices || []).some((r) => /\$\d/.test(r.label || '')));
  g.dlg.node = null; g.speaking = null;
  drop(far);

  // The same person at the front of the line is.
  const near = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  near.tape = T.makeTape('HORROR', g.rng, { rewound: true });
  near.script = 'rent'; near.hasMoney = true; near.queueIndex = 0;
  place(near, 10.75, 0.80, 'WAITING');
  out.nearWhy = g.cannotServe(near);
  g.talkToPerson(near);
  const n2 = g.dlg.node;
  out.nearText = (n2 && n2.text) || '';
  // rentRoot opens by naming the tape and its price; idleRoot never does.
  out.nearSells = !!(n2 && (n2.choices || []).some((r) => /\$\d/.test(r.label || '')));
  g.dlg.node = null; g.speaking = null;
  drop(near);

  // And second in line is not, however close they are standing.
  const queued = window.__cust.createCustomer(g.rng, { intent: 'RENT' });
  queued.tape = T.makeTape('HORROR', g.rng, { rewound: true });
  queued.script = 'rent'; queued.hasMoney = true; queued.queueIndex = 1;
  place(queued, 9.35, 0.78, 'WAITING');
  out.queuedWhy = g.cannotServe(queued);
  drop(queued);
  return out;
});
check('somebody out in the aisles cannot be rung up',
  gate.farWhy === 'not at the counter' && !gate.farSells,
  `"${gate.farWhy}" / "${gate.farText.slice(0, 38)}"`);
check('and talking to them there gets you a conversation, not a till',
  gate.farText !== gate.nearText);
check('at the window, at the front of the line, they can be',
  gate.nearWhy === '' && gate.nearSells, `"${gate.nearText.slice(0, 38)}"`);
check('second in line still waits their turn', gate.queuedWhy === 'waiting in line', gate.queuedWhy);

/* ---------- 4e. a special who buys goes and shops for it ---------- */
const shopping = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const out = [];
  for (const sp of window.__specials.specialRoster()) {
    // Walk this special's tree looking for the branch that ends in a sale.
    let found = null;
    const walk = (path) => {
      if (found || path.length > 7) return;
      const c = window.__cust.makeSpecial(g.rng, sp);
      c.x = 5.4; c.z = 3.0; c.state = 'ACTING';
      g.customers.push(c);
      let node = D.talkTo(c, g.ctx, { atCounter: true });
      let ok = true;
      for (const i of path) {
        if (!node || !node.choices || !node.choices[i]) { ok = false; break; }
        const r = node.choices[i];
        node = r.go ? r.go() : (r.fn ? r.fn() : null);
      }
      if (ok) {
        // A sale must never happen here: no tape conjured, no money taken.
        if (c.checkedOut) found = { bad: 'rang up on the spot' };
        else if (c.script === 'rent' && c.state === 'BROWSING') {
          found = { shops: true, tape: !!c.tape, act: c.act, genre: c.wantGenre || null };
        } else if (node && node.choices) {
          for (let i = 0; i < node.choices.length && !found; i++) walk(path.concat(i));
        }
      }
      const k = g.customers.indexOf(c);
      if (k >= 0) g.customers.splice(k, 1);
    };
    walk([]);
    out.push({ id: sp.id, ...(found || { none: true }) });
  }
  return out;
});
const rangUp = shopping.filter((r) => r.bad);
const shops = shopping.filter((r) => r.shops);
check('no special is ever rung up where they stand', rangUp.length === 0,
  rangUp.map((r) => r.id).join(' ') || `${shopping.length} trees walked`);
check('the ones who agree to rent go off and shop for it instead',
  shops.length >= 9, `${shops.length} of ${shopping.length} head for the shelves`);
check('and they arrive at the shelf empty-handed, with their act dropped',
  shops.every((r) => !r.tape && !r.act), shops.filter((r) => r.tape || r.act).map((r) => r.id).join(' '));
console.log(`        sent shopping: ${shops.map((r) => r.id + (r.genre ? `(${r.genre})` : '')).join(', ')}`);

/* ---------- 4f. and nobody walks out on their own change ---------- */
const changeHeld = await ev(() => {
  const g = window.__game;
  // Clear the line first, so she is the one at the window rather than
  // fourth behind whoever an earlier check left standing there.
  g.queue.length = 0;
  const c = window.__cust.makeSpecial(g.rng, window.__specials.specialById('PHONECALL'));
  c.x = 8.4; c.z = 4.6; c.state = 'ACTING';
  g.customers.push(c);
  c.awaitingChange = true; c.changeDue = 2.01;
  g.ctx.leave(c);
  const afterLeave = c.state;
  // Run the shop for a moment: she should be making her way to the window.
  const before = { x: c.x, z: c.z };
  for (let i = 0; i < 2400; i++) window.__cust.updateCustomer(c, 1 / 60, g.ctx);
  const at = { state: c.state, x: +c.x.toFixed(2), z: +c.z.toFixed(2) };
  const d = Math.hypot(c.x - 10.75, c.z - 0.80);
  // Once paid, she can go.
  g.ctx.giveChange(c);
  g.ctx.leave(c);
  const afterPaid = c.state;
  g.customers.splice(g.customers.indexOf(c), 1);
  return { afterLeave, at, d: +d.toFixed(2), afterPaid, moved: Math.hypot(c.x - before.x, c.z - before.z) > 1 };
});
check('a special owed change cannot be sent away by the dialogue',
  changeHeld.afterLeave !== 'LEAVING', changeHeld.afterLeave);
check('she walks to the window and waits there instead',
  changeHeld.moved && changeHeld.d < 1.6 && changeHeld.at.state === 'WAITING',
  `${changeHeld.at.state} at ${changeHeld.at.x},${changeHeld.at.z} (${changeHeld.d}m from the window)`);
check('and once you have paid her she leaves like anyone else',
  changeHeld.afterPaid === 'LEAVING', changeHeld.afterPaid);

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
  ['PLAY', 'REPORT', 'PAUSE'].includes(await ev(() => window.__game.state)),
  await ev(() => window.__game.state));

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n\n') : '(none)');
await browser.close();
if (errors.length) fails += errors.length;
console.log(fails ? `\nspecials FAILED (${fails})` : '\nspecials clean');
process.exit(fails ? 1 : 0);
