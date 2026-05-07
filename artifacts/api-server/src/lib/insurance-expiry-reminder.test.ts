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
  it("buckets certs into critical / warning / soon / expired", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-05-01" }),
      cert({ id: "c2", coverageEnd: "2026-05-20" }),
      cert({ id: "c3", coverageEnd: "2026-06-15" }),
      cert({ id: "c4", coverageEnd: "2026-07-20" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result.map((r) => ({ id: r.cert.id, bucket: r.bucket }))).toEqual([
      { id: "c1", bucket: "expired" },
      { id: "c2", bucket: "critical" },
      { id: "c3", bucket: "warning" },
      { id: "c4", bucket: "soon" },
    ]);
  });

  it("excludes certs expired more than 30 days ago", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-03-01" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("excludes certs more than 90 days out", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-09-01" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("skips certs with blank coverageEnd", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "" }),
    ];
    const result = bucketExpiringCerts(certs, PROPERTIES, "2026-05-07");
    expect(result).toHaveLength(0);
  });

  it("sorts by days ascending (most urgent first)", () => {
    const certs: ReminderCert[] = [
      cert({ id: "c1", coverageEnd: "2026-06-01" }),
      cert({ id: "c2", coverageEnd: "2026-05-10" }),
      cert({ id: "c3", coverageEnd: "2026-05-01" }),
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
  it("builds email with correct subject and recipient list", () => {
    const bucketed = bucketExpiringCerts(
      [
        cert({ id: "c1", coverageEnd: "2026-05-20" }),
        cert({ id: "c2", propertyId: "p2", coverageEnd: "2026-06-15" }),
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
    expect(email.subject).toContain("insurance alert");
  });

  it("includes bucket summary in text body", () => {
    const bucketed = bucketExpiringCerts(
      [
        cert({ id: "c1", coverageEnd: "2026-05-01" }),
        cert({ id: "c2", coverageEnd: "2026-05-20" }),
      ],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com",
    });
    expect(email.text).toContain("1 expired");
    expect(email.text).toContain("1 within 30 days");
  });

  it("includes deep link in HTML and text", () => {
    const bucketed = bucketExpiringCerts(
      [cert({ id: "c1", coverageEnd: "2026-05-20" })],
      PROPERTIES,
      "2026-05-07",
    );
    const email = buildInsuranceExpiryEmail({
      recipients: ["ops@example.com"],
      certs: bucketed,
      appBaseUrl: "https://app.example.com/",
    });
    expect(email.text).toContain("https://app.example.com/");
    expect(email.html).toContain("https://app.example.com/");
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
