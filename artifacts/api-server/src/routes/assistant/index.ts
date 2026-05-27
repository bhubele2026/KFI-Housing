import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  assistantConversationsTable,
  assistantMessagesTable,
  assistantProposalsTable,
  assistantUploadsTable,
  type AssistantMessageRow,
  propertiesTable,
  buildingsTable,
  leasesTable,
  occupantsTable,
  roomsTable,
  bedsTable,
  utilitiesTable,
  insuranceCertificatesTable,
  payrollDeductionsTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { customersTable } from "@workspace/db";
import {
  anthropicToolDefs,
  TOOL_BY_NAME,
  impliedCustomerIdForWrite,
  customerIdForFocus,
  evaluateWriteScope,
  type FocusEntityType,
} from "./tools";
import {
  buildUndoPlan,
  captureSnapshot,
  executeUndoPlan,
  extractAffectedIds,
  extractResultId,
  isToolReversible,
  type UndoPlan,
} from "./undo";

const router: IRouter = Router();

const MODEL = "claude-sonnet-4-5";
// Raised from 8 → 20 in Task #668 so multi-step write flows (look up by
// name → batch update) don't hit the cap before the model can finish.
const MAX_TURNS = 20;

const SYSTEM_PROMPT_BASE = `You are the HousingOps assistant — an in-app copilot for an operator who manages corporate housing (customers → properties → buildings → rooms → beds → occupants, plus leases, utilities, insurance certificates, and payroll deductions).

You have read-only and write tools. READ tools (list_*, get_*, find_*, extract_*) execute immediately. WRITE tools (create_*, update_*, delete_*, assign_*, move_*, unassign_*, bulk_*, import_*, log_*, record_*) are PROPOSALS — the user must confirm each one before it executes.

When the user attaches a file (master lease workbook, payroll deduction export, lease PDF) the system will tell you the uploadId in the user's message. Pass that uploadId straight into the matching tool (import_master_leases, import_payroll_deductions, extract_lease_pdf). Don't ask the user to repeat it.

Guidelines:
- When the user names something by label ("Penda", "Schuette", "Sarah Jones"), first call find_property_by_name or find_occupant_by_name to resolve the id. Never invent ids.
- Prefer one tool call at a time so the user can follow along.
- Before any destructive action (delete_*, unassign_*), confirm in plain English what will happen and which records are affected.
- After a write tool runs (the system will tell you the result), summarize what changed in 1–2 short sentences.
- For multi-step setup ("create a property with 2 buildings, 8 rooms each, $750/week beds"), prefer the composite tool create_property_with_layout — one Confirm card runs everything atomically.
- For batch occupant creation, prefer bulk_create_occupants.
- For batch lease edits ("set monthly rent on these 5 leases to $X"), prefer bulk_update_leases — one Confirm card edits them all instead of N separate proposals.
- For multi-bed creates ("add 6 beds to room R"), prefer bulk_create_beds.
- For batch bed-status flips ("mark these 4 beds needs_cleaning"), prefer bulk_update_beds.
- For adding multiple utilities to the same property in one ask ("add water $50/mo and garbage $20/mo to <property>"), prefer bulk_create_utilities so one Confirm card runs them all.
- If a required field is missing, ASK the user instead of guessing.
- The verbs "add" / "create" / "new" ALWAYS map to a create_* (or bulk_create_*) tool — never to update_*. "Change" / "set" / "rename" / "update" map to update_*. If you're unsure which the user meant, ASK rather than guessing.
- If the user states a count ("add three utilities") but lists fewer items, ASK which they meant. Do not invent the missing items, do not substitute an update_*, and do not silently proceed with only the items that were listed.
- Keep replies short and operational. No fluff.

Naming conventions:
- Bed labels typically combine building code + room number + bed letter (e.g. "MG-04B" = building MG, room 04, bed B).
- Lease status: active / expired / pending.
- Bed status: Occupied / Vacant. cleaningStatus: ready / needs_cleaning / in_progress / occupied.`;

interface PageFocus {
  entityType: FocusEntityType;
  entityId: string;
}

const FOCUS_ENTITY_TYPES: readonly FocusEntityType[] = [
  "property",
  "building",
  "room",
  "bed",
  "customer",
  "lease",
  "occupant",
  "utility",
  "insurance",
  "payroll",
];

interface AssistantCtx {
  customerScopeId: string | null;
  pageContext: string | null;
  focus: PageFocus | null;
  /** Authenticated operator — required by tools that read user-owned data (e.g. uploads). */
  userId: string;
  // Resolved owning customerId for `focus`, or null when there is no
  // focus or the focused row no longer exists. Populated by
  // resolveFocusCustomer; parseAssistantContext leaves it null.
  focusCustomerId: string | null;
}

export function parseAssistantContext(req: Request): AssistantCtx {
  const userId = getUserId(req);
  const raw = req.headers["x-assistant-context"];
  const empty: AssistantCtx = {
    customerScopeId: null,
    pageContext: null,
    focus: null,
    focusCustomerId: null,
    userId,
  };
  if (typeof raw !== "string" || !raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    let focus: PageFocus | null = null;
    if (
      parsed?.focus &&
      typeof parsed.focus.entityType === "string" &&
      typeof parsed.focus.entityId === "string" &&
      (FOCUS_ENTITY_TYPES as readonly string[]).includes(parsed.focus.entityType)
    ) {
      focus = {
        entityType: parsed.focus.entityType as FocusEntityType,
        entityId: parsed.focus.entityId,
      };
    }
    return {
      customerScopeId:
        typeof parsed?.customerId === "string" &&
        parsed.customerId.toLowerCase() !== "all"
          ? parsed.customerId
          : null,
      pageContext: typeof parsed?.page === "string" ? parsed.page : null,
      focus,
      focusCustomerId: null,
      userId,
    };
  } catch {
    return empty;
  }
}

/**
 * Resolve the page-focus customer once per request and stash it on the
 * ctx. The write guard treats focusCustomerId as the implicit "effective
 * scope" when the dropdown is "All", so we resolve eagerly here rather
 * than lazily inside the loop. A stale/missing focus row leaves
 * focusCustomerId as null — the guard then behaves as if no focus was
 * sent (back-compat).
 */
async function resolveFocusCustomer(ctx: AssistantCtx): Promise<AssistantCtx> {
  if (!ctx.focus) return ctx;
  try {
    const id = await customerIdForFocus(ctx.focus.entityType, ctx.focus.entityId);
    return { ...ctx, focusCustomerId: id };
  } catch {
    return ctx;
  }
}

/**
 * Resolve the focused entity into a one-line summary the model can use
 * verbatim (id + display name + parent ownership). Returns null when
 * the id no longer exists — the model is told the focus is stale and
 * should re-resolve rather than guess.
 */
async function summarizeFocus(focus: PageFocus): Promise<string | null> {
  switch (focus.entityType) {
    case "property": {
      const [row] = await db
        .select({ id: propertiesTable.id, name: propertiesTable.name, customerId: propertiesTable.customerId })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `property ${row.id} ("${row.name}", customer ${row.customerId})`;
    }
    case "building": {
      const [row] = await db
        .select({
          id: buildingsTable.id,
          name: buildingsTable.name,
          propertyId: buildingsTable.propertyId,
        })
        .from(buildingsTable)
        .where(eq(buildingsTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `building ${row.id} ("${row.name}", property ${row.propertyId})`;
    }
    case "customer": {
      const [row] = await db
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable)
        .where(eq(customersTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `customer ${row.id} ("${row.name}")`;
    }
    case "lease": {
      const [row] = await db
        .select({
          id: leasesTable.id,
          propertyId: leasesTable.propertyId,
          status: leasesTable.status,
          endDate: leasesTable.endDate,
        })
        .from(leasesTable)
        .where(eq(leasesTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `lease ${row.id} (property ${row.propertyId}, status ${row.status}, ends ${row.endDate || "?"})`;
    }
    case "occupant": {
      const [row] = await db
        .select({
          id: occupantsTable.id,
          name: occupantsTable.name,
          propertyId: occupantsTable.propertyId,
          status: occupantsTable.status,
        })
        .from(occupantsTable)
        .where(eq(occupantsTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `occupant ${row.id} ("${row.name}", property ${row.propertyId}, status ${row.status})`;
    }
    case "room": {
      const [row] = await db
        .select({
          id: roomsTable.id,
          name: roomsTable.name,
          propertyId: roomsTable.propertyId,
          buildingId: roomsTable.buildingId,
        })
        .from(roomsTable)
        .where(eq(roomsTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `room ${row.id} ("${row.name}", property ${row.propertyId}${row.buildingId ? `, building ${row.buildingId}` : ""})`;
    }
    case "bed": {
      const [row] = await db
        .select({
          id: bedsTable.id,
          bedNumber: bedsTable.bedNumber,
          roomId: bedsTable.roomId,
          propertyId: bedsTable.propertyId,
          status: bedsTable.status,
          cleaningStatus: bedsTable.cleaningStatus,
          occupantId: bedsTable.occupantId,
        })
        .from(bedsTable)
        .where(eq(bedsTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `bed ${row.id} (#${row.bedNumber}, room ${row.roomId}, property ${row.propertyId}, status ${row.status}/${row.cleaningStatus}${row.occupantId ? `, occupant ${row.occupantId}` : ""})`;
    }
    case "utility": {
      const [row] = await db
        .select({
          id: utilitiesTable.id,
          type: utilitiesTable.type,
          company: utilitiesTable.company,
          propertyId: utilitiesTable.propertyId,
        })
        .from(utilitiesTable)
        .where(eq(utilitiesTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `utility ${row.id} (${row.type}${row.company ? ` — ${row.company}` : ""}, property ${row.propertyId})`;
    }
    case "insurance": {
      const [row] = await db
        .select({
          id: insuranceCertificatesTable.id,
          carrier: insuranceCertificatesTable.carrier,
          policyNumber: insuranceCertificatesTable.policyNumber,
          propertyId: insuranceCertificatesTable.propertyId,
          coverageEnd: insuranceCertificatesTable.coverageEnd,
        })
        .from(insuranceCertificatesTable)
        .where(eq(insuranceCertificatesTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `insurance certificate ${row.id} (carrier ${row.carrier || "?"}, policy ${row.policyNumber || "?"}, property ${row.propertyId}, ends ${row.coverageEnd || "?"})`;
    }
    case "payroll": {
      const [row] = await db
        .select({
          id: payrollDeductionsTable.id,
          occupantId: payrollDeductionsTable.occupantId,
          customerId: payrollDeductionsTable.customerId,
          propertyId: payrollDeductionsTable.propertyId,
          payWeekEndDate: payrollDeductionsTable.payWeekEndDate,
          weeklyAmount: payrollDeductionsTable.weeklyAmount,
        })
        .from(payrollDeductionsTable)
        .where(eq(payrollDeductionsTable.id, focus.entityId))
        .limit(1);
      if (!row) return null;
      return `payroll deduction ${row.id} (occupant ${row.occupantId}, customer ${row.customerId || "?"}, property ${row.propertyId || "?"}, week ending ${row.payWeekEndDate}, $${row.weeklyAmount})`;
    }
    default:
      return null;
  }
}

/**
 * One tappable suggestion surfaced above the chat input. `label` is the
 * short button text (≤ ~28ch); `prompt` is the full natural-language
 * sentence that gets sent to the assistant when the chip is tapped.
 */
export interface PageChip {
  label: string;
  prompt: string;
}

/**
 * Per-page "common asks" — these aren't commands the model executes;
 * they're hints so suggestions ("what next?") match what the operator
 * usually does on this page. Returned as structured chips so the web
 * client can render them as tappable buttons above the chat input;
 * `pageSuggestions` then flattens the same list into the COMMON ASKS
 * block of the system prompt. Keep these tight and operational, and
 * cap each page at 4 chips so the row never wraps to a third line.
 */
export function pageChipsFor(ctx: AssistantCtx): PageChip[] {
  const path = ctx.pageContext?.split("?")[0] ?? "";
  let chips: PageChip[] = [];
  if (ctx.focus?.entityType === "property") {
    chips = [
      { label: "Expiring leases here", prompt: "Show the leases expiring soon for this property." },
      { label: "Vacant beds", prompt: "List the vacant beds at this property." },
      { label: "Add a building", prompt: "Add a new building to this property." },
      { label: "Assign an occupant", prompt: "Find an unassigned bed at this property and help me assign an occupant to it." },
    ];
  } else if (ctx.focus?.entityType === "building") {
    chips = [
      { label: "Rooms in this building", prompt: "List the rooms in this building." },
      { label: "Add a room", prompt: "Add a new room (with beds) to this building." },
      { label: "Mark cleaning status", prompt: "Help me mark a room or bed here as needs_cleaning or ready." },
    ];
  } else if (ctx.focus?.entityType === "lease") {
    chips = [
      { label: "Extend by 6 months", prompt: "Extend this lease by 6 months." },
      { label: "Other leases here", prompt: "Show the property's other leases." },
      { label: "Snooze expiry alert", prompt: "Snooze the expiry alert on this lease." },
    ];
  } else if (ctx.focus?.entityType === "occupant") {
    chips = [
      { label: "Recent deductions", prompt: "Show this occupant's recent payroll deductions." },
      { label: "Move to another bed", prompt: "Move this occupant to another bed (must be cleaning-ready)." },
      { label: "Mark as Former", prompt: "Unassign this occupant and mark them as Former." },
    ];
  } else if (ctx.focus?.entityType === "customer") {
    chips = [
      { label: "This customer's properties", prompt: "List this customer's properties." },
      { label: "Unmatched payroll", prompt: "Find unmatched payroll deductions for this customer." },
      { label: "Expiring in 30 days", prompt: "List leases expiring in the next 30 days for this customer." },
    ];
  } else if (path === "/leases" || path === "/leases/snoozed") {
    chips = [
      { label: "Expiring in 30 days", prompt: "Show leases expiring in the next 30 days." },
      { label: "Expiring in 60 days", prompt: "Show leases expiring in the next 60 days." },
      { label: "Filter by customer", prompt: "Help me filter leases by customer." },
    ];
  } else if (path === "/dashboard") {
    chips = [
      { label: "What needs attention?", prompt: "What needs attention today? Pull expiring leases and unmatched payroll for the active customer." },
      { label: "Find unmatched payroll", prompt: "Find unmatched payroll deductions across the active customer." },
      { label: "Jump to a property", prompt: "Help me jump to a property by name." },
    ];
  } else if (path === "/occupants") {
    chips = [
      { label: "Find an occupant", prompt: "Help me find an occupant by name." },
      { label: "Bulk add occupants", prompt: "Help me bulk-create occupants for a property." },
    ];
  }
  return chips.slice(0, 4);
}

function pageSuggestions(ctx: AssistantCtx): string {
  const chips = pageChipsFor(ctx);
  if (!chips.length) return "";
  const lines = chips.map((c) => `- ${c.prompt}`);
  return `\n\nCOMMON ASKS ON THIS PAGE:\n${lines.join("\n")}`;
}

async function buildSystemPrompt(ctx: AssistantCtx): Promise<string> {
  const customers = await db
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable);
  const customerList = customers
    .map((c) => `- ${c.id}: ${c.name}`)
    .join("\n");
  let scopeNote: string;
  if (ctx.customerScopeId) {
    // When a focus is also resolved, the page belongs to the same (or a
    // different) customer; either way the dropdown is the binding scope,
    // so we keep the existing nudge intact.
    scopeNote = `\n\nACTIVE CUSTOMER SCOPE: ${ctx.customerScopeId}. The operator is currently viewing only this customer's data. When they say "this customer" or "our properties", assume they mean ${ctx.customerScopeId}. WRITE TOOLS that touch a different customer's data will be REJECTED — you must ask the operator to switch scope first.`;
  } else if (ctx.focusCustomerId) {
    // Dropdown is "All" but the page identifies a single customer —
    // treat that as the implicit scope. Tell the model it MAY propose
    // writes against that customer (and entities under it) directly
    // instead of asking the operator to switch the dropdown.
    scopeNote = `\n\nNo global customer scope is active, but the current page belongs to customer ${ctx.focusCustomerId}. You MAY propose writes against this customer (and any entities under it — its properties, buildings, rooms, beds, occupants, leases, utilities, insurance certificates, payroll deductions) WITHOUT asking the operator to change their global scope. Writes targeting a different customer will still be rejected.`;
  } else {
    scopeNote = "\n\nNo customer scope is active — the operator is viewing all customers.";
  }
  // Resolve the focused entity to a one-line summary. If the id is
  // stale (deleted while the tab sat open) we say so explicitly so the
  // model re-asks instead of using the dead id.
  let focusNote = "";
  if (ctx.focus) {
    const summary = await summarizeFocus(ctx.focus);
    focusNote = summary
      ? `\n\nIN FOCUS: ${summary}. When the operator says "this ${ctx.focus.entityType}" / "here", that's the record they mean — use its id directly without re-asking.`
      : `\n\nIN FOCUS: ${ctx.focus.entityType} id ${ctx.focus.entityId} (NOT FOUND — the record may have been deleted; ask the operator what they meant).`;
  }
  const pageNote = ctx.pageContext
    ? `\n\nCURRENT PAGE: ${ctx.pageContext}.`
    : "";
  const suggestions = pageSuggestions(ctx);
  return `${SYSTEM_PROMPT_BASE}

Customers in this workspace:
${customerList || "(no customers yet)"}${scopeNote}${pageNote}${focusNote}${suggestions}`;
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * Produce the bracketed "[Current state — …]" line we prepend to every
 * persisted user message (Task #668). Keeping the same single-line
 * format makes the freshest page context always sit at the top of the
 * most recent user turn, so the model never has to guess what "this
 * property" refers to in a long conversation.
 */
function formatCurrentStateLine(ctx: AssistantCtx): string {
  const page = ctx.pageContext ?? "?";
  const scope = ctx.customerScopeId ?? "ALL";
  const focus = ctx.focus
    ? `${ctx.focus.entityType}:${ctx.focus.entityId}`
    : "none";
  return `[Current state — page=${page}, scope=${scope}, focus=${focus}]`;
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

/**
 * Run `fn` while writing an SSE comment (`: keepalive\n\n`) every
 * 15 s so intermediate proxies (and the client-side stall watchdog,
 * Task #668) don't kill a long-running tool execution that hasn't
 * produced output yet. The interval is cleared in `finally` so a
 * thrown error doesn't leak a timer.
 */
async function withSseKeepalive<T>(
  res: Response,
  fn: () => Promise<T>,
): Promise<T> {
  const timer = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      /* socket already closed */
    }
  }, 15_000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

// ── File uploads (assistant attachments) ─────────────────────
// Operators attach spreadsheets / PDFs in the assistant panel before
// invoking an import_* / extract_lease_pdf tool (Task #647). We
// persist the bytes server-side so the eventual proposal confirm flow
// can re-read them without trusting the client to re-upload, and so
// the panel survives page reloads.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const uploadMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  uploadMw.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `File is too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        });
        return;
      }
      res.status(400).json({ error: `Upload rejected: ${err.message}` });
      return;
    }
    next(err);
  });
}

router.post("/assistant/uploads", uploadSingle, async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Missing 'file' field in multipart upload." });
    return;
  }
  // Only accept a conversationId the caller actually owns — otherwise
  // a malicious client could associate uploads with someone else's
  // conversation row. Unknown / unauthorized ids are silently dropped
  // to null (the upload still belongs to its uploader via userId).
  let conversationId: string | null = null;
  const rawConv =
    typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
  if (rawConv) {
    const [conv] = await db
      .select({ id: assistantConversationsTable.id })
      .from(assistantConversationsTable)
      .where(
        and(
          eq(assistantConversationsTable.id, rawConv),
          eq(assistantConversationsTable.userId, userId),
        ),
      );
    if (!conv) {
      res.status(403).json({ error: "Conversation does not belong to caller." });
      return;
    }
    conversationId = conv.id;
  }
  const id = newId("u");
  await db.insert(assistantUploadsTable).values({
    id,
    conversationId,
    userId,
    filename: file.originalname ?? "upload",
    mime: file.mimetype ?? "application/octet-stream",
    sizeBytes: file.size,
    content: file.buffer,
  });
  res.status(201).json({
    uploadId: id,
    filename: file.originalname ?? "upload",
    mime: file.mimetype ?? "application/octet-stream",
    sizeBytes: file.size,
  });
});

// ── Page chips (Task #670) ───────────────────────────────────
// Used by the web client to render 2-4 tappable suggestion chips above
// the chat input. The same `X-Assistant-Context` header the chat route
// reads is parsed here, so chips swap as the operator navigates without
// any extra signalling.
router.get("/assistant/page-chips", (req, res): void => {
  const ctx = parseAssistantContext(req);
  res.json({ chips: pageChipsFor(ctx) });
});

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

/**
 * Anthropic rejects the entire request if any assistant `tool_use`
 * block is not followed by a matching `tool_result` in the next user
 * message. The conversation can end up in that state when the
 * proposal/confirm flow is interrupted (operator types a new prompt
 * while a proposal is pending, the route crashes between persisting
 * the assistant turn and persisting the combined tool_result, etc.).
 *
 * This helper walks the message list and, for every orphan
 * `tool_use` id, splices in a synthetic `tool_result` block so the
 * next API call is structurally valid. The synthetic content is
 * marked `is_error: true` and explains the result is missing — the
 * model treats it as "this tool call didn't produce anything; do
 * something else." Pure function — no I/O, easy to unit-test.
 */
export function healToolUseBalance(
  messages: Array<{ role: "user" | "assistant"; content: any }>,
): Array<{ role: "user" | "assistant"; content: any }> {
  const out: Array<{ role: "user" | "assistant"; content: any }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    out.push(msg);
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const toolUseIds: string[] = [];
    for (const block of msg.content) {
      if (block && block.type === "tool_use" && typeof block.id === "string") {
        toolUseIds.push(block.id);
      }
    }
    if (toolUseIds.length === 0) continue;
    const next = messages[i + 1];
    const nextIsToolResultUser =
      !!next && next.role === "user" && Array.isArray(next.content);
    const resolved = new Set<string>();
    if (nextIsToolResultUser) {
      for (const b of next!.content as any[]) {
        if (b && b.type === "tool_result" && typeof b.tool_use_id === "string") {
          resolved.add(b.tool_use_id);
        }
      }
    }
    const missing = toolUseIds.filter((id) => !resolved.has(id));
    if (missing.length === 0) continue;
    const synthetic = missing.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: "Skipped — no result was recorded for this tool call.",
      is_error: true,
    }));
    if (nextIsToolResultUser) {
      // Replace the next message with a copy that has the synthetic
      // tool_result blocks appended, then push it and skip past it.
      out.push({
        role: "user",
        content: [...(next!.content as any[]), ...synthetic],
      });
      i += 1;
    } else {
      // No following user message — insert a synthetic one between
      // this assistant turn and whatever comes next.
      out.push({ role: "user", content: synthetic });
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

/**
 * Returns true when the error from `anthropic.messages.stream` /
 * `finalMessage()` looks like Anthropic's transient overload signal
 * (HTTP 529 / `overloaded_error`). Only this specific shape is
 * retried — every other failure (auth, schema, tool execution,
 * client disconnect, generic network) still fails immediately so we
 * don't silently mask real bugs.
 */
export function isOverloadedError(err: any): boolean {
  if (!err) return false;
  if (err.status === 529) return true;
  if (err?.error?.error?.type === "overloaded_error") return true;
  const msg = typeof err.message === "string" ? err.message : "";
  return /overloaded/i.test(msg);
}

const MAX_OVERLOAD_RETRIES = 3;
const OVERLOAD_FRIENDLY_MESSAGE =
  "Anthropic's API is temporarily overloaded. Please try again in a moment.";

// ── Core loop: run Anthropic until pause (write proposal) or stop ──
async function runLoop(
  conversationId: string,
  res: Response,
  ctx: AssistantCtx,
): Promise<void> {
  const systemPrompt = await buildSystemPrompt(ctx);
  // Counted across the whole request (NOT reset per turn): if
  // Anthropic is sustained-overloaded we want to give up after
  // a bounded number of attempts even if the operator's prompt
  // happens to need several model turns.
  let overloadedRetries = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const rows = await loadMessages(conversationId);
    const messages = healToolUseBalance(buildAnthropicMessages(rows));
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
      if (isOverloadedError(err)) {
        if (overloadedRetries >= MAX_OVERLOAD_RETRIES) {
          // Exhausted — surface a friendly final message (not the raw
          // JSON the SDK threw) and persist it as the assistant turn so
          // the conversation history shows what happened.
          console.error("[assistant] overload retries exhausted", err);
          sseSend(res, "error", { message: OVERLOAD_FRIENDLY_MESSAGE });
          await persistMessage(
            conversationId,
            "assistant",
            OVERLOAD_FRIENDLY_MESSAGE,
          );
          return;
        }
        const delayMs = Math.min(8000, 500 * 2 ** overloadedRetries);
        const secs = Math.max(1, Math.round(delayMs / 1000));
        // Inline progress hint streamed as a text delta so the chat
        // bubble shows "retrying" rather than the operator staring at
        // a frozen panel. We don't persist this delta — once the
        // retry succeeds the real assistant turn supersedes it.
        sseSend(res, "text", {
          delta: `\n_Anthropic is busy — retrying in ${secs}s…_\n`,
        });
        await new Promise((r) => setTimeout(r, delayMs));
        overloadedRetries += 1;
        turn -= 1; // re-run this turn
        continue;
      }
      // Coerce empty/missing message to String(err) so we never forward
      // a literal empty string to the client.
      const msg =
        typeof err?.message === "string" && err.message.length > 0
          ? err.message
          : String(err);
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
          const result = await withSseKeepalive(res, () =>
            def.execute(tu.input ?? {}, { userId: ctx.userId }),
          );
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
        // Customer-scope guard — refuse to even propose a write that
        // crosses the effective scope. The "effective scope" is the
        // dropdown's customerScopeId if set, otherwise the page-focus
        // customer (so a property/occupant/lease/etc. detail page
        // implicitly scopes writes to that customer without forcing the
        // operator to flip the dropdown). The result becomes a
        // tool_error the model can react to.
        if (ctx.customerScopeId || ctx.focusCustomerId) {
          const implied = await impliedCustomerIdForWrite(tu.name, tu.input ?? {});
          const decision = evaluateWriteScope(implied, {
            scopeCustomerId: ctx.customerScopeId,
            focusCustomerId: ctx.focusCustomerId,
          });
          if (!decision.ok) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: decision.reason,
              is_error: true,
            });
            sseSend(res, "tool_error", { tool: tu.name, message: decision.reason });
            continue;
          }
        }
        // First write — record proposal, capture prior results, then continue
        // the loop to mark all remaining tool_uses as deferred.
        // If the tool exposes a `preview` (Task #647), run it now so the
        // proposal card can show "what will change" before the operator
        // confirms. Preview failures are surfaced as a soft error on the
        // proposal but don't block it — the operator can still confirm
        // (the execute may still succeed) or cancel.
        let previewData: unknown = null;
        let previewError: string | null = null;
        if (def.preview) {
          try {
            previewData = await withSseKeepalive(res, () =>
              def.preview!(tu.input ?? {}, { userId: ctx.userId }),
            );
          } catch (err: any) {
            previewError = err?.message ?? String(err);
          }
        }
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
            preview: previewData,
            previewError,
          },
          status: "pending",
        });
        sseSend(res, "proposal", {
          id: proposalId,
          tool: tu.name,
          summary: def.summarize(tu.input ?? {}),
          input: tu.input ?? {},
          preview: previewData,
          previewError,
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
            ...(propRow?.payload ?? {}),
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
  // Hit the per-conversation turn cap without converging on a stop /
  // proposal. Surface a visible error before "done" so the client can
  // show the operator why the chat just ended instead of silently
  // hanging mid-flow.
  sseSend(res, "error", {
    message:
      "Hit max turns — the request was too complex to finish in one chat. Break it into smaller steps, or use a bulk_* tool to batch a repetitive change into one proposal.",
  });
  sseSend(res, "done", { reason: "max_turns" });
}

/**
 * Mark every pending proposal on `conversationId` as rejected and
 * persist a balanced `tool_result` user-message for each one, so the
 * conversation's assistant turn that emitted those tool_use blocks
 * stays structurally valid for Anthropic. Emits one SSE
 * `proposal_resolved` per cancelled proposal so the UI updates
 * pending cards to "Cancelled" in real time.
 *
 * `reason` is folded into the result error string so we can tell at
 * a glance whether the cancel came from a new user message
 * (`new_user_message`) or the trash-button cleanup endpoint
 * (`conversation_reset`). The healToolUseBalance pass in runLoop
 * picks up any prior read tool_uses we don't replay here.
 */
async function autoCancelPendingProposals(
  conversationId: string,
  res: Response | null,
  reason: "new_user_message" | "conversation_reset",
): Promise<number> {
  const pendings = await db
    .select()
    .from(assistantProposalsTable)
    .where(
      and(
        eq(assistantProposalsTable.conversationId, conversationId),
        eq(assistantProposalsTable.status, "pending"),
      ),
    )
    .orderBy(asc(assistantProposalsTable.createdAt));
  if (pendings.length === 0) return 0;
  const errMsg =
    reason === "new_user_message"
      ? "Superseded by a new user message"
      : "Superseded by conversation reset";
  for (const p of pendings) {
    await db
      .update(assistantProposalsTable)
      .set({
        status: "rejected",
        result: { error: errMsg },
        updatedAt: new Date(),
      })
      .where(eq(assistantProposalsTable.id, p.id));
    // Build a balanced user-message: a tool_result for the proposal's
    // own tool_use id plus one for every deferred tool_use the model
    // emitted alongside it. Any prior read tool_uses that aren't
    // covered here will be patched up by healToolUseBalance on the
    // next runLoop iteration.
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const deferredIds = Array.isArray(payload.deferredToolUseIds)
      ? (payload.deferredToolUseIds as string[])
      : [];
    const ids = [p.toolUseId, ...deferredIds].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    const blocks = ids.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: errMsg,
      is_error: true,
    }));
    if (blocks.length > 0) {
      await persistMessage(conversationId, "user", "", { blocks });
    }
    if (res) {
      sseSend(res, "proposal_resolved", {
        id: p.id,
        tool: p.toolName,
        status: "rejected",
        error: errMsg,
      });
    }
  }
  return pendings.length;
}

// ── DELETE /assistant/conversations/:id/pending ──
// Best-effort endpoint the web client fires when the operator hits
// the trash / "new conversation" button. It auto-cancels any pending
// proposals on the conversation so re-hydrating that conversation
// later (or any future view of it) doesn't trip the Anthropic
// missing-tool_result 400. Returns the count of cancelled proposals.
router.delete(
  "/assistant/conversations/:id/pending",
  async (req, res): Promise<void> => {
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
    const cancelled = await autoCancelPendingProposals(
      conv.id,
      null,
      "conversation_reset",
    );
    res.json({ cancelled });
  },
);

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

  const ctx = await resolveFocusCustomer(parseAssistantContext(req));

  sseInit(res);
  sseSend(res, "conversation", { id: conversationId });

  // Auto-cancel any pending proposals on this conversation BEFORE we
  // persist the new user message. If we didn't, the next runLoop call
  // would ship an assistant turn whose tool_use blocks have no
  // matching tool_result (the proposal's combined tool_result never
  // gets written until confirm/reject runs) followed by a plain
  // user-text message → Anthropic 400. Treating a fresh prompt as
  // "operator changed their mind about the pending proposal" matches
  // operator intent and keeps history balanced.
  await autoCancelPendingProposals(conversationId, res, "new_user_message");

  // Prepend a single bracketed "[Current state — page=…, scope=…,
  // focus=…]" line to the persisted user message (Task #668) so each
  // user turn carries the freshest page context as the most recent
  // thing in the model's view. Without this the model occasionally
  // resolves "this property" against an older turn's stale page.
  const stateLine = formatCurrentStateLine(ctx);
  await persistMessage(
    conversationId,
    "user",
    `${stateLine}\n${body.message}`,
  );

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
    sseSend(res, "proposal_resolved", {
      id: proposalId,
      tool: proposal.toolName,
      status: "rejected",
    });
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
    // when it would cross the effective scope (dropdown scope, or the
    // page-focus customer when the dropdown is "All").
    const ctx = await resolveFocusCustomer(parseAssistantContext(req));
    if (ctx.customerScopeId || ctx.focusCustomerId) {
      const implied = await impliedCustomerIdForWrite(proposal.toolName, finalInput);
      const decision = evaluateWriteScope(
        implied,
        {
          scopeCustomerId: ctx.customerScopeId,
          focusCustomerId: ctx.focusCustomerId,
        },
        { phase: "confirm" },
      );
      if (!decision.ok) {
        const errMsg = decision.reason;
        await db
          .update(assistantProposalsTable)
          .set({ status: "rejected", resolvedAt: new Date(), result: { error: errMsg } as any })
          .where(eq(assistantProposalsTable.id, proposalId));
        sseSend(res, "proposal_resolved", {
          id: proposalId,
          tool: proposal.toolName,
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
      // Snapshot the target row BEFORE we mutate so update_* / delete_*
      // can be reversed by replaying the snapshot. Creates need no
      // snapshot (the new id is enough to reverse).
      const snapshot = await captureSnapshot(proposal.toolName, finalInput);
      const result = await withSseKeepalive(res, () =>
        def.execute(finalInput, { userId }),
      );
      const undoPlan = buildUndoPlan(
        proposal.toolName,
        finalInput,
        result,
        snapshot,
      );
      const resultId = extractResultId(proposal.toolName, finalInput, result);
      // affectedIds is the full set of row ids this proposal touched
      // (single-row tools: [id]; bulk_create_*: every created id;
      // bulk_update_*: every updated id). The undo subsequent-edit
      // safety check uses it so a later update on any one of a
      // bulk_create's rows blocks the whole batch undo.
      const affectedIds = extractAffectedIds(undoPlan);
      await db
        .update(assistantProposalsTable)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          payload: { ...wrapped, input: finalInput, undoPlan, resultId, affectedIds },
          result: result as Record<string, unknown>,
        })
        .where(eq(assistantProposalsTable.id, proposalId));
      toolResultBlock = {
        type: "tool_result",
        tool_use_id: proposal.toolUseId,
        content: JSON.stringify(result).slice(0, 50_000),
      };
      sseSend(res, "proposal_resolved", {
        id: proposalId,
        tool: proposal.toolName,
        status: "approved",
        result,
        resultId,
        reversible: Boolean(undoPlan),
      });
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
      sseSend(res, "proposal_resolved", {
        id: proposalId,
        tool: proposal.toolName,
        status: "failed",
        error: message,
      });
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

  await runLoop(
    proposal.conversationId,
    res,
    await resolveFocusCustomer(parseAssistantContext(req)),
  );
  res.end();
});

// ── POST /assistant/proposals/:id/undo ─ reverse an approved write ──
router.post("/assistant/proposals/:id/undo", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const proposalId = req.params.id;
  const [proposal] = await db
    .select()
    .from(assistantProposalsTable)
    .where(eq(assistantProposalsTable.id, proposalId));
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
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
  if (proposal.status !== "approved") {
    res.status(409).json({ error: `Cannot undo a ${proposal.status} change` });
    return;
  }
  const payload = (proposal.payload ?? {}) as {
    undoPlan?: UndoPlan | null;
    resultId?: string | null;
    affectedIds?: string[] | null;
  };
  const plan = payload.undoPlan;
  if (!plan) {
    res.status(400).json({ error: "This change is not reversible" });
    return;
  }
  // Refuse undo if a more recent approved change exists on the same
  // entity row — undoing an older edit on top of a newer one would
  // silently clobber the operator's later work. They have to undo the
  // newer changes first (the UI exposes Undo only on the most recent
  // approved change for this reason; this is a defense-in-depth check).
  //
  // We compare the full set of ids each proposal touched (the new
  // `affectedIds` array, falling back to `resultId` for proposals
  // written before that field existed). This way a later
  // `update_utility` against any one of the rows a
  // `bulk_create_utilities` created blocks the whole batch undo.
  const targetIds = new Set<string>([
    ...((payload.affectedIds ?? []).filter((x) => typeof x === "string") as string[]),
  ]);
  if (payload.resultId) targetIds.add(payload.resultId);
  const subsequent = await db
    .select()
    .from(assistantProposalsTable)
    .where(eq(assistantProposalsTable.conversationId, proposal.conversationId))
    .orderBy(asc(assistantProposalsTable.createdAt));
  for (const p of subsequent) {
    if (p.id === proposal.id) continue;
    if (p.status !== "approved") continue;
    if (new Date(p.createdAt) <= new Date(proposal.createdAt)) continue;
    const pp = (p.payload ?? {}) as {
      resultId?: string | null;
      affectedIds?: string[] | null;
      undoPlan?: UndoPlan | null;
    };
    const ppIds = new Set<string>([
      ...((pp.affectedIds ?? []).filter((x) => typeof x === "string") as string[]),
    ]);
    if (pp.resultId) ppIds.add(pp.resultId);
    let overlaps = false;
    for (const id of ppIds) {
      if (targetIds.has(id)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      res.status(409).json({
        error:
          "A more recent change targets the same record — undo that one first.",
      });
      return;
    }
  }
  try {
    await executeUndoPlan(plan);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Undo failed" });
    return;
  }
  const [updated] = await db
    .update(assistantProposalsTable)
    .set({
      status: "undone",
      resolvedAt: new Date(),
    })
    .where(eq(assistantProposalsTable.id, proposalId))
    .returning();
  res.json({ proposal: updated });
});

// ── GET /assistant/changelog ─ every approved/undone write across all convos ──
router.get("/assistant/changelog", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const convs = await db
    .select()
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, userId));
  if (convs.length === 0) {
    res.json({ entries: [] });
    return;
  }
  const convById = new Map(convs.map((c) => [c.id, c]));
  const allProps = await db
    .select()
    .from(assistantProposalsTable)
    .orderBy(desc(assistantProposalsTable.resolvedAt));
  const entries = allProps
    .filter(
      (p) =>
        convById.has(p.conversationId) &&
        (p.status === "approved" || p.status === "undone"),
    )
    .map((p) => {
      const payload = (p.payload ?? {}) as { undoPlan?: unknown; resultId?: string };
      return {
        id: p.id,
        conversationId: p.conversationId,
        conversationTitle: convById.get(p.conversationId)?.title ?? "(untitled)",
        toolName: p.toolName,
        summary: p.summary,
        status: p.status,
        resultId: payload.resultId ?? null,
        reversible: Boolean(payload.undoPlan),
        createdAt: p.createdAt,
        resolvedAt: p.resolvedAt,
      };
    });
  res.json({ entries });
});

export default router;

