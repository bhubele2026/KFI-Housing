import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Bed, Occupant, ProjectedMoveIn, Room } from "@/data/mockData";

// ── Hoisted mock state ─────────────────────────────────────────────────
// The mocked api-client-react hooks read/write through these closures so
// individual tests can swap the list response or capture mutation calls.
const { state, toastMock } = vi.hoisted(() => {
  type MutateCallbacks<TData = unknown> = {
    onSuccess?: (data: TData) => void;
    onError?: (err: Error) => void;
    onSettled?: () => void;
  };
  return {
    state: {
      list: [] as ProjectedMoveIn[],
      createCalls: [] as Array<{
        vars: { id: string; data: Record<string, unknown> };
        cb: MutateCallbacks;
      }>,
      updateCalls: [] as Array<{
        vars: {
          id: string;
          moveInId: string;
          data: Record<string, unknown>;
        };
        cb: MutateCallbacks;
      }>,
      deleteCalls: [] as Array<{
        vars: { id: string; moveInId: string };
        cb: MutateCallbacks;
      }>,
      convertCalls: [] as Array<{
        vars: {
          id: string;
          moveInId: string;
          data: { bedId?: string | null };
        };
        cb: MutateCallbacks;
      }>,
    },
    toastMock: vi.fn(),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// ConfirmDeleteButton wraps the trash icon in an AlertDialog. The dialog
// portal interferes with happy-dom, so collapse it to "click trigger ⇒
// fire onConfirm immediately" — the dialog UX is exercised by its own
// dedicated test file.
vi.mock("@/components/confirm-delete-button", () => ({
  ConfirmDeleteButton: ({
    trigger,
    onConfirm,
    testId,
  }: {
    trigger: ReactNode;
    onConfirm: () => void;
    testId?: string;
  }) => (
    <span data-testid={testId} onClick={onConfirm}>
      {trigger}
    </span>
  ),
}));

// Reduce the Select to a plain native <select> so tests can change the
// "bed" dropdown by setting the value directly. The component reads the
// chosen value via the `onValueChange` callback, which mirrors what
// Radix's Select fires.
vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children?: ReactNode;
  }) {
    // Walk the tree to find SelectItems and surface them as <option>s.
    const opts: Array<{ value: string; label: string }> = [];
    const walk = (node: unknown) => {
      if (node == null) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === "object" && node && "props" in node) {
        const p = (node as { props: Record<string, unknown> }).props ?? {};
        const v = p.value;
        const ch = p.children;
        if (typeof v === "string" && (typeof ch === "string" || typeof ch === "number")) {
          opts.push({ value: v, label: String(ch) });
        }
        if ("children" in p) walk(ch);
      }
    };
    walk(children);
    return (
      <select
        data-testid="select-projected-bed"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return {
    Select,
    SelectContent: Pass,
    SelectItem: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useListProjectedMoveIns: () => ({ data: state.list }),
  useCreateProjectedMoveIn: () => ({
    mutate: (vars: { id: string; data: Record<string, unknown> }, cb: unknown) => {
      state.createCalls.push({
        vars,
        cb: (cb ?? {}) as Parameters<typeof state.createCalls.push>[0]["cb"],
      });
    },
  }),
  useUpdateProjectedMoveIn: () => ({
    mutate: (
      vars: { id: string; moveInId: string; data: Record<string, unknown> },
      cb: unknown,
    ) => {
      state.updateCalls.push({
        vars,
        cb: (cb ?? {}) as Parameters<typeof state.updateCalls.push>[0]["cb"],
      });
    },
  }),
  useDeleteProjectedMoveIn: () => ({
    mutate: (vars: { id: string; moveInId: string }, cb: unknown) => {
      state.deleteCalls.push({
        vars,
        cb: (cb ?? {}) as Parameters<typeof state.deleteCalls.push>[0]["cb"],
      });
    },
  }),
  useConvertProjectedMoveIn: () => ({
    mutate: (
      vars: {
        id: string;
        moveInId: string;
        data: { bedId?: string | null };
      },
      cb: unknown,
    ) => {
      state.convertCalls.push({
        vars,
        cb: (cb ?? {}) as Parameters<typeof state.convertCalls.push>[0]["cb"],
      });
    },
  }),
  getListProjectedMoveInsQueryKey: (id: string) => [
    `/api/properties/${id}/projected-move-ins`,
  ],
  getListBedsQueryKey: () => ["/api/beds"],
  getListOccupantsQueryKey: () => ["/api/occupants"],
}));

import { ProjectedMoveInsSection } from "./projected-move-ins-section";

// ── Helpers ────────────────────────────────────────────────────────────
function setReactInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("value setter unavailable");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function makeRow(overrides: Partial<ProjectedMoveIn> = {}): ProjectedMoveIn {
  return {
    id: "pmi-1",
    propertyId: "p1",
    personName: "Maria Santos",
    projectedMoveInDate: "2026-06-15",
    bedId: null,
    notes: "",
    convertedOccupantId: null,
    ...overrides,
  };
}

function ymdOffset(days: number): string {
  const now = new Date();
  const t = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) +
      days * 24 * 60 * 60 * 1000,
  );
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const rooms: Room[] = [
  {
    id: "r1",
    propertyId: "p1",
    name: "Master",
    sqft: 0,
    bathrooms: 0,
    monthlyRent: 0,
  } as unknown as Room,
];
const beds: Bed[] = [
  {
    id: "b1",
    propertyId: "p1",
    bedNumber: 1,
    roomId: "r1",
    status: "Vacant",
    occupantId: null,
    cleaningStatus: "ready",
  } as unknown as Bed,
];
const occupants: Occupant[] = [];

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root | null = null;

function Harness() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectedMoveInsSection
        propertyId="p1"
        propRooms={rooms}
        propBeds={beds}
        propOccupants={occupants}
      />
    </QueryClientProvider>
  );
}

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
  });
}

beforeEach(() => {
  state.list = [];
  state.createCalls.length = 0;
  state.updateCalls.length = 0;
  state.deleteCalls.length = 0;
  state.convertCalls.length = 0;
  toastMock.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => {
      r.unmount();
    });
    root = null;
  }
  container.remove();
  queryClient.clear();
});

describe("ProjectedMoveInsSection — rendering", () => {
  it("shows the empty state and zeroed badges when there are no projections", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="text-projected-empty"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="badge-projected-total"]')!
        .textContent,
    ).toContain("0 planned");
    expect(
      container.querySelector('[data-testid="badge-projected-overdue"]')!
        .textContent,
    ).toContain("0 overdue");
  });

  it("renders one row per projection and counts overdue + next-7 in the badges", async () => {
    state.list = [
      makeRow({ id: "pmi-overdue", projectedMoveInDate: ymdOffset(-3) }),
      makeRow({ id: "pmi-soon", projectedMoveInDate: ymdOffset(2) }),
      makeRow({ id: "pmi-future", projectedMoveInDate: ymdOffset(30) }),
    ];
    await render();
    const list = container.querySelector(
      '[data-testid="list-projected-move-ins"]',
    );
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li").length).toBe(3);
    expect(
      container.querySelector('[data-testid="badge-projected-total"]')!
        .textContent,
    ).toContain("3 planned");
    expect(
      container.querySelector('[data-testid="badge-projected-overdue"]')!
        .textContent,
    ).toContain("1 overdue");
    expect(
      container.querySelector('[data-testid="badge-projected-next7"]')!
        .textContent,
    ).toContain("1 in next 7 days");
  });

  it("flags an overdue row with a destructive badge and a future row with the muted variant", async () => {
    state.list = [
      makeRow({ id: "pmi-overdue", projectedMoveInDate: ymdOffset(-2) }),
      makeRow({ id: "pmi-future", projectedMoveInDate: ymdOffset(20) }),
    ];
    await render();
    const overdueBadge = container.querySelector(
      '[data-testid="badge-projected-flag-pmi-overdue"]',
    );
    const futureBadge = container.querySelector(
      '[data-testid="badge-projected-flag-pmi-future"]',
    );
    expect(overdueBadge).not.toBeNull();
    expect(overdueBadge!.textContent).toContain("Overdue");
    expect(overdueBadge!.className).toContain("rose");
    expect(futureBadge).not.toBeNull();
    expect(futureBadge!.textContent).toContain("In 20d");
  });
});

describe("ProjectedMoveInsSection — add row", () => {
  it("calls createMut and writes an optimistic row into the cache", async () => {
    await render();
    const nameInput = container.querySelector(
      '[data-testid="input-projected-name"]',
    ) as HTMLInputElement;
    const dateInput = container.querySelector(
      '[data-testid="input-projected-date"]',
    ) as HTMLInputElement;
    const notesInput = container.querySelector(
      '[data-testid="input-projected-notes"]',
    ) as HTMLInputElement;
    const addButton = container.querySelector(
      '[data-testid="button-projected-add"]',
    ) as HTMLButtonElement;

    await act(async () => {
      setReactInputValue(nameInput, "Pat New");
      setReactInputValue(dateInput, "2026-08-01");
      setReactInputValue(notesInput, "joining day shift");
    });
    await act(async () => {
      addButton.click();
    });

    expect(state.createCalls).toHaveLength(1);
    const call = state.createCalls[0];
    expect(call.vars.id).toBe("p1");
    expect(call.vars.data).toMatchObject({
      personName: "Pat New",
      projectedMoveInDate: "2026-08-01",
      bedId: null,
      notes: "joining day shift",
    });

    // Optimistic insert lands in the react-query cache under the same
    // key the section reads from.
    const cached = queryClient.getQueryData<ProjectedMoveIn[]>([
      `/api/properties/p1/projected-move-ins`,
    ]);
    expect(cached).toHaveLength(1);
    expect(cached![0].personName).toBe("Pat New");
  });

  it("blocks adding when the name is empty and surfaces a destructive toast", async () => {
    await render();
    const dateInput = container.querySelector(
      '[data-testid="input-projected-date"]',
    ) as HTMLInputElement;
    const addButton = container.querySelector(
      '[data-testid="button-projected-add"]',
    ) as HTMLButtonElement;
    await act(async () => {
      setReactInputValue(dateInput, "2026-08-01");
    });
    await act(async () => {
      addButton.click();
    });

    expect(state.createCalls).toHaveLength(0);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "Name required",
      variant: "destructive",
    });
  });
});

describe("ProjectedMoveInsSection — convert flow", () => {
  it("refuses to convert a row with no bed and shows a 'Pick a bed first' toast", async () => {
    state.list = [makeRow({ id: "pmi-1", bedId: null })];
    await render();
    const btn = container.querySelector(
      '[data-testid="button-projected-convert-pmi-1"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(state.convertCalls).toHaveLength(0);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "Pick a bed first",
      variant: "destructive",
    });
  });

  it("on success: drops the row from the cache and shows a 'Moved in' toast", async () => {
    state.list = [makeRow({ id: "pmi-1", bedId: "b1" })];
    queryClient.setQueryData(
      [`/api/properties/p1/projected-move-ins`],
      state.list,
    );
    await render();
    const btn = container.querySelector(
      '[data-testid="button-projected-convert-pmi-1"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(state.convertCalls).toHaveLength(1);
    expect(state.convertCalls[0].vars).toMatchObject({
      id: "p1",
      moveInId: "pmi-1",
      data: { bedId: "b1" },
    });

    // Fire the success callback the way the real mutation would.
    await act(async () => {
      state.convertCalls[0].cb.onSuccess?.({});
    });

    const cached = queryClient.getQueryData<ProjectedMoveIn[]>([
      `/api/properties/p1/projected-move-ins`,
    ]);
    expect(cached).toEqual([]);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "Moved in",
    });
  });

  it("on error: surfaces the server's message in a destructive toast", async () => {
    state.list = [makeRow({ id: "pmi-1", bedId: "b1" })];
    await render();
    const btn = container.querySelector(
      '[data-testid="button-projected-convert-pmi-1"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    expect(state.convertCalls).toHaveLength(1);
    await act(async () => {
      state.convertCalls[0].cb.onError?.(
        new Error("Bed is currently occupied by another occupant — vacate it first."),
      );
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const arg = toastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.title).toBe("Couldn't move them in");
    expect(arg.variant).toBe("destructive");
    expect(String(arg.description)).toContain("currently occupied");
  });
});
