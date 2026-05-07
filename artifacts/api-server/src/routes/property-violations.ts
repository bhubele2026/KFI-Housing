import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, propertiesTable, propertyViolationsTable } from "@workspace/db";
import {
  ListPropertyViolationsParams,
  ListPropertyViolationsResponse,
  ListPropertyViolationsResponseItem,
  CreatePropertyViolationParams,
  CreatePropertyViolationBody,
  DeletePropertyViolationParams,
} from "@workspace/api-zod";

/**
 * CRUD for `property_violations` (Task #499).
 *
 * Routes are scoped under `/properties/:id/violations` so the property
 * id is always validated against the URL — the body never carries
 * `propertyId` itself, eliminating a class of "wrong property" bugs.
 *
 * The list endpoint orders by `occurred_on DESC` so the most recent
 * notice is always at the top of the table; ties are broken by
 * `created_at` so two same-day notices stay deterministic.
 */
const router: IRouter = Router();

router.get(
  "/properties/:id/violations",
  async (req, res): Promise<void> => {
    const params = ListPropertyViolationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(propertyViolationsTable)
      .where(eq(propertyViolationsTable.propertyId, params.data.id))
      .orderBy(
        desc(propertyViolationsTable.occurredOn),
        desc(propertyViolationsTable.createdAt),
      );
    res.json(ListPropertyViolationsResponse.parse(rows));
  },
);

router.post(
  "/properties/:id/violations",
  async (req, res): Promise<void> => {
    const params = CreatePropertyViolationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreatePropertyViolationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    // Reject violations against properties that don't exist so a
    // stale UI can't accumulate orphan rows.
    const [property] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, params.data.id));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const [row] = await db
      .insert(propertyViolationsTable)
      .values({
        ...body.data,
        propertyId: params.data.id,
      })
      .returning();
    res.status(201).json(ListPropertyViolationsResponseItem.parse(row));
  },
);

router.delete(
  "/properties/:id/violations/:violationId",
  async (req, res): Promise<void> => {
    const params = DeletePropertyViolationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await db
      .delete(propertyViolationsTable)
      .where(
        and(
          eq(propertyViolationsTable.id, params.data.violationId),
          eq(propertyViolationsTable.propertyId, params.data.id),
        ),
      );
    res.sendStatus(204);
  },
);

export default router;
