import { describe, it, expect } from "vitest";
import {
  computeLeaseStatus,
  daysUntilExpiry,
  deriveLeaseStatus,
  todayIso,
} from "./lease-status";

describe("daysUntilExpiry", () => {
  it("returns a positive count for leases ending in the future", () => {
    expect(daysUntilExpiry("2026-06-05", "2026-05-06")).toBe(30);
    expect(daysUntilExpiry("2026-08-04", "2026-05-06")).toBe(90);
  });

  it("returns 0 the day the lease ends", () => {
    expect(daysUntilExpiry("2026-05-06", "2026-05-06")).toBe(0);
  });

  it("returns a negative count for already-expired leases", () => {
    expect(daysUntilExpiry("2026-05-01", "2026-05-06")).toBe(-5);
  });

  it("handles month and year boundaries", () => {
    expect(daysUntilExpiry("2027-01-05", "2026-12-31")).toBe(5);
    expect(daysUntilExpiry("2026-03-01", "2026-02-25")).toBe(4);
  });
});

describe("computeLeaseStatus", () => {
  it("returns Upcoming when today is before the start date", () => {
    expect(computeLeaseStatus("2026-06-01", "2026-12-31", "2026-05-06")).toBe(
      "Upcoming",
    );
  });

  it("returns Active when today is inside the term, inclusive of the boundary days", () => {
    expect(computeLeaseStatus("2025-01-01", "2026-12-31", "2026-05-06")).toBe(
      "Active",
    );
    expect(computeLeaseStatus("2026-05-06", "2026-12-31", "2026-05-06")).toBe(
      "Active",
    );
    expect(computeLeaseStatus("2025-01-01", "2026-05-06", "2026-05-06")).toBe(
      "Active",
    );
  });

  it("returns Expired the day after the end date", () => {
    expect(computeLeaseStatus("2024-12-01", "2025-11-30", "2025-12-01")).toBe(
      "Expired",
    );
  });
});

describe("todayIso", () => {
  it("formats a Date as zero-padded YYYY-MM-DD in UTC", () => {
    expect(todayIso(new Date("2026-05-06T12:00:00Z"))).toBe("2026-05-06");
    expect(todayIso(new Date("2026-01-09T00:00:00Z"))).toBe("2026-01-09");
  });
});

describe("deriveLeaseStatus", () => {
  const now = new Date("2026-05-06T12:00:00Z");

  it("re-derives status from term dates when both are present", () => {
    expect(
      deriveLeaseStatus(
        { startDate: "2024-12-01", endDate: "2025-11-30", status: "Active" },
        now,
      ),
    ).toBe("Expired");
    expect(
      deriveLeaseStatus(
        { startDate: "2026-06-01", endDate: "2026-12-31", status: "Active" },
        now,
      ),
    ).toBe("Upcoming");
    expect(
      deriveLeaseStatus(
        { startDate: "2025-09-30", endDate: "2026-08-31", status: "Active" },
        now,
      ),
    ).toBe("Active");
  });

  it("falls back to the stored status when either term date is blank", () => {
    expect(
      deriveLeaseStatus(
        { startDate: "", endDate: "", status: "Upcoming" },
        now,
      ),
    ).toBe("Upcoming");
    expect(
      deriveLeaseStatus(
        { startDate: "2026-01-01", endDate: "", status: "Active" },
        now,
      ),
    ).toBe("Active");
  });
});
