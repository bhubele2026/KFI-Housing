import { describe, expect, it, vi } from "vitest";
import {
  readReminderConfig,
  shouldSendReminderNow,
  startRoomNightReminderScheduler,
} from "./room-night-reminder-scheduler";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("readReminderConfig", () => {
  it("falls back to LEASE_DIGEST env vars when ROOM_NIGHT_REMINDER vars are unset", () => {
    const cfg = readReminderConfig({
      LEASE_DIGEST_WEBHOOK_URL: "https://hooks/digest",
      LEASE_DIGEST_RECIPIENTS: "a@x.com, b@x.com",
      HOUSINGOPS_BASE_URL: "https://app.example.com",
    });
    expect(cfg.webhookUrl).toBe("https://hooks/digest");
    expect(cfg.recipients).toEqual(["a@x.com", "b@x.com"]);
    expect(cfg.appBaseUrl).toBe("https://app.example.com");
    expect(cfg.hourUtc).toBe(13);
  });

  it("prefers ROOM_NIGHT_REMINDER env vars over LEASE_DIGEST", () => {
    const cfg = readReminderConfig({
      ROOM_NIGHT_REMINDER_WEBHOOK_URL: "https://hooks/reminder",
      ROOM_NIGHT_REMINDER_RECIPIENTS: "ops@x.com",
      LEASE_DIGEST_WEBHOOK_URL: "https://hooks/digest",
      LEASE_DIGEST_RECIPIENTS: "other@x.com",
      ROOM_NIGHT_REMINDER_HOUR_UTC: "9",
    });
    expect(cfg.webhookUrl).toBe("https://hooks/reminder");
    expect(cfg.recipients).toEqual(["ops@x.com"]);
    expect(cfg.hourUtc).toBe(9);
  });
});

describe("shouldSendReminderNow", () => {
  it("returns true on the first business day at or after the configured hour", () => {
    expect(
      shouldSendReminderNow({
        now: new Date("2026-06-01T13:00:00Z"),
        hourUtc: 13,
        lastSentMonthKey: null,
      }),
    ).toBe(true);
  });

  it("returns false before the configured hour", () => {
    expect(
      shouldSendReminderNow({
        now: new Date("2026-06-01T10:00:00Z"),
        hourUtc: 13,
        lastSentMonthKey: null,
      }),
    ).toBe(false);
  });

  it("returns false on a non-first-business-day", () => {
    expect(
      shouldSendReminderNow({
        now: new Date("2026-06-15T13:00:00Z"),
        hourUtc: 13,
        lastSentMonthKey: null,
      }),
    ).toBe(false);
  });

  it("returns false when already sent for this month", () => {
    expect(
      shouldSendReminderNow({
        now: new Date("2026-06-01T13:00:00Z"),
        hourUtc: 13,
        lastSentMonthKey: "2026-06",
      }),
    ).toBe(false);
  });

  it("returns true for the next month after sending the previous one", () => {
    expect(
      shouldSendReminderNow({
        now: new Date("2026-07-01T13:00:00Z"),
        hourUtc: 13,
        lastSentMonthKey: "2026-06",
      }),
    ).toBe(true);
  });
});

describe("startRoomNightReminderScheduler", () => {
  it("logs and no-ops when not configured", () => {
    const logger = fakeLogger();
    const setIntervalFn = vi.fn();
    startRoomNightReminderScheduler({
      config: { webhookUrl: "", recipients: [], appBaseUrl: "", hourUtc: 13 },
      fetch: vi.fn(),
      loadLeases: async () => [],
      loadProperties: async () => [],
      loadRoomNightLogs: async () => [],
      getLastSentMonthKey: vi.fn().mockResolvedValue(null),
      setLastSentMonthKey: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-01T13:00:00Z"),
      logger,
      setIntervalFn,
    });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("fires the reminder on the first business day and dedupes within the month", async () => {
    const logger = fakeLogger();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    let registered: (() => void) | null = null;
    const setIntervalFn = vi.fn((cb: () => void) => {
      registered = cb;
      return { unref: () => {} };
    });
    let now = new Date("2026-06-01T13:00:00Z");
    let storedKey: string | null = null;
    const getLastSentMonthKey = vi.fn(async () => storedKey);
    const setLastSentMonthKey = vi.fn(async (key: string) => { storedKey = key; });

    startRoomNightReminderScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://app.example.com",
        hourUtc: 13,
      },
      fetch: fetchMock,
      loadLeases: async () => [
        {
          id: "l1",
          propertyId: "p1",
          startDate: "2024-01-01",
          endDate: "2027-12-31",
          status: "Active",
          monthlyRoomNightMin: 10,
        },
      ],
      loadProperties: async () => [{ id: "p1", name: "Ridge Motor Inn" }],
      loadRoomNightLogs: async () => [],
      getLastSentMonthKey,
      setLastSentMonthKey,
      now: () => now,
      logger,
      setIntervalFn,
    });

    expect(setIntervalFn).toHaveBeenCalledOnce();
    registered!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(setLastSentMonthKey).toHaveBeenCalledWith("2026-06");

    registered!();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now = new Date("2026-07-01T13:00:00Z");
    registered!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(setLastSentMonthKey).toHaveBeenCalledWith("2026-07");
  });

  it("does not send when the DB already has a sent marker for this month (cross-restart idempotency)", async () => {
    const logger = fakeLogger();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    let registered: (() => void) | null = null;
    const setIntervalFn = vi.fn((cb: () => void) => {
      registered = cb;
      return { unref: () => {} };
    });

    startRoomNightReminderScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://app.example.com",
        hourUtc: 13,
      },
      fetch: fetchMock,
      loadLeases: async () => [
        {
          id: "l1",
          propertyId: "p1",
          startDate: "2024-01-01",
          endDate: "2027-12-31",
          status: "Active",
          monthlyRoomNightMin: 10,
        },
      ],
      loadProperties: async () => [{ id: "p1", name: "Ridge Motor Inn" }],
      loadRoomNightLogs: async () => [],
      getLastSentMonthKey: vi.fn().mockResolvedValue("2026-06"),
      setLastSentMonthKey: vi.fn(),
      now: () => new Date("2026-06-01T13:00:00Z"),
      logger,
      setIntervalFn,
    });

    registered!();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a stop function that clears the interval", () => {
    const stop = startRoomNightReminderScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "",
        hourUtc: 13,
      },
      fetch: vi.fn(),
      loadLeases: async () => [],
      loadProperties: async () => [],
      loadRoomNightLogs: async () => [],
      getLastSentMonthKey: vi.fn().mockResolvedValue(null),
      setLastSentMonthKey: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-06-01T13:00:00Z"),
      logger: fakeLogger(),
    });
    expect(typeof stop).toBe("function");
    stop();
  });
});
