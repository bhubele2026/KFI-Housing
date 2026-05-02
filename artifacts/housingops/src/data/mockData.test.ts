import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeOverallRating,
  computePricePerSqft,
  computeRoomTotals,
  daysUntil,
  EMPTY_RATINGS,
  getRenewalInfo,
  toMonthlyCharge,
  type Room,
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

describe("computePricePerSqft", () => {
  it("returns rent / sqft rounded to cents", () => {
    // 4500 / 1800 = 2.5 exactly
    expect(computePricePerSqft(4500, 1800)).toBe(2.5);
    // 5400 / 960 = 5.625 → rounded to 5.63
    expect(computePricePerSqft(5400, 960)).toBe(5.63);
  });

  it("returns null when total rent is zero", () => {
    expect(computePricePerSqft(0, 1800)).toBeNull();
  });

  it("returns null when total sqft is zero", () => {
    // Avoids Infinity for properties with rent but no sqft entered yet.
    expect(computePricePerSqft(4500, 0)).toBeNull();
  });

  it("returns null when both are zero", () => {
    expect(computePricePerSqft(0, 0)).toBeNull();
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

  it("tolerates a stray time component on imported dates", () => {
    // Some imported / legacy rows arrive as "2026-05-31 00:00:00" or
    // "2026-05-31T00:00:00.000Z". Without the defensive strip these would
    // parse as NaN and silently disappear from the renewal alerts panel.
    expect(daysUntil("2025-06-30 00:00:00")).toBe(15);
    expect(daysUntil("2025-06-30T00:00:00.000Z")).toBe(15);
    expect(daysUntil("2025-06-15 23:59:59")).toBe(0);
  });
});

describe("getRenewalInfo (defensive against malformed dates)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15, 9, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies a legacy 'YYYY-MM-DD HH:MM:SS' end date as a normal critical/warning lease", () => {
    // 2025-07-15 is 30 days out from the fake 'today' of 2025-06-15 →
    // critical (≤ 30). The malformed time suffix must not turn this into NaN.
    const info = getRenewalInfo("2025-07-15 00:00:00");
    expect(info.level).toBe("critical");
    expect(info.days).toBe(30);
    expect(info.label).toBe("30 days left");
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

describe("computeRoomTotals", () => {
  // Build a Room with sane defaults so each test only has to spell out
  // the field(s) it cares about. The propertyId / id / name don't affect
  // the totals — they only matter at the page level.
  function makeRoom(overrides: Partial<Room> = {}): Room {
    return {
      id: overrides.id ?? "r-test",
      propertyId: overrides.propertyId ?? "p1",
      name: overrides.name ?? "Room",
      sqft: overrides.sqft ?? 0,
      bathrooms: overrides.bathrooms ?? 0,
      monthlyRent: overrides.monthlyRent ?? 0,
    };
  }

  it("returns all-zero totals for an empty list (callers can render placeholders without an extra empty check)", () => {
    expect(computeRoomTotals([])).toEqual({
      roomCount: 0,
      totalSqft: 0,
      totalBathrooms: 0,
      totalMonthlyRent: 0,
    });
  });

  it("returns the room's own values when given a single room", () => {
    expect(
      computeRoomTotals([
        makeRoom({ sqft: 250, bathrooms: 1, monthlyRent: 1500 }),
      ]),
    ).toEqual({
      roomCount: 1,
      totalSqft: 250,
      totalBathrooms: 1,
      totalMonthlyRent: 1500,
    });
  });

  it("sums every field across multiple rooms", () => {
    // Numbers picked so each total is unique (no field equals another)
    // — that way an off-by-one mapping bug (e.g. summing sqft into
    // totalBathrooms) would fail loudly instead of silently lining up.
    const rooms = [
      makeRoom({ id: "r1", sqft: 200, bathrooms: 1, monthlyRent: 1000 }),
      makeRoom({ id: "r2", sqft: 150, bathrooms: 0.5, monthlyRent: 800 }),
      makeRoom({ id: "r3", sqft: 320, bathrooms: 1.5, monthlyRent: 1200 }),
    ];
    expect(computeRoomTotals(rooms)).toEqual({
      roomCount: 3,
      totalSqft: 670,
      totalBathrooms: 3,
      totalMonthlyRent: 3000,
    });
  });

  it("treats explicit zero sqft / bathrooms / rent as 0 contribution", () => {
    // A freshly-added room (the Beds tab seeds new rooms with all-zero
    // numerics) must not crash or NaN-poison the totals — it should
    // just count toward roomCount and add 0 elsewhere.
    expect(
      computeRoomTotals([
        makeRoom({ sqft: 100, bathrooms: 1, monthlyRent: 500 }),
        makeRoom({ id: "r-new", sqft: 0, bathrooms: 0, monthlyRent: 0 }),
      ]),
    ).toEqual({
      roomCount: 2,
      totalSqft: 100,
      totalBathrooms: 1,
      totalMonthlyRent: 500,
    });
  });

  it("treats missing (undefined) sqft / bathrooms / rent as 0", () => {
    // Imported / legacy rows can arrive with undefined numerics. The
    // `r.field || 0` fallback in the implementation must keep totals
    // numeric — otherwise `undefined + 100` would render as "NaN sqft"
    // on the property overview.
    const partialRoom = {
      id: "r-partial",
      propertyId: "p1",
      name: "Partial",
      sqft: undefined,
      bathrooms: undefined,
      monthlyRent: undefined,
    } as unknown as Room;

    expect(
      computeRoomTotals([
        makeRoom({ sqft: 200, bathrooms: 1, monthlyRent: 1000 }),
        partialRoom,
      ]),
    ).toEqual({
      roomCount: 2,
      totalSqft: 200,
      totalBathrooms: 1,
      totalMonthlyRent: 1000,
    });
  });

  it("treats null sqft / bathrooms / rent as 0", () => {
    // Same defensive contract as the undefined case, but for the
    // null-shaped variants some serializers produce.
    const nullishRoom = {
      id: "r-null",
      propertyId: "p1",
      name: "Nullish",
      sqft: null,
      bathrooms: null,
      monthlyRent: null,
    } as unknown as Room;

    expect(computeRoomTotals([nullishRoom])).toEqual({
      roomCount: 1,
      totalSqft: 0,
      totalBathrooms: 0,
      totalMonthlyRent: 0,
    });
  });
});

describe("toMonthlyCharge", () => {
  describe("Monthly", () => {
    it("returns the input unchanged for whole-dollar amounts", () => {
      expect(toMonthlyCharge(1500, "Monthly")).toBe(1500);
    });

    it("returns the input unchanged for amounts with cents", () => {
      // Guards against accidental rounding for the Monthly branch — the
      // value should be returned exactly as-is, including fractional cents.
      expect(toMonthlyCharge(1234.567, "Monthly")).toBe(1234.567);
      expect(toMonthlyCharge(99.99, "Monthly")).toBe(99.99);
    });
  });

  describe("Weekly", () => {
    it("applies the 52/12 factor", () => {
      // 300 * 52 / 12 = 1300 exactly
      expect(toMonthlyCharge(300, "Weekly")).toBe(1300);
    });

    it("rounds to two decimal places", () => {
      // 100 * 52 / 12 = 433.3333… → 433.33
      expect(toMonthlyCharge(100, "Weekly")).toBe(433.33);
      // 250 * 52 / 12 = 1083.3333… → 1083.33
      expect(toMonthlyCharge(250, "Weekly")).toBe(1083.33);
      // 175.50 * 52 / 12 = 760.5 exactly
      expect(toMonthlyCharge(175.5, "Weekly")).toBe(760.5);
    });
  });

  describe("Biweekly", () => {
    it("applies the 26/12 factor", () => {
      // 600 * 26 / 12 = 1300 exactly
      expect(toMonthlyCharge(600, "Biweekly")).toBe(1300);
    });

    it("rounds to two decimal places", () => {
      // 100 * 26 / 12 = 216.6666… → 216.67
      expect(toMonthlyCharge(100, "Biweekly")).toBe(216.67);
      // 500 * 26 / 12 = 1083.3333… → 1083.33
      expect(toMonthlyCharge(500, "Biweekly")).toBe(1083.33);
      // 351 * 26 / 12 = 760.5 exactly
      expect(toMonthlyCharge(351, "Biweekly")).toBe(760.5);
    });
  });

  describe("zero charge", () => {
    it("returns 0 for Monthly", () => {
      expect(toMonthlyCharge(0, "Monthly")).toBe(0);
    });

    it("returns 0 for Weekly", () => {
      expect(toMonthlyCharge(0, "Weekly")).toBe(0);
    });

    it("returns 0 for Biweekly", () => {
      expect(toMonthlyCharge(0, "Biweekly")).toBe(0);
    });
  });
});
