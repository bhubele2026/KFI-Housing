import { useEffect, useSyncExternalStore } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
// NOTE: this import creates a small module-level cycle with
// `./use-runtime-config` (which imports `clearGoogleMapsKeyError` from
// here). It's safe because both bindings are only consumed inside
// function bodies — `useRecheckGoogleMapsKey` runs when
// `MapsKeyErrorToastActions` renders, and `clearGoogleMapsKeyError`
// runs when the recheck callback fires. ESM live bindings are wired
// up by the time either is invoked.
import { useRecheckGoogleMapsKey } from "./use-runtime-config";

// ---------------------------------------------------------------------------
// Tailored, action-oriented copy keyed by the exact error code Google's
// Maps Embed iframe posts back to the parent window. Each line names the
// concrete fix on the *operator's* Google Cloud Console — the whole point of
// subscribing to the postMessage / gm_authFailure signals is so we can stop
// telling everyone the same vague "something failed" story regardless of
// which key problem they actually have.
//
// Originally lived inline in `property-location-map.tsx` (Task #163). Hoisted
// here in Task #167 so the portfolio map and an app-level toast can share
// the same lookup table — see `useGoogleMapsKeyError` and
// `MapsKeyErrorToastListener` below.
// ---------------------------------------------------------------------------
export const MAPS_ERROR_MESSAGES: Record<string, string> = {
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

// Synthetic code reported when the Maps JavaScript SDK calls
// `window.gm_authFailure`. Google's documented JS API auth-failure callback
// fires with no arguments, so unlike the Embed iframe (which posts a
// specific code) we don't know whether it's a referrer/quota/disabled-API
// problem. We coin a code so it can flow through the same de-dupe + lookup
// machinery as the embed-iframe codes — and so the portfolio map can show a
// dedicated "key rejected" panel rather than a stuck loading spinner.
export const MAPS_AUTH_FAILURE_CODE = "MapsJsAuthFailure";

const MAPS_AUTH_FAILURE_MESSAGE =
  "Google rejected this Maps API key. Check that the Maps JavaScript API " +
  "is enabled, this domain is on the key's HTTP referrer allowlist, and " +
  "the key isn't over quota in Google Cloud Console.";

// Combined lookup for any code we can surface — the embed-iframe codes plus
// the synthetic JS-SDK auth-failure code. Used by both the toast and by
// portfolio-map's "key rejected" panel.
const COMBINED_MESSAGES: Record<string, string> = {
  ...MAPS_ERROR_MESSAGES,
  [MAPS_AUTH_FAILURE_CODE]: MAPS_AUTH_FAILURE_MESSAGE,
};

export function getMapsKeyErrorMessage(code: string): string {
  const known = COMBINED_MESSAGES[code];
  if (known) return known;
  // Unknown code — surface the raw code alongside the generic
  // troubleshooting line (Task #169 behavior, shared with the property
  // card). Better than telling the operator the same thing for every
  // unrecognized code, and gives them something concrete to put in a
  // support ticket if Google ships a new code we haven't tailored yet.
  return `Google reported ${code} — ${MAPS_KEY_TROUBLESHOOTING_TEXT}`;
}

export const KNOWN_MAPS_ERROR_CODES = Object.keys(MAPS_ERROR_MESSAGES);

// Generic operator-facing troubleshooting line, paired with the raw code
// when Google posts a code we don't yet have a tailored message for (see
// `getMapsKeyErrorMessage`). Embed-API-flavored because that's the surface
// these unknown codes come from — the JS-SDK auth-failure path uses
// MAPS_AUTH_FAILURE_MESSAGE instead.
const MAPS_KEY_TROUBLESHOOTING_TEXT =
  "Google rejected this Maps API key. Check that the Maps Embed API " +
  "is enabled and that this domain is on the key's allowlist.";

// ---------------------------------------------------------------------------
// Google Cloud Console deep-links keyed by the same code table as the
// messages above (Task #173). The toast's "Open in Google Cloud Console"
// action button uses these so the operator lands one click away from the
// concrete fix the message describes — instead of having to log in,
// hunt through the menu, and find the right project/page themselves.
//
// The URLs intentionally don't include a `project=` query string: we have
// no way to know which Google Cloud project owns the operator's key, and
// pinning a wrong project would silently send them to the wrong place.
// Console preserves the operator's last-used project across pages, so
// landing on credentials/quotas in their current project is the right
// behavior for the overwhelmingly common case.
// ---------------------------------------------------------------------------
const GOOGLE_CONSOLE_CREDENTIALS_URL =
  "https://console.cloud.google.com/apis/credentials";
const GOOGLE_CONSOLE_MAPS_EMBED_LIBRARY_URL =
  "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com";
const GOOGLE_CONSOLE_MAPS_EMBED_QUOTAS_URL =
  "https://console.cloud.google.com/apis/api/maps-embed-backend.googleapis.com/quotas";
const GOOGLE_CONSOLE_PROJECT_SELECTOR_URL =
  "https://console.cloud.google.com/projectselector2/home/dashboard";

export const MAPS_KEY_CONSOLE_URLS: Record<string, string> = {
  // Referrer allowlist lives on the key's credential page.
  RefererNotAllowedMapError: GOOGLE_CONSOLE_CREDENTIALS_URL,
  // The operator needs to enable the Maps Embed API for the key's project.
  ApiNotActivatedMapError: GOOGLE_CONSOLE_MAPS_EMBED_LIBRARY_URL,
  // Wrong/typo'd key — credentials list is where they pick the right one.
  InvalidKeyMapError: GOOGLE_CONSOLE_CREDENTIALS_URL,
  // Same — they'll need to copy a key from the credentials list.
  MissingKeyMapError: GOOGLE_CONSOLE_CREDENTIALS_URL,
  // Expired keys are managed (re-issued / rotated) from the credentials list.
  ExpiredKeyMapError: GOOGLE_CONSOLE_CREDENTIALS_URL,
  // Quotas page — exactly the lever they need.
  OverQuotaMapError: GOOGLE_CONSOLE_MAPS_EMBED_QUOTAS_URL,
  // API restrictions are configured on the key's credential page.
  RequestDeniedMapError: GOOGLE_CONSOLE_CREDENTIALS_URL,
  // Project no longer exists — the project picker is the only useful start.
  DeletedApiProjectMapError: GOOGLE_CONSOLE_PROJECT_SELECTOR_URL,
  // The fix is a code change, but the Embed API library page is at least
  // where the operator can confirm which versions are supported and that
  // the API is still enabled.
  RetiredVersionMapError: GOOGLE_CONSOLE_MAPS_EMBED_LIBRARY_URL,
  // JS SDK auth failures are usually a referrer/restriction problem on the
  // key — credentials list is the most useful first stop.
  [MAPS_AUTH_FAILURE_CODE]: GOOGLE_CONSOLE_CREDENTIALS_URL,
};

/**
 * Resolve the Google Cloud Console URL most relevant to a Maps key error
 * code. Falls back to the credentials list so the toast's action button
 * is never dead, even when Google ships a code we haven't mapped yet.
 */
export function getMapsKeyConsoleUrl(code: string): string {
  return MAPS_KEY_CONSOLE_URLS[code] ?? GOOGLE_CONSOLE_CREDENTIALS_URL;
}

// Loose pattern for "looks like a Google Maps Embed error code". Google's
// existing codes all share the shape `<PascalCaseName>MapError`
// (`RefererNotAllowedMapError`, `OverQuotaMapError`, …). Matching that
// shape lets us surface a useful in-app message when Google ships a new
// code (or renames an existing one) before we've added a tailored entry
// to MAPS_ERROR_MESSAGES — instead of silently ignoring it and leaving
// the operator staring at Google's grey error tile with no clue what
// code Google sent. Anchored at a word boundary so substrings like
// "DescriptionMapErrorHandler" won't false-match. Originally introduced
// for the property-location card in Task #169; hoisted into the shared
// hook so the app-level toast and portfolio-map's key-rejected branch
// also benefit from unknown-code surfacing.
const MAPS_ERROR_CODE_PATTERN = /\b[A-Z][A-Za-z0-9]*MapError\b/;

function findMapsErrorCodeInString(value: string): string | null {
  // Known codes win — they preserve the exact spelling the lookup table
  // is keyed on, even if the surrounding string has extra prose.
  for (const code of KNOWN_MAPS_ERROR_CODES) {
    if (value.includes(code)) return code;
  }
  const match = value.match(MAPS_ERROR_CODE_PATTERN);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// extractGoogleMapsErrorCode
//
// Walk an arbitrary postMessage payload looking for a Google Maps error
// code. Google does not publish the exact shape of the error message it
// posts back, and it has changed across versions of the Embed API (the
// value has been seen as a bare string, as `{ code: "…" }`, and as a
// nested error object on the JS API). To avoid being brittle to that
// shape, we look at the obvious string fields and recurse one extra
// level into nested objects — but bound the recursion so a hostile or
// pathological payload can't lock the listener up.
// ---------------------------------------------------------------------------
export function extractGoogleMapsErrorCode(
  data: unknown,
  depth = 0,
): string | null {
  if (depth > 3) return null;
  if (typeof data === "string") {
    return findMapsErrorCodeInString(data);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const fields = ["code", "error", "errorCode", "name", "type", "message"];
    for (const key of fields) {
      const value = obj[key];
      if (typeof value === "string") {
        const found = findMapsErrorCodeInString(value);
        if (found) return found;
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

// ---------------------------------------------------------------------------
// Module-level state.
//
// The first time a Google Maps embed (anywhere on the page) reports a known
// key/quota error code in this session, we want exactly one toast and we
// want every Maps surface — current or future — to know about it without
// each one re-installing its own listener. That sharing has to live above
// React's render tree, which is why this state is module-scoped:
//
//   * `notifiedCodes`  — codes we've already toasted; used to de-dupe so
//                        navigating between properties doesn't spam.
//   * `latestCode`     — the most recent code observed, exposed via
//                        `useGoogleMapsKeyError` so portfolio-map can flip
//                        into a dedicated key-rejected panel even though
//                        the JS SDK gave it no per-iframe signal.
//   * `subscribers`    — React subscribers (state hooks) that re-render
//                        when `latestCode` changes.
//   * `toastSinks`     — toast handlers registered by the app-level
//                        listener; we let the registered sink decide how
//                        the notification is rendered.
// ---------------------------------------------------------------------------
const notifiedCodes = new Set<string>();
let latestCode: string | null = null;
const subscribers = new Set<() => void>();
type ToastSink = (code: string, message: string) => void;
const toastSinks = new Set<ToastSink>();
// Callbacks invoked when the shared store is *cleared* (typically by an
// operator clicking "Re-check key" after fixing the key in Cloud
// Console). Distinct from the `subscribers` set — those re-render to the
// new latest-code value (now `null`), but they don't know about side
// effects like "dismiss the still-visible toast that was warning about
// the old code." The toast listener registers an on-clear callback that
// dismisses its most recent toast handle so the operator doesn't see a
// stale "key rejected" toast lingering after a successful re-check.
const onClearSubscribers = new Set<() => void>();

function emit(code: string): void {
  latestCode = code;
  for (const fn of subscribers) fn();
}

/**
 * Record a Google Maps key/quota error. Updates the latest-code subscribers
 * unconditionally (so a portfolio-map mounted after the error still sees
 * it), and fires the toast at most once per code per session.
 *
 * Exported so callers that detect an error themselves (e.g. a per-iframe
 * source-bound listener) can also feed the shared de-dupe + toast pipeline
 * instead of duplicating the bookkeeping.
 */
export function reportGoogleMapsKeyError(code: string): void {
  emit(code);
  if (notifiedCodes.has(code)) return;
  notifiedCodes.add(code);
  const message = getMapsKeyErrorMessage(code);
  for (const sink of toastSinks) sink(code, message);
}

/**
 * Clear the shared Google Maps key-error store: forget the latest code,
 * reset the per-session toast dedupe set, and dismiss any still-visible
 * key-error toast. Safe to call when the store is already empty (no-op).
 *
 * Used by the "Re-check key" affordance on the in-card error panels — an
 * operator who just fixed the key in Google Cloud Console clicks it,
 * `useRecheckGoogleMapsKey` re-fetches `/api/config`, and on success this
 * is invoked so every Maps surface drops out of its key-rejected branch
 * and re-attempts the embed against the (now possibly fixed) key. If
 * Google still rejects it, a fresh code repopulates the store via the
 * normal postMessage / `gm_authFailure` paths and a new toast fires —
 * resetting `notifiedCodes` here is what re-arms that "fresh toast on
 * next failure" behavior, instead of silently swallowing the second
 * rejection because we'd already toasted that code earlier in the
 * session.
 */
export function clearGoogleMapsKeyError(): void {
  // Bail when there's literally nothing to clear so we don't churn
  // subscribers / dismiss-callbacks for a no-op recheck.
  if (latestCode === null && notifiedCodes.size === 0) return;
  notifiedCodes.clear();
  latestCode = null;
  for (const fn of subscribers) fn();
  for (const fn of onClearSubscribers) fn();
}

// Test-only escape hatch — keeps module-level state from leaking between
// Vitest test cases. Not imported by any production code path.
export function __resetGoogleMapsKeyErrorForTest(): void {
  notifiedCodes.clear();
  latestCode = null;
  // Subscribers, toastSinks, and onClearSubscribers are owned by mounted
  // components / the app listener and are cleaned up on unmount;
  // clearing them here would leave dangling references in still-mounted
  // trees.
}

// ---------------------------------------------------------------------------
// Global listener installation (ref-counted)
//
// React StrictMode mounts effects twice in dev, and we register the
// app-level listener via a hook, so we ref-count the installation to make
// sure double-mount doesn't double-register the postMessage handler or
// stomp the previously-set `gm_authFailure`.
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

let installCount = 0;
let previousAuthFailure: (() => void) | undefined;

function handleMessage(event: MessageEvent): void {
  const code = extractGoogleMapsErrorCode(event.data);
  if (code) reportGoogleMapsKeyError(code);
}

function handleAuthFailure(): void {
  reportGoogleMapsKeyError(MAPS_AUTH_FAILURE_CODE);
  // Forward to whatever was previously installed, in case some other
  // code path also wanted to know.
  previousAuthFailure?.();
}

function installGlobalListeners(): void {
  if (typeof window === "undefined") return;
  installCount += 1;
  if (installCount > 1) return;
  window.addEventListener("message", handleMessage);
  previousAuthFailure = window.gm_authFailure;
  window.gm_authFailure = handleAuthFailure;
}

function uninstallGlobalListeners(): void {
  if (typeof window === "undefined") return;
  installCount = Math.max(0, installCount - 1);
  if (installCount > 0) return;
  window.removeEventListener("message", handleMessage);
  // Only restore if we're still the installed handler — if some other code
  // overwrote it after us we'd otherwise blow away their handler too.
  if (window.gm_authFailure === handleAuthFailure) {
    window.gm_authFailure = previousAuthFailure;
  }
  previousAuthFailure = undefined;
}

// ---------------------------------------------------------------------------
// React-facing API
// ---------------------------------------------------------------------------

/**
 * Action-slot content for the Maps key-rejected toast: a "Re-check"
 * button next to the existing "Open in Google Cloud Console" deep
 * link. Lives here (not inline in the listener hook) so the recheck
 * hook can subscribe to its own re-render lifecycle — that's what
 * lets the button label flip to "Re-checking…" + disable while a
 * refetch is in flight without re-emitting the toast.
 *
 * Why a Re-check button on the toast at all: the in-card error panels
 * already carry the same affordance, but an operator who dismisses
 * the toast and switches to a non-Maps page (Customers, Finance, …)
 * loses the panel-based recovery path until they navigate back. Hoisting
 * the action onto the toast itself means recovery is reachable from
 * anywhere in the app, not just from a card with a visible map.
 *
 * On a successful recheck the recheck hook calls
 * `clearGoogleMapsKeyError`, which dismisses this very toast through
 * the on-clear callback wired up in `useGoogleMapsKeyErrorToastListener`.
 * On a failed recheck (api-server down, key still bad) the hook
 * intentionally leaves the store alone, so the toast stays visible —
 * lying to the operator with a silent dismissal would send them
 * chasing the wrong fix.
 */
function MapsKeyErrorToastActions({
  consoleUrl,
}: {
  consoleUrl: string;
}) {
  const { recheck, isRechecking } = useRecheckGoogleMapsKey();
  return (
    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
      <ToastAction
        altText="Re-check Google Maps key"
        onClick={(event) => {
          // Don't let Radix's default action behavior auto-dismiss the
          // toast — `clearGoogleMapsKeyError` (called inside `recheck()`
          // on success) takes care of dismissal via the on-clear
          // callback. If the recheck fails, the toast must stay up so
          // the operator still sees they need to act.
          event.preventDefault();
          void recheck();
        }}
        disabled={isRechecking}
        data-testid="maps-key-error-toast-recheck"
      >
        {isRechecking ? "Re-checking…" : "Re-check"}
      </ToastAction>
      <ToastAction altText="Open in Google Cloud Console" asChild>
        <a
          href={consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="maps-key-error-toast-console-link"
        >
          Open in Google Cloud Console
        </a>
      </ToastAction>
    </div>
  );
}

/**
 * Mount once at the app root. Installs the global postMessage and
 * `gm_authFailure` listeners and pumps the resulting key-error events into
 * the app's toast queue (one toast per code per session).
 *
 * The toast itself has no UI of its own — it uses the shared `useToast`
 * pipeline so it sits in the same Toaster viewport as every other in-app
 * notification. Each toast carries an "Open in Google Cloud Console"
 * action button that deep-links to the page most likely to hold the fix
 * for the reported code (Task #173) — credentials, the Maps Embed library
 * page, the quotas page, etc. — so operators don't have to hunt through
 * the console menu themselves.
 */
export function useGoogleMapsKeyErrorToastListener(): void {
  const { toast } = useToast();

  useEffect(() => {
    // Track the dismiss handle for the most recent key-error toast we
    // emitted, so a successful "Re-check key" click (which calls
    // `clearGoogleMapsKeyError`) can take down the still-visible toast
    // — leaving it up after the operator just confirmed the key looks
    // OK would be confusing and contradict every other Maps surface
    // that just dropped out of its rejected branch.
    let lastDismiss: (() => void) | undefined;
    const sink: ToastSink = (code, message) => {
      const consoleUrl = getMapsKeyConsoleUrl(code);
      const handle = toast({
        variant: "destructive",
        title: "Google Maps key rejected",
        description: message,
        action: <MapsKeyErrorToastActions consoleUrl={consoleUrl} />,
      });
      lastDismiss = handle.dismiss;
    };
    const onClear = () => {
      lastDismiss?.();
      lastDismiss = undefined;
    };
    toastSinks.add(sink);
    onClearSubscribers.add(onClear);
    installGlobalListeners();
    return () => {
      toastSinks.delete(sink);
      onClearSubscribers.delete(onClear);
      uninstallGlobalListeners();
    };
  }, [toast]);
}

/**
 * Subscribe to the latest Google Maps key-error code seen anywhere on the
 * page during this session. Components use this to render a dedicated "key
 * rejected" branch (the portfolio map flips out of its loading state into
 * a tailored error panel; the per-property location card uses its own
 * source-bound listener for branch switching but feeds this same store so
 * the toast and any other surface stay in sync).
 *
 * Returns `null` until the first error is observed.
 */
export function useGoogleMapsKeyError(): {
  code: string | null;
  message: string | null;
} {
  const code = useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => latestCode,
    () => latestCode,
  );
  return {
    code,
    message: code ? getMapsKeyErrorMessage(code) : null,
  };
}

// Re-export so test files can poke at the install count without reaching
// into private internals. Kept off the named API surface intentionally.
export const __testing = {
  getInstallCount: () => installCount,
  getNotifiedCodes: () => new Set(notifiedCodes),
};
