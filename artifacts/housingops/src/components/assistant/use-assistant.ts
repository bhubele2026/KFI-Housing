import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomerScope } from "@/context/customer-scope";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}

export interface PendingProposal {
  id: string;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "failed" | "undone";
  error?: string;
  /** id of the created/updated/deleted record, when known. */
  resultId?: string | null;
  /** whether this proposal can still be reversed via /undo. */
  reversible?: boolean;
  createdAt?: string;
}

interface InternalState {
  messages: AssistantMessage[];
  conversationId: string | null;
  proposals: PendingProposal[];
  busy: boolean;
  error: string | null;
}

function apiBase(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return `${b}api/assistant`;
}

const STORAGE_KEY = "housingops:assistant:conversationId";

let msgCounter = 0;
function localId(prefix: string): string {
  msgCounter += 1;
  return `${prefix}-${Date.now()}-${msgCounter}`;
}

function loadStoredConversationId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeConversationId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Map the current wouter location to an { entityType, entityId } focus so
 * the assistant can resolve phrases like "this property" / "this lease"
 * without the operator having to paste an id. Order matters — the more
 * specific routes (e.g. /properties/:id/buildings/:buildingId) come
 * first.
 */
function parsePageFocus(
  loc: string,
): { entityType: string; entityId: string } | null {
  const path = loc.split("?")[0]!.replace(/\/$/, "");
  const patterns: Array<[RegExp, string]> = [
    [/^\/properties\/([^/]+)\/buildings\/([^/]+)$/, "building"],
    [/^\/properties\/([^/]+)$/, "property"],
    [/^\/customers\/([^/]+)$/, "customer"],
    [/^\/leases\/([^/]+)$/, "lease"],
    [/^\/occupants\/([^/]+)$/, "occupant"],
  ];
  for (const [re, entityType] of patterns) {
    const m = path.match(re);
    if (m) {
      // For nested building route we want the BUILDING id (m[2]); for the
      // others the first capture is the entity id.
      const entityId = entityType === "building" ? m[2]! : m[1]!;
      // Skip placeholder routes (/leases/new).
      if (entityId === "new") return null;
      return { entityType, entityId };
    }
  }
  return null;
}

export function useAssistant() {
  const [state, setState] = useState<InternalState>({
    messages: [],
    conversationId: loadStoredConversationId(),
    proposals: [],
    busy: false,
    error: null,
  });
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [location] = useLocation();
  const { customerId } = useCustomerScope();

  // Build the X-Assistant-Context header injected on every request so the
  // server-side system prompt knows what page the operator is looking at
  // and which customer scope is active. We parse the URL into a
  // structured { route, entityType, entityId } so the server can fetch a
  // one-line summary of the focused record and inject it — that's what
  // makes "rename this property" / "what leases expire here?" / "add a
  // bed to this room" work without the operator having to repeat ids.
  const contextHeader = useCallback((): string => {
    const focus = parsePageFocus(location);
    return JSON.stringify({
      customerId: customerId ?? "ALL",
      page: location,
      focus, // { entityType, entityId } | null
    });
  }, [customerId, location]);

  // Bootstrap: if we have a persisted conversationId, hydrate messages +
  // pending proposals from the server so the panel survives refresh.
  useEffect(() => {
    const cid = state.conversationId;
    if (!cid) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/conversations/${cid}`, {
          credentials: "include",
        });
        if (!r.ok) {
          // 404 → stale id; clear it so a fresh thread starts on next send.
          if (r.status === 404) {
            storeConversationId(null);
            setState((s) => ({ ...s, conversationId: null }));
          }
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        const msgs: AssistantMessage[] = ((data.messages ?? []) as any[])
          .filter((m) => typeof m.content === "string" && m.content.length > 0)
          .map((m) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            text: m.content,
          }));
        const proposals: PendingProposal[] = ((data.proposals ?? []) as any[]).map(
          (p) => ({
            id: p.id,
            tool: p.toolName ?? p.tool,
            summary: p.summary,
            // Server stores the proposed tool input inside payload.input;
            // older drafts wrote it as a top-level `input` field, accept
            // either shape so old conversations still hydrate.
            input: (p.payload?.input ?? p.input ?? {}) as Record<string, unknown>,
            status: p.status,
            error: typeof p.result?.error === "string" ? p.result.error : undefined,
            resultId: (p.payload?.resultId ?? null) as string | null,
            reversible: Boolean(p.payload?.undoPlan),
            createdAt: p.createdAt,
          }),
        );
        setState((s) => ({ ...s, messages: msgs, proposals }));
      } catch {
        /* offline / network — leave persisted id, will retry next mount */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentional: bootstrap once per persisted conversation id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    storeConversationId(null);
    setState({ messages: [], conversationId: null, proposals: [], busy: false, error: null });
  }, []);

  const invalidateData = useCallback(() => {
    // Refetch every list query so the rest of the app reflects the change.
    queryClient.invalidateQueries();
  }, [queryClient]);

  /** Stream an SSE response and dispatch events into local state. */
  const consumeStream = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      assistantMessageId: string,
    ): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-Assistant-Context": contextHeader(),
          },
          body: JSON.stringify(body),
          credentials: "include",
          signal: controller.signal,
        });
      } catch (err: any) {
        setState((s) => ({
          ...s,
          busy: false,
          error: err?.message ?? "Network error",
          messages: s.messages.map((m) =>
            m.id === assistantMessageId ? { ...m, pending: false } : m,
          ),
        }));
        return;
      }
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        setState((s) => ({
          ...s,
          busy: false,
          error: txt || `HTTP ${res.status}`,
          messages: s.messages.map((m) =>
            m.id === assistantMessageId ? { ...m, pending: false } : m,
          ),
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let needRefetch = false;

      const handle = (event: string, payload: any) => {
        if (event === "conversation") {
          storeConversationId(payload.id);
          setState((s) => ({ ...s, conversationId: payload.id }));
        } else if (event === "text") {
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMessageId ? { ...m, text: m.text + payload.delta } : m,
            ),
          }));
        } else if (event === "proposal") {
          setState((s) => ({
            ...s,
            proposals: [
              ...s.proposals,
              {
                id: payload.id,
                tool: payload.tool,
                summary: payload.summary,
                input: payload.input,
                status: "pending",
              },
            ],
          }));
        } else if (event === "proposal_resolved") {
          if (payload.status === "approved") needRefetch = true;
          setState((s) => ({
            ...s,
            proposals: s.proposals.map((p) =>
              p.id === payload.id
                ? {
                    ...p,
                    status: payload.status,
                    error: payload.error,
                    resultId:
                      typeof payload.resultId === "string"
                        ? payload.resultId
                        : p.resultId,
                    reversible:
                      typeof payload.reversible === "boolean"
                        ? payload.reversible
                        : p.reversible,
                  }
                : p,
            ),
          }));
        } else if (event === "tool_result") {
          // read tool — no-op for UI
        } else if (event === "tool_error") {
          setState((s) => ({ ...s, error: payload.message }));
        } else if (event === "error") {
          setState((s) => ({ ...s, error: payload.message }));
        } else if (event === "done") {
          setState((s) => ({
            ...s,
            busy: false,
            messages: s.messages.map((m) =>
              m.id === assistantMessageId ? { ...m, pending: false } : m,
            ),
          }));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!raw.trim()) continue;
          let event = "message";
          let data = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            handle(event, JSON.parse(data));
          } catch {
            /* ignore malformed */
          }
        }
      }
      // Stream closed without "done" event — flush.
      setState((s) => ({
        ...s,
        busy: false,
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, pending: false } : m,
        ),
      }));
      if (needRefetch) invalidateData();
    },
    [contextHeader, invalidateData],
  );

  const send = useCallback(
    async (text: string) => {
      const userMsg: AssistantMessage = { id: localId("u"), role: "user", text };
      const assistantMsg: AssistantMessage = {
        id: localId("a"),
        role: "assistant",
        text: "",
        pending: true,
      };
      setState((s) => ({
        ...s,
        busy: true,
        error: null,
        messages: [...s.messages, userMsg, assistantMsg],
      }));
      await consumeStream(
        `${apiBase()}/chat`,
        { message: text, conversationId: state.conversationId },
        assistantMsg.id,
      );
    },
    [consumeStream, state.conversationId],
  );

  const respondToProposal = useCallback(
    async (proposalId: string, approve: boolean) => {
      const assistantMsg: AssistantMessage = {
        id: localId("a"),
        role: "assistant",
        text: "",
        pending: true,
      };
      setState((s) => ({
        ...s,
        busy: true,
        error: null,
        messages: [...s.messages, assistantMsg],
      }));
      await consumeStream(
        `${apiBase()}/confirm`,
        { proposalId, approve },
        assistantMsg.id,
      );
    },
    [consumeStream],
  );

  const undoProposal = useCallback(
    async (proposalId: string) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        const r = await fetch(`${apiBase()}/proposals/${proposalId}/undo`, {
          method: "POST",
          headers: { "X-Assistant-Context": contextHeader() },
          credentials: "include",
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setState((s) => ({
            ...s,
            busy: false,
            error: body?.error ?? `Undo failed (HTTP ${r.status})`,
          }));
          return;
        }
        setState((s) => ({
          ...s,
          busy: false,
          proposals: s.proposals.map((p) =>
            p.id === proposalId
              ? { ...p, status: "undone", reversible: false }
              : p,
          ),
        }));
        invalidateData();
      } catch (err: any) {
        setState((s) => ({
          ...s,
          busy: false,
          error: err?.message ?? "Undo failed",
        }));
      }
    },
    [contextHeader, invalidateData],
  );

  return {
    ...state,
    send,
    respondToProposal,
    undoProposal,
    reset,
  };
}
