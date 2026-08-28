/* The deputy: what he knows, why he knows more of it every night, and the
   night he comes by to say it is finished. */
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
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
await ev(() => { window.__game.sound.muted = true; });

/* ---------- 1. the description grows ---------- */
const growth = await ev(() => {
  const M = window.__night;
  const rows = [];
  for (let n = M.DEPUTY_FIRST_NIGHT; n <= M.DEPUTY_FIRST_NIGHT + 11; n++) {
    const x = M.makeNight(9001, n, 'HORROR');
    rows.push({ n, keys: x.bulletin.keys.length, extra: x.bulletin.extra.length });
  }
  return rows;
});
const keys = growth.map((r) => r.keys);
check('the bulletin starts short', keys[0] <= 3, `${keys[0]} traits on the first deputy night`);
check('and never gets shorter from one night to the next',
  keys.every((k, i) => i === 0 || k >= keys[i - 1]), keys.join(' -> '));
check('and ends up a proper list to check against',
  keys[keys.length - 1] >= 9, `${keys[keys.length - 1]} traits by night ${growth[growth.length - 1].n}`);
check('what he will give up if you press him grows too',
  growth[growth.length - 1].extra > growth[0].extra,
  `${growth[0].extra} -> ${growth[growth.length - 1].extra}`);

/* ---------- 2. and he can account for the difference ---------- */
const banks = await ev(() => {
  const B = window.__brief;
  const counts = {};
  for (const k of ['MORE_DETAIL', 'PRIOR_ARREST', 'DIFFERENT_MAN', 'HOW_MANY',
    'WHY_MORE_HELPS', 'CERTAIN_YES', 'CERTAIN_NO', 'GREETINGS', 'ALL_CLEAR', 'ALL_CLEAR_WHY']) {
    counts[k] = (B[k] || []).length;
  }
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
});
check('there are dozens of ways for him to explain himself',
  banks.total >= 100 && banks.MORE_DETAIL >= 30 && banks.PRIOR_ARREST >= 12,
  `${banks.total} lines (${banks.MORE_DETAIL} reasons he knows more, ${banks.PRIOR_ARREST} arrests)`);

const spread = await ev(() => {
  const M = window.__night;
  const seen = { more: new Set(), prior: new Set(), diff: new Set(), greet: new Set() };
  let repeats = 0, prev = null;
  for (let n = 3; n <= 40; n++) {
    const c = M.makeNight(9001, n, 'HORROR').caseFile;
    seen.more.add(c.moreDetail); seen.prior.add(c.priorArrest);
    seen.diff.add(c.differentMan); seen.greet.add(c.greeting);
    if (prev && c.moreDetail === prev) repeats++;
    prev = c.moreDetail;
  }
  return { more: seen.more.size, prior: seen.prior.size, diff: seen.diff.size,
    greet: seen.greet.size, repeats };
});
check('and he does not repeat himself two nights running', spread.repeats === 0);
check('nor use the same handful over and over',
  spread.more >= 20 && spread.prior >= 10 && spread.diff >= 9,
  `over 38 nights: ${spread.more} explanations, ${spread.prior} arrests, ${spread.diff} reasons it is somebody else`);

const stable = await ev(() => {
  const M = window.__night;
  const a = M.makeNight(9001, 7, 'HORROR').caseFile;
  const b = M.makeNight(4242, 7, 'HORROR').caseFile;
  return a.moreDetail === b.moreDetail && a.priorArrest === b.priorArrest;
});
check('a given night always tells the same story', stable);

/* ---------- 3. the briefing tree itself ---------- */
const tree = await ev(() => {
  const g = window.__game;
  const D = window.__dlg;
  const M = window.__night;
  const out = [];
  for (const n of [3, 5, 8, 12]) {
    const night = M.makeNight(9001, n, 'HORROR');
    const officer = { name: 'Deputy Test', app: night.officerApp, personality: window.__pers.OFFICER, observed: new Set() };
    let learned = false, added = 0;
    const ctx = Object.assign({}, g.ctx, {
      rng: window.__mathx.makeRng(n * 7919),
      learnBulletin: () => { learned = true; },
      addBulletinDetail: () => { added++; },
      finishIntro: () => { },
      notesKey: () => 'TAB',
    });
    const lines = new Set(), replies = new Set();
    let nodes = 0, blown = false;
    const explore = (path) => {
      if (nodes > 4000 || blown) { blown = nodes > 4000; return; }
      let node = D.buildOfficerIntro(officer, night.bulletin, night.caseFile, ctx);
      let ok = true;
      for (const i of path) {
        if (!node || !node.choices || !node.choices[i]) { ok = false; break; }
        const r = node.choices[i];
        node = r.go ? r.go() : (r.fn ? r.fn() : null);
      }
      if (!ok) return;
      nodes++;
      if (node && node.text) lines.add(node.text);
      const ch = (node && node.choices) || [];
      ch.forEach((r) => replies.add(r.label || ''));
      if (path.length < 6) for (let i = 0; i < ch.length; i++) explore(path.concat(i));
    };
    explore([]);
    // and one straight walk, to be sure it hands over the bulletin
    let node = D.buildOfficerIntro(officer, night.bulletin, night.caseFile, ctx);
    let steps = 0;
    while (node && (node.choices || []).length && steps < 40) {
      steps++;
      const r = node.choices[0];
      node = r.go ? r.go() : (r.fn ? r.fn() : null);
    }
    out.push({ n, lines: lines.size, replies: replies.size, learned, added, blown, steps });
  }
  return out;
});
check('the briefing terminates on every night tested', tree.every((t) => !t.blown && t.steps < 40));
check('and always ends up reading the bulletin out', tree.every((t) => t.learned));
/* The first deputy night has no yesterday to account for, so it is the
   short one on purpose; every night after it has the arrest and the growing
   list to talk about as well. */
check('there is plenty of it, and more of it once there is a yesterday',
  tree.every((t) => t.lines >= 8) && tree[1].lines > tree[0].lines * 1.5
  && tree.slice(1).every((t) => t.replies >= 25),
  tree.map((t) => `night ${t.n}: ${t.lines} lines / ${t.replies} replies`).join(', '));

/* ---------- 4. the night he says it is over ---------- */
const standDown = await ev(() => {
  const M = window.__night;
  const night = M.makeNight(9001, 9, 'HORROR', { standDown: true });
  const g = window.__game;
  const D = window.__dlg;
  const officer = { name: 'Deputy Test', app: night.officerApp, personality: window.__pers.OFFICER, observed: new Set() };
  let learned = false, finished = false;
  const ctx = Object.assign({}, g.ctx, {
    rng: window.__mathx.makeRng(31337),
    learnBulletin: () => { learned = true; },
    addBulletinDetail: () => { },
    finishIntro: () => { finished = true; },
    notesKey: () => 'TAB',
  });
  const texts = [];
  let node = D.buildOfficerIntro(officer, night.bulletin, night.caseFile, ctx);
  let steps = 0;
  while (node && (node.choices || []).length && steps < 20) {
    steps++;
    texts.push(node.text);
    const r = node.choices[0];
    node = r.go ? r.go() : (r.fn ? r.fn() : null);
  }
  return { deputy: night.deputy, killer: night.plan.appears, learned, finished, steps,
    first: texts[0] || '', all: texts.join(' ') };
});
check('a stand-down night still has a deputy in it', standDown.deputy === true);
check('but nobody working it', standDown.killer === false);
check('he tells you it is finished rather than reading a description',
  !standDown.learned && standDown.finished, `learned a bulletin: ${standDown.learned}`);
check('and says so in as many words', /over|done|got him|nothing|accounted/i.test(standDown.all),
  `"${standDown.first.split('\n').pop().slice(0, 56)}"`);

/* ---------- 5. an arrest buys quiet nights ---------- */
const run = await ev(() => {
  const g = window.__game;
  g.run = { calmUntil: 0, standDownNight: 0, arrests: 0 };
  g.nightNo = 6;
  g.rng = window.__mathx.makeRng(11);
  g.mode = 'HORROR';
  // stand in for the arrest
  const R = g.run;
  R.arrests++; R.standDownNight = 7; R.calmUntil = 6 + 3 + g.rng.int(3);
  const M = window.__night;
  const rows = [];
  for (let n = 7; n <= 13; n++) {
    const night = M.makeNight(9001, n, 'HORROR', {
      calm: n <= R.calmUntil, standDown: n === R.standDownNight,
    });
    rows.push({ n, calm: night.calm, standDown: night.standDown,
      deputy: night.deputy, killer: night.plan.appears });
  }
  return { calmUntil: R.calmUntil, rows };
});
check('the night after an arrest is the stand-down visit',
  run.rows[0].standDown && run.rows[0].deputy && !run.rows[0].killer);
check('and it buys a few nights with nobody working them',
  run.rows.filter((r) => r.calm).length >= 3,
  run.rows.map((r) => `${r.n}:${r.calm ? 'calm' : 'live'}`).join(' '));
check('the deputy does not come back on the quiet nights after that',
  run.rows.filter((r) => r.calm && !r.standDown).every((r) => !r.deputy),
  run.rows.map((r) => `${r.n}:${r.deputy ? 'deputy' : '-'}`).join(' '));
check('and he is back once the town is live again',
  run.rows.filter((r) => !r.calm).every((r) => r.deputy),
  run.rows.filter((r) => !r.calm).map((r) => r.n).join(','));

/* ---------- he says she when the person he is after is a woman ---------- */
/* The bulletin already used the right pronoun. Everything else he said --
   how the description got longer, why the man in custody does not help --
   was written masculine and stayed masculine on a night whose suspect was
   a woman. The lines carry tokens now, expanded per night. */
const pronouns = await ev(() => {
  const M = window.__night;
  const B = window.__brief;
  const out = { m: 0, f: 0, leftovers: 0, wrong: [], sample: {} };
  for (let n = 3; n < 16; n++) {
    for (let s = 0; s < 60; s++) {
      const x = M.makeNight(31000 + s * 7, n, 'HORROR');
      const fem = x.suspect.gender.id === 'f';
      const said = [x.caseFile.moreDetail, x.caseFile.differentMan, x.bulletin.description].join(' ');
      if (/\{[A-Za-z]+\}/.test(said)) out.leftovers++;
      if (fem) { out.f++; if (!out.sample.f) out.sample.f = x.caseFile.moreDetail; }
      else { out.m++; if (!out.sample.m) out.sample.m = x.caseFile.moreDetail; }
    }
  }
  // and the expander itself, both ways, over every tokenised line
  const male = { gender: { id: 'm' } }, fem = { gender: { id: 'f' } };
  let pairs = 0, differ = 0;
  for (const pool of [B.MORE_DETAIL, B.DIFFERENT_MAN]) {
    for (const t of pool) {
      if (!/\{/.test(t)) continue;
      pairs++;
      const a = B.voice(t, male), b = B.voice(t, fem);
      if (a !== b) differ++;
      if (/\{/.test(a) || /\{/.test(b)) out.wrong.push(t.slice(0, 40));
    }
  }
  out.pairs = pairs; out.differ = differ;
  return out;
});
check('nights come in both flavours', pronouns.m > 20 && pronouns.f > 20,
  `${pronouns.m} male, ${pronouns.f} female`);
check('and no line ever reaches the player with a token still in it',
  pronouns.leftovers === 0 && pronouns.wrong.length === 0,
  pronouns.wrong.join(' | ') || `${pronouns.leftovers} leftovers`);
check('every tokenised line reads differently for a woman',
  pronouns.pairs > 12 && pronouns.differ === pronouns.pairs,
  `${pronouns.differ} of ${pronouns.pairs} change`);
console.log('      M: ' + String(pronouns.sample.m).slice(0, 88));
console.log('      F: ' + String(pronouns.sample.f).slice(0, 88));

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
fails += errors.length;
console.log(fails ? `\ndeputy FAILED (${fails})` : '\ndeputy clean');
process.exit(fails ? 1 : 0);
