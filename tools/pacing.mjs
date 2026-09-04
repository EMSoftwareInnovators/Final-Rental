/* Campaign pacing analysis.
 *
 * A lightweight, pure-node sampler (no browser -- makeNight runs headless) that
 * builds every Story night across many seeds the way game.js would, then
 * reports the pacing metrics that matter and asserts broad sanity ranges. The
 * point is to catch an ABSURD generated night -- a pile-up, a dead store, a
 * required regular that fails to appear, a cap that leaks -- not to pin
 * procedural generation to narrow numbers. Ranges here are deliberately loose.
 *
 * Run: node tools/pacing.mjs   (add --table to print the per-night table)
 */
import { makeNight, MODE } from '../src/game/night.js';
import { nightConfig, investigationPolicy, STORY_NIGHT_COUNT } from '../src/game/campaign.js';

const SEEDS = 120;
const SHOW_TABLE = process.argv.includes('--table');
let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/* Mirror game.js's opts construction for a no-arrest campaign (the baseline
   path): static config, plus the state-aware investigation overrides. A fresh
   campaign has no arrests and no cooldown, so calm/standDown are false and the
   Act III nights get their authored overrides. */
const campaign = { stats: { arrests: 0 }, cooldown: { calmUntil: 0, standDownNight: 0 }, storyFlags: {} };
function buildNight(seed, n) {
  const cfg = nightConfig(n);
  const inv = investigationPolicy(campaign, n);
  return makeNight(seed, n, MODE.STORY, {
    calm: inv.calmOverride != null ? inv.calmOverride : false,
    standDown: inv.standDownOverride != null ? inv.standDownOverride : false,
    killerPolicy: inv.killerPolicy || cfg.killerPolicy,
    deputyPolicy: cfg.deputyPolicy,
    coachPolicy: cfg.coachPolicy,
    requiredSpecials: cfg.requiredSpecials,
    specialCap: cfg.specialCap,
  });
}

/* Sample one night across all seeds and reduce to pacing metrics. */
function sample(n) {
  const cfg = nightConfig(n);
  const req = cfg.requiredSpecials.slice().sort();
  let deputy = 0, coach = 0, killer = 0, fullPlan = 0, overCap = 0, swarm = 0;
  let custMin = 99, custMax = 0, custSum = 0;
  let spMax = 0, spSum = 0, reqOk = 0;
  let minGapSum = 0, worstMin = 1, worstDead = 0;      // gaps as fraction of night
  let reqSpaceWorst = 1;                                // spacing between required specials
  for (let i = 0; i < SEEDS; i++) {
    const nt = buildNight(4000 + i, n);
    if (nt.deputy) deputy++;
    if (nt.busAt !== Infinity) coach++;
    if (nt.plan.appears) killer++;
    if (nt.plan.appears && typeof nt.plan.prowlFor === 'number' && typeof nt.plan.visitAt === 'number') fullPlan++;
    if (nt.swarm) swarm++;
    const cust = nt.schedule.length;
    custMin = Math.min(custMin, cust); custMax = Math.max(custMax, cust); custSum += cust;
    const sp = nt.schedule.filter((e) => e.special);
    spMax = Math.max(spMax, sp.length); spSum += sp.length;
    if (cfg.specialCap != null && sp.length > cfg.specialCap) overCap++;
    if (req.length && req.every((id) => sp.map((e) => e.special).includes(id))) reqOk++;
    // arrival gaps across the whole rota, as a fraction of the shift length
    const times = nt.schedule.map((e) => e.t).sort((a, b) => a - b);
    let localMin = 1, localDead = 0;
    for (let k = 1; k < times.length; k++) {
      const gap = (times[k] - times[k - 1]) / nt.length;
      localMin = Math.min(localMin, gap);
      localDead = Math.max(localDead, gap);
    }
    minGapSum += localMin; worstMin = Math.min(worstMin, localMin); worstDead = Math.max(worstDead, localDead);
    // spacing between the required specials, when there are two or more
    if (req.length >= 2) {
      const rt = nt.schedule.filter((e) => req.includes(e.special)).map((e) => e.t).sort((a, b) => a - b);
      for (let k = 1; k < rt.length; k++) reqSpaceWorst = Math.min(reqSpaceWorst, (rt[k] - rt[k - 1]) / nt.length);
    }
  }
  return {
    n, cfg, req,
    deputyPct: deputy / SEEDS, coachPct: coach / SEEDS, killerPct: killer / SEEDS,
    fullPlan, overCap, swarm,
    custMin, custMax, custAvg: +(custSum / SEEDS).toFixed(1),
    spMax, spAvg: +(spSum / SEEDS).toFixed(2), reqOk,
    avgMinGap: +(minGapSum / SEEDS).toFixed(3), worstMin: +worstMin.toFixed(3), worstDead: +worstDead.toFixed(3),
    reqSpaceWorst: req.length >= 2 ? +reqSpaceWorst.toFixed(3) : null,
  };
}

const rows = [];
for (let n = 1; n <= STORY_NIGHT_COUNT; n++) rows.push(sample(n));

if (SHOW_TABLE) {
  console.log('\nnight  cust(min/avg/max)  sp(avg/max)  dep%  coach%  kill%  minGap  deadMax');
  for (const r of rows) {
    console.log(
      `  ${String(r.n).padStart(2)}   ${String(r.custMin).padStart(2)}/${String(r.custAvg).padStart(4)}/${String(r.custMax).padStart(2)}`
      + `        ${String(r.spAvg).padStart(4)}/${r.spMax}`
      + `      ${(r.deputyPct * 100).toFixed(0).padStart(3)}   ${(r.coachPct * 100).toFixed(0).padStart(3)}   ${(r.killerPct * 100).toFixed(0).padStart(3)}`
      + `    ${r.avgMinGap.toFixed(3)}   ${r.worstDead.toFixed(3)}`);
  }
  console.log('');
}

/* ---- policy expectations, per the authored configs ---- */
const P = (id) => id === 'forced' ? 1 : id === 'forbidden' ? 0 : null;
for (const r of rows) {
  const wantDep = P(r.cfg.deputyPolicy);
  const wantCoach = P(r.cfg.coachPolicy);
  // killer can be forced by the investigation override even when the static
  // config is normal, so treat the effective policy: nights 4,8,10,12 forced;
  // 1,2,3,5,7,9,11 forbidden; 6 normal (a probability).
  const forcedKiller = [4, 8, 10, 12];
  const forbidKiller = [1, 2, 3, 5, 7, 9, 11];
  if (wantDep === 1) check(`Night ${r.n}: deputy every night`, r.deputyPct === 1, `${(r.deputyPct * 100).toFixed(0)}%`);
  if (wantDep === 0) check(`Night ${r.n}: never a deputy`, r.deputyPct === 0, `${(r.deputyPct * 100).toFixed(0)}%`);
  if (wantCoach === 1) check(`Night ${r.n}: coach every night`, r.coachPct === 1, `${(r.coachPct * 100).toFixed(0)}%`);
  if (wantCoach === 0) check(`Night ${r.n}: never a coach`, r.coachPct === 0, `${(r.coachPct * 100).toFixed(0)}%`);
  if (forcedKiller.includes(r.n)) {
    check(`Night ${r.n}: killer every night, full plan`, r.killerPct === 1 && r.fullPlan === SEEDS, `${(r.killerPct * 100).toFixed(0)}% / plan ${r.fullPlan}`);
  }
  if (forbidKiller.includes(r.n)) check(`Night ${r.n}: never the killer`, r.killerPct === 0, `${(r.killerPct * 100).toFixed(0)}%`);
  // caps and required specials
  check(`Night ${r.n}: special cap respected every seed`, r.overCap === 0, `${r.overCap} over`);
  if (r.req.length) check(`Night ${r.n}: required special(s) [${r.req.join()}] present every seed`, r.reqOk === SEEDS, `${r.reqOk}/${SEEDS}`);
  // no swarm on the authored horror/finale nights that must breathe
  if ([8, 10, 12].includes(r.n)) check(`Night ${r.n}: no special swarm`, r.swarm === 0, `${r.swarm}`);
}

/* ---- broad pacing sanity across the whole campaign ---- */
for (const r of rows) {
  check(`Night ${r.n}: customer count in a sane band`, r.custMin >= 5 && r.custMax <= 13, `${r.custMin}-${r.custMax}`);
  // A dead store the whole night would show as a single huge gap; flag only the absurd.
  check(`Night ${r.n}: no night is one long dead stretch`, r.worstDead < 0.6, `deadMax ${r.worstDead}`);
}
// Night 6 killer is a live probability (normal), not pinned either way.
const n6 = rows[5];
check('Night 6: killer stays a probability (neither always nor never)', n6.killerPct > 0 && n6.killerPct < 1, `${(n6.killerPct * 100).toFixed(0)}%`);
// The two guaranteed regulars on Night 8/12 must not pile up (Night 12 has one).
const n8 = rows[7];
check('Night 8: the two guaranteed regulars stay spread apart', n8.reqSpaceWorst !== null && n8.reqSpaceWorst > 0.08, `worst spacing ${n8.reqSpaceWorst}`);

console.log(fails ? `\npacing FAILED (${fails})` : '\npacing clean');
process.exit(fails ? 1 : 0);
