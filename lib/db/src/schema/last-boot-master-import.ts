import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * Singleton row recording the most recent successful boot-time
 * Housing_Lease_MASTER auto-import (Task #341). Persisting this in
 * the database — rather than the in-memory `lastBootImport` module
 * variable used by Task #318 — means the Leases page indicator
 * survives api-server restarts and never briefly shows
 * "never succeeded" on a fresh process when an earlier boot ran
 * cleanly.
 *
 * The table holds at most one row keyed by `id = "singleton"`. The
 * boot wrapper upserts that row on every successful run and the
 * `/leases/import-master/last-auto-import` route reads it back.
 *
 * `ranAt` is stored as an ISO-8601 string (text) to match the
 * existing API contract — the route hands the value straight back
 * to the client without re-formatting it.
 */
export const lastBootMasterImportTable = pgTable("last_boot_master_import", {
  id: text("id").primaryKey(),
  ranAt: text("ran_at").notNull().default(""),
  customersCreated: integer("customers_created").notNull().default(0),
  customersUpdated: integer("customers_updated").notNull().default(0),
  propertiesCreated: integer("properties_created").notNull().default(0),
  propertiesUpdated: integer("properties_updated").notNull().default(0),
  leasesCreated: integer("leases_created").notNull().default(0),
  leasesUpdated: integer("leases_updated").notNull().default(0),
  leasesSkipped: integer("leases_skipped").notNull().default(0),
});

export type LastBootMasterImportRow =
  typeof lastBootMasterImportTable.$inferSelect;
export type InsertLastBootMasterImportRow =
  typeof lastBootMasterImportTable.$inferInsert;
