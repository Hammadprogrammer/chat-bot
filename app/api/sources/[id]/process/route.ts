import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runBatchAndContinue, serializeSource, verifyInternalToken } from "@/lib/ingest/worker";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

async function authorize(req: Request, id: string) {
  if (await verifyInternalToken(id, req.headers.get("x-internal-token"))) {
    return prisma.knowledgeSource.findUnique({ where: { id } });
  }
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.knowledgeSource.findFirst({ where: { id, chatbot: { userId: user.id } } });
}

/**
 * Advance processing of a knowledge source by one time-boxed batch. Further batches are
 * scheduled automatically in the background until the source is READY; the dashboard
 * also polls this endpoint to show progress.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sources/[id]/process">) {
  const { id } = await ctx.params;
  const source = await authorize(req, id);
  if (!source) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = new URL(req.url).origin;
  const result = await runBatchAndContinue(source.id, origin);
  return NextResponse.json(serializeSource(result.source, result.busy));
}

export async function GET(req: Request, ctx: RouteContext<"/api/sources/[id]/process">) {
  const { id } = await ctx.params;
  const source = await authorize(req, id);
  if (!source) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(serializeSource(source, source.lockedAt !== null && Date.now() - source.lockedAt.getTime() < 90_000));
}
