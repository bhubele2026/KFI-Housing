import { describe, expect, it } from "vitest";
import reconciliationRouter, { monthBounds } from "./reconciliation";

/** Extract `{method, path}` pairs from an Express Router for shape tests. */
function routesOf(router: typeof reconciliationRouter): Array<{ method: string; path: string }> {
  // Router internals: `stack` is an array of layers; each route layer has
  // `.route.path` and `.route.methods` keyed by lowercase HTTP verb. This
  // shape has been stable across Express 4.x.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: any[] = (router as any).stack ?? [];
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) {
        if (layer.route.methods[m]) out.push({ method: m.toUpperCase(), path: layer.route.path });
      }
    }
  }
  return out;
}

describe("reconciliation router shape", () => {
  const routes = routesOf(reconciliationRouter);

  it("exposes GET /reconciliation/properties and its /summary alias", () => {
    const paths = routes.filter((r) => r.method === "GET").map((r) => r.path);
    expect(paths).toContain("/reconciliation/properties");
    expect(paths).toContain("/reconciliation/summary");
  });

  it("exposes POST /reconciliation/transactions/:id/map and /remap alias", () => {
    const paths = routes.filter((r) => r.method === "POST").map((r) => r.path);
    expect(paths).toContain("/reconciliation/transactions/:id/map");
    expect(paths).toContain("/reconciliation/transactions/:id/remap");
  });

  it("/summary and /properties bind the same handler (no req.url mutation)", () => {
    // Both routes should be wired to the shared `handlePropertiesRollup`
    // function. Compare layer handle references via the router stack so a
    // future refactor that re-introduces `req.url = ...; next();` (which
    // doesn't re-dispatch through the router) fails this test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = (reconciliationRouter as any).stack ?? [];
    const propsLayer = stack.find(
      (l) => l.route?.path === "/reconciliation/properties" && l.route.methods.get,
    );
    const summaryLayer = stack.find(
      (l) => l.route?.path === "/reconciliation/summary" && l.route.methods.get,
    );
    expect(propsLayer).toBeDefined();
    expect(summaryLayer).toBeDefined();
    expect(propsLayer.route.stack[0].handle).toBe(summaryLayer.route.stack[0].handle);
  });
});

describe("monthBounds", () => {
  it("returns half-open bounds with exclusive end", () => {
    const b = monthBounds("2026-05");
    expect(b).toEqual({ start: "2026-05-01", endExclusive: "2026-06-01" });
  });

  it("rolls year over correctly for December", () => {
    const b = monthBounds("2026-12");
    expect(b).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });

  it("rejects malformed input", () => {
    expect(monthBounds("not-a-month")).toBeNull();
    expect(monthBounds("2026-5")).toBeNull();
    expect(monthBounds("2026/05")).toBeNull();
  });

  it("date filter using endExclusive does NOT include the next month's first day", () => {
    const b = monthBounds("2026-05");
    expect(b).not.toBeNull();
    const firstOfNext = "2026-06-01";
    expect(firstOfNext < b!.endExclusive).toBe(false);
    expect("2026-05-31" < b!.endExclusive).toBe(true);
    expect("2026-05-01" >= b!.start).toBe(true);
  });
});
