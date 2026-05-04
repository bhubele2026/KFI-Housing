import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// The route only depends on `process.env.GOOGLE_MAPS_API_KEY` /
// `GOOGLE_MAPS_MAP_ID` and the shared zod response schema — it doesn't
// touch the DB or any integrations — so we can import it directly
// without the heavyweight mocks the other route tests need.
import configRouter from "./config";

describe("GET /api/config", () => {
  let server: http.Server;
  let baseUrl: string;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalMapId = process.env.GOOGLE_MAPS_MAP_ID;

  beforeAll(async () => {
    const app: Express = express();
    app.use("/api", configRouter);
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
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_MAP_ID;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
    if (originalMapId === undefined) {
      delete process.env.GOOGLE_MAPS_MAP_ID;
    } else {
      process.env.GOOGLE_MAPS_MAP_ID = originalMapId;
    }
  });

  type ConfigBody = {
    googleMapsApiKey: string | null;
    googleMapsMapId: string | null;
  };

  it("returns the current GOOGLE_MAPS_API_KEY when one is configured", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "live-key-123";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: "live-key-123",
      googleMapsMapId: null,
    });
  });

  it("returns the current GOOGLE_MAPS_MAP_ID when one is configured", async () => {
    process.env.GOOGLE_MAPS_MAP_ID = "branded-map-id-xyz";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: null,
      googleMapsMapId: "branded-map-id-xyz",
    });
  });

  it("returns both fields together when both env vars are set", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "live-key-123";
    process.env.GOOGLE_MAPS_MAP_ID = "branded-map-id-xyz";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: "live-key-123",
      googleMapsMapId: "branded-map-id-xyz",
    });
  });

  it("returns both fields as null when neither env var is set", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: null,
      googleMapsMapId: null,
    });
  });

  it("treats an empty / whitespace-only API key as unset (avoids handing a useless '' to the embed)", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "   ";

    const res = await fetch(`${baseUrl}/api/config`);
    const body = (await res.json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBeNull();
  });

  it("treats an empty / whitespace-only Map ID as unset (so the portfolio map can fall back to DEMO_MAP_ID)", async () => {
    process.env.GOOGLE_MAPS_MAP_ID = "   ";

    const res = await fetch(`${baseUrl}/api/config`);
    const body = (await res.json()) as ConfigBody;
    expect(body.googleMapsMapId).toBeNull();
  });

  it("reflects a rotated key on the very next request — no process restart required", async () => {
    // The whole point of moving the key behind /api/config is to let
    // operators rotate it without bouncing the api-server twice (one
    // restart to pick up the new env var, another for the web app).
    // Overwriting the env var here simulates that rotation.
    process.env.GOOGLE_MAPS_API_KEY = "old-key";
    let body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBe("old-key");

    process.env.GOOGLE_MAPS_API_KEY = "new-rotated-key";
    body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBe("new-rotated-key");
  });

  it("reflects a rotated Map ID on the very next request — no process restart required", async () => {
    // Mirrors the API-key rotation test for the Map ID. Operators use
    // this when swapping in a new branded style without rebuilding the
    // web bundle.
    process.env.GOOGLE_MAPS_MAP_ID = "old-map-id";
    let body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
    expect(body.googleMapsMapId).toBe("old-map-id");

    process.env.GOOGLE_MAPS_MAP_ID = "new-rotated-map-id";
    body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
    expect(body.googleMapsMapId).toBe("new-rotated-map-id");
  });

  it("does not expose any other environment variable through the response shape", async () => {
    // Belt-and-suspenders against a future copy-paste that adds a
    // sibling secret to the route. The zod response schema also
    // enforces this, but a focused assertion makes the intent obvious
    // when someone reads the test file.
    process.env.GOOGLE_MAPS_API_KEY = "live-key-xyz";
    process.env.GOOGLE_MAPS_MAP_ID = "live-map-id";
    process.env.SOME_OTHER_SECRET = "must-not-leak";

    try {
      const res = await fetch(`${baseUrl}/api/config`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        "googleMapsApiKey",
        "googleMapsMapId",
      ]);
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
    } finally {
      delete process.env.SOME_OTHER_SECRET;
    }
  });
});
