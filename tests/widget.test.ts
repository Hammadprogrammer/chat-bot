import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Extract the pure helpers from the browser widget so they can be unit-tested in Node.
const src = readFileSync(new URL("../public/widget.js", import.meta.url), "utf8");
const lumSrc = src.match(/function luminance[\s\S]*?\n {2}}\n/)?.[0] ?? "";
const cssSrc = src.match(/function css\(c\) \{[\s\S]*?\n {2}}\n/)?.[0] ?? "";
const helpers = new Function(`${lumSrc}\n${cssSrc}\nreturn { luminance, css };`)() as {
  luminance: (hex: string) => number;
  css: (c: { primaryColor: string; position?: string }) => string;
};

describe("widget auto-contrast", () => {
  it("computes luminance", () => {
    expect(helpers.luminance("#ffffff")).toBeCloseTo(1, 2);
    expect(helpers.luminance("#000000")).toBe(0);
    expect(helpers.luminance("#2563eb")).toBeLessThan(0.6);
    expect(helpers.luminance("#f5a623")).toBeGreaterThan(0.3);
    expect(helpers.luminance("not-a-color")).toBe(0);
  });

  it("uses dark text/icons on a white primary color", () => {
    const css = helpers.css({ primaryColor: "#ffffff" });
    expect(css).toContain("color:#111827");
    expect(css).toContain("fill:#111827");
    expect(css).not.toMatch(/\.u\{[^}]*color:#fff/);
    expect(css).toContain("border:1px solid rgba(0,0,0,.12)");
  });

  it("uses white text/icons on a dark primary color", () => {
    const css = helpers.css({ primaryColor: "#0b1f3a", position: "left" });
    expect(css).toMatch(/\.h\{[^}]*color:#fff/);
    expect(css).toMatch(/\.u\{[^}]*background:#0b1f3a;color:#fff/);
    expect(css).toContain("left:20px");
  });
});
