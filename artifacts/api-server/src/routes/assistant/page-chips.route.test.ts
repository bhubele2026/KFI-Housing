import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";
import assistantRouter from "./index";

// End-to-end coverage of GET /api/assistant/page-chips (Task #670):
// proves that the focus value parsed from the X-Assistant-Context
// header drives the right chip set for the property / lease / occupant
// detail routes — which is the bug the original Phase-1 client patch
// would have shipped without (it omitted `focus` from the header).

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(assistantRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function fetchChips(ctx: Record<string, unknown>): Promise<string[]> {
  const r = await fetch(`${baseUrl}/assistant/page-chips`, {
    method: "GET",
    headers: {
      "X-Assistant-Context": JSON.stringify(ctx),
    },
  });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { chips: Array<{ label: string; prompt: string }> };
  return body.chips.map((c) => c.label);
}

describe("GET /api/assistant/page-chips", () => {
  it("returns property-focus chips for /properties/:id", async () => {
    const labels = await fetchChips({
      customerId: "All",
      page: "/properties/p-1",
      focus: { entityType: "property", entityId: "p-1" },
    });
    expect(labels).toContain("Expiring leases here");
    expect(labels).toContain("Vacant beds");
    expect(labels).toContain("Add a building");
  });

  it("returns lease-focus chips for /leases/:id", async () => {
    const labels = await fetchChips({
      customerId: "All",
      page: "/leases/l-1",
      focus: { entityType: "lease", entityId: "l-1" },
    });
    expect(labels).toContain("Extend by 6 months");
    expect(labels).toContain("Other leases here");
  });

  it("returns occupant-focus chips for /occupants/:id", async () => {
    const labels = await fetchChips({
      customerId: "All",
      page: "/occupants/o-1",
      focus: { entityType: "occupant", entityId: "o-1" },
    });
    expect(labels).toContain("Recent deductions");
    expect(labels).toContain("Move to another bed");
  });

  it("returns dashboard chips when no focus is sent", async () => {
    const labels = await fetchChips({ customerId: "All", page: "/dashboard" });
    expect(labels).toContain("What needs attention?");
    expect(labels).toContain("Find unmatched payroll");
  });
});
