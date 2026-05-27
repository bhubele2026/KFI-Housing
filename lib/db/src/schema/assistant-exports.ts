import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";

/**
 * Generated exports the assistant produced for the operator (Task #681).
 *
 * Mirrors `assistant_uploads` but for the OUT direction — when the
 * operator asks the assistant for an Excel or PDF dump of a listable
 * dataset, one of the `export_*` tools generates the file in-memory,
 * uploads the bytes to object storage (App Storage), and persists only
 * the metadata + storage key here. A download route
 * (`GET /api/assistant/exports/:id/download`) streams the bytes back
 * from object storage when the operator clicks the chip in chat.
 *
 * Task #684: the bytes used to live on the row as a `bytea` column,
 * which bloated the table for large room-night / payroll exports.
 * Moving the blob to object storage keeps Postgres light; the row is
 * just an index entry.
 *
 * Rows live 24h and are pruned by an hourly cleanup scheduler that
 * deletes both the row AND the object so neither side grows unbounded.
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
    storageKey: text("storage_key").notNull(),
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
