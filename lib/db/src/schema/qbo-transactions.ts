import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * One row per QuickBooks Online transaction we've mirrored locally
 * (Task #689). Covers `Invoice`, `Bill`, `Payment`, `BillPayment`
 * (and `VendorCredit` collapsed into the `bill` type with a negative
 * amount). The `(realmId, qboId, type)` unique index makes the sync
 * job's upsert idempotent.
 *
 * Mapping fields (`customerId`, `propertyId`, `leaseId`, `utilityId`,
 * `classification`, `mappedConfidence`, `manualOverride`) are
 * populated by `qbo-mapping.ts` after each sync; rows where the
 * pipeline can't confidently match a property surface in the
 * "Needs mapping" tray on the reconciliation page.
 */
export const QBO_TXN_TYPES = ["invoice", "bill", "payment", "bill_payment"] as const;
export type QboTxnType = (typeof QBO_TXN_TYPES)[number];

export const QBO_CLASSIFICATIONS = ["rent", "utility", "other"] as const;
export type QboClassification = (typeof QBO_CLASSIFICATIONS)[number];

export const qboTransactionsTable = pgTable(
  "qbo_transactions",
  {
    id: text("id").primaryKey(),
    qboId: text("qbo_id").notNull(),
    realmId: text("realm_id").notNull(),
    type: text("type").notNull(),
    txnDate: text("txn_date").notNull().default(""),
    qboCustomerId: text("qbo_customer_id").notNull().default(""),
    qboVendorId: text("qbo_vendor_id").notNull().default(""),
    customerId: text("customer_id"),
    propertyId: text("property_id"),
    leaseId: text("lease_id"),
    utilityId: text("utility_id"),
    classification: text("classification").notNull().default("other"),
    amount: doublePrecision("amount").notNull().default(0),
    balance: doublePrecision("balance").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    memo: text("memo").notNull().default(""),
    locationName: text("location_name").notNull().default(""),
    accountName: text("account_name").notNull().default(""),
    accountId: text("account_id").notNull().default(""),
    rawJson: jsonb("raw_json").notNull().default({}),
    mappedConfidence: doublePrecision("mapped_confidence")
      .notNull()
      .default(0),
    manualOverride: boolean("manual_override").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    qboIdUnique: uniqueIndex("qbo_transactions_qbo_id_unique").on(
      table.realmId,
      table.qboId,
      table.type,
    ),
    propertyDateIdx: index("qbo_transactions_property_date_idx").on(
      table.propertyId,
      table.txnDate,
    ),
    customerDateIdx: index("qbo_transactions_customer_date_idx").on(
      table.customerId,
      table.txnDate,
    ),
    classificationIdx: index("qbo_transactions_classification_idx").on(
      table.propertyId,
      table.classification,
      table.txnDate,
    ),
  }),
);

export type QboTransactionRow = typeof qboTransactionsTable.$inferSelect;
export type InsertQboTransactionRow = typeof qboTransactionsTable.$inferInsert;
