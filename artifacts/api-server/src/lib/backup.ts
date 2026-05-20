import { spawn } from "node:child_process";
import { createGzip, createGunzip } from "node:zlib";
import { Readable, PassThrough } from "node:stream";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

/**
 * Pre-deploy database snapshots (Task #640).
 *
 * On every production boot — before `pushSchemaIfNeeded` runs — we
 * shell out to `pg_dump`, gzip the output, and upload it to a
 * `backups/` prefix in the configured Object Storage bucket. Each
 * snapshot is keyed by `<ISO timestamp>__<git SHA>.sql.gz` so an
 * operator can tell, at a glance, which deploy a backup corresponds
 * to.
 *
 * We keep the most recent {@link BACKUP_RETENTION} snapshots and
 * prune older ones, so a long-running production environment doesn't
 * accumulate hundreds of dumps. Snapshots for the same SHA are
 * skipped — every redeploy of the same revision is a no-op.
 *
 * The whole module is best-effort: failures log loudly but never
 * block boot, because a botched backup must not stop a server from
 * coming up and serving real traffic. The data-safety story still
 * relies on the *previous* boot's snapshot being there.
 */

export const BACKUP_RETENTION = 20;
const BACKUPS_PREFIX = "backups/";

function getBackupBucketName(): string {
  // Reuse the same bucket as user uploads so operators don't need to
  // provision a second bucket. We use the PRIVATE_OBJECT_DIR's bucket
  // segment so backups land alongside other private app data.
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir || dir.trim() === "") {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not set — cannot upload database backups. " +
        "Provision an Object Storage bucket and set PRIVATE_OBJECT_DIR.",
    );
  }
  // PRIVATE_OBJECT_DIR is shaped like `/<bucket>/<...>` or
  // `<bucket>/<...>`. Strip a leading slash, take the first path
  // segment as the bucket.
  const trimmed = dir.replace(/^\/+/, "");
  const bucket = trimmed.split("/")[0];
  if (!bucket) {
    throw new Error(
      `PRIVATE_OBJECT_DIR is malformed (${dir}); expected /<bucket>/<path>.`,
    );
  }
  return bucket;
}

function getBackupPrefix(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const trimmed = dir.replace(/^\/+/, "");
  const parts = trimmed.split("/").filter((p) => p.length > 0);
  // Drop the bucket name; keep any sub-path.
  const subPath = parts.slice(1).join("/");
  return subPath ? `${subPath}/${BACKUPS_PREFIX}` : BACKUPS_PREFIX;
}

function currentGitSha(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env["REPLIT_GIT_COMMIT_SHA"] ||
    env["REPL_DEPLOYMENT_ID"] ||
    env["GIT_COMMIT"] ||
    env["GIT_SHA"] ||
    "unknown-sha"
  ).slice(0, 16);
}

export interface BackupSnapshot {
  id: string; // object name under the bucket (full path)
  name: string; // file name only, used in the public id/url
  sizeBytes: number;
  createdAt: string; // ISO
  gitSha: string;
}

function parseSnapshotName(name: string): { createdAt: string; gitSha: string } | null {
  // Expected: <iso>__<sha>.sql.gz where <iso> uses `-` and `T` and no
  // colons (we substitute `:` for `-` so it's a safe object name).
  const m = name.match(/^([0-9TZ\-]+)__([A-Za-z0-9._-]+)\.sql\.gz$/);
  if (!m) return null;
  const safeIso = m[1];
  const isoStr = safeIso
    .replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3")
    .replace(/Z?$/, "Z");
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) return null;
  return { createdAt: parsed.toISOString(), gitSha: m[2] };
}

function snapshotObjectName(prefix: string, name: string): string {
  return `${prefix}${name}`;
}

export async function listBackups(): Promise<BackupSnapshot[]> {
  const bucket = objectStorageClient.bucket(getBackupBucketName());
  const prefix = getBackupPrefix();
  const [files] = await bucket.getFiles({ prefix });
  const snapshots: BackupSnapshot[] = [];
  for (const f of files) {
    const name = f.name.slice(prefix.length);
    if (!name.endsWith(".sql.gz")) continue;
    const parsed = parseSnapshotName(name);
    if (!parsed) continue;
    const sizeRaw = f.metadata?.size;
    const sizeBytes =
      typeof sizeRaw === "number" ? sizeRaw : Number(sizeRaw ?? 0) || 0;
    snapshots.push({
      id: f.name,
      name,
      sizeBytes,
      createdAt: parsed.createdAt,
      gitSha: parsed.gitSha,
    });
  }
  snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return snapshots;
}

async function pruneOldBackups(): Promise<number> {
  const all = await listBackups();
  const toDelete = all.slice(BACKUP_RETENTION);
  if (toDelete.length === 0) return 0;
  const bucket = objectStorageClient.bucket(getBackupBucketName());
  let pruned = 0;
  for (const snap of toDelete) {
    try {
      await bucket.file(snap.id).delete();
      pruned += 1;
    } catch (err) {
      logger.warn({ err, id: snap.id }, "Failed to prune old backup");
    }
  }
  return pruned;
}

function buildSnapshotName(now: Date, gitSha: string): string {
  const iso = now.toISOString().replace(/:/g, "-");
  return `${iso}__${gitSha}.sql.gz`;
}

/**
 * Runs `pg_dump | gzip` and streams the result into Object Storage.
 * Returns the snapshot record on success.
 */
export async function createBackupSnapshot(
  options: { now?: Date } = {},
): Promise<BackupSnapshot> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — cannot run pg_dump");
  }
  const now = options.now ?? new Date();
  const gitSha = currentGitSha();
  const name = buildSnapshotName(now, gitSha);
  const prefix = getBackupPrefix();
  const objectName = snapshotObjectName(prefix, name);

  const bucket = objectStorageClient.bucket(getBackupBucketName());
  const file = bucket.file(objectName);

  // pg_dump arguments:
  //   --no-owner / --no-privileges → makes restores portable across
  //   environments that may not share the same role/grant graph.
  //   --format=plain               → plain SQL so a restore is just
  //   `psql < dump.sql`. The output is gzipped before upload.
  //   --clean --if-exists          → restore drops then recreates so
  //   re-applying a backup over an existing DB is deterministic.
  const dump = spawn(
    "pg_dump",
    [
      databaseUrl,
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      "--clean",
      "--if-exists",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const stderrChunks: Buffer[] = [];
  dump.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

  const gzip = createGzip({ level: 6 });
  const passthrough = new PassThrough();
  dump.stdout.pipe(gzip).pipe(passthrough);

  let totalBytes = 0;
  passthrough.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
  });

  const uploadStream = file.createWriteStream({
    resumable: false,
    contentType: "application/gzip",
    metadata: { metadata: { gitSha, createdAt: now.toISOString() } },
  });

  const uploadDone = new Promise<void>((resolve, reject) => {
    uploadStream.on("finish", () => resolve());
    uploadStream.on("error", reject);
  });

  const dumpDone = new Promise<void>((resolve, reject) => {
    dump.on("error", reject);
    dump.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
      }
    });
  });

  passthrough.pipe(uploadStream);

  try {
    await Promise.all([dumpDone, uploadDone]);
  } catch (err) {
    // Best-effort cleanup of the partial object so a half-written
    // backup isn't returned by listBackups().
    try {
      await file.delete({ ignoreNotFound: true });
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    id: objectName,
    name,
    sizeBytes: totalBytes,
    createdAt: now.toISOString(),
    gitSha,
  };
}

/**
 * Snapshots the DB once per (git SHA, prod boot). Re-running for the
 * same SHA is a no-op so a flapping autoscale revision doesn't fill
 * the bucket. Non-fatal — callers continue serving on failure.
 */
export async function snapshotIfNeeded(): Promise<BackupSnapshot | null> {
  const gitSha = currentGitSha();
  const existing = await listBackups().catch((err) => {
    logger.warn({ err }, "listBackups failed during snapshotIfNeeded — assuming no prior backup");
    return [] as BackupSnapshot[];
  });
  if (existing.some((s) => s.gitSha === gitSha)) {
    logger.info(
      { gitSha },
      "Database snapshot for this SHA already exists; skipping pre-boot backup",
    );
    return null;
  }
  logger.info({ gitSha }, "Taking pre-boot database snapshot");
  const snap = await createBackupSnapshot();
  logger.info(
    { id: snap.id, sizeBytes: snap.sizeBytes },
    "Pre-boot database snapshot uploaded to Object Storage",
  );
  const pruned = await pruneOldBackups().catch((err) => {
    logger.warn({ err }, "Failed to prune old backups — leaving them in place");
    return 0;
  });
  if (pruned > 0) {
    logger.info({ pruned }, "Pruned old backups to enforce retention");
  }
  return snap;
}

export interface RestoreOptions {
  /** Object storage id (matches BackupSnapshot.id) of the snapshot to restore. */
  id: string;
  /** When true, no SQL is executed; we just report row counts and snapshot size. */
  dryRun?: boolean;
}

export interface RestoreReport {
  id: string;
  dryRun: boolean;
  bytesRead: number;
  tableRowCountsBefore: Record<string, number>;
  tableRowCountsAfter: Record<string, number>;
  executedStatements: number;
}

const ROW_COUNT_TABLES = [
  "customers",
  "properties",
  "buildings",
  "rooms",
  "beds",
  "leases",
  "occupants",
  "utilities",
  "other_costs",
  "room_night_logs",
  "insurance_certificates",
  "property_violations",
];

async function captureRowCounts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const client = await pool.connect();
  try {
    for (const t of ROW_COUNT_TABLES) {
      try {
        const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        result[t] = Number(r.rows[0]?.n ?? 0);
      } catch {
        result[t] = -1; // table missing
      }
    }
  } finally {
    client.release();
  }
  return result;
}

async function downloadGzippedSnapshot(id: string): Promise<Buffer> {
  const bucket = objectStorageClient.bucket(getBackupBucketName());
  const file = bucket.file(id);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Backup not found: ${id}`);
  }
  const read = file.createReadStream();
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    Readable.from(read).pipe(gunzip);
    gunzip.on("data", (c: Buffer) => chunks.push(c));
    gunzip.on("end", () => resolve());
    gunzip.on("error", reject);
    read.on("error", reject);
  });
  return Buffer.concat(chunks);
}

/**
 * Restores a previously-taken snapshot into the live DB inside a
 * single transaction so a botched restore rolls back cleanly. In
 * `dryRun` mode the SQL is fetched + parsed but never executed.
 */
export async function restoreBackupSnapshot(
  options: RestoreOptions,
): Promise<RestoreReport> {
  const sqlBuffer = await downloadGzippedSnapshot(options.id);
  const sql = sqlBuffer.toString("utf8");
  const before = await captureRowCounts();

  if (options.dryRun) {
    return {
      id: options.id,
      dryRun: true,
      bytesRead: sqlBuffer.byteLength,
      tableRowCountsBefore: before,
      tableRowCountsAfter: before,
      executedStatements: 0,
    };
  }

  const client = await pool.connect();
  let executed = 0;
  try {
    await client.query("BEGIN");
    // pg_dump output contains multi-statement SQL with COPY blocks
    // and DDL — `pg` can run multi-statement strings in one query
    // when no parameters are bound. We pass the whole script in a
    // single call so COPY ... FROM stdin sections are handled by the
    // driver's statement parser.
    await client.query(sql);
    await client.query("COMMIT");
    executed = 1;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const after = await captureRowCounts();
  return {
    id: options.id,
    dryRun: false,
    bytesRead: sqlBuffer.byteLength,
    tableRowCountsBefore: before,
    tableRowCountsAfter: after,
    executedStatements: executed,
  };
}
