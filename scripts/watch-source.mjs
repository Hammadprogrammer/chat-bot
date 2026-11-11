/** Watches the latest URL source until it finishes. Usage: node --env-file=.env scripts/watch-source.mjs */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
for (let i = 0; i < 60; i++) {
  const s = await p.knowledgeSource.findFirst({ where: { type: "URL" }, orderBy: { createdAt: "desc" } });
  const paused = s.pausedUntil && s.pausedUntil > new Date() ? `paused until ${s.pausedUntil.toLocaleTimeString()}` : "";
  console.log(new Date().toLocaleTimeString(), s.status, "pages", s.pageCount, "chunks", s.chunkCount, "queued", s.payload?.queue?.length ?? 0, paused, s.error ?? "");
  if (s.status !== "PROCESSING" && s.status !== "PENDING") break;
  await new Promise((r) => setTimeout(r, 15000));
}
await p.$disconnect();
