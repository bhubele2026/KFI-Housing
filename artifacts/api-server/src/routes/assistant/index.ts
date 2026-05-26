import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  assistantConversationsTable,
  assistantMessagesTable,
  assistantProposalsTable,
  type AssistantMessageRow,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { customersTable } from "@workspace/db";
import { anthropicToolDefs, TOOL_BY_NAME, impliedCustomerIdForWrite } from "./tools";

const router: IRouter = Router();

const MODEL = "claude-sonnet-4-5";
const MAX_TURNS = 8;

const SYSTEM_PROMPT_BASE = `You are the HousingOps assistant — an in-app copilot for an operator who manages corporate housing (customers → properties → buildings → rooms → beds → occupants, plus leases, utilities, insurance certificates, and payroll deductions).

You have read-only and write tools. READ tools (list_*, get_*, find_*) execute immediately. WRITE tools (create_*, update_*, delete_*, assign_*, move_*, unassign_*, bulk_*) are PROPOSALS — the user must confirm each one before it executes.

Guidelines:
- When the user names something by label ("Penda", "Schuette", "Sarah Jones"), first call find_property_by_name or find_occupant_by_name to resolve the id. Never invent ids.
- Prefer one tool call at a time so the user can follow along.
- Before any destructive action (delete_*, unassign_*), confirm in plain English what will happen and which records are affected.
- After a write tool runs (the system will tell you the result), summarize what changed in 1–2 short sentences.
- For multi-step setup ("create a property with 2 buildings, 8 rooms each, $750/week beds"), prefer the composite tool create_property_with_layout — one Confirm card runs everything atomically.
- For batch occupant creation, prefer bulk_create_occupants.
- If a required field is missing, ASK the user instead of guessing.
- Keep replies short and operational. No fluff.

Naming conventions:
- Bed labels typically combine building code + room number + bed letter (e.g. "MG-04B" = building MG, room 04, bed B).
- Lease status: active / expired / pending.
- Bed status: Occupied / Vacant. cleaningStatus: ready / needs_cleaning / in_progress / occupied.`;

interface AssistantCtx {
  customerScopeId: string | null;
  pageContext: string | null;
}

function parseAssistantContext(req: Request): AssistantCtx {
  const raw = req.headers["x-assistant-context"];
  if (typeof raw !== "string" || !raw) return { customerScopeId: null, pageContext: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      customerScopeId:
        typeof parsed?.customerId === "string" && parsed.customerId !== "ALL"
          ? parsed.customerId
          : null,
      pageContext: typeof parsed?.page === "string" ? parsed.page : null,
    };
  } catch {
    return { customerScopeId: null, pageContext: null };
  }
}

async function buildSystemPrompt(ctx: AssistantCtx): Promise<string> {
  const customers = await db
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable);
  const customerList = customers
    .map((c) => `- ${c.id}: ${c.name}`)
    .join("\n");
  const scopeNote = ctx.customerScopeId
    ? `\n\nACTIVE CUSTOMER SCOPE: ${ctx.customerScopeId}. The operator is currently viewing only this customer's data. When they say "this customer" or "our properties", assume they mean ${ctx.customerScopeId}. WRITE TOOLS that touch a different customer's data will be REJECTED — you must ask the operator to switch scope first.`
    : "\n\nNo customer scope is active — the operator is viewing all customers.";
  const pageNote = ctx.pageContext
    ? `\n\nCURRENT PAGE: ${ctx.pageContext}. When the operator says "this property" / "this lease" / etc., assume they're referring to whatever is in focus on that page.`
    : "";
  return `${SYSTEM_PROMPT_BASE}

Customers in this workspace:
${customerList || "(no customers yet)"}${scopeNote}${pageNote}`;
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function getUserId(req: Request): string {
  const auth = (req as any).auth;
  return auth?.userId ?? "anon";
}

// SSE helpers ────────────────────────────────────────────────
function sseInit(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function sseSend(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Conversations ────────────────────────────────────────────

router.get("/assistant/conversations", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, userId))
    .orderBy(desc(assistantConversationsTable.updatedAt))
    .limit(50);
  res.json({ conversations: rows });
});

router.get("/assistant/conversations/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const [conv] = await db
    .select()
    .from(assistantConversationsTable)
    .where(
      and(
        eq(assistantConversationsTable.id, req.params.id),
        eq(assistantConversationsTable.userId, userId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const messages = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conv.id))
    .orderBy(asc(assistantMessagesTable.createdAt));
  const proposals = await db
    .select()
    .from(assistantProposalsTable)
    .where(eq(assistantProposalsTable.conversationId, conv.id))
    .orderBy(asc(assistantProposalsTable.createdAt));
  res.json({ conversation: conv, messages, proposals });
});

router.delete("/assistant/conversations/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const [conv] = await db
    .select()
    .from(assistantConversationsTable)
    .where(
      and(
        eq(assistantConversationsTable.id, req.params.id),
        eq(assistantConversationsTable.userId, userId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(assistantMessagesTable)
      .where(eq(assistantMessagesTable.conversationId, conv.id));
    await tx
      .delete(assistantProposalsTable)
      .where(eq(assistantProposalsTable.conversationId, conv.id));
    await tx
      .delete(assistantConversationsTable)
      .where(eq(assistantConversationsTable.id, conv.id));
  });
  res.sendStatus(204);
});

// ── Build Anthropic message history from stored rows ──────────
function buildAnthropicMessages(
  rows: AssistantMessageRow[],
): Array<{ role: "user" | "assistant"; content: any }> {
  const out: Array<{ role: "user" | "assistant"; content: any }> = [];
  for (const r of rows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    if (md.blocks) {
      out.push({ role: r.role as "user" | "assistant", content: md.blocks as any });
    } else {
      out.push({ role: r.role as "user" | "assistant", content: r.content });
    }
  }
  return out;
}

async function loadMessages(conversationId: string): Promise<AssistantMessageRow[]> {
  return db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conversationId))
    .orderBy(asc(assistantMessagesTable.createdAt));
}

async function persistMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<AssistantMessageRow> {
  const [row] = await db
    .insert(assistantMessagesTable)
    .values({
      id: newId("am"),
      conversationId,
      role,
      content,
      metadata,
    })
    .returning();
  await db
    .update(assistantConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversationsTable.id, conversationId));
  return row;
}

// ── Core loop: run Anthropic until pause (write proposal) or stop ──
async function runLoop(
  conversationId: string,
  res: Response,
  ctx: AssistantCtx,
): Promise<void> {
  const systemPrompt = await buildSystemPrompt(ctx);
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const rows = await loadMessages(conversationId);
    const messages = buildAnthropicMessages(rows);
    if (messages.length === 0) {
      sseSend(res, "done", { reason: "empty" });
      return;
    }

    let assistantText = "";
    const assistantBlocks: any[] = [];

    let finalMessage: any;
    try {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: anthropicToolDefs() as any,
        messages: messages as any,
      });

      stream.on("text", (delta: string) => {
        assistantText += delta;
        sseSend(res, "text", { delta });
      });

      finalMessage = await stream.finalMessage();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error("[assistant] stream error", err);
      sseSend(res, "error", { message: msg });
      await persistMessage(conversationId, "assistant", `Error: ${msg}`);
      return;
    }

    for (const block of finalMessage.content) assistantBlocks.push(block);

    // Persist the assistant turn (with full blocks for tool-use history).
    await persistMessage(conversationId, "assistant", assistantText, {
      blocks: assistantBlocks,
    });

    const toolUses = assistantBlocks.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      sseSend(res, "done", { reason: "stop" });
      return;
    }

    // Process tool uses in order. Reads execute immediately; the FIRST write
    // becomes a proposal that pauses the loop. Any tool_uses that appear AFTER
    // the first write are "deferred" — we record a placeholder tool_result so
    // the assistant message stays balanced (Anthropic requires every tool_use
    // to have a matching tool_result in the immediately-following user turn).
    // The proposal stores prior read results + deferred ids; on confirm we
    // emit one combined tool_result user-message in the original order.
    const toolResults: any[] = [];
    let pausedProposalId: string | null = null;
    let writeIndex = -1;

    for (let i = 0; i < toolUses.length; i++) {
      const tu = toolUses[i];
      const def = TOOL_BY_NAME.get(tu.name);

      if (writeIndex !== -1) {
        // Already paused — mark remaining tool_uses as deferred.
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content:
            "Deferred — the previous proposal must be resolved first. Please call this tool again after the user confirms or cancels.",
          is_error: true,
        });
        continue;
      }

      if (!def) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Unknown tool ${tu.name}`,
          is_error: true,
        });
        sseSend(res, "tool_error", { tool: tu.name, message: "Unknown tool" });
        continue;
      }

      if (def.kind === "read") {
        sseSend(res, "tool_call", {
          tool: tu.name,
          summary: def.summarize(tu.input ?? {}),
        });
        try {
          const result = await def.execute(tu.input ?? {});
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 50_000),
          });
          sseSend(res, "tool_result", { tool: tu.name, ok: true });
        } catch (err: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: ${err?.message ?? String(err)}`,
            is_error: true,
          });
          sseSend(res, "tool_result", { tool: tu.name, ok: false, error: err?.message });
        }
      } else {
        // Customer-scope guard — refuse to even propose a write that crosses
        // the active customer scope. The result becomes a tool_error the
        // model can react to (it will explain to the operator and ask to
        // switch scope, per the system prompt).
        if (ctx.customerScopeId) {
          const implied = await impliedCustomerIdForWrite(tu.name, tu.input ?? {});
          // Fail closed: if we couldn't prove ownership for a write under
          // an active customer scope, refuse rather than silently allowing
          // the mutation. The only legitimate `null` cases are top-level
          // "create_customer"-style tools, which aren't in this registry.
          if (implied === null || implied !== ctx.customerScopeId) {
            const errMsg =
              implied === null
                ? `Refused: could not prove which customer this change belongs to under the active scope ${ctx.customerScopeId}. Resolve the target record first (e.g. find_property_by_name) or have the operator clear the customer scope.`
                : `Refused: this change targets customer ${implied} but the active scope is ${ctx.customerScopeId}. Ask the operator to switch the customer scope first.`;
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: errMsg,
              is_error: true,
            });
            sseSend(res, "tool_error", { tool: tu.name, message: errMsg });
            continue;
          }
        }
        // First write — record proposal, capture prior results, then continue
        // the loop to mark all remaining tool_uses as deferred.
        const proposalId = newId("ap");
        const priorResults = [...toolResults];
        await db.insert(assistantProposalsTable).values({
          id: proposalId,
          conversationId,
          toolName: tu.name,
          toolUseId: tu.id,
          summary: def.summarize(tu.input ?? {}),
          payload: {
            input: tu.input ?? {},
            priorResults,
            deferredToolUseIds: [] as string[],
          },
          status: "pending",
        });
        sseSend(res, "proposal", {
          id: proposalId,
          tool: tu.name,
          summary: def.summarize(tu.input ?? {}),
          input: tu.input ?? {},
        });
        pausedProposalId = proposalId;
        writeIndex = i;
      }
    }

    if (pausedProposalId) {
      // Record which tool_use ids were deferred so confirm can rebuild the
      // single combined user-message in the original block order.
      const deferredIds = toolUses.slice(writeIndex + 1).map((tu) => tu.id);
      const [propRow] = await db
        .select()
        .from(assistantProposalsTable)
        .where(eq(assistantProposalsTable.id, pausedProposalId));
      const wrapped = (propRow?.payload ?? {}) as {
        input?: unknown;
        priorResults?: unknown;
      };
      await db
        .update(assistantProposalsTable)
        .set({
          payload: {
            input: wrapped.input ?? {},
            priorResults: wrapped.priorResults ?? [],
            deferredToolUseIds: deferredIds,
          },
        })
        .where(eq(assistantProposalsTable.id, pausedProposalId));
      sseSend(res, "done", { reason: "awaiting_confirm" });
      return;
    }

    // Persist tool_result block as a user-role message for next turn.
    await persistMessage(conversationId, "user", "", { blocks: toolResults });
  }
  sseSend(res, "done", { reason: "max_turns" });
}

// ── POST /assistant/chat ─ start or continue a conversation ──
router.post("/assistant/chat", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const body = req.body as { conversationId?: string; message: string };
  if (!body?.message?.trim()) {
    res.status(400).json({ error: "message required" });
    return;
  }

  let conversationId = body.conversationId;
  if (!conversationId) {
    conversationId = newId("ac");
    await db.insert(assistantConversationsTable).values({
      id: conversationId,
      userId,
      title: body.message.slice(0, 60),
    });
  } else {
    const [conv] = await db
      .select()
      .from(assistantConversationsTable)
      .where(
        and(
          eq(assistantConversationsTable.id, conversationId),
          eq(assistantConversationsTable.userId, userId),
        ),
      );
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
  }

  const ctx = parseAssistantContext(req);

  sseInit(res);
  sseSend(res, "conversation", { id: conversationId });

  await persistMessage(conversationId, "user", body.message);

  req.on("close", () => {
    /* client disconnected */
  });

  await runLoop(conversationId, res, ctx);
  res.end();
});

// ── POST /assistant/confirm ─ approve or reject a pending proposal ──
router.post("/assistant/confirm", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const { proposalId, approve, edits } = req.body as {
    proposalId: string;
    approve: boolean;
    edits?: Record<string, unknown>;
  };
  if (!proposalId || typeof approve !== "boolean") {
    res.status(400).json({ error: "proposalId and approve required" });
    return;
  }

  const [proposal] = await db
    .select()
    .from(assistantProposalsTable)
    .where(eq(assistantProposalsTable.id, proposalId));
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (proposal.status !== "pending") {
    res.status(409).json({ error: `Proposal already ${proposal.status}` });
    return;
  }

  const [conv] = await db
    .select()
    .from(assistantConversationsTable)
    .where(
      and(
        eq(assistantConversationsTable.id, proposal.conversationId),
        eq(assistantConversationsTable.userId, userId),
      ),
    );
  if (!conv) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const def = TOOL_BY_NAME.get(proposal.toolName);
  if (!def) {
    res.status(500).json({ error: `Unknown tool ${proposal.toolName}` });
    return;
  }

  sseInit(res);
  sseSend(res, "conversation", { id: proposal.conversationId });

  const wrapped = (proposal.payload ?? {}) as {
    input?: Record<string, unknown>;
    priorResults?: any[];
    deferredToolUseIds?: string[];
  };
  const wrappedInput = wrapped.input ?? {};
  const priorResults = wrapped.priorResults ?? [];
  const deferredIds = wrapped.deferredToolUseIds ?? [];

  let toolResultBlock: any;
  if (!approve) {
    await db
      .update(assistantProposalsTable)
      .set({ status: "rejected", resolvedAt: new Date() })
      .where(eq(assistantProposalsTable.id, proposalId));
    toolResultBlock = {
      type: "tool_result",
      tool_use_id: proposal.toolUseId,
      content: "User declined this action.",
      is_error: true,
    };
    sseSend(res, "proposal_resolved", { id: proposalId, status: "rejected" });
  } else {
    // Allowlist edits to keys declared in the tool's input_schema —
    // every tool schema is built with additionalProperties:false, so
    // anything else is by-definition not a valid field and could only
    // be an attempt to smuggle ownership-changing data (e.g. a stray
    // customerId on update_room) past the executor's permissive
    // Object.entries(rest) handling. Unknown keys are dropped.
    const schemaProps =
      ((def.input_schema as any)?.properties as Record<string, unknown>) ?? {};
    const allowedKeys = new Set(Object.keys(schemaProps));
    const sanitizedEdits: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edits ?? {})) {
      if (allowedKeys.has(k)) sanitizedEdits[k] = v;
    }
    const finalInput = { ...wrappedInput, ...sanitizedEdits };
    // Re-run the customer-scope guard on the FINAL input (after any
    // operator edits). If edits changed a parent id
    // (propertyId/buildingId/roomId/...), impliedCustomerIdForWrite
    // resolves ownership from the NEW target graph and fails closed
    // when it would cross the active customer scope.
    const ctx = parseAssistantContext(req);
    if (ctx.customerScopeId) {
      const implied = await impliedCustomerIdForWrite(proposal.toolName, finalInput);
      if (implied === null || implied !== ctx.customerScopeId) {
        const errMsg =
          implied === null
            ? `Refused on confirm: could not prove which customer this change belongs to under the active scope ${ctx.customerScopeId}.`
            : `Refused on confirm: edited input targets customer ${implied} but the active scope is ${ctx.customerScopeId}.`;
        await db
          .update(assistantProposalsTable)
          .set({ status: "rejected", resolvedAt: new Date(), result: { error: errMsg } as any })
          .where(eq(assistantProposalsTable.id, proposalId));
        sseSend(res, "proposal_resolved", {
          id: proposalId,
          status: "rejected",
          error: errMsg,
        });
        toolResultBlock = {
          type: "tool_result",
          tool_use_id: proposal.toolUseId,
          content: errMsg,
          is_error: true,
        };
        // Skip execution; fall through to the deferred-results / runLoop
        // path so the model sees the refusal and can explain it. Reuse
        // the priorResults + deferredIds already unwrapped from
        // `wrapped` above.
        const refusalDeferredBlocks = deferredIds.map((id) => ({
          type: "tool_result" as const,
          tool_use_id: id,
          content:
            "Deferred — the previous proposal has now been resolved. Re-issue this tool call if it's still needed.",
          is_error: true,
        }));
        await persistMessage(proposal.conversationId, "user", "", {
          blocks: [...priorResults, toolResultBlock, ...refusalDeferredBlocks],
        });
        await runLoop(proposal.conversationId, res, ctx);
        res.end();
        return;
      }
    }
    try {
      const result = await def.execute(finalInput);
      await db
        .update(assistantProposalsTable)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          payload: { ...wrapped, input: finalInput },
          result: result as Record<string, unknown>,
        })
        .where(eq(assistantProposalsTable.id, proposalId));
      toolResultBlock = {
        type: "tool_result",
        tool_use_id: proposal.toolUseId,
        content: JSON.stringify(result).slice(0, 50_000),
      };
      sseSend(res, "proposal_resolved", { id: proposalId, status: "approved", result });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await db
        .update(assistantProposalsTable)
        .set({
          status: "failed",
          resolvedAt: new Date(),
          result: { error: message },
        })
        .where(eq(assistantProposalsTable.id, proposalId));
      toolResultBlock = {
        type: "tool_result",
        tool_use_id: proposal.toolUseId,
        content: `Error: ${message}`,
        is_error: true,
      };
      sseSend(res, "proposal_resolved", { id: proposalId, status: "failed", error: message });
    }
  }

  // Rebuild the single tool_result user message that matches the prior
  // assistant turn's tool_use block order: [...reads-before-write, write,
  // ...deferred placeholders for tool_uses after the write].
  const deferredBlocks = deferredIds.map((id) => ({
    type: "tool_result",
    tool_use_id: id,
    content:
      "Deferred — the previous proposal has now been resolved. Re-issue this tool call if it's still needed.",
    is_error: true,
  }));
  await persistMessage(proposal.conversationId, "user", "", {
    blocks: [...priorResults, toolResultBlock, ...deferredBlocks],
  });

  await runLoop(proposal.conversationId, res, parseAssistantContext(req));
  res.end();
});

export default router;
