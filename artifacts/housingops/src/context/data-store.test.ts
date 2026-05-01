import { describe, it, expect } from "vitest";
import {
  inspectImportPayload,
  UnsupportedImportError,
  EXPORT_FORMAT_VERSION,
  LEGACY_CUSTOMER_ID,
} from "./data-store";

const exportedAt = "2026-04-01T12:00:00.000Z";

const sampleProperty = {
  id: "p1",
  customerId: "c1",
  name: "Maple House",
  address: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  totalBeds: 4,
  monthlyRent: 2400,
  chargePerBed: 600,
  status: "Active",
  landlordName: "Jane Doe",
  landlordEmail: "jane@example.com",
  landlordPhone: "555-0100",
  paymentMethod: "ACH",
  paymentRecipient: "Jane Doe LLC",
  paymentDueDay: 1,
  paymentNotes: "Auto-debit",
  bankName: "Acme Bank",
  bankRouting: "021000021",
  bankAccount: "1234567890",
  portalUrl: "",
  notes: "",
  furnishings: ["Queen beds"],
};

const sampleCustomer = {
  id: "c1",
  name: "Acme Co",
  contactName: "Jane Doe",
  email: "jane@example.com",
  phone: "555-0100",
  notes: "",
};

const v2Payload = {
  format: "housingops-export",
  version: EXPORT_FORMAT_VERSION,
  exportedAt,
  data: {
    customers: [sampleCustomer],
    properties: [sampleProperty],
    leases: [],
    beds: [],
    occupants: [],
    utilities: [],
  },
};

// v1: no `customers` array, properties have no `customerId`.
const { customerId: _ignored, ...v1PropertyAllFields } = sampleProperty;

const v1FullPayload = {
  format: "housingops-export",
  version: 1,
  exportedAt,
  data: {
    properties: [v1PropertyAllFields],
    leases: [],
    beds: [],
    occupants: [],
    utilities: [],
  },
};

// v1 backup from before landlord/payment/banking/furnishings existed.
const v1MinimalProperty = {
  id: "p-old",
  name: "Old Cottage",
  address: "9 Vintage Ln",
  city: "Boulder",
  state: "CO",
  zip: "80301",
  totalBeds: 2,
  monthlyRent: 1500,
  chargePerBed: 750,
  status: "Active",
};

const v1MinimalPayload = {
  format: "housingops-export",
  version: 1,
  exportedAt,
  data: {
    properties: [v1MinimalProperty],
    leases: [],
    beds: [],
    occupants: [],
    utilities: [],
  },
};

describe("inspectImportPayload", () => {
  it("accepts a valid v2 payload without migrating", () => {
    const preview = inspectImportPayload(v2Payload);

    expect(preview.migratedFromV1).toBe(false);
    expect(preview.summary).toEqual({
      customers: 1,
      properties: 1,
      leases: 0,
      beds: 0,
      occupants: 0,
      utilities: 0,
    });
    expect(preview.data.customers[0].id).toBe("c1");
    expect(preview.data.properties[0].customerId).toBe("c1");
  });

  it("accepts a v1 payload that already has all newer fields", () => {
    const preview = inspectImportPayload(v1FullPayload);

    expect(preview.migratedFromV1).toBe(true);
    expect(preview.summary.customers).toBe(1);
    expect(preview.summary.properties).toBe(1);
    expect(preview.data.customers[0].id).toBe(LEGACY_CUSTOMER_ID);

    const migrated = preview.data.properties[0];
    expect(migrated.customerId).toBe(LEGACY_CUSTOMER_ID);
    // Original values are preserved (not stomped on by defaults).
    expect(migrated.landlordName).toBe("Jane Doe");
    expect(migrated.paymentMethod).toBe("ACH");
    expect(migrated.bankName).toBe("Acme Bank");
    expect(migrated.furnishings).toEqual(["Queen beds"]);
  });

  it("migrates a v1 payload missing landlord/payment/banking/furnishings", () => {
    const preview = inspectImportPayload(v1MinimalPayload);

    expect(preview.migratedFromV1).toBe(true);
    expect(preview.data.customers).toHaveLength(1);
    expect(preview.data.customers[0].id).toBe(LEGACY_CUSTOMER_ID);
    expect(preview.data.customers[0].name).toBe("Legacy Properties");

    const migrated = preview.data.properties[0];
    expect(migrated.id).toBe("p-old");
    expect(migrated.customerId).toBe(LEGACY_CUSTOMER_ID);
    // Defaults filled in for fields that didn't exist in old backups.
    expect(migrated.landlordName).toBe("");
    expect(migrated.landlordEmail).toBe("");
    expect(migrated.landlordPhone).toBe("");
    expect(migrated.paymentMethod).toBe("ACH");
    expect(migrated.paymentRecipient).toBe("");
    expect(migrated.paymentDueDay).toBe(0);
    expect(migrated.paymentNotes).toBe("");
    expect(migrated.bankName).toBe("");
    expect(migrated.bankRouting).toBe("");
    expect(migrated.bankAccount).toBe("");
    expect(migrated.portalUrl).toBe("");
    expect(migrated.notes).toBe("");
    expect(migrated.furnishings).toEqual([]);
  });

  it("throws a friendly error for a payload that isn't a HousingOps export", () => {
    expect(() => inspectImportPayload({ hello: "world" })).toThrow(
      UnsupportedImportError,
    );

    try {
      inspectImportPayload({ hello: "world" });
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedImportError);
      expect((err as Error).message).toMatch(/doesn't look like a HousingOps export/i);
    }
  });

  it("throws a 'newer format' error for a future version payload", () => {
    const futurePayload = {
      format: "housingops-export",
      version: EXPORT_FORMAT_VERSION + 1,
      exportedAt,
      data: {
        customers: [],
        properties: [],
        leases: [],
        beds: [],
        occupants: [],
        utilities: [],
      },
    };

    expect(() => inspectImportPayload(futurePayload)).toThrow(
      UnsupportedImportError,
    );

    try {
      inspectImportPayload(futurePayload);
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedImportError);
      expect((err as Error).message).toMatch(/newer format/i);
      expect((err as Error).message).toContain(
        `v${EXPORT_FORMAT_VERSION + 1}`,
      );
    }
  });
});
