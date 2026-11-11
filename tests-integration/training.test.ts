import { afterAll, describe, expect, it } from "vitest";
import { generateSystemPromptFromSite } from "@/lib/ai";
import { prisma } from "@/lib/prisma";

/** Needs the dev server running (npm run dev) and indexed chatbots. */
const base = process.env.QA_BASE_URL ?? "http://localhost:3000";

const GUIDELINES = `- When a visitor asks about price or cost: never quote a made-up number. Explain that pricing depends on the subject, exam/course type and deadline, mention any discount stated on the website, and invite them to get a free quote via the contact options (WhatsApp/phone).
- If the visitor's request is vague (e.g. "I need help"), ask ONE short question: which subject/exam and when is the deadline.
- Only promise outcomes the website itself promises; never add extra guarantees. When asked about grades, describe the website's stated policy honestly.
- For complaints or frustration, apologize sincerely and offer the remedy the website states (refund/replacement) or connect them with the team right away.
- Keep answers under 6 lines unless the visitor asks for a full list.`;

const visitorId = `v_train_${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { visitorId } });
  await prisma.$disconnect();
});

describe("training: generated prompt + owner guidelines (live)", async () => {
  const bots = await prisma.chatbot.findMany({ orderBy: { createdAt: "asc" } });

  for (const bot of bots) {
    describe(bot.name, () => {
      let conversationId: string | null = null;
      const ask = async (message: string) => {
        const res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: bot.allowedDomains[0] ? `https://${bot.allowedDomains[0]}` : "https://example.com" },
          body: JSON.stringify({ key: bot.publicKey, message, visitorId, conversationId, pageUrl: "https://test" }),
        });
        const j = (await res.json()) as { answer?: string; conversationId?: string };
        conversationId = j.conversationId ?? conversationId;
        console.log(`[${bot.name}] Q: ${message}\n   A: ${(j.answer ?? "").replace(/\n+/g, " ⏎ ").slice(0, 300)}`);
        return j.answer ?? "";
      };

      it("generates a professional prompt from the website and saves it with guidelines", async () => {
        const overview = await prisma.chunk.findMany({ where: { chatbotId: bot.id, title: { startsWith: "Website overview" } }, select: { content: true }, take: 2 });
        const sample = await prisma.chunk.findMany({ where: { chatbotId: bot.id, NOT: { title: { startsWith: "Website overview" } } }, orderBy: { createdAt: "asc" }, select: { content: true }, take: 4 });
        const host = bot.websiteUrl ? new URL(bot.websiteUrl).hostname.replace(/^www\./, "") : bot.name;
        const prompt = await generateSystemPromptFromSite({ businessName: bot.name, host, overview: overview.map((o) => o.content).join("\n\n"), sampleText: sample.map((s) => s.content).join("\n\n") });
        console.log(`[${bot.name}] prompt:\n${prompt}`);
        expect(prompt.length).toBeGreaterThan(150);
        expect(prompt.toLowerCase()).toMatch(/you are|assistant|professional/i);
        await prisma.chatbot.update({ where: { id: bot.id }, data: { systemPrompt: prompt, responseGuidelines: GUIDELINES } });
      });

      it("vague request → asks subject/deadline", async () => {
        const a = await ask("I need help");
        expect(a).toMatch(/\?/);
        expect(a).toMatch(/subject|exam|course|deadline|class/i);
      });

      it("price → no fixed price, offers quote", async () => {
        const a = await ask("How much does it cost?");
        expect(a).not.toMatch(/\$\s?\d{2,}/);
        expect(a).toMatch(/quote|whatsapp|depends|varies|estimate|contact/i);
      });

      it("grade question → answers per the site's stated policy, no extra promises", async () => {
        const a = await ask("Can you guarantee me an A grade?");
        expect(a).toMatch(/grade|guarantee|outcome/i);
      });

      it("complaint → apology + human", async () => {
        const a = await ask("Your service was terrible last time, I'm very upset.");
        expect(a).toMatch(/sorry|apolog/i);
        expect(a).toMatch(/refund|make it right|team|connect|member|call|whatsapp|right|replace/i);
      });

      it("normal question still answered from site", async () => {
        const a = await ask("Do you help with nursing exams?");
        expect(a).toMatch(/nursing/i);
      });
    });
  }
});
