import { describe, it, expect } from "vitest";
import {
  isSaturdayDate,
  mostRecentSaturday,
  parsePayWeekDate,
  payWeekEndForDate,
  trailingPayWeeks,
} from "./pay-week";

describe("pay-week helpers", () => {
  it("parses YYYY-MM-DD and rejects bad input", () => {
    expect(parsePayWeekDate("2026-05-09")?.getDay()).toBe(6);
    expect(parsePayWeekDate("not-a-date")).toBeNull();
    expect(parsePayWeekDate("2026-13-01")).toBeNull();
  });

  it("isSaturdayDate", () => {
    expect(isSaturdayDate("2026-05-09")).toBe(true); // Saturday
    expect(isSaturdayDate("2026-05-10")).toBe(false); // Sunday
    expect(isSaturdayDate("garbage")).toBe(false);
  });

  it("mostRecentSaturday returns the day itself when it's Saturday", () => {
    const sat = new Date(2026, 4, 9); // May 9, 2026 is a Saturday
    expect(mostRecentSaturday(sat)).toBe("2026-05-09");
  });

  it("mostRecentSaturday rolls back from a midweek date", () => {
    const wed = new Date(2026, 4, 13); // Wednesday
    expect(mostRecentSaturday(wed)).toBe("2026-05-09");
  });

  it("payWeekEndForDate folds Mon-Fri forward to Saturday", () => {
    const mon = new Date(2026, 4, 11); // Monday
    expect(payWeekEndForDate(mon)).toBe("2026-05-16");
    const sat = new Date(2026, 4, 16);
    expect(payWeekEndForDate(sat)).toBe("2026-05-16");
  });

  it("trailingPayWeeks returns the requested chronological run", () => {
    const wks = trailingPayWeeks(3, "2026-05-09");
    expect(wks).toEqual(["2026-04-25", "2026-05-02", "2026-05-09"]);
  });
});
