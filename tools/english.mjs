/* The store is at 4412 Delaney Ave and everybody in it is American, so
   nothing they say -- and nothing written on the walls, the HUD, the
   notepad or the README -- should read as British.

   This one needs no browser: it is a read of the source. It exists because
   "till" survived on the HUD for weeks, and once you go looking there is a
   whole shift of them behind it: a queue, a shop, a film, a parade of
   shops, a laundrette, grey trousers, a fortnight.

   Some of these words are perfectly good American English in another
   sense -- you ring a sale up on a register, a film person says film, a
   bin is a bin -- so the list carries the exceptions with it rather than
   dropping the check. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let bad = 0, files = 0;

/* word -> what an American clerk would say instead. Matched case-insensitively
   on word boundaries. `skip` holds the phrases where the word is not the
   British one, checked against the whole line. */
const BRITISH = [
  ['till', 'register (or "until", for the preposition)'],
  ['shop', 'store', { skip: ['to shop', 'shop for', 'shops for', 'shopping', 'r.shops', 'shops:', 'const shops', 'shops.', 'off.shops'] }],
  ['queue', 'line', { skip: ['g.queue', 'this.queue', 'queueSpot', 'queueIndex', 'QUEUE_', "'QUEUE'", 'SPOTS.queue', 'queue:', 'audio thread a queue', '// 5  queue', '// 6  queue'] }],
  ['film', 'movie', { skip: ['buttery film', 'On film.', 'different film entirely', 'film reel', 'a film person', 'about the film', 'this film cost'] }],
  ['parade', 'block', { skip: ["'PARADE'"] }],
  ['pavement', 'sidewalk'],
  ['kerb', 'curb'],
  ['laundrette', 'laundromat'],
  ['parlour', 'parlor'],
  ['grey', 'gray'],
  ['colour', 'color'],
  ['coloured', 'colored'],
  ['colours', 'colors'],
  ['trousers', 'pants'],
  ['theatre', 'theater'],
  ['centre', 'center'],
  ['metre', 'meter'],
  ['metres', 'meters'],
  ['neighbour', 'neighbor'],
  ['cheque', 'check'],
  ['fortnight', 'two weeks'],
  ['maths', 'math'],
  ['petrol', 'gasoline'],
  ['adverts', 'commercials'],
  ['chemist', 'drugstore'],
  ['car park', 'parking lot'],
  ['hire car', 'rental car'],
  ['licence', 'license'],
  ['defence', 'defense'],
  ['offence', 'offense'],
  ['behaviour', 'behavior'],
  ['humour', 'humor'],
  ['honour', 'honor'],
  ['favour', 'favor'],
  ['favourite', 'favorite'],
  ['marvellous', 'marvelous'],
  ['travelling', 'traveling'],
  ['whilst', 'while'],
  ['amongst', 'among'],
  ['mate', 'buddy', { skip: ['estimate', 'approximate'] }],
  ['bloke', 'guy'],
  ['half eleven', 'half past eleven'],
  ['quid', 'dollars'],
  ['lorry', 'truck'],
  ['rubbish', 'trash'],
  ['jumper', 'sweater'],
  ['torch', 'flashlight'],
  ['aluminium', 'aluminum'],
  ['tyre', 'tire'],
  ['postcode', 'zip code'],
  ['dustbin', 'trash can'],
  ['biro', 'ballpoint pen'],
];

/* "Round" for "around" -- turning round, come round, have a look round.
   Matched only after a verb, because a round is also a shape, a drink and
   a shift of the clock. */
const ROUND = String.raw`\b(turn|turns|turned|turning|come|comes|came|coming|go|goes|went|going`
  + String.raw`|walk|walks|walked|walking|look|looks|looked|looking|show|shows|showed|showing`
  + String.raw`|get|gets|got|getting|sit|sits|sat|stand|stands|stood|hang|hangs|hung|hanging`
  + String.raw`|drive|drives|drove|driving|ask|asks|asked|asking|bring|brings|brought)\s+round\b`;

/* -ise/-yse where American English wants -ize/-yze. Spelled out rather than
   matched by pattern: "premise", "surprise" and a dozen others end that way
   in both. */
const ISE = ['realise', 'realised', 'apologise', 'apologised', 'organise', 'organised',
  'recognise', 'recognised', 'specialise', 'analyse', 'analysed', 'criticise',
  'civilised', 'sympathise', 'sympathises', 'notarised', 'galvanised', 'synthesise',
  'synthesised', 'normalise', 'normalised', 'quantisation', 'penalised', 'tokenised',
  'alphabetising', 'memorise', 'summarise', 'prioritise', 'apologising'];

const TARGETS = ['src', 'tools', 'README.md', 'index.html', 'docs/cover.html'];
const SELF = 'tools/english.mjs';

const walk = (p, out = []) => {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f), out); return out; }
  if (/\.(js|mjs|html|css|md)$/.test(p)) out.push(p);
  return out;
};

const hits = [];
for (const t of TARGETS) {
  for (const f of walk(t)) {
    if (f === SELF) continue;
    files++;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const check = (word, want, opts) => {
        if (opts && opts.skip && opts.skip.some((s) => line.includes(s))) return;
        const re = new RegExp(`\\b${word.replace(' ', '\\s+')}\\b`, 'i');
        if (!re.test(line)) return;
        hits.push({ f, n: i + 1, word, want, line: line.trim().slice(0, 96) });
      };
      for (const [word, want, opts] of BRITISH) check(word, want, opts);
      const r = new RegExp(ROUND, 'i').exec(line);
      if (r) hits.push({ f, n: i + 1, word: r[0], want: `${r[1]} around`, line: line.trim().slice(0, 96) });
      for (const word of ISE) check(word, word.replace(/is(e|ed|ing|ation)?$/, (m) => m.replace('is', 'iz')).replace(/ys(e|ed)$/, (m) => m.replace('ys', 'yz')));
    });
  }
}

console.log(`  read ${files} files`);
if (hits.length) {
  bad = 1;
  for (const h of hits) {
    console.log(`  FAIL  ${h.f}:${h.n}  "${h.word}" -> ${h.want}`);
    console.log(`        ${h.line}`);
  }
}
console.log(hits.length ? `\n${hits.length} British word${hits.length > 1 ? 's' : ''} left in an American video store`
  : '\n  ok  nobody in this store sounds British');
process.exit(bad);
