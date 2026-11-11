/** Re-indexes every URL source of the first chatbot via the API and watches progress until READY.
 *  Usage: node --env-file=.env scripts/reindex-check.mjs [baseUrl] */
import { PrismaClient } from "@prisma/client";

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();

async function login() {
  const html = await (await fetch(`${base}/login`)).text();
  const fd = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) fd.append(m[1], (m[2] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  fd.append("email", process.env.ADMIN_EMAIL);
  fd.append("password", process.env.ADMIN_PASSWORD);
  const res = await fetch(`${base}/login`, { method: "POST", body: fd, redirect: "manual" });
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}

const cookie = await login();
const source = await prisma.knowledgeSource.findFirst({ where: { type: "URL" }, orderBy: { createdAt: "desc" } });
if (!source) { console.log("no URL source found"); process.exit(1); }
console.log("source:", source.name, "| status:", source.status, "| chunks:", source.chunkCount);

// Reset like the Re-index button does (blue/green: existing chunks stay until replaced)
const p = source.payload;
await prisma.knowledgeSource.update({ where: { id: source.id }, data: { status: "PENDING", error: null, pageCount: 0, lockedAt: null, pausedUntil: null, payload: { ...p, queue: [source.url], visited: [], failed: [], boilerplate: [] } } });

const started = Date.now();
let last = "";
for (let i = 0; i < 120; i++) {
  const res = await fetch(`${base}/api/sources/${source.id}/process`, { method: i % 4 === 0 ? "POST" : "GET", headers: { cookie } });
  const s = await res.json();
  const line = `${s.status} · ${s.pageCount} pages · ${s.chunkCount} chunks · ${s.progress ?? ""} ${s.busy ? "(worker busy)" : ""} ${s.error ? "· " + s.error : ""}`;
  if (line !== last) {
    console.log(`[${Math.round((Date.now() - started) / 1000)}s]`, line);
    last = line;
  }
  if (s.status === "READY" || s.status === "FAILED") break;
  await new Promise((r) => setTimeout(r, 3000));
}

const final = await prisma.knowledgeSource.findUnique({ where: { id: source.id } });
console.log("\nfinal:", final.status, "| pages:", final.pageCount, "| chunks:", final.chunkCount, "| skipped:", final.payload?.failed?.length ?? 0);
if (final.payload?.failed?.length) console.log("skipped pages:", final.payload.failed.slice(0, 5));
await prisma.$disconnect();
