import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeOverallRating,
  daysUntil,
  EMPTY_RATINGS,
  getRenewalInfo,
} from "./mockData";

describe("computeOverallRating", () => {
  it("returns null when nothing is rated (all zeros)", () => {
    expect(computeOverallRating(EMPTY_RATINGS)).toBeNull();
  });

  it("excludes zero (not-yet-rated) categories from the average", () => {
    // Rated values: 4 and 2 → average 3. The four zeros should be ignored
    // rather than dragging the average down to 1.
    const result = computeOverallRating({
      landlord: 4,
      cleanliness: 0,
      amenities: 2,
      occupants: 0,
      location: 0,
      valueForMoney: 0,
    });
    expect(result).toBe(3);
  });

  it("computes a simple average when every category is rated", () => {
    // (5 + 4 + 5 + 4 + 4 + 3) / 6 = 4.166… → rounded to 4.2
    const result = computeOverallRating({
      landlord: 5,
      cleanliness: 4,
      amenities: 5,
      occupants: 4,
      location: 4,
      valueForMoney: 3,
    });
    expect(result).toBe(4.2);
  });

  it("rounds the result to one decimal place", () => {
    // (4 + 4 + 4 + 5 + 5 + 5) / 6 = 4.5 exactly
    expect(
      computeOverallRating({
        landlord: 4,
        cleanliness: 4,
        amenities: 4,
        occupants: 5,
        location: 5,
        valueForMoney: 5,
      }),
    ).toBe(4.5);

    // (5 + 4 + 4 + 4 + 4 + 4) / 6 = 4.166… → rounded to 4.2
    expect(
      computeOverallRating({
        landlord: 5,
        cleanliness: 4,
        amenities: 4,
        occupants: 4,
        location: 4,
        valueForMoney: 4,
      }),
    ).toBe(4.2);

    // Single rated category of 3 → 3.0 (no rounding noise)
    expect(
      computeOverallRating({
        landlord: 3,
        cleanliness: 0,
        amenities: 0,
        occupants: 0,
        location: 0,
        valueForMoney: 0,
      }),
    ).toBe(3);
  });

  it("returns null for null input", () => {
    expect(computeOverallRating(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(computeOverallRating(undefined)).toBeNull();
  });
});

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, n: number): Date {
  const out = new Date(base);
  out.setDate(out.getDate() + n);
  return out;
}

describe("daysUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for today's date", () => {
    expect(daysUntil("2025-06-15")).toBe(0);
  });

  it("returns positive days for a future date", () => {
    expect(daysUntil("2025-06-30")).toBe(15);
  });

  it("returns negative days for a past date", () => {
    expect(daysUntil("2025-06-10")).toBe(-5);
  });

  it("parses YYYY-MM-DD as a local calendar date (no timezone drift)", () => {
    // If the implementation parsed "2025-06-15" as UTC midnight, then in any
    // timezone west of UTC (e.g. America/Los_Angeles) the resulting Date would
    // fall on June 14 in local time and daysUntil would return -1 instead of 0
    // when "today" is also June 15. This guards that path.
    expect(daysUntil("2025-06-15")).toBe(0);
    expect(daysUntil("2025-06-16")).toBe(1);
    expect(daysUntil("2025-06-14")).toBe(-1);
  });

  it("ignores the current time-of-day when comparing", () => {
    // System time is set to 10:30 AM. End-of-day on the same date should
    // still be 0 days away, not negative.
    vi.setSystemTime(new Date(2025, 5, 15, 23, 59, 59));
    expect(daysUntil("2025-06-15")).toBe(0);
    vi.setSystemTime(new Date(2025, 5, 15, 0, 0, 1));
    expect(daysUntil("2025-06-15")).toBe(0);
  });
});

describe("getRenewalInfo", () => {
  // Use a fixed "today" so the test is deterministic regardless of when it runs.
  const TODAY = new Date(2025, 5, 15, 9, 0, 0); // June 15 2025, 9:00 local

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns level 'expired' for a date already in the past", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, -10)));
    expect(info.level).toBe("expired");
    expect(info.days).toBe(-10);
    expect(info.label).toBe("Expired 10 days ago");
    expect(info.shortLabel).toBe("−10d");
  });

  it("uses the singular form for 'Expired 1 day ago'", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, -1)));
    expect(info.level).toBe("expired");
    expect(info.label).toBe("Expired 1 day ago");
  });

  it("returns level 'critical' with label 'Expires today' for today", () => {
    const info = getRenewalInfo(ymd(TODAY));
    expect(info.level).toBe("critical");
    expect(info.days).toBe(0);
    expect(info.label).toBe("Expires today");
    expect(info.shortLabel).toBe("Today");
  });

  it("returns level 'critical' at the 30-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 30)));
    expect(info.level).toBe("critical");
    expect(info.days).toBe(30);
    expect(info.label).toBe("30 days left");
    expect(info.shortLabel).toBe("30d");
  });

  it("returns level 'warning' just past the 30-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 31)));
    expect(info.level).toBe("warning");
    expect(info.days).toBe(31);
  });

  it("returns level 'warning' at the 60-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 60)));
    expect(info.level).toBe("warning");
    expect(info.days).toBe(60);
    expect(info.label).toBe("60 days left");
    expect(info.shortLabel).toBe("60d");
  });

  it("returns level 'soon' just past the 60-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 61)));
    expect(info.level).toBe("soon");
    expect(info.days).toBe(61);
  });

  it("returns level 'soon' at the 90-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 90)));
    expect(info.level).toBe("soon");
    expect(info.days).toBe(90);
    expect(info.label).toBe("90 days left");
    expect(info.shortLabel).toBe("90d");
  });

  it("returns level 'ok' for a date well past 90 days", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 180)));
    expect(info.level).toBe("ok");
    expect(info.days).toBe(180);
    expect(info.label).toBe("180 days left");
    expect(info.shortLabel).toBe("180d");
  });

  it("returns level 'ok' just past the 90-day boundary", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 91)));
    expect(info.level).toBe("ok");
    expect(info.days).toBe(91);
  });

  it("uses the singular form for '1 day left'", () => {
    const info = getRenewalInfo(ymd(addDays(TODAY, 1)));
    expect(info.level).toBe("critical");
    expect(info.label).toBe("1 day left");
    expect(info.shortLabel).toBe("1d");
  });
});
