import { beforeEach, describe, expect, it } from "vitest";
import { isDomainAllowed, normalizeDomain, parseDomainList } from "@/lib/domains";
import { assertPublicUrl } from "@/lib/ingest/fetch";
import { parseGitHubUrl } from "@/lib/ingest/github";
import { _resetRateLimiter, rateLimit } from "@/lib/rate-limit";

describe("domains", () => {
  it("normalizes user input", () => {
    expect(normalizeDomain("https://WWW.Example.com/path?x=1")).toBe("example.com");
    expect(normalizeDomain("example.com:3000")).toBe("example.com");
    expect(parseDomainList("a.com, https://b.com\n*.c.com  a.com")).toEqual(["a.com", "b.com", "*.c.com"]);
  });

  it("enforces the allow-list", () => {
    const allowed = ["example.com", "*.shop.io"];
    expect(isDomainAllowed("example.com", allowed)).toBe(true);
    expect(isDomainAllowed("www.example.com", allowed)).toBe(true);
    expect(isDomainAllowed("evil.com", allowed)).toBe(false);
    expect(isDomainAllowed("example.com.evil.com", allowed)).toBe(false);
    expect(isDomainAllowed("a.shop.io", allowed)).toBe(true);
    expect(isDomainAllowed("shop.io", allowed)).toBe(true);
    expect(isDomainAllowed(null, allowed)).toBe(false);
    expect(isDomainAllowed("localhost", allowed)).toBe(false);
    expect(isDomainAllowed("localhost", ["localhost"])).toBe(true);
  });

  it("allows everything when the list is empty", () => {
    expect(isDomainAllowed("anything.com", [])).toBe(true);
    expect(isDomainAllowed(null, [])).toBe(true);
  });
});

describe("rateLimit", () => {
  beforeEach(() => _resetRateLimiter());

  it("blocks after the limit within the window and resets afterwards", () => {
    const t = 1_000_000;
    expect(rateLimit("k", 2, 1000, t).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, t + 10).ok).toBe(true);
    const third = rateLimit("k", 2, 1000, t + 20);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSec).toBe(1);
    expect(rateLimit("k", 2, 1000, t + 1001).ok).toBe(true);
    expect(rateLimit("other", 2, 1000, t + 20).ok).toBe(true);
  });
});

describe("assertPublicUrl (SSRF)", () => {
  it("rejects private, loopback and non-http targets", async () => {
    for (const bad of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "ftp://example.com", "http://[::1]/", "not a url"]) {
      await expect(assertPublicUrl(bad)).rejects.toThrow();
    }
  });
  it("accepts public hosts", async () => {
    await expect(assertPublicUrl("https://example.com/page")).resolves.toBeInstanceOf(URL);
  });
});

describe("parseGitHubUrl", () => {
  it("parses owner/repo/branch", () => {
    expect(parseGitHubUrl("https://github.com/vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js", branch: undefined });
    expect(parseGitHubUrl("github.com/o/r/tree/dev")).toEqual({ owner: "o", repo: "r", branch: "dev" });
    expect(() => parseGitHubUrl("https://gitlab.com/o/r")).toThrow();
  });
});
