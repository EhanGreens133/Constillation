/** Environment access in one place, so every fallback path is visible. */

const str = (v: string | undefined, d = ""): string => (v && v.trim() ? v.trim() : d);

export const env = {
  get authSecret(): string {
    const s = str(process.env.AUTH_SECRET);
    if (s) return s;
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set in production");
    }
    return "dev-insecure-secret-do-not-use-in-production";
  },
  get appOrigin(): string {
    return str(process.env.APP_ORIGIN, "http://localhost:3000").replace(/\/$/, "");
  },
  get authorEmail(): string {
    return str(process.env.AUTHOR_EMAIL);
  },
  get magicLinkDelivery(): "console" | "webhook" {
    return str(process.env.MAGIC_LINK_DELIVERY, "console") === "webhook" ? "webhook" : "console";
  },
  get magicLinkWebhook(): string {
    return str(process.env.MAGIC_LINK_WEBHOOK);
  },

  get mongoUri(): string {
    return str(process.env.MONGODB_URI);
  },
  get mongoDb(): string {
    return str(process.env.MONGODB_DB, "constellation");
  },
  get atlasSearchIndex(): string {
    return str(process.env.ATLAS_SEARCH_INDEX);
  },
  get atlasVectorIndex(): string {
    return str(process.env.ATLAS_VECTOR_INDEX);
  },
  get dataDir(): string {
    return str(process.env.DATA_DIR, ".data");
  },

  get openaiKey(): string {
    return str(process.env.OPENAI_API_KEY);
  },
  /**
   * Any OpenAI model that supports structured outputs. If this names a model
   * that does not exist, the suggestion pass says so on screen and falls back
   * to the extractive path - it never fails a capture or a read.
   */
  get suggestModel(): string {
    return str(process.env.SUGGEST_MODEL, "gpt-5");
  },

  get embeddingProvider(): "voyage" | "openai" | "azure-openai" | "none" {
    const p = str(process.env.EMBEDDING_PROVIDER, "none");
    return p === "voyage" || p === "openai" || p === "azure-openai" ? p : "none";
  },
  /** Falls back to OPENAI_API_KEY, so one key covers both uses. */
  get embeddingKey(): string {
    const explicit = str(process.env.EMBEDDING_API_KEY);
    if (explicit) return explicit;
    return this.embeddingProvider === "openai" ? str(process.env.OPENAI_API_KEY) : "";
  },
  get embeddingModel(): string {
    return str(process.env.EMBEDDING_MODEL, "text-embedding-3-small");
  },
  get embeddingUrl(): string {
    return str(process.env.EMBEDDING_API_URL);
  },
  get embeddingDimensions(): number {
    const n = Number(str(process.env.EMBEDDING_DIMENSIONS, "1024"));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1024;
  },
};
