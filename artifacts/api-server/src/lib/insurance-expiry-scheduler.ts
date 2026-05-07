import type { Logger } from "pino";
import {
  parseRecipients,
  sendInsuranceExpiryReminder,
  type InsuranceExpiryReminderDeps,
} from "./insurance-expiry-reminder";

export const SCHEDULER_STATE_ID = "insurance-expiry-reminder";

export interface InsuranceExpirySchedulerConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
  hourUtc: number;
}

export function readInsuranceExpiryConfig(env: NodeJS.ProcessEnv): InsuranceExpirySchedulerConfig {
  return {
    webhookUrl: (
      env["INSURANCE_EXPIRY_WEBHOOK_URL"] ??
      env["LEASE_DIGEST_WEBHOOK_URL"] ??
      ""
    ).trim(),
    recipients: parseRecipients(
      env["INSURANCE_EXPIRY_RECIPIENTS"] ??
      env["LEASE_DIGEST_RECIPIENTS"],
    ),
    appBaseUrl: (
      env["HOUSINGOPS_BASE_URL"] ??
      env["APP_BASE_URL"] ??
      ""
    ).trim(),
    hourUtc: parseIntOr(env["INSURANCE_EXPIRY_HOUR_UTC"], 13),
  };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function currentWeekKey(now: Date): string {
  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor(
    (now.getTime() - jan1.getTime()) / (1000 * 60 * 60 * 24),
  );
  const week = Math.ceil((dayOfYear + jan1.getUTCDay() + 1) / 7);
  return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface StartInsuranceExpirySchedulerDeps extends InsuranceExpiryReminderDeps {
  config: InsuranceExpirySchedulerConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  getLastSentWeekKey: () => Promise<string | null>;
  setLastSentWeekKey: (weekKey: string) => Promise<void>;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  intervalMs?: number;
}

export function startInsuranceExpiryScheduler(
  deps: StartInsuranceExpirySchedulerDeps,
): () => void {
  const { config, logger } = deps;
  if (!config.webhookUrl || config.recipients.length === 0) {
    logger.info(
      "Insurance expiry reminder disabled — set INSURANCE_EXPIRY_WEBHOOK_URL (or LEASE_DIGEST_WEBHOOK_URL) and INSURANCE_EXPIRY_RECIPIENTS (or LEASE_DIGEST_RECIPIENTS) to enable.",
    );
    return () => {};
  }
  if (!config.appBaseUrl) {
    logger.warn(
      "Insurance expiry reminder enabled but HOUSINGOPS_BASE_URL is not set — deep links in the email will be relative.",
    );
  }

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    const now = deps.now();
    if (now.getUTCDay() !== 1) return;
    if (now.getUTCHours() < config.hourUtc) return;

    inFlight = true;
    try {
      const lastSentWeekKey = await deps.getLastSentWeekKey();
      const weekKey = currentWeekKey(now);
      if (weekKey === lastSentWeekKey) return;

      const result = await sendInsuranceExpiryReminder(
        {
          webhookUrl: config.webhookUrl,
          recipients: config.recipients,
          appBaseUrl: config.appBaseUrl,
        },
        deps,
      );
      await deps.setLastSentWeekKey(weekKey);
      if (result.sent) {
        logger.info(
          { count: result.count, recipients: config.recipients.length },
          "Sent insurance expiry reminder email",
        );
      } else {
        logger.info(
          { reason: result.reason },
          "Insurance expiry reminder skipped (no action needed)",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to send insurance expiry reminder email");
    } finally {
      inFlight = false;
    }
  };

  void tick();

  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000;
  const setFn = deps.setIntervalFn ?? setInterval;
  const handle = setFn(() => {
    void tick();
  }, intervalMs);
  if (handle && typeof handle.unref === "function") handle.unref();

  return () => {
    if (handle && typeof (handle as { unref?: unknown }).unref === "function") {
      clearInterval(handle as unknown as NodeJS.Timeout);
    }
  };
}
