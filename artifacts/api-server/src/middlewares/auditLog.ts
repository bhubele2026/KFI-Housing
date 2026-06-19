import type { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import type { AuthedRequest } from "./requireAuth";

// Paths we never want in the audit log: the audit log's own endpoints (would
// be self-referential noise) and the health/config probes.
const SKIP_PREFIXES = ["/activity", "/healthz", "/config", "/__clerk"];

function shouldSkipPath(path: string): boolean {
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function makeId(): string {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function verbForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case "POST":
      return "Created";
    case "PUT":
    case "PATCH":
      return "Updated";
    case "DELETE":
      return "Deleted";
    case "GET":
      return "Viewed";
    default:
      return method.toUpperCase();
  }
}

// Turn a request into a short human-readable action like "Updated leases" or
// "Viewed dashboard" using the first path segment as the resource name.
function humanizeAction(method: string, path: string): string {
  const segment = path.split("/").filter(Boolean)[0] ?? "app";
  const resource = segment.replace(/-/g, " ");
  return `${verbForMethod(method)} ${resource}`;
}

/**
 * Records an audit-log entry for authenticated requests. Mount AFTER
 * `requireAuth` (so `req.appUser` is populated) and BEFORE the router.
 *
 * - Only mutating requests (POST/PUT/PATCH/DELETE) are recorded — the log is
 *   a history of what CHANGED, not every page a user opened. (Read activity
 *   is still reflected in each user's `last_seen_at` for the "who's active"
 *   summary, so nothing is lost by not logging GETs here.)
 * - Only successful responses (status < 400) are recorded.
 * - Writes are fire-and-forget so the audit log can never slow down or
 *   fail a real request.
 */
export function auditLog(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const user = req.appUser;
  // No identified user (public paths) — nothing to attribute, skip.
  if (!user) {
    next();
    return;
  }

  const method = req.method.toUpperCase();
  const path = req.path;

  if (shouldSkipPath(path)) {
    next();
    return;
  }

  const isMutation =
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE";

  // Reads are never recorded — only changes belong in the activity log.
  if (!isMutation) {
    next();
    return;
  }

  // Record only once the response completes successfully so we don't log
  // requests that were rejected (validation errors, 404s, etc.).
  _res.on("finish", () => {
    if (_res.statusCode >= 400) return;
    void db
      .insert(activityLogTable)
      .values({
        id: makeId(),
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        method,
        path,
        action: humanizeAction(method, path),
      })
      .catch((err) => logger.warn({ err }, "activity log insert failed"));
  });

  next();
}
