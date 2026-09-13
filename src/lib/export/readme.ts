import type { ArchiveBundle } from "./build";

/**
 * README.txt - written for a non-technical reader who has just been handed
 * this folder and has no idea what to do with it. Plain language, no jargon,
 * and an honest statement of which file is the one that will outlive the rest.
 */
export function renderReadme(bundle: ArchiveBundle): string {
  const title = bundle.archive.title.trim() || "this archive";
  const authorLine = bundle.archive.title.trim()
    ? `This is ${bundle.archive.title.trim()}.`
    : "This is a personal archive.";

  const lines = [
    "WHAT THIS IS",
    "============",
    "",
    authorLine,
    "",
    "It is a collection of things one person wrote down over the course of their",
    "life: thoughts, stories, feelings, things they loved, people and places that",
    "mattered, songs, quotes they kept, and lessons they drew. There are",
    `${bundle.counts.entries} entries in this copy.`,
    "",
    "It was put together by the author themselves, for you to read.",
    "",
    "",
    "HOW TO OPEN IT",
    "==============",
    "",
    "Double-click the file called:",
    "",
    "    archive.html",
    "",
    "It opens in any web browser - Chrome, Safari, Edge, Firefox, anything. You do",
    "not need an internet connection. You do not need an account, a password or a",
    "program to install. Nothing is sent anywhere, and nothing you do while",
    "reading is recorded.",
    "",
    "The first thing you will see is a message from the author. After that you can",
    "read the entries in order, search for a name or a word, look at the",
    "collections they grouped things into, or explore a map where entries that",
    "share words sit near each other.",
    "",
    "",
    "IF THAT PAGE EVER STOPS WORKING",
    "===============================",
    "",
    "Open this instead:",
    "",
    "    archive.txt",
    "",
    "It is the same archive written as plain text. It will open in any text editor,",
    "on any computer, for as long as computers read text - which is to say, longer",
    "than any web page can be relied upon. If you only ever keep one file from this",
    "folder, keep that one.",
    "",
    "There is also:",
    "",
    "    archive.json   - the same content in a structured form, for anyone who",
    "                     wants to move it into another program later. The file",
    "                     documents its own fields.",
  ];

  if (bundle.openingAudio) {
    lines.push(
      "",
      `    ${bundle.openingAudio.filename}`,
      "                   - a recording of the opening message. It also plays",
      "                     inside archive.html.",
    );
  }

  lines.push(
    "",
    "",
    "WHAT YOU ARE READING",
    "====================",
    "",
    "Every word of every entry was written by the author. Nothing was rewritten,",
    "shortened, summarised or tidied up by software.",
    "",
    "Some entries have no title. That is normal and deliberate: most writing is not",
    "given a title. Where an entry has no title, you will see its opening words in",
    "italics instead. Where a title or a category was suggested by software and the",
    "author chose to keep it, it is marked \"suggested\".",
    "",
    "Some entries are connected to others. Where it says the entries share words,",
    "that connection was found by a program comparing text - not by anyone deciding",
    "the two belong together. Two entries can sit side by side and mean completely",
    "different things.",
    "",
    "Entries can carry three different dates: the year the thing happened, the date",
    "it was written down, and the dates of any notes added later. They are kept",
    "separate on purpose. What someone believed at the time and what they made of",
    "it years later are both worth having, and they are not the same.",
    "",
    "You may find a chart of how many entries were written each year. It counts",
    "writing, not significance. Hard years produce a lot of writing; contented ones",
    "often produce none at all.",
    "",
  );

  if (bundle.edition === "inheritance") {
    lines.push(
      "This copy leaves out the entries the author marked private. That was their",
      "choice, made while they were alive.",
      "",
    );
  } else {
    lines.push(
      "WARNING: this is the author's own working copy. It includes entries they",
      "marked PRIVATE, which are not meant to be passed on. If you were given this",
      "copy by mistake, the one intended for family is the inheritance edition.",
      "",
    );
  }

  lines.push(
    "",
    "KEEPING IT",
    "==========",
    "",
    "This folder is the whole thing. Copy it wherever you like - a hard drive, a",
    "USB stick, a cloud folder, an email to yourself. There is no server behind it",
    "and nothing to renew or pay for. More copies in more places is the only",
    "maintenance it needs.",
    "",
    "",
    "TECHNICAL DETAILS",
    "=================",
    "",
    `Edition:      ${bundle.edition}`,
    `Built:        ${bundle.builtAt}`,
    `Entries:      ${bundle.counts.entries}`,
    `Later notes:  ${bundle.counts.reflections}`,
    `Collections:  ${bundle.clusters.length}`,
    `Untitled:     ${bundle.counts.entries - bundle.counts.withTitle}`,
    `Unfiled:      ${bundle.counts.unfiled}`,
    `Connections:  ${bundle.counts.connections}`,
  );
  if (bundle.edition === "inheritance" && bundle.counts.omittedPrivate > 0) {
    lines.push(`Private entries left out: ${bundle.counts.omittedPrivate}`);
  }
  lines.push(`Schema:       ${bundle.schema}`, `Generated by: ${bundle.generator}`);

  if (bundle.warnings.length) {
    lines.push("", "NOTES FROM THE EXPORT", "=====================", "");
    for (const w of bundle.warnings) lines.push(`- ${w}`);
  }

  lines.push("", `(${title})`, "");
  return lines.join("\n");
}
