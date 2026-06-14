import { describe, it, expect } from "vitest";
import {
  computePropertyEconomics,
  occupantMonthlyCharge,
} from "./property-economics";
import type { Property, Lease, Occupant, Utility } from "@/data/mockData";

const prop = (o: Partial<Property> & { id: string }): Property =>
  ({ customerId: "c1", name: o.id, totalBeds: 0, monthlyRent: 0, ...o }) as unknown as Property;
const lease = (o: Partial<Lease> & { propertyId: string }): Lease =>
  ({ status: "Active", rateType: "monthly", monthlyRent: 0, ...o }) as unknown as Lease;
const occ = (o: Partial<Occupant> & { propertyId: string }): Occupant =>
  ({ status: "Active", moveOutDate: null, chargePerBed: 0, billingFrequency: "Monthly", ...o }) as unknown as Occupant;
const util = (o: Partial<Utility> & { propertyId: string }): Utility =>
  ({ monthlyCost: 0, type: "Electric", ...o }) as unknown as Utility;

describe("occupantMonthlyCharge", () => {
  it("normalizes weekly and biweekly charges to monthly", () => {
    expect(occupantMonthlyCharge({ chargePerBed: 200, billingFrequency: "Weekly" })).toBeCloseTo(866.67, 1);
    expect(occupantMonthlyCharge({ chargePerBed: 200, billingFrequency: "Biweekly" })).toBeCloseTo(433.33, 1);
    expect(occupantMonthlyCharge({ chargePerBed: 700, billingFrequency: "Monthly" })).toBe(700);
  });
});

describe("computePropertyEconomics", () => {
  it("computes vacancy + undercharge loss with break-even per bed", () => {
    const properties = [prop({ id: "p1", totalBeds: 10 })];
    const leases = [
      lease({ propertyId: "p1", monthlyRent: 5000 }),
      lease({ propertyId: "p1", monthlyRent: 5000 }),
    ];
    // 6 active occupants charged $700/mo each; 4 beds vacant
    const occupants = Array.from({ length: 6 }, (_, i) =>
      occ({ id: `o${i}`, propertyId: "p1", chargePerBed: 700, billingFrequency: "Monthly" }),
    );
    const { rows, summary } = computePropertyEconomics(properties, leases, occupants, []);
    const r = rows[0]!;
    expect(r.monthlyCost).toBe(10000);
    expect(r.recommendedPerBed).toBe(1000); // 10000 / 10
    expect(r.occupied).toBe(6);
    expect(r.vacant).toBe(4);
    expect(r.vacancyLoss).toBe(4000); // 4 * 1000
    expect(r.underchargeLoss).toBe(1800); // 6 * (1000 - 700)
    expect(r.monthlyLoss).toBe(5800);
    expect(r.avgChargePerBed).toBe(700);
    expect(summary.totalMonthlyLoss).toBe(5800);
    expect(summary.totalVacant).toBe(4);
  });

  it("includes utilities in monthly cost", () => {
    const properties = [prop({ id: "p1", totalBeds: 4, monthlyRent: 2000 })];
    const utils = [util({ propertyId: "p1", monthlyCost: 400 })];
    const { rows } = computePropertyEconomics(properties, [], [], utils);
    expect(rows[0]!.monthlyCost).toBe(2400);
    expect(rows[0]!.recommendedPerBed).toBe(600);
  });

  it("withholds per-bed math when beds are unknown (totalBeds 0)", () => {
    const properties = [prop({ id: "p1", totalBeds: 0, monthlyRent: 3000 })];
    const { rows, summary } = computePropertyEconomics(properties, [], [], []);
    expect(rows[0]!.bedsKnown).toBe(false);
    expect(rows[0]!.recommendedPerBed).toBeNull();
    expect(rows[0]!.monthlyLoss).toBe(0);
    expect(summary.bedsUnknownCount).toBe(1);
  });

  it("flags chargeDataMissing when an active occupant has no charge", () => {
    const properties = [prop({ id: "p1", totalBeds: 2, monthlyRent: 1000 })];
    const occupants = [
      occ({ id: "a", propertyId: "p1", chargePerBed: 300, billingFrequency: "Monthly" }),
      occ({ id: "b", propertyId: "p1", chargePerBed: 0 }),
    ];
    const { rows } = computePropertyEconomics(properties, [], occupants, []);
    expect(rows[0]!.chargeDataMissing).toBe(true);
    // only the charged occupant contributes to undercharge (recPerBed 500, charge 300 -> 200)
    expect(rows[0]!.underchargeLoss).toBe(200);
  });

  it("sorts worst-loss property first", () => {
    const properties = [
      prop({ id: "small", totalBeds: 2, monthlyRent: 1000 }),
      prop({ id: "big", totalBeds: 10, monthlyRent: 10000 }),
    ];
    const { rows } = computePropertyEconomics(properties, [], [], []);
    expect(rows[0]!.propertyId).toBe("big"); // 10 vacant * 1000 = 10000 loss
  });
});
