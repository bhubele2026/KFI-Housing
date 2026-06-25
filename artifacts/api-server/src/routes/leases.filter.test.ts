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

// Perf-pass Step 2: optional `?propertyId=` / `?customerId=` filters on
// GET /api/leases. The route always wraps supplied conds in and(...), so the
// fake `where` only needs to understand the combined shape.

interface LeaseRow {
  id: string;
  propertyId: string;
  customerId: string | null;
  [k: string]: unknown;
}
interface FieldCond {
  field: string;
  value: string;
}
interface AndCond {
  conds: FieldCond[];
}

const store = new Map<string, LeaseRow>();
const allRows = (): LeaseRow[] => Array.from(store.values());
const matches = (row: LeaseRow, c: FieldCond) =>
  (row as Record<string, unknown>)[c.field] === c.value;
const filtered = (cond: AndCond): LeaseRow[] =>
  allRows().filter((r) => cond.conds.every((c) => matches(r, c)));

const fakeDb = {
  select: () => ({
    from: () => ({
      orderBy: () => allRows(),
      where: (cond: AndCond) => ({ orderBy: () => filtered(cond) }),
    }),
  }),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __field: string }, value: string): FieldCond => ({ field: col.__field, value }),
  and: (...conds: FieldCond[]): AndCond => ({ conds }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __field: "propertyId" },
    customerId: { __field: "customerId" },
  },
  propertiesTable: { __table: "properties" },
  roomsTable: { __table: "rooms" },
  bedsTable: { __table: "beds" },
}));

const leasesRouter = (await import("./leases")).default;

function makeLease(id: string, propertyId: string, customerId: string | null): LeaseRow {
  return {
    id,
    propertyId,
    customerId,
    startDate: "2024-01-01",
    endDate: "2025-01-01",
    monthlyRent: 1000,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    weeklyCost: 0,
    vendor: "",
    needsReview: false,
    rateType: "monthly",
    nightlyRate: 0,
    guaranteedRooms: 0,
    monthlyRoomNightMin: 0,
    longStayTaxExempt: false,
    customerResponsibleForRent: false,
    unit: "",
    snoozedUntil: "",
    snoozedAt: "",
    snoozedBy: "",
    noticePeriodDays: null,
    utilitiesIncludedInRent: false,
    buildingId: null,
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", leasesRouter);
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
  store.set("l1", makeLease("l1", "p-1", "c-1"));
  store.set("l2", makeLease("l2", "p-1", "c-2"));
  store.set("l3", makeLease("l3", "p-2", "c-1"));
});

describe("GET /api/leases — optional propertyId/customerId filters (perf Step 2)", () => {
  it("returns every lease when no filter is supplied", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/leases`)).json()) as LeaseRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["l1", "l2", "l3"]);
  });

  it("filters by propertyId", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/leases?propertyId=p-1`)).json()) as LeaseRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["l1", "l2"]);
  });

  it("filters by customerId", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/leases?customerId=c-1`)).json()) as LeaseRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["l1", "l3"]);
  });

  it("ANDs propertyId + customerId together", async () => {
    const rows = (await (await fetch(`${baseUrl}/api/leases?propertyId=p-1&customerId=c-1`)).json()) as LeaseRow[];
    expect(rows.map((r) => r.id)).toEqual(["l1"]);
  });

  it("400s on a malformed (array) propertyId", async () => {
    const res = await fetch(`${baseUrl}/api/leases?propertyId=a&propertyId=b`);
    expect(res.status).toBe(400);
  });
});
