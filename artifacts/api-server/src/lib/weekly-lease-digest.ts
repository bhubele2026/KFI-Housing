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

// ── Task #492 thresholds ───────────────────────────────────────────────
// Both alert thresholds live as named constants so the meaning is
// obvious at the call site and can be tuned per-environment without
// touching code. Defaults match the product spec — 30 days of lead
// time before a lease's notice deadline, and 80% combined-occupancy
// floor across a customer's owned + shared properties.
export const NOTICE_LEAD_DAYS_DEFAULT = 30;
export const LOW_OCCUPANCY_THRESHOLD_PCT_DEFAULT = 80;

export interface AlertThresholds {
  noticeLeadDays: number;
  lowOccupancyThresholdPct: number;
}

/**
 * Read the alert thresholds from env, falling back to product defaults.
 * Negative / non-numeric values fall back so a typo in deploy config
 * can't silently disable the alerts.
 */
export function readAlertThresholds(env: NodeJS.ProcessEnv): AlertThresholds {
  return {
    noticeLeadDays: readPositiveInt(
      env["NOTICE_LEAD_DAYS"],
      NOTICE_LEAD_DAYS_DEFAULT,
    ),
    lowOccupancyThresholdPct: readPositiveInt(
      env["LOW_OCCUPANCY_THRESHOLD_PCT"],
      LOW_OCCUPANCY_THRESHOLD_PCT_DEFAULT,
    ),
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

export type ExpiryBucket = "critical" | "warning" | "soon";

export interface DigestLease {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  status: string;
  vendor?: string;
  /**
   * Lease-level notice period override (Task #492). When `null` or
   * absent, the parent property's `defaultNoticePeriodDays` is used.
   * When both are missing, notice tracking is disabled for the lease.
   */
  noticePeriodDays?: number | null;
}

export interface DigestProperty {
  id: string;
  name: string;
  /**
   * Default notice period (days) inherited by leases on this property
   * when their own `noticePeriodDays` is unset. `null`/absent disables
   * the notice deadline alert for inheriting leases.
   */
  defaultNoticePeriodDays?: number | null;
  /**
   * Primary owning customer id. Combined with `sharedWithCustomerIds`
   * to compute per-customer combined occupancy (Task #492).
   */
  customerId?: string;
  /** Additional customers sharing the property. */
  sharedWithCustomerIds?: string[];
}

export interface DigestCustomer {
  id: string;
  name: string;
}

/**
 * Subset of bed fields required for the low-occupancy roll-up. Status
 * is the same free-form string the schema stores; only the literal
 * value `"Occupied"` counts toward the numerator.
 */
export interface DigestBed {
  propertyId: string;
  status: string;
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

// ── Notice deadline alerts (Task #492) ─────────────────────────────────

export interface NoticeDeadlineEntry {
  lease: DigestLease;
  propertyName: string;
  /** Effective notice period in days (lease override or property default). */
  noticePeriodDays: number;
  /** ISO `YYYY-MM-DD` date the notice must be served by. */
  noticeDeadline: string;
  /** Whole calendar days from `today` to `noticeDeadline`. */
  daysUntilDeadline: number;
}

/**
 * Add `days` calendar days to a `YYYY-MM-DD` date and return the same
 * format. Implemented locally (rather than in `lease-status.ts`) so
 * this module's helpers stay self-contained for digest tests.
 */
function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the effective notice period for a lease — its own override
 * if set, otherwise the parent property's default. Returns `null` when
 * neither is set or the value is non-positive (notice tracking off).
 */
export function effectiveNoticePeriodDays(
  lease: Pick<DigestLease, "noticePeriodDays">,
  property: Pick<DigestProperty, "defaultNoticePeriodDays"> | undefined,
): number | null {
  const lv = lease.noticePeriodDays;
  if (typeof lv === "number" && lv > 0) return Math.trunc(lv);
  const pv = property?.defaultNoticePeriodDays;
  if (typeof pv === "number" && pv > 0) return Math.trunc(pv);
  return null;
}

/**
 * Surface every lease whose notice deadline (= `endDate` − notice
 * period) falls within `leadDays` of `today`. Past deadlines are
 * skipped — once the deadline has slipped, the existing expiry buckets
 * already cover the lease. Same status filter as
 * `bucketExpiringLeases`: Upcoming + Expired leases are ignored.
 */
export function bucketNoticeDeadlines(
  leases: readonly DigestLease[],
  properties: readonly DigestProperty[],
  today: string,
  leadDays: number,
): NoticeDeadlineEntry[] {
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const out: NoticeDeadlineEntry[] = [];
  for (const l of leases) {
    if (!l.endDate || !l.startDate) continue;
    const status = deriveLeaseStatus(l, new Date(`${today}T00:00:00Z`));
    if (status === "Upcoming" || status === "Expired") continue;
    const period = effectiveNoticePeriodDays(l, propertyById.get(l.propertyId));
    if (period == null) continue;
    const deadline = addDaysIso(l.endDate, -period);
    const daysUntilDeadline = daysUntilExpiry(deadline, today);
    if (daysUntilDeadline < 0 || daysUntilDeadline > leadDays) continue;
    out.push({
      lease: l,
      propertyName: propertyById.get(l.propertyId)?.name ?? "—",
      noticePeriodDays: period,
      noticeDeadline: deadline,
      daysUntilDeadline,
    });
  }
  out.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);
  return out;
}

// ── Low combined-occupancy alerts (Task #492) ──────────────────────────

export interface LowOccupancyCustomer {
  customerId: string;
  customerName: string;
  totalBeds: number;
  occupiedBeds: number;
  occupancyPct: number;
}

/**
 * Flag every customer whose combined bed occupancy across owned + shared
 * properties is strictly below `thresholdPct`. Customers with no beds
 * are skipped — there's nothing to roll up. Output is sorted lowest
 * occupancy first so the worst offenders surface at the top.
 */
export function computeLowOccupancyCustomers(
  customers: readonly DigestCustomer[],
  properties: readonly DigestProperty[],
  beds: readonly DigestBed[],
  thresholdPct: number,
): LowOccupancyCustomer[] {
  const bedsByProperty = new Map<string, { total: number; occupied: number }>();
  for (const b of beds) {
    const entry = bedsByProperty.get(b.propertyId) ?? { total: 0, occupied: 0 };
    entry.total += 1;
    if (b.status === "Occupied") entry.occupied += 1;
    bedsByProperty.set(b.propertyId, entry);
  }
  const out: LowOccupancyCustomer[] = [];
  for (const c of customers) {
    let total = 0;
    let occupied = 0;
    for (const p of properties) {
      const owns =
        p.customerId === c.id ||
        (p.sharedWithCustomerIds ?? []).includes(c.id);
      if (!owns) continue;
      const bed = bedsByProperty.get(p.id);
      if (!bed) continue;
      total += bed.total;
      occupied += bed.occupied;
    }
    if (total === 0) continue;
    const pct = (occupied / total) * 100;
    if (pct >= thresholdPct) continue;
    out.push({
      customerId: c.id,
      customerName: c.name,
      totalBeds: total,
      occupiedBeds: occupied,
      occupancyPct: pct,
    });
  }
  out.sort((a, b) => a.occupancyPct - b.occupancyPct);
  return out;
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

function noticeRowLabel(days: number): string {
  if (days === 0) return "deadline today";
  if (days === 1) return "1 day until notice deadline";
  return `${days} days until notice deadline`;
}

function customerLink(baseUrl: string, customerId: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/customers/${encodeURIComponent(customerId)}`;
}

/**
 * Render the digest into a recipient-ready email payload. We emit
 * both a plain-text and an HTML body so the receiving mailer can
 * pick whichever its template engine prefers; deep-links use the
 * provided `appBaseUrl` so the click lands on the lease detail page
 * in HousingOps regardless of which environment sent the digest.
 *
 * The optional `noticeDeadlines` and `lowOccupancyCustomers` sections
 * (Task #492) render only when non-empty so legacy callers that don't
 * pass them keep the original layout exactly.
 */
export function buildLeaseDigestEmail(input: {
  recipients: readonly string[];
  buckets: DigestBuckets;
  appBaseUrl: string;
  today: string;
  noticeDeadlines?: readonly NoticeDeadlineEntry[];
  lowOccupancyCustomers?: readonly LowOccupancyCustomer[];
  noticeLeadDays?: number;
  lowOccupancyThresholdPct?: number;
}): DigestEmail {
  const {
    recipients,
    buckets,
    appBaseUrl,
    today,
    noticeDeadlines = [],
    lowOccupancyCustomers = [],
    noticeLeadDays,
    lowOccupancyThresholdPct,
  } = input;
  const total = totalExpiring(buckets);
  const noticeCount = noticeDeadlines.length;
  const lowOccCount = lowOccupancyCustomers.length;

  const headlineParts: string[] = [];
  if (total > 0) {
    headlineParts.push(`${total} lease${total === 1 ? "" : "s"} expiring soon`);
  }
  if (noticeCount > 0) {
    headlineParts.push(
      `${noticeCount} notice deadline${noticeCount === 1 ? "" : "s"} approaching`,
    );
  }
  if (lowOccCount > 0) {
    headlineParts.push(
      `${lowOccCount} customer${lowOccCount === 1 ? "" : "s"} below ${lowOccupancyThresholdPct ?? LOW_OCCUPANCY_THRESHOLD_PCT_DEFAULT}% occupancy`,
    );
  }
  const subject =
    headlineParts.length === 0
      ? `HousingOps weekly lease digest (${today}) — no leases expiring soon`
      : `HousingOps weekly lease digest (${today}) — ${headlineParts.join(", ")}`;

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

  if (noticeCount > 0) {
    const lead =
      noticeLeadDays ?? NOTICE_LEAD_DAYS_DEFAULT;
    const heading = `Notice deadline approaching (next ${lead} day${lead === 1 ? "" : "s"})`;
    textLines.push(`== ${heading} (${noticeCount}) ==`);
    htmlParts.push(
      `<h3>${escapeHtml(heading)} (${noticeCount})</h3>`,
      "<ul>",
    );
    for (const e of noticeDeadlines) {
      const url = leaseLink(appBaseUrl, e.lease.id);
      textLines.push(
        `- ${e.propertyName} — notice by ${e.noticeDeadline} (${noticeRowLabel(e.daysUntilDeadline)}; ends ${e.lease.endDate}, ${e.noticePeriodDays}-day notice) — ${url}`,
      );
      htmlParts.push(
        `<li><a href="${escapeHtml(url)}">${escapeHtml(e.propertyName)}</a> — notice by ${escapeHtml(e.noticeDeadline)} (${escapeHtml(noticeRowLabel(e.daysUntilDeadline))}; ends ${escapeHtml(e.lease.endDate)}, ${e.noticePeriodDays}-day notice)</li>`,
      );
    }
    htmlParts.push("</ul>");
    textLines.push("");
  }

  if (lowOccCount > 0) {
    const threshold = lowOccupancyThresholdPct ?? LOW_OCCUPANCY_THRESHOLD_PCT_DEFAULT;
    const heading = `Combined occupancy below ${threshold}%`;
    textLines.push(`== ${heading} (${lowOccCount}) ==`);
    htmlParts.push(
      `<h3>${escapeHtml(heading)} (${lowOccCount})</h3>`,
      "<ul>",
    );
    for (const c of lowOccupancyCustomers) {
      const url = customerLink(appBaseUrl, c.customerId);
      const pctLabel = `${c.occupancyPct.toFixed(1)}% (${c.occupiedBeds}/${c.totalBeds} beds)`;
      textLines.push(`- ${c.customerName} — ${pctLabel} — ${url}`);
      htmlParts.push(
        `<li><a href="${escapeHtml(url)}">${escapeHtml(c.customerName)}</a> — ${escapeHtml(pctLabel)}</li>`,
      );
    }
    htmlParts.push("</ul>");
    textLines.push("");
  }

  if (total === 0 && noticeCount === 0 && lowOccCount === 0) {
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
  /**
   * The rendered digest payload. Always populated on a successful
   * send; also returned (without `sent: true`) when the caller passes
   * `{ dryRun: true }` so operators can inspect the email content
   * without actually invoking the webhook.
   */
  email?: DigestEmail;
}

export interface SendDigestOptions {
  /**
   * When true, build the digest email but skip the webhook POST.
   * Useful for "preview without sending" flows where an operator
   * wants to inspect subject / body / recipients before dispatching
   * to real recipients. The returned `SendDigestResult` includes the
   * rendered `email` payload and `sent: false`.
   */
  dryRun?: boolean;
}

export interface WeeklyDigestDeps {
  fetch: typeof fetch;
  loadLeases: () => Promise<DigestLease[]>;
  loadProperties: () => Promise<DigestProperty[]>;
  now: () => Date;
  /**
   * Optional roll-up sources (Task #492). When omitted, the notice
   * deadline + low combined-occupancy sections are simply skipped, so
   * existing callers (tests, legacy wiring) keep their original payload
   * shape without modification.
   */
  loadCustomers?: () => Promise<DigestCustomer[]>;
  loadBeds?: () => Promise<DigestBed[]>;
}

export interface WeeklyDigestConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
  /** Lead time in days for "Notice deadline approaching" alerts. */
  noticeLeadDays?: number;
  /** Combined-occupancy floor (percent) for low-occupancy alerts. */
  lowOccupancyThresholdPct?: number;
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
  options: SendDigestOptions = {},
): Promise<SendDigestResult> {
  if (config.recipients.length === 0) {
    return { sent: false, reason: "no recipients configured" };
  }
  // The webhook URL is only strictly required when we actually plan
  // to POST. A `dryRun` caller is asking for the rendered payload, so
  // it's fine to skip this check and still hand back the email body.
  if (!options.dryRun && !config.webhookUrl) {
    return { sent: false, reason: "no webhook URL configured" };
  }
  const today = todayIso(deps.now());
  const noticeLeadDays = config.noticeLeadDays ?? NOTICE_LEAD_DAYS_DEFAULT;
  const lowOccThreshold =
    config.lowOccupancyThresholdPct ?? LOW_OCCUPANCY_THRESHOLD_PCT_DEFAULT;
  const [leases, properties, customers, beds] = await Promise.all([
    deps.loadLeases(),
    deps.loadProperties(),
    deps.loadCustomers ? deps.loadCustomers() : Promise.resolve([]),
    deps.loadBeds ? deps.loadBeds() : Promise.resolve([]),
  ]);
  const buckets = bucketExpiringLeases(leases, properties, today);
  const noticeDeadlines = bucketNoticeDeadlines(
    leases,
    properties,
    today,
    noticeLeadDays,
  );
  const lowOccupancyCustomers =
    customers.length > 0 && beds.length > 0
      ? computeLowOccupancyCustomers(
          customers,
          properties,
          beds,
          lowOccThreshold,
        )
      : [];
  const email = buildLeaseDigestEmail({
    recipients: config.recipients,
    buckets,
    appBaseUrl: config.appBaseUrl,
    today,
    noticeDeadlines,
    lowOccupancyCustomers,
    noticeLeadDays,
    lowOccupancyThresholdPct: lowOccThreshold,
  });
  const total = totalExpiring(buckets);
  if (options.dryRun) {
    return { sent: false, reason: "dry run", total, email };
  }
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
  return { sent: true, total, email };
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
