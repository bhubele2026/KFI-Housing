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

interface BedRow {
  id: string;
  propertyId: string;
  bedNumber: number;
  roomId: string;
  status: string;
  occupantId: string | null;
}

const store = new Map<string, BedRow>();

const fakeDb = {
  select: () => ({
    from: () => ({
      orderBy: () => Array.from(store.values()),
    }),
  }),
  insert: () => ({
    values: (vals: BedRow) => ({
      returning: () => {
        store.set(vals.id, vals);
        return [vals];
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({ returning: () => [] }),
    }),
  }),
  delete: () => ({ where: () => undefined }),
};

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  bedsTable: { __table: "beds", id: { __col: "id" } },
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
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  store.clear();
});

describe("GET /api/beds (boundary normalize on read — Task #416)", () => {
  // Without the boundary normalizer the response schema's enum check
  // on `status` would 500 the entire list endpoint when a single
  // legacy row carries an off-list value (e.g. an old "Pending"
  // status from before the enum tightened). With the normalizer
  // wired into the GET path that row is coerced down to the safe
  // default ("Vacant") so the rest of the array still round-trips.
  it("coerces an off-list status on a legacy row to the canonical default", async () => {
    store.set("b-clean", {
      id: "b-clean",
      propertyId: "p-1",
      bedNumber: 1,
      roomId: "r-1",
      status: "Occupied",
      occupantId: "o-1",
    });
    store.set("b-legacy", {
      id: "b-legacy",
      propertyId: "p-1",
      bedNumber: 2,
      roomId: "r-1",
      status: "Pending",
      occupantId: null,
    });

    const res = await fetch(`${baseUrl}/api/beds`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as BedRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["b-clean", "b-legacy"]);
    const legacy = rows.find((r) => r.id === "b-legacy")!;
    expect(legacy.status).toBe("Vacant");
    const clean = rows.find((r) => r.id === "b-clean")!;
    expect(clean.status).toBe("Occupied");
  });
});
