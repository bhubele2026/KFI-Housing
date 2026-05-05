import { useEffect, useState } from "react";
import {
  getDismissedGeocodeFailures,
  getGeocodeFailures,
  getGeocodeFailureTimestamp,
  subscribeDismissedGeocodeFailures,
  subscribeGeocodeFailures,
} from "@/lib/google-maps-sdk";

/**
 * Subscribes to the shared module-level geocode cache and returns the
 * set of address strings that Google has definitively rejected this
 * session (cached as `null`). The set updates live as new failures land
 * from any Maps surface — the portfolio map on /properties, a
 * per-property Location card on /properties/:id, etc. — so a rolled-up
 * "addresses Google can't pinpoint" panel can stay in sync without
 * each surface having to push into a parallel store.
 *
 * The returned Set is a snapshot — callers should treat it as
 * read-only and rely on the next render for fresh values. The initial
 * snapshot is read once on mount so a freshly-mounted consumer
 * immediately sees failures recorded by earlier surfaces this session
 * (e.g. an operator who visited a property-detail page before opening
 * the Properties list).
 */
export function useGeocodeFailures(): ReadonlySet<string> {
  const [failures, setFailures] = useState<ReadonlySet<string>>(() =>
    getGeocodeFailures(),
  );
  useEffect(() => {
    // Re-snapshot on mount in case a fresh failure landed between the
    // initial useState() snapshot and this effect attaching (e.g. a
    // sibling surface's geocoder callback fired during render).
    setFailures(getGeocodeFailures());
    return subscribeGeocodeFailures((next) => setFailures(next));
  }, []);
  return failures;
}

/**
 * Subscribes to the shared geocode-failure cache and returns a Map of
 * `address → lastCheckedAt` (epoch ms) for every currently-failing
 * address. Mirrors `useGeocodeFailures` but carries the per-row
 * timestamp the Properties rollup needs to render "Checked N minutes
 * ago" labels.
 *
 * Kept as a separate hook (rather than augmenting `useGeocodeFailures`)
 * so existing callers — the sidebar badge, the toast hook — don't
 * carry the timestamp Map they have no use for, and so a re-record of
 * the same failure (which advances the timestamp but not the set) only
 * forces a re-render in subscribers that actually display the label.
 *
 * The Map is rebuilt on every notification, so `getTimestamp(addr)`
 * inside a render always reflects the most recent recording. Rows
 * whose timestamp predates the live `Date.now()` clock by minutes /
 * hours / days will format accordingly without any extra plumbing.
 */
export function useGeocodeFailureTimestamps(): ReadonlyMap<string, number> {
  // Computed from the current set so a re-render driven by
  // `useGeocodeFailures` already pulls a fresh map on the next render
  // — there's no separate subscription path needed. Walking the set
  // is cheap (one entry per unique failed address) and avoids
  // exposing the module-level Map directly.
  const failures = useGeocodeFailures();
  const map = new Map<string, number>();
  for (const addr of failures) {
    const ts = getGeocodeFailureTimestamp(addr);
    if (typeof ts === "number") map.set(addr, ts);
  }
  return map;
}

/**
 * Subscribes to the shared dismissed-failures set and returns a
 * snapshot of every address the operator has dismissed this session.
 * Drives the rollup's "n dismissed — show" footer so operators can
 * review and undo dismissals without losing the rest of the session
 * state — the only prior recovery was a hard refresh, which would
 * also wipe the active failure cache.
 *
 * Kept as a dedicated hook (separate channel from
 * `useGeocodeFailures`) so consumers that don't render the footer
 * — the sidebar badge, the active list — don't re-render every
 * time a dismissal lands or gets undone.
 */
export function useDismissedGeocodeFailures(): ReadonlySet<string> {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() =>
    getDismissedGeocodeFailures(),
  );
  useEffect(() => {
    // Re-snapshot on mount so a dismissal that landed between the
    // initial useState() snapshot and this effect attaching is
    // picked up on first render after subscribe.
    setDismissed(getDismissedGeocodeFailures());
    return subscribeDismissedGeocodeFailures((next) => setDismissed(next));
  }, []);
  return dismissed;
}
