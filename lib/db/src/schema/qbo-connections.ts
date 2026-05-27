import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One row per connected QuickBooks Online realm (company). Stores the
 * Intuit OAuth tokens and the incremental-sync cursor so the
 * background sync job can resume where it left off and the access
 * token can be transparently refreshed.
 *
 * The refresh-token lifecycle is owned entirely by the QBO client
 * wrapper at `artifacts/api-server/src/lib/qbo-client.ts`; this row is
 * just the persistent store.
 */
export const qboConnectionsTable = pgTable(
  "qbo_connections",
  {
    id: text("id").primaryKey(),
    realmId: text("realm_id").notNull(),
    /** QBO company display name (snapshotted at connect time). */
    companyName: text("company_name").notNull().default(""),
    /** "sandbox" | "production". */
    environment: text("environment").notNull().default("production"),
    accessToken: text("access_token").notNull().default(""),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshToken: text("refresh_token").notNull().default(""),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    connectedByUserId: text("connected_by_user_id").notNull().default(""),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStartedAt: timestamp("last_sync_started_at", {
      withTimezone: true,
    }),
    lastSyncError: text("last_sync_error").notNull().default(""),
    /**
     * Stringified JSON map of per-entity cursors (ISO timestamps used
     * with `Metadata.LastUpdatedTime >= ?`). Example:
     * {"Customer":"2026-01-01T00:00:00Z","Invoice":"…"}.
     * Empty string = first sync; the sync job treats that as a
     * "historical bulk pull" trigger.
     */
    lastSyncCursor: text("last_sync_cursor").notNull().default(""),
    /**
     * Historical pull state: {months, completedEntities, totalEntities}
     * encoded as JSON. Lets the settings page show a progress bar
     * while the initial 12-month pull runs in the background.
     */
    historicalPullProgress: text("historical_pull_progress")
      .notNull()
      .default(""),
  },
  (table) => ({
    realmUnique: uniqueIndex("qbo_connections_realm_unique").on(table.realmId),
  }),
);

export type QboConnectionRow = typeof qboConnectionsTable.$inferSelect;
export type InsertQboConnectionRow = typeof qboConnectionsTable.$inferInsert;
