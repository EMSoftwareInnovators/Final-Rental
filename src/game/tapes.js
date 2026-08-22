/* ============================================================
   tapes.js -- the rental catalogue. Six genres, six shelves.
   A tape knows its genre (where it must go back), whether it was
   rewound, and how overdue it is.
   ============================================================ */

export const GENRES = ['HORROR', 'COMEDY', 'ACTION', 'SCIFI', 'DRAMA', 'FAMILY'];

export const GENRE_LABEL = {
  HORROR: 'HORROR', COMEDY: 'COMEDY', ACTION: 'ACTION',
  SCIFI: 'SCI-FI', DRAMA: 'DRAMA', FAMILY: 'FAMILY',
};

export const GENRE_COLOR = {
  HORROR: '#ff4b3a', COMEDY: '#ffd447', ACTION: '#4fa8ff',
  SCIFI: '#5cf0ff', DRAMA: '#e8d9ae', FAMILY: '#7cf09a',
};

export const CATALOG = {
  HORROR: [
    'THE CRAWL', 'BLOOD ORCHARD', 'NIGHT CLERK', 'SLAUGHTER MOTEL', 'THE REWIND',
    'CHILDREN OF THE STATIC', 'MEAT LOCKER 3', 'HER TEETH', 'CABIN 14',
    'THE MAN IN THE HALL', 'SPLICE OF LIFE', 'GRAVEYARD SHIFT', 'FEEDING TIME',
    'THE WEEPING WALL', 'BLACK FRIDAY VHS',
  ],
  COMEDY: [
    'DOUBLE SHIFT', 'MY OTHER DAD', 'PIZZA WARS', 'THE INTERN FROM MARS',
    'HONEY, I QUIT', 'THREE GUYS ONE VAN', 'SUMMER OF LARRY', 'OFFICE PARTY 2',
    'THE GREAT LAWN FEUD', 'BOWLING FOR RENT', 'MY BOSS IS A GHOST',
    'CAMP LOOSE ENDS', 'DENTIST ON THE RUN',
  ],
  ACTION: [
    'HARD EXIT', 'MAXIMUM VELOCITY', 'THE LAST PRECINCT', 'STEEL RAIN',
    'CODENAME: MAGPIE', 'DEEP HARBOR', 'BLACK ICE PATROL', 'FIST OF THE DELTA',
    'RUNAWAY FREIGHT', 'DOUBLE CROSSFIRE', 'THE COURIER', 'NITRO CITY',
    'SIEGE AT PIER 9',
  ],
  SCIFI: [
    'ORBIT ZERO', 'THE QUIET SIGNAL', 'ANDROID SUMMER', 'GRAVITY WELL',
    'CHRONOFAULT', 'THE LAST TRANSMISSION', 'STARFALL 88', 'MIND OF GLASS',
    'THE COLONY BELOW', 'ECHO PROTOCOL', 'TERMINAL VELOCITY 9', 'DUST OF EUROPA',
  ],
  DRAMA: [
    'A QUIET COUNTY', 'THE LONG DRIVE HOME', 'FATHERS AND FIRES', 'LETTERS FROM ELM',
    'THE SEASON AFTER', 'PAPER ANNIVERSARY', 'WHAT THE RIVER TOOK', 'SALT AND HONEY',
    'THE UNDERSTUDY', 'NINE DAYS IN OCTOBER', 'THE WEIGHT OF SUNDAY',
  ],
  FAMILY: [
    'BUSTER GOES TO CAMP', 'THE LOST PUPPY PATROL', 'SKATEBOARD SUMMER',
    'PRINCESS OF THE PINES', 'MY PET DINOSAUR', 'THE HOMEWORK MACHINE',
    'GRANDMA VS THE MALL', 'HOOPS AND DREAMS JR', 'THE SNOW FORT',
    'TOBY AND THE TALKING TRUCK',
  ],
};

let nextId = 1;

export function makeTape(genre, rng, opts = {}) {
  const list = CATALOG[genre];
  return {
    id: nextId++,
    title: opts.title || list[rng.int(list.length)],
    genre,
    rewound: opts.rewound !== undefined ? opts.rewound : true,
    price: opts.price !== undefined ? opts.price : (genre === 'HORROR' ? 3.5 : 2.99),
    daysLate: opts.daysLate || 0,
    /** set when the tape is out with a customer */
    heldBy: null,
  };
}

export function lateFee(daysLate) { return Math.round(daysLate * 100) / 100; }

/** Short one-line label used all over the HUD and dialogue. */
export function tapeLabel(tape) {
  return `${tape.title} (${GENRE_LABEL[tape.genre]})`;
}
