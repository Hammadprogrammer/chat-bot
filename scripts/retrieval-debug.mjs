/** Shows what the retriever returns for a question. Usage: node --env-file=.env scripts/retrieval-debug.mjs "question" */
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const q = process.argv[2] ?? "What services do you offer?";
const prisma = new PrismaClient();
const bot = await prisma.chatbot.findFirst({ orderBy: { createdAt: "desc" } });
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
const e = await ai.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL, input: [q], dimensions: 1536 });
const lit = `[${e.data[0].embedding.join(",")}]`;
const rows = await prisma.$queryRawUnsafe(
  `SELECT c."title", left(c."content", 90) AS snippet, 1 - (c."embedding" <=> $1::vector) AS sim
   FROM "Chunk" c WHERE c."chatbotId" = $2 ORDER BY c."embedding" <=> $1::vector LIMIT 8`,
  lit,
  bot.id,
);
console.log(`bot cutoff=${bot.similarityCutoff} chunks=${bot.maxContextChunks}\n`);
for (const r of rows) console.log(Number(r.sim).toFixed(3), "|", r.title?.slice(0, 50), "|", r.snippet.replace(/\n/g, " "));
const kw = await prisma.$queryRawUnsafe(
  `SELECT c."title" FROM "Chunk" c WHERE c."chatbotId" = $2 AND to_tsvector('english', c."content") @@ websearch_to_tsquery('english', $1) LIMIT 5`,
  q,
  bot.id,
);
console.log("\nkeyword hits:", kw.map((k) => k.title?.slice(0, 40)));
await prisma.$disconnect();
