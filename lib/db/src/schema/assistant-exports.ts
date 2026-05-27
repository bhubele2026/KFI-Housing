import { pgTable, text, integer, timestamp, index, customType } from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Generated exports the assistant produced for the operator (Task #681).
 *
 * Mirrors `assistant_uploads` but for the OUT direction — when the
 * operator asks the assistant for an Excel or PDF dump of a listable
 * dataset, one of the `export_*` tools generates the file in-memory,
 * persists the bytes here, and returns just the row's id. A download
 * route (`GET /api/assistant/exports/:id/download`) streams the bytes
 * back to the browser when the operator clicks the chip in chat.
 *
 * Rows live 24h and are pruned by an hourly cleanup scheduler so the
 * `bytea` column never grows unbounded.
 */
export const assistantExportsTable = pgTable(
  "assistant_exports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    toolName: text("tool_name").notNull(),
    format: text("format").notNull(),
    entityType: text("entity_type").notNull(),
    rowCount: integer("row_count").notNull(),
    filterDesc: text("filter_desc"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    byUser: index("assistant_exports_user_created_idx").on(
      t.userId,
      desc(t.createdAt),
    ),
    byExpires: index("assistant_exports_expires_idx").on(t.expiresAt),
  }),
);

export type AssistantExportRow = typeof assistantExportsTable.$inferSelect;
export type InsertAssistantExportRow = typeof assistantExportsTable.$inferInsert;
