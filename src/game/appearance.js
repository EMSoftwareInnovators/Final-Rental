/* ============================================================
   appearance.js -- who a person IS, physically.
   Every trait does three jobs at once:
     1. it changes the low-poly model / its skin texture,
     2. it produces a line the police officer can read out,
     3. it produces a line you can tick off in your notepad.
   That triangle is the whole identification game.
   ============================================================ */
import { makeTex } from '../engine/texture.js';

/* ---------------- the atlas the character model is unwrapped to ---------------- */
export const ATLAS = {
  headF: [0, 0, 24, 24], headB: [24, 0, 24, 24], headL: [48, 0, 24, 24],
  headR: [72, 0, 24, 24], headT: [96, 0, 24, 24], headD: [0, 24, 24, 24],
  torsoT: [24, 24, 16, 16], torsoD: [40, 24, 16, 16], hand: [56, 24, 16, 16],
  shoeT: [72, 24, 16, 16], hatB: [88, 24, 24, 16],
  torsoF: [0, 48, 32, 44], torsoB: [32, 48, 32, 44],
  torsoL: [64, 48, 16, 44], torsoR: [80, 48, 16, 44],
  arm: [96, 48, 16, 44], leg: [112, 48, 16, 44],
  shoe: [0, 96, 16, 16], hatS: [16, 96, 32, 16], hatT: [48, 96, 24, 24],
  bag: [72, 96, 24, 24],
};
export const ATLAS_SIZE = 128;

/* ---------------- trait tables ---------------- */
const T = (id, label, bulletin, extra = {}) => ({ id, label, bulletin, ...extra });

export const HEIGHTS = [
  T('short', `Short — about 5'3"`, `short. Five three, five four maybe`, { scale: 0.88 }),
  T('average', `Average height — about 5'8"`, `average height, call it five eight`, { scale: 1.0 }),
  T('tall', `Tall — about 6'1"`, `tall. Six foot one`, { scale: 1.09 }),
  T('verytall', `Very tall — 6'4" or more`, `real tall, six four or better`, { scale: 1.17 }),
];

export const BUILDS = [
  T('thin', 'Thin, narrow shoulders', 'thin. Skinny, narrow through the shoulders', { w: 0.86, d: 0.9 }),
  T('average', 'Average build', 'average build, nothing that stands out', { w: 1.0, d: 1.0 }),
  T('heavy', 'Heavy set', 'heavy set', { w: 1.22, d: 1.2 }),
  T('broad', 'Broad, athletic shoulders', 'broad. Built like they load trucks', { w: 1.14, d: 1.02 }),
];

const HAIR_COLORS = [
  { id: 'black', name: 'black', hex: '#17141a', dark: '#0d0b10' },
  { id: 'brown', name: 'dark brown', hex: '#3d2a1a', dark: '#2a1c11' },
  { id: 'lightbrown', name: 'light brown', hex: '#6b4a2c', dark: '#4d341e' },
  { id: 'blond', name: 'blond', hex: '#b99553', dark: '#8f7038' },
  { id: 'red', name: 'red', hex: '#8a3a1c', dark: '#642713' },
  { id: 'grey', name: 'grey', hex: '#8d8a84', dark: '#6a6862' },
  { id: 'white', name: 'white', hex: '#cfcac0', dark: '#a5a099' },
];
const HAIR_STYLES = [
  { id: 'short', name: 'short' }, { id: 'long', name: 'long, past the shoulders' },
  { id: 'ponytail', name: 'pulled back in a ponytail' }, { id: 'mullet', name: 'a mullet' },
  { id: 'curly', name: 'curly and thick' }, { id: 'buzz', name: 'buzzed down to the scalp' },
  { id: 'bald', name: 'bald on top' }, { id: 'greasy', name: 'greasy, combed flat' },
];

export const FACIAL = [
  T('clean', 'Clean shaven', 'clean shaven'),
  T('stubble', 'Two days of stubble', `a couple days of stubble, hasn't shaved`),
  T('mustache', 'Thick mustache', 'a thick mustache'),
  T('beard', 'Full beard', 'a full beard'),
  T('goatee', 'Goatee', 'a goatee'),
  T('chops', 'Long sideburns', 'sideburns down to the jaw'),
];

export const GLASSES = [
  T('none', 'No glasses', 'no glasses'),
  T('round', 'Round wire-frame glasses', 'little round wire glasses'),
  T('square', 'Thick square frames', 'thick square frames'),
  T('aviator', 'Tinted aviators — indoors', `tinted aviators. Wearing them indoors, at night`),
];

export const HATS = [
  T('none', 'No hat', 'no hat'),
  T('cap', 'Baseball cap', 'a ball cap'),
  T('trucker', 'Mesh-back trucker cap', 'one of those mesh-back trucker caps'),
  T('beanie', 'Knit beanie', 'a knit beanie pulled down'),
  T('hood', 'Hood up', 'hood up, even inside'),
];

const COLORS = [
  { id: 'brown', name: 'brown', hex: '#5a3f22' },
  { id: 'navy', name: 'navy', hex: '#1e2a4a' },
  { id: 'olive', name: 'olive', hex: '#44492a' },
  { id: 'maroon', name: 'maroon', hex: '#4a1a1e' },
  { id: 'grey', name: 'grey', hex: '#4a4a50' },
  { id: 'black', name: 'black', hex: '#1a1a1e' },
  { id: 'denim', name: 'denim blue', hex: '#33507a' },
  { id: 'tan', name: 'tan', hex: '#8a7148' },
  { id: 'forest', name: 'forest green', hex: '#20402a' },
  { id: 'rust', name: 'rust orange', hex: '#7a3c1c' },
  { id: 'cream', name: 'cream', hex: '#b6ab8c' },
  { id: 'plum', name: 'plum', hex: '#3f2247' },
  { id: 'teal', name: 'teal', hex: '#1c5157' },
  { id: 'mustard', name: 'mustard yellow', hex: '#8a7317' },
];
const JACKET_KIND = ['corduroy jacket', 'denim jacket', 'leather jacket', 'windbreaker',
  'wool overcoat', 'letterman jacket', 'flannel shirt', 'trench coat', 'puffy parka',
  'bomber jacket', 'cardigan', 'work coat', 'track jacket', 'poncho'];

export const MARKS = [
  T('none', 'No visible marks', 'nothing distinctive on the face or hands'),
  T('scar', 'Scar through the left eyebrow', 'a scar. Runs right through the left eyebrow'),
  T('bandage', 'Bandaged right hand', 'a bandage on the right hand. Fresh'),
  T('tattoo', 'Dark tattoo on the neck', 'a tattoo on the neck, dark, up under the collar'),
  T('burn', 'Burn mark on the right cheek', 'a burn on the right cheek'),
  T('patch', 'Eye patch, left eye', 'an eye patch. Left eye'),
  T('split', 'Split, uneven eyebrow', 'one eyebrow split in half — old cut'),
];

export const GAITS = [
  T('normal', 'Walks normally', 'walks normal'),
  T('limp', 'Walks with a limp', 'a limp. Favors the right leg', { limp: 1 }),
  T('shuffle', 'Shuffles, drags the feet', 'shuffles. Drags the feet', { speed: 0.75 }),
  T('brisk', 'Moves fast, in a hurry', 'moves fast. Always in a hurry', { speed: 1.3 }),
  T('stiff', 'Stiff, upright walk', 'stiff. Holds himself very straight', { stiff: 1 }),
];

export const CARRY = [
  T('none', 'Empty handed', 'not carrying anything'),
  T('duffel', 'Canvas duffel bag', 'a canvas duffel bag. Heavy looking'),
  T('backpack', 'Backpack', 'a backpack'),
  T('gloves', 'Work gloves — indoors', 'work gloves. Keeps them on inside'),
  T('walkman', 'Walkman on the belt', 'a walkman clipped to the belt'),
  T('umbrella', 'Folded umbrella', 'a folded umbrella, and it has not rained in a week'),
];

export const SMELLS = [
  T('none', 'No notable smell', 'nothing you would notice'),
  T('gas', 'Smells of gasoline', 'gasoline. You will smell it before you see them'),
  T('smoke', 'Smells of cigarettes', 'cigarettes, heavy'),
  T('bleach', 'Smells of bleach', 'bleach. Like a cleaned floor'),
  T('oil', 'Smells of motor oil', 'motor oil'),
  T('cologne', 'Heavy cheap cologne', 'cologne, the cheap kind, too much of it'),
  T('wet', 'Smells of wet earth', 'wet dirt. Like a basement'),
];

export const VOICES = [
  T('low', 'Low, quiet voice', 'a low voice. Quiet talker', { pitch: 0.72, rough: 0.3 }),
  T('raspy', 'Raspy voice', 'raspy, like a smoker', { pitch: 0.85, rough: 0.9 }),
  T('nasal', 'Nasal voice', 'nasal', { pitch: 1.32, rough: 0.2 }),
  T('soft', 'Soft, careful voice', 'soft spoken. Picks his words', { pitch: 1.1, rough: 0.1 }),
  T('loud', 'Loud, carrying voice', 'loud. You will hear him from the door', { pitch: 0.98, rough: 0.5 }),
  T('flat', 'Flat, no inflection', 'flat. No music in it at all', { pitch: 0.9, rough: 0.15 }),
];

const SKIN = ['#d8ab84', '#c08e63', '#8d5f3c', '#5e3c26', '#e8c39e', '#a6714a', '#3f2a1c'];

/* Traits the player can verify by LOOKING. */
export const VISIBLE_KEYS = ['height', 'build', 'hair', 'facial', 'glasses', 'hat', 'jacket', 'pants', 'mark', 'gait', 'carry'];
/* Traits that need conversation or proximity. */
export const HIDDEN_KEYS = ['smell', 'voice'];
export const ALL_KEYS = [...VISIBLE_KEYS, ...HIDDEN_KEYS];

export const KEY_LABEL = {
  height: 'Height', build: 'Build', hair: 'Hair', facial: 'Face', glasses: 'Eyewear',
  hat: 'Headwear', jacket: 'Outerwear', pants: 'Trousers', mark: 'Distinguishing mark',
  gait: 'Walk', carry: 'Carrying', smell: 'Smell', voice: 'Voice',
};

/* ---------------- generation ---------------- */
export function randomAppearance(rng, force = {}) {
  const hairColor = rng.pick(HAIR_COLORS);
  const hairStyle = rng.pick(HAIR_STYLES);
  const jacketColor = rng.pick(COLORS);
  const jacketKind = rng.pick(JACKET_KIND);
  const pantsColor = rng.pick(COLORS);
  const shirtColor = rng.pick(COLORS);
  const a = {
    skin: rng.pick(SKIN),
    height: rng.pick(HEIGHTS),
    build: rng.pick(BUILDS),
    hair: {
      id: `${hairColor.id}-${hairStyle.id}`,
      color: hairColor, style: hairStyle,
      label: hairStyle.id === 'bald' ? `Bald, ${hairColor.name} at the sides` : `${cap(hairColor.name)} hair, ${hairStyle.name}`,
      bulletin: hairStyle.id === 'bald' ? `bald, what is left of it is ${hairColor.name}` : `${hairColor.name} hair, ${hairStyle.name}`,
    },
    facial: rng.pick(FACIAL),
    glasses: rng.pick(GLASSES),
    hat: rng.pick(HATS),
    jacket: {
      id: `${jacketColor.id}-${jacketKind}`,
      color: jacketColor, kind: jacketKind,
      label: `${cap(jacketColor.name)} ${jacketKind}`,
      bulletin: `a ${jacketColor.name} ${jacketKind}`,
    },
    shirt: shirtColor,
    pants: {
      id: pantsColor.id, color: pantsColor,
      label: `${cap(pantsColor.name)} trousers`,
      bulletin: `${pantsColor.name} pants`,
    },
    shoes: rng.pick(COLORS),
    mark: rng.pick(MARKS),
    gait: rng.pick(GAITS),
    carry: rng.pick(CARRY),
    smell: rng.pick(SMELLS),
    voice: rng.pick(VOICES),
  };
  Object.assign(a, force);
  return a;
}

/** Copy the listed traits from `src` onto a fresh appearance. Used for decoys. */
export function withTraits(base, src, keys) {
  const out = { ...base };
  for (const k of keys) out[k] = src[k];
  return out;
}

export function traitId(a, key) {
  const v = a[key];
  return v && (v.id !== undefined ? v.id : String(v));
}

export function sameTrait(a, b, key) { return traitId(a, key) === traitId(b, key); }

export function traitLabel(a, key) {
  const v = a[key];
  return (v && v.label) || String(v);
}

export function traitBulletin(a, key) {
  const v = a[key];
  return (v && v.bulletin) || String(v);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- names ---------------- */
const FIRST = ['Denise', 'Marty', 'Curtis', 'Ray', 'Lorraine', 'Ed', 'Patty', 'Duane',
  'Sheila', 'Vern', 'Bobbi', 'Gil', 'Wanda', 'Stan', 'Charlene', 'Dale', 'Roberta',
  'Kenny', 'Yvette', 'Norm', 'Trish', 'Hank', 'Marcy', 'Terry', 'Faye', 'Dwight',
  'Colleen', 'Rudy', 'Janine', 'Wes', 'Bev', 'Lonnie', 'Arlene', 'Merle', 'Doreen'];
const LAST = ['Pallozzi', 'Krebs', 'Vance', 'Dunlop', 'Marchetti', 'Ostrowski', 'Hale',
  'Bunting', 'Ferris', 'Novak', 'Cardoza', 'Whitlock', 'Deemer', 'Sackett', 'Rennick',
  'Pruitt', 'Mabry', 'Colley', 'Vogel', 'Tunstall', 'Ashby', 'Rierdon', 'Kowalczyk',
  'Bellweather', 'Stumpf', 'Draper', 'Hoyt', 'Lindqvist', 'Barrone', 'Mercer'];

export function randomName(rng) {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

/* ============================================================
   SKIN PAINTING -- draws the 128x128 atlas for one person.
   ============================================================ */
export function paintSkin(a) {
  return makeTex(ATLAS_SIZE, ATLAS_SIZE, (g) => {
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    g.fillStyle = '#000'; g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    const R = (name) => ATLAS[name];
    const box = (r, color) => { g.fillStyle = color; g.fillRect(r[0], r[1], r[2], r[3]); };
    const px = (r, x, y, w, h, color) => { g.fillStyle = color; g.fillRect(r[0] + x, r[1] + y, w, h); };
    const shade = (hex, k) => shadeHex(hex, k);

    const skin = a.skin;
    const hair = a.hair.color;
    const jkt = a.jacket.color.hex;
    const shirt = a.shirt.hex;
    const pants = a.pants.color.hex;
    const shoes = a.shoes.hex;

    /* ---- head ---- */
    for (const f of ['headF', 'headB', 'headL', 'headR', 'headT', 'headD']) box(R(f), skin);
    box(R('headL'), shade(skin, 0.86));
    box(R('headR'), shade(skin, 0.86));
    box(R('headB'), shade(skin, 0.78));
    box(R('headD'), shade(skin, 0.6));
    box(R('headT'), shade(skin, 1.06));

    // hair
    const hs = a.hair.style.id;
    if (hs !== 'bald') {
      box(R('headT'), hair.hex);
      px(R('headF'), 0, 0, 24, hs === 'buzz' ? 4 : 6, hair.hex);
      px(R('headB'), 0, 0, 24, hs === 'buzz' ? 5 : 9, hair.hex);
      px(R('headL'), 0, 0, 24, hs === 'buzz' ? 5 : 8, hair.dark);
      px(R('headR'), 0, 0, 24, hs === 'buzz' ? 5 : 8, hair.dark);
      if (hs === 'long' || hs === 'curly') {
        px(R('headB'), 0, 0, 24, 22, hair.hex);
        px(R('headL'), 0, 0, 7, 20, hair.dark);
        px(R('headR'), 17, 0, 7, 20, hair.dark);
      }
      if (hs === 'mullet') {
        px(R('headB'), 4, 0, 16, 23, hair.hex);
        px(R('headF'), 0, 0, 24, 4, hair.hex);
      }
      if (hs === 'ponytail') {
        px(R('headB'), 9, 0, 6, 22, hair.dark);
        px(R('headB'), 0, 0, 24, 8, hair.hex);
      }
      if (hs === 'greasy') {
        px(R('headF'), 0, 0, 24, 7, hair.dark);
        px(R('headF'), 2, 6, 14, 2, hair.hex);
      }
      if (hs === 'curly') {
        for (let i = 0; i < 26; i++) {
          const rr = R('headT');
          g.fillStyle = i % 2 ? hair.dark : hair.hex;
          g.fillRect(rr[0] + (i * 7) % 22, rr[1] + (i * 5) % 22, 3, 3);
        }
      }
    } else {
      px(R('headL'), 0, 8, 24, 5, hair.dark);
      px(R('headR'), 0, 8, 24, 5, hair.dark);
      px(R('headB'), 0, 10, 24, 6, hair.dark);
      px(R('headT'), 2, 2, 20, 20, shade(skin, 1.1));
    }

    /* ---- face on headF ---- */
    const F = R('headF');
    // brows
    g.fillStyle = hair.dark;
    g.fillRect(F[0] + 4, F[1] + 9, 6, 2);
    g.fillRect(F[0] + 14, F[1] + 9, 6, 2);
    // eyes
    g.fillStyle = '#efe9dd';
    g.fillRect(F[0] + 5, F[1] + 12, 5, 3);
    g.fillRect(F[0] + 14, F[1] + 12, 5, 3);
    g.fillStyle = '#1a1410';
    g.fillRect(F[0] + 7, F[1] + 13, 2, 2);
    g.fillRect(F[0] + 16, F[1] + 13, 2, 2);
    // nose + mouth
    g.fillStyle = shade(skin, 0.82);
    g.fillRect(F[0] + 11, F[1] + 14, 2, 4);
    g.fillStyle = shade(skin, 0.55);
    g.fillRect(F[0] + 8, F[1] + 19, 8, 1);

    // facial hair
    const fh = a.facial.id;
    if (fh === 'stubble') { g.fillStyle = hexA(hair.dark, 0.35); g.fillRect(F[0] + 4, F[1] + 16, 16, 7); }
    if (fh === 'mustache') { g.fillStyle = hair.dark; g.fillRect(F[0] + 8, F[1] + 17, 8, 2); }
    if (fh === 'beard') {
      g.fillStyle = hair.dark;
      g.fillRect(F[0] + 3, F[1] + 16, 18, 8);
      g.fillStyle = shade(skin, 0.9); g.fillRect(F[0] + 9, F[1] + 19, 6, 2);
      px(R('headD'), 0, 0, 24, 24, hair.dark);
    }
    if (fh === 'goatee') { g.fillStyle = hair.dark; g.fillRect(F[0] + 9, F[1] + 17, 6, 6); }
    if (fh === 'chops') {
      g.fillStyle = hair.dark;
      g.fillRect(F[0] + 2, F[1] + 8, 3, 12); g.fillRect(F[0] + 19, F[1] + 8, 3, 12);
    }

    // distinguishing mark
    switch (a.mark.id) {
      case 'scar':
        g.fillStyle = '#8c3a30'; g.fillRect(F[0] + 5, F[1] + 6, 2, 9);
        g.fillStyle = '#b5584a'; g.fillRect(F[0] + 5, F[1] + 7, 1, 7); break;
      case 'burn':
        g.fillStyle = hexA('#7a3324', 0.8);
        g.fillRect(F[0] + 15, F[1] + 15, 6, 6); g.fillRect(F[0] + 17, F[1] + 13, 3, 3); break;
      case 'patch':
        g.fillStyle = '#0d0d10'; g.fillRect(F[0] + 4, F[1] + 11, 7, 5);
        g.fillRect(F[0] + 3, F[1] + 9, 18, 1); break;
      case 'split':
        g.fillStyle = shade(skin, 1.05); g.fillRect(F[0] + 6, F[1] + 9, 2, 2); break;
      case 'tattoo':
        px(R('headD'), 4, 2, 8, 6, '#1b2a4a');
        px(R('torsoF'), 12, 1, 7, 4, '#1b2a4a'); break;
      case 'bandage':
        box(R('hand'), '#d9d2be');
        px(R('hand'), 0, 5, 16, 2, '#b8b09a'); break;
      default: break;
    }

    // glasses
    if (a.glasses.id !== 'none') {
      const gl = a.glasses.id;
      const frame = gl === 'aviator' ? '#c9b47a' : gl === 'square' ? '#1a1a1e' : '#8d8a84';
      g.fillStyle = frame;
      if (gl === 'square') {
        g.fillRect(F[0] + 3, F[1] + 10, 8, 7); g.fillRect(F[0] + 13, F[1] + 10, 8, 7);
        g.fillStyle = hexA('#0d1218', 0.55);
        g.fillRect(F[0] + 4, F[1] + 11, 6, 5); g.fillRect(F[0] + 14, F[1] + 11, 6, 5);
      } else {
        g.fillRect(F[0] + 4, F[1] + 11, 7, 5); g.fillRect(F[0] + 13, F[1] + 11, 7, 5);
        g.fillStyle = gl === 'aviator' ? hexA('#2a1c10', 0.85) : hexA('#a8c8d8', 0.3);
        g.fillRect(F[0] + 5, F[1] + 12, 5, 3); g.fillRect(F[0] + 14, F[1] + 12, 5, 3);
      }
      g.fillStyle = frame;
      g.fillRect(F[0] + 11, F[1] + 12, 2, 1);
      px(R('headL'), 0, 12, 24, 1, frame);
      px(R('headR'), 0, 12, 24, 1, frame);
    }

    /* ---- hat ---- */
    const hat = a.hat.id;
    if (hat !== 'none') {
      const hatCol = hat === 'hood' ? jkt : ['#1a1a1e', '#4a1a1e', '#1e2a4a', '#20402a', '#5a3f22'][(a.skin.length + a.hair.color.id.length) % 5];
      box(R('hatS'), hatCol);
      box(R('hatT'), shade(hatCol, 1.12));
      box(R('hatB'), shade(hatCol, 0.6));
      if (hat === 'trucker') {
        px(R('hatS'), 0, 0, 32, 7, '#d8cfae');
        px(R('hatT'), 0, 12, 24, 12, '#d8cfae');
      }
      if (hat === 'beanie') {
        px(R('hatS'), 0, 11, 32, 5, shade(hatCol, 0.75));
        for (let i = 0; i < 32; i += 4) px(R('hatS'), i, 0, 2, 16, shade(hatCol, 1.1));
      }
      if (hat === 'cap' || hat === 'trucker') px(R('hatS'), 6, 2, 8, 5, '#c9a227');
      if (hat === 'hood') {
        px(R('headL'), 0, 0, 6, 24, shade(jkt, 0.8));
        px(R('headR'), 18, 0, 6, 24, shade(jkt, 0.8));
        px(R('headF'), 0, 0, 24, 5, shade(jkt, 0.7));
        px(R('headB'), 0, 0, 24, 24, shade(jkt, 0.75));
      }
    }

    /* ---- torso ---- */
    box(R('torsoF'), jkt);
    box(R('torsoB'), shade(jkt, 0.82));
    box(R('torsoL'), shade(jkt, 0.88));
    box(R('torsoR'), shade(jkt, 0.88));
    box(R('torsoT'), shade(jkt, 1.08));
    box(R('torsoD'), shade(jkt, 0.5));
    // shirt showing through the open jacket
    px(R('torsoF'), 11, 0, 10, 44, shirt);
    px(R('torsoF'), 9, 0, 2, 44, shade(jkt, 1.15));
    px(R('torsoF'), 21, 0, 2, 44, shade(jkt, 0.7));
    // collar
    px(R('torsoF'), 7, 0, 18, 4, shade(jkt, 1.2));
    px(R('torsoF'), 13, 0, 6, 6, shade(skin, 0.9));
    // jacket specifics
    const jk = a.jacket.kind;
    if (jk === 'denim jacket') {
      for (let y = 6; y < 44; y += 6) px(R('torsoF'), 0, y, 32, 1, shade(jkt, 0.85));
      px(R('torsoF'), 3, 10, 6, 5, shade(jkt, 1.15));
      px(R('torsoF'), 23, 10, 6, 5, shade(jkt, 1.15));
    } else if (jk === 'flannel shirt') {
      for (let y = 0; y < 44; y += 5) px(R('torsoF'), 0, y, 32, 2, shade(jkt, 0.7));
      for (let x = 0; x < 32; x += 5) px(R('torsoF'), x, 0, 2, 44, hexA(shade(jkt, 1.3), 0.45));
    } else if (jk === 'corduroy jacket') {
      for (let x = 0; x < 32; x += 3) px(R('torsoF'), x, 4, 1, 40, shade(jkt, 0.82));
    } else if (jk === 'leather jacket') {
      px(R('torsoF'), 8, 2, 3, 42, shade(jkt, 1.5));
      px(R('torsoF'), 0, 4, 32, 2, shade(jkt, 1.25));
    } else if (jk === 'letterman jacket' || jk === 'varsity') {
      px(R('torsoF'), 0, 0, 32, 44, jkt);
      px(R('torsoF'), 11, 0, 10, 44, '#d8cfae');
      px(R('torsoF'), 13, 12, 7, 9, shade(jkt, 1.4));
    } else if (jk === 'puffy parka') {
      for (let y = 2; y < 44; y += 7) px(R('torsoF'), 0, y, 32, 5, shade(jkt, 1.08));
    } else if (jk === 'track jacket') {
      px(R('torsoF'), 2, 0, 3, 44, '#d8cfae');
      px(R('torsoF'), 27, 0, 3, 44, '#d8cfae');
    }
    // buttons
    if (jk !== 'leather jacket') {
      g.fillStyle = shade(jkt, 1.5);
      for (let y = 10; y < 42; y += 9) g.fillRect(R('torsoF')[0] + 10, R('torsoF')[1] + y, 2, 2);
    }

    /* ---- arms / hands ---- */
    box(R('arm'), shade(jkt, 0.94));
    px(R('arm'), 0, 38, 16, 6, shade(jkt, 0.7));   // cuff
    px(R('arm'), 0, 0, 16, 3, shade(jkt, 1.1));    // shoulder seam
    if (a.mark.id !== 'bandage') box(R('hand'), skin);
    if (a.carry.id === 'gloves') { box(R('hand'), '#2a2620'); px(R('arm'), 0, 34, 16, 4, '#2a2620'); }

    /* ---- legs / shoes ---- */
    box(R('leg'), pants);
    px(R('leg'), 0, 0, 16, 3, shade(pants, 0.8));
    px(R('leg'), 6, 0, 2, 44, shade(pants, 0.88));
    if (a.pants.color.id === 'denim') for (let y = 0; y < 44; y += 7) px(R('leg'), 0, y, 16, 1, shade(pants, 0.86));
    box(R('shoe'), shoes);
    box(R('shoeT'), shade(shoes, 0.8));
    px(R('shoe'), 0, 12, 16, 4, '#111114');

    /* ---- carried bag ---- */
    box(R('bag'), a.carry.id === 'duffel' ? '#3a3226' : a.carry.id === 'backpack' ? '#22303a' : '#2a2a30');
    px(R('bag'), 0, 8, 24, 3, '#15151a');
    px(R('bag'), 3, 3, 6, 4, '#8d8a84');

    /* ---- worn, dirty, 1996 ---- */
    const d = g.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const n = (Math.random() - 0.5) * 16;
      p[i] += n; p[i + 1] += n; p[i + 2] += n;
    }
    g.putImageData(d, 0, 0);
  });
}

/** 64x64 close-up for the dialogue box. */
export function paintPortrait(a, canvas) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const W = canvas.width, H = canvas.height;
  const hair = a.hair.color, skin = a.skin;
  g.fillStyle = '#0a0c14'; g.fillRect(0, 0, W, H);
  // shoulders
  g.fillStyle = a.jacket.color.hex; g.fillRect(6, 48, 52, 16);
  g.fillStyle = a.shirt.hex; g.fillRect(26, 48, 12, 16);
  g.fillStyle = shadeHex(skin, 0.85); g.fillRect(26, 42, 12, 8);
  // head
  const hw = a.build.id === 'heavy' ? 17 : a.build.id === 'thin' ? 13 : 15;
  g.fillStyle = skin; g.fillRect(32 - hw, 10, hw * 2, 34);
  g.fillStyle = shadeHex(skin, 0.85); g.fillRect(32 + hw - 4, 10, 4, 34);
  const hs = a.hair.style.id;
  if (hs !== 'bald') {
    g.fillStyle = hair.hex;
    g.fillRect(32 - hw, 6, hw * 2, hs === 'buzz' ? 7 : 11);
    if (hs === 'long' || hs === 'curly') { g.fillRect(32 - hw - 3, 8, 4, 32); g.fillRect(32 + hw - 1, 8, 4, 32); }
    if (hs === 'mullet') { g.fillRect(32 - hw - 2, 26, 3, 16); g.fillRect(32 + hw - 1, 26, 3, 16); }
    if (hs === 'greasy') { g.fillStyle = hair.dark; g.fillRect(32 - hw, 12, hw * 2, 3); }
  } else { g.fillStyle = hair.dark; g.fillRect(32 - hw, 16, 3, 10); g.fillRect(32 + hw - 3, 16, 3, 10); }
  // eyes
  g.fillStyle = hair.dark; g.fillRect(32 - 11, 21, 8, 2); g.fillRect(32 + 3, 21, 8, 2);
  g.fillStyle = '#efe9dd'; g.fillRect(32 - 11, 24, 8, 5); g.fillRect(32 + 3, 24, 8, 5);
  g.fillStyle = '#17110c'; g.fillRect(32 - 8, 25, 3, 3); g.fillRect(32 + 6, 25, 3, 3);
  // nose, mouth
  g.fillStyle = shadeHex(skin, 0.8); g.fillRect(31, 28, 3, 6);
  g.fillStyle = shadeHex(skin, 0.5); g.fillRect(27, 37, 10, 2);
  // facial hair
  const fh = a.facial.id;
  if (fh === 'stubble') { g.fillStyle = hexA(hair.dark, 0.4); g.fillRect(32 - hw + 2, 32, hw * 2 - 4, 12); }
  if (fh === 'mustache') { g.fillStyle = hair.dark; g.fillRect(26, 33, 12, 3); }
  if (fh === 'beard') { g.fillStyle = hair.dark; g.fillRect(32 - hw + 1, 31, hw * 2 - 2, 14); g.fillStyle = shadeHex(skin, 0.9); g.fillRect(28, 36, 8, 3); }
  if (fh === 'goatee') { g.fillStyle = hair.dark; g.fillRect(28, 34, 8, 9); }
  if (fh === 'chops') { g.fillStyle = hair.dark; g.fillRect(32 - hw, 17, 4, 17); g.fillRect(32 + hw - 4, 17, 4, 17); }
  // mark
  if (a.mark.id === 'scar') { g.fillStyle = '#8c3a30'; g.fillRect(32 - 10, 15, 3, 13); }
  if (a.mark.id === 'burn') { g.fillStyle = hexA('#7a3324', 0.8); g.fillRect(32 + 5, 30, 9, 9); }
  if (a.mark.id === 'patch') { g.fillStyle = '#0d0d10'; g.fillRect(32 - 12, 22, 10, 8); g.fillRect(32 - 13, 19, 28, 2); }
  if (a.mark.id === 'tattoo') { g.fillStyle = '#1b2a4a'; g.fillRect(26, 44, 10, 5); }
  // glasses
  if (a.glasses.id !== 'none') {
    const gl = a.glasses.id;
    g.fillStyle = gl === 'aviator' ? '#c9b47a' : gl === 'square' ? '#1a1a1e' : '#8d8a84';
    g.fillRect(32 - 13, 22, 11, 9); g.fillRect(32 + 2, 22, 11, 9); g.fillRect(32 - 2, 25, 4, 2);
    g.fillStyle = gl === 'aviator' ? hexA('#2a1c10', 0.85) : hexA('#a8c8d8', 0.28);
    g.fillRect(32 - 12, 23, 9, 7); g.fillRect(32 + 3, 23, 9, 7);
  }
  // hat
  if (a.hat.id !== 'none') {
    const hatCol = a.hat.id === 'hood' ? a.jacket.color.hex : ['#1a1a1e', '#4a1a1e', '#1e2a4a', '#20402a', '#5a3f22'][(a.skin.length + hair.id.length) % 5];
    g.fillStyle = hatCol;
    if (a.hat.id === 'hood') { g.fillRect(32 - hw - 5, 2, hw * 2 + 10, 14); g.fillRect(32 - hw - 5, 2, 6, 44); g.fillRect(32 + hw - 1, 2, 6, 44); }
    else if (a.hat.id === 'beanie') { g.fillRect(32 - hw - 1, 2, hw * 2 + 2, 14); g.fillStyle = shadeHex(hatCol, 0.75); g.fillRect(32 - hw - 1, 12, hw * 2 + 2, 4); }
    else { g.fillRect(32 - hw - 1, 4, hw * 2 + 2, 9); g.fillRect(32 - hw - 6, 12, hw * 2 + 12, 3); }
  }
  // scanlines + grain so the portrait matches the render
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1);
  const d = g.getImageData(0, 0, W, H), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (Math.random() - 0.5) * 26; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  g.putImageData(d, 0, 0);
}

/* ---------------- colour helpers ---------------- */
export function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k;
  r = r > 255 ? 255 : r | 0; g = g > 255 ? 255 : g | 0; b = b > 255 ? 255 : b | 0;
  return `rgb(${r},${g},${b})`;
}
export function hexA(hex, a) {
  if (hex.startsWith('rgb')) return hex.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
