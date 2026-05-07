import { describe, it, expect, beforeEach } from "vitest";
import {
  currentMonthKey,
  getHotelRateRiskStatus,
  getHotelRateMonthRisk,
  getHotelRateLeasesMissingMonthLog,
  readAcknowledgedReminderMonth,
  writeAcknowledgedReminderMonth,
  HOTEL_RATE_REMINDER_STORAGE_KEY,
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

describe("getHotelRateLeasesMissingMonthLog", () => {
  function leaseRow(
    id: string,
    monthlyRoomNightMin: number,
    status: Lease["status"] = "Active",
  ): Pick<Lease, "id" | "monthlyRoomNightMin" | "status"> {
    return { id, monthlyRoomNightMin, status };
  }

  it("returns hotel-rate Active/Upcoming leases that have no log for the month", () => {
    const leases = [
      leaseRow("l1", 30, "Active"),
      leaseRow("l2", 30, "Upcoming"),
      leaseRow("l3", 30, "Active"),
    ];
    const logs = [log("l3", "2026-05", 5)];
    const result = getHotelRateLeasesMissingMonthLog(leases, logs, "2026-05");
    expect(result.map((l) => l.id).sort()).toEqual(["l1", "l2"]);
  });

  it("ignores non-hotel-rate leases (no monthly minimum)", () => {
    const leases = [leaseRow("l1", 0, "Active"), leaseRow("l2", 30, "Active")];
    const result = getHotelRateLeasesMissingMonthLog(leases, [], "2026-05");
    expect(result.map((l) => l.id)).toEqual(["l2"]);
  });

  it("skips Expired hotel-rate leases — there's no rate left to void", () => {
    const leases = [
      leaseRow("l1", 30, "Expired"),
      leaseRow("l2", 30, "Active"),
    ];
    const result = getHotelRateLeasesMissingMonthLog(leases, [], "2026-05");
    expect(result.map((l) => l.id)).toEqual(["l2"]);
  });

  it("treats logs from other months as not satisfying the requested month", () => {
    const leases = [leaseRow("l1", 30, "Active")];
    const logs = [log("l1", "2026-04", 60)];
    const result = getHotelRateLeasesMissingMonthLog(leases, logs, "2026-05");
    expect(result.map((l) => l.id)).toEqual(["l1"]);
  });

  it("returns an empty list when every hotel-rate lease already has a log this month", () => {
    const leases = [leaseRow("l1", 30, "Active"), leaseRow("l2", 30, "Active")];
    const logs = [log("l1", "2026-05", 5), log("l2", "2026-05", 0)];
    expect(getHotelRateLeasesMissingMonthLog(leases, logs, "2026-05")).toEqual([]);
  });
});

describe("reminder month persistence", () => {
  beforeEach(() => {
    window.localStorage.removeItem(HOTEL_RATE_REMINDER_STORAGE_KEY);
  });

  it("returns null when nothing has been persisted", () => {
    expect(readAcknowledgedReminderMonth()).toBeNull();
  });

  it("round-trips a YYYY-MM value through localStorage", () => {
    writeAcknowledgedReminderMonth("2026-05");
    expect(readAcknowledgedReminderMonth()).toBe("2026-05");
  });

  it("rejects malformed persisted values rather than handing them back as a month", () => {
    // A poisoned localStorage entry (manual edit, leftover from a
    // future schema, etc.) must not satisfy the "already acknowledged"
    // check — otherwise the operator would silently miss the toast.
    window.localStorage.setItem(HOTEL_RATE_REMINDER_STORAGE_KEY, "not-a-month");
    expect(readAcknowledgedReminderMonth()).toBeNull();
  });
});

describe("currentMonthKey", () => {
  it("formats Date as YYYY-MM, zero-padding single-digit months", () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });
});
