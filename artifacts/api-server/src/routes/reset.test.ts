import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// Stub the seed module so we can drive both reset endpoints without
// touching the real database. The unit-level invariants of
// `wipeAllOnly` / `resetToSampleData` (marker is written on wipe,
// cleared on reseed, all 9 business tables are wiped) live in
// `seed.ts` itself; this test pins down the HTTP contract that an
// operator will actually hit:
//   • POST /api/reset       → resetToSampleData (wipe + reseed),
//                             pre-Task #486 behavior preserved
//   • POST /api/reset/wipe  → wipeAllOnly (wipe + set marker),
//                             new Task #486 entry point — no reseed
const wipeAllOnly = vi.fn(async () => {});
const resetToSampleData = vi.fn(async () => {});
vi.mock("../lib/seed", () => ({
  wipeAllOnly: () => wipeAllOnly(),
  resetToSampleData: () => resetToSampleData(),
}));

// Imported AFTER the mock so the router picks up the stubbed module.
const resetRouter = (await import("./reset")).default;

describe("reset routes (Task #486)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use("/api", resetRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    wipeAllOnly.mockClear();
    resetToSampleData.mockClear();
  });

  it("POST /api/reset/wipe runs wipeAllOnly exactly once and does NOT reseed", async () => {
    // The wipe-only entry point is the whole point of Task #486 —
    // an operator wants to clear out sample / test data and re-import
    // customer by customer without the API silently refilling the DB.
    const res = await fetch(`${baseUrl}/api/reset/wipe`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(wipeAllOnly).toHaveBeenCalledTimes(1);
    expect(resetToSampleData).not.toHaveBeenCalled();
  });

  it("POST /api/reset still runs resetToSampleData (legacy wipe+reseed) and does NOT call wipeAllOnly", async () => {
    // Existing tests, runbooks, and the "Reset sample data" UI button
    // depend on `POST /reset` continuing to wipe AND reseed — Task
    // #486 deliberately preserved this behavior so nothing pre-486
    // breaks.
    const res = await fetch(`${baseUrl}/api/reset`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(resetToSampleData).toHaveBeenCalledTimes(1);
    expect(wipeAllOnly).not.toHaveBeenCalled();
  });

  it("POST /api/reset/wipe surfaces a 500 when the underlying wipe transaction throws (so a botched wipe doesn't silently report success)", async () => {
    // The wipe runs in a single DB transaction — if it fails, the
    // operator must SEE the failure rather than getting `{status:"ok"}`
    // and a database that's still half-populated.
    wipeAllOnly.mockRejectedValueOnce(new Error("boom"));

    const res = await fetch(`${baseUrl}/api/reset/wipe`, { method: "POST" });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(wipeAllOnly).toHaveBeenCalledTimes(1);
  });
});
