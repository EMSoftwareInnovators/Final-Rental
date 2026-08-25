/* ============================================================
   main.js -- boot. Waits for the DOM, builds the game, and gets
   out of the way.
   ============================================================ */
import { Game } from './game/game.js';
import * as appearance from './game/appearance.js';
import * as mathx from './engine/mathx.js';
import * as customer from './game/customer.js';
import * as personality from './game/personality.js';
import * as dialogue from './game/dialogue.js';

const start = async () => {
  const game = new Game();
  // Dev hooks: the console, and the headless harnesses under tools/.
  window.__game = game;
  window.__app = appearance;
  window.__mathx = mathx;
  window.__cust = customer;
  window.__pers = personality;
  window.__dlg = dialogue;
  try {
    await game.boot();
    game.applyOptions();
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      `<pre style="color:#ffb641;font:14px monospace;padding:2rem;white-space:pre-wrap">`
      + `FINAL RENTAL failed to start.\n\n${err && err.stack ? err.stack : err}\n\n`
      + `Serve the folder over http:// (npm start) -- ES modules will not load from file://.</pre>`;
  }
};

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
else start();
