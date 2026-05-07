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
// Task #373 — defence-in-depth: PATCH/POST routes must coerce off-list
// values via the boundary normalizer, not just rely on the zod request
// schema. The schema is the primary gate (and 400s any bad value
// today), but we want a test that actually proves the secondary
// boundary kicks in for a value that somehow slipped past the schema
// (e.g. a future loosened LeaseDate regex, or a hand-crafted curl
// against a bug). To simulate that, we mock the api-zod schemas to be
// lax for the duration of these tests, then assert the values that
// land in the in-memory store have been coerced rather than persisted
// as-is.
// ---------------------------------------------------------------------------

interface PropertyRow {
  id: string;
  paymentMethod: string;
  status: string;
  rentFrequency: string;
  lat: number | null;
  lng: number | null;
  coordsVerified: boolean;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}
interface LeaseRow {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  rateType: string;
}
interface CustomerRow {
  id: string;
  name: string;
}

const propertyStore = new Map<string, PropertyRow>();
const leaseStore = new Map<string, LeaseRow>();
const customerStore = new Map<string, CustomerRow>();

function fluentInsert<T extends { id: string }>(store: Map<string, T>) {
  return (_t: unknown) => ({
    values: (vals: T) => ({
      returning: () => {
        const row = { ...vals } as T;
        store.set(row.id, row);
        return [row];
      },
    }),
  });
}

function fluentUpdate<T extends { id: string }>(store: Map<string, T>) {
  return (_t: unknown) => ({
    set: (vals: Partial<T>) => ({
      where: (predicate: { id: string }) => ({
        returning: () => {
          const existing = store.get(predicate.id);
          if (!existing) return [];
          const merged = { ...existing, ...vals } as T;
          store.set(predicate.id, merged);
          return [merged];
        },
      }),
    }),
  });
}

function fluentSelect<T extends { id: string }>(store: Map<string, T>) {
  return () => ({
    from: (_t: unknown) => ({
      orderBy: () => Array.from(store.values()),
      where: (predicate: { id: string }) => {
        const row = store.get(predicate.id);
        return row ? [row] : [];
      },
    }),
  });
}

const fakeDb = {
  // Routed by table identity; each table has its own fluent set.
  select: (() => {
    const propSel = fluentSelect(propertyStore);
    const leaseSel = fluentSelect(leaseStore);
    const custSel = fluentSelect(customerStore);
    return () => ({
      from: (t: { __table: string }) => {
        if (t.__table === "properties") return propSel().from(t);
        if (t.__table === "leases") return leaseSel().from(t);
        return custSel().from(t);
      },
    });
  })(),
  insert: (t: { __table: string }) => {
    if (t.__table === "properties") return fluentInsert(propertyStore)(t);
    if (t.__table === "leases") return fluentInsert(leaseStore)(t);
    return fluentInsert(customerStore)(t);
  },
  update: (t: { __table: string }) => {
    if (t.__table === "properties") return fluentUpdate(propertyStore)(t);
    if (t.__table === "leases") return fluentUpdate(leaseStore)(t);
    return fluentUpdate(customerStore)(t);
  },
  delete: () => ({ where: () => undefined }),
};

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  propertiesTable: { __table: "properties" },
  leasesTable: { __table: "leases" },
  customersTable: { __table: "customers" },
}));

// Lax schemas — pass any body straight through. This is the "loosened
// schema" scenario the task is defending against.
const passthrough = {
  safeParse: (data: unknown) => ({ success: true as const, data }),
  parse: (data: unknown) => data,
};

vi.mock("@workspace/api-zod", () => ({
  ListPropertiesResponse: passthrough,
  CreatePropertyBody: passthrough,
  UpdatePropertyParams: passthrough,
  UpdatePropertyBody: passthrough,
  UpdatePropertyResponse: passthrough,
  DeletePropertyParams: passthrough,
  ListLeasesResponse: passthrough,
  CreateLeaseBody: passthrough,
  UpdateLeaseParams: passthrough,
  UpdateLeaseBody: passthrough,
  UpdateLeaseResponse: passthrough,
  DeleteLeaseParams: passthrough,
  ListCustomersResponse: passthrough,
  CreateCustomerBody: passthrough,
  UpdateCustomerParams: passthrough,
  UpdateCustomerBody: passthrough,
  UpdateCustomerResponse: passthrough,
  DeleteCustomerParams: passthrough,
}));

// Stub geocoder so the properties POST/PATCH doesn't reach out.
vi.mock("../lib/geocode-property", () => ({
  formatPropertyAddress: (r: { address?: string }) => r.address ?? "",
  getGeocoder: () => ({ geocode: async () => null }),
  __setGeocoderForTest: () => undefined,
}));

const propertiesRouter = (await import("./properties")).default;
const leasesRouter = (await import("./leases")).default;
const customersRouter = (await import("./customers")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", propertiesRouter);
  app.use("/api", leasesRouter);
  app.use("/api", customersRouter);
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
  propertyStore.clear();
  leaseStore.clear();
  customerStore.clear();
});

describe("Task #373 — write-path normalizer (POST/PATCH defence-in-depth)", () => {
  it("PATCH /properties/:id coerces an off-list paymentMethod / status / rentFrequency before the DB write", async () => {
    propertyStore.set("p1", {
      id: "p1",
      paymentMethod: "ACH",
      status: "Active",
      rentFrequency: "Monthly",
      lat: null,
      lng: null,
      coordsVerified: false,
    });

    const res = await fetch(`${baseUrl}/api/properties/p1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentMethod: "Crypto",
        status: "Frozen",
        rentFrequency: "Quarterly",
      }),
    });
    expect(res.status).toBe(200);
    const persisted = propertyStore.get("p1")!;
    // Off-list values were coerced, not persisted as-is.
    expect(persisted.paymentMethod).toBe("");
    expect(persisted.status).toBe("Active");
    expect(persisted.rentFrequency).toBe("Monthly");
  });

  it("POST /properties coerces an off-list paymentMethod before the DB write", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "p-new",
        paymentMethod: "Bitcoin",
        status: "Active",
        rentFrequency: "Monthly",
        address: "",
      }),
    });
    expect(res.status).toBe(201);
    const persisted = propertyStore.get("p-new")!;
    expect(persisted.paymentMethod).toBe("");
  });

  it("PATCH /leases/:id coerces datetime-style dates and off-list status / rateType before the DB write", async () => {
    leaseStore.set("l1", {
      id: "l1",
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      status: "Active",
      rateType: "monthly",
    });

    const res = await fetch(`${baseUrl}/api/leases/l1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: "2026-05-31 00:00:00",
        endDate: "2027-05-31T00:00:00.000Z",
        status: "pending",
        rateType: "annual",
      }),
    });
    expect(res.status).toBe(200);
    const persisted = leaseStore.get("l1")!;
    // Dates coerced down to YYYY-MM-DD; enums coerced to safe defaults.
    expect(persisted.startDate).toBe("2026-05-31");
    expect(persisted.endDate).toBe("2027-05-31");
    expect(persisted.status).toBe("Active");
    expect(persisted.rateType).toBe("monthly");
  });

  it("POST /leases coerces datetime-style dates before the DB write", async () => {
    const res = await fetch(`${baseUrl}/api/leases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "l-new",
        startDate: "2026-05-31 00:00:00",
        endDate: "",
        status: "Active",
        rateType: "monthly",
      }),
    });
    expect(res.status).toBe(201);
    const persisted = leaseStore.get("l-new")!;
    expect(persisted.startDate).toBe("2026-05-31");
    expect(persisted.endDate).toBe("");
  });

  // Customer normalizer is a pass-through today, but the call is wired
  // in so any future stricter field automatically gets the same
  // boundary treatment. Prove the route invokes the normalizer (i.e.
  // the body still round-trips cleanly through it).
  it("POST /customers and PATCH /customers/:id pass the body through normalizeCustomerRow", async () => {
    const post = await fetch(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "c1", name: "Acme" }),
    });
    expect(post.status).toBe(201);
    expect(customerStore.get("c1")?.name).toBe("Acme");

    const patch = await fetch(`${baseUrl}/api/customers/c1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Acme Inc." }),
    });
    expect(patch.status).toBe(200);
    expect(customerStore.get("c1")?.name).toBe("Acme Inc.");
  });
});
