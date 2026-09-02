/* The browser build: one zip, index.html at the top of it.
 *
 * That is the whole format. itch.io wants a zip with an index.html in its
 * root, and this game is already a web page with no asset files, so the
 * build is a copy and a compress rather than a bundle -- nothing is
 * minified, nothing is transpiled, and what ships is the source.
 *
 * The zip is checked after it is written, from the inside: index.html has
 * to be at the root and not one folder down, which is the single most
 * common way one of these gets rejected.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const OUT = 'dist';
const NAME = 'final-rental-web';
const STAGE = path.join(OUT, NAME);
const ZIP = path.join(OUT, `${NAME}.zip`);

rmSync(STAGE, { recursive: true, force: true });
rmSync(ZIP, { force: true });
mkdirSync(STAGE, { recursive: true });

/* index.html at the root, and the game beside it. Nothing else: the tests,
   the tools, the screenshots, the dev server and the desktop shell are all
   irrelevant to a browser and would only be served to anyone who asked. */
cpSync('index.html', path.join(STAGE, 'index.html'));
cpSync('src', path.join(STAGE, 'src'), { recursive: true });

/* Zipped from inside the staging folder so the paths in the archive start
   at index.html. Zipping the folder itself puts everything one level down,
   the host finds no index.html at the root, and the upload is refused. */
execFileSync('zip', ['-r', '-q', '-9', path.resolve(ZIP), '.'], { cwd: STAGE });

const listing = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

const problems = [];
if (!listing.includes('index.html')) problems.push('no index.html at the root of the zip');
if (!listing.some((f) => f.startsWith('src/'))) problems.push('the game is not in there');
const stray = listing.filter((f) => !/^(index\.html|src\/)/.test(f));
if (stray.length) problems.push(`things that are not the game: ${stray.join(', ')}`);

const size = statSync(ZIP).size;
console.log(`  ${ZIP}`);
console.log(`  ${listing.length} files, ${(size / 1024).toFixed(0)}K`);
console.log(`  index.html at the root: ${listing.includes('index.html') ? 'yes' : 'NO'}`);
if (!existsSync(ZIP) || problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  process.exit(1);
}
console.log('\n  Upload it as "This file will be played in the browser".');
console.log('  Embed size 1280x960 (the picture is 4:3 and letterboxes itself into anything).');
console.log('  Tick the fullscreen button: it is the way out if the frame will not give up the mouse.');
