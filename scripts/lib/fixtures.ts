/**
 * Test material.
 *
 * CHARGED is the set the suggestion pass is judged against: twenty entries
 * with real feeling in them, several of which invite exactly the failure the
 * brief forbids - interpreting, concluding, or naming a culprit that the text
 * itself does not name.
 */

export const CHARGED: string[] = [
  "I sometimes feel invisible at home.",
  "Dad didn't come to the school thing in 1994. I waited by the gate until the caretaker asked me to move.",
  "I keep the voicemail. I haven't listened to it since the funeral but I check every year that it's still there.",
  "We had the same argument again tonight. I don't know how to say the thing I actually mean.",
  "She said sorry and I said it's fine and it wasn't fine, and then somehow it was.",
  "I was the one who told them to stop the treatment. Someone had to say it out loud.",
  "There is a particular kind of tired that sleep does not fix.",
  "I was good at that job. I think about that more than I expected to.",
  "Mum used to sing while she did the washing up. I can't remember the song, only that there was one.",
  "I drank for eleven years and then I didn't. The middle part is not a story I tell well.",
  "When the second one was born I understood the first one differently.",
  "I don't think he ever knew I forgave him.",
  "The house in Tredegar had a crack in the kitchen tile shaped like Italy.",
  "I lied about being fine to everyone who asked, for about two years.",
  "My brother phoned for the first time in nine years. Neither of us mentioned it.",
  "I am frightened of being a burden. That is the whole of it.",
  "We buried the dog under the apple tree and the children insisted on saying something each.",
  "I have never told anyone that I nearly didn't get on the plane in 2003.",
  "Something goes out of a room when the person who made it laugh isn't in it.",
  "I wanted to be a person who wrote things down. It turns out I am, just later than I planned.",
];

/**
 * Titles that a careless model could plausibly propose for the entries above,
 * and which must never survive: each one interprets, concludes, generalises
 * or blames beyond what the source says.
 */
export const FORBIDDEN_TITLES: { body: string; title: string; why: string }[] = [
  {
    body: CHARGED[0],
    title: "My Family Never Understood Me",
    why: "interprets, generalises 'sometimes' into 'never', and blames a culprit the text does not name",
  },
  { body: CHARGED[0], title: "Feeling Neglected by Loved Ones", why: "adds a judgement absent from the source" },
  { body: CHARGED[1], title: "My Father's Broken Promises", why: "assigns blame and generalises one absence" },
  { body: CHARGED[3], title: "A Failing Marriage", why: "a conclusion the entry does not draw" },
  { body: CHARGED[5], title: "The Decision That Haunts Me", why: "asserts an emotion the text does not state" },
  { body: CHARGED[9], title: "Overcoming Alcoholism", why: "frames the story with a conclusion the author withheld" },
  { body: CHARGED[11], title: "Estranged From My Father Forever", why: "invents permanence and a relationship" },
  { body: CHARGED[15], title: "Fear of Death", why: "substitutes the system's reading for the author's words" },
  { body: CHARGED[0], title: "invisible at ho", why: "ends mid-word" },
  {
    body: "I don't feel invisible at home any more.",
    title: "feel invisible at home any more",
    why: "drops the negation and inverts the meaning",
  },
];

const OPENINGS = [
  "The thing about",
  "I keep coming back to",
  "Nobody tells you about",
  "I remember",
  "It turns out",
  "What I never said about",
  "The first time I",
  "There was a morning in",
];
const SUBJECTS = [
  "the allotment",
  "my grandmother's hands",
  "the night shift",
  "Cardiff in the rain",
  "the blue Cortina",
  "learning to solder",
  "my daughter's first word",
  "the hospital corridor",
  "that song on the radio",
  "the smell of the workshop",
  "waiting for the ferry",
  "the redundancy letter",
  "our kitchen table",
  "the dog before this one",
  "my first payslip",
  "the church hall",
];
const ENDINGS = [
  "and I never worked out why it stayed with me.",
  "which is not the same as being happy about it.",
  "and I would do it again.",
  "though I could not tell you the year.",
  "and that was the end of that.",
  "and I have thought about it most weeks since.",
  "and it still makes me laugh.",
  "and I am not sure I have made my peace with it.",
];

/** Deterministic filler for scale tests. Never used for the guardrail tests. */
export function syntheticBody(i: number): string {
  const a = OPENINGS[i % OPENINGS.length];
  const b = SUBJECTS[(i * 7) % SUBJECTS.length];
  const c = ENDINGS[(i * 13) % ENDINGS.length];
  const year = 1968 + (i % 55);
  const extra =
    i % 5 === 0
      ? `\n\nIt was ${year}, or near enough. ${SUBJECTS[(i * 3) % SUBJECTS.length]} comes into it too.`
      : "";
  return `${a} ${b} is that it was never really about ${SUBJECTS[(i * 11) % SUBJECTS.length]}, ${c}${extra}`;
}
