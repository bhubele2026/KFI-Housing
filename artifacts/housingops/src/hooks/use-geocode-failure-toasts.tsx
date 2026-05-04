import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useGeocodeFailures } from "@/hooks/use-geocode-failures";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
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
  // the failure set — re-running on a properties change would cause
  // us to walk the same set of failures over and over, and the
  // toasted-set guard would suppress duplicates anyway, but at the
  // cost of churn we don't need.
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  const failures = useGeocodeFailures();

  useEffect(() => {
    if (failures.size === 0) return;
    for (const addr of failures) {
      if (toastedAddresses.has(addr)) continue;
      // Mark before dispatching the toast so any synchronous re-entry
      // (e.g. a second subscriber callback firing inside the same
      // microtask) can't double-toast the same address.
      toastedAddresses.add(addr);
      const props = propertiesRef.current;
      const match = props?.find((p) => formatGeocodeAddress(p) === addr);
      toast({
        variant: "destructive",
        title: "Address Google can't pinpoint",
        description: `Google can't pinpoint ${addr} — fix it on the property page.`,
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
    }
  }, [failures, toast]);
}
