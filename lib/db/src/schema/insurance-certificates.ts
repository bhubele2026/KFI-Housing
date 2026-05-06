import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Renter's / liability insurance certificates on file for a property
 * (and optionally a specific lease). Modeled as a small first-class
 * entity rather than free-form notes so that:
 *   - expiry tracking is queryable (coverage_end ≤ today + 30d, etc.),
 *   - audits can list every certificate and its source document,
 *   - operators can see at a glance whether a property is covered.
 *
 * Most fields default to empty strings so older PDFs that only
 * acknowledge a certificate exists (without spelling out carrier /
 * policy / dates) can still be captured. The natural identity used by
 * the seeders is `(propertyId, policyNumber)` — see
 * `seed-chateau-knoll.ts` for the dedupe strategy.
 */
export const insuranceCertificatesTable = pgTable("insurance_certificates", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  /** Optional: scope the certificate to a specific lease. Empty when
   *  the cert covers the property as a whole. */
  leaseId: text("lease_id").notNull().default(""),
  /** Underwriting carrier as printed on the certificate (e.g.
   *  "Philadelphia Indemnity"). */
  carrier: text("carrier").notNull().default(""),
  /** Policy number from the certificate (e.g. ACORD 25 box). */
  policyNumber: text("policy_number").notNull().default(""),
  /** Named insured on the certificate (often the staffing company,
   *  not the property landlord). */
  insuredName: text("insured_name").notNull().default(""),
  /** YYYY-MM-DD; matches the date format used elsewhere in the schema. */
  coverageStart: text("coverage_start").notNull().default(""),
  coverageEnd: text("coverage_end").notNull().default(""),
  /** Source PDF / file marker. Free-form so it can hold an attached
   *  asset filename today and a real object-storage URL later. */
  documentUrl: text("document_url").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type InsuranceCertificateRow =
  typeof insuranceCertificatesTable.$inferSelect;
export type InsertInsuranceCertificateRow =
  typeof insuranceCertificatesTable.$inferInsert;
