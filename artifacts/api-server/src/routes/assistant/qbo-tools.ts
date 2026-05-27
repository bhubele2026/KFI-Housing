import { randomUUID } from "node:crypto";
import { and, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  leasesTable,
  propertiesTable,
  utilitiesTable,
  qboTransactionsTable,
  type LeaseRow,
  type PropertyRow,
  type QboTransactionRow,
  type UtilityRow,
} from "@workspace/db";
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
