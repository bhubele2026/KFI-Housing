import { Router, type IRouter } from "express";
import { db, leasesTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * "Find new leases" — scans the SharePoint master lease folder
 * (KFISImplementation / Housing Master File and Leases / Leases) for lease
 * documents, flags which aren't represented in the app yet, and returns lease
 * expiry stats. Read-only.
 *
 * Needs a Microsoft Graph app registration (client-credentials). Set these
 * api-server secrets:
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 * The drive + folder are defaulted to the discovered "Housing Master File and
 * Leases / Leases" location; override with SHAREPOINT_LEASES_DRIVE_ID /
 * SHAREPOINT_LEASES_FOLDER_ID if it ever moves.
 *
 * Until the Graph secrets are set, the endpoint returns
 * { configured: false } so the UI can show a friendly setup message instead
 * of failing.
 */

const router: IRouter = Router();

const DEFAULT_DRIVE_ID =
  "b!D_coNqVzXUW1_0SPJYIgPdH8Rd0kUthHmNa_QbgVRxKUzZMtdHG3TIvxOoJwD3JY";
const DEFAULT_FOLDER_ID = "01R4TRPREVL5N47KVG7NCLIRNYQ46P6TQ3";

const trim = (v: string | undefined): string => (v ?? "").trim();

function graphConfig() {
  const tenant = trim(process.env.GRAPH_TENANT_ID);
  const clientId = trim(process.env.GRAPH_CLIENT_ID);
  const clientSecret = trim(process.env.GRAPH_CLIENT_SECRET);
  const driveId = trim(process.env.SHAREPOINT_LEASES_DRIVE_ID) || DEFAULT_DRIVE_ID;
  const folderId =
    trim(process.env.SHAREPOINT_LEASES_FOLDER_ID) || DEFAULT_FOLDER_ID;
  const configured = Boolean(tenant && clientId && clientSecret);
  return { tenant, clientId, clientSecret, driveId, folderId, configured };
}

async function getGraphToken(
  tenant: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Graph token response had no access_token");
  return json.access_token;
}

interface DriveChild {
  name?: string;
  folder?: unknown;
  file?: unknown;
  lastModifiedDateTime?: string;
}

async function listChildren(
  token: string,
  driveId: string,
  itemId: string,
): Promise<DriveChild[]> {
  const out: DriveChild[] = [];
  let url:
    | string
    | undefined = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,folder,file,lastModifiedDateTime`;
  let guard = 0;
  while (url && guard < 10) {
    guard += 1;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph children request failed (${res.status})`);
    const json = (await res.json()) as { value?: DriveChild[]; "@odata.nextLink"?: string };
    if (Array.isArray(json.value)) out.push(...json.value);
    url = json["@odata.nextLink"];
  }
  return out;
}

const isLeaseDoc = (name: string): boolean =>
  /\.(pdf|docx)$/i.test(name) &&
  /(lease|agreement|executed|rental)/i.test(name);

const baseName = (name: string): string =>
  name.replace(/\.[^.]+$/, "").toLowerCase();

router.post("/leases/scan-sharepoint", async (_req, res): Promise<void> => {
  const cfg = graphConfig();

  // Expiry stats come from data already in the app — works regardless of Graph.
  const expiry = { active: 0, expired: 0, upcoming: 0, total: 0 };
  try {
    const rows = await db.select({ status: leasesTable.status }).from(leasesTable);
    for (const r of rows) {
      expiry.total += 1;
      const s = (r.status ?? "").toLowerCase();
      if (s === "expired") expiry.expired += 1;
      else if (s === "upcoming") expiry.upcoming += 1;
      else expiry.active += 1;
    }
  } catch (err) {
    logger.warn({ err }, "scan-sharepoint: failed to read lease expiry stats");
  }

  if (!cfg.configured) {
    res.json({
      configured: false,
      message:
        "Microsoft Graph isn't connected yet. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET on the API server, then run this again.",
      expiry,
    });
    return;
  }

  try {
    const token = await getGraphToken(cfg.tenant, cfg.clientId, cfg.clientSecret);

    // Existing lease text (notes + clauses + source) to detect what's new.
    const leaseRows = await db
      .select({ notes: leasesTable.notes, clauses: leasesTable.clauses })
      .from(leasesTable);
    const knownText = leaseRows
      .map((l) => `${l.notes ?? ""} ${l.clauses ?? ""}`.toLowerCase())
      .join("\n");

    // Top level = per-property folders; recurse one level for lease docs.
    const top = await listChildren(token, cfg.driveId, cfg.folderId);
    const folders = top.filter((c) => c.folder);
    const files: {
      folder: string;
      file: string;
      lastModified: string;
      isNew: boolean;
    }[] = [];

    for (const f of folders) {
      const folderName = f.name ?? "";
      let kids: DriveChild[] = [];
      try {
        // Re-list by path under the parent so we don't need each child's id.
        const enc = encodeURIComponent(folderName);
        const url = `https://graph.microsoft.com/v1.0/drives/${cfg.driveId}/items/${cfg.folderId}:/${enc}:/children?$top=200&$select=name,file,lastModifiedDateTime`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const j = (await r.json()) as { value?: DriveChild[] };
          kids = j.value ?? [];
        }
      } catch {
        /* skip a folder we can't read */
      }
      for (const k of kids) {
        const name = k.name ?? "";
        if (!k.file || !isLeaseDoc(name)) continue;
        const isNew = !knownText.includes(baseName(name));
        files.push({
          folder: folderName,
          file: name,
          lastModified: k.lastModifiedDateTime ?? "",
          isNew,
        });
      }
    }

    files.sort((a, b) => (a.isNew === b.isNew ? 0 : a.isNew ? -1 : 1));
    res.json({
      configured: true,
      scannedFolders: folders.length,
      leaseDocsFound: files.length,
      newCount: files.filter((f) => f.isNew).length,
      files,
      expiry,
      note:
        "New = a lease document in SharePoint not yet referenced by any lease in the app. Import new ones via Upload lease PDF, or wire auto-create next.",
    });
  } catch (err) {
    logger.error({ err }, "scan-sharepoint failed");
    res.status(502).json({
      configured: true,
      error:
        "Couldn't reach SharePoint via Microsoft Graph. Check the GRAPH_* secrets and that the app has Sites.Read.All / Files.Read.All.",
      expiry,
    });
  }
});

export default router;
