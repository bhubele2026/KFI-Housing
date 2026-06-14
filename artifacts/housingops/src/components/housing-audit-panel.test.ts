import { describe, it, expect } from "vitest";
import { computeHousingAudit } from "./housing-audit-panel";
import type { Property, Lease } from "@/data/mockData";

const prop = (id: string, name: string, address: string): Property =>
  ({ id, name, address }) as unknown as Property;

const lease = (l: Partial<Lease> & { id: string; propertyId: string }): Lease =>
  ({ rateType: "monthly", ...l }) as unknown as Lease;

describe("computeHousingAudit", () => {
  it("flags missing rent, missing dates, and duplicate addresses", () => {
    const properties = [
      prop("p1", "Alpha Apts", "1 Main St"),
      prop("p2", "Alpha Apts (dup)", "1 main st  "), // same address, normalized
      prop("p3", "Bravo Motel", "2 Oak Ave"),
    ];
    const leases = [
      lease({ id: "l1", propertyId: "p1", monthlyRent: 1000, startDate: "2026-01-01", endDate: "2026-12-31" }),
      lease({ id: "l2", propertyId: "p1", monthlyRent: 0, needsReview: true, startDate: "", endDate: "", unit: "5" }),
      lease({ id: "l3", propertyId: "p3", rateType: "room-night", nightlyRate: 0, startDate: "2026-01-01", endDate: "2026-02-01" }),
    ];

    const audit = computeHousingAudit(properties, leases);
    expect(audit.missingRent.map((r) => r.leaseId).sort()).toEqual(["l2", "l3"]);
    expect(audit.missingDates.map((r) => r.leaseId)).toEqual(["l2"]);
    expect(audit.duplicates).toHaveLength(1);
    expect(audit.duplicates[0]!.properties.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(audit.clear).toBe(false);
  });

  it("reports all clear when every lease is complete and addresses are unique", () => {
    const properties = [prop("p1", "Alpha", "1 Main St"), prop("p2", "Bravo", "2 Oak Ave")];
    const leases = [
      lease({ id: "l1", propertyId: "p1", monthlyRent: 1000, startDate: "2026-01-01", endDate: "2026-12-31" }),
      lease({ id: "l2", propertyId: "p2", rateType: "room-night", nightlyRate: 75, startDate: "2026-01-01", endDate: "2026-03-01" }),
    ];
    const audit = computeHousingAudit(properties, leases);
    expect(audit.clear).toBe(true);
    expect(audit.missingRent).toHaveLength(0);
    expect(audit.missingDates).toHaveLength(0);
    expect(audit.duplicates).toHaveLength(0);
  });
});
