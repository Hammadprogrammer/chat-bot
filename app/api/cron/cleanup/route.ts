import { NextResponse } from "next/server";
import { cleanupAll } from "@/lib/cleanup";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily data-retention job (Vercel Cron). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await cleanupAll();
  const totals = results.reduce(
    (t, r) => ({ conversations: t.conversations + r.conversationsDeleted, messages: t.messages + r.messagesDeleted }),
    { conversations: 0, messages: 0 },
  );
  return NextResponse.json({ ok: true, chatbots: results.length, deleted: totals, results });
}
