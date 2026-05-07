import { describe, expect, it } from "vitest";
import type { CustomerRow, PropertyRow } from "@workspace/db";
import {
  rankPropertyCandidates,
  type ExtractedLease,
} from "./lease-pdf-import";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const EMPTY_RATINGS = {
  landlord: 0,
  cleanliness: 0,
  amenities: 0,
  occupants: 0,
  location: 0,
  valueForMoney: 0,
};

function makeProperty(overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    id: "prop-1",
    name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    totalBeds: 0,
    monthlyRent: 0,
    chargePerBed: 0,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "",
    paymentDueDay: 1,
    rentFrequency: "Monthly",
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "",
    furnishings: [],
    customerId: "",
    sharedWithCustomerIds: [],
    ratings: EMPTY_RATINGS,
    lat: null,
    lng: null,
    coordsVerified: false,
    rentFree: false,
    defaultNoticePeriodDays: null,
    propertyType: null,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: "cust-1",
    name: "ACME Properties LLC",
    contactName: "",
    email: "",
    phone: "",
    notes: "",
    state: "",
    noHousingReason: null,
    ...overrides,
  };
}

function makeExtracted(overrides: Partial<ExtractedLease> = {}): ExtractedLease {
  return {
    propertyName: null,
    propertyAddress: null,
    city: null,
    state: null,
    zip: null,
    landlordName: null,
    startDate: null,
    endDate: null,
    monthlyRent: null,
    securityDeposit: null,
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    confidence: "medium",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rankPropertyCandidates
// ---------------------------------------------------------------------------

describe("rankPropertyCandidates", () => {
  it("returns [] when there are no properties to match against", () => {
    const result = rankPropertyCandidates(
      makeExtracted({ propertyName: "Maple Court", city: "Austin" }),
      [],
      [],
    );
    expect(result).toEqual([]);
  });

  it("ranks a strong address+name match above weaker ones", () => {
    const properties = [
      makeProperty({
        id: "prop-strong",
        name: "Maple Court Apartments",
        address: "123 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        customerId: "cust-1",
      }),
      makeProperty({
        id: "prop-weak",
        name: "Riverside Lofts",
        address: "9 River Rd",
        city: "Dallas",
        state: "TX",
        zip: "75201",
        customerId: "cust-1",
      }),
    ];
    const customers = [makeCustomer()];

    const result = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "123 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
      properties,
      customers,
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.propertyId).toBe("prop-strong");
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
    // The exact-everything match should comfortably clear the 0.6 noise floor
    // the route uses to decide whether to auto-attach.
    expect(result[0]?.score).toBeGreaterThanOrEqual(0.6);
  });

  it("attaches the matching customer name from the lookup table", () => {
    const properties = [
      makeProperty({
        id: "prop-strong",
        name: "Maple Court Apartments",
        address: "123 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        customerId: "cust-42",
      }),
    ];
    const customers = [
      makeCustomer({ id: "cust-1", name: "Wrong Customer" }),
      makeCustomer({ id: "cust-42", name: "Right Customer Inc" }),
    ];

    const [top] = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      properties,
      customers,
    );

    expect(top?.customerName).toBe("Right Customer Inc");
  });

  it("falls back to '' when the property's customer is not in the lookup", () => {
    const properties = [
      makeProperty({
        id: "prop-1",
        name: "Maple Court",
        address: "123 Maple St",
        city: "Austin",
        zip: "78701",
        customerId: "cust-missing",
      }),
    ];

    const [top] = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court",
        propertyAddress: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      properties,
      [],
    );

    expect(top?.customerName).toBe("");
  });

  it("filters out zero-score candidates so totally unrelated rows are dropped", () => {
    const properties = [
      makeProperty({
        id: "prop-keep",
        name: "Maple Court",
        address: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      makeProperty({
        id: "prop-drop",
        name: "Riverside Lofts",
        address: "9 River Rd",
        city: "Dallas",
        zip: "75201",
      }),
    ];

    const result = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court",
        propertyAddress: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      properties,
      [],
    );

    expect(result.map((c) => c.propertyId)).toEqual(["prop-keep"]);
  });

  it("limits the result list to the top 5 candidates", () => {
    // 7 near-identical properties so each scores > 0 against the same query.
    const properties = Array.from({ length: 7 }, (_, i) =>
      makeProperty({
        id: `prop-${i}`,
        name: "Maple Court Apartments",
        address: `${100 + i} Maple St`,
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
    );

    const result = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "100 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
      properties,
      [],
    );

    expect(result).toHaveLength(5);
  });

  it("sorts by score descending", () => {
    const properties = [
      makeProperty({
        id: "prop-weakish",
        name: "Maple",
        address: "Some St",
        city: "Austin",
        zip: "00000",
      }),
      makeProperty({
        id: "prop-strong",
        name: "Maple Court Apartments",
        address: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      makeProperty({
        id: "prop-medium",
        name: "Maple Court",
        address: "Other Rd",
        city: "Austin",
        zip: "78702",
      }),
    ];

    const result = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      properties,
      [],
    );

    const scores = result.map((c) => c.score);
    const sortedDesc = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sortedDesc);
    expect(result[0]?.propertyId).toBe("prop-strong");
  });

  it("applies the +0.15 ZIP bump on an exact ZIP match", () => {
    // Two properties with identical name/address tokens. The only differing
    // input is the ZIP — so any score delta isolates the ZIP bump.
    const baseProp = {
      name: "Generic Building",
      address: "1 Main St",
      city: "Austin",
      state: "TX",
    };
    const properties = [
      makeProperty({ id: "prop-no-zip", ...baseProp, zip: "00000" }),
      makeProperty({ id: "prop-zip", ...baseProp, zip: "78701" }),
    ];

    const extracted = makeExtracted({
      propertyName: "Generic Building",
      propertyAddress: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });

    const result = rankPropertyCandidates(extracted, properties, []);
    const withZip = result.find((c) => c.propertyId === "prop-zip");
    const withoutZip = result.find((c) => c.propertyId === "prop-no-zip");
    expect(withZip).toBeDefined();
    expect(withoutZip).toBeDefined();
    // ZIP-matched property should score strictly higher.
    expect(withZip!.score).toBeGreaterThan(withoutZip!.score);
  });

  it("never returns a score above 1, even when the ZIP bump would overflow", () => {
    const properties = [
      makeProperty({
        id: "prop-perfect",
        name: "Maple Court Apartments",
        address: "123 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
    ];

    const [top] = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "123 Maple St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
      properties,
      [],
    );

    expect(top?.score).toBeLessThanOrEqual(1);
  });

  it("ignores generic stop tokens like 'st' / 'apt' so they don't inflate scores", () => {
    // Both queries differ only in those stop tokens. Without filtering, the
    // common 'st' would bump the score.
    const properties = [
      makeProperty({
        id: "prop-1",
        name: "Riverside Lofts",
        address: "9 River Rd",
        city: "Dallas",
        zip: "75201",
      }),
    ];
    const result = rankPropertyCandidates(
      // Query has only stop-tokens overlapping with property address.
      makeExtracted({ propertyAddress: "St Apt Unit", city: "Phoenix" }),
      properties,
      [],
    );
    expect(result).toEqual([]);
  });

  it("rounds scores to 3 decimal places for stable response payloads", () => {
    const properties = [
      makeProperty({
        id: "prop-1",
        name: "Maple Court Apartments",
        address: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
    ];
    const [top] = rankPropertyCandidates(
      makeExtracted({
        propertyName: "Maple Court Apartments",
        propertyAddress: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
      properties,
      [],
    );
    expect(top?.score).toBeDefined();
    // toFixed(3) → at most 3 fractional digits.
    const decimals = String(top!.score).split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(3);
  });

  it("handles extracted leases with all-null fields without throwing", () => {
    const properties = [
      makeProperty({
        id: "prop-1",
        name: "Maple Court",
        address: "123 Maple St",
        city: "Austin",
        zip: "78701",
      }),
    ];
    const result = rankPropertyCandidates(makeExtracted({}), properties, []);
    // Nothing to match on → no candidates.
    expect(result).toEqual([]);
  });
});
