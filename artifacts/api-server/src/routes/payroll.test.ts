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

// The route imports `@workspace/db` transitively via
// `seed-housing-deductions`, which throws at import time when DATABASE_URL
// is unset. Mock the seeder itself so the route test can focus on the
// HTTP contract (shape + zod validation) without a Postgres dependency.
const seedMock = vi.fn();

vi.mock("../lib/seed-housing-deductions", () => ({
  seedHousingDeductions: (...args: unknown[]) => seedMock(...args),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  occupantsTable: { __table: "occupants" },
}));

const payrollRouter = (await import("./payroll")).default;

describe("GET /payroll/unplaced", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api", payrollRouter);
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
    seedMock.mockReset();
  });

  it("returns the seeder's `unmatched` array verbatim, including weekly amount", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 3,
      matched: 1,
      updated: 0,
      alreadyCorrect: 1,
      unmatched: [
        {
          customer: "Adient",
          name: "ANDREW GRANVILLE",
          personId: "2004810",
          weekly: 25,
          suggestions: [],
        },
        {
          customer: "Bell Timber, Inc.",
          name: "GERARD A DERBY",
          personId: "2004445",
          weekly: 150.5,
          suggestions: [
            {
              occupantId: "occ-1",
              name: "Gerard Derby",
              propertyName: "Maple Court",
              score: 0.85,
            },
          ],
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { customer: "Adient", name: "ANDREW GRANVILLE", personId: "2004810", weekly: 25, suggestions: [] },
      {
        customer: "Bell Timber, Inc.",
        name: "GERARD A DERBY",
        personId: "2004445",
        weekly: 150.5,
        suggestions: [
          {
            occupantId: "occ-1",
            name: "Gerard Derby",
            propertyName: "Maple Court",
            score: 0.85,
          },
        ],
      },
    ]);
    // Re-running the seeder on every request is the contract — the
    // dashboard relies on this so a freshly assigned occupant disappears
    // from the list on the next refetch.
    expect(seedMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when every payroll row matches an occupant", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 5,
      matched: 5,
      updated: 0,
      alreadyCorrect: 5,
      unmatched: [],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("rejects malformed seeder output via zod (extra/missing fields would otherwise leak through)", async () => {
    // Missing required `weekly` field — zod should refuse to encode it
    // and the route should 500 rather than silently ship a bad shape
    // to the dashboard.
    seedMock.mockResolvedValueOnce({
      totalRows: 1,
      matched: 0,
      updated: 0,
      alreadyCorrect: 0,
      unmatched: [
        { customer: "Adient", name: "X", personId: "1" },
      ],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(500);
  });
});
