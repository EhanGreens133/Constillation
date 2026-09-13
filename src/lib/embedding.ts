import { env } from "./env";

/**
 * Embeddings are computed at write time and only at write time.
 *
 * Nothing on a read path calls this file, and nothing in the export depends
 * on it. If the provider is unset, down, or removed from the internet in
 * 2031, capture, search, reading and export all keep working - relatedness
 * simply falls back to TF-IDF over the corpus.
 */

const TIMEOUT_MS = 15_000;
let warned = false;

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[embedding] ${message} Relatedness will fall back to TF-IDF.`);
}

export function embeddingsConfigured(): boolean {
  return env.embeddingProvider !== "none" && (!!env.embeddingKey || !!env.embeddingUrl);
}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function buildRequest(texts: string[]): ProviderRequest | null {
  const key = env.embeddingKey;
  switch (env.embeddingProvider) {
    case "voyage":
      return {
        url: env.embeddingUrl || "https://api.voyageai.com/v1/embeddings",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: { input: texts, model: env.embeddingModel, input_type: "document" },
      };
    case "openai":
      return {
        url: env.embeddingUrl || "https://api.openai.com/v1/embeddings",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: {
          input: texts,
          model: env.embeddingModel,
          // text-embedding-3-* can be asked for shorter vectors. Sending the
          // configured size keeps the Atlas vector index and the stored
          // vectors in agreement, which is the one thing that must not drift.
          ...(/^text-embedding-3/.test(env.embeddingModel) ? { dimensions: env.embeddingDimensions } : {}),
        },
      };
    case "azure-openai":
      if (!env.embeddingUrl) return null;
      return {
        url: env.embeddingUrl,
        headers: { "api-key": key, "content-type": "application/json" },
        body: { input: texts, dimensions: env.embeddingDimensions },
      };
    default:
      return null;
  }
}

/** Returns one vector per input, or null if embeddings are unavailable. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!embeddingsConfigured() || texts.length === 0) return null;
  const req = buildRequest(texts.map((t) => t.slice(0, 8000)));
  if (!req) {
    warnOnce("provider is configured but incomplete.");
    return null;
  }
  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      warnOnce(`provider returned ${res.status}.`);
      return null;
    }
    const json = (await res.json()) as { data?: { embedding: number[]; index?: number }[] };
    if (!json.data?.length) {
      warnOnce("provider returned no vectors.");
      return null;
    }
    const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((d) => d.embedding);
  } catch (err) {
    warnOnce(`provider unreachable (${(err as Error).message}).`);
    return null;
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  const vectors = await embedTexts([text]);
  return vectors?.[0] ?? null;
}

// --- write-time queue ------------------------------------------------------

interface Job {
  id: string;
  body: string;
  attempts: number;
}

const queue: Job[] = [];
let draining = false;

/**
 * Fire and forget. Called after a capture has already been persisted and the
 * response has been (or is about to be) returned. A save is never held up by
 * an embedding, and a failed embedding never fails a save.
 */
export function queueEmbedding(id: string, body: string): void {
  if (!embeddingsConfigured()) return;
  queue.push({ id, body, attempts: 0 });
  if (!draining) void drain();
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      const vector = await embedText(job.body);
      if (!vector) {
        if (job.attempts < 1) queue.push({ ...job, attempts: job.attempts + 1 });
        continue;
      }
      try {
        const { getStore } = await import("./store");
        const store = await getStore();
        await store.entries.update({ _id: job.id }, { $set: { embedding: vector } });
      } catch (err) {
        console.warn(`[embedding] could not store vector for ${job.id}: ${(err as Error).message}`);
      }
    }
  } finally {
    draining = false;
  }
}

/** Waits for the in-process queue to empty. For scripts and tests only. */
export async function waitForEmbeddings(): Promise<void> {
  while (draining || queue.length) await new Promise((r) => setTimeout(r, 50));
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
