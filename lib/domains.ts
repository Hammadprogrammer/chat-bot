/** Normalize a user-supplied domain entry: strips scheme, path, port and lowercases. */
export function normalizeDomain(input: string) {
  let d = input.trim().toLowerCase();
  if (!d) return "";
  d = d.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];
  return d.replace(/^www\./, "");
}

export function parseDomainList(raw: string) {
  return [...new Set(raw.split(/[\n,\s]+/).map(normalizeDomain).filter(Boolean))];
}

export function hostnameFromUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether `hostname` is permitted by the allow-list. Entries match exactly (with or
 * without `www.`) or as wildcards (`*.example.com` matches any subdomain and the apex).
 * An empty allow-list permits every origin.
 */
export function isDomainAllowed(hostname: string | null, allowed: string[]) {
  if (allowed.length === 0) return true;
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host === "localhost" || host === "127.0.0.1") return allowed.some((a) => a === "localhost" || a === "127.0.0.1");
  return allowed.some((entry) => {
    const e = normalizeDomain(entry.replace(/^\*\./, "")) || entry;
    if (entry.startsWith("*.")) return host === e || host.endsWith(`.${e}`);
    return host === e;
  });
}
