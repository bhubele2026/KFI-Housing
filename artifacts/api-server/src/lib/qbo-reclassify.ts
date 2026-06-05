import { and, eq, sql } from "drizzle-orm";
import {
  db as defaultDb,
  qboTransactionsTable,
  type QboMappingOverrideRow,
} from "@workspace/db";
import { memoToken } from "./qbo-mapping";

/**
 * One-shot re-classification of mirrored QBO transactions against a
 * newly-saved (or imported) memo→property mapping rule (Task #694).
 *
 * For every row in `qbo_transactions` whose `(realmId, qboCustomerId,
 * qboVendorId, memoToken)` matches the rule and whose `manualOverride`
 * is `false`, we recompute the mapping fields (propertyId / leaseId /
 * utilityId), bump `mappedConfidence` to 1.0, and stamp
 * `reclassifiedAt`. Rows with `manualOverride=true` are skipped
 * (operator's manual choices win) but counted in `skippedManual` so
 * the UI can surface "N manual overrides matched this rule — review?".
 *
 * The rule's `qboCustomerId` / `qboVendorId` may be empty strings to
 * mean "any customer/vendor on that dimension".
 */

export interface ReclassifyRule {
  realmId: string;
  qboCustomerId?: string | null;
  qboVendorId?: string | null;
  memoToken: string;
  propertyId: string;
  leaseId?: string | null;
  utilityId?: string | null;
}

export interface ReclassifyResult {
  reclassified: number;
  skippedManual: number;
}

type DbHandle = typeof defaultDb;

export async function reclassifyForRule(
  rule: ReclassifyRule,
  options: { db?: DbHandle; now?: () => Date } = {},
): Promise<ReclassifyResult> {
  const db = options.db ?? defaultDb;
  const now = options.now ?? (() => new Date());
  const tok = (rule.memoToken ?? "").trim();
  if (!tok || !rule.realmId || !rule.propertyId) {
    return { reclassified: 0, skippedManual: 0 };
  }

  // Pull every txn in the realm that potentially matches the customer/
  // vendor scope. Memo matching happens in JS — we have to recompute
  // `memoToken(memo)` to honour the same normalisation that the
  // override engine uses, so a SQL WHERE clause can't shortcut it.
  const rows = await db
    .select()
    .from(qboTransactionsTable)
    .where(eq(qboTransactionsTable.realmId, rule.realmId));

  let reclassified = 0;
  let skippedManual = 0;
  const stamp = now();
  for (const row of rows) {
    if (rule.qboCustomerId && row.qboCustomerId !== rule.qboCustomerId) continue;
    if (rule.qboVendorId && row.qboVendorId !== rule.qboVendorId) continue;
    if (memoToken(row.memo ?? "") !== tok) continue;
    if (row.manualOverride) {
      skippedManual += 1;
      continue;
    }
    await db
      .update(qboTransactionsTable)
      .set({
        propertyId: rule.propertyId,
        leaseId: rule.leaseId ?? null,
        utilityId: rule.utilityId ?? null,
        mappedConfidence: 1,
        reclassifiedAt: stamp,
        updatedAt: stamp,
      })
      .where(eq(qboTransactionsTable.id, row.id));
    reclassified += 1;
  }
  return { reclassified, skippedManual };
}

/** Run every override in the realm through {@link reclassifyForRule}.
 *  Called by the sync job after each per-realm pull so freshly-imported
 *  transactions inherit existing rules without waiting for the operator
 *  to re-save anything. Safe to invoke repeatedly — re-running on rows
 *  that already match the rule is a no-op for the mapping fields and
 *  simply refreshes `reclassifiedAt`. */
export async function reclassifyForAllRules(
  realmId: string,
  rules: QboMappingOverrideRow[],
  options: { db?: DbHandle; now?: () => Date } = {},
): Promise<ReclassifyResult> {
  let reclassified = 0;
  let skippedManual = 0;
  for (const r of rules) {
    if (r.realmId !== realmId) continue;
    const out = await reclassifyForRule(
      {
        realmId,
        qboCustomerId: r.qboCustomerId,
        qboVendorId: r.qboVendorId,
        memoToken: r.memoToken,
        propertyId: r.propertyId,
        leaseId: r.leaseId,
        utilityId: r.utilityId,
      },
      options,
    );
    reclassified += out.reclassified;
    skippedManual += out.skippedManual;
  }
  return { reclassified, skippedManual };
}
