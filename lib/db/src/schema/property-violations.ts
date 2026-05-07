import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-property rule violations communicated by the property
 * (typically copy-pasted from emailed notices). Tied to a specific
 * occupant in the unit and categorised by type so a property-level
 * summary count and per-category breakdown can be rendered without
 * walking note text.
 *
 * `occupantId` is nullable because the offender may have already
 * moved out by the time the operator records the notice — we still
 * want to log it. `occupantName` is captured as a snapshot at
 * logging time so the row stays human-readable even after the
 * occupant row is deleted.
 *
 * `category` is a free-text column constrained at the API boundary
 * (see `lib/api-spec/openapi.yaml` -> `PropertyViolationCategory`).
 * `details` is only meaningful when `category === "other"`; the UI
 * surfaces it as the free-form "what kind?" follow-up.
 *
 * `notes` holds the pasted notification body verbatim — operators
 * usually drop the original email text in here.
 *
 * `occurredOn` is the date the violation was reported / observed,
 * stored as YYYY-MM-DD to match every other date column in the
 * schema. `createdAt` is the row insertion time; `createdBy` is a
 * free-text operator name (we don't have a real user identity yet).
 */
export const propertyViolationsTable = pgTable("property_violations", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  /** Nullable: the occupant may have moved out before the violation
   *  was recorded; we still want to keep the row. */
  occupantId: text("occupant_id"),
  /** Snapshot of the occupant's display name at logging time so the
   *  row stays readable after the occupant is deleted. */
  occupantName: text("occupant_name").notNull().default(""),
  /** One of: smoking | parking | noise | police | maintenance |
   *  cleanliness | other. Constrained at the API boundary. */
  category: text("category").notNull().default("other"),
  /** Free-text "what kind?" detail — only meaningful when
   *  `category === "other"`. Empty string otherwise. */
  details: text("details").notNull().default(""),
  /** The pasted notification body. */
  notes: text("notes").notNull().default(""),
  /** YYYY-MM-DD; matches the date format used elsewhere. */
  occurredOn: text("occurred_on").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  createdBy: text("created_by").notNull().default(""),
});

export type PropertyViolationRow = typeof propertyViolationsTable.$inferSelect;
export type InsertPropertyViolationRow =
  typeof propertyViolationsTable.$inferInsert;
