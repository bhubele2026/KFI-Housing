import { describe, expect, it } from "vitest";
import {
  bucketExpiringCerts,
  buildInsuranceExpiryEmail,
  type ReminderCert,
  type ReminderProperty,
} from "./insurance-expiry-reminder";

const PROPERTIES: ReminderProperty[] = [
  { id: "p1", name: "Oak Manor" },
  { id: "p2", name: "Pine Lodge" },
];

function cert(overrides: Partial<ReminderCert> & { id: string }): ReminderCert {
  return {
    propertyId: "p1",
    carrier: "Acme Insurance",
    policyNumber: "POL-001",
    coverageEnd: "2026-06-01",
    ...overrides,
  };
}

describe("bucketExpiringCerts", () => {
  it("buckets certs ending today as 'today' and 1–30 days as 'expiring'", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-05-07" }), // today
      cert({ id: "c2", coverageEnd: "2026-05-20" }), // 13 days
      cert({ id: "c3", coverageEnd: "2026-06-06" }), // 30 days
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result.map((r) => ({ id: r.cert.id, bucket: r.bucket, days: r.days }))).toEqual([
      { id: "c1", bucket: "today", days: 0 },
      { id: "c2", bucket: "expiring", days: 13 },
      { id: "c3", bucket: "expiring", days: 30 },
    ]);
  });

  it("excludes already-expired certs", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-05-01" }), // expired 6 days ago
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("excludes certs more than 30 days out", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-06-07" }), // 31 days
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("skips certs with blank coverageEnd", () => {
    const certs: ReminderCert[] = [cert({ id: "c1", coverageEnd: "" })];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("sorts by days ascending (most urgent first)", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-06-01" }),
      cert({ id: "c2", coverageEnd: "2026-05-10" }),
      cert({ id: "c3", coverageEnd: "2026-05-07" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result.map((r) => r.cert.id)).toEqual(["c3", "c2", "c1"]);
  });

  it("resolves property name from the properties list", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", propertyId: "p2", coverageEnd: "2026-05-20" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result[0].propertyName).toBe("Pine Lodge");
  });

  it("uses fallback name for unknown property id", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", propertyId: "unknown", coverageEnd: "2026-05-20" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result[0].propertyName).toBe("—");
  });
});

describe("buildInsuranceExpiryEmail", () => {
  it("builds email with subject + recipient list", () => {
    const bucketed = bucketExpiringCerts(
      [
        cert({ id: "c1", coverageEnd: "2026-05-20" }),
        cert({ id: "c2", propertyId: "p2", coverageEnd: "2026-06-01" }),
      ],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com", "admin@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com",
    });
    expect(email.to).toEqual(["ops@example.com", "admin@example.com"]);
    expect(email.subject).toContain("2 certificates");
    expect(email.subject).toContain("within 30 days");
  });

  it("calls out 'expiring today' rows in the summary", () => {
    const bucketed = bucketExpiringCerts(
      [
        cert({ id: "c1", coverageEnd: "2026-05-07" }), // today
        cert({ id: "c2", coverageEnd: "2026-05-20" }), // 13 days
      ],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com",
    });
    expect(email.text).toContain("1 expiring today");
    expect(email.text).toContain("1 within 30 days");
  });

  it("includes carrier, policy number, and coverage end date", () => {
    const bucketed = bucketExpiringCerts(
      [
        cert({
          id: "c1",
          carrier: "Liberty Mutual",
          policyNumber: "LM-9001",
          coverageEnd: "2026-05-20",
        }),
      ],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com",
    });
    expect(email.text).toContain("Liberty Mutual");
    expect(email.text).toContain("LM-9001");
    expect(email.text).toContain("2026-05-20");
    expect(email.html).toContain("Liberty Mutual");
    expect(email.html).toContain("LM-9001");
    expect(email.html).toContain("2026-05-20");
    expect(email.html).toContain("<th>Coverage ends</th>");
  });

  it("links each row to the property's Insurance tab", () => {
    const bucketed = bucketExpiringCerts(
      [cert({ id: "c1", propertyId: "p1", coverageEnd: "2026-05-20" })],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com/",
    });
    const expected = "https://app.example.com/properties/p1?tab=insurance";
    expect(email.text).toContain(expected);
    expect(email.html).toContain(expected);
  });

  it("URL-encodes property ids in deep links", () => {
    const bucketed = bucketExpiringCerts(
      [cert({ id: "c1", propertyId: "weird id/1", coverageEnd: "2026-05-20" })],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com",
    });
    expect(email.text).toContain(
      "https://app.example.com/properties/weird%20id%2F1?tab=insurance",
    );
  });

  it("singular subject for 1 certificate", () => {
    const bucketed = bucketExpiringCerts(
      [cert({ id: "c1", coverageEnd: "2026-05-20" })],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "",
    });
    expect(email.subject).toContain("1 certificate ");
    expect(email.subject).not.toContain("1 certificates");
  });
});
