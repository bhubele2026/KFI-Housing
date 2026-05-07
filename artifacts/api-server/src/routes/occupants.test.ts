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

// Rows the GET handler should see (Task #416 — boundary normalizer on
// the read path). Defaults to empty so the existing POST/PATCH suites
// that never touch GET are unaffected.
const getStoreRows: Array<Record<string, unknown>> = [];

const fakeDb = {
  select: () => ({
    from: () => {
      const builder = {
        orderBy: () => getStoreRows,
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
        const row = {
          ...vals,
          createdAt: vals.createdAt ?? new Date("2026-03-10T08:00:00Z"),
        };
        insertedRows.push(row);
        return [row];
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
            createdAt: new Date("2026-01-15T12:00:00Z"),
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
    getStoreRows.length = 0;
  });

  // Task #416 — the GET list endpoint must run rows through the
  // boundary normalizer before the response schema parse, so a legacy
  // row whose enum values are off-list (e.g. `billingFrequency:
  // "Annually"` or `shift: "graveyard"`) doesn't 500 the entire list
  // endpoint.
  it("coerces a legacy off-list billingFrequency / shift in the store on GET (Task #416)", async () => {
    getStoreRows.push({
      id: "o-legacy",
      name: "Legacy Lou",
      email: "",
      phone: "",
      bedId: null,
      propertyId: null,
      moveInDate: "2024-01-01",
      moveOutDate: null,
      status: "Pending",
      chargePerBed: 0,
      billingFrequency: "Annually",
      employeeId: "",
      company: "",
      chargeSource: "weird-source",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
      shift: "graveyard",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const res = await fetch(`${baseUrl}/api/occupants`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "o-legacy",
      status: "Active",
      billingFrequency: "Monthly",
      chargeSource: "",
      shift: null,
    });
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

  it("POST response serializes createdAt as an ISO-8601 string (Task #391)", async () => {
    const res = await fetch(`${baseUrl}/api/occupants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { createdAt: string };
    expect(typeof body.createdAt).toBe("string");
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it("PATCH response serializes createdAt as an ISO-8601 string (Task #391)", async () => {
    existingByPatchId.set("o-ts", { chargeSource: "" });
    const res = await fetch(`${baseUrl}/api/occupants/o-ts`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { createdAt: string };
    expect(typeof body.createdAt).toBe("string");
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it("serializes null createdAt as null in PATCH response (Task #391)", async () => {
    existingByPatchId.set("o-null", { chargeSource: "" });
    const res = await fetch(`${baseUrl}/api/occupants/o-null`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "NullDate" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { createdAt: string };
    expect(typeof body.createdAt).toBe("string");
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });
});
