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

/**
 * Buckets used by the daily insurance-expiry reminder (Task #401).
 *
 * - `expiring`: cert ends in 1–30 days. Operators get a daily nudge
 *   while the cert is in this window so renewal conversations start
 *   before coverage actually lapses.
 * - `today`: cert ends today (days === 0). Same daily cadence as
 *   `expiring`, surfaced separately so the email can call out the
 *   "ends today" rows distinctly — this is the "again on the day they
 *   expire" reminder the task explicitly calls for.
 */
export type InsuranceExpiryBucket = "today" | "expiring";

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

/**
 * Returns the certs operators should be nudged about today: anything
 * with a coverage end date 0–30 days out (inclusive). Past-expiry
 * certs are excluded — once a cert has lapsed it is a different state
 * than "about to expire" and the dashboard already shows it; the
 * scheduled email is forward-looking only.
 */
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
    if (days < 0 || days > 30) continue;
    out.push({
      cert,
      propertyName: propertyName.get(cert.propertyId) ?? "—",
      days,
      bucket: days === 0 ? "today" : "expiring",
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

function daysLabel(days: number): string {
  if (days === 0) return "expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * Deep-link to a property's Insurance tab. The property-detail page
 * reads the active tab from the `?tab=` query param (see
 * `artifacts/housingops/src/pages/property-detail.tsx`), so this
 * lands the operator one click away from "Edit cert" / "Upload
 * replacement" without having to find the property and switch tabs.
 */
function propertyInsuranceLink(baseUrl: string, propertyId: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/properties/${encodeURIComponent(propertyId)}?tab=insurance`;
}

export function buildInsuranceExpiryEmail(input: {
  recipients: readonly string[];
  certs: readonly BucketedCert[];
  appBaseUrl: string;
}): InsuranceExpiryEmail {
  const { recipients, certs, appBaseUrl } = input;
  const count = certs.length;
  const todayCount = certs.filter((c) => c.bucket === "today").length;
  const expiringCount = certs.filter((c) => c.bucket === "expiring").length;

  const summaryParts = [
    todayCount > 0 ? `${todayCount} expiring today` : "",
    expiringCount > 0 ? `${expiringCount} within 30 days` : "",
  ].filter(Boolean);
  const summary = summaryParts.join(", ");

  const subject = `KFI Staffing insurance alert — ${count} certificate${count === 1 ? "" : "s"} expiring within 30 days`;

  const textLines: string[] = [
    `Insurance certificate expiry alert.`,
    "",
    `${count} certificate${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention: ${summary}.`,
    "",
  ];

  const htmlParts: string[] = [
    `<p>Insurance certificate expiry alert.</p>`,
    `<p>${count} certificate${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention: ${escapeHtml(summary)}.</p>`,
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">`,
    `<tr><th>Property</th><th>Carrier</th><th>Policy #</th><th>Coverage ends</th><th>When</th></tr>`,
  ];

  for (const c of certs) {
    const link = propertyInsuranceLink(appBaseUrl, c.cert.propertyId);
    textLines.push(
      `- ${c.propertyName} — ${c.cert.carrier || "—"} (${c.cert.policyNumber || "—"}) — coverage ends ${c.cert.coverageEnd} (${daysLabel(c.days)}) — ${link}`,
    );
    htmlParts.push(
      `<tr>` +
        `<td><a href="${escapeHtml(link)}">${escapeHtml(c.propertyName)}</a></td>` +
        `<td>${escapeHtml(c.cert.carrier || "—")}</td>` +
        `<td>${escapeHtml(c.cert.policyNumber || "—")}</td>` +
        `<td>${escapeHtml(c.cert.coverageEnd)}</td>` +
        `<td>${escapeHtml(daysLabel(c.days))}</td>` +
        `</tr>`,
    );
  }

  htmlParts.push(`</table>`);

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
    return {
      sent: false,
      reason: "no insurance certificates expiring within 30 days",
    };
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
