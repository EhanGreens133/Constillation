"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sign in.
 *
 * One account, one password box. The magic-link flow still exists behind
 * "Trouble signing in?" - it needs terminal access to the server, which makes
 * it a way back in that cannot be locked out or forgotten.
 */
const setupBox: React.CSSProperties = {
  background: "var(--bg-soft)",
  padding: "0.7rem 0.9rem",
  borderRadius: "var(--radius)",
  fontSize: "0.9rem",
  margin: "0 0 0.6rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "signing" | "linkSent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isLocal, setIsLocal] = useState(true);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    // Decides which recovery instructions make sense: a terminal command only
    // helps someone sitting at the machine running this.
    setIsLocal(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname));
  }, []);

  async function signIn(ev: React.FormEvent) {
    ev.preventDefault();
    if (!password) return;
    setState("signing");
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      // A proxy error or an HTML error page is not JSON. Parsing it before
      // checking res.ok would show the author a SyntaxError instead of what
      // actually went wrong.
      const raw = await res.text();
      let body: { ok?: boolean; error?: string; code?: string } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        body = {};
      }
      if (!res.ok) {
        if (body.code === "no_password") setNeedsSetup(true);
        throw new Error(body.error ?? `Sign-in failed (${res.status} ${res.statusText || "error"}).`);
      }
      // Full navigation, so the session cookie is on the very first request.
      // "/" unless the redirect target is a plain same-site path: "//evil.com"
      // starts with a slash but is another origin.
      const next = new URLSearchParams(window.location.search).get("next");
      const safe = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
      window.location.href = safe;
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
      setPassword("");
      field.current?.focus();
    }
  }

  async function requestLink() {
    setError(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "could not generate a link");
      setDevUrl(body.url ?? null);
      setState("linkSent");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main style={{ maxWidth: "26rem", margin: "12vh auto 0" }}>
      <h1>Constellation</h1>
      <p className="lede">Your archive. One account, yours.</p>

      <form className="card" onSubmit={signIn}>
        <div className="field">
          <span className="label">Password</span>
          <input
            ref={field}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <button className="primary" type="submit" disabled={state === "signing" || !password}>
          {state === "signing" ? "Signing in…" : "Sign in"}
        </button>

        {error && <p className="err">{error}</p>}

        {needsSetup && (
          <>
            {isLocal ? (
              <>
                <p className="note" style={{ marginTop: "1rem" }}>
                  Set one now — run this in the project folder, then come back:
                </p>
                <pre style={setupBox}>npm run set-password</pre>
              </>
            ) : (
              <>
                {/* A deployed host has no project folder to run npm in. Its
                    configuration is the only way in, and .env.local never
                    leaves the machine it was written on. */}
                <p className="note" style={{ marginTop: "1rem" }}>
                  This server is configured by its environment, not by a file in the repository —{" "}
                  <code>.env.local</code> is never deployed. Add this variable in your host&apos;s settings and
                  redeploy:
                </p>
                <pre style={setupBox}>AUTH_PASSWORD_HASH=…</pre>
                <p className="note">
                  On the machine where you set the password, <code>npm run env:deploy</code> prints the value to paste,
                  along with everything else this server needs.
                </p>
              </>
            )}
          </>
        )}
      </form>

      <p className="note" style={{ marginTop: "1.2rem" }}>
        <button type="button" className="ghost" onClick={() => setShowHelp(!showHelp)}>
          Trouble signing in?
        </button>
      </p>

      {showHelp && (
        <div className="card">
          <p style={{ marginTop: 0 }} className="note">
            {isLocal
              ? "You can always get in from the machine running this, without the password:"
              : "From a terminal on the machine running this server:"}
          </p>
          <pre style={setupBox}>npm run login</pre>
          <p className="note">
            It prints a link that signs you in. To change the password: <code>npm run set-password</code>
            {isLocal ? "." : ", then update AUTH_PASSWORD_HASH in this host's settings and redeploy."}
          </p>
          <button type="button" onClick={() => void requestLink()}>
            Or generate one now
          </button>
          {state === "linkSent" && (
            <p className="note" style={{ marginTop: "0.8rem" }}>
              {devUrl ? (
                <a href={devUrl} style={{ wordBreak: "break-all" }}>
                  Sign in on this device
                </a>
              ) : (
                <>
                  Generated. It is in the server console and in <code>.data/magic-link.txt</code>.
                </>
              )}
            </p>
          )}
        </div>
      )}

      <p className="note" style={{ marginTop: "1.6rem" }}>
        The archive itself does not depend on any of this. Exported copies open with no account and no server.
      </p>
    </main>
  );
}
