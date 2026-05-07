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
  const originalLegacyKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
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
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_MAP_ID;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
    if (originalLegacyKey === undefined) {
      delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.VITE_GOOGLE_MAPS_API_KEY = originalLegacyKey;
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
    noticeLeadDays: number;
    lowOccupancyThresholdPct: number;
  };

  // Task #492 added two integer threshold fields to /api/config. Every
  // existing assertion below cares only about the maps fields, so we
  // expose the defaults the unset env produces and let each test reuse
  // them in `toEqual` without duplicating the literals everywhere.
  const DEFAULT_THRESHOLDS = {
    noticeLeadDays: 30,
    lowOccupancyThresholdPct: 80,
  } as const;

  it("returns the current GOOGLE_MAPS_API_KEY when one is configured", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "live-key-123";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: "live-key-123",
      googleMapsMapId: null,
      ...DEFAULT_THRESHOLDS,
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
      ...DEFAULT_THRESHOLDS,
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
      ...DEFAULT_THRESHOLDS,
    });
  });

  it("returns both fields as null when neither env var is set", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: null,
      googleMapsMapId: null,
      ...DEFAULT_THRESHOLDS,
    });
  });

  // Task #492: the alert thresholds for the dashboard cards and the
  // weekly digest both flow from `/api/config` so the live UI and the
  // emailed digest can never disagree about what counts as "approaching"
  // or "low". The dashboard reads these values, falling back to the
  // same defaults the api-server would use, so an env override on the
  // server lights up identically in both surfaces.
  describe("Task #492 alert thresholds", () => {
    const originalNoticeLeadDays = process.env.NOTICE_LEAD_DAYS;
    const originalLowOccPct = process.env.LOW_OCCUPANCY_THRESHOLD_PCT;
    afterEach(() => {
      if (originalNoticeLeadDays === undefined) {
        delete process.env.NOTICE_LEAD_DAYS;
      } else {
        process.env.NOTICE_LEAD_DAYS = originalNoticeLeadDays;
      }
      if (originalLowOccPct === undefined) {
        delete process.env.LOW_OCCUPANCY_THRESHOLD_PCT;
      } else {
        process.env.LOW_OCCUPANCY_THRESHOLD_PCT = originalLowOccPct;
      }
    });

    it("returns the documented defaults (30 / 80) when neither env override is set", async () => {
      delete process.env.NOTICE_LEAD_DAYS;
      delete process.env.LOW_OCCUPANCY_THRESHOLD_PCT;
      const body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
      expect(body.noticeLeadDays).toBe(30);
      expect(body.lowOccupancyThresholdPct).toBe(80);
    });

    it("reflects NOTICE_LEAD_DAYS / LOW_OCCUPANCY_THRESHOLD_PCT env overrides on the very next request", async () => {
      process.env.NOTICE_LEAD_DAYS = "14";
      process.env.LOW_OCCUPANCY_THRESHOLD_PCT = "65";
      const body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
      expect(body.noticeLeadDays).toBe(14);
      expect(body.lowOccupancyThresholdPct).toBe(65);
    });

    it("falls back to the defaults when the env overrides are garbage (so a typo can't silently disable the alerts)", async () => {
      process.env.NOTICE_LEAD_DAYS = "nope";
      process.env.LOW_OCCUPANCY_THRESHOLD_PCT = "-1";
      const body = (await (await fetch(`${baseUrl}/api/config`)).json()) as ConfigBody;
      expect(body.noticeLeadDays).toBe(30);
      expect(body.lowOccupancyThresholdPct).toBe(80);
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

  it("falls back to VITE_GOOGLE_MAPS_API_KEY when only the legacy env var is set", async () => {
    // The key was migrated env var names twice — first to
    // VITE_GOOGLE_MAPS_API_KEY (Tasks #143/#147) and then to
    // GOOGLE_MAPS_API_KEY (Task #154) — and an operator who set the
    // secret under the legacy name was silently producing a
    // `googleMapsApiKey: null` response with no log line pointing at
    // the cause (Task #187). The fallback below means that historical
    // mistake can't silently kill the embedded map again.
    process.env.VITE_GOOGLE_MAPS_API_KEY = "legacy-vite-key";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body).toEqual({
      googleMapsApiKey: "legacy-vite-key",
      googleMapsMapId: null,
      ...DEFAULT_THRESHOLDS,
    });
  });

  it("prefers the canonical GOOGLE_MAPS_API_KEY when both env vars are set", async () => {
    // The canonical name is what current code, docs, and rotation
    // instructions all reference. If both happen to be set during a
    // partial migration, the canonical name must win so that an
    // operator who follows the documented rotation flow actually sees
    // their new value land — otherwise a stale legacy secret could
    // silently mask the rotation (Task #187).
    process.env.GOOGLE_MAPS_API_KEY = "canonical-key";
    process.env.VITE_GOOGLE_MAPS_API_KEY = "legacy-vite-key";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBe("canonical-key");
  });

  it("falls back to the legacy env var when GOOGLE_MAPS_API_KEY is whitespace-only", async () => {
    // Whitespace is treated as unset by the route's `trim` helper, so
    // a `GOOGLE_MAPS_API_KEY="   "` value (e.g. an operator who
    // accidentally pasted just spaces into the canonical secret) must
    // not block the fallback to a real legacy value. Without this,
    // the embed would render its dashed fallback even though a usable
    // key is configured under the legacy name (Task #187).
    process.env.GOOGLE_MAPS_API_KEY = "   ";
    process.env.VITE_GOOGLE_MAPS_API_KEY = "legacy-vite-key";

    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBe("legacy-vite-key");
  });

  it("returns null when both the canonical and legacy env vars are whitespace-only", async () => {
    // Belt-and-suspenders: whitespace-on-both must still surface as
    // `null` so the frontend renders its "API key isn't configured"
    // fallback rather than handing a useless "" or "   " to the embed
    // URL.
    process.env.GOOGLE_MAPS_API_KEY = "   ";
    process.env.VITE_GOOGLE_MAPS_API_KEY = "  ";

    const res = await fetch(`${baseUrl}/api/config`);
    const body = (await res.json()) as ConfigBody;
    expect(body.googleMapsApiKey).toBeNull();
  });

  // ---------------------------------------------------------------
  // GET /api/config/stream — Server-Sent Events feed.
  //
  // The SSE endpoint exists so a rotated GOOGLE_MAPS_API_KEY /
  // GOOGLE_MAPS_MAP_ID lands in already-open tabs within seconds of
  // the api-server restart instead of waiting up to a full polling
  // interval. The api-server restart drops every open EventSource;
  // the browser auto-reconnects and the very first `config` event of
  // the new connection delivers the rotated value. These tests pin
  // down the contract the client relies on:
  //   • text/event-stream headers + no-cache
  //   • initial `config` event with the current values on connect
  //   • a fresh `config` event when the env vars change between ticks
  //   • heartbeat comments while values are unchanged (so proxies
  //     don't close the idle connection)
  //   • clean shutdown: the per-connection interval is cleared and
  //     the response ends when the client disconnects (no leaked
  //     timers across tests).
  // ---------------------------------------------------------------

  // Helper: connect to the stream and accumulate decoded chunks until
  // the test calls `stop()`. Uses fetch + AbortController so we can
  // cleanly hang up — EventSource isn't available in Node's vitest
  // runner and we don't need its auto-reconnect behavior here, only
  // the wire format the client will read.
  async function openStream(): Promise<{
    chunks: string[];
    waitForEvent: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<string>;
    stop: () => Promise<void>;
  }> {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/config/stream`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    if (!res.body) {
      controller.abort();
      throw new Error("SSE response had no body");
    }
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-cache");
    expect(cacheControl).toContain("no-transform");

    const chunks: string[] = [];
    let buffer = "";
    // Tracked as a tuple so TS doesn't lose the narrowing across the
    // `await reader.read()` boundary (we reassign `resolveNext = null`
    // after invoking it, which otherwise widens the captured local
    // back to `(() => void) | null` before the call).
    const waiters: Array<() => void> = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          chunks.push(text);
          // Drain every waiter once new bytes land so all pending
          // `waitForEvent` calls re-check their predicate.
          while (waiters.length > 0) {
            const r = waiters.shift();
            if (r) r();
          }
        }
      } catch {
        // AbortController hangs up — expected when the test calls stop().
      }
    })();

    return {
      chunks,
      async waitForEvent(predicate, timeoutMs = 2_000) {
        const deadline = Date.now() + timeoutMs;
        while (true) {
          if (predicate(buffer)) return buffer;
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new Error(
              `Timed out waiting for SSE event. Buffer so far:\n${buffer}`,
            );
          }
          await Promise.race([
            new Promise<void>((r) => {
              waiters.push(r);
            }),
            new Promise<void>((r) => setTimeout(r, remaining)),
          ]);
        }
      },
      async stop() {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          // already aborted
        }
        await pump;
      },
    };
  }

  // Pull every `event: config\ndata: …\n\n` block out of the buffer
  // and return their parsed payloads, in order.
  function parseConfigEvents(buffer: string): ConfigBody[] {
    const out: ConfigBody[] = [];
    const re = /event: config\ndata: (.+)\n\n/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(buffer)) !== null) {
      out.push(JSON.parse(match[1]) as ConfigBody);
    }
    return out;
  }

  describe("GET /api/config/stream", () => {
    const originalInterval = process.env.CONFIG_STREAM_INTERVAL_MS;
    afterEach(() => {
      if (originalInterval === undefined) {
        delete process.env.CONFIG_STREAM_INTERVAL_MS;
      } else {
        process.env.CONFIG_STREAM_INTERVAL_MS = originalInterval;
      }
    });

    it("delivers the current config in a `config` event the moment a client connects (this is the path that makes a rotated key land in seconds — api-server restart → reconnect → initial event)", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "live-key-123";
      process.env.GOOGLE_MAPS_MAP_ID = "branded-map";
      // Long interval so this test doesn't see anything but the
      // initial event — keeps the assertion narrow.
      process.env.CONFIG_STREAM_INTERVAL_MS = "60000";

      const stream = await openStream();
      try {
        await stream.waitForEvent((b) => parseConfigEvents(b).length >= 1);
        const events = parseConfigEvents(stream.chunks.join(""));
        expect(events[0]).toEqual({
          googleMapsApiKey: "live-key-123",
          googleMapsMapId: "branded-map",
          ...DEFAULT_THRESHOLDS,
        });
      } finally {
        await stream.stop();
      }
    });

    it("emits a fresh `config` event when GOOGLE_MAPS_API_KEY rotates between ticks (covers the rare in-process rotation case; the more common api-server-restart path is exercised on the client by EventSource auto-reconnect)", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "old-key";
      // Short interval so the test doesn't have to wait long for the
      // tick-driven change detection inside the SSE handler.
      process.env.CONFIG_STREAM_INTERVAL_MS = "25";

      const stream = await openStream();
      try {
        // Wait for the initial event first so we know the handler is
        // running and has captured the "old" baseline.
        await stream.waitForEvent((b) => parseConfigEvents(b).length >= 1);

        process.env.GOOGLE_MAPS_API_KEY = "new-rotated-key";

        await stream.waitForEvent(
          (b) =>
            parseConfigEvents(b).some(
              (e) => e.googleMapsApiKey === "new-rotated-key",
            ),
        );
        const events = parseConfigEvents(stream.chunks.join(""));
        // Both events present, in order.
        expect(events[0].googleMapsApiKey).toBe("old-key");
        expect(events.at(-1)?.googleMapsApiKey).toBe("new-rotated-key");
      } finally {
        await stream.stop();
      }
    });

    it("sends a heartbeat comment between change events so proxies don't close the idle connection", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "stable-key";
      process.env.CONFIG_STREAM_INTERVAL_MS = "25";

      const stream = await openStream();
      try {
        await stream.waitForEvent((b) => b.includes(":hb"));
        // The heartbeat is a true SSE comment (line starts with `:`),
        // not an event — clients with `addEventListener("config", …)`
        // must NOT see a delivery.
        const events = parseConfigEvents(stream.chunks.join(""));
        expect(events).toHaveLength(1);
      } finally {
        await stream.stop();
      }
    });

    it("clears the per-connection interval and ends the response when the client disconnects (no leaked timers across reconnects)", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "stable-key";
      process.env.CONFIG_STREAM_INTERVAL_MS = "10";

      const stream = await openStream();
      // Wait for the first heartbeat so we know the interval is
      // running, then hang up. If the interval weren't cleared, a
      // later `res.write` against an ended response would throw and
      // surface in unhandledRejection — vitest fails the suite on
      // those, so this test relies on that side-effect for coverage.
      await stream.waitForEvent((b) => b.includes(":hb"));
      await stream.stop();

      // Give the would-be-leaked interval a few cycles to misbehave.
      await new Promise((r) => setTimeout(r, 50));
      // If we got here without an unhandled error, teardown was clean.
      expect(true).toBe(true);
    });
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
        "lowOccupancyThresholdPct",
        "noticeLeadDays",
      ]);
      expect(JSON.stringify(body)).not.toContain("must-not-leak");
    } finally {
      delete process.env.SOME_OTHER_SECRET;
    }
  });
});
