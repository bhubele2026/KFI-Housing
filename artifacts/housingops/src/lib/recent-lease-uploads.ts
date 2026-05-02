// In-memory store for the user's recent lease-PDF upload attempts in this
// browser session. Survives the Upload dialog being closed/reopened (the
// dialog itself resets all of its draft state on close), but does NOT
// persist across page reloads — that's intentional, since failed uploads
// hold on to the original `File` object so the user can retry without
// re-picking, and `File` objects can't be serialised.

import { useSyncExternalStore } from "react";

export type LeaseUploadStatus = "parsed" | "failed";

export interface RecentLeaseUpload {
  id: string;
  fileName: string;
  status: LeaseUploadStatus;
  /** When status === "failed", the user-friendly message we showed in the toast. */
  errorMessage?: string;
  /** Original picked File, kept ONLY for failed uploads so Retry works without re-picking. */
  file?: File;
  /** Epoch ms — used purely for display ordering and the relative timestamp. */
  timestamp: number;
}

const MAX_ENTRIES = 5;

let uploads: RecentLeaseUpload[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Push a new entry to the front of the list, capped at MAX_ENTRIES. */
export function recordLeaseUpload(upload: RecentLeaseUpload): void {
  uploads = [upload, ...uploads].slice(0, MAX_ENTRIES);
  emit();
}

/** Remove a single entry by id (used when retrying so we don't show stale failures). */
export function clearLeaseUpload(id: string): void {
  const next = uploads.filter((u) => u.id !== id);
  if (next.length !== uploads.length) {
    uploads = next;
    emit();
  }
}

/** Test helper — wipes the store. Not exported through any UI surface. */
export function __resetRecentLeaseUploadsForTests(): void {
  uploads = [];
  emit();
}

/** Test helper — returns the current list snapshot without going through React. */
export function __getRecentLeaseUploadsForTests(): RecentLeaseUpload[] {
  return uploads;
}

/**
 * React hook returning the current list of recent uploads, newest first.
 * Components re-render when the list changes.
 */
export function useRecentLeaseUploads(): RecentLeaseUpload[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => uploads,
    () => uploads,
  );
}
