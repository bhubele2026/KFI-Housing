/**
 * Hourly tick that fires the weekly lease digest (Task #356) on the
 * configured weekday + UTC hour. Runs in-process so no external cron
 * is required. The ISO-week dedupe key (see `isoWeekKey`) is held in
 * memory, so dedupe is process-lifetime only — a restart between the
 * scheduled hour and the next tick on the same weekday could re-send
 * the digest. For most production deploys (restarts are rare and the
 * scheduled window is short) this is acceptable; persist
 * `lastSentWeekKey` to the DB if you need stronger cross-restart
 * guarantees.
 */

import type { Logger } from "pino";
import {
  isoWeekKey,
  parseRecipients,
  sendWeeklyLeaseDigest,
  shouldSendDigestNow,
  type WeeklyDigestDeps,
} from "./weekly-lease-digest";

export interface SchedulerConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
  weekday: number;
  hourUtc: number;
}

export function readDigestConfig(env: NodeJS.ProcessEnv): SchedulerConfig {
  return {
    webhookUrl: (env["LEASE_DIGEST_WEBHOOK_URL"] ?? "").trim(),
    recipients: parseRecipients(env["LEASE_DIGEST_RECIPIENTS"]),
    appBaseUrl: (
      env["HOUSINGOPS_BASE_URL"] ??
      env["APP_BASE_URL"] ??
      ""
    ).trim(),
    weekday: parseIntOr(env["LEASE_DIGEST_WEEKDAY"], 1), // Monday
    hourUtc: parseIntOr(env["LEASE_DIGEST_HOUR_UTC"], 13), // 8am US Central
  };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface StartSchedulerDeps extends WeeklyDigestDeps {
  config: SchedulerConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  intervalMs?: number;
}

/**
 * Begin the hourly scheduler tick. Returns a `stop` function so tests
 * (and graceful-shutdown code) can clear the interval. The first
 * tick is scheduled, not executed immediately, so server boot stays
 * fast — the next eligible Monday tick will catch up.
 */
export function startWeeklyLeaseDigestScheduler(
  deps: StartSchedulerDeps,
): () => void {
  const { config, logger } = deps;
  if (!config.webhookUrl || config.recipients.length === 0) {
    logger.info(
      "Weekly lease digest disabled — set LEASE_DIGEST_WEBHOOK_URL and LEASE_DIGEST_RECIPIENTS to enable.",
    );
    return () => {};
  }
  if (!config.appBaseUrl) {
    logger.warn(
      "Weekly lease digest enabled but HOUSINGOPS_BASE_URL is not set — deep links in the email will be relative.",
    );
  }

  let lastSentWeekKey: string | null = null;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    const now = deps.now();
    if (
      !shouldSendDigestNow({
        now,
        weekday: config.weekday,
        hourUtc: config.hourUtc,
        lastSentWeekKey,
      })
    ) {
      return;
    }
    inFlight = true;
    try {
      const result = await sendWeeklyLeaseDigest(
        {
          webhookUrl: config.webhookUrl,
          recipients: config.recipients,
          appBaseUrl: config.appBaseUrl,
        },
        deps,
      );
      if (result.sent) {
        lastSentWeekKey = isoWeekKey(now);
        logger.info(
          { total: result.total, recipients: config.recipients.length },
          "Sent weekly lease expiry digest",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to send weekly lease expiry digest");
    } finally {
      inFlight = false;
    }
  };

  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000; // 1 hour
  const setFn = deps.setIntervalFn ?? setInterval;
  const handle = setFn(() => {
    void tick();
  }, intervalMs);
  if (handle && typeof handle.unref === "function") handle.unref();

  return () => {
    if (handle && typeof (handle as { unref?: unknown }).unref === "function") {
      // setInterval handles support .unref / clearInterval transparently
      clearInterval(handle as unknown as NodeJS.Timeout);
    }
  };
}
