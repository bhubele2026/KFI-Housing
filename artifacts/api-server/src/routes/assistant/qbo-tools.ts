import { randomUUID } from "node:crypto";
import { and, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  leasesTable,
  propertiesTable,
  utilitiesTable,
  qboTransactionsTable,
  qboConnectionsTable,
  qboMappingOverridesTable,
  type LeaseRow,
  type PropertyRow,
  type QboTransactionRow,
  type UtilityRow,
} from "@workspace/db";
import { memoToken as toMemoToken } from "../../lib/qbo-mapping";
import { reclassifyForRule } from "../../lib/qbo-reclassify";
import {
  buildXlsxBuffer,
  colLetter,
  type ExportColumn,
} from "../../lib/xlsx-export";
import { putAssistantExportObject } from "../../lib/assistant-exports-storage";
import { assistantExportsTable } from "@workspace/db";
import type { ToolDef } from "./tools";

/**
 * Assistant tools for QuickBooks-backed rent/utility reconciliation
 * (Task #689). All read-only — they never propose writes, so the
 * model can call them inline without a Confirm card.
 */

const Str = { type: "string" } as const;
const StrOpt = { type: ["string", "null"] } as const;
const NumOpt = { type: ["number", "null"] } as const;
const BoolOpt = { type: ["boolean", "null"] } as const;

function obj(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Half-open [start, endExclusive) bounds for a YYYY-MM month. */
function monthBounds(
  month: string,
): { start: string; endExclusive: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = `${m[1]}-${m[2]}-01`;
  const next = new Date(Date.UTC(y, mo, 1));
  const endExclusive = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return { start, endExclusive };
}

function leaseActiveInMonth(
  l: LeaseRow,
  start: string,
  endExclusive: string,
): boolean {
  const s = l.startDate || "";
  const e = l.endDate || "9999-12-31";
  return (!s || s < endExclusive) && (!e || e >= start);
}

export const qboAssistantTools: ToolDef[] = [];

qboAssistantTools.push({
  name: "list_qbo_transactions",
  kind: "read",
  description:
    "List mirrored QuickBooks Online transactions. Filter by propertyId, customerId, month (YYYY-MM), classification (rent|utility|other), type (invoice|bill|payment|bill_payment), and/or unmapped=true to show only rows missing a propertyId.",
  input_schema: obj({
    propertyId: StrOpt,
    customerId: StrOpt,
    month: StrOpt,
    classification: StrOpt,
    type: StrOpt,
    unmapped: BoolOpt,
    limit: NumOpt,
  }),
  summarize: (i) =>
    `Listing QBO txns${i.propertyId ? ` for property ${i.propertyId}` : ""}${i.month ? ` in ${i.month}` : ""}${i.classification ? ` (${i.classification})` : ""}${i.unmapped ? ` [unmapped only]` : ""}`,
  execute: async (input) => {
    const conds: ReturnType<typeof eq>[] = [];
    if (input.propertyId)
      conds.push(eq(qboTransactionsTable.propertyId, input.propertyId));
    if (input.customerId)
      conds.push(eq(qboTransactionsTable.customerId, input.customerId));
    if (input.type) conds.push(eq(qboTransactionsTable.type, input.type));
    if (input.unmapped === true)
      conds.push(sql`${qboTransactionsTable.propertyId} IS NULL`);
    if (input.month) {
      const b = monthBounds(input.month);
      if (b) {
        conds.push(gte(qboTransactionsTable.txnDate, b.start));
        conds.push(lt(qboTransactionsTable.txnDate, b.endExclusive));
      }
    }
    if (input.classification)
      conds.push(
        eq(qboTransactionsTable.classification, input.classification),
      );
    const limit = Math.min(500, Math.max(1, Number(input.limit ?? 100)));
    const rows = conds.length
      ? await db
          .select()
          .from(qboTransactionsTable)
          .where(and(...conds))
          .limit(limit)
      : await db.select().from(qboTransactionsTable).limit(limit);
    return { transactions: rows };
  },
});

interface SummaryRow {
  propertyId: string;
  propertyName: string;
  customerId: string;
  customerName: string;
  expectedRent: number;
  expectedUtilities: number;
  invoicedRent: number;
  invoicedUtilities: number;
  paidRent: number;
  paidUtilities: number;
  variance: number;
}

async function computeSummary(
  month: string,
  filters: { customerId?: string | null; propertyId?: string | null },
): Promise<{ month: string; rows: SummaryRow[] }> {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error("month must be YYYY-MM");
  const [properties, leases, utilities, txns, customers] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(leasesTable),
    db.select().from(utilitiesTable),
    db
      .select()
      .from(qboTransactionsTable)
      .where(
        and(
          gte(qboTransactionsTable.txnDate, bounds.start),
          lt(qboTransactionsTable.txnDate, bounds.endExclusive),
        ),
      ),
    db.select().from(customersTable),
  ]);
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  let scoped = properties as PropertyRow[];
  if (filters.customerId)
    scoped = scoped.filter((p) => p.customerId === filters.customerId);
  if (filters.propertyId)
    scoped = scoped.filter((p) => p.id === filters.propertyId);
  const rows = scoped.map<SummaryRow>((p) => {
    const propLeases = (leases as LeaseRow[]).filter(
      (l) =>
        l.propertyId === p.id &&
        (l.status ?? "").toLowerCase() === "active" &&
        leaseActiveInMonth(l, bounds.start, bounds.endExclusive),
    );
    const expectedRent = propLeases.reduce(
      (s, l) => s + (l.monthlyRent ?? 0),
      0,
    );
    const expectedUtilities = (utilities as UtilityRow[])
      .filter((u) => u.propertyId === p.id)
      .reduce((s, u) => s + (u.monthlyCost ?? 0), 0);
    let invoicedRent = 0;
    let invoicedUtilities = 0;
    let paidRent = 0;
    let paidUtilities = 0;
    for (const t of txns as QboTransactionRow[]) {
      if (t.propertyId !== p.id) continue;
      const isInv = t.type === "invoice" || t.type === "bill";
      const isPay = t.type === "payment" || t.type === "bill_payment";
      if (t.classification === "rent") {
        if (isInv) invoicedRent += t.amount;
        if (isPay) paidRent += t.amount;
      } else if (t.classification === "utility") {
        if (isInv) invoicedUtilities += t.amount;
        if (isPay) paidUtilities += t.amount;
      }
    }
    return {
      propertyId: p.id,
      propertyName: p.name,
      customerId: p.customerId,
      customerName: customerNameById.get(p.customerId) ?? "",
      expectedRent,
      expectedUtilities,
      invoicedRent,
      invoicedUtilities,
      paidRent,
      paidUtilities,
      variance:
        paidRent + paidUtilities - (expectedRent + expectedUtilities),
    };
  });
  return { month, rows };
}

qboAssistantTools.push({
  name: "reconciliation_summary",
  kind: "read",
  description:
    "Per-property rent + utility reconciliation for a given month. Returns the same shape as the Reconciliation UI grid: expectedRent, expectedUtilities, invoicedRent, invoicedUtilities, paidRent, paidUtilities, variance per property. Defaults to the current month.",
  input_schema: obj({ month: StrOpt, customerId: StrOpt, propertyId: StrOpt }),
  summarize: (i) =>
    `Reconciliation for ${i.month ?? "current month"}${i.propertyId ? ` (one property)` : ""}`,
  execute: async (input) => {
    const month = input.month ?? new Date().toISOString().slice(0, 7);
    return computeSummary(month, {
      customerId: input.customerId,
      propertyId: input.propertyId,
    });
  },
});

qboAssistantTools.push({
  name: "find_qbo_transaction_by_memo",
  kind: "read",
  description:
    "Search mirrored QBO transactions by memo / line description substring. Use this to look up a specific bill or invoice the operator names by memo text.",
  input_schema: obj({ query: Str, limit: NumOpt }, ["query"]),
  summarize: (i) => `Searching QBO memos for "${i.query}"`,
  execute: async (input) => {
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 20)));
    const q = `%${input.query}%`;
    const rows = await db
      .select()
      .from(qboTransactionsTable)
      .where(
        or(
          ilike(qboTransactionsTable.memo, q),
          ilike(qboTransactionsTable.accountName, q),
        ),
      )
      .limit(limit);
    return { transactions: rows };
  },
});

qboAssistantTools.push({
  name: "list_qbo_mapping_rules",
  kind: "read",
  description:
    "List every saved QuickBooks → HousingOps memo→property mapping rule the operator has authored on the Mapping Rules page (Task #694). Returns rule rows from `qbo_mapping_overrides` with the resolved property name attached, so the assistant can answer questions like 'do we already have a rule for the Maple 3107 invoices?' without round-tripping the UI.",
  input_schema: obj({ propertyId: StrOpt, customerId: StrOpt }),
  summarize: (i) =>
    `Listing QBO mapping rules${i.propertyId ? " (one property)" : ""}${i.customerId ? " (one customer)" : ""}`,
  execute: async (input) => {
    const [conn] = await db.select().from(qboConnectionsTable).limit(1);
    if (!conn) return { rules: [] };
    // Resolve HousingOps customerId → its linked qboCustomerId so we
    // can answer questions like "what rules are set for Burnett
    // Dairy?" in HousingOps terms even though rules are keyed by the
    // QBO id the sync engine sees.
    let qboCustomerIdFilter: string | null = null;
    if (input.customerId) {
      const [c] = await db
        .select({ qboCustomerId: customersTable.qboCustomerId })
        .from(customersTable)
        .where(eq(customersTable.id, input.customerId));
      qboCustomerIdFilter = c?.qboCustomerId ?? "__NEVER_MATCH__";
    }
    const rules = await db
      .select()
      .from(qboMappingOverridesTable)
      .where(eq(qboMappingOverridesTable.realmId, conn.realmId));
    const filtered = rules.filter((r) => {
      if (input.propertyId && r.propertyId !== input.propertyId) return false;
      if (qboCustomerIdFilter !== null && r.qboCustomerId !== qboCustomerIdFilter)
        return false;
      return true;
    });
    return { rules: filtered };
  },
});

/**
 * READ-ONLY proposal tool. Returns a *draft* (no DB writes) plus a
 * dry-run match count from the existing `qbo_transactions` mirror, so
 * the operator can see exactly what the rule would do before agreeing.
 * The assistant runtime renders this as a confirm card; only
 * `confirm_qbo_mapping_rule` actually writes to `qbo_mapping_overrides`
 * and triggers reclassification.
 */
qboAssistantTools.push({
  name: "propose_qbo_mapping_rule",
  kind: "read",
  description:
    "READ-ONLY draft helper. Given a `qboCustomerId` (or HousingOps `customerId`) and a `memoSample` from a real transaction, derive the canonical `memoToken` we'd save, recommend a `propertyId` based on what's already mapped most often for the same customer + memo token, and dry-run how many existing mirrored transactions the rule would reclassify. NEVER writes to the database. Returns a `draft` the assistant should show the operator; only after explicit approval may you call confirm_qbo_mapping_rule with that draft. Use whenever the operator says things like 'always map invoices from <customer> that mention <phrase> to <property>'.",
  input_schema: obj(
    {
      qboCustomerId: StrOpt,
      customerId: StrOpt,
      qboVendorId: StrOpt,
      memoSample: Str,
      propertyId: StrOpt,
      leaseId: StrOpt,
      utilityId: StrOpt,
    },
    ["memoSample"],
  ),
  summarize: (i) =>
    `Drafting rule from memo sample "${String(i.memoSample).slice(0, 40)}"`,
  execute: async (input) => {
    const [conn] = await db.select().from(qboConnectionsTable).limit(1);
    if (!conn) return { error: "QuickBooks is not connected." };

    let qboCustomerId = (input.qboCustomerId as string) ?? "";
    if (!qboCustomerId && input.customerId) {
      const [c] = await db
        .select({ qboCustomerId: customersTable.qboCustomerId })
        .from(customersTable)
        .where(eq(customersTable.id, input.customerId));
      qboCustomerId = c?.qboCustomerId ?? "";
    }
    const qboVendorId = (input.qboVendorId as string) ?? "";

    // Canonicalize the memo sample into our token form. We use the
    // shared suggester so the draft matches what the UI would derive
    // from the Reconciliation "Save as rule…" affordance for the
    // same transaction.
    const { suggestMemoToken } = await import("../../lib/qbo-mapping");
    const allRows = await db
      .select({
        memo: qboTransactionsTable.memo,
        qboCustomerId: qboTransactionsTable.qboCustomerId,
        qboVendorId: qboTransactionsTable.qboVendorId,
        propertyId: qboTransactionsTable.propertyId,
        type: qboTransactionsTable.type,
        txnDate: qboTransactionsTable.txnDate,
        amount: qboTransactionsTable.amount,
        id: qboTransactionsTable.id,
        manualOverride: qboTransactionsTable.manualOverride,
      })
      .from(qboTransactionsTable)
      .where(eq(qboTransactionsTable.realmId, conn.realmId));
    const otherMemos = allRows
      .filter(
        (r) =>
          (!qboCustomerId || r.qboCustomerId === qboCustomerId) &&
          !r.propertyId &&
          r.memo !== input.memoSample,
      )
      .map((r) => r.memo ?? "");
    const tok = suggestMemoToken(String(input.memoSample), otherMemos);

    const matches = allRows.filter((r) => {
      if (qboCustomerId && r.qboCustomerId !== qboCustomerId) return false;
      if (qboVendorId && r.qboVendorId !== qboVendorId) return false;
      if (toMemoToken(r.memo ?? "") !== tok) return false;
      return true;
    });

    // Recommend a property: the most common already-mapped property
    // among matching transactions, OR fall back to the operator's
    // explicit propertyId if provided.
    const propCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.propertyId) {
        propCounts.set(m.propertyId, (propCounts.get(m.propertyId) ?? 0) + 1);
      }
    }
    let suggestedPropertyId = (input.propertyId as string) ?? "";
    if (!suggestedPropertyId && propCounts.size > 0) {
      suggestedPropertyId = [...propCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0][0];
    }

    const skippedManual = matches.filter((m) => m.manualOverride).length;
    return {
      draft: {
        memoToken: tok,
        qboCustomerId,
        qboVendorId,
        customerId: input.customerId ?? null,
        propertyId: suggestedPropertyId,
        leaseId: input.leaseId ?? null,
        utilityId: input.utilityId ?? null,
      },
      wouldReclassify: matches.length - skippedManual,
      skippedManual,
      sampleTransactions: matches.slice(0, 10).map((m) => ({
        id: m.id,
        txnDate: m.txnDate,
        type: m.type,
        memo: m.memo,
        amount: m.amount,
        currentPropertyId: m.propertyId,
      })),
    };
  },
});

/**
 * WRITE tool. The assistant runtime gates this behind a confirm card.
 * Persists the rule (insert or natural-key upsert) and runs the
 * one-shot reclassifier — i.e. the same code path the Mapping Rules
 * page uses on Save.
 */
qboAssistantTools.push({
  name: "confirm_qbo_mapping_rule",
  kind: "write",
  description:
    "Persist a QuickBooks → HousingOps memo→property mapping rule the operator has just approved, and one-shot reclassify every mirrored transaction that matches it. ONLY call this with the `draft` returned by a prior propose_qbo_mapping_rule call AND after the operator explicitly says yes — never invent the draft fields.",
  input_schema: obj(
    {
      memoToken: Str,
      propertyId: Str,
      qboCustomerId: StrOpt,
      qboVendorId: StrOpt,
      leaseId: StrOpt,
      utilityId: StrOpt,
    },
    ["memoToken", "propertyId"],
  ),
  summarize: (i) =>
    `Saving rule: memo "${i.memoToken}" → property ${i.propertyId}`,
  execute: async (input) => {
    const [conn] = await db.select().from(qboConnectionsTable).limit(1);
    if (!conn) return { error: "QuickBooks is not connected." };
    const qboCustomerId = (input.qboCustomerId as string) ?? "";
    const qboVendorId = (input.qboVendorId as string) ?? "";
    const tok = toMemoToken(String(input.memoToken));
    const id = `qov-${randomUUID().slice(0, 8)}`;
    const [rule] = await db
      .insert(qboMappingOverridesTable)
      .values({
        id,
        realmId: conn.realmId,
        qboCustomerId,
        qboVendorId,
        memoToken: tok,
        propertyId: input.propertyId,
        leaseId: input.leaseId ?? null,
        utilityId: input.utilityId ?? null,
        createdByUserId: "",
      })
      .onConflictDoUpdate({
        target: [
          qboMappingOverridesTable.realmId,
          qboMappingOverridesTable.qboCustomerId,
          qboMappingOverridesTable.qboVendorId,
          qboMappingOverridesTable.memoToken,
        ],
        set: {
          propertyId: input.propertyId,
          leaseId: input.leaseId ?? null,
          utilityId: input.utilityId ?? null,
        },
      })
      .returning();
    const r = await reclassifyForRule({
      realmId: conn.realmId,
      qboCustomerId,
      qboVendorId,
      memoToken: tok,
      propertyId: input.propertyId,
      leaseId: input.leaseId ?? null,
      utilityId: input.utilityId ?? null,
    });
    return {
      rule,
      reclassified: r.reclassified,
      skippedManual: r.skippedManual,
    };
  },
});

qboAssistantTools.push({
  name: "export_reconciliation",
  kind: "read",
  description:
    "Export the per-property reconciliation for a given month as an .xlsx file with a Totals sheet. Columns mirror the UI grid: expected rent + utilities, invoiced rent + utilities, paid rent + utilities, variance. Returns a download chip the operator clicks.",
  input_schema: obj({ month: StrOpt, customerId: StrOpt, propertyId: StrOpt }),
  summarize: (i) =>
    `Exporting reconciliation ${i.month ?? "this month"}`,
  execute: async (input, ctx) => {
    const month = input.month ?? new Date().toISOString().slice(0, 7);
    const { rows: summary } = await computeSummary(month, {
      customerId: input.customerId,
      propertyId: input.propertyId,
    });
    const rows = summary.map((r) => ({
      customer: r.customerName,
      property: r.propertyName,
      expectedRent: r.expectedRent,
      expectedUtilities: r.expectedUtilities,
      invoicedRent: r.invoicedRent,
      invoicedUtilities: r.invoicedUtilities,
      paidRent: r.paidRent,
      paidUtilities: r.paidUtilities,
      variance: r.variance,
    }));
    const columns: ExportColumn[] = [
      { key: "customer", header: "Customer" },
      { key: "property", header: "Property" },
      { key: "expectedRent", header: "Expected rent", format: "currency" },
      { key: "expectedUtilities", header: "Expected utilities", format: "currency" },
      { key: "invoicedRent", header: "Invoiced rent", format: "currency" },
      { key: "invoicedUtilities", header: "Invoiced utilities", format: "currency" },
      { key: "paidRent", header: "Paid rent", format: "currency" },
      { key: "paidUtilities", header: "Paid utilities", format: "currency" },
      { key: "variance", header: "Variance", format: "currency" },
    ];
    const col = (k: string) =>
      colLetter(columns.findIndex((c) => c.key === k));
    const buffer = buildXlsxBuffer({
      title: `Reconciliation ${month}`,
      filterDesc: `Month=${month}${input.customerId ? `, customer=${input.customerId}` : ""}${input.propertyId ? `, property=${input.propertyId}` : ""}`,
      columns,
      rows,
      summary: {
        name: "Totals",
        rows: [
          { label: "Properties", value: rows.length },
          { label: "Expected rent", formula: `=SUM(${col("expectedRent")}5:${col("expectedRent")}{lastRow})` },
          { label: "Expected utilities", formula: `=SUM(${col("expectedUtilities")}5:${col("expectedUtilities")}{lastRow})` },
          { label: "Invoiced rent", formula: `=SUM(${col("invoicedRent")}5:${col("invoicedRent")}{lastRow})` },
          { label: "Invoiced utilities", formula: `=SUM(${col("invoicedUtilities")}5:${col("invoicedUtilities")}{lastRow})` },
          { label: "Paid rent", formula: `=SUM(${col("paidRent")}5:${col("paidRent")}{lastRow})` },
          { label: "Paid utilities", formula: `=SUM(${col("paidUtilities")}5:${col("paidUtilities")}{lastRow})` },
          { label: "Variance", formula: `=SUM(${col("variance")}5:${col("variance")}{lastRow})` },
        ],
      },
    });
    const id = `ax-${randomUUID().slice(0, 8)}`;
    const filename = `reconciliation-${month}.xlsx`;
    const storageKey = await putAssistantExportObject(
      id,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await db.insert(assistantExportsTable).values({
      id,
      userId: ctx.userId,
      conversationId: ctx.conversationId ?? null,
      toolName: "export_reconciliation",
      entityType: "reconciliation",
      filename,
      format: "xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.length,
      rowCount: rows.length,
      storageKey,
      createdAt: now,
      expiresAt,
    });
    return {
      kind: "export",
      exportId: id,
      filename,
      format: "xlsx",
      sizeBytes: buffer.length,
      rowCount: rows.length,
    };
  },
});
