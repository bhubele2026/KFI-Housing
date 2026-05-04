import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useGoogleMapsKeyError,
  useGoogleMapsKeyErrorToastListener,
  reportGoogleMapsKeyError,
  extractGoogleMapsErrorCode,
  MAPS_ERROR_MESSAGES,
  MAPS_AUTH_FAILURE_CODE,
  __resetGoogleMapsKeyErrorForTest,
  __testing,
} from "./use-google-maps-key-error";
import { useToast } from "./use-toast";

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
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            data-title={String(t.title ?? "")}
            data-description={String(t.description ?? "")}
            data-variant={String(t.variant ?? "default")}
          />
        ))}
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
  }> {
    const els = container.querySelectorAll('[data-testid="toast"]');
    return Array.from(els).map((el) => ({
      title: el.getAttribute("data-title") ?? "",
      description: el.getAttribute("data-description") ?? "",
      variant: el.getAttribute("data-variant") ?? "",
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
});
