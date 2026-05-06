import { describe, it, expect } from "vitest";
import {
  currentMonthKey,
  getHotelRateRiskStatus,
  getHotelRateMonthRisk,
} from "./hotel-rate-status";
import type { Lease, RoomNightLog } from "@/data/mockData";

function lease(over: Partial<Lease> & { id: string }): Pick<Lease, "id" | "monthlyRoomNightMin"> {
  return { id: over.id, monthlyRoomNightMin: over.monthlyRoomNightMin ?? 0 };
}

function log(leaseId: string, month: string, roomNights: number): RoomNightLog {
  return { id: `rnl-${leaseId}-${month}`, leaseId, month, roomNights, notes: "" };
}

describe("getHotelRateRiskStatus", () => {
  it("returns null when the lease has no monthly minimum (not a hotel-rate lease)", () => {
    expect(getHotelRateRiskStatus(lease({ id: "l1" }), [])).toBeNull();
  });

  it("flags a hotel-rate lease with no logs as 'missing'", () => {
    const result = getHotelRateRiskStatus(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [],
    );
    expect(result).toEqual({ kind: "missing", monthlyMin: 30 });
  });

  it("flags the latest month as 'below-min' when its log is short", () => {
    const result = getHotelRateRiskStatus(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l1", "2026-04", 25), log("l1", "2026-05", 10)],
    );
    expect(result).toEqual({
      kind: "below-min",
      monthlyMin: 30,
      latestMonth: "2026-05",
      latestNights: 10,
    });
  });

  it("returns null when the latest log meets the minimum", () => {
    const result = getHotelRateRiskStatus(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l1", "2026-05", 31)],
    );
    expect(result).toBeNull();
  });

  it("ignores logs that belong to a different lease", () => {
    const result = getHotelRateRiskStatus(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l2", "2026-05", 60)],
    );
    expect(result).toEqual({ kind: "missing", monthlyMin: 30 });
  });
});

describe("getHotelRateMonthRisk", () => {
  it("returns 'missing' when no log exists for the requested month", () => {
    const result = getHotelRateMonthRisk(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l1", "2026-04", 60)],
      "2026-05",
    );
    expect(result).toEqual({ kind: "missing", monthlyMin: 30 });
  });

  it("returns 'below-min' when the requested month's log is short", () => {
    const result = getHotelRateMonthRisk(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l1", "2026-05", 12)],
      "2026-05",
    );
    expect(result).toMatchObject({ kind: "below-min", latestNights: 12 });
  });

  it("returns null when the requested month meets the minimum", () => {
    const result = getHotelRateMonthRisk(
      lease({ id: "l1", monthlyRoomNightMin: 30 }),
      [log("l1", "2026-05", 30)],
      "2026-05",
    );
    expect(result).toBeNull();
  });

  it("returns null for non-hotel-rate leases", () => {
    expect(
      getHotelRateMonthRisk(lease({ id: "l1" }), [], "2026-05"),
    ).toBeNull();
  });
});

describe("currentMonthKey", () => {
  it("formats Date as YYYY-MM, zero-padding single-digit months", () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });
});
