import { describe, expect, it, vi } from "vitest";
import {
  readInsuranceExpiryConfig,
  startInsuranceExpiryScheduler,
  type StartInsuranceExpirySchedulerDeps,
} from "./insurance-expiry-scheduler";

function makeDeps(
  overrides: Partial<StartInsuranceExpirySchedulerDeps> = {},
): StartInsuranceExpirySchedulerDeps {
  return {
    config: {
      webhookUrl: "https://hooks.example.com/ins",
      recipients: ["ops@example.com"],
      appBaseUrl: "https://app.example.com",
      hourUtc: 13,
    },
    fetch: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    loadCerts: vi.fn().mockResolvedValue([]),
    loadProperties: vi.fn().mockResolvedValue([]),
    getLastSentWeekKey: vi.fn().mockResolvedValue(null),
    setLastSentWeekKey: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-05-11T14:00:00Z"),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    setIntervalFn: vi.fn().mockReturnValue({ unref: vi.fn() }),
    intervalMs: 999999,
    ...overrides,
  };
}

describe("readInsuranceExpiryConfig", () => {
  it("reads dedicated env vars", () => {
    const config = readInsuranceExpiryConfig({
      INSURANCE_EXPIRY_WEBHOOK_URL: "https://ins.hook",
      INSURANCE_EXPIRY_RECIPIENTS: "a@b.com, c@d.com",
      HOUSINGOPS_BASE_URL: "https://app.test",
      INSURANCE_EXPIRY_HOUR_UTC: "10",
    });
    expect(config.webhookUrl).toBe("https://ins.hook");
    expect(config.recipients).toEqual(["a@b.com", "c@d.com"]);
    expect(config.appBaseUrl).toBe("https://app.test");
    expect(config.hourUtc).toBe(10);
  });

  it("falls back to lease digest env vars", () => {
    const config = readInsuranceExpiryConfig({
      LEASE_DIGEST_WEBHOOK_URL: "https://lease.hook",
      LEASE_DIGEST_RECIPIENTS: "x@y.com",
    });
    expect(config.webhookUrl).toBe("https://lease.hook");
    expect(config.recipients).toEqual(["x@y.com"]);
  });

  it("returns defaults for missing env vars", () => {
    const config = readInsuranceExpiryConfig({});
    expect(config.webhookUrl).toBe("");
    expect(config.recipients).toEqual([]);
    expect(config.appBaseUrl).toBe("");
    expect(config.hourUtc).toBe(13);
  });
});

describe("startInsuranceExpiryScheduler", () => {
  it("does nothing when webhook URL is empty", () => {
    const deps = makeDeps({
      config: { ...makeDeps().config, webhookUrl: "" },
    });
    const stop = startInsuranceExpiryScheduler(deps);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("disabled"),
    );
    expect(deps.loadCerts).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing when recipients are empty", () => {
    const deps = makeDeps({
      config: { ...makeDeps().config, recipients: [] },
    });
    const stop = startInsuranceExpiryScheduler(deps);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("disabled"),
    );
    stop();
  });

  it("skips when not Monday", () => {
    const deps = makeDeps({
      now: () => new Date("2026-05-12T14:00:00Z"),
    });
    startInsuranceExpiryScheduler(deps);
    expect(deps.loadCerts).not.toHaveBeenCalled();
  });

  it("skips when before hourUtc on Monday", () => {
    const deps = makeDeps({
      now: () => new Date("2026-05-11T10:00:00Z"),
    });
    startInsuranceExpiryScheduler(deps);
    expect(deps.loadCerts).not.toHaveBeenCalled();
  });

  it("skips when already sent this week", async () => {
    const deps = makeDeps({
      getLastSentWeekKey: vi.fn().mockResolvedValue("2026-W20"),
      now: () => new Date("2026-05-11T14:00:00Z"),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.getLastSentWeekKey).toHaveBeenCalled();
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("sends and persists week key when certs are expiring", async () => {
    const deps = makeDeps({
      loadCerts: vi.fn().mockResolvedValue([
        {
          id: "c1",
          propertyId: "p1",
          carrier: "Acme",
          policyNumber: "POL-1",
          coverageEnd: "2026-05-20",
        },
      ]),
      loadProperties: vi.fn().mockResolvedValue([
        { id: "p1", name: "Oak Manor" },
      ]),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.setLastSentWeekKey).toHaveBeenCalled();
    });
    expect(deps.fetch).toHaveBeenCalledWith(
      "https://hooks.example.com/ins",
      expect.objectContaining({ method: "POST" }),
    );
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining("Sent insurance expiry reminder"),
    );
  });

  it("warns on missing base URL", () => {
    const deps = makeDeps({
      config: { ...makeDeps().config, appBaseUrl: "" },
    });
    startInsuranceExpiryScheduler(deps);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("HOUSINGOPS_BASE_URL"),
    );
  });
});
