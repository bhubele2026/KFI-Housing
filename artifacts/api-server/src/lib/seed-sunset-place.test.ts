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

function makeUpdate(table: unknown) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: (pred: Predicate) => {
        const exec = async (): Promise<Row[]> => {
          const store = stores[tableNameOf(table)];
          const updated: Row[] = [];
          for (const [id, row] of store) {
            if (matches(row, pred)) {
              store.set(id, { ...row, ...patch });
              updated.push({ id });
            }
          }
          return updated;
        };
        return {
          returning: (_cols?: unknown) => exec(),
          then: (onF: (v: Row[]) => unknown, onR?: (e: unknown) => unknown) =>
            exec().then(onF, onR),
        };
      },
    }),
  };
}

function makeDelete(table: unknown) {
  return {
    where: (pred: Predicate) => ({
      returning: async (_cols?: unknown) => {
        const store = stores[tableNameOf(table)];
        const removed: Row[] = [];
        for (const [id, row] of Array.from(store.entries())) {
          if (matches(row, pred)) {
            store.delete(id);
            removed.push({ id });
          }
        }
        return removed;
      },
    }),
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

const tx = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
};
type Tx = typeof tx;
const fakeDb = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
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
  seedSunsetPlaceIfMissing,
  SUNSET_PLACE_CUSTOMER_ID,
  SUNSET_PLACE_PROPERTY_ID,
  sunsetPlaceLeaseId,
} = await import("./seed-sunset-place");

const silentLogger = { info: vi.fn(), warn: vi.fn() };
const NOW = () => new Date("2026-06-14T00:00:00Z");

const CONFIRMED: Record<
  string,
  { start: string; end: string; rent: number; deposit: number; status: string }
> = {
  "148": { start: "2026-05-28", end: "2026-11-30", rent: 989, deposit: 989, status: "Active" },
  "221": { start: "2026-05-28", end: "2026-11-30", rent: 1169, deposit: 1169, status: "Active" },
  "117": { start: "2026-06-01", end: "2027-03-31", rent: 1109, deposit: 1109, status: "Active" },
  "215": { start: "2026-06-01", end: "2027-03-31", rent: 1309, deposit: 1309, status: "Active" },
  "106": { start: "2026-07-08", end: "2026-11-30", rent: 939, deposit: 939, status: "Upcoming" },
};

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedSunsetPlaceIfMissing", () => {
  it("inserts customer, property, and 7 leases on a fresh DB", async () => {
    const result = await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 7,
      customerId: SUNSET_PLACE_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    expect(stores.customers.has(SUNSET_PLACE_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(SUNSET_PLACE_PROPERTY_ID)).toBe(true);
    for (const unit of ["148", "221", "117", "215", "106", "132", "134"]) {
      expect(stores.leases.has(sunsetPlaceLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with Sunset Place / Lisenby details", async () => {
    await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    const p = stores.properties.get(SUNSET_PLACE_PROPERTY_ID)!;
    expect(p["name"]).toMatch(/Sunset Place/);
    expect(p["address"]).toBe("216 Sunset Place");
    expect(p["city"]).toBe("Neillsville");
    expect(p["state"]).toBe("WI");
    expect(p["zip"]).toBe("54456");
    expect(p["landlordName"]).toBe("Lisenby Properties LLC");
    expect(p["customerId"]).toBe(SUNSET_PLACE_CUSTOMER_ID);
  });

  it("seeds each confirmed lease with correct rent, deposit, term, and status", async () => {
    await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    for (const [unit, exp] of Object.entries(CONFIRMED)) {
      const lease = stores.leases.get(sunsetPlaceLeaseId(unit))!;
      expect(lease["startDate"]).toBe(exp.start);
      expect(lease["endDate"]).toBe(exp.end);
      expect(lease["monthlyRent"]).toBe(exp.rent);
      expect(lease["securityDeposit"]).toBe(exp.deposit);
      expect(lease["status"]).toBe(exp.status);
      expect(lease["needsReview"]).toBe(false);
      expect(lease["vendor"]).toBe("Lanyard");
      expect(lease["weeklyCost"]).toBe(115);
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
    }
  });

  it("flags units 132 and 134 as needsReview with unknown rent", async () => {
    await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    for (const unit of ["132", "134"]) {
      const lease = stores.leases.get(sunsetPlaceLeaseId(unit))!;
      expect(lease["needsReview"]).toBe(true);
      expect(lease["monthlyRent"]).toBe(0);
      expect(lease["status"]).toBe("Upcoming");
      expect(String(lease["notes"])).toMatch(/manual entry/);
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    const before = stores.properties.get(SUNSET_PLACE_PROPERTY_ID)!;
    stores.properties.set(SUNSET_PLACE_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@lisenby.example",
    });

    const second = await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
      customerId: SUNSET_PLACE_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    const after = stores.properties.get(SUNSET_PLACE_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@lisenby.example");
  });

  it("repoints from the KFI fallback to WB Manufacturing and deletes the fallback", async () => {
    const first = await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    expect(first.repointedToEndClient).toBe(false);
    expect(
      stores.properties.get(SUNSET_PLACE_PROPERTY_ID)!["customerId"],
    ).toBe(SUNSET_PLACE_CUSTOMER_ID);

    stores.customers.set("cust-wb", {
      id: "cust-wb",
      name: "WB Manufactoring - Thorp, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const second = await seedSunsetPlaceIfMissing({ logger: silentLogger, now: NOW });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-wb");
    expect(stores.customers.has(SUNSET_PLACE_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(SUNSET_PLACE_PROPERTY_ID)!["customerId"],
    ).toBe("cust-wb");
  });
});
