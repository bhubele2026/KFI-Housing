import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

/**
 * Behavioral tests for the QBO Mapping Rules router (Task #694).
 *
 * The router imports `@workspace/db`, which throws at import time when
 * DATABASE_URL is unset, so we replace it with an in-memory fake that
 * implements the subset of Drizzle's chainable API the router uses.
 * Tests then drive a real Express app and assert on JSON payloads —
 * this exercises the route handlers end-to-end (including the
 * insert-vs-update branch in POST /memo, which is the bug the prior
 * review flagged) without standing up PGlite.
 */

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
interface ConnRow {
  realmId: string;
}
interface CustomerRow {
  id: string;
  name: string;
  qboCustomerId: string | null;
}
interface MemoRow {
  id: string;
  realmId: string;
  qboCustomerId: string;
  qboVendorId: string;
  memoToken: string;
  propertyId: string;
  leaseId: string | null;
  utilityId: string | null;
  createdByUserId: string;
}
interface TxnRow {
  id: string;
  realmId: string;
  qboCustomerId: string;
  qboVendorId: string;
  memo: string | null;
  manualOverride: boolean;
  propertyId: string | null;
  leaseId: string | null;
  utilityId: string | null;
  customerId: string | null;
  txnDate: string;
  amount: number;
  classification: string;
  rawJson: any;
  mappedConfidence: number;
  reclassifiedAt: Date | null;
}

const store = {
  conns: [] as ConnRow[],
  customers: [] as CustomerRow[],
  memos: [] as MemoRow[],
  txns: [] as TxnRow[],
  accountClassifications: [] as any[],
};

function reset() {
  store.conns = [{ realmId: "realm-1" }];
  store.customers = [
    { id: "c-a", name: "Alpha Inc", qboCustomerId: "qc-1" },
    { id: "c-b", name: "Beta LLC", qboCustomerId: null },
  ];
  store.memos = [];
  store.txns = [];
  store.accountClassifications = [];
}

// ---------------------------------------------------------------------------
// Fake Drizzle handle
// ---------------------------------------------------------------------------
// Each table object the router imports is just a column-name proxy —
// any property access returns `{ __col: name, name }` so the router's
// `eq(table.id, x)` resolves to a structure the fake `where` can read,
// and the special `__name` access returns the in-store array name so
// db ops know which array to operate on.
function asColumnProxy(name: string) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === "__name") return name;
        return { __col: String(key), name: String(key) };
      },
    },
  ) as any;
}
const qboConnectionsTable = asColumnProxy("conns");
const qboMappingOverridesTable = asColumnProxy("memos");
const qboTransactionsTable = asColumnProxy("txns");
const qboAccountClassificationsTable = asColumnProxy("accountClassifications");
const customersTable = asColumnProxy("customers");

function rowsFor(table: any): any[] {
  return (store as any)[table.__name] ?? [];
}

const db = {
  select: (_cols?: any) => ({
    from: (table: any) => {
      const all = rowsFor(table);
      const chain = {
        where: () => Promise.resolve(all),
        limit: (n: number) => Promise.resolve(all.slice(0, n)),
        then: (resolve: any) => resolve(all),
      };
      return chain;
    },
  }),
  insert: (table: any) => ({
    values: (vals: any) => {
      const arr = rowsFor(table);
      return {
        onConflictDoUpdate: ({ set }: any) => ({
          returning: () => {
            // Natural-key conflict for memos: (realmId, qboCustomerId,
            // qboVendorId, memoToken)
            if (table.__name === "memos") {
              const existing = arr.find(
                (r) =>
                  r.realmId === vals.realmId &&
                  r.qboCustomerId === vals.qboCustomerId &&
                  r.qboVendorId === vals.qboVendorId &&
                  r.memoToken === vals.memoToken,
              );
              if (existing) {
                Object.assign(existing, set);
                return [existing];
              }
            }
            arr.push(vals);
            return [vals];
          },
        }),
        returning: () => {
          arr.push(vals);
          return [vals];
        },
      };
    },
  }),
  update: (table: any) => ({
    set: (patch: any) => ({
      where: (pred: any) => {
        const arr = rowsFor(table);
        // pred is an object created by our fake eq() below: {col, val}
        const matches = arr.filter((r) => r[pred.col] === pred.val);
        for (const m of matches) Object.assign(m, patch);
        return {
          returning: () => matches,
          then: (resolve: any) => resolve(matches),
        };
      },
    }),
  }),
  delete: (table: any) => ({
    where: (pred: any) => {
      const arr = rowsFor(table);
      const before = arr.length;
      const remaining = arr.filter((r) => r[pred.col] !== pred.val);
      (store as any)[table.__name] = remaining;
      return Promise.resolve({ deleted: before - remaining.length });
    },
  }),
};

// ---------------------------------------------------------------------------
// Mock @workspace/db before importing the router
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db,
  qboConnectionsTable,
  qboMappingOverridesTable,
  qboTransactionsTable,
  qboAccountClassificationsTable,
  customersTable,
}));

// drizzle-orm: stub `eq` to return a {col, val} the fake `where`
// understands, and pass through the other helpers as no-ops.
vi.mock("drizzle-orm", async () => {
  const eq = (col: any, val: any) => ({
    col: typeof col === "string" ? col : col?.name ?? col?.__col ?? "id",
    val,
  });
  return {
    eq,
    and: (...args: any[]) => args[0],
    or: (...args: any[]) => args[0],
    desc: (x: any) => x,
    sql: { raw: (s: string) => s },
  };
});

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: router } = await import("./qbo-mapping-rules");
  const app: Express = express();
  app.use(express.json());
  // Stub the requireAuth-decorated req shape — our router only reads
  // `req.appUser?.id`, so set it on every request.
  app.use((req: any, _res, next) => {
    req.appUser = { id: "user-test" };
    next();
  });
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => reset());

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/qbo/mapping-rules", () => {
  it("returns the dashboard payload (customer links, memo rules, classifications)", async () => {
    store.memos.push({
      id: "qov-1",
      realmId: "realm-1",
      qboCustomerId: "qc-1",
      qboVendorId: "",
      memoToken: "maple unit",
      propertyId: "prop-1",
      leaseId: null,
      utilityId: null,
      createdByUserId: "user-test",
    });
    const r = await api("GET", "/api/qbo/mapping-rules");
    expect(r.status).toBe(200);
    expect(r.body.realmId).toBe("realm-1");
    expect(r.body.customerLinks).toHaveLength(1);
    expect(r.body.customerLinks[0].customerName).toBe("Alpha Inc");
    expect(r.body.memoRules).toHaveLength(1);
    expect(r.body.memoRules[0]).toMatchObject({
      id: "qov-1",
      memoToken: "maple unit",
      propertyId: "prop-1",
    });
  });

  it("returns an empty shell when QuickBooks isn't connected", async () => {
    store.conns = [];
    const r = await api("GET", "/api/qbo/mapping-rules");
    expect(r.body).toEqual({
      realmId: null,
      customerLinks: [],
      memoRules: [],
      accountClassifications: [],
    });
  });
});

describe("POST /api/qbo/mapping-rules/memo", () => {
  it("creates a new rule with a generated id when no id is sent", async () => {
    const r = await api("POST", "/api/qbo/mapping-rules/memo", {
      qboCustomerId: "qc-1",
      memoToken: "Penda Repair",
      propertyId: "prop-99",
    });
    expect(r.status).toBe(200);
    expect(store.memos).toHaveLength(1);
    expect(store.memos[0].id).toMatch(/^qov-/);
    // memoToken is normalized server-side.
    expect(store.memos[0].memoToken).toBe(
      [..."penda repair".split(" ")].sort().join(" "),
    );
    expect(r.body.rule.propertyId).toBe("prop-99");
  });

  it("edits an existing rule by id without PK collision when the natural key changes", async () => {
    store.memos.push({
      id: "qov-keep",
      realmId: "realm-1",
      qboCustomerId: "qc-1",
      qboVendorId: "",
      memoToken: "old token",
      propertyId: "prop-1",
      leaseId: null,
      utilityId: null,
      createdByUserId: "user-test",
    });
    // Change BOTH the memo token AND the customer scope — under the
    // prior insert+onConflictDoUpdate code, sending the existing `id`
    // would collide on the PK because the natural-key conflict target
    // wouldn't match. With the new explicit update-by-id path this
    // succeeds.
    const r = await api("POST", "/api/qbo/mapping-rules/memo", {
      id: "qov-keep",
      qboCustomerId: "qc-2",
      memoToken: "Brand New Memo",
      propertyId: "prop-2",
    });
    expect(r.status).toBe(200);
    expect(store.memos).toHaveLength(1);
    expect(store.memos[0]).toMatchObject({
      id: "qov-keep",
      qboCustomerId: "qc-2",
      propertyId: "prop-2",
    });
  });

  it("returns 404 when editing a rule id that doesn't exist", async () => {
    const r = await api("POST", "/api/qbo/mapping-rules/memo", {
      id: "qov-missing",
      memoToken: "anything",
      propertyId: "prop-1",
    });
    expect(r.status).toBe(404);
  });

  it("rejects payloads missing the required fields", async () => {
    const r = await api("POST", "/api/qbo/mapping-rules/memo", {
      memoToken: "",
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/qbo/mapping-rules/preview", () => {
  it("returns the count + sample of mirrored transactions a draft would match", async () => {
    store.txns.push(
      {
        id: "t1",
        realmId: "realm-1",
        qboCustomerId: "qc-1",
        qboVendorId: "",
        memo: "Penda Repair May",
        manualOverride: false,
        propertyId: null,
        leaseId: null,
        utilityId: null,
        customerId: null,
        txnDate: "2026-05-10",
        amount: 100,
        classification: "other",
        rawJson: {},
        mappedConfidence: 0,
        reclassifiedAt: null,
      },
      {
        id: "t2",
        realmId: "realm-1",
        qboCustomerId: "qc-1",
        qboVendorId: "",
        memo: "Unrelated",
        manualOverride: false,
        propertyId: null,
        leaseId: null,
        utilityId: null,
        customerId: null,
        txnDate: "2026-05-11",
        amount: 50,
        classification: "other",
        rawJson: {},
        mappedConfidence: 0,
        reclassifiedAt: null,
      },
    );
    const r = await api("POST", "/api/qbo/mapping-rules/preview", {
      qboCustomerId: "qc-1",
      memoToken: "Penda Repair",
      propertyId: "prop-1",
    });
    expect(r.status).toBe(200);
    expect(r.body.matchCount).toBe(1);
    expect(r.body.transactions[0].id).toBe("t1");
  });
});

describe("vendor scoping (qboVendorId)", () => {
  it("persists qboVendorId on create and isolates preview matches by vendor", async () => {
    store.txns.push(
      {
        id: "tv1",
        realmId: "realm-1",
        qboCustomerId: "",
        qboVendorId: "v-acme",
        memo: "Pipe Repair",
        manualOverride: false,
        propertyId: null,
        leaseId: null,
        utilityId: null,
        customerId: null,
        txnDate: "2026-05-12",
        amount: 200,
        classification: "other",
        rawJson: {},
        mappedConfidence: 0,
        reclassifiedAt: null,
      },
      {
        id: "tv2",
        realmId: "realm-1",
        qboCustomerId: "",
        qboVendorId: "v-beta",
        memo: "Pipe Repair",
        manualOverride: false,
        propertyId: null,
        leaseId: null,
        utilityId: null,
        customerId: null,
        txnDate: "2026-05-13",
        amount: 175,
        classification: "other",
        rawJson: {},
        mappedConfidence: 0,
        reclassifiedAt: null,
      },
    );

    // Preview scoped to v-acme: must match only tv1, never tv2.
    const preview = await api("POST", "/api/qbo/mapping-rules/preview", {
      qboVendorId: "v-acme",
      memoToken: "Pipe Repair",
      propertyId: "prop-1",
    });
    expect(preview.status).toBe(200);
    expect(preview.body.matchCount).toBe(1);
    expect(preview.body.transactions[0].id).toBe("tv1");

    // Save the rule with the vendor scope and confirm it persists.
    const save = await api("POST", "/api/qbo/mapping-rules/memo", {
      qboVendorId: "v-acme",
      memoToken: "Pipe Repair",
      propertyId: "prop-1",
    });
    expect(save.status).toBe(200);
    expect(save.body.rule.qboVendorId).toBe("v-acme");
    // Reclassifier only touches the v-acme row, not the v-beta row.
    expect(save.body.reclassified).toBe(1);
    expect(
      store.txns.find((t) => t.id === "tv1")?.propertyId,
    ).toBe("prop-1");
    expect(
      store.txns.find((t) => t.id === "tv2")?.propertyId,
    ).toBeNull();
  });

  it("/qbo/mapping-rules/suggest-token surfaces qboVendorId from the source transaction", async () => {
    store.txns.push({
      id: "tv-prefill",
      realmId: "realm-1",
      qboCustomerId: "",
      qboVendorId: "v-prefill-vendor",
      memo: "Special Bill",
      manualOverride: false,
      propertyId: null,
      leaseId: null,
      utilityId: null,
      customerId: null,
      txnDate: "2026-05-20",
      amount: 50,
      classification: "other",
      rawJson: {},
      mappedConfidence: 0,
      reclassifiedAt: null,
    });
    const r = await api("POST", "/api/qbo/mapping-rules/suggest-token", {
      transactionId: "tv-prefill",
    });
    expect(r.status).toBe(200);
    expect(r.body.qboVendorId).toBe("v-prefill-vendor");
  });
});

describe("DELETE /api/qbo/mapping-rules/memo/:id", () => {
  it("removes the rule", async () => {
    store.memos.push({
      id: "qov-x",
      realmId: "realm-1",
      qboCustomerId: "",
      qboVendorId: "",
      memoToken: "abc",
      propertyId: "p",
      leaseId: null,
      utilityId: null,
      createdByUserId: "u",
    });
    const r = await api("DELETE", "/api/qbo/mapping-rules/memo/qov-x");
    expect(r.status).toBe(200);
    expect(store.memos).toHaveLength(0);
  });
});

describe("POST /api/qbo/mapping-rules/customer-link", () => {
  it("attaches a qboCustomerId to a HousingOps customer", async () => {
    const r = await api("POST", "/api/qbo/mapping-rules/customer-link", {
      customerId: "c-b",
      qboCustomerId: "qc-9",
    });
    expect(r.status).toBe(200);
    expect(store.customers.find((c) => c.id === "c-b")?.qboCustomerId).toBe(
      "qc-9",
    );
  });

  it("returns 404 for an unknown customer", async () => {
    const r = await api("POST", "/api/qbo/mapping-rules/customer-link", {
      customerId: "c-ghost",
      qboCustomerId: "qc-9",
    });
    expect(r.status).toBe(404);
  });
});

describe("router shape (regression)", () => {
  it("mounts all 14 expected routes", async () => {
    const { default: router } = await import("./qbo-mapping-rules");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = (router as any).stack ?? [];
    const paths: string[] = [];
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m])
            paths.push(`${m.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
    for (const expected of [
      "GET /qbo/mapping-rules",
      "GET /qbo/customers/unlinked",
      "POST /qbo/mapping-rules/auto-link-customers",
      "POST /qbo/mapping-rules/auto-link-customers/confirm",
      "POST /qbo/mapping-rules/customer-link",
      "DELETE /qbo/mapping-rules/customer-link/:customerId",
      "POST /qbo/mapping-rules/memo",
      "DELETE /qbo/mapping-rules/memo/:id",
      "POST /qbo/mapping-rules/preview",
      "GET /qbo/mapping-rules/export",
      "POST /qbo/mapping-rules/import",
      "PUT /qbo/mapping-rules/account/:id",
      "POST /qbo/mapping-rules/suggest-token",
    ]) {
      expect(paths).toContain(expected);
    }
  });
});
