import { todayIso } from "./lease-status";
import { parseRecipients } from "./weekly-lease-digest";

export interface ReminderLease {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  status: string;
  monthlyRoomNightMin: number;
  vendor?: string;
}

export interface ReminderProperty {
  id: string;
  name: string;
}

export interface ReminderLog {
  leaseId: string;
  month: string;
}

export interface ReminderEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface RoomNightReminderDeps {
  fetch: typeof fetch;
  loadLeases: () => Promise<ReminderLease[]>;
  loadProperties: () => Promise<ReminderProperty[]>;
  loadRoomNightLogs: () => Promise<ReminderLog[]>;
  now: () => Date;
}

export interface RoomNightReminderConfig {
  webhookUrl: string;
  recipients: string[];
  appBaseUrl: string;
}

export interface SendReminderResult {
  sent: boolean;
  reason?: string;
  count?: number;
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isFirstBusinessDayOfMonth(d: Date): boolean {
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  if (day === 1) return dow >= 1 && dow <= 5;
  if (day === 2) return dow === 1;
  if (day === 3) return dow === 1;
  return false;
}

export function getLeasesMissingMonthLog(
  leases: readonly ReminderLease[],
  logs: readonly ReminderLog[],
  month: string,
): ReminderLease[] {
  const loggedLeaseIds = new Set(
    logs.filter((l) => l.month === month).map((l) => l.leaseId),
  );
  return leases.filter((lease) => {
    const monthlyMin = lease.monthlyRoomNightMin ?? 0;
    if (monthlyMin <= 0) return false;
    if (lease.status !== "Active" && lease.status !== "Upcoming") return false;
    return !loggedLeaseIds.has(lease.id);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRoomNightReminderEmail(input: {
  recipients: readonly string[];
  leases: readonly ReminderLease[];
  properties: readonly ReminderProperty[];
  appBaseUrl: string;
  month: string;
}): ReminderEmail {
  const { recipients, leases, properties, appBaseUrl, month } = input;
  const count = leases.length;
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const trimmedBase = appBaseUrl.replace(/\/$/, "");
  const actionUrl = `${trimmedBase}/leases?atRisk=1`;

  const subject =
    count === 0
      ? `KFI Staffing room-night reminder (${month}) — all logs recorded`
      : `KFI Staffing room-night reminder (${month}) — ${count} hotel-rate lease${count === 1 ? "" : "s"} missing a room-night log`;

  const textLines: string[] = [
    `Room-night log reminder for ${month}.`,
    "",
  ];
  const htmlParts: string[] = [
    `<p>Room-night log reminder for <strong>${escapeHtml(month)}</strong>.</p>`,
  ];

  if (count === 0) {
    textLines.push("All hotel-rate leases have a room-night log recorded for this month. No action needed.");
    htmlParts.push("<p>All hotel-rate leases have a room-night log recorded for this month. No action needed.</p>");
  } else {
    textLines.push(
      `${count} hotel-rate lease${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing a room-night log for this month.`,
      `Log them now to avoid voiding your negotiated rate.`,
      "",
    );
    htmlParts.push(
      `<p>${count} hotel-rate lease${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} missing a room-night log for this month. Log them now to avoid voiding your negotiated rate.</p>`,
      "<ul>",
    );

    for (const lease of leases) {
      const name = propertyName.get(lease.propertyId) ?? "—";
      const vendor = lease.vendor ? ` (${lease.vendor})` : "";
      textLines.push(`- ${name}${vendor} — min ${lease.monthlyRoomNightMin} nights/month`);
      htmlParts.push(
        `<li>${escapeHtml(name)}${escapeHtml(vendor)} — min ${lease.monthlyRoomNightMin} nights/month</li>`,
      );
    }

    htmlParts.push("</ul>");
    textLines.push("");
    textLines.push(`Review and log room-nights: ${actionUrl}`);
    htmlParts.push(
      `<p><a href="${escapeHtml(actionUrl)}">Review and log room-nights →</a></p>`,
    );
  }

  return {
    to: [...recipients],
    subject,
    text: textLines.join("\n"),
    html: htmlParts.join("\n"),
  };
}

export { parseRecipients };

export async function sendRoomNightReminder(
  config: RoomNightReminderConfig,
  deps: RoomNightReminderDeps,
): Promise<SendReminderResult> {
  if (config.recipients.length === 0) {
    return { sent: false, reason: "no recipients configured" };
  }
  if (!config.webhookUrl) {
    return { sent: false, reason: "no webhook URL configured" };
  }
  const now = deps.now();
  const month = currentMonthKey(now);
  const [leases, properties, logs] = await Promise.all([
    deps.loadLeases(),
    deps.loadProperties(),
    deps.loadRoomNightLogs(),
  ]);
  const missing = getLeasesMissingMonthLog(leases, logs, month);
  if (missing.length === 0) {
    return { sent: false, reason: "no hotel-rate leases missing a log this month" };
  }
  const email = buildRoomNightReminderEmail({
    recipients: config.recipients,
    leases: missing,
    properties,
    appBaseUrl: config.appBaseUrl,
    month,
  });
  const response = await deps.fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email),
  });
  if (!response.ok) {
    throw new Error(
      `Room-night reminder webhook responded with HTTP ${response.status}`,
    );
  }
  return { sent: true, count: missing.length };
}
