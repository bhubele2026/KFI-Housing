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

interface RoomRow {
  id: string;
  propertyId: string;
  name: string;
  sqft: number;
  bathrooms: number;
  monthlyRent: number;
}

const store = new Map<string, RoomRow>();

function makeFakeDb() {
  return {
    select: () => ({
      from: (_t: unknown) => ({
        orderBy: () => Array.from(store.values()),
        where: () => ({
          limit: () => [],
        }),
        limit: () => [],
      }),
    }),
    insert: (_t: unknown) => ({
      values: (vals: Partial<RoomRow>) => ({
        returning: () => {
          const row = { ...vals } as RoomRow;
          store.set(row.id, row);
          return [row];
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (vals: Partial<RoomRow>) => ({
        where: (_predicate: unknown) => ({
          returning: () => {
            return [];
          },
        }),
      }),
    }),
    delete: (_t: unknown) => ({
      where: (_predicate: unknown) => {},
    }),
  };
}

const fakeDb = makeFakeDb();

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  roomsTable: { __table: "rooms" },
  bedsTable: { __table: "beds" },
}));

const roomsRouter = (await import("./rooms")).default;

function makeRoom(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: "r-1",
    propertyId: "p-1",
    name: "Room A",
    sqft: 200,
    bathrooms: 1,
    monthlyRent: 800,
    ...overrides,
  };
}

describe("GET /rooms — per-row safeParse pass-through (task #376)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api", roomsRouter);
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

  it("returns 200 with both valid and malformed rows (null monthlyRent passed through)", async () => {
    store.set(
      "r-bad",
      makeRoom({
        id: "r-bad",
        monthlyRent: null as unknown as number,
      }),
    );
    store.set("r-clean", makeRoom({ id: "r-clean" }));

    const res = await fetch(`${baseUrl}/api/rooms`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as RoomRow[];
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["r-bad", "r-clean"]);
    const bad = rows.find((r) => r.id === "r-bad")!;
    expect(bad.monthlyRent).toBeNull();
  });

  it("returns 200 with all valid rows when no rows are malformed", async () => {
    store.set("r-1", makeRoom({ id: "r-1" }));
    store.set("r-2", makeRoom({ id: "r-2", name: "Room B" }));

    const res = await fetch(`${baseUrl}/api/rooms`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as RoomRow[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.monthlyRent === 800)).toBe(true);
  });

  // Task #416 — the GET handler now pipes each row through
  // `normalizeRoomRow` before the per-row safeParse so the route
  // stays symmetric with the other resources (occupants/beds/utilities)
  // whose normalizers actively coerce off-list enum values. The room
  // normalizer is a pass-through today (no enum/date columns), so the
  // observable behaviour for a clean row is unchanged — this test
  // pins that contract: a row that was already canonical round-trips
  // unchanged through the GET response.
  it("round-trips a canonical row through normalizeRoomRow on GET (Task #416)", async () => {
    store.set("r-1", makeRoom({ id: "r-1", name: "Room A" }));
    const res = await fetch(`${baseUrl}/api/rooms`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as RoomRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(makeRoom({ id: "r-1", name: "Room A" }));
  });
});
