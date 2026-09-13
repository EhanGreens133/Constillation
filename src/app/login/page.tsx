"use client";

import { useState } from "react";

/**
 * One account, one sign-in method. A link is generated and delivered wherever
 * the author configured it - by default to the server's own console and
 * .data/magic-link.txt, which is enough for a self-hosted single-user box and
 * depends on no third party staying in business.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestLink(ev: React.FormEvent) {
    ev.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { ok?: boolean; url?: string; delivered?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setDevUrl(body.url ?? null);
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  return (
    <main style={{ maxWidth: "28rem", margin: "12vh auto 0" }}>
      <h1>Constellation</h1>
      <p className="lede">Your archive. One account, yours.</p>

      {state === "sent" ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>A sign-in link has been generated. It is valid for 15 minutes.</p>
          <p className="note">
            Depending on how you configured delivery, it is in the server log, in <code>.data/magic-link.txt</code>, or
            it has been posted to your webhook.
          </p>
          {devUrl && (
            <p style={{ wordBreak: "break-all" }}>
              <a href={devUrl}>Sign in on this device</a>
            </p>
          )}
          <button onClick={() => setState("idle")}>Request another</button>
        </div>
      ) : (
        <form className="card" onSubmit={requestLink}>
          <div className="field">
            <span className="label">Email (optional, only used to check it is you)</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button className="primary" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Generating…" : "Send me a sign-in link"}
          </button>
          {error && <p className="err">{error}</p>}
        </form>
      )}

      <p className="note" style={{ marginTop: "1.6rem" }}>
        The archive itself does not depend on this. Exported copies open with no account and no server.
      </p>
    </main>
  );
}
