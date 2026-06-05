import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  utilitiesTable,
  qboConnectionsTable,
  qboTransactionsTable,
  qboAccountClassificationsTable,
  qboMappingOverridesTable,
  type QboConnectionRow,
  type QboClassification,
} from "@workspace/db";
import {
  buildCdcQuery,
  createQboClient,
  type QboClient,
  type QboConfig,
  type FetchImpl,
} from "./qbo-client";
import {
  classifyAccount,
  findOverride,
  matchCustomer,
  matchPropertyFromMemo,
  memoToken,
  pickLeaseForRent,
  pickUtilityForUtility,
} from "./qbo-mapping";
import { logger } from "./logger";

/**
 * Per-realm QuickBooks Online sync (Task #689).
 *
 * Pulls Customer / Invoice / Bill / VendorCredit / Payment / BillPayment
 * incrementally using `Metadata.LastUpdatedTime >= cursor`, normalises
 * every row into `qbo_transactions`, and runs the mapping pipeline
 * to attach `customerId` / `propertyId` / `leaseId` / `utilityId`.
 */

const ENTITIES = [
  "Customer",
  "Invoice",
  "Bill",
  "VendorCredit",
  "Payment",
  "BillPayment",
] as const;

type EntityName = (typeof ENTITIES)[number];

interface SyncDeps {
  config: QboConfig;
  fetchImpl?: FetchImpl;
  now?: () => Date;
  /** Historical pull window in months when no cursor exists yet. Defaults to 12. */
  initialHistoryMonths?: number;
}

export interface SyncResult {
  realmId: string;
  upsertedByEntity: Record<EntityName, number>;
  /** Aggregate of upsertedByEntity for UI convenience. */
  upserted: number;
  /** Count of previously-unmapped rows that the remap pass attached. */
  remappedCount: number;
  error: string | null;
}

interface QboLinkedTxn {
  TxnId?: string;
  TxnType?: string;
}

interface QboLine {
  Amount?: number;
  Description?: string;
  AccountBasedExpenseLineDetail?: {
    AccountRef?: { value?: string; name?: string };
  };
  SalesItemLineDetail?: {
    ItemAccountRef?: { value?: string; name?: string };
  };
  /** Present on Payment / BillPayment line items — points back to the
   *  Invoice / Bill the payment settles. We use this to inherit the
   *  classification from the linked source transaction (rent/utility)
   *  because Payment.Line items only carry a deposit AccountRef, not
   *  the original rent/utility income account. */
  LinkedTxn?: QboLinkedTxn[];
}

interface CommonTxn {
  Id: string;
  TxnDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  TotalAmt?: number;
  Balance?: number;
  CurrencyRef?: { value?: string };
  CustomerRef?: { value?: string; name?: string };
  VendorRef?: { value?: string; name?: string };
  Line?: QboLine[];
  MetaData?: { LastUpdatedTime?: string };
}

function readCursorMap(json: string): Partial<Record<EntityName, string>> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Partial<Record<EntityName, string>>;
  } catch {
    return {};
  }
}

function writeCursorMap(map: Partial<Record<EntityName, string>>): string {
  return JSON.stringify(map);
}

function pickLine(t: CommonTxn): {
  accountId: string;
  accountName: string;
  description: string;
} {
  const lines = t.Line ?? [];
  for (const ln of lines) {
    const acc =
      ln.AccountBasedExpenseLineDetail?.AccountRef ??
      ln.SalesItemLineDetail?.ItemAccountRef;
    if (acc?.name || acc?.value) {
      return {
        accountId: acc?.value ?? "",
        accountName: acc?.name ?? "",
        description: ln.Description ?? "",
      };
    }
  }
  const first = lines[0];
  return { accountId: "", accountName: "", description: first?.Description ?? "" };
}

/** Extract the `(qboType → qboId)` pairs a Payment / BillPayment links
 *  back to. Pure / unit-testable. */
export function extractLinkedTxnRefs(
  t: Pick<CommonTxn, "Line">,
): Array<{ qboType: "invoice" | "bill" | null; qboId: string }> {
  const out: Array<{ qboType: "invoice" | "bill" | null; qboId: string }> = [];
  for (const ln of t.Line ?? []) {
    for (const lk of ln.LinkedTxn ?? []) {
      if (!lk.TxnId) continue;
      const tt = (lk.TxnType ?? "").toLowerCase();
      const qboType: "invoice" | "bill" | null =
        tt === "invoice"
          ? "invoice"
          : tt === "bill" || tt === "vendorcredit"
            ? "bill"
            : null;
      out.push({ qboType, qboId: lk.TxnId });
    }
  }
  return out;
}

/** Given the source-transaction rows a payment / bill_payment links
 *  back to, pick the inherited mapping fields. The classification
 *  with the largest absolute amount wins (so a payment that settles
 *  one rent invoice + a small adjustment still classifies as rent).
 *  Pure / unit-testable. */
export function inheritFromLinked(
  linked: Array<{
    classification: string;
    propertyId: string | null;
    leaseId: string | null;
    utilityId: string | null;
    customerId: string | null;
    amount: number;
  }>,
): {
  classification: QboClassification;
  propertyId: string | null;
  leaseId: string | null;
  utilityId: string | null;
  customerId: string | null;
} | null {
  if (linked.length === 0) return null;
  const byClass: Record<string, number> = { rent: 0, utility: 0, other: 0 };
  for (const r of linked) byClass[r.classification] =
    (byClass[r.classification] ?? 0) + Math.abs(r.amount);
  const cls = (Object.entries(byClass).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "other") as QboClassification;
  // Prefer the first linked row that matches the winning classification
  // for the property/lease/utility/customer carry-over so we don't
  // pick fields from a row whose classification is "other".
  const pick = linked.find((r) => r.classification === cls) ?? linked[0]!;
  return {
    classification: cls,
    propertyId: pick.propertyId,
    leaseId: pick.leaseId,
    utilityId: pick.utilityId,
    customerId: pick.customerId,
  };
}

function memoOf(t: CommonTxn): string {
  const lineDesc = (t.Line ?? [])
    .map((l) => l.Description ?? "")
    .filter(Boolean)
    .join(" | ");
  return [t.PrivateNote ?? "", lineDesc, t.DocNumber ?? ""]
    .filter(Boolean)
    .join(" — ");
}

interface MappingInputs {
  realmId: string;
  customers: Awaited<ReturnType<typeof db.select>> extends never ? never : Array<typeof customersTable.$inferSelect>;
  properties: Array<typeof propertiesTable.$inferSelect>;
  leases: Array<typeof leasesTable.$inferSelect>;
  utilities: Array<typeof utilitiesTable.$inferSelect>;
  classifications: Array<typeof qboAccountClassificationsTable.$inferSelect>;
  overrides: Array<typeof qboMappingOverridesTable.$inferSelect>;
}

export interface MappedFields {
  customerId: string | null;
  propertyId: string | null;
  leaseId: string | null;
  utilityId: string | null;
  classification: QboClassification;
  mappedConfidence: number;
  manualOverride: boolean;
}

export function mapTransaction(
  inp: {
    qboCustomerId: string;
    qboCustomerName: string;
    qboVendorId: string;
    qboVendorName: string;
    accountId: string;
    accountName: string;
    memo: string;
    txnDate: string;
  },
  m: MappingInputs,
): MappedFields {
  // 1. Override wins.
  const override = findOverride(
    m.realmId,
    inp.qboCustomerId,
    inp.qboVendorId,
    inp.memo,
    m.overrides,
  );
  if (override) {
    const classification = classifyAccount(
      inp.accountName,
      inp.accountId,
      m.classifications,
    );
    return {
      customerId:
        matchCustomer(
          { id: inp.qboCustomerId, displayName: inp.qboCustomerName },
          m.customers,
        ).customerId ?? null,
      propertyId: override.propertyId,
      leaseId: override.leaseId ?? null,
      utilityId: override.utilityId ?? null,
      classification,
      mappedConfidence: 1,
      manualOverride: true,
    };
  }

  // 2. Customer
  const c = matchCustomer(
    {
      id: inp.qboCustomerId || inp.qboVendorId,
      displayName: inp.qboCustomerName || inp.qboVendorName,
    },
    m.customers,
  );

  // 3. Property
  const p = matchPropertyFromMemo(inp.memo, m.properties, m.customers);

  // 4. Classification
  const classification = classifyAccount(
    inp.accountName,
    inp.accountId,
    m.classifications,
  );

  // 5. Lease / utility
  let leaseId: string | null = null;
  let utilityId: string | null = null;
  if (p.propertyId) {
    if (classification === "rent") {
      leaseId = pickLeaseForRent(p.propertyId, inp.txnDate, m.leases);
    } else if (classification === "utility") {
      utilityId = pickUtilityForUtility(
        p.propertyId,
        inp.memo,
        inp.accountName,
        m.utilities,
      );
    }
  }

  return {
    customerId: c.customerId,
    propertyId: p.propertyId,
    leaseId,
    utilityId,
    classification,
    mappedConfidence: Math.max(c.confidence, p.confidence),
    manualOverride: false,
  };
}

async function loadMappingInputs(realmId: string): Promise<MappingInputs> {
  const [customers, properties, leases, utilities, classifications, overrides] =
    await Promise.all([
      db.select().from(customersTable),
      db.select().from(propertiesTable),
      db.select().from(leasesTable),
      db.select().from(utilitiesTable),
      db
        .select()
        .from(qboAccountClassificationsTable)
        .where(eq(qboAccountClassificationsTable.realmId, realmId)),
      db
        .select()
        .from(qboMappingOverridesTable)
        .where(eq(qboMappingOverridesTable.realmId, realmId)),
    ]);
  return {
    realmId,
    customers,
    properties,
    leases,
    utilities,
    classifications,
    overrides,
  };
}

async function upsertCustomerLink(
  realmId: string,
  qboCustomer: { id: string; displayName: string },
  mapping: MappingInputs,
): Promise<void> {
  const r = matchCustomer(qboCustomer, mapping.customers);
  if (!r.customerId) return;
  const existing = mapping.customers.find((c) => c.id === r.customerId);
  if (existing && existing.qboCustomerId === qboCustomer.id) return;
  await db
    .update(customersTable)
    .set({ qboCustomerId: qboCustomer.id })
    .where(eq(customersTable.id, r.customerId));
  if (existing) existing.qboCustomerId = qboCustomer.id;
}

async function upsertTxn(
  realmId: string,
  type: "invoice" | "bill" | "payment" | "bill_payment",
  t: CommonTxn,
  signedAmount: number,
  mapping: MappingInputs,
): Promise<void> {
  const line = pickLine(t);
  const memo = memoOf(t);
  const qboCustomerId = t.CustomerRef?.value ?? "";
  const qboVendorId = t.VendorRef?.value ?? "";

  // Seed account classification row so the settings page can show /
  // edit it. Conflict-free: do nothing if it already exists.
  if (line.accountName || line.accountId) {
    await db
      .insert(qboAccountClassificationsTable)
      .values({
        id: `qac-${randomUUID().slice(0, 8)}`,
        realmId,
        qboAccountId: line.accountId,
        accountName: line.accountName,
        classification: classifyAccount(
          line.accountName,
          line.accountId,
          mapping.classifications,
        ),
      })
      .onConflictDoNothing();
  }

  const mapped = mapTransaction(
    {
      qboCustomerId,
      qboCustomerName: t.CustomerRef?.name ?? "",
      qboVendorId,
      qboVendorName: t.VendorRef?.name ?? "",
      accountId: line.accountId,
      accountName: line.accountName,
      memo,
      txnDate: t.TxnDate ?? "",
    },
    mapping,
  );

  // Payment / BillPayment line items reference a *deposit* account
  // (e.g. "Undeposited Funds") rather than the original rent/utility
  // income account. Inherit classification + property mapping from the
  // linked Invoice / Bill row(s) we already synced earlier in this
  // pass; without this, payments end up classified as "other" and
  // paid-vs-expected reconciliation silently misses every settled
  // dollar.
  if ((type === "payment" || type === "bill_payment") &&
      mapped.classification === "other") {
    const refs = extractLinkedTxnRefs(t);
    if (refs.length > 0) {
      const linkedQboIds = Array.from(new Set(refs.map((r) => r.qboId)));
      const linkedRows = await db
        .select()
        .from(qboTransactionsTable)
        .where(
          sql`${qboTransactionsTable.realmId} = ${realmId}
              AND ${qboTransactionsTable.qboId} = ANY(${linkedQboIds})
              AND ${qboTransactionsTable.type} IN ('invoice', 'bill')`,
        );
      const inherited = inheritFromLinked(
        linkedRows.map((r) => ({
          classification: r.classification,
          propertyId: r.propertyId,
          leaseId: r.leaseId,
          utilityId: r.utilityId,
          customerId: r.customerId,
          amount: r.amount,
        })),
      );
      if (inherited && inherited.classification !== "other") {
        mapped.classification = inherited.classification;
        if (!mapped.propertyId) mapped.propertyId = inherited.propertyId;
        if (!mapped.leaseId) mapped.leaseId = inherited.leaseId;
        if (!mapped.utilityId) mapped.utilityId = inherited.utilityId;
        if (!mapped.customerId) mapped.customerId = inherited.customerId;
        mapped.mappedConfidence = Math.max(mapped.mappedConfidence, 0.95);
      }
    }
  }

  const id = `qbt-${randomUUID().slice(0, 10)}`;
  await db
    .insert(qboTransactionsTable)
    .values({
      id,
      qboId: t.Id,
      realmId,
      type,
      txnDate: t.TxnDate ?? "",
      qboCustomerId,
      qboVendorId,
      customerId: mapped.customerId,
      propertyId: mapped.propertyId,
      leaseId: mapped.leaseId,
      utilityId: mapped.utilityId,
      classification: mapped.classification,
      amount: signedAmount,
      balance: t.Balance ?? 0,
      currency: t.CurrencyRef?.value ?? "USD",
      memo,
      accountName: line.accountName,
      accountId: line.accountId,
      rawJson: t as unknown as Record<string, unknown>,
      mappedConfidence: mapped.mappedConfidence,
      manualOverride: mapped.manualOverride,
    })
    .onConflictDoUpdate({
      target: [
        qboTransactionsTable.realmId,
        qboTransactionsTable.qboId,
        qboTransactionsTable.type,
      ],
      // Re-running sync should NOT clobber a manualOverride row's
      // mapping. We update everything except the override fields when
      // the existing row was operator-edited; otherwise we update
      // the mapping too.
      set: {
        txnDate: t.TxnDate ?? "",
        amount: signedAmount,
        balance: t.Balance ?? 0,
        currency: t.CurrencyRef?.value ?? "USD",
        memo,
        accountName: line.accountName,
        accountId: line.accountId,
        rawJson: t as unknown as Record<string, unknown>,
        // Conditionally update mapping fields: keep the existing
        // values when `manual_override = true`.
        customerId: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.customerId} ELSE ${mapped.customerId} END`,
        propertyId: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.propertyId} ELSE ${mapped.propertyId} END`,
        leaseId: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.leaseId} ELSE ${mapped.leaseId} END`,
        utilityId: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.utilityId} ELSE ${mapped.utilityId} END`,
        classification: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.classification} ELSE ${mapped.classification} END`,
        mappedConfidence: sql`CASE WHEN ${qboTransactionsTable.manualOverride} THEN ${qboTransactionsTable.mappedConfidence} ELSE ${mapped.mappedConfidence} END`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Run one sync pass for a single connection.
 */
export async function runSyncForConnection(
  conn: QboConnectionRow,
  deps: SyncDeps,
): Promise<SyncResult> {
  const now = (deps.now ?? (() => new Date()))();
  await db
    .update(qboConnectionsTable)
    .set({ lastSyncStartedAt: now, lastSyncError: "" })
    .where(eq(qboConnectionsTable.id, conn.id));

  const client = createQboClient({
    config: deps.config,
    connection: {
      realmId: conn.realmId,
      accessToken: conn.accessToken,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
      refreshToken: conn.refreshToken,
    },
    persistTokens: async (t) => {
      await db
        .update(qboConnectionsTable)
        .set({
          accessToken: t.accessToken,
          accessTokenExpiresAt: t.accessTokenExpiresAt,
          refreshToken: t.refreshToken,
          refreshTokenExpiresAt: t.refreshTokenExpiresAt,
        })
        .where(eq(qboConnectionsTable.id, conn.id));
    },
    fetchImpl: deps.fetchImpl,
  });

  const cursors = readCursorMap(conn.lastSyncCursor);
  const upsertedByEntity: Record<EntityName, number> = {
    Customer: 0,
    Invoice: 0,
    Bill: 0,
    VendorCredit: 0,
    Payment: 0,
    BillPayment: 0,
  };

  // For brand-new connections, seed the cursor to `now - initialHistoryMonths`
  // so the first pull is bounded (default 12 months) instead of "all of history".
  const historyMonths = deps.initialHistoryMonths ?? 12;
  const initialCursor = new Date(now);
  initialCursor.setMonth(initialCursor.getMonth() - historyMonths);
  const initialCursorIso = initialCursor.toISOString();

  let firstError: string | null = null;
  const mapping = await loadMappingInputs(conn.realmId);

  for (const entity of ENTITIES) {
    try {
      const since = cursors[entity] ?? initialCursorIso;
      const q = buildCdcQuery(entity, since);
      const newCursorTs = new Date().toISOString();
      for await (const raw of client.iterateQuery<CommonTxn>(q)) {
        if (entity === "Customer") {
          const c = raw as unknown as {
            Id: string;
            DisplayName?: string;
            CompanyName?: string;
          };
          await upsertCustomerLink(
            conn.realmId,
            { id: c.Id, displayName: c.DisplayName ?? c.CompanyName ?? "" },
            mapping,
          );
        } else {
          const type =
            entity === "Invoice"
              ? "invoice"
              : entity === "Bill" || entity === "VendorCredit"
                ? "bill"
                : entity === "Payment"
                  ? "payment"
                  : "bill_payment";
          const signed =
            entity === "VendorCredit" ? -(raw.TotalAmt ?? 0) : raw.TotalAmt ?? 0;
          await upsertTxn(conn.realmId, type as never, raw, signed, mapping);
        }
        upsertedByEntity[entity] += 1;
      }
      cursors[entity] = newCursorTs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, realmId: conn.realmId, entity }, "qbo_sync.error");
      if (!firstError) firstError = `${entity}: ${msg}`;
      // continue with next entity
    }
  }

  // Rule-driven reclassification pass (Task #694) — re-run every saved
  // memo→property mapping rule against the realm so rows imported in
  // this sync inherit overrides written before the sync started. Done
  // BEFORE the fuzzy remap pass below so the rule's confidence=1
  // mapping wins over a fuzzy match.
  try {
    const { qboMappingOverridesTable } = await import("@workspace/db");
    const { reclassifyForAllRules } = await import("./qbo-reclassify");
    const rules = await db
      .select()
      .from(qboMappingOverridesTable)
      .where(eq(qboMappingOverridesTable.realmId, conn.realmId));
    if (rules.length) {
      await reclassifyForAllRules(conn.realmId, rules);
    }
  } catch (err) {
    logger.warn({ err, realmId: conn.realmId }, "qbo_sync.reclassify_pass_error");
  }

  // Remap pass — re-run the mapping pipeline against every transaction
  // that is still missing a propertyId (or was manually marked unmapped).
  // This catches rows whose underlying property/lease/utility/customer
  // entities were created AFTER the original sync, without waiting for
  // QBO to emit a CDC update for them.
  let remappedCount = 0;
  try {
    const remapMapping = await loadMappingInputs(conn.realmId);
    const unmapped = await db
      .select()
      .from(qboTransactionsTable)
      .where(
        sql`${qboTransactionsTable.realmId} = ${conn.realmId}
            AND ${qboTransactionsTable.manualOverride} = false
            AND ${qboTransactionsTable.propertyId} IS NULL`,
      );
    for (const row of unmapped) {
      const fresh = mapTransaction(
        {
          qboCustomerId: row.qboCustomerId ?? "",
          qboCustomerName: "",
          qboVendorId: row.qboVendorId ?? "",
          qboVendorName: "",
          accountId: row.accountId ?? "",
          accountName: row.accountName ?? "",
          memo: row.memo ?? "",
          txnDate: row.txnDate,
        },
        remapMapping,
      );
      if (fresh.propertyId) {
        await db
          .update(qboTransactionsTable)
          .set({
            customerId: fresh.customerId,
            propertyId: fresh.propertyId,
            leaseId: fresh.leaseId,
            utilityId: fresh.utilityId,
            classification: fresh.classification,
            mappedConfidence: fresh.mappedConfidence,
            updatedAt: new Date(),
          })
          .where(eq(qboTransactionsTable.id, row.id));
        remappedCount += 1;
      }
    }
  } catch (err) {
    logger.warn({ err, realmId: conn.realmId }, "qbo_sync.remap_pass_error");
  }

  await db
    .update(qboConnectionsTable)
    .set({
      lastSyncCursor: writeCursorMap(cursors),
      lastSyncAt: new Date(),
      lastSyncError: firstError ?? "",
    })
    .where(eq(qboConnectionsTable.id, conn.id));

  if (firstError) {
    logger.warn({ realmId: conn.realmId, error: firstError }, "qbo_sync.partial");
  } else {
    logger.info(
      { realmId: conn.realmId, counts: upsertedByEntity, remapped: remappedCount },
      "qbo_sync.ok",
    );
  }

  const upserted = Object.values(upsertedByEntity).reduce((a, b) => a + b, 0);
  return {
    realmId: conn.realmId,
    upsertedByEntity,
    upserted,
    remappedCount,
    error: firstError,
  };
}

/** Sync every connected realm. */
export async function runSyncForAllConnections(
  deps: SyncDeps,
): Promise<SyncResult[]> {
  const conns = await db.select().from(qboConnectionsTable);
  const out: SyncResult[] = [];
  for (const c of conns) {
    if (!c.refreshToken) continue;
    try {
      logger.info({ realmId: c.realmId }, "qbo_sync.start");
      out.push(await runSyncForConnection(c, deps));
    } catch (err) {
      logger.error({ err, realmId: c.realmId }, "qbo_sync.error");
      out.push({
        realmId: c.realmId,
        upsertedByEntity: {
          Customer: 0,
          Invoice: 0,
          Bill: 0,
          VendorCredit: 0,
          Payment: 0,
          BillPayment: 0,
        },
        upserted: 0,
        remappedCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
