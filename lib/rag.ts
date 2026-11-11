import { Prisma } from "@prisma/client";
import { embedQuery, toVectorLiteral } from "./ai";
import { prisma } from "./prisma";

export type RetrievedChunk = {
  id: string;
  content: string;
  title: string | null;
  url: string | null;
  sourceId: string;
  similarity: number;
};

const OVERVIEW_QUESTION =
  /\b(what|which|list|all|every|tell me about)\b.*\b(offer|provide|service|services|subject|subjects|course|courses|class|classes|product|products|help with|do you do|specialize|cover|categories|pages)\b|\b(contact|phone|email|whatsapp|reach you|get in touch|call you)\b/i;

/** The "Website overview" chunks (menu catalogue + contact details) for a chatbot. */
async function overviewChunks(chatbotId: string) {
  return prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
    SELECT c."id", c."content", c."title", c."url", c."sourceId", 1.0::float AS "similarity"
    FROM "Chunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."chatbotId" = ${chatbotId} AND s."status" <> 'FAILED' AND c."title" LIKE 'Website overview%'
    ORDER BY c."createdAt" DESC LIMIT 2
  `).catch(() => [] as RetrievedChunk[]);
}

/**
 * Vector similarity search, always filtered by chatbotId so a tenant can never
 * retrieve another tenant's knowledge.
 */
export async function retrieveChunks(chatbotId: string, query: string, opts: { limit: number; cutoff: number; catalogue?: boolean }) {
  // Keyword search needs no AI provider, so it runs first and keeps the bot answering
  // even when the embeddings provider is down or out of quota.
  const keywordQuery = (limit: number) =>
    prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
      SELECT c."id", c."content", c."title", c."url", c."sourceId",
             ts_rank_cd(to_tsvector('english', c."content"), websearch_to_tsquery('english', ${query})) AS "similarity"
      FROM "Chunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
      WHERE c."chatbotId" = ${chatbotId}
        AND s."status" <> 'FAILED'
        AND to_tsvector('english', c."content") @@ websearch_to_tsquery('english', ${query})
      ORDER BY "similarity" DESC
      LIMIT ${limit}
    `).catch(() => [] as RetrievedChunk[]);

  let vector: number[] | null = null;
  let tokens = 0;
  try {
    ({ vector, tokens } = await embedQuery(query));
  } catch (e) {
    console.warn("[rag] embeddings unavailable, using keyword-only retrieval:", e instanceof Error ? e.message : e);
  }
  if (!vector) {
    // Degraded mode: match ANY of the query words (OR) and rank, so broad questions still hit.
    const rows = await prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
      WITH q AS (SELECT NULLIF(replace(plainto_tsquery('english', ${query})::text, '&', '|'), '')::tsquery AS tq)
      SELECT c."id", c."content", c."title", c."url", c."sourceId",
             ts_rank_cd(to_tsvector('english', coalesce(c."title", '') || ' ' || c."content"), q.tq) AS "similarity"
      FROM "Chunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId", q
      WHERE c."chatbotId" = ${chatbotId}
        AND s."status" <> 'FAILED'
        AND q.tq IS NOT NULL
        AND to_tsvector('english', coalesce(c."title", '') || ' ' || c."content") @@ q.tq
      ORDER BY "similarity" DESC
      LIMIT ${opts.limit + 2}
    `).catch(() => [] as RetrievedChunk[]);
    const pinned = opts.catalogue || OVERVIEW_QUESTION.test(query) ? await overviewChunks(chatbotId) : [];
    const ids = new Set(pinned.map((p) => p.id));
    const chunks = [...pinned, ...rows.filter((r) => !ids.has(r.id)).map((r) => ({ ...r, similarity: Math.max(opts.cutoff, Number(r.similarity)) }))];
    return { chunks: chunks.slice(0, opts.limit + 2), embeddingTokens: 0, all: rows, degraded: true };
  }

  const literal = toVectorLiteral(vector);
  // Chunks from sources that are still indexing are searchable too (status != FAILED),
  // so partially crawled sites already answer questions.
  const [vectorRows, keywordRows] = await Promise.all([
    prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
      SELECT c."id", c."content", c."title", c."url", c."sourceId",
             1 - (c."embedding" <=> ${literal}::vector) AS "similarity"
      FROM "Chunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
      WHERE c."chatbotId" = ${chatbotId}
        AND c."embedding" IS NOT NULL
        AND s."status" <> 'FAILED'
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${opts.limit}
    `),
    keywordQuery(4),
  ]);

  // Hybrid merge: semantic matches above the cutoff, plus exact keyword hits (phone
  // numbers, prices, product names) that embeddings sometimes miss.
  const seen = new Set<string>();
  const merged: RetrievedChunk[] = [];
  const add = (r: RetrievedChunk) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    merged.push(r);
  };
  // Catalogue-style questions ("what do you offer / which subjects / how to contact") always get
  // the site overview (menu + contact details) so the answer is complete, not a sample.
  if (opts.catalogue || OVERVIEW_QUESTION.test(query)) for (const r of await overviewChunks(chatbotId)) add(r);
  // Exact keyword matches first (they carry precise facts), then semantic matches.
  for (const r of keywordRows) add({ ...r, similarity: Math.max(opts.cutoff, Number(r.similarity)) });
  for (const r of vectorRows) if (r.similarity >= opts.cutoff) add(r);
  // If semantic scores are all low but something exists, still give the model the best few.
  if (merged.length === 0) for (const r of vectorRows.slice(0, 3)) if (r.similarity >= opts.cutoff * 0.7) merged.push(r);
  return { chunks: merged.slice(0, opts.limit + 2), embeddingTokens: tokens, all: vectorRows, degraded: false };
}

export function buildContext(chunks: RetrievedChunk[], maxChars = 7000) {
  const parts: string[] = [];
  let total = 0;
  for (const [i, c] of chunks.entries()) {
    const header = `[${i + 1}] ${c.title ?? "Document"}${c.url ? ` (${c.url})` : ""}`;
    const block = `${header}\n${c.content}`;
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join("\n\n---\n\n");
}

/** Deduplicate cited sources for the client. */
export function citations(chunks: RetrievedChunk[]) {
  const seen = new Set<string>();
  return chunks
    .map((c) => ({ title: c.title ?? "Document", url: c.url }))
    .filter((c) => {
      const k = `${c.title}|${c.url ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

/** Insert chunk rows together with their embeddings. */
export async function insertChunks(
  rows: { chatbotId: string; sourceId: string; content: string; title?: string | null; url?: string | null; tokenCount: number; embedding: number[] }[],
) {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) =>
      Prisma.sql`(${cuid()}, ${r.chatbotId}, ${r.sourceId}, ${r.content}, ${r.title ?? null}, ${r.url ?? null}, ${r.tokenCount}, ${toVectorLiteral(r.embedding)}::vector)`,
  );
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Chunk" ("id", "chatbotId", "sourceId", "content", "title", "url", "tokenCount", "embedding")
    VALUES ${Prisma.join(values)}
  `);
}

function cuid() {
  return `c${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export type UsageDelta = Partial<{
  messages: number;
  unanswered: number;
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  handoffs: number;
}>;

/** Atomically bump today's usage counters for a chatbot. */
export async function recordUsage(chatbotId: string, delta: UsageDelta) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const d = { messages: 0, unanswered: 0, conversations: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, handoffs: 0, ...delta };
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "UsageDaily" ("id", "chatbotId", "day", "messages", "unanswered", "conversations", "inputTokens", "outputTokens", "embeddingTokens", "handoffs")
    VALUES (${cuid()}, ${chatbotId}, ${day}::date, ${d.messages}, ${d.unanswered}, ${d.conversations}, ${d.inputTokens}, ${d.outputTokens}, ${d.embeddingTokens}, ${d.handoffs})
    ON CONFLICT ("chatbotId", "day") DO UPDATE SET
      "messages" = "UsageDaily"."messages" + EXCLUDED."messages",
      "unanswered" = "UsageDaily"."unanswered" + EXCLUDED."unanswered",
      "conversations" = "UsageDaily"."conversations" + EXCLUDED."conversations",
      "inputTokens" = "UsageDaily"."inputTokens" + EXCLUDED."inputTokens",
      "outputTokens" = "UsageDaily"."outputTokens" + EXCLUDED."outputTokens",
      "embeddingTokens" = "UsageDaily"."embeddingTokens" + EXCLUDED."embeddingTokens",
      "handoffs" = "UsageDaily"."handoffs" + EXCLUDED."handoffs"
  `);
}

/** Messages sent to a chatbot since the start of the current UTC month. */
export async function monthlyMessageCount(chatbotId: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await prisma.usageDaily.aggregate({ where: { chatbotId, day: { gte: start } }, _sum: { messages: true } });
  return agg._sum.messages ?? 0;
}
