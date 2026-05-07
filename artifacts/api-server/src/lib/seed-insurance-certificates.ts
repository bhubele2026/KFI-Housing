import { and, eq } from "drizzle-orm";
import { db, insuranceCertificatesTable } from "@workspace/db";

/**
 * Shared idempotent helper for the PDF-derived seeders that want to
 * load insurance certificate rows alongside their customers / properties
 * / leases. Mirrors the inline pattern used in `seed-chateau-knoll.ts`
 * (Task #314) so other PDF seeders can opt in by declaring a static
 * `CERTIFICATES` array and calling this once per transaction.
 *
 * Documented intake path (Task #334):
 *   - When the source insurance PDF is attached to the project, prefer
 *     adding a row to that property's seeder via this helper so the row
 *     replays idempotently across resets.
 *   - When the cert arrives by email but the PDF is not attached,
 *     operators POST `/api/insurance-certificates` directly (see the
 *     `routes/insurance-certificates.ts` route).
 *
 * Dedup is by the natural key `(propertyId, policyNumber)` — same as
 * the Chateau Knoll seeder — so an operator who already loaded the
 * cert under a different id is not duplicated. Insert-only: operator
 * edits to existing cert rows are preserved.
 */

export interface InsuranceCertificateSpec {
  /** Stable seed id used when no existing row matches the natural key. */
  id: string;
  /** Resolved property id this certificate covers. */
  propertyId: string;
  leaseId?: string;
  carrier: string;
  policyNumber: string;
  insuredName: string;
  /** YYYY-MM-DD or "" when unknown. */
  coverageStart: string;
  /** YYYY-MM-DD or "" when unknown. */
  coverageEnd: string;
  /** Source PDF filename, or "" when the cert was captured by hand. */
  documentUrl: string;
  notes: string;
}

/**
 * The same Drizzle transaction handle each seeder receives from
 * `db.transaction(async (tx) => …)` — derived from the live `db`
 * export so this stays in lock-step with whatever Drizzle adapter
 * `@workspace/db` is built against (currently node-pg). Per-seeder
 * unit tests build a fake `db` whose `.transaction(cb)` calls back
 * with their own fake tx; that fake satisfies this same parameter
 * type because the unit tests `vi.mock("@workspace/db", …)` redefine
 * the `db` export, which in turn redefines `Tx` for the test build.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert each spec, deduping by `(propertyId, policyNumber)`. Returns
 * the count of newly-inserted rows. Specs with an empty
 * `policyNumber` are inserted unconditionally on first run only (the
 * id-based unique constraint via `onConflictDoNothing` still keeps it
 * idempotent across boots).
 */
export async function applyInsuranceCertificates(
  tx: Tx,
  specs: readonly InsuranceCertificateSpec[],
): Promise<number> {
  let inserted = 0;
  for (const spec of specs) {
    if (spec.policyNumber !== "") {
      const existing = await tx
        .select({ id: insuranceCertificatesTable.id })
        .from(insuranceCertificatesTable)
        .where(
          and(
            eq(insuranceCertificatesTable.propertyId, spec.propertyId),
            eq(insuranceCertificatesTable.policyNumber, spec.policyNumber),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
    }
    const ins = await tx
      .insert(insuranceCertificatesTable)
      .values({
        id: spec.id,
        propertyId: spec.propertyId,
        leaseId: spec.leaseId ?? "",
        carrier: spec.carrier,
        policyNumber: spec.policyNumber,
        insuredName: spec.insuredName,
        coverageStart: spec.coverageStart,
        coverageEnd: spec.coverageEnd,
        documentUrl: spec.documentUrl,
        notes: spec.notes,
      })
      .onConflictDoNothing()
      .returning({ id: insuranceCertificatesTable.id });
    if (ins.length > 0) inserted += 1;
  }
  return inserted;
}
