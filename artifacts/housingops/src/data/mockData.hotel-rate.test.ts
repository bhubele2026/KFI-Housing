import { describe, it, expect } from "vitest";
import {
  estimateLeaseMonthlyRent,
  getLatestRoomNightLog,
  sumActiveRentEstimated,
  LeaseSchema,
  type Lease,
  type RoomNightLog,
} from "./mockData";

// Dedicated coverage for task #347: pin the three hotel-rate revenue
// helpers (`getLatestRoomNightLog`, `estimateLeaseMonthlyRent`,
// `sumActiveRentEstimated`) introduced by task #320 against the four
// regression cases the property page depends on:
//
//   1. no log → 0 (helpers MUST NOT fabricate revenue from thin air)
//   2. latest-month picking (highest YYYY-MM wins, regardless of order)
//   3. rounding to cents (so aggregates stay free of float noise)
//   4. non-hotel ("monthly") rate types ignored (their stored monthlyRent
//      is returned unchanged, room-night logs do not influence them)
//
// These tests focus on the helpers in isolation; the matching UI
// behaviour is covered by `property-detail.lease-summary.test.tsx`.

function makeLease(over: Partial<Lease>): Lease {
  return LeaseSchema.parse({
    id: "l-1",
    propertyId: "p-1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRent: 0,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    ...over,
  });
}

function makeLog(o: { leaseId: string; month: string; roomNights: number }): RoomNightLog {
  return { id: `log-${o.leaseId}-${o.month}`, notes: "", ...o };
}

describe("getLatestRoomNightLog", () => {
  it("returns null when no logs exist for the lease (no log → 0 upstream)", () => {
    expect(getLatestRoomNightLog([], "l-1")).toBeNull();
    const others = [makeLog({ leaseId: "other", month: "2026-04", roomNights: 12 })];
    expect(getLatestRoomNightLog(others, "l-1")).toBeNull();
  });

  it("picks the highest YYYY-MM string regardless of input order (latest-month picking)", () => {
    const logs = [
      makeLog({ leaseId: "l-1", month: "2026-02", roomNights: 8 }),
      makeLog({ leaseId: "l-1", month: "2026-04", roomNights: 22 }),
      makeLog({ leaseId: "l-1", month: "2026-01", roomNights: 5 }),
      makeLog({ leaseId: "l-1", month: "2026-03", roomNights: 11 }),
    ];
    const latest = getLatestRoomNightLog(logs, "l-1");
    expect(latest?.month).toBe("2026-04");
    expect(latest?.roomNights).toBe(22);
  });
});

describe("estimateLeaseMonthlyRent", () => {
  it("returns the stored monthlyRent for monthly leases (non-hotel rate types ignored)", () => {
    const monthly = makeLease({ monthlyRent: 2400 });
    expect(estimateLeaseMonthlyRent(monthly, [])).toBe(2400);
  });

  it("ignores room-night logs for monthly leases — even matching ones MUST NOT change the stored rent", () => {
    const monthly = makeLease({ monthlyRent: 2400, nightlyRate: 99 });
    const logs = [makeLog({ leaseId: monthly.id, month: "2026-04", roomNights: 30 })];
    expect(estimateLeaseMonthlyRent(monthly, logs)).toBe(2400);
  });

  it("returns 0 for hotel-rate leases with no log yet (no log → 0; no fabricated revenue)", () => {
    const hotel = makeLease({ rateType: "room-night", nightlyRate: 89, monthlyRent: 0 });
    expect(estimateLeaseMonthlyRent(hotel, [])).toBe(0);
    // Logs for OTHER leases must not leak through either.
    const otherLogs = [makeLog({ leaseId: "different", month: "2026-04", roomNights: 22 })];
    expect(estimateLeaseMonthlyRent(hotel, otherLogs)).toBe(0);
  });

  it("multiplies nightlyRate by the latest month's roomNights (latest-month picking, end-to-end)", () => {
    const hotel = makeLease({ rateType: "room-night", nightlyRate: 89, monthlyRent: 0 });
    const logs = [
      makeLog({ leaseId: hotel.id, month: "2026-03", roomNights: 10 }),
      makeLog({ leaseId: hotel.id, month: "2026-04", roomNights: 22 }),
    ];
    // Earlier month must NOT win even though it appears first in the list.
    expect(estimateLeaseMonthlyRent(hotel, logs)).toBe(89 * 22);
  });

  it("rounds the nightly × room-nights product to cents (rounding to cents)", () => {
    // 89.999 * 7 = 629.993 → 629.99 (banker-free, half-away-from-zero)
    const hotelA = makeLease({ rateType: "room-night", nightlyRate: 89.999, monthlyRent: 0 });
    expect(
      estimateLeaseMonthlyRent(hotelA, [makeLog({ leaseId: hotelA.id, month: "2026-04", roomNights: 7 })]),
    ).toBe(629.99);

    // 12.345 * 3 = 37.035 → 37.04 (rounds UP at the half)
    const hotelB = makeLease({ rateType: "room-night", nightlyRate: 12.345, monthlyRent: 0 });
    expect(
      estimateLeaseMonthlyRent(hotelB, [makeLog({ leaseId: hotelB.id, month: "2026-04", roomNights: 3 })]),
    ).toBe(37.04);

    // 0.1 * 3 = 0.30000000000000004 in IEEE-754 → must collapse to exactly 0.30
    const hotelC = makeLease({ rateType: "room-night", nightlyRate: 0.1, monthlyRent: 0 });
    expect(
      estimateLeaseMonthlyRent(hotelC, [makeLog({ leaseId: hotelC.id, month: "2026-04", roomNights: 3 })]),
    ).toBe(0.3);
  });
});

describe("sumActiveRentEstimated", () => {
  it("sums monthly + hotel-rate active leases for the property and skips inactive / other-property leases", () => {
    const monthly = makeLease({ id: "l-monthly", monthlyRent: 2400 });
    const hotel = makeLease({
      id: "l-hotel",
      rateType: "room-night",
      nightlyRate: 89,
      monthlyRent: 0,
    });
    const expired = makeLease({ id: "l-old", monthlyRent: 5000, status: "Expired" });
    const upcoming = makeLease({ id: "l-soon", monthlyRent: 1000, status: "Upcoming" });
    const otherProp = makeLease({ id: "l-other", propertyId: "p-2", monthlyRent: 999 });
    const logs = [makeLog({ leaseId: "l-hotel", month: "2026-04", roomNights: 22 })];

    expect(
      sumActiveRentEstimated([monthly, hotel, expired, upcoming, otherProp], logs, "p-1"),
    ).toBe(2400 + 89 * 22);
  });

  it("returns 0 when the property has no active leases at all", () => {
    const expired = makeLease({ monthlyRent: 5000, status: "Expired" });
    expect(sumActiveRentEstimated([expired], [], "p-1")).toBe(0);
  });

  it("contributes 0 from active hotel-rate leases that have no log yet (no log → 0)", () => {
    const hotel = makeLease({ rateType: "room-night", nightlyRate: 89, monthlyRent: 0 });
    expect(sumActiveRentEstimated([hotel], [], "p-1")).toBe(0);
  });

  it("rounds each hotel-rate contribution to cents before summing (rounding to cents at the aggregate level)", () => {
    const hotelA = makeLease({
      id: "l-h1",
      rateType: "room-night",
      nightlyRate: 89.999,
      monthlyRent: 0,
    });
    const hotelB = makeLease({
      id: "l-h2",
      rateType: "room-night",
      nightlyRate: 12.345,
      monthlyRent: 0,
    });
    const logs = [
      makeLog({ leaseId: "l-h1", month: "2026-04", roomNights: 7 }), // → 629.99
      makeLog({ leaseId: "l-h2", month: "2026-04", roomNights: 3 }), // → 37.04
    ];
    // 629.99 + 37.04 = 667.03 exactly (no float drift).
    expect(sumActiveRentEstimated([hotelA, hotelB], logs, "p-1")).toBe(667.03);
  });
});
