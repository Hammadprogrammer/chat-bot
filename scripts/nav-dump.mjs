/** Dumps a simplified view of a page's nav/header HTML. Usage: node scripts/nav-dump.mjs <url> */
const html = await (await fetch(process.argv[2], { headers: { "user-agent": "Mozilla/5.0" } })).text();
const blocks = [...html.matchAll(/<(nav|header)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[0]);
for (const b of blocks) {
  const s = b
    .replace(/<(svg|style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+/g, " ")
    .replace(/ (class|style|aria-[\w-]+|data-[\w-]+|role|tabindex|id|target|rel|title|alt|src|width|height|loading|decoding|sizes|srcset)="[^"]*"/g, "")
    .replace(/<!--.*?-->/g, "");
  console.log(s.slice(0, 5000), "\n-----");
}
