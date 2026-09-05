/* ============================================================
   storage.js -- one persistence seam for both hosts.

   The game saves five things (campaign, profile, overtime, prefs, padbinds),
   and until now every one reached straight for window.localStorage. That is
   right for the browser build and wrong for the desktop build, which wants
   real per-domain JSON files it can write atomically, back up, recover, and
   one day hand to Steam Cloud.

   So the domain owners (campaign.js, profile.js, overtime.js) and the two
   inline stores in game.js no longer touch localStorage directly. They go
   through the singleton `storage` below, whose surface is deliberately the
   same three methods localStorage has -- getItem / setItem / removeItem, all
   synchronous -- so nothing above it had to change shape or learn about async.

   Two backends sit under that surface:

     WEB       the browser build. getItem/setItem/removeItem pass straight
               through to window.localStorage, live, every call. It behaves
               exactly as the game always did, which is why the whole test
               suite -- much of which pokes localStorage directly -- keeps
               working untouched. hydrate() is a no-op.

     DESKTOP   the Electron build. There is no synchronous filesystem in a
               sandboxed renderer, so the desktop host hands the renderer every
               save file's contents once, at boot (hydrate, awaited before any
               gameplay), into an in-memory cache. getItem reads that cache;
               setItem/removeItem update it AND persist through a synchronous
               IPC call to the main process, which does the atomic write. Small
               JSON at a night boundary written synchronously is the simplest
               correct thing: no write can be reordered behind a newer one, and
               there is nothing pending to flush when the window closes.

   Which backend is live is decided once, by src/main.js at boot, from whether
   the desktop bridge (window.finalRentalDesktop, installed by the Electron
   preload) is present. Gameplay never asks.
   ============================================================ */

/* The five keys the game persists. Named here so the desktop host and the
   migration path have one list to agree on, and so a stray key can never be
   quietly created behind the storage layer. */
export const STORAGE_KEYS = [
  'finalrental.campaign',
  'finalrental.profile',
  'finalrental.overtime',
  'finalrental.prefs',
  'finalrental.padbinds',
];

/* ---- the browser backend: live localStorage, exactly as before ---- */
const webBackend = {
  name: 'web',
  async hydrate() { return { notices: [] }; },   // localStorage is already there
  getItem(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch { return false; }
  },
  removeItem(key) {
    try { window.localStorage.removeItem(key); return true; } catch { /* ignore */ }
  },
};

/* ---- the desktop backend: a boot-hydrated cache over synchronous IPC ---- */
function makeDesktopBackend(bridge) {
  const cache = new Map();
  return {
    name: 'desktop',
    async hydrate() {
      /* One round trip: the host reads every save file (recovering from a
         backup or resetting a corrupt domain as needed) and hands back the
         values plus any notices about what it had to do. */
      let res;
      try { res = await bridge.hydrate(); } catch { res = null; }
      const values = (res && res.values) || {};
      for (const key of STORAGE_KEYS) {
        if (typeof values[key] === 'string') cache.set(key, values[key]);
      }
      return { notices: (res && Array.isArray(res.notices)) ? res.notices : [] };
    },
    getItem(key) {
      return cache.has(key) ? cache.get(key) : null;
    },
    setItem(key, value) {
      const str = String(value);
      cache.set(key, str);
      /* Persist synchronously so the write is on disk before this returns --
         no async race, no reordering, nothing to flush at quit. The host does
         the atomic write and keeps the last-known-good backup. */
      try { return bridge.saveSync(key, str) !== false; } catch { return false; }
    },
    removeItem(key) {
      cache.delete(key);
      try { bridge.removeSync(key); } catch { /* the file may already be gone */ }
    },
  };
}

class Storage {
  constructor() {
    this._backend = webBackend;   // safe default; main.js may switch to desktop
    this._notices = [];
    this._failed = false;         // set true if a write ever failed on this host
  }

  /**
   * Decide the backend and load any state the game needs before it starts.
   *
   * Called once by src/main.js and AWAITED before boot(): gameplay must never
   * read a save that has not been loaded yet. Picks the desktop bridge if the
   * preload installed one, else stays on live localStorage. Returns the
   * recovery notices so the game can tell the player, calmly, if a save had to
   * be restored from backup or reset.
   */
  async init(bridge) {
    this._backend = bridge ? makeDesktopBackend(bridge) : webBackend;
    try {
      const res = await this._backend.hydrate();
      this._notices = (res && res.notices) || [];
    } catch {
      this._notices = [];
    }
    return this._notices;
  }

  /** Which host is active: 'web' or 'desktop'. */
  get backend() { return this._backend.name; }

  /** Recovery notices from init(), if the game wants to surface them. */
  get notices() { return this._notices.slice(); }

  /** True if any write has failed on this host (disk full, permissions, ...).
      Callers making an irreversible boundary save can check this and warn. */
  get failed() { return this._failed; }

  getItem(key) { return this._backend.getItem(key); }

  setItem(key, value) {
    const ok = this._backend.setItem(key, value);
    if (ok === false) this._failed = true;
    return ok;
  }

  removeItem(key) { return this._backend.removeItem(key); }
}

/* The singleton the whole game shares. */
export const storage = new Storage();
