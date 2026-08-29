/* ============================================================
   catalog.js -- what is actually on the shelves.

   A video store is a wall of titles, and a wall of fifteen titles
   reads as a prop. Each genre here is a hand-written core -- the
   ones with jokes in them -- plus a generated run built from
   genre-specific grammars, so a shelf has hundreds of plausible
   1996 spines on it and you rarely see the same one twice.

   The generator is seeded and run once, so the store's stock is
   the same store every night rather than a fresh hallucination.
   ============================================================ */
import { makeRng } from '../engine/mathx.js';

/* ---------------- the hand-written core ---------------- */
const CORE = {
  HORROR: [
    'THE CRAWL', 'BLOOD ORCHARD', 'NIGHT CLERK', 'SLAUGHTER MOTEL', 'THE REWIND',
    'CHILDREN OF THE STATIC', 'MEAT LOCKER 3', 'HER TEETH', 'CABIN 14',
    'THE MAN IN THE HALL', 'SPLICE OF LIFE', 'GRAVEYARD SHIFT', 'FEEDING TIME',
    'THE WEEPING WALL', 'BLACK FRIDAY VHS', 'MOTHER MADE IT', 'DO NOT ADJUST',
    'THE LAST CUSTOMER', 'SIX FEET OF WINTER', 'PLEASE HOLD', 'THE THING IN 4B',
    'AUNT PATTY', 'RURAL ROUTE 9', 'IT LEARNED TO KNOCK', 'THE PARKING DECK',
    'DEAD AIR', 'A GOOD BOY', 'THE SMILING SEASON', 'BASEMENT TAPES',
    'SOMETHING IN THE FREEZER', 'THE NEIGHBOR IMPROVED', 'HOG NIGHT',
    'WE FOUND THE CAMERA', 'THIRTEEN MILES OF NOTHING', 'THE UNDERSIDE',
    'GRANDFATHER CLOCK', 'THE QUIET FLOOR', 'CANDLES FOR EVERYONE',
  ],
  COMEDY: [
    'DOUBLE SHIFT', 'MY OTHER DAD', 'PIZZA WARS', 'THE INTERN FROM MARS',
    'HONEY, I QUIT', 'THREE GUYS ONE VAN', 'SUMMER OF LARRY', 'OFFICE PARTY 2',
    'THE GREAT LAWN FEUD', 'BOWLING FOR RENT', 'MY BOSS IS A GHOST',
    'CAMP LOOSE ENDS', 'DENTIST ON THE RUN', 'WEEKEND AT THE DMV',
    'MY DOG THE LAWYER', 'TWO WEEKS NOTICE, ONE WEEK PAY', 'THE CASSEROLE INCIDENT',
    'UNCLE RAY MOVES IN', 'HOT TUB CITY COUNCIL', 'THE WRONG BRIAN',
    'GOLF CART BANDITS', 'MRS. FINCH GOES TO VEGAS', 'THE MALL WALKERS',
    'NINE TO NEVER', 'SUBSTITUTE GYM TEACHER', 'THE POTLUCK CONSPIRACY',
    'MY SON THE MIME', 'ATTACK OF THE HOA', 'BRIDESMAID FOR HIRE',
    'THE LAST BLOCKBUSTER PARTY', 'ROOMMATE ROULETTE', 'CRUISE CONTROL',
    'THE ACCIDENTAL MAYOR', 'DAD BAND', 'TWO CATS AND A MORTGAGE',
  ],
  ACTION: [
    'HARD EXIT', 'MAXIMUM VELOCITY', 'THE LAST PRECINCT', 'STEEL RAIN',
    'CODENAME: MAGPIE', 'DEEP HARBOR', 'BLACK ICE PATROL', 'FIST OF THE DELTA',
    'RUNAWAY FREIGHT', 'DOUBLE CROSSFIRE', 'THE COURIER', 'NITRO CITY',
    'SIEGE AT PIER 9', 'CONCRETE VENDETTA', 'ONE MAN SHORT', 'HAMMERDOWN',
    'THE MOSCOW LEDGER', 'TERMINAL PURSUIT', 'BADGE 77', 'SALVAGE RIGHTS',
    'THE RIO CONTRACT', 'IRON MERIDIAN', 'LAST TRAIN TO KOWLOON',
    'DEAD DROP DENVER', 'THE HELSINKI SWITCH', 'ROUGH TRADE', 'GUNMETAL SUNRISE',
    'THE BARCELONA RUN', 'HARD WATER', 'EXTRACTION POINT BRAVO',
    'THE COLONEL RETIRES', 'STREET LEVEL', 'CARGO 1900',
  ],
  SCIFI: [
    'ORBIT ZERO', 'THE QUIET SIGNAL', 'ANDROID SUMMER', 'GRAVITY WELL',
    'CHRONOFAULT', 'THE LAST TRANSMISSION', 'STARFALL 88', 'MIND OF GLASS',
    'THE COLONY BELOW', 'ECHO PROTOCOL', 'TERMINAL VELOCITY 9', 'DUST OF EUROPA',
    'THE SEVENTH ITERATION', 'CARBON DAUGHTER', 'THE LONG DECELERATION',
    'HAB 12', 'SIGNAL FROM THE ICE', 'THE COPY OF THE COPY', 'MOONFALL COUNTY',
    'INSIDE THE ENGINE', 'THE PATIENT MACHINE', 'RED SHIFT DIVORCE',
    'BEFORE THE ARRAY', 'THE VOTING SPHERE', 'CLONEWORK', 'THE LAST OPERATOR',
    'STATION KEEPING', 'THE WEIGHT OF LIGHT', 'ARGO SEVEN DOES NOT ANSWER',
    'THE CHILDREN OF THE TANK', 'SOFT REBOOT',
  ],
  DRAMA: [
    'A QUIET COUNTY', 'THE LONG DRIVE HOME', 'FATHERS AND FIRES', 'LETTERS FROM ELM',
    'THE SEASON AFTER', 'PAPER ANNIVERSARY', 'WHAT THE RIVER TOOK', 'SALT AND HONEY',
    'THE UNDERSTUDY', 'NINE DAYS IN OCTOBER', 'THE WEIGHT OF SUNDAY',
    'THE LAST SHIFT AT THE MILL', 'HER MOTHER’S HANDS', 'COAL AND COFFEE',
    'THE FIELD BEHIND THE CHURCH', 'SOMETHING ABOUT AUGUST', 'THE DEBT',
    'A ROOM ON THE SECOND FLOOR', 'THE PIANO IN THE BARN', 'WINTER TENANTS',
    'THE OLDEST BROTHER', 'HALF A MILE OF FENCE', 'THE DAY THE PLANT CLOSED',
    'RAIN ON THE CROP', 'MY FATHER’S TRUCK', 'THE SUNDAY VISIT',
    'BEFORE THE INSURANCE MAN', 'THE HOUSE ON KELLER ROAD', 'A SMALL INHERITANCE',
  ],
  FAMILY: [
    'BUSTER GOES TO CAMP', 'THE LOST PUPPY PATROL', 'SKATEBOARD SUMMER',
    'PRINCESS OF THE PINES', 'MY PET DINOSAUR', 'THE HOMEWORK MACHINE',
    'GRANDMA VS THE MALL', 'HOOPS AND DREAMS JR', 'THE SNOW FORT',
    'TOBY AND THE TALKING TRUCK', 'THE GREAT SCIENCE FAIR HEIST',
    'A HORSE NAMED PATIENCE', 'THE PAPER ROUTE KINGS', 'MOOSE ON THE LOOSE',
    'THE TREEHOUSE TREATY', 'SPACE CAMP DROPOUT', 'MY BROTHER THE ROBOT',
    'THE PENGUIN WHO COULD NOT SKATE', 'SUMMER OF THE SEVENTH BIKE',
    'THE BAKE SALE BANDITS', 'RUFUS SAVES THE FARM', 'THE LAST DAY OF FIFTH GRADE',
    'CAPTAIN CARDBOARD', 'THE MERMAID OF LAKE VERNON', 'DAD’S BIG IDEA',
  ],
  GAMES: [
    'GRAVEL MERCHANTS', 'HYPER TURBO GRAND PRIX', 'CASTLE OF THE SEVENTH KEY',
    'MEGA PUNCH TOURNAMENT', 'SEWER RESCUE SQUAD', 'STARFIGHTER OMEGA',
    'BLOCK BUSTER DELUXE', 'NINJA COURIER 2', 'DIRT TRACK DYNASTY',
    'ROBO-DOG ADVENTURE', 'THE PIXEL DUNGEON', 'SLAM CITY BASKETBALL',
    'SPACE HAULER 3000', 'KUNG-FU ISLAND', 'WIZARD OF THE NINE GATES',
    'MONSTER TRUCK MAYHEM', 'FROG QUEST', 'TURBO GOLF CHALLENGE',
    'CRYSTAL MINER 64', 'BARON VON BLAST', 'SKATE OR DIE TRYING',
    'THE LEGEND OF TIN VALLEY', 'PUNCH-DRUNK BOXING', 'GALACTIC PAPERBOY',
    'DUNGEON JANITOR', 'HOVER TANK COMMAND', 'CHEF WARS', 'PYRAMID PANIC',
    'RALLY DEMON 2', 'THE AMAZING PLUMBING BROTHERS',
  ],
};

/* ---------------- word banks ---------------- */
const W = {
  horrorNoun: ['HOUSE', 'HOLLOW', 'CELLAR', 'ORCHARD', 'CHAPEL', 'ASYLUM', 'MOTEL',
    'HARVEST', 'CHOIR', 'MIDNIGHT', 'FURNACE', 'ATTIC', 'MARSH', 'DOLL', 'MIRROR',
    'STAIRWELL', 'SILO', 'PARISH', 'BUTCHER', 'HOUNDS', 'LANTERN', 'CROW', 'WELL',
    'GRAVE', 'HYMN', 'SCARECROW', 'RECTORY', 'ORPHANAGE', 'TIDE', 'PLAGUE',
    'STILLNESS', 'FEVER', 'CANDLE', 'HUNGER', 'SPLINTER', 'BASEMENT', 'SLAUGHTER'],
  horrorAdj: ['CRIMSON', 'HOLLOW', 'SILENT', 'ROTTING', 'PATIENT', 'CRAWLING',
    'WEEPING', 'BURIED', 'HUNGRY', 'FROZEN', 'BLIND', 'WHISPERING', 'FORGOTTEN',
    'UNQUIET', 'BLEEDING', 'SMILING', 'WAITING', 'HUMMING'],
  horrorPlace: ['ELMWOOD', 'BLACKMOOR', 'DELANEY', 'HARROW', 'PINE HOLLOW',
    'COLD SPRING', 'MERCY', 'ST. BRENDAN', 'CROWFIELD', 'DUNWICK', 'RIVERSIDE',
    'CEDAR RUN', 'ASHFORD', 'GRIMSBY', 'WILLOW BEND'],

  comedyNoun: ['WEDDING', 'REUNION', 'DIVORCE', 'PROMOTION', 'CASSEROLE', 'MINIVAN',
    'BARBECUE', 'HONEYMOON', 'CARWASH', 'BAKE SALE', 'BOWLING LEAGUE', 'TIMESHARE',
    'PARADE', 'PTA', 'CONDO', 'CRUISE', 'RECITAL', 'GARAGE SALE', 'CAMPGROUND',
    'DEPOSITION', 'DELI', 'HOT TUB', 'LAWN', 'CARPOOL', 'FONDUE'],
  comedyAdj: ['ACCIDENTAL', 'RELUCTANT', 'UNAUTHORIZED', 'TERRIBLE', 'FAKE',
    'SUBSTITUTE', 'PROFESSIONAL', 'AMATEUR', 'SECRET', 'DELUXE', 'EMERGENCY',
    'UNOFFICIAL', 'WORST', 'HONORARY'],
  comedyName: ['LARRY', 'DENISE', 'CHUCK', 'BARB', 'DUANE', 'MARLENE', 'GARY',
    'PATTY', 'HOWIE', 'SHEILA', 'VERN', 'DOT', 'RANDY', 'JOANNE', 'STAN'],

  actionNoun: ['PROTOCOL', 'VENDETTA', 'CONTRACT', 'PURSUIT', 'STRIKE', 'HARBOR',
    'PRECINCT', 'CONVOY', 'RANSOM', 'SANCTION', 'BREACH', 'PAYLOAD', 'ASSAULT',
    'MANIFEST', 'CROSSFIRE', 'GAUNTLET', 'OVERRIDE', 'BLACKOUT', 'FREIGHT',
    'CHECKPOINT', 'SYNDICATE', 'CARTEL', 'FIREWALL', 'DETONATOR'],
  actionAdj: ['HARD', 'DEEP', 'BLACK', 'IRON', 'MAXIMUM', 'TERMINAL', 'CONCRETE',
    'BROKEN', 'FINAL', 'DOUBLE', 'RED', 'COLD', 'SILENT', 'HOSTILE', 'DEAD'],
  actionPlace: ['MOSCOW', 'BANGKOK', 'DETROIT', 'BERLIN', 'MARSEILLE', 'MACAU',
    'BELFAST', 'CARACAS', 'ISTANBUL', 'JUAREZ', 'LISBON', 'ODESSA', 'TANGIER',
    'HELSINKI', 'PIER 9', 'SECTOR 12'],

  scifiNoun: ['PROTOCOL', 'ARRAY', 'ORBIT', 'SIGNAL', 'ENGINE', 'COLONY', 'DRIFT',
    'ITERATION', 'HORIZON', 'VECTOR', 'ARCHIVE', 'LATTICE', 'SPECIMEN', 'RELAY',
    'TRANSIT', 'CANOPY', 'CASCADE', 'REACTOR', 'MACHINE', 'DESCENT', 'CIPHER'],
  scifiAdj: ['QUIET', 'LONG', 'LAST', 'PATIENT', 'HOLLOW', 'SOFT', 'INFINITE',
    'ORBITAL', 'SYNTHETIC', 'FROZEN', 'DISTANT', 'PERFECT', 'RECURSIVE'],
  scifiPlace: ['EUROPA', 'CERES', 'TITAN', 'HAB 12', 'STATION KELVIN', 'THE BELT',
    'ARGO SEVEN', 'NEW TRIESTE', 'LUNA VERDE', 'THE DEEP FIELD', 'IO'],

  dramaNoun: ['SUMMER', 'HARVEST', 'INHERITANCE', 'DEBT', 'FUNERAL', 'FARM',
    'MILL', 'CHURCH', 'RIVER', 'ORCHARD', 'PROMISE', 'LETTER', 'WINTER',
    'HOMECOMING', 'FENCE', 'KITCHEN', 'ROAD', 'FACTORY', 'STATION', 'CROP'],
  dramaAdj: ['QUIET', 'LONG', 'LAST', 'SMALL', 'HONEST', 'BORROWED', 'DISTANT',
    'FAITHFUL', 'PATIENT', 'ORDINARY', 'UNSPOKEN'],
  dramaPlace: ['ELM', 'KELLER ROAD', 'CEDAR COUNTY', 'BRIAR CREEK', 'MERCY',
    'FALLOWFIELD', 'THE HOLLOW', 'PORT ALICE', 'STONEBRIDGE'],

  familyNoun: ['PUPPY', 'DINOSAUR', 'TREEHOUSE', 'BICYCLE', 'PONY', 'ROBOT',
    'SNOWMAN', 'PENGUIN', 'CIRCUS', 'CLUBHOUSE', 'LEMONADE STAND', 'SCIENCE FAIR',
    'PAPER ROUTE', 'GO-KART', 'CAMP', 'FIELD TRIP', 'HAMSTER', 'KITE'],
  familyAdj: ['GREAT', 'AMAZING', 'INCREDIBLE', 'SECRET', 'MAGIC', 'BRAVE',
    'LOST', 'RUNAWAY', 'GIANT', 'TINY', 'WONDERFUL'],
  familyName: ['BUSTER', 'RUFUS', 'PIP', 'MOOSE', 'BISCUIT', 'CHARLIE', 'MURPHY',
    'WINSTON', 'DAISY', 'SCOUT', 'TOBY', 'JASPER'],

  gameNoun: ['QUEST', 'ISLAND', 'DUNGEON', 'RACER', 'BRAWLER', 'COMMANDO',
    'PATROL', 'ARENA', 'GAUNTLET', 'CASTLE', 'CAVERNS', 'CIRCUIT', 'SQUADRON',
    'MECHANIC', 'PANIC', 'RAMPAGE', 'TOURNAMENT', 'ODYSSEY', 'SMASH', 'DYNASTY'],
  gameAdj: ['SUPER', 'HYPER', 'MEGA', 'TURBO', 'ULTRA', 'COSMIC', 'ATOMIC',
    'NEON', 'SAVAGE', 'CRYSTAL', 'THUNDER', 'LASER', 'GALACTIC', 'RADICAL'],
  gameHero: ['NINJA', 'ROBOT', 'WIZARD', 'PIRATE', 'KNIGHT', 'MONSTER TRUCK',
    'SPACE MARINE', 'DRAGON', 'FROG', 'SAMURAI', 'BARBARIAN', 'CYBORG', 'YETI'],
};

const NUM = ['2', '3', '4', 'II', 'III', '2000', '3000', '64', '88', '99', 'X'];
const SUB = ['THE FINAL CHAPTER', 'THE RECKONING', 'THE RETURN', 'DELUXE EDITION',
  'THE NEXT DAY', 'RELOADED', 'AFTERMATH', 'THE BEGINNING'];

/* ---------------- grammars ---------------- */
const PATTERNS = {
  HORROR: [
    (r) => `THE ${r.pick(W.horrorNoun)}`,
    (r) => `THE ${r.pick(W.horrorAdj)} ${r.pick(W.horrorNoun)}`,
    (r) => `${r.pick(W.horrorNoun)} OF THE ${r.pick(W.horrorNoun)}`,
    (r) => `${r.pick(W.horrorPlace)}`,
    (r) => `${r.pick(W.horrorPlace)} ${r.pick(NUM)}`,
    (r) => `THE ${r.pick(W.horrorPlace)} ${r.pick(W.horrorNoun)}`,
    (r) => `DO NOT ${r.pick(['OPEN IT', 'ANSWER IT', 'LOOK BACK', 'GO DOWN THERE', 'WAKE HER'])}`,
    (r) => `IT ${r.pick(['WAITS', 'REMEMBERS', 'FOLLOWS', 'HUNGERS', 'KNOWS', 'RETURNS'])}`,
    (r) => `${r.pick(W.horrorAdj)} ${r.pick(W.horrorNoun)} ${r.pick(NUM)}`,
    (r) => `NIGHT OF THE ${r.pick(W.horrorNoun)}`,
  ],
  COMEDY: [
    (r) => `THE ${r.pick(W.comedyAdj)} ${r.pick(W.comedyNoun)}`,
    (r) => `${r.pick(W.comedyName)} AND THE ${r.pick(W.comedyNoun)}`,
    (r) => `MY ${r.pick(['BOSS', 'MOTHER', 'DENTIST', 'LANDLORD', 'BROTHER', 'ACCOUNTANT', 'NEIGHBOR'])} THE ${r.pick(['SPY', 'GHOST', 'ALIEN', 'CRIMINAL', 'GENIUS', 'ROCK STAR', 'WRESTLER'])}`,
    (r) => `${r.pick(W.comedyNoun)} ${r.pick(NUM)}`,
    (r) => `HONEY, I ${r.pick(['QUIT', 'SOLD THE HOUSE', 'JOINED A BAND', 'ADOPTED SIX DOGS', 'BOUGHT A BOAT'])}`,
    (r) => `THE ${r.pick(W.comedyNoun)} FROM ${r.pick(['MARS', 'HELL', 'ACCOUNTING', 'NEXT DOOR', 'CLEVELAND'])}`,
    (r) => `${r.pick(['WEEKEND', 'CHRISTMAS', 'SUMMER'])} AT THE ${r.pick(W.comedyNoun)}`,
    (r) => `${r.pick(W.comedyName)} GOES TO ${r.pick(['COLLEGE', 'WASHINGTON', 'VEGAS', 'PRISON', 'CAMP', 'THE MOON'])}`,
  ],
  ACTION: [
    (r) => `THE ${r.pick(W.actionPlace)} ${r.pick(W.actionNoun)}`,
    (r) => `${r.pick(W.actionAdj)} ${r.pick(W.actionNoun)}`,
    (r) => `${r.pick(W.actionAdj)} ${r.pick(W.actionNoun)} ${r.pick(NUM)}`,
    (r) => `CODENAME: ${r.pick(['MAGPIE', 'HALYARD', 'VULTURE', 'WINTERGREEN', 'DRY POWDER', 'BLUE COLLAR', 'TALLOW'])}`,
    (r) => `${r.pick(W.actionNoun)} AT ${r.pick(W.actionPlace)}`,
    (r) => `LAST ${r.pick(['TRAIN', 'FLIGHT', 'BOAT', 'CALL', 'MAN'])} TO ${r.pick(W.actionPlace)}`,
    (r) => `${r.pick(['BADGE', 'UNIT', 'PRECINCT', 'SECTOR'])} ${r.int(90) + 9}`,
    (r) => `THE ${r.pick(W.actionAdj)} ${r.pick(['OPTION', 'ANSWER', 'MILE', 'HOUR', 'ORDER'])}`,
  ],
  SCIFI: [
    (r) => `THE ${r.pick(W.scifiAdj)} ${r.pick(W.scifiNoun)}`,
    (r) => `${r.pick(W.scifiNoun)} ${r.pick(NUM)}`,
    (r) => `${r.pick(W.scifiPlace)} ${r.pick(['PROTOCOL', 'DESCENT', 'INCIDENT', 'DIRECTIVE', 'SILENCE'])}`,
    (r) => `THE ${r.pick(W.scifiNoun)} OF ${r.pick(W.scifiPlace)}`,
    (r) => `${r.pick(['SIGNAL', 'TRANSMISSION', 'MESSAGE', 'ECHO'])} FROM ${r.pick(W.scifiPlace)}`,
    (r) => `${r.pick(W.scifiAdj)} ${r.pick(W.scifiNoun)}`,
    (r) => `THE ${r.pick(['SEVENTH', 'NINTH', 'THIRD', 'LAST', 'FIRST'])} ${r.pick(W.scifiNoun)}`,
    (r) => `WE ARE ${r.pick(['NOT ALONE', 'THE COPY', 'STILL FALLING', 'OUT OF AIR'])}`,
  ],
  DRAMA: [
    (r) => `THE ${r.pick(W.dramaAdj)} ${r.pick(W.dramaNoun)}`,
    (r) => `${r.pick(['LETTERS', 'NOTES', 'POSTCARDS'])} FROM ${r.pick(W.dramaPlace)}`,
    (r) => `THE ${r.pick(W.dramaNoun)} AT ${r.pick(W.dramaPlace)}`,
    (r) => `WHAT THE ${r.pick(W.dramaNoun)} ${r.pick(['TOOK', 'KNEW', 'LEFT', 'COST'])}`,
    (r) => `${r.pick(['NINE', 'THREE', 'TWELVE', 'SEVEN'])} DAYS IN ${r.pick(['OCTOBER', 'MARCH', 'JUNE', 'DECEMBER'])}`,
    (r) => `A ${r.pick(W.dramaAdj)} ${r.pick(W.dramaNoun)}`,
    (r) => `MY ${r.pick(['FATHER', 'MOTHER', 'BROTHER', 'SISTER'])}’S ${r.pick(['TRUCK', 'HANDS', 'HOUSE', 'WAR', 'DEBT', 'SILENCE'])}`,
    (r) => `THE DAY THE ${r.pick(['PLANT', 'MILL', 'SCHOOL', 'BANK', 'CHURCH'])} CLOSED`,
  ],
  FAMILY: [
    (r) => `THE ${r.pick(W.familyAdj)} ${r.pick(W.familyNoun)}`,
    (r) => `${r.pick(W.familyName)} AND THE ${r.pick(W.familyNoun)}`,
    (r) => `${r.pick(W.familyName)} SAVES ${r.pick(['THE FARM', 'CHRISTMAS', 'THE DAY', 'SUMMER', 'THE ZOO'])}`,
    (r) => `MY ${r.pick(['PET', 'BROTHER', 'SISTER', 'GRANDPA'])} THE ${r.pick(['DINOSAUR', 'ROBOT', 'WIZARD', 'ASTRONAUT', 'PIRATE'])}`,
    (r) => `THE ${r.pick(W.familyNoun)} ${r.pick(['CLUB', 'GANG', 'PATROL', 'CREW', 'KIDS'])}`,
    (r) => `${r.pick(['SUMMER', 'WINTER', 'SPRING'])} OF THE ${r.pick(W.familyNoun)}`,
    (r) => `${r.pick(W.familyName)} GOES TO ${r.pick(['CAMP', 'SCHOOL', 'THE CITY', 'THE MOON', 'THE COUNTY FAIR'])}`,
  ],
  GAMES: [
    (r) => `${r.pick(W.gameAdj)} ${r.pick(W.gameNoun)}`,
    (r) => `${r.pick(W.gameAdj)} ${r.pick(W.gameHero)} ${r.pick(NUM)}`,
    (r) => `${r.pick(W.gameHero)} ${r.pick(W.gameNoun)}`,
    (r) => `THE LEGEND OF ${r.pick(['TIN VALLEY', 'BLACKSPIRE', 'THE NINE GATES', 'CINDER KEEP', 'MOSS HOLLOW'])}`,
    (r) => `${r.pick(W.gameHero)} ${r.pick(W.gameNoun)} ${r.pick(NUM)}`,
    (r) => `${r.pick(['CAPTAIN', 'DOCTOR', 'BARON', 'PROFESSOR', 'COMMANDER'])} ${r.pick(['BLAST', 'ZORK', 'MAGMA', 'VOLT', 'KRUNCH', 'NOVA'])}`,
    (r) => `${r.pick(W.gameNoun)} ${r.pick(['64', '2000', '3000', 'DX', 'TURBO', 'ADVANCE'])}`,
    (r) => `${r.pick(W.gameAdj)} ${r.pick(W.gameNoun)}: ${r.pick(SUB)}`,
  ],
};

/** "A UNSPOKEN WINTER" is not a title anybody printed. */
function article(t) { return t.replace(/\bA ([AEIOU])/g, 'AN $1'); }

/** How many generated titles each genre gets on top of its core. */
const TARGET = 300;

function build() {
  const out = {};
  // one fixed seed: the store stocks the same movies every night it opens
  const rng = makeRng(0x5A17E5);
  for (const genre of Object.keys(CORE)) {
    const seen = new Set(CORE[genre].map((t) => t.toUpperCase()));
    const list = CORE[genre].slice();
    const pats = PATTERNS[genre];
    let guard = 0;
    while (list.length < TARGET && guard++ < TARGET * 40) {
      const t = article(pats[rng.int(pats.length)](rng).replace(/\s+/g, ' ').trim());
      if (t.length > 34 || seen.has(t)) continue;
      seen.add(t);
      list.push(t);
    }
    out[genre] = list;
  }
  return out;
}

export const CATALOG = build();

/** Rough count, for the check harness and for anyone curious. */
export function catalogSize() {
  let n = 0;
  for (const g of Object.keys(CATALOG)) n += CATALOG[g].length;
  return n;
}
