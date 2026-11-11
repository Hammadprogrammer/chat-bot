<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Stack: Next.js 16 App Router (Turbopack, `proxy.ts` instead of middleware), Prisma 6 + Neon Postgres + pgvector, OpenAI, Tailwind 4, Vitest.
- `.env` is gitignored; copy `.env.example`. `node --env-file=.env` is used for scripts.
- Verification: `npm run typecheck`, `npm run lint`, `npm test` (unit, no DB needed), `npx next build`.
- Smoke test (needs a running dev server + DB): `npm run smoke -- http://localhost:3000`. The in-memory rate limiter persists for the dev server's lifetime, so a second run within 10 minutes will hit 429 on the handoff check.
- Migrations: edit `prisma/schema.prisma`, then `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql` and `npm run db:migrate` (Neon pooled connections don't support `migrate dev`'s shadow DB). The `Chunk.embedding` vector column + HNSW index live in raw SQL.
- Tenant isolation rule: every Prisma query touching chatbot data must filter by `chatbotId` and the chatbot by `userId` (see `requireChatbot` in `lib/auth.ts` and `resolvePublicChatbot` in `lib/api.ts`).
- Windows/PowerShell: paths with `[id]` segments break `Get-Content`; use the edit tool.
