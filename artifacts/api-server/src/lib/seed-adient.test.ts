import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}
type TableName = "customers" | "properties" | "leases";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  leases: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type Predicate =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "like"; col: string; pattern: string }
  | { kind: "and"; parts: Predicate[] };

function rowField(row: Row, col: string): unknown {
  return row[col];
}

function likeMatch(haystack: unknown, pattern: string): boolean {
  if (typeof haystack !== "string") return false;
  const escaped = pattern
    .replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    .replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`).test(haystack);
}

function matches(row: Row, p: Predicate): boolean {
  if (p.kind === "eq") return rowField(row, p.col) === p.value;
  if (p.kind === "like") return likeMatch(rowField(row, p.col), p.pattern);
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
  like: (col: { __col: string }, pattern: string) => ({
    kind: "like" as const,
    col: col.__col,
    pattern,
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
    address: { __col: "address" },
    zip: { __col: "zip" },
  },
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    startDate: { __col: "startDate" },
    endDate: { __col: "endDate" },
    notes: { __col: "notes" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedAdientIfMissing,
  ADIENT_CUSTOMER_ID,
  ADIENT_PROPERTY_ID,
  adientLeaseId,
} = await import("./seed-adient");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedAdientIfMissing", () => {
  it("inserts customer, property, and 5 leases on a fresh DB", async () => {
    const result = await seedAdientIfMissing({ logger: silentLogger });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 5,
    });
    expect(stores.customers.has(ADIENT_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(ADIENT_PROPERTY_ID)).toBe(true);
    for (const unit of [3, 4, 7, 8, 19]) {
      expect(stores.leases.has(adientLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with the Versailles address and Dunn landlord", async () => {
    await seedAdientIfMissing({ logger: silentLogger });

    const property = stores.properties.get(ADIENT_PROPERTY_ID)!;
    expect(property["address"]).toBe("308 Fairgrounds Rd");
    expect(property["city"]).toBe("Versailles");
    expect(property["state"]).toBe("MO");
    expect(property["zip"]).toBe("65084");
    expect(property["landlordName"]).toBe("Dunn Property Management LLC");
    expect(property["customerId"]).toBe(ADIENT_CUSTOMER_ID);
    expect(String(property["notes"])).toMatch(/Econolodge/i);
  });

  it("seeds each lease with the correct deposit, term, and verbatim source PDF filename", async () => {
    await seedAdientIfMissing({ logger: silentLogger });

    const expected: Record<number, { deposit: number; source: string }> = {
      3:  { deposit: 0,    source: "Lease_Agreement_-_308_Fairground_Unit_3_1778105368416.pdf" },
      4:  { deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_4_1778105368416.pdf" },
      7:  { deposit: 0,    source: "Lease_Agreement_-_308_Fairground_Unit_7_1778105368416.pdf" },
      8:  { deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_8_1778105368417.pdf" },
      19: { deposit: 1000, source: "Lease_Agreement_-_308_Fairground_Unit_19_1778105368416.pdf" },
    };
    for (const [unitStr, want] of Object.entries(expected)) {
      const unit = Number(unitStr);
      const lease = stores.leases.get(adientLeaseId(unit))!;
      expect(lease["securityDeposit"]).toBe(want.deposit);
      expect(lease["monthlyRent"]).toBe(1000);
      expect(lease["startDate"]).toBe("2025-05-01");
      expect(lease["endDate"]).toBe("2025-10-31");
      expect(lease["status"]).toBe("Active");
      const clauses = String(lease["clauses"]);
      expect(clauses).toMatch(/KFI Staffing/);
      expect(clauses).toMatch(/\$100/);
      expect(clauses).toMatch(/month-to-month/i);
      expect(clauses).toContain(`Source document: ${want.source}`);
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedAdientIfMissing({ logger: silentLogger });

    const before = stores.properties.get(ADIENT_PROPERTY_ID)!;
    stores.properties.set(ADIENT_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@dunnproperties.example",
    });

    const second = await seedAdientIfMissing({ logger: silentLogger });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
    });

    const after = stores.properties.get(ADIENT_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@dunnproperties.example");
  });

  it("reuses pre-existing Adient customer/property created under different IDs (natural-key match)", async () => {
    stores.customers.set("operator-cust-1", {
      id: "operator-cust-1",
      name: "Adient",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator notes",
    });
    stores.properties.set("operator-prop-1", {
      id: "operator-prop-1",
      customerId: "operator-cust-1",
      name: "Versailles",
      address: "308 Fairgrounds Rd",
      city: "Versailles",
      state: "MO",
      zip: "65084",
      landlordName: "Dunn Property Management LLC",
      notes: "operator property notes",
    });
    stores.leases.set("operator-lease-u7", {
      id: "operator-lease-u7",
      propertyId: "operator-prop-1",
      startDate: "2025-05-01",
      endDate: "2025-10-31",
      monthlyRent: 1000,
      securityDeposit: 0,
      status: "Active",
      notes: "Unit 7 — operator",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
    });

    const result = await seedAdientIfMissing({ logger: silentLogger });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(false);
    expect(result.leasesInserted).toBe(4);
    expect(stores.customers.has(ADIENT_CUSTOMER_ID)).toBe(false);
    expect(stores.properties.has(ADIENT_PROPERTY_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    expect(stores.properties.size).toBe(1);
    expect(stores.leases.size).toBe(5);
    for (const lease of stores.leases.values()) {
      expect(lease["propertyId"]).toBe("operator-prop-1");
    }
    expect(stores.leases.get("operator-lease-u7")!["notes"]).toBe(
      "Unit 7 — operator",
    );
    expect(stores.properties.get("operator-prop-1")!["notes"]).toBe(
      "operator property notes",
    );
  });
});
