# Alpha 1
# Development Note

This repo originally started as an experiment to see how far Claude Code could take a game concept when regularly supplied with prompts from a locally hosted LLM, with minimal human intervention.

The project began as a straightforward first-person horror game set in a video rental store. Over the last few days, the automated prompting began introducing increasingly bizarre, off-scope mechanics and overemphasizing crude humor in ways that did not fit the initial concept.

I've reverted the repository to the last stable version containing the core horror and simulation features.

I’m now developing the concept further with the goal of turning it into a complete game for eventual release.

# FINAL RENTAL

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

It **must** be served over `http://`. Opening `index.html` straight off disk
will show a blank screen, because browsers refuse to load ES modules from
`file://`.

**Browser:** anything from about 2018 on — Safari 12+, Chrome 63+, Firefox 60+.
The game needs ES modules and `<canvas>`, and nothing newer than that. Sound
starts on your first click.

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

**Rentals.** People pull their own tapes — and they take their time about it.
They drift to a section, read the backs of a few boxes, pull one out, turn it
over, put it back and try somewhere else. Tell them one is good and they will
take your word for it. Tell them you close soon and they will settle for
whatever is in their hand.

**Money is paper.** Nothing goes straight into the till. They hand you a bill,
it sits in your hand until you walk it to the register and ring it up, and if
they gave you a twenty for a three dollar rental they are standing at your
counter until you count their change back out of the drawer. Cash still in your
hand at midnight is cash you have to explain.

Some of them do not have any money at all, and what you do about that is up to
you — an account, a partial payment, a free rental out of your own numbers, or
a no.

**And some of them are not all there.** A man wants the number three with no
onions and asks whether the shake machine is working. A woman has a load of
whites in the car and wants change for the machines. Someone is holding ticket
B-forty-one and would like to renew their license. You can explain, or you can
play along and see how far it goes — playing along makes them love you, and
people who love you buy things.

Others are in the right shop with the wrong idea entirely: the tape that has to
work in a Betamax, the one returned to the wrong chain, the customer who
believes renting is just buying very slowly, and the man who has brought his
entire VCR in on a cart because yours does not make the noise.

**Patience.** Everyone has a fuse and the length of it depends on who they are.
The commuter who is double-parked is not the retiree who wants to tell you about
her sister's dog. Let someone stand there too long and they will find something
to be angry about. Some of them were going to find something anyway.

---

## The other thing

The deputy's description is the only thing you get. It is never complete, and it
gets thinner every night as the witness statements dry up.

- **Look at people.** Standing in front of someone long enough takes in the
  obvious things — sex, height, build, hair, coat, whatever is on their face and
  in their hands. Getting close enough tells you what they smell like. Talking
  to them tells you what they sound like. Everything the deputy can describe is
  on the model: a ponytail is a ponytail, a limp is a limp, and the duffel bag
  is really there.
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

### Difficulty

Each night the store gets busier, tempers get shorter, the bulletin loses a
detail, more customers are seeded to match most of the description, and he moves
sooner and breaks in faster. Decoys are generated to share as much of the
bulletin as the night allows but are always guaranteed to differ on at least one
described trait — the description is always enough to clear an innocent person,
if you actually check all of it.

---

## What it is made of

No engine, no libraries, no asset files. Every polygon, texture, animation and
sound is generated at runtime by about 6,000 lines of JavaScript.

### The renderer

`src/engine/raster.js` is a software triangle rasterizer written to reproduce
the hardware of a classic PlayStation rather than imitate it with a filter:

- **Integer vertex snapping.** Projected vertices are rounded to whole pixels,
  exactly like the PlayStation's GTE, which had no subpixel precision. This is
  the source of the polygon wobble on anything that moves.
- **Lofted, faceted bodies.** People are not boxes. Every part is a stack of
  cross-sections skinned into a tapered solid — a torso that narrows at the
  waist and slopes at the shoulders, an eight-sided skull with one flat panel
  for the face, limbs that thin toward the wrist. Build and sex are baked into
  separate meshes rather than squashed in with a scale factor, so "heavy set"
  and "thin, narrow shoulders" read from across the shop, which they have to.
- **Affine texture mapping.** UVs are interpolated linearly in screen space with
  no perspective correction, so textures swim across large surfaces. The period
  fix was to subdivide big polygons, so the floor, ceiling and walls are built as
  grids of roughly one-metre tiles — which is why they are.
- **Per-vertex shading with black fog** folded into a single interpolated scalar,
  so the whole shading step is two multiplies per pixel. There are no lightmaps
  and no per-pixel lights; the store's nine fluorescents are baked into vertex
  colors at build time.
- **Nearest-neighbour texels**, a 1/z depth buffer, near-plane clipping, and
  blend modes for the glass.

`src/engine/postfx.js` is the tape deck on top: 15-bit color quantization with a
4×4 Bayer dither (the PlayStation dithered in hardware; that is where the
crosshatch in the gradients comes from), composite chroma bleed, phosphor
ghosting, scanlines, a rolling head-switching band, dropout flecks, and the
garbage line at the bottom of the frame that a real VHS never quite hides.

Everything renders into a 320×240 buffer and is scaled up with nearest-neighbor.
