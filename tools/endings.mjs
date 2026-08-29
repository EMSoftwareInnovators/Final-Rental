/* The last page of a night has to fit on the screen.

   There is nothing to scroll it with -- the pointer is locked, the player
   may be on a pad, and the panel's own overflow is a mouse-wheel
   scrollbar nobody can reach -- and the arrest page ends in a choice, so
   anything that falls off the bottom is a decision the player cannot see.
   The longest arrest did exactly that: hid in the back room, the same man
   caught the night before, several quiet nights coming, and "Hand in the
   keys" was off the panel entirely.

   Cinema bars take 11% off the top and 11% off the bottom while an ending
   is up, so the real budget is 78cqh, not the 88cqh the panel allows
   itself. This measures every branch of every ending, both genders, with
   a long name, against the space actually available.

   It also reads the pronouns back. The page is written about a different
   person every night and about half of them are women, and the arrest
   page used to put a woman face down on the carpet and then call her "he"
   three sentences running. */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
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
await page.waitForTimeout(900);

/* Put the game in the state an ending is actually shown in -- cinema bars
   and all -- and hand the panel one. */
await ev(() => {
  const g = window.__game;
  window.__end = {
    show(kind, data) {
      g.state = 'ENDING'; g.endKind = kind; g.endData = data;
      g.ui.setHudVisible(false);
      g.ui.cinema(true);
      g.ui.showPanel(window.__ui.endingHtml(kind, data));
      if (kind === 'CAUGHT') g.ui.panelSelect(0);
      const body = document.querySelector('#panel-body');
      const bar = document.querySelector('#letterbox-top');
      const cab = document.querySelector('#cabinet');
      /* Everything in the cabinet's own coordinates. The cabinet is pinned
         to 4:3 and centered in the window, so a viewport-relative rect is
         offset by however much letterboxing the window itself needed. */
      const c = cab.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const barH = bar.getBoundingClientRect().height;
      const top = b.top - c.top, bottom = b.bottom - c.top;
      const floor = c.height - barH;               // where the bottom bar starts
      const last = body.lastElementChild && body.lastElementChild.lastElementChild;
      const lastBottom = last ? last.getBoundingClientRect().bottom - c.top : bottom;
      return {
        /* Does the panel itself have more in it than it is showing? */
        clipped: body.scrollHeight > body.clientHeight + 1,
        over: body.scrollHeight - body.clientHeight,
        /* And does it stay clear of the bars it is being shown between? */
        top: +top.toFixed(1), bottom: +bottom.toFixed(1),
        barH: +barH.toFixed(1), cabH: +c.height.toFixed(1),
        clearsTop: top >= barH - 1,
        clearsBottom: bottom <= floor + 1,
        /* How much room is left before the page runs into a bar. */
        spare: +Math.min(top - barH, floor - bottom).toFixed(1),
        /* Is the last thing on the page on the page? */
        lastVisible: lastBottom <= bottom + 1 && lastBottom <= floor + 1,
        text: body.textContent.replace(/\s+/g, ' ').trim(),
      };
    },
  };
});

/* A long-ish name, because the name is on its own line and the roster has
   some that run. */
const LONG = 'Marguerite Vandersloot';
const app = (id) => ({ gender: { id } });

/* Every branch of the arrest: where they were taken, whether the deputy
   said the same thing last night, and whether the town gets quiet nights.
   Sixteen pages, twice over for the two genders. */
const WHERE = [
  ['on the sidewalk', { offscreen: true }],
  ['through the front door', { broke: true }],
  ['while you were in the back room', { hid: true }],
  ['at the returns bin', {}],
];

console.log('  -- the arrest --');
let worst = { spare: 1e9, label: '' };
for (const sex of ['m', 'f']) {
  for (const [label, where] of WHERE) {
    for (const caughtLast of [false, true]) {
      for (const calmNights of [0, 5]) {
        const d = Object.assign({
          name: LONG, night: 12, nights: 12, app: app(sex),
          caseFile: { caughtLast }, calmNights, mode: 'shift',
        }, where);
        const r = await ev(([k, data]) => window.__end.show(k, data), ['CAUGHT', d]);
        const tag = `${sex} ${label}${caughtLast ? ' +repeat' : ''}${calmNights ? ' +calm' : ''}`;
        if (r.spare < worst.spare) worst = { spare: r.spare, label: tag };
        if (r.clipped || !r.lastVisible || !r.clearsBottom || !r.clearsTop) {
          check(`${tag}`, false,
            `${r.clipped ? `${r.over}px of it is not on the panel.` : ''}`
            + `${!r.lastVisible ? ' the last line is off the page.' : ''}`
            + `${!r.clearsBottom ? ` bottom ${r.bottom} past the bar at ${(r.cabH - r.barH).toFixed(0)}.` : ''}`
            + `${!r.clearsTop ? ` top ${r.top} under the bar ending at ${r.barH}.` : ''}`);
        }
      }
    }
  }
}
check('every arrest page fits between the cinema bars, choice and all',
  fails === 0, `32 pages, tightest is ${worst.label} with ${worst.spare}px to spare`);

/* And it is about the right person. */
console.log('\n  -- who it is about --');
for (const [sex, wrong, right] of [['f', /\b(he|him|his)\b/i, /\b(she|her)\b/], ['m', /\b(she|her)\b/i, /\b(he|him|his)\b/]]) {
  const d = { name: LONG, night: 4, nights: 4, app: app(sex), caseFile: { caughtLast: true }, calmNights: 3 };
  const r = await ev(([k, data]) => window.__end.show(k, data), ['CAUGHT', d]);
  /* "the deputy" is a different person, rolled separately, so the page
     must not put a pronoun on that one at all. */
  check(`a ${sex === 'f' ? 'woman' : 'man'} is not called ${sex === 'f' ? '"he"' : '"she"'} on the arrest page`,
    !wrong.test(r.text) && right.test(r.text),
    r.text.slice(0, 150));
}

/* The other two pages. ATTACKED talks about him; TERMINATED talks about
   the person you were wrong about, and its reason line comes out of
   describeInnocent, so both of its shapes get measured. */
console.log('\n  -- the other endings --');
const REASONS = [
  `The description fit. It fit almost perfectly. It was not them.`,
  `The jacket and the facial never matched. It was in your notes the whole time.`,
];
for (const sex of ['m', 'f']) {
  const r = await ev(([k, d]) => window.__end.show(k, d),
    ['ATTACKED', { name: LONG, app: app(sex), night: 9 }]);
  check(`the attack page fits, and is about a ${sex === 'f' ? 'woman' : 'man'}`,
    !r.clipped && r.lastVisible && r.clearsBottom
    && (sex === 'f' ? /\bshe\b/i.test(r.text) && !/\bhe does not hurry\b/i.test(r.text) : /\bhe\b/i.test(r.text)),
    `${r.clipped ? `${r.over}px over` : 'fits'}`);
}
for (const reason of REASONS) {
  const r = await ev(([k, d]) => window.__end.show(k, d),
    ['FIRED', { name: LONG, night: 7, reason }]);
  check('the firing page fits', !r.clipped && r.lastVisible && r.clearsBottom,
    `${r.spare}px to spare - "${reason.slice(0, 34)}..."`);
}

/* The end-of-shift report is the same shape of risk and the player sees
   it every single night: it goes up behind the same cinema bars, out of
   the same panel. Measured with every counter at a number that takes the
   width it can, and the longest note the grader writes. */
console.log('\n  -- the end-of-shift report --');
/* Every note the grader can write, verbatim from game.js. The table is
   fourteen fixed rows whatever the numbers are, so the only thing that
   moves the report's height is which of these lands in the column beside
   it -- and there is no point measuring a longer one than exists. */
const NOTES = [
  `You locked up, you counted the drawer, and you went home. That is the whole job.`,
  `Nothing happened tonight. Nothing is supposed to happen tonight.`,
  `Somebody will have taken the good horror titles by Friday. They always do.`,
  `Nobody from the county came by tonight. Nobody had anything to tell you.`,
  `Nobody came for you tonight. The deputy will be back tomorrow with more to go on, which is not the comfort it sounds like.`,
  `Somebody in that store tonight matched the bulletin, and you let them walk out with a tape.`,
  `Quiet night. That is not the same as a safe one.`,
];
let worstReport = { spare: 1e9, note: '' };
for (const note of NOTES) {
  const r = await ev((n) => {
    const g = window.__game;
    /* Four-figure counters throughout: the numbers are right-aligned in
       their own column, so this is the widest the table ever gets. */
    const stats = {
      served: 1480, rentalsRung: 1320, feesCollected: 1888.75, feesWaived: 444.25,
      shelvedRight: 1260, shelvedWrong: 180, shelvedUnrewound: 140, unshelved: 220,
      angered: 310, stormedOut: 170, turnedAway: 120, changeStiffed: 90,
      cashLoose: 1215.5, tips: 388.25,
    };
    g.state = 'REPORT';
    g.ui.setHudVisible(false);
    g.ui.cinema(true);
    g.ui.showPanel(window.__ui.reportHtml(12, stats, { letter: 'D', score: 1284 }, n));
    const body = document.querySelector('#panel-body');
    const cab = document.querySelector('#cabinet');
    const barH = document.querySelector('#letterbox-top').getBoundingClientRect().height;
    const c = cab.getBoundingClientRect(), b = body.getBoundingClientRect();
    const top = b.top - c.top, bottom = b.bottom - c.top;
    return {
      clipped: body.scrollHeight > body.clientHeight + 1,
      over: body.scrollHeight - body.clientHeight,
      spare: +Math.min(top - barH, c.height - barH - bottom).toFixed(1),
    };
  }, note);
  if (r.spare < worstReport.spare) worstReport = { spare: r.spare, note, clipped: r.clipped, over: r.over };
}
check('the end-of-shift report fits between the bars too',
  !worstReport.clipped && worstReport.spare >= -1,
  worstReport.clipped
    ? `${worstReport.over}px of it is not on the panel`
    : `${worstReport.spare}px to spare on "${worstReport.note.slice(0, 38)}..."`);

/* And the same measurement at the shapes a browser window actually is.
   The cabinet is pinned to 4:3 so this should not matter -- everything on
   the panel is in container units -- and that is exactly the claim worth
   holding down, since it is what lets one measurement stand for them all. */
console.log('\n  -- and at other window sizes --');
for (const [w, h] of [[640, 480], [1024, 768], [1600, 900], [900, 1400]]) {
  await page.setViewportSize({ width: w, height: h });
  /* The bars are on a half-second height transition and the container
     units they are sized in just changed, so they are moving. Measuring
     into that is measuring a bar that is not the size it is about to be. */
  await page.waitForTimeout(700);
  const r = await ev(([k, d]) => window.__end.show(k, d), ['CAUGHT', {
    name: LONG, night: 12, nights: 12, app: app('f'), hid: true,
    caseFile: { caughtLast: true }, calmNights: 5,
  }]);
  check(`the longest arrest fits a ${w}x${h} window`,
    !r.clipped && r.lastVisible && r.clearsBottom && r.clearsTop,
    `${r.spare}px to spare, panel ${(r.bottom - r.top).toFixed(0)}px of ${(r.cabH - r.barH * 2).toFixed(0)}px between the bars`);
}
await page.setViewportSize({ width: 1280, height: 960 });

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
if (errors.length) fails++;
console.log(fails ? `\nendings FAILED (${fails})` : '\nendings clean');
await browser.close();
process.exit(fails ? 1 : 0);
