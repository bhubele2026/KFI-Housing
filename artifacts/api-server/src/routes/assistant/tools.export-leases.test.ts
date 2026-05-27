import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same PGlite swap as the other assistant integration tests.
vi.mock("@workspace/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@workspace/db/schema");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    db,
    pool: { end: async () => { await client.close(); } },
    ...schema,
  };
});

const dbModule = await import("@workspace/db");
const {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  assistantExportsTable,
} = dbModule as typeof import("@workspace/db");
const { exportLeasesTool } = await import("./export-tools");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as typeof import("xlsx");

beforeAll(async () => {
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@workspace/db/schema");
  const { apply } = await pushSchema(schema as any, db as any);
  await apply();

  await db.insert(customersTable).values([
    { id: "custA", name: "Customer A" },
    { id: "custB", name: "Customer B" },
  ]);
  await db.insert(propertiesTable).values([
    { id: "propA", name: "Property A", customerId: "custA" },
    { id: "propB", name: "Property B", customerId: "custB" },
  ]);
  await db.insert(leasesTable).values([
    {
      id: "L1",
      propertyId: "propA",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      monthlyRent: 1500,
      status: "Active",
    },
    {
      id: "L2",
      propertyId: "propA",
      startDate: "2026-01-01",
      endDate: "2026-06-01",
      monthlyRent: 800,
      status: "Expiring",
    },
    {
      id: "L3",
      propertyId: "propB",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      monthlyRent: 2200,
      status: "Active",
    },
  ]);
}, 60_000);

afterAll(async () => {
  await (dbModule as any).pool.end();
});

const ctx = {
  userId: "user-A",
  conversationId: "conv-1",
} as any;

describe("export_leases tool", () => {
  it("filters by customerId, persists an assistant_exports row, and returns a download envelope", async () => {
    const result = await exportLeasesTool.execute(
      { format: "xlsx", customerId: "custA" },
      ctx,
    );
    expect(result.format).toBe("xlsx");
    expect(result.rowCount).toBe(2);
    expect(result.sizeBytes).toBeGreaterThan(500);
    expect(result.filename).toMatch(/^leases-customer-a-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(result.exportId).toMatch(/^ax-/);

    // The row must be persisted exactly as returned — the download
    // route reads back from this table.
    const [row] = await db
      .select()
      .from(assistantExportsTable);
    expect(row).toBeDefined();
    expect(row.userId).toBe("user-A");
    expect(row.conversationId).toBe("conv-1");
    expect(row.toolName).toBe("export_leases");
    expect(row.entityType).toBe("leases");
    expect(row.rowCount).toBe(2);
    expect(row.sizeBytes).toBe(result.sizeBytes);
    // ~24h TTL (allow a generous window for slow test runs).
    const ttlMs = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(25 * 60 * 60 * 1000);

    // The persisted bytes must be a real xlsx with the formula columns
    // intact (the LIVE recalc is THE acceptance criterion for Task #681).
    const content = Buffer.isBuffer(row.content)
      ? row.content
      : Buffer.from(row.content as unknown as Uint8Array);
    const wb = XLSX.read(content, { type: "buffer", cellFormula: true });
    expect(wb.SheetNames).toContain("Data");
    expect(wb.SheetNames).toContain("Totals");
    // Days-to-expiry is column L (12th column, index 11) and must be a formula.
    expect((wb.Sheets["Data"]["L5"] as any).f).toContain("TODAY()");
  });
});
