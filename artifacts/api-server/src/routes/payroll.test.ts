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

// GET /payroll/unplaced is now READ-ONLY. The bundled-payroll auto-seeder was
// removed — operators import an Excel deductions file from the Occupants page,
// and `unmatched` / `lowConfidenceMatches` are computed per-import inside
// POST /api/payroll/import-deductions. The GET endpoint is preserved for
// existing callers and degrades to empty arrays. We keep a spy on the old
// seeder so we can assert it is NEVER invoked on GET anymore.
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

  it("is read-only: returns 200 with empty unmatched + lowConfidenceMatches", async () => {
    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unmatched: [], lowConfidenceMatches: [] });
  });

  it("does NOT run the deductions seeder on GET (matching moved to import-deductions)", async () => {
    await fetch(`${baseUrl}/api/payroll/unplaced`);
    expect(seedMock).not.toHaveBeenCalled();
  });

  it("ignores query params (e.g. ?reclaimOverridden) and still returns the empty shape", async () => {
    const res = await fetch(
      `${baseUrl}/api/payroll/unplaced?reclaimOverridden=true`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unmatched: [], lowConfidenceMatches: [] });
    expect(seedMock).not.toHaveBeenCalled();
  });

  it("always returns a response that conforms to the ListUnplacedPayroll shape", async () => {
    const res = await fetch(`${baseUrl}/api/payroll/unplaced`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "lowConfidenceMatches",
      "unmatched",
    ]);
    expect(Array.isArray(body.unmatched)).toBe(true);
    expect(Array.isArray(body.lowConfidenceMatches)).toBe(true);
  });
});
