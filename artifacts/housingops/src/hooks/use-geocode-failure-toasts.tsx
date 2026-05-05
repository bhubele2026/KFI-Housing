import { useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useGeocodeFailures,
  useGeocodeFailureTimestamps,
} from "@/hooks/use-geocode-failures";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { CheckedAgoLabel } from "@/components/checked-ago-label";
import { formatGeocodeAddress } from "@/lib/google-maps-sdk";

// Module-level set of addresses we've already toasted for this session.
// Lives at module scope (rather than in component state) so it survives
// the layout component being unmounted and remounted across navigation
// — without that, an operator who briefly switched layouts (e.g. the
// auth gate flips between login and app shells) could see the same
// "Google can't pinpoint X" toast twice for the same address.
//
// The set is intentionally NOT cleared when an address falls back out
// of the failure snapshot (e.g. the operator dismissed the rollup row
// or fixed the address). The task contract is "first-time transition
// per session" — a re-rejection that re-emits the same address must
// stay silent because the badge already tracks the running count.
const toastedAddresses = new Set<string>();

// Test-only escape hatch — keeps the dedupe set from leaking between
// Vitest cases. Kept off the public surface intentionally; only the
// matching test file imports it.
export function __resetGeocodeFailureToastsForTest(): void {
  toastedAddresses.clear();
}

interface AddressableProperty {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface ToastUpdateInput {
  description?: React.ReactNode;
}

interface ToastHandle {
  update: (props: ToastUpdateInput) => void;
  lastTimestamp: number | undefined;
}

function buildDescription(addr: string, timestamp: number | undefined): React.ReactNode {
  // Render the description as a JSX node so the embedded
  // <CheckedAgoLabel> can self-refresh on the shared minute clock —
  // an operator who leaves the toast on screen sees "Checked just now"
  // tick over to "Checked a minute ago" without us pushing a fresh
  // toast prop. The literal sentence still names the address so the
  // operator can identify the row at a glance.
  return (
    <span>
      {`Google can't pinpoint ${addr} — fix it on the property page.`}
      {typeof timestamp === "number" ? (
        <>
          {" "}
          <CheckedAgoLabel timestamp={timestamp} />
        </>
      ) : null}
    </span>
  );
}

/**
 * Fires a one-shot toast the first time each address transitions to
 * "rejected" in the shared in-session geocode cache. Mounted once from
 * the app shell (the sidebar) so failures surfaced by any Maps surface
 * — the portfolio map on /properties, a per-property Location card on
 * /properties/:id — get the operator's attention even when the
 * sidebar's numeric badge is off-screen on a narrow display.
 *
 * The toast carries an "Open property" action that deep-links to the
 * detail page for the property whose current formatted address matches
 * the rejected one, so operators can fix the address in one click. If
 * no current property still matches the failure (e.g. the address was
 * already edited but the cache entry lingers), the action is omitted
 * rather than rendering a dead link to nowhere.
 *
 * Each address toasts at most once per session — a follow-up failure
 * for the same address stays silent. The sidebar's numeric badge
 * already tracks the running count for the operator, so re-toasting
 * would just be noise.
 *
 * The description carries a "Checked N ago" label matching the one
 * the Properties rollup and sidebar badge tooltip render, so an
 * operator who dismisses the toast knows whether the failure is fresh
 * or a re-record of a known-stale address. When a re-record advances
 * the timestamp, the still-open toast updates in place rather than
 * spawning a duplicate (the dedupe rule above still applies).
 */
export function useGeocodeFailureToasts(
  properties: ReadonlyArray<AddressableProperty> | undefined,
): void {
  const { toast } = useToast();
  // Stash the latest properties array in a ref so the failure-handler
  // effect can match newly-rejected addresses against it without
  // re-running every time the parent rerenders for unrelated reasons
  // (the data store emits a fresh `properties` reference after every
  // edit). The effect's dependency array intentionally tracks only
  // the failure set / timestamp map — re-running on a properties
  // change would walk the same set of failures over and over, and
  // the toasted-set guard would suppress duplicates anyway, but at
  // the cost of churn we don't need.
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  const failures = useGeocodeFailures();
  const timestamps = useGeocodeFailureTimestamps();

  // Per-toast `update` handles, keyed by the address. We keep these
  // around so a re-recorded failure (which advances the timestamp
  // without changing the failure set) can refresh the description
  // of an already-open toast in place — without that, the toast
  // would keep showing the original "Checked just now" line even
  // after the underlying entry was re-stamped minutes later.
  const toastHandlesRef = useRef(new Map<string, ToastHandle>());

  useEffect(() => {
    if (failures.size === 0) return;
    for (const addr of failures) {
      const ts = timestamps.get(addr);

      if (toastedAddresses.has(addr)) {
        // Already announced — only push an update when the timestamp
        // actually moved, so unrelated failure-set churn doesn't
        // thrash the toast description.
        const handle = toastHandlesRef.current.get(addr);
        if (handle && ts !== handle.lastTimestamp) {
          handle.update({ description: buildDescription(addr, ts) });
          handle.lastTimestamp = ts;
        }
        continue;
      }

      // Mark before dispatching the toast so any synchronous re-entry
      // (e.g. a second subscriber callback firing inside the same
      // microtask) can't double-toast the same address.
      toastedAddresses.add(addr);
      const props = propertiesRef.current;
      const match = props?.find((p) => formatGeocodeAddress(p) === addr);
      const handle: { update?: (props: ToastUpdateInput) => void } | void = toast({
        variant: "destructive",
        title: "Address Google can't pinpoint",
        description: buildDescription(addr, ts),
        action: match ? (
          // `asChild` makes the action render as the child element so
          // wouter's <Link> handles the SPA navigation (no full page
          // reload) while still receiving the styling and altText
          // from ToastAction. The `altText` is required for screen
          // readers — the toast may auto-dismiss before assistive
          // tech describes the action button itself.
          <ToastAction altText={`Open property to fix ${addr}`} asChild>
            <Link href={`/properties/${match.id}`}>Open property</Link>
          </ToastAction>
        ) : undefined,
      });
      // Some callers (notably tests that pre-date the in-place
      // update path) mock `toast()` to return nothing. Treat the
      // missing handle as "no update channel available" rather than
      // crashing — the next genuine refresh just won't push.
      if (handle && typeof handle.update === "function") {
        toastHandlesRef.current.set(addr, {
          update: handle.update,
          lastTimestamp: ts,
        });
      }
    }
  }, [failures, timestamps, toast]);
}
