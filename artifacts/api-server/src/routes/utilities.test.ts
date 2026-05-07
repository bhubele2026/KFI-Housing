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

interface UtilityRow {
  id: string;
  propertyId: string;
  type: string;
  company: string;
  monthlyCost: number;
  accountNumber: string;
  notes: string;
}

const store = new Map<string, UtilityRow>();

const fakeDb = {
  select: () => ({
    from: () => ({
      orderBy: () => Array.from(store.values()),
    }),
  }),
  insert: () => ({
    values: (vals: UtilityRow) => ({
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
  utilitiesTable: { __table: "utilities", id: { __col: "id" } },
}));

const utilitiesRouter = (await import("./utilities")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", utilitiesRouter);
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

describe("GET /api/utilities (boundary normalize on read — Task #416)", () => {
  // A legacy utility row with an off-list `type` (e.g. a free-form
  // "Sewer" label from an earlier schema) used to 500 the entire
  // list endpoint via the response schema's enum check. With the
  // normalizer wired into the GET path the off-list label is coerced
  // to "Other" so the rest of the array still round-trips through
  // `ListUtilitiesResponse.parse`.
  it("coerces an off-list type on a legacy row to 'Other'", async () => {
    store.set("u-clean", {
      id: "u-clean",
      propertyId: "p-1",
      type: "Electric",
      company: "Acme Power",
      monthlyCost: 120,
      accountNumber: "AP-001",
      notes: "",
    });
    store.set("u-legacy", {
      id: "u-legacy",
      propertyId: "p-1",
      type: "Sewer",
      company: "Town Sewer",
      monthlyCost: 35,
      accountNumber: "TS-001",
      notes: "Pre-enum legacy row",
    });

    const res = await fetch(`${baseUrl}/api/utilities`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as UtilityRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(["u-clean", "u-legacy"]);
    const legacy = rows.find((r) => r.id === "u-legacy")!;
    expect(legacy.type).toBe("Other");
    const clean = rows.find((r) => r.id === "u-clean")!;
    expect(clean.type).toBe("Electric");
  });
});
