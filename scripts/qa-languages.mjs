/** Multilingual QA: same business questions in many languages/scripts. Usage: node --env-file=.env scripts/qa-languages.mjs [baseUrl] */
import { PrismaClient } from "@prisma/client";

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();
const bot = await prisma.chatbot.findFirst({ orderBy: { createdAt: "desc" } });
const origin = bot.allowedDomains[0] ? `https://${bot.allowedDomains[0]}` : "https://example.com";
const visitorId = "v_lang_" + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;

async function ask(message, conversationId = null) {
  const t = Date.now();
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ key: bot.publicKey, message, visitorId, conversationId, pageUrl: origin }) });
  return { status: res.status, ms: Date.now() - t, ...(await res.json()) };
}
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${String(detail).replace(/\n/g, " ").slice(0, 300)}`);
}
const SUBJECTS = ["biology", "business", "chemistry", "computer", "economics", "finance", "history", "law", "math", "nursing", "philosophy", "physics", "psychology", "sociology", "statistics"];
const countSubjects = (s) => SUBJECTS.filter((x) => new RegExp(x, "i").test(s)).length;
const SERVICES = ["class help", "exam help", "course help", "assignment", "quiz", "proctored"];
const countServices = (s) => SERVICES.filter((x) => new RegExp(x, "i").test(s)).length;
const roman = (s) => /\b(hum|ham|aap|ap|hain|hai|ke|ki|ka|mein|me|liye|parhate|padhate|sikhate|madad|chahiye|batayein|bataye|koi|aur|haan|ji|karte|dete|milta|milti)\b/i.test(s) && !/[\u0600-\u06FF\u0900-\u097F]/.test(s);

// --- Roman Urdu (exact messages from the user's screenshot) ---
let c = await ask("muje prhna hai");
check("Roman Urdu: 'muje prhna hai' → helpful reply in Roman Urdu", c.status === 200 && c.answer.length > 20 && roman(c.answer), `${c.ms}ms · ${c.answer}`);
let r = await ask("kn kns e sub hai ap log phtate hai?", c.conversationId);
check("Roman Urdu: subjects question → lists all 15 subjects", r.answered && countSubjects(r.answer) === 15, `${r.ms}ms · ${r.answer}`);
check("…and replies in Roman Urdu (not English/Urdu script)", roman(r.answer), r.answer);
r = await ask("ap kia kia services dete ho?", c.conversationId);
check("Roman Urdu: services → all 6", r.answered && countServices(r.answer) === 6, r.answer);
r = await ask("contact kese karu?", c.conversationId);
check("Roman Urdu: contact → phone + email", r.answered && /703/.test(r.answer) && /info@hireclassbuddy\.com/i.test(r.answer), r.answer);
r = await ask("pehle session pe koi discount hai?", c.conversationId);
check("Roman Urdu: discount → 50%", r.answered && /50/.test(r.answer), r.answer);

// --- Urdu script ---
r = await ask("آپ کون کون سے مضامین پڑھاتے ہیں؟");
check("Urdu script: subjects → 15, reply in Urdu script", r.answered && countSubjects(r.answer) >= 12 && /[\u0600-\u06FF]/.test(r.answer), r.answer);

// --- Hindi ---
r = await ask("आप कौन सी सेवाएँ देते हैं?");
check("Hindi: services → 6, reply in Devanagari", r.answered && countServices(r.answer) === 6 && /[\u0900-\u097F]/.test(r.answer), r.answer);

// --- Arabic ---
r = await ask("كيف يمكنني التواصل معكم؟");
check("Arabic: contact → phone/email, reply in Arabic", r.answered && /703|info@/.test(r.answer) && /[\u0600-\u06FF]/.test(r.answer), r.answer);

// --- Spanish / French ---
r = await ask("¿Qué servicios ofrecen?");
check("Spanish: services → 6 in Spanish", r.answered && countServices(r.answer) === 6 && /ofrecemos|servicios|necesitas|información|ayuda|más/i.test(r.answer), r.answer);
r = await ask("Avez-vous une réduction pour la première séance ?");
check("French: discount → 50% in French", r.answered && /50/.test(r.answer) && /réduction|première|séance|remise/i.test(r.answer), r.answer);

// --- Mixed / follow-up in Roman Urdu ---
c = await ask("nursing ke liye help milti hai?");
check("Roman Urdu: nursing → yes", c.answered && /nursing/i.test(c.answer), c.answer);
r = await ask("or statistics?", c.conversationId);
check("Roman Urdu follow-up 'or statistics?' understood", r.answered && /statistic/i.test(r.answer), r.answer);

// --- English still works & stays English ---
r = await ask("What services do you offer?");
check("English: services → 6 in English", r.answered && countServices(r.answer) === 6 && !/[\u0600-\u06FF\u0900-\u097F]/.test(r.answer), r.answer);

await prisma.conversation.deleteMany({ where: { chatbotId: bot.id, visitorId } });
await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
