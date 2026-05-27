import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  leasesTable,
  propertiesTable,
  utilitiesTable,
  qboTransactionsTable,
  qboMappingOverridesTable,
  type LeaseRow,
  type PropertyRow,
  type UtilityRow,
  type QboTransactionRow,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/requireAuth";

/**
 * Per-property rent/utility reconciliation (Task #689).
 *
 * `expected` is the sum of:
 *   - active leases on the property (their `monthlyRent` for the month)
 *   - all `utilities.monthlyCost` rows on the property
 * `invoiced` / `paid` come from the mirrored QBO transactions, scoped
 * to the month and the property's matched rows.
 * `variance = paid - expected`.
 */

const router: IRouter = Router();

/**
 * Returns the half-open [start, endExclusive) bounds for a YYYY-MM month.
 * Callers MUST use `>= start` AND `< endExclusive` to avoid counting the
 * first day of the following month.
 */
export function monthBounds(
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

function leaseActiveInMonth(l: LeaseRow, start: string, end: string): boolean {
  const s = l.startDate || "";
  const e = l.endDate || "9999-12-31";
  return (!s || s < end) && (!e || e >= start);
}

interface PropertyRollup {
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
  /** "ok" | "warn" | "bad" — ±$1 threshold around 0 variance, "warn" if invoiced != paid. */
  status: "ok" | "warn" | "bad";
  unmappedCount: number;
}

const VARIANCE_THRESHOLD = 1;
function statusOf(variance: number, invoiced: number, paid: number): "ok" | "warn" | "bad" {
  if (Math.abs(variance) <= VARIANCE_THRESHOLD && Math.abs(invoiced - paid) <= VARIANCE_THRESHOLD) {
    return "ok";
  }
  if (Math.abs(variance) > VARIANCE_THRESHOLD) return "bad";
  return "warn";
}

async function handlePropertiesRollup(req: Request, res: Response): Promise<void> {
  const month =
    typeof req.query["month"] === "string"
      ? req.query["month"]
      : new Date().toISOString().slice(0, 7);
  const customerId =
    typeof req.query["customerId"] === "string" && req.query["customerId"]
      ? req.query["customerId"]
      : null;
  const propertyIdFilter =
    typeof req.query["propertyId"] === "string" && req.query["propertyId"]
      ? req.query["propertyId"]
      : null;
  const bounds = monthBounds(month);
  if (!bounds) {
    res.status(400).json({ error: "month must be YYYY-MM" });
    return;
  }

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
  let propScope = properties as PropertyRow[];
  if (customerId) propScope = propScope.filter((p) => p.customerId === customerId);
  if (propertyIdFilter)
    propScope = propScope.filter((p) => p.id === propertyIdFilter);

  const rows: PropertyRollup[] = propScope.map((p) => {
    const propLeases = (leases as LeaseRow[]).filter(
      (l) =>
        l.propertyId === p.id &&
        (l.status ?? "").toLowerCase() === "active" &&
        leaseActiveInMonth(l, bounds.start, bounds.endExclusive),
    );
    const expectedRent = propLeases.reduce(
      (sum, l) => sum + (l.monthlyRent ?? 0),
      0,
    );
    const expectedUtilities = (utilities as UtilityRow[])
      .filter((u) => u.propertyId === p.id)
      .reduce((sum, u) => sum + (u.monthlyCost ?? 0), 0);

    const propTxns = (txns as QboTransactionRow[]).filter(
      (t) => t.propertyId === p.id,
    );

    let invoicedRent = 0;
    let invoicedUtilities = 0;
    let paidRent = 0;
    let paidUtilities = 0;
    for (const t of propTxns) {
      const isInvoice = t.type === "invoice" || t.type === "bill";
      const isPayment = t.type === "payment" || t.type === "bill_payment";
      if (t.classification === "rent") {
        if (isInvoice) invoicedRent += t.amount;
        if (isPayment) paidRent += t.amount;
      } else if (t.classification === "utility") {
        if (isInvoice) invoicedUtilities += t.amount;
        if (isPayment) paidUtilities += t.amount;
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
      variance: paidRent + paidUtilities - expectedRent - expectedUtilities,
      status: statusOf(
        paidRent + paidUtilities - expectedRent - expectedUtilities,
        invoicedRent + invoicedUtilities,
        paidRent + paidUtilities,
      ),
      unmappedCount: 0,
    };
  });

  // Unmapped count is a single SQL aggregate so the page can show
  // "N transactions need mapping" without scanning every txn in JS.
  const unmappedRows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(qboTransactionsTable)
    .where(
      and(
        gte(qboTransactionsTable.txnDate, bounds.start),
        lt(qboTransactionsTable.txnDate, bounds.endExclusive),
        sql`${qboTransactionsTable.propertyId} IS NULL`,
      ),
    )) as Array<{ count: number }>;

  res.json({
    month,
    rows: rows.sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
    unmappedCount: unmappedRows[0]?.count ?? 0,
  });
}

router.get("/reconciliation/properties", handlePropertiesRollup);
router.get("/reconciliation/summary", handlePropertiesRollup);

router.get("/reconciliation/unmapped", async (req, res) => {
  const limit = Math.min(
    500,
    Math.max(1, Number(req.query["limit"] ?? 50)),
  );
  // Cursor format: "<txnDate>|<id>". Returns rows strictly greater than
  // the cursor under (txnDate ASC, id ASC) ordering.
  const cursor =
    typeof req.query["cursor"] === "string" ? req.query["cursor"] : null;
  const conds = [sql`${qboTransactionsTable.propertyId} IS NULL`];
  if (cursor) {
    const [cDate, cId] = cursor.split("|");
    if (cDate && cId) {
      conds.push(
        sql`(${qboTransactionsTable.txnDate}, ${qboTransactionsTable.id}) > (${cDate}, ${cId})`,
      );
    }
  }
  const rows = await db
    .select()
    .from(qboTransactionsTable)
    .where(and(...conds))
    .orderBy(asc(qboTransactionsTable.txnDate), asc(qboTransactionsTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  res.json({
    transactions: page,
    nextCursor: hasMore && last ? `${last.txnDate}|${last.id}` : null,
  });
});

router.get("/reconciliation/transactions", async (req, res) => {
  const conds: ReturnType<typeof eq>[] = [];
  if (typeof req.query["propertyId"] === "string") {
    conds.push(eq(qboTransactionsTable.propertyId, req.query["propertyId"]));
  }
  if (typeof req.query["month"] === "string") {
    const b = monthBounds(req.query["month"]);
    if (b) {
      conds.push(gte(qboTransactionsTable.txnDate, b.start));
      conds.push(lt(qboTransactionsTable.txnDate, b.endExclusive));
    }
  }
  if (typeof req.query["classification"] === "string") {
    conds.push(
      eq(qboTransactionsTable.classification, req.query["classification"]),
    );
  }
  const q = db.select().from(qboTransactionsTable);
  const rows =
    conds.length > 0
      ? await q.where(and(...conds)).orderBy(asc(qboTransactionsTable.txnDate))
      : await q.orderBy(asc(qboTransactionsTable.txnDate)).limit(500);
  res.json({ transactions: rows });
});

/**
 * Operator-supplied mapping for a single transaction. Writes the
 * mapping back onto the txn AND creates a `qbo_mapping_overrides` row
 * keyed by (realmId, qboCustomerId, memoToken) so future syncs of the
 * same customer+memo skip the fuzzy step entirely.
 */
async function handleRemap(req: AuthedRequest, res: Response): Promise<void> {
    const id = req.params["id"] as string;
    const propertyId =
      typeof req.body?.propertyId === "string" ? req.body.propertyId : null;
    const leaseId =
      typeof req.body?.leaseId === "string" ? req.body.leaseId : null;
    const utilityId =
      typeof req.body?.utilityId === "string" ? req.body.utilityId : null;
    if (!propertyId) {
      res.status(400).json({ error: "propertyId is required" });
      return;
    }
    const [existing] = await db
      .select()
      .from(qboTransactionsTable)
      .where(eq(qboTransactionsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    const [row] = await db
      .update(qboTransactionsTable)
      .set({
        propertyId,
        leaseId,
        utilityId,
        manualOverride: true,
        mappedConfidence: 1,
        updatedAt: new Date(),
      })
      .where(eq(qboTransactionsTable.id, id))
      .returning();

    // Record an override so future syncs of the same (customer, memo)
    // pair skip the fuzzy step.
    const { memoToken } = await import("../lib/qbo-mapping");
    await db
      .insert(qboMappingOverridesTable)
      .values({
        id: `qov-${randomUUID().slice(0, 8)}`,
        realmId: existing.realmId,
        qboCustomerId: existing.qboCustomerId,
        qboVendorId: existing.qboVendorId,
        memoToken: memoToken(existing.memo),
        propertyId,
        leaseId,
        utilityId,
        createdByUserId: req.appUser?.id ?? "",
      })
      .onConflictDoUpdate({
        target: [
          qboMappingOverridesTable.realmId,
          qboMappingOverridesTable.qboCustomerId,
          qboMappingOverridesTable.qboVendorId,
          qboMappingOverridesTable.memoToken,
        ],
        set: { propertyId, leaseId, utilityId },
      });

    res.json(row);
}

router.post("/reconciliation/transactions/:id/map", handleRemap);
router.post("/reconciliation/transactions/:id/remap", handleRemap);

router.get("/reconciliation/property/:id", async (req, res) => {
  const propertyId = req.params["id"] as string;
  const month =
    typeof req.query["month"] === "string"
      ? req.query["month"]
      : new Date().toISOString().slice(0, 7);
  const bounds = monthBounds(month);
  if (!bounds) {
    res.status(400).json({ error: "month must be YYYY-MM" });
    return;
  }
  const rows = await db
    .select()
    .from(qboTransactionsTable)
    .where(
      and(
        eq(qboTransactionsTable.propertyId, propertyId),
        gte(qboTransactionsTable.txnDate, bounds.start),
        lt(qboTransactionsTable.txnDate, bounds.endExclusive),
      ),
    )
    .orderBy(asc(qboTransactionsTable.txnDate));
  res.json({ propertyId, month, transactions: rows });
});

export default router;
