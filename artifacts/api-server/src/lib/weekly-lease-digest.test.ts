import { describe, expect, it, vi } from "vitest";
import {
  bucketExpiringLeases,
  bucketNoticeDeadlines,
  buildLeaseDigestEmail,
  computeLowOccupancyCustomers,
  effectiveNoticePeriodDays,
  isoWeekKey,
  parseRecipients,
  readAlertThresholds,
  sendWeeklyLeaseDigest,
  shouldSendDigestNow,
  totalExpiring,
  type DigestLease,
  type DigestProperty,
} from "./weekly-lease-digest";

const TODAY = "2026-05-04"; // a Monday

function lease(over: Partial<DigestLease> & { id: string; endDate: string }): DigestLease {
  return {
    propertyId: "p1",
    startDate: "2024-01-01",
    status: "Active",
    ...over,
  };
}

const PROPERTIES: DigestProperty[] = [
  { id: "p1", name: "Maple House" },
  { id: "p2", name: "Cedar Court" },
];

describe("bucketExpiringLeases", () => {
  it("buckets leases by 30 / 60 / 90 day windows", () => {
    const buckets = bucketExpiringLeases(
      [
        lease({ id: "l-crit", endDate: "2026-05-25" }), // 21 days
        lease({ id: "l-warn", endDate: "2026-06-20", propertyId: "p2" }), // 47 days
        lease({ id: "l-soon", endDate: "2026-07-25" }), // 82 days
        lease({ id: "l-far", endDate: "2026-09-30" }), // > 90 days
        lease({ id: "l-past", endDate: "2026-04-01" }), // expired
        lease({ id: "l-upcoming", startDate: "2027-01-01", endDate: "2027-12-31" }),
        lease({ id: "l-blank", endDate: "" }),
      ],
      PROPERTIES,
      TODAY,
    );
    expect(buckets.critical.map((e) => e.lease.id)).toEqual(["l-crit"]);
    expect(buckets.warning.map((e) => e.lease.id)).toEqual(["l-warn"]);
    expect(buckets.soon.map((e) => e.lease.id)).toEqual(["l-soon"]);
    expect(buckets.warning[0]?.propertyName).toBe("Cedar Court");
    expect(totalExpiring(buckets)).toBe(3);
  });

  it("sorts each bucket by soonest-first", () => {
    const buckets = bucketExpiringLeases(
      [
        lease({ id: "a", endDate: "2026-05-30" }),
        lease({ id: "b", endDate: "2026-05-10" }),
        lease({ id: "c", endDate: "2026-05-20" }),
      ],
      PROPERTIES,
      TODAY,
    );
    expect(buckets.critical.map((e) => e.lease.id)).toEqual(["b", "c", "a"]);
  });
});

describe("buildLeaseDigestEmail", () => {
  const buckets = bucketExpiringLeases(
    [
      lease({ id: "l-crit", endDate: "2026-05-25" }),
      lease({ id: "l-warn", endDate: "2026-06-20", propertyId: "p2" }),
    ],
    PROPERTIES,
    TODAY,
  );

  it("includes recipients, subject with count, and deep links", () => {
    const email = buildLeaseDigestEmail({
      recipients: ["ops@example.com", "renewals@example.com"],
      buckets,
      appBaseUrl: "https://housingops.example.com",
      today: TODAY,
    });
    expect(email.to).toEqual(["ops@example.com", "renewals@example.com"]);
    expect(email.subject).toContain("2 leases expiring soon");
    expect(email.subject).toContain(TODAY);
    expect(email.text).toContain("Maple House");
    expect(email.text).toContain("https://housingops.example.com/leases/l-crit");
    expect(email.html).toContain(
      'href="https://housingops.example.com/leases/l-warn"',
    );
    expect(email.html).toContain("Cedar Court");
  });

  it("sends a friendly empty-state subject when no leases match", () => {
    const empty = bucketExpiringLeases([], PROPERTIES, TODAY);
    const email = buildLeaseDigestEmail({
      recipients: ["ops@example.com"],
      buckets: empty,
      appBaseUrl: "https://housingops.example.com",
      today: TODAY,
    });
    expect(email.subject).toContain("no leases expiring soon");
    expect(email.text).toContain("No action needed this week.");
  });

  it("escapes HTML in property names so a stray `<` can't break the email", () => {
    const props: DigestProperty[] = [
      { id: "p1", name: "Maple <script>alert(1)</script>" },
    ];
    const b = bucketExpiringLeases(
      [lease({ id: "x", endDate: "2026-05-25" })],
      props,
      TODAY,
    );
    const email = buildLeaseDigestEmail({
      recipients: ["ops@example.com"],
      buckets: b,
      appBaseUrl: "https://housingops.example.com",
      today: TODAY,
    });
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("Task #492 — notice deadlines & low combined occupancy", () => {
  it("readAlertThresholds defaults & overrides", () => {
    expect(readAlertThresholds({})).toEqual({
      noticeLeadDays: 30,
      lowOccupancyThresholdPct: 80,
    });
    expect(
      readAlertThresholds({
        NOTICE_LEAD_DAYS: "14",
        LOW_OCCUPANCY_THRESHOLD_PCT: "65",
      }),
    ).toEqual({ noticeLeadDays: 14, lowOccupancyThresholdPct: 65 });
    // Garbage falls back to defaults so a typo can't disable alerts.
    expect(
      readAlertThresholds({
        NOTICE_LEAD_DAYS: "nope",
        LOW_OCCUPANCY_THRESHOLD_PCT: "-1",
      }),
    ).toEqual({ noticeLeadDays: 30, lowOccupancyThresholdPct: 80 });
  });

  it("effectiveNoticePeriodDays prefers lease over property and returns null otherwise", () => {
    expect(
      effectiveNoticePeriodDays(
        { noticePeriodDays: 60 } as DigestLease,
        { defaultNoticePeriodDays: 30 } as DigestProperty,
      ),
    ).toBe(60);
    expect(
      effectiveNoticePeriodDays(
        { noticePeriodDays: null } as DigestLease,
        { defaultNoticePeriodDays: 45 } as DigestProperty,
      ),
    ).toBe(45);
    expect(
      effectiveNoticePeriodDays(
        { noticePeriodDays: null } as DigestLease,
        { defaultNoticePeriodDays: null } as DigestProperty,
      ),
    ).toBe(null);
    expect(
      effectiveNoticePeriodDays({ noticePeriodDays: null } as DigestLease, undefined),
    ).toBe(null);
  });

  it("bucketNoticeDeadlines surfaces only leases inside the lead window", () => {
    const props: DigestProperty[] = [
      { id: "p1", name: "Maple", defaultNoticePeriodDays: 60 },
      { id: "p2", name: "Cedar", defaultNoticePeriodDays: null },
    ];
    const leases: DigestLease[] = [
      // ends in 70 days, 60-day notice => 10 days until deadline (in window)
      lease({ id: "in", endDate: "2026-07-13", propertyId: "p1" }),
      // ends in 21 days, 60-day notice => -39 (already past, skipped)
      lease({ id: "past", endDate: "2026-05-25", propertyId: "p1" }),
      // explicit override on the lease beats the property's null
      lease({
        id: "override",
        endDate: "2026-06-08", // 35 days
        propertyId: "p2",
        noticePeriodDays: 14,
      }), // 21 days until — in window
      // p2 has no notice configured AND lease has no override => skipped
      lease({ id: "no-notice", endDate: "2026-05-20", propertyId: "p2" }),
    ];
    const out = bucketNoticeDeadlines(leases, props, TODAY, 30);
    expect(out.map((e) => e.lease.id)).toEqual(["in", "override"]);
    expect(out[0].daysUntilDeadline).toBe(10);
    expect(out[0].noticeDeadline).toBe("2026-05-14");
  });

  it("computeLowOccupancyCustomers respects shared properties", () => {
    const customers = [
      { id: "c1", name: "Acme" },
      { id: "c2", name: "Beta" },
    ];
    const props: DigestProperty[] = [
      { id: "p1", name: "Maple", customerId: "c1" },
      {
        id: "p2",
        name: "Cedar",
        customerId: "c2",
        sharedWithCustomerIds: ["c1"],
      },
    ];
    const beds = [
      { propertyId: "p1", status: "Vacant" as const },
      { propertyId: "p1", status: "Vacant" as const },
      { propertyId: "p2", status: "Occupied" as const },
      { propertyId: "p2", status: "Occupied" as const },
      { propertyId: "p2", status: "Vacant" as const },
    ];
    const out = computeLowOccupancyCustomers(customers, props, beds, 80);
    // c1: 2/5 = 40% (low). c2: 2/3 ≈ 66.7% (also low).
    const ids = out.map((c) => c.customerId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    // Lowest first
    expect(out[0].customerId).toBe("c1");
    // Threshold 50% drops c2.
    expect(
      computeLowOccupancyCustomers(customers, props, beds, 50).map((c) => c.customerId),
    ).toEqual(["c1"]);
  });

  it("buildLeaseDigestEmail renders new sections only when populated", () => {
    const buckets = bucketExpiringLeases([], PROPERTIES, TODAY);
    const noticeDeadlines = [
      {
        lease: lease({ id: "n1", endDate: "2026-07-01" }),
        propertyName: "Maple House",
        noticePeriodDays: 60,
        daysUntilDeadline: 5,
        noticeDeadline: "2026-05-09",
      },
    ];
    const lowOcc = [
      {
        customerId: "c1",
        customerName: "Acme",
        totalBeds: 5,
        occupiedBeds: 2,
        occupancyPct: 40,
      },
    ];
    const email = buildLeaseDigestEmail({
      recipients: ["ops@example.com"],
      buckets,
      appBaseUrl: "https://housingops.example.com",
      today: TODAY,
      noticeDeadlines,
      lowOccupancyCustomers: lowOcc,
      noticeLeadDays: 30,
      lowOccupancyThresholdPct: 80,
    });
    expect(email.subject).toContain("notice deadline");
    expect(email.subject).toContain("below 80%");
    expect(email.text).toContain("Notice deadline approaching");
    expect(email.text).toContain("Combined occupancy below 80%");
    expect(email.html).toContain("/leases/n1");
    expect(email.html).toContain("/customers/c1");
  });
});

describe("parseRecipients", () => {
  it("splits on commas, semicolons, and whitespace", () => {
    expect(parseRecipients("a@x.com, b@x.com;c@x.com  d@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
  });
  it("returns empty for undefined / blank", () => {
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });
});

describe("sendWeeklyLeaseDigest", () => {
  it("POSTs the digest payload to the configured webhook", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await sendWeeklyLeaseDigest(
      {
        webhookUrl: "https://hooks.example.com/digest",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://housingops.example.com",
      },
      {
        fetch: fetchMock,
        loadLeases: async () => [lease({ id: "l1", endDate: "2026-05-25" })],
        loadProperties: async () => PROPERTIES,
        now: () => new Date(`${TODAY}T13:00:00Z`),
      },
    );
    expect(result.sent).toBe(true);
    expect(result.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.example.com/digest");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.to).toEqual(["ops@example.com"]);
    expect(body.subject).toContain("1 lease expiring soon");
  });

  it("skips when no recipients are configured", async () => {
    const fetchMock = vi.fn();
    const result = await sendWeeklyLeaseDigest(
      {
        webhookUrl: "https://hooks.example.com/digest",
        recipients: [],
        appBaseUrl: "https://housingops.example.com",
      },
      {
        fetch: fetchMock,
        loadLeases: async () => [],
        loadProperties: async () => [],
        now: () => new Date(`${TODAY}T13:00:00Z`),
      },
    );
    expect(result.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the rendered email payload without POSTing when dryRun is true", async () => {
    const fetchMock = vi.fn();
    const result = await sendWeeklyLeaseDigest(
      {
        webhookUrl: "https://hooks.example.com/digest",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://housingops.example.com",
      },
      {
        fetch: fetchMock,
        loadLeases: async () => [lease({ id: "l1", endDate: "2026-05-25" })],
        loadProperties: async () => PROPERTIES,
        now: () => new Date(`${TODAY}T13:00:00Z`),
      },
      { dryRun: true },
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("dry run");
    expect(result.total).toBe(1);
    expect(result.email).toBeDefined();
    expect(result.email?.to).toEqual(["ops@example.com"]);
    expect(result.email?.subject).toContain("1 lease expiring soon");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dryRun does not require a webhook URL", async () => {
    const fetchMock = vi.fn();
    const result = await sendWeeklyLeaseDigest(
      {
        webhookUrl: "",
        recipients: ["ops@example.com"],
        appBaseUrl: "https://housingops.example.com",
      },
      {
        fetch: fetchMock,
        loadLeases: async () => [],
        loadProperties: async () => [],
        now: () => new Date(`${TODAY}T13:00:00Z`),
      },
      { dryRun: true },
    );
    expect(result.sent).toBe(false);
    expect(result.email).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the webhook responds non-2xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      sendWeeklyLeaseDigest(
        {
          webhookUrl: "https://hooks.example.com/digest",
          recipients: ["ops@example.com"],
          appBaseUrl: "https://housingops.example.com",
        },
        {
          fetch: fetchMock,
          loadLeases: async () => [],
          loadProperties: async () => [],
          now: () => new Date(`${TODAY}T13:00:00Z`),
        },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("shouldSendDigestNow", () => {
  it("fires on the configured weekday at/after the configured hour", () => {
    const monday9am = new Date(`${TODAY}T13:00:00Z`); // Monday 13:00 UTC
    expect(
      shouldSendDigestNow({
        now: monday9am,
        weekday: 1,
        hourUtc: 13,
        lastSentWeekKey: null,
      }),
    ).toBe(true);
  });
  it("waits until the configured hour", () => {
    expect(
      shouldSendDigestNow({
        now: new Date(`${TODAY}T12:59:00Z`),
        weekday: 1,
        hourUtc: 13,
        lastSentWeekKey: null,
      }),
    ).toBe(false);
  });
  it("does not fire on the wrong weekday", () => {
    expect(
      shouldSendDigestNow({
        now: new Date(`2026-05-05T13:00:00Z`), // Tuesday
        weekday: 1,
        hourUtc: 13,
        lastSentWeekKey: null,
      }),
    ).toBe(false);
  });
  it("dedupes within an ISO week", () => {
    const t1 = new Date(`${TODAY}T13:00:00Z`);
    const key = isoWeekKey(t1);
    expect(
      shouldSendDigestNow({
        now: new Date(`${TODAY}T15:00:00Z`),
        weekday: 1,
        hourUtc: 13,
        lastSentWeekKey: key,
      }),
    ).toBe(false);
  });
});
