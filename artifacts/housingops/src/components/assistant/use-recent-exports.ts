import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

/**
 * One row in the "Recent exports" tray (Task #683). Mirrors the
 * payload shape of `GET /api/assistant/exports` — the server filters
 * expired rows out and orders newest-first, so the client just renders.
 */
export interface RecentExport {
  id: string;
  filename: string;
  format: string;
  rowCount: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  downloadUrl: string;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

/**
 * Fetch the current operator's non-expired assistant exports. Used by
 * the assistant panel to surface a small "Recent exports" affordance
 * so a refresh / scroll-away never loses the download chip while the
 * file is still live on the server (Task #683). The query is opt-in
 * via `enabled` so we don't poll the endpoint while the bubble or
 * tray is closed.
 */
export function useRecentExports(opts: { enabled: boolean }) {
  return useQuery<{ exports: RecentExport[] }>({
    queryKey: ["assistant-recent-exports"],
    enabled: opts.enabled,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      return customFetch<{ exports: RecentExport[] }>(`${apiBase()}/exports`, {
        method: "GET",
        credentials: "include",
        signal,
      });
    },
  });
}
