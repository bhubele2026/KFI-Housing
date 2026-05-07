import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The Leases page shows this small badge next to the "Import master file"
// button so an operator can confirm at-a-glance that the bundled-workbook
// boot import did its job. Two failure modes are silent without this
// component flipping into a warning style (Task #340):
//
//   • the boot import has never succeeded on the current api-server
//     process (e.g. fresh deploy that errored on its first attempt), and
//   • the bundled `Housing_Lease_MASTER_*.xlsx` was modified after the
//     last successful boot import — i.e. someone dropped a fresh master
//     file but a restart is needed before it picks up.
//
// Both branches must use a visually distinct warning treatment that
// stands out from the muted "everything is fine" timestamp variant, so
// the tests below pin the `data-variant` contract that the parent page
// (and any future automated tests) can assert against.

const useGetLastAutoMasterImportMock = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetLastAutoMasterImport: () => useGetLastAutoMasterImportMock(),
}));

const { LastAutoImportIndicator } = await import(
  "./last-auto-import-indicator"
);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LastAutoImportIndicator", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useGetLastAutoMasterImportMock.mockReset();
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
  });

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<LastAutoImportIndicator />);
    });
  }

  function badge() {
    return container.querySelector('[data-testid="text-last-auto-import"]');
  }

  it("renders the muted ok variant when the recorded import is at least as new as the bundled workbook", async () => {
    const ranAt = "2026-05-01T12:00:00.000Z";
    const bundledMtime = "2026-04-30T12:00:00.000Z";
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: {
        ranAt,
        bundledMtime,
        customersCreated: 1,
        customersUpdated: 2,
        propertiesCreated: 3,
        propertiesUpdated: 4,
        leasesCreated: 5,
        leasesUpdated: 6,
        leasesSkipped: 0,
      },
      isLoading: false,
      isError: false,
    });
    await render();
    const el = badge();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("ok");
    expect(el!.textContent ?? "").toContain("Last auto-imported on");
    // The plain variant must NOT include the warning-only restart copy
    // — otherwise operators learn to ignore the warning entirely.
    expect(el!.textContent ?? "").not.toMatch(/restart/i);
  });

  it("flips to a 'never-succeeded' warning variant when ranAt is null (fresh deploy whose first boot import errored)", async () => {
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: { ranAt: null, bundledMtime: "2026-05-01T00:00:00.000Z" },
      isLoading: false,
      isError: false,
    });
    await render();
    const el = badge();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("never-succeeded");
    // The warning variant must point operators at the logs — without
    // that, the badge is just a vague "something's off" signal.
    expect((el!.textContent ?? "").toLowerCase()).toContain("logs");
  });

  it("flips to a 'stale' warning variant when the bundled workbook is newer than the last successful boot import", async () => {
    const ranAt = "2026-05-01T00:00:00.000Z";
    const bundledMtime = "2026-05-06T00:00:00.000Z";
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: {
        ranAt,
        bundledMtime,
        customersCreated: 0,
        customersUpdated: 0,
        propertiesCreated: 0,
        propertiesUpdated: 0,
        leasesCreated: 0,
        leasesUpdated: 0,
        leasesSkipped: 0,
      },
      isLoading: false,
      isError: false,
    });
    await render();
    const el = badge();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("stale");
    // Must tell the operator the actionable next step — restarting the
    // api-server is the only way the boot import will pick up the new
    // bundled workbook.
    expect((el!.textContent ?? "").toLowerCase()).toMatch(/restart/);
  });

  it("stays on the muted ok variant when the API hasn't shipped a bundledMtime yet (defensive — never falsely warn)", async () => {
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: {
        ranAt: "2026-05-01T00:00:00.000Z",
        bundledMtime: null,
        customersCreated: 0,
        customersUpdated: 0,
        propertiesCreated: 0,
        propertiesUpdated: 0,
        leasesCreated: 0,
        leasesUpdated: 0,
        leasesSkipped: 0,
      },
      isLoading: false,
      isError: false,
    });
    await render();
    const el = badge();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("ok");
  });

  it("renders nothing while the query is still loading so the layout doesn't flicker", async () => {
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    await render();
    expect(container.innerHTML).toBe("");
  });

  it("falls back to a muted 'unknown' label when the request fails outright", async () => {
    useGetLastAutoMasterImportMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    await render();
    const el = badge();
    expect(el).not.toBeNull();
    expect((el!.textContent ?? "").toLowerCase()).toContain("unknown");
  });
});
