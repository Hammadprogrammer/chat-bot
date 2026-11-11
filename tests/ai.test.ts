import { describe, expect, it } from "vitest";
import { buildSystemPrompt, fitVector, toVectorLiteral } from "@/lib/ai";
import { buildContext, citations, type RetrievedChunk } from "@/lib/rag";

const chunk = (over: Partial<RetrievedChunk>): RetrievedChunk => ({ id: "1", content: "c", title: "T", url: null, sourceId: "s", similarity: 0.9, ...over });

describe("prompt + context", () => {
  it("builds a grounded system prompt with the NO_ANSWER rule", () => {
    const p = buildSystemPrompt({ systemPrompt: "Be nice.", botName: "Bot", context: "CTX" });
    expect(p).toContain("Be nice.");
    expect(p).toContain('"Bot"');
    expect(p).toContain("NO_ANSWER");
    expect(p.endsWith("CTX")).toBe(true);
  });

  it("numbers and truncates context", () => {
    const ctx = buildContext([chunk({ content: "a".repeat(100), url: "https://x" }), chunk({ id: "2", content: "b".repeat(100) })], 150);
    expect(ctx).toContain("[1] T (https://x)");
    expect(ctx).not.toContain("[2]");
  });

  it("deduplicates citations", () => {
    expect(citations([chunk({}), chunk({ id: "2" }), chunk({ id: "3", title: "Other", url: "https://o" })])).toEqual([
      { title: "T", url: null },
      { title: "Other", url: "https://o" },
    ]);
  });

  it("fits embeddings to the column size", () => {
    expect(fitVector([1, 2, 3], 3)).toEqual([1, 2, 3]);
    const truncated = fitVector([3, 4, 100, 100], 2);
    expect(truncated).toEqual([0.6, 0.8]);
    expect(fitVector([1, 2], 4)).toEqual([1, 2, 0, 0]);
  });

  it("formats pgvector literals", () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe("[0.1,-2,3]");
  });
});
