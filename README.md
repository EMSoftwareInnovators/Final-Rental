# BE KIND, REWIND

A first-person horror game set on the graveyard shift at **Sunset Video**,
4412 Delaney Ave, October 1996.

You run the counter alone. Customers bring tapes back — some rewound, some not,
some days overdue. You take the late fees, you rewind what needs rewinding, and
you put every tape back on its own genre run. Other customers pull tapes off the
shelves themselves and expect to be rung up. They have opinions about your
carpet, your horror section, and how long you are taking.

At the start of every shift a county deputy comes in and reads you a description
of a man who has been killing people who work counters after ten at night.

Some nights he comes in. He is polite. He pays cash. He asks what time you lock
up, and whether there is anyone in the back.

---

## Running it

```bash
npm start          # serves on http://localhost:8080
```

Then open <http://localhost:8080> and click to grab the mouse.

There is no build step and no dependency to install — the whole game is
hand-written ES modules. It **must** be served over `http://`, because browsers
refuse to load ES modules from `file://`.

To run the automated checks (renderer, simulation soak, scripted playthrough):

```bash
npm install --no-save playwright-core   # only needed for the checks
npm run check
```

---

## Controls

| | |
|---|---|
| `W A S D` | walk &nbsp;&nbsp; (`SHIFT` to hurry) |
| mouse | look |
| `E` / left click | interact, talk, advance dialogue |
| `1`–`4`, or `↑ ↓` + `E` | choose a reply |
| `TAB` | notepad — the bulletin next to whoever you are looking at |
| `G` | put down the tape in your hand |
| `ESC` | pause / back out of a conversation |

---

## The job

**Returns.** Take the tape (or have them drop it in the bin). Late fees run a
dollar a day and the register wants them collected. Not everyone agrees they are
late. Some of them are lying, some of them are right, and you cannot tell which
from the screen.

**Rewinding.** A tape that comes back unwound has to go through the rewinder on
the counter before it goes back on a shelf. It takes about six seconds, and it
keeps running while you serve somebody else.

**Shelving.** Six runs: HORROR, COMEDY, ACTION, SCI-FI, DRAMA, FAMILY. A tape on
the wrong run counts against your shift. So does a tape you shelved without
rewinding, and so does anything still sitting on the counter at midnight.

**Rentals.** People pull their own tapes. Ring them up, take the money. Some of
them do not have any money, and what you do about that is up to you — an
account, a partial payment, a free rental out of your own numbers, or a no.

**Patience.** Everyone has a fuse and the length of it depends on who they are.
The commuter who is double-parked is not the retiree who wants to tell you about
her sister's dog. Let someone stand there too long and they will find something
to be angry about. Some of them were going to find something anyway.

---

## The other thing

The deputy's description is the only thing you get. It is never complete, and it
gets thinner every night as the witness statements dry up.

- **Look at people.** Standing in front of someone long enough takes in the
  obvious things — height, build, hair, coat, whatever is on their face and in
  their hands. Getting close enough tells you what they smell like. Talking to
  them tells you what they sound like.
- **`TAB` compares.** The bulletin on the left, the person in front of you on the
  right, matches highlighted. Someone can match four of six lines and be nobody.
- **He may come in first as a customer**, browse, and check out a tape. He is
  the calmest person who will talk to you all night. He will ask you questions.
  How you answer them changes how long you have later.
- **If you are sure:** lock the front door, then pick up the phone. The deadbolt
  only buys minutes — on a bad night, not many. Locking it is not the win. The
  phone is the win.
- **If you are wrong:** they put a regular customer face down on the carpet in
  front of six people, and the district manager drives in at two in the morning
  to take your keys.

Four ways a night ends: he never shows and you clock out into a harder shift
tomorrow; he gets in and reaches you; you call it in on the wrong person; or you
call it in on the right one.

---

## What it is made of

No engine, no libraries, no asset files. Every polygon, texture, animation and
sound is generated at runtime by about 6,000 lines of JavaScript.

### The renderer

`src/engine/raster.js` is a software triangle rasterizer written to reproduce
1996 hardware behaviour rather than imitate it with a filter:

- **Integer vertex snapping.** Projected vertices are rounded to whole pixels,
  exactly like the PlayStation's GTE, which had no subpixel precision. This is
  the source of the polygon wobble on anything that moves.
- **Affine texture mapping.** UVs are interpolated linearly in screen space with
  no perspective correction, so textures swim across large surfaces. The period
  fix was to subdivide big polygons, so the floor, ceiling and walls are built as
  grids of roughly one-metre tiles — which is why they are.
- **Per-vertex shading with black fog** folded into a single interpolated scalar,
  so the whole shading step is two multiplies per pixel. There are no lightmaps
  and no per-pixel lights; the store's nine fluorescents are baked into vertex
  colours at build time.
- **Nearest-neighbour texels**, a 1/z depth buffer, near-plane clipping, and
  blend modes for the glass.

`src/engine/postfx.js` is the tape deck on top: 15-bit colour quantisation with a
4×4 Bayer dither (the PlayStation dithered in hardware; that is where the
crosshatch in the gradients comes from), composite chroma bleed, phosphor
ghosting, scanlines, a rolling head-switching band, dropout flecks, and the
garbage line at the bottom of the frame that a real VHS never quite hides.

Everything renders into a 320×240 buffer and is scaled up with nearest-neighbour.

### Everything else

| | |
|---|---|
| `engine/mesh.js` | mesh construction, subdivision, texture atlassing |
| `engine/texture.js` | every texture in the store, drawn procedurally |
| `engine/audio.js` | WebAudio synthesis — fluorescent hum, the rewinder motor, DTMF, dialogue blips pitched per character, a dread bed that tightens |
| `game/world.js` | the store: floor plan, geometry, lighting bake, collision |
| `game/appearance.js` | physical traits. Each one changes the model, gives the deputy a line, and gives you a line to tick off |
| `game/personality.js` | fifteen archetypes with their own patience, honesty, wealth and voice |
| `game/dialogue.js` | branching conversation built on demand against live state |
| `game/customer.js` | arrival, browsing, queueing, patience, anger, leaving |
| `game/killer.js` | the two acts |
| `game/night.js` | the shift director: suspect, bulletin, decoys, schedule, difficulty |
| `game/actor.js` | the low-poly humanoid — about ninety triangles a person |

### Difficulty

Each night the store gets busier, tempers get shorter, the bulletin loses a
detail, more customers are seeded to match most of the description, and he moves
sooner and breaks in faster. Decoys are generated to share as much of the
bulletin as the night allows but are always guaranteed to differ on at least one
described trait — the description is always enough to clear an innocent person,
if you actually check all of it.
