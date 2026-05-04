import { Router, type IRouter } from "express";
import { GetRuntimeConfigResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Shared by both `GET /config` (JSON) and `GET /config/stream` (SSE) so
// the two endpoints can never disagree on what counts as "set" — an
// empty / whitespace-only env var collapses to `null` everywhere, and
// the zod schema is the single source of truth for the response shape.
const trim = (raw: string | undefined): string | null => {
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
};
function readRuntimeConfig() {
  // The Google Maps key has been migrated env var names twice in close
  // succession — first `VITE_GOOGLE_MAPS_API_KEY` for the build-time
  // setup (Tasks #143/#147), then `GOOGLE_MAPS_API_KEY` for this
  // runtime `/api/config` setup (Task #154). Each migration left an
  // opportunity for the secret to be set under one name while the code
  // reads the other, and the resulting failure mode was silent — the
  // map page just rendered the dashed "API key isn't configured"
  // fallback with no log line pointing at the real cause.
  //
  // Reading the canonical name first and falling back to the legacy
  // name means a single-character mismatch can never silently kill
  // the map again. Centralizing the fallback in this shared helper
  // means both `GET /config` and `GET /config/stream` honor it
  // identically — the SSE endpoint can never disagree with the JSON
  // endpoint about what counts as "set" (Task #187).
  //
  // DO NOT remove the fallback in a future cleanup without first
  // confirming nothing in the deploy/secrets pipeline is still pinned
  // to the legacy name.
  const googleMapsApiKey =
    trim(process.env.GOOGLE_MAPS_API_KEY) ??
    trim(process.env.VITE_GOOGLE_MAPS_API_KEY);
  return GetRuntimeConfigResponse.parse({
    googleMapsApiKey,
    googleMapsMapId: trim(process.env.GOOGLE_MAPS_MAP_ID),
  });
}

// Returns the small set of runtime values the housingops web app reads on
// mount: the Google Maps Embed API key (used by the property-detail
// Location card and the portfolio map) and the portfolio map's branded
// Map ID (custom palette + reduced POI clutter, configured in the team's
// Google Cloud Console). Both are exposed deliberately so an operator can
// rotate them by updating the api-server secret + a quick api-server
// restart, without rebuilding or restarting the web workflow.
//
// SECURITY: do NOT add unrelated secrets here. The browser will see whatever
// this endpoint returns. Only values that are already public-by-design
// (e.g. the Google Maps Embed key, which travels in the embed URL anyway,
// and the Map ID, which is referenced from the loaded JS SDK) belong here.
router.get("/config", (_req, res) => {
  res.json(readRuntimeConfig());
});

// Default tick cadence for the SSE handler. Each tick re-reads the env
// vars and either pushes a fresh `config` event (when the serialized
// payload changed) or a heartbeat comment to keep proxies from closing
// the idle connection. 15s is short enough to detect a process.env
// mutation made without a restart (extremely rare in practice — the
// usual rotation flow restarts the api-server, which drops every SSE
// connection and lets the client's EventSource auto-reconnect with a
// brand-new initial `config` event in seconds) while staying cheap on
// CPU. Tests override this via CONFIG_STREAM_INTERVAL_MS so they don't
// have to wait whole seconds for behavior to fall out.
const DEFAULT_STREAM_INTERVAL_MS = 15_000;
function resolveStreamIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.CONFIG_STREAM_INTERVAL_MS;
  if (!raw) return DEFAULT_STREAM_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STREAM_INTERVAL_MS;
  return n;
}

// Server-Sent Events feed of the same payload as `GET /config`. The
// purpose of this endpoint is *latency*: when an operator rotates
// `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_MAP_ID` and restarts the
// api-server, every open browser tab's EventSource drops, auto-reconnects
// (default ~3s back-off in the EventSource spec), and gets the new value
// in the very first `config` event of the new connection — so a rotated
// key lands in seconds instead of waiting up to a full polling interval.
//
// The polling fallback at `GET /config` is unchanged: browsers without
// EventSource support, environments that strip SSE responses, and the
// mid-rotation reconnect window all keep working through the periodic
// react-query refetch on the client side. The sustained-failure warning
// (Task #175) still fires when neither push nor poll has succeeded
// inside its window because the client treats SSE pushes as a fresh
// `dataUpdatedAt`, which resets the warning streak the same way a
// successful poll does.
//
// Wire format:
//   event: config
//   data: {"googleMapsApiKey":"…","googleMapsMapId":"…"}
//
//   :hb                      // heartbeat comment, no event delivered
//
// Heartbeats are SSE comments (lines starting with `:`) so they don't
// fire any `addEventListener("config", …)` callback on the client —
// they only exist to keep proxies from closing the idle connection.
router.get("/config/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx (and a few other reverse proxies) buffer event-stream bodies
  // by default, which would defeat the "land within seconds" goal.
  // The header is a no-op when no such proxy is in front.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendConfig = (payload: string): void => {
    res.write(`event: config\ndata: ${payload}\n\n`);
  };
  const sendHeartbeat = (): void => {
    res.write(`:hb\n\n`);
  };

  // Initial event so a freshly-opened tab gets the current values
  // *before* the first poll would have fired — this is the main path
  // by which a rotation lands fast (api-server restart → EventSource
  // reconnects → initial event delivers the rotated key). The
  // canonical/legacy env-var fallback (Task #187) lives inside
  // `readRuntimeConfig`, so the SSE feed and `GET /config` always
  // agree on what counts as "set".
  let lastPayload = JSON.stringify(readRuntimeConfig());
  sendConfig(lastPayload);

  const intervalMs = resolveStreamIntervalMs(process.env);
  const timer = setInterval(() => {
    let next: string;
    try {
      next = JSON.stringify(readRuntimeConfig());
    } catch {
      // If the env vars went weird mid-flight (e.g. someone set one
      // to a value the zod schema rejects), don't kill the connection
      // — just skip this tick. The next /api/config request will
      // surface the real error through the normal path.
      sendHeartbeat();
      return;
    }
    if (next !== lastPayload) {
      lastPayload = next;
      sendConfig(next);
    } else {
      sendHeartbeat();
    }
  }, intervalMs);

  req.on("close", () => {
    clearInterval(timer);
    res.end();
  });
});

export default router;
