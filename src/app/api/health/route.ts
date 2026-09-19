import { json } from "@/lib/api";
import { getStore } from "@/lib/store";
import { embeddingsConfigured } from "@/lib/embedding";
import { passwordConfigured, passwordSource } from "@/lib/password";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const HASH_SHAPE = /^scrypt:\d+:\d+:\d+:[0-9a-f]{32}:[0-9a-f]{64}$/;

/**
 * What is currently available, and what the fallback is when it is not.
 * Every "false" here is a degraded path, not a broken one.
 *
 * The `auth` block exists to answer one question from outside the host: does
 * this server actually see the configuration you think you gave it? It
 * reports presence, shape and length - never a value, and never anything a
 * stranger could not already learn by posting to the sign-in endpoint.
 */
export async function GET() {
  const hash = env.authPasswordHash;
  const auth = {
    password: (await passwordConfigured()) ? "set" : "MISSING",
    readFrom: await passwordSource(),
    // A hash that arrived mangled - by shell quoting, a truncated paste, or
    // $-expansion somewhere in the deployment chain - is the failure that
    // otherwise looks exactly like "wrong password" forever.
    hashWellFormed: hash ? HASH_SHAPE.test(hash) : null,
    hashLength: hash.length || 0,
    authSecret: (process.env.AUTH_SECRET ?? "").trim() ? "set" : "MISSING",
    appOrigin: env.appOrigin,
  };

  let backend = "unavailable";
  let entries = -1;
  try {
    const store = await getStore();
    backend = store.backend;
    entries = await store.entries.count({ deletedAt: null });
  } catch (err) {
    return json(
      {
        ok: false,
        auth,
        storage: (err as Error).message,
        capture: "queued in the browser until storage returns",
      },
      503,
    );
  }

  return json({
    ok: true,
    auth,
    storage: {
      backend,
      entries,
      // On most hosts the file backend is ephemeral: entries written there
      // disappear on the next deploy. Worth saying out loud.
      warning:
        backend === "file" && process.env.NODE_ENV === "production"
          ? "MONGODB_URI is not set, so entries are being written to local files. On a hosted platform those are lost on redeploy."
          : undefined,
    },
    search: env.atlasSearchIndex && backend === "mongo" ? "atlas, falling back to lexical" : "lexical scan",
    relatedness: embeddingsConfigured()
      ? env.atlasVectorIndex
        ? "vectors via atlas, falling back to tf-idf"
        : "vectors computed in process, falling back to tf-idf"
      : "tf-idf",
    suggestions: env.openaiKey ? `model available (${env.suggestModel})` : "extractive (verbatim opening words)",
    export: "always available",
  });
}
