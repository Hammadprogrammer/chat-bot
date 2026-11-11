/** Asks the first chatbot questions through the public API (one conversation) and prints full answers.
 *  Usage: node --env-file=.env scripts/chat-check.mjs [baseUrl] "q1" "q2" ... */
import { PrismaClient } from "@prisma/client";

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();
const bot = await prisma.chatbot.findFirst({ orderBy: { createdAt: "desc" } });
const origin = bot.allowedDomains[0] ? `https://${bot.allowedDomains[0]}` : "https://example.com";
const questions = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["Hi there!", "What services do you offer?", "How can I contact you?", "Is there any discount for the first session?", "Do you help with nursing classes?", "What is the capital of France?"];

let conversationId = null;
for (const q of questions) {
  const t = Date.now();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ key: bot.publicKey, message: q, visitorId: "v_chatcheck1", conversationId, pageUrl: origin }),
  });
  const j = await res.json();
  conversationId = j.conversationId ?? conversationId;
  console.log(`\nQ: ${q}\n[${res.status} · ${Date.now() - t}ms · answered=${j.answered}${j.handoff ? " · handoff offered" : ""}]`);
  console.log("A:", (j.answer ?? j.error ?? "").replace(/\n+/g, " ⏎ ").slice(0, 700));
  if (j.sources?.length) console.log("sources:", j.sources.map((s) => s.title).join(" | "));
}
await prisma.conversation.deleteMany({ where: { chatbotId: bot.id, visitorId: "v_chatcheck1" } });
await prisma.$disconnect();
