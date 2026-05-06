import { and, eq, ne } from "drizzle-orm";
import { db, occupantsTable, leasesTable } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

export interface BackfillResult {
  scanned: number;
  updated: number;
  remaining: number;
}

export interface BackfillDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Backfill empty `moveInDate` values on occupants by borrowing the
 * earliest valid `startDate` from a lease that belongs to the same
 * property. Occupants whose property has no lease with a real start
 * date are left empty so the UI can flag them as "needs review".
 *
 * Idempotent: only rows where `moveInDate = ''` are touched, so
 * re-running on a clean DB is a no-op.
 */
export async function backfillOccupantMoveInDates(
  deps: Partial<BackfillDeps> = {},
): Promise<BackfillResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const empties = await database
    .select({ id: occupantsTable.id, propertyId: occupantsTable.propertyId })
    .from(occupantsTable)
    .where(eq(occupantsTable.moveInDate, ""));

  if (empties.length === 0) {
    return { scanned: 0, updated: 0, remaining: 0 };
  }

  const propertyIds = Array.from(
    new Set(
      empties
        .map((o) => o.propertyId)
        .filter((id): id is string => typeof id === "string" && id !== ""),
    ),
  );

  const earliestStartByProperty = new Map<string, string>();
  for (const propertyId of propertyIds) {
    const leases = await database
      .select({ startDate: leasesTable.startDate })
      .from(leasesTable)
      .where(
        and(
          eq(leasesTable.propertyId, propertyId),
          ne(leasesTable.startDate, ""),
        ),
      );

    const valid = leases
      .map((l) => l.startDate)
      .filter((d) => STRICT_DATE_RE.test(d))
      .sort();

    if (valid.length > 0) {
      earliestStartByProperty.set(propertyId, valid[0]!);
    }
  }

  let updated = 0;
  for (const occ of empties) {
    if (!occ.propertyId) continue;
    const candidate = earliestStartByProperty.get(occ.propertyId);
    if (!candidate) continue;
    await database
      .update(occupantsTable)
      .set({ moveInDate: candidate })
      .where(
        and(
          eq(occupantsTable.id, occ.id),
          eq(occupantsTable.moveInDate, ""),
        ),
      );
    updated++;
  }

  const remaining = empties.length - updated;
  log.info(
    { scanned: empties.length, updated, remaining },
    "Backfilled occupant move-in dates from matching lease start dates",
  );
  if (remaining > 0) {
    log.warn(
      { remaining },
      "Some occupants still have an empty moveInDate — no matching lease start date available; UI will flag them as 'needs review'",
    );
  }

  return { scanned: empties.length, updated, remaining };
}

