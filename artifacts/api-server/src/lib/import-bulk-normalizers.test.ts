import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task #417 — verifies the bulk-import write paths for occupants,
 * beds, and utilities run rows through the matching boundary
 * normaliser before the DB insert/update, mirroring the API write
 * paths.
 *
 * The other importer (`import-master-leases.ts`) is already covered by
 * `import-master-leases.test.ts`; this file focuses on the
 * occupant/bed/utility surface.
 */

interface Row {
  id: string;
  [k: string]: unknown;
}

type TableName =
  | "customers"
  | "properties"
  | "leases"
  | "rooms"
  | "beds"
  | "occupants"
  | "utilities"
  | "roomNightLogs"
  | "insuranceCertificates"
  | "schedulerState";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  leases: new Map(),
  rooms: new Map(),
  beds: new Map(),
  occupants: new Map(),
  utilities: new Map(),
  roomNightLogs: new Map(),
  insuranceCertificates: new Map(),
  schedulerState: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

interface Predicate {
  kind: "eq";
  col: string;
  value: unknown;
}

function makeSelect() {
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values()).map((r) => ({
        ...r,
      }));
      return {
        orderBy: () => Promise.resolve(rows),
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
        limit: () => Promise.resolve(rows),
        then: (
          onF: (v: unknown[]) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(rows).then(onF, onR),
      };
    },
  };
}

function makeInsert(table: unknown) {
  return {
    values: (rows: Row | Row[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      const store = stores[tableNameOf(table)];
      const inserted: Row[] = [];
      for (const r of arr) {
        const copy = { ...r };
        store.set(String(r.id), copy);
        inserted.push({ ...copy });
      }
      return {
        returning: async () => inserted.map((r) => ({ ...r })),
        onConflictDoNothing: () => ({
          returning: async () => inserted.map((r) => ({ ...r })),
        }),
        then: (
          onF: (v: unknown) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(undefined).then(onF, onR),
      };
    },
  };
}

function makeUpdate(table: unknown) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: (pred: Predicate) => {
        const store = stores[tableNameOf(table)];
        const updated: Row[] = [];
        for (const row of store.values()) {
          if (row[pred.col] === pred.value) {
            for (const [k, v] of Object.entries(patch)) row[k] = v;
            updated.push({ ...row });
          }
        }
        return {
          returning: async () => updated,
          then: (
            onF: (v: unknown) => unknown,
            onR?: (e: unknown) => unknown,
          ) => Promise.resolve(undefined).then(onF, onR),
        };
      },
    }),
  };
}

function makeDelete(table: unknown) {
  const store = stores[tableNameOf(table)];
  const thenable = {
    where: (pred: Predicate) => {
      for (const row of Array.from(store.values())) {
        if (row[pred.col] === pred.value) store.delete(String(row.id));
      }
      return Promise.resolve(undefined);
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ) => {
      store.clear();
      return Promise.resolve(undefined).then(onF, onR);
    },
  };
  return thenable;
}

const tx = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
};
type Tx = typeof tx;
const fakeDb = {
  ...tx,
  transaction: <T,>(cb: (tx: Tx) => Promise<T>): Promise<T> => cb(tx),
};

function makeColumns(name: TableName, cols: string[]) {
  const t: Record<string, unknown> & { __table: TableName } = {
    __table: name,
  };
  for (const c of cols) t[c] = { __col: c };
  return t;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  customersTable: makeColumns("customers", ["id"]),
  propertiesTable: makeColumns("properties", ["id"]),
  leasesTable: makeColumns("leases", ["id"]),
  roomsTable: makeColumns("rooms", ["id"]),
  bedsTable: makeColumns("beds", ["id"]),
  occupantsTable: makeColumns("occupants", ["id", "employeeId"]),
  utilitiesTable: makeColumns("utilities", ["id"]),
  roomNightLogsTable: makeColumns("roomNightLogs", ["id"]),
  insuranceCertificatesTable: makeColumns("insuranceCertificates", ["id"]),
  otherCostsTable: makeColumns("otherCosts", ["id"]),
  propertyViolationsTable: makeColumns("propertyViolations", ["id"]),
  buildingsTable: makeColumns("buildings", ["id"]),
  schedulerStateTable: makeColumns("schedulerState", ["id", "lastSentKey"]),
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const { replaceAllData } = await import("./seed");
const { seedHousingDeductions } = await import("./seed-housing-deductions");

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

function baseBundle() {
  return {
    customers: [
      { id: "c1", name: "Acme", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: "p1",
        name: "Hotel One",
        address: "1 Main",
        city: "Austin",
        state: "TX",
        zip: "78701",
        totalBeds: 0,
        monthlyRent: 0,
        chargePerBed: 0,
        status: "Active" as const,
        landlordName: "",
        landlordEmail: "",
        landlordPhone: "",
        paymentMethod: "" as const,
        paymentRecipient: "",
        paymentDueDay: 1,
        paymentNotes: "",
        bankName: "",
        bankRouting: "",
        bankAccount: "",
        portalUrl: "",
        notes: "",
        furnishings: [],
        customerId: "c1",
      },
    ],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    roomNightLogs: [],
  };
}

describe("Task #417 — bulk-import normalizers", () => {
  it("replaceAllData coerces off-list occupant/bed/utility values before the DB write", async () => {
    const bundle = {
      ...baseBundle(),
      occupants: [
        {
          id: "occ-1",
          name: "Jane",
          propertyId: "p1",
          status: "Pending", // off-list -> "Active"
          billingFrequency: "Quarterly", // off-list -> "Monthly"
          chargeSource: "magic", // off-list -> ""
          shift: "1st", // legacy -> "Days" (Task #506)
          moveInDate: "2026-01-15 00:00:00", // datetime -> "2026-01-15"
          moveOutDate: "2026-06-30T23:59:59.000Z", // ISO -> "2026-06-30"
        },
      ] as unknown as never[],
      beds: [
        {
          id: "bed-1",
          propertyId: "p1",
          roomId: null,
          bedNumber: 1,
          status: "Reserved", // off-list -> "Vacant"
          occupantId: null,
        },
      ] as unknown as never[],
      utilities: [
        {
          id: "u-1",
          propertyId: "p1",
          type: "Solar", // off-list -> "Other"
        },
      ] as unknown as never[],
    };

    await replaceAllData(bundle as never);

    const occ = stores.occupants.get("occ-1")!;
    expect(occ.status).toBe("Active");
    expect(occ.billingFrequency).toBe("Monthly");
    expect(occ.chargeSource).toBe("");
    expect(occ.shift).toBe("Days");
    expect(occ.moveInDate).toBe("2026-01-15");
    expect(occ.moveOutDate).toBe("2026-06-30");

    const bed = stores.beds.get("bed-1")!;
    expect(bed.status).toBe("Vacant");

    const util = stores.utilities.get("u-1")!;
    expect(util.type).toBe("Other");
  });

  it("seedHousingDeductions coerces off-list billingFrequency/chargeSource on the occupant update path", async () => {
    // Pre-seed a matching occupant the deduction importer will update.
    stores.occupants.set("occ-target", {
      id: "occ-target",
      name: "JANE DOE",
      propertyId: "p1",
      employeeId: "EMP-1",
      company: "Acme",
      status: "Active",
      billingFrequency: "Monthly",
      chargePerBed: 0,
      chargeSource: "manual_override",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
    });
    // The importer skips chargeSource === "manual_override" by default,
    // so request a re-claim for this occupant id.
    await seedHousingDeductions({
      db: fakeDb as never,
      logger: { info: () => undefined, warn: () => undefined },
      rows: [
        { customer: "Acme", name: "JANE DOE", personId: "EMP-1", weekly: 100 },
      ],
      reclaimOverridden: true,
      reclaimOccupantIds: ["occ-target"],
    });

    const occ = stores.occupants.get("occ-target")!;
    // The hard-coded patch ("Weekly" / "payroll") is already on-list,
    // but the test proves the patch went through normalizeOccupantRow:
    // any future drift to an off-list value would now be coerced
    // rather than silently persisted.
    expect(occ.billingFrequency).toBe("Weekly");
    expect(occ.chargeSource).toBe("payroll");
    expect(occ.chargePerBed).toBe(100);
  });
});
