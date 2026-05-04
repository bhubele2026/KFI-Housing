import { describe, it, expect } from "vitest";
import {
  RUNTIME_CONFIG_REFETCH_INTERVAL_MS,
  RUNTIME_CONFIG_STALE_TIME_MS,
  RUNTIME_CONFIG_STALE_WARNING_MS,
} from "./use-runtime-config";

// These constants are the contract that lets a rotated
// GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_MAP_ID land in open browser tabs
// within a bounded window without a hard refresh. The actual integration
// (refetch fires → component re-renders with new values → map / iframe
// re-creates against the new key) is exercised end-to-end in the
// portfolio-map and property-location-map test suites; this file pins
// down the rotation budget itself so a future refactor that bumps the
// interval to e.g. 30 minutes (which would silently regress operator
// expectations) is caught here, loudly.

describe("runtime config refetch budget", () => {
  it("re-checks /api/config on a bounded interval (sub-five-minute window for rotation to land)", () => {
    expect(RUNTIME_CONFIG_REFETCH_INTERVAL_MS).toBeGreaterThan(0);
    // Operator-facing contract: rotation should land within minutes,
    // not hours. Anything above ~5 minutes would defeat the point of
    // a "no rebuild, no web restart" rotation flow.
    expect(RUNTIME_CONFIG_REFETCH_INTERVAL_MS).toBeLessThanOrEqual(
      5 * 60_000,
    );
  });

  it("keeps the cache fresh for at least a few seconds so back-to-back mounts share the response, but not so long that it masks a due rotation", () => {
    expect(RUNTIME_CONFIG_STALE_TIME_MS).toBeGreaterThan(0);
    // Stale time must never exceed the refetch interval — otherwise
    // a fresh cached value would suppress the periodic refetch and
    // open tabs would never see the rotation.
    expect(RUNTIME_CONFIG_STALE_TIME_MS).toBeLessThanOrEqual(
      RUNTIME_CONFIG_REFETCH_INTERVAL_MS,
    );
  });

  it("only raises the stale-refresh warning after a sustained failure window — strictly more than one missed refetch but still within minutes", () => {
    // The warning is meant to ride out a single transient blip and
    // *only* fire when the operator's tab has truly been unable to
    // see new config values. A threshold ≤ one refetch interval
    // would cry wolf on every transient hiccup; a threshold beyond
    // ~5 minutes would defeat the point of warning at all.
    expect(RUNTIME_CONFIG_STALE_WARNING_MS).toBeGreaterThan(
      RUNTIME_CONFIG_REFETCH_INTERVAL_MS,
    );
    expect(RUNTIME_CONFIG_STALE_WARNING_MS).toBeLessThanOrEqual(
      5 * 60_000,
    );
  });
});
