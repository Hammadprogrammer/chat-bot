import { createHash } from "node:crypto";
import { Prisma, type KnowledgeSource } from "@prisma/client";
import { AIConfigError, AIRateLimitError, embedTexts } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { insertChunks, recordUsage } from "@/lib/rag";
import { chunkText, estimateTokens, extractAvailability, htmlToText } from "@/lib/text";
import { discoverSitemapUrls, fetchPage, type CrawlPayload } from "./crawl";
import { fetchGitHubFile, type GitHubPayload } from "./github";

export type FaqItem = { question: string; answer: string };
export type TextPayload = { text: string; title?: string };
export type FaqPayload = { items: FaqItem[] };

const DEFAULT_BUDGET_MS = 40_000;
const MAX_CHARS_PER_SOURCE = 3_000_000;
export const LOCK_TTL_MS = 90_000;
/** Longest automatic pause after a provider quota error (daily quotas reset within 24h). */
const MAX_PAUSE_SEC = 24 * 3600;

type Doc = { text: string; title: string | null; url: string | null };
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
type Json = Prisma.InputJsonValue;

/**
 * Chunk, embed and persist a batch of documents for a source. Returns stats.
 * `replace` deletes the previous chunks matching the filter — but only AFTER the new
 * embeddings succeeded, so a provider outage never leaves the bot without knowledge.
 */
async function indexDocuments(source: KnowledgeSource, docs: Doc[], replace?: Prisma.ChunkWhereInput) {
  let pieces = docs.flatMap((d) => chunkText(d.text).map((content) => ({ content, title: d.title, url: d.url })));
  const replaced = replace ? await prisma.chunk.count({ where: { sourceId: source.id, ...replace } }) : 0;
  if (pieces.length === 0) return { chunks: 0, chars: 0, tokens: 0, replaced: 0 };
  // Skip boilerplate that is already indexed for this chatbot (menus, footers, sign-up
  // forms repeated on every page). Keeps retrieval results meaningful.
  const existing = await prisma.$queryRaw<{ h: string; url: string | null; sourceId: string }[]>(Prisma.sql`
    SELECT md5("content") AS h, "url", "sourceId" FROM "Chunk"
    WHERE "chatbotId" = ${source.chatbotId} AND md5("content") IN (${Prisma.join(pieces.map((p) => md5(p.content)))})
  `);
  // Chunks about to be replaced don't count as duplicates (same page re-indexed).
  const replacingUrls = new Set(docs.map((d) => d.url).filter(Boolean));
  const dup = new Set(existing.filter((e) => !(replace && e.sourceId === source.id && replacingUrls.has(e.url))).map((e) => e.h));
  const seen = new Set<string>();
  pieces = pieces.filter((p) => {
    const h = md5(p.content);
    if (dup.has(h) || seen.has(h)) return false;
    seen.add(h);
    return true;
  });
  if (pieces.length === 0) {
    if (replace) await prisma.chunk.deleteMany({ where: { sourceId: source.id, ...replace } });
    return { chunks: 0, chars: 0, tokens: 0, replaced };
  }
  const { vectors, tokens } = await embedTexts(pieces.map((p) => p.content));
  if (replace) await prisma.chunk.deleteMany({ where: { sourceId: source.id, ...replace } });
  await insertChunks(
    pieces.map((p, i) => ({
      chatbotId: source.chatbotId,
      sourceId: source.id,
      content: p.content,
      title: p.title,
      url: p.url,
      tokenCount: estimateTokens(p.content),
      embedding: vectors[i],
    })),
  );
  await recordUsage(source.chatbotId, { embeddingTokens: tokens });
  return { chunks: pieces.length, chars: pieces.reduce((n, p) => n + p.content.length, 0), tokens, replaced };
}

async function bump(source: KnowledgeSource, stats: { chunks: number; chars: number }, extra: Prisma.KnowledgeSourceUpdateInput = {}) {
  return prisma.knowledgeSource.update({
    where: { id: source.id },
    data: { chunkCount: { increment: stats.chunks }, charCount: { increment: stats.chars }, ...extra },
  });
}

/** Try to take the processing lock. Returns false if another worker holds a fresh lock. */
async function acquireLock(sourceId: string) {
  const now = new Date();
  const { count } = await prisma.knowledgeSource.updateMany({
    where: {
      id: sourceId,
      status: { in: ["PENDING", "PROCESSING"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } }],
      AND: [{ OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] }],
    },
    data: { lockedAt: now, status: "PROCESSING", error: null },
  });
  return count === 1;
}

function pauseData(e: AIRateLimitError): Prisma.KnowledgeSourceUpdateInput {
  return { pausedUntil: new Date(Date.now() + Math.min(e.retryAfterSec, MAX_PAUSE_SEC) * 1000), error: e.message, lockedAt: null };
}

export type ProcessResult = { source: KnowledgeSource; busy: boolean; reason?: "locked" | "paused" };

/**
 * Advance a knowledge source by one time-boxed batch. Safe to call repeatedly and
 * concurrently: a DB lock ensures a single worker; provider rate limits pause the
 * source (never fail it); long jobs persist their queue in `payload` and resume.
 */
export async function processSource(sourceId: string, budgetMs = DEFAULT_BUDGET_MS): Promise<ProcessResult> {
  const deadline = Date.now() + budgetMs;
  const existing = await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
  if (existing.status === "READY" || existing.status === "FAILED") return { source: existing, busy: false };
  if (!(await acquireLock(sourceId))) {
    const paused = existing.pausedUntil !== null && existing.pausedUntil > new Date();
    return { source: existing, busy: true, reason: paused ? "paused" : "locked" };
  }
  const source = await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });

  try {
    switch (source.type) {
      case "TEXT":
      case "FILE": {
        const p = source.payload as TextPayload;
        const stats = await indexDocuments(source, [{ text: p.text, title: p.title ?? source.name, url: source.url }], {});
        const updated = await prisma.knowledgeSource.update({
          where: { id: source.id },
          data: { status: "READY", chunkCount: stats.chunks, charCount: stats.chars, lockedAt: null, pausedUntil: null },
        });
        return { busy: false, source: updated };
      }
      case "FAQ": {
        const p = source.payload as FaqPayload;
        const docs = p.items.map((f) => ({ text: `Q: ${f.question}\nA: ${f.answer}`, title: f.question, url: null }));
        const stats = await indexDocuments(source, docs, {});
        const updated = await prisma.knowledgeSource.update({
          where: { id: source.id },
          data: { status: "READY", chunkCount: stats.chunks, charCount: stats.chars, pageCount: p.items.length, lockedAt: null, pausedUntil: null },
        });
        return { busy: false, source: updated };
      }
      case "URL":
        return { busy: false, source: await processCrawl(source, deadline) };
      case "GITHUB":
        return { busy: false, source: await processGitHub(source, deadline) };
    }
  } catch (e) {
    if (e instanceof AIRateLimitError) {
      return { busy: false, source: await prisma.knowledgeSource.update({ where: { id: source.id }, data: pauseData(e) }) };
    }
    const message = e instanceof Error ? e.message : "Processing failed";
    const data: Prisma.KnowledgeSourceUpdateInput = { status: "FAILED", error: message.slice(0, 500), lockedAt: null };
    if (e instanceof AIConfigError) data.error = `${message}. Fix the AI configuration and press Re-index.`;
    return { busy: false, source: await prisma.knowledgeSource.update({ where: { id: source.id }, data }) };
  }
}

async function processCrawl(source: KnowledgeSource, deadline: number) {
  let payload = source.payload as CrawlPayload;
  let current = source;

  if (payload.mode === "crawl" && payload.visited.length === 0 && payload.queue.length === 1) {
    const fromSitemap = await discoverSitemapUrls(payload.queue[0], payload.maxPages);
    payload = { ...payload, queue: [...new Set([...payload.queue, ...fromSitemap])] };
  }

  let paused: AIRateLimitError | null = null;
  while (payload.queue.length > 0 && payload.visited.length < payload.maxPages && Date.now() < deadline) {
    const url = payload.queue[0];
    if (payload.visited.includes(url)) {
      payload.queue.shift();
      continue;
    }
    let page: Awaited<ReturnType<typeof fetchPage>>;
    try {
      try {
        page = await fetchPage(url);
      } catch (first) {
        // The very first page decides whether the whole crawl works: give it a second chance.
        if (payload.visited.length > 0) throw first;
        await new Promise((r) => setTimeout(r, 1500));
        page = await fetchPage(url);
      }
    } catch (e) {
      // Page-level fetch failure: record it and move on. Never fails the whole source.
      payload.queue.shift();
      payload.visited.push(url);
      payload.failed.push({ url, error: e instanceof Error ? e.message : "fetch failed" });
      if (payload.failed.length > 100) payload.failed = payload.failed.slice(-100);
      continue;
    }
    if (payload.mode === "crawl") {
      const known = new Set([...payload.visited, ...payload.queue]);
      const fresh = page.links.filter((l) => !known.has(l));
      payload.queue.push(...fresh.slice(0, Math.max(0, payload.maxPages * 3 - payload.queue.length)));
    }
    if (current.charCount + page.text.length > MAX_CHARS_PER_SOURCE) {
      payload.queue = [];
      break;
    }
    try {
      // Paragraphs that also appear on the first page (forms, footers, CTAs, testimonials)
      // are site-wide boilerplate: drop them from every later page so chunks stay focused.
      const paragraphs = page.text.split(/\n{2,}/);
      let text = page.text;
      if (payload.visited.length === 0) {
        payload.boilerplate = paragraphs.filter((p) => p.length > 40).map(md5).slice(0, 300);
      } else if (payload.boilerplate?.length) {
        const bp = new Set(payload.boilerplate);
        const kept = paragraphs.filter((p) => p.length <= 40 || !bp.has(md5(p)));
        if (kept.join("").length > 200) text = kept.join("\n\n");
      }
      const docs: Doc[] = [{ text, title: page.title, url }];
      // First page: index the site menu as an overview so "what do you offer?" lists everything.
      if (payload.visited.length === 0 && (page.navigation.some((g) => g.items.length >= 3) || page.contacts)) {
        const host = new URL(url).hostname.replace(/^www\./, "");
        const c = page.contacts;
        const contactLines = [
          ...(c?.phones.map((p) => `- Phone: ${p}`) ?? []),
          ...(c?.emails.map((e) => `- Email: ${e}`) ?? []),
          ...(c?.whatsapp.map((w) => {
            const num = /wa\.me\/(\d+)|phone=(\d+)/i.exec(w);
            return `- WhatsApp: ${num ? `+${num[1] ?? num[2]} (${w})` : w}`;
          }) ?? []),
        ];
        const parts = [`What services do you offer? What do you provide? Which subjects, courses or topics do you cover or teach? What can you help with? How can I contact you? What are your timings / working hours / availability?`];
        const availability = extractAvailability(page.text);
        if (availability.length) parts.push(`Availability / timings / support hours (from the website):\n${availability.map((a) => `- ${a}`).join("\n")}`);
        const groups = page.navigation.filter((g) => g.label !== "Main pages");
        if (groups.length) {
          parts.push(
            `Official catalogue of ${host} (from the website menu). Each group below is complete and exact — when asked about one group, list exactly these items and nothing from other groups:\n\n` +
              groups.map((g) => `${g.label} (${g.items.length} in total):\n${g.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n"),
          );
        }
        const main = page.navigation.find((g) => g.label === "Main pages");
        if (main) parts.push(`Other site pages (not services): ${main.items.join(", ")}`);
        if (contactLines.length) parts.push(`Contact details for ${host}:\n${contactLines.join("\n")}`);
        docs.push({ title: `Website overview – services, pages and contact details for ${host}`, url, text: parts.join("\n\n") });
      }
      const replace: Prisma.ChunkWhereInput = docs.length > 1 ? { OR: [{ url }, { title: { startsWith: "Website overview" } }] } : { url };
      const stats = await indexDocuments(current, docs, replace);
      payload.queue.shift();
      payload.visited.push(url);
      current = await bump(current, { chunks: stats.chunks - stats.replaced, chars: stats.chars }, { pageCount: { increment: 1 }, payload: payload as unknown as Json, lockedAt: new Date() });
    } catch (e) {
      if (e instanceof AIRateLimitError) {
        // Leave the URL at the head of the queue and pause; we resume exactly here later.
        paused = e;
        break;
      }
      throw e;
    }
  }

  const done = !paused && (payload.queue.length === 0 || payload.visited.length >= payload.maxPages);
  const onlyFailures = done && current.pageCount === 0 && payload.failed.length > 0;
  let counts: Prisma.KnowledgeSourceUpdateInput = {};
  if (done && !onlyFailures) {
    // Pages that disappeared since the last crawl: drop their chunks, then recompute totals.
    const failedUrls = payload.failed.map((f) => f.url);
    await prisma.chunk.deleteMany({
      where: { sourceId: source.id, url: { notIn: [...payload.visited, ...failedUrls] }, NOT: { title: { startsWith: "Website overview" } } },
    });
    const agg = await prisma.chunk.aggregate({ where: { sourceId: source.id }, _count: true, _sum: { tokenCount: true } });
    counts = { chunkCount: agg._count, charCount: (agg._sum.tokenCount ?? 0) * 4 };
  }
  return prisma.knowledgeSource.update({
    where: { id: source.id },
    data: {
      ...counts,
      payload: payload as unknown as Json,
      status: onlyFailures ? "FAILED" : done ? "READY" : "PROCESSING",
      error: onlyFailures ? `Could not read any page. First error: ${payload.failed[0]?.error}` : paused ? paused.message : null,
      lockedAt: null,
      pausedUntil: paused ? new Date(Date.now() + Math.min(paused.retryAfterSec, MAX_PAUSE_SEC) * 1000) : null,
    },
  });
}

async function processGitHub(source: KnowledgeSource, deadline: number) {
  const payload = source.payload as GitHubPayload;
  let current = source;
  let paused: AIRateLimitError | null = null;
  while (payload.files.length > 0 && Date.now() < deadline) {
    const path = payload.files[0];
    let file: Awaited<ReturnType<typeof fetchGitHubFile>>;
    try {
      file = await fetchGitHubFile(payload, path);
    } catch (e) {
      payload.files.shift();
      payload.processed += 1;
      payload.failed.push({ path, error: e instanceof Error ? e.message : "fetch failed" });
      continue;
    }
    try {
      const content = /\.html?$/i.test(path) ? htmlToText(file.text) : file.text;
      const stats = await indexDocuments(current, [{ text: content, title: path, url: file.url }], { url: file.url });
      payload.files.shift();
      payload.processed += 1;
      current = await bump(current, { chunks: stats.chunks - stats.replaced, chars: stats.chars }, { pageCount: { increment: 1 }, payload: payload as unknown as Json, lockedAt: new Date() });
    } catch (e) {
      if (e instanceof AIRateLimitError) {
        paused = e;
        break;
      }
      throw e;
    }
  }
  const done = !paused && payload.files.length === 0;
  return prisma.knowledgeSource.update({
    where: { id: source.id },
    data: {
      payload: payload as unknown as Json,
      status: done ? "READY" : "PROCESSING",
      error: paused ? paused.message : null,
      lockedAt: null,
      pausedUntil: paused ? new Date(Date.now() + Math.min(paused.retryAfterSec, MAX_PAUSE_SEC) * 1000) : null,
    },
  });
}

/**
 * Queue a source for re-processing. Existing chunks stay searchable and are replaced
 * page-by-page as the new crawl succeeds (blue/green), so re-indexing never leaves gaps.
 */
export async function resetSource(sourceId: string) {
  const source = await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
  let payload = source.payload as Json | null;
  if (source.type === "URL") {
    const p = source.payload as CrawlPayload;
    payload = { ...p, queue: [source.url!], visited: [], failed: [], boilerplate: [] } as unknown as Json;
  }
  return prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { status: "PENDING", error: null, pageCount: 0, lockedAt: null, pausedUntil: null, payload: payload ?? undefined },
  });
}

/** Human-readable progress for the dashboard. */
export function describeProgress(source: Pick<KnowledgeSource, "type" | "status" | "payload" | "pageCount" | "pausedUntil">) {
  if (source.status !== "PROCESSING" && source.status !== "PENDING") return null;
  if (source.pausedUntil && source.pausedUntil > new Date()) {
    const sec = Math.max(1, Math.round((source.pausedUntil.getTime() - Date.now()) / 1000));
    const human = sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`;
    return sec >= 1800
      ? `Paused — the embeddings provider's daily free quota is used up · resumes automatically in ${human} (or switch provider in .env and press Re-index)`
      : `Paused by provider rate limit · resumes in ${human}`;
  }
  if (source.type === "URL") {
    const p = source.payload as CrawlPayload | null;
    if (!p) return "Starting…";
    const total = Math.min(p.maxPages, p.visited.length + p.queue.length);
    return `${source.pageCount} pages indexed · ${Math.max(0, total - p.visited.length)} queued${p.failed.length ? ` · ${p.failed.length} skipped` : ""}`;
  }
  if (source.type === "GITHUB") {
    const p = source.payload as GitHubPayload | null;
    return p ? `${p.processed} / ${p.processed + p.files.length} files` : "Starting…";
  }
  return "Indexing…";
}
