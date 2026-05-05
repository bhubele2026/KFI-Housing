import { describe, it, expect } from "vitest";
import { addMonthsToYMD, formatYMDPretty, parseYMD } from "./lease-dates";

describe("parseYMD", () => {
  describe("happy path", () => {
    it("parses a clean YYYY-MM-DD into numeric parts", () => {
      expect(parseYMD("2026-05-31")).toEqual({ year: 2026, month: 5, day: 31 });
    });

    it("parses a leap-day date", () => {
      expect(parseYMD("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    });

    it("parses zero-padded single-digit month and day", () => {
      expect(parseYMD("2026-01-05")).toEqual({ year: 2026, month: 1, day: 5 });
    });
  });

  describe("throws loudly on the previously-problematic legacy formats", () => {
    // These shapes used to silently produce `NaN days left` in the
    // Renewal Alerts panel. The defensive layers (a startup SQL job and
    // a server-side normalize call) have been removed in favour of
    // failing visibly here.
    it("throws on a 'YYYY-MM-DD HH:MM:SS' suffix", () => {
      expect(() => parseYMD("2026-05-31 00:00:00")).toThrow(
        /2026-05-31 00:00:00/,
      );
    });

    it("throws on an ISO 'T'-separated datetime", () => {
      expect(() => parseYMD("2026-05-31T00:00:00.000Z")).toThrow(
        /2026-05-31T00:00:00\.000Z/,
      );
    });

    it("throws on a slash-separated date", () => {
      expect(() => parseYMD("2026/05/31")).toThrow();
    });

    it("throws on US-style M/D/YYYY", () => {
      expect(() => parseYMD("5/31/2026")).toThrow();
    });

    it("throws on an empty string", () => {
      expect(() => parseYMD("")).toThrow();
    });

    it("throws on a non-string input", () => {
      expect(() => parseYMD(undefined as unknown as string)).toThrow();
      expect(() => parseYMD(null as unknown as string)).toThrow();
      expect(() => parseYMD(20260531 as unknown as string)).toThrow();
    });
  });

  describe("rejects shapes that pass the regex but aren't real calendar dates", () => {
    it("throws on Feb 30", () => {
      expect(() => parseYMD("2025-02-30")).toThrow(/not a real calendar date/);
    });

    it("throws on Feb 29 in a non-leap year", () => {
      expect(() => parseYMD("2025-02-29")).toThrow(/not a real calendar date/);
    });

    it("throws on month 13", () => {
      expect(() => parseYMD("2025-13-01")).toThrow(/not a real calendar date/);
    });

    it("throws on day 00", () => {
      expect(() => parseYMD("2025-05-00")).toThrow(/not a real calendar date/);
    });
  });
});

describe("addMonthsToYMD", () => {
  describe("year wrap", () => {
    it("rolls Dec → next Jan when adding 1 month", () => {
      expect(addMonthsToYMD("2026-12-15", 1)).toBe("2027-01-15");
    });

    it("rolls Nov → next Feb when adding 3 months", () => {
      expect(addMonthsToYMD("2026-11-10", 3)).toBe("2027-02-10");
    });

    it("crosses multiple year boundaries when adding many months", () => {
      expect(addMonthsToYMD("2026-08-05", 30)).toBe("2029-02-05");
    });
  });

  describe("month-end clamping", () => {
    it("clamps Jan 31 + 1 month → Feb 28 in a non-leap year", () => {
      expect(addMonthsToYMD("2026-01-31", 1)).toBe("2026-02-28");
    });

    it("clamps Jan 31 + 1 month → Feb 29 in a leap year", () => {
      expect(addMonthsToYMD("2024-01-31", 1)).toBe("2024-02-29");
    });

    it("clamps Mar 31 + 1 month → Apr 30 (30-day month)", () => {
      expect(addMonthsToYMD("2026-03-31", 1)).toBe("2026-04-30");
    });

    it("clamps Aug 31 + 6 months → Feb 28 in a non-leap year", () => {
      expect(addMonthsToYMD("2025-08-31", 6)).toBe("2026-02-28");
    });

    it("clamps Aug 31 + 6 months → Feb 29 when the target Feb is a leap-year Feb", () => {
      expect(addMonthsToYMD("2023-08-31", 6)).toBe("2024-02-29");
    });
  });

  describe("+6 month and +12 month offsets across year boundaries", () => {
    it("adds 6 months from mid-year without crossing a year boundary", () => {
      expect(addMonthsToYMD("2026-01-15", 6)).toBe("2026-07-15");
    });

    it("adds 6 months from late in the year and crosses into the next year", () => {
      expect(addMonthsToYMD("2026-09-15", 6)).toBe("2027-03-15");
    });

    it("adds 12 months and lands on the same month/day in the next year", () => {
      expect(addMonthsToYMD("2026-01-15", 12)).toBe("2027-01-15");
    });

    it("adds 12 months from Dec 1 → Dec 1 of the following year", () => {
      expect(addMonthsToYMD("2026-12-01", 12)).toBe("2027-12-01");
    });

    it("adds 12 months from Feb 29 (leap year) and clamps to Feb 28 in the non-leap target year", () => {
      expect(addMonthsToYMD("2024-02-29", 12)).toBe("2025-02-28");
    });
  });

  describe("stability when the day already fits the target month", () => {
    it("preserves the day when adding 1 month and the day exists in the target month", () => {
      expect(addMonthsToYMD("2026-01-15", 1)).toBe("2026-02-15");
    });

    it("preserves the day when adding 6 months and the day exists in the target month", () => {
      expect(addMonthsToYMD("2026-04-10", 6)).toBe("2026-10-10");
    });

    it("preserves the day on day 1, where every month fits", () => {
      expect(addMonthsToYMD("2026-05-01", 7)).toBe("2026-12-01");
    });

    it("returns the same date when adding 0 months", () => {
      expect(addMonthsToYMD("2026-07-04", 0)).toBe("2026-07-04");
    });
  });

  describe("output formatting", () => {
    it("zero-pads single-digit months and days", () => {
      expect(addMonthsToYMD("2026-01-05", 1)).toBe("2026-02-05");
    });

    it("returns a 10-character YYYY-MM-DD string", () => {
      const result = addMonthsToYMD("2026-01-15", 12);
      expect(result).toHaveLength(10);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("propagates parseYMD's loud failure on malformed input", () => {
    it("throws on a stray time suffix instead of returning a NaN-bearing string", () => {
      expect(() => addMonthsToYMD("2026-05-31 00:00:00", 12)).toThrow(
        /2026-05-31 00:00:00/,
      );
    });

    it("throws on an empty string", () => {
      expect(() => addMonthsToYMD("", 12)).toThrow();
    });
  });
});

describe("formatYMDPretty", () => {
  it("returns a non-empty locale string for a clean date", () => {
    // Locale formatting varies by environment, so we only assert the
    // year shows up — the important contract is "doesn't crash and
    // doesn't render NaN" on a clean input.
    const out = formatYMDPretty("2026-05-31");
    expect(out).toContain("2026");
    expect(out).not.toContain("NaN");
  });

  it("throws on a stray time suffix instead of silently producing 'Invalid Date'", () => {
    expect(() => formatYMDPretty("2026-05-31 00:00:00")).toThrow(
      /2026-05-31 00:00:00/,
    );
  });
});
