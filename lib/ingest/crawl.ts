import { extractContacts, extractLinks, extractNavigationGroups, extractTitle, htmlToText, type NavGroup } from "@/lib/text";
import { fetchPublic } from "./fetch";

export const MAX_CRAWL_PAGES = 150;
export const DEFAULT_CRAWL_PAGES = 50;

export type CrawlPayload = {
  mode: "single" | "crawl";
  queue: string[];
  visited: string[];
  maxPages: number;
  failed: { url: string; error: string }[];
  /** md5 of paragraphs seen on the first crawled page; repeated elsewhere = site boilerplate */
  boilerplate?: string[];
};

export function normalizeUrl(raw: string) {
  const u = new URL(raw.trim());
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

export function newCrawlPayload(startUrl: string, mode: "single" | "crawl", maxPages = MAX_CRAWL_PAGES): CrawlPayload {
  return { mode, queue: [normalizeUrl(startUrl)], visited: [], maxPages: Math.min(maxPages, MAX_CRAWL_PAGES), failed: [] };
}

/** Try to seed the crawl queue from sitemap.xml so the crawl covers the whole site. */
export async function discoverSitemapUrls(startUrl: string, limit: number) {
  try {
    const origin = new URL(startUrl).origin;
    const { buffer } = await fetchPublic(`${origin}/sitemap.xml`, { timeoutMs: 8000, accept: "application/xml,text/xml" });
    const xml = buffer.toString("utf8");
    const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const sameOrigin = urls.filter((u) => u.startsWith(origin) && !u.endsWith(".xml"));
    return sameOrigin.slice(0, limit).map(normalizeUrl);
  } catch {
    return [];
  }
}

export async function fetchPage(url: string) {
  const { buffer, contentType, finalUrl } = await fetchPublic(url);
  if (contentType.includes("application/pdf")) {
    const { extractFromFile } = await import("./extract");
    const { text } = await extractFromFile(buffer, "document.pdf");
    return { text, title: url.split("/").pop() ?? url, links: [] as string[], finalUrl, navigation: [] as NavGroup[], contacts: null as ReturnType<typeof extractContacts> | null };
  }
  const html = buffer.toString("utf8");
  if (!contentType.includes("html") && !/<html/i.test(html)) {
    return { text: html.trim(), title: url, links: [] as string[], finalUrl, navigation: [] as NavGroup[], contacts: null as ReturnType<typeof extractContacts> | null };
  }
  return { text: htmlToText(html), title: extractTitle(html) ?? url, links: extractLinks(html, finalUrl), finalUrl, navigation: extractNavigationGroups(html), contacts: extractContacts(html) };
}
