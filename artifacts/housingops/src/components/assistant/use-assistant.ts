import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getListBedsQueryKey,
  getListBuildingsQueryKey,
  getListCustomersQueryKey,
  getListInsuranceCertificatesQueryKey,
  getListLeasesQueryKey,
  getListOccupantsQueryKey,
  getListPayrollDeductionsQueryKey,
  getListPropertiesQueryKey,
  getListProjectedMoveInsQueryKey,
  getListPropertyViolationsQueryKey,
  getListRoomNightLogsQueryKey,
  getListRoomsQueryKey,
  getListUtilitiesQueryKey,
} from "@workspace/api-client-react";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useData } from "@/context/data-store";

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
  /** "What will change" preview computed server-side (Task #647). */
  preview?: unknown;
  /** Set when the preview helper itself threw. */
  previewError?: string | null;
}

export interface AssistantAttachment {
  uploadId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
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
 *
 * Supported URL patterns (kept in sync with the server-side
 * FocusEntityType union in api-server/src/routes/assistant/tools.ts):
 *   /properties/:id/buildings/:buildingId  → building
 *   /properties/:id                        → property
 *   /customers/:id                         → customer
 *   /leases/:id                            → lease
 *   /occupants/:id                         → occupant
 *   /rooms/:id                             → room
 *   /beds/:id                              → bed
 *   /utilities/:id                         → utility
 *   /insurance/:id                         → insurance
 *   /payroll/:id                           → payroll
 * Placeholder ids ("new") are skipped so create routes don't emit a
 * bogus focus header.
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
    [/^\/rooms\/([^/]+)$/, "room"],
    [/^\/beds\/([^/]+)$/, "bed"],
    [/^\/utilities\/([^/]+)$/, "utility"],
    [/^\/insurance\/([^/]+)$/, "insurance"],
    [/^\/payroll\/([^/]+)$/, "payroll"],
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

/**
 * Resolve a parsed page-focus entity to the customer that owns it, using
 * the same scope-resolver chain the server's `customerIdForFocus` uses
 * but powered by the React Query cache we already have in memory. Used to
 * surface the implicit page-focus scope as a badge in the chat header.
 */
function resolveFocusCustomerId(
  focus: { entityType: string; entityId: string } | null,
  data: ReturnType<typeof useData>,
  queryClient: QueryClient,
): string | null {
  if (!focus) return null;
  const customerIdViaProperty = (propertyId: string | undefined | null) =>
    propertyId
      ? data.properties.find((p) => p.id === propertyId)?.customerId ?? null
      : null;
  switch (focus.entityType) {
    case "customer":
      return data.customers.find((c) => c.id === focus.entityId)?.id ?? null;
    case "property":
      return (
        data.properties.find((p) => p.id === focus.entityId)?.customerId ?? null
      );
    case "building": {
      const b = data.buildings.find((x) => x.id === focus.entityId);
      if (!b) return null;
      return customerIdViaProperty(b.propertyId);
    }
    case "lease": {
      const l = data.leases.find((x) => x.id === focus.entityId);
      if (!l) return null;
      // A lease can override its owning customer; fall back to the parent
      // property's customer the way LEASE_RESPONSIBLE_CUSTOMER does on the
      // server.
      if (l.customerId) return l.customerId;
      return customerIdViaProperty(l.propertyId);
    }
    case "occupant": {
      const o = data.occupants.find((x) => x.id === focus.entityId);
      if (!o) return null;
      return customerIdViaProperty(o.propertyId);
    }
    case "room": {
      const r = data.rooms.find((x) => x.id === focus.entityId);
      if (!r) return null;
      return customerIdViaProperty(r.propertyId);
    }
    case "bed": {
      const b = data.beds.find((x) => x.id === focus.entityId);
      if (!b) return null;
      return customerIdViaProperty(b.propertyId);
    }
    case "utility": {
      const u = data.utilities.find((x) => x.id === focus.entityId);
      if (!u) return null;
      return customerIdViaProperty(u.propertyId);
    }
    case "insurance": {
      const c = data.insuranceCertificates.find((x) => x.id === focus.entityId);
      if (!c) return null;
      return customerIdViaProperty(c.propertyId);
    }
    case "payroll": {
      // Payroll deductions aren't held in the data-store snapshot, so we
      // read whatever the React Query cache already has from existing
      // payroll list calls (e.g. the dashboard / occupants page). If
      // nothing has been fetched yet we fall back to null and the badge
      // simply doesn't render — the server-side resolver will still
      // enforce the scope on the actual request.
      const caches = queryClient.getQueriesData<unknown>({
        queryKey: getListPayrollDeductionsQueryKey().slice(0, 1),
      });
      for (const [, rows] of caches) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows as Array<{
          id?: string;
          customerId?: string | null;
          propertyId?: string | null;
        }>) {
          if (row?.id === focus.entityId) {
            return row.customerId || customerIdViaProperty(row.propertyId);
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
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
  const data = useData();

  // Surface the implicit page-focus customer for the chat header badge.
  // Only meaningful when the global dropdown is "All" — when the operator
  // has explicitly picked a customer, the existing dropdown indicator
  // already communicates the scope and we don't want a second badge.
  const pageFocusCustomer = useMemo<{ id: string; name: string } | null>(() => {
    if (customerId !== ALL_CUSTOMERS) return null;
    const focus = parsePageFocus(location);
    const cid = resolveFocusCustomerId(focus, data, queryClient);
    if (!cid) return null;
    const c = data.customers.find((x) => x.id === cid);
    if (!c) return null;
    return { id: c.id, name: c.name || c.id };
  }, [customerId, location, data, queryClient]);

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
      customerId: customerId === ALL_CUSTOMERS ? "ALL" : customerId,
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
            preview: p.payload?.preview,
            previewError: p.payload?.previewError ?? null,
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
    const prior = state.conversationId;
    storeConversationId(null);
    setState({ messages: [], conversationId: null, proposals: [], busy: false, error: null });
    // Best-effort: tell the server to auto-cancel any pending
    // proposals on the abandoned conversation so re-hydrating it
    // later won't trip Anthropic's "tool_use without tool_result"
    // 400. Failures are ignored — the runLoop healer is the real
    // safety net.
    if (prior) {
      fetch(`${apiBase()}/conversations/${prior}/pending`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    }
  }, [state.conversationId]);

  // Map each write tool to the list query keys whose cached results it
  // could have changed (Task #668). Invalidating only the affected keys
  // keeps the rest of the app from refetching everything on every
  // proposal, which used to thrash the dashboard. Tools not listed —
  // and any tool we don't recognise — fall back to a full invalidation
  // so we never silently leave stale data on screen.
  const invalidateData = useCallback(
    (toolName?: string | null) => {
      const map: Record<string, Array<() => readonly unknown[]>> = {
        // Properties
        create_property: [getListPropertiesQueryKey],
        update_property: [getListPropertiesQueryKey],
        delete_property: [
          getListPropertiesQueryKey,
          getListBuildingsQueryKey,
          getListRoomsQueryKey,
          getListBedsQueryKey,
          getListOccupantsQueryKey,
          getListLeasesQueryKey,
          getListUtilitiesQueryKey,
          getListInsuranceCertificatesQueryKey,
        ],
        // Buildings
        create_building: [getListBuildingsQueryKey],
        update_building: [getListBuildingsQueryKey],
        delete_building: [getListBuildingsQueryKey, getListRoomsQueryKey],
        // Rooms
        create_room: [getListRoomsQueryKey],
        update_room: [getListRoomsQueryKey],
        delete_room: [getListRoomsQueryKey, getListBedsQueryKey],
        // Beds
        create_bed: [getListBedsQueryKey],
        update_bed: [getListBedsQueryKey, getListOccupantsQueryKey],
        delete_bed: [getListBedsQueryKey, getListOccupantsQueryKey],
        bulk_create_beds: [getListBedsQueryKey],
        bulk_update_beds: [getListBedsQueryKey, getListOccupantsQueryKey],
        // Occupants
        create_occupant: [getListOccupantsQueryKey, getListBedsQueryKey],
        update_occupant: [getListOccupantsQueryKey],
        delete_occupant: [getListOccupantsQueryKey, getListBedsQueryKey],
        assign_occupant_to_bed: [getListOccupantsQueryKey, getListBedsQueryKey],
        move_occupant_to_bed: [getListOccupantsQueryKey, getListBedsQueryKey],
        unassign_occupant: [getListOccupantsQueryKey, getListBedsQueryKey],
        bulk_create_occupants: [getListOccupantsQueryKey, getListBedsQueryKey],
        // Leases
        create_lease: [getListLeasesQueryKey],
        update_lease: [getListLeasesQueryKey],
        delete_lease: [getListLeasesQueryKey],
        bulk_update_leases: [getListLeasesQueryKey],
        // Utilities
        create_utility: [getListUtilitiesQueryKey],
        update_utility: [getListUtilitiesQueryKey],
        delete_utility: [getListUtilitiesQueryKey],
        bulk_create_utilities: [getListUtilitiesQueryKey],
        // Insurance
        create_insurance_certificate: [getListInsuranceCertificatesQueryKey],
        update_insurance_certificate: [getListInsuranceCertificatesQueryKey],
        delete_insurance_certificate: [getListInsuranceCertificatesQueryKey],
        // Payroll
        create_payroll_deduction: [getListPayrollDeductionsQueryKey],
        update_payroll_deduction: [getListPayrollDeductionsQueryKey],
        delete_payroll_deduction: [getListPayrollDeductionsQueryKey],
        // Customers
        create_customer: [getListCustomersQueryKey],
        update_customer: [getListCustomersQueryKey],
        delete_customer: [getListCustomersQueryKey],
        // Composite — touches everything under a new property
        create_property_with_layout: [
          getListPropertiesQueryKey,
          getListBuildingsQueryKey,
          getListRoomsQueryKey,
          getListBedsQueryKey,
        ],
        // Room-night logging (property-scoped helper — pass a
        // placeholder id and slice to the prefix so we invalidate every
        // property's cached list, not just one).
        log_room_nights: [getListRoomNightLogsQueryKey],
        // Property-scoped lists: invalidate by prefix so every
        // property's cached results are dropped.
        record_property_violation: [
          () => getListPropertyViolationsQueryKey("").slice(0, 1),
        ],
        create_projected_move_in: [
          () => getListProjectedMoveInsQueryKey("").slice(0, 1),
        ],
        // Importers touch many tables at once.
        import_master_leases: [getListLeasesQueryKey],
        import_payroll_deductions: [
          getListPayrollDeductionsQueryKey,
          getListOccupantsQueryKey,
        ],
        // extract_lease_pdf only stages a draft for the next proposal —
        // no list cache is touched until the operator approves a
        // follow-up create_lease, which has its own mapping above.
      };
      const keys = toolName ? map[toolName] : undefined;
      if (!keys) {
        // Unknown / composite / undo path — be safe and refetch all
        // list queries.
        queryClient.invalidateQueries();
        return;
      }
      for (const getKey of keys) {
        queryClient.invalidateQueries({ queryKey: getKey() });
      }
    },
    [queryClient],
  );

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
      const approvedTools: string[] = [];

      // 60-second stall watchdog (Task #668). If we go a full minute
      // without any chunk from the server (including SSE keepalive
      // comments emitted by `withSseKeepalive`), assume the
      // connection is wedged and abort so the operator gets a clear
      // error instead of a spinner that never resolves. Cleared in
      // the read-loop `finally`.
      let lastChunkAt = Date.now();
      const stallTimer = setInterval(() => {
        if (Date.now() - lastChunkAt > 60_000) {
          clearInterval(stallTimer);
          try {
            controller.abort();
          } catch {
            /* already aborted */
          }
          setState((s) => ({
            ...s,
            busy: false,
            error:
              "Assistant stream stalled (no response for 60s). Please try again.",
            messages: s.messages.map((m) =>
              m.id === assistantMessageId ? { ...m, pending: false } : m,
            ),
          }));
        }
      }, 5_000);

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
                preview: payload.preview,
                previewError: payload.previewError ?? null,
              },
            ],
          }));
        } else if (event === "proposal_resolved") {
          if (payload.status === "approved" && typeof payload.tool === "string") {
            approvedTools.push(payload.tool);
          } else if (payload.status === "approved") {
            // Server didn't tag the tool — fall back to a full invalidate.
            approvedTools.push("");
          }
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

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          lastChunkAt = Date.now();
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
      } finally {
        clearInterval(stallTimer);
      }
      // Stream closed without "done" event — flush.
      setState((s) => ({
        ...s,
        busy: false,
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, pending: false } : m,
        ),
      }));
      // Invalidate only the lists each approved tool actually touched.
      // An empty string in `approvedTools` means the server didn't tag
      // the tool, so fall through to a full invalidate for safety.
      if (approvedTools.length > 0) {
        if (approvedTools.includes("")) {
          invalidateData(null);
        } else {
          for (const tool of approvedTools) invalidateData(tool);
        }
      }
    },
    [contextHeader, invalidateData],
  );

  const send = useCallback(
    async (text: string, attachments: AssistantAttachment[] = []) => {
      const annotations = attachments
        .map(
          (a) =>
            `[Attached file: filename="${a.filename}", uploadId="${a.uploadId}", mime="${a.mime}", sizeBytes=${a.sizeBytes}]`,
        )
        .join("\n");
      const displayText = attachments.length
        ? `${text}\n\n${attachments.map((a) => `📎 ${a.filename}`).join("\n")}`
        : text;
      const wireText = annotations ? `${text}\n\n${annotations}` : text;
      const userMsg: AssistantMessage = {
        id: localId("u"),
        role: "user",
        text: displayText,
      };
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
        { message: wireText, conversationId: state.conversationId },
        assistantMsg.id,
      );
    },
    [consumeStream, state.conversationId],
  );

  const uploadFile = useCallback(
    async (file: File): Promise<AssistantAttachment> => {
      const fd = new FormData();
      fd.append("file", file);
      if (state.conversationId) fd.append("conversationId", state.conversationId);
      const r = await fetch(`${apiBase()}/uploads`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(txt || `HTTP ${r.status}`);
      }
      return (await r.json()) as AssistantAttachment;
    },
    [state.conversationId],
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
        invalidateData(null);
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
    uploadFile,
    pageFocusCustomer,
  };
}
