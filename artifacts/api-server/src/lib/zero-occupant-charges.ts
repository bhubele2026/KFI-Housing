import { pool } from "@workspace/db";
import { logger } from "./logger";

const MARKER_ID = "zero-occupant-charges-v1";

export async function zeroOccupantChargesOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    const marker = await client.query(
      "SELECT id FROM scheduler_state WHERE id = $1",
      [MARKER_ID],
    );
    if ((marker.rowCount ?? 0) > 0) {
      logger.info(
        { marker: MARKER_ID },
        "zero-occupant-charges already applied; skipping",
      );
      return;
    }

    await client.query("BEGIN");
    try {
      const res = await client.query(
        "UPDATE occupants SET charge_per_bed = 0 WHERE charge_per_bed > 0",
      );
      await client.query(
        `INSERT INTO scheduler_state (id, last_sent_key) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET last_sent_key = EXCLUDED.last_sent_key`,
        [MARKER_ID, new Date().toISOString()],
      );
      await client.query("COMMIT");
      logger.info(
        { marker: MARKER_ID, rows: res.rowCount ?? 0 },
        "zero-occupant-charges applied — Housing Recovery now $0 until rates are set",
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
