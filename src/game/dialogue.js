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
import { traitBulletin } from './appearance.js';
import { TAPE_TALK, SEEN_IT } from './chatter.js';
import { GENRE_LABEL, GENRES, tapeLabel, lateFee, mediaWord } from './tapes.js';

const money = (v) => `$${v.toFixed(2)}`;
const round2 = (v) => Math.round(v * 100) / 100;

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

  /* ---- the night he comes to say it is finished ---- */
  if (C.standDown) {
    return say(officer, `${C.greeting}\n\n${C.allClear}`, [
      reply(`You're certain.`, () => say(officer,
        `${C.allClearWhy}\n\nI would not come in here and say it if I wasn't.`, [
        reply(`Then that's that.`, () => standDownOutro()),
        reply(`You said that in September.`, () => say(officer,
          `I did. And I was wrong in September, and I have had to live in this county since.\n\nI am not wrong tonight.`,
          [reply(`...Alright.`, () => standDownOutro())]), { risk: true }),
      ])),
      reply(`So there's nothing to look for tonight.`, () => say(officer,
        `Nothing. Sell your tapes. Lock up at midnight because it's midnight, not because of anybody.`,
        [reply(`I'll take it.`, () => standDownOutro())])),
      reply(`What happens now?`, () => say(officer,
        `${C.allClearWhy}\n\nNow it's paperwork, and then it's somebody else's town.`,
        [reply(`Goodnight, deputy.`, () => standDownOutro())])),
    ]);
  }

  function standDownOutro() {
    return say(officer, rng.pick([
      `Get home safe. For the ordinary reason, for once.`,
      `Enjoy the quiet. They don't come round often.`,
      `You did alright these last few weeks. Somebody should say so.`,
    ]), [reply(`Goodnight.`, () => { ctx.finishIntro(); return null; })]);
  }

  const notepadLine = () => say(officer,
    `Write it down. All of it.\n\nYou keep that where you can get at it -- ${ctx.notesKey()} -- and you hold it up against every face that comes through that door. Not most of it. All of it.`,
    [reply(`I've got it.`, () => outro())]);

  const outro = () => say(officer,
    bulletin.certain
      ? `Keep that door where you can see it. If someone matching that comes in — you don't confront them, you don't be clever. You lock the door and you get on that phone.\n\nAnd clerk? Be sure. We had a fella call it in last week on his own mailman.`
      : `Might be nothing tonight. Might be. Either way — you see it, you lock up and you call. Be sure before you do.`,
    [reply('Understood.', () => { ctx.finishIntro(); return null; })]);

  /* Why the list is longer than it was last night.
     The county is not getting nowhere -- they take somebody most nights,
     and every one of them talks. So the description grows, which sounds
     like progress and is in fact the problem: by the end of a run every
     ordinary customer matches four things on a list of nine. */
  const whyMore = () => say(officer, C.moreDetail, [
    reply(`So you know more than you did yesterday.`, () => say(officer,
      `${C.whyMoreHelps}`, [
      reply(`Read it out.`, () => detail()),
      reply(`How many of them are there?`, () => howMany()),
    ])),
    reply(`That's ${C.detailCount} things to check on every customer.`, () => say(officer,
      rng.pick([
        `It is. I'd rather hand you ${C.detailCount} and have you slow than hand you two and have you wrong.`,
        `Yes. And you have got a line and one pair of eyes, and I am sorry about that.`,
        `Which is why you write it down instead of trying to hold it in your head.`,
      ]), [reply(`Go on, then.`, () => detail())])),
    reply(`Just give me tonight's.`, () => detail()),
  ]);

  const howMany = () => say(officer, C.howMany, [
    reply(`...Right.`, () => detail()),
    reply(`And you're still calling it one man on the radio.`, () => say(officer,
      rng.pick([
        `I do not write the radio.`,
        `You have noticed that too, then.`,
        `Take that up with the sheriff. Bring a witness.`,
      ]), [reply(`Read me the description.`, () => detail())]), { risk: true }),
  ]);

  /* Why it is a different man tonight.
     A player who is paying attention will notice that the person they put
     in a cruiser on Tuesday is not the person at the glass on Wednesday,
     and the deputy is the only one in the building who can account for it. */
  const theOtherOne = () => say(officer,
    `${C.priorArrest}\n\n${C.differentMan}`, [
    reply(`So it isn't the same person.`, () => say(officer,
      `${A.why || `No. It is not.`}`, [
      reply(`How many of them are there?`, () => howMany()),
      reply(`Then how do you have MORE on him than you did yesterday?`, () => whyMore()),
      reply(`Then the description's no good to me.`, () => say(officer,
        `The description is what we have got tonight, and there is more of it than there was last night. Tomorrow there will be more again.`,
        [reply(`Go on, then.`, () => detail())])),
    ])),
    reply(`What did last night's one tell you?`, () => whyMore()),
    reply(`Just give me tonight's.`, () => detail()),
  ]);

  const askNode = () => {
    const cs = [];
    if (extras.length && asked < 3) {
      cs.push(reply('Anything else you can give me?', () => {
        asked++;
        const e = extras.shift();
        ctx.addBulletinDetail(e);
        return say(officer, e.officerLine, [
          ...(extras.length && asked < 3 ? [reply('Anything else?', () => askNode().choices[0].fn())] : []),
          reply(`Got it.`, () => outro()),
        ]);
      }));
    }
    cs.push(reply(`How sure are you it's tonight?`, () => say(officer,
      bulletin.certain ? C.certainYes : C.certainNo,
      [reply('Great. Thanks.', () => outro())])));
    if (C.grew) {
      cs.push(reply(`Why is there more of it every night?`, () => say(officer,
        `${C.moreDetail}\n\n${C.whyMoreHelps}`, [reply(`...Right.`, () => outro())])));
    }
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
      ...(C.grew ? [reply(`That's more than last night.`, () => whyMore())] : []),
    ]);
  };

  const alias = C.alias ? ` The papers are calling it ${C.alias}.` : '';
  const opener = C.caughtLast
    ? `${C.greeting}\n\nWe've got a new description out on somebody working this side of the river. New one. Not the one from last night — and there's more of it than there was.`
    : `${C.greeting}\n\nWe've got a description out on somebody working this side of the river. I'm hitting every business still lit up.${alias}`;

  return say(officer, opener, [
    ...(C.caughtLast ? [reply(`Hold on. You caught somebody last night.`, () => theOtherOne())] : []),
    ...(C.grew ? [reply(`More of it how?`, () => whyMore())] : []),
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
  /* Anybody can be driven out by being rude to them -- except the few
     whose way out is an errand you have not run yet. Grinding the man
     waiting on a pizza down to nothing used to send him home, which made
     "be unpleasant twenty times" a faster solution than the pizza and
     quietly deleted the whole character. He stays. He just hates you. */
  if (c.mood <= 0 && !c.resolvedAnger && !c.immovable) return angryRoot(c, ctx);
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
    reply(`Then I can't check the ${mediaWord(tape)} back in.`, () => {
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
  }, { good: `take ${mediaWord(tape)}` }));
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
 * movie, it is the movie they are actually holding. Nobody discusses a
 * comedy while clutching a slasher.
 */
/**
 * They have talked themselves into renting something.
 *
 * Nobody is served where they stand. The store conjuring a tape into
 * somebody's hands mid-conversation is how a special ended up paid for in
 * the middle of the floor and then walked out on her own change. So the
 * sale is not made here: they go and pick something off a shelf like
 * everyone else, walk it to the counter, and join the back of the line.
 */
function goShopping(c, ctx, said, opts = {}) {
  ctx.sendToShop(c, opts);
  return say(c, said, [reply(opts.close || `The counter's over there.`, () => null)]);
}

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

/* ============================================================
   THE ONES OFF THE COACH

   They all look the same and they are not all the same. About one in four
   wants to tell you about the journey before they will let you ring
   anything up, and they will take as long over it as you let them. The
   line does not stop forming while they do.

   You can cut them off. It costs you nothing but their good opinion, and
   on a night with two dozen of them their good opinion is not the scarce
   thing -- the counter is.
   ============================================================ */
const BUS_RAMBLE = [
  [`We came up on the coach. Four hours. FOUR hours, and they stopped once, at a place with one bathroom.`,
   `And the driver, right, the driver would not put the heat on. Said it was broken. It was not broken, because when we complained it came on.`,
   `Anyway. Anyway! Sorry. What was I — yes. This.`],
  [`Have you ever been on a coach with somebody who has brought their own egg sandwiches? Because I have. Today. For four hours.`,
   `Nobody said anything. That's the part I can't get past. Twenty-odd people and not one of us said a word about the eggs.`,
   `So that's where my head is at. Sorry. Yes. This one.`],
  [`Is this the town with the water tower they painted? Somebody said there was a water tower.`,
   `We've been through about six towns today and I could not tell you which was which. They all had a laundromat.`,
   `Right. Sorry. I'm holding you up.`],
  [`We're all together, if you're wondering. The whole coach. We've got matching coats, which was not my idea.`,
   `It was Denise's idea. Denise is somewhere behind me and she can hear me saying this.`,
   `Where was I. The movie. Yes.`],
  [`I'll be honest with you, I don't even want a movie. But everybody's getting one and I'm not standing outside on my own.`,
   `That's most decisions, though, isn't it. When you actually look at them.`,
   `...Sorry. Long day. This one, please.`],
];

function busRamble(c, ctx, then) {
  const rng = ctx.rng;
  if (!c.rambleSet) c.rambleSet = rng.pick(BUS_RAMBLE);
  const beats = c.rambleSet;

  const go = (i) => {
    if (i >= beats.length) { c.rambles = -1; return then(); }
    return say(c, beats[i], [
      reply(rng.pick([`Mm.`, `Right.`, `Go on.`]), () => go(i + 1)),
      reply(rng.pick([`That does sound like a long day.`, `Four hours is a long time.`,
        `I can imagine.`]), () => { ctx.mood(c, +6); return go(i + 1); }),
      /* The line is the pressure. Cutting them off is the button that
         exists because of it. */
      reply(`I'm going to have to stop you. Look at the line.`, () => {
        ctx.mood(c, -10);
        c.rambles = -1;
        return say(c, rng.pick([
          `...Right. No, you're right. Sorry.`,
          `Oh. Yes. Sorry, I do that.`,
          `(they glance behind them and go slightly pink)`,
        ]), [reply(`It's fine. Let's get you sorted.`, () => then())]);
      }, { risk: true }),
    ]);
  };
  return go(c.rambles || 0);
}

function rentRoot(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
  if (!tape) return idleRoot(c, ctx);
  /* One of the coach party, and one of the ones who wants to talk about
     it. Nothing gets rung up until that is dealt with, one way or the
     other. */
  if (c.fromBus && c.rambles >= 0) return busRamble(c, ctx, () => rentRoot(c, ctx));
  /* A price settled earlier -- the coupon man's free one, his thirty cents
     off -- travels with him to the counter rather than being rung up on the
     spot in the middle of an argument. */
  const price = c.priceAgreed != null ? c.priceAgreed
    : Math.max(0, Math.round((tape.price - (c.priceDiscount || 0)) * 100) / 100);
  const finish = () => farewell(c, ctx);

  const complete = () => {
    c.checkedOut = true;
    const off = round2(tape.price - price);
    if (off > 0.001) ctx.waive(off);
    const t = ctx.checkout(tape, c, price <= 0.001, price);
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
    push: `I can see the menu boards right there behind you. The little colored ones.`,
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
    play: `Galvanized, if you've got it. It's going outside.`,
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
    relent: `...I have brought a cat into a video store.\n\nHe's going to be insufferable about this.`,
    play: `Should I take him out of the box? He bites when he's out of the box.`,
    exit: `Come on, Duchess. Nobody here is a professional.`,
  },
  photo: {
    open: `Pickup for Ruiz. One hour. It's been about nine.`,
    push: `Doubles. I always order doubles. It'll say doubles on the envelope.`,
    relent: `Those aren't envelopes, are they. Those are little boxes with movies in them.`,
    play: `If any came out dark I'm not paying for the dark ones.`,
    exit: `That is a roll of my daughter's christening and somebody has LOST it.`,
    storms: true,
  },
  taxes: {
    open: `I've got the four o'clock with Denise. I brought everything. I brought the shoebox.`,
    push: `Denise. Short woman. Does the returns. She's got a little jar of pens.`,
    relent: `Oh, this is the video store. Denise is TWO DOORS DOWN.`,
    play: `Can I still write off the boat? I want to write off the boat.`,
    exit: `I have taken a half day for this.`,
    storms: true,
  },
  bowling: {
    open: `Eleven and a half. And is lane six still hooking? Because I'm not paying for lane six again.`,
    push: `Shoes. The rack of shoes. Behind you, with all the little numbers on the heels.`,
    relent: `Those have got movie titles on them. Shoes don't have movie titles on them.`,
    play: `Half size up if you're out. I'd rather swim than pinch.`,
    exit: `League starts in ten minutes. TEN MINUTES.`,
    storms: true,
  },
  jury: {
    open: `(holds up a summons) It says report to the annex. Is this the annex? Nobody's at the annex.`,
    push: `I'm not trying to get out of it. I want to be here. That's the whole point.`,
    relent: `...The annex is the gray building. This is the one with the neon sign of a filmstrip.`,
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
    relent: `Those are movie cases. Those are — that's a shark on that one. That's not a beach.`,
    play: `Aisle seats. And a rental car, something with air conditioning.`,
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
    push: `Somebody said the old storefront on the block. This is the old storefront on the block.`,
    relent: `That's a lot of horror movies for a church basement. I did wonder.`,
    play: `Am I early? I'm always early. It's a nervous thing.`,
    exit: `I actually needed that tonight.`,
  },
  bar: {
    open: `Bud. Bottle, not the tap, the tap here's always warm. And whatever the man behind me is having.`,
    push: `You've got a counter, and a register, and it's dark in here. What else would this be?`,
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
    open: `I want the one that's in the theater right now. The big one. With the boat.`,
    push: `I don't want to GO to the theater. I want you to have it here. Tonight.`,
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
    push: `A fast watcher gets the whole movie for three dollars. I get a third of it. That's discrimination.`,
    relent: `...I suppose I could rent it twice.\n\nI don't like that I've talked myself into that.`,
    play: `Put me down for two weeks. And no phone calls about it.`,
    exit: `Three dollars for twenty minutes of a movie. Highway robbery.`,
    storms: true,
  },
  colorize: {
    open: `Have you got this one in color? The one I watched was all gray and I thought my set was going.`,
    push: `They do it. I've seen them do it. Ted Turner does it.`,
    relent: `So this is just how it IS. Forever. Nobody's going to fix it.`,
    play: `Nothing garish. Just — natural colors. Skin, sky, that sort of thing.`,
    exit: `Gray movie. Gray town. Gray everything.`,
  },
  commercials: {
    open: `There were eleven minutes of commercials before the movie. I timed them. I want eleven minutes back.`,
    push: `I pay for a movie. I don't pay for commercials for other movies. That's their business, not mine.`,
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
    exit: `A business with no system. Marvelous.`,
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
        `Alright. Point me at something. Something with a dog.`,
        `You know what? Yes. I'm owed something today.`,
      ]), [
        reply(`Have a look around. I'll ring it up at the counter.`, () => {
          if (!c.hasMoney) { ctx.mood(c, -6); return say(c, `...Naturally I have no money.`, [reply('...', () => done())]); }
          ctx.mood(c, +14);
          return goShopping(c, ctx, `Right. Right! A video. From a video store.`);
        }),
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
        `Before you go — one movie. On the house of my patience.`,
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
    // If they are holding something, they talk about that -- not a movie
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

  /* If the thing is ringing, picking it up answers it. Nothing else on
     this phone matters until you have found out who that is. */
  const P = ctx.pizzaState && ctx.pizzaState();
  if (P && P.phase === 'RINGING') { ctx.pizzaAnswered(); return buildPizzaOrder(ctx); }

  /* And once there is a man in the store waiting on food, the parlor is
     on the list -- it is the only thing that gets rid of him. */
  /* Until the order is actually in an oven. It used to hide the row the
     moment he agreed to something else, which is precisely the moment you
     need to call them back -- so the one call that ends this was taken off
     the list one step before you could make it. */
  const parlorRow = P && !P.done && P.customer
    && P.phase !== 'COOKING' && P.phase !== 'DELIVERING'
    ? [reply(`Call Bertucci's down the block.`, () => buildPizzaParlor(ctx))]
    : [];

  /* There is a woman at the counter who wants the regional manager, and
     the regional manager is a man forty minutes away who went to bed at
     ten. Calling him is its own little errand and it does not work first
     time; see managerCall() below. */
  const karen = ctx.wantsManager && ctx.wantsManager();
  const managerRow = karen && !ctx.managerConnected()
    ? [reply(`Call the regional manager.`, () => managerCall(ctx, karen), { risk: false })]
    : [];

  if (!suspects.length && (managerRow.length || parlorRow.length)) {
    return say(OP, `(dial tone)`, managerRow.concat(parlorRow).concat([
      reply(`Put it back down.`, () => hang()),
    ]));
  }

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
      .concat(managerRow).concat(parlorRow)
      .concat([reply(`Never mind. Sorry.`, () => hang())]));

  return choose();
}

/* ============================================================
   CALLING THE REGIONAL MANAGER

   Half past eleven on a Friday. He is forty minutes away, he has a wife,
   a machine, and a teenage daughter, and he went to bed at ten. You do
   not get him on the first go and you do not get him on the second.

   Each attempt is a separate call: you put the receiver down, and if you
   want him you pick it up and try again. Which is exactly the amount of
   effort the woman at the counter is worth.
   ============================================================ */
const MANAGER_MISSES = [
  { who: 'THE LINE',
    text: `(it rings. And rings. Eleven times, twelve.)\n\n(nobody is going to pick that up)`,
    outs: [`Put it down.`, `...Once more, later.`] },
  { who: 'A MACHINE',
    text: `"Hi! You've reached the Vandeveldes. We can't come to the phone —"\n\n(a child shouting somewhere behind it)\n\n"— so leave it after the beep!"`,
    outs: [`I'm not leaving this on a machine.`, `(hang up)`] },
  { who: 'A WOMAN',
    text: `"...Hello?"\n\n(she has been asleep. You can hear that she has been asleep.)\n\n"He's in bed. Whatever it is, it's in bed with him. Call the office Monday."`,
    outs: [`It's about the store on Delaney.`, `Sorry to have woken you.`] },
  { who: 'A TEENAGER',
    text: `"...What."\n\n(long pause)\n\n"He's asleep. I'm asleep. Everyone in this house is asleep except you."`,
    outs: [`Could you wake him?`, `...Right. Sorry.`] },
  { who: 'THE LINE',
    text: `(engaged)\n\n(somebody in that house has taken it off the hook)`,
    outs: [`(put it down)`, `I'll try again.`] },
];

const MANAGER_ANSWERS = [
  `"...Vandevelde."\n\n(a man sitting up in the dark, getting his voice on)\n\n"It's — what time is it. Who is this?"`,
  `"Yeah. Yeah, hello."\n\n(he sounds like he has come down a flight of stairs to do this)\n\n"Somebody had better be robbing me."`,
  `"This is Vandevelde."\n\n(entirely awake, and not pleased about it)\n\n"You're one of my stores. Which one."`,
];

function managerCall(ctx, karen) {
  const rng = ctx.rng;
  const n = ctx.managerAttempt();        // 1, 2, 3... and it counts up
  const hang = () => { ctx.hangUp(); return null; };

  /* He answers on the third go at the earliest, and always by the fifth.
     Any less and the errand is nothing; any more and it is a slot
     machine. */
  const gotHim = n >= 5 || (n >= 3 && rng.chance(0.55));

  if (!gotHim) {
    const miss = MANAGER_MISSES[(n - 1) % MANAGER_MISSES.length];
    const M = { name: miss.who, voicePitch: 1.0, rough: 0.35 };
    return say(M, miss.text, miss.outs.map((o) => reply(o, () => hang())));
  }

  ctx.managerConnect();
  const M = { name: 'D. VANDEVELDE', voicePitch: 0.88, rough: 0.5 };
  const over = (line) => say(M, line, [
    reply(`There's a customer here who'd like to speak to you.`, () => handOff()),
    reply(`I'm going to put someone on.`, () => handOff()),
  ]);

  const handOff = () => say(M, rng.pick([
    `"...You're going to WHAT."\n\n(a long breath)\n\n"Fine. Put her on. Put her on."`,
    `"A customer. At half past eleven at night. Of course there is."\n\n"Go on then."`,
    `"Right." \n\n(you can hear him deciding to be a professional about it)\n\n"Put her on, son."`,
  ]), [
    reply(`Hold the line.`, () => {
      ctx.toast(`He's on the line. ${karen ? karen.name : 'She'} needs to be within reach of the cord.`, 'good');
      return null;
    }),
  ]);

  return over(rng.pick(MANAGER_ANSWERS));
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

/** How far gone he is, said the way you would see it rather than as a number. */
function wearWord(left) {
  if (left > 0.82) return 'he is not listening yet';
  if (left > 0.62) return 'he is listening, and pretending not to';
  if (left > 0.42) return 'he has started gathering his things';
  if (left > 0.22) return 'he keeps glancing at the door';
  return 'he is nearly out of the building';
}

/**
 * The two who will not be told.
 *
 * Neither of them thinks he is doing anything. There is no single line that
 * gets rid of either one -- you work them down over a lot of exchanges, and
 * between exchanges they go back to what they were doing and you have to
 * come and start again. That is deliberate: they are a tax on the night,
 * paid in the only currency the shift has, which is time.
 *
 * `resist` is how much of them is left. Standing your ground takes it down.
 * Arguing on their terms does not, and one or two things put it back up.
 */
function grind(c, ctx, spec) {
  const rng = ctx.rng;
  if (c.resist === undefined) c.resist = spec.resist;

  /* Between goes he is not listening -- but keeping at him still counts.

     It used to count for nothing at all: nine tries in ten got a brush-off
     that changed no state and said nothing, so a player standing there
     working at him saw a man who could not be moved and concluded he was
     broken. He was not; he just did all his moving in the one try out of
     ten that landed. Pestering now chips at both his patience for you and
     his position, so it is the slow way rather than the no way, and the
     line says which of the two you are getting. */
  if (c.brushT > 0) {
    c.brushT = Math.max(0, c.brushT - spec.cool * 0.22);
    c.resist = Math.max(0, c.resist - 0.11);
    ctx.wearingDown(c, 1 - c.resist / spec.resist);
    if (c.resist <= 0) return leaving();
    return say(c, `${rng.pick(spec.brush)}\n\n(${wearWord(c.resist / spec.resist)})`,
      [reply(`I'm not going away.`, () => null)]);
  }

  if (c.resist <= 0) return leaving();

  function leaving() {
    return say(c, rng.pick(spec.gone), [
      reply(`Out.`, () => { ctx.leave(c); return null; }),
      ...(spec.andSell ? [reply(`...Wait. Do you actually want to rent something?`,
        () => { ctx.mood(c, +14); return spec.andSell(); })] : []),
    ]);
  }

  const step = (d, then) => {
    c.resist = Math.max(0, c.resist - d);
    c.brushT = spec.cool;
    return then;
  };

  /* Which beat he is on: how far you have got, mapped across the list.
     This used to divide the other way round and came out at -1 on the very
     first exchange, so the opening line of every one of these was the
     word "undefined". */
  const done = spec.resist - c.resist;
  const beat = spec.beats[Math.max(0, Math.min(spec.beats.length - 1,
    Math.floor(done * spec.beats.length / spec.resist)))];

  const cs = [
    reply(rng.pick(spec.firm), () => step(1, say(c, rng.pick(spec.give), [
      reply(`Good. Keep going.`, () => null),
    ]))),
    reply(rng.pick(spec.firmer), () => {
      // Leaning harder works, but he digs in first and you get one more round.
      if (rng.chance(0.34)) {
        c.resist = Math.min(spec.resist, c.resist + 1);
        c.brushT = spec.cool;
        return say(c, rng.pick(spec.dig), [reply(`...`, () => null)]);
      }
      return step(2, say(c, rng.pick(spec.give), [reply(`Right.`, () => null)]));
    }, { risk: true }),
    reply(rng.pick(spec.reason), () => step(0, say(c, rng.pick(spec.deflect), [
      reply(`That isn't what I asked.`, () => null),
    ]))),
    reply(`...Forget it.`, () => { ctx.mood(c, +4); c.brushT = spec.cool; return null; }),
  ];
  return say(c, beat, cs);
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
          reply(`Go and find one. Bring it to the counter.`, () => {
            ctx.mood(c, +20);
            return goShopping(c, ctx, `Say no more. Say NO more.`, { close: `And turn that off.` });
          }),
          reply(`We're closing. Another night.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    /* ---------------- the assignment ----------------
       He was contacted in his sleep and given a mission, and the mission
       ends in this store's basement. There is no basement. Saying so does
       not help, and saying so twice makes it worse -- he did not come here
       to be told the building's floor plan, he came to be let in.

       The one thing that works is not a denial at all. It is an
       alternative address. Give him somewhere else to be and he goes
       there, because a man on a mission would rather have the wrong
       basement than no basement. */
    case 'BASEMENT':
      return basementRoot(c, ctx);

    /* ---------------- offended on somebody else's behalf ----------------
       She is not upset about the thing. She is upset that anybody was
       upset about the thing, and once that is out of the way the
       conversation leaves the subject entirely and does not come back.
       She does rent something. It just takes a while to get there. */
    case 'OFFENDED':
      return offendedRoot(c, ctx);

    /* ---------------- the manager ----------------
       Talking to her achieves nothing, on purpose. Her complaint is not
       with you and you cannot fix it -- there is no light on the back of
       the building and you do not own the building. Every reply is a
       variation on "I'd like to speak to your manager", and the only
       thing that ends it is a man forty minutes away, asleep, whose
       phone number is on a card by the register. */
    case 'MANAGER':
      return managerRoot(c, ctx);

    /* ---------------- the pizza ----------------
       He called, he ordered, and he is here to collect. Nothing you say
       moves him, because he is not confused -- he is certain. The only
       thing that ends it is a box on the counter. */
    case 'PIZZA':
      return pizzaRoot(c, ctx);

    /* ---------------- the popcorn ----------------
       He is having the time of his life and he is not being malicious
       about it, which somehow makes him harder to shift. A grind, like
       the smell and the smoker: no single line does it, you work him
       down. And unlike them, what he leaves behind is on your floor. */
    case 'POPCORN':
      return grind(c, ctx, {
        resist: 8,
        cool: 11,
        beats: [
          `(he is laughing too hard to answer)`,
          `Look at it. LOOK at it. It's still going!`,
          `I didn't think it'd all fit. It all fit!`,
          `Alright, alright — one more minute. One more.`,
          `Have you seen how far it's gone? It's by the door!`,
          `Okay. Okay, I'm going. I am. I'm going.`,
          `(he is wiping his eyes)`,
          `That was the best thing I've done all year.`,
        ],
        firm: [
          `Get out from behind my counter.`,
          `Out. Now.`,
          `You need to leave. Right now.`,
          `That's enough. Move.`,
        ],
        firmer: [
          `Leave, or I'm calling the county.`,
          `I'm not asking again. Out.`,
          `You're going to pay for that machine.`,
        ],
        reason: [
          `Do you know how long that takes to clean up?`,
          `Somebody is going to slip on that.`,
          `That machine costs more than I make in a month.`,
        ],
        give: [
          `(he backs off a step, still giggling)`,
          `Alright. Alright! God.`,
          `(he holds his hands up, not sorry at all)`,
        ],
        dig: [
          `Oh come ON. It's POPCORN. Nobody's hurt.`,
          `You're going to remember this. You'll laugh about it.`,
          `One more scoop. One. Then I'll go.`,
        ],
        deflect: [
          `You could just... not clean it up? Leave it?`,
          `It's biodegradable. Corn is.`,
          `Get a mop. Have you got a mop?`,
        ],
        brush: [
          `(he has gone back to watching it)`,
          `(he is not listening. He is watching the popcorn)`,
          `(he says something, but he is laughing, so it is not words)`,
        ],
        gone: [
          `Fine! Fine. I'm going.\n\n(he looks back at it on his way past)\n\nWorth it, though.`,
          `Alright. I'm out.\n\n(at the door)\n\nYou want to get a bigger tub, though. That one's too small.`,
          `Going, going.\n\n(he is still laughing at the door)\n\nSorry about your floor. Genuinely. Sort of.`,
        ],
      });

    /* ---------------- the smell ----------------
       He does not think he smells. He thinks you have a problem with him,
       and he would like to discuss it, at length, in the aisle. */
    case 'REEKER':
      return grind(c, ctx, {
        resist: 9,
        cool: 14,
        beats: [
          `I'm looking. A man's allowed to look.`,
          `I haven't touched anything. Have I touched anything? Name one thing.`,
          `Is this about how I look? Because it sounds like it's about how I look.`,
          `I've been coming to this block since before you worked here.`,
          `There's no sign. Show me the sign that says I can't stand here.`,
          `You know what this is? This is discrimination, is what this is.`,
          `I have a right to be in a store. That's not a special right, that's the normal one.`,
          `Fine. FINE. But I want it on record that I was going to rent something.`,
        ],
        firm: [
          `I need you to leave.`,
          `You're going to have to go.`,
          `This isn't a discussion. Out.`,
          `I'm not arguing with you. The door's there.`,
        ],
        firmer: [
          `Leave, or I call the county and they can explain it to you.`,
          `Out. Now. I'm done being polite about it.`,
          `You are clearing off or I am clearing you off.`,
        ],
        reason: [
          `Sir, people can smell you from the door.`,
          `It's not about you. It's about the store.`,
          `Nobody else can stand in here.`,
          `I have customers who won't come to the counter.`,
        ],
        give: [
          `...Alright. Alright, I hear you. Give me a minute.`,
          `You don't have to say it like that. I'm going.`,
          `Fine. I'm gathering my things. Such as they are.`,
          `(he doesn't move, but he stops arguing)`,
        ],
        dig: [
          `No. No, now I'm staying. Now it's a principle.`,
          `You raise your voice at me and I'll be here all night.`,
          `See, that's the tone. That's exactly the tone.`,
        ],
        deflect: [
          `Everybody smells of something. You smell of that carpet.`,
          `It's the coat. It's not me, it's the coat, and the coat's outside my control.`,
          `I can't smell anything, so.`,
          `That's their problem, isn't it. That's not a me problem.`,
        ],
        brush: [
          `(he has turned his back and is reading a box he is not reading)`,
          `We already talked. I'm going in a minute.`,
          `Mm. In a minute.`,
        ],
        gone: [
          `Right. That's me. And I hope you're pleased with yourself.`,
          `I'm going. I said I was going. I've been going this whole time.`,
        ],
      });

    /* ---------------- the television ----------------
       He is not being difficult. He genuinely cannot hold on to the idea of
       leaving for long enough to do it, and the conversation keeps coming
       back round to the screen. */
    case 'SMOKER':
      return grind(c, ctx, {
        resist: 10,
        cool: 16,
        beats: [
          `(he does not look away from the screen) ...Yeah.`,
          `There's a pattern in it. If you watch long enough there's a pattern.`,
          `Wait, sorry — you said something. Say it again.`,
          `I'm not watching it watching it. It's more like it's on.`,
          `Okay so. Okay. What was the question.`,
          `Am I in the way? I can stand somewhere else. Where should I stand.`,
          `You know when you know you have to do a thing, but the thing is later?`,
          `Yeah, no, totally. Totally. ...What are we doing?`,
          `I feel like we've had this conversation. Have we had this conversation?`,
        ],
        firm: [
          `You need to go home.`,
          `Out. Front door. Now.`,
          `I need you to leave the store.`,
          `Go. Home. Two words.`,
        ],
        firmer: [
          `I am walking you to that door myself in a minute.`,
          `LEAVE. Do you understand the word?`,
          `Out, or I'm calling somebody about it.`,
        ],
        reason: [
          `You smell like a bonfire in a hedge.`,
          `Everyone in here can smell you, man.`,
          `I've got people who won't come to the register.`,
          `You've been standing there forty minutes.`,
        ],
        give: [
          `Yeah. Yeah, okay. That's fair. I'm gonna go.`,
          `Right. Door. I know where the door is.`,
          `Okay. Okay okay okay. Going. Going now.`,
          `(he takes one step toward the door and stops)`,
        ],
        dig: [
          `Whoa. Hey. You don't have to be like that about it.`,
          `That's — okay, now I feel weird. Now I'm gonna need a minute.`,
          `See now I've forgotten what I was doing and it's because of that.`,
        ],
        deflect: [
          `That's just my jacket. My jacket's been through some stuff.`,
          `Is it me? It might be me. It's probably the carpet though.`,
          `Do you ever think about how a tape has the whole movie on it? Just — sitting there?`,
          `What's on after this one?`,
        ],
        brush: [
          `(he has gone back to the screen and does not appear to have noticed you leave)`,
          `Yeah man. In a minute.`,
          `Hm? Oh. Hey.`,
        ],
        gone: [
          `Yeah, no, I hear you. I'm going. This has been really nice, though.`,
          `Okay. I'm out. You're a good person. I said that already, right?`,
        ],
        andSell: () => say(c, `Do you have the one where nothing happens?`, [
          reply(`Comedy section. Off you go.`, () => {
            if (!c.hasMoney) { return say(c, `Ah. Yeah. Money.`, [reply('...', () => { ctx.leave(c); return null; })]); }
            ctx.mood(c, +16);
            return goShopping(c, ctx, `You're a good person. I said that already.`,
              { genre: 'COMEDY', close: `The counter. When you're ready.` });
          }),
          reply(`Just go home.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    /* ---------------- a movie that does not exist ---------------- */
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
        reply(`Pick something out and I'll ring it up.`,
          () => goShopping(c, ctx, `Fine. But I want it noted that I asked for the other one.`)),
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
          reply(`It's a napkin. You wrote COUPON on a napkin in ballpoint pen.`, () => (n >= 2 ? end() : push(n + 1)), { risk: true }),
          reply(`Tell you what. One free rental. Go and pick it.`, () => {
            ctx.mood(c, +34);
            return goShopping(c, ctx, `See? SEE? The coupon works.`,
              { price: 0, close: `It does not work. Go on.` });
          }, { cost: '-$2.99' }),
          reply(`I can do ten percent. That's what I can do.`, () => {
            ctx.mood(c, +14);
            return say(c, `Ten percent. Off a three dollar rental. Thirty cents.`, [
              reply(`Thirty cents.`, () => sellHim()),
            ]);
          }),
        ]);
      const sellHim = () => say(c, `Alright. Thirty cents. I'll go and find something worth it.`, [
        reply(`Do that. Two sixty-nine at the counter.`,
          () => goShopping(c, ctx, `Two sixty-nine. Under the coupon.`, { discount: 0.3 })),
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
    /* ---------------- the man with the folder ----------------
       He is not in a hurry and he has brought paperwork. Every exchange is
       a recitation, most of them long enough that you will consider walking
       away, and there is a cooling-off period between them during which he
       goes back to reading. Getting rid of him is a project. */
    case 'SOVEREIGN':
      return grind(c, ctx, {
        resist: 16,
        cool: 18,
        beats: [
          `Before we proceed. Am I being detained?\n\n(he opens a ring binder)\n\nI ask because under the Uniform Commercial Transactions Act of eighteen ninety-four, section four, subsection C, paragraph nine — and I have it here, I can read it to you, I will read it to you — "no man engaged in travel upon the common way shall be held to account by any agent of a corporate body except upon presentation of a wet-ink instrument bearing the seal of the county in which the alleged obligation is said to have arisen." No seal. No instrument. So. Am I being detained.`,
          `I'm not a customer. I'm a man. There's a difference and it is a legal one, and it is set out in Bouvier's, which you have not read, at the entry for PERSON, natural, as distinguished from PERSON, corporate.\n\nWhen you say "customer" you are addressing a legal fiction. The fiction is spelled in capital letters. I am spelled in lower case. I have a document here, notarized, which severs my correspondence with the fiction, and I filed it with the county in March, and they wrote back, and the letter is in this binder behind the tab that says COUNTY.`,
          `I never signed anything. Did I sign anything? You cannot produce it, because it does not exist, because I did not sign it.\n\nThe Statute of Frauds — and this is not fringe, this is first-year contract law, you can look it up in any library including the one two streets over which I have also had words with — requires a memorandum in writing signed by the party to be charged. I am the party to be charged. There is no memorandum. There is no writing. There is no signature. There is a man in a polo shirt and a cardboard box with a movie in it.`,
          `The card in your machine has my name on it in capital letters. That is not me. That is a corporate fiction created without my consent at the registration of my birth, and every transaction conducted against it is conducted against the fiction and not against the man.\n\nI have written to the Registrar. Three times. The third letter was certified. The green card came back with a squiggle on it that could be anybody. That squiggle is now the only evidence the state has that I exist, and I would like you to sit with that for a moment.`,
          `I don't have a membership because I am not engaged in commerce. I am traveling.\n\nTravel is a right. Driving is a privilege. Renting is neither — renting is a bailment, and a bailment requires a bailor and a bailee and a meeting of minds, and my mind has not met yours and I would suggest it is not going to.\n\nI could produce the affidavit. I do have the affidavit. It runs to eleven pages and I have read it aloud at two town meetings.`,
          `Under common law — and I would ask you to look this up rather than take my word for it, although you may take my word for it — a late fee is a penalty. Penalties require a court. You are not a court. You have a carpet and a popcorn machine.\n\nSee Farnsworth on the doctrine of liquidated damages, which holds that a stipulated sum bearing no reasonable relationship to actual loss is unenforceable as against public policy. Your actual loss on a videotape that sat in my house for six days is nothing. It is less than nothing. It was not going to be rented. Nobody wants it.`,
          `I want to talk about the sign on your door.\n\n"We reserve the right to refuse service." That is an assertion of a right. Rights are not reserved by adhesive lettering. Rights are secured by instrument, and I do not see an instrument, I see a sticker, and a sticker is not a lawful notice under the Posting and Notice provisions of the Municipal Code, section eleven, which requires that any notice affecting the rights of the public be displayed in letters not less than two inches in height and countersigned by the clerk of the county.\n\nThose letters are one inch. I measured them. I have a tape measure in the car.`,
          `You keep saying "policy". Policy is not law. A corporation may set policy for its employees; it may not set policy for a man.\n\nI would refer you to the Restatement, which nobody in this town has ever opened, on the distinction between a contract of adhesion and an agreement freely entered. Your policy is adhesion. I am not adhered. I am standing here of my own volition, which is more than can be said for you, since you are here for money, which is compulsion.`,
          `Now. Since you have not answered my first question, I am going to take that as a no, and I would like it noted — and I will note it myself, in the binder, and I will date it — that at approximately eleven fourteen on this evening I asked whether I was being detained and received no lawful answer.\n\n(he writes for some time)\n\nHow do you spell your name? Not your first name. The one on the badge.`,
          `Let me read you something. This is from the county's own bylaws, section nine, article four, and I obtained it under a records request that took eleven weeks and cost me forty-one dollars in copying:\n\n"No commercial premises within the district shall condition entry upon the surrender of any right otherwise held at law."\n\nYou are conditioning my entry upon my agreement to be a customer. A customer surrenders rights. Therefore your condition is void, and my presence here is lawful, and has been lawful this entire time, including during the portion where you sighed.`,
          `I have been to four other establishments on this block tonight and I have had this same conversation in three of them. The laundromat understood immediately. The laundromat has a woman working who has read the code.\n\nI mention this not to shame you but because I want you to understand that I am not confused and I am not unwell and I am not, as the man at the hardware store suggested, "one of those." I am simply correct, and being correct in a town like this one is a full-time occupation.`,
          `Very well. I am going to leave. I want to be clear that I am leaving of my own volition and not under compulsion, and that my leaving does not constitute acquiescence, acceptance, admission, or waiver of any right, claim, or remedy, all of which are expressly reserved.\n\nWithout prejudice. UCC one dash three zero eight. You may write that down. I will wait.`,
        ],
        firm: [
          `Sir. It's a video store.`,
          `None of that is a thing here.`,
          `I need you to leave.`,
          `I'm going to stop you there.`,
          `That's not what any of that means.`,
        ],
        firmer: [
          `Out. Before I pick up the phone.`,
          `You are leaving now, one way or the other.`,
          `I am not listening to another word of this.`,
        ],
        reason: [
          `Mm-hm. And the tape is three dollars.`,
          `Right. Three dollars.`,
          `I need you to step aside. There are people waiting.`,
          `Nothing you have said has been about a movie.`,
          `Sir, I have a line.`,
        ],
        give: [
          `...I'll allow that you have answered part of it.`,
          `Noted. Under protest, but noted.`,
          `(he turns a page and does not look up)\n\nContinue.`,
          `That is the first reasonable thing anybody in this building has said.`,
          `I am prepared to move on. Not to concede. To move on.`,
        ],
        dig: [
          `Now that. That is a threat, and a threat is an assault in some jurisdictions, and I am going to write down the time.`,
          `You have just made this take considerably longer. I hope you understand that.`,
          `(he closes the binder, then opens it again at a different tab)\n\nRight. Let's start at the beginning.`,
        ],
        deflect: [
          `They can wait. This is more important than a Tuesday.`,
          `The line is a symptom. I am addressing the cause.`,
          `Three dollars is the number. It is not the issue. You keep giving me the number.`,
          `I am not here about a movie. I have never been here about a movie.`,
        ],
        brush: [
          `(he is reading, and holds up one finger without looking at you)`,
          `One moment. I am at a part.`,
          `(he has found a new tab and appears to be underlining)`,
          `Mm. I will be with you.`,
        ],
        gone: [
          `Noted. Recorded. Reserved. You'll be hearing from a court that you do not recognize either.`,
          `Without prejudice, all rights reserved, and I'll be back on Thursday with the laminated one.`,
        ],
        andSell: () => say(c, `...Fine. Three dollars. Under protest, and I want that noted.`, [
          reply(`It's noted. Go and choose one.`, () => {
            ctx.mood(c, +18);
            return goShopping(c, ctx, `Under protest.`, { close: `Under protest. The counter's there.` });
          }),
          reply(`We're closed to you. Goodnight.`, () => { ctx.storm(c); return null; }, { risk: true }),
        ]),
      });

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
          reply(`Have a look. I'll be at the register.`,
            () => goShopping(c, ctx, `I know where everything is, dear. Better than you do.`,
              { genre: 'DRAMA', close: `I don't doubt it.` })),
          reply(`We're closing shortly.`, () => { ctx.mood(c, -4); return done(); }),
        ]);
      }
    }

    /* ---------------- the wrong store's tape ---------------- */
    case 'RETURNS': {
      const done = () => farewell(c, ctx);
      return say(c, `Returning. Now — before you look at it — hear me out.`, [
        reply(`It's got another store's sticker on it.`, () => say(c,
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
          reply(`Help yourself. Bring it over when you've got it.`,
            () => goShopping(c, ctx, `Good man.`)),
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
          reply(`People like it. That's what a video store is for.`, () => { ctx.mood(c, -10); return rant(n + 1); }),
          reply(`Do you want it or not?`, () => { ctx.mood(c, -16); return buy(); }, { risk: true }),
          reply(`Tell me more, genuinely.`, () => { ctx.mood(c, +22); return rant(n + 1); }),
        ]);
      };
      const buy = () => say(c, `I'll take it anyway. Obviously I'll take it.`, [
        reply(`Then go and get it off the shelf.`,
          () => goShopping(c, ctx, `I know exactly where it is. That is rather my whole problem.`,
            { close: `Bring it to the counter.` })),
        reply(`We're closing. Come back when you like it less.`, () => {
          ctx.mood(c, -12);
          return say(c, `That is the single best thing anyone in this store has ever said to me.`,
            [reply(`Goodnight.`, () => { ctx.leave(c); return null; })]);
        }, { risk: true }),
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
        reply(`It's a family movie. It's on the FAMILY run.`, () => { ctx.mood(c, -4); return push(); }),
        reply(`Give me a second — I'll read the back for you.`, () => { ctx.mood(c, +26); return buy(); }),
      ]);
      function push() {
        return say(c, `That is not an answer. I asked a simple question.`, [
          reply(`Then pick a different one. I'll help you.`, () => { ctx.mood(c, +20); return buy(); }),
          reply(`Ma'am, I run a register. I don't screen the movies.`, () => {
            ctx.mood(c, -18);
            return say(c, `Then what exactly is the point of you.`, [
              reply(`Some nights I ask myself that.`, () => { ctx.mood(c, +26); return buy(); }),
              reply(`We'll try the library, then. Yes?`, () => { ctx.storm(c); return null; }, { risk: true }),
            ]);
          }, { risk: true }),
        ]);
      }
      function buy() {
        return say(c, `Fine. Family section. And I'm holding you to the dog.`, [
          reply(`Family's the far wall. I'll be at the register.`,
            () => goShopping(c, ctx, `If there's a single frightening moment in it, I'm coming back.`,
              { genre: 'FAMILY', close: `Understood.` })),
          reply(`Honestly? Try the library. They vet things.`, () => {
            ctx.mood(c, -6);
            return say(c, `...That is either very rude or very honest.`,
              [reply(`Bit of both.`, () => { ctx.leave(c); return null; })]);
          }, { risk: true }),
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
        reply(`Go on then. Pick one.`,
          () => goShopping(c, ctx, `Keep the card. Seriously. Keep it.`)),
        reply(`Just take the card and go.`, () => { ctx.mood(c, -8); ctx.leave(c); return null; }),
      ]);
      return pitch(0);
    }

    /* ---------------- the telephone ---------------- */
    case 'PHONECALL':
      return eject(c, ctx, [
        `(covers the receiver) — sorry, WHAT? (uncovers) No, not you, Denise.`,
        `I'm ALLOWED to be on the phone. It's a phone. In a store.`,
        `Denise, I'll call you back. No — no, because this MAN — yes. Yes. Bye. Bye. BYE.`,
      ], {
        takes: 3,
        andSell: () => say(c, `Right. Sorry. What have you got that's funny?`, [
          reply(`Comedy's the middle run. Bring me one.`, () => {
            ctx.mood(c, +16);
            return goShopping(c, ctx, `You're a love.`,
              { genre: 'COMEDY', close: `I'll be at the register.` });
          }),
          reply(`Another night.`, () => { ctx.leave(c); return null; }),
        ]),
      });

    default:
      return idleRoot(c, ctx);
  }
}

/* ============================================================
   THE ASSIGNMENT

   Codename SHEPHERD'S CROOK. He was briefed while asleep, by people who
   do not use telephones, and the briefing said: the basement of the video
   store on Delaney. There is no basement. There has never been a
   basement. He is aware that you will say that -- it is in the briefing.

   Every denial makes him worse, because a denial is what an obstruction
   sounds like. Refusing outright makes him worse faster. The exit is not
   a denial at all: it is a better address. Suggest the mission meant the
   OTHER video store, the one across town, and he thanks you and goes,
   because a man with an assignment would rather have the wrong basement
   than no basement at all.
   ============================================================ */
const CROOK_OPEN = [
  `Don't say anything yet. I want to see your face when I say this.\n\nSHEPHERD'S CROOK.`,
  `I'm going to say two words and I want you to watch your own reaction. Ready.\n\nSHEPHERD'S CROOK.`,
  `You won't have been told. That's normal. That's how it's supposed to work.\n\nSHEPHERD'S CROOK. Say it back to me.`,
];

const CROOK_BRIEF = [
  `Tuesday night. Three-forty in the morning. I was asleep and then I was being spoken to, and I was still asleep, which is how you know it wasn't a dream.\n\nThey don't use phones. Phones can be listened to. They use the part of you that's already switched off.`,
  `They came in through the sleep. That's the channel. Always has been — they've been doing it since sixty-one and they got very good at it by sixty-three.\n\nI woke up with the whole thing already in me. Like a song you didn't learn.`,
  `I don't hear voices. I want to be extremely clear about that, because people get it wrong and then they stop listening.\n\nI was ISSUED something. In my sleep. There's a difference and it's an important one.`,
];

const CROOK_TASK = [
  `The assignment is a retrieval. There's a canister. Sixteen millimetre, unspliced, and it has been in a basement on this street since November of sixty-three.\n\nYour basement.`,
  `Dallas. The whole of it, from an angle nobody has ever published, because the man holding the camera put it in a can and the can went into a basement on Delaney.\n\nThis is Delaney. This is the basement.`,
  `There is a reel. It shows the fence. Not the book building — the fence.\n\nAnd it has been sitting under this floor for thirty-three years waiting for somebody with clearance to come and get it, and that somebody is me.`,
];

const CROOK_DIG = [
  `See, that's the exact phrasing. "There is no basement." Word for word. They told me you'd say that.`,
  `You're doing very well. You've been trained well. I'm not angry at you, I want you to understand that.`,
  `Every building on this block has a basement. I've been in the laundromat's. I've been in the barber's. Yours is the one that's a secret.`,
  `A man who genuinely didn't have a basement would look confused. You look CAREFUL. That's a different face.`,
  `I'm not asking you to come down with me. I'm asking you to stand aside from a door you say isn't there.`,
  `Fine. FINE. Then show me the floor. Show me the whole floor. Move the shelving.`,
];

const CROOK_HOT = [
  `DON'T. Don't say it again.`,
  `You are OBSTRUCTING a retrieval. Do you know what that makes you? It makes you PART of it.`,
  `Thirty-three years! Thirty-three years and it's a boy behind a register!`,
  `I have a NAME for what you are and I am being polite by not using it.`,
];

function basementRoot(c, ctx) {
  const rng = ctx.rng;
  if (c.crookStage === undefined) { c.crookStage = 0; c.crookHeat = 0; }
  /* Per conversation, not per night. He is inexhaustible across the shift
     and finite within one exchange: go round the houses enough times and
     he stops talking to you and goes back to studying the floor. Which
     ends the conversation without ending him -- he is still in the store,
     and still has no basement to be let into. */
  c.crookRound = 0;

  const stonewall = () => say(c, rng.pick([
    `No. No, we're going in circles and circles are how they waste you.\n\nI'll wait. I've waited thirty-three years, I can wait out a shift.`,
    `I'm not going to keep asking a man who's been told what to say.\n\n(he turns away and looks at the floor again)`,
    `You know what? Don't. Don't say it again.\n\nI'll be over here. Looking at your floor.`,
  ]), [reply(`...`, () => null)]);

  /* Every denial winds him up. He never leaves this way -- the meter is
     only there so the room can see the refusals landing badly. */
  const deny = (line) => {
    c.crookHeat++;
    c.crookRound++;
    ctx.mood(c, -8);
    if (c.crookRound > 5) return stonewall();
    const pool = c.crookHeat >= 4 ? CROOK_HOT : CROOK_DIG;
    return say(c, `${line}\n\n${rng.pick(pool)}`, [
      reply(`There is no basement. There has never been a basement.`,
        () => deny(`(he closes his eyes for a moment)`), { risk: true }),
      reply(`I'm not showing you anything. Get out.`,
        () => deny(`(he does not move)`), { risk: true }),
      reply(`...Wait. Which video store did they say?`, () => redirect()),
      reply(`What's on the reel?`, () => say(c, rng.pick(CROOK_TASK),
        [reply(`...Right.`, () => deny(`(he waits)`))])),
    ]);
  };

  /* The way out. Not a denial: a better address. He would rather have the
     wrong basement than no basement, so give him one. */
  const redirect = () => say(c, rng.pick([
    `...Say that again.`,
    `What do you mean, which one.`,
    `(for the first time, he stops talking)`,
  ]), [
    reply(`There are two video stores in this town. This is the one on Delaney.`,
      () => confirm()),
    reply(`Sunset's got a second store the other side of town. That one has a basement.`,
      () => confirm()),
    reply(`I think your assignment might be the other store. The one across town.`,
      () => confirm()),
    reply(`Never mind. Just go.`, () => deny(`(the moment passes)`), { risk: true }),
  ]);

  const confirm = () => say(c, rng.pick([
    `The other one.\n\nThe OTHER one. On the west side. By the overpass.\n\n...That's a basement. That building has a basement, I've seen the vent.`,
    `West side. Behind the overpass.\n\nOh. Oh, that's — that would explain the whole of it. The whole of it.\n\nThey said Sunset. They never said Delaney. I put Delaney on it. That was me.`,
    `(he is very still)\n\nI assumed. I ASSUMED. Thirty-three years and I assumed.\n\nThere's a Sunset on the west side. With a basement. With a vent on the alley side.`,
  ]), [
    reply(`Sounds like where you're meant to be.`, () => out(`Yes. Yes. I've lost forty minutes.`)),
    reply(`I'd hurry. It's nearly midnight.`, () => out(`They'll have allowed for that. They allow for everything.`)),
    reply(`Good luck with the canister.`, () => out(`Don't say canister out loud in here.`)),
  ]);

  const out = (last) => say(c, `${last}\n\n(he is already moving)`, [
    reply(`...`, () => { ctx.mood(c, +20); ctx.leave(c); return null; }),
  ]);

  if (c.crookStage === 0) {
    c.crookStage = 1;
    return say(c, rng.pick(CROOK_OPEN), [
      reply(`...I don't know what that is.`, () => say(c, rng.pick(CROOK_BRIEF),
        [reply(`Sir.`, () => deny(`So. Your basement.`))])),
      reply(`Shepherd's what?`, () => say(c, rng.pick(CROOK_BRIEF),
        [reply(`Okay.`, () => deny(`So. Your basement.`))])),
      reply(`Can I help you find a movie?`, () => say(c,
        `A movie. He says a movie.\n\nI'm not here for a movie. I'm here for what's under it.`,
        [reply(`Under what?`, () => deny(`Under the FLOOR.`))])),
    ]);
  }
  return deny(rng.pick([`Are we doing this again?`, `Basement.`, `I haven't moved.`]));
}

/* ============================================================
   OFFENDED ABOUT THE OFFENSE

   Somebody, somewhere, was offended by something. She was not. She is
   offended that they were, and she has come here to say so -- and then
   the conversation slides sideways, twice, and ends up somewhere with no
   connection to where it started.

   She is not an ejection. She talks herself out, arrives at a completely
   different subject, notices she has been standing there for ten minutes
   and goes and rents something. What she wants is for you to keep saying
   things back.
   ============================================================ */
/* What set her off, tonight. Never the same one twice in a night. */
const OFFENSES = [
  { it: `a picture on a cereal box`, who: `a woman in Ohio` },
  { it: `the word "moist" in a magazine`, who: `an entire church group` },
  { it: `a mascot at a county fair`, who: `somebody's mother-in-law` },
  { it: `a joke on the radio, at six in the morning`, who: `a man who called in about it` },
  { it: `the color they repainted the bank`, who: `the historical society` },
  { it: `a greetings card with a frog on it`, who: `a woman at my church` },
  { it: `a nativity where Joseph had a beard`, who: `three separate families` },
  { it: `the new road signs`, who: `a retired schoolteacher` },
  { it: `a sitcom where the dog talks`, who: `a letter-writing campaign` },
];

/* Where it goes instead, once the offense has been dealt with. */
const TANGENTS = [
  {
    into: `And do you know what that reminds me of? Gravy.`,
    body: [
      `My sister makes gravy with the water off the potatoes. The WATER. And she'll tell you it's how our mother did it, and our mother did no such thing, I was THERE.`,
      `I have said nothing about it for eleven years. Eleven years of that gravy. And every year she says "you're quiet" and I say "I'm enjoying it."`,
      `That's not lying. That's manners. There's a difference and nobody teaches it any more.`,
    ],
    land: `Anyway. Gravy.`,
  },
  {
    into: `Which brings me — and I don't know why — to my neighbor's driveway.`,
    body: [
      `He's put gravel down. Gravel. On a slope. And now every time it rains I have his driveway in my flowerbed.`,
      `I said, Ray, that's not a driveway, that's a delivery. And he laughed. He LAUGHED. Which I took well, I think.`,
      `I've been picking his driveway out of my begonias since March and we are still on speaking terms, which if you knew me you'd call a miracle.`,
    ],
    land: `Anyway. Gravel.`,
  },
  {
    into: `Now. This is going to sound like a change of subject and it isn't.`,
    body: [
      `They've moved the bread. In the store. The bread has been in the same place my whole adult life and now it's where the cards were.`,
      `And I asked a boy about it and he said it was to do with the FLOW. The flow! Of a grocery store!`,
      `I stood in front of the cards for a full minute the first time. Just stood there. Like something that had been switched off.`,
    ],
    land: `Anyway. Bread.`,
  },
  {
    into: `Can I tell you what I actually came out for tonight? Because it wasn't a movie.`,
    body: [
      `The house is very quiet since Dennis. And a quiet house is fine in the day. In the day it's peaceful.`,
      `It's about nine o'clock it stops being peaceful. Nine o'clock it turns into something else entirely.`,
      `So I get in the car. And I drive somewhere with a light on. That's the whole plan. Somewhere with a light on.`,
    ],
    land: `Anyway. That's more than you asked for.`,
  },
];

function offendedRoot(c, ctx) {
  const rng = ctx.rng;
  if (!c.offense) {
    c.offense = rng.pick(OFFENSES);
    c.tangent = rng.pick(TANGENTS);
    c.offStage = 0;
  }
  const O = c.offense, T = c.tangent;

  /* The tangent, one paragraph at a time. She only needs you to keep
     saying things back; what you say barely matters, which is the joke. */
  const wander = (i) => {
    if (i >= T.body.length) return land();
    return say(c, T.body[i], [
      reply(rng.pick([`Right.`, `Mm.`, `I see.`]), () => wander(i + 1)),
      reply(rng.pick([`That does sound frustrating.`, `That's a long time to say nothing.`,
        `I can imagine.`]), () => { ctx.mood(c, +6); return wander(i + 1); }),
      reply(rng.pick([`Ma'am, is there a movie you wanted?`, `Was there something you needed?`]),
        () => say(c, rng.pick([
          `In a minute. I'm nearly at the end of it.`,
          `Yes — yes, I'll get to that. Let me just finish.`,
          `There is. There is. Hold on.`,
        ]), [reply(`...Go on.`, () => wander(i + 1))])),
    ]);
  };

  const land = () => say(c, `${T.land}\n\n...I've been standing here talking at you for ten minutes, haven't I. And you've let me.`, [
    reply(`It's a slow night.`, () => sell(`That's a kind way of putting it.`)),
    reply(`You have, a bit.`, () => sell(`Well. You could have stopped me.`)),
    reply(`I didn't mind.`, () => { ctx.mood(c, +14); return sell(`No. I don't think you did.`); }),
  ]);

  const sell = (said) => say(c, `${said}\n\nRight. Something with a bit of backbone to it. I'll find it myself, you've done enough listening.`, [
    reply(`Take your time.`, () => {
      ctx.mood(c, +10);
      return goShopping(c, ctx, `I always do.`, { close: `I'll be at the counter.` });
    }),
    reply(`Anything in particular?`, () => say(c,
      `Something where somebody says what they mean. You'd be amazed how rare that is.`,
      [reply(`Have a look around.`, () => {
        ctx.mood(c, +10);
        return goShopping(c, ctx, `I shall.`, { close: `I'll be at the counter.` });
      })])),
  ]);

  const pivot = () => say(c, T.into, [
    reply(`...Go on.`, () => wander(0)),
    reply(`Is this still about the ${O.it}?`, () => say(c,
      `No. No, we've dealt with that. Keep up.`, [reply(`Sorry.`, () => wander(0))])),
  ]);

  const core = () => say(c, rng.pick([
    `And I want to be very clear, because people get this wrong. I am not offended by ${O.it}.\n\nI am offended THAT ${O.who} was offended by it. Those are two completely different things and I'll thank you not to run them together.`,
    `Now, you'll think I'm about to complain about ${O.it}. I'm not. I don't care about ${O.it}.\n\nWhat I care about is that ${O.who} decided to be UPSET about it. In public. On purpose.`,
    `${cap(O.who)} was offended by ${O.it}. And I have been carrying that around all week like a stone in my shoe.\n\nNot the ${O.it}. The being offended by it. That's the part.`,
  ]), [
    reply(`So you're offended that they were offended.`, () => say(c,
      rng.pick([`Yes. Finally. Thank you.`, `YES. Somebody with ears.`,
        `That is exactly it and you're the first person all week to get there.`]),
      [reply(`Right.`, () => { ctx.mood(c, +10); return pivot(); })])),
    reply(`That sounds exhausting.`, () => say(c,
      `It IS. It's exhausting. And nobody sympathizes, because to sympathize you'd have to follow it.`,
      [reply(`I follow it.`, () => { ctx.mood(c, +8); return pivot(); })])),
    reply(`I don't think I follow.`, () => say(c,
      `Then I'll say it slower, because it's worth getting.`,
      [reply(`Please do.`, () => pivot())])),
  ]);

  if (c.offStage === 0) {
    c.offStage = 1;
    return say(c, rng.pick([
      `Can I say something? I'm going to say something, and then I'll buy a movie, I promise.`,
      `Before anything else. Have you heard about ${O.it}?`,
      `You look like a man who'll let somebody finish a sentence. I've got one.`,
    ]), [
      reply(`Go ahead.`, () => core()),
      reply(`...Sure.`, () => core()),
      reply(`I'm listening.`, () => { ctx.mood(c, +6); return core(); }),
    ]);
  }
  /* Come back to her mid-story and she picks up where she left off. */
  return pivot();
}

/* ============================================================
   THE ONE WHO WANTS A MANAGER

   She is not angry with the clerk and says so, repeatedly, which somehow
   makes it worse. She is angry about the lot: no light on the back of the
   building, an alley nobody can see into, and a woman followed to her car
   on this block in March. None of that is yours to fix and she knows it.
   That is why she wants somebody it IS.

   So the conversation is a wall on purpose. Everything you say gets the
   same answer in different words. The only thing that moves her is the
   receiver, with a man on the other end of it who can write to a
   landlord.
   ============================================================ */
const KAREN_WALL = [
  `I'd like to speak to your manager, please.`,
  `Then I'd like the number of somebody who does have a manager.`,
  `You're being very reasonable and I'm not going to be moved by it.`,
  `I'm not leaving until I've spoken to somebody above you.`,
  `This is not about you. I have said that four times now.`,
  `Somebody signs the lease on this building. I want that person.`,
  `A district manager. A regional. Whatever you call them. Get me one.`,
  `I'll stand here all night. I've got nowhere I'd rather be, apparently.`,
  `Is there a card? There's always a card. Behind the register, usually.`,
  `You have a phone right there. I can see it from here.`,
];

const KAREN_WHY = [
  `Because there is no light on the back of this building. None. The whole lot is a black hole after nine o'clock.`,
  `Because a woman was followed to her car on this block in March and nothing has changed since. Not one thing.`,
  `Because I park in that lot. My daughter parks in that lot. And you can't see the alley from anywhere.`,
  `Because I've told the laundromat and I've told the barber and they both said the same thing you're saying.`,
];

function managerRoot(c, ctx) {
  const rng = ctx.rng;
  if (c.karenAsked === undefined) { c.karenAsked = 0; c.karenTold = false; }
  c.karenAsked++;
  /* Per conversation. The wall does not come down -- she leaves holding a
     receiver or she does not leave -- but a wall you can walk away from is
     still a wall, and a conversation that cannot be ended is a bug rather
     than a character. Say the same thing enough times and she stops
     saying it and just stands there. */
  c.karenRound = 0;

  const standing = () => say(c, rng.pick([
    `We're going round. I'll stop, then.\n\n(she folds her arms and looks at the phone on your back counter)`,
    `Right. I'll wait, and you'll do whatever you were going to do.\n\n(she does not leave)`,
    `(she stops answering you, and looks past you at the phone)`,
  ]), [reply(`...`, () => null)]);

  /* Once she has told you what it is actually about she stops explaining
     and goes back to the wall, because explaining was never the point. */
  const wall = (lead) => {
    c.karenRound++;
    if (c.karenRound > 6) return standing();
    return say(c, `${lead ? lead + '\n\n' : ''}${rng.pick(KAREN_WALL)}`, [
    reply(`I'm the only person here. There is no manager on site.`,
      () => wall(rng.pick([`(she nods, and does not move)`, `I understand that. And?`,
        `Then you'll appreciate my difficulty.`]))),
    reply(`Ma'am, there's nothing I can do about the parking lot.`,
      () => wall(rng.pick([`No. There isn't.`, `Correct. Which is why I'm not asking you.`,
        `I know. I'm not asking YOU.`]))),
    reply(`What is this actually about?`, () => why()),
    reply(`I'm going to have to ask you to leave.`, () => {
      ctx.mood(c, -10);
      return wall(rng.pick([
        `No, I don't think so. I'm a customer standing in a store.`,
        `You can ask. I'm not going.`,
        `On what grounds? I've raised my voice at nobody.`,
      ]));
    }, { risk: true }),
      reply(`...`, () => null),
    ]);
  };

  const why = () => {
    c.karenTold = true;
    return say(c, rng.pick(KAREN_WHY), [
      reply(`That's fair. I still can't fix it.`, () => {
        ctx.mood(c, +8);
        return wall(`No. But somebody can.`);
      }),
      reply(`I'll mention it.`, () => say(c,
        `To who? You'll mention it to who?\n\nThat's what I'm asking for. The person you'd mention it to.`,
        [reply(`...`, () => wall(null))])),
      reply(`Nobody's told me any of this.`, () => say(c,
        `No. They wouldn't have. That's rather the shape of the whole thing.`,
        [reply(`Right.`, () => wall(null))])),
    ]);
  };

  if (c.karenAsked === 1) {
    return say(c, rng.pick([
      `Good evening. I'd like to speak to your manager, please.`,
      `Are you the manager? ...No. No, you're not, are you. Who is?`,
      `Before you say anything: this is not a complaint about you.\n\nI'd like your manager.`,
    ]), [
      reply(`That'd be me. There's nobody else on tonight.`, () => wall(
        `Then somebody above you. There's always somebody above you.`)),
      reply(`What's the problem?`, () => why()),
      reply(`It's nearly midnight, ma'am.`, () => wall(
        `It is. And I'm still here, which should tell you something.`)),
    ]);
  }
  return wall(rng.pick([
    `(she has not moved)`,
    `Have you got that number yet?`,
    `I'm still here.`,
  ]));
}

/* ============================================================
   THE PIZZA

   He calls first, from a payphone outside the laundromat, and orders.
   He is not confused about which number he dialled: he is certain, and
   the certainty is what you cannot get past. Then he turns up to
   collect, and he will stand there.

   There is exactly one way this ends, and it is a real pizza on your
   real counter with his toppings on it. Which means the phone twice --
   once to order, and once more after Bertucci's tells you they have not
   got half of what he asked for and you have to go back and make him
   choose again.
   ============================================================ */
/* What he asks for. The second of each pair is the one no pizza place in
   1996 has ever had, which is the whole point of the second call. */
const TOPPINGS = [
  { ok: 'pepperoni', odd: 'canned corn' },
  { ok: 'sausage', odd: 'sauerkraut' },
  { ok: 'mushroom', odd: 'tuna, drained' },
  { ok: 'green pepper', odd: 'pineapple AND anchovy, together' },
  { ok: 'extra cheese', odd: 'sliced hard-boiled egg' },
  { ok: 'onion', odd: 'peanut butter, just a scrape' },
  { ok: 'black olive', odd: 'macaroni' },
  { ok: 'bacon', odd: 'raisins' },
];

const PIZZA_INSIST = [
  `No, I've got the number right here. Written down. In pen.`,
  `Delaney. Four-four-one-two Delaney. That's you.`,
  `Look, I'm not being funny, but I've ordered from you before.`,
  `Sunset. That's what it says on the front of the building, right?`,
  `I don't need to know what else you do. I need a pizza.`,
  `Then who am I talking to? Because this is the number.`,
  `You're doing the thing where you pretend you're not open.`,
  `A large. That's all. I'm not asking for the world here.`,
];

const PIZZA_FLOOR = [
  `I'm not leaving without it. I paid on the phone.`,
  `Buddy. BUDDY. Where is my pizza.`,
  `Then go and check the back. Go on. Go and check.`,
  `I can smell popcorn. You've got a popcorn machine. Don't tell me you don't do food.`,
  `Forty minutes. It's been forty minutes.`,
  `You know what, I'll wait. I've got all night and I'm getting hungrier.`,
  `Is there someone else I can talk to? Someone in the kitchen?`,
  `I'm looking at a wall of tapes and I do not care about a single one of them.`,
];

/** His half of the call that starts the whole thing off. */
export function buildPizzaOrder(ctx) {
  const rng = ctx.rng;
  const P = ctx.pizzaState();
  const caller = { name: 'A MAN ON A PAYPHONE', voicePitch: 0.95, rough: 0.55 };
  const hang = () => { ctx.hangUp(); return null; };

  if (!P || !P.wants) {
    const pick = rng.pick(TOPPINGS);
    if (P) P.wants = pick;
  }
  const W = (P && P.wants) || TOPPINGS[0];

  const done = (line) => say(caller, line, [
    reply(`...Hello? Hello.`, () => {
      if (P) { P.phase = 'ORDERED'; P.t = 0; }
      ctx.toast(`He hung up. He is coming here.`, 'bad');
      return hang();
    }),
  ]);

  const order = () => say(caller,
    `Right. Large. ${cap(W.ok)}, and ${W.odd}.\n\nAnd don't skimp on the ${W.odd}, last time it was like you'd waved it at the thing.`, [
    reply(`Sir, this is a video rental store.`, () => push(1)),
    reply(`We don't sell food. We sell movies.`, () => push(1)),
    reply(`...${cap(W.odd)}.`, () => say(caller,
      `${cap(W.odd)}. Yes. Is that a problem? It's not a problem.`,
      [reply(`I'll see what I can do.`, () => done(`Twenty minutes. I'm walking over.`))])),
  ]);

  const push = (n) => {
    if (n >= 3) return done(rng.pick([
      `Twenty minutes. I'm walking over. Have it ready.`,
      `I'll come to you. Clearly this is easier in person.`,
      `Right, I'm coming down there. Don't start the pizza until I'm there, I want to watch.`,
    ]));
    return say(caller, rng.pick(PIZZA_INSIST), [
      reply(`There is no kitchen here. There's a popcorn machine.`, () => push(n + 1)),
      reply(`You've got the wrong number.`, () => push(n + 1)),
      reply(`...What did you want on it?`, () => order()),
    ]);
  };

  return say(caller, rng.pick([
    `Yeah, hi — I'd like to order a large for collection.`,
    `Hi. Do you do collection? I'll collect.`,
    `Evening. One large, please. For pick-up.`,
  ]), [
    reply(`Sunset Video, how can I help?`, () => push(0)),
    reply(`I think you've misdialled.`, () => push(1)),
    reply(`...Go ahead.`, () => order()),
  ]);
}

/**
 * Calling Bertucci's, which is what actually solves this.
 *
 * The first call gets you told they have not got the strange half of it.
 * Then you have to go and tell HIM, get him to pick something they do
 * have, and call back. Two calls, with a conversation in the middle.
 */
export function buildPizzaParlor(ctx) {
  const rng = ctx.rng;
  const P = ctx.pizzaState();
  const parlor = { name: `BERTUCCI'S`, voicePitch: 1.0, rough: 0.45 };
  const hang = () => { ctx.hangUp(); return null; };
  const W = (P && P.wants) || TOPPINGS[0];

  /* Second call: he has settled on something they actually stock. */
  if (P && P.agreed) {
    return say(parlor, `"Bertucci's."`, [
      reply(`Me again. Large, ${W.ok} and ${P.agreed}.`, () => {
        ctx.pizzaCook(rng.range(55, 95));
        return say(parlor,
          `"${cap(W.ok)} and ${P.agreed}. Now that we can do."\n\n(the sound of a man writing on a pad)\n\n"Twenty minutes. Delaney, yeah? The video place?"`, [
          reply(`The video place. Yes.`, () => {
            ctx.toast(`Ordered. Twenty minutes, they said.`, 'good');
            return hang();
          }),
        ]);
      }),
    ]);
  }

  /* First call: they have not got the odd half and they say so. */
  if (P && P.placed) {
    return say(parlor, `"It's coming. Twenty minutes means twenty minutes."`, [
      reply(`Sorry. Thanks.`, () => hang()),
    ]);
  }

  return say(parlor, rng.pick([
    `"Bertucci's, collection or delivery?"`,
    `"Bertucci's."\n\n(somebody shouting an order in the background)`,
    `"Yeah, Bertucci's, hold on — yeah, go ahead."`,
  ]), [
    reply(`Delivery. To Sunset Video, on Delaney. Large, ${W.ok} and ${W.odd}.`, () => {
      if (P) P.placed = true;
      return say(parlor, rng.pick([
        `"${cap(W.ok)}, fine. ${cap(W.odd)} — no. We haven't got that. We've never had that."`,
        `"Yeah. Yeah. ...${cap(W.odd)}? On a pizza? No, pal. Not a thing we own."`,
        `"Hold on."\n\n(muffled, away from the phone: "Have we got ${W.odd}?" ... "Have we WHAT?")\n\n"No. That's a no."`,
      ]), [
        reply(`What have you got?`, () => say(parlor,
          `"What everyone's got. ${PARLOR_STOCK.join(', ')}. It's a pizza place, not a drugstore."`, [
          reply(`Let me ask him and call you back.`, () => {
            if (P) P.refused = W.odd;
            ctx.toast(`They haven't got ${W.odd}. He'll have to pick something else.`, 'bad');
            return hang();
          }),
        ])),
        reply(`Right. I'll call back.`, () => {
          if (P) P.refused = W.odd;
          ctx.toast(`They haven't got ${W.odd}. He'll have to pick something else.`, 'bad');
          return hang();
        }),
      ]);
    }),
    reply(`Nothing. Sorry, wrong number.`, () => hang()),
  ]);
}

const PARLOR_STOCK = ['pepperoni', 'sausage', 'mushroom', 'onion', 'green pepper',
  'black olive', 'bacon', 'extra cheese'];

function pizzaRoot(c, ctx) {
  const rng = ctx.rng;
  const P = ctx.pizzaState();
  const W = (P && P.wants) || TOPPINGS[0];
  if (c.pizzaAsked === undefined) c.pizzaAsked = 0;
  c.pizzaAsked++;
  c.pizzaRound = 0;

  const standing = () => say(c, rng.pick([
    `(he stops arguing and stands there, arms folded, facing the back room)`,
    `Fine. I'll wait. Waiting's free.\n\n(he does not leave)`,
    `(he has stopped listening and is watching the door)`,
  ]), [reply(`...`, () => null)]);

  /* The wall. He is immovable until there is a box on the counter. */
  const floor = (lead) => {
    c.pizzaRound++;
    if (c.pizzaRound > 6) return standing();
    return say(c, `${lead ? lead + '\n\n' : ''}${rng.pick(PIZZA_FLOOR)}`, [
      reply(`This is a video store. There is no pizza.`, () => {
        ctx.mood(c, -6);
        return floor(rng.pick([`Then what's the popcorn for?`, `You keep saying that.`,
          `(he looks at the popcorn machine, then back at you)`]));
      }, { risk: true }),
      reply(`I need you to leave.`, () => {
        ctx.mood(c, -12);
        return floor(rng.pick([`Not without my food.`, `Give me the pizza and I'm gone.`,
          `I'll go the second there's a box in my hand.`]));
      }, { risk: true }),
      reply(`What exactly did you order?`, () => say(c,
        `Large. ${cap(W.ok)} and ${W.odd}. I said don't skimp on the ${W.odd}.`,
        [reply(`Right.`, () => floor(null))])),
      reply(`...`, () => null),
    ]);
  };

  /* They have not got the odd half. This is the bit only he can settle. */
  if (P && P.refused && !P.agreed) {
    const take = (t) => say(c, rng.pick([
      `...Fine. ${cap(t)}. But I want it noted that this is a compromise.`,
      `${cap(t)}, then. Under protest.`,
      `Go on then. ${cap(t)}. And extra of it, since I'm being flexible.`,
    ]), [
      reply(`I'll call them back.`, () => {
        ctx.pizzaAgree(t);
        return null;
      }),
    ]);
    const some = ctx.rng.shuffle(PARLOR_STOCK.filter((t) => t !== W.ok)).slice(0, 3);
    return say(c, rng.pick([
      `They haven't got it? How has a pizza place not got ${P.refused}?`,
      `No ${P.refused}. Right. Of course. Of COURSE there's no ${P.refused}.`,
      `What do you mean they haven't got it. It's ${P.refused}. It comes in a tin.`,
    ]), some.map((t) => reply(`They've got ${t}.`, () => take(t)))
      .concat([reply(`They've got what everyone's got.`, () => say(c,
        `Then surprise me. No — don't surprise me. What have they got.`,
        [reply(`${cap(some[0])}.`, () => take(some[0]))]))]));
  }

  if (P && (P.placed && P.agreed)) {
    return say(c, rng.pick([
      `Is it coming? Tell me it's coming.`,
      `Twenty minutes, they said? From when?`,
      `(he has calmed down considerably and is now just hungry)`,
    ]), [
      reply(`It's on its way.`, () => { ctx.mood(c, +10); return null; }),
      reply(`Any minute.`, () => { ctx.mood(c, +6); return null; }),
    ]);
  }

  if (c.pizzaAsked === 1) {
    return say(c, rng.pick([
      `Collection. Nusbaum. Large, ${W.ok} and ${W.odd}.`,
      `I called about twenty minutes ago. Nusbaum. Is it ready?`,
      `Hi. Order for Nusbaum? I called it in.`,
    ]), [
      reply(`Sir, this is a video rental store.`, () => floor(
        `I know what it is. I can see the tapes. Where's my pizza?`)),
      reply(`We don't do food.`, () => floor(`Then why did you take my order?`)),
      reply(`...I'll see what I can do.`, () => {
        ctx.mood(c, +12);
        return say(c, `Thank you. THANK you. That's all I wanted.`,
          [reply(`Give me a minute.`, () => null)]);
      }),
    ]);
  }
  return floor(null);
}

/* ============================================================
   THE SWEEP THAT FOUND NOTHING

   You named him, the cruiser came, and he was gone before it got here.
   That used to be two lines of text over an empty store, which made the
   right call feel like a wasted one. A deputy comes in and says it to
   your face instead: nobody out there, and he is not telling you that you
   were wrong -- he is telling you to keep the door in view.
   ============================================================ */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildSweepReport(officer, bulletin, ctx) {
  const rng = ctx.rng;
  const A = bulletin && bulletin.app;
  /* Whatever you actually had written down. Reading back a detail nobody
     has told you yet would be the bulletin leaking through him. */
  const known = bulletin ? [...bulletin.known] : [];
  const cite = known.length && A
    ? traitBulletin(A, rng.pick(known))
    : 'the description we put out';

  const done = () => { ctx.sweepDone(); return null; };

  const vigilant = () => say(officer, rng.pick([
    `Here's where I land on it. You did the right thing and it didn't pay off tonight. That happens more than anybody wants to hear.\n\nKeep the door in front of you. If he comes back through it, you call again, and you don't wait to be sure.`,
    `I'm not going to stand here and tell you it was nothing. You call it in, we come, that's the arrangement. Tonight the arrangement got beaten by about ninety seconds.\n\nStay where you can see the block. Anything at all, you pick that phone up.`,
    `Don't second-guess it. A man who walks out the second he hears a siren is a man who had a reason to.\n\nEyes on the door for the rest of your shift. I mean it.`,
  ]), [reply(`Understood.`, () => done())]);

  const matched = () => say(officer, rng.pick([
    `For what it's worth — and I'm saying this as much for my report as for you — whoever you were looking at matched what we put out. ${cap(cite)}. All of it, straight down the sheet.\n\nThat isn't a coincidence I'm comfortable with.`,
    `I'll tell you what I told dispatch. The description you gave back matched ours to the letter. ${cap(cite)}. Every line of it.\n\nPeople match one or two. They don't match all of it.`,
    `You want to know if you got it wrong. You didn't. What you described and what's on our sheet are the same man — ${cite}, the lot.\n\nWhich is exactly why I'd rather he was in the back of my car right now.`,
  ]), [
    reply(`So he was here.`, () => say(officer,
      `Somebody was here. Somebody who heard a siren and decided he had somewhere to be.\n\nI can't put that in front of a judge. I can put it in front of you.`,
      [reply(`...Right.`, () => vigilant())])),
    reply(`Then why isn't he in cuffs?`, () => say(officer,
      `Because I need him in front of me, not in front of you. A description isn't a man. A man is a man.\n\nHe'll turn up. They always turn up.`,
      [reply(`That's not comforting.`, () => vigilant())])),
    reply(`What now?`, () => vigilant()),
  ]);

  return say(officer, rng.pick([
    `Swept the block twice. Both ends of the lot, the alley behind the laundromat, all of it.\n\nNobody. Not a soul out there who shouldn't be.`,
    `We had two units on it inside of a minute. Nothing on the block, nothing in the lot, nothing behind the buildings.\n\nHe isn't out there any more.`,
    `I've been up and down that street and around the back twice over. It's empty out there.\n\nWhoever you saw is not on this block.`,
  ]), [
    reply(`He was standing right there.`, () => matched()),
    reply(`You're saying I imagined him.`, () => say(officer,
      `I'm saying no such thing. Sit down for a second and listen to what I'm actually telling you.`,
      [reply(`...Go on.`, () => matched())])),
    reply(`So that was for nothing.`, () => matched()),
  ]);
}
