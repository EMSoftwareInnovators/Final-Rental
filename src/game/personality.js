/* ============================================================
   personality.js -- who a person IS, behaviourally.
   Archetypes drive patience, honesty about late fees, whether
   they can actually pay, how long they browse, and every line
   they speak. Two customers with the same archetype still differ:
   appearance, name and quirk are rolled separately.
   ============================================================ */

const P = (id, o) => ({ id, ...o });

export const ARCHETYPES = [
  P('REGULAR', {
    tag: 'a regular',
    weight: 16, patience: 52, irascibility: 0.12, honesty: 0.95, generosity: 0.45,
    chattiness: 0.4, wealth: 0.95, speed: 1.0, browse: 9,
    lines: {
      greetReturn: [
        `Evening. Just dropping this back before you close.`,
        `Hey — same time, same tape. How's the shift treating you?`,
        `Brought it back. Two nights, like always.`,
      ],
      greetRent: [
        `Evening. Found something for tonight.`,
        `Hi. This one any good? Don't answer, I'll find out.`,
        `Just this one. I know, I know — I'm predictable.`,
      ],
      feeAccept: [`Yeah, that's fair. Here.`, `My own fault. Here you go.`, `Figured. Take it out of this.`],
      feeDispute: [`Huh. I thought I had another day on that one.`],
      feeWaived: [`Ah — you didn't have to do that. Thanks.`, `That's decent of you. I'll remember it.`],
      noMoney: [`Shoot, I left my wallet in the truck. Two seconds.`],
      thanks: [`Thanks. Have a quiet one.`, `Appreciate it. Lock up safe.`, `Thanks — get home okay.`],
      wait: [`No rush.`, `Take your time.`],
      angry: [`Come on now. I've been coming here four years.`],
      bye: [`Night.`, `See you Thursday.`, `Take care of yourself.`],
      smalltalk: [
        `Street lights are out on Ninth again. Whole block's dark.`,
        `You working alone tonight? That's a lot of store for one person.`,
        `My wife wants the comedy section reorganized. I told her that's your job.`,
      ],
    },
  }),

  P('IMPATIENT', {
    tag: 'in a hurry',
    weight: 12, patience: 20, irascibility: 0.7, honesty: 0.75, generosity: 0.05,
    chattiness: 0.05, wealth: 0.9, speed: 1.25, browse: 4,
    lines: {
      greetReturn: [`Returning. I'm double parked.`, `Here. Quick as you can.`, `Take it, take it — I'm late.`],
      greetRent: [`This one. Ring it up.`, `Just this. Meter's running.`],
      feeAccept: [`Fine. Whatever. Here.`],
      feeDispute: [`A dollar? For a day? Are you serious right now.`],
      feeWaived: [`Great. Can I go?`],
      noMoney: [`I don't have cash on me. Put it on the account.`],
      thanks: [`Yep.`],
      wait: [`Any day now.`, `Hello? Still here.`, `Is this a one-person operation or —`],
      angry: [`Unbelievable. This is a five second transaction!`, `I have somewhere to BE.`],
      bye: [`Finally.`, `Yeah.`],
      smalltalk: [`I don't have time for this.`],
    },
  }),

  P('CHATTY', {
    tag: 'a talker',
    weight: 11, patience: 90, irascibility: 0.05, honesty: 0.9, generosity: 0.6,
    chattiness: 1.0, wealth: 0.85, speed: 0.85, browse: 16,
    lines: {
      greetReturn: [
        `Oh good, you're still open! I said to myself, they close at midnight, I've got time.`,
        `Hi honey. Now — I watched this twice. Twice! Let me tell you about the ending.`,
      ],
      greetRent: [
        `I have been standing in that aisle for twenty minutes and I finally decided.`,
        `Now don't judge me for this one. My sister recommended it.`,
      ],
      feeAccept: [`Oh of course, of course, a dollar a day, that's the rule, I know the rule.`],
      feeDispute: [`Now hold on. I dropped it in the slot Tuesday. Or was it Wednesday. It was after bowling.`],
      feeWaived: [`Well aren't you a sweetheart. I'm telling your manager. In a good way!`],
      noMoney: [`Oh no. Oh no no no. I left my purse on the counter at home.`],
      thanks: [`You're a doll. Okay. Okay I'm going. Okay.`],
      wait: [`Take your time, sweetheart, I'll just talk.`, `Did I tell you about my sister's dog?`],
      angry: [`Well. That's not very friendly.`],
      bye: [`Bye now! Say hi to — well, whoever's here tomorrow!`],
      smalltalk: [
        `My nephew says the tapes are going away. Discs, he says. Little discs. I said Kevin, nobody wants that.`,
        `There were police cars on Delaney all afternoon. Three of them. Nobody will say a word about it.`,
        `You look tired, honey. Are you eating?`,
      ],
    },
  }),

  P('CHEAPSKATE', {
    tag: 'watches every penny',
    weight: 10, patience: 55, irascibility: 0.45, honesty: 0.3, generosity: 0,
    chattiness: 0.3, wealth: 0.8, speed: 1.0, browse: 12,
    lines: {
      greetReturn: [`Before you scan that — I want to talk about the charge.`, `Returning. And I'm disputing whatever it says.`],
      greetRent: [`Is this one of the ninety-nine cent ones? It's shelved with them.`],
      feeAccept: [`Under protest. Write that down. Under protest.`],
      feeDispute: [
        `No. Absolutely not. Your drop box was jammed on Sunday and I have a witness.`,
        `A dollar a day is highway robbery and you know it.`,
      ],
      feeWaived: [`Now THAT is customer service. See? Was that so hard?`],
      noMoney: [`I'm not paying that. Hold it behind the counter, I'll come back.`],
      thanks: [`Mm.`],
      wait: [`Clock's ticking on your minimum wage, not mine.`],
      angry: [`I want your name. What's your name? I'm writing it down.`],
      bye: [`I'll be back Tuesday. With the coupon.`],
      smalltalk: [`Your competitor across the bridge does two-for-one on Wednesdays.`],
    },
  }),

  P('BROKE', {
    tag: 'short on cash',
    weight: 9, patience: 60, irascibility: 0.3, honesty: 0.85, generosity: 0,
    chattiness: 0.5, wealth: 0.05, speed: 1.0, browse: 14,
    alwaysBroke: true,
    lines: {
      greetReturn: [`Returning this. And, uh. About the fee. Can we talk about the fee.`],
      greetRent: [`Okay so. Full disclosure. I have four dollars and it's in quarters.`],
      feeAccept: [`...yeah. Yeah, okay. That's most of it.`],
      feeDispute: [`I'm not saying I don't owe it. I'm saying I don't HAVE it.`],
      feeWaived: [`Seriously? You're — man. Thank you. Really.`],
      noMoney: [
        `I know how this sounds. Can I leave my watch? It's a real watch.`,
        `What if I bring the money Friday. I get paid Friday. I'm good for it.`,
        `Can I put it on my mom's account? She's on the account.`,
      ],
      thanks: [`You're alright. You're alright, man.`],
      wait: [`It's fine, I'm not in a rush. Obviously.`],
      angry: [`I'm not trying to steal from you! I'm just BROKE!`],
      bye: [`Alright. Next week.`],
      smalltalk: [`Are you guys hiring? Like, at all?`],
    },
  }),

  P('HORROR_NERD', {
    tag: 'knows the horror shelf better than you',
    weight: 10, patience: 70, irascibility: 0.4, honesty: 0.95, generosity: 0.3,
    chattiness: 0.8, wealth: 0.8, speed: 1.05, browse: 18,
    prefers: 'HORROR',
    lines: {
      greetReturn: [`Bringing this back. Whoever shelved it under Drama should be fired. Not you. Probably you.`],
      greetRent: [`Uncut. This is the uncut one, right? The box art's different on the uncut one.`],
      feeAccept: [`Worth it. Kept it an extra night for the commentary.`],
      feeDispute: [`I returned it Sunday. Your slot ate it. It happens.`],
      feeWaived: [`Solid. You're the only one here who gets it.`],
      noMoney: [`Card's maxed. I bought a laserdisc I can't play.`],
      thanks: [`Rewound, obviously. I'm not an animal.`],
      wait: [`Take your time. I'm reading the back of this.`],
      angry: [`Do you even WATCH these? Do you know what you're sitting on here?`],
      bye: [`If the sequel comes in, hold it. Hold it for me.`],
      smalltalk: [
        `You know they filmed part of one out on Route 9? Real place. Real barn.`,
        `Everyone's talking about that guy on the news. That's not horror. That's just a guy.`,
        `Your horror section is alphabetical by DIRECTOR. Who did that. That's insane. I love it.`,
      ],
    },
  }),

  P('PARENT', {
    tag: 'kids in the car',
    weight: 10, patience: 30, irascibility: 0.55, honesty: 0.9, generosity: 0.35,
    chattiness: 0.3, wealth: 0.9, speed: 1.15, browse: 7,
    prefers: 'FAMILY',
    lines: {
      greetReturn: [`Returning. The kids are in the car with the engine running, so.`],
      greetRent: [`Is this one okay for a seven year old? Actually okay, not "PG" okay.`],
      feeAccept: [`Of course there's a fee. Of course there is. Here.`],
      feeDispute: [`I put it in the slot myself. I watched it go in.`],
      feeWaived: [`Oh thank god. Thank you. Genuinely.`],
      noMoney: [`I've got — hang on — I've got six dollars and a juice box.`],
      thanks: [`Thanks. Sorry. Long day.`],
      wait: [`I really can't leave them out there long.`],
      angry: [`My children are ALONE IN A CAR. Do you understand that?`],
      bye: [`Okay. Going. Bye.`],
      smalltalk: [`Don't put the scary ones at kid height. That's all I'll say.`],
    },
  }),

  P('NURSE', {
    tag: 'coming off a double',
    weight: 8, patience: 75, irascibility: 0.08, honesty: 1.0, generosity: 0.7,
    chattiness: 0.25, wealth: 0.95, speed: 0.9, browse: 10,
    lines: {
      greetReturn: [`Hi. Sorry, I'm barely here. Sixteen hours.`],
      greetRent: [`Something I can fall asleep to. Nothing with sirens in it.`],
      feeAccept: [`That's on me. Here.`],
      feeDispute: [`Was it? God. Maybe. Everything's been Tuesday for a week.`],
      feeWaived: [`That's very kind. Thank you.`],
      noMoney: [`I've got — sorry, my card's in my scrubs. In my locker.`],
      thanks: [`Thank you. Really.`],
      wait: [`It's fine. Standing still is nice.`],
      angry: [`Please. I just want to go home.`],
      bye: [`Goodnight. Lock your door, hm?`],
      smalltalk: [
        `We had police at the hospital tonight. They wouldn't say why.`,
        `If you get a chance to sit down tonight, take it.`,
      ],
    },
  }),

  P('CONSPIRACY', {
    tag: 'has a theory',
    weight: 8, patience: 80, irascibility: 0.35, honesty: 0.6, generosity: 0.2,
    chattiness: 0.95, wealth: 0.7, speed: 0.95, browse: 15,
    lines: {
      greetReturn: [`I'm returning this but I want it noted that I only watched it for research.`],
      greetRent: [`This one got pulled from theaters in four states. Four. Ask yourself why.`],
      feeAccept: [`Fine. Cash. No record.`],
      feeDispute: [`Your computer says late. Your computer says a lot of things.`],
      feeWaived: [`See, this is what I'm talking about. Person to person. No system.`],
      noMoney: [`I don't keep money in a bank and I'm not explaining why.`],
      thanks: [`Stay sharp.`],
      wait: [`No no, take your time. I'll watch the window.`],
      angry: [`You're one of them. I should have known.`],
      bye: [`Lock that door tonight. I mean it.`],
      smalltalk: [
        `Three people gone in six weeks and it's page four. Page four!`,
        `The cop that came in here — did he show you a badge, or did he just say he was a cop?`,
        `They always work retail hours. The ones like this. Have you noticed that?`,
      ],
    },
  }),

  P('DRUNK', {
    tag: 'has had a few',
    weight: 7, patience: 45, irascibility: 0.75, honesty: 0.5, generosity: 0.5,
    chattiness: 0.7, wealth: 0.6, speed: 0.7, browse: 13,
    lines: {
      greetReturn: [`Ssss'yours. This is yours. I'm giving it back.`, `Hey. HEY. I brought it back. I'm a good person.`],
      greetRent: [`Somethin' funny. Nothin' sad. I can't do sad tonight.`],
      feeAccept: [`Money money money. Here's money.`],
      feeDispute: [`Nah. Nah nah nah. No fee. We're friends.`],
      feeWaived: [`I LOVE this place.`],
      noMoney: [`I spent it. All of it. On somethin' stupid.`],
      thanks: [`You're a prince. A PRINCE.`],
      wait: [`I'll wait. I got nowhere. Nowhere at all.`],
      angry: [`Don't you look at me like that. DON'T.`],
      bye: [`I'm walkin'. It's fine. It's four blocks.`],
      smalltalk: [`There's somebody standin' across the street. Been there a while. Just standin'.`],
    },
  }),

  P('COMPLAINER', {
    tag: 'wants to speak to someone',
    weight: 8, patience: 34, irascibility: 0.85, honesty: 0.55, generosity: 0,
    chattiness: 0.5, wealth: 0.85, speed: 1.0, browse: 11,
    lines: {
      greetReturn: [`Before we start — the tape was damaged. Damaged when I got it.`],
      greetRent: [`This was in the wrong section. Again. This is the third time.`],
      feeAccept: [`I'll pay it. And then I'm calling in the morning.`],
      feeDispute: [`Absolutely not. Remove it. Remove it right now.`],
      feeWaived: [`As you should. That's what I've been saying.`],
      noMoney: [`I'm not paying for your mistake, so the amount is irrelevant.`],
      thanks: [`Hmph.`],
      wait: [`Is there someone else working tonight? Anyone?`],
      angry: [`Do you know how long I've been standing here? DO YOU?`, `What is your name. Your NAME.`],
      bye: [`This isn't over.`],
      smalltalk: [`Your carpet is filthy, by the way. Just so someone's said it.`],
    },
  }),

  P('QUIET', {
    tag: 'says very little',
    weight: 9, patience: 100, irascibility: 0.1, honesty: 0.8, generosity: 0.1,
    chattiness: 0.05, wealth: 0.8, speed: 0.95, browse: 20,
    unsettling: true,
    lines: {
      greetReturn: [`...Returning.`, `Here.`],
      greetRent: [`This one.`],
      feeAccept: [`Okay.`],
      feeDispute: [`...No.`],
      feeWaived: [`...Thank you.`],
      noMoney: [`I don't have it.`],
      thanks: [`Mm.`],
      wait: [`...`, `(watching you)`],
      angry: [`...`],
      bye: [`...`],
      smalltalk: [`Do you close alone?`, `...`, `It's cold out.`],
    },
  }),

  P('SNOB', {
    tag: 'a film person',
    weight: 7, patience: 65, irascibility: 0.4, honesty: 0.9, generosity: 0.25,
    chattiness: 0.75, wealth: 0.9, speed: 1.0, browse: 17,
    lines: {
      greetReturn: [`Returning. It's a lesser print, I'm afraid. Someone taped over the last four minutes.`],
      greetRent: [`I'll take this, though I've seen it. On a screen. A real one.`],
      feeAccept: [`Naturally. The cost of art.`],
      feeDispute: [`Your ledger is wrong. Mine isn't.`],
      feeWaived: [`Civilised. Thank you.`],
      noMoney: [`I've an account. Somewhere. Under a different name.`],
      thanks: [`Mm. Adequate.`],
      wait: [`Do carry on.`],
      angry: [`This is precisely why the format is dying.`],
      bye: [`Try to watch something with a subtitle occasionally.`],
      smalltalk: [`Your "Drama" section is a landfill and I say that with love.`],
    },
  }),

  P('TEEN', {
    tag: 'a teenager with a note',
    weight: 8, patience: 50, irascibility: 0.35, honesty: 0.7, generosity: 0.05,
    chattiness: 0.45, wealth: 0.25, speed: 1.1, browse: 12,
    lines: {
      greetReturn: [`My mom said to bring this back and to say sorry it's late.`],
      greetRent: [`Can I get this one? I have a note. It's a real note.`],
      feeAccept: [`She gave me exactly enough. I think. Is this enough?`],
      feeDispute: [`She said you'd say that. She said don't let them charge you twice.`],
      feeWaived: [`Wait, really? Okay. Cool. Thanks.`],
      noMoney: [`I have like a dollar sixty. Can I owe you?`],
      thanks: [`Sweet. Thanks.`],
      wait: [`It's cool.`],
      angry: [`Whatever, man.`],
      bye: [`Later.`],
      smalltalk: [`Is it true somebody got grabbed behind the laundromat?`],
    },
  }),

  P('TRUCKER', {
    tag: 'passing through',
    weight: 6, patience: 60, irascibility: 0.3, honesty: 0.85, generosity: 0.5,
    chattiness: 0.4, wealth: 0.9, speed: 1.0, browse: 10,
    lines: {
      greetReturn: [`Dropping this. Rented it in Fell's Point, but you're the same chain, right?`],
      greetRent: [`Something for the sleeper cab. Two hours, no thinking.`],
      feeAccept: [`Yep. Cash alright?`],
      feeDispute: [`I was in Ohio. Physically in Ohio.`],
      feeWaived: [`Good man. Good man.`],
      noMoney: [`Company card's frozen till Monday.`],
      thanks: [`Preciate you.`],
      wait: [`I got nothin' but road ahead of me.`],
      angry: [`Hey. Hey. Watch the tone, kid.`],
      bye: [`Keep the doors locked, this town's got a problem.`],
      smalltalk: [`Saw a guy walking the shoulder out by the quarry. No car. No flashlight. Just walking.`],
    },
  }),
];

/** The mask the killer wears while he's pretending to be a customer. */
export const KILLER_MASK = P('MASK', {
  tag: 'polite. too polite',
  weight: 0, patience: 999, irascibility: 0, honesty: 1, generosity: 0.2,
  chattiness: 0.5, wealth: 1, speed: 0.92, browse: 16,
  unsettling: true,
  lines: {
    greetReturn: [`Good evening. I believe this is yours.`],
    greetRent: [`Good evening. I'd like to take this one out, please.`],
    feeAccept: [`Of course. I always pay what I owe.`],
    feeDispute: [`If you say it's late, then it's late.`],
    feeWaived: [`That's generous. People aren't, usually.`],
    noMoney: [`I have it. I always have it.`],
    thanks: [`Thank you. You've been very helpful.`],
    wait: [`Take all the time you need.`, `I'm not in any hurry at all.`],
    angry: [`...`],
    bye: [`Goodnight. I'll see you again.`],
    smalltalk: [
      `Do you work these nights alone, or is there someone in the back?`,
      `What time do you actually lock up? The sign says midnight. Signs lie.`,
      `That back door — does it lock from the outside, or only from in here?`,
      `You can see the whole parking lot from behind that counter. That's good. That's smart.`,
      `I like a place that stays open late. Says something about a person, working nights.`,
      `Do the police come by? On a normal night, I mean.`,
    ],
  },
});

/** The officer who opens every shift. */
export const OFFICER = P('OFFICER', {
  tag: 'county sheriff',
  patience: 999, irascibility: 0, honesty: 1, generosity: 0, chattiness: 1,
  wealth: 1, speed: 1.05, browse: 0,
  lines: {},
});

export function pickPersonality(rng, exclude = []) {
  const pool = ARCHETYPES.filter((a) => !exclude.includes(a.id));
  let total = 0;
  for (const a of pool) total += a.weight;
  let r = rng() * total;
  for (const a of pool) { r -= a.weight; if (r <= 0) return a; }
  return pool[pool.length - 1];
}

export function line(person, key, rng, fallback = '...') {
  const pool = person.personality.lines[key];
  if (!pool || !pool.length) return fallback;
  return pool[rng.int(pool.length)];
}
