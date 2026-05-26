import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Task #658 — end-to-end coverage of the page-focus scope guard against
// a real Postgres-shaped database (PGlite). The unit tests in
// scope-guard.test.ts pin down the pure decision function. This suite
// proves the full chain still works: focus header parsed → focused
// entity resolved against the real schema (customerIdForFocus) →
// impliedCustomerIdForWrite walks the seeded property/room/bed graph →
// evaluateWriteScope allows or refuses the proposal at /assistant/chat
// AND re-runs the same guard on /assistant/confirm when the operator
// edits a parent id to cross customers.
// ---------------------------------------------------------------------------

// 1) Substitute @workspace/db with a PGlite-backed drizzle instance that
//    exposes every schema export the assistant routes import. Reusing
//    the package's own `schema` barrel keeps the table identity stable
//    across the route module and the test code, so `db.insert(...)`
//    calls in both places hit the same table descriptors.
vi.mock("@workspace/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@workspace/db/schema");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    db,
    pool: {
      end: async () => {
        await client.close();
      },
    },
    ...schema,
  };
});

// 2) The anthropic client is a singleton that throws at import unless
//    the AI integration env vars are set. We don't want any real LLM
//    calls in an integration test; instead we hand back a tiny
//    queueable fake whose stream produces a pre-canned list of content
//    blocks (text + tool_use) per invocation.
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
}));

// Imports happen AFTER the mocks above so the mocked modules are
// picked up by the route under test.
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
const { eq } = await import("drizzle-orm");
const assistantRouter = (await import("./index")).default;

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

function focusHeader(
  entityType: string,
  entityId: string,
  scope: "ALL" | string = "ALL",
): string {
  return JSON.stringify({
    customerId: scope,
    focus: { entityType, entityId },
  });
}

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  // Push the full drizzle schema into the PGlite instance the mock
  // returned. Mirrors lib/db/src/migrate.integration.test.ts but
  // calls drizzle-kit/api directly because we don't need the
  // migrate.ts boot-sequence helpers (PGlite starts empty — there's
  // no legacy shape to back-fill).
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@workspace/db/schema");
  const { apply } = await pushSchema(schema as any, db as any);
  await apply();

  // Two customers, each with one property → building → room → bed.
  // The scope guard walks bed → property → customerId, so seeding
  // through the full chain proves customerIdForRow's real SQL works
  // end-to-end (not just the pure decision function).
  await db.insert(customersTable).values([
    { id: "custA", name: "Customer A" },
    { id: "custB", name: "Customer B" },
  ]);
  await db.insert(propertiesTable).values([
    { id: "propA", name: "Property A", customerId: "custA" },
    { id: "propB", name: "Property B", customerId: "custB" },
  ]);
  await db.insert(buildingsTable).values([
    { id: "bldA", propertyId: "propA", name: "Building A" },
    { id: "bldB", propertyId: "propB", name: "Building B" },
  ]);
  await db.insert(roomsTable).values([
    { id: "roomA1", propertyId: "propA", buildingId: "bldA", name: "A-101" },
    { id: "roomB1", propertyId: "propB", buildingId: "bldB", name: "B-101" },
  ]);
  await db.insert(bedsTable).values([
    { id: "bedA1", propertyId: "propA", roomId: "roomA1", bedNumber: 1 },
    { id: "bedB1", propertyId: "propB", roomId: "roomB1", bedNumber: 1 },
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

describe("Task #658 — page-focus scope guard end-to-end against a real DB", () => {
  it("allows a write whose target falls under the focused customer (dropdown 'All')", async () => {
    // Operator is on Property A's page (customer A). Dropdown is
    // "All". The model proposes update_bed on bedA1, which lives
    // under propA → custA. Guard MUST allow.
    responseQueue.push([
      {
        type: "tool_use",
        id: "tu-allow",
        name: "update_bed",
        input: { id: "bedA1", cleaningStatus: "ready" },
      },
    ]);

    const res = await fetch(`${baseUrl}/assistant/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({ message: "mark this bed ready" }),
    });
    const events = await readSse(res);

    expect(events.filter((e) => e.event === "tool_error")).toHaveLength(0);
    const proposals = events.filter((e) => e.event === "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].data.tool).toBe("update_bed");

    const [row] = await db
      .select()
      .from(assistantProposalsTable)
      .where(eq(assistantProposalsTable.id, proposals[0].data.id as string));
    expect(row?.status).toBe("pending");
  });

  it("refuses a write targeting a different customer's property under the focused customer", async () => {
    // Same focus (propA / custA) with dropdown still "All". This time
    // the model proposes update_room on roomB1 (custB). The guard
    // refuses at the propose phase with a message that names BOTH
    // the offending target customer and the focus customer.
    responseQueue.push([
      {
        type: "tool_use",
        id: "tu-refuse",
        name: "update_room",
        input: { id: "roomB1", name: "renamed" },
      },
    ]);
    // After the tool_error is folded back as a user-role tool_result,
    // runLoop re-invokes the model — give it a stop message so the
    // loop terminates instead of hitting MAX_TURNS.
    responseQueue.push([{ type: "text", text: "(noted, will not proceed)" }]);

    const res = await fetch(`${baseUrl}/assistant/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({ message: "rename roomB1" }),
    });
    const events = await readSse(res);

    expect(events.filter((e) => e.event === "proposal")).toHaveLength(0);
    const errs = events.filter((e) => e.event === "tool_error");
    expect(errs).toHaveLength(1);
    const message = errs[0].data.message as string;
    expect(message).toMatch(/^Refused:/);
    expect(message).toContain("custB");
    expect(message).toContain("custA");
    expect(message).toContain("current page belongs to");
  });

  it("re-runs the guard on /assistant/confirm when the operator edits the target id across customers", async () => {
    // Seed a pending proposal for update_bed on bedA1 (custA — the
    // focus customer). On confirm the operator edits `id` to bedB1
    // (custB). impliedCustomerIdForWrite re-resolves ownership from
    // the EDITED input and the guard refuses with the "on confirm"
    // phase prefix, naming both customers.
    const convId = "ac-int-3";
    const propId = "ap-int-3";
    await db.insert(assistantConversationsTable).values({
      id: convId,
      userId: "anon",
      title: "scope guard confirm",
    });
    await db.insert(assistantProposalsTable).values({
      id: propId,
      conversationId: convId,
      toolName: "update_bed",
      toolUseId: "tu-confirm",
      summary: "Update bed bedA1",
      payload: {
        input: { id: "bedA1", cleaningStatus: "ready" },
        priorResults: [],
        deferredToolUseIds: [],
      },
      status: "pending",
    });

    // After the refusal path persists the synthetic tool_result, the
    // confirm handler hands off to runLoop. Queue a plain text stop
    // so the loop exits cleanly without us needing the real model.
    responseQueue.push([{ type: "text", text: "(refused, stop)" }]);

    const res = await fetch(`${baseUrl}/assistant/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({
        proposalId: propId,
        approve: true,
        edits: { id: "bedB1" },
      }),
    });
    const events = await readSse(res);

    const resolved = events.find((e) => e.event === "proposal_resolved");
    expect(resolved).toBeDefined();
    expect(resolved!.data.status).toBe("rejected");
    const err = resolved!.data.error as string;
    expect(err).toMatch(/^Refused on confirm:/);
    expect(err).toContain("custB");
    expect(err).toContain("custA");
    expect(err).toContain("current page belongs to");

    const [updated] = await db
      .select()
      .from(assistantProposalsTable)
      .where(eq(assistantProposalsTable.id, propId));
    expect(updated?.status).toBe("rejected");
  });
});

describe("Task #664 — pre-#663 scope refusals must not poison new turns", () => {
  it("strengthens the system prompt and still proposes a write when prior turns contain stale scope-refusal tool_errors", async () => {
    // Seed a conversation whose history contains a fake pre-#663
    // scope refusal: an assistant turn with a tool_use, then a user
    // turn whose tool_result is the old buggy error string ("active
    // customer scope is All"). Without the strengthened system note
    // the model would pattern-match its own prior refusal and refuse
    // again in plain prose without ever calling a tool.
    const convId = "ac-poisoned-1";
    await db.insert(assistantConversationsTable).values({
      id: convId,
      userId: "anon",
      title: "poisoned history",
    });
    await db.insert(assistantMessagesTable).values([
      {
        id: "am-poisoned-1",
        conversationId: convId,
        role: "user",
        content: "mark this bed ready",
        metadata: {},
      },
      {
        id: "am-poisoned-2",
        conversationId: convId,
        role: "assistant",
        content: "",
        metadata: {
          blocks: [
            {
              type: "tool_use",
              id: "tu-old-1",
              name: "update_bed",
              input: { id: "bedA1", cleaningStatus: "ready" },
            },
          ],
        },
      },
      {
        id: "am-poisoned-3",
        conversationId: convId,
        role: "user",
        content: "",
        metadata: {
          blocks: [
            {
              type: "tool_result",
              tool_use_id: "tu-old-1",
              content:
                "Refused: this write targets custA but the active customer scope is All. Ask the operator to switch the scope dropdown first.",
              is_error: true,
            },
          ],
        },
      },
    ]);

    // The model (post-fix) should ignore the stale refusal and try
    // the write again. Queue a fresh tool_use for it; the guard now
    // allows it because focus=propA → custA matches bedA1's owner.
    responseQueue.push([
      {
        type: "tool_use",
        id: "tu-new-1",
        name: "update_bed",
        input: { id: "bedA1", cleaningStatus: "ready" },
      },
    ]);

    const res = await fetch(`${baseUrl}/assistant/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistant-context": focusHeader("property", "propA"),
      },
      body: JSON.stringify({
        conversationId: convId,
        message: "try again",
      }),
    });
    const events = await readSse(res);

    // The strengthened scope note must show up in the system prompt
    // we hand to Anthropic — this is what tells the model to stop
    // pattern-matching its prior refusal.
    expect(streamCalls.length).toBeGreaterThanOrEqual(1);
    const systemPrompt = String(streamCalls[0]!.system ?? "");
    expect(systemPrompt).toContain("current page belongs to customer custA");
    expect(systemPrompt).toMatch(/IGNORE any earlier scope refusals/);
    expect(systemPrompt).toMatch(/older guard build/);

    // And the write proposal still gets created — the guard does
    // not block it, and the prior poisoned tool_error did not cause
    // the route to short-circuit.
    expect(events.filter((e) => e.event === "tool_error")).toHaveLength(0);
    const proposals = events.filter((e) => e.event === "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].data.tool).toBe("update_bed");
  });
});
