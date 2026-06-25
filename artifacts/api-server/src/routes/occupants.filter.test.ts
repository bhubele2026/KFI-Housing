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

// Perf-pass Step 2: optional `?propertyId=` filter on GET /api/occupants.

interface OccRow {
  id: string;
  propertyId: string | null;
  [k: string]: unknown;
}
interface Cond {
  field: string;
  value: string;
}

const store = new Map<string, OccRow>();
const allRows = (): OccRow[] => Array.from(store.values());
const filtered = (cond: Cond): OccRow[] =>
  allRows().filter((r) => (r as Record<string, unknown>)[cond.field] === cond.value);

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
  and: (...c: unknown[]) => ({ and: c }),
  ne: (col: unknown, value: unknown) => ({ ne: [col, value] }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    propertyId: { __field: "propertyId" },
  },
  bedsTable: { __table: "beds", roomId: { __col: "roomId" } },
}));

// Isolate the GET filter from the payroll-deduction batch query.
vi.mock("../lib/occupant-deduction", () => ({
  getOccupantDeductionsBatch: async () => new Map(),
  deductionFromOccupant: () => ({}),
}));

const occupantsRouter = (await import("./occupants")).default;

function makeOccupant(id: string, propertyId: string): OccRow {
  return {
    id,
    name: "Test",
    email: "",
    phone: "",
    bedId: null,
    propertyId,
    moveInDate: "2024-01-01",
    moveOutDate: null,
    status: "Active",
    chargePerBed: 0,
    billingFrequency: "Monthly",
    employeeId: "",
    company: "",
    chargeSource: "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: "",
    shift: null,
    createdAt: new Date("2026-01-15T12:00:00Z"),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", occupantsRouter);
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
  store.set("o1", makeOccupant("o1", "p-1"));
  store.set("o2", makeOccupant("o2", "p-1"));
  store.set("o3", makeOccupant("o3", "p-2"));
});

describe("GET /api/occupants — optional propertyId filter (perf Step 2)", () => {
  it("returns every occupant when no propertyId is supplied", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/occupants`)).json()) as OccRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("returns only the occupants for the given propertyId", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/occupants?propertyId=p-1`)).json()) as OccRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["o1", "o2"]);
  });

  it("400s on a malformed (array) propertyId", async () => {
    const res = await fetch(`${baseUrl}/api/occupants?propertyId=a&propertyId=b`);
    expect(res.status).toBe(400);
  });
});
