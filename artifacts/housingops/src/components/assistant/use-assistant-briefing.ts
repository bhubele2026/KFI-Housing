import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

/**
 * Daily briefing (Task #671 Phase 6) — the proactive "what needs you
 * today" summary the dock shows on first open, ranked by dollars at
 * risk. Numbers are computed server-side (GET /assistant/briefing) so
 * the dock card and the assistant's narration cite the same figures.
 */
export interface BriefingItem {
  key: string;
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  dollars: number;
  ctaPrompt: string;
}

export interface DailyBriefing {
  periodMonth: string;
  totalAtRisk: number;
  items: BriefingItem[];
  headline: string;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

/**
 * Fetch the briefing. Enabled only while the dock is open (we don't poll
 * it in the background — the closed-dock badge already shows the nudge
 * count). Cached 5 min so reopening the dock is instant.
 */
export function useAssistantBriefing(opts: { enabled: boolean }) {
  return useQuery<DailyBriefing>({
    queryKey: ["assistant-briefing"],
    enabled: opts.enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      return customFetch<DailyBriefing>(`${apiBase()}/briefing`, {
        method: "GET",
        credentials: "include",
        signal,
      });
    },
  });
}
