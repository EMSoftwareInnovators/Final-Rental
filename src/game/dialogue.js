/* ============================================================
   dialogue.js -- conversations. A node is a plain object with a
   line of speech and up to four player replies; each reply is a
   closure that mutates the world and returns the next node (or
   null to end the exchange). Because nodes are built on demand
   they always see live state: the fee that is actually owed, the
   tape that is actually in your hands, how annoyed they actually
   are.
   ============================================================ */
import { line } from './personality.js';
import { TAPE_TALK, SEEN_IT } from './chatter.js';
import { GENRE_LABEL, GENRES, tapeLabel, lateFee, mediaWord } from './tapes.js';

const money = (v) => `$${v.toFixed(2)}`;

export class DialogueRunner {
  constructor() { this.node = null; this.sel = 0; this.person = null; this.onEnd = null; }
  get active() { return !!this.node; }
  start(person, node, onEnd) {
    this.person = person; this.node = node; this.sel = 0; this.onEnd = onEnd || null;
    return node;
  }
  move(d) {
    if (!this.node || !this.node.choices || !this.node.choices.length) return false;
    const n = this.node.choices.length;
    this.sel = (this.sel + d + n) % n;
    return true;
  }
  /** Take the selected reply (or advance a reply-less node). Returns true if the talk continues. */
  pick() {
    if (!this.node) return false;
    const ch = this.node.choices;
    let next = null;
    if (ch && ch.length) {
      const c = ch[Math.min(this.sel, ch.length - 1)];
      if (c.disabled) return true;
      next = c.fn ? c.fn() : null;
    } else if (this.node.next) {
      next = this.node.next();
    }
    this.node = next || null;
    this.sel = 0;
    if (!this.node) { const p = this.person; this.person = null; if (this.onEnd) this.onEnd(p); }
    return !!this.node;
  }
  cancel() {
    const p = this.person;
    this.node = null; this.person = null;
    if (this.onEnd) this.onEnd(p);
  }
}

/* ---------------- node helpers ---------------- */
const say = (person, text, choices, extra = {}) => ({
  person, text, choices: choices || null, ...extra,
});
const reply = (label, fn, opts = {}) => ({ label, fn, ...opts });

/* ============================================================
   THE OPENING BRIEFING -- a sheriff's deputy, every night.
   ============================================================ */
export function buildOfficerIntro(officer, bulletin, caseFile, ctx) {
  const rng = ctx.rng;
  let asked = 0;
  let c_toldNotes = false;
  const extras = bulletin.extra.slice();
  const C = caseFile || {};
  const A = C.angle || {};

  const notepadLine = () => say(officer,
    `Write it down. All of it.\n\nYou keep that where you can get at it -- ${ctx.notesKey()} -- and you hold it up against every face that comes through that door. Not most of it. All of it.`,
    [reply(`I've got it.`, () => outro())]);

  const outro = () => say(officer,
    bulletin.certain
      ? `Keep that door where you can see it. If someone matching that comes in — you don't confront them, you don't be clever. You lock the door and you get on that phone.\n\nAnd clerk? Be sure. We had a fella call it in last week on his own mailman.`
      : `Might be nothing tonight. Might be. Either way — you see it, you lock up and you call. Be sure before you do.`,
    [reply('Understood.', () => { ctx.finishIntro(); return null; })]);

  /* Why it is a different man tonight.
     A player who is paying attention will notice that the person they put
     in a cruiser on Tuesday is not the person at the glass on Wednesday,
     and the deputy is the only one in the building who can account for it.
     He has a different account every few nights, and none of them are
     especially reassuring. */
  const theOtherOne = () => say(officer,
    `${A.prior || `We took somebody off the street last night.`}\n\n${A.lead || ''}`, [
    reply(`So it isn't the same person.`, () => say(officer,
      `${A.why || `No. It is not.`}`, [
      reply(`How many of them are there?`, () => say(officer,
        rng.pick([
          `I have asked that question in three meetings and nobody will put a number on it.`,
          `More than we have said publicly. That is as far as I will go.`,
          `Enough that we stopped numbering them and started dating them.`,
        ]), [reply(`...Right.`, () => detail())])),
      reply(`Then the description's no good to me.`, () => say(officer,
        `The description is what we have got tonight. Tomorrow it will be a different one and I will read you that as well.`,
        [reply(`Go on, then.`, () => detail())])),
    ])),
    reply(`Just give me tonight's.`, () => detail()),
  ]);

  const askNode = () => {
    const cs = [];
    if (extras.length && asked < 2) {
      cs.push(reply('Anything else you can give me?', () => {
        asked++;
        const e = extras.shift();
        ctx.addBulletinDetail(e);
        return say(officer, e.officerLine, [
          ...(extras.length && asked < 2 ? [reply('Anything else?', () => askNode().choices[0].fn())] : []),
          reply(`Got it.`, () => outro()),
        ]);
      }));
    }
    cs.push(reply(`How sure are you it's tonight?`, () => say(officer,
      bulletin.certain
        ? `I'm not. Nobody is. But three in six weeks and every one of them was working a counter after ten at night. You're a counter after ten at night.`
        : `I'm not sure of anything. That's the job. Somebody saw somebody. Could be a guy who looks like a guy.`,
      [reply('Great. Thanks.', () => outro())])));
    cs.push(reply(`I'll keep an eye out.`, () => outro()));
    return say(officer, `Anything you want to ask me, ask it now. I'm not coming back tonight.`, cs);
  };

  const detail = () => {
    // this is the moment the description actually reaches your notepad
    ctx.learnBulletin();
    return say(officer, bulletin.description, [
    reply('Let me write that down.', () => (c_toldNotes ? askNode() : (c_toldNotes = true, notepadLine()))),
    reply(`That's half the men in this county.`, () => say(officer,
      `Yeah. It is. That's the problem.`, [reply('...', () => askNode())])),
    ]);
  };

  const greet = rng.pick([
    `Evening. Sorry — I know you're closing soon. County sheriff's office.`,
    `Evening. You the only one on tonight? ... Figures.`,
    `Don't get up. This'll take two minutes.`,
  ]);

  const alias = C.alias ? ` The papers are calling it ${C.alias}.` : '';
  const opener = C.caughtLast
    ? `${greet}\n\nWe've got a new description out on somebody working this side of the river. New one. Not the one from last night.`
    : `${greet}\n\nWe've got a description out on somebody working this side of the river. I'm hitting every business still lit up.${alias}`;

  return say(officer, opener, [
    ...(C.caughtLast ? [reply(`Hold on. You caught somebody last night.`, () => theOtherOne())] : []),
    reply(`Go ahead.`, () => detail()),
    reply(`Is this about the ones on the news?`, () => say(officer,
      `The news has about a third of it.${alias} Here's what matters to you tonight.`,
      [reply('Okay.', () => detail())])),
  ]);
}

/* ============================================================
   CUSTOMERS
   ============================================================ */
export function talkTo(c, ctx, opts = {}) {
  if (c.awaitingChange) return changeRoot(c, ctx);
  if (c.mood <= 0 && !c.resolvedAnger) return angryRoot(c, ctx);
  if (c.script === 'confused' && !c.confusionResolved) {
    c.confusionResolved = true;
    return confusedRoot(c, ctx);
  }
  /* Business is done at the window, at the front of the line. Anywhere
     else you can talk to somebody, but you cannot take their money. */
  if (c.special && c.script === 'special' && !c.checkedOut) return specialRoot(c, ctx);
  if (opts.atCounter === false) return idleRoot(c, ctx);
  /* Everything below here reads c.tape and its price or its due date.
     Two people never have one: a shopper still working down the shelves,
     and somebody you already served, whose tape is in your hands. Talking
     to either of them used to dereference null and take the whole frame
     loop down with it. */
  if (c.checkedOut || c.gaveTape || c.served) return farewell(c, ctx);
  if (!c.tape) return idleRoot(c, ctx);
  if (c.script === 'return') return returnRoot(c, ctx);
  return rentRoot(c, ctx);
}

/* ---------------- small talk (shared) ---------------- */
function smallTalk(c, ctx, then) {
  const rng = ctx.rng;
  const txt = line(c, 'smalltalk', rng, '...');
  const isProbe = c.isKiller;
  const cs = [];
  if (isProbe) {
    // Answering the killer honestly tells him what he wants to know.
    cs.push(reply(`Yeah, it's just me tonight.`, () => {
      ctx.killerIntel(2);
      return say(c, `Hm. That's a lot of building for one person.`, [reply('...', () => then())]);
    }, { risk: true }));
    cs.push(reply(`My manager's in the back.`, () => {
      ctx.killerIntel(-2);
      return say(c, rng.pick([`...Is he. Alright.`, `I didn't see a car out front.`, `Of course. Sure.`]),
        [reply('...', () => then())]);
    }));
    cs.push(reply(`Why do you ask?`, () => {
      ctx.killerIntel(-1);
      return say(c, rng.pick([
        `No reason. Making conversation.`,
        `People are friendly here. I like that about the place.`,
        `Just talking. Long night for everybody.`,
      ]), [reply('...', () => then())]);
    }));
  } else {
    cs.push(reply(`Mm-hm.`, () => then()));
    cs.push(reply(`Is that right?`, () => {
      ctx.mood(c, +6);
      const follow = line(c, 'smalltalk', rng, '...');
      return say(c, follow, [reply('Huh.', () => then())]);
    }));
    cs.push(reply(`Sorry — can we do this? I've got a store to close.`, () => {
      ctx.mood(c, -12);
      return say(c, c.personality.irascibility > 0.5
        ? line(c, 'angry', rng, `Fine.`)
        : rng.pick([`Oh. Sure. Sorry.`, `Right. Right, of course.`, `...Sure.`]),
        [reply('Thanks.', () => then())]);
    }, { risk: true }));
  }
  return say(c, txt, cs);
}

function maybeSmallTalk(c, ctx, then) {
  if (c.saidSmallTalk) return then();
  // He always gets one question in. It is the only thing he gives you.
  const roll = c.isKiller ? 1 : c.personality.chattiness;
  if (roll < 1 && !ctx.rng.chance(roll)) return then();
  c.saidSmallTalk = true;
  return smallTalk(c, ctx, then);
}

/* ---------------- RETURNS ---------------- */
function returnRoot(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return farewell(c, ctx);
  const fee = lateFee(tape.daysLate, tape.genre);

  const finish = () => {
    if (!c.gaveTape) return handOver(c, ctx);
    return farewell(c, ctx);
  };

  const feeStep = () => maybeSmallTalk(c, ctx,
    () => ((fee > 0 && !c.feeSettled) ? feeNode(c, ctx, finish) : finish()));

  const greetText = line(c, 'greetReturn', rng, `Returning this.`);
  return say(c, greetText, [
    reply(`Let's have a look at it.`, () => feeStep()),
    ...(fee > 0 ? [reply(`Before anything — this one's ${tape.daysLate} day${tape.daysLate > 1 ? 's' : ''} late.`,
      () => feeStep(), { cost: money(fee) })] : []),
    reply(`Evening. Busy out there?`, () => { ctx.mood(c, +5); return feeStep(); }),
  ]);
}

function feeNode(c, ctx, then) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return then();
  const fee = lateFee(tape.daysLate, tape.genre);
  const disputes = !c.isKiller && rng() > c.personality.honesty;

  const paid = () => {
    c.feeSettled = true;
    const t = ctx.takeCash(fee, c, 'late fee');
    ctx.mood(c, +2);
    /* They hand you a note and say what it is. Working out that a five for
       a three means two back is the clerk's job, and the HUD keeps the
       running total -- being told the arithmetic every single time made
       the player a passenger at their own counter. */
    return say(c, t.change > 0
      ? rng.pick([`Out of ${money(t.tendered)}.`, `${money(t.tendered)} is the smallest I've got.`,
        `Sorry — big bill.`, `That's a ${money(t.tendered)}.`])
      : line(c, 'thanks', rng, `Thanks.`),
      [reply(`...`, () => then())]);
  };
  const waived = () => {
    c.feeSettled = true;
    ctx.waive(fee);
    ctx.mood(c, +26);
    return say(c, line(c, 'feeWaived', rng, `Thanks.`), [reply('Just this once.', () => then())]);
  };
  const refused = () => {
    c.feeSettled = true;
    c.owes = fee;
    ctx.owed(c, fee);
    return say(c, rng.pick([`Then I'll settle it next time.`, `Put it on the account.`, `Fine. Next time.`]),
      [reply('...', () => then())]);
  };

  const demand = () => say(c, line(c, 'feeDispute', rng, `I don't think that's right.`), [
    reply(`Our system has it checked in three days after it was due.`, () => {
      // Standing firm works on the mostly-honest; the rest dig in.
      if (rng() < c.personality.honesty + 0.25) return paid();
      ctx.mood(c, -18);
      return say(c, line(c, 'angry', rng, `This is ridiculous.`), [
        reply(`I'll waive it. It's late and I'm tired.`, () => waived(), { cost: `-${money(fee)}` }),
        reply(`Then the fee stands and it goes on your account.`, () => { ctx.mood(c, -14); return refused(); }, { risk: true }),
      ]);
    }),
    reply(`I can waive it this once.`, () => waived(), { cost: `-${money(fee)}` }),
    reply(`Then I can't check the tape back in.`, () => {
      ctx.mood(c, -24);
      return say(c, c.personality.irascibility > 0.45
        ? line(c, 'angry', rng, `Are you serious?`)
        : rng.pick([`...Seriously?`, `Come on. Really?`, `That's not — okay. Okay.`]), [
        reply(`I'm sorry. It's the policy.`, () => { ctx.mood(c, -6); return refused(); }),
        reply(`Alright, alright. Waived.`, () => waived(), { cost: `-${money(fee)}` }),
      ]);
    }, { risk: true }),
  ]);

  const canPay = c.hasMoney;
  /* This used to be an `asPlayer` node with no replies -- a screen of the
     clerk talking to himself that you pressed through, which read like a
     different system from every other exchange in the game. It is a normal
     line from them with normal replies now. */
  const settle = () => {
    if (!canPay) {
      return say(c, line(c, 'noMoney', rng, `I don't have it on me.`), [
        reply(`I'll put it on your account. Bring it Friday.`, () => { ctx.mood(c, +18); return refused(); }),
        reply(`Waive it. Forget it.`, () => waived(), { cost: `-${money(fee)}` }),
        reply(`No cash, no check-in. I'm sorry.`, () => {
          ctx.mood(c, -22);
          return say(c, line(c, 'angry', rng, `Unbelievable.`), [
            reply(`...Fine. Account.`, () => { ctx.mood(c, +10); return refused(); }),
          ]);
        }, { risk: true }),
      ]);
    }
    if (disputes) return demand();
    return say(c, line(c, 'feeAccept', rng, `Fair enough.`), [
      reply(`Thank you. I'll take that.`, () => paid(), { good: money(fee) }),
      reply(`On second thought — forget it tonight.`, () => waived(), { cost: `-${money(fee)}` }),
    ]);
  };

  const days = `${tape.daysLate} day${tape.daysLate > 1 ? 's' : ''}`;
  return say(c, rng.pick([
    `Something wrong?`,
    `You're pulling a face.`,
    `That's the look. What is it.`,
    `Go on. How bad.`,
  ]), [
    reply(`${tapeLabel(tape)} is ${days} over. That's ${money(fee)}.`, () => settle()),
    reply(`Due back ${tape.daysLate > 6 ? 'last week' : 'Tuesday'}. It's ${days} late — ${money(fee)}.`, () => settle()),
    reply(`I have to charge you for this. ${money(fee)}, ${days}.`, () => { ctx.mood(c, -3); return settle(); }),
  ]);
}

function handOver(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return farewell(c, ctx);
  const cs = [];
  cs.push(reply(`I'll take it.`, () => {
    if (!ctx.canTakeTape()) {
      return say(c, rng.pick([`...Your hands are full, friend.`, `You want to put something down first?`]),
        [reply('One second.', () => null)]);
    }
    ctx.takeTape(tape, c);
    c.gaveTape = true;
    return say(c, line(c, 'thanks', rng, `Thanks.`), [reply('...', () => farewell(c, ctx))]);
  }, { good: 'take tape' }));
  cs.push(reply(`Drop it in the return bin.`, () => {
    ctx.binTape(tape, c);
    c.gaveTape = true;
    return say(c, rng.pick([`Sure.`, `There you go.`, `Right in.`]), [reply('...', () => farewell(c, ctx))]);
  }));
  if (tape.game) {
    cs.push(reply(`Hang on — is the cartridge actually in the box?`, () => {
      const honest = rng() < c.personality.honesty;
      if (honest) {
        return say(c, rng.pick([
          `...Ah. No. It's in the machine. I'll bring it Tuesday.`,
          `It is. I checked twice. I'm the sort of person who checks twice.`,
          `Open it. Go on, open it. I'll wait.`,
        ]), [
          reply(`I'll check it now.`, () => { ctx.mood(c, -3); return handOver(c, ctx); }),
          reply(`I'll take your word for it.`, () => { ctx.mood(c, +8); return handOver(c, ctx); }),
        ]);
      }
      ctx.mood(c, -6);
      return say(c, rng.pick([
        `Why would I bring you an empty box?`,
        `Of course it is. What is this.`,
        `Every time. Every single time with you people.`,
      ]), [reply(`Sorry — had to ask.`, () => { ctx.mood(c, +5); return handOver(c, ctx); })]);
    }));
  } else if (!tape.rewound) {
    cs.push(reply(`Hang on — is this rewound?`, () => {
      const honest = rng() < c.personality.honesty;
      ctx.mood(c, -4);
      if (honest) {
        return say(c, rng.pick([
          `...No. No, it isn't. Sorry.`,
          `Ah, hell. I fell asleep. Sorry.`,
          `I meant to. I did mean to.`,
        ]), [
          reply(`There's a dollar rewind charge.`, () => {
            if (!c.hasMoney) { ctx.mood(c, -8); return say(c, line(c, 'noMoney', rng, `Can't tonight.`), [reply('...', () => handOver(c, ctx))]); }
            ctx.takeCash(1, c, 'rewind charge'); ctx.mood(c, -6);
            return say(c, rng.pick([`Yeah. That's fair.`, `A dollar. Sure.`]), [reply('...', () => handOver(c, ctx))]);
          }, { good: '$1.00' }),
          reply(`Don't worry about it, I'll do it.`, () => { ctx.mood(c, +14); return handOver(c, ctx); }),
        ]);
      }
      ctx.mood(c, -10);
      return say(c, rng.pick([
        `It's rewound. I rewound it.`,
        `Of course it's rewound. What do you take me for?`,
        `That's what the machine's for, isn't it?`,
      ]), [
        reply(`We'll see.`, () => handOver(c, ctx)),
        reply(`Sorry — had to ask.`, () => { ctx.mood(c, +6); return handOver(c, ctx); }),
      ]);
    }));
  }
  return say(c, rng.pick([`Here.`, `So — do you want it or not?`, `It's all yours.`]), cs);
}

/* ---------------- RENTALS ---------------- */
/**
 * What they say about the thing in their hand.
 *
 * The rule the whole file obeys: if somebody is going to talk about a
 * film, it is the film they are actually holding. Nobody discusses a
 * comedy while clutching a slasher.
 */
function tapeOpener(tape, rng) {
  const pool = (tape && TAPE_TALK[tape.genre]) || TAPE_TALK.DRAMA;
  return rng.pick(pool);
}

/** Have they seen it? Honest people say so; the rest have an opinion. */
function seenIt(c, rng) {
  const roll = rng();
  if (roll < 0.34) return rng.pick(SEEN_IT.yes);
  if (roll < 0.72) return rng.pick(SEEN_IT.no);
  return rng.pick(SEEN_IT.opinion);
}

function rentRoot(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return idleRoot(c, ctx);
  const price = tape.price;
  const finish = () => farewell(c, ctx);

  const complete = () => {
    c.checkedOut = true;
    const t = ctx.checkout(tape, c);
    const sign = tape.game ? `Three nights. Cartridge back in the box.` : `Two nights. Be kind, rewind.`;
    return say(c, t && t.change > 0
      ? rng.pick([`Out of ${money(t.tendered)}, sorry.`, `${money(t.tendered)}. It's all I've got on me.`,
        `Here — ${money(t.tendered)}.`])
      : line(c, 'thanks', rng, `Thanks.`),
      [reply(sign, () => finish())]);
  };

  const broke = () => say(c, line(c, 'noMoney', rng, `I'm short.`), [
    reply(`I can put it on your account.`, () => {
      ctx.mood(c, +22); ctx.owed(c, price); c.checkedOut = true; ctx.checkout(tape, c, true);
      return say(c, rng.pick([`You're a lifesaver.`, `I'll have it Friday. Promise.`, `Thank you. Really.`]),
        [reply(`Friday.`, () => finish())]);
    }, { risk: true, cost: 'unpaid' }),
    reply(`I can't let it walk out without payment.`, () => {
      ctx.mood(c, -16);
      return say(c, c.personality.irascibility > 0.5 ? line(c, 'angry', rng, `Great. Wonderful.`)
        : rng.pick([`Yeah. No, I get it.`, `Figured you'd say that.`, `...Alright.`]), [
        reply(`Come back when you've got it.`, () => { ctx.returnToShelf(c); return finish(); }),
        reply(`Wait. Take it. On me.`, () => { ctx.waive(price); ctx.mood(c, +30); c.checkedOut = true; ctx.checkout(tape, c, true); return finish(); },
          { cost: `-${money(price)}` }),
      ]);
    }),
    reply(`How much have you got?`, () => {
      const has = Math.round(price * rng.range(0.2, 0.75) * 100) / 100;
      return say(c, `${money(has)}. That's — that's everything.`, [
        reply(`Take it for ${money(has)}.`, () => {
          ctx.takeCash(has, c, 'partial', true); ctx.waive(price - has); ctx.mood(c, +24);
          c.checkedOut = true; ctx.checkout(tape, c, true); return finish();
        }, { good: money(has) }),
        reply(`Not enough. Sorry.`, () => { ctx.mood(c, -12); ctx.returnToShelf(c); return finish(); }),
      ]);
    }),
  ]);

  const takePayment = () => {
    if (!c.hasMoney) return broke();
    return say(c, line(c, 'feeAccept', rng, `Here you go.`), [
      reply(`Thanks. Two nights.`, () => complete(), { good: money(price) }),
    ]);
  };
  const ring = () => maybeSmallTalk(c, ctx, takePayment);

  const cs = [
    reply(`${tapeLabel(tape)}. That's ${money(price)} for two nights.`, () => ring()),
    reply(`${tapeLabel(tape)}. Good pick — seen it before?`, () => {
      ctx.mood(c, +8);
      return say(c, seenIt(c, rng), [
        reply(`${money(price)}, then.`, () => ring()),
        reply(`What made you pick this one?`, () => {
          ctx.mood(c, +10);
          return say(c, tapeOpener(tape, rng), [
            reply(`You'll be fine. ${money(price)}.`, () => { ctx.mood(c, +6); return ring(); }),
            reply(`Honestly? Put it back and take something else.`, () => {
              ctx.mood(c, -6); ctx.returnToShelf(c);
              return say(c, rng.pick([
                `...Now I have to start again.`,
                `That's the first honest thing anybody's said to me today.`,
                `Fine. Fine! I'll look again.`,
              ]), [reply(`Take your time.`, () => null)]);
            }, { risk: true }),
          ]);
        }),
      ]);
    }),
    reply(`(say nothing, and let them fill the silence)`, () => {
      return say(c, tapeOpener(tape, rng), [
        reply(`Couldn't tell you. ${money(price)}.`, () => ring()),
        reply(`It's better than it looks. Most of them are.`, () => { ctx.mood(c, +10); return ring(); }),
      ]);
    }),
  ];
  if (tape.genre === 'HORROR') {
    cs.push(reply(`You know how this one ends?`, () => {
      ctx.mood(c, c.personality.id === 'HORROR_NERD' ? +14 : -8);
      return say(c, c.personality.id === 'HORROR_NERD'
        ? `Don't. Don't you dare. I've kept it clean for nine years.`
        : rng.pick([`Please don't.`, `Do NOT tell me.`, `...Why would you say that.`]),
        [reply(`Kidding. ${money(price)}.`, () => ring())]);
    }, { risk: true }));
  }
  cs.push(reply(`One moment — let me finish something.`, () => { ctx.mood(c, -10); return null; }, { risk: true }));

  return say(c, line(c, 'greetRent', rng, `Just this one.`), cs);
}

/* ============================================================
   THE ONES WHO ARE NOT ALL THERE
   Two flavours: people in the wrong building entirely, and people in
   the right building with a completely wrong model of how it works.
   ============================================================ */

export const LOST_PREMISES = {
  restaurant: {
    open: `Yeah, hi — let me get the number three, no onions, and whatever the kid gets. Is the shake machine working?`,
    push: `I can see the menu boards right there behind you. The little coloured ones.`,
    relent: `...Those are movies.\n\nThose are movies, aren't they.`,
    play: `Great, great. And can I get that to go? I'm parked in the fire lane.`,
    exit: `Well now I have to drive all the way back around.`,
  },
  laundromat: {
    open: `Do you have change for the machines? I've got a load of whites in the car and nobody's at the desk.`,
    push: `The washers. Big silver ones. Usually along that wall.`,
    relent: `That's... that's a shelf of tapes.\n\nOh, for crying out loud.`,
    play: `Which machine's the good one? Last time I used four and it ate my quarters.`,
    exit: `Then where do people wash things around here?`,
  },
  pharmacy: {
    open: `Pickup for Halvorsen. Should be under H. It's the blue one, the little blue one.`,
    push: `The doctor called it in Tuesday. He said it'd be ready Tuesday.`,
    relent: `Wait. Wait, hold on. What kind of store is this?`,
    play: `And is that the generic? Because my insurance only does the generic.`,
    exit: `Then somebody has my prescription and it is NOT me.`,
  },
  dmv: {
    open: `I've got B-forty-one. They called B-thirty-nine about ten minutes ago and then everybody just left.`,
    push: `I'm here for the renewal. I brought both proofs of residence, look.`,
    relent: `...Why is there a movie about a shark on the counter.`,
    play: `Do I look at the little box or the wall chart? Nobody ever says.`,
    exit: `I have been in this line since two o'clock.`,
  },
  hardware: {
    open: `I need a five-sixteenths carriage bolt, about two inches, and one of those washers that isn't flat.`,
    push: `You had them last spring. Aisle at the back, past the paint.`,
    relent: `That's not paint. That's a display for a movie.`,
    play: `Galvanised, if you've got it. It's going outside.`,
    exit: `Then I'm going to Fenner's and Fenner's is closed.`,
  },
  bank: {
    open: `I'd like to deposit this and get forty back. Sorry — do you need the little slip? I never fill out the little slip.`,
    push: `You're a teller, aren't you? You're behind the counter.`,
    relent: `Oh no. Oh, I have been standing in a video store.`,
    play: `Put it in checking. No — savings. No, checking.`,
    exit: `Do NOT tell my daughter about this.`,
  },
  arcade: {
    open: `Two dollars in tokens. And is the pinball one still tilted? My son says it's tilted.`,
    push: `The arcade. This is the arcade. There's a sign.`,
    relent: `That sign says "SUNSET VIDEO." ...That's a different kind of video, isn't it.`,
    play: `Give me quarters instead. The tokens jam.`,
    exit: `Everything good closes.`,
  },
  post: {
    open: `Book of stamps and I need to know what it costs to send this to Nevada.`,
    push: `You've got a scale back there. I can see a scale.`,
    relent: `That's a tape rewinder. Why does a post office have a tape rewinder.`,
    play: `Do the pretty ones cost extra? They always cost extra.`,
    exit: `Nobody in this town knows what their own job is.`,
  },
  barber: {
    open: `Just a trim. Off the ears, leave the top. I'm not fussy and I don't want a conversation.`,
    push: `There's a chair right there. I can see the chair.`,
    relent: `That is not a barber's chair. That is a stool with a videotape on it.`,
    play: `And no talc. Last fella covered me in talc.`,
    exit: `I'll go to the one by the bank and he does it CROOKED.`,
    storms: true,
  },
  vet: {
    open: `(sets a cat carrier on the counter) He's been making a noise. Like a hinge. Listen — there. That noise.`,
    push: `You're the eight o'clock, aren't you? They said there'd be somebody at eight.`,
    relent: `...I have brought a cat into a video shop.\n\nHe's going to be insufferable about this.`,
    play: `Should I take him out of the box? He bites when he's out of the box.`,
    exit: `Come on, Duchess. Nobody here is a professional.`,
  },
  photo: {
    open: `Pickup for Ruiz. One hour. It's been about nine.`,
    push: `Doubles. I always order doubles. It'll say doubles on the envelope.`,
    relent: `Those aren't envelopes, are they. Those are little boxes with films in them.`,
    play: `If any came out dark I'm not paying for the dark ones.`,
    exit: `That is a roll of my daughter's christening and somebody has LOST it.`,
    storms: true,
  },
  taxes: {
    open: `I've got the four o'clock with Denise. I brought everything. I brought the shoebox.`,
    push: `Denise. Short woman. Does the returns. She's got a little jar of pens.`,
    relent: `Oh, this is the video shop. Denise is TWO DOORS DOWN.`,
    play: `Can I still write off the boat? I want to write off the boat.`,
    exit: `I have taken a half day for this.`,
    storms: true,
  },
  bowling: {
    open: `Eleven and a half. And is lane six still hooking? Because I'm not paying for lane six again.`,
    push: `Shoes. The rack of shoes. Behind you, with all the little numbers on the heels.`,
    relent: `Those have got film titles on them. Shoes don't have film titles on them.`,
    play: `Half size up if you're out. I'd rather swim than pinch.`,
    exit: `League starts in ten minutes. TEN MINUTES.`,
    storms: true,
  },
  jury: {
    open: `(holds up a summons) It says report to the annex. Is this the annex? Nobody's at the annex.`,
    push: `I'm not trying to get out of it. I want to be here. That's the whole point.`,
    relent: `...The annex is the grey building. This is the one with the neon sign of a filmstrip.`,
    play: `Do I sit, or do they call me? I've never done one of these.`,
    exit: `I am going to be fined and it is going to be somebody's fault.`,
  },
  optical: {
    open: `Two-fifteen with the eye doctor. And I want the ones that go dark outside, but not the ones that STAY dark.`,
    push: `You've got a whole wall of frames back there, I can see them from here.`,
    relent: `(squints hard) ...Those are video cassettes.\n\nWell. That rather makes the appointment's case.`,
    play: `Read the bottom line? Certainly. E. F. ...P? Is it a P?`,
    exit: `And I still can't see.`,
  },
  travel: {
    open: `Two to Orlando, the week of the twelfth, and I do not want a layover in Atlanta. Anywhere but Atlanta.`,
    push: `You've got the brochures right there. The shiny ones with the beaches.`,
    relent: `Those are film cases. Those are — that's a shark on that one. That's not a beach.`,
    play: `Aisle seats. And a hire car, something with air conditioning.`,
    exit: `Fine. FINE. We'll drive, and I'll hate every mile of it.`,
    storms: true,
  },
  bail: {
    open: `My nephew's in county. They said forty percent down and somebody signs. I'm somebody.`,
    push: `The sign outside said open twenty-four hours. That's a bail sign. Nobody else is open twenty-four hours.`,
    relent: `...The sign says NEW RELEASES.\n\nHe's going to be in there all weekend.`,
    play: `Does he have to come back here, or does he go to the court? He never comes back.`,
    exit: `That boy is going to sit in a cell because of a NEON SIGN.`,
    storms: true,
  },
  church: {
    open: `Is this where they do the Tuesday group? The one in the basement, with the coffee?`,
    push: `Somebody said the old shop unit on the parade. This is the old shop unit on the parade.`,
    relent: `That's a lot of horror films for a church basement. I did wonder.`,
    play: `Am I early? I'm always early. It's a nervous thing.`,
    exit: `I actually needed that tonight.`,
  },
  bar: {
    open: `Bud. Bottle, not the tap, the tap here's always warm. And whatever the man behind me is having.`,
    push: `You've got a counter, and a till, and it's dark in here. What else would this be?`,
    relent: `...There's no taps. There's no taps and there's a cardboard alien over there.`,
    play: `Start a tab. I'm good for it, ask anyone.`,
    exit: `I'll drink at home like a normal person.`,
  },
  employ: {
    open: `I'm here about the job. I've got a resumé, it's a bit creased, I had it in the car.`,
    push: `The card in the window. "HELP WANTED." Right there in the window.`,
    relent: `..."HELD OVER." It says HELD OVER.\n\nI have been rehearsing in a parking lot for forty minutes.`,
    play: `My greatest weakness is that I care too much. Honestly? Too much.`,
    exit: `Nobody is hiring. Nobody in this whole town is hiring.`,
    storms: true,
  },
};

export const DIM_PREMISES = {
  theaters: {
    open: `I want the one that's in the theatre right now. The big one. With the boat.`,
    push: `I don't want to GO to the theatre. I want you to have it here. Tonight.`,
    relent: `So I have to wait a whole year? For a movie that already exists?`,
    play: `Front row seats if you've got them. Not too close.`,
    exit: `A whole year. Unbelievable.`,
  },
  betamax: {
    open: `Before I take this — does it work in a Betamax? Because everything you rent me is the wrong shape.`,
    push: `They're the same. They're both a rectangle.`,
    relent: `...You're telling me I bought the wrong machine. In 1983.`,
    play: `I'll take two. One for each slot.`,
    exit: `Thirteen years. Thirteen years I've had that thing.`,
  },
  librarycard: {
    open: `Here's my card. It should have my whole history on it.`,
    push: `It's a card. You swipe cards. That's what the machine is for.`,
    relent: `This is a library card, isn't it.\n\nWhy do they make them all the same.`,
    play: `Put it on the card and I'll settle up in three weeks like always.`,
    exit: `Then what is a card even FOR.`,
  },
  otherchain: {
    open: `Returning this. Yes, I know. I know it doesn't say your name on it. Hear me out.`,
    push: `You're both video stores. Surely you people talk.`,
    relent: `So I have to drive it back across the bridge myself.`,
    play: `Great, I'll leave it with you. Tell them Krebs brought it back.`,
    exit: `You are all in this together.`,
  },
  theguy: {
    open: `I'm looking for the one with the guy in it. You know the guy. He's got the face.`,
    push: `He was in the other one. With the car. He does the thing with his eyebrow.`,
    relent: `Okay, I'll walk around until I see him. He's on the front of the box.`,
    play: `Yeah! That's the guy! That's absolutely the guy.`,
    exit: `Nobody ever knows the guy.`,
  },
  wedding: {
    open: `Returning this. I'd like it noted the picture quality was terrible and there's a whole hour of somebody's shoes.`,
    push: `It came out of my machine. Therefore it is yours.`,
    relent: `..."CHRISTINE AND DALE, JUNE 8." \n\nThat's my niece's wedding. I taped over your movie.`,
    play: `I'd give it two stars. The reception picked up at the end.`,
    exit: `Well now I have to tell Christine.`,
  },
  broughtvcr: {
    open: `I brought the whole machine in. It's in the cart. Can you rewind it here, with your equipment?`,
    push: `Mine makes a noise. Yours doesn't make a noise. So yours is better.`,
    relent: `You want me to take a VCR back out to a Buick in the dark.`,
    play: `Careful, the cord's shot. Don't touch the bare part.`,
    exit: `And they wonder why nobody fixes anything anymore.`,
  },
  keeping: {
    open: `Just so we're square — this one's mine now, right? I rented it. That's like buying it slowly.`,
    push: `I've had four of yours for three years. Nobody said a word.`,
    relent: `...How much is it, in total. Approximately.\n\nDon't tell me. Don't say it out loud.`,
    play: `Fantastic. I'll start a shelf.`,
    exit: `I'm going to go sit in my car for a minute.`,
  },
  subtitles: {
    open: `I want this one, but with the words at the bottom. Can you put the words on before I take it?`,
    push: `You've got the machine right there. The rewinder. Same principle.`,
    relent: `So the words are either on it or they aren't, and I can't change that, and neither can you.`,
    play: `Big words, if you can. My eyes aren't what they were.`,
    exit: `Then what's the point of any of it.`,
  },
  ending: {
    open: `Before I rent it — how does it end? I'm not asking to be difficult. I just don't like a surprise.`,
    push: `You work here. You've seen all of them. That's the job.`,
    relent: `You genuinely aren't going to tell me. You're going to make me watch it.`,
    play: `Does the dog live? Just tell me about the dog.`,
    exit: `I'll wait for it to be on television and someone will spoil it for free.`,
  },
  record: {
    open: `There's a thing on channel nine at eleven. Can you tape it for me here and I'll pick it up Sunday?`,
    push: `You've got a machine and I don't. I'd say that settles it.`,
    relent: `So I have to set the timer myself. On my own machine. Which flashes twelve.`,
    play: `Get the whole thing, not just the start. Last time somebody got just the start.`,
    exit: `Everyone in my life has failed me on this exact matter.`,
    storms: true,
  },
  overnight: {
    open: `Two nights is no good to me. I'm a slow watcher. I do about twenty minutes and then I've got to lie down.`,
    push: `A fast watcher gets the whole film for three dollars. I get a third of it. That's discrimination.`,
    relent: `...I suppose I could rent it twice.\n\nI don't like that I've talked myself into that.`,
    play: `Put me down for a fortnight. And no phone calls about it.`,
    exit: `Three dollars for twenty minutes of a film. Highway robbery.`,
    storms: true,
  },
  colorize: {
    open: `Have you got this one in colour? The one I watched was all grey and I thought my set was going.`,
    push: `They do it. I've seen them do it. Ted Turner does it.`,
    relent: `So this is just how it IS. Forever. Nobody's going to fix it.`,
    play: `Nothing garish. Just — natural colours. Skin, sky, that sort of thing.`,
    exit: `Grey film. Grey town. Grey everything.`,
  },
  commercials: {
    open: `There were eleven minutes of adverts before the film. I timed them. I want eleven minutes back.`,
    push: `I pay for a film. I don't pay for adverts for other films. That's their business, not mine.`,
    relent: `You can't fast-forward for me in advance. I do see that. I didn't, but I do now.`,
    play: `Eleven minutes at three dollars for two hours is — well. It's about twenty-seven cents.`,
    exit: `Twenty-seven cents of my life, and nobody cares.`,
    storms: true,
  },
  speed: {
    open: `Can you run it through quick and just tell me if it's any good? Save us both the trouble.`,
    push: `Put it in the rewinder and watch it going backwards. You'd get the gist.`,
    relent: `You'd genuinely have to sit down and watch the whole thing. Like a person.`,
    play: `Right, and what happens in the middle? Roughly.`,
    exit: `Nobody wants to work.`,
    storms: true,
  },
  membership: {
    open: `I paid the membership in eighty-nine. Twelve dollars. So these are free now, is my understanding.`,
    push: `A membership is a membership. That's what the word means.`,
    relent: `So the twelve dollars bought me... the right to give you more dollars.`,
    play: `Just put it on the membership. That's what it's there for.`,
    exit: `That is a racket and you know it's a racket.`,
    storms: true,
  },
  tvguide: {
    open: `What's on tonight? After the news. Is it the one with the helicopter?`,
    push: `You're the video place. Video. It's all the same thing.`,
    relent: `You're not the television. You're the... other thing. The one you have to choose.`,
    play: `Nine o'clock, then. Is it a two-parter? I hate a two-parter.`,
    exit: `I'll just have it on and see what happens.`,
  },
  swap: {
    open: `I've brought four of mine. I'll leave these, I'll take four of yours, we're square.`,
    push: `They're good ones. Two of them are still in the wrappers.`,
    relent: `...You don't want my tapes.\n\nNobody wants my tapes.`,
    play: `Fair trade. I'll take a horror and three of whatever's popular.`,
    exit: `I'll put them back in the loft with the rest.`,
  },
  reserve: {
    open: `I want to put a hold on everything with a submarine in it. Standing order. Just call me when one comes in.`,
    push: `You've got a phone. You've got my number. I don't see the difficulty.`,
    relent: `So there's no list. There's no list at all, is there. It's just... whoever gets here first.`,
    play: `Submarines, and anything with a lighthouse. I'll be by on Thursdays.`,
    exit: `A business with no system. Marvellous.`,
    storms: true,
  },
  damage: {
    open: `Now, this was chewed when I got it. I want that noted before we go any further.`,
    push: `My machine doesn't chew tapes. It's a good machine. It's a Sanyo.`,
    relent: `...There's a bit of it here, in my pocket. That's probably not ideal for my case.`,
    play: `So we'll say it was chewed already and no more about it.`,
    exit: `I have been coming here for six years and this is how it goes.`,
    storms: true,
  },
};

function confusedRoot(c, ctx) {
  const rng = ctx.rng;
  const lost = c.personality.confused === 'lost';
  const table = lost ? LOST_PREMISES : DIM_PREMISES;
  const P = table[c.premise] || table[Object.keys(table)[0]];
  const done = () => farewell(c, ctx);

  // If they wandered in holding something, they can still be sold it.
  const sell = () => {
    if (!c.tape) {
      return say(c, rng.pick([
        `...Fine. Fine! What have you got that's short.`,
        `Alright. Pick one for me. Something with a dog.`,
        `You know what? Yes. I'm owed something today.`,
      ]), [
        reply(`Two ninety-nine. Two nights.`, () => {
          if (!c.hasMoney) { ctx.mood(c, -6); return say(c, `...Naturally I have no money.`, [reply('...', () => done())]); }
          c.tape = ctx.giveShelfPick(c);
          c.checkedOut = true;
          const t = ctx.checkout(c.tape, c);
          ctx.mood(c, +14);
          return say(c, t && t.change > 0 ? `Out of ${money(t.tendered)}.` : `There. That was easy.`,
            [reply(`Be kind, rewind.`, () => done())]);
        }, { good: '$2.99' }),
        reply(`We're closing soon, honestly.`, () => { ctx.mood(c, -8); return done(); }),
      ]);
    }
    return rentRoot(c, ctx);
  };

  // How they take it when the penny drops. The ones with a temper on them
  // do not simply wander off -- they go loudly, and it costs you.
  const walkOut = (text) => say(c, text, [
    reply(rng.pick([`Mm-hm.`, `Right you are.`, `Goodnight.`]), () => {
      if (P.storms) ctx.storm(c); else ctx.leave(c);
      return null;
    }),
    ...(P.storms ? [
      reply(rng.pick([
        `Hang on. Let me at least send you home with something.`,
        `Before you go — one film. On the house of my patience.`,
        `Wait. You came all this way.`,
      ]), () => { ctx.mood(c, +22); return sell(); }),
    ] : []),
  ]);

  const relented = () => say(c, P.relent, [
    reply(`Happens more than you'd think.`, () => { ctx.mood(c, +12); return sell(); }),
    reply(`It's been a long night for both of us.`, () => { ctx.mood(c, +16); return sell(); }),
    // The placid ones just go. The others take the correction badly.
    reply(`Yeah. Have a good one.`, () => {
      ctx.mood(c, -2);
      if (!P.storms) return done();
      return walkOut(P.exit);
    }),
  ]);

  const pushed = () => say(c, P.push, [
    reply(`I promise you. Video rentals. That is the entire business.`, () => relented()),
    reply(`(point at the eight hundred videotapes)`, () => { ctx.mood(c, +6); return relented(); }),
    reply(`Sure. Whatever you say.`, () => {
      ctx.mood(c, +8);
      return say(c, P.play, [
        reply(`...I can't keep this up. This is a video store.`, () => relented()),
        reply(`Coming right up.`, () => {
          ctx.mood(c, +20);
          return say(c, rng.pick([
            `You know what, you're the only one here who listens.`,
            `Finally. Somebody who knows what they're doing.`,
            `See, THIS is service.`,
          ]), [reply(`...`, () => sell())]);
        }, { risk: true }),
      ]);
    }),
  ]);

  return say(c, P.open, [
    reply(lost ? `Sir, this is a video store.` : `I'm going to stop you there.`, () => pushed()),
    reply(`...Go on.`, () => pushed()),
    reply(lost ? `The place you want is two doors down.` : `That's not how any of this works.`, () => {
      ctx.mood(c, -10);
      return walkOut(P.exit);
    }, { risk: true }),
  ]);
}

/* ---------------- CHANGE OWED ---------------- */
function changeRoot(c, ctx) {
  const rng = ctx.rng;
  const due = c.changeDue || 0;
  const ready = ctx.changeInHand() >= due - 0.001;
  const loose = ctx.cashInHand();

  if (ready) {
    return say(c, rng.pick([
      `My change?`, `You had my change.`, `Still owe me ${money(due)}, I think.`,
      `...`, `Sorry — the change?`,
    ]), [
      reply(`${money(due)}. Sorry about that.`, () => {
        ctx.giveChange(c);
        return say(c, line(c, 'thanks', rng, `Thanks.`), [reply(`Goodnight.`, () => farewell(c, ctx))]);
      }, { good: `-${money(due)}` }),
      reply(`Keep it as store credit?`, () => {
        if (rng() < c.personality.generosity) {
          ctx.keepChange(c); ctx.mood(c, +4);
          return say(c, `...Sure. Fine. Put it on the card thing.`, [reply(`Appreciated.`, () => farewell(c, ctx))]);
        }
        ctx.mood(c, -16);
        return say(c, line(c, 'angry', rng, `No. My change. Now.`), [
          reply(`Of course. ${money(due)}.`, () => { ctx.giveChange(c); return farewell(c, ctx); }),
        ]);
      }, { risk: true }),
    ]);
  }

  return say(c, rng.pick([
    `I'm waiting on change.`, `You've still got my money.`, `Any day now.`,
  ]), [
    reply(loose > 0
      ? `One second — I have to ring it up first.`
      : `Let me count it out of the drawer.`,
      () => { ctx.needRegister(loose > 0, due); return null; }),
  ]);
}

/* ---------------- ANGER ---------------- */
function angryRoot(c, ctx) {
  const rng = ctx.rng;
  return say(c, line(c, 'angry', rng, `I've been standing here forever.`), [
    reply(`You're right. I'm sorry — let me take care of you now.`, () => {
      ctx.mood(c, +34); c.resolvedAnger = true;
      return say(c, rng.pick([`...Okay. Okay, thank you.`, `Fine. Fine.`, `Well. Alright then.`]),
        [reply(`Right.`, () => talkTo(c, ctx))]);
    }),
    reply(`Free rental. On the house. We good?`, () => {
      ctx.waive(3); ctx.mood(c, +48); c.resolvedAnger = true;
      return say(c, rng.pick([`...Yeah. Yeah, we're good.`, `Now you're talking.`, `That's more like it.`]),
        [reply(`Right.`, () => talkTo(c, ctx))]);
    }, { cost: '-$3.00' }),
    reply(`I'm one person running a whole store. Give me a minute.`, () => {
      if (c.personality.irascibility < 0.4) {
        ctx.mood(c, +20); c.resolvedAnger = true;
        return say(c, `...Yeah. Yeah, alright. Sorry.`, [reply(`Thanks.`, () => talkTo(c, ctx))]);
      }
      ctx.mood(c, -20);
      return say(c, line(c, 'angry', rng, `That is not my problem.`), [
        reply(`Then we're done here.`, () => { ctx.storm(c); return null; }, { risk: true }),
        reply(`Okay. Free rental, on me.`, () => { ctx.waive(3); ctx.mood(c, +40); c.resolvedAnger = true; return talkTo(c, ctx); }, { cost: '-$3.00' }),
      ]);
    }, { risk: true }),
    reply(`Then leave.`, () => { ctx.storm(c); return null; }, { risk: true }),
  ]);
}

/* ---------------- IDLE / FAREWELL ---------------- */
function idleRoot(c, ctx) {
  const rng = ctx.rng;
  // The caller sets state to TALKING before building the node, so the
  // browsing lines are keyed off what they were doing a moment ago.
  const was = c._prevState || c.state;
  if (was === 'BROWSING' || was === 'PICKING') {
    const holding = c.tape;
    // If they are holding something, they talk about that -- not a film
    // chosen at random from a shelf they are not standing at.
    const lines = holding ? [
      tapeOpener(holding, rng),
      `${tapeLabel(holding)}. Have you seen it? Be honest with me.`,
      `Two hours and six minutes. That's a lot of ${mediaWord(holding)} for a Tuesday.`,
      `It says "unrated" on the back. Unrated by who?`,
      `...I'm going to put this one back. I'm sorry.`,
    ] : [
      `Still looking. I'll come to you.`,
      `Do you have anything with a dog in it? Not a sad dog.`,
      `Where'd you move the ${GENRE_LABEL[rng.pick(GENRES)] || 'HORROR'} section?`,
      `I'll know it when I see it.`,
      `Everything on this wall looks like everything else on this wall.`,
      `...`,
    ];
    return say(c, rng.pick(lines), [
      reply(`Take your time.`, () => { ctx.mood(c, +4); return null; }),
      ...(holding ? [reply(`That one's good. Genuinely.`, () => {
        ctx.mood(c, +10); ctx.nudgeChoice(c);
        return say(c, rng.pick([`Sold. That's all I needed to hear.`, `Alright then. You've never lied to me.`]),
          [reply(`...`, () => null)]);
      })] : []),
      reply(`We close at midnight.`, () => { ctx.mood(c, -6); ctx.hurry(c); return null; }),
    ]);
  }
  return say(c, line(c, 'wait', rng, `...`), [reply(`Right with you.`, () => null)]);
}

function farewell(c, ctx) {
  const rng = ctx.rng;
  if (c.awaitingChange) {
    return say(c, rng.pick([
      `I'm still waiting on my change.`,
      `Hang on — my change.`,
      `You've got ${money(c.changeDue || 0)} of mine.`,
    ]), [reply(`Right. One second.`, () => null)]);
  }
  return say(c, line(c, 'bye', rng, `Night.`), [
    reply(`Goodnight.`, () => { ctx.leave(c); return null; }),
    reply(`Get home safe. Seriously.`, () => {
      ctx.mood(c, +6);
      return say(c, c.isKiller
        ? rng.pick([`I always do.`, `Oh, I'm not worried.`, `You too. Lock up behind me.`])
        : rng.pick([`You too.`, `Will do.`, `...Yeah. You too.`]),
        [reply(`...`, () => { ctx.leave(c); return null; })]);
    }),
  ]);
}

/* ============================================================
   THE PHONE
   ============================================================ */
export function buildPhoneCall(ctx) {
  const suspects = ctx.phoneTargets();
  const OP = { name: 'DISPATCH', voicePitch: 1.06, rough: 0.4 };

  const hang = () => { ctx.hangUp(); return null; };

  if (!suspects.length) {
    return say(OP, `Nine-one-one, what's your emergency?`, [
      reply(`...Nothing. Sorry. Wrong number.`, () => hang()),
      reply(`There's nobody here. I'm just — it's a long night.`, () =>
        say(OP, `Sir, this line is for emergencies. Call back when you have something to report.`,
          [reply(`Yeah.`, () => hang())])),
    ]);
  }

  const confirm = (s) => say(OP,
    `Okay. You're telling me the individual matching our bulletin is at 4412 Delaney right now. Is that correct? Once I roll a unit on this, it's on the record.`, [
    reply(`Yes. I'm sure.`, () => { ctx.accuse(s); return null; }),
    reply(`...Actually, hold on. Let me look again.`, () => choose()),
  ]);

  const choose = () => say(OP, `Nine-one-one. Go ahead.`,
    suspects.map((s) => reply(s.phoneLabel, () => confirm(s), { risk: true }))
      .concat([reply(`Never mind. Sorry.`, () => hang())]));

  return choose();
}

/* ============================================================
   THE REGULARS NOBODY WANTS

   Each of these is a situation rather than a transaction. Some can
   be talked round, some can be sold something, and some have to be
   asked to leave more than once -- which costs you the time of
   everybody standing in the line behind them.
   ============================================================ */

/** Shared shape: ask them to go, and they do not go the first time. */
function eject(c, ctx, texts, opts = {}) {
  const rng = ctx.rng;
  c.asked = (c.asked || 0) + 1;
  const n = Math.min(c.asked, texts.length) - 1;
  if (c.asked >= (opts.takes || texts.length)) {
    return say(c, texts[texts.length - 1], [
      reply(`Thank you.`, () => { ctx.leave(c); return null; }),
      ...(opts.andSell ? [reply(`...Before you go. Do you want to rent something?`, () => {
        ctx.mood(c, +12);
        return opts.andSell();
      })] : []),
    ]);
  }
  return say(c, texts[n], [
    reply(rng.pick([`I'm not asking again.`, `I'd like you to leave. Now.`, `Out. Please.`]),
      () => eject(c, ctx, texts, opts), { risk: true }),
    reply(rng.pick([`I'm serious. Other people are trying to shop.`, `You're going to have to stop.`]),
      () => eject(c, ctx, texts, opts)),
    reply(`...Fine. Carry on, I suppose.`, () => { ctx.mood(c, +6); return null; }),
  ]);
}

export function specialRoot(c, ctx) {
  const rng = ctx.rng;
  switch (c.special) {
    /* ---------------- the boombox ---------------- */
    case 'BOOMBOX':
      return eject(c, ctx, [
        `WHAT? Nah — nah, this is the GOOD part. Listen. LISTEN.`,
        `Man, you got a whole store and no music in it. I'm IMPROVING this place.`,
        `Alright. ALRIGHT. Y'all don't deserve me anyway.`,
      ], {
        takes: 3,
        andSell: () => say(c, `...Actually yeah. You got anything with a real soundtrack?`, [
          reply(`Two ninety-nine. It has a soundtrack.`, () => {
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            const p = ctx.checkout(t, c);
            ctx.mood(c, +20);
            return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `Respect.`,
              [reply(`Two nights.`, () => { ctx.leave(c); return null; })]);
          }, { good: '$2.99' }),
          reply(`We're closing. Another night.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    /* ---------------- the smell ---------------- */
    case 'REEKER':
      return eject(c, ctx, [
        `I'm looking. A man's allowed to look.`,
        `I haven't touched anything. Have I touched anything?`,
        `You people. You're all the same. I was going to rent something.`,
        `Fine! FINE. I'm going. I'm going.`,
      ], { takes: 4 });

    /* ---------------- the television ---------------- */
    case 'SMOKER':
      return eject(c, ctx, [
        `(he does not look away from the screen) ...Yeah.`,
        `There's a pattern in it. If you watch long enough there's a pattern.`,
        `Whoa. Hey. You don't have to be like that about it.`,
        `Yeah, no, I hear you. I'm going. This has been really nice, though.`,
      ], {
        takes: 4,
        andSell: () => say(c, `Do you have the one where nothing happens?`, [
          reply(`I'll pick you something. Two ninety-nine.`, () => {
            if (!c.hasMoney) { return say(c, `Ah. Yeah. Money.`, [reply('...', () => { ctx.leave(c); return null; })]); }
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            ctx.checkout(t, c);
            ctx.mood(c, +16);
            return say(c, `You're a good person. I said that already.`,
              [reply(`Goodnight.`, () => { ctx.leave(c); return null; })]);
          }, { good: '$2.99' }),
          reply(`Just go home.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    /* ---------------- a film that does not exist ---------------- */
    case 'PREORDER': {
      const title = rng.pick([
        `SUMMER OF THE SHARK 4`, `THE ONE WITH THE TWO TRAINS`, `MIDNIGHT IN VERONA`,
        `CAPTAIN ATLANTIC`, `THE PRESIDENT'S DAUGHTER'S PLANE`,
      ]);
      const done = () => farewell(c, ctx);
      const insist = (n) => say(c,
        n === 0 ? `My nephew has SEEN it. He works in the industry.`
          : n === 1 ? `Then order it. You have a phone. I can see the phone.`
            : `This is the worst run store on this side of the river and I have been to all of them.`,
        [
          reply(`It isn't out. It isn't out anywhere. It's not finished.`, () => (n >= 2 ? storm() : insist(n + 1))),
          reply(`I can put your name down for when it comes in.`, () => {
            ctx.mood(c, +26);
            return say(c, `...Well. That's something. Put it down properly. In pen.`, [
              reply(`In pen.`, () => sell()),
            ]);
          }),
          reply(`Your nephew is lying to you.`, () => { ctx.mood(c, -30); return storm(); }, { risk: true }),
        ]);
      const storm = () => say(c, `I'll be writing to somebody about this.`, [
        reply(`You do that.`, () => { ctx.storm(c); return null; }),
        reply(`Wait — let me find you something for tonight.`, () => { ctx.mood(c, +22); return sell(); }),
      ]);
      const sell = () => say(c, `Something for tonight, then. Nothing with subtitles.`, [
        reply(`Two ninety-nine.`, () => {
          const t = ctx.giveShelfPick(c);
          c.tape = t; c.checkedOut = true;
          const p = ctx.checkout(t, c);
          return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `Fine.`,
            [reply(`Two nights.`, () => done())]);
        }, { good: '$2.99' }),
        reply(`We're closing, honestly.`, () => { ctx.mood(c, -10); return done(); }),
      ]);
      return say(c, `Do you have ${title}? It's new. It's very new.`, [
        reply(`That isn't out yet. It isn't even in theatres.`, () => insist(0)),
        reply(`I've never heard of it.`, () => insist(1)),
        reply(`Let me check the back.`, () => {
          ctx.mood(c, +10);
          return say(c, `Thank you. Somebody who tries.`, [
            reply(`...It isn't there. It doesn't exist.`, () => insist(0)),
          ]);
        }),
      ]);
    }

    /* ---------------- the coupon ---------------- */
    case 'COUPON': {
      const done = () => farewell(c, ctx);
      const push = (n) => say(c,
        n === 0 ? `It's a coupon. It says COUPON on it. In my handwriting, sure, but it says it.`
          : n === 1 ? `I've been coming here eleven years. Eleven.`
            : `So you're calling me a liar. In front of people.`,
        [
          reply(`It's a napkin. It's a napkin with a biro on it.`, () => (n >= 2 ? end() : push(n + 1)), { risk: true }),
          reply(`Tell you what. One free rental. Once.`, () => {
            ctx.waive(2.99); ctx.mood(c, +34);
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true; ctx.checkout(t, c, true);
            return say(c, `See? SEE? The coupon works.`,
              [reply(`It does not work. Goodnight.`, () => { ctx.leave(c); return null; })]);
          }, { cost: '-$2.99' }),
          reply(`I can do ten percent. That's what I can do.`, () => {
            ctx.mood(c, +14);
            return say(c, `Ten percent. Off a three dollar rental. Thirty cents.`, [
              reply(`Thirty cents.`, () => sellHim()),
            ]);
          }),
        ]);
      const sellHim = () => say(c, `Alright. Ring it. Two sixty-nine, then.`, [
        reply(`Two sixty-nine.`, () => {
          const t = ctx.giveShelfPick(c);
          c.tape = t; c.checkedOut = true;
          ctx.waive(0.3);
          const p = ctx.checkout(t, c);
          return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `That's more like it.`,
            [reply(`Two nights.`, () => done())]);
        }, { good: '$2.69' }),
      ]);
      const end = () => say(c, `Unbelievable. I'll bring the laminated one.`, [
        reply(`Please don't.`, () => { ctx.storm(c); return null; }),
        reply(`Bring it. I'll look at it.`, () => { ctx.mood(c, +12); ctx.leave(c); return null; }),
      ]);
      return say(c, `Before you scan anything. I've got a coupon.`, [
        reply(`Let me see it.`, () => push(0)),
        reply(`We don't take coupons.`, () => push(1)),
        reply(`...Where did you get that.`, () => push(0)),
      ]);
    }

    /* ---------------- the sovereign citizen ---------------- */
    case 'SOVEREIGN': {
      const beat = (n) => {
        const LINES = [
          `Before we proceed. Am I being detained?`,
          `I'm not a customer. I'm a man. There's a difference and it's a legal one.`,
          `I never signed anything. Did I sign anything? You can't produce it, can you.`,
          `The card in your machine has my name in capital letters. That's not me. That's a corporate fiction.`,
          `I don't have a licence because I'm not engaged in commerce. I'm travelling.`,
          `Under common law — and I'd ask you to look this up — a late fee is a penalty, and penalties require a court.`,
        ];
        if (n >= LINES.length) return finish();
        return say(c, LINES[n], [
          reply(rng.pick([`You're in a video shop.`, `Sir. This is a video shop.`, `None of that is a thing.`]),
            () => beat(n + 1)),
          reply(rng.pick([`Mm-hm. And the tape is three dollars.`, `Right. Three dollars.`, `Sure. Three dollars.`]),
            () => beat(n + 1)),
          reply(`I need you to step aside. There are people waiting.`, () => {
            ctx.mood(c, -12);
            return say(c, `They can wait. This is more important than a Tuesday.`, [
              reply(`...`, () => beat(n + 1)),
            ]);
          }, { risk: true }),
          reply(`Get out of my shop.`, () => { ctx.mood(c, -40); return out(); }, { risk: true }),
        ]);
      };
      const out = () => say(c, `Noted. Recorded. You'll be hearing from a court that you do not recognise either.`, [
        reply(`Goodnight.`, () => { ctx.storm(c); return null; }),
      ]);
      const finish = () => say(c, `...Fine. Three dollars. Under protest, and I want that noted.`, [
        reply(`It's noted.`, () => {
          const t = ctx.giveShelfPick(c);
          c.tape = t; c.checkedOut = true;
          const p = ctx.checkout(t, c);
          ctx.mood(c, +18);
          return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}. Under protest.` : `Under protest.`,
            [reply(`Two nights. Under protest.`, () => farewell(c, ctx))]);
        }, { good: '$2.99' }),
        reply(`Actually, I'd rather you left.`, () => { ctx.leave(c); return null; }, { risk: true }),
      ]);
      return beat(0);
    }

    /* ---------------- the shelf auditor ---------------- */
    case 'AUDITOR': {
      const g = rng.pick(['HORROR', 'COMEDY', 'ACTION', 'SCIFI', 'DRAMA', 'FAMILY']);
      const done = () => farewell(c, ctx);
      return say(c, `Dear, your ${GENRE_LABEL[g]} run is not in order. I've been through it twice.`, [
        reply(`It's alphabetical by title.`, () => say(c,
          `It is alphabetical by SOME title. Whoever did it ignored "THE".`, [
          reply(`...That's a fair point, actually.`, () => { ctx.mood(c, +24); return offer(); }),
          reply(`Nobody has ever complained about that before.`, () => { ctx.mood(c, -8); return offer(); }),
        ])),
        reply(`I'll get to it.`, () => { ctx.mood(c, -6); return offer(); }),
        reply(`Would you like a job?`, () => {
          ctx.mood(c, +30);
          return say(c, `Oh! Oh, no. No. But thank you for asking, that's very — no.`,
            [reply(`Worth a try.`, () => offer())]);
        }),
      ]);
      function offer() {
        return say(c, `I'll take something. Nothing loud.`, [
          reply(`Two forty-nine.`, () => {
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            const p = ctx.checkout(t, c);
            return say(c, p && p.change > 0 ? `I have exact change, dear. I always do.` : `Thank you, dear.`,
              [reply(`Two nights.`, () => done())]);
          }, { good: '$2.49' }),
          reply(`We're closing shortly.`, () => { ctx.mood(c, -4); return done(); }),
        ]);
      }
    }

    /* ---------------- the wrong shop's tape ---------------- */
    case 'RETURNS': {
      const done = () => farewell(c, ctx);
      return say(c, `Returning. Now — before you look at it — hear me out.`, [
        reply(`It's got another shop's sticker on it.`, () => say(c,
          `It does. And they're closed. And they've BEEN closed. Since March.`, [
          reply(`Then it's not my problem, and it's not my tape.`, () => say(c,
            `So what happens to it? Who takes it? Somebody has to take it.`, [
            reply(`Leave it. I'll deal with it.`, () => { ctx.binTape(c.tape, c); c.gaveTape = true; ctx.mood(c, +26); return sell(); }),
            reply(`You take it. It's yours now.`, () => { ctx.mood(c, -14); return done(); }, { risk: true }),
          ])),
          reply(`...Give it here. I'll put it in the bin.`, () => { ctx.binTape(c.tape, c); c.gaveTape = true; ctx.mood(c, +20); return sell(); }),
        ])),
        reply(`I'll take it, whatever it is.`, () => { ctx.binTape(c.tape, c); c.gaveTape = true; ctx.mood(c, +18); return sell(); }),
      ]);
      function sell() {
        return say(c, `Appreciate you. I'll take one of yours while I'm here.`, [
          reply(`Two ninety-nine.`, () => {
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            const p = ctx.checkout(t, c);
            return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `Good man.`,
              [reply(`Two nights.`, () => done())]);
          }, { good: '$2.99' }),
          reply(`Another time.`, () => done()),
        ]);
      }
    }

    /* ---------------- the critic ---------------- */
    case 'CRITIC': {
      const done = () => farewell(c, ctx);
      const rant = (n) => {
        const L = [
          `You've got it in the wrong section, first of all. It isn't horror. It's a chamber piece.`,
          `The version you're renting is the American cut. Eleven minutes shorter. Eleven.`,
          `The director disowned it. Publicly. In print. And people still rent it and think they've seen it.`,
        ];
        if (n >= L.length) return buy();
        return say(c, L[n], [
          reply(`I'll move it to DRAMA.`, () => { ctx.mood(c, +18); return rant(n + 1); }),
          reply(`People like it. That's what a video shop is for.`, () => { ctx.mood(c, -10); return rant(n + 1); }),
          reply(`Do you want it or not?`, () => { ctx.mood(c, -16); return buy(); }, { risk: true }),
          reply(`Tell me more, genuinely.`, () => { ctx.mood(c, +22); return rant(n + 1); }),
        ]);
      };
      const buy = () => say(c, `I'll take it anyway. Obviously I'll take it.`, [
        reply(`Two ninety-nine.`, () => {
          const t = ctx.giveShelfPick(c);
          c.tape = t; c.checkedOut = true;
          const p = ctx.checkout(t, c);
          return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `Thank you.`,
            [reply(`Two nights.`, () => done())]);
        }, { good: '$2.99' }),
      ]);
      return rant(0);
    }

    /* ---------------- the parent ---------------- */
    case 'PARENT': {
      const done = () => farewell(c, ctx);
      return say(c, `Before you ring anything up. Is there anything in it.`, [
        reply(`Anything like what?`, () => say(c,
          `You know what. Language. The other thing. A dog that dies.`, [
          reply(`There is a dog. The dog is fine.`, () => { ctx.mood(c, +22); return buy(); }),
          reply(`I haven't seen it. I can't tell you.`, () => { ctx.mood(c, -12); return push(); }),
          reply(`It's rated for children. That's what the rating is for.`, () => { ctx.mood(c, -6); return push(); }),
        ])),
        reply(`It's a family film. It's on the FAMILY run.`, () => { ctx.mood(c, -4); return push(); }),
        reply(`Give me a second — I'll read the back for you.`, () => { ctx.mood(c, +26); return buy(); }),
      ]);
      function push() {
        return say(c, `That is not an answer. I asked a simple question.`, [
          reply(`Then pick a different one. I'll help you.`, () => { ctx.mood(c, +20); return buy(); }),
          reply(`Ma'am, I run a till. I don't screen the films.`, () => {
            ctx.mood(c, -18);
            return say(c, `Then what exactly is the point of you.`, [
              reply(`Some nights I ask myself that.`, () => { ctx.mood(c, +26); return buy(); }),
              reply(`We'll try the library, then. Yes?`, () => { ctx.storm(c); return null; }, { risk: true }),
            ]);
          }, { risk: true }),
        ]);
      }
      function buy() {
        return say(c, `Fine. This one. And I'm holding you to the dog.`, [
          reply(`Two forty-nine.`, () => {
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            const p = ctx.checkout(t, c);
            return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `Thank you.`,
              [reply(`Two nights.`, () => done())]);
          }, { good: '$2.49' }),
        ]);
      }
    }

    /* ---------------- the salesman ---------------- */
    case 'CLOSER': {
      const done = () => farewell(c, ctx);
      const pitch = (n) => {
        const L = [
          `Five minutes. That's all. Who handles your overstock?`,
          `Because I can move it. Whatever's dead on your shelves, I can move it, and you'd see money on it.`,
          `I'm not asking you to sign. I'm asking you to think. Thinking is free.`,
        ];
        if (n >= L.length) return end();
        return say(c, L[n], [
          reply(`Not interested.`, () => (n >= 1 ? end() : pitch(n + 1))),
          reply(`The owner handles that. He's not here.`, () => { ctx.killerIntel(-1); return pitch(n + 1); }),
          reply(`Go on then. Five minutes.`, () => { ctx.mood(c, +18); return pitch(n + 1); }),
          reply(`You're holding up the line.`, () => { ctx.mood(c, -14); return end(); }, { risk: true }),
        ]);
      };
      const end = () => say(c, `Card's on the counter. I'll take one of these while I'm here.`, [
        reply(`Two ninety-nine.`, () => {
          const t = ctx.giveShelfPick(c);
          c.tape = t; c.checkedOut = true;
          const p = ctx.checkout(t, c);
          return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}. Keep the card.` : `Keep the card.`,
            [reply(`Two nights.`, () => done())]);
        }, { good: '$2.99' }),
        reply(`Just take the card and go.`, () => { ctx.mood(c, -8); ctx.leave(c); return null; }),
      ]);
      return pitch(0);
    }

    /* ---------------- the telephone ---------------- */
    case 'PHONECALL':
      return eject(c, ctx, [
        `(covers the receiver) — sorry, WHAT? (uncovers) No, not you, Denise.`,
        `I'm ALLOWED to be on the phone. It's a phone. In a shop.`,
        `Denise, I'll call you back. No — no, because this MAN — yes. Yes. Bye. Bye. BYE.`,
      ], {
        takes: 3,
        andSell: () => say(c, `Right. Sorry. What have you got that's funny?`, [
          reply(`Two ninety-nine.`, () => {
            const t = ctx.giveShelfPick(c);
            c.tape = t; c.checkedOut = true;
            const p = ctx.checkout(t, c);
            ctx.mood(c, +16);
            return say(c, p && p.change > 0 ? `Out of ${money(p.tendered)}.` : `You're a love.`,
              [reply(`Two nights.`, () => { ctx.leave(c); return null; })]);
          }, { good: '$2.99' }),
          reply(`Another night.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    default:
      return idleRoot(c, ctx);
  }
}
