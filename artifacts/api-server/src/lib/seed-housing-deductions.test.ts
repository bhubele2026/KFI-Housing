import { describe, expect, it } from "vitest";
import {
  nameSimilarity,
  rankSuggestions,
  type SuggestionCandidate,
} from "./seed-housing-deductions";

describe("nameSimilarity", () => {
  it("scores 1.0 for identical normalized names", () => {
    expect(nameSimilarity("Jane Smith", "JANE SMITH")).toBe(1);
  });

  it("ignores middle initials when token-matching (typo case from task)", () => {
    // "JANE A SMITH" vs "Jane Smith" — the single-letter "a" is a
    // middle initial and should not penalize the match.
    expect(nameSimilarity("JANE A SMITH", "Jane Smith")).toBe(1);
  });

  it("tolerates one-character typos via Levenshtein", () => {
    // 1 edit out of 11 chars ≈ 0.91
    expect(nameSimilarity("jonathan smith", "johnathan smith")).toBeGreaterThan(
      0.9,
    );
  });

  it("returns 0 for empty input", () => {
    expect(nameSimilarity("", "Jane Smith")).toBe(0);
  });

  it("scores low for unrelated names", () => {
    expect(nameSimilarity("Jane Smith", "Bob Jones")).toBeLessThan(0.4);
  });
});

const propertyNames = new Map<string, string>([
  ["prop-1", "Maple Court"],
  ["prop-2", "Oak Ridge"],
]);

const candidates: SuggestionCandidate[] = [
  { id: "occ-1", name: "Jane Smith", company: "Adient", propertyId: "prop-1" },
  { id: "occ-2", name: "Janet Smyth", company: "Adient", propertyId: "prop-2" },
  // Different employer — must be filtered out even with a perfect name match.
  { id: "occ-3", name: "Jane Smith", company: "Penda Corp", propertyId: "prop-1" },
  // Below the threshold even within the right employer.
  { id: "occ-4", name: "Bob Jones", company: "Adient", propertyId: "prop-1" },
  // Unassigned occupant — should still surface, with propertyName=null.
  { id: "occ-5", name: "Jayne Smith", company: "Adient", propertyId: null },
];

describe("rankSuggestions", () => {
  it("returns same-employer candidates ranked by descending similarity", () => {
    const result = rankSuggestions("JANE A SMITH", "Adient", candidates, propertyNames);
    const ids = result.map((s) => s.occupantId);
    // occ-3 (different company) and occ-4 (low score) excluded.
    expect(ids).not.toContain("occ-3");
    expect(ids).not.toContain("occ-4");
    expect(ids[0]).toBe("occ-1"); // exact-tokens beats fuzzier candidates
    expect(result[0]!.propertyName).toBe("Maple Court");
    expect(result.length).toBeLessThanOrEqual(3);
    // Sorted descending.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it("matches employer case-insensitively and trims whitespace", () => {
    const result = rankSuggestions("JANE A SMITH", "  adient  ", candidates, propertyNames);
    expect(result.length).toBeGreaterThan(0);
  });

  it("reports propertyName as null for an unassigned candidate", () => {
    const result = rankSuggestions("Jayne Smith", "Adient", candidates, propertyNames);
    const occ5 = result.find((s) => s.occupantId === "occ-5");
    expect(occ5).toBeDefined();
    expect(occ5!.propertyName).toBeNull();
  });

  it("returns an empty array when nothing scores above the threshold", () => {
    const result = rankSuggestions("Zzzz Qqqq", "Adient", candidates, propertyNames);
    expect(result).toEqual([]);
  });

  it("caps suggestions to the configured limit", () => {
    const many: SuggestionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `occ-${i}`,
      name: `Jane Smith ${i}`,
      company: "Adient",
      propertyId: null,
    }));
    const result = rankSuggestions("Jane Smith", "Adient", many, new Map(), { limit: 3 });
    expect(result.length).toBe(3);
  });
});
