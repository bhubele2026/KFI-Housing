import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { parseAssistantContext, pageChipsFor } from "./index";

function mockReq(ctx: Record<string, unknown>): Request {
  return {
    headers: {
      "x-assistant-context": JSON.stringify(ctx),
      "x-user-id": "user-test",
    },
  } as unknown as Request;
}

/**
 * Mirrors what the `/assistant/page-chips` route handler does
 * end-to-end: parse the X-Assistant-Context header (same path
 * /assistant/chat takes) then run pageChipsFor. Keeps this test honest
 * about the actual wire shape the web client sends.
 */
function chipsFor(ctx: Record<string, unknown>) {
  return pageChipsFor(parseAssistantContext(mockReq(ctx)));
}

describe("pageChipsFor", () => {
  it("returns dashboard chips with 'What needs attention?' and 'Find unmatched payroll'", () => {
    const chips = chipsFor({ customerId: "All", page: "/dashboard" });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("What needs attention?");
    expect(labels).toContain("Find unmatched payroll");
  });

  it("returns property-focus chips with 'Expiring leases here', 'Vacant beds', 'Add a building'", () => {
    const chips = chipsFor({
      customerId: "All",
      page: "/properties/p-1",
      focus: { entityType: "property", entityId: "p-1" },
    });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Expiring leases here");
    expect(labels).toContain("Vacant beds");
    expect(labels).toContain("Add a building");
  });

  it("returns lease-focus chips with 'Extend by 6 months' and 'Other leases here'", () => {
    const chips = chipsFor({
      customerId: "All",
      page: "/leases/l-1",
      focus: { entityType: "lease", entityId: "l-1" },
    });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Extend by 6 months");
    expect(labels).toContain("Other leases here");
  });

  it("returns occupant-focus chips with 'Recent deductions' and 'Move to another bed'", () => {
    const chips = chipsFor({
      customerId: "All",
      page: "/occupants/o-1",
      focus: { entityType: "occupant", entityId: "o-1" },
    });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Recent deductions");
    expect(labels).toContain("Move to another bed");
  });

  it("caps each page at 4 chips", () => {
    for (const focus of [
      { entityType: "property", entityId: "p-1" },
      { entityType: "building", entityId: "b-1" },
      { entityType: "lease", entityId: "l-1" },
      { entityType: "occupant", entityId: "o-1" },
      { entityType: "customer", entityId: "c-1" },
    ]) {
      const chips = chipsFor({ customerId: "All", focus });
      expect(chips.length).toBeLessThanOrEqual(4);
      expect(chips.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("every chip prompt is a full natural-language sentence", () => {
    const chips = chipsFor({ customerId: "All", page: "/dashboard" });
    for (const chip of chips) {
      expect(chip.prompt.length).toBeGreaterThan(chip.label.length);
      expect(chip.prompt).toMatch(/[.?]$/);
    }
  });

  it("returns no chips for an unknown page with no focus", () => {
    const chips = chipsFor({ customerId: "All", page: "/something-else" });
    expect(chips).toEqual([]);
  });
});
