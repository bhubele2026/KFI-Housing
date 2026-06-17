// Generic bed-inventory materializer.
//
// Many properties are seeded with a `totalBeds` capacity but NO discrete
// `beds` rows (the harvested-properties seeder sets totalBeds and leaves
// beds empty; only a few hand-written seeders create real beds). The
// Assign-Occupant dialog can only place someone into a property that has
// at least one *ready, vacant* bed ROW — so without bed rows, those
// properties can't receive a placement from the Roster.
//
// This seeder closes that gap generically: for every property it ensures
// there are at least `totalBeds` bed rows, creating any shortfall as
// ready/vacant beds in a single auto-created "Unassigned" room. It is:
//   • additive — it only ever CREATES missing beds; it never deletes,
//     moves, or modifies an existing bed (so occupied beds are untouched),
//   • idempotent — deterministic ids (`bed-auto-<propertyId>-<n>`) mean
//     re-running only fills whatever is still missing,
//   • capacity-driven — it trusts each property's own `totalBeds`, so it
//     needs no hardcoded per-property numbers. (Set the right totalBeds
//     per property from the SharePoint "address" tab and re-run to
//     materialize the exact bed count.)
//
// The real room/unit breakdown can be layered in later by a
// property-specific seeder; this just guarantees placeable inventory.

import { eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  roomsTable,
  bedsTable,
  type InsertRoomRow,
  type InsertBedRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

export const AUTO_ROOM_ID = (propertyId: string) => `room-auto-${propertyId}`;
export const AUTO_BED_ID = (propertyId: string, n: number) =>
  `bed-auto-${propertyId}-${n}`;

export interface BedPlan {
  roomId: string;
  beds: { id: string; bedNumber: number }[];
}

/**
 * Pure planner: given a property's existing bed ids and its target
 * `totalBeds`, return the auto-bed rows that still need creating to reach
 * the target. Existing beds (from any source) count toward the target, so
 * we only fill the shortfall. Deterministic and side-effect free — this
 * is the unit-tested core of the seeder.
 */
export function planBedsToCreate(
  propertyId: string,
  existingBedIds: string[],
  totalBeds: number,
): BedPlan {
  const target = Number.isFinite(totalBeds) && totalBeds > 0 ? Math.floor(totalBeds) : 0;
  const existing = new Set(existingBedIds);
  const shortfall = target - existingBedIds.length;
  const beds: { id: string; bedNumber: number }[] = [];
  if (shortfall <= 0) return { roomId: AUTO_ROOM_ID(propertyId), beds };
  // Walk bed numbers 1..target and take the first `shortfall` ids that
  // don't already exist — so re-runs never collide and never overshoot.
  let made = 0;
  for (let n = 1; n <= target && made < shortfall; n++) {
    const id = AUTO_BED_ID(propertyId, n);
    if (existing.has(id)) continue;
    beds.push({ id, bedNumber: n });
    made++;
  }
  return { roomId: AUTO_ROOM_ID(propertyId), beds };
}

function buildAutoRoom(propertyId: string): InsertRoomRow {
  return {
    id: AUTO_ROOM_ID(propertyId),
    propertyId,
    buildingId: "",
    name: "Unassigned (auto)",
    sqft: 0,
    bathrooms: 0,
    monthlyRent: 0,
  };
}

function buildAutoBed(
  propertyId: string,
  roomId: string,
  id: string,
  bedNumber: number,
): InsertBedRow {
  return {
    id,
    propertyId,
    bedNumber,
    roomId,
    status: "Vacant",
    occupantId: null,
  };
}

/**
 * Ensure every property has at least `totalBeds` discrete bed rows so it
 * can receive placements. Additive + idempotent. Non-fatal by contract:
 * callers wrap it in try/catch so a transient DB issue can't block boot.
 */
export async function seedBedInventoryIfMissing(
  log: Logger = defaultLogger,
): Promise<{ propertiesTouched: number; bedsCreated: number }> {
  const properties = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      totalBeds: propertiesTable.totalBeds,
    })
    .from(propertiesTable);

  let propertiesTouched = 0;
  let bedsCreated = 0;

  for (const p of properties) {
    if (!p.totalBeds || p.totalBeds <= 0) continue;

    const existing = await db
      .select({ id: bedsTable.id })
      .from(bedsTable)
      .where(eq(bedsTable.propertyId, p.id));

    const plan = planBedsToCreate(
      p.id,
      existing.map((b) => b.id),
      p.totalBeds,
    );
    if (plan.beds.length === 0) continue;

    // Ensure the auto room exists (idempotent).
    const room = await db
      .select({ id: roomsTable.id })
      .from(roomsTable)
      .where(eq(roomsTable.id, plan.roomId));
    if (room.length === 0) {
      await db.insert(roomsTable).values(buildAutoRoom(p.id));
    }

    const rows = plan.beds.map((b) =>
      buildAutoBed(p.id, plan.roomId, b.id, b.bedNumber),
    );
    await db.insert(bedsTable).values(rows);
    propertiesTouched++;
    bedsCreated += rows.length;
    log.info(
      { propertyId: p.id, property: p.name, created: rows.length, totalBeds: p.totalBeds },
      "seed-bed-inventory: materialized vacant beds",
    );
  }

  if (bedsCreated > 0) {
    log.info(
      { propertiesTouched, bedsCreated },
      "seed-bed-inventory: done materializing placeable beds",
    );
  }
  return { propertiesTouched, bedsCreated };
}
