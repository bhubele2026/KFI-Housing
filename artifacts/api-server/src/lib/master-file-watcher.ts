import { promises as fs } from "fs";
import { latestMasterFilePath } from "./import-master-leases";

export interface MasterFileSnapshot {
  filePath: string;
  mtimeMs: number;
}

export interface MasterFileWatcherDeps {
  reimport: () => Promise<void>;
  logger: Pick<import("pino").Logger, "info" | "warn" | "error">;
  pollIntervalMs?: number;
  resolveLatestSnapshot?: () => Promise<MasterFileSnapshot | null>;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;

async function defaultResolveLatestSnapshot(): Promise<MasterFileSnapshot | null> {
  try {
    const filePath = await latestMasterFilePath();
    const stat = await fs.stat(filePath);
    return { filePath, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function startMasterFileWatcher(deps: MasterFileWatcherDeps): () => void {
  const resolveLatest = deps.resolveLatestSnapshot ?? defaultResolveLatestSnapshot;
  const intervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let lastFilePath: string | null = null;
  let lastMtimeMs: number | null = null;
  let running = false;
  let stopped = false;
  let initialized = false;

  async function init(): Promise<void> {
    const snap = await resolveLatest();
    if (snap) {
      lastFilePath = snap.filePath;
      lastMtimeMs = snap.mtimeMs;
    }
    initialized = true;
  }

  async function poll(): Promise<void> {
    if (stopped || running) return;
    running = true;
    try {
      const snap = await resolveLatest();

      if (snap === null) {
        return;
      }

      const changed =
        (lastMtimeMs === null && initialized) ||
        snap.filePath !== lastFilePath ||
        snap.mtimeMs !== lastMtimeMs;

      if (changed) {
        deps.logger.info(
          { filePath: snap.filePath },
          "Master housing file change detected — re-importing in-process",
        );
        try {
          await deps.reimport();
          deps.logger.info(
            "Master housing file re-import completed successfully",
          );
          lastFilePath = snap.filePath;
          lastMtimeMs = snap.mtimeMs;
        } catch (err) {
          deps.logger.error(
            { err },
            "Master housing file re-import failed — will retry on next poll",
          );
        }
      } else {
        lastFilePath = snap.filePath;
        lastMtimeMs = snap.mtimeMs;
      }
    } finally {
      running = false;
    }
  }

  void init().then(() => {
    if (!stopped) {
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref();
    }
  });

  let timer: ReturnType<typeof setInterval> | null = null;

  return () => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
