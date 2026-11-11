import { z } from "zod";
import { error, json, parseBody, preflight, resolvePublicChatbot } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recordUsage } from "@/lib/rag";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  key: z.string().min(8).max(64),
  conversationId: z.string().max(64).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
  email: z.email("Enter a valid email address").max(254),
  message: z.string().trim().min(1, "Message is required").max(3000),
  pageUrl: z.string().max(2048).optional().nullable(),
});

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const body = await parseBody(req, Body);
    const bot = await resolvePublicChatbot(req, body.key);
    if (!rateLimit(`handoff:${clientIp(req)}`, 5, 10 * 60_000).ok) {
      return json({ error: "Too many requests", code: "rate_limited" }, { status: 429, origin });
    }
    const conversation = body.conversationId
      ? await prisma.conversation.findFirst({ where: { id: body.conversationId, chatbotId: bot.id }, select: { id: true } })
      : null;
    await prisma.handoffRequest.create({
      data: {
        chatbotId: bot.id,
        conversationId: conversation?.id ?? null,
        name: body.name ?? null,
        email: body.email,
        message: body.message,
        pageUrl: body.pageUrl ?? null,
      },
    });
    await recordUsage(bot.id, { handoffs: 1 });
    return json({ ok: true, message: "Thanks! Our team will get back to you by email." }, { origin });
  } catch (e) {
    return error(e, origin);
  }
}
