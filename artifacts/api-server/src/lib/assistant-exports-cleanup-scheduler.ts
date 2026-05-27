import type { Logger } from "pino";

export interface AssistantExportsCleanupDeps {
  /** Returns the number of rows deleted. */
  deleteExpired: () => Promise<number>;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now?: () => Date;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  setTimeoutFn?: (cb: () => void, ms: number) => { unref?: () => void };
  intervalMs?: number;
  warmupMs?: number;
}

/**
 * Hourly cleanup of expired `assistant_exports` rows (Task #681).
 *
 * Modelled on `insurance-expiry-scheduler.ts`: setInterval + 5-minute
 * warm-up + structured log on each tick. Returns a stop function so
 * tests can clear the timer. Best-effort — a DELETE failure logs and
 * the next tick retries.
 */
export function startAssistantExportsCleanupScheduler(
  deps: AssistantExportsCleanupDeps,
): () => void {
  const setI = deps.setIntervalFn ?? setInterval;
  const setT = deps.setTimeoutFn ?? setTimeout;
  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000; // 1h
  const warmupMs = deps.warmupMs ?? 5 * 60 * 1000; // 5min

  deps.logger.info(
    { intervalMs, warmupMs },
    "assistant-exports-cleanup: scheduler started",
  );

  let stopped = false;
  let intervalTimer: { unref?: () => void } | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const deleted = await deps.deleteExpired();
      if (deleted > 0) {
        deps.logger.info(
          { deleted },
          "assistant-exports-cleanup: pruned expired rows",
        );
      }
    } catch (err) {
      deps.logger.warn(
        { err },
        "assistant-exports-cleanup: prune failed — will retry next tick",
      );
    }
  };

  // One-shot warmup → fire the first prune, then start the hourly
  // interval exactly once. Previously this used setInterval for the
  // warmup, which spawned a brand-new hourly timer every 5 minutes —
  // an unbounded leak that caused duplicate prune work over uptime.
  const warmupTimer = setT(() => {
    if (stopped) return;
    void tick();
    intervalTimer = setI(() => {
      void tick();
    }, intervalMs);
    intervalTimer?.unref?.();
  }, warmupMs);
  (warmupTimer as { unref?: () => void })?.unref?.();

  return () => {
    stopped = true;
    try {
      clearTimeout(warmupTimer as unknown as NodeJS.Timeout);
    } catch {
      /* ignore */
    }
    try {
      clearInterval(intervalTimer as unknown as NodeJS.Timeout);
    } catch {
      /* ignore */
    }
  };
}
