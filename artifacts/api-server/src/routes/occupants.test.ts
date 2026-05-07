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

// Stand-in for the existing-row lookup the PATCH route does to decide
// whether a manual edit should flip chargeSource → "manual_override"
// (Task #330). Tests can override this by mutating `existingByPatchId`.
const existingByPatchId = new Map<string, { chargeSource: string }>();

const fakeDb = {
  select: () => ({
    from: () => {
      const builder = {
        orderBy: () => [],
        where: (pred: { id?: string }) => {
          if (pred?.id && existingByPatchId.has(pred.id)) {
            return [existingByPatchId.get(pred.id)!];
          }
          return [];
        },
      };
      return builder;
    },
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
    set: (vals: Record<string, unknown>) => ({
      where: (pred: { id?: string }) => ({
        returning: () => {
          updatedRows.push({ id: pred?.id, ...vals });
          // Pad out the response to a full Occupant shape so the
          // route's UpdateOccupantResponse.parse(row) succeeds. Tests
          // assert against the captured `updatedRows` (the actual SET
          // payload), not the response body shape.
          const fullRow = {
            id: pred?.id ?? "o-mock",
            name: "",
            email: "",
            phone: "",
            bedId: null,
            propertyId: null,
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
            ...vals,
          };
          return [fullRow];
        },
      }),
    }),
  }),
  delete: () => ({ where: () => undefined }),
};

const updatedRows: Array<Record<string, unknown>> = [];

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    chargeSource: { __col: "chargeSource" },
  },
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
    updatedRows.length = 0;
    existingByPatchId.clear();
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

  it("flips chargeSource to manual_override when chargePerBed is patched on a payroll-stamped row, preserving customer + personId (Task #330)", async () => {
    existingByPatchId.set("o1", { chargeSource: "payroll" });
    const res = await fetch(`${baseUrl}/api/occupants/o1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chargePerBed: 200 }),
    });
    expect(res.status).toBe(200);
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({
      id: "o1",
      chargePerBed: 200,
      chargeSource: "manual_override",
    });
    // The customer + personId stamps must NOT be wiped — keep the link.
    expect(updatedRows[0]).not.toHaveProperty("chargeSourceCustomer");
    expect(updatedRows[0]).not.toHaveProperty("chargeSourcePersonId");
  });

  it("does not re-stamp chargeSource when patching a row that's already manual_override", async () => {
    existingByPatchId.set("o1", { chargeSource: "manual_override" });
    const res = await fetch(`${baseUrl}/api/occupants/o1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chargePerBed: 250 }),
    });
    expect(res.status).toBe(200);
    expect(updatedRows[0]).toMatchObject({ id: "o1", chargePerBed: 250 });
    expect(updatedRows[0]).not.toHaveProperty("chargeSource");
  });

  it("leaves chargeSource alone for a patch on a plain manual occupant (no payroll history)", async () => {
    existingByPatchId.set("o1", { chargeSource: "" });
    const res = await fetch(`${baseUrl}/api/occupants/o1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chargePerBed: 100 }),
    });
    expect(res.status).toBe(200);
    expect(updatedRows[0]).toMatchObject({ id: "o1", chargePerBed: 100 });
    expect(updatedRows[0]).not.toHaveProperty("chargeSource");
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
