import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act, isValidElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useGoogleMapsKeyError,
  useGoogleMapsKeyErrorToastListener,
  reportGoogleMapsKeyError,
  clearGoogleMapsKeyError,
  extractGoogleMapsErrorCode,
  getMapsKeyConsoleUrl,
  MAPS_ERROR_MESSAGES,
  MAPS_KEY_CONSOLE_URLS,
  MAPS_AUTH_FAILURE_CODE,
  __resetGoogleMapsKeyErrorForTest,
  __testing,
} from "./use-google-maps-key-error";
import { useToast } from "./use-toast";
import { Toaster } from "@/components/ui/toaster";
import { useRuntimeConfigQuery } from "./use-runtime-config";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// These tests pin down the contract Task #167 introduced: a single shared
// store + listener that fires exactly one toast per Google Maps key/quota
// error code per session, and lets any Maps surface (the property-location
// card, the portfolio map) read the latest code so it can flip into a
// dedicated "key rejected" branch.

describe("useGoogleMapsKeyError", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalGmAuthFailure: (() => void) | undefined;

  beforeEach(() => {
    __resetGoogleMapsKeyErrorForTest();
    // Make sure we start each test with no listener installed (the previous
    // test's afterEach unmounts its tree, which decrements the install
    // count — but defensively assert it).
    expect(__testing.getInstallCount()).toBe(0);
    originalGmAuthFailure = window.gm_authFailure;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    window.gm_authFailure = originalGmAuthFailure;
    __resetGoogleMapsKeyErrorForTest();
  });

  // --------------------------------------------------------------------
  // Probe components — each test mounts whichever combination of probes
  // it needs (a toast listener and/or a subscriber that mirrors the
  // current code into the DOM so we can assert it without reaching into
  // the hook's internals).
  // --------------------------------------------------------------------
  function ListenerProbe() {
    useGoogleMapsKeyErrorToastListener();
    return null;
  }

  function SubscriberProbe() {
    const { code, message } = useGoogleMapsKeyError();
    return (
      <div
        data-testid="probe"
        data-code={code ?? ""}
        data-message={message ?? ""}
      />
    );
  }

  function ToastReader() {
    const { toasts } = useToast();
    return (
      <div data-testid="toast-count" data-count={String(toasts.length)}>
        {toasts.map((t) => {
          // The action slot is a `<MapsKeyErrorToastActions consoleUrl=…/>`
          // wrapper component. Reading its `consoleUrl` prop directly
          // (rather than walking into rendered children) avoids needing
          // to stand up a Toaster + QueryClientProvider just to
          // confirm which deep-link the toast carries — the wrapper's
          // shape is the contract we're pinning down here. Toast-level
          // Re-check click behaviour gets its own test that mounts the
          // real Toaster.
          const actionConsoleUrl = (() => {
            if (!t.action || !isValidElement(t.action)) return "";
            const actionEl = t.action as ReactElement<{ consoleUrl?: string }>;
            return actionEl.props.consoleUrl ?? "";
          })();
          return (
            <div
              key={t.id}
              data-testid="toast"
              data-title={String(t.title ?? "")}
              data-description={String(t.description ?? "")}
              data-variant={String(t.variant ?? "default")}
              data-action-console-url={actionConsoleUrl}
              data-has-action={t.action ? "true" : "false"}
              // `open` flips to false when the toast is dismissed (the
              // hook keeps dismissed toasts in the queue for ~16
              // minutes before garbage-collecting them, so length-of-
              // queue is not a reliable "is anything visible?" signal —
              // the open flag is). Default to "true" since the toast
              // primitive treats missing `open` as visible.
              data-open={String(t.open ?? true)}
            />
          );
        })}
      </div>
    );
  }

  async function mount(node: React.ReactElement) {
    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });
  }

  function readProbe(): { code: string; message: string } {
    const el = container.querySelector(
      '[data-testid="probe"]',
    ) as HTMLElement | null;
    return {
      code: el?.getAttribute("data-code") ?? "",
      message: el?.getAttribute("data-message") ?? "",
    };
  }

  function readToasts(): Array<{
    title: string;
    description: string;
    variant: string;
    actionConsoleUrl: string;
    hasAction: boolean;
    open: boolean;
  }> {
    const els = container.querySelectorAll('[data-testid="toast"]');
    return Array.from(els).map((el) => ({
      title: el.getAttribute("data-title") ?? "",
      description: el.getAttribute("data-description") ?? "",
      variant: el.getAttribute("data-variant") ?? "",
      actionConsoleUrl: el.getAttribute("data-action-console-url") ?? "",
      hasAction: el.getAttribute("data-has-action") === "true",
      open: el.getAttribute("data-open") !== "false",
    }));
  }

  // --------------------------------------------------------------------
  // extractGoogleMapsErrorCode (pure helper)
  // --------------------------------------------------------------------
  it("extractGoogleMapsErrorCode: pulls a code out of common payload shapes", () => {
    expect(extractGoogleMapsErrorCode("RefererNotAllowedMapError")).toBe(
      "RefererNotAllowedMapError",
    );
    expect(extractGoogleMapsErrorCode({ code: "OverQuotaMapError" })).toBe(
      "OverQuotaMapError",
    );
    expect(
      extractGoogleMapsErrorCode({
        error: { name: "InvalidKeyMapError" },
      }),
    ).toBe("InvalidKeyMapError");
    expect(extractGoogleMapsErrorCode("nothing of interest here")).toBeNull();
    expect(extractGoogleMapsErrorCode(null)).toBeNull();
    expect(extractGoogleMapsErrorCode(42)).toBeNull();
  });

  // --------------------------------------------------------------------
  // First-toast contract
  // --------------------------------------------------------------------
  it("fires exactly one toast the first time a known code is reported", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    expect(readToasts()).toEqual([]);

    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });

    const toasts = readToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].title.toLowerCase()).toContain("google maps");
    // The toast description must be the *tailored* line, not a generic
    // "something failed" copy. Use the source-of-truth message table so
    // future copy edits don't require keeping this assertion in sync.
    expect(toasts[0].description).toBe(
      MAPS_ERROR_MESSAGES.RefererNotAllowedMapError,
    );
  });

  // --------------------------------------------------------------------
  // Open-in-Google-Cloud-Console action button (Task #173)
  //
  // The toast carries an action button that deep-links to the page in
  // Google Cloud Console most relevant to the reported code, so the
  // operator doesn't have to hunt through the menu themselves. The
  // mapping is exercised both at the function level (for codes that
  // never need to flow through the listener — fallback, JS auth) and at
  // the toast level (for the codes the listener is most likely to see).
  // --------------------------------------------------------------------
  it("getMapsKeyConsoleUrl: maps each known code to its most-relevant console page", () => {
    // Per-code expectations are the contract: the URL has to actually
    // be the right page for the fix the message names. Hard-coding the
    // expected URLs here (instead of just round-tripping through
    // MAPS_KEY_CONSOLE_URLS) keeps the assertion honest — a typo in the
    // table would silently pass a "table === table" check.
    expect(getMapsKeyConsoleUrl("RefererNotAllowedMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("ApiNotActivatedMapError")).toBe(
      "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com",
    );
    expect(getMapsKeyConsoleUrl("InvalidKeyMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("MissingKeyMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("ExpiredKeyMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("OverQuotaMapError")).toBe(
      "https://console.cloud.google.com/apis/api/maps-embed-backend.googleapis.com/quotas",
    );
    expect(getMapsKeyConsoleUrl("RequestDeniedMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("DeletedApiProjectMapError")).toBe(
      "https://console.cloud.google.com/projectselector2/home/dashboard",
    );
    expect(getMapsKeyConsoleUrl("RetiredVersionMapError")).toBe(
      "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com",
    );
    expect(getMapsKeyConsoleUrl(MAPS_AUTH_FAILURE_CODE)).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
  });

  it("getMapsKeyConsoleUrl: every code with a tailored message also has a tailored console URL", () => {
    // The table-completeness check — if anyone adds a new
    // MAPS_ERROR_MESSAGES entry without the matching URL, this fails
    // loudly instead of silently falling back to credentials.
    for (const code of Object.keys(MAPS_ERROR_MESSAGES)) {
      expect(MAPS_KEY_CONSOLE_URLS[code]).toBeDefined();
    }
    // The synthetic JS-SDK code lives outside MAPS_ERROR_MESSAGES but
    // still needs an explicit mapping.
    expect(MAPS_KEY_CONSOLE_URLS[MAPS_AUTH_FAILURE_CODE]).toBeDefined();
  });

  it("getMapsKeyConsoleUrl: unknown codes fall back to the credentials list (action is never dead)", () => {
    expect(getMapsKeyConsoleUrl("SomeBrandNewMapError")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
    expect(getMapsKeyConsoleUrl("")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
  });

  it.each([
    [
      "RefererNotAllowedMapError",
      "https://console.cloud.google.com/apis/credentials",
    ],
    [
      "ApiNotActivatedMapError",
      "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com",
    ],
    [
      "OverQuotaMapError",
      "https://console.cloud.google.com/apis/api/maps-embed-backend.googleapis.com/quotas",
    ],
    [
      "DeletedApiProjectMapError",
      "https://console.cloud.google.com/projectselector2/home/dashboard",
    ],
    [
      "RetiredVersionMapError",
      "https://console.cloud.google.com/apis/library/maps-embed-backend.googleapis.com",
    ],
  ])(
    "the toast for %s carries an action button linking to %s",
    async (code, expectedHref) => {
      await mount(
        <>
          <ListenerProbe />
          <ToastReader />
        </>,
      );
      await act(async () => {
        reportGoogleMapsKeyError(code);
      });
      const toasts = readToasts();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].hasAction).toBe(true);
      expect(toasts[0].actionConsoleUrl).toBe(expectedHref);
    },
  );

  it("the toast for an unknown code still carries an action button (fallback href)", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("BrandNewUnseenMapError");
    });
    const toasts = readToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].hasAction).toBe(true);
    expect(toasts[0].actionConsoleUrl).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
  });

  it("dedupes per code per session — second report of the same code does not toast again", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    // Still exactly one toast — not three.
    expect(readToasts()).toHaveLength(1);
    expect(readToasts()[0].description).toBe(
      MAPS_ERROR_MESSAGES.OverQuotaMapError,
    );
  });

  it("a different code in the same session does fire its own toast", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });
    // The toast hook caps the visible queue at 1, but each call should
    // have produced its own toast — verify by checking the dedupe set
    // saw both codes get past the gate (that's the actual contract).
    const notified = __testing.getNotifiedCodes();
    expect(notified.has("OverQuotaMapError")).toBe(true);
    expect(notified.has("InvalidKeyMapError")).toBe(true);
  });

  // --------------------------------------------------------------------
  // Global postMessage listener installed by the app-level hook
  // --------------------------------------------------------------------
  it("picks up known codes posted from any window source, not just one iframe", async () => {
    await mount(
      <>
        <ListenerProbe />
        <SubscriberProbe />
        <ToastReader />
      </>,
    );

    // Fire a postMessage with no `source` set — the global listener has
    // no per-iframe provenance check, so it must accept it as long as
    // the payload contains a known code.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { code: "ApiNotActivatedMapError" } }),
      );
    });

    expect(readProbe().code).toBe("ApiNotActivatedMapError");
    expect(readToasts()).toHaveLength(1);
    expect(readToasts()[0].description).toBe(
      MAPS_ERROR_MESSAGES.ApiNotActivatedMapError,
    );
  });

  it("ignores postMessage payloads that don't carry a known code", async () => {
    await mount(
      <>
        <ListenerProbe />
        <SubscriberProbe />
      </>,
    );
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { code: "SomeoneElsesMessage" } }),
      );
      window.dispatchEvent(new MessageEvent("message", { data: "hello" }));
    });
    // The store stays empty — neither subscribers nor the dedupe set were
    // notified. Asserting via the dedupe set rather than the toast queue
    // avoids cross-test bleed from the toast reducer's module-scoped
    // state (the toast hook keeps dismissed toasts around for ~16
    // minutes, so the queue isn't a clean per-test signal).
    expect(readProbe().code).toBe("");
    expect(__testing.getNotifiedCodes().size).toBe(0);
  });

  // --------------------------------------------------------------------
  // window.gm_authFailure (the JS SDK's auth-failure callback)
  // --------------------------------------------------------------------
  it("installs window.gm_authFailure and routes its invocation through the same toast pipeline", async () => {
    await mount(
      <>
        <ListenerProbe />
        <SubscriberProbe />
        <ToastReader />
      </>,
    );

    // The listener must replace whatever was on `window.gm_authFailure`
    // at mount time. Calling the now-installed function simulates the
    // Maps JS SDK's documented auth-failure path.
    expect(typeof window.gm_authFailure).toBe("function");

    await act(async () => {
      window.gm_authFailure!();
    });

    expect(readProbe().code).toBe(MAPS_AUTH_FAILURE_CODE);
    // Generic "key rejected" tailored copy — still keyed off the
    // synthetic auth-failure code, not the embed-iframe table.
    const toasts = readToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("destructive");
    expect(toasts[0].description.toLowerCase()).toContain(
      "google rejected this maps api key",
    );
  });

  it("forwards gm_authFailure to whatever previous handler was installed", async () => {
    let calls = 0;
    window.gm_authFailure = () => {
      calls++;
    };
    await mount(<ListenerProbe />);
    await act(async () => {
      window.gm_authFailure!();
    });
    // Both: our handler reported the error AND the previously-installed
    // handler still ran. Ref-counted install must not silently swallow
    // the previously-installed callback.
    expect(__testing.getNotifiedCodes().has(MAPS_AUTH_FAILURE_CODE)).toBe(true);
    expect(calls).toBe(1);
  });

  it("restores the previous gm_authFailure on unmount", async () => {
    const previous = () => {};
    window.gm_authFailure = previous;
    await mount(<ListenerProbe />);
    expect(window.gm_authFailure).not.toBe(previous);
    await act(async () => {
      root!.unmount();
      root = null;
    });
    expect(window.gm_authFailure).toBe(previous);
    expect(__testing.getInstallCount()).toBe(0);
  });

  // --------------------------------------------------------------------
  // useGoogleMapsKeyError subscriber
  // --------------------------------------------------------------------
  it("a subscriber mounted *after* the error sees the latest code immediately (not just future ones)", async () => {
    // Report before any subscriber exists. This mirrors the real flow
    // where the property-location card detects + reports a key error,
    // and only later does the operator switch to the map view that
    // mounts the portfolio map.
    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });
    await mount(<SubscriberProbe />);
    expect(readProbe().code).toBe("InvalidKeyMapError");
    expect(readProbe().message).toBe(MAPS_ERROR_MESSAGES.InvalidKeyMapError);
  });

  // --------------------------------------------------------------------
  // clearGoogleMapsKeyError — the "Re-check key" affordance (Task #181)
  //
  // After an operator fixes their Maps key in Google Cloud Console (or
  // /api/config returns a rotated value), the in-card recheck button
  // re-fetches /api/config and on success calls
  // `clearGoogleMapsKeyError` to drop every Maps surface out of its
  // rejected branch. The contract this section pins down:
  //   1) The latest-code subscribers see `null` (panels disappear).
  //   2) The per-session dedupe set is reset, so a *next* failure for
  //      the same code fires a fresh toast instead of being silently
  //      swallowed because we'd already toasted that code earlier.
  //   3) Any still-visible toast from the previous error is dismissed
  //      so the operator isn't lied to with a stale "key rejected"
  //      banner sitting next to a Maps surface that just recovered.
  // --------------------------------------------------------------------
  it("clearGoogleMapsKeyError: subscribers see the code go back to null after a clear", async () => {
    await mount(
      <>
        <ListenerProbe />
        <SubscriberProbe />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });
    expect(readProbe().code).toBe("RefererNotAllowedMapError");

    await act(async () => {
      clearGoogleMapsKeyError();
    });
    // Subscribers must re-render with the cleared state — leaving them
    // pinned to the old code would mean the panels stay up even after
    // recheck succeeded.
    expect(readProbe().code).toBe("");
    expect(readProbe().message).toBe("");
  });

  it("clearGoogleMapsKeyError: resets the per-session dedupe set so the *next* failure fires a fresh toast", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    // First failure toasts, dedupe set remembers the code.
    expect(__testing.getNotifiedCodes().has("OverQuotaMapError")).toBe(true);

    await act(async () => {
      clearGoogleMapsKeyError();
    });
    // The dedupe set must be empty again — otherwise a second
    // OverQuotaMapError after a failed recheck would be silently
    // swallowed and the operator would have no notification of the
    // continued failure (the panel would re-appear, but the toast
    // wouldn't, which would defeat the "fresh signal on next failure"
    // contract documented on the export).
    expect(__testing.getNotifiedCodes().size).toBe(0);

    // Now report the same code again — it must fire a NEW toast.
    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    expect(__testing.getNotifiedCodes().has("OverQuotaMapError")).toBe(true);
  });

  it("clearGoogleMapsKeyError: dismisses the still-visible key-error toast", async () => {
    await mount(
      <>
        <ListenerProbe />
        <ToastReader />
      </>,
    );
    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });
    // The toast is up and visible (open=true).
    const before = readToasts();
    expect(before).toHaveLength(1);
    expect(before[0].open).toBe(true);
    expect(before[0].description).toBe(
      MAPS_ERROR_MESSAGES.InvalidKeyMapError,
    );

    await act(async () => {
      clearGoogleMapsKeyError();
    });

    // The toast hook keeps dismissed toasts in its queue (open=false)
    // for a long timeout before garbage-collecting them, so the queue
    // *length* isn't a reliable "is anything visible?" signal — the
    // open flag is. After clear, every key-error toast must be
    // closed so the operator doesn't see a stale "key rejected"
    // banner sitting next to a Maps surface that just recovered.
    const after = readToasts();
    for (const t of after) {
      expect(t.open).toBe(false);
    }
  });

  it("clearGoogleMapsKeyError: is a safe no-op when the store is already empty", async () => {
    await mount(
      <>
        <ListenerProbe />
        <SubscriberProbe />
        <ToastReader />
      </>,
    );
    // No error reported — the shared store starts empty.
    expect(readProbe().code).toBe("");

    // The useToast hook keeps a module-scoped queue that survives
    // across tests (the reducer's `memoryState` is intentionally
    // long-lived so toasts persist across re-renders), so we can't
    // assert "queue is exactly empty" here without leaking ordering
    // assumptions from previous tests. Snapshot the count BEFORE the
    // clear and assert that calling clear on an empty store didn't
    // *add* anything — that's the actual contract.
    const toastCountBefore = readToasts().length;

    // Should not throw and should leave the probe at empty.
    await act(async () => {
      clearGoogleMapsKeyError();
    });

    expect(readProbe().code).toBe("");
    expect(readToasts().length).toBe(toastCountBefore);
  });
});

// ---------------------------------------------------------------------------
// Toast-level Re-check action (Task #189)
//
// The in-card error panels already carry a Re-check affordance, but an
// operator who dismisses the toast and switches to a non-Maps page
// (Customers, Finance, …) loses that recovery path until they navigate
// back to a Maps surface. This describe block pins down that the Re-check
// button rendered inside the toast itself drives the same recovery
// pipeline — refetch /api/config, on success clear the shared key-error
// store, on failure leave both the store and the toast intact so the
// operator isn't lied to about whether the key was reconfirmed.
//
// Mounts the real Toaster (so the action component actually renders and
// its useRecheckGoogleMapsKey hook runs) inside a QueryClientProvider
// (required for `useQueryClient` not to throw) plus a fetch mock that
// stands in for /api/config. The describe block is its own block so we
// don't pull QueryClientProvider into the lighter-weight tests above.
// ---------------------------------------------------------------------------
describe("Maps key-error toast: Re-check action", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalGmAuthFailure: (() => void) | undefined;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    __resetGoogleMapsKeyErrorForTest();
    expect(__testing.getInstallCount()).toBe(0);
    originalGmAuthFailure = window.gm_authFailure;
    originalFetch = globalThis.fetch;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    window.gm_authFailure = originalGmAuthFailure;
    globalThis.fetch = originalFetch;
    __resetGoogleMapsKeyErrorForTest();
  });

  function ListenerProbe() {
    useGoogleMapsKeyErrorToastListener();
    return null;
  }

  // Subscribe to /api/config so the runtime-config query lives in the
  // react-query cache. Without an active observer the cache is empty
  // and `queryClient.refetchQueries` (used by `useRecheckGoogleMapsKey`)
  // has nothing to re-fire — the toast button would silently no-op,
  // which is not what production sees: in real usage at least one Maps
  // surface (or the app-level config consumer) has already mounted the
  // query by the time a key-error toast appears.
  function ConfigQueryProbe() {
    useRuntimeConfigQuery(true);
    return null;
  }

  async function mountWithToaster(): Promise<{ client: QueryClient }> {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={client}>
          <ConfigQueryProbe />
          <ListenerProbe />
          <Toaster />
        </QueryClientProvider>,
      );
    });
    return { client };
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  async function waitFor(
    predicate: () => boolean,
    { timeoutMs = 1000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, intervalMs));
      });
      if (predicate()) return;
    }
    throw new Error(
      `waitFor: predicate did not become true within ${timeoutMs}ms`,
    );
  }

  function getRecheck(): HTMLButtonElement | null {
    return document.querySelector(
      '[data-testid="maps-key-error-toast-recheck"]',
    ) as HTMLButtonElement | null;
  }

  function getConsoleLink(): HTMLAnchorElement | null {
    return document.querySelector(
      '[data-testid="maps-key-error-toast-console-link"]',
    ) as HTMLAnchorElement | null;
  }

  it("renders a Re-check button next to the existing Open-in-Console link", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ googleMapsApiKey: "fixed-key" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await mountWithToaster();
    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });

    const recheck = getRecheck();
    expect(recheck).not.toBeNull();
    // The label reads clearly so an operator skimming the toast knows
    // what the button does — a generic icon next to the existing
    // "Open in Google Cloud Console" deep link would be ambiguous.
    expect((recheck!.textContent ?? "").toLowerCase()).toContain("re-check");
    // It's a real button (not asChild-wrapping an anchor), so clicking
    // it doesn't navigate the operator away from their current page.
    expect(recheck!.tagName).toBe("BUTTON");
    expect(recheck!.disabled).toBe(false);

    // The Console deep link must still be present alongside the new
    // Re-check button — the new affordance complements, not replaces,
    // the existing one.
    const link = getConsoleLink();
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "https://console.cloud.google.com/apis/credentials",
    );
  });

  it("clicking Re-check refetches /api/config and clears the shared store on success", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ googleMapsApiKey: "freshly-fixed-key" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await mountWithToaster();
    // Wait for the ConfigQueryProbe's initial /api/config fetch to
    // settle before flipping into the rejected branch — otherwise the
    // recheck assertion below races the initial mount and `callsBefore`
    // would be a moving target.
    await waitFor(() => calls >= 1);
    await settle();

    await act(async () => {
      reportGoogleMapsKeyError("InvalidKeyMapError");
    });
    expect(__testing.getNotifiedCodes().has("InvalidKeyMapError")).toBe(true);

    const callsBefore = calls;
    const recheck = getRecheck();
    expect(recheck).not.toBeNull();
    await act(async () => {
      recheck!.click();
    });

    // The recheck must hit /api/config — guards against a regression
    // where the toast button merely cleared the local store without
    // actually re-confirming the runtime config.
    await waitFor(() => calls > callsBefore);
    expect(calls).toBeGreaterThan(callsBefore);
    const lastCall = fetchMock.mock.calls.at(-1) as unknown as [
      RequestInfo | URL,
      ...unknown[],
    ];
    expect(String(lastCall[0])).toContain("/api/config");

    // And on success the shared dedupe set must be empty — the store
    // is cleared so every Maps surface drops out of its rejected
    // branch and the *next* failure for the same code can fire a
    // fresh toast (instead of being silently swallowed because we'd
    // already toasted that code earlier in the session).
    await waitFor(() => __testing.getNotifiedCodes().size === 0);
    expect(__testing.getNotifiedCodes().has("InvalidKeyMapError")).toBe(false);
  });

  it("leaves the store intact when /api/config still errors on recheck (no false recovery)", async () => {
    // When the operator clicks Re-check but /api/config itself errors
    // — the api-server is down, the network blipped, the key is still
    // bad — we must NOT silently drop the key-error state and pretend
    // the key is fixed. Doing so would lie to the operator and send
    // them chasing the wrong fix. The shared store stays populated;
    // clicking again retries.
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await mountWithToaster();
    // Let the ConfigQueryProbe's initial /api/config fetch fire (and
    // fail) so `callsBefore` is a stable baseline — otherwise asserting
    // `calls > callsBefore` below would race the initial mount.
    await waitFor(() => calls >= 1);
    await settle();

    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });
    expect(__testing.getNotifiedCodes().has("OverQuotaMapError")).toBe(true);

    const callsBefore = calls;
    const recheck = getRecheck();
    expect(recheck).not.toBeNull();
    await act(async () => {
      recheck!.click();
    });
    // Wait for the recheck's failed refetch to actually fire (one more
    // call than the baseline). Asserting against `callsBefore` rather
    // than `calls >= 1` rules out the initial mount fetch satisfying
    // the predicate without the click ever triggering anything.
    await waitFor(() => calls > callsBefore);
    await settle();

    // Surface stays rejected — the dedupe set still holds the code,
    // and a future success-path recheck can still reset it.
    expect(__testing.getNotifiedCodes().has("OverQuotaMapError")).toBe(true);
  });
});
