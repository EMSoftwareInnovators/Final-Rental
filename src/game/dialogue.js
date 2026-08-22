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
export function buildOfficerIntro(officer, bulletin, ctx) {
  const rng = ctx.rng;
  let asked = 0;
  const extras = bulletin.extra.slice();

  const outro = () => say(officer,
    bulletin.certain
      ? `Keep that door where you can see it. If someone matching that comes in — you don't confront them, you don't be clever. You lock the door and you get on that phone.\n\nAnd clerk? Be sure. We had a fella call it in last week on his own mailman.`
      : `Might be nothing tonight. Might be. Either way — you see it, you lock up and you call. Be sure before you do.`,
    [reply('Understood.', () => { ctx.finishIntro(); return null; })]);

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

  return say(officer, `${greet}\n\nWe've got a description out on somebody working this side of the river. I'm hitting every business still lit up.`, [
    reply(`Go ahead.`, () => detail()),
    reply(`Is this about the ones on the news?`, () => say(officer,
      `The news has about a third of it. Here's what matters to you tonight.`,
      [reply('Okay.', () => detail())])),
  ]);
}

/* ============================================================
   CUSTOMERS
   ============================================================ */
export function talkTo(c, ctx) {
  if (c.mood <= 0 && !c.resolvedAnger) return angryRoot(c, ctx);
  if (c.script === 'return') return returnRoot(c, ctx);
  if (c.script === 'rent') return rentRoot(c, ctx);
  return idleRoot(c, ctx);
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
  const fee = lateFee(tape.daysLate);
  const disputes = !c.isKiller && rng() > c.personality.honesty;

  const paid = () => {
    c.feeSettled = true;
    ctx.pay(fee, 'late fee');
    ctx.mood(c, +2);
    return say(c, line(c, 'thanks', rng, `Thanks.`), [reply('...', () => then())]);
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
      reply(`Thank you. Out of the drawer.`, () => paid(), { good: money(fee) }),
      reply(`On second thought — forget it tonight.`, () => waived(), { cost: `-${money(fee)}` }),
    ]);
  };
  return opening;
}

function handOver(c, ctx) {
  const rng = ctx.rng;
  const tape = c.tape;
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
            ctx.pay(1, 'rewind charge'); ctx.mood(c, -6);
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
  const price = tape.price;
  const finish = () => farewell(c, ctx);

  const complete = () => {
    c.checkedOut = true;
    ctx.checkout(tape, c);
    return say(c, line(c, 'thanks', rng, `Thanks.`), [reply('Two nights. Be kind, rewind.', () => finish())]);
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
          ctx.pay(has, 'partial'); ctx.waive(price - has); ctx.mood(c, +24);
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
  if (c.state === 'BROWSE') {
    return say(c, rng.pick([
      `Still looking. I'll come to you.`,
      `Do you have anything with a dog in it? Not a sad dog.`,
      `Where'd you move the ${GENRE_LABEL[rng.pick(['HORROR', 'COMEDY', 'ACTION', 'SCIFI'])]} section?`,
      `...`,
    ]), [
      reply(`Take your time.`, () => { ctx.mood(c, +4); return null; }),
      reply(`We close at midnight.`, () => { ctx.mood(c, -6); return null; }),
    ]);
  }
  return say(c, line(c, 'wait', rng, `...`), [reply(`Right with you.`, () => null)]);
}

function farewell(c, ctx) {
  const rng = ctx.rng;
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
