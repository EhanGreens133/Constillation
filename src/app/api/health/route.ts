import { json } from "@/lib/api";
import { getStore } from "@/lib/store";
import { embeddingsConfigured } from "@/lib/embedding";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * What is currently available, and what the fallback is when it is not.
 * Every "false" here is a degraded path, not a broken one.
 */
export async function GET() {
  let backend = "unavailable";
  let entries = -1;
  try {
    const store = await getStore();
    backend = store.backend;
    entries = await store.entries.count({ deletedAt: null });
  } catch (err) {
    return json(
      { ok: false, storage: (err as Error).message, capture: "queued in the browser until storage returns" },
      503,
    );
  }
  return json({
    ok: true,
    storage: { backend, entries },
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
