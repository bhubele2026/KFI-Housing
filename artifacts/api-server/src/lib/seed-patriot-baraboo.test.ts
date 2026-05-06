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
  seedPatriotBarabooIfMissing,
  PATRIOT_BARABOO_CUSTOMER_ID,
  PATRIOT_BARABOO_PROPERTY_ID,
  patriotBarabooLeaseId,
} = await import("./seed-patriot-baraboo");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["509", "510", "512", "811", "812"] as const;

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedPatriotBarabooIfMissing", () => {
  it("inserts customer, property, and 5 leases on a fresh DB", async () => {
    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 5,
    });
    expect(stores.customers.has(PATRIOT_BARABOO_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(PATRIOT_BARABOO_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(patriotBarabooLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with the Baraboo address and Patriot landlord", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger });

    const property = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(property["address"]).toBe("1850 W. Pine St.");
    expect(property["city"]).toBe("Baraboo");
    expect(property["state"]).toBe("WI");
    expect(property["zip"]).toBe("53913");
    expect(property["landlordName"]).toBe("Patriot Properties");
    expect(property["paymentRecipient"]).toBe("JCW Baraboo LLC");
    expect(property["customerId"]).toBe(PATRIOT_BARABOO_CUSTOMER_ID);
    expect(String(property["notes"])).toMatch(/JCW Baraboo|Patriot/);
  });

  it("seeds each lease with the correct rent, deposit, term, status, and source PDF", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger });

    const sources: Record<string, string> = {
      "509": "Lease_Agreement_-_509_1778107818114.pdf",
      "510": "Lease_Agreement_-_510_1778107818114.pdf",
      "512": "Lease_Agreement_-_512_1778107818114.pdf",
      "811": "Lease_Agreement_-_811_1778107818114.pdf",
      "812": "Lease_Agreement_-_812_1778107818114.pdf",
    };
    for (const unit of UNITS) {
      const lease = stores.leases.get(patriotBarabooLeaseId(unit))!;
      expect(lease["monthlyRent"]).toBe(1675);
      expect(lease["securityDeposit"]).toBe(1675);
      expect(lease["startDate"]).toBe("2025-09-30");
      expect(lease["endDate"]).toBe("2026-08-31");
      expect(lease["status"]).toBe("Active");
      const clauses = String(lease["clauses"]);
      expect(clauses).toMatch(/KFI Staffing/);
      expect(clauses).toMatch(/5%/);
      expect(clauses).toMatch(/Valeria Alderman/);
      expect(clauses).toContain(`Source document: ${sources[unit]}`);
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
      expect(String(lease["notes"])).toMatch(/\$10\.50 LLI/);
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger });

    const before = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    stores.properties.set(PATRIOT_BARABOO_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@patriotproperties.example",
    });

    const second = await seedPatriotBarabooIfMissing({ logger: silentLogger });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
    });

    const after = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@patriotproperties.example");
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

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(5);
    expect(stores.customers.has(PATRIOT_BARABOO_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });
});
