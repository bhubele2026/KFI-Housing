import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Navigation, ExternalLink, AlertCircle } from "lucide-react";
import {
  useGetRuntimeConfig,
  getGetRuntimeConfigQueryKey,
} from "@workspace/api-client-react";

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
        ) : embedUrl ? (
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
              />
            </div>
            <div className="absolute top-2 right-2 rounded-md bg-background/90 backdrop-blur px-2 py-1 text-xs font-medium shadow-sm border flex items-center gap-1 opacity-90 group-hover:opacity-100">
              <ExternalLink className="h-3 w-3" />
              Open in Google Maps
            </div>
          </a>
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
