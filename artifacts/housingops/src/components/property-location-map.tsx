import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Navigation, ExternalLink, AlertCircle } from "lucide-react";
import {
  useGetRuntimeConfig,
  getGetRuntimeConfigQueryKey,
} from "@workspace/api-client-react";

// Plain-English troubleshooting copy shared between the dedicated
// error branch (shown when the iframe's own `error` event fires —
// network blocked, CSP refused, malformed URL) and the persistent
// disclosure rendered alongside the success branch.
//
// The disclosure exists because Google's Embed API renders its
// `RefererNotAllowedMapError` / `ApiNotActivatedMapError` /
// `InvalidKeyMapError` / quota-exhausted screens *inside* the iframe
// as same-origin Google content — so the parent page never sees an
// `error` event for those failures (cross-origin content errors are
// not exposed to the host page). The disclosure makes the same
// troubleshooting reachable in those cases without us having to
// guess at the failure via timeouts. Keeping the copy in one place
// guarantees the two surfaces never drift.
const MAPS_KEY_TROUBLESHOOTING_TEXT =
  "Google rejected this Maps API key. Check that the Maps Embed API " +
  "is enabled and that this domain is on the key's allowlist.";

interface PropertyLocationMapProps {
  address: string;
  city: string;
  state: string;
  zip: string;
  /**
   * Inject the Maps API key for tests so they don't have to stand up a
   * fake `/api/config` endpoint. When provided, the component skips the
   * runtime config fetch entirely and uses this value directly:
   *   - `undefined` (default) — fetch the key from the api-server
   *     `/api/config` endpoint via react-query
   *   - `"some-key"`          — render the embed branch with this key
   *   - `""` / `null`         — render the friendly fallback branch
   *
   * Production code paths leave this `undefined` so an operator can
   * rotate the key on the api-server side without rebuilding the web
   * bundle (Task #154).
   */
  apiKey?: string | null;
}

function formatAddressLines(
  address: string,
  city: string,
  state: string,
  zip: string,
): { street: string; cityStateZip: string; full: string } {
  const street = address.trim();
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = zip.trim();
  const cityStateZip = [
    cityPart,
    [statePart, zipPart].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const full = [street, cityStateZip].filter(Boolean).join(", ");
  return { street, cityStateZip, full };
}

export function PropertyLocationMap({
  address,
  city,
  state,
  zip,
  apiKey,
}: PropertyLocationMapProps) {
  const { street, cityStateZip, full } = formatAddressLines(
    address,
    city,
    state,
    zip,
  );

  const hasAnyAddress = full.length > 0;

  // Only hit the network when the caller didn't pre-supply a key. Tests
  // pass `apiKey` explicitly so they never fire a real fetch; production
  // leaves it undefined so we read the key from `/api/config`.
  //
  // We also skip the fetch when there's no address to render — the
  // Location card shows its empty state in that case and the key
  // wouldn't be used anyway, so there's no reason to wake the api-server
  // up for it.
  const shouldFetchConfig = apiKey === undefined && hasAnyAddress;
  const configQuery = useGetRuntimeConfig({
    query: {
      // Supply queryKey explicitly so TS is happy — the orval-generated
      // options helper falls back to the same default when omitted, but
      // react-query v5's `UseQueryOptions` type marks `queryKey` as
      // required.
      queryKey: getGetRuntimeConfigQueryKey(),
      enabled: shouldFetchConfig,
    },
  });

  if (!hasAnyAddress) {
    return (
      <Card data-testid="card-property-location">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
            data-testid="property-location-empty"
          >
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Add an address to see this property on a map.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Resolve the effective key. Test injection wins; otherwise we use the
  // value from the runtime config endpoint (which can be `null` when the
  // operator hasn't set GOOGLE_MAPS_API_KEY yet).
  const fetchedKey =
    configQuery.data?.googleMapsApiKey == null
      ? ""
      : configQuery.data.googleMapsApiKey;
  const resolvedKey = apiKey === undefined ? fetchedKey : (apiKey ?? "");

  // While the config request is in flight we render a neutral placeholder
  // instead of the "set up your key" copy — we don't yet know whether a
  // key is configured, and flashing the scary warning before the answer
  // arrives would mislead the operator.
  const isConfigLoading = shouldFetchConfig && configQuery.isPending;

  const encoded = encodeURIComponent(full);
  const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
  const embedUrl = resolvedKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(resolvedKey)}&q=${encoded}`
    : null;

  // Track whether the embedded iframe failed to load. When Google
  // rejects the key (`RefererNotAllowedMapError`,
  // `ApiNotActivatedMapError`, `InvalidKeyMapError`, quota exhausted,
  // etc.) or the network blocks the embed entirely, the iframe's
  // `onError` event lets us swap the tiny grey Google error tile —
  // which inside our card looks like the embed is "almost working" —
  // for a plain-English message that points the operator at what to
  // fix on their key. We reset back to "ok" whenever the embed URL
  // changes (new address or rotated key) so a freshly-valid setup
  // gets a fresh attempt instead of being stuck in the error branch.
  const [mapStatus, setMapStatus] = useState<"ok" | "error">("ok");
  useEffect(() => {
    setMapStatus("ok");
  }, [embedUrl]);

  return (
    <Card data-testid="card-property-location">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isConfigLoading ? (
          <div
            className="rounded-lg border bg-muted/30 aspect-[16/9] w-full flex items-center justify-center text-xs text-muted-foreground"
            data-testid="property-location-map-loading"
            aria-busy="true"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Loading map…
            </span>
          </div>
        ) : embedUrl && mapStatus === "ok" ? (
          <div className="space-y-2">
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${full} in Google Maps`}
              className="block relative rounded-lg overflow-hidden border bg-muted group focus:outline-none focus:ring-2 focus:ring-ring w-full max-w-xl"
              data-testid="property-location-map-link"
            >
              <div className="h-40 sm:h-48 w-full">
                <iframe
                  title={`Map of ${full}`}
                  src={embedUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-full w-full block pointer-events-none"
                  data-testid="property-location-map-iframe"
                  onError={() => setMapStatus("error")}
                />
              </div>
              <div className="absolute top-2 right-2 rounded-md bg-background/90 backdrop-blur px-2 py-1 text-xs font-medium shadow-sm border flex items-center gap-1 opacity-90 group-hover:opacity-100">
                <ExternalLink className="h-3 w-3" />
                Open in Google Maps
              </div>
            </a>
            {/*
              Always-visible companion message. Why this is rendered
              unconditionally next to the embed — not as a collapsible
              disclosure and not gated on detection:
              Google's Embed API renders its key-rejection screens
              (RefererNotAllowedMapError, ApiNotActivatedMapError,
              InvalidKeyMapError, quota exhausted) as same-origin
              Google content *inside* the iframe. Cross-origin content
              errors are not exposed to the host page, so the iframe's
              `error` event never fires for the most common rejection
              modes — meaning detection is not possible from the
              browser. By always rendering the plain-English fix list
              right below the embed, the operator sees the message
              alongside Google's grey error tile in the failure case,
              which is the behavior the task describes. We accept the
              small amount of permanent UI weight in the success case
              as the cost of having reliable, no-false-positives
              messaging in the failure case.
            */}
            <p
              className="text-xs text-muted-foreground flex items-start gap-1.5"
              data-testid="property-location-map-troubleshoot"
            >
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-troubleshoot-text">
                Seeing a Google error in the map?{" "}
                {MAPS_KEY_TROUBLESHOOTING_TEXT}
              </span>
            </p>
          </div>
        ) : embedUrl && mapStatus === "error" ? (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2"
            data-testid="property-location-map-error"
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{MAPS_KEY_TROUBLESHOOTING_TEXT}</span>
            </div>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              data-testid="property-location-map-error-link"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Google Maps
            </a>
          </div>
        ) : (
          <div
            className="rounded-lg border border-dashed bg-muted/30 p-4 space-y-2"
            data-testid="property-location-fallback"
          >
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                A Google Maps API key isn't configured on the server yet, so
                the embedded preview is hidden. You can still open this
                address in Google Maps below.
              </span>
            </div>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              data-testid="property-location-fallback-link"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Google Maps
            </a>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="text-sm" data-testid="property-location-address">
            {street && <p className="font-medium">{street}</p>}
            {cityStateZip && (
              <p className="text-muted-foreground">{cityStateZip}</p>
            )}
          </div>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            data-testid="property-location-directions-link"
          >
            <Navigation className="h-4 w-4" />
            Directions
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
