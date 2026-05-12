import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// In-memory drizzle mock for the projected-move-ins route (Task #577).
// ---------------------------------------------------------------------------
//
// The route touches four tables (projected_move_ins, properties, beds,
// occupants) and runs the convert flow inside `db.transaction(...)`. The
// mock implements just enough of the drizzle surface — `select().from()
// .where().orderBy()`, `insert().values().returning()`, `update().set()
// .where().returning()`, `delete().where()`, plus a `transaction(cb)`
// that hands the same handle to the callback — to let the real router
// execute against an in-process store. Tests reset every store in
// `beforeEach` so suites don't bleed into one another.

type TableName = "projectedMoveIns" | "properties" | "beds" | "occupants";

interface Row {
  id: string;
  [k: string]: unknown;
}

const stores: Record<TableName, Map<string, Row>> = {
  projectedMoveIns: new Map(),
  properties: new Map(),
  beds: new Map(),
  occupants: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type EqPred = { kind: "eq"; col: string; value: unknown };
type IsNullPred = { kind: "isNull"; col: string };
type AndPred = { kind: "and"; preds: Predicate[] };
type Predicate = EqPred | IsNullPred | AndPred;

function predMatches(row: Row, p: Predicate | undefined): boolean {
  if (!p) return true;
  if (p.kind === "eq") return row[p.col] === p.value;
  if (p.kind === "isNull") return row[p.col] == null;
  return p.preds.every((sub) => predMatches(row, sub));
}

function makeSelectChain(table: unknown, fields?: Record<string, unknown>) {
  const rows = Array.from(stores[tableNameOf(table)].values());
  let where: Predicate | undefined;
  const project = (r: Row): Row => {
    if (!fields) return { ...r };
    const out: Row = { id: r.id };
    for (const [k] of Object.entries(fields)) out[k] = r[k];
    return out;
  };
  const builder = {
    where(pred: Predicate) {
      where = pred;
      const filtered = rows.filter((r) => predMatches(r, where)).map(project);
      const next = {
        orderBy: (col: unknown) => {
          const colName =
            (col as { __col?: string } | null)?.__col ?? "id";
          const sorted = [...filtered].sort((a, b) =>
            String(a[colName] ?? "").localeCompare(String(b[colName] ?? "")),
          );
          return Promise.resolve(sorted);
        },
        then: (
          onF: (v: unknown[]) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(filtered).then(onF, onR),
      };
      return next;
    },
  };
  return builder;
}

function makeInsert(table: unknown) {
  return {
    values: (rows: Row | Row[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      const tname = tableNameOf(table);
      const store = stores[tname];
      const inserted: Row[] = [];
      for (const row of arr) {
        // Defaults mirror the column defaults declared in the schema so
        // a route that inserts a partial payload (e.g. POST projected
        // move-ins doesn't supply `convertedOccupantId`) still gets a
        // round-trippable row that satisfies the response schema.
        const tableDefaults: Row =
          tname === "projectedMoveIns"
            ? {
                id: "",
                notes: "",
                bedId: null,
                convertedOccupantId: null,
              }
            : { id: "" };
        const copy = {
          ...tableDefaults,
          ...row,
          createdAt: row.createdAt ?? new Date("2026-05-01T00:00:00Z"),
          updatedAt: row.updatedAt ?? new Date("2026-05-01T00:00:00Z"),
        };
        store.set(String(row.id), copy);
        inserted.push({ ...copy });
      }
      return {
        returning: async () => inserted.map((r) => ({ ...r })),
        then: (
          onF: (v: unknown) => unknown,
          onR?: (e: unknown) => unknown,
        ) => Promise.resolve(undefined).then(onF, onR),
      };
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
          if (predMatches(row, pred)) {
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
  return {
    where: (pred: Predicate) => {
      for (const row of Array.from(store.values())) {
        if (predMatches(row, pred)) store.delete(String(row.id));
      }
      return Promise.resolve(undefined);
    },
  };
}

const tx = {
  select: (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => makeSelectChain(table, fields),
  }),
  insert: (table: unknown) => makeInsert(table),
  update: (table: unknown) => makeUpdate(table),
  delete: (table: unknown) => makeDelete(table),
};
type Tx = typeof tx;
const fakeDb = {
  ...tx,
  // Run the callback synchronously against the same store so the route's
  // tx.* calls behave like a real, never-aborting transaction.
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
  isNull: (col: { __col: string }) => ({
    kind: "isNull" as const,
    col: col.__col,
  }),
  and: (...preds: Predicate[]) => ({ kind: "and" as const, preds }),
  asc: (col: unknown) => col,
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  projectedMoveInsTable: makeColumns("projectedMoveIns", [
    "id",
    "propertyId",
    "personName",
    "projectedMoveInDate",
    "bedId",
    "notes",
    "convertedOccupantId",
    "createdAt",
    "updatedAt",
  ]),
  propertiesTable: makeColumns("properties", ["id"]),
  bedsTable: makeColumns("beds", [
    "id",
    "propertyId",
    "status",
    "occupantId",
    "cleaningStatus",
  ]),
  occupantsTable: makeColumns("occupants", [
    "id",
    "propertyId",
    "bedId",
    "name",
    "moveInDate",
    "status",
  ]),
}));

const projectedMoveInsRouter = (await import("./projected-move-ins")).default;

function seedProperty(id: string) {
  stores.properties.set(id, { id });
}

function seedBed(
  id: string,
  overrides: Partial<{
    propertyId: string;
    status: "Vacant" | "Occupied";
    occupantId: string | null;
    cleaningStatus: "ready" | "needs_cleaning" | "in_progress";
  }> = {},
) {
  stores.beds.set(id, {
    id,
    propertyId: overrides.propertyId ?? "p1",
    status: overrides.status ?? "Vacant",
    occupantId: overrides.occupantId ?? null,
    cleaningStatus: overrides.cleaningStatus ?? "ready",
  });
}

function seedProjection(
  id: string,
  overrides: Partial<Row> = {},
): Row {
  const row: Row = {
    id,
    propertyId: "p1",
    personName: "Maria Santos",
    projectedMoveInDate: "2026-06-15",
    bedId: null,
    notes: "",
    convertedOccupantId: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
  stores.projectedMoveIns.set(id, row);
  return row;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", projectedMoveInsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
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
  seedProperty("p1");
});

describe("GET /api/properties/:id/projected-move-ins (Task #577)", () => {
  it("returns only rows for the requested property that haven't been converted, sorted by date", async () => {
    seedProjection("pmi-late", {
      propertyId: "p1",
      personName: "Late Larry",
      projectedMoveInDate: "2026-09-01",
    });
    seedProjection("pmi-early", {
      propertyId: "p1",
      personName: "Early Eve",
      projectedMoveInDate: "2026-06-01",
    });
    // Hidden because already converted.
    seedProjection("pmi-done", {
      propertyId: "p1",
      personName: "Done Dan",
      projectedMoveInDate: "2026-07-01",
      convertedOccupantId: "occ-old",
    });
    // Hidden because it belongs to a different property.
    seedProperty("p2");
    seedProjection("pmi-other", {
      propertyId: "p2",
      personName: "Other Otto",
      projectedMoveInDate: "2026-06-10",
    });

    const res = await fetch(`${baseUrl}/api/properties/p1/projected-move-ins`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["pmi-early", "pmi-late"]);
  });
});

describe("POST /api/properties/:id/projected-move-ins (Task #577)", () => {
  function validBody(overrides: Partial<Row> = {}) {
    return {
      id: "pmi-new",
      personName: "Maria Santos",
      projectedMoveInDate: "2026-06-15",
      bedId: null,
      notes: "with crew B",
      ...overrides,
    };
  }

  it("creates a row and returns 201 with a serialized createdAt", async () => {
    const res = await fetch(`${baseUrl}/api/properties/p1/projected-move-ins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; createdAt: string };
    expect(body.id).toBe("pmi-new");
    expect(typeof body.createdAt).toBe("string");
    expect(stores.projectedMoveIns.size).toBe(1);
  });

  it("rejects an empty name with 400", async () => {
    const res = await fetch(`${baseUrl}/api/properties/p1/projected-move-ins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody({ personName: "  " })),
    });
    expect(res.status).toBe(400);
    expect(stores.projectedMoveIns.size).toBe(0);
  });

  it("rejects a malformed projectedMoveInDate with 400", async () => {
    const res = await fetch(`${baseUrl}/api/properties/p1/projected-move-ins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody({ projectedMoveInDate: "next month" })),
    });
    expect(res.status).toBe(400);
    expect(stores.projectedMoveIns.size).toBe(0);
  });

  it("returns 404 when the property does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/properties/ghost/projected-move-ins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when bedId points at a bed in a different property", async () => {
    seedProperty("p2");
    seedBed("b-other", { propertyId: "p2" });
    const res = await fetch(`${baseUrl}/api/properties/p1/projected-move-ins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody({ bedId: "b-other" })),
    });
    expect(res.status).toBe(400);
    expect(stores.projectedMoveIns.size).toBe(0);
  });
});

describe("PATCH /api/properties/:id/projected-move-ins/:moveInId (Task #577)", () => {
  it("updates the row and returns the new shape", async () => {
    seedProjection("pmi-1");
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personName: "Renamed", notes: "updated" }),
      },
    );
    expect(res.status).toBe(200);
    const row = stores.projectedMoveIns.get("pmi-1")!;
    expect(row.personName).toBe("Renamed");
    expect(row.notes).toBe("updated");
  });

  it("rejects an empty name with 400 even on patch", async () => {
    seedProjection("pmi-1");
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personName: "" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the projection doesn't exist for this property", async () => {
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-missing`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "hello" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/properties/:id/projected-move-ins/:moveInId (Task #577)", () => {
  it("removes the row and returns 204", async () => {
    seedProjection("pmi-del");
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-del`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
    expect(stores.projectedMoveIns.has("pmi-del")).toBe(false);
  });

  it("is a no-op (still 204) when the moveInId doesn't exist", async () => {
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-ghost`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
  });
});

describe("POST /api/properties/:id/projected-move-ins/:moveInId/convert (Task #577)", () => {
  it("happy path: creates an occupant, flips the bed to Occupied, and stamps convertedOccupantId", async () => {
    seedBed("b1", { propertyId: "p1", cleaningStatus: "ready" });
    seedProjection("pmi-1", { bedId: "b1" });

    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projectedMoveIn: { convertedOccupantId: string; bedId: string };
      occupant: { id: string; bedId: string; moveInDate: string };
    };
    expect(body.projectedMoveIn.convertedOccupantId).toMatch(/^occ-/);
    expect(body.projectedMoveIn.bedId).toBe("b1");
    expect(body.occupant.bedId).toBe("b1");
    expect(body.occupant.moveInDate).toBe("2026-06-15");

    const bed = stores.beds.get("b1")!;
    expect(bed.status).toBe("Occupied");
    expect(bed.occupantId).toBe(body.occupant.id);

    const projection = stores.projectedMoveIns.get("pmi-1")!;
    expect(projection.convertedOccupantId).toBe(body.occupant.id);

    expect(stores.occupants.size).toBe(1);
  });

  it("returns 409 when the target bed is already occupied", async () => {
    seedBed("b1", {
      propertyId: "p1",
      status: "Occupied",
      occupantId: "occ-existing",
      cleaningStatus: "ready",
    });
    seedProjection("pmi-1", { bedId: "b1" });

    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("occupied");
    // Nothing should have been written.
    expect(stores.occupants.size).toBe(0);
    expect(stores.projectedMoveIns.get("pmi-1")!.convertedOccupantId).toBeNull();
  });

  it("returns 409 when the bed is not 'ready' to clean", async () => {
    seedBed("b1", { propertyId: "p1", cleaningStatus: "needs_cleaning" });
    seedProjection("pmi-1", { bedId: "b1" });

    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; cleaningStatus: string };
    expect(body.error.toLowerCase()).toContain("cleaning");
    expect(body.cleaningStatus).toBe("needs_cleaning");
    expect(stores.occupants.size).toBe(0);
  });

  it("returns 400 when no bed is set on the projection or in the override", async () => {
    seedProjection("pmi-1", { bedId: null });
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("bed");
  });

  it("returns 400 when the projection's date is missing/malformed", async () => {
    seedBed("b1", { propertyId: "p1", cleaningStatus: "ready" });
    seedProjection("pmi-1", { bedId: "b1", projectedMoveInDate: "" });
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("date");
  });

  it("returns 409 when the projection has already been converted", async () => {
    seedProjection("pmi-1", {
      bedId: "b1",
      convertedOccupantId: "occ-prev",
    });
    seedBed("b1", { propertyId: "p1", cleaningStatus: "ready" });

    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("already");
  });

  it("returns 404 when the projection doesn't exist for this property", async () => {
    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-ghost/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(404);
  });

  it("uses the override bedId when supplied in the body", async () => {
    seedBed("b1", { propertyId: "p1", cleaningStatus: "ready" });
    seedBed("b2", { propertyId: "p1", cleaningStatus: "ready" });
    seedProjection("pmi-1", { bedId: "b1" });

    const res = await fetch(
      `${baseUrl}/api/properties/p1/projected-move-ins/pmi-1/convert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bedId: "b2" }),
      },
    );
    expect(res.status).toBe(200);
    expect(stores.beds.get("b1")!.status).toBe("Vacant");
    expect(stores.beds.get("b2")!.status).toBe("Occupied");
    const projection = stores.projectedMoveIns.get("pmi-1")!;
    expect(projection.bedId).toBe("b2");
  });
});
