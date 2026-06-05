import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  qboConnectionsTable,
  qboMappingOverridesTable,
  qboTransactionsTable,
  qboAccountClassificationsTable,
  type QboTransactionRow,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/requireAuth";
import { memoToken } from "../lib/qbo-mapping";
import { reclassifyForRule } from "../lib/qbo-reclassify";
import { logger } from "../lib/logger";

/**
 * API routes for the proactive QBO Mapping Rules page (Task #694).
 * Rules live in the existing `qbo_mapping_overrides` and
 * `qbo_account_classifications` tables — this router just gives
 * operators a friendlier CRUD + preview surface than the reactive
 * "Needs mapping" tray on the Reconciliation page.
 */

const router: IRouter = Router();

async function currentRealmId(): Promise<string | null> {
  const [c] = await db.select().from(qboConnectionsTable).limit(1);
  return c?.realmId ?? null;
}

// ─── GET /api/qbo/mapping-rules ─────────────────────────────────────
router.get("/qbo/mapping-rules", async (_req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({
      realmId: null,
      customerLinks: [],
      memoRules: [],
      accountClassifications: [],
    });
    return;
  }
  const [memoRules, accountClassifications, customers, txns] = await Promise.all([
    db
      .select()
      .from(qboMappingOverridesTable)
      .where(eq(qboMappingOverridesTable.realmId, realmId)),
    db
      .select()
      .from(qboAccountClassificationsTable)
      .where(eq(qboAccountClassificationsTable.realmId, realmId)),
    db.select().from(customersTable),
    db
      .select({
        qboCustomerId: qboTransactionsTable.qboCustomerId,
        memo: qboTransactionsTable.memo,
        manualOverride: qboTransactionsTable.manualOverride,
        qboVendorId: qboTransactionsTable.qboVendorId,
      })
      .from(qboTransactionsTable)
      .where(eq(qboTransactionsTable.realmId, realmId)),
  ]);

  const customerLinks = customers
    .filter((c) => c.qboCustomerId)
    .map((c) => ({
      customerId: c.id,
      customerName: c.name,
      qboCustomerId: c.qboCustomerId,
    }));

  // Pre-compute match counts for each rule so the table can show
  // "47 transactions" without N additional round-trips.
  const matchCounts = new Map<string, number>();
  for (const rule of memoRules) matchCounts.set(rule.id, 0);
  for (const t of txns) {
    const tok = memoToken(t.memo ?? "");
    for (const r of memoRules) {
      if (r.memoToken !== tok) continue;
      if (r.qboCustomerId && r.qboCustomerId !== t.qboCustomerId) continue;
      if (r.qboVendorId && r.qboVendorId !== t.qboVendorId) continue;
      matchCounts.set(r.id, (matchCounts.get(r.id) ?? 0) + 1);
    }
  }

  res.json({
    realmId,
    customerLinks,
    memoRules: memoRules.map((r) => ({
      ...r,
      matchCount: matchCounts.get(r.id) ?? 0,
    })),
    accountClassifications,
  });
});

// ─── GET /api/qbo/customers/unlinked ────────────────────────────────
router.get("/qbo/customers/unlinked", async (_req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({ qboCustomers: [] });
    return;
  }
  const [linkedCustomers, txns] = await Promise.all([
    db.select().from(customersTable),
    db
      .select({
        qboCustomerId: qboTransactionsTable.qboCustomerId,
      })
      .from(qboTransactionsTable)
      .where(eq(qboTransactionsTable.realmId, realmId)),
  ]);
  const linked = new Set(
    linkedCustomers.map((c) => c.qboCustomerId).filter(Boolean) as string[],
  );
  const seen = new Map<string, { id: string; displayName: string }>();
  // Pull display names from the raw JSON-backed txn rows. We don't
  // mirror QBO Customer entities to their own table, so the txn rows
  // are our best source.
  const rawRows = await db
    .select({
      qboCustomerId: qboTransactionsTable.qboCustomerId,
      rawJson: qboTransactionsTable.rawJson,
    })
    .from(qboTransactionsTable)
    .where(eq(qboTransactionsTable.realmId, realmId));
  for (const r of rawRows) {
    if (!r.qboCustomerId || linked.has(r.qboCustomerId)) continue;
    if (seen.has(r.qboCustomerId)) continue;
    const raw = (r.rawJson ?? {}) as Record<string, any>;
    const name = raw?.CustomerRef?.name ?? r.qboCustomerId;
    seen.set(r.qboCustomerId, { id: r.qboCustomerId, displayName: name });
  }
  // Backfill from txns array if any qboCustomerId still wasn't seen.
  for (const t of txns) {
    if (!t.qboCustomerId || linked.has(t.qboCustomerId) || seen.has(t.qboCustomerId))
      continue;
    seen.set(t.qboCustomerId, {
      id: t.qboCustomerId,
      displayName: t.qboCustomerId,
    });
  }
  res.json({ qboCustomers: [...seen.values()] });
});

// ─── POST /api/qbo/mapping-rules/customer-link ──────────────────────
const customerLinkSchema = z.object({
  qboCustomerId: z.string().min(1),
  customerId: z.string().min(1),
});

router.post("/qbo/mapping-rules/customer-link", async (req: AuthedRequest, res) => {
  const parsed = customerLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [c] = await db
    .update(customersTable)
    .set({ qboCustomerId: parsed.data.qboCustomerId })
    .where(eq(customersTable.id, parsed.data.customerId))
    .returning();
  if (!c) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json({ customer: c });
});

router.delete(
  "/qbo/mapping-rules/customer-link/:customerId",
  async (req, res) => {
    const customerId = req.params["customerId"] as string;
    const [c] = await db
      .update(customersTable)
      .set({ qboCustomerId: null })
      .where(eq(customersTable.id, customerId))
      .returning();
    if (!c) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({ customer: c });
  },
);

// ─── POST /api/qbo/mapping-rules/auto-link-customers ────────────────
router.post("/qbo/mapping-rules/auto-link-customers", async (_req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({ proposals: [] });
    return;
  }
  const [customers, txns] = await Promise.all([
    db.select().from(customersTable),
    db
      .select({
        qboCustomerId: qboTransactionsTable.qboCustomerId,
        rawJson: qboTransactionsTable.rawJson,
      })
      .from(qboTransactionsTable)
      .where(eq(qboTransactionsTable.realmId, realmId)),
  ]);
  const linked = new Set(
    customers.map((c) => c.qboCustomerId).filter(Boolean) as string[],
  );
  const seen = new Map<string, string>();
  for (const t of txns) {
    if (!t.qboCustomerId || linked.has(t.qboCustomerId) || seen.has(t.qboCustomerId))
      continue;
    const raw = (t.rawJson ?? {}) as Record<string, any>;
    const name = raw?.CustomerRef?.name;
    if (typeof name === "string" && name.length > 0) {
      seen.set(t.qboCustomerId, name);
    }
  }
  const proposals: Array<{
    qboCustomerId: string;
    qboCustomerName: string;
    customerId: string;
    customerName: string;
  }> = [];
  for (const [qid, qname] of seen) {
    const match = customers.find(
      (c) => c.name.trim().toLowerCase() === qname.trim().toLowerCase(),
    );
    if (match && !match.qboCustomerId) {
      proposals.push({
        qboCustomerId: qid,
        qboCustomerName: qname,
        customerId: match.id,
        customerName: match.name,
      });
    }
  }
  res.json({ proposals });
});

router.post(
  "/qbo/mapping-rules/auto-link-customers/confirm",
  async (req, res) => {
    const proposals = Array.isArray(req.body?.proposals) ? req.body.proposals : [];
    let linked = 0;
    for (const p of proposals) {
      if (
        typeof p?.customerId !== "string" ||
        typeof p?.qboCustomerId !== "string"
      ) {
        continue;
      }
      await db
        .update(customersTable)
        .set({ qboCustomerId: p.qboCustomerId })
        .where(eq(customersTable.id, p.customerId));
      linked += 1;
    }
    res.json({ linked });
  },
);

// ─── POST /api/qbo/mapping-rules/memo ───────────────────────────────
const memoRuleSchema = z.object({
  id: z.string().optional(),
  qboCustomerId: z.string().optional().nullable(),
  qboVendorId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  memoToken: z.string().min(1),
  propertyId: z.string().min(1),
  leaseId: z.string().optional().nullable(),
  utilityId: z.string().optional().nullable(),
});

/** Resolve a HousingOps customerId → its linked qboCustomerId so the
 *  UI can show "Customer scope" pickers in HousingOps terms while the
 *  rule still keys by the QBO id the sync engine sees. */
async function resolveQboCustomerId(
  customerId?: string | null,
  qboCustomerId?: string | null,
): Promise<string> {
  if (qboCustomerId) return qboCustomerId;
  if (!customerId) return "";
  const [c] = await db
    .select({ qboCustomerId: customersTable.qboCustomerId })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  return c?.qboCustomerId ?? "";
}

router.post("/qbo/mapping-rules/memo", async (req: AuthedRequest, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.status(400).json({ error: "QuickBooks is not connected" });
    return;
  }
  const parsed = memoRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const qboCustomerId = await resolveQboCustomerId(
    body.customerId,
    body.qboCustomerId,
  );
  const qboVendorId = body.qboVendorId ?? "";
  const tok = memoToken(body.memoToken);
  // When `id` is present the operator is *editing* an existing rule.
  // We must NOT use `insert().onConflictDoUpdate(...)` here because the
  // conflict target is the natural key (realmId, qboCustomerId,
  // qboVendorId, memoToken), and `id` is the table's primary key —
  // changing any natural-key field while sending the existing id would
  // collide on `id` (which isn't in the conflict target) and fail.
  // Split paths: explicit UPDATE by id for edits, insert+natural-key
  // upsert for creates.
  let rule: typeof qboMappingOverridesTable.$inferSelect | undefined;
  if (body.id) {
    const updated = await db
      .update(qboMappingOverridesTable)
      .set({
        qboCustomerId,
        qboVendorId,
        memoToken: tok,
        propertyId: body.propertyId,
        leaseId: body.leaseId ?? null,
        utilityId: body.utilityId ?? null,
      })
      .where(eq(qboMappingOverridesTable.id, body.id))
      .returning();
    rule = updated[0];
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
  } else {
    const inserted = await db
      .insert(qboMappingOverridesTable)
      .values({
        id: `qov-${randomUUID().slice(0, 8)}`,
        realmId,
        qboCustomerId,
        qboVendorId,
        memoToken: tok,
        propertyId: body.propertyId,
        leaseId: body.leaseId ?? null,
        utilityId: body.utilityId ?? null,
        createdByUserId: req.appUser?.id ?? "",
      })
      .onConflictDoUpdate({
        target: [
          qboMappingOverridesTable.realmId,
          qboMappingOverridesTable.qboCustomerId,
          qboMappingOverridesTable.qboVendorId,
          qboMappingOverridesTable.memoToken,
        ],
        set: {
          propertyId: body.propertyId,
          leaseId: body.leaseId ?? null,
          utilityId: body.utilityId ?? null,
        },
      })
      .returning();
    rule = inserted[0];
  }

  const result = await reclassifyForRule({
    realmId,
    qboCustomerId,
    qboVendorId,
    memoToken: tok,
    propertyId: body.propertyId,
    leaseId: body.leaseId ?? null,
    utilityId: body.utilityId ?? null,
  });
  res.json({
    rule,
    reclassified: result.reclassified,
    skippedManual: result.skippedManual,
  });
});

router.delete("/qbo/mapping-rules/memo/:id", async (req, res) => {
  const id = req.params["id"] as string;
  await db
    .delete(qboMappingOverridesTable)
    .where(eq(qboMappingOverridesTable.id, id));
  res.json({ ok: true });
});

// ─── POST /api/qbo/mapping-rules/preview ────────────────────────────
router.post("/qbo/mapping-rules/preview", async (req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({ matchCount: 0, transactions: [] });
    return;
  }
  const parsed = memoRuleSchema
    .partial({ propertyId: true })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const qboCustomerId = await resolveQboCustomerId(
    body.customerId,
    body.qboCustomerId,
  );
  const qboVendorId = body.qboVendorId ?? "";
  const tok = memoToken(body.memoToken);
  if (!tok) {
    res.json({ matchCount: 0, transactions: [] });
    return;
  }
  const rows = await db
    .select()
    .from(qboTransactionsTable)
    .where(eq(qboTransactionsTable.realmId, realmId));
  const matches: QboTransactionRow[] = [];
  for (const r of rows) {
    if (qboCustomerId && r.qboCustomerId !== qboCustomerId) continue;
    if (qboVendorId && r.qboVendorId !== qboVendorId) continue;
    if (memoToken(r.memo ?? "") !== tok) continue;
    matches.push(r);
  }
  matches.sort((a, b) => (b.txnDate || "").localeCompare(a.txnDate || ""));
  res.json({
    matchCount: matches.length,
    transactions: matches.slice(0, 25),
  });
});

// ─── GET /api/qbo/mapping-rules/export ──────────────────────────────
router.get("/qbo/mapping-rules/export", async (_req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({ realmId: null, memoRules: [], customerLinks: [] });
    return;
  }
  const [memoRules, customers] = await Promise.all([
    db
      .select()
      .from(qboMappingOverridesTable)
      .where(eq(qboMappingOverridesTable.realmId, realmId)),
    db.select().from(customersTable),
  ]);
  const customerLinks = customers
    .filter((c) => c.qboCustomerId)
    .map((c) => ({
      customerId: c.id,
      customerName: c.name,
      qboCustomerId: c.qboCustomerId,
    }));
  res.json({
    realmId,
    exportedAt: new Date().toISOString(),
    memoRules: memoRules.map((r) => ({
      qboCustomerId: r.qboCustomerId,
      qboVendorId: r.qboVendorId,
      memoToken: r.memoToken,
      propertyId: r.propertyId,
      leaseId: r.leaseId,
      utilityId: r.utilityId,
    })),
    customerLinks,
  });
});

const importSchema = z.object({
  memoRules: z
    .array(
      z.object({
        qboCustomerId: z.string().optional().nullable(),
        qboVendorId: z.string().optional().nullable(),
        memoToken: z.string().min(1),
        propertyId: z.string().min(1),
        leaseId: z.string().optional().nullable(),
        utilityId: z.string().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
  customerLinks: z
    .array(
      z.object({
        customerId: z.string().min(1),
        qboCustomerId: z.string().min(1),
      }),
    )
    .optional()
    .default([]),
});

router.post("/qbo/mapping-rules/import", async (req: AuthedRequest, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.status(400).json({ error: "QuickBooks is not connected" });
    return;
  }
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let upsertedRules = 0;
  for (const r of parsed.data.memoRules) {
    const tok = memoToken(r.memoToken);
    await db
      .insert(qboMappingOverridesTable)
      .values({
        id: `qov-${randomUUID().slice(0, 8)}`,
        realmId,
        qboCustomerId: r.qboCustomerId ?? "",
        qboVendorId: r.qboVendorId ?? "",
        memoToken: tok,
        propertyId: r.propertyId,
        leaseId: r.leaseId ?? null,
        utilityId: r.utilityId ?? null,
        createdByUserId: req.appUser?.id ?? "",
      })
      .onConflictDoUpdate({
        target: [
          qboMappingOverridesTable.realmId,
          qboMappingOverridesTable.qboCustomerId,
          qboMappingOverridesTable.qboVendorId,
          qboMappingOverridesTable.memoToken,
        ],
        set: {
          propertyId: r.propertyId,
          leaseId: r.leaseId ?? null,
          utilityId: r.utilityId ?? null,
        },
      });
    upsertedRules += 1;
  }
  let linkedCustomers = 0;
  for (const l of parsed.data.customerLinks) {
    const [c] = await db
      .update(customersTable)
      .set({ qboCustomerId: l.qboCustomerId })
      .where(eq(customersTable.id, l.customerId))
      .returning();
    if (c) linkedCustomers += 1;
  }
  res.json({ upsertedRules, linkedCustomers });
});

// ─── PUT /api/qbo/mapping-rules/account/:id ─────────────────────────
router.put(
  "/qbo/mapping-rules/account/:id",
  async (req: AuthedRequest, res) => {
    const id = req.params["id"] as string;
    const classification = String(req.body?.classification ?? "");
    if (!["rent", "utility", "other"].includes(classification)) {
      res.status(400).json({ error: "classification must be rent|utility|other" });
      return;
    }
    const [row] = await db
      .update(qboAccountClassificationsTable)
      .set({
        classification,
        editedByUserId: req.appUser?.id ?? null,
        editedAt: new Date(),
      })
      .where(eq(qboAccountClassificationsTable.id, id))
      .returning();
    res.json(row);
  },
);

/** Suggest a memo token from an existing unmapped transaction id. The
 *  Reconciliation page's "Save as rule…" affordance calls this so the
 *  dialog pre-fills the suggested token without round-tripping the
 *  full unmapped list back into the client. */
router.post("/qbo/mapping-rules/suggest-token", async (req, res) => {
  const realmId = await currentRealmId();
  if (!realmId) {
    res.json({ memoToken: "", customerId: null });
    return;
  }
  const transactionId = String(req.body?.transactionId ?? "");
  if (!transactionId) {
    res.status(400).json({ error: "transactionId is required" });
    return;
  }
  const [row] = await db
    .select()
    .from(qboTransactionsTable)
    .where(eq(qboTransactionsTable.id, transactionId));
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const otherRows = await db
    .select({
      memo: qboTransactionsTable.memo,
      qboCustomerId: qboTransactionsTable.qboCustomerId,
      propertyId: qboTransactionsTable.propertyId,
    })
    .from(qboTransactionsTable)
    .where(eq(qboTransactionsTable.realmId, realmId));
  const others = otherRows
    .filter(
      (r) =>
        r.qboCustomerId === row.qboCustomerId &&
        !r.propertyId &&
        r.memo !== row.memo,
    )
    .map((r) => r.memo ?? "");
  const { suggestMemoToken } = await import("../lib/qbo-mapping");
  const token = suggestMemoToken(row.memo ?? "", others);
  res.json({
    memoToken: token,
    qboCustomerId: row.qboCustomerId,
    // Vendor-side transactions (bills, vendor credits) carry a
    // qboVendorId and an empty qboCustomerId — surface it so the
    // "Save as rule…" prefill and the dialog can scope the rule to
    // the vendor that originated the transaction.
    qboVendorId: row.qboVendorId ?? "",
    customerId: row.customerId,
    transaction: row,
  });
});

export default router;
