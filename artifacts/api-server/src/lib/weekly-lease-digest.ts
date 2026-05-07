/**
 * Weekly "leases expiring soon" email digest (Task #356).
 *
 * The dashboard alert card already buckets leases ending in
 * 30 / 60 / 90 days, but operators only see it when they open the app.
 * This module pushes the same list out as a weekly email so renewal
 * conversations start before a lease silently flips to "Expired".
 *
 * Transport mirrors `notify-schema-drift`: we POST a JSON payload to a
 * generic `LEASE_DIGEST_WEBHOOK_URL`, which an operator wires up to
 * their email service (Zapier, Make, Resend webhook, internal mailer,
 * etc.). Recipients are configurable via `LEASE_DIGEST_RECIPIENTS`
 * (comma-separated emails) and forwarded in the payload's `to` field.
 *
 * Pure helpers (`bucketExpiringLeases`, `buildLeaseDigestEmail`,
 * `parseRecipients`, `shouldSendDigestNow`) are exported for tests so
 * the scheduler and transport stay thin and skimmable.
 */

import { daysUntilExpiry, deriveLeaseStatus, todayIso } from "./lease-status";

export type ExpiryBucket = "critical" | "warning" | "soon";

export interface DigestLease {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  status: string;
  vendor?: string;
}

export interface DigestProperty {
  id: string;
  name: string;
}

export interface ExpiringLeaseEntry {
  lease: DigestLease;
  propertyName: string;
  days: number;
  bucket: ExpiryBucket;
}

export interface DigestBuckets {
  critical: ExpiringLeaseEntry[]; // ≤ 30 days
  warning: ExpiringLeaseEntry[]; // 31–60 days
  soon: ExpiringLeaseEntry[]; // 61–90 days
}

const BUCKET_LABEL: Record<ExpiryBucket, string> = {
  critical: "Expiring within 30 days",
  warning: "Expiring in 31–60 days",
  soon: "Expiring in 61–90 days",
};

/**
 * Group leases by how close they are to their `endDate`. Leases
 * without an end date, leases whose status is "Upcoming", and leases
 * outside the 0–90 day window are skipped — same rules the dashboard
 * uses, minus the "recently expired" bucket (the digest is forward-
 * looking only). Status is re-derived from term dates against `today`
 * so a lease seeded as "Active" past its end date is correctly
 * filtered out.
 */
export function bucketExpiringLeases(
  leases: readonly DigestLease[],
  properties: readonly DigestProperty[],
  today: string,
): DigestBuckets {
  const out: DigestBuckets = { critical: [], warning: [], soon: [] };
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  for (const l of leases) {
    if (!l.endDate || !l.startDate) continue;
    const status = deriveLeaseStatus(l, new Date(`${today}T00:00:00Z`));
    if (status === "Upcoming" || status === "Expired") continue;
    const days = daysUntilExpiry(l.endDate, today);
    if (days < 0 || days > 90) continue;
    let bucket: ExpiryBucket;
    if (days <= 30) bucket = "critical";
    else if (days <= 60) bucket = "warning";
    else bucket = "soon";
    out[bucket].push({
      lease: l,
      propertyName: propertyName.get(l.propertyId) ?? "—",
      days,
      bucket,
    });
  }
  for (const k of Object.keys(out) as ExpiryBucket[]) {
    out[k].sort((a, b) => a.days - b.days);
  }
  return out;
}

export function totalExpiring(buckets: DigestBuckets): number {
  return buckets.critical.length + buckets.warning.length + buckets.soon.length;
}

export interface DigestEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function leaseLink(baseUrl: string, leaseId: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/leases/${encodeURIComponent(leaseId)}`;
}

function rowLabel(days: number): string {
  if (days === 0) return "ends today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/**
 * Render the digest into a recipient-ready email payload. We emit
 * both a plain-text and an HTML body so the receiving mailer can
 * pick whichever its template engine prefers; deep-links use the
 * provided `appBaseUrl` so the click lands on the lease detail page
 * in HousingOps regardless of which environment sent the digest.
 */
export function buildLeaseDigestEmail(input: {
  recipients: readonly string[];
  buckets: DigestBuckets;
  appBaseUrl: string;
  today: string;
}): DigestEmail {
  const { recipients, buckets, appBaseUrl, today } = input;
  const total = totalExpiring(buckets);
  const subject =
    total === 0
      ? `HousingOps weekly lease digest (${today}) — no leases expiring soon`
      : `HousingOps weekly lease digest (${today}) — ${total} lease${total === 1 ? "" : "s"} expiring soon`;

  const order: ExpiryBucket[] = ["critical", "warning", "soon"];
  const textLines: string[] = [
    `Weekly lease expiry digest for ${today}.`,
    `${total} lease${total === 1 ? "" : "s"} expiring within the next 90 days.`,
    "",
  ];
  const htmlParts: string[] = [
    `<p>Weekly lease expiry digest for <strong>${escapeHtml(today)}</strong>.</p>`,
    `<p>${total} lease${total === 1 ? "" : "s"} expiring within the next 90 days.</p>`,
  ];

  for (const bucket of order) {
    const entries = buckets[bucket];
    if (entries.length === 0) continue;
    textLines.push(`== ${BUCKET_LABEL[bucket]} (${entries.length}) ==`);
    htmlParts.push(
      `<h3>${escapeHtml(BUCKET_LABEL[bucket])} (${entries.length})</h3>`,
      "<ul>",
    );
    for (const e of entries) {
      const url = leaseLink(appBaseUrl, e.lease.id);
      textLines.push(
        `- ${e.propertyName} — ends ${e.lease.endDate} (${rowLabel(e.days)}) — ${url}`,
      );
      htmlParts.push(
        `<li><a href="${escapeHtml(url)}">${escapeHtml(e.propertyName)}</a> — ends ${escapeHtml(e.lease.endDate)} (${escapeHtml(rowLabel(e.days))})</li>`,
      );
    }
    htmlParts.push("</ul>");
    textLines.push("");
  }

  if (total === 0) {
    textLines.push("No action needed this week.");
    htmlParts.push("<p>No action needed this week.</p>");
  }

  return {
    to: [...recipients],
    subject,
    text: textLines.join("\n"),
    html: htmlParts.join("\n"),
  };
}

/** Parse `LEASE_DIGEST_RECIPIENTS` — comma- or whitespace-separated. */
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface SendDigestResult {
  sent: boolean;
  reason?: string;
  total?: number;
}

export interface WeeklyDigestDeps {
  fetch: typeof fetch;
  loadLeases: () => Promise<DigestLease[]>;
  loadProperties: () => Promise<DigestProperty[]>;
  now: () => Date;
}

export interface WeeklyDigestConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
}

/**
 * Build the digest from current DB state and POST it to the
 * configured webhook. Returns `{ sent: false }` when there are no
 * recipients or when a transient transport error occurs (the caller
 * decides whether to log loudly or stay quiet — failures must never
 * crash the API server). The HTTP body is the `DigestEmail` payload
 * verbatim so a downstream mailer template can hand the same shape
 * to its email provider's "send" endpoint.
 */
export async function sendWeeklyLeaseDigest(
  config: WeeklyDigestConfig,
  deps: WeeklyDigestDeps,
): Promise<SendDigestResult> {
  if (config.recipients.length === 0) {
    return { sent: false, reason: "no recipients configured" };
  }
  if (!config.webhookUrl) {
    return { sent: false, reason: "no webhook URL configured" };
  }
  const today = todayIso(deps.now());
  const [leases, properties] = await Promise.all([
    deps.loadLeases(),
    deps.loadProperties(),
  ]);
  const buckets = bucketExpiringLeases(leases, properties, today);
  const email = buildLeaseDigestEmail({
    recipients: config.recipients,
    buckets,
    appBaseUrl: config.appBaseUrl,
    today,
  });
  const response = await deps.fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email),
  });
  if (!response.ok) {
    throw new Error(
      `Lease digest webhook responded with HTTP ${response.status}`,
    );
  }
  return { sent: true, total: totalExpiring(buckets) };
}

/**
 * ISO week label used as a dedupe key by the scheduler so two ticks
 * in the same week never double-send within a single api-server
 * process. We cheap-out by counting whole UTC days since 1970-01-05
 * (a Monday) and dividing by 7 — self-contained so the scheduler
 * test doesn't need a date library. Note: the dedupe is in-memory,
 * so a process restart between the scheduled hour and the next tick
 * could in theory re-send the same week's digest; if cross-restart
 * dedupe is needed, persist this key to the DB.
 */
export function isoWeekKey(d: Date): string {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = Math.floor(d.getTime() / MS_PER_DAY);
  // 1970-01-05 = day 4 was a Monday.
  const weeks = Math.floor((days - 4) / 7);
  return `w${weeks}`;
}

/**
 * True when `now` falls on the configured weekday (0 = Sunday … 6 =
 * Saturday, default Monday = 1) at or after the configured UTC hour
 * (default 13:00 UTC ≈ 8am US Central) — and we have not already
 * sent for this ISO week. The scheduler ticks hourly and uses this
 * to decide when to fire.
 */
export function shouldSendDigestNow(input: {
  now: Date;
  weekday: number;
  hourUtc: number;
  lastSentWeekKey: string | null;
}): boolean {
  const { now, weekday, hourUtc, lastSentWeekKey } = input;
  if (now.getUTCDay() !== weekday) return false;
  if (now.getUTCHours() < hourUtc) return false;
  return isoWeekKey(now) !== lastSentWeekKey;
}
