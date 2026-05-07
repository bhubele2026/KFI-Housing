import { Router, type IRouter } from "express";
import { db, leasesTable, propertiesTable } from "@workspace/db";
import { sendWeeklyLeaseDigest } from "../lib/weekly-lease-digest";
import { readDigestConfig } from "../lib/lease-digest-scheduler";
import { timingSafeEqual } from "crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isDigestPreviewEnabled(): boolean {
  return (process.env.LEASE_DIGEST_PREVIEW_ENABLED ?? "").trim().toLowerCase() === "true";
}

function isDigestConfigured(): boolean {
  const config = readDigestConfig(process.env);
  return Boolean(config.webhookUrl) && config.recipients.length > 0;
}

function getPreviewSecret(): string {
  return (process.env.LEASE_DIGEST_PREVIEW_SECRET ?? "").trim();
}

function verifySecret(provided: string): boolean {
  const expected = getPreviewSecret();
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

router.get("/lease-digest/status", (_req, res): void => {
  const enabled = isDigestPreviewEnabled() && isDigestConfigured() && getPreviewSecret().length > 0;
  res.json({ previewEnabled: enabled });
});

router.post("/lease-digest/preview", async (req, res): Promise<void> => {
  if (!isDigestPreviewEnabled()) {
    res.status(403).json({
      error:
        "Digest preview is disabled. Set LEASE_DIGEST_PREVIEW_ENABLED=true to allow on-demand previews.",
    });
    return;
  }

  const secret = typeof req.body?.secret === "string" ? req.body.secret : "";
  if (!verifySecret(secret)) {
    res.status(403).json({
      error: "Invalid admin secret. Provide the correct LEASE_DIGEST_PREVIEW_SECRET to send previews.",
    });
    return;
  }

  const config = readDigestConfig(process.env);
  const dryRun = req.body?.dryRun === true;

  // The webhook URL is only required when we plan to POST. A dry-run
  // caller just wants the rendered payload back so they can inspect
  // subject/body/recipients before actually dispatching the digest.
  if (!dryRun && !config.webhookUrl) {
    res.status(422).json({
      error:
        "LEASE_DIGEST_WEBHOOK_URL is not configured — cannot send a preview.",
    });
    return;
  }
  if (config.recipients.length === 0) {
    res.status(422).json({
      error:
        "LEASE_DIGEST_RECIPIENTS is not configured — no one to send the preview to.",
    });
    return;
  }

  try {
    const result = await sendWeeklyLeaseDigest(
      {
        webhookUrl: config.webhookUrl,
        recipients: config.recipients,
        appBaseUrl: config.appBaseUrl,
      },
      {
        fetch: globalThis.fetch,
        loadLeases: async () => {
          const rows = await db.select().from(leasesTable);
          return rows.map((r) => ({
            id: r.id,
            propertyId: r.propertyId,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
            vendor: r.vendor,
          }));
        },
        loadProperties: async () => {
          const rows = await db.select().from(propertiesTable);
          return rows.map((r) => ({ id: r.id, name: r.name }));
        },
        now: () => new Date(),
      },
      { dryRun },
    );

    res.json({
      sent: result.sent,
      dryRun,
      total: result.total ?? 0,
      recipients: config.recipients.length,
      // On a dry-run the email payload is the whole point of the
      // request — surface it so the dashboard can render it for the
      // operator. On a real send we still echo it back for parity so
      // the UI can show what was actually dispatched.
      email: result.email,
    });
  } catch (err) {
    logger.error({ err }, "Lease digest preview failed");
    res.status(502).json({
      error:
        err instanceof Error
          ? err.message
          : "Unexpected error sending digest preview",
    });
  }
});

export default router;
