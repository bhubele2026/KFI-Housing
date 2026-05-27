import type { Logger } from "pino";
import { readQboConfig } from "./qbo-client";
import { runSyncForAllConnections } from "./qbo-sync";

export interface QboSchedulerDeps {
  env: NodeJS.ProcessEnv;
  logger: Pick<Logger, "info" | "warn" | "error">;
  intervalMs?: number;
  warmupMs?: number;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  setTimeoutFn?: (cb: () => void, ms: number) => { unref?: () => void };
}

/**
 * Hourly QuickBooks Online sync scheduler (Task #689). Mirrors the
 * shape of `insurance-expiry-scheduler.ts`: one warmup timer, an
 * hourly interval, in-flight dedupe, and structured
 * `qbo_sync.{start,ok,error}` logs (emitted from `runSyncForAllConnections`).
 *
 * Disabled silently when QBO env vars aren't configured.
 */
export function startQboSyncScheduler(deps: QboSchedulerDeps): () => void {
  const config = readQboConfig(deps.env);
  if (!config) {
    deps.logger.info(
      "QBO sync scheduler disabled — set QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI to enable.",
    );
    return () => {};
  }

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runSyncForAllConnections({ config });
    } catch (err) {
      deps.logger.error({ err }, "qbo_sync.scheduler_tick_failed");
    } finally {
      inFlight = false;
    }
  };

  const warmupMs = deps.warmupMs ?? 30_000;
  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000;
  const setT = deps.setTimeoutFn ?? setTimeout;
  const setI = deps.setIntervalFn ?? setInterval;
  const warmHandle = setT(() => void tick(), warmupMs);
  if (warmHandle && typeof warmHandle.unref === "function") warmHandle.unref();
  const handle = setI(() => void tick(), intervalMs);
  if (handle && typeof handle.unref === "function") handle.unref();
  return () => {
    if (handle) clearInterval(handle as unknown as NodeJS.Timeout);
  };
}
