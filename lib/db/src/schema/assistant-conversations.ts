import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const assistantConversationsTable = pgTable("assistant_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default(""),
  title: text("title").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AssistantConversationRow = typeof assistantConversationsTable.$inferSelect;
export type InsertAssistantConversationRow = typeof assistantConversationsTable.$inferInsert;
