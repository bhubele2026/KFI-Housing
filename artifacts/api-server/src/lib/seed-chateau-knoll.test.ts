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
  | { kind: "lt"; col: string; value: unknown }
  | { kind: "like"; col: string; pattern: string }
  | { kind: "and"; parts: Predicate[] }
  | { kind: "or"; parts: Predicate[] };

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
  if (p.kind === "lt") {
    const lhs = rowField(row, p.col);
    return (
      typeof lhs === "number" &&
      typeof p.value === "number" &&
      lhs < p.value
    );
  }
  if (p.kind === "like") return likeMatch(rowField(row, p.col), p.pattern);
  if (p.kind === "or") return p.parts.some((q) => matches(row, q));
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
          for (const row of store.values()) {
            if (matches(row, pred)) {
              Object.assign(row, patch);
              updated.push({ id: row.id });
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
  lt: (col: { __col: string }, value: unknown) => ({
    kind: "lt" as const,
    col: col.__col,
    value,
  }),
  like: (col: { __col: string }, pattern: string) => ({
    kind: "like" as const,
    col: col.__col,
    pattern,
  }),
  and: (...parts: Predicate[]) => ({ kind: "and" as const, parts }),
  or: (...parts: Predicate[]) => ({ kind: "or" as const, parts }),
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
    totalBeds: { __col: "totalBeds" },
  },
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    startDate: { __col: "startDate" },
    endDate: { __col: "endDate" },
    monthlyRent: { __col: "monthlyRent" },
    notes: { __col: "notes" },
    clauses: { __col: "clauses" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const { seedChateauKnollIfMissing, SEED_CHATEAU_KNOLL_IDS } = await import(
  "./seed-chateau-knoll"
);

const silentLogger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
  silentLogger.info.mockReset();
  silentLogger.warn.mockReset();
});

describe("seedChateauKnollIfMissing", () => {
  it("inserts the corporate customer, the property, and 6 active leases on a fresh DB", async () => {
    const result = await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(true);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(6);
    expect(result.unitsPresent.sort()).toEqual(
      ["1407", "1506", "2108", "3512", "3524", "3604"],
    );

    expect(stores.customers.size).toBe(1);
    expect(stores.properties.size).toBe(1);
    expect(stores.leases.size).toBe(6);

    const property = stores.properties.get(SEED_CHATEAU_KNOLL_IDS.property)!;
    expect(property["address"]).toBe("2900 Middle Rd");
    expect(property["city"]).toBe("Bettendorf");
    expect(property["state"]).toBe("IA");
    expect(property["zip"]).toBe("52722");
    expect(property["totalBeds"]).toBe(6);
    expect(property["landlordName"]).toBe("Chateau Knoll, LLC");
    expect(property["customerId"]).toBe(SEED_CHATEAU_KNOLL_IDS.customer);
  });

  it("seeds each lease with the correct rent, dates, deposit, and unit marker in notes", async () => {
    await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const expected: Record<
      string,
      { start: string; end: string; rent: number; source: string }
    > = {
      "1407": { start: "2026-02-12", end: "2026-08-11", rent: 1543, source: "Chateau_Knoll_Lease_-_1407_1778107759430.pdf" },
      "1506": { start: "2026-02-12", end: "2026-08-11", rent: 1581, source: "Chateau_Knoll_Lease_-_1506_1778107759431.pdf" },
      "2108": { start: "2026-01-23", end: "2026-07-31", rent: 1661, source: "Chateau_Knoll_Lease_-_2108_1778107759430.pdf" },
      "3512": { start: "2026-01-23", end: "2026-07-31", rent: 1546, source: "Chateau_Knoll_Lease_-_3512_1778107759431.pdf" },
      "3524": { start: "2026-01-23", end: "2026-07-31", rent: 1546, source: "Chateau_Knoll_Lease_-_3524_1778107759431.pdf" },
      "3604": { start: "2026-01-23", end: "2026-07-31", rent: 1793, source: "Chateau_Knoll_Lease_-_3604_1778107759430.pdf" },
    };

    for (const [unit, exp] of Object.entries(expected)) {
      const id = SEED_CHATEAU_KNOLL_IDS.leases[unit]!;
      const row = stores.leases.get(id)!;
      expect(row, `lease for unit ${unit}`).toBeDefined();
      expect(row["startDate"]).toBe(exp.start);
      expect(row["endDate"]).toBe(exp.end);
      expect(row["monthlyRent"]).toBe(exp.rent);
      expect(row["securityDeposit"]).toBe(200);
      expect(row["status"]).toBe("Active");
      expect(String(row["notes"])).toContain(`Unit ${unit} —`);
      expect(String(row["notes"])).toContain(exp.source);
    }
  });

  it("flags units 2108, 3512, 3524, 3604 as KFI-responsible per the LOI", async () => {
    await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const loiUnits = ["2108", "3512", "3524", "3604"];
    for (const unit of loiUnits) {
      const id = SEED_CHATEAU_KNOLL_IDS.leases[unit]!;
      const row = stores.leases.get(id)!;
      expect(String(row["notes"])).toMatch(/KFI Staffing is responsible/i);
      expect(String(row["clauses"])).toMatch(/01\/22\/2026 LOI/);
    }

    for (const unit of ["1407", "1506"]) {
      const id = SEED_CHATEAU_KNOLL_IDS.leases[unit]!;
      const row = stores.leases.get(id)!;
      expect(String(row["notes"])).not.toMatch(/KFI Staffing is responsible/i);
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const propId = SEED_CHATEAU_KNOLL_IDS.property;
    const before = stores.properties.get(propId)!;
    stores.properties.set(propId, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@chateau.example",
    });

    const second = await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second.customerInserted).toBe(false);
    expect(second.propertyInserted).toBe(false);
    expect(second.leasesInserted).toBe(0);
    expect(second.unitsPresent.sort()).toEqual(
      ["1407", "1506", "2108", "3512", "3524", "3604"],
    );

    const after = stores.properties.get(propId)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@chateau.example");
    expect(stores.leases.size).toBe(6);
  });

  it("reuses a pre-existing Chateau Knoll property created under another customer and bumps totalBeds when too low", async () => {
    stores.customers.set("operator-cust-other", {
      id: "operator-cust-other",
      name: "Some Downstream Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set("operator-prop-chateau", {
      id: "operator-prop-chateau",
      customerId: "operator-cust-other",
      name: "Chateau Knoll (operator)",
      address: "2900 Middle Rd",
      city: "Bettendorf",
      state: "IA",
      zip: "52722",
      totalBeds: 2,
      notes: "operator notes",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(false);
    expect(result.totalBedsBumped).toBe(true);
    expect(result.leasesInserted).toBe(6);
    expect(stores.customers.has(SEED_CHATEAU_KNOLL_IDS.customer)).toBe(false);
    expect(stores.properties.has(SEED_CHATEAU_KNOLL_IDS.property)).toBe(false);

    const reused = stores.properties.get("operator-prop-chateau")!;
    expect(reused["totalBeds"]).toBe(6);
    expect(reused["notes"]).toBe("operator notes");

    for (const unit of ["1407", "1506", "2108", "3512", "3524", "3604"]) {
      const lease = stores.leases.get(SEED_CHATEAU_KNOLL_IDS.leases[unit]!)!;
      expect(lease["propertyId"]).toBe("operator-prop-chateau");
    }
  });

  it("does not bump totalBeds when the existing property already has enough beds", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Some Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set("operator-prop", {
      id: "operator-prop",
      customerId: "operator-cust",
      name: "Chateau",
      address: "2900 Middle Rd",
      city: "Bettendorf",
      state: "IA",
      zip: "52722",
      totalBeds: 12,
      notes: "",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(result.totalBedsBumped).toBe(false);
    expect(stores.properties.get("operator-prop")!["totalBeds"]).toBe(12);
  });

  it("attaches the property to the Greystone Manufacturing end-client when one exists, and skips the corporate fallback", async () => {
    stores.customers.set("cust-greystone", {
      id: "cust-greystone",
      name: "Greystone Manufacturing - Bettendorf, IA",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger });

    expect(result.customerId).toBe("cust-greystone");
    expect(result.customerInserted).toBe(false);
    expect(result.fallbackCustomerDeleted).toBe(false);
    expect(stores.customers.has(SEED_CHATEAU_KNOLL_IDS.customer)).toBe(false);

    const property = stores.properties.get(SEED_CHATEAU_KNOLL_IDS.property)!;
    expect(property["customerId"]).toBe("cust-greystone");

    expect(result.leasesInserted).toBe(6);
    for (const unit of ["1407", "1506", "2108", "3512", "3524", "3604"]) {
      const lease = stores.leases.get(SEED_CHATEAU_KNOLL_IDS.leases[unit]!)!;
      expect(lease["propertyId"]).toBe(SEED_CHATEAU_KNOLL_IDS.property);
    }
  });

  it("matches the Greystone end-client by 'Greystone Manufacturing' (no city suffix) too", async () => {
    stores.customers.set("cust-greystone-short", {
      id: "cust-greystone-short",
      name: "Greystone Manufacturing",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger });

    expect(result.customerId).toBe("cust-greystone-short");
    expect(stores.customers.has(SEED_CHATEAU_KNOLL_IDS.customer)).toBe(false);
    const property = stores.properties.get(SEED_CHATEAU_KNOLL_IDS.property)!;
    expect(property["customerId"]).toBe("cust-greystone-short");
  });

  it("repoints a property previously attached to the corporate fallback once Greystone shows up, and deletes the unused fallback", async () => {
    // First boot: no Greystone yet — falls back to "KFI Staffing — Corporate".
    const first = await seedChateauKnollIfMissing({ logger: silentLogger });
    expect(first.customerInserted).toBe(true);
    expect(first.repointedToEndClient).toBe(false);
    expect(first.fallbackCustomerDeleted).toBe(false);
    expect(
      stores.properties.get(SEED_CHATEAU_KNOLL_IDS.property)!["customerId"],
    ).toBe(SEED_CHATEAU_KNOLL_IDS.customer);

    // Master file lands and creates the Greystone customer.
    stores.customers.set("cust-greystone", {
      id: "cust-greystone",
      name: "Greystone Manufacturing - Bettendorf, IA",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    // Second boot: should repoint the property and remove the orphaned
    // corporate fallback.
    const second = await seedChateauKnollIfMissing({ logger: silentLogger });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-greystone");
    expect(stores.customers.has(SEED_CHATEAU_KNOLL_IDS.customer)).toBe(false);
    expect(stores.customers.has("cust-greystone")).toBe(true);

    const property = stores.properties.get(SEED_CHATEAU_KNOLL_IDS.property)!;
    expect(property["customerId"]).toBe("cust-greystone");

    // All 6 leases still roll up under the property (and so under
    // Greystone) — no leases were lost in the repoint.
    expect(stores.leases.size).toBe(6);
    for (const unit of ["1407", "1506", "2108", "3512", "3524", "3604"]) {
      const lease = stores.leases.get(SEED_CHATEAU_KNOLL_IDS.leases[unit]!)!;
      expect(lease["propertyId"]).toBe(SEED_CHATEAU_KNOLL_IDS.property);
    }
  });

  it("does not repoint or delete anything when the property is attached to an operator-chosen non-fallback customer", async () => {
    // Operator manually attached Chateau Knoll to a different
    // downstream client; Greystone also exists.
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Operator Custom Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.customers.set("cust-greystone", {
      id: "cust-greystone",
      name: "Greystone Manufacturing",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set("operator-prop", {
      id: "operator-prop",
      customerId: "operator-cust",
      name: "Chateau Knoll (operator)",
      address: "2900 Middle Rd",
      city: "Bettendorf",
      state: "IA",
      zip: "52722",
      totalBeds: 6,
      notes: "operator notes",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger });

    // Operator's choice is preserved — we only repoint AWAY from the
    // legacy "KFI Staffing — Corporate" fallback id.
    expect(result.repointedToEndClient).toBe(false);
    expect(result.customerId).toBe("operator-cust");
    expect(stores.properties.get("operator-prop")!["customerId"]).toBe(
      "operator-cust",
    );
    // Both real customers preserved.
    expect(stores.customers.has("operator-cust")).toBe(true);
    expect(stores.customers.has("cust-greystone")).toBe(true);
  });

  it("does not duplicate leases that another import already wrote without our '— Unit N —' marker", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Some Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set("operator-prop", {
      id: "operator-prop",
      customerId: "operator-cust",
      name: "Chateau",
      address: "2900 Middle Rd",
      city: "Bettendorf",
      state: "IA",
      zip: "52722",
      totalBeds: 6,
      notes: "",
    });

    // Pre-existing equivalent lease for unit 2108 written by an
    // upstream master-file import: same monthlyRent, slightly different
    // date normalization, no "Unit N —" marker — but the unit number
    // appears in the clauses field.
    stores.leases.set("upstream-lease-2108", {
      id: "upstream-lease-2108",
      propertyId: "operator-prop",
      startDate: "2026-01-24",
      endDate: "2026-08-01",
      monthlyRent: 1661,
      securityDeposit: 200,
      status: "Active",
      notes: "Imported from master file row #42.",
      clauses: "Premises: Unit 2108, Chateau Knoll, Bettendorf IA.",
    });

    // And one for unit 3512 with the marker but different dates.
    stores.leases.set("upstream-lease-3512", {
      id: "upstream-lease-3512",
      propertyId: "operator-prop",
      startDate: "2026-02-01",
      endDate: "2026-07-31",
      monthlyRent: 1546,
      securityDeposit: 200,
      status: "Active",
      notes: "Unit 3512 — master file.",
      clauses: "",
    });

    const result = await seedChateauKnollIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // 2108 and 3512 should be detected as already present — only the
    // remaining 4 should be inserted.
    expect(result.leasesInserted).toBe(4);
    expect(result.unitsPresent.sort()).toEqual(
      ["1407", "1506", "2108", "3512", "3524", "3604"],
    );
    expect(stores.leases.size).toBe(6);
    expect(stores.leases.has(SEED_CHATEAU_KNOLL_IDS.leases["2108"]!)).toBe(false);
    expect(stores.leases.has(SEED_CHATEAU_KNOLL_IDS.leases["3512"]!)).toBe(false);
  });
});
