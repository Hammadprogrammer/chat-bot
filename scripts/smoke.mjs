/**
 * End-to-end smoke test against a running dev server.
 * Usage: node --env-file=.env scripts/smoke.mjs [baseUrl]
 */
import { PrismaClient } from "@prisma/client";

const base = process.argv[2] ?? "http://localhost:3100";
const prisma = new PrismaClient();
let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}

// --- login via progressive-enhancement form post ---
async function loginForm(email, password) {
  const html = await (await fetch(`${base}/login`)).text();
  const fd = new FormData();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) {
    fd.append(m[1], (m[2] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }
  fd.append("email", email);
  fd.append("password", password);
  const res = await fetch(`${base}/login`, { method: "POST", body: fd, redirect: "manual" });
  return { status: res.status, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null, body: await res.text() };
}

const bad = await loginForm(process.env.ADMIN_EMAIL, "wrong-password");
check("login rejects wrong password", bad.body.includes("Invalid email or password") && !bad.cookie);
const good = await loginForm(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
check("login succeeds with env admin credentials", good.status === 303 && !!good.cookie, `status ${good.status}`);
const cookie = good.cookie ?? "";
const admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL.toLowerCase() } });
check("admin user bootstrapped in DB with bcrypt hash", admin?.passwordHash?.startsWith("$2") && admin.role === "ADMIN");

const dash = await fetch(`${base}/dashboard`, { headers: { cookie }, redirect: "manual" });
check("dashboard renders for authenticated user", dash.status === 200 && (await dash.text()).includes("Your chatbots"));
const anon = await fetch(`${base}/dashboard`, { redirect: "manual" });
check("dashboard redirects anonymous user", anon.status === 307 && anon.headers.get("location")?.includes("/login"));

// --- create chatbot directly (server actions need RSC protocol) + tenant setup ---
const other = await prisma.user.upsert({ where: { email: "other@example.com" }, update: {}, create: { email: "other@example.com", passwordHash: "x" } });
const bot = await prisma.chatbot.create({
  data: { userId: admin.id, publicKey: "pk_smoke_" + Math.random().toString(36).slice(2, 10), name: "Smoke Bot", botName: "Smoke Bot", allowedDomains: ["example.com", "*.shop.io"], supportEmail: "help@example.com" },
});
const otherBot = await prisma.chatbot.create({ data: { userId: other.id, publicKey: "pk_other_" + Math.random().toString(36).slice(2, 10), name: "Other Tenant Bot" } });

try {
  // Tenant isolation in the dashboard
  const foreign = await fetch(`${base}/dashboard/chatbots/${otherBot.id}`, { headers: { cookie }, redirect: "manual" });
  check("dashboard blocks access to another tenant's chatbot", foreign.status === 307, `status ${foreign.status}`);
  const own = await fetch(`${base}/dashboard/chatbots/${bot.id}/knowledge`, { headers: { cookie } });
  check("knowledge page renders for own chatbot", own.status === 200 && (await own.text()).includes("Add knowledge"));
  const embed = await fetch(`${base}/dashboard/chatbots/${bot.id}/embed`, { headers: { cookie } });
  check("embed page shows script snippet with public key", (await embed.text()).includes(bot.publicKey));

  // Public widget config + domain validation
  const cfgOk = await fetch(`${base}/api/widget/config?key=${bot.publicKey}`, { headers: { origin: "https://www.example.com" } });
  const cfgJson = await cfgOk.json();
  check("widget config served to authorized domain", cfgOk.status === 200 && cfgJson.botName === "Smoke Bot" && cfgJson.handoffEnabled === true);
  check("CORS header echoes origin", cfgOk.headers.get("access-control-allow-origin") === "https://www.example.com");
  const cfgSub = await fetch(`${base}/api/widget/config?key=${bot.publicKey}`, { headers: { origin: "https://a.shop.io" } });
  check("wildcard domain allowed", cfgSub.status === 200);
  const cfgBad = await fetch(`${base}/api/widget/config?key=${bot.publicKey}`, { headers: { origin: "https://evil.com" } });
  check("unauthorized domain rejected (403)", cfgBad.status === 403, `status ${cfgBad.status}`);
  const cfgMissing = await fetch(`${base}/api/widget/config?key=pk_doesnotexist123`, { headers: { origin: "https://example.com" } });
  check("unknown key rejected (404)", cfgMissing.status === 404);
  const pre = await fetch(`${base}/api/chat`, { method: "OPTIONS", headers: { origin: "https://example.com" } });
  check("CORS preflight OK", pre.status === 204);

  // Chat validation / AI-unavailable handling
  const chat = (body, origin = "https://example.com") => fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const invalid = await chat({ key: bot.publicKey, message: "", visitorId: "v_12345" });
  check("chat validates input (400)", invalid.status === 400, `status ${invalid.status}`);
  const chatRes = await chat({ key: bot.publicKey, message: "What are your opening hours?", visitorId: "v_12345", pageUrl: "https://example.com/" });
  const chatJson = await chatRes.json();
  if (process.env.OPENAI_API_KEY) {
    check("chat answers or falls back with handoff", chatRes.status === 200 && typeof chatJson.answer === "string", JSON.stringify(chatJson).slice(0, 120));
  } else {
    check("chat reports AI unavailable cleanly without OPENAI_API_KEY (503)", chatRes.status === 503 && chatJson.code === "ai_unavailable", `status ${chatRes.status}`);
  }
  const chatBadOrigin = await chat({ key: bot.publicKey, message: "hi", visitorId: "v_12345" }, "https://evil.com");
  check("chat rejects unauthorized domain", chatBadOrigin.status === 403);

  // Handoff
  const ho = await fetch(`${base}/api/handoff`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: JSON.stringify({ key: bot.publicKey, email: "visitor@test.com", name: "Vis", message: "Please call me" }) });
  check("handoff request stored", ho.status === 200 && (await prisma.handoffRequest.count({ where: { chatbotId: bot.id } })) === 1);
  const hoBad = await fetch(`${base}/api/handoff`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: JSON.stringify({ key: bot.publicKey, email: "not-an-email", message: "x" }) });
  check("handoff validates email", hoBad.status === 400);

  // Rate limiting (per-ip handoff limit = 5 / 10 min)
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${base}/api/handoff`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: JSON.stringify({ key: bot.publicKey, email: "v@test.com", message: "x" }) });
    if (r.status === 429) limited = true;
  }
  check("handoff rate limit kicks in (429)", limited);

  // Upload API auth + validation
  const upAnon = await fetch(`${base}/api/sources/upload`, { method: "POST", body: new FormData() });
  check("upload requires auth (401)", upAnon.status === 401);
  const fd = new FormData();
  fd.append("chatbotId", otherBot.id);
  fd.append("file", new Blob(["hello world text file content"], { type: "text/plain" }), "notes.txt");
  const upForeign = await fetch(`${base}/api/sources/upload`, { method: "POST", headers: { cookie }, body: fd });
  check("upload blocks other tenant's chatbot (404)", upForeign.status === 404, `status ${upForeign.status}`);
  const fd2 = new FormData();
  fd2.append("chatbotId", bot.id);
  fd2.append("file", new Blob(["binary"], { type: "application/octet-stream" }), "virus.exe");
  const upBad = await fetch(`${base}/api/sources/upload`, { method: "POST", headers: { cookie }, body: fd2 });
  check("upload rejects unsupported file type (400)", upBad.status === 400);
  const fd3 = new FormData();
  fd3.append("chatbotId", bot.id);
  fd3.append("file", new Blob(["The store opens at 9am and closes at 6pm every weekday. Weekend hours are 10am to 4pm."], { type: "text/plain" }), "hours.txt");
  const upOk = await fetch(`${base}/api/sources/upload`, { method: "POST", headers: { cookie }, body: fd3 });
  const upJson = await upOk.json();
  if (process.env.OPENAI_API_KEY) check("txt upload indexed", upOk.status === 200 && upJson.status === "READY", JSON.stringify(upJson));
  else check("txt upload extracted; indexing fails cleanly without OpenAI", upOk.status === 200 && upJson.status === "FAILED" && /OPENAI_API_KEY/.test(upJson.error ?? ""), JSON.stringify(upJson));

  // widget.js served with CORS
  const w = await fetch(`${base}/widget.js`);
  check("widget.js served with CORS", w.status === 200 && w.headers.get("access-control-allow-origin") === "*" && (await w.text()).includes("data-chatbot-key"));
} finally {
  await prisma.chatbot.deleteMany({ where: { id: { in: [bot.id, otherBot.id] } } });
  await prisma.user.delete({ where: { id: other.id } });
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
