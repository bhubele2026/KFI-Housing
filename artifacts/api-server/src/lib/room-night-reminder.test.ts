import { describe, expect, it, vi } from "vitest";
import {
  buildRoomNightReminderEmail,
  currentMonthKey,
  getLeasesMissingMonthLog,
  isFirstBusinessDayOfMonth,
  sendRoomNightReminder,
  type ReminderLease,
  type ReminderLog,
  type ReminderProperty,
} from "./room-night-reminder";

function lease(over: Partial<ReminderLease> & { id: string }): ReminderLease {
  return {
    propertyId: "p1",
    startDate: "2024-01-01",
    endDate: "2025-12-31",
    status: "Active",
    monthlyRoomNightMin: 10,
    ...over,
  };
}

const PROPERTIES: ReminderProperty[] = [
  { id: "p1", name: "Ridge Motor Inn" },
  { id: "p2", name: "Highway Lodge" },
];

describe("currentMonthKey", () => {
  it("formats a UTC date as YYYY-MM", () => {
    expect(currentMonthKey(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    expect(currentMonthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });

  it("zero-pads single-digit months", () => {
    expect(currentMonthKey(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01");
  });
});

describe("isFirstBusinessDayOfMonth", () => {
  it("returns true for the 1st when it falls Mon–Fri", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2026-06-01T12:00:00Z"))).toBe(true);
    expect(isFirstBusinessDayOfMonth(new Date("2026-07-01T12:00:00Z"))).toBe(true);
  });

  it("returns false for the 1st on a Saturday", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2025-11-01T12:00:00Z"))).toBe(false);
  });

  it("returns false for the 1st on a Sunday", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2026-03-01T12:00:00Z"))).toBe(false);
  });

  it("returns true for Monday the 2nd when the 1st was Sunday", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2026-03-02T12:00:00Z"))).toBe(true);
  });

  it("returns true for Monday the 3rd when the 1st was Saturday", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2025-11-03T12:00:00Z"))).toBe(true);
  });

  it("returns false for mid-month dates", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2026-06-15T12:00:00Z"))).toBe(false);
  });

  it("returns false for the 2nd on a non-Monday", () => {
    expect(isFirstBusinessDayOfMonth(new Date("2026-06-02T12:00:00Z"))).toBe(false);
  });
});

describe("getLeasesMissingMonthLog", () => {
  it("returns hotel-rate leases without a log for the given month", () => {
    const leases = [
      lease({ id: "l1" }),
      lease({ id: "l2" }),
      lease({ id: "l3", monthlyRoomNightMin: 0 }),
    ];
    const logs: ReminderLog[] = [{ leaseId: "l1", month: "2026-06" }];
    const result = getLeasesMissingMonthLog(leases, logs, "2026-06");
    expect(result.map((l) => l.id)).toEqual(["l2"]);
  });

  it("excludes expired leases", () => {
    const leases = [lease({ id: "l1", status: "Expired" })];
    const result = getLeasesMissingMonthLog(leases, [], "2026-06");
    expect(result).toEqual([]);
  });

  it("includes upcoming leases", () => {
    const leases = [lease({ id: "l1", status: "Upcoming" })];
    const result = getLeasesMissingMonthLog(leases, [], "2026-06");
    expect(result.map((l) => l.id)).toEqual(["l1"]);
  });

  it("skips leases with monthlyRoomNightMin <= 0", () => {
    const leases = [lease({ id: "l1", monthlyRoomNightMin: 0 })];
    const result = getLeasesMissingMonthLog(leases, [], "2026-06");
    expect(result).toEqual([]);
  });

  it("returns empty when all hotel-rate leases have logs", () => {
    const leases = [lease({ id: "l1" })];
    const logs: ReminderLog[] = [{ leaseId: "l1", month: "2026-06" }];
    const result = getLeasesMissingMonthLog(leases, logs, "2026-06");
    expect(result).toEqual([]);
  });
});

describe("buildRoomNightReminderEmail", () => {
  it("builds an actionable email with lease details", () => {
    const email = buildRoomNightReminderEmail({
      recipients: ["ops@example.com"],
      leases: [
        lease({ id: "l1", vendor: "Acme Hotels" }),
        lease({ id: "l2", propertyId: "p2", monthlyRoomNightMin: 20 }),
      ],
      properties: PROPERTIES,
      appBaseUrl: "https://app.example.com",
      month: "2026-06",
    });
    expect(email.to).toEqual(["ops@example.com"]);
    expect(email.subject).toContain("2 hotel-rate leases");
    expect(email.subject).toContain("2026-06");
    expect(email.text).toContain("Ridge Motor Inn");
    expect(email.text).toContain("Highway Lodge");
    expect(email.text).toContain("Acme Hotels");
    expect(email.text).toContain("/leases?atRisk=1");
    expect(email.html).toContain("/leases?atRisk=1");
  });

  it("uses singular phrasing for a single lease", () => {
    const email = buildRoomNightReminderEmail({
      recipients: ["ops@example.com"],
      leases: [lease({ id: "l1" })],
      properties: PROPERTIES,
      appBaseUrl: "https://app.example.com",
      month: "2026-06",
    });
    expect(email.subject).toContain("1 hotel-rate lease missing");
    expect(email.subject).not.toContain("leases");
  });

  it("produces a no-action-needed email when no leases are missing", () => {
    const email = buildRoomNightReminderEmail({
      recipients: ["ops@example.com"],
      leases: [],
      properties: PROPERTIES,
      appBaseUrl: "https://app.example.com",
      month: "2026-06",
    });
    expect(email.subject).toContain("all logs recorded");
    expect(email.text).toContain("No action needed");
  });
});

describe("sendRoomNightReminder", () => {
  it("returns sent:false when no recipients are configured", async () => {
    const result = await sendRoomNightReminder(
      { webhookUrl: "https://hooks/x", recipients: [], appBaseUrl: "" },
      {
        fetch: vi.fn(),
        loadLeases: async () => [],
        loadProperties: async () => [],
        loadRoomNightLogs: async () => [],
        now: () => new Date("2026-06-01T13:00:00Z"),
      },
    );
    expect(result).toEqual({ sent: false, reason: "no recipients configured" });
  });

  it("returns sent:false when no webhook URL is configured", async () => {
    const result = await sendRoomNightReminder(
      { webhookUrl: "", recipients: ["a@x.com"], appBaseUrl: "" },
      {
        fetch: vi.fn(),
        loadLeases: async () => [],
        loadProperties: async () => [],
        loadRoomNightLogs: async () => [],
        now: () => new Date("2026-06-01T13:00:00Z"),
      },
    );
    expect(result).toEqual({ sent: false, reason: "no webhook URL configured" });
  });

  it("returns sent:false when no hotel-rate leases are missing a log", async () => {
    const result = await sendRoomNightReminder(
      { webhookUrl: "https://hooks/x", recipients: ["a@x.com"], appBaseUrl: "" },
      {
        fetch: vi.fn(),
        loadLeases: async () => [lease({ id: "l1" })],
        loadProperties: async () => PROPERTIES,
        loadRoomNightLogs: async () => [{ leaseId: "l1", month: "2026-06" }],
        now: () => new Date("2026-06-01T13:00:00Z"),
      },
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("no hotel-rate leases missing");
  });

  it("POSTs email payload to webhook and returns sent:true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await sendRoomNightReminder(
      {
        webhookUrl: "https://hooks/x",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://app.example.com",
      },
      {
        fetch: fetchMock,
        loadLeases: async () => [lease({ id: "l1" }), lease({ id: "l2", propertyId: "p2" })],
        loadProperties: async () => PROPERTIES,
        loadRoomNightLogs: async () => [],
        now: () => new Date("2026-06-01T13:00:00Z"),
      },
    );
    expect(result).toEqual({ sent: true, count: 2 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks/x");
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(["ops@example.com"]);
    expect(body.subject).toContain("2 hotel-rate leases");
    expect(body.html).toContain("/leases?atRisk=1");
  });

  it("throws on non-ok HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("fail", { status: 500 }));
    await expect(
      sendRoomNightReminder(
        { webhookUrl: "https://hooks/x", recipients: ["a@x.com"], appBaseUrl: "" },
        {
          fetch: fetchMock,
          loadLeases: async () => [lease({ id: "l1" })],
          loadProperties: async () => PROPERTIES,
          loadRoomNightLogs: async () => [],
          now: () => new Date("2026-06-01T13:00:00Z"),
        },
      ),
    ).rejects.toThrow("HTTP 500");
  });
});
