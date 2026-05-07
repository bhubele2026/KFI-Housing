import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const digestRecipientsTable = pgTable("digest_recipients", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DigestRecipientRow = typeof digestRecipientsTable.$inferSelect;
export type InsertDigestRecipientRow = typeof digestRecipientsTable.$inferInsert;
