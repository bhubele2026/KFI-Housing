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

// Perf-pass Step 2: optional `?propertyId=` server-side filter on GET /api/beds.
// Self-contained harness (separate from beds.test.ts) modeling the
// select().from().where(cond).orderBy() chain the filter branch uses.

interface BedRow {
  id: string;
  propertyId: string;
  bedNumber: number;
  roomId: string;
  status: string;
  occupantId: string | null;
}

interface Cond {
  field: string;
  value: string;
}

const store = new Map<string, BedRow>();

function allRows(): BedRow[] {
  return Array.from(store.values());
}
function filtered(cond: Cond): BedRow[] {
  return allRows().filter((r) => (r as unknown as Record<string, unknown>)[cond.field] === cond.value);
}

const fakeDb = {
  select: () => ({
    from: () => ({
      orderBy: () => allRows(),
      where: (cond: Cond) => ({ orderBy: () => filtered(cond) }),
    }),
  }),
};

vi.mock("drizzle-orm", () => ({
  // Capture the column's field + the value so the fake `where` can filter.
  eq: (col: { __field: string }, value: string) => ({ field: col.__field, value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  bedsTable: {
    __table: "beds",
    id: { __col: "id" },
    propertyId: { __field: "propertyId" },
  },
}));

const bedsRouter = (await import("./beds")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", bedsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  store.clear();
  store.set("b1", { id: "b1", propertyId: "p-1", bedNumber: 1, roomId: "r-1", status: "Vacant", occupantId: null });
  store.set("b2", { id: "b2", propertyId: "p-1", bedNumber: 2, roomId: "r-1", status: "Vacant", occupantId: null });
  store.set("b3", { id: "b3", propertyId: "p-2", bedNumber: 1, roomId: "r-9", status: "Vacant", occupantId: null });
});

describe("GET /api/beds — optional propertyId filter (perf Step 2)", () => {
  it("returns every bed when no propertyId is supplied (unchanged behavior)", async () => {
    const res = await fetch(`${baseUrl}/api/beds`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as BedRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("returns only the beds for the given propertyId", async () => {
    const res = await fetch(`${baseUrl}/api/beds?propertyId=p-1`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as BedRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["b1", "b2"]);
  });

  it("returns an empty list for a property with no beds", async () => {
    const res = await fetch(`${baseUrl}/api/beds?propertyId=does-not-exist`);
    expect(res.status).toBe(200);
    expect((await res.json()) as BedRow[]).toEqual([]);
  });

  it("400s when propertyId is malformed (repeated query param → array)", async () => {
    const res = await fetch(`${baseUrl}/api/beds?propertyId=a&propertyId=b`);
    expect(res.status).toBe(400);
  });
});
