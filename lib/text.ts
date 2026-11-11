const BLOCK_TAGS = "p|div|br|hr|h[1-6]|li|ul|ol|tr|td|th|table|section|article|header|footer|nav|aside|blockquote|pre|dd|dt|dl|figure|figcaption|form|fieldset|main";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
};

export function decodeEntities(input: string) {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract the <title> of an HTML document, if any. */
export function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? normalizeWhitespace(decodeEntities(m[1].replace(/<[^>]+>/g, ""))) : undefined;
}

/** Convert HTML to readable plain text, dropping scripts, styles, nav/footers and tags. */
export function htmlToText(html: string) {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  s = s.replace(new RegExp(`<\\/?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeEntities(s));
}

/**
 * Extract the site's navigation structure (menu link texts, grouped by their dropdown
 * heading when detectable). Menus list the services/pages a business offers, which is
 * exactly what visitors ask about, so it is indexed as its own document.
 */
export function extractNavigation(html: string) {
  return extractNavigationGroups(html).flatMap((g) => g.items);
}

export type NavGroup = { label: string; items: string[] };

const GENERIC_LINK = /^(home|login|log in|sign ?up|sign ?in|register|menu|get started|book now|\W+)$/i;

/**
 * Menu structure with groups, e.g. { label: "Services", items: [...] }.
 * 1) Structural: a dropdown heading (<span>/<button>/<h*>) followed by links nested deeper in
 *    the DOM owns those links ("Services ▾ → …").
 * 2) Fallback: links sharing a URL prefix (/services/*) with ≥3 members form a group.
 * Everything else goes to "Main pages".
 */
export function extractNavigationGroups(html: string): NavGroup[] {
  const blocks = [...html.matchAll(/<(nav|header)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2].replace(/<(svg|style|script)[^>]*>[\s\S]*?<\/\1>/gi, ""));
  const clean = (s: string) => normalizeWhitespace(decodeEntities(s.replace(/<[^>]+>/g, " ")));
  type Link = { text: string; segment: string | null; group: string | null };
  const links: Link[] = [];
  const tokenRe = /<a\b([^>]*)>([\s\S]*?)<\/a>|<(span|button|h[1-6]|p|strong|summary)\b[^>]*>([^<]{2,40})<\/\3>|<(div|ul|ol|li|section|details|menu)\b[^>]*>|<\/(div|ul|ol|li|section|details|menu)>/gi;

  for (const block of blocks) {
    let depth = 0;
    let current: { label: string; depth: number } | null = null;
    for (const m of block.matchAll(tokenRe)) {
      if (m[5] !== undefined) {
        depth++;
      } else if (m[6] !== undefined) {
        depth--;
        if (current && depth < current.depth) current = null;
      } else if (m[2] !== undefined) {
        const text = clean(m[2]);
        if (text.length < 2 || text.length > 80) continue;
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1] ?? "")?.[1] ?? "";
        const path = href.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
        const seg = path.split("/").filter(Boolean);
        const inGroup = current !== null && depth > current.depth;
        if (current && !inGroup) current = null;
        links.push({ text, segment: seg.length >= 2 ? seg[0].toLowerCase() : null, group: inGroup ? current!.label : null });
      } else {
        const text = clean(m[4]);
        if (text.length >= 2 && !/^\W+$/.test(text)) current = { label: text, depth };
      }
    }
  }

  // Fallback grouping by URL prefix for links that no heading claimed.
  const bySegment = new Map<string, number>();
  for (const l of links) if (!l.group && l.segment) bySegment.set(l.segment, (bySegment.get(l.segment) ?? 0) + 1);
  const humanize = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const groups = new Map<string, NavGroup>();
  const seen = new Set<string>();
  for (const l of links) {
    const key = l.text.toLowerCase();
    if (seen.has(key) || GENERIC_LINK.test(l.text)) continue;
    seen.add(key);
    const label = l.group ?? (l.segment && (bySegment.get(l.segment) ?? 0) >= 3 ? humanize(l.segment) : "Main pages");
    if (!groups.has(label)) groups.set(label, { label, items: [] });
    groups.get(label)!.items.push(l.text);
  }
  // Heading-groups with a single item are not real dropdowns → merge into Main pages.
  const result: NavGroup[] = [];
  const main: NavGroup = { label: "Main pages", items: [] };
  for (const g of groups.values()) {
    if (g.label === "Main pages") main.items.push(...g.items);
    else if (g.items.length < 2) main.items.push(...g.items);
    else result.push(g);
  }
  if (main.items.length) result.push(main);
  return result;
}
/** Pull out contact details (emails, phone numbers, WhatsApp links) from a page. */
export function extractContacts(html: string) {
  // Drop SVG paths / inline styles / scripts whose numbers look like phone numbers.
  const text = decodeEntities(html.replace(/<(svg|script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/\s(d|points|viewBox|style)="[^"]*"/gi, " "));
  const emails = [...new Set([...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0].toLowerCase().replace(/\.$/, "")).filter((e) => !/\.(png|jpe?g|svg|gif|webp|css|js)$/i.test(e) && !/example\.com|sentry|wixpress|w3\.org/i.test(e)))];
  const isPhone = (p: string) => {
    const digits = p.replace(/\D/g, "").length;
    const separators = (p.match(/[\s().-]/g) ?? []).length;
    return digits >= 10 && digits <= 15 && (p.startsWith("+") || separators >= 1) && !/\.\d.*\.\d/.test(p);
  };
  const phones = [...new Set([...text.matchAll(/(?:tel:|\b)(\+?\d[\d\s().-]{8,}\d)/gi)].map((m) => m[1].trim()).filter(isPhone))];
  const whatsapp = [...new Set([...text.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>\\]*/gi)].map((m) => m[0]))];
  return { emails: emails.slice(0, 5), phones: phones.slice(0, 5), whatsapp: whatsapp.slice(0, 3) };
}

/** Sentences about opening hours / availability (24/7, weekdays, "round the clock"…). */
export function extractAvailability(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hits = sentences.filter((s) =>
    /\b(24\s?\/\s?7|24x7|24 hours|round[- ]the[- ]clock|available (any ?time|all day|on weekends)|weekends?,? (and )?holidays|opening hours|business hours|working hours|office hours|mon(day)?\s?[-–]\s?(fri|sat|sun)|\d{1,2}\s?(am|pm)\s?[-–to]+\s?\d{1,2}\s?(am|pm))\b/i.test(s),
  );
  return [...new Set(hits.map((s) => normalizeWhitespace(s)).filter((s) => s.length >= 15 && s.length <= 240))].slice(0, 4);
}

/** Extract same-origin links from an HTML document. */
export function extractLinks(html: string, baseUrl: string) {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (m[1].startsWith("#")) continue;
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.origin !== base.origin) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|gz|mp[34]|webm|woff2?|ttf|eot)$/i.test(u.pathname)) continue;
      u.hash = "";
      u.search = "";
      out.add(u.toString().replace(/\/$/, ""));
    } catch {
      /* ignore invalid urls */
    }
  }
  return [...out];
}

/** Rough token estimate (~4 chars per token for English). */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export type ChunkOptions = { maxChars?: number; overlapChars?: number };

/**
 * Split text into overlapping chunks, preferring paragraph then sentence boundaries.
 */
export function chunkText(text: string, { maxChars = 1500, overlapChars = 200 }: ChunkOptions = {}) {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) units.push(p);
    else {
      let buf = "";
      for (const sentence of p.split(/(?<=[.!?])\s+/)) {
        if (sentence.length > maxChars) {
          if (buf) {
            units.push(buf);
            buf = "";
          }
          for (let i = 0; i < sentence.length; i += maxChars) units.push(sentence.slice(i, i + maxChars));
        } else if ((buf + " " + sentence).length > maxChars) {
          units.push(buf);
          buf = sentence;
        } else buf = buf ? `${buf} ${sentence}` : sentence;
      }
      if (buf) units.push(buf);
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (!current) current = unit;
    else if ((current + "\n\n" + unit).length <= maxChars) current += "\n\n" + unit;
    else {
      chunks.push(current);
      const tail = overlapChars > 0 ? current.slice(-overlapChars) : "";
      const overlap = tail.includes(" ") ? tail.slice(tail.indexOf(" ") + 1) : tail;
      current = overlap && (overlap + "\n" + unit).length <= maxChars ? `${overlap}\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 20);
}
