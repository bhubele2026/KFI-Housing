import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import http from "node:http";
import { AddressInfo } from "node:net";
import { EventSource as EventSourcePolyfill } from "eventsource";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  setBaseUrl,
  useGetRuntimeConfig,
  type RuntimeConfig,
} from "@workspace/api-client-react";
import {
  useRuntimeConfigQuery,
  useRuntimeConfigStream,
} from "./use-runtime-config";

// End-to-end glue test for Task #182's SSE push channel (Task #193).
//
// The two existing test suites cover each side of the wire in isolation:
//
//   • `artifacts/api-server/src/routes/config.test.ts` pins down the SSE
//     wire format coming off `/api/config/stream` (initial event,
//     change detection between ticks, heartbeat comments, clean shutdown).
//   • `artifacts/housingops/src/hooks/use-runtime-config-stale.test.tsx`
//     pins down that an SSE-driven `dataUpdatedAt` advance silences the
//     stale-refresh warning even while the polled refetch is still in
//     `isError: true`.
//
// What neither suite proves is the actual end-to-end glue: an honest
// `EventSource` opened against a running api-server, with the response
// landing in the same react-query cache `useRuntimeConfigQuery` reads,
// and a consumer component re-rendering with the rotated key. A
// regression in any one of:
//
//   • the stream URL (`/api/config/stream`)
//   • the SSE event name (`event: config`)
//   • the JSON shape vs. the orval-generated `RuntimeConfig` type
//   • the react-query cache key (`getGetRuntimeConfigQueryKey()`)
//
// would break the rotation flow in production while leaving every
// existing test green. This file exercises the whole path end-to-end
// against a tiny in-process SSE server.

// ---------------------------------------------------------------------
// EventSource polyfill.
//
// jsdom (which Vitest uses for this package) does not ship an
// `EventSource`. Node 24 also doesn't expose one globally — `undici`
// ships an `EventSource` under the hood but it's not installed at the
// `globalThis.EventSource` slot — so the hook's `typeof EventSource`
// guard short-circuits and the SSE path is never exercised. The
// `eventsource` npm package (a WhatWG-compliant client) fills the gap.
//
// One wrinkle: the hook uses the *relative* URL `/api/config/stream`
// (the workspace router path-routes that to the api-server in the
// browser). The polyfill's constructor requires an absolute URL, so we
// wrap it to resolve any path-only input against the test server's
// base. This keeps the production code path untouched — the hook still
// constructs `new EventSource("/api/config/stream")` exactly as it
// would in a browser.
// ---------------------------------------------------------------------
let baseUrl = "";
class TestEventSource extends EventSourcePolyfill {
  constructor(url: string | URL, init?: EventSourceInit) {
    const resolved =
      typeof url === "string" && url.startsWith("/") ? `${baseUrl}${url}` : url;
    super(resolved, init);
  }
}

// ---------------------------------------------------------------------
// Tiny SSE server. Holds the connection open across the test, lets us
// emit `event: config` payloads on demand from the test body, and
// cleanly closes when the test calls stop. We deliver two payloads
// with different `googleMapsApiKey` values so the test can assert the
// *second* (rotated) key lands in the consumer — proving the glue
// continues to work after the initial event, not just at hookup.
// ---------------------------------------------------------------------
let server: http.Server;
let pushConfig: (payload: RuntimeConfig) => void;
let closeStream: () => void;

beforeAll(async () => {
  let writeFn: ((p: RuntimeConfig) => void) | null = null;
  let endFn: (() => void) | null = null;

  server = http.createServer((req, res) => {
    if (req.url === "/api/config" && req.method === "GET") {
      // The companion JSON endpoint. The polled query mounts alongside
      // the SSE hook, so even though the test focuses on the push path
      // we keep a real /api/config available to avoid an unmocked
      // background fetch racing into the cache mid-assertion.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ googleMapsApiKey: "initial-key", googleMapsMapId: null }));
      return;
    }
    if (req.url === "/api/config/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      writeFn = (p: RuntimeConfig) => {
        res.write(`event: config\ndata: ${JSON.stringify(p)}\n\n`);
      };
      endFn = () => {
        try {
          res.end();
        } catch {
          // already ended
        }
      };
      req.on("close", () => {
        writeFn = null;
        endFn = null;
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  pushConfig = (payload) => {
    if (!writeFn) throw new Error("SSE stream is not connected yet");
    writeFn(payload);
  };
  closeStream = () => {
    endFn?.();
  };
});

afterAll(async () => {
  // Force-drop any keep-alive sockets the polled `/api/config` request
  // left behind so `server.close` resolves immediately. Without this,
  // Node's http server hangs onto idle keep-alive connections for up
  // to its keep-alive timeout (~5s by default), which would push the
  // suite well past the <2s budget called out in Task #193.
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useRuntimeConfigStream end-to-end glue (SSE push → react-query cache → consumer re-render)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;
  let observed: Array<RuntimeConfig | undefined>;
  const originalEventSource = (
    globalThis as unknown as { EventSource: typeof EventSource | undefined }
  ).EventSource;

  beforeEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = TestEventSource;
    setBaseUrl(baseUrl);
    container = document.createElement("div");
    document.body.appendChild(container);
    observed = [];
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          // The behavior under test is purely the SSE push landing in
          // the cache — disable retries so a transient network hiccup
          // can't slow the test down or mask the assertion.
          retry: false,
        },
      },
    });
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    queryClient.clear();
    closeStream();
    setBaseUrl(null);
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  // The "map component" the task description refers to: a tiny consumer
  // that subscribes to the same query the production Maps surfaces use
  // (`useRuntimeConfigQuery`) and also opens the SSE channel
  // (`useRuntimeConfigStream`). Each render captures `data` so the test
  // can assert exactly which payloads the consumer observed.
  function MapConsumer() {
    useRuntimeConfigStream(true);
    const query = useRuntimeConfigQuery(true);
    observed.push(query.data as RuntimeConfig | undefined);
    return <div data-testid="key">{query.data?.googleMapsApiKey ?? ""}</div>;
  }

  // Polls `predicate` against react state until it returns true or the
  // deadline expires. We can't use fake timers here — the SSE plumbing
  // depends on real I/O — so a small real-clock wait loop with `act` is
  // the cleanest way to let pending state updates flush.
  async function waitFor(predicate: () => boolean, timeoutMs = 1_500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    if (!predicate()) {
      throw new Error(
        `Timed out waiting for predicate. Observed payloads: ${JSON.stringify(observed)}`,
      );
    }
  }

  it("delivers a rotated key from a `config` SSE event into the consumer's `useRuntimeConfigQuery().data` without waiting on the polling fallback", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <MapConsumer />
        </QueryClientProvider>,
      );
    });

    // Push the *first* SSE payload — represents the initial `config`
    // event the api-server emits to a freshly-connected client. We send
    // it manually rather than letting the server emit on connect so the
    // test owns the timing and stays deterministic.
    await waitFor(() => typeof pushConfig === "function");
    // Wait until the SSE stream is wired up (the hook's `useEffect`
    // creates the EventSource, which then opens the HTTP request).
    await waitFor(() => {
      try {
        pushConfig({ googleMapsApiKey: "key-A", googleMapsMapId: null });
        return true;
      } catch {
        return false;
      }
    });
    await waitFor(() =>
      observed.some((d) => d?.googleMapsApiKey === "key-A"),
    );

    // The rotation: api-server is restarted with a new
    // GOOGLE_MAPS_API_KEY, the EventSource reconnects, and the very
    // first `config` event of the new connection delivers the rotated
    // value. We model that as a second push on the same connection —
    // identical observable effect on the cache and the consumer.
    pushConfig({ googleMapsApiKey: "key-B-rotated", googleMapsMapId: null });

    await waitFor(() =>
      observed.some((d) => d?.googleMapsApiKey === "key-B-rotated"),
    );

    // Consumer re-rendered with the rotated key. The DOM assertion
    // catches a regression where setQueryData lands in some *other*
    // cache key the consumer isn't observing — in that case `data`
    // would never advance and this would still time out, but the DOM
    // check makes the failure mode obvious in the test output.
    expect(container.querySelector("[data-testid=key]")?.textContent).toBe(
      "key-B-rotated",
    );

    // Both payloads were observed in order — the rotated value must
    // come *after* the initial one, never replace it from the past.
    const aIndex = observed.findIndex((d) => d?.googleMapsApiKey === "key-A");
    const bIndex = observed.findIndex(
      (d) => d?.googleMapsApiKey === "key-B-rotated",
    );
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeGreaterThan(aIndex);

    // Belt-and-suspenders: the cache key the consumer reads is the
    // same one the SSE hook writes. If the two ever drift apart this
    // test is the first thing that breaks.
    const cached = queryClient.getQueryData<RuntimeConfig>(["/api/config"]);
    expect(cached?.googleMapsApiKey).toBe("key-B-rotated");
  });
});
