/* ============================================================
   preload.js -- the one, narrow bridge between the game and the desktop.

   The renderer stays sandboxed and context-isolated; it gets no Node, no fs,
   no general IPC. All it is handed, on `window.finalRentalDesktop`, is exactly
   what the save layer needs: load the five save files once, write one, remove
   one, report a fatal error to the local log, and ask whether this is a
   production build. Nothing here can read or write anything the main process
   has not explicitly agreed to in its IPC handlers, which are keyed to the
   five known save domains and refuse everything else.

   The web build has no preload and no bridge; src/engine/storage.js sees the
   absence of window.finalRentalDesktop and stays on localStorage. So this file
   is purely additive -- the game runs unchanged without it.
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* The five domains, same list as src/engine/storage.js and storage-fs.js. A
   sandboxed preload cannot require the game's modules, so the list is repeated
   here -- and the main process validates against its own copy regardless, so a
   drift here can never widen what is reachable. */
const KEYS = [
  'finalrental.campaign',
  'finalrental.profile',
  'finalrental.overtime',
  'finalrental.prefs',
  'finalrental.padbinds',
];

/* Gather any legacy localStorage values for migration. The preload shares the
   page's origin, so this is the game://app origin's own localStorage -- which
   is where an EARLIER desktop build of this app kept its saves. (It is not,
   and cannot be, some other browser's or the itch build's storage.) */
function legacyValues() {
  const out = {};
  for (const key of KEYS) {
    try {
      const v = window.localStorage.getItem(key);
      if (typeof v === 'string') out[key] = v;
    } catch { /* no localStorage, or blocked -- nothing to migrate */ }
  }
  return out;
}

contextBridge.exposeInMainWorld('finalRentalDesktop', {
  /* Load every save file once, migrating a legacy localStorage value for any
     domain that has no file yet. Async, awaited by the game before it starts.
     Returns { values: {key: string}, notices: [{key, kind}] }. */
  hydrate: () => ipcRenderer.invoke('storage:hydrate', legacyValues()),

  /* Persist one domain, synchronously: the write is atomic and on disk before
     this returns, so there is nothing pending to lose at quit and no way for an
     older write to land after a newer one. Returns true on success. */
  saveSync: (key, value) => ipcRenderer.sendSync('storage:save', key, String(value)) === true,

  /* Delete one domain's files (a finished run, a wiped campaign). */
  removeSync: (key) => { ipcRenderer.sendSync('storage:remove', key); },

  /* Native window fullscreen, so a Settings toggle drives the same state as
     F11 / Alt+Enter -- one fullscreen concept on the desktop, not two. */
  toggleFullscreen: () => { try { ipcRenderer.send('window:toggle-fullscreen'); } catch { /* ignore */ } },
  isFullscreen: () => { try { return ipcRenderer.sendSync('window:is-fullscreen') === true; } catch { return false; } },

  /* Forward an uncaught renderer error to the local log file. Message only --
     never page content, never keystrokes. */
  reportError: (message) => { try { ipcRenderer.send('log:error', String(message).slice(0, 2000)); } catch { /* ignore */ } },

  /* True in a packaged/production build: the game hides its debug globals and
     cheats when this is set. */
  isProduction: () => ipcRenderer.sendSync('app:isProduction') === true,
});
