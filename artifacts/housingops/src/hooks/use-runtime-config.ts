import { useCallback, useContext, useEffect, useState } from "react";
import { QueryClientContext, useQueryClient } from "@tanstack/react-query";
import {
  useGetRuntimeConfig,
  getGetRuntimeConfigQueryKey,
} from "@workspace/api-client-react";
import { clearGoogleMapsKeyError } from "./use-google-maps-key-error";

/**
 * How often the runtime config (Google Maps API key + Map ID, exposed
 * by `GET /api/config`) is re-fetched while a tab stays open.
 *
 * Operators rotate either value by setting `GOOGLE_MAPS_API_KEY` /
 * `GOOGLE_MAPS_MAP_ID` on the api-server and restarting only the
 * api-server (no web rebuild). Without a periodic refetch the open
 * browser tab would keep using the cached value indefinitely and the
 * operator would have to ask everyone to hard-refresh — defeating
 * much of the point of a "no rebuild, no web restart" rotation flow.
 *
 * One minute is the bounded fallback window inside which a rotated
 * value is guaranteed to land in any open tab even when the SSE push
 * channel (`/api/config/stream` — see {@link useRuntimeConfigStream})
 * is unavailable. On the happy path the SSE feed delivers the rotated
 * key in seconds because the api-server restart drops every open
 * EventSource and the browser auto-reconnects with a fresh initial
 * `config` event; the poll exists purely as a safety net.
 */
export const RUNTIME_CONFIG_REFETCH_INTERVAL_MS = 60_000;

/**
 * Window during which the cached runtime config response is considered
 * fresh. New mounts (e.g. navigating to a different page that also
 * reads the config) inside this window reuse the cached value rather
 * than firing a fresh request, while still inheriting the periodic
 * refetch above. Half the refetch interval keeps the cache useful
 * without ever masking a rotation that is already due to land.
 */
export const RUNTIME_CONFIG_STALE_TIME_MS = 30_000;

/**
 * Shared subscription to `/api/config`. Both the portfolio map and the
 * property-detail Location card call this so they share the underlying
 * query (same key) — the second consumer to mount inherits the cached
 * response instantly, and a single periodic refetch covers both.
 *
 * Pass `enabled = false` (e.g. tests that inject the key explicitly,
 * or the empty-address branch of the Location card that never reads
 * the key) to skip the network entirely.
 *
 * Refetch triggers, in addition to the initial mount:
 *   - `refetchInterval` — the periodic poll above; the bounded window
 *     for picking up a rotation in an idle tab when the SSE push
 *     channel is unavailable.
 *   - `refetchOnWindowFocus` — when the operator switches back to the
 *     tab after rotating the key in another tab/window, we re-check
 *     immediately rather than waiting up to a full interval.
 *   - `refetchOnReconnect` — same idea after the network drops; if
 *     they rotated while offline, we want the new value as soon as
 *     we are back online.
 *
 * The default `QueryClient` in `App.tsx` disables `refetchOnWindowFocus`
 * globally (it would be noisy for the data-store s CRUD queries), so
 * we re-enable it here on the runtime-config query specifically.
 *
 * SSE pushes from {@link useRuntimeConfigStream} land in this same
 * react-query cache via `setQueryData`, so consumers don't need to
 * subscribe to anything new — the existing `data` field just updates
 * faster.
 */
export function useRuntimeConfigQuery(enabled: boolean) {
  return useGetRuntimeConfig({
    query: {
      // Supply queryKey explicitly so TS is happy — react-query v5 s
      // `UseQueryOptions` type marks `queryKey` as required even
      // though the orval-generated options helper falls back to the
      // same default. Sharing this key across mount sites is what
      // gives us the "second consumer gets the cache for free"
      // property described above — and what lets the SSE hook below
      // push fresh values into the same cache via setQueryData.
      queryKey: getGetRuntimeConfigQueryKey(),
      enabled,
      staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
      refetchInterval: RUNTIME_CONFIG_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
}

/**
 * URL of the api-server's Server-Sent Events feed. Path-based-routed
 * to the api-server (which serves `/api/*`) by the workspace router,
 * so a relative URL works in dev and prod alike.
 */
const RUNTIME_CONFIG_STREAM_URL = "/api/config/stream";

/**
 * Subscribes to the `/api/config/stream` SSE feed and pushes every
 * delivered payload into the same react-query cache the polling hook
 * reads. The end result for consumers is identical to the polling
 * path — `useRuntimeConfigQuery().data` just updates faster — so no
 * component code has to know whether a particular value arrived via
 * push or poll.
 *
 * Why this exists: without push, a rotated `GOOGLE_MAPS_API_KEY` /
 * `GOOGLE_MAPS_MAP_ID` could take up to a full
 * `RUNTIME_CONFIG_REFETCH_INTERVAL_MS` window to land in an
 * already-open tab. The api-server restart that ships the new value
 * drops every open EventSource; the browser then auto-reconnects
 * (default ~3s back-off in the EventSource spec) and the very first
 * `config` event of the new connection delivers the rotated key —
 * down from "up to a minute" to "within seconds".
 *
 * The polling fallback in {@link useRuntimeConfigQuery} is unchanged.
 * Browsers without `EventSource` (a very small slice today, but the
 * `typeof` guard keeps SSR / test harnesses without it from crashing),
 * environments that strip event-stream responses (some CSP-restricted
 * iframes, certain corporate proxies), and the brief reconnect window
 * itself all keep working through the existing 60s poll. The
 * sustained-failure warning fires when *neither* push nor poll has
 * delivered for ≥ {@link RUNTIME_CONFIG_STALE_WARNING_MS} because the
 * stale hook resets its failure streak whenever react-query's
 * `dataUpdatedAt` advances — which it does on every SSE push too,
 * not just on every successful poll.
 *
 * Pass `enabled = false` (e.g. tests injecting the key explicitly,
 * or the empty-address branch of the Location card) to skip opening
 * the EventSource entirely.
 */
export function useRuntimeConfigStream(enabled: boolean): void {
  // Read the QueryClient via the context directly (rather than through
  // `useQueryClient()`, which throws when no provider is mounted) so
  // call sites that don't stand up a `QueryClientProvider` — notably
  // page-level tests that mock `useGetRuntimeConfig` to bypass
  // react-query entirely (see e.g.
  // `pages/property-detail.location-map-errors.test.tsx`) — keep
  // working. Without a client we have no cache to push into; the
  // polling fallback in `useRuntimeConfigQuery` covers production
  // anyway, so silently no-op'ing here is the right behavior.
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    if (!enabled) return;
    if (!queryClient) return;
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    let es: EventSource;
    try {
      es = new EventSource(RUNTIME_CONFIG_STREAM_URL);
    } catch {
      // Some environments throw synchronously on construction (e.g.
      // CSP `connect-src` violations). Treat that the same as "SSE
      // unavailable" — the polling fallback covers us.
      return;
    }

    const onConfig = (e: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        // A malformed payload shouldn't poison the cache or crash
        // the page — just skip it and wait for the next event.
        return;
      }
      // Push into the same cache the polling query reads. Consumers
      // see this exactly the same way they see a successful poll
      // result: `data` updates and `dataUpdatedAt` bumps, which the
      // sustained-failure warning hook uses to reset its streak.
      queryClient.setQueryData(getGetRuntimeConfigQueryKey(), parsed);
    };
    es.addEventListener("config", onConfig as EventListener);

    return () => {
      es.removeEventListener("config", onConfig as EventListener);
      es.close();
    };
  }, [enabled, queryClient]);
}

/**
 * How long the periodic `/api/config` refetch must keep failing before we
 * raise an in-page warning. The refetch interval above is one minute, so
 * two minutes corresponds to >=2 consecutive failed background refreshes —
 * enough to rule out a single transient blip while still alerting an
 * operator quickly enough that a stuck rotation is actionable.
 *
 * Without a sustained-failure signal an operator who rotates
 * `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_MAP_ID` on the api-server has no
 * way to tell — from a tab that loaded successfully earlier — that the
 * background refetch which would deliver the new value has stopped
 * working. The tab keeps using whatever values it last loaded and the
 * rotation silently fails to land.
 */
export const RUNTIME_CONFIG_STALE_WARNING_MS = 2 * 60_000;

/**
 * Polling cadence for the in-component clock that drives the
 * stale-refresh warning s transition. Independent of the refetch
 * interval — react-query updates the query state itself on every
 * refetch attempt, but the *threshold* is "elapsed time since the
 * failure streak began", which only ticks if we re-render. Polling
 * a quarter of the warning window keeps the boundary crossing
 * tight without burning re-renders on every animation frame.
 */
const STALE_WARNING_TICK_MS = 15_000;

/**
 * Detects when *both* the SSE push channel and the polling fallback
 * have been failing to deliver fresh runtime config for a sustained
 * window. The return value flips to `true` once the current failure
 * streak has been continuous for at least
 * {@link RUNTIME_CONFIG_STALE_WARNING_MS}, and back to `false` as soon
 * as either a successful poll lands or an SSE push pumps a new value
 * into the cache.
 *
 * The hook intentionally only fires once at least one successful fetch
 * has landed in this session (we keep state because react-query clears
 * `data` after a long enough gap, but operators care about "we *had* a
 * working config and the refresh has since stopped working", which the
 * sticky flag captures). When the very first fetch is still failing,
 * the components already render their dedicated `isConfigError` branch
 * with a Retry affordance — adding a second warning on top would be
 * noise.
 *
 * Pass the result of {@link useRuntimeConfigQuery} (or any other call
 * site sharing the same query key) directly. The hook only reads the
 * fields it needs, which keeps it cheap to call from multiple
 * components without each one taking an explicit dependency on
 * react-query's `UseQueryResult` shape.
 *
 * `dataUpdatedAt` is the bridge to the SSE push path: react-query
 * bumps that field on *any* cache write, including the
 * `setQueryData` calls the SSE listener uses. Treating an advance in
 * `dataUpdatedAt` as a recovery means a healthy push channel keeps the
 * warning silent even if the polling fallback has been continuously
 * erroring — which is exactly the right behavior, since the operator
 * is in fact getting fresh values.
 */
export function useRuntimeConfigRefreshStale(query: {
  isError: boolean;
  isSuccess: boolean;
  data: unknown;
  /**
   * react-query's wall-clock timestamp of the last successful cache
   * write for this query (poll *or* `setQueryData`). Optional so
   * existing call sites and tests that don't pass it keep working
   * unchanged — when omitted, the hook falls back to its prior
   * behavior of resetting the streak only on `isError === false`.
   */
  dataUpdatedAt?: number;
}): boolean {
  const { isError, isSuccess, data, dataUpdatedAt } = query;

  // "Have we ever seen a successful response in this session?" — sticky.
  // We cannot just look at `data !== undefined` because react-query may
  // reset `data` if the cache is GC d between observers, which would
  // suppress the warning even though the operator did briefly have a
  // working config. Using a state setter (rather than a ref) so the
  // component re-renders the moment it flips on.
  const [hasEverSucceeded, setHasEverSucceeded] = useState(false);
  useEffect(() => {
    if (isSuccess || data !== undefined) setHasEverSucceeded(true);
  }, [isSuccess, data]);

  // Anchor for "when did the current failure streak begin?". Reset to
  // null on success so a future failure restarts the timer from scratch
  // — a streak that recovers and then re-enters the error state should
  // get the full warning window again, not be treated as "still failing
  // since the original streak."
  //
  // We *also* reset to null when react-query's `dataUpdatedAt` advances
  // past the streak start, even while `isError` is still true. SSE
  // pushes (via `setQueryData` from `useRuntimeConfigStream`) bump
  // `dataUpdatedAt` without changing `isError`, so without this branch
  // a tab whose polling fallback was permanently failing — but whose
  // SSE channel was healthy and delivering fresh values every few
  // seconds — would still raise the "your tab might be using outdated
  // map settings" warning, which would be flatly wrong.
  const [streakStart, setStreakStart] = useState<number | null>(null);
  useEffect(() => {
    if (!isError) {
      setStreakStart(null);
      return;
    }
    setStreakStart((prev) => {
      if (prev !== null && dataUpdatedAt && dataUpdatedAt > prev) {
        // Treat the SSE-driven cache write as a recovery: clear the
        // streak. The very next render (if `isError` is still true)
        // will set a fresh `Date.now()` anchor below, restarting the
        // full warning window — which is correct behavior, the SSE
        // push is the moral equivalent of a successful poll.
        return null;
      }
      return prev ?? Date.now();
    });
  }, [isError, dataUpdatedAt]);

  // Re-check the elapsed time on a timer so we transition into the
  // warning state at the threshold even when no other render is pending.
  // Only run while we are actually accumulating a failure streak — no
  // reason to keep the timer alive in the success/loading branches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isError || !hasEverSucceeded) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), STALE_WARNING_TICK_MS);
    return () => clearInterval(id);
  }, [isError, hasEverSucceeded]);

  if (!isError || !hasEverSucceeded || streakStart === null) return false;
  return now - streakStart >= RUNTIME_CONFIG_STALE_WARNING_MS;
}

/**
 * "Re-check Maps API key" affordance for the Google Maps key-error UI.
 *
 * An operator who fixes their Maps key in Google Cloud Console (enables
 * the API, adds this domain to the referrer allowlist, raises the quota,
 * issues a fresh key, …) should not have to hard-refresh the whole tab
 * to recover. They click "Re-check key" on the in-card error panel, this
 * hook re-fetches `/api/config` so any rotated value lands immediately
 * (instead of waiting up to a full RUNTIME_CONFIG_REFETCH_INTERVAL_MS
 * for the periodic poll), and on success clears the shared key-error
 * store so every Maps surface drops out of its rejected branch and
 * re-attempts the embed against the (now possibly fixed) key. If Google
 * still rejects it, the normal postMessage / `gm_authFailure` paths
 * repopulate the store and the panels + a fresh toast come back —
 * resetting `notifiedCodes` inside `clearGoogleMapsKeyError` is what
 * re-arms that "fresh toast on next failure" behavior.
 *
 * What this cannot fix: the Google Maps JS SDK s `gm_authFailure`
 * callback only fires once per script load, so if Cloud Console was
 * fixed but the operator s underlying Maps API key value did not change,
 * the SDK is still in its broken auth state and will not re-call
 * `gm_authFailure` to confirm. The Embed-iframe path does not have this
 * limitation — each iframe is a fresh request — so the recheck reliably
 * recovers the property-detail Location card and any portfolio-map page
 * where the operator rotated the key value.
 *
 * `recheck()` swallows refetch errors so a transient `/api/config`
 * blip does not blow up the calling component. Instead, when the
 * refetch ends in an error state we leave the existing key-error
 * panels alone so the operator is not lied to about whether the key
 * was reconfirmed; clicking again retries.
 */
export function useRecheckGoogleMapsKey(): {
  recheck: () => Promise<void>;
  isRechecking: boolean;
} {
  const queryClient = useQueryClient();
  const [isRechecking, setIsRechecking] = useState(false);

  const recheck = useCallback(async () => {
    setIsRechecking(true);
    try {
      const queryKey = getGetRuntimeConfigQueryKey();
      // `refetchQueries` resolves once every matching query has
      // settled (success or error). We do not need to inspect the
      // returned data — the next render of any Maps surface will
      // pick up `configQuery.data` from the cache directly.
      //
      // `type: "all"` (vs. the default `"active"`) is important: a
      // Maps surface can be mounted with an explicit `apiKey` prop
      // (test injection, or any future caller that already has a
      // resolved key in hand), in which case its `useGetRuntimeConfig`
      // observer is `enabled: false` — and react-query treats
      // disabled-only observers as *inactive*, so the default
      // `refetchQueries` would silently skip the refetch and we would
      // clear the key-error store without ever re-confirming the
      // runtime config. Including inactive queries here means recheck
      // re-fires /api/config regardless of how the calling surface
      // happens to be configured.
      await queryClient.refetchQueries({ queryKey, type: "all" });
      // Do not clear the shared key-error store if /api/config itself
      // is broken — the api-server being down is a different problem
      // from the Maps key being bad, and dropping the key-error
      // panels in that case would silently send the operator chasing
      // the wrong fix.
      const state = queryClient.getQueryState(queryKey);
      if (state?.status === "error") return;
      clearGoogleMapsKeyError();
    } finally {
      setIsRechecking(false);
    }
  }, [queryClient]);

  return { recheck, isRechecking };
}