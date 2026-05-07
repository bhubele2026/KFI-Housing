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

  it("returns the seeder's `unmatched` and `lowConfidenceMatches` arrays verbatim", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 4,
      matched: 2,
      updated: 0,
      alreadyCorrect: 2,
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
              company: "Bell Timber, Inc.",
              propertyName: "Maple Court",
              score: 0.85,
              crossEmployer: false,
            },
          ],
        },
      ],
      lowConfidenceMatches: [
        {
          customer: "Burnett Dairy - Grantsburg",
          name: "JOSE GARCIA",
          personId: "2002150",
          weekly: 125,
          matched: {
            occupantId: "occ-jg-a",
            name: "Jose Garcia",
            company: "Burnett Dairy - Grantsburg",
            propertyName: "Hilltop",
            score: 1,
            crossEmployer: false,
          },
          suggestions: [
            {
              occupantId: "occ-jg-b",
              name: "Jose Garcia",
              company: "Burnett Dairy - Grantsburg",
              propertyName: "Lakeside",
              score: 1,
              crossEmployer: false,
            },
          ],
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      unmatched: [
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
              company: "Bell Timber, Inc.",
              propertyName: "Maple Court",
              score: 0.85,
              crossEmployer: false,
            },
          ],
        },
      ],
      lowConfidenceMatches: [
        {
          customer: "Burnett Dairy - Grantsburg",
          name: "JOSE GARCIA",
          personId: "2002150",
          weekly: 125,
          matched: {
            occupantId: "occ-jg-a",
            name: "Jose Garcia",
            company: "Burnett Dairy - Grantsburg",
            propertyName: "Hilltop",
            score: 1,
            crossEmployer: false,
          },
          suggestions: [
            {
              occupantId: "occ-jg-b",
              name: "Jose Garcia",
              company: "Burnett Dairy - Grantsburg",
              propertyName: "Lakeside",
              score: 1,
              crossEmployer: false,
            },
          ],
        },
      ],
    });
    // Re-running the seeder on every request is the contract — the
    // dashboard relies on this so a freshly assigned occupant disappears
    // from the list on the next refetch.
    expect(seedMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to seeding with reclaimOverridden=false (safe — skips manual overrides)", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 0,
      matched: 0,
      updated: 0,
      alreadyCorrect: 0,
      unmatched: [],
      lowConfidenceMatches: [],
    });
    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(seedMock.mock.calls[0]![0]).toMatchObject({ reclaimOverridden: false });
  });

  it("passes reclaimOverridden=true when ?reclaimOverridden=true is set (Task #330)", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 0,
      matched: 0,
      updated: 0,
      alreadyCorrect: 0,
      unmatched: [],
      lowConfidenceMatches: [],
    });
    const res = await fetch(`${baseUrl}/api/payroll/unplaced?reclaimOverridden=true`);
    expect(res.status).toBe(200);
    expect(seedMock.mock.calls[0]![0]).toMatchObject({ reclaimOverridden: true });
  });

  it("ignores any value other than the literal 'true' for reclaimOverridden", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 0,
      matched: 0,
      updated: 0,
      alreadyCorrect: 0,
      unmatched: [],
      lowConfidenceMatches: [],
    });
    const res = await fetch(`${baseUrl}/api/payroll/unplaced?reclaimOverridden=1`);
    expect(res.status).toBe(200);
    expect(seedMock.mock.calls[0]![0]).toMatchObject({ reclaimOverridden: false });
  });

  it("returns empty arrays when every payroll row matches an occupant cleanly", async () => {
    seedMock.mockResolvedValueOnce({
      totalRows: 5,
      matched: 5,
      updated: 0,
      alreadyCorrect: 5,
      unmatched: [],
      lowConfidenceMatches: [],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unmatched: [], lowConfidenceMatches: [] });
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
      lowConfidenceMatches: [],
    });

    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(500);
  });
});
