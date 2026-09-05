/* ============================================================
   main.js -- boot. Waits for the DOM, loads the saves, builds the
   game, and gets out of the way.
   ============================================================ */
import { Game } from './game/game.js';
import { storage } from './engine/storage.js';
import * as appearance from './game/appearance.js';
import * as mathx from './engine/mathx.js';
import * as customer from './game/customer.js';
import * as personality from './game/personality.js';
import * as dialogue from './game/dialogue.js';
import * as night from './game/night.js';
import * as campaign from './game/campaign.js';
import * as profile from './game/profile.js';
import * as overtime from './game/overtime.js';
import * as world from './game/world.js';
import * as uimod from './game/ui.js';
import * as tapes from './game/tapes.js';
import * as specials from './game/specials.js';
import * as catalog from './game/catalog.js';
import * as chatter from './game/chatter.js';
import * as briefing from './game/briefing.js';
import * as inputmod from './engine/input.js';

/* The desktop bridge, when this is the Electron build (electron/preload.js
   installs it); null in the browser. It decides two things: where saves go
   (filesystem vs localStorage) and whether this is a production build (debug
   globals off). The web production build has no bridge, so it signals
   production with a window.__FR_PROD__ marker the build injects instead. */
const desktop = (typeof window !== 'undefined' && window.finalRentalDesktop) || null;
const IS_PRODUCTION = (desktop ? !!desktop.isProduction() : false)
  || (typeof window !== 'undefined' && window.__FR_PROD__ === true);

const start = async () => {
  /* Load persistence BEFORE the game exists. On desktop this reads the save
     files (recovering or migrating as needed) into the storage layer; on the
     browser it is a no-op over live localStorage. Gameplay must never read a
     save that has not been loaded, so this is awaited. */
  let notices = [];
  try { notices = await storage.init(desktop); } catch { notices = []; }

  const game = new Game();

  /* Development hooks -- the in-page console and the headless harnesses under
     tools/ -- are exposed ONLY outside a production build. A shipped game gives
     no window.__game, so there is no timeScale fast-forward, no test-state
     mutation, and no way to reach into the simulation from the console. The
     dev web server and the unpackaged desktop build are both development, so
     the whole test suite keeps working untouched. */
  if (!IS_PRODUCTION) {
    window.__game = game;
    window.__app = appearance;
    window.__mathx = mathx;
    window.__cust = customer;
    window.__pers = personality;
    window.__dlg = dialogue;
    window.__night = night;
    window.__campaign = campaign;
    window.__profile = profile;
    window.__overtime = overtime;
    window.__world = world;
    window.__ui = uimod;
    window.__tapes = tapes;
    window.__specials = specials;
    window.__catalog = catalog;
    window.__chat = chatter;
    window.__brief = briefing;
    window.__input = inputmod;
    window.__storage = storage;
  }

  /* Forward an uncaught renderer error to the desktop log (message only). On
     the web this is a no-op; the browser console is the record there. */
  if (desktop) {
    const forward = (msg) => { try { desktop.reportError(msg); } catch { /* ignore */ } };
    addEventListener('error', (e) => forward(e && e.message ? e.message : 'error'));
    addEventListener('unhandledrejection', (e) => forward('unhandledrejection: '
      + (e && e.reason && e.reason.message ? e.reason.message : e && e.reason)));
  }

  try {
    await game.boot();
    game.applyOptions();
    /* If a save had to be recovered from backup or reset after corruption, tell
       the player -- calmly, in the game's own panel, never a browser alert or a
       stack trace. Migration is expected and stays silent. */
    const meaningful = notices.filter((n) => n && (n.kind === 'recovered' || n.kind === 'reset'));
    if (meaningful.length) game.showBootNotice(meaningful);
  } catch (err) {
    console.error(err);
    if (desktop) { try { desktop.reportError('boot failed: ' + (err && err.message)); } catch { /* ignore */ } }
    document.body.innerHTML =
      `<pre style="color:#ffb641;font:14px monospace;padding:2rem;white-space:pre-wrap">`
      + `FINAL RENTAL failed to start.\n\n${err && err.stack ? err.stack : err}\n\n`
      + `Serve the folder over http:// (npm start) -- ES modules will not load from file://.</pre>`;
  }
};

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
else start();
