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
