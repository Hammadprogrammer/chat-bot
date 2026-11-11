import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runBatchAndContinue, serializeSource } from "@/lib/ingest/worker";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Safety net: picks up sources that are still PENDING/PROCESSING but have no active
 * worker (e.g. a background continuation was lost) and resumes them.
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token).
 */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stale = new Date(Date.now() - 90_000);
  const sources = await prisma.knowledgeSource.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] }, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] },
    orderBy: { updatedAt: "asc" },
    take: 3,
    select: { id: true },
  });
  const origin = new URL(req.url).origin;
  const results = [];
  for (const s of sources) {
    const r = await runBatchAndContinue(s.id, origin);
    results.push(serializeSource(r.source, r.busy));
  }
  return NextResponse.json({ resumed: results.length, results });
}
