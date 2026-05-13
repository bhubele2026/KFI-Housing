import { pool } from "@workspace/db";
import { logger } from "./logger";
import snapshot from "./prod-sync-snapshot.json" with { type: "json" };

const MARKER_ID = "prod-sync-v1";

const TABLE_ORDER: ReadonlyArray<keyof typeof snapshot> = [
  "customers",
  "properties",
  "buildings",
  "rooms",
  "beds",
  "bed_weekly_rates",
  "leases",
  "occupants",
  "projected_move_ins",
  "utilities",
  "other_costs",
  "room_night_logs",
  "payroll_deductions",
  "insurance_certificates",
  "property_violations",
  "last_boot_master_import",
];

function quoteIdent(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

export async function runProdSyncOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    const marker = await client.query(
      "SELECT id FROM scheduler_state WHERE id = $1",
      [MARKER_ID],
    );
    if ((marker.rowCount ?? 0) > 0) {
      logger.info({ marker: MARKER_ID }, "prod-sync already applied; skipping");
      return;
    }

    logger.info(
      { marker: MARKER_ID },
      "prod-sync marker absent — applying one-shot dev→prod data sync",
    );

    await client.query("BEGIN");
    try {
      const truncateList = TABLE_ORDER.map((t) => quoteIdent(t)).join(", ");
      await client.query(
        `TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`,
      );

      let totalInserted = 0;
      for (const table of TABLE_ORDER) {
        const rows = snapshot[table] as ReadonlyArray<Record<string, unknown>>;
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]!);
        const colSql = columns.map(quoteIdent).join(", ");

        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const valuesSql: string[] = [];
          const params: unknown[] = [];
          let p = 1;
          for (const row of chunk) {
            const placeholders = columns.map(() => `$${p++}`).join(", ");
            valuesSql.push(`(${placeholders})`);
            for (const col of columns) {
              const v = row[col];
              params.push(
                v !== null && typeof v === "object" ? JSON.stringify(v) : v,
              );
            }
          }
          await client.query(
            `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES ${valuesSql.join(", ")}`,
            params,
          );
        }
        totalInserted += rows.length;
        logger.info({ table, rows: rows.length }, "prod-sync table inserted");
      }

      await client.query(
        `INSERT INTO scheduler_state (id, last_sent_key) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET last_sent_key = EXCLUDED.last_sent_key`,
        [MARKER_ID, new Date().toISOString()],
      );

      await client.query("COMMIT");
      logger.info(
        { totalInserted, tables: TABLE_ORDER.length },
        "prod-sync complete — production data now mirrors development snapshot",
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
