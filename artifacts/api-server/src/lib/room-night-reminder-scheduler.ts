import type { Logger } from "pino";
import {
  currentMonthKey,
  isFirstBusinessDayOfMonth,
  parseRecipients,
  sendRoomNightReminder,
  type RoomNightReminderDeps,
} from "./room-night-reminder";

export const SCHEDULER_STATE_ID = "room-night-reminder";

export interface ReminderSchedulerConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
  hourUtc: number;
}

export function readReminderConfig(env: NodeJS.ProcessEnv): ReminderSchedulerConfig {
  return {
    webhookUrl: (env["ROOM_NIGHT_REMINDER_WEBHOOK_URL"] ?? env["LEASE_DIGEST_WEBHOOK_URL"] ?? "").trim(),
    recipients: parseRecipients(env["ROOM_NIGHT_REMINDER_RECIPIENTS"] ?? env["LEASE_DIGEST_RECIPIENTS"]),
    appBaseUrl: (
      env["HOUSINGOPS_BASE_URL"] ??
      env["APP_BASE_URL"] ??
      ""
    ).trim(),
    hourUtc: parseIntOr(env["ROOM_NIGHT_REMINDER_HOUR_UTC"], 13),
  };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface StartReminderSchedulerDeps extends RoomNightReminderDeps {
  config: ReminderSchedulerConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  getLastSentMonthKey: () => Promise<string | null>;
  setLastSentMonthKey: (monthKey: string) => Promise<void>;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  intervalMs?: number;
}

export function shouldSendReminderNow(input: {
  now: Date;
  hourUtc: number;
  lastSentMonthKey: string | null;
}): boolean {
  const { now, hourUtc, lastSentMonthKey } = input;
  if (!isFirstBusinessDayOfMonth(now)) return false;
  if (now.getUTCHours() < hourUtc) return false;
  return currentMonthKey(now) !== lastSentMonthKey;
}

export function startRoomNightReminderScheduler(
  deps: StartReminderSchedulerDeps,
): () => void {
  const { config, logger } = deps;
  if (!config.webhookUrl || config.recipients.length === 0) {
    logger.info(
      "Room-night reminder disabled — set ROOM_NIGHT_REMINDER_WEBHOOK_URL (or LEASE_DIGEST_WEBHOOK_URL) and ROOM_NIGHT_REMINDER_RECIPIENTS (or LEASE_DIGEST_RECIPIENTS) to enable.",
    );
    return () => {};
  }
  if (!config.appBaseUrl) {
    logger.warn(
      "Room-night reminder enabled but HOUSINGOPS_BASE_URL is not set — deep links in the email will be relative.",
    );
  }

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    const now = deps.now();
    if (!isFirstBusinessDayOfMonth(now)) return;
    if (now.getUTCHours() < config.hourUtc) return;

    inFlight = true;
    try {
      const lastSentMonthKey = await deps.getLastSentMonthKey();
      if (currentMonthKey(now) === lastSentMonthKey) return;

      const result = await sendRoomNightReminder(
        {
          webhookUrl: config.webhookUrl,
          recipients: config.recipients,
          appBaseUrl: config.appBaseUrl,
        },
        deps,
      );
      const monthKey = currentMonthKey(now);
      await deps.setLastSentMonthKey(monthKey);
      if (result.sent) {
        logger.info(
          { count: result.count, recipients: config.recipients.length },
          "Sent room-night log reminder email",
        );
      } else {
        logger.info(
          { reason: result.reason },
          "Room-night reminder skipped (no action needed)",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to send room-night log reminder email");
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
