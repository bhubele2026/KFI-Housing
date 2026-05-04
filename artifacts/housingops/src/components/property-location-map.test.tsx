import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PropertyLocationMap } from "./property-location-map";

// These tests pin down the three render branches of the property location
// card — full embed (address + key), graceful fallback (address but no
// key), and empty state (no address) — plus the exact Google Maps URLs
// the card hands off to. A regression in any of these would either break
// the embed iframe, drop the operator's one-click jump to maps, or paint
// a misleading "set up your key" warning over a working map.

describe("PropertyLocationMap", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
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
  });

  async function render(node: React.ReactElement) {
    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("renders the embedded map, search/directions URLs, and address block when an address and key are present", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key-abc"
      />,
    );

    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    // Embed URL must include the key and the URL-encoded full address.
    // Spaces become +; commas become %2C in encodeURIComponent.
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(iframe!.src).toContain("https://www.google.com/maps/embed/v1/place");
    expect(iframe!.src).toContain(`key=${encodeURIComponent("test-key-abc")}`);
    expect(iframe!.src).toContain(`q=${expectedQuery}`);

    // The whole map area is wrapped in an anchor that opens the address
    // in a new tab via Google Maps Search.
    const mapLink = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(mapLink).not.toBeNull();
    expect(mapLink!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(mapLink!.target).toBe("_blank");
    expect(mapLink!.rel).toContain("noopener");

    // Directions affordance opens the same address in directions mode.
    const dir = get("property-location-directions-link") as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    expect(dir!.href).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${expectedQuery}`,
    );
    expect(dir!.target).toBe("_blank");

    // Address block: street on first line, "city, state zip" on second.
    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("100 Oak Way");
    expect(addr!.textContent).toContain("Austin, TX 78701");

    // The fallback / empty-state surfaces must NOT be visible alongside
    // a working embed — they each represent a different render branch.
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-empty")).toBeNull();
  });

  it("falls back to a plain 'Open in Google Maps' link with a setup note when the API key is missing", async () => {
    await render(
      <PropertyLocationMap
        address="200 Maple Dr"
        city="Dallas"
        state="TX"
        zip="75201"
        apiKey=""
      />,
    );

    // No iframe and no map-link anchor — the embed branch is off.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();

    const fallback = get("property-location-fallback");
    expect(fallback).not.toBeNull();
    // Inline note tells the operator a Google Maps API key needs to be set up.
    expect(fallback!.textContent).toContain("VITE_GOOGLE_MAPS_API_KEY");

    // Plain link still gives the operator a one-click jump to Google Maps.
    const link = get("property-location-fallback-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    const expectedQuery = encodeURIComponent("200 Maple Dr, Dallas, TX 75201");
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(link!.target).toBe("_blank");

    // Address block + Directions link still render even without the embed.
    expect(get("property-location-address")?.textContent).toContain(
      "200 Maple Dr",
    );
    const dir = get("property-location-directions-link") as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    expect(dir!.href).toContain("destination=" + expectedQuery);

    // Empty state must NOT be visible — we DO have an address.
    expect(get("property-location-empty")).toBeNull();
  });

  it("renders a friendly empty state instead of a broken/blank map when every address field is empty", async () => {
    await render(
      <PropertyLocationMap
        address=""
        city=""
        state=""
        zip=""
        apiKey="test-key-abc"
      />,
    );

    const empty = get("property-location-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent?.toLowerCase()).toContain(
      "add an address",
    );

    // None of the active branches should render alongside the empty state.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-directions-link")).toBeNull();
    expect(get("property-location-address")).toBeNull();
  });

  it("treats whitespace-only address fields as empty and shows the empty state", async () => {
    // Defends against a regression that .length-checked the raw strings
    // instead of trimming — an operator who typed only spaces would
    // otherwise see a broken iframe pointed at "%20%20%20".
    await render(
      <PropertyLocationMap
        address="   "
        city=" "
        state=""
        zip="  "
        apiKey="test-key-abc"
      />,
    );

    expect(get("property-location-empty")).not.toBeNull();
    expect(get("property-location-map-iframe")).toBeNull();
  });

  it("URL-encodes special characters in the address so the search/embed URLs stay valid", async () => {
    // An address with `&`, `#`, and a unit number — characters that
    // would break the search URL if interpolated raw. encodeURIComponent
    // turns `&`→`%26`, `#`→`%23`, ` `→`%20`, `,`→`%2C`.
    await render(
      <PropertyLocationMap
        address="100 R&D Way #5"
        city="San José"
        state="CA"
        zip="95110"
        apiKey="test-key-abc"
      />,
    );

    const expectedQuery = encodeURIComponent(
      "100 R&D Way #5, San José, CA 95110",
    );
    const link = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    // Raw special chars must NOT appear in the URL — only their encoded
    // forms — otherwise the URL would be malformed.
    expect(link!.href).not.toContain(" ");
    expect(link!.href).not.toContain("#");
  });

  it("renders only the parts of the address the user has filled in (street present, city/state/zip blank)", async () => {
    // Partial-address case: street only, no city/state/zip yet. The
    // card should still embed and link with whatever is filled in
    // rather than waiting for a fully-formatted address.
    await render(
      <PropertyLocationMap
        address="500 Elm Rd"
        city=""
        state=""
        zip=""
        apiKey="test-key-abc"
      />,
    );

    const expectedQuery = encodeURIComponent("500 Elm Rd");
    const link = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );

    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("500 Elm Rd");
    // No empty "," from the missing city/state/zip line.
    expect(addr!.textContent).not.toContain(", ,");
  });
});
