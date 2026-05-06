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
  seedHickoryHavenIfMissing,
  HICKORY_HAVEN_CUSTOMER_ID,
  HICKORY_HAVEN_PROPERTY_ID,
  hickoryHavenLeaseId,
} = await import("./seed-hickory-haven");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["6", "8", "11", "12"] as const;

const EXPECTED: Record<
  string,
  { startDate: string; rent: number; deposit: number; source: string }
> = {
  "6": {
    startDate: "2026-02-27",
    rent: 1075,
    deposit: 1075,
    source: "Lease_Agreement_-_Unit_6_1778107900898.pdf",
  },
  "8": {
    startDate: "2026-02-27",
    rent: 900,
    deposit: 900,
    source: "Lease_Agreement_-_Unit_8_1778107900898.pdf",
  },
  "11": {
    startDate: "2026-03-13",
    rent: 900,
    deposit: 900,
    source: "Lease_Agreement_-_Unit_11_1778107900898.pdf",
  },
  "12": {
    startDate: "2026-03-13",
    rent: 1075,
    deposit: 1075,
    source: "Lease_Agreement_-_Unit_12_1778107900898.pdf",
  },
};

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedHickoryHavenIfMissing", () => {
  it("inserts customer, property, and 4 leases on a fresh DB", async () => {
    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 4,
    });
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(HICKORY_HAVEN_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(hickoryHavenLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property at 600 W Hickory St, Gilman, WI with the right landlord", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const property = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(property["address"]).toBe("600 W Hickory St");
    expect(property["city"]).toBe("Gilman");
    expect(property["state"]).toBe("WI");
    expect(property["zip"]).toBe("54433");
    expect(property["landlordName"]).toBe("Hickory Haven Apartments LLC");
    expect(property["landlordEmail"]).toBe("jnagelpcc@gmail.com");
    expect(property["landlordPhone"]).toBe("(715) 290-0025");
    expect(property["customerId"]).toBe(HICKORY_HAVEN_CUSTOMER_ID);
    // Sum of the 4 unit rents: 1075 + 900 + 900 + 1075 = 3950
    expect(property["monthlyRent"]).toBe(3950);
    // Insurance certificate noted as attachment, not as feature work
    expect(String(property["notes"])).toMatch(/Certificate of Liability/);
  });

  it("seeds each lease with the correct rent, deposit, term, status, and source PDF", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    for (const unit of UNITS) {
      const lease = stores.leases.get(hickoryHavenLeaseId(unit))!;
      const expected = EXPECTED[unit]!;
      expect(lease["monthlyRent"]).toBe(expected.rent);
      expect(lease["securityDeposit"]).toBe(expected.deposit);
      expect(lease["startDate"]).toBe(expected.startDate);
      expect(lease["endDate"]).toBe("2026-08-31");
      expect(lease["status"]).toBe("Active");
      expect(String(lease["clauses"])).toMatch(/KFI Staffing/);
      expect(String(lease["clauses"])).toContain(
        `Source document: ${expected.source}`,
      );
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
    }
    // Units with prorated first-month rent surface that in clauses
    expect(String(stores.leases.get(hickoryHavenLeaseId("11"))!["clauses"]))
      .toMatch(/\$551\.61/);
    expect(String(stores.leases.get(hickoryHavenLeaseId("12"))!["clauses"]))
      .toMatch(/\$658\.87/);
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const before = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    stores.properties.set(HICKORY_HAVEN_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@hickoryhaven.example",
    });

    const second = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
    });

    const after = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@hickoryhaven.example");
    expect(stores.leases.size).toBe(4);
  });

  it("reuses a pre-existing KFI Staffing customer matched by name LIKE", async () => {
    stores.customers.set("operator-cust-kfi", {
      id: "operator-cust-kfi",
      name: "KFI Staffing",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator notes",
    });

    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(4);
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });
});
