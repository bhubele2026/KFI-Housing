import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "./index";

// End-to-end Spanish coverage for the operator's daily flow. Mounts
// Dashboard, Leases, Properties, and Settings under
// `i18n.language === "es"` and asserts both the PageHeader title and a
// handful of in-body labels render in Spanish. The shared
// `test-setup.ts` already turns on `saveMissing` + a `missingKey`
// listener — this suite simply asserts no Spanish key was missing.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, Legend: Stub, ResponsiveContainer: Stub,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// Radix portals don't render inline in jsdom; pass-through stubs let
// the page bodies + PageHeader render so we can read their text.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass, DialogTrigger: Pass, DialogContent: () => null,
    DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass,
    DialogFooter: Pass, DialogClose: Pass, DialogPortal: Pass, DialogOverlay: () => null,
  };
});
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: () => null,
    DropdownMenuItem: Pass, DropdownMenuLabel: Pass, DropdownMenuSeparator: Pass,
    DropdownMenuGroup: Pass, DropdownMenuPortal: Pass,
    DropdownMenuCheckboxItem: Pass, DropdownMenuRadioItem: Pass, DropdownMenuRadioGroup: Pass,
    DropdownMenuShortcut: Pass, DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass, DropdownMenuSubContent: Pass,
  };
});
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: () => null, TooltipProvider: Pass };
});
vi.mock("@/components/ui/hover-card", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { HoverCard: Pass, HoverCardTrigger: Pass, HoverCardContent: () => null };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogTrigger: Pass, AlertDialogContent: Pass,
    AlertDialogHeader: Pass, AlertDialogTitle: Pass, AlertDialogDescription: Pass,
    AlertDialogFooter: Pass, AlertDialogAction: Pass, AlertDialogCancel: Pass,
    AlertDialogPortal: Pass, AlertDialogOverlay: () => null,
  };
});
vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: () => null, PopoverAnchor: Pass };
});
vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectContent: Pass, SelectGroup: Pass, SelectItem: Pass, SelectLabel: Pass,
    SelectScrollDownButton: Pass, SelectScrollUpButton: Pass, SelectSeparator: Pass,
    SelectTrigger: Pass, SelectValue: Pass,
  };
});

vi.mock("@/components/add-lease-dialog", () => ({ AddLeaseDialog: () => null }));
vi.mock("@/components/upload-lease-pdf-dialog", () => ({ UploadLeasePdfDialog: () => null }));
vi.mock("@/components/import-master-leases-button", () => ({ ImportMasterLeasesButton: () => null }));
vi.mock("@/components/last-auto-import-indicator", () => ({ LastAutoImportIndicator: () => null }));
vi.mock("@/components/leases-table", () => ({ LeasesTable: () => null }));
vi.mock("@/components/portfolio-map", () => ({ PortfolioMap: () => null }));
vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/components/assign-occupant-dialog", () => ({ AssignOccupantDialog: () => null }));

vi.mock("@workspace/api-client-react", () => ({
  useListUnplacedPayroll: () => ({ data: { unmatched: [], lowConfidenceMatches: [] } }),
  getListUnplacedPayrollQueryKey: () => ["/payroll/unplaced"],
  useListRoomNightLogs: () => ({ data: [] }),
  useGetLastAutoMasterImport: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetRuntimeConfig: () => ({
    data: { googleMapsApiKey: "test-key", googleMapsMapId: "test-map-id" },
    isPending: false, isLoading: false, isError: false, isSuccess: true,
    error: null, status: "success", fetchStatus: "idle",
  }),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
  useListDigestRecipients: () => ({ data: [], isLoading: false }),
  useCreateDigestRecipient: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteDigestRecipient: () => ({ mutate: vi.fn(), isPending: false }),
  getListDigestRecipientsQueryKey: () => ["/api/digest-recipients"] as const,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

const emptyStore = {
  customers: [], properties: [], beds: [], rooms: [], leases: [], utilities: [],
  insuranceCertificates: [], occupants: [],
  isLoading: false,
  dataIssues: [] as Array<Record<string, unknown>>,
  addCustomer: vi.fn(), addProperty: vi.fn(), addLease: vi.fn(),
  updateLease: vi.fn(), deleteLease: vi.fn(),
  addOccupant: vi.fn(), updateBed: vi.fn(), updateOccupant: vi.fn(),
};
vi.mock("@/context/data-store", () => ({
  useData: () => emptyStore,
  RoomInUseError: class RoomInUseError extends Error {},
}));

// `@workspace/object-storage-web` re-exports a chain that vitest's
// transform pipeline can't currently resolve (also breaks
// `properties.test.tsx`; tracked as a follow-up). The pages mounted
// here don't touch the uploader, so a no-op stub keeps the import
// graph intact.
vi.mock("@workspace/object-storage-web", () => ({
  useUpload: () => ({ upload: vi.fn(), uploading: false, progress: 0, error: null, reset: vi.fn() }),
  ObjectUploader: () => null,
}));

import Dashboard from "@/pages/dashboard";
import Leases from "@/pages/leases";
import Properties from "@/pages/properties";
import Settings from "@/pages/settings";
import { CustomerScopeProvider } from "@/context/customer-scope";

function mount(node: ReactNode, container: HTMLDivElement): Root {
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<CustomerScopeProvider>{node}</CustomerScopeProvider>);
  });
  return root;
}

function readTitle(container: HTMLElement): string {
  const el = container.querySelector('[data-testid="page-header-title"]');
  if (!el) throw new Error("page-header-title not found");
  return el.textContent ?? "";
}

function readDescription(container: HTMLElement): string | null {
  const el = container.querySelector('[data-testid="page-header-description"]');
  return el ? el.textContent : null;
}

function languageButtonAria(container: HTMLElement, lng: "en" | "es"): string | null {
  const el = container.querySelector(`[data-testid="button-language-${lng}"]`);
  return el ? el.getAttribute("aria-label") : null;
}

function spanishMissingKeys(): string[] {
  return globalThis.__missingI18nKeys
    .filter((m) => m.lng?.startsWith("es"))
    .map((m) => m.key);
}

describe("Spanish-language end-to-end coverage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(async () => {
    globalThis.__missingI18nKeys.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      await i18n.changeLanguage("es");
    });
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => { r.unmount(); });
      root = null;
    }
    container.remove();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("Dashboard renders header and the property-performance card in Spanish", async () => {
    await act(async () => { root = mount(<Dashboard />, container); });

    expect(readTitle(container)).toBe("Panel");
    expect(readDescription(container)).toBe(
      "Resumen de tus operaciones de alojamiento y finanzas.",
    );

    // In-body labels driven by `t("dashboardExtra.*")` — guards against
    // a key being added to the English bundle without a Spanish
    // counterpart.
    const text = container.textContent ?? "";
    expect(text).toContain("Rendimiento por propiedad");
    expect(text).toContain("Propiedad");
    expect(text).toContain("Ocupación");
    expect(text).toContain("Ganancia/Pérdida");

    // Metric card titles + trend sub-labels (task #556) — these were
    // hard-coded English before this assertion landed.
    expect(text).toContain("Propiedades");
    expect(text).toContain("Camas totales");
    expect(text).toContain("Ingresos mensuales");
    expect(text).toContain("Costos mensuales");
    expect(text).toContain("Utilidad neta");
    expect(text).toContain("Renta / cama");
    expect(text).toContain("Electricidad / cama");
    expect(text).toContain("Renta + electricidad / cama");
    expect(text).toContain("Objetivo: $45k");
    expect(text).toContain("Contratos + servicios");

    // Occupancy Rate card.
    expect(text).toContain("Tasa de ocupación");

    // Top Properties by Rating card — title, sort label, table headers,
    // and the "No properties yet" empty state with its action button.
    expect(text).toContain("Mejores propiedades por calificación");
    expect(text).toContain("Ordenar por");
    expect(text).toContain("Aún no hay propiedades");
    expect(text).toContain(
      "Agrega tu primera propiedad para empezar a clasificar a las mejores aquí.",
    );
    expect(text).toContain("Agregar propiedad");

    // Financial Overview card title (swept alongside the dashboard).
    expect(text).toContain("Resumen financiero");

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Dashboard reconciliation actions and cross-employer dialog render in Spanish", async () => {
    // Seed a recent reconciliation entry so the audit-trail card
    // renders the "Undo" button (otherwise the card hides itself and
    // the assertion below would silently pass on no rendered text).
    const { recordPayrollReconciliation, __resetRecentPayrollReconciliationsForTests } =
      await import("@/lib/recent-payroll-reconciliations");
    __resetRecentPayrollReconciliationsForTests();
    recordPayrollReconciliation({
      id: "rec-1",
      occupantId: "occ-1",
      occupantName: "Alice Example",
      propertyName: "123 Main",
      employer: "Acme",
      weekly: 100,
      kind: "typo",
      timestamp: Date.now(),
      prev: {
        chargePerBed: 90,
        billingFrequency: "Weekly",
        employeeId: "EMP-1",
        company: "Acme",
      },
    });

    await act(async () => { root = mount(<Dashboard />, container); });

    const text = container.textContent ?? "";
    // Audit-trail row's Undo button.
    expect(text).toContain("Deshacer");
    // Property Performance card never has rows in this empty store, so
    // the Profit/Loss badge isn't rendered. We still want to guard
    // against the literal slipping back in, so assert the bundle has
    // the Spanish copy and the English copy is gone from the page.
    expect(i18n.t("pages.dashboard.performance.profitBadge")).toBe("Ganancia");
    expect(i18n.t("pages.dashboard.performance.lossBadge")).toBe("Pérdida");
    expect(text).not.toContain("Profit");
    expect(text).not.toContain("Loss");

    // Cross-employer confirm dialog is gated by state and its
    // AlertDialog is mocked to only render when `open=true` — assert
    // the bundle contains the Spanish copy so a regression on the key
    // would still trip CI.
    expect(i18n.t("pages.dashboard.crossEmployer.confirmTitle")).toBe(
      "¿Deshacer cambio de empleador cruzado?",
    );
    expect(i18n.t("pages.dashboard.crossEmployer.undoChange")).toBe(
      "Deshacer cambio",
    );

    // Lease expiry alerts card and employer-move dialog copy:
    // these blocks are conditionally rendered, so guard against
    // regressions at the bundle level.
    expect(i18n.t("pages.dashboard.leaseExpiry.title")).toBe(
      "Alertas de vencimiento de contratos",
    );
    expect(i18n.t("pages.dashboard.leaseExpiry.sendPreview")).toBe(
      "Enviar vista previa",
    );
    expect(i18n.t("pages.dashboard.leaseExpiry.helperText")).toContain(
      "Contratos que vencen",
    );
    expect(
      i18n.t("pages.dashboard.leaseExpiry.leaseCount", { count: 1 }),
    ).toBe("1 contrato");
    expect(
      i18n.t("pages.dashboard.leaseExpiry.leaseCount", { count: 3 }),
    ).toBe("3 contratos");
    expect(i18n.t("pages.dashboard.employerMove.confirmTitle")).toBe(
      "¿Mover ocupante a un nuevo empleador?",
    );
    expect(i18n.t("pages.dashboard.employerMove.confirm")).toBe(
      "Mover ocupante",
    );
    expect(i18n.t("pages.dashboard.employerMove.undoAltText")).toBe(
      "Deshacer cambio de empleador",
    );

    // Recently-reconciled audit-trail card chrome (task #556 follow-up).
    // The card is rendered (we seeded an entry above), so assert the
    // header copy + the relative-time formatter both produce Spanish.
    expect(text).toContain("Conciliados recientemente desde nómina");
    expect(text).toContain("Ocupante");
    // Relative time helper now reads from i18n. The seeded entry is
    // "just now" (timestamp = Date.now()), so the cell should render
    // the Spanish form.
    expect(text).toContain("ahora mismo");

    // Bundle-level guards for the cards/dialogs that don't render
    // against an empty store but are part of this task's scope.
    expect(i18n.t("pages.dashboard.relativeTime.justNow")).toBe("ahora mismo");
    expect(
      i18n.t("pages.dashboard.relativeTime.minutesAgo", { count: 2 }),
    ).toContain("min");
    expect(i18n.t("pages.dashboard.undoToast.failedTitle")).toBe(
      "Error al deshacer",
    );
    expect(i18n.t("pages.dashboard.undoToast.completeTitle")).toBe(
      "Deshacer completado",
    );
    expect(i18n.t("pages.dashboard.reclaim.claimedTitle")).toBe(
      "Reclamado desde nómina",
    );
    expect(
      i18n.t("pages.dashboard.reclaim.allClaimedDescription", { count: 2 }),
    ).toContain("ocupantes");
    expect(
      i18n.t("pages.dashboard.needsReviewItems.hotelRateAtRiskLabel", {
        month: "Mar",
      }),
    ).toContain("Mar");
    expect(i18n.t("pages.dashboard.expiry.expiresToday")).toBe("Vence hoy");
    expect(
      i18n.t("pages.dashboard.expiry.daysLeft", { count: 5 }),
    ).toContain("días");
    expect(i18n.t("pages.dashboard.noticeDeadline.title")).toBe(
      "Plazo de aviso próximo",
    );
    expect(i18n.t("pages.dashboard.lowOccupancy.title")).toBe(
      "Ocupación combinada baja",
    );
    expect(i18n.t("pages.dashboard.insurance.title")).toBe(
      "Alertas de vencimiento de seguros",
    );
    expect(i18n.t("pages.dashboard.customerPaidRent.title")).toBe(
      "Renta mensual pagada por el cliente",
    );
    expect(i18n.t("pages.dashboard.payrollMismatches.title")).toBe(
      "Revisar discrepancias de nómina",
    );
    expect(i18n.t("pages.dashboard.payrollMismatches.reclaim")).toBe(
      "Reclamar",
    );
    expect(i18n.t("pages.dashboard.confirmMatch.title")).toBe(
      "Confirmar coincidencia",
    );
    expect(i18n.t("pages.dashboard.confirmMatch.didYouMean")).toBe(
      "¿Quisiste decir:",
    );
    expect(i18n.t("pages.dashboard.digest.dryRunTitle")).toBe(
      "Previsualizar resumen (simulación)",
    );
    expect(i18n.t("pages.dashboard.digest.adminSecretLabel")).toBe(
      "Clave de administrador",
    );
    expect(i18n.t("pages.dashboard.digest.emailPreviewTitle")).toBe(
      "Vista previa del correo del resumen",
    );
    expect(i18n.t("pages.dashboard.digest.sendNowToRecipients")).toBe(
      "Enviar ahora a destinatarios",
    );

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Leases renders header and language toggle button labels in Spanish", async () => {
    await act(async () => { root = mount(<Leases />, container); });

    expect(readTitle(container)).toBe("Contratos");
    expect(readDescription(container)).toBe("Gestiona los contratos maestros de arriendo");

    // The LanguageToggle in the PageHeader actions slot composes three
    // nested `t(...)` calls — `language.switchTo` interpolated with
    // `language.english` / `language.spanish`. Asserting the resulting
    // aria-labels exercises real in-body Spanish output that isn't
    // part of the header text itself.
    expect(languageButtonAria(container, "en")).toBe("Cambiar a Inglés");
    expect(languageButtonAria(container, "es")).toBe("Cambiar a Español");

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Properties renders header and language toggle button labels in Spanish", async () => {
    await act(async () => { root = mount(<Properties />, container); });

    expect(readTitle(container)).toBe("Propiedades");
    expect(readDescription(container)).toBe("Selecciona una propiedad para gestionarla");

    expect(languageButtonAria(container, "en")).toBe("Cambiar a Inglés");
    expect(languageButtonAria(container, "es")).toBe("Cambiar a Español");

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Settings renders header and the digest-recipients card in Spanish", async () => {
    await act(async () => { root = mount(<Settings />, container); });

    expect(readTitle(container)).toBe("Ajustes");

    // In-body labels driven by `t("settings.*")` — these were
    // hard-coded English before this suite landed, so this assertion
    // also catches anyone re-introducing a literal English string in
    // the digest-recipients card.
    const text = container.textContent ?? "";
    expect(text).toContain("Destinatarios del resumen semanal de contratos");
    expect(text).toContain("Estos correos reciben el resumen semanal");
    expect(text).toContain("Añadir");

    expect(spanishMissingKeys()).toEqual([]);
  });
});
