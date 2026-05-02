import { describe, it, expect } from "vitest";
import {
  inspectImportPayload,
  UnsupportedImportError,
  EXPORT_FORMAT_VERSION,
  LEGACY_CUSTOMER_ID,
  mergeImportBundles,
  totalImportSummary,
  type ExportData,
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

const sampleRoom = {
  id: "r1",
  propertyId: "p1",
  name: "Master",
  sqft: 200,
  bathrooms: 1,
  monthlyRent: 1000,
};

const v3Payload = {
  format: "housingops-export",
  version: EXPORT_FORMAT_VERSION,
  exportedAt,
  data: {
    customers: [sampleCustomer],
    properties: [sampleProperty],
    leases: [],
    rooms: [sampleRoom],
    beds: [],
    occupants: [],
    utilities: [],
  },
};

// v2 payloads carry no `rooms` array; beds have a free-text `room` column.
const v2Payload = {
  format: "housingops-export",
  version: 2,
  exportedAt,
  data: {
    customers: [sampleCustomer],
    properties: [sampleProperty],
    leases: [],
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Master", status: "Vacant", occupantId: null },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "Master", status: "Vacant", occupantId: null },
      { id: "b3", propertyId: "p1", bedNumber: 3, room: "Guest",  status: "Vacant", occupantId: null },
      { id: "b4", propertyId: "p1", bedNumber: 4, room: "",       status: "Vacant", occupantId: null },
    ],
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
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Suite A", status: "Vacant", occupantId: null },
    ],
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
  it("accepts a valid v3 payload without migrating", () => {
    const preview = inspectImportPayload(v3Payload);

    expect(preview.migratedFromV1).toBe(false);
    expect(preview.migratedRooms).toBe(false);
    expect(preview.summary).toEqual({
      customers: 1,
      properties: 1,
      leases: 0,
      rooms: 1,
      beds: 0,
      occupants: 0,
      utilities: 0,
    });
    expect(preview.data.customers[0].id).toBe("c1");
    expect(preview.data.properties[0].customerId).toBe("c1");
    expect(preview.data.rooms[0].id).toBe("r1");
  });

  it("migrates a v2 payload by synthesizing rooms from bed.room strings", () => {
    const preview = inspectImportPayload(v2Payload);

    expect(preview.migratedFromV1).toBe(false);
    expect(preview.migratedRooms).toBe(true);

    // Two unique non-empty room names plus one empty → "Unassigned".
    expect(preview.data.rooms).toHaveLength(3);
    const names = preview.data.rooms.map(r => r.name).sort();
    expect(names).toEqual(["Guest", "Master", "Unassigned"]);
    for (const room of preview.data.rooms) {
      expect(room.propertyId).toBe("p1");
      expect(room.sqft).toBe(0);
      expect(room.bathrooms).toBe(0);
      expect(room.monthlyRent).toBe(0);
    }

    // All beds now reference a real roomId (no empty strings).
    expect(preview.data.beds).toHaveLength(4);
    for (const bed of preview.data.beds) {
      expect(bed.roomId).not.toBe("");
      expect(preview.data.rooms.some(r => r.id === bed.roomId)).toBe(true);
    }

    // Beds in the same legacy room name share a roomId.
    const masterRoom = preview.data.rooms.find(r => r.name === "Master")!;
    const masterBeds = preview.data.beds.filter(b => b.roomId === masterRoom.id);
    expect(masterBeds).toHaveLength(2);
    expect(masterBeds.map(b => b.id).sort()).toEqual(["b1", "b2"]);

    expect(preview.summary.rooms).toBe(3);
    expect(preview.summary.beds).toBe(4);
  });

  it("accepts a v1 payload that already has all newer fields and migrates rooms", () => {
    const preview = inspectImportPayload(v1FullPayload);

    expect(preview.migratedFromV1).toBe(true);
    expect(preview.migratedRooms).toBe(true);
    expect(preview.summary.customers).toBe(1);
    expect(preview.summary.properties).toBe(1);
    expect(preview.summary.rooms).toBe(1);
    expect(preview.data.customers[0].id).toBe(LEGACY_CUSTOMER_ID);

    const migrated = preview.data.properties[0];
    expect(migrated.customerId).toBe(LEGACY_CUSTOMER_ID);
    // Original values are preserved (not stomped on by defaults).
    expect(migrated.landlordName).toBe("Jane Doe");
    expect(migrated.paymentMethod).toBe("ACH");
    expect(migrated.bankName).toBe("Acme Bank");
    expect(migrated.furnishings).toEqual(["Queen beds"]);

    expect(preview.data.rooms[0].name).toBe("Suite A");
    expect(preview.data.beds[0].roomId).toBe(preview.data.rooms[0].id);
  });

  it("migrates a v1 payload missing landlord/payment/banking/furnishings", () => {
    const preview = inspectImportPayload(v1MinimalPayload);

    expect(preview.migratedFromV1).toBe(true);
    expect(preview.migratedRooms).toBe(true);
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

    // No legacy beds → no synthesized rooms.
    expect(preview.data.rooms).toEqual([]);
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
        rooms: [],
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

// ── Merge import logic ──────────────────────────────────────────────────
// These tests exercise mergeImportBundles directly so we can verify the
// "X added, Y updated" semantics surfaced in the import dialog without
// needing a React tree.

const baseProperty = (id: string, overrides: Partial<typeof sampleProperty> = {}) => ({
  ...sampleProperty,
  id,
  ...overrides,
});

const baseCustomer = (id: string, overrides: Partial<typeof sampleCustomer> = {}) => ({
  ...sampleCustomer,
  id,
  ...overrides,
});

const emptyBundle = (): ExportData => ({
  customers: [],
  properties: [],
  leases: [],
  rooms: [],
  beds: [],
  occupants: [],
  utilities: [],
});

describe("mergeImportBundles", () => {
  it("adds new records and reports them as added", () => {
    const current: ExportData = {
      ...emptyBundle(),
      customers: [baseCustomer("c1")],
      properties: [baseProperty("p1")],
    };
    const incoming: ExportData = {
      ...emptyBundle(),
      customers: [baseCustomer("c2", { name: "New Co" })],
      properties: [baseProperty("p2", { name: "New Place" })],
    };

    const merged = mergeImportBundles(current, incoming);

    expect(merged.added).toEqual({
      customers: 1,
      properties: 1,
      leases: 0,
      rooms: 0,
      beds: 0,
      occupants: 0,
      utilities: 0,
    });
    expect(merged.updated.customers).toBe(0);
    expect(merged.updated.properties).toBe(0);
    expect(merged.data.customers.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(merged.data.properties.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("overwrites existing records with the same id and reports them as updated", () => {
    const current: ExportData = {
      ...emptyBundle(),
      properties: [baseProperty("p1", { name: "Old Name" })],
    };
    const incoming: ExportData = {
      ...emptyBundle(),
      properties: [baseProperty("p1", { name: "New Name" })],
    };

    const merged = mergeImportBundles(current, incoming);

    expect(merged.added.properties).toBe(0);
    expect(merged.updated.properties).toBe(1);
    expect(merged.data.properties).toHaveLength(1);
    expect(merged.data.properties[0].name).toBe("New Name");
  });

  it("does not count records whose content is unchanged", () => {
    const property = baseProperty("p1", { name: "Same" });
    const current: ExportData = { ...emptyBundle(), properties: [property] };
    const incoming: ExportData = { ...emptyBundle(), properties: [{ ...property }] };

    const merged = mergeImportBundles(current, incoming);

    expect(merged.added.properties).toBe(0);
    expect(merged.updated.properties).toBe(0);
    expect(merged.data.properties).toHaveLength(1);
  });

  it("preserves local-only records that are not in the imported file", () => {
    const current: ExportData = {
      ...emptyBundle(),
      properties: [baseProperty("p1"), baseProperty("p2", { name: "Keep me" })],
    };
    const incoming: ExportData = {
      ...emptyBundle(),
      properties: [baseProperty("p3", { name: "From file" })],
    };

    const merged = mergeImportBundles(current, incoming);

    expect(merged.added.properties).toBe(1);
    expect(merged.updated.properties).toBe(0);
    const ids = merged.data.properties.map((p) => p.id).sort();
    expect(ids).toEqual(["p1", "p2", "p3"]);
    // The local-only "Keep me" property is untouched.
    expect(merged.data.properties.find((p) => p.id === "p2")?.name).toBe("Keep me");
  });

  it("merges all entity types independently", () => {
    const current: ExportData = {
      customers: [baseCustomer("c1")],
      properties: [baseProperty("p1")],
      leases: [{ id: "l1", propertyId: "p1", startDate: "2024-01-01", endDate: "2025-01-01", monthlyRent: 100, securityDeposit: 200, status: "Active" as const, notes: "" }],
      rooms: [{ id: "r1", propertyId: "p1", name: "Master", sqft: 100, bathrooms: 1, monthlyRent: 500 }],
      beds: [{ id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Vacant" as const, occupantId: null }],
      occupants: [],
      utilities: [],
    };
    const incoming: ExportData = {
      customers: [baseCustomer("c1", { name: "Renamed" })], // updated
      properties: [baseProperty("p2", { name: "New" })], // added
      leases: [], // nothing
      rooms: [], // nothing
      beds: [{ id: "b1", propertyId: "p1", bedNumber: 1, roomId: "r1", status: "Vacant" as const, occupantId: null }], // unchanged
      occupants: [],
      utilities: [{ id: "u1", propertyId: "p1", type: "Electric" as const, company: "X", monthlyCost: 100, accountNumber: "", notes: "" }], // added
    };

    const merged = mergeImportBundles(current, incoming);

    expect(merged.added).toEqual({
      customers: 0,
      properties: 1,
      leases: 0,
      rooms: 0,
      beds: 0,
      occupants: 0,
      utilities: 1,
    });
    expect(merged.updated).toEqual({
      customers: 1,
      properties: 0,
      leases: 0,
      rooms: 0,
      beds: 0,
      occupants: 0,
      utilities: 0,
    });
    expect(totalImportSummary(merged.added)).toBe(2);
    expect(totalImportSummary(merged.updated)).toBe(1);
  });
});
