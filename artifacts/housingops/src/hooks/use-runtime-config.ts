import { useEffect, useState } from "react";
import {
  useGetRuntimeConfig,
  getGetRuntimeConfigQueryKey,
} from "@workspace/api-client-react";

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
 * One minute is the bounded window inside which a rotated value is
 * guaranteed to land in any open tab. It's frequent enough that an
 * operator who restarts the api-server right after rotating sees the
 * new value land within ~a minute, and infrequent enough that idle
 * tabs don't pound `/api/config` (which is itself a cheap endpoint,
 * but there's no reason to be wasteful).
 */
export const RUNTIME_CONFIG_REFETCH_INTERVAL_MS = 60_000;

/**
 * Window during which the cached runtime config response is considered
 * fresh. New mounts (e.g. navigating to a different page that also
 * reads the config) inside this window reuse the cached value rather
 * than firing a fresh request, while still inheriting the periodic
 * refetch above. Half the refetch interval keeps the cache useful
 * without ever masking a rotation that's already due to land.
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
 *     for picking up a rotation in an idle tab.
 *   - `refetchOnWindowFocus` — when the operator switches back to the
 *     tab after rotating the key in another tab/window, we re-check
 *     immediately rather than waiting up to a full interval.
 *   - `refetchOnReconnect` — same idea after the network drops; if
 *     they rotated while offline, we want the new value as soon as
 *     we're back online.
 *
 * The default `QueryClient` in `App.tsx` disables `refetchOnWindowFocus`
 * globally (it would be noisy for the data-store's CRUD queries), so
 * we re-enable it here on the runtime-config query specifically.
 */
export function useRuntimeConfigQuery(enabled: boolean) {
  return useGetRuntimeConfig({
    query: {
      // Supply queryKey explicitly so TS is happy — react-query v5's
      // `UseQueryOptions` type marks `queryKey` as required even
      // though the orval-generated options helper falls back to the
      // same default. Sharing this key across mount sites is what
      // gives us the "second consumer gets the cache for free"
      // property described above.
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
 * How long the periodic `/api/config` refetch must keep failing before we
 * raise an in-page warning. The refetch interval above is one minute, so
 * two minutes corresponds to ≥2 consecutive failed background refreshes —
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
 * stale-refresh warning's transition. Independent of the refetch
 * interval — react-query updates the query state itself on every
 * refetch attempt, but the *threshold* is "elapsed time since the
 * failure streak began", which only ticks if we re-render. Polling
 * a quarter of the warning window keeps the boundary crossing
 * tight without burning re-renders on every animation frame.
 */
const STALE_WARNING_TICK_MS = 15_000;

/**
 * Detects when the background `/api/config` refetch has been failing for
 * a sustained window. The return value flips to `true` once the current
 * failure streak has been continuous for at least
 * {@link RUNTIME_CONFIG_STALE_WARNING_MS}, and back to `false` as soon as
 * any refetch succeeds.
 *
 * The hook intentionally only fires once at least one successful fetch
 * has landed in this session (we keep a ref because react-query clears
 * `data` after a long enough gap, but operators care about "we *had* a
 * working config and the refresh has since stopped working", which the
 * ref captures). When the very first fetch is still failing, the
 * components already render their dedicated `isConfigError` branch with
 * a Retry affordance — adding a second warning on top would be noise.
 *
 * Pass the result of {@link useRuntimeConfigQuery} (or any other call
 * site sharing the same query key) directly. The hook only reads the
 * three fields it needs, which keeps it cheap to call from multiple
 * components without each one taking an explicit dependency on
 * react-query's `UseQueryResult` shape.
 */
export function useRuntimeConfigRefreshStale(query: {
  isError: boolean;
  isSuccess: boolean;
  data: unknown;
}): boolean {
  const { isError, isSuccess, data } = query;

  // "Have we ever seen a successful response in this session?" — sticky.
  // We can't just look at `data !== undefined` because react-query may
  // reset `data` if the cache is GC'd between observers, which would
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
  const [streakStart, setStreakStart] = useState<number | null>(null);
  useEffect(() => {
    if (!isError) {
      setStreakStart(null);
      return;
    }
    setStreakStart((prev) => prev ?? Date.now());
  }, [isError]);

  // Re-check the elapsed time on a timer so we transition into the
  // warning state at the threshold even when no other render is pending.
  // Only run while we're actually accumulating a failure streak — no
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
