/* ============================================================
   specials.js -- the regulars nobody wants.

   Ordinary customers are rolled: a random face, a random coat, an
   archetype off a weighted table. These are not. Each one is a
   fixed person -- the same name, the same face, the same coat,
   the same problem -- who turns up now and again instead of a
   normal customer, and who has to be handled rather than served.

   A special owns three things:
     app      a locked appearance, so you recognise them on sight
     act      an optional behaviour that runs while they are in
              the shop (dancing, reeking, standing at the TV)
     script   an id the dialogue tree switches on
   ============================================================ */
import { makeRng } from '../engine/mathx.js';
import {
  randomAppearance, GENDERS, HEIGHTS, BUILDS, FACIAL, GLASSES, HATS,
  MARKS, GAITS, CARRY, SMELLS, VOICES,
} from './appearance.js';

const find = (tbl, id) => tbl.find((t) => t.id === id) || tbl[0];
const colour = (id, name, hex) => ({ id, name, hex });

/** One locked-down appearance. Built from a fixed seed so it never drifts. */
function fixedApp(seed, spec) {
  const rng = makeRng(seed);
  const a = randomAppearance(rng, { gender: spec.gender || 'm' });
  if (spec.height) a.height = find(spec.gender === 'f' ? HEIGHTS : HEIGHTS, spec.height);
  if (spec.build) a.build = find(BUILDS, spec.build);
  if (spec.facial) a.facial = find(FACIAL, spec.facial);
  if (spec.glasses) a.glasses = find(GLASSES, spec.glasses);
  if (spec.hat) a.hat = find(HATS, spec.hat);
  if (spec.mark) a.mark = find(MARKS, spec.mark);
  if (spec.gait) a.gait = find(GAITS, spec.gait);
  if (spec.carry) a.carry = find(CARRY, spec.carry);
  if (spec.smell) a.smell = find(SMELLS, spec.smell);
  if (spec.voice) a.voice = find(VOICES, spec.voice);
  if (spec.skin) a.skin = spec.skin;
  if (spec.hair) {
    a.hair = {
      id: spec.hair.id,
      color: colour(spec.hair.id, spec.hair.name, spec.hair.hex),
      style: { id: spec.hair.style, name: spec.hair.styleName },
      label: spec.hair.label,
      bulletin: spec.hair.bulletin,
    };
    a.hair.color.dark = spec.hair.dark;
  }
  if (spec.jacket) {
    a.jacket = {
      id: spec.jacket.id,
      color: colour(spec.jacket.id, spec.jacket.name, spec.jacket.hex),
      kind: spec.jacket.kind,
      label: `${spec.jacket.name[0].toUpperCase() + spec.jacket.name.slice(1)} ${spec.jacket.kind}`,
      bulletin: `a ${spec.jacket.name} ${spec.jacket.kind}`,
    };
  }
  if (spec.pants) {
    a.pants = {
      id: spec.pants.id, color: colour(spec.pants.id, spec.pants.name, spec.pants.hex),
      label: `${spec.pants.name[0].toUpperCase() + spec.pants.name.slice(1)} trousers`,
      bulletin: `${spec.pants.name} pants`,
    };
  }
  if (spec.shirt) a.shirt = colour(spec.shirt.id, spec.shirt.name, spec.shirt.hex);
  return a;
}

/* Shared behavioural defaults: these people are not here to be served, so
   their patience is enormous and their money is theoretical. */
const BASE = {
  weight: 0, patience: 400, irascibility: 0.2, honesty: 0.9, generosity: 0.3,
  chattiness: 0.9, wealth: 1, speed: 1, browse: 8,
};

/* ============================================================
   THE ROSTER
   ============================================================ */
export const SPECIALS = [
  /* ---------------------------------------------------------- */
  {
    id: 'BOOMBOX',
    name: 'Dontae Whitlock',
    tag: 'has brought his own music',
    /** Where he goes and what he does there. */
    act: 'DANCE',
    /** What the other customers say about him. */
    nuisance: 'noise',
    complaints: [
      `Can you turn that OFF?`,
      `I cannot hear myself think in here.`,
      `Is he allowed to do that? Is that allowed?`,
      `My kid is asleep in the car. In the CAR.`,
      `Sir. SIR. There are other people in this building.`,
    ],
    app: {
      gender: 'm', height: 'tall', build: 'thin', facial: 'goatee', glasses: 'aviator',
      hat: 'none', gait: 'brisk', carry: 'none', smell: 'cologne', voice: 'loud',
      hair: { id: 'black', name: 'black', hex: '#17141a', dark: '#0d0b10', style: 'curly',
        styleName: 'a high fade', label: 'Black hair, high fade', bulletin: 'black hair, high fade' },
      jacket: { id: 'track', name: 'electric purple', hex: '#5c2a8a', kind: 'track jacket' },
      pants: { id: 'track', name: 'electric purple', hex: '#4a2270' },
      shirt: { id: 'gold', name: 'gold', hex: '#c8a13a' },
      skin: '#8d5f3c',
    },
    ...BASE,
    irascibility: 0.35,
    lines: {
      wait: [`(the bassline does not stop)`, `(he is not even looking at you)`],
      angry: [`Man, I'm just VIBING. Why is everybody in this town like this.`],
      bye: [`Aight. Aight! I'm going. Rude, though.`],
      thanks: [`Respect.`],
      smalltalk: [`You got anything with a soundtrack? A real soundtrack.`],
      greetRent: [`Yo. This one got a good soundtrack?`],
      greetReturn: [`Bringing this back. Soundtrack was weak.`],
      feeAccept: [`For real? Alright, alright.`],
      feeDispute: [`Nah, that ain't right.`],
      feeWaived: [`Now THAT'S customer service.`],
      noMoney: [`I got it in the car. With the speakers.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'REEKER',
    name: 'Delbert Pruitt',
    tag: 'you can smell him from the door',
    act: 'LINGER',
    nuisance: 'stench',
    complaints: [
      `Oh my GOD. What is that.`,
      `Is something dead back there? Is something actually dead?`,
      `I'm going to be sick. I am going to be sick in your store.`,
      `That is a human being making that smell.`,
      `I'll come back. I'll come back another night.`,
    ],
    app: {
      gender: 'm', height: 'average', build: 'heavy', facial: 'beard', glasses: 'none',
      hat: 'none', gait: 'shuffle', carry: 'none', smell: 'wet', voice: 'raspy',
      hair: { id: 'grey', name: 'grey', hex: '#8d8a84', dark: '#6a6862', style: 'greasy',
        styleName: 'greasy, flat to the skull', label: 'Grey hair, greasy and flat',
        bulletin: 'grey hair, greasy, combed flat' },
      jacket: { id: 'coat', name: 'stained tan', hex: '#6b5a38', kind: 'work coat' },
      pants: { id: 'brown', name: 'brown', hex: '#4a3a24' },
      shirt: { id: 'dirty', name: 'grey', hex: '#5a564c' },
      skin: '#c08e63',
    },
    ...BASE,
    patience: 900, irascibility: 0.55, wealth: 0,
    lines: {
      wait: [`(he is reading the back of the same box he was reading ten minutes ago)`],
      angry: [`I'm ALLOWED to be in here. It's a shop. It's a public shop.`],
      bye: [`Fine. Fine! Nobody ever lets me finish looking.`],
      thanks: [`Mm.`],
      smalltalk: [`Do you have anything about submarines. Real ones.`],
      greetRent: [`I'm not renting. I'm looking.`],
      greetReturn: [`I'm not returning anything either.`],
      feeAccept: [`I have no money.`],
      feeDispute: [`I have no money.`],
      feeWaived: [`Mm.`],
      noMoney: [`I told you. No money.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'SMOKER',
    name: 'Wes Tunstall',
    tag: 'watching the television, intently',
    act: 'TV',
    nuisance: 'skunk',
    complaints: [
      `Somebody is smoking something in here and it is not tobacco.`,
      `Whew. WHEW. That is not a cigarette.`,
      `My eyes are watering. My actual eyes.`,
      `It smells like a skunk had an accident in a greenhouse.`,
      `Do you have a licence for whatever that is?`,
    ],
    app: {
      gender: 'm', height: 'average', build: 'thin', facial: 'chops', glasses: 'round',
      hat: 'beanie', gait: 'shuffle', carry: 'none', smell: 'smoke', voice: 'low',
      hair: { id: 'brown', name: 'dark brown', hex: '#3d2a1a', dark: '#2a1c11', style: 'long',
        styleName: 'long, past the shoulders', label: 'Dark brown hair, long',
        bulletin: 'dark brown hair, long, past the shoulders' },
      jacket: { id: 'poncho', name: 'faded green', hex: '#3c5230', kind: 'poncho' },
      pants: { id: 'cord', name: 'brown corduroy', hex: '#4d3a22' },
      shirt: { id: 'tie', name: 'orange', hex: '#8a5a1c' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 900, irascibility: 0.1, wealth: 0.4, speed: 0.7,
    lines: {
      wait: [`(he has not blinked in a while)`, `(he is watching the static)`],
      angry: [`Whoa. Whoa. Hey. It's fine. Everything's fine.`],
      bye: [`Yeah. Yeah, okay. Cool. Cool cool cool.`],
      thanks: [`Solid.`],
      smalltalk: [`Have you ever actually watched the snow? Like, watched it?`],
      greetRent: [`Do you have the one where nothing happens? For like two hours?`],
      greetReturn: [`Oh, is this yours? Huh.`],
      feeAccept: [`Sure. Sure.`],
      feeDispute: [`Time's not really... you know.`],
      feeWaived: [`You're a good person.`],
      noMoney: [`Money. Right. That's the thing I don't have.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'PREORDER',
    name: 'Marcy Deemer',
    tag: 'wants a film that does not exist',
    script: 'PREORDER',
    app: {
      gender: 'f', height: 'short', build: 'average', facial: 'clean', glasses: 'square',
      hat: 'none', gait: 'brisk', carry: 'umbrella', smell: 'cologne', voice: 'nasal',
      hair: { id: 'blond', name: 'blond', hex: '#b99553', dark: '#8f7038', style: 'ponytail',
        styleName: 'pulled back, very tight', label: 'Blond hair, pulled back tight',
        bulletin: 'blond hair, pulled back tight' },
      jacket: { id: 'blazer', name: 'salmon pink', hex: '#a85a52', kind: 'blazer' },
      pants: { id: 'cream', name: 'cream', hex: '#b6ab8c' },
      shirt: { id: 'white', name: 'white', hex: '#c8c4b4' },
      skin: '#e8c39e',
    },
    ...BASE,
    patience: 90, irascibility: 0.65, chattiness: 1, wealth: 1,
    lines: {
      wait: [`I'll wait while you check the back.`, `Check the computer. You have a computer.`],
      angry: [`I have been a member here since it was a Radio Shack.`],
      bye: [`I'll be writing to somebody about this.`],
      thanks: [`Well. Thank you.`],
      smalltalk: [`My nephew works in the industry. So I hear things.`],
      greetRent: [`I'll take this while I'm here, I suppose.`],
      greetReturn: [`Returning. And I have a question.`],
      feeAccept: [`Fine.`],
      feeDispute: [`I refuse.`],
      feeWaived: [`As you should.`],
      noMoney: [`I have money. That is not the issue.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'COUPON',
    name: 'Otis Bellweather',
    tag: 'has a coupon he made himself',
    script: 'COUPON',
    app: {
      gender: 'm', height: 'short', build: 'heavy', facial: 'mustache', glasses: 'square',
      hat: 'trucker', gait: 'normal', carry: 'none', smell: 'smoke', voice: 'flat',
      hair: { id: 'grey', name: 'grey', hex: '#8d8a84', dark: '#6a6862', style: 'bald',
        styleName: 'bald on top', label: 'Bald, grey at the sides',
        bulletin: 'bald, what is left of it is grey' },
      jacket: { id: 'windb', name: 'mustard yellow', hex: '#8a7317', kind: 'windbreaker' },
      pants: { id: 'grey', name: 'grey', hex: '#4a4a50' },
      shirt: { id: 'plaid', name: 'red', hex: '#6a2a24' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 200, irascibility: 0.5, honesty: 0.4, wealth: 0.6,
    lines: {
      wait: [`Take your time reading it. It's all there.`],
      angry: [`This is EXACTLY what my wife said would happen.`],
      bye: [`I'll bring the laminated one next time.`],
      thanks: [`Now that is honoring a coupon.`],
      smalltalk: [`You know what they charge across the bridge? Do you?`],
      greetRent: [`This one. And I've got something for you.`],
      greetReturn: [`Returning. And I've got something for you.`],
      feeAccept: [`Take it off the coupon.`],
      feeDispute: [`The coupon covers it.`],
      feeWaived: [`See? The coupon works.`],
      noMoney: [`I've got the coupon.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'SOVEREIGN',
    name: 'Lyle Rierdon',
    tag: 'does not recognise your authority',
    script: 'SOVEREIGN',
    /** Stands at the end of the counter rather than joining the line. */
    act: 'WINDOW',
    /** Blocks the window rather than moving along. */
    blocksLine: true,
    app: {
      gender: 'm', height: 'tall', build: 'average', facial: 'beard', glasses: 'none',
      hat: 'cap', gait: 'stiff', carry: 'backpack', smell: 'none', voice: 'loud',
      hair: { id: 'brown', name: 'dark brown', hex: '#3d2a1a', dark: '#2a1c11', style: 'ponytail',
        styleName: 'pulled back in a ponytail', label: 'Dark brown hair, ponytail',
        bulletin: 'dark brown hair in a ponytail' },
      jacket: { id: 'camo', name: 'olive', hex: '#44492a', kind: 'field jacket' },
      pants: { id: 'olive', name: 'olive', hex: '#3a3f22' },
      shirt: { id: 'flag', name: 'navy', hex: '#20304a' },
      skin: '#c08e63',
    },
    ...BASE,
    patience: 900, irascibility: 0.4, honesty: 0.5, wealth: 0.8, chattiness: 1,
    lines: {
      wait: [`I'm not finished.`, `I have not finished making my point.`],
      angry: [`You are creating a liability for yourself right now. Personally.`],
      bye: [`This conversation is being recorded. In my memory.`],
      thanks: [`I accept that under protest.`],
      smalltalk: [`Do you know the difference between a citizen and a person?`],
      greetRent: [`I'd like to take possession of this. Not rent. Take possession.`],
      greetReturn: [`I'm returning this, but I want it noted I was never under contract.`],
      feeAccept: [`Under protest.`],
      feeDispute: [`There is no valid contract. There never was.`],
      feeWaived: [`Correct. That's the correct outcome.`],
      noMoney: [`I do not use their currency.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'AUDITOR',
    name: 'Verna Ashby',
    tag: 'is checking your alphabetising',
    act: 'AUDIT',
    script: 'AUDITOR',
    app: {
      gender: 'f', height: 'short', build: 'thin', facial: 'clean', glasses: 'round',
      hat: 'none', gait: 'shuffle', carry: 'none', smell: 'bleach', voice: 'soft',
      hair: { id: 'white', name: 'white', hex: '#cfcac0', dark: '#a5a099', style: 'short',
        styleName: 'short and set', label: 'White hair, short and set',
        bulletin: 'white hair, short, set' },
      jacket: { id: 'cardi', name: 'lilac', hex: '#6a5a7a', kind: 'cardigan' },
      pants: { id: 'navy', name: 'navy', hex: '#1e2a4a' },
      shirt: { id: 'cream', name: 'cream', hex: '#b6ab8c' },
      skin: '#e8c39e',
    },
    ...BASE,
    patience: 900, irascibility: 0.15, chattiness: 1, wealth: 1, speed: 0.72,
    lines: {
      wait: [`(she is writing something down)`],
      angry: [`I am being perfectly pleasant about this.`],
      bye: [`I'll check again next week, dear.`],
      thanks: [`That's better. That's much better.`],
      smalltalk: [`Your SCI-FI has crept into your HORROR. Just so you know.`],
      greetRent: [`I'll take this. And I have some notes.`],
      greetReturn: [`Here. And I have some notes.`],
      feeAccept: [`Of course. Rules are rules.`],
      feeDispute: [`I keep my own records, dear.`],
      feeWaived: [`Oh, you shouldn't. But thank you.`],
      noMoney: [`I always have exact change.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'PHONECALL',
    name: 'Rhonda Colley',
    tag: 'on the phone, loudly, the whole time',
    act: 'PHONE',
    nuisance: 'noise',
    complaints: [
      `We can all hear you, you know.`,
      `Nobody needs to know that about your sister.`,
      `Those things are for emergencies.`,
      `She has been on that call since I walked in.`,
    ],
    app: {
      gender: 'f', height: 'average', build: 'average', facial: 'clean', glasses: 'aviator',
      hat: 'none', gait: 'normal', carry: 'none', smell: 'cologne', voice: 'loud',
      hair: { id: 'red', name: 'red', hex: '#8a3a1c', dark: '#642713', style: 'curly',
        styleName: 'curly and enormous', label: 'Red hair, curly and enormous',
        bulletin: 'red hair, curly, a lot of it' },
      jacket: { id: 'puff', name: 'teal', hex: '#1c5157', kind: 'puffy parka' },
      pants: { id: 'black', name: 'black', hex: '#1a1a1e' },
      shirt: { id: 'pink', name: 'pink', hex: '#8a4a5a' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 300, irascibility: 0.5, chattiness: 0.2, wealth: 1,
    lines: {
      wait: [`(covers the phone) One second. (uncovers) — no, not you, Denise.`],
      angry: [`I have to go, Denise, this MAN is being difficult.`],
      bye: [`— anyway, so then he said —`],
      thanks: [`(nods, still talking)`],
      smalltalk: [`Denise. DENISE. I'm in the video store. The video store.`],
      greetRent: [`(mouths: this one) — no, go on, I'm listening.`],
      greetReturn: [`(pushes the tape across without looking at you)`],
      feeAccept: [`(waves a note at you) — no, HIS mother.`],
      feeDispute: [`(covers phone) How much? (uncovers) Denise, hold on.`],
      feeWaived: [`(thumbs up)`],
      noMoney: [`(mouths: card?) — they don't take cards, Denise.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'RETURNS',
    name: 'Chet Kowalczyk',
    tag: 'has brought back something that is not yours',
    script: 'WRONGSTORE',
    app: {
      gender: 'm', height: 'verytall', build: 'broad', facial: 'stubble', glasses: 'none',
      hat: 'cap', gait: 'normal', carry: 'backpack', smell: 'oil', voice: 'flat',
      hair: { id: 'lightbrown', name: 'light brown', hex: '#6b4a2c', dark: '#4d341e', style: 'mullet',
        styleName: 'a mullet, an ambitious one', label: 'Light brown hair, mullet',
        bulletin: 'light brown hair, a mullet' },
      jacket: { id: 'denim', name: 'denim blue', hex: '#33507a', kind: 'denim jacket' },
      pants: { id: 'denim', name: 'denim blue', hex: '#2b4368' },
      shirt: { id: 'white', name: 'white', hex: '#b8b4a4' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 260, irascibility: 0.45, honesty: 0.8, wealth: 0.9,
    lines: {
      wait: [`It's got a barcode. It's got to go somewhere.`],
      angry: [`Then WHO takes it? Somebody takes it!`],
      bye: [`I'm leaving it in the bin. I'm just going to leave it in the bin.`],
      thanks: [`Appreciate you.`],
      smalltalk: [`Do all you places share a computer, or —`],
      greetRent: [`I'll take one of yours too, since I'm here.`],
      greetReturn: [`Returning. Hear me out before you look at it.`],
      feeAccept: [`That's fair.`],
      feeDispute: [`It's not even your tape!`],
      feeWaived: [`Good man.`],
      noMoney: [`I've got about a dollar.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'CRITIC',
    name: 'Gil Stumpf',
    tag: 'would like to tell you about the film',
    script: 'CRITIC',
    app: {
      gender: 'm', height: 'average', build: 'thin', facial: 'goatee', glasses: 'round',
      hat: 'none', gait: 'normal', carry: 'none', smell: 'smoke', voice: 'nasal',
      hair: { id: 'black', name: 'black', hex: '#17141a', dark: '#0d0b10', style: 'short',
        styleName: 'short, receding', label: 'Black hair, short and receding',
        bulletin: 'black hair, short, going back at the temples' },
      jacket: { id: 'cord', name: 'rust orange', hex: '#7a3c1c', kind: 'corduroy jacket' },
      pants: { id: 'black', name: 'black', hex: '#1a1a1e' },
      shirt: { id: 'black', name: 'black', hex: '#26262c' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 500, irascibility: 0.3, chattiness: 1, wealth: 1,
    lines: {
      wait: [`I'll keep going. You're clearly interested.`],
      angry: [`This is why regional cinema is dying.`],
      bye: [`Read about it. Genuinely. Read about it.`],
      thanks: [`You have surprisingly good taste for a rental clerk.`],
      smalltalk: [`Have you seen the Japanese cut? Of course you haven't.`],
      greetRent: [`This. And before you scan it — a word about the director.`],
      greetReturn: [`Returning. I have thoughts.`],
      feeAccept: [`A dollar is nothing next to what this film cost me emotionally.`],
      feeDispute: [`I kept it longer because it deserved longer.`],
      feeWaived: [`A patron of the arts.`],
      noMoney: [`Art has bankrupted me.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'PARENT',
    name: 'Sondra Vance',
    tag: 'is not letting the children pick',
    script: 'PARENT',
    app: {
      gender: 'f', height: 'tall', build: 'average', facial: 'clean', glasses: 'none',
      hat: 'none', gait: 'brisk', carry: 'none', smell: 'none', voice: 'raspy',
      hair: { id: 'brown', name: 'dark brown', hex: '#3d2a1a', dark: '#2a1c11', style: 'short',
        styleName: 'short, practical', label: 'Dark brown hair, short',
        bulletin: 'dark brown hair, short' },
      jacket: { id: 'wool', name: 'maroon', hex: '#4a1a1e', kind: 'wool overcoat' },
      pants: { id: 'grey', name: 'grey', hex: '#4a4a50' },
      shirt: { id: 'cream', name: 'cream', hex: '#b6ab8c' },
      skin: '#a6714a',
    },
    ...BASE,
    patience: 120, irascibility: 0.6, chattiness: 0.7, wealth: 1,
    lines: {
      wait: [`Is there a rating on that? A real rating?`],
      angry: [`I asked one question. ONE.`],
      bye: [`We'll try the library.`],
      thanks: [`Thank you. Somebody with sense.`],
      smalltalk: [`What's in this one? And don't say "adventure."`],
      greetRent: [`Before you ring that up. Is there anything in it.`],
      greetReturn: [`Returning this, and we need to talk about what was in it.`],
      feeAccept: [`Fine.`],
      feeDispute: [`It was late because I had to watch it twice to be sure.`],
      feeWaived: [`Well. That's decent.`],
      noMoney: [`I'm not paying for that.`],
    },
  },

  /* ---------------------------------------------------------- */
  {
    id: 'CLOSER',
    name: 'Ike Barrone',
    tag: 'wants to sell you something',
    script: 'SALESMAN',
    app: {
      gender: 'm', height: 'average', build: 'broad', facial: 'mustache', glasses: 'none',
      hat: 'none', gait: 'brisk', carry: 'duffel', smell: 'cologne', voice: 'loud',
      hair: { id: 'black', name: 'black', hex: '#17141a', dark: '#0d0b10', style: 'greasy',
        styleName: 'combed flat and shining', label: 'Black hair, combed flat',
        bulletin: 'black hair, greasy, combed flat' },
      jacket: { id: 'suit', name: 'grey', hex: '#4a4a50', kind: 'suit jacket' },
      pants: { id: 'grey', name: 'grey', hex: '#3e3e44' },
      shirt: { id: 'blue', name: 'pale blue', hex: '#5a6a86' },
      skin: '#d8ab84',
    },
    ...BASE,
    patience: 600, irascibility: 0.25, honesty: 0.3, chattiness: 1, wealth: 1,
    lines: {
      wait: [`Take your time. I'm going to be here a while.`],
      angry: [`You'll regret this in about eighteen months.`],
      bye: [`Card's on the counter. Card's on the counter.`],
      thanks: [`Pleasure doing business.`],
      smalltalk: [`Who handles your supply? Just curious. Professionally curious.`],
      greetRent: [`I'll take one. Loosens people up, buying something.`],
      greetReturn: [`Returning. Also — do you have five minutes?`],
      feeAccept: [`Cost of doing business.`],
      feeDispute: [`Waive it and I'll listen to you for a change.`],
      feeWaived: [`Now we're talking.`],
      noMoney: [`Cash flow. You understand cash flow.`],
    },
  },
];

/* Built once. Every night sees the same faces. */
let BUILT = null;
export function specialRoster() {
  if (BUILT) return BUILT;
  BUILT = SPECIALS.map((s, i) => ({
    ...s,
    app: fixedApp(0xC0FFEE + i * 7919, s.app),
    personality: {
      id: `SP_${s.id}`, tag: s.tag,
      weight: 0, patience: s.patience, irascibility: s.irascibility,
      honesty: s.honesty, generosity: s.generosity, chattiness: s.chattiness,
      wealth: s.wealth, speed: s.speed, browse: s.browse,
      special: s.id, lines: s.lines,
    },
  }));
  return BUILT;
}

export function specialById(id) { return specialRoster().find((s) => s.id === id) || null; }

/**
 * Who turns up tonight.
 *
 * Normally one or two, dropped in where an ordinary customer would have
 * been. Once in a while -- and you will know when -- the whole rota is
 * one of these, which is a different kind of night entirely.
 */
export function planSpecials(rng, night, count) {
  const roster = specialRoster();
  const swarm = rng() < 0.07;
  const n = swarm
    ? Math.max(4, Math.min(roster.length, Math.round(count * 0.7)))
    : (rng() < 0.62 ? 1 : 0) + (rng() < 0.28 ? 1 : 0);
  if (!n) return { swarm: false, picks: [] };
  const pool = rng.shuffle(roster.slice());
  const picks = pool.slice(0, Math.min(n, pool.length)).map((s) => s.id);
  return { swarm, picks };
}
