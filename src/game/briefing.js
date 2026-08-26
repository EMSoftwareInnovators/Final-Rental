/* ============================================================
   briefing.js -- what the deputy says, and why he knows more
   tonight than he did last night.

   The county is not getting nowhere. Every night they take
   somebody off the street, and every night the description that
   replaces it is longer: two more witnesses, a partial plate, a
   petrol station camera, the previous man's own account of who
   he was copying. So the bulletin grows, the notepad fills, and
   the number of things you have to check against the person at
   your counter goes up rather than down.

   Which is worse for you, not better. On night four you are
   looking for a man in a green coat. On night ten you are
   looking for a man in a green coat, of a certain height, with
   a certain walk, a certain voice, and something wrong with one
   hand -- and every ordinary customer now matches most of it.
   ============================================================ */

/* ------------------------------------------------------------
   WHY THERE IS MORE TO GO ON TONIGHT

   Drawn per night. Each is a reason the description got longer
   between yesterday's shift and this one.
   ------------------------------------------------------------ */
export const MORE_DETAIL = [
  `We got a good long look at him tonight. Girl at the filling station on Route 9 served him coffee and stared at him the entire time he drank it.`,
  `The man we took last night talked. Not about himself — about the others. Half of what I'm giving you came out of that room at four this morning.`,
  `There's a camera over the pumps at the truck stop. It's a terrible camera. It was pointed at the right place at the right time exactly once.`,
  `A woman followed him two blocks in her car with the lights off, which was a stupid thing to do, and I am not going to say that to her face because she gave us four new details.`,
  `He left a print on a chest freezer. First one in six weeks. That gave us the hand, and the hand gave us a good deal else.`,
  `Two separate people gave us the same walk, an hour apart, on opposite sides of the river. When two strangers describe a walk the same way, that is worth writing down.`,
  `The dry cleaner on Third had his coat in for two days. She kept the ticket. She kept the ticket, clerk.`,
  `A boy on a paper round saw him standing still for eleven minutes. Eleven minutes. Kids notice a man who does not move.`,
  `We have got the smell now, and I know how that sounds, but three people who have never met each other led with it.`,
  `He spoke to somebody. Properly spoke, a whole conversation, and she remembered the voice because it did not match the rest of him.`,
  `State lab came back on the tape from Delaney's. There is about nine seconds where he turns and faces the counter.`,
  `Woman at the church hall does the flowers on a Tuesday and has a memory like a filing cabinet. She gave us four things and got three of them right.`,
  `We had him in a room for six hours last night. Wrong man — but he watched the one we want walk past his window twice.`,
  `Somebody finally reported the car. Nobody had reported the car. There has been a car this whole time.`,
  `A nurse coming off shift walked straight past him under a streetlight and turned around to look. She is trained to look at people. It shows.`,
  `He tried a door at the laundromat that has a bell on it. She got a clear look before he was back on the pavement.`,
  `There is a description in the file from January that nobody connected until this morning. Same everything.`,
  `The one we arrested described who he was copying, in detail, for two hours, because he was proud of it.`,
  `Man at the hardware store sold him something specific. I am not going to tell you what. But he remembered the customer.`,
  `Two of my own people saw him at a distance on Sunday and wrote it up properly, which is not always the case.`,
  `The girl at the drive-in ticket booth has been giving us a description since October and nobody would take it seriously. We are taking it seriously.`,
  `He was in a bar on the county line for forty minutes. Bartenders are the best witnesses there are and the worst at coming forward.`,
  `Photograph. Bad one, off a cheque, seven years old. Enough for the build and the face.`,
  `A cab driver picked somebody up two streets from the last one, at the right time, and only rang us because his wife made him.`,
  `We pulled the tape from the bank machine across from Delaney's. It faces the wrong way. It caught the reflection.`,
  `The neighbour who found her has been remembering things in pieces all week. Three more came back to her last night.`,
  `We've had the same anonymous call four nights running now. Same voice, same phone box. He's telling the truth, whoever he is.`,
  `He was seen buying petrol in a can. That is the kind of detail that comes with a good long look at somebody.`,
  `Highway patrol stopped a vehicle on Thursday and let it go. The trooper wrote a very thorough note about the driver.`,
  `A kid at the arcade sat next to him for half an hour. Kids will tell you everything if you let them talk long enough.`,
  `The county over has been working the same man for a month and would not share a file until this morning.`,
  `The one we took last night had a notebook. In the notebook was a description. Of him.`,
  `There is a dog that will not go near a particular stretch of the towpath. That got us looking somewhere we had not looked.`,
  `Woman came in with a shoe. Just a shoe. It turned out to be a very useful shoe.`,
  `Sketch artist finally got somewhere with the Delaney witness. Took four sessions and she cried through three of them.`,
  `A man in a caravan on the flats keeps a log of every vehicle that passes. Every one. For eleven years. God bless him.`,
];

/* ------------------------------------------------------------
   LAST NIGHT'S ARREST

   What happened to the one from yesterday. He is in custody, and
   he is not the one at your counter tonight.
   ------------------------------------------------------------ */
export const PRIOR_ARREST = [
  `We took a man last night on the Millbrook road with a boot full of things that were not his.`,
  `The one from last night is in a cell in the county building and will be there until Thursday at least.`,
  `We arrested somebody at two this morning, four streets from where you're standing. He is not going anywhere.`,
  `Last night's is charged. Sat down, gave us a name, gave us an address, gave us most of a confession.`,
  `We got last night's coming out of a house on Fenner Street with the lights still off inside.`,
  `The man you'd have been watching for last night was picked up before he made it as far as the parade.`,
  `He walked into a roadblock he had no business not seeing. Last night's is done.`,
  `We have last night's in custody. His own sister called it in, which I will be thinking about for a while.`,
  `Last night's is in the hospital wing with a broken ankle, and a deputy on the door.`,
  `Took him off a bus. A bus, at four in the morning, still wearing the coat.`,
  `He gave himself up at the station at six. Walked in and sat down in reception.`,
  `That one is finished. He tried a back door that had two of my people behind it.`,
  `We found last night's asleep in a car park, which tells you something about how these end.`,
  `Last night's went quietly, which the ones who have done the most usually do.`,
  `He ran about eighty yards. That is the whole of last night's arrest.`,
  `The description you had last night was good and it worked. Somebody else's clerk made the call.`,
];

/* ------------------------------------------------------------
   AND YET THERE IS ANOTHER ONE

   Why the man in custody does not help the clerk tonight.
   ------------------------------------------------------------ */
export const DIFFERENT_MAN = [
  `And there is another one out tonight, and he does not look anything like the one we've got.`,
  `Which would be the end of it, except somebody who is not him tried a door on Fenner Street at eleven.`,
  `So that's one. The trouble is the one we took was in a cell when the last call came in.`,
  `He was in an interview room when it happened again. So it is not him, and it is not finished.`,
  `Different height. Different coat. Different everything. It is not the same man and I am not going to pretend it is.`,
  `We thought that was it, too. Then the call came in at half past one and the man we had was asleep.`,
  `The one we've got is five foot six. The one from last night was six foot two. Somebody has been busy.`,
  `That was Tuesday's. Tonight's is somebody else, and we are back to a coat and a walk.`,
  `Everyone in that building wanted it to be over. It is not over.`,
  `He is the fourth one we have taken. There has been a fifth every time.`,
  `Whatever this is, it does not stop when you arrest one of them. That is the part nobody will print.`,
  `We closed one file last night and opened another one before breakfast.`,
];

/* ------------------------------------------------------------
   THE CLERK PRESSES, AND THE DEPUTY ANSWERS
   ------------------------------------------------------------ */
export const HOW_MANY = [
  `I have asked that question in three meetings and nobody will put a number on it.`,
  `More than we have said publicly. That is as far as I will go.`,
  `Enough that we stopped numbering them and started dating them.`,
  `Officially, one. I have been to the briefings. It is not one.`,
  `You are asking the wrong deputy. I would like to know as well.`,
  `Four, that we can prove. My own opinion is not four.`,
  `Every time I answer that the number has gone up, so I have stopped answering it.`,
  `Nobody has said the word "several" out loud yet. Everybody is thinking it.`,
  `Somebody in the state office knows. It is not anybody who talks to me.`,
  `As many as there are people who read the papers and thought it looked easy.`,
];

export const WHY_MORE_HELPS = [
  `Which is the good news. It is also why the list I'm about to read you is longer than last night's.`,
  `So you have more to check tonight. That cuts both ways and I know it.`,
  `More detail means more to hold a face against. It also means more chances to talk yourself into it.`,
  `Six things instead of three. Do not stop at the coat because the coat matches.`,
  `The longer this list gets, the more ordinary people will match half of it. Match all of it or none of it.`,
  `You will get people tonight who tick four of these. Four is not all of them.`,
];

export const CERTAIN_YES = [
  `I'm not. Nobody is. But three in six weeks and every one of them was working a counter after ten at night. You're a counter after ten at night.`,
  `Sure enough that I have driven past this parade four times tonight already.`,
  `Sure enough that I am standing in a video shop at half past nine telling a stranger about his coat.`,
  `Not sure. Likely. There is a difference and it will not help you at one in the morning.`,
  `Every one so far has been a Tuesday or a Wednesday. It is Wednesday.`,
];

export const CERTAIN_NO = [
  `I'm not sure of anything. That's the job. Somebody saw somebody. Could be a guy who looks like a guy.`,
  `Honestly? Probably not tonight. But I said that on the fourteenth as well.`,
  `Low. I would not have stopped in if the sheriff had not made a list of every lit window.`,
  `Not very. Which is not the same as no, and I would rather you heard it from me than from the radio.`,
];

export const GREETINGS = [
  `Evening. Sorry — I know you're closing soon. County sheriff's office.`,
  `Evening. You the only one on tonight? ... Figures.`,
  `Don't get up. This'll take two minutes.`,
  `Evening. I'm not buying anything, before you ask.`,
  `Sorry to do this at your busiest. County sheriff's office.`,
  `Evening. I've done nine of these tonight and you are the only one still smiling.`,
  `You'll have seen the car outside. Nothing's happened. Not here.`,
  `Evening, son. I'll be quick and then you can get on.`,
];

/* ------------------------------------------------------------
   A NIGHT WITH NOTHING IN IT

   Sometimes he comes by to say it is finished, and means it.
   ------------------------------------------------------------ */
export const ALL_CLEAR = [
  `It's done. The one from last night is charged and there is nobody else out. You can breathe.`,
  `I'm here to tell you to stop looking over your shoulder. We got him, and this time it is actually him.`,
  `No bulletin tonight. Nothing to write down. That is the whole reason I stopped in.`,
  `You can take the list off the wall. Whatever you had written down, throw it out.`,
  `Everybody's accounted for. First night in six weeks I can say that to somebody.`,
  `It's over. I'd rather tell you in person than let you find out from the paper.`,
];

export const ALL_CLEAR_WHY = [
  `He gave us the other two before lunchtime. All three are in the county building.`,
  `The last one walked into the station on his own and asked for a lawyer and a cigarette.`,
  `State took over on Monday and had it wrapped inside a week. I am not too proud to say it.`,
  `Turned out to be two brothers and a man who worked for both of them.`,
  `Everything since September was one man wearing four different coats. We have the coats.`,
  `The one you helped us with on the phone was the last of them, as it happens.`,
];

/** Pull a stable item for a given night, so a night always reads the same. */
export function pick(list, night, salt = 0) {
  if (!list || !list.length) return '';
  const i = Math.abs(Math.round(night * 2654435761 + salt * 40503)) % list.length;
  return list[i];
}
