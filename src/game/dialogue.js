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
import { GENRE_LABEL, tapeLabel, lateFee } from './tapes.js';

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
  const extras = bulletin.extra.slice();
  const C = caseFile || {};
  const A = C.angle || {};

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

  const detail = () => say(officer, bulletin.description, [
    reply('Let me write that down.', () => askNode()),
    reply(`That's half the men in this county.`, () => say(officer,
      `Yeah. It is. That's the problem.`, [reply('...', () => askNode())])),
  ]);

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
export function talkTo(c, ctx) {
  if (c.awaitingChange) return changeRoot(c, ctx);
  if (c.mood <= 0 && !c.resolvedAnger) return angryRoot(c, ctx);
  if (c.script === 'confused' && !c.confusionResolved) {
    c.confusionResolved = true;
    return confusedRoot(c, ctx);
  }
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
  const fee = lateFee(tape.daysLate);

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
  const fee = lateFee(tape.daysLate);
  const disputes = !c.isKiller && rng() > c.personality.honesty;

  const paid = () => {
    c.feeSettled = true;
    const t = ctx.takeCash(fee, c, 'late fee');
    ctx.mood(c, +2);
    return say(c, t.change > 0
      ? `${rng.pick(['Out of ' + money(t.tendered) + '.', 'Only got a ' + money(t.tendered) + ' on me.', 'Sorry, big bill.'])}`
      : line(c, 'thanks', rng, `Thanks.`),
      [reply(t.change > 0 ? `I'll get your change.` : `...`, () => then())]);
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
  const opening = say(c, `${tapeLabel(tape)} — ${tape.daysLate} day${tape.daysLate > 1 ? 's' : ''} over. That's ${money(fee)}.`,
    [], { asPlayer: true });

  opening.next = () => {
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
  return opening;
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
  if (!tape.rewound) {
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
function rentRoot(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return idleRoot(c, ctx);
  const price = tape.price;
  const finish = () => farewell(c, ctx);

  const complete = () => {
    c.checkedOut = true;
    const t = ctx.checkout(tape, c);
    return say(c, t && t.change > 0
      ? `Out of ${money(t.tendered)}, sorry.`
      : line(c, 'thanks', rng, `Thanks.`),
      [reply('Two nights. Be kind, rewind.', () => finish())]);
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
    reply(`Good pick. Ever seen it?`, () => {
      ctx.mood(c, +8);
      return say(c, rng.pick([
        `Not yet. That's rather the point.`,
        `Three times. I keep renting it anyway.`,
        `My brother says it's the worst thing ever made. So.`,
        `...No.`,
      ]), [reply(`${money(price)}, then.`, () => ring())]);
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

  const relented = () => say(c, P.relent, [
    reply(`Happens more than you'd think.`, () => { ctx.mood(c, +12); return sell(); }),
    reply(`It's been a long night for both of us.`, () => { ctx.mood(c, +16); return sell(); }),
    reply(`Yeah. Have a good one.`, () => { ctx.mood(c, -2); return done(); }),
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
      return say(c, P.exit, [reply(`Mm-hm.`, () => done())]);
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
    const lines = holding ? [
      `Is this the one with the boat in it? The box makes it look like there's a boat.`,
      `Have you seen this? Is it any good? Be honest with me.`,
      `Two hours and six minutes. That's a lot of movie for a Tuesday.`,
      `It says "unrated." Unrated by who?`,
      `...I'm going to put this back. I'm sorry.`,
    ] : [
      `Still looking. I'll come to you.`,
      `Do you have anything with a dog in it? Not a sad dog.`,
      `Where'd you move the ${GENRE_LABEL[rng.pick(['HORROR', 'COMEDY', 'ACTION', 'SCIFI'])]} section?`,
      `I'll know it when I see it.`,
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
