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
          then: (
            onF: (v: Row[]) => unknown,
            onR?: (e: unknown) => unknown,
          ) => exec().then(onF, onR),
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
  seedKolbeWausauIfMissing,
  KOLBE_WAUSAU_CUSTOMER_ID,
  KOLBE_WAUSAU_PROPERTY_ID,
  kolbeWausauLeaseId,
} = await import("./seed-kolbe-wausau");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["108", "200"] as const;

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedKolbeWausauIfMissing", () => {
  it("inserts customer, property, and 2 leases on a fresh DB", async () => {
    const result = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 2,
      customerId: KOLBE_WAUSAU_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    expect(stores.customers.has(KOLBE_WAUSAU_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(KOLBE_WAUSAU_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(kolbeWausauLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with Kolbe Apartments + Wausau address fields", async () => {
    await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const property = stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!;
    expect(property["address"]).toBe("1331 South 8th Ave");
    expect(property["city"]).toBe("Wausau");
    expect(property["state"]).toBe("WI");
    expect(property["zip"]).toBe("54401");
    expect(property["landlordName"]).toBe("Kolbe Apartments LLC");
    expect(property["paymentRecipient"]).toBe("Kolbe Apartments LLC");
    expect(property["customerId"]).toBe(KOLBE_WAUSAU_CUSTOMER_ID);
    expect(String(property["notes"])).toMatch(/Apt 108/);
    expect(String(property["notes"])).toMatch(/Apt 200/);
  });

  it("seeds each lease with the correct rent, deposit, term, status, and source PDF", async () => {
    await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const expected = {
      "108": {
        rent: 1410,
        deposit: 1000,
        start: "2026-05-01",
        end: "2026-10-31",
        addr: "1341 South 8th Ave",
        source:
          "Lease_-1341_South_8th_Ave_Apt_1_Wausau,_WI_-_54401_kfi-staffin_1778107848648.pdf",
      },
      "200": {
        rent: 1849,
        deposit: 1000,
        start: "2026-03-27",
        end: "2026-09-26",
        addr: "1331 South 8th Ave",
        source:
          "Lease_-1331_South_8th_Ave_Apt_200_Wausau,_WI_-_54401_kfi-staff_1778107848648.pdf",
      },
    } as const;

    for (const unit of UNITS) {
      const lease = stores.leases.get(kolbeWausauLeaseId(unit))!;
      const e = expected[unit];
      expect(lease["monthlyRent"]).toBe(e.rent);
      expect(lease["securityDeposit"]).toBe(e.deposit);
      expect(lease["startDate"]).toBe(e.start);
      expect(lease["endDate"]).toBe(e.end);
      expect(lease["status"]).toBe("Active");
      const clauses = String(lease["clauses"]);
      expect(clauses).toMatch(/KFI Staffing LLC/);
      expect(clauses).toContain(`Source document: ${e.source}`);
      expect(clauses).toContain(e.addr);
      expect(String(lease["notes"])).toMatch(new RegExp(`Apt ${unit} —`));
      expect(String(lease["notes"])).toContain(e.addr);
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const before = stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!;
    stores.properties.set(KOLBE_WAUSAU_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@kolbe.example",
    });

    const second = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
      customerId: KOLBE_WAUSAU_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });

    const after = stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@kolbe.example");
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

    const result = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(2);
    expect(stores.customers.has(KOLBE_WAUSAU_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });

  it("repoints the property from the KFI Staffing fallback to Schuette Metals once the end-client shows up, and deletes the unused fallback (Task #328)", async () => {
    const first = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(first.customerInserted).toBe(true);
    expect(first.repointedToEndClient).toBe(false);
    expect(first.fallbackCustomerDeleted).toBe(false);
    expect(
      stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!["customerId"],
    ).toBe(KOLBE_WAUSAU_CUSTOMER_ID);

    stores.customers.set("cust-schuette", {
      id: "cust-schuette",
      name: "Schuette Metals - Rothschild, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const second = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-schuette");
    expect(stores.customers.has(KOLBE_WAUSAU_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!["customerId"],
    ).toBe("cust-schuette");
  });

  it("preserves an operator-chosen non-fallback customer even when Schuette Metals exists (Task #328)", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Operator Custom Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.customers.set("cust-schuette", {
      id: "cust-schuette",
      name: "Schuette Metals",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set(KOLBE_WAUSAU_PROPERTY_ID, {
      id: KOLBE_WAUSAU_PROPERTY_ID,
      customerId: "operator-cust",
      name: "Kolbe Wausau",
      address: "1331 South 8th Ave",
      city: "Wausau",
      state: "WI",
      zip: "54401",
      notes: "operator notes",
    });

    const result = await seedKolbeWausauIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.repointedToEndClient).toBe(false);
    expect(result.customerId).toBe("operator-cust");
    expect(
      stores.properties.get(KOLBE_WAUSAU_PROPERTY_ID)!["customerId"],
    ).toBe("operator-cust");
    expect(stores.customers.has("operator-cust")).toBe(true);
    expect(stores.customers.has("cust-schuette")).toBe(true);
  });
});
