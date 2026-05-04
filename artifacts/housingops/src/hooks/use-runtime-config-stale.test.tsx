import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  RUNTIME_CONFIG_STALE_WARNING_MS,
  useRuntimeConfigRefreshStale,
} from "./use-runtime-config";

// Behavior contract for `useRuntimeConfigRefreshStale` (Task #175).
//
// The hook is the brain behind the in-page "your tab might be using
// outdated map settings" warning that the portfolio map and the
// property-detail Location card render. It must:
//
//   • Stay false until at least one successful /api/config fetch has
//     landed in this session — the first-load failure case is owned by
//     a different, dedicated error branch with its own Retry button.
//   • Stay false when /api/config is healthy.
//   • Stay false during the initial moments of a failure streak, even
//     well past the refetch interval — a single missed poll is not
//     enough signal.
//   • Flip true once the failure streak has been continuous for at
//     least RUNTIME_CONFIG_STALE_WARNING_MS.
//   • Flip back to false the instant a refetch succeeds again, and
//     restart the timer from scratch on a subsequent failure.
//
// We exercise each of these with a tiny harness component that re-runs
// the hook against a `query`-shaped prop the test mutates between
// renders, simulating react-query's transitions without taking a
// dependency on the real QueryClient (which would also force us to
// pump real timers through its scheduler).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface QueryShape {
  isError: boolean;
  isSuccess: boolean;
  data: unknown;
  dataUpdatedAt?: number;
}

function Harness({
  query,
  onRender,
}: {
  query: QueryShape;
  onRender: (isStale: boolean) => void;
}) {
  const isStale = useRuntimeConfigRefreshStale(query);
  onRender(isStale);
  return null;
}

describe("useRuntimeConfigRefreshStale", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let lastValue: boolean | null = null;
  const onRender = (v: boolean) => {
    lastValue = v;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    lastValue = null;
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  async function renderWith(query: QueryShape) {
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness query={query} onRender={onRender} />);
    });
  }

  async function rerenderWith(query: QueryShape) {
    if (!root) throw new Error("renderWith must be called before rerenderWith");
    const r = root;
    await act(async () => {
      r.render(<Harness query={query} onRender={onRender} />);
    });
  }

  // Advances the fake clock by `ms` and lets pending React state
  // updates (the hook's `setInterval` callback that re-reads `now`)
  // flush before returning. Mirrors how `vi.useFakeTimers` is normally
  // paired with `act` in React 19 tests.
  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("stays false on first load while the query is still pending (no data, no error)", async () => {
    await renderWith({ isError: false, isSuccess: false, data: undefined });
    expect(lastValue).toBe(false);
    // Even after a long time on the loading state, no warning fires —
    // the operator's "did /api/config ever come back at all?" question
    // is owned by the dedicated isConfigError branch, not this hook.
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS * 2);
    expect(lastValue).toBe(false);
  });

  it("stays false when the very first fetch errors before any successful response — that case is the dedicated error branch's job, not ours", async () => {
    await renderWith({ isError: true, isSuccess: false, data: undefined });
    expect(lastValue).toBe(false);
    // Even well past the would-be threshold, with `data` still
    // undefined we never fire — there's no "stale" config to warn
    // about because there has never *been* a config in this session.
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS * 2);
    expect(lastValue).toBe(false);
  });

  it("stays false while /api/config is healthy", async () => {
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS * 2);
    expect(lastValue).toBe(false);
  });

  it("stays false for the first failure of a streak — a single missed refetch is not enough signal to warn", async () => {
    // Simulate: first refetch landed successfully → cached data
    // present → second refetch fails → react-query exposes
    // `isError: true` while keeping the previous `data`.
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);

    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);

    // Push the clock just under the threshold — should still be
    // silent. This is the "transient blip" case.
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS - 1_000);
    expect(lastValue).toBe(false);
  });

  it("flips to true only after the failure streak has been continuous for ≥ RUNTIME_CONFIG_STALE_WARNING_MS", async () => {
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
    });
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);

    // Cross the threshold — generous slack on top to absorb any rounding
    // in the hook's interval-driven `now` re-reads.
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS + 5_000);
    expect(lastValue).toBe(true);
  });

  it("flips back to false the instant a refetch succeeds, and restarts the streak timer for any subsequent failure", async () => {
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
    });
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
    });
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS + 5_000);
    expect(lastValue).toBe(true);

    // Recovery: a refetch finally lands. The warning must clear
    // immediately — no "still showing for a few more polls" tail
    // (operators rely on this to confirm a fix worked).
    await rerenderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);

    // A *new* failure streak must get the full warning window again,
    // not be treated as a continuation of the prior one. Otherwise the
    // hook would warn on the very first failure after recovery, which
    // would make recovery flicker the warning back on for what looks
    // like no reason.
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
    });
    expect(lastValue).toBe(false);

    await advance(RUNTIME_CONFIG_STALE_WARNING_MS - 1_000);
    expect(lastValue).toBe(false);

    await advance(2_000);
    expect(lastValue).toBe(true);
  });

  // SSE-push behavior — Task #182.
  //
  // The stream hook (`useRuntimeConfigStream`) lands rotated values
  // into the same react-query cache as the polling fallback by calling
  // `setQueryData`. That bumps `dataUpdatedAt` *without* clearing
  // `isError` (the last polled refetch can still be in an error state).
  //
  // The contract these tests pin down: an SSE push that advances
  // `dataUpdatedAt` past the start of the current failure streak must
  // be treated as a recovery. Otherwise a tab whose polling fallback
  // is permanently failing — but whose push channel is healthy and
  // delivering fresh values every few seconds — would still raise the
  // "your tab might be using outdated map settings" warning, which
  // would be flatly wrong.
  it("treats an SSE push (`dataUpdatedAt` advancing while `isError` stays true) as a recovery so the warning doesn't fire while the push channel keeps delivering values", async () => {
    // Anchor every `dataUpdatedAt` value to the fake clock's *current*
    // wall time. `vi.useFakeTimers()` defaults to the real Date.now()
    // at install, so a small literal like `1_000` would always be
    // *less* than the streak start the hook captures internally, and
    // the recovery branch (which fires only when dataUpdatedAt > prev
    // streak start) would never trigger — the test would pass for the
    // wrong reason or fail outright.
    const t0 = Date.now();
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
      dataUpdatedAt: t0,
    });
    expect(lastValue).toBe(false);

    // Now the polling fallback enters a permanent failure streak. The
    // hook captures `Date.now()` (== t0 at this moment) as the streak
    // anchor on this render's effect.
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
      dataUpdatedAt: t0,
    });
    expect(lastValue).toBe(false);

    // Advance to just under the warning threshold to set up the
    // "would otherwise fire imminently" precondition.
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS - 1_000);
    expect(lastValue).toBe(false);

    // SSE push lands: setQueryData bumps `dataUpdatedAt` to a value
    // strictly newer than the streak anchor (the hook compares
    // dataUpdatedAt to the captured streak start). The polled refetch
    // is still in `isError: true`. Without the recovery branch the
    // warning would flip true within the next second.
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-B" },
      dataUpdatedAt: Date.now() + 1,
    });

    // Walk well past the original threshold; the warning must stay
    // silent because the push reset the streak.
    await advance(2_000);
    expect(lastValue).toBe(false);

    // A fresh push every cycle keeps the warning permanently silent
    // even though `isError` never clears.
    for (let i = 1; i <= 3; i++) {
      await advance(RUNTIME_CONFIG_STALE_WARNING_MS / 2);
      await rerenderWith({
        isError: true,
        isSuccess: false,
        data: { googleMapsApiKey: `key-push-${i}` },
        dataUpdatedAt: Date.now() + 1,
      });
      expect(lastValue).toBe(false);
    }
  });

  it("still flips to true when *neither* SSE push nor poll lands for the warning window — the fallback signal must not be defeated by the new field being present-but-stale", async () => {
    const t0 = Date.now();
    await renderWith({
      isError: false,
      isSuccess: true,
      data: { googleMapsApiKey: "key-A" },
      dataUpdatedAt: t0,
    });
    // Polling errors, and crucially `dataUpdatedAt` does NOT advance —
    // because nothing has delivered a fresh value (neither poll nor
    // push). This is exactly the sustained-failure case the warning
    // is for.
    await rerenderWith({
      isError: true,
      isSuccess: false,
      data: { googleMapsApiKey: "key-A" },
      dataUpdatedAt: t0,
    });
    await advance(RUNTIME_CONFIG_STALE_WARNING_MS + 5_000);
    expect(lastValue).toBe(true);
  });
});
