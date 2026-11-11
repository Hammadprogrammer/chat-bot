import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchError extends Error {}

const USER_AGENT = "Mozilla/5.0 (compatible; MultiSiteChatbot/1.0; +https://github.com)";
const MAX_BODY_BYTES = 3 * 1024 * 1024;

function isPrivateIp(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

/** Reject URLs that point at private networks (SSRF protection). */
export async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("Invalid URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw new FetchError("Only http(s) URLs are supported");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FetchError("URL host is not allowed");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new FetchError("URL host is not allowed");
    return url;
  }
  if (process.env.NODE_ENV === "test") return url;
  // DNS can be flaky (and IPv6-only answers fail on IPv4-only networks): try all records, retry once.
  let addresses: { address: string }[] = [];
  for (let attempt = 0; attempt < 2 && addresses.length === 0; attempt++) {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      try {
        addresses = await lookup(host, { all: true, family: 4 });
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  if (addresses.length === 0) throw new FetchError(`Could not resolve host ${host}`);
  if (addresses.some((a) => isPrivateIp(a.address))) throw new FetchError("URL host resolves to a private address");
  return url;
}

/** Fetch a public URL with timeout, size cap and redirect safety. */
export async function fetchPublic(raw: string, init: { timeoutMs?: number; accept?: string } = {}) {
  const url = await assertPublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: init.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status} for ${url}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) throw new FetchError("Response too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) throw new FetchError("Response too large");
    return { buffer: buf, contentType: res.headers.get("content-type") ?? "", finalUrl: res.url || url.toString() };
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(e instanceof Error && e.name === "AbortError" ? `Timed out fetching ${url}` : `Failed to fetch ${url}`);
  } finally {
    clearTimeout(timer);
  }
}
