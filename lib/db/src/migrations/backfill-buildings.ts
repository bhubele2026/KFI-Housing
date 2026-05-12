import type { Pool, PoolClient } from "pg";

export interface PropertyShape {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface BuildingDraft {
  id: string;
  propertyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface BackfillBuildingsPlan {
  buildings: BuildingDraft[];
  /** propertyId → default buildingId (the one created/used during backfill). */
  defaultBuildingByProperty: Map<string, string>;
}

/**
 * Pure helper: builds one default Building per Property, mirroring the
 * property's address fields. Deterministic id (`bldg_<propertyId>_1`)
 * so re-runs are idempotent.
 */
export function planBuildingsBackfill(
  properties: PropertyShape[],
): BackfillBuildingsPlan {
  const buildings: BuildingDraft[] = [];
  const defaultBuildingByProperty = new Map<string, string>();
  const sorted = [...properties].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    const id = `bldg_${p.id}_1`;
    buildings.push({
      id,
      propertyId: p.id,
      name: "Main building",
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
    });
    defaultBuildingByProperty.set(p.id, id);
  }
  return { buildings, defaultBuildingByProperty };
}

interface QueryRunner {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

async function tableExists(c: QueryRunner, table: string): Promise<boolean> {
  const r = await c.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

async function columnExists(
  c: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

/**
 * Idempotent migration that creates the `buildings` table (if missing),
 * adds `building_id` columns to `rooms` and `leases` (if missing), and
 * back-fills one default building per existing property — assigning
 * every existing room to that default. Leases are left with NULL
 * `building_id` (the no-pin case) by design.
 *
 * Runs BEFORE drizzle's pushSchema so the diff afterwards is empty.
 */
export async function backfillBuildingsIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; buildingsCreated: number; roomsUpdated: number }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, buildingsCreated: 0, roomsUpdated: 0 };
  }
  const hasProperties = await tableExists(
    pool as unknown as QueryRunner,
    "properties",
  );
  if (!hasProperties) {
    return { migrated: false, buildingsCreated: 0, roomsUpdated: 0 };
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ensure the buildings table exists with the canonical shape.
    await client.query(`
      CREATE TABLE IF NOT EXISTS buildings (
        id text PRIMARY KEY,
        property_id text NOT NULL DEFAULT '',
        name text NOT NULL DEFAULT '',
        address text NOT NULL DEFAULT '',
        city text NOT NULL DEFAULT '',
        state text NOT NULL DEFAULT '',
        zip text NOT NULL DEFAULT '',
        notes text NOT NULL DEFAULT ''
      )
    `);

    // 2. Add building_id columns to rooms / leases if missing.
    const hasRooms = await tableExists(client as unknown as QueryRunner, "rooms");
    if (hasRooms) {
      await client.query(
        `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS building_id text NOT NULL DEFAULT ''`,
      );
    }
    const hasLeases = await tableExists(client as unknown as QueryRunner, "leases");
    if (hasLeases) {
      await client.query(
        `ALTER TABLE leases ADD COLUMN IF NOT EXISTS building_id text`,
      );
    }

    // 3. Decide which properties still need a default building. A
    //    property is considered "covered" when at least one building
    //    row already references it.
    const propsRes = await client.query(
      `SELECT id, address, city, state, zip FROM properties ORDER BY id`,
    );
    const properties: PropertyShape[] = propsRes.rows.map((r) => ({
      id: String(r["id"]),
      address: String(r["address"] ?? ""),
      city: String(r["city"] ?? ""),
      state: String(r["state"] ?? ""),
      zip: String(r["zip"] ?? ""),
    }));
    const coveredRes = await client.query(
      `SELECT DISTINCT property_id FROM buildings`,
    );
    const covered = new Set(
      coveredRes.rows.map((r) => String(r["property_id"])),
    );
    const needsBuilding = properties.filter((p) => !covered.has(p.id));
    const plan = planBuildingsBackfill(needsBuilding);

    // 4. Insert the default buildings.
    for (const b of plan.buildings) {
      await client.query(
        `INSERT INTO buildings (id, property_id, name, address, city, state, zip)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [b.id, b.propertyId, b.name, b.address, b.city, b.state, b.zip],
      );
    }

    // 5. Backfill rooms.building_id where blank by picking the first
    //    building under the same property (deterministic by id).
    let roomsUpdated = 0;
    if (hasRooms) {
      const r = await client.query(
        `UPDATE rooms r
            SET building_id = b.id
           FROM (
             SELECT DISTINCT ON (property_id) property_id, id
               FROM buildings
              ORDER BY property_id, id
           ) b
          WHERE r.property_id = b.property_id
            AND (r.building_id IS NULL OR r.building_id = '')`,
      );
      roomsUpdated = (r as unknown as { rowCount?: number }).rowCount ?? 0;
    }

    await client.query("COMMIT");

    if (plan.buildings.length > 0 || roomsUpdated > 0) {
      log(
        `Backfilled ${plan.buildings.length} building(s) and ${roomsUpdated} room(s).`,
        { buildings: plan.buildings.length, rooms: roomsUpdated },
      );
    }

    return {
      migrated: true,
      buildingsCreated: plan.buildings.length,
      roomsUpdated,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      /* ignore secondary error */
    });
    throw err;
  } finally {
    client.release();
  }
}
