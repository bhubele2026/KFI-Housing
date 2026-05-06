import { describe, it, expect } from "vitest";
import {
  computeLeaseStatus,
  deriveLeaseStatus,
  todayIso,
} from "./lease-status";

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
