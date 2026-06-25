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

// Perf-pass Step 2: optional `?propertyId=` filter on GET /api/rooms.

interface RoomRow {
  id: string;
  propertyId: string;
  buildingId: string;
  name: string;
  sqft: number;
  bathrooms: number;
  monthlyRent: number;
}
interface Cond {
  field: string;
  value: string;
}

const store = new Map<string, RoomRow>();
const allRows = (): RoomRow[] => Array.from(store.values());
const filtered = (cond: Cond): RoomRow[] =>
  allRows().filter((r) => (r as unknown as Record<string, unknown>)[cond.field] === cond.value);

const fakeDb = {
  select: () => ({
    from: () => ({
      orderBy: () => allRows(),
      where: (cond: Cond) => ({ orderBy: () => filtered(cond) }),
    }),
  }),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __field: string }, value: string) => ({ field: col.__field, value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  roomsTable: {
    __table: "rooms",
    id: { __col: "id" },
    propertyId: { __field: "propertyId" },
  },
  bedsTable: { __table: "beds" },
}));

const roomsRouter = (await import("./rooms")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", roomsRouter);
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
  store.set("rm1", { id: "rm1", propertyId: "p-1", buildingId: "", name: "Room 1", sqft: 0, bathrooms: 0, monthlyRent: 0 });
  store.set("rm2", { id: "rm2", propertyId: "p-1", buildingId: "", name: "Room 2", sqft: 0, bathrooms: 0, monthlyRent: 0 });
  store.set("rm3", { id: "rm3", propertyId: "p-2", buildingId: "", name: "Room A", sqft: 0, bathrooms: 0, monthlyRent: 0 });
});

describe("GET /api/rooms — optional propertyId filter (perf Step 2)", () => {
  it("returns every room when no propertyId is supplied", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/rooms`)).json()) as RoomRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["rm1", "rm2", "rm3"]);
  });

  it("returns only the rooms for the given propertyId", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/rooms?propertyId=p-2`)).json()) as RoomRow[];
    expect(rows.map((r) => r.id)).toEqual(["rm3"]);
  });

  it("400s on a malformed (array) propertyId", async () => {
    const res = await fetch(`${baseUrl}/api/rooms?propertyId=a&propertyId=b`);
    expect(res.status).toBe(400);
  });
});
