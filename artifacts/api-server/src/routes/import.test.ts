import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// In-memory drizzle mock (shared by `replaceAllData` + `room-night-logs` route)
// ---------------------------------------------------------------------------
//
// `replaceAllData` runs inside `db.transaction(...)` and calls
// `tx.delete(table)` + `tx.insert(table).values(rows)`. The
// `/room-night-logs` route uses `db.select().from(table).orderBy(col)` and
// `db.insert(table).values(row).returning()` directly. The mock implements
// just the surface area touched by these two flows so we can exercise the
// full HTTP round-trip (POST /import → DB → GET /room-night-logs) without
// a real Postgres.

type TableName =
  | "customers"
  | "properties"
  | "leases"
  | "rooms"
  | "beds"
  | "occupants"
  | "utilities"
  | "roomNightLogs"
  | "insuranceCertificates"
  | "otherCosts"
  | "propertyViolations"
  | "buildings";

interface Row {
  id: string;
  [k: string]: unknown;
}

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  leases: new Map(),
  rooms: new Map(),
  beds: new Map(),
  occupants: new Map(),
  utilities: new Map(),
  roomNightLogs: new Map(),
  insuranceCertificates: new Map(),
  otherCosts: new Map(),
  propertyViolations: new Map(),
  // Buildings (Task #570) — wiped + reinserted alongside the other
  // tables when the importer round-trips a bundle.
  buildings: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type Predicate = { kind: "eq"; col: string; value: unknown };
function matches(row: Row, p: Predicate): boolean {
  return row[p.col] === p.value;
}

function makeSelect() {
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values()).map((r) => ({
        ...r,
      }));
      const result = {
        orderBy: (_col: unknown) => {
          // Stable sort by `id` — matches the route's `.orderBy(table.id)`.
          const sorted = [...rows].sort((a, b) =>
            String(a.id).localeCompare(String(b.id)),
          );
          return Promise.resolve(sorted);
        },
        then: (
          onF: (v: unknown[]) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(rows).then(onF, onR),
      };
      return result;
    },
  };
}

function makeInsert(table: unknown) {
  return {
    values: (rows: Row | Row[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      const store = stores[tableNameOf(table)];
      const inserted: Row[] = [];
      for (const row of arr) {
        const copy = { ...row };
        store.set(String(row.id), copy);
        inserted.push({ ...copy });
      }
      const thenable = {
        returning: async () => inserted.map((r) => ({ ...r })),
        then: (
          onF: (v: unknown) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(undefined).then(onF, onR),
      };
      return thenable;
    },
  };
}

function makeUpdate(table: unknown) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: (pred: Predicate) => {
        const store = stores[tableNameOf(table)];
        const updated: Row[] = [];
        for (const row of store.values()) {
          if (matches(row, pred)) {
            for (const [k, v] of Object.entries(patch)) row[k] = v;
            updated.push({ ...row });
          }
        }
        return {
          returning: async () => updated,
          then: (
            onF: (v: unknown) => unknown,
            onR?: (e: unknown) => unknown,
          ) => Promise.resolve(undefined).then(onF, onR),
        };
      },
    }),
  };
}

function makeDelete(table: unknown) {
  const store = stores[tableNameOf(table)];
  const thenable = {
    where: (pred: Predicate) => {
      for (const row of Array.from(store.values())) {
        if (matches(row, pred)) store.delete(String(row.id));
      }
      return Promise.resolve(undefined);
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ) => {
      store.clear();
      return Promise.resolve(undefined).then(onF, onR);
    },
  };
  return thenable;
}

const tx = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
};
type Tx = typeof tx;
const fakeDb = {
  ...tx,
  transaction: <T,>(cb: (tx: Tx) => Promise<T>): Promise<T> => cb(tx),
};

function makeColumns(name: TableName, cols: string[]) {
  const table: Record<string, unknown> & { __table: TableName } = {
    __table: name,
  };
  for (const c of cols) table[c] = { __col: c };
  return table;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  customersTable: makeColumns("customers", ["id"]),
  propertiesTable: makeColumns("properties", ["id"]),
  leasesTable: makeColumns("leases", ["id"]),
  roomsTable: makeColumns("rooms", ["id"]),
  bedsTable: makeColumns("beds", ["id"]),
  occupantsTable: makeColumns("occupants", ["id"]),
  utilitiesTable: makeColumns("utilities", ["id"]),
  roomNightLogsTable: makeColumns("roomNightLogs", [
    "id",
    "leaseId",
    "month",
    "roomNights",
    "notes",
  ]),
  insuranceCertificatesTable: makeColumns("insuranceCertificates", ["id"]),
  otherCostsTable: makeColumns("otherCosts", ["id"]),
  propertyViolationsTable: makeColumns("propertyViolations", ["id"]),
  buildingsTable: makeColumns("buildings", ["id"]),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

// Imports come AFTER the mocks so the mocked modules are picked up.
const { replaceAllData } = await import("../lib/seed");
const importRouter = (await import("./import")).default;
const roomNightLogsRouter = (await import("./room-night-logs")).default;

// ---------------------------------------------------------------------------
// Ephemeral HTTP server for the round-trip tests
// ---------------------------------------------------------------------------

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", importRouter);
  app.use("/api", roomNightLogsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid bundle that satisfies ImportDataBody
// ---------------------------------------------------------------------------

interface RoomNightLogFixture {
  id: string;
  leaseId: string;
  month: string;
  roomNights: number;
  notes: string;
}

function makeBundle(roomNightLogs: RoomNightLogFixture[]) {
  return {
    customers: [
      {
        id: "c1",
        name: "Acme",
        contactName: "",
        email: "",
        phone: "",
        notes: "",
      },
    ],
    properties: [
      {
        id: "p1",
        name: "Hotel One",
        address: "1 Main",
        city: "Austin",
        state: "TX",
        zip: "78701",
        totalBeds: 0,
        monthlyRent: 0,
        chargePerBed: 0,
        status: "Active" as const,
        landlordName: "",
        landlordEmail: "",
        landlordPhone: "",
        paymentMethod: "" as const,
        paymentRecipient: "",
        paymentDueDay: 1,
        paymentNotes: "",
        bankName: "",
        bankRouting: "",
        bankAccount: "",
        portalUrl: "",
        notes: "",
        furnishings: [],
        customerId: "c1",
      },
    ],
    leases: [
      {
        id: "lease-hotel",
        propertyId: "p1",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyRent: 0,
        securityDeposit: 0,
        status: "Active" as const,
        notes: "",
      },
    ],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    roomNightLogs,
  };
}

const SAMPLE_LOGS: RoomNightLogFixture[] = [
  {
    id: "rnl-jan",
    leaseId: "lease-hotel",
    month: "2026-01",
    roomNights: 120,
    notes: "Soft launch month — under min by 30.",
  },
  {
    id: "rnl-feb",
    leaseId: "lease-hotel",
    month: "2026-02",
    roomNights: 200,
    notes: "",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replaceAllData (room-night-log persistence — Task #352)", () => {
  it("inserts room-night logs into the DB and clears them on the next replace", async () => {
    await replaceAllData(makeBundle(SAMPLE_LOGS));

    expect(stores.roomNightLogs.size).toBe(2);
    const jan = stores.roomNightLogs.get("rnl-jan")!;
    expect(jan).toMatchObject({
      id: "rnl-jan",
      leaseId: "lease-hotel",
      month: "2026-01",
      roomNights: 120,
    });
    expect(stores.roomNightLogs.get("rnl-feb")?.roomNights).toBe(200);

    // A second replace with an empty log array exercises the wipeAll →
    // insertBundle path: previous rows must be gone afterward.
    await replaceAllData(makeBundle([]));
    expect(stores.roomNightLogs.size).toBe(0);
    // And the rest of the bundle was wiped + reinserted in the same tx,
    // so the dependent tables still have their fresh rows.
    expect(stores.leases.size).toBe(1);
    expect(stores.properties.size).toBe(1);
    expect(stores.customers.size).toBe(1);
  });

  it("treats a bundle with no roomNightLogs field as an empty list (legacy backups)", async () => {
    const legacy = makeBundle([]) as Partial<ReturnType<typeof makeBundle>>;
    delete (legacy as { roomNightLogs?: unknown }).roomNightLogs;

    await expect(
      replaceAllData(legacy as Parameters<typeof replaceAllData>[0]),
    ).resolves.toBeUndefined();
    expect(stores.roomNightLogs.size).toBe(0);
  });
});

describe("POST /api/import → GET /api/room-night-logs round-trip (Task #352)", () => {
  it("persists logs sent through the HTTP boundary and returns them verbatim", async () => {
    const postRes = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeBundle(SAMPLE_LOGS)),
    });
    expect(postRes.status).toBe(200);
    expect(await postRes.json()).toEqual({ status: "ok" });

    const getRes = await fetch(`${baseUrl}/api/room-night-logs`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as RoomNightLogFixture[];

    // Sorted by id (route uses `.orderBy(roomNightLogsTable.id)`).
    expect(body).toEqual([
      {
        id: "rnl-feb",
        leaseId: "lease-hotel",
        month: "2026-02",
        roomNights: 200,
        notes: "",
      },
      {
        id: "rnl-jan",
        leaseId: "lease-hotel",
        month: "2026-01",
        roomNights: 120,
        notes: "Soft launch month — under min by 30.",
      },
    ]);
  });

  it("does not leak logs across imports — a follow-up import with no logs empties the list", async () => {
    let postRes = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeBundle(SAMPLE_LOGS)),
    });
    expect(postRes.status).toBe(200);

    postRes = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeBundle([])),
    });
    expect(postRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/room-night-logs`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual([]);
  });
});
