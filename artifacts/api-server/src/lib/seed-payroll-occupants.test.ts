import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}
type TableName = "customers" | "properties" | "occupants";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  occupants: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type Predicate =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "and"; parts: Predicate[] };

function rowField(row: Row, col: string): unknown {
  return row[col];
}

function matches(row: Row, p: Predicate): boolean {
  if (p.kind === "eq") return rowField(row, p.col) === p.value;
  return p.parts.every((q) => matches(row, q));
}

function makeSelect(projection: Record<string, { __col: string }>) {
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values());
      const project = (matched: Row[]) =>
        matched.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(projection)) {
            out[k] = rowField(r, v.__col);
          }
          return out;
        });
      return {
        where: (pred: Predicate) => {
          const filtered = rows.filter((r) => matches(r, pred));
          const projected = project(filtered);
          return {
            then: (
              onF: (v: unknown[]) => unknown,
              onR?: (e: unknown) => unknown,
            ) => Promise.resolve(projected).then(onF, onR),
            limit: (n: number) => Promise.resolve(projected.slice(0, n)),
          };
        },
      };
    },
  };
}

function makeInsert(table: unknown) {
  return {
    values: (rows: Row | Row[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      return {
        onConflictDoNothing: () => ({
          returning: async (_cols?: unknown) => {
            const store = stores[tableNameOf(table)];
            const inserted: Row[] = [];
            for (const row of arr) {
              if (!store.has(row.id)) {
                store.set(row.id, { ...row });
                inserted.push({ id: row.id });
              }
            }
            return inserted;
          },
        }),
      };
    },
  };
}

const tx = { select: makeSelect, insert: makeInsert };
type Tx = typeof tx;
const fakeDb = {
  select: makeSelect,
  insert: makeInsert,
  transaction: <T,>(cb: (tx: Tx) => Promise<T>): Promise<T> => cb(tx),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
  and: (...parts: Predicate[]) => ({ kind: "and" as const, parts }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  customersTable: {
    __table: "customers",
    id: { __col: "id" },
    name: { __col: "name" },
  },
  propertiesTable: {
    __table: "properties",
    id: { __col: "id" },
    customerId: { __col: "customerId" },
    name: { __col: "name" },
  },
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    employeeId: { __col: "employeeId" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedPayrollOccupantsIfMissing,
  PAYROLL_OCCUPANTS,
  pendingPlacementPropertyName,
} = await import("./seed-payroll-occupants");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedPayrollOccupantsIfMissing", () => {
  it("inserts a customer + pending-placement property + occupant for every payroll row on a fresh DB", async () => {
    const result = await seedPayrollOccupantsIfMissing({
      logger: silentLogger,
    });

    // 9 distinct customers across the 56-row payroll snapshot.
    expect(result.customersInserted).toBe(9);
    expect(result.propertiesInserted).toBe(9);
    expect(result.occupantsInserted).toBe(PAYROLL_OCCUPANTS.length);
    expect(stores.occupants.size).toBe(PAYROLL_OCCUPANTS.length);

    for (const occ of PAYROLL_OCCUPANTS) {
      const row = stores.occupants.get(`occ-payroll-${occ.personId}`)!;
      expect(row).toBeDefined();
      expect(row["employeeId"]).toBe(occ.personId);
      expect(row["company"]).toBe(occ.customer);
      expect(row["chargePerBed"]).toBe(occ.weekly);
      expect(row["billingFrequency"]).toBe("Weekly");
      expect(row["status"]).toBe("Active");
      expect(row["bedId"]).toBeNull();
      // Property must belong to the same customer and be the
      // pending-placement bucket.
      const property = stores.properties.get(row["propertyId"] as string)!;
      expect(property).toBeDefined();
      expect(property["name"]).toBe(pendingPlacementPropertyName(occ.customer));
    }
  });

  it("reuses a pre-existing customer matched by name and does not insert a duplicate", async () => {
    stores.customers.set("operator-cust-adient", {
      id: "operator-cust-adient",
      name: "Adient",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator notes",
      state: "MO",
    });

    const result = await seedPayrollOccupantsIfMissing({
      logger: silentLogger,
    });

    expect(result.customersInserted).toBe(8);
    expect(stores.customers.get("operator-cust-adient")!["notes"]).toBe(
      "operator notes",
    );
    const adientProp = Array.from(stores.properties.values()).find(
      (p) => p["name"] === pendingPlacementPropertyName("Adient"),
    )!;
    expect(adientProp["customerId"]).toBe("operator-cust-adient");
  });

  it("is idempotent: re-running yields no further inserts and does not overwrite operator edits", async () => {
    await seedPayrollOccupantsIfMissing({ logger: silentLogger });

    const sample = stores.occupants.get("occ-payroll-2004810")!;
    stores.occupants.set("occ-payroll-2004810", {
      ...sample,
      name: "Andrew Granville (operator-edited)",
      chargePerBed: 999,
    });

    const second = await seedPayrollOccupantsIfMissing({
      logger: silentLogger,
    });

    expect(second).toEqual({
      customersInserted: 0,
      propertiesInserted: 0,
      occupantsInserted: 0,
    });
    const after = stores.occupants.get("occ-payroll-2004810")!;
    expect(after["name"]).toBe("Andrew Granville (operator-edited)");
    expect(after["chargePerBed"]).toBe(999);
  });

  it("does not insert a duplicate occupant when one already exists for the same employeeId under a different id", async () => {
    stores.customers.set("cust-adient", {
      id: "cust-adient",
      name: "Adient",
      state: "MO",
      notes: "",
      contactName: "",
      email: "",
      phone: "",
    });
    stores.occupants.set("legacy-andrew", {
      id: "legacy-andrew",
      name: "Andrew Granville",
      employeeId: "2004810",
      company: "Adient",
      chargePerBed: 0,
      billingFrequency: "Monthly",
      status: "Active",
      propertyId: null,
      bedId: null,
    });

    const result = await seedPayrollOccupantsIfMissing({
      logger: silentLogger,
    });

    expect(stores.occupants.has("occ-payroll-2004810")).toBe(false);
    // 56 payroll rows, 1 already exists → 55 inserted.
    expect(result.occupantsInserted).toBe(PAYROLL_OCCUPANTS.length - 1);
  });

  it("covers all 56 payroll rows from Task #305's unmatched snapshot", () => {
    expect(PAYROLL_OCCUPANTS.length).toBe(56);
    const customers = new Set(PAYROLL_OCCUPANTS.map((r) => r.customer));
    expect(customers.size).toBe(9);
    // Every row carries a non-empty personId — that's the matcher key
    // the deduction seeder uses.
    for (const r of PAYROLL_OCCUPANTS) {
      expect(r.personId).toMatch(/^\d+$/);
    }
  });
});
