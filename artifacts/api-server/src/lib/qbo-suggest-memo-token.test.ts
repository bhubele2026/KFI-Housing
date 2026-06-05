import { describe, expect, it } from "vitest";
import { suggestMemoToken } from "./qbo-mapping";

describe("suggestMemoToken", () => {
  it("returns the longest n-gram shared with at least one other unmapped memo", () => {
    // `norm` strips non-alnum and lowercases; `suggestTokens` then
    // drops MEMO_STOP, MONTHS and pure-numeric tokens. "Rent" and
    // months disappear; "3107" is a pure number so it disappears too.
    const memo = "Maple Penda Unit A May 2026";
    const others = [
      "Maple Penda Unit A April 2026",
      "Maple Penda Unit A — late fee",
    ];
    const out = suggestMemoToken(memo, others);
    // Single-character tokens like "a" are dropped by the length<2
    // filter, so the longest shared n-gram is the 3-gram.
    expect(out).toBe("maple penda unit");
  });

  it("strips months, generic stop-words, and pure numeric tokens", () => {
    // "rent"/"for" are MEMO_STOP, "may" is a month, "2026"/"1234"
    // are pure numbers — only "property" survives.
    const out = suggestMemoToken("Rent for May 2026 - Property 1234", []);
    expect(out).toBe("property");
  });

  it("falls back to first 3 tokens when there is no overlap", () => {
    const out = suggestMemoToken("apple banana cherry date", ["unrelated text"]);
    expect(out).toBe("apple banana cherry");
  });

  it("returns empty string when the memo has no usable tokens", () => {
    expect(suggestMemoToken("", [])).toBe("");
    expect(suggestMemoToken("123 456 789", [])).toBe("");
  });

  it("prefers a longer 4-gram over a shorter 2-gram when both overlap", () => {
    const memo = "alpha beta gamma delta epsilon";
    const others = [
      "alpha beta gamma delta — zeta",
      "alpha beta — totally different",
    ];
    expect(suggestMemoToken(memo, others)).toBe("alpha beta gamma delta");
  });
});
