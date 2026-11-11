/** Measures each dependency's latency to find chat bottlenecks. Usage: node --env-file=.env scripts/latency-check.mjs */
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const chat = new OpenAI({ apiKey: process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY, baseURL: process.env.CHAT_BASE_URL || process.env.OPENAI_BASE_URL || undefined });
const models = [process.env.OPENAI_CHAT_MODEL, ...(process.env.OPENAI_CHAT_FALLBACK_MODELS ?? "").split(",").filter(Boolean)];
for (const m of models) {
  const t = Date.now();
  try {
    const r = await chat.chat.completions.create({ model: m, messages: [{ role: "user", content: "Say hello in one short sentence." }], max_tokens: 40 });
    console.log(`chat ${m}: ${Date.now() - t}ms`, JSON.stringify(r.choices[0].message.content));
  } catch (e) {
    console.log(`chat ${m}: ERR`, e.status, (e.message ?? "").slice(0, 80));
  }
}

const emb = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
for (let i = 0; i < 2; i++) {
  const t = Date.now();
  await emb.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL, input: ["how much does it cost"], dimensions: 1536 });
  console.log(`embedding: ${Date.now() - t}ms`);
}

const p = new PrismaClient();
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  await p.chatbot.findFirst();
  console.log(`neon query: ${Date.now() - t}ms`);
}
await p.$disconnect();
