import type { Pool, PoolClient } from "pg";

export interface BedRow {
  id: string;
  propertyId: string;
  bedNumber: number;
  room: string;
}

export interface RoomDraft {
  id: string;
  propertyId: string;
  name: string;
}

export interface BackfillPlan {
  rooms: RoomDraft[];
  bedRoomIds: Map<string, string>;
}

/**
 * Pure helper: groups beds by (propertyId, room-name) into Room records and
 * returns a map from bedId → roomId. Beds with an empty/null room name are
 * grouped into a single auto-named "Room" per property.
 */
export function planBackfill(beds: BedRow[]): BackfillPlan {
  const rooms: RoomDraft[] = [];
  const bedRoomIds = new Map<string, string>();
  const counters = new Map<string, number>(); // propertyId -> next index
  const seen = new Map<string, string>(); // `${propertyId}|${name}` -> roomId

  // Sort for deterministic room ordering & ids.
  const sorted = [...beds].sort((a, b) => {
    if (a.propertyId !== b.propertyId) return a.propertyId.localeCompare(b.propertyId);
    if (a.bedNumber !== b.bedNumber) return a.bedNumber - b.bedNumber;
    return a.id.localeCompare(b.id);
  });

  for (const bed of sorted) {
    const rawName = (bed.room ?? "").trim();
    const propId = bed.propertyId;
    const key = `${propId}|${rawName.toLowerCase()}`;

    let roomId = seen.get(key);
    if (!roomId) {
      const next = (counters.get(propId) ?? 0) + 1;
      counters.set(propId, next);
      roomId = `r_${propId}_${next}`;
      const name = rawName !== "" ? rawName : `Room ${next}`;
      rooms.push({ id: roomId, propertyId: propId, name });
      seen.set(key, roomId);
    }
    bedRoomIds.set(bed.id, roomId);
  }

  return { rooms, bedRoomIds };
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
 * Idempotent migration that converts the legacy `beds.room` text column into a
 * proper `rooms` table with `beds.room_id` foreign references. Runs BEFORE
 * drizzle's pushSchema so the schema diff afterwards is empty.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in tests),
 *  - the `beds` table doesn't exist (fresh database — drizzle will create
 *    everything from the new schema), or
 *  - the migration has already run (no `room` column to migrate).
 */
export async function backfillRoomsIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; roomsCreated: number; bedsUpdated: number }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, roomsCreated: 0, bedsUpdated: 0 };
  }

  const hasBeds = await tableExists(pool as unknown as QueryRunner, "beds");
  if (!hasBeds) {
    return { migrated: false, roomsCreated: 0, bedsUpdated: 0 };
  }

  const hasRoom = await columnExists(
    pool as unknown as QueryRunner,
    "beds",
    "room",
  );
  if (!hasRoom) {
    return { migrated: false, roomsCreated: 0, bedsUpdated: 0 };
  }

  log("Migrating bed.room text into a real rooms table…");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Make sure rooms table exists with the new shape (matching the schema).
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id text PRIMARY KEY,
        property_id text NOT NULL DEFAULT '',
        name text NOT NULL DEFAULT '',
        sqft integer NOT NULL DEFAULT 0,
        bathrooms double precision NOT NULL DEFAULT 0,
        monthly_rent double precision NOT NULL DEFAULT 0
      )
    `);

    // 2. Add room_id column on beds if missing (NOT NULL DEFAULT '' is safe).
    await client.query(`
      ALTER TABLE beds
        ADD COLUMN IF NOT EXISTS room_id text NOT NULL DEFAULT ''
    `);

    // 3. Read existing beds and plan rooms.
    const bedRes = await client.query(
      `SELECT id, property_id, bed_number, room
         FROM beds
        ORDER BY property_id, bed_number, id`,
    );
    const beds: BedRow[] = bedRes.rows.map((r) => ({
      id: String(r["id"]),
      propertyId: String(r["property_id"]),
      bedNumber: Number(r["bed_number"]),
      room: String(r["room"] ?? ""),
    }));

    const plan = planBackfill(beds);

    // 4. Insert rooms (skip if id already taken, e.g. partially-migrated DB).
    for (const room of plan.rooms) {
      await client.query(
        `INSERT INTO rooms (id, property_id, name)
              VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [room.id, room.propertyId, room.name],
      );
    }

    // 5. Backfill bed.room_id.
    let bedsUpdated = 0;
    for (const [bedId, roomId] of plan.bedRoomIds.entries()) {
      const r = await client.query(
        `UPDATE beds SET room_id = $1 WHERE id = $2`,
        [roomId, bedId],
      );
      bedsUpdated += (r as unknown as { rowCount?: number }).rowCount ?? 0;
    }

    // 6. Drop the legacy text column. Drizzle's diff afterwards will be empty
    //    so pushSchema reports "Schema is up to date".
    await client.query(`ALTER TABLE beds DROP COLUMN IF EXISTS room`);

    await client.query("COMMIT");

    log(
      `Backfilled ${plan.rooms.length} room(s) for ${bedsUpdated} bed(s).`,
      { rooms: plan.rooms.length, beds: bedsUpdated },
    );

    return {
      migrated: true,
      roomsCreated: plan.rooms.length,
      bedsUpdated,
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
