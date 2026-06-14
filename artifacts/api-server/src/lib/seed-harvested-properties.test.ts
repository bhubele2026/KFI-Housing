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

const { seedHarvestedPropertiesIfMissing, HARVESTED_PROPERTIES } = await import(
  "./seed-harvested-properties"
);

const silentLogger = { info: vi.fn(), warn: vi.fn() };
const NOW = () => new Date("2026-06-14T00:00:00Z");

const EXPECTED_LEASES = HARVESTED_PROPERTIES.reduce(
  (sum, p) => sum + p.leases.length,
  0,
);

function leaseValues(): Row[] {
  return Array.from(stores.leases.values());
}

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedHarvestedPropertiesIfMissing", () => {
  it("inserts every harvested property and lease on a fresh DB", async () => {
    const result = await seedHarvestedPropertiesIfMissing({
      logger: silentLogger,
      now: NOW,
    });
    expect(result.propertiesInserted).toBe(HARVESTED_PROPERTIES.length);
    expect(result.leasesInserted).toBe(EXPECTED_LEASES);
    expect(stores.properties.size).toBe(HARVESTED_PROPERTIES.length);
    expect(stores.leases.size).toBe(EXPECTED_LEASES);
  });

  it("captures confirmed apartment rent (Stonleigh #E $1208)", async () => {
    await seedHarvestedPropertiesIfMissing({ logger: silentLogger, now: NOW });
    const hit = leaseValues().find(
      (l) =>
        String(l["notes"]).includes("1312 Stonleigh Court #E") &&
        l["monthlyRent"] === 1208,
    );
    expect(hit).toBeTruthy();
    expect(hit!["needsReview"]).toBe(true);
  });

  it("models a motel as room-night with a nightly rate (Palace Motel $53.91)", async () => {
    await seedHarvestedPropertiesIfMissing({ logger: silentLogger, now: NOW });
    const hit = leaseValues().find((l) => l["nightlyRate"] === 53.91);
    expect(hit).toBeTruthy();
    expect(hit!["rateType"]).toBe("room-night");
  });

  it("flags unknown-rent units needsReview with rent 0", async () => {
    await seedHarvestedPropertiesIfMissing({ logger: silentLogger, now: NOW });
    const bartlett = leaseValues().find((l) =>
      String(l["notes"]).includes("International Wire"),
    );
    expect(bartlett).toBeTruthy();
    expect(bartlett!["needsReview"]).toBe(true);
    expect(bartlett!["monthlyRent"]).toBe(0);
  });

  it("is idempotent — a second run inserts nothing", async () => {
    await seedHarvestedPropertiesIfMissing({ logger: silentLogger, now: NOW });
    const second = await seedHarvestedPropertiesIfMissing({
      logger: silentLogger,
      now: NOW,
    });
    expect(second.propertiesInserted).toBe(0);
    expect(second.leasesInserted).toBe(0);
    expect(stores.properties.size).toBe(HARVESTED_PROPERTIES.length);
    expect(stores.leases.size).toBe(EXPECTED_LEASES);
  });

  it("attaches a property to its real end-client when one already exists (Heatron)", async () => {
    stores.customers.set("cust-heatron", {
      id: "cust-heatron",
      name: "Heatron - Leavenworth, KS",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    await seedHarvestedPropertiesIfMissing({ logger: silentLogger, now: NOW });
    const stonleigh = Array.from(stores.properties.values()).find((p) =>
      String(p["name"]).includes("Stonleigh"),
    )!;
    expect(stonleigh["customerId"]).toBe("cust-heatron");
  });
});
