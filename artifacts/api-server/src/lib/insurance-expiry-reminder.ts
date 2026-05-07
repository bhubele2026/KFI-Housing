import { daysUntilExpiry, todayIso } from "./lease-status";
import { parseRecipients } from "./weekly-lease-digest";

export interface ReminderCert {
  id: string;
  propertyId: string;
  carrier: string;
  policyNumber: string;
  coverageEnd: string;
}

export interface ReminderProperty {
  id: string;
  name: string;
}

export type InsuranceExpiryBucket = "critical" | "warning" | "soon" | "expired";

export interface BucketedCert {
  cert: ReminderCert;
  propertyName: string;
  days: number;
  bucket: InsuranceExpiryBucket;
}

export interface InsuranceExpiryEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface InsuranceExpiryReminderDeps {
  fetch: typeof fetch;
  loadCerts: () => Promise<ReminderCert[]>;
  loadProperties: () => Promise<ReminderProperty[]>;
  now: () => Date;
}

export interface InsuranceExpiryReminderConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
}

export interface SendInsuranceExpiryResult {
  sent: boolean;
  reason?: string;
  count?: number;
}

export function bucketExpiringCerts(
  certs: readonly ReminderCert[],
  properties: readonly ReminderProperty[],
  today: string,
): BucketedCert[] {
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const out: BucketedCert[] = [];
  for (const cert of certs) {
    if (!cert.coverageEnd) continue;
    const days = daysUntilExpiry(cert.coverageEnd, today);
    let bucket: InsuranceExpiryBucket;
    if (days < 0) {
      if (days < -30) continue;
      bucket = "expired";
    } else if (days <= 30) {
      bucket = "critical";
    } else if (days <= 60) {
      bucket = "warning";
    } else if (days <= 90) {
      bucket = "soon";
    } else {
      continue;
    }
    out.push({
      cert,
      propertyName: propertyName.get(cert.propertyId) ?? "—",
      days,
      bucket,
    });
  }
  out.sort((a, b) => a.days - b.days);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bucketLabel(bucket: InsuranceExpiryBucket): string {
  switch (bucket) {
    case "expired": return "Expired";
    case "critical": return "≤ 30 days";
    case "warning": return "31–60 days";
    case "soon": return "61–90 days";
  }
}

function daysLabel(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function buildInsuranceExpiryEmail(input: {
  recipients: readonly string[];
  certs: readonly BucketedCert[];
  appBaseUrl: string;
}): InsuranceExpiryEmail {
  const { recipients, certs, appBaseUrl } = input;
  const count = certs.length;
  const trimmedBase = appBaseUrl.replace(/\/$/, "");
  const actionUrl = `${trimmedBase}/`;

  const expiredCount = certs.filter((c) => c.bucket === "expired").length;
  const criticalCount = certs.filter((c) => c.bucket === "critical").length;
  const warningCount = certs.filter((c) => c.bucket === "warning").length;
  const soonCount = certs.filter((c) => c.bucket === "soon").length;

  const bucketSummary = [
    expiredCount > 0 ? `${expiredCount} expired` : "",
    criticalCount > 0 ? `${criticalCount} within 30 days` : "",
    warningCount > 0 ? `${warningCount} within 31–60 days` : "",
    soonCount > 0 ? `${soonCount} within 61–90 days` : "",
  ].filter(Boolean).join(", ");

  const subject = `HousingOps insurance alert — ${count} certificate${count === 1 ? "" : "s"} expiring or expired`;

  const textLines: string[] = [
    `Insurance certificate expiry alert.`,
    "",
    `${count} certificate${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention: ${bucketSummary}.`,
    "",
  ];

  const htmlParts: string[] = [
    `<p>Insurance certificate expiry alert.</p>`,
    `<p>${count} certificate${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention: ${escapeHtml(bucketSummary)}.</p>`,
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">`,
    `<tr><th>Property</th><th>Carrier</th><th>Policy #</th><th>Status</th><th>When</th></tr>`,
  ];

  for (const c of certs) {
    textLines.push(
      `- ${c.propertyName} — ${c.cert.carrier || "—"} (${c.cert.policyNumber || "—"}) — ${bucketLabel(c.bucket)} — ${daysLabel(c.days)}`,
    );
    htmlParts.push(
      `<tr><td>${escapeHtml(c.propertyName)}</td><td>${escapeHtml(c.cert.carrier || "—")}</td><td>${escapeHtml(c.cert.policyNumber || "—")}</td><td>${escapeHtml(bucketLabel(c.bucket))}</td><td>${escapeHtml(daysLabel(c.days))}</td></tr>`,
    );
  }

  htmlParts.push(`</table>`);
  textLines.push("");
  textLines.push(`Review certificates: ${actionUrl}`);
  htmlParts.push(
    `<p><a href="${escapeHtml(actionUrl)}">Review certificates in HousingOps →</a></p>`,
  );

  return {
    to: [...recipients],
    subject,
    text: textLines.join("\n"),
    html: htmlParts.join("\n"),
  };
}

export { parseRecipients };

export async function sendInsuranceExpiryReminder(
  config: InsuranceExpiryReminderConfig,
  deps: InsuranceExpiryReminderDeps,
): Promise<SendInsuranceExpiryResult> {
  if (config.recipients.length === 0) {
    return { sent: false, reason: "no recipients configured" };
  }
  if (!config.webhookUrl) {
    return { sent: false, reason: "no webhook URL configured" };
  }
  const now = deps.now();
  const today = todayIso(now);
  const [certs, properties] = await Promise.all([
    deps.loadCerts(),
    deps.loadProperties(),
  ]);
  const bucketed = bucketExpiringCerts(certs, properties, today);
  if (bucketed.length === 0) {
    return { sent: false, reason: "no insurance certificates expiring within 90 days" };
  }
  const email = buildInsuranceExpiryEmail({
    recipients: config.recipients,
    certs: bucketed,
    appBaseUrl: config.appBaseUrl,
  });
  const response = await deps.fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email),
  });
  if (!response.ok) {
    throw new Error(
      `Insurance expiry reminder webhook responded with HTTP ${response.status}`,
    );
  }
  return { sent: true, count: bucketed.length };
}
