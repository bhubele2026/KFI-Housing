import { useEffect, useState } from "react";
import {
  getGeocodeFailures,
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
