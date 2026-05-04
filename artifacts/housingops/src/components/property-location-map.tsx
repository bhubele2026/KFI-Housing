import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Navigation,
  ExternalLink,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  extractGoogleMapsErrorCode,
  getMapsKeyConsoleUrl,
  getMapsKeyErrorMessage,
  reportGoogleMapsKeyError,
  useGoogleMapsKeyError,
} from "@/hooks/use-google-maps-key-error";
import {
  useRuntimeConfigQuery,
  useRuntimeConfigRefreshStale,
  useRuntimeConfigStream,
  useRecheckGoogleMapsKey,
} from "@/hooks/use-runtime-config";
import { RuntimeConfigStaleWarning } from "@/components/runtime-config-stale-warning";

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
// the shared `getMapsKeyErrorMessage` lookup (imported above, shared
// with the app-level toast listener and the portfolio map — Task
// #167) instead of this generic one. Task #163 introduced the
// lookup; Task #167 hoisted it to a shared module so a key rejection
// seen anywhere on the page also fires a one-time app-level toast
// and flips the portfolio map into a matching error state.
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
  // The shared hook applies the periodic background refetch +
  // refetch-on-window-focus that lets a rotated GOOGLE_MAPS_API_KEY
  // propagate into open tabs without a hard refresh. Sharing the
  // queryKey with the portfolio map means the second consumer to mount
  // gets the cached response instantly and one periodic poll covers
  // both. The iframe re-renders with the new key automatically because
  // the rotated value lands in `embedUrl`.
  const shouldFetchConfig = apiKey === undefined && hasAnyAddress;
  const configQuery = useRuntimeConfigQuery(shouldFetchConfig);
  // Subscribe to the SSE push channel so a rotated key lands within
  // seconds of the api-server restart instead of waiting up to a full
  // polling interval. Pushes land in the same react-query cache the
  // polling hook reads, so the iframe re-renders with the new key the
  // moment `configQuery.data` updates — no separate consumer wiring.
  useRuntimeConfigStream(shouldFetchConfig);

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

  // Subscribe to the shared Google Maps key-error store so a code
  // observed *anywhere else on the page* — the portfolio map's
  // `gm_authFailure` callback, an embed iframe on a sibling card,
  // etc. — flips this card into its dedicated key-rejected branch
  // even before the local iframe has had a chance to report anything
  // (Task #178). Without this subscription, an operator could be
  // staring at our "Loading map…" placeholder indefinitely while a
  // toast on the same page was already saying the key was rejected.
  const sharedKeyError = useGoogleMapsKeyError();

  // "Re-check key" affordance for the in-card error panel. An operator
  // who fixed their Maps key in Google Cloud Console clicks this and
  // we re-fetch /api/config + clear the shared key-error store so the
  // card drops out of the rejected branch and re-attempts the embed
  // against the (now possibly fixed) key — without a hard refresh.
  // Local error state (`iframeLoadError`, `reportedErrorCode`) is
  // reset alongside the shared store so the iframe gets a fresh
  // attempt even when the resolved key value didn't change.
  const { recheck, isRechecking } = useRecheckGoogleMapsKey();
  const handleRecheck = () => {
    setIframeLoadError(false);
    setReportedErrorCode(null);
    void recheck();
  };

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
  // The runtime config request itself failed (network error, 5xx, etc.).
  // Without an explicit branch the operator would otherwise see the
  // "set up your key" fallback (because `data` is undefined when the
  // query errors), which sends them chasing the wrong fix. Surface the
  // real cause instead and offer a manual retry.
  const isConfigError = shouldFetchConfig && configQuery.isError;
  // Sustained-failure warning. Fires once the periodic background
  // refetch has been failing for ≥ RUNTIME_CONFIG_STALE_WARNING_MS
  // *after* at least one successful fetch landed in this session, so
  // the operator knows a freshly-rotated GOOGLE_MAPS_API_KEY may not
  // be reaching this tab. Hidden when the caller pre-supplied an
  // `apiKey` (no fetch happens), and a no-op until the threshold is
  // crossed.
  const isRefreshStale = useRuntimeConfigRefreshStale({
    isError: configQuery.isError,
    isSuccess: configQuery.isSuccess,
    data: configQuery.data,
    // Bridge to the SSE path: every push lands as a `setQueryData`
    // call on the same cache, which bumps `dataUpdatedAt`. Forwarding
    // it lets the stale hook treat a healthy push channel as
    // "refresh is working" even when the polling fallback is failing
    // (otherwise the warning would fire on a tab that's actually
    // getting fresh values via SSE).
    dataUpdatedAt: configQuery.dataUpdatedAt,
  });

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
      if (code) {
        setReportedErrorCode(code);
        // Also feed the shared store so the app-level toast (Task
        // #167) fires once per code per session and any other Maps
        // surface mounted on the page can flip into its own
        // key-rejected state. The app-level postMessage listener
        // would normally pick the same payload up directly, but
        // routing through `reportGoogleMapsKeyError` here keeps the
        // store consistent even on pages that don't yet mount the
        // app-level listener (e.g. tests of this card in isolation
        // that opt in to the shared store).
        reportGoogleMapsKeyError(code);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl]);

  // Prefer a code observed by *this* iframe over one routed through the
  // shared store. They normally match (the local listener also feeds
  // the shared store via `reportGoogleMapsKeyError`), but during the
  // brief window before the local handler runs — or when the only
  // signal is a sibling Maps surface reporting an error before our own
  // `/api/config` request has even returned — the shared store is the
  // sole source of truth. Either way, surface the same dedicated error
  // panel rather than the loading/fallback branches (Task #178).
  const effectiveErrorCode = reportedErrorCode ?? sharedKeyError.code;
  const isMapError = iframeLoadError || effectiveErrorCode !== null;
  // Tailored message wins when Google gave us a specific code we
  // recognize. The shared `getMapsKeyErrorMessage` lookup handles both
  // the embed-API codes and the synthetic JS-SDK auth-failure code, and
  // names the raw code verbatim alongside the generic fix line for
  // anything Google ships that isn't in our table — far better than
  // silently ignoring it. The plain generic line is reserved for the
  // "iframe element failed to load and we have no code to act on" case.
  let errorMessage: string;
  if (effectiveErrorCode !== null) {
    errorMessage = getMapsKeyErrorMessage(effectiveErrorCode);
  } else {
    errorMessage = MAPS_KEY_TROUBLESHOOTING_TEXT;
  }

  return (
    <Card data-testid="card-property-location">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/*
          Sustained-failure warning. Lives at the top of CardContent
          (rather than above the Card) so it stays visually inside
          the Location card the operator is already looking at —
          there's no other "Location"-shaped affordance on the
          property-detail page for the warning to dock against. The
          component is a no-op while `isRefreshStale` is false, so
          rendering it unconditionally costs nothing (Task #175).
        */}
        <RuntimeConfigStaleWarning isStale={isRefreshStale} />
        {isMapError ? (
          // Key-rejected / iframe-load-error branch is checked BEFORE
          // `isConfigLoading` so a code reported anywhere on the page
          // (e.g. the portfolio map's `gm_authFailure`, or a sibling
          // embed iframe's postMessage) flips this card out of the
          // "Loading map…" placeholder *immediately* — even if our own
          // `/api/config` request is still in flight. Without this
          // ordering an operator could be staring at our spinner
          // indefinitely while a toast on the same page already said
          // the key was rejected, with no in-page explanation
          // (Task #178).
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2"
            data-testid="property-location-map-error"
            data-error-code={effectiveErrorCode ?? ""}
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-error-text">
                {errorMessage}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              {/*
                Same per-code Google Cloud Console deep-link the
                app-level toast surfaces (Task #173). Operators who
                dismissed that toast — or arrived at this card after
                the toast had already fired and timed out — still get
                the single-click jump to the right Console page
                (credentials / quotas / library / …) for whatever code
                Google reported. Falls back to the credentials list
                when the code is unrecognized so the link is never
                dead. Uses `effectiveErrorCode` so a code observed via
                the shared store (e.g. a sibling Maps surface) also
                surfaces the Console link, not just one this iframe
                reported itself (Task #178). When the iframe's own
                `error` event fires we have no code, so we don't
                surface a Console link in that case
                (`effectiveErrorCode` is null then) since we'd just be
                guessing which page to send the operator to.
              */}
              {effectiveErrorCode !== null && (
                <a
                  href={getMapsKeyConsoleUrl(effectiveErrorCode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  data-testid="property-location-map-error-console-link"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Google Cloud Console
                </a>
              )}
            </div>
            {/*
              "Re-check key" affordance (Task #181). After fixing the
              key in Google Cloud Console (enabling the API, adding
              this domain to the referrer allowlist, raising the
              quota, rotating the value, …) operators previously had
              to hard-refresh the entire tab to recover. This button
              re-fetches /api/config and clears the shared key-error
              store on success so this card — and every other Maps
              surface on the page — drops out of its rejected branch
              and re-attempts the embed. If Google still rejects the
              key the postMessage / `gm_authFailure` paths repopulate
              the store and the panel + a fresh toast come back, so
              clicking optimistically is safe.
            */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRecheck}
              disabled={isRechecking}
              data-testid="property-location-map-error-recheck"
            >
              <RefreshCw
                className={
                  isRechecking
                    ? "h-4 w-4 animate-spin"
                    : "h-4 w-4"
                }
              />
              {isRechecking ? "Re-checking…" : "Re-check key"}
            </Button>
          </div>
        ) : isConfigLoading ? (
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
        ) : isConfigError ? (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3"
            data-testid="property-location-map-config-error"
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span data-testid="property-location-map-config-error-text">
                Couldn't load the map config from{" "}
                <code className="font-mono text-[11px] bg-background/60 px-1 rounded">
                  /api/config
                </code>
                . Check the api-server logs and try again.
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void configQuery.refetch();
              }}
              data-testid="property-location-map-config-retry"
            >
              Retry
            </Button>
          </div>
        ) : embedUrl ? (
          // `isMapError` is handled by the top-of-tree branch above, so
          // by the time we reach this branch we know the embed should
          // be live.
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              {/*
                Same per-code Google Cloud Console deep-link the
                app-level toast surfaces (Task #173). Operators who
                dismissed that toast — or arrived at this card after
                the toast had already fired and timed out — still get
                the single-click jump to the right Console page
                (credentials / quotas / library / …) for whatever code
                Google reported. Falls back to the credentials list
                when the code is unrecognized so the link is never
                dead. Uses the iframe-reported code only — when the
                iframe's own `error` event fires we have no code, so
                we don't surface a Console link in that case
                (`reportedErrorCode` is null then) since we'd just be
                guessing which page to send the operator to.
              */}
              {reportedErrorCode !== null && (
                <a
                  href={getMapsKeyConsoleUrl(reportedErrorCode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  data-testid="property-location-map-error-console-link"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Google Cloud Console
                </a>
              )}
            </div>
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
