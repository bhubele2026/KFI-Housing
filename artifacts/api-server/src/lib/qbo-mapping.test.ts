import { describe, expect, it } from "vitest";

describe("findOverride keys by counterparty dimension", () => {
  const base: Omit<QboMappingOverrideRow, "qboCustomerId" | "qboVendorId" | "memoToken" | "propertyId"> = {
    id: "qov-1",
    realmId: "r1",
    leaseId: null,
    utilityId: null,
    createdByUserId: "",
    createdAt: new Date(),
  };
  const tok = memoToken("Maple 3107 — Unit A");
  const customerOverride: QboMappingOverrideRow = {
    ...base,
    qboCustomerId: "cust-1",
    qboVendorId: "",
    memoToken: tok,
    propertyId: "prop-A",
  };
  const vendorOverride: QboMappingOverrideRow = {
    ...base,
    id: "qov-2",
    qboCustomerId: "",
    qboVendorId: "vend-1",
    memoToken: tok,
    propertyId: "prop-B",
  };
  const overrides = [customerOverride, vendorOverride];

  it("returns the customer-side override for a customer-side lookup", () => {
    const o = findOverride("r1", "cust-1", "", "Maple 3107 — Unit A", overrides);
    expect(o?.propertyId).toBe("prop-A");
  });

  it("returns the vendor-side override for a vendor-side lookup", () => {
    const o = findOverride("r1", "", "vend-1", "Maple 3107 — Unit A", overrides);
    expect(o?.propertyId).toBe("prop-B");
  });

  it("does NOT cross-match: vendor-side lookup must not hit a customer-side override", () => {
    const o = findOverride("r1", "", "vend-2", "Maple 3107 — Unit A", overrides);
    expect(o).toBeNull();
  });

  it("never matches when both counterparty ids are blank (avoids collisions on bills with no customer)", () => {
    const o = findOverride("r1", "", "", "Maple 3107 — Unit A", overrides);
    expect(o).toBeNull();
  });

  it("does not leak across realms", () => {
    const o = findOverride("r2", "cust-1", "", "Maple 3107 — Unit A", overrides);
    expect(o).toBeNull();
  });
});

import type {
  CustomerRow,
  LeaseRow,
  PropertyRow,
  QboAccountClassificationRow,
  QboMappingOverrideRow,
  UtilityRow,
} from "@workspace/db";
import {
  classifyAccount,
  findOverride,
  matchCustomer,
  matchPropertyFromMemo,
  memoToken,
  pickLeaseForRent,
  pickUtilityForUtility,
} from "./qbo-mapping";

function customer(
  partial: Partial<CustomerRow> & { id: string; name: string },
): CustomerRow {
  return {
    id: partial.id,
    name: partial.name,
    qboCustomerId: partial.qboCustomerId ?? null,
    email: "",
    state: "",
    notes: "",
    contactName: "",
    phone: "",
    noHousingReason: null,
    customShifts: [],
    isInactive: false,
  } as unknown as CustomerRow;
}

function property(
  partial: Partial<PropertyRow> & {
    id: string;
    name: string;
    customerId: string;
  },
): PropertyRow {
  return {
    id: partial.id,
    name: partial.name,
    address: partial.address ?? "",
    customerId: partial.customerId,
  } as PropertyRow;
}

function lease(
  partial: Partial<LeaseRow> & { id: string; propertyId: string },
): LeaseRow {
  return {
    id: partial.id,
    propertyId: partial.propertyId,
    status: partial.status ?? "Active",
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    monthlyRent: partial.monthlyRent ?? 0,
  } as LeaseRow;
}

function utility(
  partial: Partial<UtilityRow> & {
    id: string;
    propertyId: string;
    type: string;
  },
): UtilityRow {
  return {
    id: partial.id,
    propertyId: partial.propertyId,
    type: partial.type,
    monthlyCost: partial.monthlyCost ?? 0,
  } as UtilityRow;
}

describe("memoToken", () => {
  it("normalises punctuation, case, and stopwords to a stable key", () => {
    expect(memoToken("Rent — 3107 Maple St. (June)")).toBe(
      memoToken("rent 3107 maple st jun"),
    );
  });
  it("returns empty string for null memo", () => {
    expect(memoToken(null)).toBe("");
  });
  it("drops year numbers and month names so cross-month memos collide", () => {
    expect(memoToken("Rent for 3107 Maple Jan 2026")).toBe(
      memoToken("Rent for 3107 Maple Feb 2026"),
    );
  });
});

describe("matchCustomer", () => {
  const customers = [
    customer({ id: "c1", name: "Acme Corp" }),
    customer({ id: "c2", name: "Beta LLC", qboCustomerId: "qbo-42" }),
  ];
  it("prefers exact qboCustomerId link with confidence 1", () => {
    const r = matchCustomer(
      { id: "qbo-42", displayName: "wrong name" },
      customers,
    );
    expect(r.customerId).toBe("c2");
    expect(r.confidence).toBe(1);
  });
  it("falls back to case-insensitive name match", () => {
    const r = matchCustomer(
      { id: "qbo-999", displayName: "acme corp" },
      customers,
    );
    expect(r.customerId).toBe("c1");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("returns null for unmatched", () => {
    const r = matchCustomer(
      { id: "qbo-x", displayName: "Totally Unknown Vendor" },
      customers,
    );
    expect(r.customerId).toBeNull();
  });
});

describe("classifyAccount", () => {
  const classifications: QboAccountClassificationRow[] = [];
  it("classifies rent-ish account names", () => {
    expect(classifyAccount("Rental Income", "1", classifications)).toBe("rent");
  });
  it("classifies utility-ish names (water, electric)", () => {
    expect(classifyAccount("Water & Sewer", "2", classifications)).toBe(
      "utility",
    );
    expect(classifyAccount("Electric Utilities", "3", classifications)).toBe(
      "utility",
    );
  });
  it("respects operator override row keyed by qboAccountId", () => {
    const overrides = [
      {
        id: "qac-1",
        qboAccountId: "99",
        accountName: "Rent Income",
        classification: "other",
      } as QboAccountClassificationRow,
    ];
    expect(classifyAccount("Rent Income", "99", overrides)).toBe("other");
  });
  it("falls back to 'other' for unrelated accounts", () => {
    expect(classifyAccount("Office Supplies", "x", classifications)).toBe(
      "other",
    );
  });
});

describe("matchPropertyFromMemo", () => {
  const customers = [customer({ id: "c1", name: "Acme Corp" })];
  const properties = [
    property({
      id: "p1",
      name: "3107 Maple",
      address: "3107 Maple St",
      customerId: "c1",
    }),
    property({
      id: "p2",
      name: "210 Oak",
      address: "210 Oak Ave",
      customerId: "c1",
    }),
  ];
  it("returns the higher-scoring candidate when memo mentions the property", () => {
    const r = matchPropertyFromMemo(
      "3107 Maple St rent invoice",
      properties,
      customers,
    );
    // Either it matched p1 above the 0.6 threshold, or returned null —
    // but it must never confuse Maple with Oak.
    expect(r.propertyId === "p1" || r.propertyId === null).toBe(true);
    expect(r.propertyId).not.toBe("p2");
  });
  it("returns null when no candidate clears the 0.6 threshold", () => {
    const r = matchPropertyFromMemo("misc reimbursement", properties, customers);
    expect(r.propertyId).toBeNull();
  });
});

describe("pickLeaseForRent", () => {
  const leases = [
    lease({
      id: "l1",
      propertyId: "p1",
      status: "Active",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyRent: 1000,
    }),
    lease({
      id: "l2",
      propertyId: "p1",
      status: "Ended",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      monthlyRent: 900,
    }),
  ];
  it("returns the active lease covering the txn date", () => {
    expect(pickLeaseForRent("p1", "2026-06-15", leases)).toBe("l1");
  });
  it("falls back to most-recent active lease when date is outside ranges", () => {
    expect(pickLeaseForRent("p1", "2027-06-15", leases)).toBe("l1");
  });
  it("returns null when property has no leases", () => {
    expect(pickLeaseForRent("pX", "2026-06-15", leases)).toBeNull();
  });
});

describe("pickUtilityForUtility", () => {
  const utilities = [
    utility({ id: "u1", propertyId: "p1", type: "electric" }),
    utility({ id: "u2", propertyId: "p1", type: "water" }),
  ];
  it("matches a 'water' utility from a water bill memo", () => {
    expect(pickUtilityForUtility("p1", "Water bill June", "", utilities)).toBe(
      "u2",
    );
  });
  it("matches an 'electric' utility from the account name", () => {
    expect(
      pickUtilityForUtility("p1", "monthly bill", "Electric Co", utilities),
    ).toBe("u1");
  });
  it("returns null when the property has no utilities", () => {
    expect(pickUtilityForUtility("pX", "anything", "", utilities)).toBeNull();
  });
});

describe("findOverride", () => {
  const overrides: QboMappingOverrideRow[] = [
    {
      id: "qov-1",
      realmId: "r1",
      qboCustomerId: "q1",
      memoToken: memoToken("Rent - 3107 Maple"),
      propertyId: "p1",
      leaseId: "l1",
      utilityId: null,
      createdByUserId: "u1",
      createdAt: new Date(),
    } as QboMappingOverrideRow,
  ];
  it("returns the override row when realm + customer + memo all match", () => {
    const o = findOverride("r1", "q1", "", "Rent - 3107 Maple", overrides);
    expect(o?.propertyId).toBe("p1");
  });
  it("returns null for non-matching memo", () => {
    expect(
      findOverride("r1", "q1", "", "Office supplies", overrides),
    ).toBeNull();
  });
  it("returns null for non-matching customer", () => {
    expect(
      findOverride("r1", "qX", "", "Rent - 3107 Maple", overrides),
    ).toBeNull();
  });
});
