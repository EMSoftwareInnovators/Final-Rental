/* ============================================================
   chatter.js -- the rest of what people say.

   personality.js holds each archetype's core handful of lines, so
   that file stays readable as a table of behaviour. This one holds
   the bulk: everything else that comes out of their mouths, merged
   onto the archetype at load. Split out because it is writing, not
   design, and it will only ever get longer.

   Keys match the categories personality.js already uses:
     greetReturn  greetRent  feeAccept  feeDispute  feeWaived
     noMoney      thanks     wait       angry       bye      smalltalk
   ============================================================ */

export const EXTRA_LINES = {

  REGULAR: {
    greetReturn: [
      `Back on time for once. Mark it on a calendar.`,
      `Here you go. Watched it Sunday with the wife, she fell asleep at the boat.`,
      `Dropping this. Didn't want it hanging over me all week.`,
      `Rewound and everything. I'm learning.`,
      `Evening. Cold one out there. Here's your tape.`,
    ],
    greetRent: [
      `Got a hunch about this one. Talk me out of it.`,
      `Same as always — something I've probably already seen.`,
      `I'll take this. And if it's terrible I'm telling you about it Thursday.`,
      `This one. My neighbour won't shut up about it.`,
      `Evening. Give me the usual damage.`,
    ],
    feeAccept: [
      `Yeah, that's on me. Here.`,
      `Can't argue with the calendar. Take it.`,
      `Worth every cent, honestly. Here.`,
    ],
    feeDispute: [
      `Two days? I'd have sworn it was one. Ah — no, you're right. Sunday.`,
      `Hm. Alright, I'll take your word for it. You've never had me wrong.`,
    ],
    feeWaived: [
      `You don't have to do that. But I won't stop you.`,
      `Now I owe you one, and I don't like owing people.`,
      `That's decent. That's genuinely decent.`,
    ],
    noMoney: [
      `Wallet's in the other coat. Every time, the other coat.`,
      `I've got a five in the truck. Give me thirty seconds.`,
    ],
    thanks: [
      `Appreciate it. Don't work too late.`,
      `Thanks. Say hi to whoever's on tomorrow.`,
      `Cheers. You're good at this, you know.`,
    ],
    wait: [`I'm in no hurry.`, `Whenever you're ready.`, `Don't rush on my account.`],
    angry: [
      `Come on. It's me. You know me.`,
      `Four years I've been coming in here and this is the night we do this?`,
    ],
    bye: [`Night. Lock up.`, `See you next week.`, `Alright. Go safe.`, `Goodnight.`,
      `Right. Same time next week, God willing.`,
    ],
    smalltalk: [
      `They finally paved the stretch by the school. Only took nine years.`,
      `That new place by the highway — have you been? Everyone says don't.`,
      `My daughter got into the college in Millbrook. First one in the family.`,
      `You ever get bored in here? Genuine question.`,
      `I keep meaning to ask what happened to the fella who used to work Fridays.`,
      `The heating in this place has never once worked, has it.`,
      `Somebody's put a shopping cart in the creek again. Third one this year.`,
      `Half the parade's shut by ten now. You're the only light on this side.`,
      `I drove past twice before I saw you were open. You want a bigger sign.`,
    ],
  },

  IMPATIENT: {
    greetReturn: [
      `Returning. Please don't check it in front of me, I'll lose my mind.`,
      `Here. I'm blocking a fire lane, so.`,
      `Take it. Take it. Thank you.`,
    ],
    greetRent: [
      `This. Nothing else. Go.`,
      `I've already decided, so please don't recommend anything.`,
      `Whatever it costs. I'll take it.`,
      `I'll be honest, I grabbed the nearest box. Ring it.`,
    ],
    feeAccept: [`Yes. Fine. Take it out of this.`, `Charge it and let me go.`],
    feeDispute: [
      `I don't have time to argue and I'm going to anyway, which tells you how wrong this is.`,
      `No. Wrong. Next.`,
    ],
    feeWaived: [`Good. Thank you. Bye.`, `Fine — great — can I go?`],
    noMoney: [`Put it on something. Anything. I'll sort it out later.`],
    thanks: [`Yep.`, `Right.`, `Mm.`],
    wait: [
      `We're both getting older here.`,
      `Is there a slower way to do this? Because I'd hate to miss it.`,
      `Tick. Tock.`,
      `I could have driven to the other one by now.`,
      `I'm counting. Out loud, in a minute.`,
    ],
    angry: [
      `This is a TAPE. In a BOX. How is this hard?`,
      `I asked for one thing. ONE.`,
      `Forget it. Forget the whole thing.`,
    ],
    bye: [`Finally.`, `Right. Gone.`, `Bye.`,
      `Gone.`,
    ],
    smalltalk: [`No. No small talk. Please.`, `I'm not doing this tonight.`],
  },

  CHATTY: {
    greetReturn: [
      `There you are! I was worried you'd closed. My sister said you closed. She's always wrong.`,
      `Okay so I brought it back but first — first — you have to hear what happened in it.`,
      `Hello hello hello. Here's your tape. Now. How are you? Really, how are you?`,
    ],
    greetRent: [
      `I've narrowed it down to three and then I put two back and now I'm second-guessing.`,
      `My hairdresser told me about this one. She's got terrible taste but she was RIGHT.`,
      `Now don't laugh. I know what the cover looks like. Don't laugh.`,
      `Now — is this the one with the woman from the other one? With the hair?`,
    ],
    feeAccept: [`A dollar a day! And rightly so. You've got to run a business.`],
    feeDispute: [
      `Now hold on, because I remember exactly, because it was the night of the thing at the church.`,
      `Tuesday. Or — no. Was it Tuesday? Ohhh. It might have been Thursday.`,
    ],
    feeWaived: [`Oh you ANGEL. No — you are. You are an angel and I'm telling everyone.`],
    noMoney: [`My purse! My purse is on the — oh, this is exactly like me, isn't it.`],
    thanks: [`You're a treasure. Truly. A treasure.`, `Bless you, sweetheart.`],
    wait: [
      `Don't mind me, I'll just chatter at you.`,
      `Oh, take your time, I've got nowhere to be and nobody to be there with.`,
    ],
    angry: [`Well now I'm upset. And I don't get upset. Ask anybody.`],
    bye: [
      `Okay! Bye! Oh — one more thing — no. No, it'll keep. Bye!`,
      `Goodnight sweetheart. Eat something.`,
    ],
    smalltalk: [
      `My son's got a new girlfriend and I don't like her and I feel terrible about it.`,
      `They're putting a drive-through in where the bakery was. A DRIVE-THROUGH.`,
      `Do you know I have never once seen this street empty? Not once. Until tonight, actually.`,
      `I told Marjorie I'd stop talking so much this year. That was January.`,
      `Have you eaten? You look like you haven't eaten.`,
      `The girl at the pharmacy has a tattoo of a moth. A MOTH.`,
      `I'd have loved a job like this at your age. All these stories on a shelf.`,
      `Have you noticed the lights out on Ninth? My husband says it's the council. It's always the council.`,
      `I've started walking in the mornings. Nobody asked, but there it is.`,
    ],
  },

  CHEAPSKATE: {
    greetReturn: [
      `Before we begin. I have the receipt, I have the date, and I have a good memory.`,
      `Returning. And I'd like to know why the last one was ninety-nine cents and this one wasn't.`,
    ],
    greetRent: [
      `This was on the two-for-one rack. I don't care what the sticker says, it was on the rack.`,
      `What's your cheapest. Not your cheapest good one. Your cheapest.`,
    ],
    feeAccept: [`I'm paying it. I want it clear that I'm paying it, not agreeing with it.`],
    feeDispute: [
      `Your drop slot was jammed and I have a witness and the witness is my wife.`,
      `The sign says late fees "may" apply. May. That's a choice, and you're choosing wrong.`,
      `I'd like to see the policy. In writing. Tonight.`,
      `I want to know the exact minute it went from on-time to late. The exact minute.`,
    ],
    feeWaived: [`There. Was that so hard? That's all I ever ask for.`],
    noMoney: [`I have money. I'm choosing not to spend it on this. There's a difference.`],
    thanks: [`Mm.`, `Right.`],
    wait: [`I've got all night and you're on the clock, so.`],
    angry: [
      `I want your name, your manager's name, and the name of whoever owns this building.`,
      `This is exactly how a place goes under, and I'll be sorry when it does. A bit.`,
    ],
    bye: [`I'll be back with the coupon. It doesn't expire. I checked.`],
    smalltalk: [
      `You know the place across the bridge does five nights for the price of two.`,
      `Your popcorn machine costs more to run than it makes. I did the maths.`,
      `Free membership is a loss leader. I know what a loss leader is.`,
      `Membership should be free after five years. That's just loyalty.`,
    ],
  },

  BROKE: {
    greetReturn: [
      `Okay before you scan it. Before you scan it. Just — let me explain first.`,
      `Bringing it back. It's late. I know it's late. I know.`,
    ],
    greetRent: [
      `I've got three dollars and eleven cents and a lot of hope.`,
      `Is there anything that's cheap and also not terrible? Be honest.`,
    ],
    feeAccept: [`...Right. Yeah. That's — okay. That's fine. That's fine.`],
    feeDispute: [`I'm not disputing it. I'm just saying it out loud so it hurts less.`],
    feeWaived: [
      `Are you serious? Man. That's — you have no idea. Thank you.`,
      `I'm going to remember this. I mean that.`,
    ],
    noMoney: [
      `What if I came back Friday. I get paid Friday. I always get paid Friday.`,
      `I could sweep up. I'm serious. I'd sweep up for a tape.`,
      `My cousin's on the account. Sort of. He said I could.`,
    ],
    thanks: [`You're solid. Thanks, man.`, `Appreciate you. Genuinely.`],
    wait: [`It's fine. I'm not exactly booked up.`],
    angry: [`I'm not a thief! I'm just having a bad year!`],
    bye: [`Alright. Friday. I'll see you Friday.`,
      `Thanks for not making it weird.`,
    ],
    smalltalk: [
      `You guys hiring? Even part time. Even nights.`,
      `Is it weird that this is the nicest part of my week?`,
      `My car's making a noise and I've decided not to think about it.`,
      `Do you ever let people watch one in the store? No. No, I know. Forget it.`,
    ],
  },

  HORROR_NERD: {
    greetReturn: [
      `Returning. And I need to flag something about the transfer on this print.`,
      `Here. Somebody's got the sequel shelved before the original. Somebody. Not naming names.`,
    ],
    greetRent: [
      `Is this the one with the extra ninety seconds, or the one they cut for the mall chains?`,
      `Nobody's rented this in four months. I checked the sticker. Four months.`,
    ],
    feeAccept: [`Extra night, extra dollar. I watched the whole thing twice. Fair trade.`],
    feeDispute: [`I put it in the slot Sunday. The slot ate it. It ate one of mine in October too.`],
    feeWaived: [`See, you get it. Nobody else here gets it.`],
    noMoney: [`I spent it. On a laserdisc. That I cannot play. On any machine I own.`],
    thanks: [`Rewound. Obviously. What am I, a monster?`],
    wait: [`Fine by me. I'm reading the back of this and it's LYING.`],
    angry: [
      `You have got a first-print box on that shelf and you've got a price gun sticker ON IT.`,
      `Do you have any idea what you're sitting on in this building?`,
    ],
    bye: [
      `If anything comes in with a Japanese sleeve, hold it. I'll pay whatever.`,
      `Lock up properly. I mean it. Not being funny.`,
    ],
    smalltalk: [
      `They shot part of one about ten miles from here. Real barn. It's still there.`,
      `Everyone keeps saying the news thing is "like a movie." It isn't. Movies have an ending.`,
      `Your horror shelf is alphabetical by director and it has RUINED me for other shops.`,
      `There's a version of this with a different last shot. Nobody believes me.`,
      `The scariest thing on this shelf is the one with the cheapest box. Every time.`,
      `Somebody rented the whole bottom row of that shelf last month. All eleven. Who does that?`,
      `You've got one in here that isn't supposed to exist in this country. I'm not telling you which.`,
    ],
  },

  PARENT: {
    greetReturn: [
      `Returning. Please be quick, there is a seven year old operating my radio.`,
      `Here. He watched it eleven times. Eleven. It might be worn through.`,
    ],
    greetRent: [
      `Is there anything in this building without a single scary bit? Not one.`,
      `She's picked this and I've said yes and I'm regretting it already.`,
      `If there's one bad word in it I will hear about it for a week.`,
    ],
    feeAccept: [`Fine. Add it to tonight. Everything's been added to tonight.`],
    feeDispute: [`I posted it Sunday. I remember because it was the one calm moment I had.`],
    feeWaived: [`Oh — thank you. That is genuinely the best thing that's happened today.`],
    noMoney: [`I have coins. I have a LOT of coins. From the car.`],
    thanks: [`Thank you. Sorry. It's been a day.`],
    wait: [
      `They're fine. They're fine. I can see the car.`,
      `If a horn goes off, that's mine.`,
    ],
    angry: [`My kids are in a PARKED CAR at eleven at night and we're discussing a DOLLAR.`],
    bye: [`Right. Going. Bye. BYE.`],
    smalltalk: [
      `Don't put the ones with the monsters on the bottom shelf. That's all I'll say.`,
      `Whoever decided cartoons should be two hours long owes me my evenings back.`,
      `Do you have kids? Don't answer that. It's a trap either way.`,
      `Is there a night that isn't busy? I'll come then. I'll come at four in the morning.`,
    ],
  },

  NURSE: {
    greetReturn: [
      `Hi. Returning. Sorry — I've been awake since yesterday, technically.`,
      `Here you go. I don't think I actually saw the end of it.`,
    ],
    greetRent: [
      `Something quiet. No hospitals, no sirens, nobody bleeding.`,
      `I want something I've seen before. I don't want to have to follow anything.`,
    ],
    feeAccept: [`That's mine to pay. Here.`],
    feeDispute: [`Was it? I genuinely can't tell you what day it is, so I'll take your word.`],
    feeWaived: [`Oh, that's kind. Thank you. Small things count more than people think.`],
    noMoney: [`My card's in my locker with my shoes and my dignity.`],
    thanks: [`Thank you. Really. Take care of yourself tonight.`],
    wait: [`Honestly? Standing somewhere warm is a treat.`],
    angry: [`Please. I'm not being difficult. I just want to go home.`],
    bye: [
      `Goodnight. Lock the door behind me, would you?`,
      `Get some sleep when you can. It doesn't keep.`,
    ],
    smalltalk: [
      `We had two officers in the department tonight and nobody would tell us why.`,
      `You get to a point in a double where everything's funny. I'm past that point.`,
      `If you ever cut yourself in here — properly, I mean — pressure first, then worry.`,
      `Somebody came in tonight who wouldn't say what happened to them. That's the part that stays with you.`,
      `I've stopped watching anything with an ambulance in it. It's not restful.`,
      `Whoever's on with you tomorrow — tell them Tuesday nights are the strange ones.`,
    ],
  },

  CONSPIRACY: {
    greetReturn: [
      `Returning it. I'd like it off my record, whatever your record is.`,
      `Here. I watched it with the sound off and the subtitles on. You see more that way.`,
    ],
    greetRent: [
      `This was pulled in four states. Four. That's not a coincidence, that's a pattern.`,
      `Do you have anything that was never officially released? Don't answer fast.`,
    ],
    feeAccept: [`Cash. No card. No record of me being here at all, ideally.`],
    feeDispute: [`Your computer says it. Your computer said Y2K too.`],
    feeWaived: [`Person to person. No system. That's how it used to work.`],
    noMoney: [`I don't use banks. I'm not going to explain that and you don't want me to.`],
    thanks: [`Stay sharp. Head up.`],
    wait: [`Take your time. I'll keep an eye on the window.`],
    angry: [`You're one of them. I actually thought you weren't.`],
    bye: [
      `Lock it. Both locks. The top one especially.`,
      `If a car sits out there more than ten minutes, that's not somebody waiting.`,
    ],
    smalltalk: [
      `Three gone in six weeks and it's page four. Page four, under a story about a fair.`,
      `Ask yourself who benefits from everybody staying in on a Friday.`,
      `They always work retail hours. Late shift, alone, cash on hand. Look it up.`,
      `The phone in here — is that a store line or does it go through the mall exchange?`,
      `You've got a back door. Is it alarmed? Don't tell me. Just — know the answer.`,
      `I'm not saying it's not a man. I'm saying nobody's checked whether it's one man.`,
      `Your camera up there. Does it record, or is it just the box? Be honest.`,
      `Somebody's been going through the returns bin outside. I've seen the footprints.`,
    ],
  },

  DRUNK: {
    greetReturn: [
      `I brought it BACK. Say it. Say I brought it back.`,
      `S'yours. Was mine for two days. Now s'yours again. Beautiful system.`,
    ],
    greetRent: [
      `Somethin' with explosions. Or dogs. Explosions or dogs.`,
      `You pick. I trust you. I trust you more'n I trust me.`,
    ],
    feeAccept: [`Money money money. There. Is that money?`],
    feeDispute: [`No fee. Not for me. We're — you and me, we're — yeah.`],
    feeWaived: [`I LOVE this store. I'm gonna tell everyone. Everyone.`],
    noMoney: [`I had money. I had SO much money. Four hours ago.`],
    thanks: [`You're a saint. A SAINT. In a video store.`],
    wait: [`I'm not goin' anywhere. Ever, possibly.`],
    angry: [
      `Don't look at me like that. Don't you DARE look at me like that.`,
      `I'm not — I'm FINE. I'm fine!`,
    ],
    bye: [
      `I'm walkin'. Four blocks. S'fine. It's all lit up. Mostly.`,
      `Night. Night night. Lock the — yeah. Do the thing.`,
      `You're a good kid. Whoever you are.`,
    ],
    smalltalk: [
      `There's a fella across the street. Been there since I came in. Just standin'.`,
      `You ever think about how it's dark out there and light in here? Like a fishtank.`,
      `My wife left in April and I keep tellin' strangers about it. Sorry.`,
      `Somebody oughta walk you to your car. That's all I'm sayin'.`,
      `I like it in here. S'warm. S'got carpet.`,
    ],
  },

  COMPLAINER: {
    greetReturn: [
      `Before you touch it — I want it documented that it arrived damaged.`,
      `Returning, and I'd like to register a complaint about the state of your parking lot.`,
    ],
    greetRent: [
      `This was filed under the wrong letter. Again. That's four times now. I count.`,
      `I'll take it, but the box is scuffed and I want that noted so I'm not blamed.`,
    ],
    feeAccept: [`I'll pay it tonight and I'll be phoning about it in the morning.`],
    feeDispute: [
      `Remove it. I'm not asking. Remove it.`,
      `I have never been late for anything in my life and I resent the implication.`,
    ],
    feeWaived: [`As you should have from the start. That's all this ever needed to be.`],
    noMoney: [`I'm not paying for an error that isn't mine, so the figure is academic.`],
    thanks: [`Hmph.`, `We'll see.`],
    wait: [
      `Is there anybody else working? Anybody at all?`,
      `I'd like to see whoever schedules the staffing here.`,
    ],
    angry: [
      `Do you know how long I have been standing at this counter? DO YOU?`,
      `Your name. I want your name and I want it spelled.`,
      `This is the single worst run business on this parade and I include the laundromat.`,
      `I would like this ENTIRE INTERACTION on record.`,
    ],
    bye: [`This isn't finished.`, `You'll hear about this.`],
    smalltalk: [
      `Your carpet is filthy. Somebody had to say it and nobody has.`,
      `That flickering strip light is a headache waiting to happen. Mine, probably.`,
      `The bin outside has been full since Sunday. I photographed it.`,
      `The door sticks. It's stuck since spring. Somebody's going to fall.`,
    ],
  },

  QUIET: {
    greetReturn: [`...Here.`, `Back.`, `(sets it on the counter)`],
    greetRent: [`This.`, `...This one.`, `(slides it forward)`],
    feeAccept: [`Okay.`, `...Fine.`],
    feeDispute: [`No.`, `...That's wrong.`],
    feeWaived: [`...Oh.`, `Thank you.`],
    noMoney: [`I don't have it.`, `No.`],
    thanks: [`Mm.`, `...`],
    wait: [`...`, `(watching you)`, `(does not move)`, `(watching the door)`,
      `(has not blinked)`,
    ],
    angry: [`...`, `(stares)`],
    bye: [`...`, `Night.`, `(leaves without a word)`],
    smalltalk: [
      `Do you close alone?`,
      `It's cold out.`,
      `...You're here every night.`,
      `Nobody walks past after eleven. I've watched.`,
      `That back room. Does it lock?`,
      `...`,
      `(looks at the back room door for a long moment)`,
      `How many keys are there?`,
    ],
  },

  SNOB: {
    greetReturn: [
      `Returning. The print is a disgrace, but that's hardly your doing. Or perhaps it is.`,
      `Here. Someone has taped over the final reel with a football match.`,
    ],
    greetRent: [
      `I'll take this, though I saw it properly. Projected. On film. In a room with other people.`,
      `Do you keep anything that isn't dubbed? Anything at all?`,
    ],
    feeAccept: [`Naturally. The cost of art is chiefly administrative.`],
    feeDispute: [`Your ledger is mistaken. Mine, I'm afraid, is not.`],
    feeWaived: [`Civilised. There's hope for the format yet.`],
    noMoney: [`I have an account somewhere. Possibly under a name I no longer use.`],
    thanks: [`Mm. Adequate.`, `Acceptable.`],
    wait: [`Do carry on. I'm admiring the lighting, which is dreadful.`],
    angry: [
      `This is precisely why the format is dying and nobody will mourn it.`,
      `I am being lectured about lateness by a man in a polo shirt.`,
    ],
    bye: [
      `Try to watch something with a subtitle occasionally. It won't kill you.`,
      `Goodnight. Do something about the Drama section.`,
      `Goodnight. Read something.`,
    ],
    smalltalk: [
      `Your Drama section is a landfill, and I say that with real affection.`,
      `Everything on that wall was made by four studios. Four. Doesn't that trouble you?`,
      `The best thing in this shop is on the bottom shelf with a cracked case.`,
      `There's a version of this with eleven more minutes and it's a different film entirely.`,
      `You've a copy of something extraordinary in here and you've priced it at ninety-nine cents.`,
    ],
  },

  TEEN: {
    greetReturn: [
      `My mom said bring this back and say sorry and don't argue about the fee.`,
      `Um. This is late. She knows it's late. She said not to make it a thing.`,
    ],
    greetRent: [
      `Can I get this one? I have a note. It's actually a real note this time.`,
      `Is this the one everybody's talking about at school or is that a different one?`,
    ],
    feeAccept: [`She gave me exactly this much. Is that — is that right?`],
    feeDispute: [`She said you'd say that. She said not to let you charge twice.`],
    feeWaived: [`Wait, for real? Okay. Um. Thanks.`],
    noMoney: [`I've got like a dollar sixty and a bus pass.`],
    thanks: [`Sweet.`, `Cool, thanks.`],
    wait: [`It's cool.`, `No, you're good.`],
    angry: [`Whatever, man.`, `This is so stupid.`],
    bye: [`Later.`, `Yeah, bye.`],
    smalltalk: [
      `Is it true somebody got grabbed behind the laundromat?`,
      `My friend says you have a room in the back with the banned ones.`,
      `Do you get to watch stuff when nobody's in? That'd be the best job ever.`,
      `Everybody's parents are freaking out about the news thing.`,
      `Are you scared working nights? Like, actually?`,
      `My cousin said you get to keep the ones nobody rents. Is that real?`,
      `Everyone's saying not to walk home alone. Which, like. I walked here.`,
    ],
  },

  TRUCKER: {
    greetReturn: [
      `Dropping this. Picked it up two states back but you're the same sign out front.`,
      `Here. Watched it in a rest stop outside Elkton with the engine running.`,
    ],
    greetRent: [
      `Two hours, no thinking, nothing sad. That's the whole brief.`,
      `Something loud. I've got eleven hours and a radio that only gets gospel.`,
    ],
    feeAccept: [`Yep. Cash alright?`, `Fair's fair. Here.`],
    feeDispute: [`I was in Ohio. Physically. In Ohio.`],
    feeWaived: [`You're alright. Not everybody is.`],
    noMoney: [`Company card's frozen till Monday and payroll's a joke.`],
    thanks: [`'Preciate you.`, `Good man.`],
    wait: [`I got nothing but road ahead. Take your time.`],
    angry: [`Hey. Watch the tone. I've had a long one.`],
    bye: [
      `Keep those doors locked. This town's got something going on.`,
      `Alright. See you in a month or never.`,
      `Alright. Don't be a hero if somebody comes in wrong.`,
    ],
    smalltalk: [
      `Saw a man walking the shoulder out past the quarry. No car, no light. Just walking.`,
      `Every town on this route's got a store like this and one guy in it at midnight.`,
      `Truck stop out by the county line's got a bulletin board. Two of the faces are new this month.`,
      `You want my advice? Park under a light. Even here. Especially here.`,
      `Ninety miles of nothing between here and the interstate. You think about that at night?`,
    ],
  },

  LOST: {
    greetReturn: [`Hi — pickup? Should be under my name.`, `I'm here for the thing. The appointment.`],
    greetRent: [`Hi — pickup? I called ahead.`, `Is this the right desk, or is there another desk?`],
    feeAccept: [`Sure, sure. Whatever it comes to.`],
    feeDispute: [`That's not what the sign out front said. I read the sign.`],
    feeWaived: [`Well that's more like it. Somebody with sense.`],
    noMoney: [`Can I be billed? I'm normally billed.`],
    thanks: [`Great. Thanks. Great.`],
    wait: [`Should I be taking a number? Is there a number thing?`, `Do I sit, or...?`,
      `I'll wait. I've waited longer for less.`,
    ],
    angry: [`This is the worst run one of these I have ever set foot in.`],
    bye: [`I'll come back when you're better organised.`],
    smalltalk: [
      `How late are you open? For the other thing, I mean.`,
      `Have they moved? They've moved, haven't they. Nobody tells anybody anything.`,
      `Is there parking round the back or is that for staff?`,
      `Is there another one of these on the other side of town? There must be.`,
    ],
  },

  DIM: {
    greetReturn: [
      `Okay so I have a question and I already know it's a dumb one.`,
      `I'm bringing this back but first — is it supposed to make a clicking noise?`,
    ],
    greetRent: [
      `Which one of these is the one everybody's talking about? Just point.`,
      `If I take this one, do I have to bring THIS one back, or can I bring a different one?`,
    ],
    feeAccept: [`Oh! Money. Right. Yes. That's the part where I give you money.`],
    feeDispute: [`I don't think that's how days work, though.`],
    feeWaived: [`Wow. Okay. Wow. That's — okay.`],
    noMoney: [`Do you take a check? I have a check. It's not mine but I have it.`],
    thanks: [`You've been really patient with me. People aren't, usually.`],
    wait: [`I'll be over here. Being confused.`],
    angry: [`Now see, THAT'S rude. And I've been nothing but nice.`],
    bye: [`Okay! Bye! Thank you! Bye!`],
    smalltalk: [
      `Does the tape know when it's the end? Like — how does it know to stop?`,
      `My brother says every movie's already inside every tape and you just pick.`,
      `If I record over it, does the old one go somewhere? Where does it GO?`,
      `Why is it called a feature? What's the rest of it, then?`,
      `Is the man on the box the same man every time or do they get different ones?`,
      `Do the actors know we're watching? Not now. But in general.`,
      `Where does the film go when the tape's rewound? Does it go back to the start of itself?`,
    ],
  },
};

/* ============================================================
   WHAT THEY THINK OF THE THING IN THEIR HAND

   The rule: if somebody is going to talk about a film, it is the
   film they are actually holding. Nobody discusses a comedy while
   clutching a slasher.
   ============================================================ */

/** Openers, by the genre of the tape they are holding. */
export const TAPE_TALK = {
  HORROR: [
    `Is this one of the mean ones, or one of the silly ones? I can only do silly tonight.`,
    `The box says "the most terrifying film ever made." They all say that.`,
    `My brother saw this at a sleepover in eighty-nine and he's still odd about it.`,
    `Does anything happen to the dog in this? Just the dog. That's all I ask.`,
    `I'm going to watch this with every light in the house on and I'm not ashamed.`,
    `Is it the kind where you see it, or the kind where you don't? I prefer don't.`,
  ],
  COMEDY: [
    `Is this actually funny, or is it "everyone says it's funny"? There's a difference.`,
    `I need to laugh at something tonight. Genuinely need to. No pressure.`,
    `My wife says the sequel's better. I've decided she's wrong on principle.`,
    `Is this one of those where the trailer had all the good bits?`,
    `Anything with a wedding in it, I'm in.`,
  ],
  ACTION: [
    `Does it have a proper ending or does it stop so they can make another one?`,
    `Explosions. That's all I want. I've had a week.`,
    `Is this the one with the helicopter, or am I thinking of the other one with the helicopter?`,
    `Two hours where nobody has feelings. That's the order.`,
  ],
  SCIFI: [
    `Do I have to have seen the first one? Be honest with me.`,
    `Is it the thinking kind or the shooting kind? Both is fine. I need to prepare.`,
    `They put a spaceship on the cover of things that have no spaceship in them. It's a scandal.`,
    `Is this the one where it turns out to be the future the whole time?`,
  ],
  DRAMA: [
    `Is this going to ruin my evening? Some of these ruin your evening.`,
    `Does anyone die at the end? I'm asking so I can decide how much wine to open.`,
    `It's two and a half hours. It had better earn it.`,
    `Everyone says this is important. Nobody says it's good.`,
  ],
  FAMILY: [
    `Is there anything in this that'll set a seven year old off? Anything at all?`,
    `We've watched the other one so many times the tape's gone soft.`,
    `She picked it. I've agreed. It's happening whether it's good or not.`,
    `Are the songs the kind that stay in your head for a month?`,
  ],
  GAMES: [
    `Does this need the extra controller? Because we've only got the one that works.`,
    `Is it the sort you finish in a weekend, or the sort that eats a month?`,
    `My son says it's too hard. My son says everything's too hard.`,
    `You can't rewind these, can you. I keep forgetting.`,
    `If I don't finish it, does the save stay on it for the next person?`,
  ],
};

/** How they answer when you ask whether they've seen it. */
export const SEEN_IT = {
  yes: [
    `Three times. I keep renting it anyway.`,
    `Twice. Once properly and once asleep.`,
    `Saw it at the drive-in when it came out. Different film on a small screen.`,
    `I've seen it. I'm renting it for somebody who hasn't and I want to watch their face.`,
  ],
  no: [
    `Not yet. That's rather the point.`,
    `No, and I've been carefully avoiding everybody who has.`,
    `Never. Everyone acts like that's a personal failing.`,
    `No. Don't tell me anything. Not one thing.`,
  ],
  opinion: [
    `My brother says it's the worst thing ever made. So. High hopes.`,
    `The girl who recommended it also recommended the last one, which was a crime.`,
    `I've heard it's overrated, which usually means it's fine.`,
    `Somebody at work spoiled it and I've decided not to believe them.`,
  ],
};
