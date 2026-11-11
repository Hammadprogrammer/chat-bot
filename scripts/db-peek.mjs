/** Quick look at every chatbot's indexed data. Usage: node --env-file=.env scripts/db-peek.mjs */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
for (const bot of await p.chatbot.findMany({ orderBy: { createdAt: "asc" } })) {
  console.log(`\n=== ${bot.name} (${bot.id}) · website ${bot.websiteUrl ?? "-"} · domains ${bot.allowedDomains.join(",") || "-"} · cutoff ${bot.similarityCutoff}`);
  const sources = await p.knowledgeSource.findMany({ where: { chatbotId: bot.id }, select: { id: true, type: true, name: true, url: true, status: true, chunkCount: true, pageCount: true, error: true, payload: true } });
  for (const s of sources) {
    const pl = s.payload ?? {};
    console.log(` - [${s.type}] ${s.name} · ${s.status} · ${s.pageCount} pages · ${s.chunkCount} chunks${s.error ? " · ERR " + s.error.slice(0, 100) : ""}${pl.failed?.length ? ` · ${pl.failed.length} failed pages` : ""}`);
    if (pl.failed?.length) for (const f of pl.failed.slice(0, 5)) console.log(`     x ${f.url} → ${f.error}`);
  }
  const ov = await p.chunk.findMany({ where: { chatbotId: bot.id, title: { startsWith: "Website overview" } }, select: { content: true } });
  for (const o of ov) console.log("   overview:", o.content.slice(0, 700).replace(/\n/g, " ⏎ "));
}
await p.$disconnect();
