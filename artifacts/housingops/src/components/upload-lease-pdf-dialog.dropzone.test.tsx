import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression coverage for Task #622 — the standalone LeasePdfDropzone
// surface that the property-detail Leases tab renders above the table.
// The zone must share the dialog's PDF + 10 MB validation so the two
// entry points stay aligned: dropping the same junk file on the page
// vs. inside the dialog should yield the same "files skipped" toast,
// and accepted PDFs should be handed back via `onFilesAccepted` so
// the parent can hand them to the dialog's `pendingFiles` prop.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

import {
  LeasePdfDropzone,
  partitionLeasePdfFiles,
  MAX_LEASE_PDF_FILE_SIZE_BYTES,
} from "./upload-lease-pdf-dialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function makeFile(
  name: string,
  size: number,
  type: string = "application/pdf",
): File {
  // Create a blob of the requested size without actually allocating
  // big buffers — File's `size` is taken from the underlying bits.
  const bits = size > 0 ? [new Uint8Array(size)] : [];
  const f = new File(bits, name, { type });
  // Some jsdom builds don't honour the Uint8Array path; force-set the
  // size so the > 10 MB branch is reachable without allocating 11 MB.
  if (f.size !== size) {
    Object.defineProperty(f, "size", { value: size });
  }
  return f;
}

function dispatchDrop(target: Element, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      items: files.map((f) => ({
        kind: "file",
        getAsFile: () => f,
      })),
    },
  });
  target.dispatchEvent(event);
}

describe("partitionLeasePdfFiles (shared validator)", () => {
  it("accepts PDFs under the 10 MB cap and rejects non-PDFs + oversized files", () => {
    const ok = makeFile("lease.pdf", 1024);
    const tooBig = makeFile("huge.pdf", MAX_LEASE_PDF_FILE_SIZE_BYTES + 1);
    const wrongType = makeFile("notes.txt", 200, "text/plain");
    const pdfByExt = makeFile("lease2.PDF", 2048, "");

    const { accepted, rejected } = partitionLeasePdfFiles([
      ok,
      tooBig,
      wrongType,
      pdfByExt,
    ]);

    expect(accepted.map((f) => f.name)).toEqual(["lease.pdf", "lease2.PDF"]);
    expect(rejected).toHaveLength(2);
    // Order matches input order: huge.pdf (oversize) first, then notes.txt.
    expect(rejected[0]).toContain("huge.pdf");
    expect(rejected[0]).toContain("over 10 MB");
    expect(rejected[1]).toContain("notes.txt");
    expect(rejected[1]).toContain("not a PDF");
  });
});

describe("<LeasePdfDropzone />", () => {
  it("renders the headline + helper text and is keyboard-activatable", () => {
    const onFiles = vi.fn();
    act(() => {
      root.render(
        <LeasePdfDropzone
          onFilesAccepted={onFiles}
          headline="Drop lease PDFs here"
          helperText="Max 10 MB each."
        />,
      );
    });

    const zone = container.querySelector(
      '[data-testid="dropzone-lease-pdfs-inline"]',
    );
    expect(zone).not.toBeNull();
    expect(zone!.textContent).toContain("Drop lease PDFs here");
    expect(zone!.textContent).toContain("Max 10 MB each.");
    expect(zone!.getAttribute("role")).toBe("button");
    expect(zone!.getAttribute("tabindex")).toBe("0");
  });

  it("returns null when disabled (read-only callers)", () => {
    act(() => {
      root.render(
        <LeasePdfDropzone onFilesAccepted={vi.fn()} disabled />,
      );
    });
    expect(
      container.querySelector('[data-testid="dropzone-lease-pdfs-inline"]'),
    ).toBeNull();
  });

  it("hands accepted PDFs to onFilesAccepted when files are dropped", () => {
    const onFiles = vi.fn();
    act(() => {
      root.render(<LeasePdfDropzone onFilesAccepted={onFiles} />);
    });
    const zone = container.querySelector(
      '[data-testid="dropzone-lease-pdfs-inline"]',
    )!;
    const pdf = makeFile("signed-lease.pdf", 4096);
    act(() => {
      dispatchDrop(zone, [pdf]);
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(1);
    expect(onFiles.mock.calls[0][0][0].name).toBe("signed-lease.pdf");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("rejects non-PDFs and oversized files with the same destructive toast as the dialog, without calling onFilesAccepted", () => {
    const onFiles = vi.fn();
    act(() => {
      root.render(<LeasePdfDropzone onFilesAccepted={onFiles} />);
    });
    const zone = container.querySelector(
      '[data-testid="dropzone-lease-pdfs-inline"]',
    )!;
    const txt = makeFile("notes.txt", 100, "text/plain");
    const huge = makeFile("huge.pdf", MAX_LEASE_PDF_FILE_SIZE_BYTES + 1);
    act(() => {
      dispatchDrop(zone, [txt, huge]);
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
    const arg = toastMock.mock.calls[0][0];
    expect(arg.variant).toBe("destructive");
    expect(arg.title).toContain("2 files skipped");
    expect(arg.description).toContain("notes.txt");
    expect(arg.description).toContain("not a PDF");
    expect(arg.description).toContain("huge.pdf");
    expect(arg.description).toContain("over 10 MB");
  });

  it("mixes accepted + rejected: surfaces the skip toast AND forwards the accepted PDFs", () => {
    const onFiles = vi.fn();
    act(() => {
      root.render(<LeasePdfDropzone onFilesAccepted={onFiles} />);
    });
    const zone = container.querySelector(
      '[data-testid="dropzone-lease-pdfs-inline"]',
    )!;
    const pdf = makeFile("good.pdf", 1024);
    const txt = makeFile("bad.txt", 100, "text/plain");
    act(() => {
      dispatchDrop(zone, [pdf, txt]);
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(["good.pdf"]);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].title).toBe("File skipped");
  });
});
