import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  bedsTable,
  occupantsTable,
  projectedMoveInsTable,
  propertiesTable,
} from "@workspace/db";
import {
  ListProjectedMoveInsParams,
  ListProjectedMoveInsResponse,
  ListProjectedMoveInsResponseItem,
  CreateProjectedMoveInParams,
  CreateProjectedMoveInBody,
  UpdateProjectedMoveInParams,
  UpdateProjectedMoveInBody,
  DeleteProjectedMoveInParams,
  ConvertProjectedMoveInParams,
  ConvertProjectedMoveInBody,
} from "@workspace/api-zod";

/**
 * CRUD + convert endpoints for `projected_move_ins` (Task #567).
 *
 * Routes are scoped under `/properties/:id/projected-move-ins` so
 * the property id is always validated against the URL.
 *
 * The list endpoint hides rows that have already been converted
 * into real occupants (`convertedOccupantId IS NOT NULL`) so the
 * Beds-tab card only shows rows the operator still needs to act
 * on. The historical link is preserved in the column for audit.
 */
const router: IRouter = Router();

function serialize<R extends { createdAt: Date | string | null; updatedAt: Date | string | null }>(
  row: R,
): R & { createdAt: string | null; updatedAt: string | null } {
  return {
    ...row,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt ?? null,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt ?? null,
  };
}

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cheap belt-and-suspenders check used by create/update so we
 * never persist a `bedId` pointing at a bed that's been deleted
 * or that lives in a different property. The convert endpoint
 * re-checks the same constraints at the moment of conversion
 * (because the bed could change state between scheduling and
 * arrival), so this is a usability guard, not a correctness one.
 */
async function ensureBedBelongsToProperty(
  bedId: string,
  propertyId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [bed] = await db
    .select({ propertyId: bedsTable.propertyId })
    .from(bedsTable)
    .where(eq(bedsTable.id, bedId));
  if (!bed) {
    return { ok: false, status: 400, error: "Target bed does not exist." };
  }
  if (bed.propertyId !== propertyId) {
    return {
      ok: false,
      status: 400,
      error: "Target bed belongs to a different property.",
    };
  }
  return { ok: true };
}

router.get(
  "/properties/:id/projected-move-ins",
  async (req, res): Promise<void> => {
    const params = ListProjectedMoveInsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(projectedMoveInsTable)
      .where(
        and(
          eq(projectedMoveInsTable.propertyId, params.data.id),
          isNull(projectedMoveInsTable.convertedOccupantId),
        ),
      )
      .orderBy(asc(projectedMoveInsTable.projectedMoveInDate));
    res.json(ListProjectedMoveInsResponse.parse(rows.map(serialize)));
  },
);

router.post(
  "/properties/:id/projected-move-ins",
  async (req, res): Promise<void> => {
    const params = CreateProjectedMoveInParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateProjectedMoveInBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!body.data.personName.trim()) {
      res.status(400).json({ error: "Name cannot be empty." });
      return;
    }
    if (!STRICT_DATE_RE.test(body.data.projectedMoveInDate)) {
      res
        .status(400)
        .json({ error: "Projected move-in date must be in YYYY-MM-DD format." });
      return;
    }
    const [property] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, params.data.id));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    if (body.data.bedId) {
      const check = await ensureBedBelongsToProperty(
        body.data.bedId,
        params.data.id,
      );
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }
    }
    const [row] = await db
      .insert(projectedMoveInsTable)
      .values({
        ...body.data,
        propertyId: params.data.id,
      })
      .returning();
    res
      .status(201)
      .json(ListProjectedMoveInsResponseItem.parse(serialize(row)));
  },
);

router.patch(
  "/properties/:id/projected-move-ins/:moveInId",
  async (req, res): Promise<void> => {
    const params = UpdateProjectedMoveInParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateProjectedMoveInBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    // Mirror the create-time constraints so an edit can't sneak
    // through an empty name or malformed date.
    if (body.data.personName !== undefined && !body.data.personName.trim()) {
      res.status(400).json({ error: "Name cannot be empty." });
      return;
    }
    if (
      body.data.projectedMoveInDate !== undefined &&
      !STRICT_DATE_RE.test(body.data.projectedMoveInDate)
    ) {
      res
        .status(400)
        .json({ error: "Projected move-in date must be in YYYY-MM-DD format." });
      return;
    }
    if (body.data.bedId) {
      const check = await ensureBedBelongsToProperty(
        body.data.bedId,
        params.data.id,
      );
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }
    }
    const [row] = await db
      .update(projectedMoveInsTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(
        and(
          eq(projectedMoveInsTable.id, params.data.moveInId),
          eq(projectedMoveInsTable.propertyId, params.data.id),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Projected move-in not found" });
      return;
    }
    res.json(ListProjectedMoveInsResponseItem.parse(serialize(row)));
  },
);

router.delete(
  "/properties/:id/projected-move-ins/:moveInId",
  async (req, res): Promise<void> => {
    const params = DeleteProjectedMoveInParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await db
      .delete(projectedMoveInsTable)
      .where(
        and(
          eq(projectedMoveInsTable.id, params.data.moveInId),
          eq(projectedMoveInsTable.propertyId, params.data.id),
        ),
      );
    res.sendStatus(204);
  },
);

router.post(
  "/properties/:id/projected-move-ins/:moveInId/convert",
  async (req, res): Promise<void> => {
    const params = ConvertProjectedMoveInParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    // Body is optional — `{}` is a valid no-override convert call.
    const body = ConvertProjectedMoveInBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [projection] = await db
      .select()
      .from(projectedMoveInsTable)
      .where(
        and(
          eq(projectedMoveInsTable.id, params.data.moveInId),
          eq(projectedMoveInsTable.propertyId, params.data.id),
        ),
      );
    if (!projection) {
      res.status(404).json({ error: "Projected move-in not found" });
      return;
    }
    if (projection.convertedOccupantId) {
      res.status(409).json({
        error: "Projected move-in has already been converted.",
      });
      return;
    }

    // Bed precedence: explicit override on the body wins, falling
    // back to whatever was stored on the projection.
    const overrideBedId =
      body.data && Object.prototype.hasOwnProperty.call(body.data, "bedId")
        ? body.data.bedId ?? null
        : undefined;
    const targetBedId =
      overrideBedId !== undefined ? overrideBedId : projection.bedId ?? null;
    if (!targetBedId) {
      res.status(400).json({
        error: "A bed must be chosen before converting this projection.",
      });
      return;
    }

    if (!STRICT_DATE_RE.test(projection.projectedMoveInDate)) {
      res.status(400).json({
        error:
          "Projected move-in date is missing or malformed (expected YYYY-MM-DD).",
      });
      return;
    }

    // Wrap the read-then-write sequence in a transaction so a
    // partial failure (e.g. the projection update throws after
    // the occupant insert succeeds) rolls back cleanly instead of
    // leaving an orphan occupant pointed at a bed whose status
    // wasn't flipped. Validation problems short-circuit by
    // throwing a tagged error which the catch block translates
    // into the appropriate HTTP response.
    type ConvertError = { http: number; body: Record<string, unknown> };
    const fail = (http: number, body: Record<string, unknown>): never => {
      const err = new Error("convert-failed") as Error & {
        convertError: ConvertError;
      };
      err.convertError = { http, body };
      throw err;
    };

    try {
      const result = await db.transaction(async (tx) => {
        // Re-use the same bed-availability + cleaning gates the
        // occupants POST/PATCH route enforces — operators shouldn't
        // be able to bypass the cleaning workflow just because the
        // placement was scheduled in advance.
        const [bed] = await tx
          .select({
            cleaningStatus: bedsTable.cleaningStatus,
            status: bedsTable.status,
            occupantId: bedsTable.occupantId,
            propertyId: bedsTable.propertyId,
          })
          .from(bedsTable)
          .where(eq(bedsTable.id, targetBedId));
        if (!bed) {
          fail(400, { error: "Target bed does not exist." });
        }
        if (bed!.propertyId !== params.data.id) {
          fail(400, {
            error: "Target bed belongs to a different property.",
          });
        }
        if (bed!.status === "Occupied" && bed!.occupantId) {
          fail(409, {
            error:
              "Bed is currently occupied by another occupant — vacate it first.",
          });
        }
        if (bed!.cleaningStatus !== "ready") {
          fail(409, {
            error:
              "Bed is not ready for a new occupant — finish the cleaning workflow first.",
            cleaningStatus: bed!.cleaningStatus,
          });
        }

        const occupantId = `occ-${randomUUID()}`;
        const [occupant] = await tx
          .insert(occupantsTable)
          .values({
            id: occupantId,
            name: projection.personName,
            propertyId: params.data.id,
            bedId: targetBedId,
            moveInDate: projection.projectedMoveInDate,
            status: "Active",
          })
          .returning();
        await tx
          .update(bedsTable)
          .set({ status: "Occupied", occupantId })
          .where(eq(bedsTable.id, targetBedId));
        const [updatedProjection] = await tx
          .update(projectedMoveInsTable)
          .set({
            convertedOccupantId: occupantId,
            bedId: targetBedId,
            updatedAt: new Date(),
          })
          .where(eq(projectedMoveInsTable.id, projection.id))
          .returning();
        return { occupant, updatedProjection };
      });

      res.json({
        projectedMoveIn: ListProjectedMoveInsResponseItem.parse(
          serialize(result.updatedProjection),
        ),
        occupant: {
          ...result.occupant,
          createdAt:
            result.occupant.createdAt instanceof Date
              ? result.occupant.createdAt.toISOString()
              : result.occupant.createdAt ?? null,
        },
      });
    } catch (err) {
      const tagged = err as Error & { convertError?: ConvertError };
      if (tagged.convertError) {
        res.status(tagged.convertError.http).json(tagged.convertError.body);
        return;
      }
      throw err;
    }
  },
);

export default router;
