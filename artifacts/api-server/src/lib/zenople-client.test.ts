import { describe, it, expect } from "vitest";
import { saturdayFromAccountingPeriod } from "./zenople-client";
import { isSaturdayDate } from "./pay-week";

describe("saturdayFromAccountingPeriod", () => {
  it("maps a Sunday AccountingPeriod to the preceding Saturday end-date", () => {
    // Zenople AccountingPeriod is always a Sunday; the Mon→Sat pay-week's
    // Saturday end-date is the day before.
    expect(saturdayFromAccountingPeriod("2025-06-29")).toBe("2025-06-28");
    expect(saturdayFromAccountingPeriod("2025-07-06")).toBe("2025-07-05");
    expect(saturdayFromAccountingPeriod("2026-06-07")).toBe("2026-06-06");
  });

  it("accepts an ISO datetime and uses only the date part", () => {
    expect(saturdayFromAccountingPeriod("2025-06-29T00:00:00.000Z")).toBe(
      "2025-06-28",
    );
  });

  it("always returns a Saturday or null", () => {
    const out = saturdayFromAccountingPeriod("2025-06-29");
    expect(out).not.toBeNull();
    expect(isSaturdayDate(out as string)).toBe(true);
  });

  it("returns null for missing or unparseable input", () => {
    expect(saturdayFromAccountingPeriod(undefined)).toBeNull();
    expect(saturdayFromAccountingPeriod("")).toBeNull();
    expect(saturdayFromAccountingPeriod("not-a-date")).toBeNull();
  });

  it("returns null when the day-before is not a Saturday (non-Sunday input)", () => {
    // A Monday minus one day is a Sunday, not a Saturday → rejected, so a
    // malformed (non-Sunday) AccountingPeriod can never silently produce a
    // wrong pay-week.
    expect(saturdayFromAccountingPeriod("2025-06-30")).toBeNull();
  });
});
