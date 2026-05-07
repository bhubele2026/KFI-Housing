import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { promises as fs } from "fs";

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
  | { kind: "and"; parts: Predicate[] };

function matches(row: Row, p: Predicate): boolean {
  if (p.kind === "eq") return row[p.col] === p.value;
  return p.parts.every((q) => matches(row, q));
}

function makeSelect(_projection?: unknown) {
  // We always return full rows regardless of projection — the importer
  // only ever uses `select().from(table)` without a column list.
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values()).map((r) => ({
        ...r,
      }));
      return {
        where: (pred: Predicate) => {
          const filtered = rows.filter((r) => matches(r, pred));
          const out = {
            then: (
              onF: (v: unknown[]) => unknown,
              onR?: (e: unknown) => unknown,
            ) => Promise.resolve(filtered).then(onF, onR),
            limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          };
          return out;
        },
        // Plain `await` on `select().from(table)` (no .where) — return the
        // full table.
        then: (
          onF: (v: unknown[]) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(rows).then(onF, onR),
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
        for (const [id, row] of store) {
          if (matches(row, pred)) {
            store.set(id, { ...row, ...patch });
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
} as unknown as typeof import("@workspace/db").db;

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  customersTable: { __table: "customers" as const, id: { __col: "id" }, name: { __col: "name" } },
  propertiesTable: {
    __table: "properties" as const,
    id: { __col: "id" },
    customerId: { __col: "customerId" },
    address: { __col: "address" },
  },
  leasesTable: { __table: "leases" as const, id: { __col: "id" } },
}));
vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
  and: (...parts: unknown[]) => ({ kind: "and" as const, parts }),
}));

const {
  importMasterLeases,
  importDefaultMasterLeasesIfMissing,
  readMasterWorkbookFromBuffer,
  getLastBootMasterImport,
  resetLastBootMasterImportForTests,
  getBundledMasterMtime,
  defaultMasterFilePath,
} = await import("./import-master-leases");

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
  silentLogger.info.mockClear();
  silentLogger.warn.mockClear();
  resetLastBootMasterImportForTests();
});

async function loadRealRows(): Promise<string[][]> {
  const filePath = path.resolve(
    __dirname,
    "../../../../attached_assets/Housing_Lease_MASTER_1778105244042.xlsx",
  );
  const buf = await fs.readFile(filePath);
  return readMasterWorkbookFromBuffer(buf);
}

describe("importMasterLeases", () => {
  it("seeds customers, properties, and leases from a clean DB", async () => {
    const rows = await loadRealRows();
    const summary = await importMasterLeases(rows, { logger: silentLogger });

    expect(summary.customersCreated).toBeGreaterThan(0);
    expect(summary.propertiesCreated).toBeGreaterThan(0);
    expect(summary.leasesCreated).toBeGreaterThan(0);
    expect(summary.customersUpdated).toBe(0);

    // The Adient row should land in MO with a numeric weekly cost lease.
    const adient = [...stores.customers.values()].find(
      (c) => (c.name as string).toLowerCase() === "adient",
    );
    expect(adient).toBeDefined();
    expect(adient?.state).toBe("MO");
  });

  it("is idempotent on re-run (zero new inserts the second time)", async () => {
    const rows = await loadRealRows();
    await importMasterLeases(rows, { logger: silentLogger });
    const before = {
      customers: stores.customers.size,
      properties: stores.properties.size,
      leases: stores.leases.size,
    };

    const second = await importMasterLeases(rows, { logger: silentLogger });
    expect(second.customersCreated).toBe(0);
    expect(second.propertiesCreated).toBe(0);
    expect(second.leasesCreated).toBe(0);
    expect({
      customers: stores.customers.size,
      properties: stores.properties.size,
      leases: stores.leases.size,
    }).toEqual(before);
  });

  it("flags ambiguous rows (Orgill / DeLallo / Shuster's / Greystone) as needsReview", async () => {
    const rows = await loadRealRows();
    const summary = await importMasterLeases(rows, { logger: silentLogger });

    const reviewNames = summary.rowsNeedingReview.map((r) => r.customerName);
    expect(reviewNames).toEqual(
      expect.arrayContaining(["Orgill"]),
    );
    expect(reviewNames.some((n) => n.startsWith("DeLallo"))).toBe(true);
    expect(reviewNames.some((n) => n.startsWith("Shuster"))).toBe(true);
    expect(reviewNames.some((n) => n.startsWith("Greystone"))).toBe(true);

    // All flagged rows should have the corresponding lease row (when an
    // address was present) marked needsReview = true and status ≠ Active.
    for (const lease of stores.leases.values()) {
      if (lease.needsReview === true) {
        expect(lease.status).not.toBe("Active");
      }
    }
  });

  // Task #372: every decision carries a `fixups` list (empty when the
  // boundary normaliser had nothing to coerce), and the summary
  // exposes `rowsWithFixups` as a quick filter the UI can render. The
  // real master file's importer-owned fields are all canonical, so
  // `rowsWithFixups` is empty in practice — but the plumbing must
  // still be present so future bad cells surface to the operator.
  it("exposes a per-row fixups list and a rowsWithFixups summary", async () => {
    const rows = await loadRealRows();
    const summary = await importMasterLeases(rows, { logger: silentLogger });
    expect(summary.decisions.length).toBeGreaterThan(0);
    for (const d of summary.decisions) {
      expect(Array.isArray(d.fixups)).toBe(true);
    }
    expect(Array.isArray(summary.rowsWithFixups)).toBe(true);
    for (const d of summary.rowsWithFixups) {
      expect(d.fixups.length).toBeGreaterThan(0);
    }
  });

  it("matches an existing Adient customer by natural-key (no duplicate)", async () => {
    // Pre-seed the DB with an Adient customer from task #283 (different id).
    stores.customers.set("operator-adient", {
      id: "operator-adient",
      name: "Adient",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator note",
      state: "",
    });

    const rows = await loadRealRows();
    const summary = await importMasterLeases(rows, { logger: silentLogger });

    // Customer should NOT have been duplicated.
    const adients = [...stores.customers.values()].filter(
      (c) => (c.name as string).toLowerCase() === "adient",
    );
    expect(adients).toHaveLength(1);
    expect(adients[0].id).toBe("operator-adient");
    // State should have been backfilled.
    expect(adients[0].state).toBe("MO");
    expect(summary.customersUpdated).toBeGreaterThanOrEqual(1);
    // Operator notes preserved.
    expect(adients[0].notes).toBe("operator note");
  });
});

describe("importDefaultMasterLeasesIfMissing", () => {
  // Mirrors the boot-time idempotency test in seed-adient.test.ts:
  // calling the boot wrapper twice on a fresh DB must produce zero new
  // inserts the second time. This locks in the contract that
  // start.ts relies on (Task #302) — the wrapper is safe to invoke on
  // every server boot.
  it("is idempotent on re-run when called as the boot-time wrapper", async () => {
    await importDefaultMasterLeasesIfMissing({ logger: silentLogger });
    const before = {
      customers: stores.customers.size,
      properties: stores.properties.size,
      leases: stores.leases.size,
    };
    expect(before.customers).toBeGreaterThan(0);
    expect(before.properties).toBeGreaterThan(0);
    expect(before.leases).toBeGreaterThan(0);

    const second = await importDefaultMasterLeasesIfMissing({
      logger: silentLogger,
    });
    expect(second.customersCreated).toBe(0);
    expect(second.propertiesCreated).toBe(0);
    expect(second.leasesCreated).toBe(0);
    expect({
      customers: stores.customers.size,
      properties: stores.properties.size,
      leases: stores.leases.size,
    }).toEqual(before);
  });

  // Task #318: the boot wrapper records the timestamp + summary counts
  // of its most recent successful run so the Leases page can show
  // operators "Last auto-imported on …" next to the manual import
  // button. Re-runs (which produce zero new inserts) still bump the
  // timestamp so a healthy boot is always visible.
  it("records the timestamp + summary counts of the last successful boot import", async () => {
    expect(getLastBootMasterImport()).toBeNull();

    const before = Date.now();
    const summary = await importDefaultMasterLeasesIfMissing({
      logger: silentLogger,
    });
    const after = Date.now();

    const recorded = getLastBootMasterImport();
    expect(recorded).not.toBeNull();
    expect(recorded?.customersCreated).toBe(summary.customersCreated);
    expect(recorded?.leasesCreated).toBe(summary.leasesCreated);
    expect(recorded?.propertiesCreated).toBe(summary.propertiesCreated);

    const ranAtMs = new Date(recorded!.ranAt).getTime();
    expect(ranAtMs).toBeGreaterThanOrEqual(before);
    expect(ranAtMs).toBeLessThanOrEqual(after);

    // A second (idempotent) run still updates the recorded timestamp
    // — operators want to see that the most recent boot ran cleanly,
    // not that some earlier boot did.
    await new Promise((r) => setTimeout(r, 5));
    await importDefaultMasterLeasesIfMissing({ logger: silentLogger });
    const second = getLastBootMasterImport();
    expect(second).not.toBeNull();
    expect(new Date(second!.ranAt).getTime()).toBeGreaterThanOrEqual(ranAtMs);
  });
});

describe("getBundledMasterMtime", () => {
  // Task #340: the Leases-page indicator compares this mtime against
  // the recorded boot-time import timestamp to flip itself into a
  // warning style when someone dropped a fresh master file but the
  // api-server hasn't been restarted to pick it up. The contract that
  // matters here is:
  //
  //   • a real Date (matching `fs.stat` on the bundled file) when the
  //     workbook is on disk, so the UI can do an honest mtime > ranAt
  //     comparison; and
  //   • a quiet `null` when the file is unreadable, so the indicator
  //     gracefully degrades to its plain timestamp variant instead of
  //     showing a false "stale" warning to operators.
  it("returns the bundled workbook's modification time when the file exists", async () => {
    const mtime = await getBundledMasterMtime();
    expect(mtime).toBeInstanceOf(Date);
    const fromStat = await fs.stat(defaultMasterFilePath());
    expect(mtime!.getTime()).toBe(fromStat.mtime.getTime());
  });

  it("returns null when the bundled workbook cannot be stat'd, instead of throwing", async () => {
    const spy = vi.spyOn(fs, "stat").mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    try {
      const mtime = await getBundledMasterMtime();
      expect(mtime).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
