import { useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { parsePageFocus } from "./use-assistant";

export interface AssistantNudge {
  id: string;
  ruleKey: string;
  source: "event" | "page" | "scanner";
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaPrompt: string | null;
  pagePattern: string | null;
  anchorType: string | null;
  anchorId: string | null;
  customerId: string | null;
  relatedProposalId: string | null;
  createdAt: string | Date;
  snoozedUntil: string | Date | null;
  /** Only present on computed (not-yet-materialised) nudges. */
  computed?: boolean;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

const NUDGES_QUERY_KEY = ["assistant-nudges"] as const;

/**
 * Fetch the operator's active nudges (Task #671 Phase 2). Kept always
 * enabled so the closed-bubble badge can display a count without
 * requiring the panel to be open. The query key includes
 * (location, customerId, focus) so nudges automatically resort when
 * the operator navigates or changes scope — the server filters by
 * page pattern / focus customer, so the cache must vary along the
 * same dimensions.
 */
export function useAssistantNudges() {
  const [location] = useLocation();
  const { customerId } = useCustomerScope();
  const scope = customerId === ALL_CUSTOMERS ? "ALL" : customerId;
  const focus = parsePageFocus(location);
  const buildHeader = useCallback(
    () =>
      JSON.stringify({ customerId: scope, page: location, focus }),
    [scope, location, focus],
  );
  return useQuery<{ nudges: AssistantNudge[] }>({
    queryKey: [
      ...NUDGES_QUERY_KEY,
      location,
      scope,
      focus?.entityType ?? null,
      focus?.entityId ?? null,
    ],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      return customFetch<{ nudges: AssistantNudge[] }>(
        `${apiBase()}/nudges`,
        {
          method: "GET",
          headers: { "X-Assistant-Context": buildHeader() },
          credentials: "include",
          signal,
        },
      );
    },
  });
}

/** Invalidate every variant of the nudges query (any location / scope). */
export function useInvalidateAssistantNudges(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: NUDGES_QUERY_KEY });
  }, [qc]);
}

function computedBody(n: AssistantNudge) {
  if (!n.computed) return undefined;
  // Computed nudges round-trip their full payload so the server can
  // materialise the row at dismiss/snooze time using the same
  // ruleKey/title/body the client just rendered.
  return {
    computed: {
      ruleKey: n.ruleKey,
      source: n.source,
      severity: n.severity,
      title: n.title,
      body: n.body,
      ctaLabel: n.ctaLabel,
      ctaPrompt: n.ctaPrompt,
      pagePattern: n.pagePattern,
      anchorType: n.anchorType,
      anchorId: n.anchorId,
      customerId: n.customerId,
    },
  };
}

export function useDismissNudge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: AssistantNudge) => {
      return customFetch(`${apiBase()}/nudges/${encodeURIComponent(n.id)}/dismiss`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(computedBody(n) ?? {}),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NUDGES_QUERY_KEY });
    },
  });
}

export type SnoozePreset = "1d" | "3d" | "1w";

export function useSnoozeNudge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      nudge: AssistantNudge;
      until: SnoozePreset | string;
    }) => {
      return customFetch(
        `${apiBase()}/nudges/${encodeURIComponent(args.nudge.id)}/snooze`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            until: args.until,
            ...(computedBody(args.nudge) ?? {}),
          }),
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NUDGES_QUERY_KEY });
    },
  });
}

/**
 * Fire-and-forget telemetry call when the operator taps a nudge CTA.
 * Server-side this is logged as `assistant_nudge.cta_tap`. The
 * subsequent dismiss mutation handles removing the card; this hook
 * only records the action.
 */
export function useNudgeCtaTap() {
  return useMutation({
    mutationFn: async (nudge: AssistantNudge) => {
      return customFetch(`${apiBase()}/nudges/${encodeURIComponent(nudge.id)}/cta`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleKey: nudge.ruleKey,
          ctaPrompt: nudge.ctaPrompt,
        }),
      });
    },
  });
}
