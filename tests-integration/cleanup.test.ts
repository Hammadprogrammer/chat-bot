import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupChatbot } from "@/lib/cleanup";
import { prisma } from "@/lib/prisma";

const tag = `v_cleanup_${Math.random().toString(36).slice(2, 8)}`;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
let chatbotId: string;
let leadConversationId: string;
let oldIds: string[] = [];

const mk = (visitor: string, lastMessageAt: Date) =>
  prisma.conversation.create({
    data: {
      chatbotId,
      visitorId: visitor,
      lastMessageAt,
      startedAt: lastMessageAt,
      messageCount: 2,
      messages: { create: [{ role: "USER", content: "q" }, { role: "ASSISTANT", content: "a" }] },
    },
  });

describe("retention cleanup (real DB)", () => {
  beforeAll(async () => {
    const bot = await prisma.chatbot.findFirst({ orderBy: { createdAt: "desc" } });
    if (!bot) throw new Error("no chatbot in DB");
    chatbotId = bot.id;
    await prisma.chatbot.update({ where: { id: chatbotId }, data: { retentionDays: 7 } });
    const old1 = await mk(`${tag}_old1`, daysAgo(10));
    const old2 = await mk(`${tag}_old2`, daysAgo(30));
    oldIds = [old1.id, old2.id];
    await mk(`${tag}_recent`, daysAgo(2));
    const lead = await mk(`${tag}_lead`, daysAgo(20));
    leadConversationId = lead.id;
    await prisma.handoffRequest.create({ data: { chatbotId, conversationId: lead.id, email: `${tag}@test.com`, message: "call me" } });
    await prisma.unansweredLog.createMany({
      data: [
        { chatbotId, question: `${tag} old q`, createdAt: daysAgo(400) },
        { chatbotId, question: `${tag} new q`, createdAt: daysAgo(1) },
      ],
    });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { visitorId: { startsWith: tag } } });
    await prisma.handoffRequest.deleteMany({ where: { email: `${tag}@test.com` } });
    await prisma.unansweredLog.deleteMany({ where: { question: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  it("deletes old conversations but keeps recent ones, leads, stats and recent unanswered log", async () => {
    const usageBefore = await prisma.usageDaily.count({ where: { chatbotId } });
    const result = await cleanupChatbot(chatbotId);
    expect(result.conversationsDeleted).toBeGreaterThanOrEqual(2);

    const left = (await prisma.conversation.findMany({ where: { visitorId: { startsWith: tag } }, select: { visitorId: true } })).map((c) => c.visitorId.replace(`${tag}_`, "")).sort();
    expect(left).toEqual(["lead", "recent"]);
    expect(await prisma.message.count({ where: { conversationId: { in: oldIds } } })).toBe(0);
    expect(await prisma.handoffRequest.count({ where: { conversationId: leadConversationId } })).toBe(1);
    expect(await prisma.usageDaily.count({ where: { chatbotId } })).toBe(usageBefore);
    expect(await prisma.unansweredLog.count({ where: { question: `${tag} old q` } })).toBe(0);
    expect(await prisma.unansweredLog.count({ where: { question: `${tag} new q` } })).toBe(1);
    expect((await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId } })).lastCleanupAt).not.toBeNull();
  });

  it("keeps everything when retention is 0 (forever)", async () => {
    await prisma.chatbot.update({ where: { id: chatbotId }, data: { retentionDays: 0 } });
    const c = await mk(`${tag}_forever`, daysAgo(500));
    const result = await cleanupChatbot(chatbotId);
    expect(result.conversationsDeleted).toBe(0);
    expect(await prisma.conversation.count({ where: { id: c.id } })).toBe(1);
    await prisma.chatbot.update({ where: { id: chatbotId }, data: { retentionDays: 7 } });
  });
});
