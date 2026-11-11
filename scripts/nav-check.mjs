/** Prints the grouped navigation + contact details the crawler will index for a URL.
 *  Usage: node scripts/nav-check.mjs https://example.com  (Node 22.6+ with type stripping) */
import { extractContacts, extractNavigationGroups, htmlToText } from "../lib/text.ts";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/nav-check.mjs <url>");
const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
for (const g of extractNavigationGroups(html)) console.log(`${g.label} (${g.items.length}): ${g.items.join(" | ")}`);
console.log("\ncontacts:", JSON.stringify(extractContacts(html)));
console.log(`body text: ${htmlToText(html).length} chars`);
