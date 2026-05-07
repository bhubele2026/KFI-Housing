import type { Logger } from "pino";
import {
  parseRecipients,
  sendInsuranceExpiryReminder,
  type InsuranceExpiryReminderDeps,
} from "./insurance-expiry-reminder";
import { mergeRecipients } from "./lease-digest-scheduler";
import { todayIso } from "./lease-status";

export const SCHEDULER_STATE_ID = "insurance-expiry-reminder";

export interface InsuranceExpirySchedulerConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
  hourUtc: number;
}

/**
 * Read scheduler config from env. Both the dedicated
 * `INSURANCE_EXPIRY_*` vars and the shared `LEASE_DIGEST_*` vars are
 * accepted so an operator already wired up for the lease digest
 * (Task #356) gets the insurance reminder for free, without
 * provisioning a second webhook + recipient list.
 *
 * Per Task #401 the global env recipient list acts as the "ops
 * mailbox fallback" — at send time we also merge in the
 * `digest_recipients` DB rows (managed in-app from Settings) so
 * admins can add/remove people without a redeploy.
 */
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

export interface StartInsuranceExpirySchedulerDeps extends InsuranceExpiryReminderDeps {
  config: InsuranceExpirySchedulerConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /**
   * Last day key (YYYY-MM-DD UTC) the scheduler successfully sent for.
   * Persisted in `scheduler_state` so a restart between the scheduled
   * hour and the next tick on the same day cannot double-send the
   * daily reminder.
   */
  getLastSentDayKey: () => Promise<string | null>;
  setLastSentDayKey: (dayKey: string) => Promise<void>;
  /**
   * Optional DB-backed recipient loader. Merged with the env-var
   * recipient list at send time so admins can manage the recipient
   * roster from Settings without a redeploy. When omitted, only
   * env-var recipients are used.
   */
  loadDbRecipients?: () => Promise<string[]>;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  intervalMs?: number;
}

/**
 * Daily insurance-expiry reminder scheduler (Task #401).
 *
 * Ticks hourly and fires once per UTC day, after the configured
 * `hourUtc` (default 13:00 UTC ≈ 8am US Central). Day-key dedupe is
 * persisted via `scheduler_state` so a restart inside the firing
 * window cannot double-send. Sending is skipped quietly when there
 * are no certs in the 0–30 day window — the scheduler is intentionally
 * chatty about *attempts* (one info log on send, one on skip) so an
 * operator can verify "yes, the daily job ran" from the workflow logs.
 */
export function startInsuranceExpiryScheduler(
  deps: StartInsuranceExpirySchedulerDeps,
): () => void {
  const { config, logger } = deps;
  if (!config.webhookUrl) {
    logger.info(
      "Insurance expiry reminder disabled — set INSURANCE_EXPIRY_WEBHOOK_URL (or LEASE_DIGEST_WEBHOOK_URL) to enable.",
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
    if (now.getUTCHours() < config.hourUtc) return;

    inFlight = true;
    try {
      const dayKey = todayIso(now);
      const lastSentDayKey = await deps.getLastSentDayKey();
      if (dayKey === lastSentDayKey) return;

      const dbEmails = deps.loadDbRecipients
        ? await deps.loadDbRecipients()
        : [];
      const merged = mergeRecipients(config.recipients, dbEmails);
      if (merged.length === 0) {
        // Deliberately do NOT persist the day key here: if an admin
        // adds a recipient later the same day, the next hourly tick
        // should pick it up and send. Persisting on "no recipients"
        // would silently swallow the alert until the next UTC day.
        logger.info(
          "Insurance expiry reminder skipped — no recipients configured (env or DB).",
        );
        return;
      }

      const result = await sendInsuranceExpiryReminder(
        {
          webhookUrl: config.webhookUrl,
          recipients: merged,
          appBaseUrl: config.appBaseUrl,
        },
        deps,
      );
      await deps.setLastSentDayKey(dayKey);
      if (result.sent) {
        logger.info(
          { count: result.count, recipients: merged.length },
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
