import { describe, expect, it } from "vitest";
import { chunkText, decodeEntities, extractContacts, extractLinks, extractNavigation, extractNavigationGroups, extractTitle, htmlToText } from "@/lib/text";

describe("htmlToText", () => {
  it("strips scripts, styles, nav/footer and tags", () => {
    const html = `<html><head><title>Hi &amp; bye</title><style>p{}</style></head>
      <body><nav>Menu</nav><h1>Hello</h1><p>World <b>bold</b></p><script>alert(1)</script><footer>foot</footer></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Hello");
    expect(text).toContain("World bold");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("Menu");
    expect(text).not.toContain("foot");
    expect(extractTitle(html)).toBe("Hi & bye");
  });

  it("decodes entities", () => {
    expect(decodeEntities("a &lt; b &#65; &#x42; &nbsp;c")).toBe("a < b A B  c");
  });
});

describe("extractNavigation / extractContacts", () => {
  it("lists menu items and skips generic links", () => {
    const html = `<nav><a href="/">Home</a><a href="/a">Online Class Help</a><a href="/b">Online <b>Exam</b> Help</a><a href="/login">Login</a><a href="/a">Online Class Help</a></nav>`;
    expect(extractNavigation(html)).toEqual(["Online Class Help", "Online Exam Help"]);
  });

  it("groups dropdown items by URL prefix and heading", () => {
    const html = `<header><a href="/">Home</a><a href="/about-us/">About Us</a>
      <div><span>Services </span><ul><li><a href="/services/a/">Class Help</a></li><li><a href="/services/b/">Exam Help</a></li><li><a href="/services/c/">Course Help</a></li></ul></div>
      <div><span>Subjects </span><a href="/subjects/x/">Math Class</a><a href="/subjects/y/">Law Class</a><a href="/subjects/z/">Nursing Class</a></div>
      <a href="/reviews/">Reviews</a></header>`;
    expect(extractNavigationGroups(html)).toEqual([
      { label: "Services", items: ["Class Help", "Exam Help", "Course Help"] },
      { label: "Subjects", items: ["Math Class", "Law Class", "Nursing Class"] },
      { label: "Main pages", items: ["About Us", "Reviews"] },
    ]);
  });

  it("finds real phones/emails and ignores SVG path numbers", () => {
    const html = `<a href="tel:+12027035862">+1 (202) 703-5862</a> <a href="mailto:info@acme.com">info@acme.com</a>
      <svg><path d="M28-.26.36-.65.25-1 7 6.45 8.5 5.25 8.5 4"/></svg> id=61571676454739 <a href="https://wa.me/12027035862\\">wa</a>`;
    const c = extractContacts(html);
    expect(c.emails).toEqual(["info@acme.com"]);
    expect(c.phones).toEqual(["+12027035862", "1 (202) 703-5862"]);
    expect(c.whatsapp).toEqual(["https://wa.me/12027035862"]);
  });
});

describe("extractLinks", () => {
  it("returns only same-origin, non-asset links without hash/query", () => {
    const html = `<a href="/about#team">A</a><a href="https://other.com/x">B</a><a href="/img.png">C</a><a href="/docs?x=1">D</a><a href="mailto:x@y.z">E</a>`;
    expect(extractLinks(html, "https://example.com/home").sort()).toEqual(["https://example.com/about", "https://example.com/docs"]);
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("Short paragraph of text that is long enough.")).toHaveLength(1);
  });

  it("splits long text into bounded overlapping chunks", () => {
    const para = "This is a sentence about the product. ".repeat(20).trim();
    const text = Array.from({ length: 8 }, (_, i) => `Section ${i}. ${para}`).join("\n\n");
    const chunks = chunkText(text, { maxChars: 1000, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(chunks.join(" ")).toContain("Section 7");
  });

  it("drops trivially small fragments", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});
