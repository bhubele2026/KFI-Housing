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
      // No `.where()` => return all rows projected (used for the
      // unconditional "list all customers" / "list all properties"
      // scans the seed performs for fuzzy matching).
      const projected = project(rows);
      return {
        where: (pred: Predicate) => {
          const filtered = rows.filter((r) => matches(r, pred));
          const projected2 = project(filtered);
          return {
            then: (
              onF: (v: unknown[]) => unknown,
              onR?: (e: unknown) => unknown,
            ) => Promise.resolve(projected2).then(onF, onR),
            limit: (n: number) => Promise.resolve(projected2.slice(0, n)),
          };
        },
        then: (
          onF: (v: unknown[]) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(projected).then(onF, onR),
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

function makeUpdate(table: unknown) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: async (pred: Predicate) => {
        const store = stores[tableNameOf(table)];
        for (const row of store.values()) {
          if (matches(row, pred)) {
            for (const [k, v] of Object.entries(patch)) row[k] = v;
          }
        }
      },
    }),
  };
}

const tx = { select: makeSelect, insert: makeInsert, update: makeUpdate };
type Tx = typeof tx;
const fakeDb = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
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
    customShifts: { __col: "customShifts" },
  },
  propertiesTable: {
    __table: "properties",
    id: { __col: "id" },
    customerId: { __col: "customerId" },
    sharedWithCustomerIds: { __col: "sharedWithCustomerIds" },
    name: { __col: "name" },
    city: { __col: "city" },
    state: { __col: "state" },
    address: { __col: "address" },
    zip: { __col: "zip" },
  },
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    customerId: { __col: "customerId" },
    notes: { __col: "notes" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedRidgeMotorInnIfMissing,
  RIDGE_PROPERTY_ID,
  ridgeLeaseId,
} = await import("./seed-ridge-motor-inn");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function seedCustomer(id: string, name: string): void {
  stores.customers.set(id, { id, name });
}

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
  silentLogger.info.mockClear();
  silentLogger.warn.mockClear();
});

describe("seedRidgeMotorInnIfMissing", () => {
  it("creates the property and one lease per customer when Penda + Trienda exist", async () => {
    seedCustomer("cust-penda", "Penda  - Portage, WI");
    seedCustomer("cust-trienda", "Trienda - Portage, WI");

    const result = await seedRidgeMotorInnIfMissing({ logger: silentLogger });

    expect(result).toEqual({
      customersMatched: 2,
      propertyCreated: true,
      propertyUpdated: false,
      leasesCreated: 2,
      leasesSkipped: 0,
    });

    const property = stores.properties.get(RIDGE_PROPERTY_ID)!;
    expect(property["name"]).toBe("Ridge Motor Inn");
    expect(property["city"]).toBe("Portage");
    expect(property["state"]).toBe("WI");
    expect(property["totalBeds"]).toBe(40);
    expect(property["customerId"]).toBe("cust-penda");
    expect(property["sharedWithCustomerIds"]).toEqual(["cust-trienda"]);
    expect(String(property["notes"])).toMatch(/Also leased to: Trienda/);
    expect(String(property["notes"])).toMatch(/needs review/i);
    expect(String(property["notes"])).toContain(
      "penda_y_trienda_housing_ridge_1778107826283.xlsx",
    );

    const pendaLease = stores.leases.get(ridgeLeaseId("penda"))!;
    const triendaLease = stores.leases.get(ridgeLeaseId("trienda"))!;
    expect(pendaLease["customerId"]).toBe("cust-penda");
    expect(triendaLease["customerId"]).toBe("cust-trienda");
    for (const lease of [pendaLease, triendaLease]) {
      expect(lease["status"]).toBe("Active");
      expect(lease["needsReview"]).toBe(true);
      expect(lease["startDate"]).toBe("");
      expect(lease["endDate"]).toBe("");
      expect(lease["monthlyRent"]).toBe(0);
      expect(lease["weeklyCost"]).toBe(0);
      expect(lease["propertyId"]).toBe(RIDGE_PROPERTY_ID);
      expect(String(lease["notes"])).toContain(
        "Source: penda_y_trienda_housing_ridge_1778107826283.xlsx",
      );
      expect(String(lease["notes"])).toContain(
        "Ridge Motor Inn — penda_y_trienda_housing_ridge",
      );
    }
    expect(String(pendaLease["notes"])).toMatch(/^Penda lease —/);
    expect(String(triendaLease["notes"])).toMatch(/^Trienda lease —/);

    // Pre-flight match decision logging is required by the boot
    // observability contract — operators rely on it to confirm the
    // seed picked up the right rows before any writes happened.
    const infoMessages = silentLogger.info.mock.calls.map(
      (c) => String(c[1] ?? c[0]),
    );
    expect(
      infoMessages.some((m) => /pre-flight customer match/.test(m)),
    ).toBe(true);
    expect(
      infoMessages.some((m) => /pre-flight property match/.test(m)),
    ).toBe(true);
    expect(
      infoMessages.some((m) => /pre-flight lease decisions/.test(m)),
    ).toBe(true);
  });

  it("is idempotent: a second invocation inserts zero rows", async () => {
    seedCustomer("cust-penda", "Penda");
    seedCustomer("cust-trienda", "Trienda");

    await seedRidgeMotorInnIfMissing({ logger: silentLogger });
    const propsBefore = new Map(stores.properties);
    const leasesBefore = new Map(stores.leases);

    const second = await seedRidgeMotorInnIfMissing({ logger: silentLogger });
    expect(second).toEqual({
      customersMatched: 2,
      propertyCreated: false,
      propertyUpdated: false,
      leasesCreated: 0,
      leasesSkipped: 2,
    });
    expect(stores.properties.size).toBe(propsBefore.size);
    expect(stores.leases.size).toBe(leasesBefore.size);
  });

  it("matches an existing Ridge Motor Inn property case-insensitively by (title, city, state)", async () => {
    seedCustomer("cust-penda", "Penda");
    seedCustomer("cust-trienda", "Trienda");
    stores.properties.set("operator-prop-ridge", {
      id: "operator-prop-ridge",
      customerId: "cust-penda",
      sharedWithCustomerIds: [],
      name: "RIDGE MOTOR INN",
      city: "portage",
      state: "wi",
      address: "123 Some St",
      zip: "53901",
      notes: "operator notes",
    });

    const result = await seedRidgeMotorInnIfMissing({ logger: silentLogger });

    expect(result.propertyCreated).toBe(false);
    expect(result.propertyUpdated).toBe(true);
    expect(result.leasesCreated).toBe(2);
    expect(stores.properties.has(RIDGE_PROPERTY_ID)).toBe(false);
    expect(stores.properties.size).toBe(1);
    const matched = stores.properties.get("operator-prop-ridge")!;
    expect(matched["notes"]).toBe("operator notes");
    expect(matched["sharedWithCustomerIds"]).toEqual(["cust-trienda"]);
    for (const lease of stores.leases.values()) {
      expect(lease["propertyId"]).toBe("operator-prop-ridge");
    }
  });

  it("matches an existing 'The Ridge Motor Inn' property (attached-PDFs seed name) and attaches both customers", async () => {
    // Mirrors the row that `seed-attached-leases.ts` writes under the
    // KFI Staffing LLC umbrella customer with the "The " prefix and a
    // populated city/state. We must reuse that row, not duplicate it,
    // and we must attach Penda + Trienda to its sharedWithCustomerIds
    // even though neither is the property's primary customer.
    seedCustomer("cust-penda", "Penda - Portage, WI");
    seedCustomer("cust-trienda", "Trienda - Portage, WI");
    seedCustomer("cust-kfi", "KFI Staffing LLC");
    stores.properties.set("prop-ridge-attached", {
      id: "prop-ridge-attached",
      customerId: "cust-kfi",
      sharedWithCustomerIds: [],
      name: "The Ridge Motor Inn",
      city: "Portage",
      state: "WI",
      address: "",
      zip: "",
      notes: "attached-PDFs seed notes",
    });

    const result = await seedRidgeMotorInnIfMissing({ logger: silentLogger });

    expect(result.propertyCreated).toBe(false);
    expect(result.propertyUpdated).toBe(true);
    expect(result.leasesCreated).toBe(2);
    expect(stores.properties.size).toBe(1);
    const matched = stores.properties.get("prop-ridge-attached")!;
    expect(matched["customerId"]).toBe("cust-kfi");
    expect(matched["sharedWithCustomerIds"]).toEqual([
      "cust-penda",
      "cust-trienda",
    ]);
    for (const lease of stores.leases.values()) {
      expect(lease["propertyId"]).toBe("prop-ridge-attached");
    }
  });

  it("skips gracefully with a warning when Penda is missing", async () => {
    seedCustomer("cust-trienda", "Trienda");

    const result = await seedRidgeMotorInnIfMissing({ logger: silentLogger });

    expect(result.customersMatched).toBe(1);
    expect(result.propertyCreated).toBe(true);
    expect(result.leasesCreated).toBe(1);
    expect(stores.customers.size).toBe(1);
    expect(stores.leases.has(ridgeLeaseId("trienda"))).toBe(true);
    expect(stores.leases.has(ridgeLeaseId("penda"))).toBe(false);
    // Trienda becomes the primary customer when Penda is missing.
    expect(stores.properties.get(RIDGE_PROPERTY_ID)!["customerId"]).toBe(
      "cust-trienda",
    );
    expect(
      silentLogger.warn.mock.calls.some(([m]) => /Penda/.test(String(m))),
    ).toBe(true);
  });

  it("skips entirely with warnings when both customers are missing", async () => {
    const result = await seedRidgeMotorInnIfMissing({ logger: silentLogger });

    expect(result).toEqual({
      customersMatched: 0,
      propertyCreated: false,
      propertyUpdated: false,
      leasesCreated: 0,
      leasesSkipped: 2,
    });
    expect(stores.customers.size).toBe(0);
    expect(stores.properties.size).toBe(0);
    expect(stores.leases.size).toBe(0);
    expect(
      silentLogger.warn.mock.calls.some(([m]) => /Penda/.test(String(m))),
    ).toBe(true);
    expect(
      silentLogger.warn.mock.calls.some(([m]) => /Trienda/.test(String(m))),
    ).toBe(true);
  });
});
