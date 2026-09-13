"use client";

import { useEffect, useState } from "react";

/**
 * Handover.
 *
 * Naming custodians, getting each of them a dated copy, and confirming they
 * have opened it on their own device. Deliberately not a feature of the data
 * model: it is a checklist for the author, kept in this browser.
 *
 * There is no dead man's switch, and the page says why. An offline file
 * cannot know its author has died; a date check in client-side JavaScript is
 * trivially bypassed; anything server-based depends on a company still
 * existing. The honest alternative is stated instead.
 */

interface Custodian {
  name: string;
  relationship: string;
  contact: string;
  copyGivenOn: string;
  confirmedOpenedOn: string;
  editionDate: string;
}

interface HandoverState {
  primary: Custodian;
  backup: Custodian;
  notes: string;
}

const EMPTY: Custodian = {
  name: "",
  relationship: "",
  contact: "",
  copyGivenOn: "",
  confirmedOpenedOn: "",
  editionDate: "",
};

const KEY = "constellation.handover";

export default function HandoverPage() {
  const [state, setState] = useState<HandoverState>({ primary: { ...EMPTY }, backup: { ...EMPTY }, notes: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...JSON.parse(raw) });
    } catch {
      /* first run */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* nothing here is load-bearing */
    }
  }, [state, loaded]);

  function update(which: "primary" | "backup", field: keyof Custodian, value: string) {
    setState((s) => ({ ...s, [which]: { ...s[which], [field]: value } }));
  }

  const today = new Date().toISOString().slice(0, 10);

  const instructions = (c: Custodian) =>
    [
      `For ${c.name || "[name]"},`,
      "",
      "This folder is an archive of things I wrote down. It is yours now.",
      "",
      "To read it: double-click archive.html. It opens in any web browser. You do",
      "not need the internet, an account, or anything installed. The first thing you",
      "will see is a message from me.",
      "",
      "If that page ever stops working, open archive.txt instead. It is the same",
      "archive as plain text and will open in any text editor, on any computer.",
      "",
      "Please keep more than one copy: your computer, and something that is not your",
      "computer. There is no service behind this and nothing to renew - copies in",
      "different places are the only thing keeping it alive.",
      "",
      `Given to you on ${c.copyGivenOn || today}.`,
    ].join("\n");

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  const steps = (c: Custodian) => [
    { done: !!c.name.trim(), label: "Named" },
    { done: !!c.editionDate, label: "Dated inheritance edition downloaded for them" },
    { done: !!c.copyGivenOn, label: "Copy handed over" },
    { done: !!c.confirmedOpenedOn, label: "They opened it on their own device, and said so" },
  ];

  return (
    <main>
      <h1>Handover</h1>
      <p className="lede">
        An archive nobody can open is not an archive. Four steps, per person: name them, download a dated copy for
        them, give it to them, and confirm they have opened it themselves.
      </p>

      {(["primary", "backup"] as const).map((which) => {
        const c = state[which];
        const done = steps(c);
        return (
          <div className="card" key={which}>
            <div className="spread">
              <h2 style={{ margin: 0 }}>{which === "primary" ? "Primary custodian" : "Backup custodian"}</h2>
              <span className="badge">
                {done.filter((s) => s.done).length} of {done.length} done
              </span>
            </div>
            <p className="note">
              {which === "primary"
                ? "The person you would tell first."
                : "Someone who does not live in the same house, and would not be affected by the same flood, fire or fallout."}
            </p>

            <div className="row">
              <div className="field" style={{ flex: "1 1 12rem" }}>
                <span className="label">Name</span>
                <input type="text" value={c.name} onChange={(e) => update(which, "name", e.target.value)} />
              </div>
              <div className="field" style={{ flex: "1 1 10rem" }}>
                <span className="label">Relationship</span>
                <input
                  type="text"
                  value={c.relationship}
                  onChange={(e) => update(which, "relationship", e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: "1 1 12rem" }}>
                <span className="label">How to reach them</span>
                <input type="text" value={c.contact} onChange={(e) => update(which, "contact", e.target.value)} />
              </div>
            </div>

            <ol className="stack" style={{ paddingLeft: "1.2rem" }}>
              <li>
                <b>Download a dated copy for them.</b>
                <div className="row" style={{ marginTop: "0.4rem" }}>
                  <a
                    className="btn"
                    href="/api/export?edition=inheritance&format=zip"
                    onClick={() => update(which, "editionDate", today)}
                  >
                    Download inheritance edition
                  </a>
                  <input
                    type="date"
                    value={c.editionDate}
                    onChange={(e) => update(which, "editionDate", e.target.value)}
                    style={{ width: "auto" }}
                  />
                </div>
              </li>
              <li>
                <b>Give it to them</b> — on a USB stick, or however you like.
                <div className="row" style={{ marginTop: "0.4rem" }}>
                  <input
                    type="date"
                    value={c.copyGivenOn}
                    onChange={(e) => update(which, "copyGivenOn", e.target.value)}
                    style={{ width: "auto" }}
                  />
                  <button className="small" onClick={() => copy(instructions(c))}>
                    Copy the note to include
                  </button>
                </div>
              </li>
              <li>
                <b>Confirm they opened it on their own device.</b> Not that they received it — that they double-clicked
                archive.html, saw your opening message, and found something.
                <div className="row" style={{ marginTop: "0.4rem" }}>
                  <input
                    type="date"
                    value={c.confirmedOpenedOn}
                    onChange={(e) => update(which, "confirmedOpenedOn", e.target.value)}
                    style={{ width: "auto" }}
                  />
                  {c.confirmedOpenedOn && <span className="badge ok">confirmed</span>}
                </div>
              </li>
            </ol>

            <details style={{ marginTop: "0.6rem" }}>
              <summary className="note">The note to give them</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.88rem",
                  background: "var(--bg-soft)",
                  padding: "0.9rem",
                  borderRadius: "var(--radius)",
                }}
              >
                {instructions(c)}
              </pre>
            </details>
          </div>
        );
      })}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Anything else they should know</h2>
        <textarea
          rows={4}
          value={state.notes}
          onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Where the other copies are. Who else has one. Anything you would want said out loud."
        />
        <p className="note">
          Kept in this browser only, on this device. It is a checklist for you, not part of the archive — nothing here
          appears in any export.
        </p>
      </div>

      <h2>About timed release, and why there isn&apos;t any</h2>
      <p className="prose note">
        There is no dead man&apos;s switch here, and there will not be one. An offline file cannot know whether its
        author has died. A date check in client-side JavaScript is bypassed by opening the developer tools, or by
        changing the system clock. Anything enforced by a server depends on a company still existing, still being
        paid, and still being able to run that code — which is precisely the failure this archive is built to avoid.
      </p>
      <p className="prose note">
        If something genuinely must stay sealed for a while, the honest answer is an encrypted copy whose key is held
        by a named person, under written instructions from you. You should know exactly what that means: it depends
        entirely on that person&apos;s judgement, memory and goodwill. They can open it early, or lose the key and
        make it unreadable forever. Choose the person accordingly, and tell them plainly what you are asking of them.
      </p>
      <p className="prose note">
        For everything that does not need sealing, the strongest thing you can do is the ordinary thing: give people
        the file now, and make sure they have opened it.
      </p>
    </main>
  );
}
