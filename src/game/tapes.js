/* ============================================================
   tapes.js -- the rental counter's rules. Seven runs, seven
   shelves. A tape knows its genre (where it must go back),
   whether it was rewound, and how overdue it is. The titles
   themselves live in catalog.js.
   ============================================================ */
import { CATALOG } from './catalog.js';

export { CATALOG };

export const GENRES = ['HORROR', 'COMEDY', 'ACTION', 'SCIFI', 'DRAMA', 'FAMILY', 'GAMES'];

export const GENRE_LABEL = {
  HORROR: 'HORROR', COMEDY: 'COMEDY', ACTION: 'ACTION',
  SCIFI: 'SCI-FI', DRAMA: 'DRAMA', FAMILY: 'FAMILY', GAMES: 'GAMES',
};

export const GENRE_COLOR = {
  HORROR: '#ff4b3a', COMEDY: '#ffd447', ACTION: '#4fa8ff',
  SCIFI: '#5cf0ff', DRAMA: '#e8d9ae', FAMILY: '#7cf09a', GAMES: '#c9a4ff',
};

/* Cartridges do not have a take-up reel, so nothing about rewinding
   applies to them -- but everything else about the counter does, and the
   store charges more for them and is stricter about the late fee. */
export const IS_GAME = { GAMES: true };
export function isGame(genre) { return !!IS_GAME[genre]; }

/** What a rental costs, and what a day of lateness costs. */
export const PRICE = {
  HORROR: 3.5, COMEDY: 2.99, ACTION: 2.99, SCIFI: 2.99,
  DRAMA: 2.49, FAMILY: 2.49, GAMES: 4.99,
};
export const LATE_PER_DAY = { GAMES: 2 };

let nextId = 1;

export function makeTape(genre, rng, opts = {}) {
  const list = CATALOG[genre];
  const game = isGame(genre);
  return {
    id: nextId++,
    title: opts.title || list[rng.int(list.length)],
    genre,
    game,
    // a cartridge is never "not rewound", so it never counts against you
    rewound: game ? true : (opts.rewound !== undefined ? opts.rewound : true),
    price: opts.price !== undefined ? opts.price : (PRICE[genre] || 2.99),
    daysLate: opts.daysLate || 0,
    /** set when the tape is out with a customer */
    heldBy: null,
  };
}

export function lateFee(daysLate, genre) {
  return Math.round(daysLate * (LATE_PER_DAY[genre] || 1) * 100) / 100;
}

/** "tape" is the wrong noun for half the shelves now. */
export function mediaWord(t) { return t && t.game ? 'cartridge' : 'tape'; }
export function mediaWordPl(t) { return t && t.game ? 'cartridges' : 'tapes'; }

/** Short one-line label used all over the HUD and dialogue. */
export function tapeLabel(tape) {
  return `${tape.title} (${GENRE_LABEL[tape.genre]})`;
}
