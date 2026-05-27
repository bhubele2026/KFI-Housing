import { useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { parsePageFocus } from "./use-assistant";

export interface PageChip {
  label: string;
  prompt: string;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

/**
 * Fetch the 2-4 tappable suggestion chips for the current page (Task
 * #670). Kept separate from `useAssistant` so chat state and chip state
 * don't intermix. The query key is `(location, customerId)` so chips
 * automatically swap when the operator navigates or changes scope. We
 * disable the query when the bubble is closed so we don't fetch in
 * the background for nothing.
 */
export function useAssistantChips(opts: { enabled: boolean }) {
  const [location] = useLocation();
  const { customerId } = useCustomerScope();
  const scope = customerId === ALL_CUSTOMERS ? "ALL" : customerId;

  // The server reads the same X-Assistant-Context header /chat uses,
  // so we build it the same way here — crucially including the parsed
  // page focus so detail routes like /properties/:id, /leases/:id, and
  // /occupants/:id get their focus-specific chips.
  const focus = parsePageFocus(location);
  const buildHeader = useCallback((): string => {
    return JSON.stringify({ customerId: scope, page: location, focus });
  }, [scope, location, focus]);

  return useQuery<{ chips: PageChip[] }>({
    queryKey: [
      "assistant-page-chips",
      location,
      scope,
      focus?.entityType ?? null,
      focus?.entityId ?? null,
    ],
    enabled: opts.enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      return customFetch<{ chips: PageChip[] }>(`${apiBase()}/page-chips`, {
        method: "GET",
        headers: { "X-Assistant-Context": buildHeader() },
        credentials: "include",
        signal,
      });
    },
  });
}
