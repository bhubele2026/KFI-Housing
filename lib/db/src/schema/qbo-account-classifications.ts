import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Operator-editable map from a QBO chart-of-accounts entry to one of
 * `rent | utility | other`. Seeded automatically from the account name
 * during sync (e.g. "53206 FOH ER Provided Rent Expense" → `rent`,
 * anything containing "utilities" / "water" / "electric" → `utility`),
 * but the settings page lets the operator override the classification
 * for any single account.
 */
export const qboAccountClassificationsTable = pgTable(
  "qbo_account_classifications",
  {
    id: text("id").primaryKey(),
    realmId: text("realm_id").notNull(),
    qboAccountId: text("qbo_account_id").notNull().default(""),
    accountName: text("account_name").notNull().default(""),
    classification: text("classification").notNull().default("other"),
    editedByUserId: text("edited_by_user_id"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => ({
    accountUnique: uniqueIndex("qbo_account_classifications_unique").on(
      table.realmId,
      table.qboAccountId,
      table.accountName,
    ),
  }),
);

export type QboAccountClassificationRow =
  typeof qboAccountClassificationsTable.$inferSelect;
export type InsertQboAccountClassificationRow =
  typeof qboAccountClassificationsTable.$inferInsert;
