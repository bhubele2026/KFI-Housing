import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, insuranceCertificatesTable } from "@workspace/db";
import {
  ListInsuranceCertificatesResponse,
  CreateInsuranceCertificateBody,
  UpdateInsuranceCertificateParams,
  UpdateInsuranceCertificateBody,
  UpdateInsuranceCertificateResponse,
  DeleteInsuranceCertificateParams,
} from "@workspace/api-zod";

/**
 * CRUD for the `insurance_certificates` table — the manual intake path
 * for renter's / liability insurance certificates an operator receives
 * by email (ACORD 25 PDFs that don't ship attached to the project).
 *
 * Documented intake path (Task #334):
 *   1. Operator receives an ACORD 25 cert from the carrier (typically
 *      by email).
 *   2. Operator POSTs `/api/insurance-certificates` with at minimum
 *      `{ id, propertyId }` and as many of carrier / policyNumber /
 *      insuredName / coverageStart / coverageEnd / documentUrl /
 *      notes as the cert spells out. `documentUrl` accepts the source
 *      PDF filename today (matches the Chateau Knoll seed pattern)
 *      and a real object-storage URL later when uploads are wired in.
 *   3. When the cert PDF itself is attached to the project, prefer
 *      adding it to the matching seeder (e.g. `seed-attached-leases.ts`,
 *      `seed-patriot-baraboo.ts`, `seed-park-place.ts`) so the row
 *      replays idempotently across resets.
 *
 * Task #333 added the read/write UI (property-detail Insurance tab +
 * dashboard expiry alerts) on top of this same REST surface.
 */

const router: IRouter = Router();

router.get("/insurance-certificates", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(insuranceCertificatesTable)
    .orderBy(insuranceCertificatesTable.id);
  res.json(ListInsuranceCertificatesResponse.parse(rows));
});

router.post("/insurance-certificates", async (req, res): Promise<void> => {
  const body = CreateInsuranceCertificateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(insuranceCertificatesTable)
    .values(body.data)
    .returning();
  res.status(201).json(UpdateInsuranceCertificateResponse.parse(row));
});

router.patch("/insurance-certificates/:id", async (req, res): Promise<void> => {
  const params = UpdateInsuranceCertificateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateInsuranceCertificateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(insuranceCertificatesTable)
    .set(body.data)
    .where(eq(insuranceCertificatesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Insurance certificate not found" });
    return;
  }
  res.json(UpdateInsuranceCertificateResponse.parse(row));
});

router.delete(
  "/insurance-certificates/:id",
  async (req, res): Promise<void> => {
    const params = DeleteInsuranceCertificateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await db
      .delete(insuranceCertificatesTable)
      .where(eq(insuranceCertificatesTable.id, params.data.id));
    res.sendStatus(204);
  },
);

export default router;
