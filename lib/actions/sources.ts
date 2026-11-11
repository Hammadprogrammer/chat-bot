"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireChatbot } from "@/lib/auth";
import { DEFAULT_CRAWL_PAGES, MAX_CRAWL_PAGES, newCrawlPayload, normalizeUrl } from "@/lib/ingest/crawl";
import { assertPublicUrl, FetchError } from "@/lib/ingest/fetch";
import { GitHubError, newGitHubPayload } from "@/lib/ingest/github";
import { resetSource, type FaqItem } from "@/lib/ingest/process";
import { runBatchAndContinue } from "@/lib/ingest/worker";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type SourceActionState = { error?: string; success?: string; sourceId?: string };

const MAX_SOURCES_PER_CHATBOT = 200;

async function guard(chatbotId: string) {
  const ctx = await requireChatbot(chatbotId);
  const count = await prisma.knowledgeSource.count({ where: { chatbotId } });
  if (count >= MAX_SOURCES_PER_CHATBOT) throw new Error("Source limit reached for this chatbot");
  return ctx;
}

/** Start processing immediately in the background (continues after the response). */
async function kickoff(sourceId: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : null;
  after(() => runBatchAndContinue(sourceId, origin).catch((e) => console.error("[ingest] kickoff failed", e)));
}

function revalidate(chatbotId: string) {
  revalidatePath(`/dashboard/chatbots/${chatbotId}/knowledge`);
  revalidatePath(`/dashboard/chatbots/${chatbotId}`);
}

const UrlSchema = z.object({
  url: z.url("Enter a valid URL including https://"),
  mode: z.enum(["single", "crawl"]),
  maxPages: z.coerce.number().int().min(1).max(MAX_CRAWL_PAGES).default(DEFAULT_CRAWL_PAGES),
});

export async function addUrlSource(chatbotId: string, _prev: SourceActionState, fd: FormData): Promise<SourceActionState> {
  try {
    const { chatbot } = await guard(chatbotId);
    const parsed = UrlSchema.safeParse({ url: String(fd.get("url") ?? "").trim(), mode: fd.get("mode") ?? "single", maxPages: fd.get("maxPages") || DEFAULT_CRAWL_PAGES });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    await assertPublicUrl(parsed.data.url);
    const url = normalizeUrl(parsed.data.url);
    const source = await prisma.knowledgeSource.create({
      data: {
        chatbotId: chatbot.id,
        type: "URL",
        name: parsed.data.mode === "crawl" ? `Crawl: ${new URL(url).hostname}` : url,
        url,
        payload: newCrawlPayload(url, parsed.data.mode, parsed.data.maxPages),
      },
    });
    await kickoff(source.id);
    revalidate(chatbot.id);
    return { success: "Website added. Indexing runs automatically in the background.", sourceId: source.id };
  } catch (e) {
    return { error: e instanceof FetchError || e instanceof Error ? e.message : "Failed to add URL" };
  }
}

const TextSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  text: z.string().trim().min(20, "Text must be at least 20 characters").max(500_000, "Text is too long (500k characters max)"),
});

export async function addTextSource(chatbotId: string, _prev: SourceActionState, fd: FormData): Promise<SourceActionState> {
  try {
    const { chatbot } = await guard(chatbotId);
    const parsed = TextSchema.safeParse({ title: fd.get("title"), text: fd.get("text") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const source = await prisma.knowledgeSource.create({
      data: { chatbotId: chatbot.id, type: "TEXT", name: parsed.data.title, payload: { text: parsed.data.text, title: parsed.data.title } },
    });
    await kickoff(source.id);
    revalidate(chatbot.id);
    return { success: "Text added. Indexing started.", sourceId: source.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add text" };
  }
}

const FaqSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(z.object({ question: z.string().trim().min(3, "Question is too short").max(500), answer: z.string().trim().min(1, "Answer is required").max(5000) })).min(1, "Add at least one question").max(200),
});

function parseFaqForm(fd: FormData): FaqItem[] {
  const questions = fd.getAll("question").map(String);
  const answers = fd.getAll("answer").map(String);
  return questions.map((q, i) => ({ question: q.trim(), answer: (answers[i] ?? "").trim() })).filter((f) => f.question || f.answer);
}

export async function addFaqSource(chatbotId: string, _prev: SourceActionState, fd: FormData): Promise<SourceActionState> {
  try {
    const { chatbot } = await guard(chatbotId);
    const parsed = FaqSchema.safeParse({ name: fd.get("name") || "FAQs", items: parseFaqForm(fd) });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const source = await prisma.knowledgeSource.create({
      data: { chatbotId: chatbot.id, type: "FAQ", name: parsed.data.name, payload: { items: parsed.data.items } },
    });
    await kickoff(source.id);
    revalidate(chatbot.id);
    return { success: "FAQs added. Indexing started.", sourceId: source.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add FAQs" };
  }
}

export async function updateFaqSource(chatbotId: string, sourceId: string, _prev: SourceActionState, fd: FormData): Promise<SourceActionState> {
  try {
    const { chatbot } = await requireChatbot(chatbotId);
    const parsed = FaqSchema.safeParse({ name: fd.get("name") || "FAQs", items: parseFaqForm(fd) });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const existing = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, chatbotId: chatbot.id, type: "FAQ" } });
    if (!existing) return { error: "FAQ source not found" };
    await prisma.knowledgeSource.update({ where: { id: existing.id }, data: { name: parsed.data.name, payload: { items: parsed.data.items }, status: "PENDING", error: null, lockedAt: null, pausedUntil: null } });
    await kickoff(existing.id);
    revalidate(chatbot.id);
    return { success: "FAQs updated. Re-indexing started." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update FAQs" };
  }
}

export async function addGitHubSource(chatbotId: string, _prev: SourceActionState, fd: FormData): Promise<SourceActionState> {
  try {
    const { chatbot } = await guard(chatbotId);
    const url = String(fd.get("url") ?? "").trim();
    const payload = await newGitHubPayload(url);
    const source = await prisma.knowledgeSource.create({
      data: {
        chatbotId: chatbot.id,
        type: "GITHUB",
        name: `${payload.owner}/${payload.repo}`,
        url: `https://github.com/${payload.owner}/${payload.repo}`,
        payload,
      },
    });
    await kickoff(source.id);
    revalidate(chatbot.id);
    return { success: `Found ${payload.files.length} files. Import runs in the background.`, sourceId: source.id };
  } catch (e) {
    return { error: e instanceof GitHubError || e instanceof Error ? e.message : "Failed to import repository" };
  }
}

export async function deleteSource(chatbotId: string, sourceId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  await prisma.knowledgeSource.deleteMany({ where: { id: sourceId, chatbotId: chatbot.id } });
  revalidate(chatbot.id);
}

export async function reindexSource(chatbotId: string, sourceId: string) {
  const { chatbot } = await requireChatbot(chatbotId);
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, chatbotId: chatbot.id } });
  if (!source) return;
  await resetSource(source.id);
  await kickoff(source.id);
  revalidate(chatbot.id);
}
