import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AssistantMessageRow = typeof assistantMessagesTable.$inferSelect;
export type InsertAssistantMessageRow = typeof assistantMessagesTable.$inferInsert;
