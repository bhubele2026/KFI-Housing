import { describe, it, expect } from "vitest";
import { planLeaseFills, type ExistingLease, type LeaseFix } from "./seed-lease-fixes";

const fix: LeaseFix = {
  propertyId: "p1",
  unit: "A02",
  monthlyRent: 1625,
  startDate: "2024-10-08",
  endDate: "2025-11-30",
};
const base: ExistingLease = {
  id: "lease-1",
  propertyId: "p1",
  unit: "A02",
  monthlyRent: 0,
  startDate: "",
  endDate: "",
};

describe("planLeaseFills", () => {
  it("fills all blank fields when the lease is empty", () => {
    expect(planLeaseFills([base], [fix])).toEqual([
      { id: "lease-1", patch: { monthlyRent: 1625, startDate: "2024-10-08", endDate: "2025-11-30" } },
    ]);
  });

  it("never overwrites a non-blank value", () => {
    const full: ExistingLease = { ...base, monthlyRent: 999, startDate: "2024-01-01", endDate: "2024-12-31" };
    expect(planLeaseFills([full], [fix])).toEqual([]);
  });

  it("fills only the blanks (rent set, dates already present)", () => {
    const partial: ExistingLease = { ...base, startDate: "2024-01-01", endDate: "2024-12-31" };
    expect(planLeaseFills([partial], [fix])).toEqual([
      { id: "lease-1", patch: { monthlyRent: 1625 } },
    ]);
  });

  it("matches on propertyId + unit, case/space-insensitive on unit", () => {
    const lease: ExistingLease = { ...base, unit: " a02 " };
    expect(planLeaseFills([lease], [fix])).toHaveLength(1);
  });

  it("skips a fix with no matching lease", () => {
    expect(planLeaseFills([{ ...base, unit: "Z99" }], [fix])).toEqual([]);
    expect(planLeaseFills([{ ...base, propertyId: "other" }], [fix])).toEqual([]);
  });

  it("does not invent an end date when the fix's is blank (month-to-month)", () => {
    const m2m: LeaseFix = { ...fix, endDate: "" };
    expect(planLeaseFills([base], [m2m])).toEqual([
      { id: "lease-1", patch: { monthlyRent: 1625, startDate: "2024-10-08" } },
    ]);
  });
});
