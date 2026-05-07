import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}
type TableName =
  | "customers"
  | "properties"
  | "leases"
  | "insurance_certificates";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  leases: new Map(),
  insurance_certificates: new Map(),
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
      where: async (pred: Predicate) => {
        const store = stores[tableNameOf(table)];
        for (const row of store.values()) {
          if (matches(row, pred)) {
            for (const [k, v] of Object.entries(patch)) {
              row[k] = v;
            }
          }
        }
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
  },
  propertiesTable: {
    __table: "properties",
    id: { __col: "id" },
    customerId: { __col: "customerId" },
    name: { __col: "name" },
    address: { __col: "address" },
    city: { __col: "city" },
    state: { __col: "state" },
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
  insuranceCertificatesTable: {
    __table: "insurance_certificates",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    policyNumber: { __col: "policyNumber" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const { seedAttachedLeasesIfMissing, SEED_ATTACHED_LEASES_IDS } = await import(
  "./seed-attached-leases"
);

const silentLogger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedAttachedLeasesIfMissing", () => {
  it("inserts the 3 customers, 4 properties, and 4 active leases on a fresh DB", async () => {
    const result = await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result).toEqual({
      customersInserted: 3,
      propertiesInserted: 4,
      leasesInserted: 4,
      certificatesInserted: 0,
    });
    expect(stores.customers.size).toBe(3);
    expect(stores.properties.size).toBe(4);
    expect(stores.leases.size).toBe(4);

    const ids = SEED_ATTACHED_LEASES_IDS;
    expect(stores.customers.has(ids.customers.kfiWebster)).toBe(true);
    expect(stores.customers.has(ids.customers.autozoneJeannette)).toBe(true);
    expect(stores.customers.has(ids.customers.kfiStaffingLlc)).toBe(true);
    expect(stores.properties.has(ids.properties.zielsdorf)).toBe(true);
    expect(stores.properties.has(ids.properties.autozoneHouse)).toBe(true);
    expect(stores.properties.has(ids.properties.yellowHouse)).toBe(true);
    expect(stores.properties.has(ids.properties.ridgeMotorInn)).toBe(true);
    expect(stores.leases.has(ids.leases.zielsdorf)).toBe(true);
    expect(stores.leases.has(ids.leases.autozoneHouse)).toBe(true);
    expect(stores.leases.has(ids.leases.yellowHouse)).toBe(true);
    expect(stores.leases.has(ids.leases.ridgeMotorInn)).toBe(true);
  });

  it("seeds each lease with the correct rent, dates, status, and source PDF marker", async () => {
    await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const ids = SEED_ATTACHED_LEASES_IDS;

    const z = stores.leases.get(ids.leases.zielsdorf)!;
    expect(z["startDate"]).toBe("2025-08-29");
    expect(z["endDate"]).toBe("2026-08-31");
    expect(z["monthlyRent"]).toBe(4000);
    expect(z["securityDeposit"]).toBe(4000);
    expect(z["status"]).toBe("Active");
    expect(String(z["clauses"])).toContain(
      "Zielsdorf_Dr_Lease_Agreement_09Sep2025_1778107193593.pdf",
    );
    expect(String(z["notes"])).toContain(
      "Zielsdorf_Dr_Lease_Agreement_09Sep2025_1778107193593.pdf",
    );

    const a = stores.leases.get(ids.leases.autozoneHouse)!;
    expect(a["startDate"]).toBe("2026-05-01");
    expect(a["endDate"]).toBe("2026-11-01");
    expect(a["monthlyRent"]).toBe(1800);
    expect(a["status"]).toBe("Active");
    expect(String(a["clauses"])).toMatch(/George DeLallo/);
    expect(String(a["notes"])).toContain(
      "Auto_Zone_-_6481_US-30_Jeannette_PA_15644_-_2026_KFI_STAFFING__1778107208478.pdf",
    );

    const y = stores.leases.get(ids.leases.yellowHouse)!;
    expect(y["startDate"]).toBe("2026-03-05");
    expect(y["endDate"]).toBe("2026-09-05");
    expect(y["monthlyRent"]).toBe(2400);
    expect(y["status"]).toBe("Active");
    expect(String(y["notes"])).toContain(
      "Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
    );

    const r = stores.leases.get(ids.leases.ridgeMotorInn)!;
    expect(r["startDate"]).toBe("2026-04-06");
    expect(r["endDate"]).toBe("2027-04-05");
    expect(r["monthlyRent"]).toBe(0);
    expect(r["status"]).toBe("Active");
    expect(String(r["clauses"])).toContain("$53.00/night");
    expect(String(r["clauses"])).toContain("Double Queen");
    expect(String(r["clauses"])).toContain("10");
    expect(String(r["notes"])).toContain(
      "The_Ridge_Motor_Inn_1778107885976.pdf",
    );

    const ridgeProp = stores.properties.get(ids.properties.ridgeMotorInn)!;
    expect(ridgeProp["name"]).toBe("The Ridge Motor Inn");
    expect(ridgeProp["address"]).toBe("2900 New Pinery Road");
    expect(ridgeProp["city"]).toBe("Portage");
    expect(ridgeProp["state"]).toBe("WI");
    expect(ridgeProp["zip"]).toBe("53901");
    expect(ridgeProp["customerId"]).toBe(ids.customers.kfiStaffingLlc);

    const ridgeCust = stores.customers.get(ids.customers.kfiStaffingLlc)!;
    expect(ridgeCust["name"]).toBe("KFI Staffing LLC");
  });

  it("links properties to the correct customers", async () => {
    await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    const ids = SEED_ATTACHED_LEASES_IDS;

    expect(
      stores.properties.get(ids.properties.zielsdorf)!["customerId"],
    ).toBe(ids.customers.kfiWebster);
    expect(
      stores.properties.get(ids.properties.autozoneHouse)!["customerId"],
    ).toBe(ids.customers.autozoneJeannette);
    expect(
      stores.properties.get(ids.properties.yellowHouse)!["customerId"],
    ).toBe(ids.customers.autozoneJeannette);
  });

  it("backfills a blank Ridge Motor Inn address on a re-run after the spec was filled in", async () => {
    const ids = SEED_ATTACHED_LEASES_IDS;
    // Simulate a DB that was seeded under the previous behavior, where the
    // Ridge Motor Inn property was inserted with an empty address.
    stores.customers.set(ids.customers.kfiStaffingLlc, {
      id: ids.customers.kfiStaffingLlc,
      name: "KFI Staffing LLC",
    });
    stores.properties.set(ids.properties.ridgeMotorInn, {
      id: ids.properties.ridgeMotorInn,
      customerId: ids.customers.kfiStaffingLlc,
      name: "The Ridge Motor Inn",
      address: "",
      city: "",
      state: "",
      zip: "",
    });

    await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const ridge = stores.properties.get(ids.properties.ridgeMotorInn)!;
    expect(ridge["address"]).toBe("2900 New Pinery Road");
    expect(ridge["city"]).toBe("Portage");
    expect(ridge["state"]).toBe("WI");
    expect(ridge["zip"]).toBe("53901");
    // No duplicate Ridge property row was created.
    const ridgeRows = Array.from(stores.properties.values()).filter(
      (p) => p["name"] === "The Ridge Motor Inn",
    );
    expect(ridgeRows).toHaveLength(1);
  });

  it("does not overwrite an already-populated address on re-run", async () => {
    const ids = SEED_ATTACHED_LEASES_IDS;
    stores.customers.set(ids.customers.kfiStaffingLlc, {
      id: ids.customers.kfiStaffingLlc,
      name: "KFI Staffing LLC",
    });
    stores.properties.set(ids.properties.ridgeMotorInn, {
      id: ids.properties.ridgeMotorInn,
      customerId: ids.customers.kfiStaffingLlc,
      name: "The Ridge Motor Inn",
      address: "999 Operator Override Rd",
      city: "Somewhere",
      state: "WI",
      zip: "54321",
    });

    await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const ridge = stores.properties.get(ids.properties.ridgeMotorInn)!;
    expect(ridge["address"]).toBe("999 Operator Override Rd");
    expect(ridge["city"]).toBe("Somewhere");
    expect(ridge["zip"]).toBe("54321");
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    const ids = SEED_ATTACHED_LEASES_IDS;

    const before = stores.properties.get(ids.properties.zielsdorf)!;
    stores.properties.set(ids.properties.zielsdorf, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@eureka.example",
    });

    const second = await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customersInserted: 0,
      propertiesInserted: 0,
      leasesInserted: 0,
      certificatesInserted: 0,
    });

    const after = stores.properties.get(ids.properties.zielsdorf)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@eureka.example");
    expect(stores.leases.size).toBe(4);
  });

  it("reuses pre-existing customers/properties created under different IDs (natural-key match)", async () => {
    stores.customers.set("operator-cust-autozone", {
      id: "operator-cust-autozone",
      name: "AutoZone – Jeannette, PA",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator notes",
    });
    stores.properties.set("operator-prop-6481", {
      id: "operator-prop-6481",
      customerId: "operator-cust-autozone",
      name: "AutoZone house",
      address: "6481 US-30",
      city: "Jeannette",
      state: "PA",
      zip: "15644",
      notes: "operator property notes",
    });

    const result = await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    const ids = SEED_ATTACHED_LEASES_IDS;

    expect(result.customersInserted).toBe(2);
    expect(result.propertiesInserted).toBe(3);
    expect(result.leasesInserted).toBe(4);

    expect(stores.customers.has(ids.customers.autozoneJeannette)).toBe(false);
    expect(stores.properties.has(ids.properties.autozoneHouse)).toBe(false);

    const autozoneLease = stores.leases.get(ids.leases.autozoneHouse)!;
    expect(autozoneLease["propertyId"]).toBe("operator-prop-6481");

    const yellowLease = stores.leases.get(ids.leases.yellowHouse)!;
    expect(stores.properties.get(yellowLease["propertyId"] as string)!["customerId"]).toBe(
      "operator-cust-autozone",
    );
  });

  it("does not duplicate The Ridge Motor Inn when a prior import (e.g. #288 master file) already created an equivalent customer/property/lease under different IDs and metadata", async () => {
    // Pre-existing rows the master-file importer might have created:
    // - same customer name "KFI Staffing LLC" but different id
    // - same property name "The Ridge Motor Inn" but with a populated
    //   address (since master file may know the address) and a different id
    // - same active agreement (matching start date) but with no source-PDF
    //   marker in notes and a different id
    stores.customers.set("master-cust-kfi", {
      id: "master-cust-kfi",
      name: "KFI Staffing LLC",
      contactName: "",
      email: "",
      phone: "",
      notes: "from master-file import",
    });
    stores.properties.set("master-prop-ridge", {
      id: "master-prop-ridge",
      customerId: "master-cust-kfi",
      name: "The Ridge Motor Inn",
      address: "123 Some St (filled in by master file)",
      city: "Portage",
      state: "WI",
      zip: "53901",
      notes: "operator notes",
    });
    stores.leases.set("master-lease-ridge", {
      id: "master-lease-ridge",
      propertyId: "master-prop-ridge",
      startDate: "2026-04-06",
      endDate: "2027-04-05",
      monthlyRent: 0,
      status: "Active",
      notes: "Pre-existing Ridge agreement from master file (no source marker).",
    });

    const result = await seedAttachedLeasesIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    const ids = SEED_ATTACHED_LEASES_IDS;

    // The Ridge customer/property/lease must NOT be re-inserted.
    expect(stores.customers.has(ids.customers.kfiStaffingLlc)).toBe(false);
    expect(stores.properties.has(ids.properties.ridgeMotorInn)).toBe(false);
    expect(stores.leases.has(ids.leases.ridgeMotorInn)).toBe(false);

    // Pre-existing rows untouched.
    expect(stores.properties.get("master-prop-ridge")!["address"]).toBe(
      "123 Some St (filled in by master file)",
    );
    expect(stores.leases.get("master-lease-ridge")!["notes"]).toBe(
      "Pre-existing Ridge agreement from master file (no source marker).",
    );

    // Only the non-Ridge KFI/AutoZone seed rows get inserted.
    expect(result).toEqual({
      customersInserted: 2, // kfiWebster + autozoneJeannette (Ridge skipped)
      propertiesInserted: 3, // zielsdorf + autozoneHouse + yellowHouse (Ridge skipped)
      leasesInserted: 3, // zielsdorf + autozoneHouse + yellowHouse (Ridge skipped)
      certificatesInserted: 0,
    });
  });
});
