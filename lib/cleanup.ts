import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const BATCH = 500;
const UNANSWERED_LOG_DAYS = 365;

export type CleanupResult = { chatbotId: string; conversationsDeleted: number; messagesDeleted: number; unansweredLogsDeleted: number };

/**
 * Delete conversations older than the chatbot's retention window, in small batches so
 * it stays cheap on serverless/free-tier Postgres. Kept forever: usage stats (UsageDaily),
 * handoff leads, conversations that produced a handoff, and the unanswered-question log
 * (trimmed after a year).
 */
export async function cleanupChatbot(chatbotId: string, now = new Date()): Promise<CleanupResult> {
  const bot = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId }, select: { retentionDays: true } });
  const result: CleanupResult = { chatbotId, conversationsDeleted: 0, messagesDeleted: 0, unansweredLogsDeleted: 0 };

  if (bot.retentionDays > 0) {
    const cutoff = new Date(now.getTime() - bot.retentionDays * 86_400_000);
    for (;;) {
      const stale = await prisma.conversation.findMany({
        where: { chatbotId, lastMessageAt: { lt: cutoff }, handoffs: { none: {} } },
        select: { id: true, messageCount: true },
        take: BATCH,
      });
      if (stale.length === 0) break;
      const ids = stale.map((c) => c.id);
      // Messages cascade from conversations; count them for the report.
      result.messagesDeleted += stale.reduce((n, c) => n + c.messageCount, 0);
      const { count } = await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
      result.conversationsDeleted += count;
      if (stale.length < BATCH) break;
    }
  }

  const logCutoff = new Date(now.getTime() - UNANSWERED_LOG_DAYS * 86_400_000);
  result.unansweredLogsDeleted = (await prisma.unansweredLog.deleteMany({ where: { chatbotId, createdAt: { lt: logCutoff } } })).count;

  await prisma.chatbot.update({ where: { id: chatbotId }, data: { lastCleanupAt: now } });
  return result;
}

/** Run cleanup for every chatbot (daily cron). */
export async function cleanupAll() {
  const bots = await prisma.chatbot.findMany({ select: { id: true } });
  const results: CleanupResult[] = [];
  for (const b of bots) {
    try {
      results.push(await cleanupChatbot(b.id));
    } catch (e) {
      console.error("[cleanup] failed for chatbot", b.id, e);
    }
  }
  return results;
}

/** Approximate storage used by a chatbot's conversations, for the dashboard. */
export async function storageSummary(chatbotId: string) {
  const [conversations, messages, bytes] = await Promise.all([
    prisma.conversation.count({ where: { chatbotId } }),
    prisma.message.count({ where: { conversation: { chatbotId } } }),
    prisma.$queryRaw<{ bytes: bigint | number | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(pg_column_size(m.*)), 0) AS bytes
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."chatbotId" = ${chatbotId}
    `).then((r) => Number(r[0]?.bytes ?? 0)).catch(() => 0),
  ]);
  return { conversations, messages, approxMb: Math.round((bytes / 1_048_576) * 100) / 100 };
}
