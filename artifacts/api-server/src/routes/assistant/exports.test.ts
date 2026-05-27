import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

// Mirror scope-guard.integration.test.ts: swap @workspace/db for a
// PGlite-backed drizzle instance so the route's `db.select(...)` and
// the test's `db.insert(...)` share the same table descriptors.
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
const { db, assistantExportsTable } = dbModule as typeof import("@workspace/db");
const exportsRouter = (await import("./exports")).default;

let baseUrl = "";
let server: http.Server;
let currentUser = "user-A";

beforeAll(async () => {
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@workspace/db/schema");
  const { apply } = await pushSchema(schema as any, db as any);
  await apply();

  const app: Express = express();
  // Stand-in for requireAuth — the real auth middleware isn't relevant
  // to the route's contract; what matters is `req.auth.userId`.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = { userId: currentUser };
    next();
  });
  app.use(exportsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((res, rej) =>
    server.close((err) => (err ? rej(err) : res())),
  );
});

async function seedExport(overrides: Partial<typeof assistantExportsTable.$inferInsert> = {}) {
  const id = overrides.id ?? `ax-${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(assistantExportsTable).values({
    id,
    userId: "user-A",
    conversationId: null,
    filename: "leases-2026-05-27.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 5,
    content: Buffer.from("hello"),
    toolName: "export_leases",
    format: "xlsx",
    entityType: "leases",
    rowCount: 1,
    filterDesc: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
  return id;
}

describe("GET /assistant/exports/:id/download", () => {
  it("streams the bytea content with correct headers when the owner downloads", async () => {
    currentUser = "user-A";
    const id = await seedExport();
    const res = await fetch(`${baseUrl}/assistant/exports/${id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="leases-2026-05-27.xlsx"',
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString("utf8")).toBe("hello");
  });

  it("returns 404 for an unknown export id", async () => {
    currentUser = "user-A";
    const res = await fetch(`${baseUrl}/assistant/exports/ax-does-not-exist/download`);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for an export owned by another user — never leaks existence", async () => {
    currentUser = "user-A";
    const id = await seedExport({ userId: "user-B" });
    const res = await fetch(`${baseUrl}/assistant/exports/${id}/download`);
    expect(res.status).toBe(404);
  });

  it("returns 410 when expiresAt is in the past", async () => {
    currentUser = "user-A";
    const id = await seedExport({ expiresAt: new Date(Date.now() - 1000) });
    const res = await fetch(`${baseUrl}/assistant/exports/${id}/download`);
    expect(res.status).toBe(410);
  });
});
