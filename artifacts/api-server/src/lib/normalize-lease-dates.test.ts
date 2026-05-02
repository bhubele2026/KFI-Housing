import { describe, expect, it } from "vitest";
import {
  normalizeDateOnly,
  normalizeLeaseDates,
} from "./normalize-lease-dates";

describe("normalizeDateOnly", () => {
  it("returns plain YYYY-MM-DD values unchanged", () => {
    expect(normalizeDateOnly("2026-05-31")).toBe("2026-05-31");
  });

  it("strips a trailing space-and-time component", () => {
    expect(normalizeDateOnly("2026-05-31 00:00:00")).toBe("2026-05-31");
    expect(normalizeDateOnly("2026-05-31 12:34:56.789")).toBe("2026-05-31");
  });

  it("strips a trailing ISO 'T'-separated time component", () => {
    expect(normalizeDateOnly("2026-05-31T00:00:00")).toBe("2026-05-31");
    expect(normalizeDateOnly("2026-05-31T00:00:00.000Z")).toBe("2026-05-31");
  });

  it("preserves empty / falsy inputs as-is (no NPE on optional fields)", () => {
    expect(normalizeDateOnly("")).toBe("");
    expect(normalizeDateOnly(undefined)).toBeUndefined();
    expect(normalizeDateOnly(null)).toBeNull();
  });
});

describe("normalizeLeaseDates", () => {
  it("normalizes both startDate and endDate when present", () => {
    const out = normalizeLeaseDates({
      id: "l1",
      startDate: "2024-01-01 00:00:00",
      endDate: "2026-05-31 00:00:00",
      monthlyRent: 4800,
    });
    expect(out).toEqual({
      id: "l1",
      startDate: "2024-01-01",
      endDate: "2026-05-31",
      monthlyRent: 4800,
    });
  });

  it("leaves other fields untouched", () => {
    const out = normalizeLeaseDates({
      id: "l1",
      startDate: "2024-01-01",
      endDate: "2026-05-31",
      notes: "keep me",
      status: "Active" as const,
    });
    expect(out.notes).toBe("keep me");
    expect(out.status).toBe("Active");
  });

  it("does not invent fields that were absent (PATCH-style partial input)", () => {
    const out = normalizeLeaseDates({ endDate: "2026-05-31 00:00:00" });
    expect(out).toEqual({ endDate: "2026-05-31" });
    expect("startDate" in out).toBe(false);
  });

  it("returns a copy rather than mutating the input", () => {
    const input = {
      id: "l1",
      startDate: "2024-01-01 00:00:00",
      endDate: "2026-05-31 00:00:00",
    };
    const out = normalizeLeaseDates(input);
    expect(input.startDate).toBe("2024-01-01 00:00:00");
    expect(input.endDate).toBe("2026-05-31 00:00:00");
    expect(out.startDate).toBe("2024-01-01");
    expect(out.endDate).toBe("2026-05-31");
  });
});
