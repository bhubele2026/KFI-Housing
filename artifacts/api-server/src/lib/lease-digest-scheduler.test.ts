import { describe, expect, it, vi } from "vitest";
import {
  readDigestConfig,
  startWeeklyLeaseDigestScheduler,
  mergeRecipients,
} from "./lease-digest-scheduler";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("readDigestConfig", () => {
  it("parses recipients and uses sensible defaults", () => {
    const cfg = readDigestConfig({
      LEASE_DIGEST_WEBHOOK_URL: "https://hooks/x",
      LEASE_DIGEST_RECIPIENTS: "a@x.com, b@x.com",
      HOUSINGOPS_BASE_URL: "https://app.example.com",
    });
    expect(cfg.webhookUrl).toBe("https://hooks/x");
    expect(cfg.recipients).toEqual(["a@x.com", "b@x.com"]);
    expect(cfg.appBaseUrl).toBe("https://app.example.com");
    expect(cfg.weekday).toBe(1);
    expect(cfg.hourUtc).toBe(13);
  });
  it("respects override env vars", () => {
    const cfg = readDigestConfig({
      LEASE_DIGEST_WEEKDAY: "3",
      LEASE_DIGEST_HOUR_UTC: "9",
    });
    expect(cfg.weekday).toBe(3);
    expect(cfg.hourUtc).toBe(9);
  });
});

describe("mergeRecipients", () => {
  it("deduplicates case-insensitively", () => {
    expect(mergeRecipients(["A@x.com"], ["a@x.com", "b@y.com"])).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });
  it("handles empty inputs", () => {
    expect(mergeRecipients([], [])).toEqual([]);
    expect(mergeRecipients([], ["c@z.com"])).toEqual(["c@z.com"]);
    expect(mergeRecipients(["c@z.com"], [])).toEqual(["c@z.com"]);
  });
});

describe("startWeeklyLeaseDigestScheduler", () => {
  it("logs and no-ops when webhook URL is missing", () => {
    const logger = fakeLogger();
    const setIntervalFn = vi.fn();
    startWeeklyLeaseDigestScheduler({
      config: {
        webhookUrl: "",
        recipients: [],
        appBaseUrl: "",
        noticeLeadDays: 30,
        lowOccupancyThresholdPct: 80,
        weekday: 1,
        hourUtc: 13,
      },
      fetch: vi.fn(),
      loadLeases: async () => [],
      loadProperties: async () => [],
      now: () => new Date("2026-05-04T13:00:00Z"),
      logger,
      setIntervalFn,
    });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("disabled"),
    );
  });

  it("fires the digest on the configured weekday and dedupes within the week", async () => {
    const logger = fakeLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    let registered: (() => void) | null = null;
    const setIntervalFn = vi.fn((cb: () => void) => {
      registered = cb;
      return { unref: () => {} };
    });
    let now = new Date("2026-05-04T13:00:00Z"); // Monday
    startWeeklyLeaseDigestScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://app.example.com",
        noticeLeadDays: 30,
        lowOccupancyThresholdPct: 80,
        weekday: 1,
        hourUtc: 13,
      },
      fetch: fetchMock,
      loadLeases: async () => [
        {
          id: "l1",
          propertyId: "p1",
          startDate: "2024-01-01",
          endDate: "2026-05-25",
          status: "Active",
        },
      ],
      loadProperties: async () => [{ id: "p1", name: "Maple" }],
      now: () => now,
      logger,
      setIntervalFn,
    });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(registered).not.toBeNull();
    registered!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    now = new Date("2026-05-04T15:00:00Z");
    registered!();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now = new Date("2026-05-11T13:00:00Z");
    registered!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("merges env and DB recipients at send time", async () => {
    const logger = fakeLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    let registered: (() => void) | null = null;
    const setIntervalFn = vi.fn((cb: () => void) => {
      registered = cb;
      return { unref: () => {} };
    });
    const loadDbRecipients = vi
      .fn()
      .mockResolvedValue(["db@example.com", "ops@example.com"]);

    startWeeklyLeaseDigestScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://app.example.com",
        noticeLeadDays: 30,
        lowOccupancyThresholdPct: 80,
        weekday: 1,
        hourUtc: 13,
      },
      fetch: fetchMock,
      loadLeases: async () => [
        {
          id: "l1",
          propertyId: "p1",
          startDate: "2024-01-01",
          endDate: "2026-05-25",
          status: "Active",
        },
      ],
      loadProperties: async () => [{ id: "p1", name: "Maple" }],
      loadDbRecipients,
      now: () => new Date("2026-05-04T13:00:00Z"),
      logger,
      setIntervalFn,
    });

    registered!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(loadDbRecipients).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(
      expect.arrayContaining(["ops@example.com", "db@example.com"]),
    );
    expect(body.to).toHaveLength(2);
  });

  it("skips when no env recipients and no DB recipients", async () => {
    const logger = fakeLogger();
    const fetchMock = vi.fn();
    let registered: (() => void) | null = null;
    const setIntervalFn = vi.fn((cb: () => void) => {
      registered = cb;
      return { unref: () => {} };
    });

    startWeeklyLeaseDigestScheduler({
      config: {
        webhookUrl: "https://hooks/x",
        recipients: [],
        appBaseUrl: "https://app.example.com",
        noticeLeadDays: 30,
        lowOccupancyThresholdPct: 80,
        weekday: 1,
        hourUtc: 13,
      },
      fetch: fetchMock,
      loadLeases: async () => [],
      loadProperties: async () => [],
      loadDbRecipients: async () => [],
      now: () => new Date("2026-05-04T13:00:00Z"),
      logger,
      setIntervalFn,
    });

    registered!();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("no recipients"),
    );
  });
});
