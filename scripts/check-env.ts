/**
 * Checks the configuration, and checks that it actually works.
 *
 *   npm run check          presence, shape, and read-only connection probes
 *   npm run check -- --deep  also sends one 4-character embedding request
 *
 * Secrets are never printed: a key is reported by its prefix, length and
 * whether it works. Nothing here writes to the database, and nothing but
 * --deep costs anything.
 */

import { loadEnv } from "./lib/load-env";

const loaded = loadEnv();
const deep = process.argv.includes("--deep");

type Level = "ok" | "warn" | "blocked" | "info";
const MARK: Record<Level, string> = { ok: "  OK   ", warn: " WARN  ", blocked: "BLOCKED", info: "  --   " };

const rows: { level: Level; label: string; detail: string }[] = [];
function say(level: Level, label: string, detail: string): void {
  rows.push({ level, label, detail });
  console.log(`[${MARK[level]}] ${label.padEnd(26)} ${detail}`);
}
function section(name: string): void {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 62 - name.length))}`);
}

/** Never print a secret. Prefix and length are enough to tell keys apart. */
const fingerprint = (v: string): string => `${v.slice(0, 7)}…${v.slice(-4)} (${v.length} chars)`;

console.log(loaded.length ? `Loaded ${loaded.join(", ")}` : "No .env.local or .env found - using the ambient environment");

// ---------------------------------------------------------------------------
section("Required to run");

const secret = (process.env.AUTH_SECRET ?? "").trim();
const PLACEHOLDER = "change-me-to-32-plus-random-bytes";
if (!secret) {
  say("blocked", "AUTH_SECRET", "not set - the app refuses to start in production");
} else if (secret === PLACEHOLDER) {
  say(
    "blocked",
    "AUTH_SECRET",
    "still the placeholder from .env.example - anyone who has read this repo can mint a session",
  );
} else if (secret.length < 32) {
  say("warn", "AUTH_SECRET", `only ${secret.length} characters - use 32 or more`);
} else {
  say("ok", "AUTH_SECRET", `set, ${secret.length} characters`);
}

const origin = (process.env.APP_ORIGIN ?? "").trim();
if (!origin) say("warn", "APP_ORIGIN", "not set - sign-in links will point at http://localhost:3000");
else if (!/^https?:\/\//.test(origin)) say("blocked", "APP_ORIGIN", `"${origin}" is not a URL`);
else if (origin.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(origin)) {
  say("warn", "APP_ORIGIN", `${origin} is http - the session cookie will not be marked secure`);
} else say("ok", "APP_ORIGIN", origin);

const delivery = (process.env.MAGIC_LINK_DELIVERY ?? "console").trim();
if (delivery === "webhook" && !(process.env.MAGIC_LINK_WEBHOOK ?? "").trim()) {
  say("warn", "MAGIC_LINK_DELIVERY", "set to webhook but MAGIC_LINK_WEBHOOK is empty - falls back to the console");
} else {
  say("ok", "MAGIC_LINK_DELIVERY", delivery === "webhook" ? "webhook" : "console and .data/magic-link.txt");
}

const authorEmail = (process.env.AUTHOR_EMAIL ?? "").trim();
say(
  authorEmail ? "ok" : "info",
  "AUTHOR_EMAIL",
  authorEmail
    ? `${authorEmail} - only this address may request a link`
    : "blank - any address may request a link (the link still only goes to your console)",
);

// ---------------------------------------------------------------------------
section("Storage");

const uri = (process.env.MONGODB_URI ?? "").trim();
const dbName = (process.env.MONGODB_DB ?? "constellation").trim();

if (!uri) {
  say("info", "MONGODB_URI", `not set - entries go to ${process.env.DATA_DIR ?? ".data"}/ as JSON (fine for one machine)`);
} else {
  const redacted = uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
  say("ok", "MONGODB_URI", redacted);
  say("ok", "MONGODB_DB", dbName);
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12_000 });
    const t0 = Date.now();
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    say("ok", "Atlas connection", `reachable in ${Date.now() - t0}ms`);

    const entries = db.collection("entries");
    const collections = await db.listCollections({ name: "entries" }).toArray();
    const exists = collections.length > 0;
    const count = exists ? await entries.estimatedDocumentCount() : 0;

    if (!exists) {
      // A brand new database. Not a problem - the collection appears on the
      // first write, and `npm run indexes` creates it along with the indexes.
      say("ok", "entries collection", "not created yet - a fresh database, which is what you want");
      say("warn", "indexes", "nothing to inspect until `npm run indexes` has run once");
    } else {
      say("ok", "entries collection", count === 0 ? "empty and ready" : `${count} documents already present`);
      const indexes = await entries.indexes();
      const named = indexes.map((i) => i.name).filter(Boolean) as string[];
      const wanted = ["cluster_when", "private", "deleted", "when_written"];
      const missing = wanted.filter((w) => !named.includes(w));
      if (missing.length === wanted.length) {
        say("warn", "ordinary indexes", "none created yet - run `npm run indexes`");
      } else if (missing.length) {
        say("warn", "ordinary indexes", `missing ${missing.join(", ")} - run \`npm run indexes\``);
      } else {
        say("ok", "ordinary indexes", named.filter((n) => n !== "_id_").join(", "));
      }
    }

    // Atlas Search and Vector indexes are a separate namespace from the above.
    const searchName = (process.env.ATLAS_SEARCH_INDEX ?? "").trim();
    const vectorName = (process.env.ATLAS_VECTOR_INDEX ?? "").trim();
    try {
      const search = exists ? await entries.listSearchIndexes().toArray() : [];
      const byName = new Map(search.map((s: any) => [s.name, s]));
      for (const [label, name, kind] of [
        ["ATLAS_SEARCH_INDEX", searchName, "search"],
        ["ATLAS_VECTOR_INDEX", vectorName, "vectorSearch"],
      ] as const) {
        if (!name) {
          say("info", label, "blank - that path stays on its fallback");
          continue;
        }
        const found: any = byName.get(name);
        if (!found) {
          say("warn", label, `"${name}" does not exist yet - run \`npm run indexes\` (fallback works meanwhile)`);
        } else if (found.status !== "READY") {
          say("warn", label, `"${name}" exists but is ${found.status}`);
        } else {
          let extra = "";
          if (kind === "vectorSearch") {
            const dims = found.latestDefinition?.fields?.find((f: any) => f.type === "vector")?.numDimensions;
            const configured = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);
            extra =
              dims === undefined
                ? ""
                : dims === configured
                  ? `, ${dims} dimensions matching EMBEDDING_DIMENSIONS`
                  : ` - MISMATCH: index is ${dims}, EMBEDDING_DIMENSIONS is ${configured}`;
            if (dims !== undefined && dims !== configured) {
              say("blocked", label, `"${name}" ready but${extra}`);
              continue;
            }
          }
          say("ok", label, `"${name}" READY${extra}`);
        }
      }
    } catch (err) {
      say("info", "Atlas Search indexes", `could not be listed (${(err as Error).message.slice(0, 60)}) - fallbacks apply`);
    }

    await client.close();
  } catch (err) {
    const message = (err as Error).message;
    const hint = /authentication failed/i.test(message)
      ? " - check the username and password in the URI"
      : /ENOTFOUND|querySrv/i.test(message)
        ? " - hostname did not resolve"
        : /timed out|ServerSelection/i.test(message)
          ? " - check Atlas Network Access allows this machine's IP"
          : "";
    say("blocked", "Atlas connection", `${message.split("\n")[0].slice(0, 90)}${hint}`);
  }
}

// ---------------------------------------------------------------------------
section("OpenAI (both uses are optional)");

const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const suggestModel = (process.env.SUGGEST_MODEL ?? "gpt-5").trim();
const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? "none").trim();
const embeddingModel = (process.env.EMBEDDING_MODEL ?? "text-embedding-3-small").trim();
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);

if (!openaiKey) {
  say("info", "OPENAI_API_KEY", "not set - suggestions stay extractive, relatedness stays TF-IDF");
} else {
  say("ok", "OPENAI_API_KEY", fingerprint(openaiKey));
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: openaiKey, timeout: 30_000, maxRetries: 1 });
    const t0 = Date.now();
    const models = await client.models.list();
    const ids = new Set<string>();
    for await (const m of models) ids.add(m.id);
    say("ok", "OpenAI key", `valid, ${ids.size} models available (${Date.now() - t0}ms)`);

    if (ids.has(suggestModel)) {
      say("ok", "SUGGEST_MODEL", `"${suggestModel}" is available on this account`);
    } else {
      const alternatives = [...ids]
        .filter((id) => /^(gpt-5|gpt-4\.1|o4)/.test(id) && !/audio|realtime|transcribe|tts|image/.test(id))
        .sort()
        .slice(0, 6);
      say(
        "blocked",
        "SUGGEST_MODEL",
        `"${suggestModel}" is NOT available on this account. Try one of: ${alternatives.join(", ") || "(none matched)"}`,
      );
    }

    if (embeddingProvider === "openai") {
      if (ids.has(embeddingModel)) {
        say("ok", "EMBEDDING_MODEL", `"${embeddingModel}" is available`);
      } else {
        say("blocked", "EMBEDDING_MODEL", `"${embeddingModel}" is NOT available on this account`);
      }
      const native = embeddingModel === "text-embedding-3-large" ? 3072 : 1536;
      if (dimensions > native) {
        say("blocked", "EMBEDDING_DIMENSIONS", `${dimensions} exceeds ${embeddingModel}'s native ${native}`);
      } else {
        say("ok", "EMBEDDING_DIMENSIONS", `${dimensions}${dimensions === native ? " (native)" : ` (shortened from ${native})`}`);
      }

      if (deep) {
        // One request, four characters of input. Costs a rounding error, and
        // proves the model, the key and the dimension setting agree.
        const probe = await client.embeddings.create({
          model: embeddingModel,
          input: "test",
          dimensions,
        });
        const got = probe.data[0].embedding.length;
        if (got === dimensions) say("ok", "embedding request", `returned a ${got}-dimension vector`);
        else say("blocked", "embedding request", `asked for ${dimensions} dimensions, got ${got}`);
      } else {
        say("info", "embedding request", "not sent - add --deep to send one 4-character test request");
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    const hint = /401|invalid_api_key|Incorrect API key/i.test(message)
      ? " - the key was rejected"
      : /429|quota/i.test(message)
        ? " - rate limited or out of quota"
        : "";
    say("blocked", "OpenAI key", `${message.split("\n")[0].slice(0, 90)}${hint}`);
  }
}

if (embeddingProvider === "none") {
  say("info", "EMBEDDING_PROVIDER", "none - relatedness uses TF-IDF");
} else if (embeddingProvider === "openai" && !openaiKey && !(process.env.EMBEDDING_API_KEY ?? "").trim()) {
  say("warn", "EMBEDDING_PROVIDER", "openai, but no key is set - relatedness falls back to TF-IDF");
} else if (embeddingProvider === "azure-openai" && !(process.env.EMBEDDING_API_URL ?? "").trim()) {
  say("blocked", "EMBEDDING_PROVIDER", "azure-openai needs EMBEDDING_API_URL");
}

// ---------------------------------------------------------------------------
section("Verdict");

const blocked = rows.filter((r) => r.level === "blocked");
const warned = rows.filter((r) => r.level === "warn");

if (blocked.length === 0) {
  console.log("\nGood to go.\n");
  console.log("  npm run indexes        create the Atlas indexes (safe to re-run)");
  console.log("  npm run dev            then sign in at /login - the link is in the server console");
} else {
  console.log(`\n${blocked.length} thing${blocked.length === 1 ? "" : "s"} to fix before this will work properly:\n`);
  for (const b of blocked) console.log(`  - ${b.label}: ${b.detail}`);
}
if (warned.length) {
  console.log(`\n${warned.length} worth knowing about:\n`);
  for (const w of warned) console.log(`  - ${w.label}: ${w.detail}`);
}
console.log("");
process.exit(blocked.length ? 1 : 0);
