/** Clears a provider pause on the latest URL source and nudges the worker; then watches progress.
 *  Usage: node --env-file=.env scripts/resume-source.mjs [baseUrl] */
import { PrismaClient } from "@prisma/client";
const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();
const src = await prisma.knowledgeSource.findFirst({ where: { type: "URL" }, orderBy: { createdAt: "desc" } });
await prisma.knowledgeSource.update({ where: { id: src.id }, data: { pausedUntil: null, lockedAt: null, error: null, status: src.status === "FAILED" ? "PENDING" : src.status } });

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
let last = "";
for (let i = 0; i < 100; i++) {
  const res = await fetch(`${base}/api/sources/${src.id}/process`, { method: i % 4 === 0 ? "POST" : "GET", headers: { cookie } });
  const s = await res.json();
  const line = `${s.status} · ${s.pageCount} pages · ${s.chunkCount} chunks · ${s.progress ?? ""}${s.busy ? " (busy)" : ""}${s.error ? " · " + s.error.slice(0, 100) : ""}`;
  if (line !== last) { console.log(line); last = line; }
  if (s.status === "READY" || s.status === "FAILED") break;
  await new Promise((r) => setTimeout(r, 3000));
}
await prisma.$disconnect();
