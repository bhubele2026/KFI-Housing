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

// Mock the DB so the route can run without Postgres. Only the call
// chains the route actually uses (`insert(...).values(...).returning()`)
// need to be modeled — the validation guard for moveInDate runs before
// any DB call when the body is empty/malformed, so the rest is no-op.
const insertedRows: unknown[] = [];

const fakeDb = {
  select: () => ({
    from: () => ({ orderBy: () => [] }),
  }),
  insert: () => ({
    values: (vals: Record<string, unknown>) => ({
      returning: () => {
        insertedRows.push(vals);
        return [vals];
      },
    }),
  }),
  update: () => ({
    set: () => ({ where: () => ({ returning: () => [] }) }),
  }),
  delete: () => ({ where: () => undefined }),
};

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: { __table: "occupants", id: { __col: "id" } },
  bedsTable: { __table: "beds", occupantId: { __col: "occupantId" } },
}));

const occupantsRouter = (await import("./occupants")).default;

function validBody() {
  return {
    id: "o-new",
    name: "Pat Doe",
    email: "pat@example.com",
    phone: "555-0001",
    bedId: null,
    propertyId: "p1",
    moveInDate: "2024-05-01",
    moveOutDate: null,
    status: "Active",
    chargePerBed: 800,
    billingFrequency: "Monthly",
    employeeId: "e-1",
    company: "Acme",
    shift: null,
  };
}

describe("POST /api/occupants — moveInDate is required at creation (Task #259)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api", occupantsRouter);
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
    insertedRows.length = 0;
  });

  it("returns 201 for a body with a clean YYYY-MM-DD moveInDate", async () => {
    const res = await fetch(`${baseUrl}/api/occupants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
  });

  it("rejects with 400 when moveInDate is an empty string", async () => {
    const res = await fetch(`${baseUrl}/api/occupants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody(), moveInDate: "" }),
    });
    expect(res.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/moveInDate/i);
  });
});
