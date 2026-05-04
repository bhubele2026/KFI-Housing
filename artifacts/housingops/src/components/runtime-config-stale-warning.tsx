import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * In-page warning shown when the periodic `/api/config` background
 * refetch (the mechanism that lets a rotated `GOOGLE_MAPS_API_KEY` /
 * `GOOGLE_MAPS_MAP_ID` land in already-open tabs without a hard
 * refresh) has been failing for a sustained window.
 *
 * Both the portfolio map and the property-detail Location card render
 * this above their own card so the operator gets the same signal
 * whichever map surface they happen to be looking at. We deliberately
 * avoid the toast pipeline here — a toast auto-dismisses, but this
 * condition is "still ongoing" and the operator needs to be able to
 * glance at the page later and still see it. An inline alert also
 * doesn't compete with the per-map error / fallback branches each
 * card already renders for first-load failure or a missing key.
 *
 * Caller is responsible for computing the `isStale` boolean via
 * {@link useRuntimeConfigRefreshStale}; rendering this component with
 * `isStale={false}` is a no-op so a single line at the top of each
 * map's render is enough to opt in.
 */
export function RuntimeConfigStaleWarning({
  isStale,
}: {
  isStale: boolean;
}) {
  if (!isStale) return null;
  return (
    <Alert
      // Amber/warning palette — this is "your tab might be using
      // outdated map settings", not "the map is broken right now".
      // Using inline color classes (instead of the destructive
      // variant) keeps it visually distinct from the same card's
      // initial-load error branch, which is the destructive red.
      className="mb-3 border-amber-500/50 bg-amber-50 text-amber-900 [&>svg]:text-amber-600 dark:bg-amber-950/40 dark:text-amber-100"
      data-testid="runtime-config-stale-warning"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription data-testid="runtime-config-stale-warning-text">
        We can't reach{" "}
        <code className="font-mono text-[11px] bg-background/60 px-1 rounded">
          /api/config
        </code>{" "}
        to refresh map settings. Any Google Maps key or Map ID you've
        rotated on the api-server may not reach this tab until the
        refresh starts working again.
      </AlertDescription>
    </Alert>
  );
}
