# Multi-Website AI Chatbot SaaS

Create AI chatbots trained on your own content and embed them on any website with a single `<script>` tag. Each chatbot has an isolated knowledge base, its own branding, prompt, authorized domains and usage tracking.

**Stack:** Next.js 16 (App Router) · TypeScript · Neon PostgreSQL + pgvector · Prisma · OpenAI · Tailwind CSS · Vercel.

## Features

- **Admin dashboard** with email/password auth (bcrypt, signed httpOnly session cookie, route guard in `proxy.ts`). The admin account is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; optional self sign-up via `ALLOW_SIGNUP`.
- **Multiple chatbots per account**, each with a unique public key and strictly isolated knowledge base, conversations and settings.
- **Knowledge sources:** website crawling (same-domain, sitemap-aware, SSRF-protected), single URLs, PDF / DOCX / TXT / Markdown / CSV / HTML / JSON uploads, manual FAQs (editable), pasted text and GitHub repository import (Markdown/docs files).
- **Pipeline:** automatic text extraction → paragraph/sentence-aware chunking with overlap → OpenAI embeddings → pgvector (HNSW, cosine). Long crawls run in time-boxed batches that resume across serverless invocations.
- **RAG answers** grounded only in the chatbot's own chunks, with citations, conversation memory, configurable model/temperature/system prompt, similarity cutoff and context size.
- **Fallback & human handoff:** when nothing relevant is found the bot shows the fallback message plus a support form / support link; requests are stored and manageable in the dashboard.
- **Embeddable widget** (`public/widget.js`): shadow-DOM isolated, mobile responsive, branded colors/position/avatar/launcher text, markdown rendering, persisted conversation per visitor, `window.MSChatbot.open()/close()`. Works on static HTML, WordPress, Next.js, React, etc.
- **Security:** authorized-domain allow-list with wildcards, CORS, zod validation on every input, per-IP and per-visitor rate limits, per-chatbot monthly quotas, login throttling, tenant checks on every query, file type/size limits, private-network URL blocking.
- **Analytics:** daily usage (messages, unanswered, conversations, tokens, handoffs), 30-day chart, conversation transcripts with latency/tokens/sources, unanswered filter, top unanswered questions.
- **Multilingual:** visitors can write in any language/script (English, Roman Urdu, Urdu, Hindi, Arabic, Spanish…); questions are translated for retrieval and answered in the visitor's language.
- **Data retention:** conversations are deleted after N days (default 7, per chatbot; 0 = forever) by a nightly cron (`/api/cron/cleanup`). Usage stats, handoff leads (and their conversations) and the unanswered-questions log are kept, so the database stays small forever.

## Local development

```bash
npm install                      # also runs prisma generate
cp .env.example .env             # fill in DATABASE_URL, AUTH_SECRET, OPENAI_API_KEY, ADMIN_*
npm run db:migrate               # applies prisma/migrations (creates pgvector extension)
npm run dev                      # http://localhost:3000
```

Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, create a chatbot, add knowledge, then open the **Embed** tab and press *Launch preview widget*.

### Checks

```bash
npm run typecheck
npm run lint
npm test                         # unit tests (no DB required)
npx next build
npm run smoke -- http://localhost:3000   # end-to-end API/auth/isolation checks against a running server
```

### Using the free Google Gemini tier

1. Get a key at https://aistudio.google.com/apikey (no credit card required).
2. In `.env` set `OPENAI_API_KEY=<gemini key>`, `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `OPENAI_CHAT_MODEL=gemini-3.5-flash-lite`, `OPENAI_CHAT_FALLBACK_MODELS=gemini-flash-lite-latest,gemini-3.6-flash`, `OPENAI_EMBEDDING_MODEL=gemini-embedding-001`.
3. Restart the dev server. Free-tier limits (~15 chat requests/min) are enough for testing and small sites.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string (`?sslmode=require`). pgvector is enabled by the migration. |
| `AUTH_SECRET` | yes | ≥ 32 random chars; signs session cookies. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | First login with these creates the admin account. |
| `OPENAI_API_KEY` | yes | API key for the AI provider (OpenAI, or Gemini/Groq/etc. via `OPENAI_BASE_URL`). |
| `OPENAI_BASE_URL` | no | Any OpenAI-compatible endpoint. **Free tier:** `https://generativelanguage.googleapis.com/v1beta/openai/` (Google Gemini). Omit for OpenAI. |
| `OPENAI_CHAT_MODEL` | no | Server default chat model, e.g. `gemini-3.5-flash-lite` or `gpt-4o-mini`. Chatbots can override it in Settings. |
| `OPENAI_CHAT_FALLBACK_MODELS` | no | Comma-separated models tried in order when the primary times out / is overloaded. |
| `CHAT_API_KEY`, `CHAT_BASE_URL` | no | Separate provider for chat (recommended free: Groq — `https://api.groq.com/openai/v1`, model `openai/gpt-oss-20b`). |
| `EMBEDDINGS_API_KEY`, `EMBEDDINGS_BASE_URL` | no | Separate provider for embeddings. Gemini free = 1000/day; Cloudflare Workers AI (`@cf/baai/bge-m3`) or Jina (`jina-embeddings-v3`) give far more. Smaller vectors are zero-padded to 1536. |
| `OPENAI_EMBEDDING_MODEL` | no | `gemini-embedding-001` or `text-embedding-3-small`. Must support 1536 dims (vectors are truncated+normalized if larger). Re-index all sources if you change it. |
| `APP_URL` | no | Public URL used in embed snippets. Auto-detected on Vercel. |
| `ALLOW_SIGNUP` | no | `"true"` to enable `/register`. Default `"false"`. |
| `GITHUB_TOKEN` | no | Higher GitHub API limits / private repos for GitHub import. |
| `CRON_SECRET` | yes (prod) | Bearer secret for `/api/cron/cleanup` (nightly retention) and `/api/cron/ingest`. Vercel Cron sends it automatically when set in the project env. |

## Deploy to Vercel

1. Create a **Neon** project (free tier) and copy the pooled connection string.
2. Push this repo to GitHub and import it in **Vercel**.
3. Add the environment variables above in *Project → Settings → Environment Variables*. Generate `AUTH_SECRET` with `openssl rand -base64 32`.
4. Deploy. The build command (`prisma migrate deploy && next build`) applies migrations automatically; `postinstall` runs `prisma generate`.
5. Open `https://your-app.vercel.app`, log in, create a chatbot, and add your production domain under **Settings → Authorized domains**.
6. Paste the snippet from the **Embed** tab into your site:

```html
<script src="https://your-app.vercel.app/widget.js" data-chatbot-key="pk_…" async></script>
```

Notes:
- Vercel Hobby functions are capped at 60 s; the upload/process routes set `maxDuration = 60` and the crawler/GitHub importer work in resumable batches, so large sites index across multiple requests driven by the dashboard.
- Rate limiting is in-memory per function instance plus DB-backed monthly quotas. For hard multi-region limits plug in Upstash/Vercel KV in `lib/rate-limit.ts`.
- Handoff requests are stored in the database and visible in the dashboard; wire an email provider (e.g. Resend) in `app/api/handoff/route.ts` if you want notifications.

## Project layout

```
app/
  api/chat, api/handoff, api/widget/config   public widget APIs (CORS + domain validation)
  api/sources/upload, api/sources/[id]/process  authenticated ingestion APIs
  dashboard/…                                admin UI (chatbots, knowledge, conversations, handoffs, settings, embed)
  login, register                            auth pages (server actions)
lib/
  auth.ts, session.ts, env.ts                auth + config
  ai.ts, rag.ts                              OpenAI, vector retrieval, usage tracking
  ingest/                                    extraction, crawling, GitHub import, batch processor
  actions/                                   server actions for chatbots & sources
  api.ts, domains.ts, rate-limit.ts, text.ts helpers
prisma/schema.prisma, prisma/migrations/     data model (pgvector column + HNSW index in SQL)
public/widget.js                             embeddable widget
proxy.ts                                     route guard (Next 16 middleware)
tests/, scripts/smoke.mjs                    unit + end-to-end checks
```
