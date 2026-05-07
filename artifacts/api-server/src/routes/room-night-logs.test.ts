import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

type TableName =
  | "customers"
  | "properties"
  | "leases"
  | "rooms"
  | "beds"
  | "occupants"
  | "utilities"
  | "roomNightLogs"
  | "insuranceCertificates";

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
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type Predicate = { kind: "eq"; col: string; value: unknown };
function matches(row: Row, p: Predicate): boolean {
  return row[p.col] === p.value;
}

let nextAutoId = 1;

function makeSelect() {
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values()).map((r) => ({
        ...r,
      }));
      const result = {
        orderBy: (_col: unknown) => {
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
        if (!copy.id) copy.id = `auto-${nextAutoId++}`;
        store.set(String(copy.id), copy);
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

const fakeDb = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
  transaction: <T,>(cb: (tx: typeof fakeDb) => Promise<T>): Promise<T> =>
    cb(fakeDb),
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
}));

vi.mock("../lib/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const roomNightLogsRouter = (await import("./room-night-logs")).default;

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
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
  nextAutoId = 1;
});

const VALID_CREATE_BODY = {
  id: "rnl-1",
  leaseId: "lease-hotel",
  month: "2026-03",
  roomNights: 150,
  notes: "Full occupancy.",
};

describe("POST /api/room-night-logs (create)", () => {
  it("returns 201 with the created row on a valid body", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_CREATE_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "rnl-1",
      leaseId: "lease-hotel",
      month: "2026-03",
      roomNights: 150,
      notes: "Full occupancy.",
    });
    expect(stores.roomNightLogs.size).toBe(1);
  });

  it("returns 400 when the body is missing required fields", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseId: "lease-hotel" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(stores.roomNightLogs.size).toBe(0);
  });

  it("returns 400 when the month format is invalid", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...VALID_CREATE_BODY, month: "March 2026" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when roomNights is not a number", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...VALID_CREATE_BODY, roomNights: "lots" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/room-night-logs/:id (edit)", () => {
  it("returns the updated row when patching an existing entry", async () => {
    stores.roomNightLogs.set("rnl-1", { ...VALID_CREATE_BODY });

    const res = await fetch(`${baseUrl}/api/room-night-logs/rnl-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNights: 175, notes: "Revised count." }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "rnl-1",
      roomNights: 175,
      notes: "Revised count.",
    });
    expect(stores.roomNightLogs.get("rnl-1")?.roomNights).toBe(175);
  });

  it("returns 404 when the id does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs/nonexistent`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNights: 99 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Room-night log not found" });
  });

  it("returns 400 when the body contains invalid fields", async () => {
    stores.roomNightLogs.set("rnl-1", { ...VALID_CREATE_BODY });

    const res = await fetch(`${baseUrl}/api/room-night-logs/rnl-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: "not-a-month" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("GET /api/room-night-logs (boundary normalize on read — Task #416)", () => {
  // The room-night-log normalizer is a pass-through today (no enum
  // or date columns on the row shape), so the observable behaviour
  // for a clean row is unchanged. This test pins the integration
  // contract: a canonical row in the store round-trips through the
  // GET response unchanged, proving the normalizer + parse pipeline
  // is wired up. Any future enum/date column added to the row will
  // automatically pick up the boundary coercion via the normalizer.
  it("round-trips a canonical row through the normalize+parse pipeline", async () => {
    stores.roomNightLogs.set("rnl-1", { ...VALID_CREATE_BODY });
    const res = await fetch(`${baseUrl}/api/room-night-logs`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "rnl-1",
      leaseId: "lease-hotel",
      month: "2026-03",
      roomNights: 150,
      notes: "Full occupancy.",
    });
  });
});

describe("DELETE /api/room-night-logs/:id (remove)", () => {
  it("returns 204 and removes the row from the store", async () => {
    stores.roomNightLogs.set("rnl-1", { ...VALID_CREATE_BODY });
    expect(stores.roomNightLogs.size).toBe(1);

    const res = await fetch(`${baseUrl}/api/room-night-logs/rnl-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(stores.roomNightLogs.size).toBe(0);
  });

  it("returns 204 even when the id does not exist (idempotent)", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });
});
