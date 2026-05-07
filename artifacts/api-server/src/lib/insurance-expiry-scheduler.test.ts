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
    getLastSentDayKey: vi.fn().mockResolvedValue(null),
    setLastSentDayKey: vi.fn().mockResolvedValue(undefined),
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

  it("skips when before hourUtc on the current day", () => {
    const deps = makeDeps({
      now: () => new Date("2026-05-11T10:00:00Z"),
    });
    startInsuranceExpiryScheduler(deps);
    expect(deps.loadCerts).not.toHaveBeenCalled();
  });

  it("runs daily — does not require a specific weekday", async () => {
    // Tuesday — the previous weekly scheduler would have skipped this.
    const deps = makeDeps({
      now: () => new Date("2026-05-12T14:00:00Z"),
      loadCerts: vi.fn().mockResolvedValue([
        {
          id: "c1",
          propertyId: "p1",
          carrier: "Acme",
          policyNumber: "POL-1",
          coverageEnd: "2026-05-20",
        },
      ]),
      loadProperties: vi.fn().mockResolvedValue([{ id: "p1", name: "Oak Manor" }]),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.setLastSentDayKey).toHaveBeenCalledWith("2026-05-12");
    });
    expect(deps.fetch).toHaveBeenCalled();
  });

  it("skips when already sent today", async () => {
    const deps = makeDeps({
      getLastSentDayKey: vi.fn().mockResolvedValue("2026-05-11"),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.getLastSentDayKey).toHaveBeenCalled();
    });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.setLastSentDayKey).not.toHaveBeenCalled();
  });

  it("sends and persists day key when certs are expiring within 30 days", async () => {
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
      loadProperties: vi.fn().mockResolvedValue([{ id: "p1", name: "Oak Manor" }]),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.setLastSentDayKey).toHaveBeenCalledWith("2026-05-11");
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

  it("merges DB recipients with env recipients", async () => {
    const deps = makeDeps({
      loadDbRecipients: vi.fn().mockResolvedValue(["extra@example.com"]),
      loadCerts: vi.fn().mockResolvedValue([
        {
          id: "c1",
          propertyId: "p1",
          carrier: "Acme",
          policyNumber: "POL-1",
          coverageEnd: "2026-05-20",
        },
      ]),
      loadProperties: vi.fn().mockResolvedValue([{ id: "p1", name: "Oak Manor" }]),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.fetch).toHaveBeenCalled();
    });
    const fetchMock = deps.fetch as ReturnType<typeof vi.fn>;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(["ops@example.com", "extra@example.com"]);
  });

  it("skips without persisting day key when no recipients are configured (env or DB)", async () => {
    // Not persisting on "no recipients" is intentional: it lets a
    // same-day fix (admin adds an email in Settings) pick the alert up
    // on the next hourly tick instead of silently waiting until tomorrow.
    const deps = makeDeps({
      config: { ...makeDeps().config, recipients: [] },
      loadDbRecipients: vi.fn().mockResolvedValue([]),
    });
    startInsuranceExpiryScheduler(deps);
    await vi.waitFor(() => {
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("no recipients"),
      );
    });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.setLastSentDayKey).not.toHaveBeenCalled();
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
