import { describe, expect, it } from "vitest";
import { ImportLeasePdfResponse } from "@workspace/api-zod";

const VALID_EXTRACTED = {
  propertyName: "Cedar House",
  propertyAddress: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  landlordName: "KFI",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  monthlyRent: 4800,
  securityDeposit: 9600,
  notes: "",
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  confidence: "high" as const,
};

const VALID_RESPONSE = {
  extracted: VALID_EXTRACTED,
  topMatch: null,
  candidates: [],
};

describe("ImportLeasePdfResponse extracted dates", () => {
  it("accepts clean YYYY-MM-DD startDate / endDate", () => {
    expect(ImportLeasePdfResponse.safeParse(VALID_RESPONSE).success).toBe(true);
  });

  it("accepts null startDate and endDate (LLM couldn't find them)", () => {
    expect(
      ImportLeasePdfResponse.safeParse({
        ...VALID_RESPONSE,
        extracted: { ...VALID_EXTRACTED, startDate: null, endDate: null },
      }).success,
    ).toBe(true);
  });

  // The extracted dates use OptionalLeaseDate (see openapi.yaml), which
  // intentionally permits "" alongside null so the review-step UI can render
  // an empty input when the LLM returned a blank string instead of null.
  // Pin that contract here so it can't silently regress.
  it("accepts empty-string startDate and endDate (LLM returned blanks)", () => {
    expect(
      ImportLeasePdfResponse.safeParse({
        ...VALID_RESPONSE,
        extracted: { ...VALID_EXTRACTED, startDate: "", endDate: "" },
      }).success,
    ).toBe(true);
  });

  // "" is intentionally accepted by OptionalLeaseDate, so it is not in this
  // list. Anything that *looks* like a date but isn't a clean YYYY-MM-DD
  // must still be rejected.
  it.each([
    ["space + time suffix", "2026-05-31 00:00:00"],
    ["full ISO with Z", "2026-05-31T00:00:00.000Z"],
    ["MM/DD/YYYY", "05/31/2026"],
    ["non-date garbage", "not-a-date"],
    ["missing zero pad", "2026-5-31"],
  ])("rejects malformed startDate: %s", (_label, bad) => {
    const result = ImportLeasePdfResponse.safeParse({
      ...VALID_RESPONSE,
      extracted: { ...VALID_EXTRACTED, startDate: bad },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path[i.path.length - 1] === "startDate",
        ),
      ).toBe(true);
    }
  });

  it.each([
    ["space + time suffix", "2026-05-31 00:00:00"],
    ["full ISO with Z", "2026-05-31T00:00:00.000Z"],
    ["MM/DD/YYYY", "05/31/2026"],
  ])("rejects malformed endDate: %s", (_label, bad) => {
    const result = ImportLeasePdfResponse.safeParse({
      ...VALID_RESPONSE,
      extracted: { ...VALID_EXTRACTED, endDate: bad },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path[i.path.length - 1] === "endDate",
        ),
      ).toBe(true);
    }
  });
});
