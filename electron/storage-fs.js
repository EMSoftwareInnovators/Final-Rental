/* ============================================================
   storage-fs.js -- the desktop save host, on disk.

   Pure node, no Electron, no game: every function takes the save directory as
   an argument, so this is unit-testable against a temp dir without a window
   (see tools/storagefs.mjs). The main process wires it to app.getPath and the
   IPC channels; the renderer only ever sees the five string values it asked
   for and any recovery notices.

   What it guarantees for each of the five save domains:

     ATOMIC WRITES   a new save is written to a temp file in the same folder,
                     flushed, then renamed over the real file. A crash or a
                     pulled plug leaves either the whole old file or the whole
                     new one -- never half a JSON.

     LAST-KNOWN-GOOD before a save is overwritten, the current valid file is
                     copied to `<domain>.backup.json`. One previous good copy
                     is enough for this stage.

     RECOVERY        on load, a domain whose primary file is missing or
                     unreadable falls back to its backup; if both are gone it
                     resets to defaults -- and only that one domain. A corrupt
                     prefs file never touches Story; a corrupt Overtime run
                     never touches the profile.

     NO SILENT LOSS  a file that fails to parse is preserved as
                     `<domain>.corrupt-<timestamp>.json` for diagnosis before
                     it is replaced, capped at a few so they cannot pile up.

     MIGRATION       a domain with nothing on disk but a valid legacy value
                     (handed in from the renderer's localStorage) is written
                     once to the filesystem. Idempotent: the next launch finds
                     the file and never migrates again.

   Domains are independent files on purpose. A single save.json would let one
   corrupt field take the whole game down with it; five files mean a failure is
   contained to its own domain.
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/* The five domains and the base filename each gets. The keys match
   src/engine/storage.js STORAGE_KEYS exactly -- one list, two files. */
const KEY_FILE = {
  'finalrental.campaign': 'campaign',
  'finalrental.profile': 'profile',
  'finalrental.overtime': 'overtime',
  'finalrental.prefs': 'prefs',
  'finalrental.padbinds': 'padbinds',
};

/* How many timestamped corrupt copies to keep per domain before the oldest is
   dropped. Enough to diagnose a repeated problem, not enough to fill a disk. */
const CORRUPT_KEEP = 3;

function fileBase(key) { return KEY_FILE[key]; }

function domainPaths(dir, key) {
  const base = KEY_FILE[key];
  return {
    base,
    primary: path.join(dir, `${base}.json`),
    backup: path.join(dir, `${base}.backup.json`),
  };
}

/* A string is a usable save only if it parses as JSON. That is the single
   validity test the host applies; the game's domain loaders do the deeper
   normalization on read, exactly as they always have. */
function isValidJson(str) {
  if (typeof str !== 'string' || str.length === 0) return false;
  try { JSON.parse(str); return true; } catch { return false; }
}

function readFileOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/**
 * Write `str` to `file` atomically: a temp file in the same directory, flushed
 * to disk, then renamed into place. Node's rename replaces an existing target
 * on every platform it supports (POSIX rename / Windows MoveFileEx with
 * replace), so the swap is atomic and never leaves the reader half a file.
 */
function atomicWrite(file, str) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, str);
    fs.fsyncSync(fd);              // the data is on the platter before the rename
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

/* Keep a corrupt file for diagnosis, then prune old ones for that domain. */
function preserveCorrupt(dir, base, str, log) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `${base}.corrupt-${stamp}.json`), str);
    const rx = new RegExp(`^${base}\\.corrupt-.*\\.json$`);
    const olds = fs.readdirSync(dir).filter((f) => rx.test(f)).sort();
    while (olds.length > CORRUPT_KEEP) {
      try { fs.unlinkSync(path.join(dir, olds.shift())); } catch { /* ignore */ }
    }
  } catch (e) { if (log) log(`could not preserve corrupt ${base}: ${e.message}`); }
}

/**
 * Load one domain, applying the recovery ladder:
 *   primary valid            -> use it
 *   primary invalid, backup  -> restore from backup (notice: recovered)
 *   primary invalid, no good -> preserve corrupt, reset (notice: reset)
 *   primary missing, backup  -> restore from backup (notice: recovered)
 *   primary missing, legacy  -> migrate the legacy value once (notice: migrated)
 *   nothing anywhere         -> defaults, no value
 * Returns { value: string|null, notice: {key,kind}|null }.
 */
function readDomain(dir, key, migrationValue, log) {
  const p = domainPaths(dir, key);
  const primary = readFileOrNull(p.primary);

  if (primary != null) {
    if (isValidJson(primary)) return { value: primary, notice: null };
    // primary is unreadable -- try the last-known-good backup
    const backup = readFileOrNull(p.backup);
    if (backup != null && isValidJson(backup)) {
      preserveCorrupt(dir, p.base, primary, log);
      try { atomicWrite(p.primary, backup); } catch (e) { if (log) log(`restore write failed for ${p.base}: ${e.message}`); }
      if (log) log(`recovered ${p.base} from backup`);
      return { value: backup, notice: { key, kind: 'recovered' } };
    }
    // both gone -- preserve the corrupt one, reset THIS domain only
    preserveCorrupt(dir, p.base, primary, log);
    try { fs.unlinkSync(p.primary); } catch { /* ignore */ }
    if (log) log(`reset ${p.base}: primary and backup both unreadable`);
    return { value: null, notice: { key, kind: 'reset' } };
  }

  // primary missing (e.g. a crash between backup and primary write) -- backup?
  const backup = readFileOrNull(p.backup);
  if (backup != null && isValidJson(backup)) {
    try { atomicWrite(p.primary, backup); } catch (e) { if (log) log(`restore write failed for ${p.base}: ${e.message}`); }
    if (log) log(`restored ${p.base} from backup (primary missing)`);
    return { value: backup, notice: { key, kind: 'recovered' } };
  }

  // nothing on disk -- migrate a valid legacy localStorage value, once
  if (isValidJson(migrationValue)) {
    try { atomicWrite(p.primary, migrationValue); if (log) log(`migrated ${p.base} from legacy storage`); }
    catch (e) { if (log) log(`migrate write failed for ${p.base}: ${e.message}`); }
    return { value: migrationValue, notice: { key, kind: 'migrated' } };
  }

  return { value: null, notice: null };   // truly fresh -- defaults
}

/**
 * Load every domain. `migrationValues` is an optional { key: string } map of
 * legacy localStorage values, used only for a domain that has no file yet.
 * Returns { values: { key: string }, notices: [{key, kind}] }.
 */
function hydrate(dir, migrationValues, log) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { if (log) log(`mkdir ${dir} failed: ${e.message}`); }
  const values = {};
  const notices = [];
  for (const key of Object.keys(KEY_FILE)) {
    const mv = migrationValues ? migrationValues[key] : null;
    const r = readDomain(dir, key, mv, log);
    if (typeof r.value === 'string') values[key] = r.value;
    if (r.notice) notices.push(r.notice);
  }
  return { values, notices };
}

/**
 * Write one domain safely: refuse anything that is not valid JSON (so a bug
 * upstream can never overwrite a good save with garbage), snapshot the current
 * valid primary to the backup, then atomically replace the primary. Returns
 * true on success, false on any failure (disk full, permissions) so the caller
 * can warn rather than falsely claim the save stuck.
 */
function write(dir, key, str, log) {
  if (!KEY_FILE[key]) { if (log) log(`refused write to unknown key ${key}`); return false; }
  if (!isValidJson(str)) { if (log) log(`refused invalid (non-JSON) write to ${key}`); return false; }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const p = domainPaths(dir, key);
    const cur = readFileOrNull(p.primary);
    if (cur != null && isValidJson(cur)) {
      try { atomicWrite(p.backup, cur); } catch (e) { if (log) log(`backup failed for ${p.base}: ${e.message}`); }
    }
    atomicWrite(p.primary, str);
    return true;
  } catch (e) {
    if (log) log(`write failed for ${key}: ${e.message}`);
    return false;
  }
}

/** Remove one domain outright -- primary and its backup. Used when the game
    deletes a save (a finished Overtime run, a wiped campaign). */
function remove(dir, key, log) {
  if (!KEY_FILE[key]) return;
  const p = domainPaths(dir, key);
  for (const f of [p.primary, p.backup]) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
  if (log) log(`removed ${p.base}`);
}

module.exports = {
  KEY_FILE, CORRUPT_KEEP,
  hydrate, write, remove,
  domainPaths, fileBase, isValidJson, atomicWrite,
};
