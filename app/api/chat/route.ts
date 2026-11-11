import { after } from "next/server";
import { z } from "zod";
import { AIConfigError, generateAnswer, understandQuery, type ChatTurn } from "@/lib/ai";
import { ApiError, error, json, parseBody, preflight, resolvePublicChatbot } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { buildContext, citations, monthlyMessageCount, recordUsage, retrieveChunks } from "@/lib/rag";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  key: z.string().min(8).max(64),
  message: z.string().trim().min(1, "Message is required").max(2000, "Message is too long"),
  conversationId: z.string().max(64).optional().nullable(),
  visitorId: z.string().min(4).max(64),
  pageUrl: z.string().max(2048).optional().nullable(),
});

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const started = Date.now();
  try {
    const body = await parseBody(req, Body);
    const bot = await resolvePublicChatbot(req, body.key);

    const ip = clientIp(req);
    // Abuse protection only (0 = unlimited for the per-visitor limit).
    const perIp = rateLimit(`chat:ip:${ip}`, 120);
    const perVisitor = bot.rateLimitPerMinute > 0 ? rateLimit(`chat:${bot.id}:${body.visitorId}`, bot.rateLimitPerMinute) : { ok: true, retryAfterSec: 0 };
    if (!perIp.ok || !perVisitor.ok) {
      const retry = Math.max(perIp.retryAfterSec, perVisitor.retryAfterSec);
      return json({ error: "Too many messages. Please slow down.", code: "rate_limited" }, { status: 429, origin, headers: { "Retry-After": String(retry) } });
    }
    if (bot.monthlyMessageLimit > 0 && (await monthlyMessageCount(bot.id)) >= bot.monthlyMessageLimit) {
      throw new ApiError(429, "This chatbot has reached its monthly message limit.", "quota_exceeded");
    }

    const retrievalOpts = { limit: bot.maxContextChunks, cutoff: bot.similarityCutoff };
    // New conversations have no history, so language detection / query rewriting can start
    // immediately, in parallel with the DB work below.
    const earlyUnderstanding = body.conversationId ? null : understandQuery(body.message, []);

    // Conversation is always scoped to this chatbot — a conversation id from another tenant is ignored.
    let conversation = body.conversationId
      ? await prisma.conversation.findFirst({ where: { id: body.conversationId, chatbotId: bot.id }, select: { id: true } })
      : null;
    const isNew = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { chatbotId: bot.id, visitorId: body.visitorId, pageUrl: body.pageUrl ?? null, userAgent: req.headers.get("user-agent")?.slice(0, 255) ?? null },
        select: { id: true },
      });
    }

    const convId = conversation.id;
    const [historyRows] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: convId }, orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true } }),
      prisma.message.create({ data: { conversationId: convId, role: "USER", content: body.message } }),
    ]);
    const history: ChatTurn[] = historyRows.reverse().map((m) => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content }));

    // Any language in → English search query out (follow-ups resolved from history).
    const qu = await (earlyUnderstanding ?? understandQuery(body.message, history));
    if (process.env.NODE_ENV !== "production") console.log("[chat] understanding", JSON.stringify({ message: body.message, ...qu }));
    const retrieval = qu.intent === "greeting"
      ? { chunks: [], embeddingTokens: 0 }
      : await retrieveChunks(bot.id, qu.searchQuery, { ...retrievalOpts, catalogue: qu.catalogue });
    let answer = bot.fallbackMessage;
    let answered = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let sources: ReturnType<typeof citations> = [];

    {
      const result = await generateAnswer({
        model: bot.model,
        temperature: bot.temperature,
        systemPrompt: bot.systemPrompt,
        botName: bot.botName,
        context: buildContext(retrieval.chunks),
        history,
        question: body.message,
        allowGeneralAnswers: bot.allowGeneralAnswers,
        language: qu.language,
        guidelines: bot.responseGuidelines,
      });
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      // The model occasionally refuses although the retrieved passages clearly match
      // (e.g. "refund policy" with 0.6+ similarity). Retry once with an explicit nudge.
      const topSim = retrieval.chunks[0]?.similarity ?? 0;
      if (!result.answered && retrieval.chunks.length > 0 && topSim >= bot.similarityCutoff + 0.15) {
        const retry = await generateAnswer({
          model: bot.model,
          temperature: 0,
          systemPrompt: bot.systemPrompt,
          botName: bot.botName,
          context: buildContext(retrieval.chunks),
          history,
          question: body.message,
          allowGeneralAnswers: bot.allowGeneralAnswers,
          language: qu.language,
          guidelines: bot.responseGuidelines,
          hint: "The CONTEXT below contains passages that directly relate to this question (titles like " + JSON.stringify(retrieval.chunks[0].title ?? "") + "). Answer from them; do not reply NO_ANSWER unless they are truly unrelated.",
        });
        inputTokens += retry.inputTokens;
        outputTokens += retry.outputTokens;
        if (retry.answered) Object.assign(result, retry);
      }
      if (result.answered) {
        answer = result.answer;
        answered = true;
        sources = bot.showSources ? citations(retrieval.chunks) : [];
      } else if (result.answer.length >= 20) {
        // Model-written fallback in the visitor's language beats the static English message.
        answer = result.answer;
      }
    }

    const handoff = !answered && bot.handoffEnabled && Boolean(bot.supportEmail || bot.supportUrl);
    const latencyMs = Date.now() - started;

    // Persist analytics after the response is sent so the visitor sees the answer sooner.
    after(async () => {
      await Promise.all([
        prisma.message.create({ data: { conversationId: convId, role: "ASSISTANT", content: answer, answered, sources, inputTokens, outputTokens, latencyMs } }),
        prisma.conversation.update({
          where: { id: convId },
          data: { messageCount: { increment: 2 }, unansweredCount: { increment: answered ? 0 : 1 }, lastMessageAt: new Date() },
        }),
        recordUsage(bot.id, { messages: 1, unanswered: answered ? 0 : 1, conversations: isNew ? 1 : 0, inputTokens, outputTokens, embeddingTokens: retrieval.embeddingTokens }),
        // Compact log of what the bot could not answer; survives conversation cleanup.
        answered || qu.intent !== "question"
          ? Promise.resolve()
          : prisma.unansweredLog.create({ data: { chatbotId: bot.id, question: body.message.slice(0, 300), language: qu.language } }),
      ]).catch((e) => console.error("[chat] failed to persist analytics", e));
    });

    return json(
      {
        conversationId: conversation.id,
        answer,
        answered,
        sources,
        handoff: handoff ? { supportEmail: bot.supportEmail, supportUrl: bot.supportUrl } : null,
      },
      { origin },
    );
  } catch (e) {
    if (e instanceof AIConfigError) return error(new ApiError(503, "AI provider is not configured", "ai_unavailable"), origin);
    return error(e, origin);
  }
}
