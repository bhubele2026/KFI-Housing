import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

interface OccupantRow {
  id: string;
  name: string;
  status: string;
  billingFrequency: string;
  chargeSource: string;
  shift: string | null;
  moveInDate: string;
  moveOutDate: string | null;
  chargePerBed: number;
  chargeSourceCustomer: string;
  chargeSourcePersonId: string;
}
interface RoomRow {
  id: string;
  propertyId: string;
  name: string;
}
interface BedRow {
  id: string;
  propertyId: string;
  status: string;
}
interface RoomNightLogRow {
  id: string;
  leaseId: string;
  month: string;
  roomNights: number;
  notes: string;
}
interface UtilityRow {
  id: string;
  propertyId: string;
  type: string;
}

const occupantStore = new Map<string, OccupantRow>();
const roomStore = new Map<string, RoomRow>();
const bedStore = new Map<string, BedRow>();
const roomNightLogStore = new Map<string, RoomNightLogRow>();
const utilityStore = new Map<string, UtilityRow>();

function fluentInsert<T extends { id: string }>(store: Map<string, T>) {
  return (_t: unknown) => ({
    values: (vals: T) => ({
      returning: () => {
        const row = { ...vals } as T;
        store.set(row.id, row);
        return [row];
      },
    }),
  });
}

function fluentUpdate<T extends { id: string }>(store: Map<string, T>) {
  return (_t: unknown) => ({
    set: (vals: Partial<T>) => ({
      where: (predicate: { id: string }) => ({
        returning: () => {
          const existing = store.get(predicate.id);
          if (!existing) return [];
          const merged = { ...existing, ...vals } as T;
          store.set(predicate.id, merged);
          return [merged];
        },
      }),
    }),
  });
}

function fluentSelect<T extends { id: string }>(store: Map<string, T>) {
  return () => ({
    from: (_t: unknown) => ({
      orderBy: () => Array.from(store.values()),
      where: (predicate: { id: string }) => {
        const row = store.get(predicate.id);
        return row ? [row] : [];
      },
      limit: () => [],
    }),
  });
}

const fakeDb = {
  select: (() => {
    const occSel = fluentSelect(occupantStore);
    const roomSel = fluentSelect(roomStore);
    const bedSel = fluentSelect(bedStore);
    const rnlSel = fluentSelect(roomNightLogStore);
    const utilSel = fluentSelect(utilityStore);
    return () => ({
      from: (t: { __table: string }) => {
        if (t.__table === "occupants") return occSel().from(t);
        if (t.__table === "rooms") return roomSel().from(t);
        if (t.__table === "beds") return bedSel().from(t);
        if (t.__table === "room_night_logs") return rnlSel().from(t);
        if (t.__table === "utilities") return utilSel().from(t);
        return occSel().from(t);
      },
    });
  })(),
  insert: (t: { __table: string }) => {
    if (t.__table === "occupants") return fluentInsert(occupantStore)(t);
    if (t.__table === "rooms") return fluentInsert(roomStore)(t);
    if (t.__table === "beds") return fluentInsert(bedStore)(t);
    if (t.__table === "room_night_logs") return fluentInsert(roomNightLogStore)(t);
    if (t.__table === "utilities") return fluentInsert(utilityStore)(t);
    return fluentInsert(occupantStore)(t);
  },
  update: (t: { __table: string }) => {
    if (t.__table === "occupants") return fluentUpdate(occupantStore)(t);
    if (t.__table === "rooms") return fluentUpdate(roomStore)(t);
    if (t.__table === "beds") return fluentUpdate(bedStore)(t);
    if (t.__table === "room_night_logs") return fluentUpdate(roomNightLogStore)(t);
    if (t.__table === "utilities") return fluentUpdate(utilityStore)(t);
    return fluentUpdate(occupantStore)(t);
  },
  delete: () => ({ where: () => undefined }),
};

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: { __table: "occupants", id: "id", chargeSource: "chargeSource", occupantId: "occupantId" },
  roomsTable: { __table: "rooms", id: "id" },
  bedsTable: { __table: "beds", id: "id", roomId: "roomId", occupantId: "occupantId" },
  roomNightLogsTable: { __table: "room_night_logs", id: "id" },
  utilitiesTable: { __table: "utilities", id: "id" },
}));

const passthrough = {
  safeParse: (data: unknown) => ({ success: true as const, data }),
  parse: (data: unknown) => data,
};

vi.mock("@workspace/api-zod", () => ({
  ListOccupantsResponse: passthrough,
  CreateOccupantBody: passthrough,
  UpdateOccupantParams: passthrough,
  UpdateOccupantBody: passthrough,
  UpdateOccupantResponse: passthrough,
  DeleteOccupantParams: passthrough,
  ListRoomsResponse: passthrough,
  CreateRoomBody: passthrough,
  UpdateRoomParams: passthrough,
  UpdateRoomBody: passthrough,
  UpdateRoomResponse: passthrough,
  DeleteRoomParams: passthrough,
  ListBedsResponse: passthrough,
  CreateBedBody: passthrough,
  UpdateBedParams: passthrough,
  UpdateBedBody: passthrough,
  UpdateBedResponse: passthrough,
  DeleteBedParams: passthrough,
  ListRoomNightLogsResponse: passthrough,
  CreateRoomNightLogBody: passthrough,
  UpdateRoomNightLogParams: passthrough,
  UpdateRoomNightLogBody: passthrough,
  UpdateRoomNightLogResponse: passthrough,
  DeleteRoomNightLogParams: passthrough,
  ListUtilitiesResponse: passthrough,
  CreateUtilityBody: passthrough,
  UpdateUtilityParams: passthrough,
  UpdateUtilityBody: passthrough,
  UpdateUtilityResponse: passthrough,
  DeleteUtilityParams: passthrough,
}));

const occupantsRouter = (await import("./occupants")).default;
const roomsRouter = (await import("./rooms")).default;
const bedsRouter = (await import("./beds")).default;
const roomNightLogsRouter = (await import("./room-night-logs")).default;
const utilitiesRouter = (await import("./utilities")).default;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", occupantsRouter);
  app.use("/api", roomsRouter);
  app.use("/api", bedsRouter);
  app.use("/api", roomNightLogsRouter);
  app.use("/api", utilitiesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  occupantStore.clear();
  roomStore.clear();
  bedStore.clear();
  roomNightLogStore.clear();
  utilityStore.clear();
});

describe("Task #375 — write-path normalizer for remaining resources", () => {
  it("POST /occupants coerces off-list status, billingFrequency, chargeSource, shift, and datetime dates", async () => {
    const res = await fetch(`${baseUrl}/api/occupants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "occ-1",
        name: "Jane Doe",
        status: "Pending",
        billingFrequency: "Quarterly",
        chargeSource: "magic",
        shift: "3rd",
        moveInDate: "2026-01-15 00:00:00",
        moveOutDate: "2026-06-30T23:59:59.000Z",
      }),
    });
    expect(res.status).toBe(201);
    const persisted = occupantStore.get("occ-1")!;
    expect(persisted.status).toBe("Active");
    expect(persisted.billingFrequency).toBe("Monthly");
    expect(persisted.chargeSource).toBe("");
    expect(persisted.shift).toBeNull();
    expect(persisted.moveInDate).toBe("2026-01-15");
    expect(persisted.moveOutDate).toBe("2026-06-30");
  });

  it("PATCH /occupants/:id coerces off-list status and billingFrequency", async () => {
    occupantStore.set("occ-2", {
      id: "occ-2",
      name: "John",
      status: "Active",
      billingFrequency: "Monthly",
      chargeSource: "",
      shift: null,
      moveInDate: "2025-01-01",
      moveOutDate: null,
      chargePerBed: 0,
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
    });

    const res = await fetch(`${baseUrl}/api/occupants/occ-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "Terminated",
        billingFrequency: "Annual",
      }),
    });
    expect(res.status).toBe(200);
    const persisted = occupantStore.get("occ-2")!;
    expect(persisted.status).toBe("Active");
    expect(persisted.billingFrequency).toBe("Monthly");
  });

  it("POST /rooms passes body through normalizeRoomRow (round-trips cleanly)", async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "rm-1", propertyId: "p1", name: "Room A" }),
    });
    expect(res.status).toBe(201);
    expect(roomStore.get("rm-1")?.name).toBe("Room A");
  });

  it("PATCH /rooms/:id passes body through normalizeRoomRow", async () => {
    roomStore.set("rm-2", { id: "rm-2", propertyId: "p1", name: "Old" });
    const res = await fetch(`${baseUrl}/api/rooms/rm-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    expect(roomStore.get("rm-2")?.name).toBe("New");
  });

  it("POST /beds coerces an off-list status before the DB write", async () => {
    const res = await fetch(`${baseUrl}/api/beds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "bed-1", propertyId: "p1", status: "Reserved" }),
    });
    expect(res.status).toBe(201);
    const persisted = bedStore.get("bed-1")!;
    expect(persisted.status).toBe("Vacant");
  });

  it("PATCH /beds/:id coerces an off-list status before the DB write", async () => {
    bedStore.set("bed-2", { id: "bed-2", propertyId: "p1", status: "Vacant" });
    const res = await fetch(`${baseUrl}/api/beds/bed-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Maintenance" }),
    });
    expect(res.status).toBe(200);
    const persisted = bedStore.get("bed-2")!;
    expect(persisted.status).toBe("Vacant");
  });

  it("POST /room-night-logs passes body through normalizeRoomNightLogRow (round-trips cleanly)", async () => {
    const res = await fetch(`${baseUrl}/api/room-night-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "rnl-1", leaseId: "l1", month: "2026-05", roomNights: 12, notes: "ok" }),
    });
    expect(res.status).toBe(201);
    expect(roomNightLogStore.get("rnl-1")?.roomNights).toBe(12);
  });

  it("PATCH /room-night-logs/:id passes body through normalizeRoomNightLogRow", async () => {
    roomNightLogStore.set("rnl-2", { id: "rnl-2", leaseId: "l1", month: "2026-04", roomNights: 5, notes: "" });
    const res = await fetch(`${baseUrl}/api/room-night-logs/rnl-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomNights: 10 }),
    });
    expect(res.status).toBe(200);
    expect(roomNightLogStore.get("rnl-2")?.roomNights).toBe(10);
  });

  it("POST /utilities coerces an off-list type before the DB write", async () => {
    const res = await fetch(`${baseUrl}/api/utilities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "u-1", propertyId: "p1", type: "Solar" }),
    });
    expect(res.status).toBe(201);
    const persisted = utilityStore.get("u-1")!;
    expect(persisted.type).toBe("Other");
  });

  it("PATCH /utilities/:id coerces an off-list type before the DB write", async () => {
    utilityStore.set("u-2", { id: "u-2", propertyId: "p1", type: "Electric" });
    const res = await fetch(`${baseUrl}/api/utilities/u-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "Wind" }),
    });
    expect(res.status).toBe(200);
    const persisted = utilityStore.get("u-2")!;
    expect(persisted.type).toBe("Other");
  });
});
