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
  seedGreenockManorIfMissing,
  GREENOCK_MANOR_CUSTOMER_ID,
  GREENOCK_MANOR_PROPERTY_ID,
  greenockManorLeaseId,
} = await import("./seed-greenock-manor");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["52", "32", "36", "42", "48", "49"] as const;

const EXPECTED: Record<
  string,
  { start: string; end: string; rent: number; deposit: number; street: string }
> = {
  "52": {
    start: "2026-03-20",
    end: "2027-03-19",
    rent: 950,
    deposit: 950,
    street: "924 Seneca Court",
  },
  "32": {
    start: "2025-12-01",
    end: "2026-11-30",
    rent: 950,
    deposit: 895,
    street: "900 Seneca Court",
  },
  "36": {
    start: "2025-11-01",
    end: "2026-10-31",
    rent: 950,
    deposit: 895,
    street: "900 Seneca Court",
  },
  "42": {
    start: "2026-02-06",
    end: "2026-12-31",
    rent: 950,
    deposit: 950,
    street: "900 Seneca Court",
  },
  "48": {
    start: "2025-11-01",
    end: "2026-10-31",
    rent: 950,
    deposit: 895,
    street: "900 Seneca Court",
  },
  "49": {
    start: "2025-11-01",
    end: "2026-10-31",
    rent: 950,
    deposit: 895,
    street: "900 Seneca Court",
  },
};

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedGreenockManorIfMissing", () => {
  it("inserts customer, property, and 6 active leases on a fresh DB", async () => {
    const result = await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 6,
    });
    expect(stores.customers.has(GREENOCK_MANOR_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(GREENOCK_MANOR_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(greenockManorLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with Greenock Manor / Mick's Properties details", async () => {
    await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const property = stores.properties.get(GREENOCK_MANOR_PROPERTY_ID)!;
    expect(property["name"]).toMatch(/Greenock Manor/);
    expect(property["city"]).toBe("McKeesport");
    expect(property["state"]).toBe("PA");
    expect(property["zip"]).toBe("15135");
    expect(property["landlordName"]).toBe("Mick's Properties, LLC");
    expect(property["customerId"]).toBe(GREENOCK_MANOR_CUSTOMER_ID);
    expect(String(property["notes"])).toMatch(/900 Seneca Court/);
    expect(String(property["notes"])).toMatch(/924 Seneca Court/);
  });

  it("seeds each lease with the correct rent, deposit, term, and status", async () => {
    await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    for (const unit of UNITS) {
      const lease = stores.leases.get(greenockManorLeaseId(unit))!;
      const exp = EXPECTED[unit]!;
      expect(lease["startDate"]).toBe(exp.start);
      expect(lease["endDate"]).toBe(exp.end);
      expect(lease["monthlyRent"]).toBe(exp.rent);
      expect(lease["securityDeposit"]).toBe(exp.deposit);
      expect(lease["status"]).toBe("Active");
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
      expect(String(lease["notes"])).toContain(exp.street);
      expect(String(lease["clauses"])).toMatch(/KFI Staffing/);
    }
  });

  it("uses the amended 12/01/2025 start for Unit 32 (not the original 2024 lease)", async () => {
    await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const unit32 = stores.leases.get(greenockManorLeaseId("32"))!;
    expect(unit32["startDate"]).toBe("2025-12-01");
    expect(unit32["endDate"]).toBe("2026-11-30");
    expect(String(unit32["notes"])).toMatch(/Amended|amended/);
  });

  it("flags Unit 49 notes as transcribed because the source PDF is image-only", async () => {
    await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const unit49 = stores.leases.get(greenockManorLeaseId("49"))!;
    expect(String(unit49["notes"])).toMatch(/image-only/);
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const before = stores.properties.get(GREENOCK_MANOR_PROPERTY_ID)!;
    stores.properties.set(GREENOCK_MANOR_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@micksproperties.example",
    });

    const second = await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
    });

    const after = stores.properties.get(GREENOCK_MANOR_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@micksproperties.example");
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

    const result = await seedGreenockManorIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(6);
    expect(stores.customers.has(GREENOCK_MANOR_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(GREENOCK_MANOR_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });
});
