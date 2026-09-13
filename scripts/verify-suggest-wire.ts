/**
 * Exercises the OpenAI suggestion path without spending anything, by pointing
 * the SDK at a local server that speaks the Responses API.
 *
 * It proves four things that matter and cannot be read off the source:
 *   - the request we send is the right shape (structured outputs, strict schema)
 *   - a well-formed reply parses and reaches the author
 *   - a model that overreaches is caught by the guardrails on the real path,
 *     not just in the unit tests
 *   - a refusal, a truncated reply and an API error all degrade to something
 *     honest instead of breaking
 *
 *   npm run verify:suggest
 */

import http from "node:http";
import { check, eq, info, section, summary, useScratchStore } from "./lib/harness";
import { CHARGED } from "./lib/fixtures";

const dir = useScratchStore("suggest-wire");
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
process.env.SUGGEST_MODEL = "gpt-5";

// --- a stand-in for api.openai.com ---------------------------------------
type Mode = "ok" | "overreach" | "refusal" | "incomplete" | "error" | "malformed";
let mode: Mode = "ok";
let lastRequest: any = null;
let requestCount = 0;

function messageResponse(text: string, status = "completed", incomplete?: string) {
  return {
    id: "resp_test",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: "gpt-5",
    error: null,
    incomplete_details: incomplete ? { reason: incomplete } : null,
    instructions: null,
    metadata: {},
    output: [
      {
        type: "message",
        id: "msg_test",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    parallel_tool_calls: false,
    tool_choice: "auto",
    tools: [],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  };
}

function refusalResponse(why: string) {
  const body = messageResponse("");
  body.output[0].content = [{ type: "refusal", refusal: why } as never];
  return body;
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    requestCount++;
    lastRequest = { path: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(raw || "{}") };
    const ids: string[] = (lastRequest.body.input.match(/<entry id="([0-9a-f]{24})">/g) ?? []).map((m: string) =>
      m.slice(11, 35),
    );

    if (mode === "error") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "the model is on fire", type: "server_error" } }));
      return;
    }

    let payload: unknown;
    if (mode === "refusal") {
      payload = refusalResponse("I can't help with that.");
    } else if (mode === "incomplete") {
      payload = messageResponse('{"proposals":[', "incomplete", "max_output_tokens");
    } else if (mode === "malformed") {
      payload = messageResponse('{"proposals":[{"entryId":"nope","title":42}]}');
    } else if (mode === "overreach") {
      // A model doing exactly what the brief forbids, plus a year the entry
      // never names, a cluster that does not exist, and the word "none" where
      // a null was asked for. Every value here is schema-valid, so this is
      // what real structured outputs can actually hand back.
      payload = messageResponse(
        JSON.stringify({
          proposals: [
            { entryId: ids[0], title: "My Family Never Understood Me", kind: "feeling", clusterId: null, whenHappened: 2014 },
            { entryId: ids[1], title: "My Father's Broken Promises", kind: "story", clusterId: "deadbeefdeadbeefdeadbeef", whenHappened: 1994 },
            { entryId: ids[2], title: "none", kind: null, clusterId: null, whenHappened: 0 },
          ],
        }),
      );
    } else {
      payload = messageResponse(
        JSON.stringify({
          proposals: ids.map((id, i) => ({
            entryId: id,
            title: i === 0 ? "I sometimes feel invisible at home" : null,
            kind: i === 0 ? "feeling" : null,
            clusterId: null,
            whenHappened: i === 1 ? 1994 : null,
          })),
        }),
      );
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
info(`stub OpenAI listening on ${process.env.OPENAI_BASE_URL}`);

const fs = await import("node:fs");
const { captureEntry } = await import("../src/lib/entries");
const { getStore, resetStore } = await import("../src/lib/store");
const { createCluster } = await import("../src/lib/clusters");
const { suggestForEntries } = await import("../src/lib/suggest");

const store = await getStore();
const cluster = await createCluster({ name: "Family" });
const ids: string[] = [];
for (const body of CHARGED.slice(0, 3)) {
  const entry = await captureEntry({ body });
  ids.push(entry._id);
}

// ---------------------------------------------------------------------------
section("The request we send");

mode = "ok";
const good = await suggestForEntries(ids);
eq("the model path was used", good.engine, "model");
eq("it posted to /v1/responses", lastRequest.path, "/v1/responses");
eq("with the configured model", lastRequest.body.model, "gpt-5");
check("the API key is sent as a bearer token", (lastRequest.auth ?? "").startsWith("Bearer sk-test"));
check("the guardrail prompt is sent as instructions", lastRequest.body.instructions.includes("VERBATIM"));
check("the prompt carries the worked example", lastRequest.body.instructions.includes("My Family Never Understood Me"));
check("the entries are sent with their ids", ids.every((id) => lastRequest.body.input.includes(id)));
check("existing clusters are offered by id", lastRequest.body.input.includes(cluster._id));
eq("structured outputs are requested", lastRequest.body.text.format.type, "json_schema");
eq("the schema is strict", lastRequest.body.text.format.strict, true);
const schema = lastRequest.body.text.format.schema;
check("the schema is closed", schema.additionalProperties === false);
check("the schema names the nine kinds", JSON.stringify(schema).includes("lesson"));
check("no entry body is sent anywhere but the input", !JSON.stringify(lastRequest.body.text).includes("invisible"));

section("A well-formed reply");
eq("one proposal per entry", good.proposals.length, 3);
const first = good.proposals.find((p) => p.entryId === ids[0])!;
eq("the verbatim title is kept", first.title, "I sometimes feel invisible at home");
eq("the category is kept", first.kind, "feeling");
const second = good.proposals.find((p) => p.entryId === ids[1])!;
eq("a year named in the entry is kept", second.whenHappened, 1994);
eq("nothing was discarded", good.rejected.length, 0);
const unchanged = await store.entries.find({ _id: { $in: ids } });
check("nothing was written to the database", unchanged.every((e) => e.title === "" && e.clusterId === null));

// ---------------------------------------------------------------------------
section("A model that overreaches, on the real path");

mode = "overreach";
const bad = await suggestForEntries(ids);
eq("the model path ran", bad.engine, "model");
const titles = bad.proposals.map((p) => p.title);
check('"My Family Never Understood Me" never reaches the author', !titles.includes("My Family Never Understood Me"));
check('"My Father\'s Broken Promises" never reaches the author', !titles.includes("My Father's Broken Promises"));
eq("both interpretive titles were discarded", bad.rejected.filter((r) => r.field === "title").length, 2);
for (const r of bad.rejected) info(`discarded ${r.field} "${r.proposed}" - ${r.reason}`);
check(
  "a year the entry does not name is discarded",
  bad.rejected.some((r) => r.field === "whenHappened" && r.proposed === "2014"),
);
check(
  "a cluster that does not exist is discarded",
  bad.rejected.some((r) => r.field === "cluster"),
);
const sentinel = bad.proposals.find((p) => p.entryId === ids[2])!;
check(
  'the word "none" is read as nothing proposed, not as a bad value',
  sentinel.title === null && sentinel.whenHappened === null,
);
check(
  "no rejection noise from the sentinels",
  !bad.rejected.some((r) => r.proposed.toLowerCase() === "none"),
);
const stillUnchanged = await store.entries.find({ _id: { $in: ids } });
check("still nothing written", stillUnchanged.every((e) => e.title === "" && e.clusterId === null));

// ---------------------------------------------------------------------------
section("Refusal, truncation and outage");

mode = "refusal";
const refused = await suggestForEntries(ids);
eq("every proposal is empty", refused.proposals.filter((p) => p.title === null).length, 3);
check("the author is told plainly", refused.notes.some((n) => /declined/.test(n)));
check("and told the entries are untouched", refused.notes.some((n) => /unchanged/.test(n)));

mode = "incomplete";
const cut = await suggestForEntries(ids);
check("a truncated reply proposes nothing", cut.proposals.every((p) => p.title === null));
check("and says why", cut.notes.some((n) => /cut off/.test(n) && /max_output_tokens/.test(n)));

mode = "malformed";
const malformed = await suggestForEntries(ids);
eq("a reply that does not fit the schema falls back too", malformed.engine, "extractive");
check(
  "and it is not blamed on the network",
  malformed.notes.some((n) => /could not read/.test(n)) && !malformed.notes.some((n) => /could not be reached/.test(n)),
);
info(malformed.notes[0]);

mode = "error";
requestCount = 0;
const broken = await suggestForEntries(ids);
eq("an API error falls back to the extractive path", broken.engine, "extractive");
check("the note names the failure", broken.notes.some((n) => /could not be reached/.test(n)));
check("titles still come back, as the author's own opening words", broken.proposals.some((p) => !!p.title));
const extractiveTitle = broken.proposals.find((p) => p.entryId === ids[0])!.title;
check(
  "and they are verbatim",
  !!extractiveTitle && CHARGED[0].includes(extractiveTitle),
  extractiveTitle ?? "none",
);
info(`the SDK retried ${requestCount - 1} time(s) before giving up`);

server.close();
await resetStore();
fs.rmSync(dir, { recursive: true, force: true });
summary();
