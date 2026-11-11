/** Verifies the configured AI provider: embeddings (1536 dims) + chat latency per model.
 *  Usage: node --env-file=.env scripts/ai-check.mjs [model ...] */
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 30_000, maxRetries: 0 });
console.log("provider:", process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");

const emb = await client.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL, input: ["hello world"], dimensions: 1536 });
console.log("embeddings OK:", emb.data[0].embedding.length, "dims");

const models = process.argv.slice(2).length ? process.argv.slice(2) : [process.env.OPENAI_CHAT_MODEL];
for (const model of models) {
  const t = Date.now();
  try {
    const chat = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: "You are a helpful assistant. Answer briefly." }, { role: "user", content: "In one sentence, what is a chatbot?" }],
      max_tokens: 80,
    });
    console.log(`${model}: OK in ${Date.now() - t}ms ->`, JSON.stringify(chat.choices[0].message.content?.slice(0, 100)), "· tokens:", chat.usage?.total_tokens);
  } catch (e) {
    console.log(`${model}: FAILED in ${Date.now() - t}ms ->`, e.status ?? "", (e.message ?? String(e)).slice(0, 160));
  }
}
