import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

const wipeAllOnly = vi.fn(async () => {});
const resetToSampleData = vi.fn(async () => {});
vi.mock("../lib/seed", () => ({
  wipeAllOnly: () => wipeAllOnly(),
  resetToSampleData: () => resetToSampleData(),
}));

const resetRouter = (await import("./reset")).default;

describe("reset routes (Task #486 + #640 production gate)", () => {
  let server: http.Server;
  let baseUrl: string;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalToken = process.env.RESET_CONFIRM_TOKEN;

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
    process.env.NODE_ENV = "development";
    delete process.env.RESET_CONFIRM_TOKEN;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalToken === undefined) {
      delete process.env.RESET_CONFIRM_TOKEN;
    } else {
      process.env.RESET_CONFIRM_TOKEN = originalToken;
    }
  });

  it("POST /api/reset/wipe runs wipeAllOnly exactly once and does NOT reseed", async () => {
    const res = await fetch(`${baseUrl}/api/reset/wipe`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(wipeAllOnly).toHaveBeenCalledTimes(1);
    expect(resetToSampleData).not.toHaveBeenCalled();
  });

  it("POST /api/reset still runs resetToSampleData (legacy wipe+reseed) and does NOT call wipeAllOnly", async () => {
    const res = await fetch(`${baseUrl}/api/reset`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(resetToSampleData).toHaveBeenCalledTimes(1);
    expect(wipeAllOnly).not.toHaveBeenCalled();
  });

  it("POST /api/reset/wipe surfaces a 500 when the underlying wipe transaction throws", async () => {
    wipeAllOnly.mockRejectedValueOnce(new Error("boom"));

    const res = await fetch(`${baseUrl}/api/reset/wipe`, { method: "POST" });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(wipeAllOnly).toHaveBeenCalledTimes(1);
  });

  describe("production gate (Task #640)", () => {
    it("POST /api/reset is blocked with 403 in production when the token header is missing", async () => {
      process.env.NODE_ENV = "production";
      process.env.RESET_CONFIRM_TOKEN = "shh-secret";

      const res = await fetch(`${baseUrl}/api/reset`, { method: "POST" });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/x-reset-confirm/i);
      expect(resetToSampleData).not.toHaveBeenCalled();
      expect(wipeAllOnly).not.toHaveBeenCalled();
    });

    it("POST /api/reset/wipe is blocked with 403 in production when the token header is wrong", async () => {
      process.env.NODE_ENV = "production";
      process.env.RESET_CONFIRM_TOKEN = "shh-secret";

      const res = await fetch(`${baseUrl}/api/reset/wipe`, {
        method: "POST",
        headers: { "x-reset-confirm": "wrong-token" },
      });

      expect(res.status).toBe(403);
      expect(wipeAllOnly).not.toHaveBeenCalled();
    });

    it("POST /api/reset/wipe is blocked with 403 in production when RESET_CONFIRM_TOKEN is not configured", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.RESET_CONFIRM_TOKEN;

      const res = await fetch(`${baseUrl}/api/reset/wipe`, {
        method: "POST",
        headers: { "x-reset-confirm": "anything" },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/RESET_CONFIRM_TOKEN/i);
      expect(wipeAllOnly).not.toHaveBeenCalled();
    });

    it("POST /api/reset/wipe is allowed in production with the matching token header", async () => {
      process.env.NODE_ENV = "production";
      process.env.RESET_CONFIRM_TOKEN = "shh-secret";

      const res = await fetch(`${baseUrl}/api/reset/wipe`, {
        method: "POST",
        headers: { "x-reset-confirm": "shh-secret" },
      });

      expect(res.status).toBe(200);
      expect(wipeAllOnly).toHaveBeenCalledTimes(1);
    });

    it("POST /api/reset is allowed in development without any header", async () => {
      process.env.NODE_ENV = "development";

      const res = await fetch(`${baseUrl}/api/reset`, { method: "POST" });

      expect(res.status).toBe(200);
      expect(resetToSampleData).toHaveBeenCalledTimes(1);
    });
  });
});
