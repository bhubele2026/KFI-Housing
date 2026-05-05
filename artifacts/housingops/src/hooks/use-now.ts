import { useEffect, useState } from "react";

// Shared module-level subscription so multiple callers using the same
// interval (e.g. every "Checked N ago" label on the Properties rollup)
// piggy-back on a single setInterval instead of spawning one timer per
// component instance. Keyed by the requested interval in ms — distinct
// intervals get distinct timers, since rounding them together would
// either waste cycles (faster than asked) or starve subscribers
// (slower than asked).
const subscribers = new Map<number, Set<(now: number) => void>>();
const timers = new Map<number, ReturnType<typeof setInterval>>();

function subscribe(intervalMs: number, cb: (now: number) => void): () => void {
  let set = subscribers.get(intervalMs);
  if (!set) {
    set = new Set();
    subscribers.set(intervalMs, set);
  }
  set.add(cb);
  if (!timers.has(intervalMs)) {
    const t = setInterval(() => {
      const now = Date.now();
      const subs = subscribers.get(intervalMs);
      // Snapshot to an array so a subscriber that unsubscribes itself
      // during the tick (unmounting from a state update) doesn't
      // mutate the Set we're iterating.
      if (subs) for (const fn of [...subs]) fn(now);
    }, intervalMs);
    timers.set(intervalMs, t);
  }
  return () => {
    const s = subscribers.get(intervalMs);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      const t = timers.get(intervalMs);
      if (t) clearInterval(t);
      timers.delete(intervalMs);
      subscribers.delete(intervalMs);
    }
  };
}

/**
 * Returns the current epoch-ms clock and re-renders the calling
 * component every `intervalMs` so relative-time labels (e.g. date-fns'
 * `formatDistanceToNow`) reflect real elapsed time even when the page
 * sits idle without other state changes.
 *
 * All callers requesting the same interval share a single underlying
 * `setInterval`, so adding more subscribers does not multiply timer
 * load. The returned value is a fresh `Date.now()` snapshot taken at
 * subscription time and on each tick.
 *
 * Defaults to 60s — fine-grained enough that "X minutes ago" labels
 * stay honest, coarse enough not to thrash for unrelated UI.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Re-snapshot on mount so a component mounted between ticks
    // doesn't briefly render a clock value frozen at module load.
    setNow(Date.now());
    return subscribe(intervalMs, setNow);
  }, [intervalMs]);
  return now;
}
