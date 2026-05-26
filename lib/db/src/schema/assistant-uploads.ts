import { pgTable, text, integer, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Files attached by the operator inside the assistant panel (Task #647).
 *
 * The assistant supports file-upload proposals — the user attaches a
 * spreadsheet, payroll export, or lease PDF, then the assistant
 * proposes an import that references the upload by id. The file
 * content is held in-database so the proposal survives page reloads
 * and the confirm flow can re-read the original bytes without
 * trusting the client to re-upload.
 *
 * Rows are tied loosely to a conversation (nullable: the file may be
 * uploaded before the conversation is created). We don't enforce a
 * foreign key on `conversationId` so a deleted conversation doesn't
 * cascade-delete an upload that's still referenced by a resolved
 * proposal's history.
 */
export const assistantUploadsTable = pgTable("assistant_uploads", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id"),
  userId: text("user_id").notNull().default(""),
  filename: text("filename").notNull().default(""),
  mime: text("mime").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AssistantUploadRow = typeof assistantUploadsTable.$inferSelect;
export type InsertAssistantUploadRow = typeof assistantUploadsTable.$inferInsert;
