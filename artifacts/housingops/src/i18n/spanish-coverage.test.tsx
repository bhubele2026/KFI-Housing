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
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), isPending: false }),
  getListPropertyViolationsQueryKey: (id: string) => ["/api/properties", id, "violations"] as const,
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
  insuranceCertificates: [], occupants: [], otherCosts: [], roomNightLogs: [],
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

// Per-test mutable wouter overrides so a few specific tests can mount
// pages that depend on `useParams()` (CustomerDetail, PropertyDetail)
// against a seeded fixture instead of only the not-found branch.
const wouterParams: { current: Record<string, string> } = { current: {} };
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useParams: () => wouterParams.current,
    useLocation: () => ["/", () => {}] as const,
  };
});

import Dashboard from "@/pages/dashboard";
import Leases from "@/pages/leases";
import Properties from "@/pages/properties";
import Settings from "@/pages/settings";
import Customers from "@/pages/customers";
import Beds from "@/pages/beds";
import Utilities from "@/pages/utilities";
import Occupants from "@/pages/occupants";
import Finance from "@/pages/finance";
import InsuranceCertificates from "@/pages/insurance-certificates";
import PropertyDetail from "@/pages/property-detail";
import CustomerDetail from "@/pages/customer-detail";
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

  it("Properties geocode toast strings translate to Spanish", () => {
    expect(i18n.t("toasts.geocode.couldntLocateTitle")).toBe(
      "No se pudo localizar la dirección",
    );
    expect(
      i18n.t("toasts.geocode.couldntLocateDescription", { name: "Acme" }),
    ).toContain("Acme");
    expect(i18n.t("toasts.geocode.couldntRetryTitle")).toBe(
      "No se pudo reintentar",
    );
    expect(i18n.t("toasts.geocode.stillCouldntPinpointTitle")).toBe(
      "Aún no se pudo localizar",
    );
    expect(i18n.t("toasts.geocode.foundItTitle")).toBe("Encontrada");
    expect(i18n.t("toasts.geocode.retryFailedTitle")).toBe(
      "Falló el reintento",
    );
    expect(i18n.t("toasts.geocode.allPinpointedTitle")).toBe(
      "Todas las direcciones localizadas",
    );
    expect(
      i18n.t("toasts.geocode.allPinpointedDescription", { count: 1 }),
    ).toBe("Se corrigió la 1 dirección marcada.");
    expect(
      i18n.t("toasts.geocode.allPinpointedDescription", { count: 5 }),
    ).toBe("Se corrigieron las 5 direcciones marcadas.");
    expect(i18n.t("toasts.geocode.nonePinpointedTitle")).toBe(
      "No se pudo localizar ninguna dirección",
    );
    expect(
      i18n.t("toasts.geocode.fixedSomeTitle", { fixed: 2, total: 5 }),
    ).toBe("Corregidas 2 de 5");
    expect(i18n.t("toasts.unknownCustomer")).toBe("Cliente desconocido");
    expect(i18n.t("toasts.couldNotAddRecipient")).toBe(
      "No se pudo añadir el destinatario.",
    );
  });

  it("Properties renders header and language toggle button labels in Spanish", async () => {
    await act(async () => { root = mount(<Properties />, container); });

    expect(readTitle(container)).toBe("Propiedades");
    expect(readDescription(container)).toBe("Selecciona una propiedad para gestionarla");

    expect(languageButtonAria(container, "en")).toBe("Cambiar a Inglés");
    expect(languageButtonAria(container, "es")).toBe("Cambiar a Español");

    const text = container.textContent ?? "";
    expect(text).toContain("Tabla");
    expect(text).toContain("Mapa");
    expect(text).toContain("Descargar CSV");
    // Rating filters
    expect(text).toContain("Cualquier calificación");
    expect(text).toContain("3+ estrellas");
    expect(text).toContain("4+ estrellas");
    expect(text).toContain("5 estrellas");
    // Table headers
    expect(text).toContain("Propiedad");
    expect(text).toContain("Cliente");
    expect(text).toContain("Camas totales");
    expect(text).toContain("Vacantes");
    expect(text).not.toContain("Download CSV");
    expect(text).not.toContain(">Table<");
    expect(text).not.toContain(">Map<");
    expect(text).not.toContain("Any rating");
    expect(text).not.toContain("3+ stars");
    expect(text).not.toContain("Min rating");
    expect(text).not.toContain("Rating category");
    expect(text).not.toContain(">Property<");
    expect(text).not.toContain(">Customer<");
    expect(text).not.toContain(">Address<");
    expect(text).not.toContain(">City<");
    expect(text).not.toContain("Total Beds");
    expect(text).not.toContain(">Status<");
    expect(text).not.toContain("No properties match the current filters.");
    expect(text).not.toContain("Missing address");
    expect(text).not.toContain("Every property in view has an address");
    // Add-property dialog and needs-review badge English originals
    expect(text).not.toContain("Showing properties missing rent");
    expect(text).not.toContain("Clear needs-review filter");
    expect(text).not.toContain(">Add property<");
    expect(text).not.toContain("Property name *");
    expect(text).not.toContain("Customer *");
    expect(text).not.toContain("Choose a customer");
    expect(text).not.toContain("Create new customer");
    expect(text).not.toContain("Company name *");
    expect(text).not.toContain(">Contact<");
    expect(text).not.toContain(">Phone<");
    expect(text).not.toContain(">Type<");
    expect(text).not.toContain("No type");

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Leases renders Download CSV button in Spanish", async () => {
    await act(async () => { root = mount(<Leases />, container); });
    const text = container.textContent ?? "";
    expect(text).toContain("Descargar CSV");
    expect(text).not.toContain("Download CSV");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Customers renders header, action buttons, table headers and empty-state in Spanish", async () => {
    await act(async () => { root = mount(<Customers />, container); });
    expect(readTitle(container)).toBe("Clientes");
    const text = container.textContent ?? "";
    expect(text).toContain("Aún no hay clientes");
    expect(text).toContain("Descargar CSV");
    expect(text).toContain("Agregar cliente");
    expect(text).toContain("Cliente");
    expect(text).toContain("Contacto principal");
    expect(text).toContain("Correo");
    expect(text).toContain("Teléfono");
    expect(text).not.toContain("Add Customer");
    expect(text).not.toContain("Download CSV");
    expect(text).not.toContain("Primary Contact");
    expect(text).not.toContain("Highest occupancy");
    expect(text).not.toContain("Highest monthly revenue");
    expect(text).not.toContain("Revenue / mo");
    expect(text).not.toContain("No Housing / Reason");
    expect(text).not.toContain(">Properties<");
    expect(text).not.toContain(">Beds<");
    expect(text).not.toContain(">Actions<");
    // No-housing reason labels translate to ES (bundle-level guards
    // since the dropdown options live inside Radix portals not rendered
    // in this jsdom mount).
    expect(i18n.t("common.noHousingReasons.provided_by_client")).toBe(
      "Proporcionado por el cliente",
    );
    expect(i18n.t("common.noHousingReasons.kfis_property")).toBe(
      "Propiedad de KFIS",
    );
    expect(i18n.t("common.noHousingReasons.all_associates_local")).toBe(
      "Todos los empleados viven localmente",
    );
    // Unassigned-state group label translates to ES.
    expect(i18n.t("pages.customers.unassignedStateLabel")).toBe(
      "Otro / Sin asignar",
    );
    expect(text).not.toContain("Other / Unassigned");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Beds renders empty-state and filters in Spanish", async () => {
    await act(async () => { root = mount(<Beds />, container); });
    expect(readTitle(container)).toBe("Camas");
    const text = container.textContent ?? "";
    expect(text).toContain("No se encontraron camas");
    expect(text).toContain("Descargar CSV");
    expect(text).not.toContain("Download CSV");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Utilities renders empty-state and chrome in Spanish", async () => {
    await act(async () => { root = mount(<Utilities />, container); });
    expect(readTitle(container)).toBe("Servicios");
    const text = container.textContent ?? "";
    expect(text).toContain("No se encontraron servicios públicos");
    expect(text).toContain("Descargar CSV");
    // Utility type filter options translate to ES
    expect(text).toContain("Electricidad");
    expect(text).toContain("Agua");
    expect(text).toContain("Basura");
    expect(text).toContain("Propano");
    expect(text).not.toContain("Download CSV");
    expect(text).not.toContain("Total Monthly");
    expect(text).not.toContain(">Electric<");
    expect(text).not.toContain(">Water<");
    expect(text).not.toContain(">Garbage<");
    expect(text).not.toContain(">Propane<");
    // Bundle-level guards for utility type labels
    expect(i18n.t("common.utilityTypes.Electric")).toBe("Electricidad");
    expect(i18n.t("common.utilityTypes.Water")).toBe("Agua");
    expect(i18n.t("common.utilityTypes.Garbage")).toBe("Basura");
    // Bundle-level guards for property-detail responsibilities + bed tooltip
    expect(i18n.t("pages.propertyDetail.responsibilities.removeTitle")).toBe(
      "Quitar responsabilidad",
    );
    expect(i18n.t("pages.propertyDetail.responsibilities.placeholder")).toBe(
      "ej. Sacar la basura los lunes",
    );
    expect(
      i18n.t("pages.propertyDetail.bedTooltipLabel", { number: 3, suffix: "" }),
    ).toBe("Cama 3");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Occupants renders empty-state, filters and action buttons in Spanish", async () => {
    await act(async () => { root = mount(<Occupants />, container); });
    expect(readTitle(container)).toBe("Ocupantes");
    const text = container.textContent ?? "";
    expect(text).toContain("No se encontraron ocupantes");
    expect(text).toContain("Descargar CSV");
    expect(text).toContain("Agregar ocupante");
    expect(text).not.toContain("Add Occupant");
    expect(text).not.toContain("Download CSV");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Finance renders empty-state in Spanish", async () => {
    await act(async () => { root = mount(<Finance />, container); });
    expect(readTitle(container)).toBe("Finanzas");
    const text = container.textContent ?? "";
    expect(text).toContain("Aún no hay propiedades");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Insurance Certificates renders empty-state and chrome in Spanish", async () => {
    await act(async () => { root = mount(<InsuranceCertificates />, container); });
    expect(readTitle(container)).toBe("Certificados de seguro");
    const text = container.textContent ?? "";
    expect(text).toContain("No hay certificados de seguro");
    expect(text).toContain("Descargar CSV");
    expect(text).not.toContain("Download CSV");
    expect(text).not.toContain("Coverage Alerts");
    // Bundle-level guards for conditionally-rendered alerts/badges:
    expect(i18n.t("pages.insurance.coverageAlerts")).toBe("Alertas de cobertura");
    expect(i18n.t("pages.insurance.expiredCount", { count: 1 })).toBe("1 vencido");
    expect(i18n.t("pages.insurance.expiredCount", { count: 3 })).toBe("3 vencidos");
    expect(i18n.t("pages.insurance.deleteTitle")).toBe(
      i18n.t("pages.insurance.deleteTitle", { lng: "es" }),
    );
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Property Detail renders not-found screen in Spanish", async () => {
    await act(async () => { root = mount(<PropertyDetail />, container); });
    const text = container.textContent ?? "";
    expect(text).toContain("Propiedad no encontrada");
    expect(text).toContain("Volver a Propiedades");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Customer Detail renders not-found screen in Spanish", async () => {
    await act(async () => { root = mount(<CustomerDetail />, container); });
    const text = container.textContent ?? "";
    expect(text).toContain("Cliente no encontrado");
    expect(text).toContain("Volver a Clientes");
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Property Detail renders body content in Spanish when seeded", async () => {
    const fixtureProperty = {
      id: "pd-fixture",
      customerId: "",
      name: "Fixture House",
      address: "1 Main St",
      city: "Madison",
      state: "WI",
      zip: "53703",
      totalBeds: 0,
      monthlyRent: 0,
      chargePerBed: 0,
      status: "Active",
      landlordName: "",
      landlordEmail: "",
      landlordPhone: "",
      paymentMethod: "ACH",
      paymentRecipient: "",
      paymentDueDay: 1,
      paymentNotes: "",
      bankName: "",
      bankRouting: "",
      bankAccount: "",
      portalUrl: "",
      notes: "",
      furnishings: [] as string[],
    };
    emptyStore.properties.push(fixtureProperty as never);
    wouterParams.current = { id: "pd-fixture" };
    try {
      await act(async () => { root = mount(<PropertyDetail />, container); });
      const text = container.textContent ?? "";
      // Tabs
      expect(text).toContain("Información");
      expect(text).toContain("Contratos");
      expect(text).toContain("Camas");
      expect(text).toContain("Mobiliario");
      expect(text).toContain("Finanzas");
      // Stat cards
      expect(text).toContain("Camas totales");
      expect(text).toContain("Ocupadas");
      expect(text).toContain("Disponibles");
      expect(text).toContain("Ingresos mensuales");
      // Property Details card
      expect(text).toContain("Detalles de la propiedad");
      expect(text).toContain("Nombre de la propiedad");
      expect(text).toContain("Dirección");
      expect(text).toContain("Ciudad");
      expect(text).toContain("Notas");
      // Payment Details card
      expect(text).toContain("Detalles de pago");
      expect(text).toContain("Método de pago");
      expect(text).toContain("Núm. de ruta");
      // Bed Occupancy card (BedMap)
      expect(text).toContain("Ocupación de camas");
      // Ratings card (renders on Info tab)
      expect(text).toContain("Calificaciones");
      expect(text).toContain("Aún sin calificaciones");
      expect(text).toContain("Limpieza");
      expect(text).toContain("Comodidades");
      // No English leaks for the strings translated by this task
      expect(text).not.toContain("No ratings yet");
      expect(text).not.toContain(">Overall<");
      expect(text).not.toContain(">Landlord<");
      expect(text).not.toContain(">Cleanliness<");
      expect(text).not.toContain(">Amenities<");
      expect(text).not.toContain(">Occupants<");
      expect(text).not.toContain("Value for Money");
      expect(text).not.toContain("Total Beds");
      expect(text).not.toContain("Property Details");
      expect(text).not.toContain("Property Name");
      expect(text).not.toContain("Payment Details");
      expect(text).not.toContain("Payment Method");
      expect(text).not.toContain("Routing #");
      expect(text).not.toContain("Account #");
      expect(text).not.toContain("Bed Occupancy");
      // Property type / billing frequency / violation category labels
      // translate to ES (bundle-level guards — these dropdown options
      // and per-row badges live in tabs not visible on the default Info
      // mount, but we still need to guarantee the keys resolve).
      expect(i18n.t("common.propertyTypes.Town house")).toBe("Casa adosada");
      expect(i18n.t("common.propertyTypes.Apartment")).toBe("Apartamento");
      expect(i18n.t("common.propertyTypes.Motel")).toBe("Motel");
      expect(i18n.t("common.billingFrequencies.Weekly")).toBe("Semanal");
      expect(i18n.t("common.billingFrequencies.Biweekly")).toBe("Quincenal");
      expect(i18n.t("common.billingFrequencies.Monthly")).toBe("Mensual");
      expect(i18n.t("common.violationCategories.smoking")).toBe("Fumar");
      expect(i18n.t("common.violationCategories.parking")).toBe(
        "Estacionamiento",
      );
      expect(i18n.t("common.violationCategories.noise")).toBe("Ruido");
      expect(i18n.t("common.violationCategories.cleanliness")).toBe(
        "Limpieza",
      );
      expect(spanishMissingKeys()).toEqual([]);
    } finally {
      emptyStore.properties.length = 0;
      wouterParams.current = {};
    }
  });

  it("Customer Detail renders body content in Spanish when seeded", async () => {
    const fixtureCustomer = {
      id: "cd-fixture",
      name: "Fixture Co",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
      state: "WI",
      customShifts: [] as string[],
      noHousingReason: null,
    };
    emptyStore.customers.push(fixtureCustomer as never);
    wouterParams.current = { id: "cd-fixture" };
    try {
      await act(async () => { root = mount(<CustomerDetail />, container); });
      const text = container.textContent ?? "";
      // Header + breadcrumb
      expect(text).toContain("Clientes");
      // Stat cards (Spanish)
      expect(text).toContain("Propiedades");
      expect(text).toContain("Camas");
      expect(text).toContain("Ocupación");
      expect(text).toContain("Ingresos mensuales");
      expect(text).toContain("en todas las propiedades");
      // Customer-paid rent section
      expect(text).toContain("Renta mensual pagada por el cliente");
      expect(text).toContain("Ningún contrato está marcado");
      // Revenue trend
      expect(text).toContain("Tendencia de ingresos");
      // Contact card
      expect(text).toContain("Contacto");
      expect(text).toContain("Contacto principal");
      expect(text).toContain("Correo");
      expect(text).toContain("Teléfono");
      expect(text).toContain("Notas");
      expect(text).toContain("Este cliente aún no tiene propiedades.");
      // No English leaks for the body strings
      expect(text).not.toContain("Highest occupancy");
      expect(text).not.toContain("Monthly Revenue");
      expect(text).not.toContain("Customer-paid monthly rent");
      expect(text).not.toContain("No leases are currently flagged");
      expect(text).not.toContain("Revenue Trend");
      expect(text).not.toContain("This customer has no properties yet");
      expect(text).not.toContain(">Contact<");
      expect(text).not.toContain("Primary contact");
      expect(text).not.toContain(">Email<");
      expect(text).not.toContain(">Phone<");
      expect(text).not.toContain(">Notes<");
      expect(spanishMissingKeys()).toEqual([]);
    } finally {
      emptyStore.customers.length = 0;
      wouterParams.current = {};
    }
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
    expect(text).toContain("Aún no hay destinatarios");
    expect(text).not.toContain("No recipients configured yet");
    expect(text).not.toContain("Loading recipients");

    // Bundle-level guards for the remove-recipient confirm dialog
    // (only visible when a delete is in-flight).
    expect(i18n.t("pages.settings.removeTitle")).toBe("¿Eliminar destinatario?");
    expect(i18n.t("pages.settings.cancel")).toBe("Cancelar");
    expect(i18n.t("pages.settings.remove")).toBe("Eliminar");

    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Leases bundle has Spanish copy for filter chrome and dialogs", () => {
    expect(i18n.t("pages.leases.filteredByCustomer")).toBe(
      "Filtrado por cliente:",
    );
    expect(i18n.t("pages.leases.missingDates")).toBe("Sin fechas");
    expect(i18n.t("pages.leases.hotelRateAtRisk")).toBe(
      "Tarifa hotel en riesgo este mes",
    );
    expect(i18n.t("pages.leases.clearAtRiskFilter")).toBe(
      "Quitar filtro de en riesgo",
    );
  });

  it("Leases renders filter labels, view toggle and renewal alerts in Spanish", async () => {
    await act(async () => { root = mount(<Leases />, container); });
    const text = container.textContent ?? "";
    // Filter SelectItem labels
    expect(text).toContain("Todos los clientes");
    expect(text).toContain("Todos los estados");
    expect(text).toContain("Todos los contratos");
    expect(text).toContain("Activo");
    expect(text).toContain("Vencido");
    expect(text).toContain("Próximo");
    expect(text).toContain("Cualquier cláusula de salida");
    expect(text).toContain("Con cláusula de salida");
    expect(text).toContain("Sin cláusula de salida");
    expect(text).toContain("Cualquier pagador");
    expect(text).toContain("No pagado por cliente");
    expect(text).toContain("Necesita revisión");
    expect(text).toContain("Sin fechas");
    expect(text).toContain("En riesgo este mes");
    // View mode toggle
    expect(text).toContain("Por cliente");
    // No English leaks for the translated labels (textContent has no
    // markup delimiters, so assert the plain strings)
    expect(text).not.toContain("All Customers");
    expect(text).not.toContain("All Statuses");
    expect(text).not.toContain("All Leases");
    expect(text).not.toContain("Any Buyout");
    expect(text).not.toContain("Buyout available");
    expect(text).not.toContain("No buyout");
    expect(text).not.toContain("Any payer");
    expect(text).not.toContain("Not customer-paid");
    expect(text).not.toContain("Needs review");
    expect(text).not.toContain("Missing dates");
    expect(text).not.toContain("At risk this month");
    expect(text).not.toContain("By customer");
    // Bundle-level guards for conditionally-rendered chrome
    expect(i18n.t("pages.leases.renewalAlerts")).toBe("Alertas de renovación");
    expect(i18n.t("pages.leases.renew")).toBe("Renovar");
    expect(i18n.t("pages.leases.unknownProperty")).toBe(
      "Propiedad desconocida",
    );
    expect(i18n.t("pages.leases.viewModeAria")).toBe(
      "Modo de vista de contratos",
    );
    expect(i18n.t("pages.leases.noActiveLeaseInScope")).toContain(
      "Ningún cliente",
    );
    expect(spanishMissingKeys()).toEqual([]);
  });

  it("Properties renders the 'Not rated' tooltip copy in Spanish", () => {
    expect(i18n.t("pages.properties.notRated")).toBe("Sin calificar");
  });

  it("Property Detail bundle has Spanish copy for hidden-records, other-costs and manual-override", () => {
    expect(i18n.t("pages.propertyDetail.droppedNotice")).toContain(
      "ocultados",
    );
    expect(i18n.t("pages.propertyDetail.statOtherCosts")).toBe("Otros costos");
    expect(i18n.t("pages.propertyDetail.manuallyOverridden")).toBe(
      "Anulado manualmente",
    );
  });

  it("Properties bundle has Spanish copy for filters and dialog", () => {
    expect(i18n.t("pages.properties.allCustomers")).toBe("Todos los clientes");
    expect(i18n.t("pages.properties.allStatuses")).toBe("Todos los estados");
    expect(i18n.t("pages.properties.statusActive")).toBe("Activa");
    expect(i18n.t("pages.properties.statusInactive")).toBe("Inactiva");
    expect(i18n.t("pages.properties.dialog.cancel")).toBe("Cancelar");
    expect(i18n.t("pages.properties.dialog.addAction")).toBe(
      "Agregar propiedad",
    );
    expect(i18n.t("pages.properties.viewLabel")).toBe("Vista de propiedades");
    expect(i18n.t("pages.properties.tableView")).toBe("Tabla");
    expect(i18n.t("pages.properties.mapView")).toBe("Mapa");
    expect(i18n.t("pages.properties.downloadCsv")).toBe("Descargar CSV");
    expect(i18n.t("pages.properties.addressReview.title")).toBe(
      "Direcciones que Google no puede ubicar",
    );
    expect(i18n.t("pages.properties.addressReview.retryAll")).toBe(
      "Reintentar todo",
    );
    expect(i18n.t("pages.properties.addressReview.dismiss")).toBe("Descartar");
    expect(i18n.t("pages.properties.addressReview.undo")).toBe("Deshacer");
    expect(i18n.t("pages.properties.addressReview.retry")).toBe("Reintentar");
    expect(
      i18n.t("pages.properties.addressReview.retryingProgress", {
        done: 2,
        total: 5,
      }),
    ).toBe("Reintentando 2 de 5…");
  });

  it("Customers bundle has Spanish copy for delete dialog and dialog footer", () => {
    expect(i18n.t("pages.customers.dialog.cancel")).toBe("Cancelar");
    expect(i18n.t("pages.customers.dialog.saveChanges")).toBe(
      "Guardar cambios",
    );
    expect(i18n.t("pages.customers.dialog.addAction")).toBe("Agregar cliente");
    expect(i18n.t("pages.customers.highestOccupancy")).toBe("Mayor ocupación");
    expect(i18n.t("pages.customers.highestRevenue")).toBe(
      "Mayores ingresos mensuales",
    );
    expect(
      i18n.t("pages.customers.bedsOccupied", { occupied: 3, total: 8 }),
    ).toBe("3/8 camas ocupadas");
    expect(i18n.t("pages.customers.perMoAcrossAll")).toBe(
      "/mes en todas las propiedades",
    );
    expect(
      i18n.t("pages.customers.countOfTotal", {
        shown: 1,
        total: 4,
        count: 4,
      }),
    ).toBe("1 de 4 clientes");
    expect(i18n.t("pages.customers.table.properties")).toBe("Propiedades");
    expect(i18n.t("pages.customers.table.beds")).toBe("Camas");
    expect(i18n.t("pages.customers.table.revenuePerMo")).toBe("Ingresos / mes");
    expect(i18n.t("pages.customers.table.noHousingReason")).toBe(
      "Sin vivienda / Motivo",
    );
    expect(i18n.t("pages.customers.table.actions")).toBe("Acciones");
    expect(
      i18n.t("pages.customers.cantDeleteTooltip", { name: "Acme", count: 2 }),
    ).toContain("No se puede eliminar");
    expect(i18n.t("pages.customers.dialog.editTitle")).toBe("Editar cliente");
    expect(i18n.t("pages.customers.dialog.addTitle")).toBe("Agregar cliente");
    expect(i18n.t("pages.customers.dialog.companyName")).toBe(
      "Nombre de la empresa *",
    );
    expect(i18n.t("pages.customers.dialog.primaryContact")).toBe(
      "Contacto principal",
    );
    expect(i18n.t("pages.customers.dialog.phone")).toBe("Teléfono");
    expect(i18n.t("pages.customers.dialog.state")).toBe("Estado");
    expect(i18n.t("pages.customers.dialog.notes")).toBe("Notas");
    expect(i18n.t("pages.customers.noHousingBadge")).toBe("Sin vivienda");
    expect(
      i18n.t("pages.customers.rowActions.viewAria", { name: "Acme" }),
    ).toBe("Ver Acme");
    expect(
      i18n.t("pages.customers.rowActions.editAria", { name: "Acme" }),
    ).toBe("Editar Acme");
    expect(i18n.t("pages.customers.rowActions.viewProperties")).toBe(
      "Ver propiedades",
    );
    expect(i18n.t("pages.customers.rowActions.viewLeases")).toBe(
      "Ver contratos",
    );
    expect(i18n.t("pages.customers.rowActions.viewUtilities")).toBe(
      "Ver servicios",
    );
    expect(i18n.t("pages.customerDetail.customerPaidTitle")).toBe(
      "Renta mensual pagada por el cliente",
    );
    expect(i18n.t("pages.customerDetail.revenueTrend")).toBe(
      "Tendencia de ingresos",
    );
    expect(i18n.t("pages.customerDetail.contact")).toBe("Contacto");
    expect(
      i18n.t("pages.customerDetail.headerSummary", {
        propertyCount: 2,
        bedCount: 5,
        count: 2,
      }),
    ).toBe("2 propiedades · 5 camas");
    expect(i18n.t("pages.properties.table.leaseRenewal")).toBe(
      "Renovación de contrato",
    );
    expect(i18n.t("pages.properties.table.insurance")).toBe("Seguro");
    expect(i18n.t("pages.properties.empty.tryClearing")).toBe(
      "Intenta limpiar tu búsqueda o filtros de arriba.",
    );
    expect(i18n.t("pages.insurance.coverageStartPlaceholder")).toBe("inicio");
    expect(i18n.t("pages.insurance.coverageEndPlaceholder")).toBe("fin");
    expect(i18n.t("pages.customers.deleteDialog.title")).toBe(
      "¿Eliminar este cliente?",
    );
    expect(i18n.t("pages.customers.deleteDialog.confirmDelete")).toBe(
      "Eliminar cliente",
    );
    expect(
      i18n.t("pages.customers.deleteDialog.stillOwns", {
        name: "Acme",
        count: 1,
      }),
    ).toContain("Acme");
    expect(
      i18n.t("pages.customers.deleteDialog.permanentlyRemove", {
        name: "Acme",
      }),
    ).toContain("Acme");
  });
});
