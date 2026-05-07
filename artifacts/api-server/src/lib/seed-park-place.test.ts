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
    unit: { __col: "unit" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedParkPlaceIfMissing,
  computeLeaseStatus,
  PARK_PLACE_CUSTOMER_ID,
  PARK_PLACE_PROPERTY_ID,
  PARK_PLACE_UNITS,
  parkPlaceLeaseId,
} = await import("./seed-park-place");

const silentLogger = { info: vi.fn(), warn: vi.fn() };
const FIXED_NOW = () => new Date("2026-05-06T12:00:00Z");

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("computeLeaseStatus", () => {
  it("returns Upcoming, Active, Expired by date comparison", () => {
    expect(computeLeaseStatus("2026-06-01", "2026-12-31", "2026-05-06")).toBe(
      "Upcoming",
    );
    expect(computeLeaseStatus("2025-01-01", "2026-12-31", "2026-05-06")).toBe(
      "Active",
    );
    expect(computeLeaseStatus("2024-12-01", "2025-11-30", "2026-05-06")).toBe(
      "Expired",
    );
  });
});

describe("seedParkPlaceIfMissing", () => {
  it("inserts customer, property, and 9 leases on a fresh DB", async () => {
    const result = await seedParkPlaceIfMissing({
      logger: silentLogger,
      now: FIXED_NOW,
    });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 9,
      customerId: PARK_PLACE_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    expect(stores.customers.has(PARK_PLACE_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(PARK_PLACE_PROPERTY_ID)).toBe(true);
    expect(PARK_PLACE_UNITS).toHaveLength(9);
    for (const unit of PARK_PLACE_UNITS) {
      expect(stores.leases.has(parkPlaceLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property with the Park Place address and Centerspace landlord", async () => {
    await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    const property = stores.properties.get(PARK_PLACE_PROPERTY_ID)!;
    expect(property["address"]).toBe("14550 34th Ave N");
    expect(property["city"]).toBe("Plymouth");
    expect(property["state"]).toBe("MN");
    expect(property["zip"]).toBe("55447");
    expect(property["landlordName"]).toBe("Centerspace LP");
    expect(property["customerId"]).toBe(PARK_PLACE_CUSTOMER_ID);
  });

  it("seeds 605-102 from the renewal PDF, not the original RENTCafe PDF", async () => {
    await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    const lease = stores.leases.get(parkPlaceLeaseId("605-102"))!;
    expect(lease["startDate"]).toBe("2025-06-01");
    expect(lease["endDate"]).toBe("2025-11-30");
    expect(lease["monthlyRent"]).toBe(2235);
    expect(String(lease["notes"])).toContain(
      "Lease_Agreement_-_Park_Place_Apartments_605-102_1778107787031.pdf",
    );
    expect(String(lease["notes"])).not.toContain("RENTCafe");
    expect(String(lease["clauses"])).toMatch(/Renewal/);
  });

  it("seeds each lease with correct rent, parking, term, source PDF, and Expired status as of 2026-05-06", async () => {
    await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    const expected: Record<
      string,
      { rent: number; parking: string; address: string }
    > = {
      "500-118": { rent: 1777, parking: "500-118-SSI", address: "14500 34th Ave N Apt 118" },
      "500-218": { rent: 1726, parking: "500-218-VSI", address: "14500 34th Ave N Apt 218" },
      "600-127": { rent: 1746, parking: "600-127-SVR", address: "14600 34th Ave N Apt 127" },
      "600-216": { rent: 1726, parking: "600-216-VSM", address: "14600 34th Ave N Apt 216" },
      "600-315": { rent: 1782, parking: "600-315-FST", address: "14600 34th Ave N Apt 315" },
      "600-342": { rent: 1751, parking: "600-342-FKV", address: "14600 34th Ave N Apt 342" },
      "605-201": { rent: 1726, parking: "605-201-VLS", address: "14605 34th Ave N Apt 201" },
      "605-218": { rent: 1746, parking: "605-218-VSI", address: "14605 34th Ave N Apt 218" },
    };
    for (const [unit, e] of Object.entries(expected)) {
      const lease = stores.leases.get(parkPlaceLeaseId(unit))!;
      expect(lease["monthlyRent"]).toBe(e.rent);
      expect(lease["startDate"]).toBe("2024-12-01");
      expect(lease["endDate"]).toBe("2025-11-30");
      expect(lease["status"]).toBe("Expired");
      expect(String(lease["clauses"])).toContain(e.parking);
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
      expect(String(lease["notes"])).toContain(e.address);
      // Task #310: unit lives in a real column, not just the notes prose.
      expect(lease["unit"]).toBe(unit);
    }
  });

  it("computes Active status when today falls inside the term", async () => {
    await seedParkPlaceIfMissing({
      logger: silentLogger,
      now: () => new Date("2025-07-15T12:00:00Z"),
    });

    const lease = stores.leases.get(parkPlaceLeaseId("605-102"))!;
    expect(lease["status"]).toBe("Active");
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    const before = stores.properties.get(PARK_PLACE_PROPERTY_ID)!;
    stores.properties.set(PARK_PLACE_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@centerspace.example",
    });
    const leaseBefore = stores.leases.get(parkPlaceLeaseId("500-118"))!;
    stores.leases.set(parkPlaceLeaseId("500-118"), {
      ...leaseBefore,
      monthlyRent: 9999,
    });

    const second = await seedParkPlaceIfMissing({
      logger: silentLogger,
      now: FIXED_NOW,
    });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
      customerId: PARK_PLACE_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });

    const after = stores.properties.get(PARK_PLACE_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@centerspace.example");
    expect(stores.leases.get(parkPlaceLeaseId("500-118"))!["monthlyRent"]).toBe(
      9999,
    );
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

    const result = await seedParkPlaceIfMissing({
      logger: silentLogger,
      now: FIXED_NOW,
    });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(9);
    expect(stores.customers.has(PARK_PLACE_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(PARK_PLACE_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });

  it("repoints the property from the KFI Staffing fallback to Cardinal CG (Spring Green) once the end-client shows up, and deletes the unused fallback (Task #328)", async () => {
    const first = await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });
    expect(first.customerInserted).toBe(true);
    expect(first.repointedToEndClient).toBe(false);
    expect(first.fallbackCustomerDeleted).toBe(false);
    expect(
      stores.properties.get(PARK_PLACE_PROPERTY_ID)!["customerId"],
    ).toBe(PARK_PLACE_CUSTOMER_ID);

    stores.customers.set("cust-cardinal-spring-green", {
      id: "cust-cardinal-spring-green",
      name: "Cardinal CG at Spring Green, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const second = await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-cardinal-spring-green");
    expect(stores.customers.has(PARK_PLACE_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(PARK_PLACE_PROPERTY_ID)!["customerId"],
    ).toBe("cust-cardinal-spring-green");
    expect(stores.leases.size).toBe(9);
  });

  it("does NOT repoint to the unrelated 'Cardinal CG - Northfield' customer (Task #328 disambiguation)", async () => {
    // Northfield is a different Cardinal CG site (Owatonna, MN address)
    // — make sure our narrow LIKE pattern doesn't accidentally match it.
    stores.customers.set("cust-cardinal-northfield", {
      id: "cust-cardinal-northfield",
      name: "Cardinal CG - Northfield",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const result = await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    expect(result.repointedToEndClient).toBe(false);
    expect(result.fallbackCustomerDeleted).toBe(false);
    expect(result.customerId).toBe(PARK_PLACE_CUSTOMER_ID);
    expect(stores.customers.has(PARK_PLACE_CUSTOMER_ID)).toBe(true);
    expect(stores.customers.has("cust-cardinal-northfield")).toBe(true);
  });

  it("preserves an operator-chosen non-fallback customer even when Cardinal CG (Spring Green) exists (Task #328)", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Operator Custom Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.customers.set("cust-cardinal-spring-green", {
      id: "cust-cardinal-spring-green",
      name: "Cardinal CG at Spring Green, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set(PARK_PLACE_PROPERTY_ID, {
      id: PARK_PLACE_PROPERTY_ID,
      customerId: "operator-cust",
      name: "Park Place",
      address: "14550 34th Ave N",
      city: "Plymouth",
      state: "MN",
      zip: "55447",
      notes: "operator notes",
    });

    const result = await seedParkPlaceIfMissing({ logger: silentLogger, now: FIXED_NOW });

    expect(result.repointedToEndClient).toBe(false);
    expect(result.customerId).toBe("operator-cust");
    expect(
      stores.properties.get(PARK_PLACE_PROPERTY_ID)!["customerId"],
    ).toBe("operator-cust");
    expect(stores.customers.has("operator-cust")).toBe(true);
    expect(stores.customers.has("cust-cardinal-spring-green")).toBe(true);
  });
});
