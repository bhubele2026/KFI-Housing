import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Navigation, ExternalLink, AlertCircle } from "lucide-react";
import {
  useGetRuntimeConfig,
  getGetRuntimeConfigQueryKey,
} from "@workspace/api-client-react";

// Generic operator-facing copy used in two places:
//   1. The dedicated error branch when the iframe's own `error` event
//      fires (network blocked, CSP refused, malformed URL) — i.e. we
//      know the embed is broken but Google never told us *why*.
//   2. The persistent companion disclosure rendered alongside the
//      success branch for the failure modes we still cannot detect
//      (extremely old browsers, postMessage stripped by an ad-blocker,
//      etc.).
//
// When Google's Embed API does report a specific error code via
// postMessage (RefererNotAllowedMapError / ApiNotActivatedMapError /
// InvalidKeyMapError / quota / …) we render the *tailored* line from
// MAPS_ERROR_MESSAGES instead of this generic one — see Task #163.
const MAPS_KEY_TROUBLESHOOTING_TEXT =
  "Google rejected this Maps API key. Check that the Maps Embed API " +
  "is enabled and that this domain is on the key's allowlist.";

// Tailored, action-oriented copy keyed by the exact error code Google's
// Maps Embed iframe posts back to the parent window. Each line names
// the concrete fix on the *operator's* Google Cloud Console — the
// whole point of subscribing to the postMessage is so we can stop
// telling everyone the same vague "something failed" story regardless
// of which key problem they actually have.
const MAPS_ERROR_MESSAGES: Record<string, string> = {
  RefererNotAllowedMapError:
    "This Maps API key isn't allowed on this domain. Add this site to the " +
    "key's HTTP referrer allowlist in Google Cloud Console.",
  ApiNotActivatedMapError:
    "The Maps Embed API isn't enabled for this key. Enable it for this " +
    "key's project in Google Cloud Console.",
  InvalidKeyMapError:
    "Google rejected this Maps API key as invalid. Double-check that the " +
    "key configured on the server matches one in Google Cloud Console.",
  MissingKeyMapError:
    "Google says no Maps API key was supplied with the request. Set the " +
    "GOOGLE_MAPS_API_KEY secret on the api-server.",
  ExpiredKeyMapError:
    "This Maps API key has expired. Issue a new key in Google Cloud " +
    "Console and update the server.",
  OverQuotaMapError:
    "This Maps API key is over its daily Google Maps Embed quota. Raise " +
    "the quota in Google Cloud Console or wait for it to reset.",
  RequestDeniedMapError:
    "Google denied this Maps request. Check the API restrictions on the " +
    "key in Google Cloud Console.",
  DeletedApiProjectMapError:
    "The Google Cloud project this Maps API key belongs to has been " +
    "deleted. Issue a new key from an active project.",
  RetiredVersionMapError:
    "This embed is using a retired version of the Google Maps Embed API. " +
    "Upgrade the embed URL to a supported version.",
};

const KNOWN_MAPS_ERROR_CODES = Object.keys(MAPS_ERROR_MESSAGES);

// Walk an arbitrary postMessage payload looking for one of the known
// Google Maps error codes. Google does not publish the exact shape of
// the error message it posts back, and it has changed across versions
// of the Embed API (the value has been seen as a bare string, as
// `{ code: "…" }`, and as a nested error object on the JS API). To
// avoid being brittle to that shape, we look at the obvious string
// fields and recurse one extra level into nested objects — but bound
// the recursion so a hostile or pathological payload can't lock the
// listener up.
function extractGoogleMapsErrorCode(
  data: unknown,
  depth = 0,
): string | null {
  if (depth > 3) return null;
  if (typeof data === "string") {
    for (const code of KNOWN_MAPS_ERROR_CODES) {
      if (data.includes(code)) return code;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const fields = ["code", "error", "errorCode", "name", "type", "message"];
    for (const key of fields) {
      const value = obj[key];
      if (typeof value === "string") {
        for (const code of KNOWN_MAPS_ERROR_CODES) {
          if (value === code || value.includes(code)) return code;
        }
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        const inner = extractGoogleMapsErrorCode(value, depth + 1);
        if (inner) return inner;
      }
    }
  }
  return null;
}

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

  // Track whether the embedded iframe failed to load. Two independent
  // signals can put the card into the error state:
  //
  //   * `iframeLoadError` — the iframe element itself fired its
  //     `error` event (network blocked, CSP refused, malformed URL).
  //     We don't get a code in this case, so we fall back to the
  //     generic troubleshooting copy.
  //
  //   * `reportedErrorCode` — Google's Embed API posted a specific
  //     error code (`RefererNotAllowedMapError`, …) back to the parent
  //     window via postMessage. This is the case the iframe `error`
  //     event *misses*: the iframe loads successfully and renders a
  //     tiny grey error tile inside itself, so onError never fires.
  //     We use the code to look up a tailored message that names the
  //     concrete fix on the operator's Google Cloud Console.
  //
  // We reset both signals whenever the embed URL changes (new address
  // or rotated key) so a freshly-valid setup gets a fresh attempt
  // instead of being stuck in the error branch.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoadError, setIframeLoadError] = useState(false);
  const [reportedErrorCode, setReportedErrorCode] = useState<string | null>(
    null,
  );

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

  // Reset the error state if the embed URL changes (new address or
  // rotated key). Done in an effect rather than a derived value so the
  // failure detected for one URL doesn't bleed into the next render.
  useEffect(() => {
    setIframeLoadError(false);
    setReportedErrorCode(null);
  }, [embedUrl]);

  // Subscribe to postMessage events from Google's Embed iframe. Google
  // dispatches the specific failure code (e.g. RefererNotAllowedMapError)
  // as a postMessage when the iframe itself loads successfully but the
  // map can't render — that is, the cases the iframe `error` event
  // doesn't fire for.
  //
  // We accept a message only if its `source` is exactly our iframe's
  // contentWindow. That single check is sufficient: each iframe has a
  // unique contentWindow, so a message from any other frame on the page
  // (or from the page itself) cannot impersonate it. We deliberately do
  // not gate on `event.origin` — Google has shipped Embed responses from
  // a few different origins over time, and the source-equality check
  // already establishes provenance.
  useEffect(() => {
    if (!embedUrl) return;
    function handleMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const code = extractGoogleMapsErrorCode(event.data);
      if (code) setReportedErrorCode(code);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl]);

  const isMapError = iframeLoadError || reportedErrorCode !== null;
  // Tailored message wins when Google gave us a specific code; the
  // generic line is the catch-all for "iframe element failed to load
  // and we have no code to act on".
  const errorMessage =
    reportedErrorCode !== null
      ? (MAPS_ERROR_MESSAGES[reportedErrorCode] ??
        MAPS_KEY_TROUBLESHOOTING_TEXT)
      : MAPS_KEY_TROUBLESHOOTING_TEXT;

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
        ) : embedUrl && !isMapError ? (
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
                  ref={iframeRef}
                  title={`Map of ${full}`}
                  src={embedUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-full w-full block pointer-events-none"
                  data-testid="property-location-map-iframe"
                  onError={() => setIframeLoadError(true)}
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
              Although Task #163 wires up postMessage detection so most
              key-rejection failures now flip us to the dedicated error
              branch with a tailored message, postMessage isn't a
              guarantee — older browsers, ad-blockers, restrictive CSPs,
              and any future change to Google's embed protocol can all
              suppress it. Keeping this generic disclosure visible in
              the success branch means the operator still has a path
              to "I see Google's grey error tile, here's the fix" even
              when detection fails. We accept the small amount of
              permanent UI weight in the success case as the cost of
              having a no-false-negatives fallback.
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
        ) : embedUrl && isMapError ? (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2"
            data-testid="property-location-map-error"
            data-error-code={reportedErrorCode ?? ""}
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-error-text">
                {errorMessage}
              </span>
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
