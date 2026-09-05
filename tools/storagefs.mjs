/* Stage 13: the desktop save host, tested on a real (temp) filesystem.
 *
 * Pure node -- no Electron, no browser. It drives electron/storage-fs.js
 * against a throwaway directory and simulates every save-lifecycle state the
 * spec asks about: normal save/reload, an interrupted temp write, a malformed
 * primary with a good backup, both malformed, a missing directory, a failed
 * write, legacy migration, repeated-boot idempotency, newer-filesystem-vs-
 * older-legacy, and domain isolation.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const S = require('../electron/storage-fs.js');

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const CK = 'finalrental.campaign';
const PK = 'finalrental.profile';
const OK = 'finalrental.overtime';
const RK = 'finalrental.prefs';

function freshDir() {
  return mkdtempSync(path.join(tmpdir(), 'fr-fs-'));
}
const p = (dir, key) => S.domainPaths(dir, key);

/* ---------- 1. normal save + reload ---------- */
{
  const dir = freshDir();
  const val = JSON.stringify({ version: 3, currentNight: 5, seed: 42 });
  check('write reports success', S.write(dir, CK, val) === true);
  check('the primary file is written', existsSync(p(dir, CK).primary));
  const h = S.hydrate(dir, null);
  check('reload returns the same value', h.values[CK] === val, h.values[CK]);
  check('a fresh save has no backup yet (nothing was overwritten)', !existsSync(p(dir, CK).backup));
  check('and no recovery notices on a clean load', h.notices.length === 0);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 2. overwrite keeps a last-known-good backup ---------- */
{
  const dir = freshDir();
  const v1 = JSON.stringify({ night: 1 });
  const v2 = JSON.stringify({ night: 2 });
  S.write(dir, CK, v1);
  S.write(dir, CK, v2);
  check('the second write left the first as a backup', readFileSync(p(dir, CK).backup, 'utf8') === v1);
  check('and the primary is the newest value', readFileSync(p(dir, CK).primary, 'utf8') === v2);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 3. an invalid write is refused, the good save survives ---------- */
{
  const dir = freshDir();
  const good = JSON.stringify({ night: 7 });
  S.write(dir, CK, good);
  check('a non-JSON write is refused', S.write(dir, CK, '{ this is not json') === false);
  check('and the previous good save is untouched', readFileSync(p(dir, CK).primary, 'utf8') === good);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 4. an interrupted temp write never destroys the primary ---------- */
{
  const dir = freshDir();
  const good = JSON.stringify({ night: 3 });
  S.write(dir, CK, good);
  // Simulate a crash mid-write: a leftover .tmp file, primary intact.
  writeFileSync(path.join(dir, `.${S.fileBase(CK)}.json.9999.123.tmp`), '{ half-written');
  const h = S.hydrate(dir, null);
  check('a stray temp file is ignored; the primary still loads', h.values[CK] === good, h.values[CK]);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 5. malformed primary + valid backup -> recovered ---------- */
{
  const dir = freshDir();
  const v1 = JSON.stringify({ night: 4 });
  const v2 = JSON.stringify({ night: 5 });
  S.write(dir, CK, v1);          // becomes backup after next write
  S.write(dir, CK, v2);          // primary=v2, backup=v1
  writeFileSync(p(dir, CK).primary, '{ corrupt ][');   // scribble on the primary
  const h = S.hydrate(dir, null);
  check('a corrupt primary is recovered from the backup', h.values[CK] === v1, h.values[CK]);
  check('and the recovery is reported as a notice', h.notices.some((n) => n.key === CK && n.kind === 'recovered'));
  check('the corrupt primary is preserved for diagnosis, not deleted',
    readdirSync(dir).some((f) => /campaign\.corrupt-.*\.json/.test(f)));
  check('and the primary is repaired on disk from the backup',
    readFileSync(p(dir, CK).primary, 'utf8') === v1);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 6. both malformed -> reset THIS domain only ---------- */
{
  const dir = freshDir();
  // profile is fine; campaign primary+backup are both garbage.
  const prof = JSON.stringify({ version: 1, story: { completed: true, completions: 2 } });
  S.write(dir, PK, prof);
  writeFileSync(p(dir, CK).primary, 'garbage-primary');
  writeFileSync(p(dir, CK).backup, 'garbage-backup');
  const h = S.hydrate(dir, null);
  check('a domain with no readable copy resets to defaults (no value)', h.values[CK] === undefined);
  check('and reports a reset notice', h.notices.some((n) => n.key === CK && n.kind === 'reset'));
  check('the corrupt campaign is preserved', readdirSync(dir).some((f) => /campaign\.corrupt-/.test(f)));
  check('and the UNRELATED profile is completely intact', h.values[PK] === prof, h.values[PK]);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 7. missing directory is created, load is empty defaults ---------- */
{
  const base = freshDir();
  const dir = path.join(base, 'saves', 'nested');   // does not exist yet
  const h = S.hydrate(dir, null);
  check('hydrate creates a missing save directory', existsSync(dir));
  check('and an empty install loads no values, no notices', Object.keys(h.values).length === 0 && h.notices.length === 0);
  rmSync(base, { recursive: true, force: true });
}

/* ---------- 8. a failed write is reported false, not a false success ---------- */
{
  const dir = freshDir();
  // Force a genuine I/O failure that even root cannot bypass: put a DIRECTORY
  // where the primary file should be, so the atomic rename cannot land.
  mkdirSync(p(dir, CK).primary, { recursive: true });
  const reported = S.write(dir, CK, JSON.stringify({ night: 1 }));
  check('a write that cannot land on disk reports failure, not a false success', reported === false, String(reported));
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 9. legacy migration, once, then idempotent ---------- */
{
  const dir = freshDir();
  const legacy = {
    [CK]: JSON.stringify({ version: 3, currentNight: 9 }),
    [PK]: JSON.stringify({ version: 1, story: { completed: true, completions: 1, endingsSeen: ['ARREST'] } }),
  };
  const h1 = S.hydrate(dir, legacy);
  check('a valid legacy value with no file is migrated to disk', existsSync(p(dir, CK).primary) && h1.values[CK] === legacy[CK]);
  check('migration is reported as a notice', h1.notices.some((n) => n.key === CK && n.kind === 'migrated'));
  // Boot again with the SAME legacy values present: must not re-migrate.
  const h2 = S.hydrate(dir, legacy);
  check('a second boot does not re-migrate (filesystem wins)', h2.notices.every((n) => n.kind !== 'migrated'));
  check('and the profile completion count did not double via migration',
    JSON.parse(h2.values[PK]).story.completions === 1, h2.values[PK]);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 10. newer filesystem beats older legacy ---------- */
{
  const dir = freshDir();
  const fsVal = JSON.stringify({ version: 3, currentNight: 12 });   // newer, on disk
  S.write(dir, CK, fsVal);
  const legacy = { [CK]: JSON.stringify({ version: 3, currentNight: 2 }) };  // older, in localStorage
  const h = S.hydrate(dir, legacy);
  check('when a filesystem save exists, the legacy value never overwrites it', h.values[CK] === fsVal, h.values[CK]);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 11. remove drops primary and backup ---------- */
{
  const dir = freshDir();
  S.write(dir, OK, JSON.stringify({ shift: 1 }));
  S.write(dir, OK, JSON.stringify({ shift: 2 }));   // now primary+backup exist
  check('an overtime run has a primary and a backup', existsSync(p(dir, OK).primary) && existsSync(p(dir, OK).backup));
  S.remove(dir, OK);
  check('remove deletes both, so a finished run cannot resurrect from backup',
    !existsSync(p(dir, OK).primary) && !existsSync(p(dir, OK).backup));
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 12. corrupt-file retention is capped ---------- */
{
  const dir = freshDir();
  // Force many recoveries so many corrupt files would accumulate.
  for (let i = 0; i < S.CORRUPT_KEEP + 4; i++) {
    S.write(dir, CK, JSON.stringify({ i }));           // valid primary (+ backup after first)
    S.write(dir, CK, JSON.stringify({ i, again: 1 })); // ensure a backup exists
    writeFileSync(p(dir, CK).primary, 'corrupt-' + i); // break the primary
    S.hydrate(dir, null);                              // recover -> preserves one corrupt
  }
  const corrupt = readdirSync(dir).filter((f) => /campaign\.corrupt-/.test(f));
  check('corrupt copies are kept but capped at the retention limit',
    corrupt.length <= S.CORRUPT_KEEP, `${corrupt.length} kept (cap ${S.CORRUPT_KEEP})`);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 13. domain files are separate and named predictably ---------- */
{
  const dir = freshDir();
  for (const key of Object.keys(S.KEY_FILE)) S.write(dir, key, JSON.stringify({ k: key }));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  check('each domain is its own predictably named file',
    JSON.stringify(files) === JSON.stringify(['campaign.json', 'overtime.json', 'padbinds.json', 'prefs.json', 'profile.json']),
    files.join(','));
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails ? `\nstoragefs FAILED (${fails})` : '\nstoragefs clean');
process.exit(fails ? 1 : 0);
