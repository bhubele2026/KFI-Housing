import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Operator-confirmed mappings from "this QBO customer + this memo
 * token" to a HousingOps property (and optionally a specific lease /
 * utility row). The "Needs mapping" tray writes one of these every
 * time the operator manually maps a transaction so the next sync
 * doesn't ask again.
 *
 * `memoToken` is a lowercased + de-noised slug derived from the QBO
 * memo / line description; the mapping engine looks up overrides by
 * (realmId, qboCustomerId, memoToken) before falling back to fuzzy
 * matching.
 */
export const qboMappingOverridesTable = pgTable(
  "qbo_mapping_overrides",
  {
    id: text("id").primaryKey(),
    realmId: text("realm_id").notNull(),
    qboCustomerId: text("qbo_customer_id").notNull().default(""),
    /** When the override originates from a bill (vendor side) the
     *  customer id is empty — keying overrides by `(realm, customer,
     *  memo)` would collide across unrelated vendors that happen to
     *  share a memo token. Including the vendor id in the unique key
     *  keeps customer-side and vendor-side overrides in separate
     *  namespaces. */
    qboVendorId: text("qbo_vendor_id").notNull().default(""),
    memoToken: text("memo_token").notNull().default(""),
    propertyId: text("property_id").notNull(),
    leaseId: text("lease_id"),
    utilityId: text("utility_id"),
    createdByUserId: text("created_by_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    overrideUnique: uniqueIndex("qbo_mapping_overrides_unique").on(
      table.realmId,
      table.qboCustomerId,
      table.qboVendorId,
      table.memoToken,
    ),
  }),
);

export type QboMappingOverrideRow =
  typeof qboMappingOverridesTable.$inferSelect;
export type InsertQboMappingOverrideRow =
  typeof qboMappingOverridesTable.$inferInsert;
