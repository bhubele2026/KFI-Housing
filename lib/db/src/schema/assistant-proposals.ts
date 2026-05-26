import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const assistantProposalsTable = pgTable("assistant_proposals", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id").notNull().default(""),
  toolName: text("tool_name").notNull(),
  toolUseId: text("tool_use_id").notNull().default(""),
  summary: text("summary").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type AssistantProposalRow = typeof assistantProposalsTable.$inferSelect;
export type InsertAssistantProposalRow = typeof assistantProposalsTable.$inferInsert;
