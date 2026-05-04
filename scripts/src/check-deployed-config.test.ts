import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";

import {
  checkDeployedConfig,
  resolveBaseUrl,
  runCli,
} from "./check-deployed-config";

// Spin up a tiny throwaway HTTP server that mimics the api-server's
// /api/config response. Each test sets `respondWith` to control the
// status / body for that test. This deliberately avoids importing the
// real api-server so a regression in the smoke check is impossible to
// hide behind a route-side fix.
type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let respondWith: RouteHandler = (_req, res) => {
  res.statusCode = 500;
  res.end("test did not configure respondWith");
};

beforeAll(async () => {
  server = http.createServer((req, res) => respondWith(req, res));
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

afterEach(() => {
  respondWith = (_req, res) => {
    res.statusCode = 500;
    res.end("test did not configure respondWith");
  };
});

function jsonResponse(status: number, body: unknown): RouteHandler {
  return (_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
}

describe("checkDeployedConfig", () => {
  it("succeeds when the deployed /api/config returns a non-empty googleMapsApiKey", async () => {
    let receivedPath: string | undefined;
    respondWith = (req, res) => {
      receivedPath = req.url;
      jsonResponse(200, {
        googleMapsApiKey: "live-key-xyz",
        googleMapsMapId: "branded-map-id",
      })(req, res);
    };

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(true);
    expect(receivedPath).toBe("/api/config");
    if (result.ok) {
      expect(result.url).toBe(`${baseUrl}/api/config`);
    }
  });

  it("trims a trailing slash on the supplied base URL so the request hits /api/config exactly once", async () => {
    let receivedPath: string | undefined;
    respondWith = (req, res) => {
      receivedPath = req.url;
      jsonResponse(200, { googleMapsApiKey: "k", googleMapsMapId: null })(
        req,
        res,
      );
    };

    const result = await checkDeployedConfig({ baseUrl: `${baseUrl}/` });

    expect(result.ok).toBe(true);
    expect(receivedPath).toBe("/api/config");
  });

  it("fails with a message naming BOTH env vars when googleMapsApiKey is null", async () => {
    respondWith = jsonResponse(200, {
      googleMapsApiKey: null,
      googleMapsMapId: null,
    });

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Both env var names must appear so an operator reading the CI
      // failure knows exactly which two secrets to check.
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
      // And the message should make clear what the live process
      // returned, so the operator doesn't have to re-curl it.
      expect(result.message).toContain("googleMapsApiKey=null");
    }
  });

  it("fails with the same env-var-naming message when googleMapsApiKey is an empty string", async () => {
    respondWith = jsonResponse(200, {
      googleMapsApiKey: "",
      googleMapsMapId: null,
    });

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("fails when googleMapsApiKey is whitespace-only (mirrors the route's trim semantics)", async () => {
    respondWith = jsonResponse(200, {
      googleMapsApiKey: "   ",
      googleMapsMapId: null,
    });

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("fails when the response is missing the googleMapsApiKey field entirely", async () => {
    respondWith = jsonResponse(200, { googleMapsMapId: null });

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("missing the googleMapsApiKey field");
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("fails when the deployed endpoint returns a non-2xx status", async () => {
    respondWith = (_req, res) => {
      res.statusCode = 503;
      res.statusMessage = "Service Unavailable";
      res.end("");
    };

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("HTTP 503");
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("fails (and does not throw) when the deploy URL is unreachable", async () => {
    // Port 1 is reserved and almost certainly closed, so connect()
    // will be refused immediately on every CI runner.
    const result = await checkDeployedConfig({
      baseUrl: "http://127.0.0.1:1",
      timeoutMs: 1_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Could not reach");
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("does not require googleMapsMapId to be set — the smoke check is scoped to the API key only", async () => {
    // The map ID has its own sane fallback (DEMO_MAP_ID) so this
    // smoke check intentionally does NOT fail when it's null. A
    // future map-ID smoke check belongs in its own task.
    respondWith = jsonResponse(200, {
      googleMapsApiKey: "live-key",
      googleMapsMapId: null,
    });

    const result = await checkDeployedConfig({ baseUrl });

    expect(result.ok).toBe(true);
  });
});

describe("resolveBaseUrl", () => {
  it("prefers the first positional CLI arg over DEPLOY_URL", () => {
    expect(
      resolveBaseUrl(["https://from-arg.example"], {
        DEPLOY_URL: "https://from-env.example",
      }),
    ).toBe("https://from-arg.example");
  });

  it("falls back to DEPLOY_URL when no positional arg is provided", () => {
    expect(
      resolveBaseUrl([], { DEPLOY_URL: "https://from-env.example" }),
    ).toBe("https://from-env.example");
  });

  it("ignores flag-style args when scanning for the URL", () => {
    expect(
      resolveBaseUrl(
        ["--verbose", "https://from-arg.example"],
        { DEPLOY_URL: "https://from-env.example" },
      ),
    ).toBe("https://from-arg.example");
  });

  it("returns null when neither arg nor env var is set", () => {
    expect(resolveBaseUrl([], {})).toBeNull();
  });

  it("treats a whitespace-only DEPLOY_URL as unset", () => {
    expect(resolveBaseUrl([], { DEPLOY_URL: "   " })).toBeNull();
  });
});

describe("runCli", () => {
  it("returns exit code 1 and writes a hint to stderr when no URL is provided", async () => {
    const stderr: string[] = [];
    const code = await runCli({
      argv: [],
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("missing deploy URL");
    expect(stderr.join("\n")).toContain("DEPLOY_URL");
  });

  it("returns exit code 0 and writes an OK line to stdout on success", async () => {
    respondWith = jsonResponse(200, {
      googleMapsApiKey: "k",
      googleMapsMapId: null,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli({
      argv: [baseUrl],
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("OK");
  });

  it("returns exit code 1 and writes the failure (with both env var names) to stderr on a missing key", async () => {
    respondWith = jsonResponse(200, {
      googleMapsApiKey: null,
      googleMapsMapId: null,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli({
      argv: [],
      env: { DEPLOY_URL: baseUrl },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    const combined = stderr.join("\n");
    expect(combined).toContain("GOOGLE_MAPS_API_KEY");
    expect(combined).toContain("VITE_GOOGLE_MAPS_API_KEY");
  });
});
