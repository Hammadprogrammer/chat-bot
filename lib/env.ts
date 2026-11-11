import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  OPENAI_API_KEY: z.string().optional(),
  /** Any OpenAI-compatible endpoint, e.g. Gemini: https://generativelanguage.googleapis.com/v1beta/openai/ */
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  /** Comma-separated models to try (in order) when the primary times out / is overloaded. */
  OPENAI_CHAT_FALLBACK_MODELS: z.string().default(""),
  /** Optional separate provider for chat (e.g. Groq); falls back to OPENAI_*. */
  CHAT_API_KEY: z.string().optional(),
  /** Extra chat keys (comma-separated, e.g. from additional Groq accounts); rotated when one is rate-limited. */
  CHAT_API_KEYS: z.string().default(""),
  CHAT_BASE_URL: z.string().optional(),
  /** Optional separate provider for embeddings (e.g. Cloudflare Workers AI); falls back to OPENAI_*. */
  EMBEDDINGS_API_KEY: z.string().optional(),
  /** Extra embeddings keys (comma-separated); rotated when one is rate-limited / out of quota. */
  EMBEDDINGS_API_KEYS: z.string().default(""),
  EMBEDDINGS_BASE_URL: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ALLOW_SIGNUP: z.enum(["true", "false"]).default("false"),
  APP_URL: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Public base URL of this deployment (used in embed snippets). */
export function appUrl() {
  const e = env();
  if (e.APP_URL) return e.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
