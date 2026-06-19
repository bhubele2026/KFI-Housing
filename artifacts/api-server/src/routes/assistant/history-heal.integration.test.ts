import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Task #666 — guards against the Anthropic 400 ("tool_use ids were found
// without tool_result blocks immediately after") that bricked the chat
// when the persisted history fell out of balance. Two layers of defense:
//   1. healToolUseBalance — pure helper, splices synthetic tool_result
//      blocks for any orphan tool_use id before each Anthropic call.
//   2. /assistant/chat auto-cancel — when an operator types a new prompt
//      while a proposal is still pending, the route rejects the
//      proposal and persists a balanced tool_result user-message so
//      history stays valid for the next call.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@workspace/db/schema");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    db,
    pool: { end: async () => { await client.close(); } },
    ...schema,
  };
});

const responseQueue: Array<Array<Record<string, unknown>>> = [];
const streamCalls: Array<Record<string, unknown>> = [];
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      stream: (args: Record<string, unknown>) => {
        streamCalls.push(args);
        const blocks = responseQueue.shift() ?? [
          { type: "text", text: "(no more queued)" },
        ];
        return {
          on(_event: string, _cb: unknown) {
            return this;
          },
          async finalMessage() {
            return { content: blocks };
          },
        };
      },
    },
  },
  ASSISTANT_MODEL: "test-model",
  ASSISTANT_EFFORT: "high",
  EXTRACTION_EFFORT: "low",
}));

const dbModule = await import("@workspace/db");
const {
  db,
  customersTable,
  propertiesTable,
  buildingsTable,
  roomsTable,
  bedsTable,
  assistantConversationsTable,
  assistantMessagesTable,
  assistantProposalsTable,
} = dbModule as typeof import("@workspace/db");
const { eq, asc } = await import("drizzle-orm");
const indexModule = await import("./index");
const assistantRouter = indexModule.default;
const { healToolUseBalance } = indexModule;

interface SseEvent {
  event: string;
  data: any;
}

async function readSse(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  const out: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (!data) continue;
    try {
      out.push({ event, data: JSON.parse(data) });
    } catch {
      out.push({ event, data });
    }
  }
  return out;
}

function focusHeader(entityType: string, entityId: string): string {
  return JSON.stringify({
    customerId: "ALL",
    focus: { entityType, entityId },
  });
}

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@workspace/db/schema");
  const { apply } = await pushSchema(schema as any, db as any);
  await apply();

  await db.insert(customersTable).values([{ id: "custA", name: "Customer A" }]);
  await db.insert(propertiesTable).values([
    { id: "propA", name: "Property A", customerId: "custA" },
  ]);
  await db.insert(buildingsTable).values([
    { id: "bldA", propertyId: "propA", name: "Building A" },
  ]);
  await db.insert(roomsTable).values([
    { id: "roomA1", propertyId: "propA", buildingId: "bldA", name: "A-101" },
  ]);
  await db.insert(bedsTable).values([
    { id: "bedA1", propertyId: "propA", roomId: "roomA1", bedNumber: 1 },
  ]);

  const app: Express = express();
  app.use(express.json());
  app.use(assistantRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  responseQueue.length = 0;
  streamCalls.length = 0;
});

describe("healToolUseBalance (unit)", () => {
  it("leaves a balanced history untouched", () => {
    const input = [
      { role: "user" as const, content: "hi" },
      {
        role: "assistant" as const,
        content: [
          { type: "tool_use", id: "tu-1", name: "x", input: {} },
        ],
      },
      {
        role: "user" as const,
        content: [
          { type: "tool_result", tool_use_id: "tu-1", content: "ok" },
        ],
      },
    ];
    const out = healToolUseBalance(input);
    expect(out).toEqual(input);
  });

  it("appends a synthetic tool_result when the following user message is missing the match", () => {
    const input = [
      {
        role: "assistant" as const,
        content: [
          { type: "tool_use", id: "tu-a", name: "x", input: {} },
          { type: "tool_use", id: "tu-b", name: "y", input: {} },
        ],
      },
      {
        role: "user" as const,
        content: [
          { type: "tool_result", tool_use_id: "tu-a", content: "ok" },
        ],
      },
    ];
    const out = healToolUseBalance(input);
    expect(out).toHaveLength(2);
    expect(out[1]!.role).toBe("user");
    const blocks = out[1]!.content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tool_use_id).toBe("tu-a");
    expect(blocks[1].tool_use_id).toBe("tu-b");
    expect(blocks[1].is_error).toBe(true);
    expect(blocks[1].content).toMatch(/Skipped/);
  });

  it("splices in a fresh user message when no following user message exists", () => {
    const input = [
      {
        role: "assistant" as const,
        content: [
          { type: "tool_use", id: "tu-1", name: "x", input: {} },
        ],
      },
    ];
    const out = healToolUseBalance(input);
    expect(out).toHaveLength(2);
    expect(out[1]!.role).toBe("user");
    const blocks = out[1]!.content as any[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].tool_use_id).toBe("tu-1");
    expect(blocks[0].is_error).toBe(true);
  });

  it("heals two consecutive assistant turns each with their own orphans", () => {
    const input = [
      {
        role: "assistant" as const,
        content: [{ type: "tool_use", id: "tu-1", name: "x", input: {} }],
      },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use", id: "tu-2", name: "y", input: {} }],
      },
    ];
    const out = healToolUseBalance(input);
    // Each assistant turn should now be followed by a synthetic user
    // tool_result message — four messages total, alternating roles.
    expect(out.map((m) => m.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect((out[1]!.content as any[])[0].tool_use_id).toBe("tu-1");
    expect((out[3]!.content as any[])[0].tool_use_id).toBe("tu-2");
  });
});

describe("Task #666 — /assistant/chat heals orphan tool_use and auto-cancels pending proposals", () => {
  it("heals an orphan tool_use before calling Anthropic and still produces a normal SSE turn", async () => {
    // Seed: assistant turn with a tool_use block, followed by a plain
    // user-text message (the malformed shape we observed in prod).
    const convId = "ac-heal-1";
    await db.insert(assistantConversationsTable).values({
      id: convId,
      userId: "anon",
      title: "orphan heal",
    });
    await db.insert(assistantMessagesTable).values([
      {
        id: "am-heal-1",
        conversationId: convId,
        role: "user",
        content: "make a bed",
        metadata: {},
      },
      {
        id: "am-heal-2",
        conversationId: convId,
        role: "assistant",
        content: "",
        metadata: {
          blocks: [
            {
              type: "tool_use",
              id: "tu-orphan",
              name: "update_bed",
              input: { id: "bedA1", cleaningStatus: "ready" },
            },
          ],
        },
      },
      {
        id: "am-heal-3",
        conversationId: convId,
        role: "user",
        content: "actually never mind, what's up",
        metadata: {},
      },
    ]);

    responseQueue.push([{ type: "text", text: "Sure, here you go." }]);

    const res = await fetch(`${baseUrl}/assistant/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({ conversationId: convId, message: "try again" }),
    });
    const events = await readSse(res);

    // No tool_error / error events; the SSE completes with `done`.
    expect(events.filter((e) => e.event === "tool_error")).toHaveLength(0);
    expect(events.filter((e) => e.event === "error")).toHaveLength(0);
    expect(events.some((e) => e.event === "done")).toBe(true);

    // Anthropic was called with a `messages` array where every
    // tool_use id has a matching tool_result in the next user message.
    expect(streamCalls.length).toBeGreaterThanOrEqual(1);
    const messages = streamCalls[0]!.messages as Array<{
      role: string;
      content: any;
    }>;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      const toolUseIds = (m.content as any[])
        .filter((b) => b?.type === "tool_use")
        .map((b) => b.id);
      if (toolUseIds.length === 0) continue;
      const next = messages[i + 1];
      expect(next).toBeDefined();
      expect(next!.role).toBe("user");
      expect(Array.isArray(next!.content)).toBe(true);
      const resolved = new Set(
        (next!.content as any[])
          .filter((b) => b?.type === "tool_result")
          .map((b) => b.tool_use_id),
      );
      for (const id of toolUseIds) {
        expect(resolved.has(id)).toBe(true);
      }
    }
  });

  it("auto-cancels a pending proposal when the operator sends a new chat message", async () => {
    const convId = "ac-cancel-1";
    const propId = "ap-cancel-1";
    await db.insert(assistantConversationsTable).values({
      id: convId,
      userId: "anon",
      title: "cancel on new send",
    });
    // The assistant turn that emitted the proposal's tool_use must
    // exist in the message log so healToolUseBalance has something
    // to anchor the synthetic tool_result onto.
    await db.insert(assistantMessagesTable).values([
      {
        id: "am-cancel-1",
        conversationId: convId,
        role: "user",
        content: "create a bed",
        metadata: {},
      },
      {
        id: "am-cancel-2",
        conversationId: convId,
        role: "assistant",
        content: "",
        metadata: {
          blocks: [
            {
              type: "tool_use",
              id: "tu-pending",
              name: "update_bed",
              input: { id: "bedA1", cleaningStatus: "ready" },
            },
          ],
        },
      },
    ]);
    await db.insert(assistantProposalsTable).values({
      id: propId,
      conversationId: convId,
      toolName: "update_bed",
      toolUseId: "tu-pending",
      summary: "Mark bedA1 ready",
      payload: {
        input: { id: "bedA1", cleaningStatus: "ready" },
        priorResults: [],
        deferredToolUseIds: [],
      },
      status: "pending",
    });

    responseQueue.push([{ type: "text", text: "Okay, moving on." }]);

    const res = await fetch(`${baseUrl}/assistant/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({
        conversationId: convId,
        message: "scratch that, what's the time",
      }),
    });
    const events = await readSse(res);

    // SSE emitted proposal_resolved with status rejected BEFORE done.
    const resolvedIdx = events.findIndex((e) => e.event === "proposal_resolved");
    const doneIdx = events.findIndex((e) => e.event === "done");
    expect(resolvedIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(resolvedIdx);
    expect(events[resolvedIdx]!.data.id).toBe(propId);
    expect(events[resolvedIdx]!.data.status).toBe("rejected");
    expect(events[resolvedIdx]!.data.error).toMatch(/[Ss]uperseded/);

    // DB row updated.
    const [row] = await db
      .select()
      .from(assistantProposalsTable)
      .where(eq(assistantProposalsTable.id, propId));
    expect(row?.status).toBe("rejected");
    expect((row?.result as any)?.error).toMatch(/superseded/i);

    // A tool_result user message with a block targeting the proposal's
    // toolUseId was persisted (so the assistant turn that emitted
    // tu-pending is now balanced).
    const msgs = await db
      .select()
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.conversationId, convId))
      .orderBy(asc(assistantMessagesTable.createdAt));
    const balancing = msgs.find((m) => {
      const blocks = (m.metadata as any)?.blocks;
      if (!Array.isArray(blocks)) return false;
      return blocks.some(
        (b: any) =>
          b?.type === "tool_result" && b?.tool_use_id === "tu-pending",
      );
    });
    expect(balancing).toBeDefined();
    expect(balancing!.role).toBe("user");
  });
});
