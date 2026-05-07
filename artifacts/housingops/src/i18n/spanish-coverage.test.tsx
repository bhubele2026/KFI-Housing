import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import NotFound from "@/pages/not-found";
import { NotFoundScreen } from "@/components/not-found-screen";
import { ErrorBoundary } from "@/components/error-boundary";
import { useTranslation } from "react-i18next";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await i18n.changeLanguage("es");
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await i18n.changeLanguage("en");
});

describe("Spanish UI rendering", () => {
  it("renders the language toggle with Spanish labels", async () => {
    await act(async () => {
      root.render(<LanguageToggle />);
    });
    // Toggle exposes both EN and ES button labels regardless of locale —
    // make sure Spanish locale at least surfaces the localized aria
    // label so screen readers announce the active state in Spanish.
    expect(container.innerHTML).toMatch(/Español|Cambiar idioma/);
  });

  it("renders the not-found-screen in Spanish via translated props", async () => {
    function Probe() {
      const { t } = useTranslation();
      return (
        <NotFoundScreen
          title={t("notFound.title")}
          description={t("notFound.description")}
        />
      );
    }
    await act(async () => {
      root.render(<Probe />);
    });
    expect(container.textContent).toContain("Página no encontrada");
  });

  it("renders the not-found screen in Spanish", async () => {
    await act(async () => {
      root.render(<NotFound />);
    });
    expect(container.textContent).toContain("Página no encontrada");
    expect(container.textContent).toContain("Volver al panel");
  });

  it("renders the error boundary fallback in Spanish", async () => {
    function Boom() {
      throw new Error("boom");
    }
    // Suppress React's expected error log noise during the throw.
    const origError = console.error;
    console.error = () => {};
    try {
      await act(async () => {
        root.render(
          <ErrorBoundary>
            <Boom />
          </ErrorBoundary>,
        );
      });
    } finally {
      console.error = origError;
    }
    expect(container.textContent).toContain("Algo salió mal en esta página");
  });

  it("falls back to English when language is reset", async () => {
    await i18n.changeLanguage("en");
    function Probe() {
      const { t } = useTranslation();
      return <span>{t("notFound.title")}</span>;
    }
    await act(async () => {
      root.render(<Probe />);
    });
    expect(container.textContent).toContain("Page not found");
  });

  it("resolves Spanish translations for the Finance page chrome and table", async () => {
    function FinanceProbe() {
      const { t } = useTranslation();
      return (
        <ul>
          <li>{t("pages.finance.title")}</li>
          <li>{t("pages.finance.downloadCsv")}</li>
          <li>{t("pages.finance.totalRevenue")}</li>
          <li>{t("pages.finance.totalCosts")}</li>
          <li>{t("pages.finance.netProfit")}</li>
          <li>{t("pages.finance.chartTitle")}</li>
          <li>{t("pages.finance.allCustomers")}</li>
          <li>{t("pages.finance.table.property")}</li>
          <li>{t("pages.finance.table.customer")}</li>
          <li>{t("pages.finance.table.occupancy")}</li>
          <li>{t("pages.finance.table.leaseCost")}</li>
          <li>{t("pages.finance.table.utilityCost")}</li>
          <li>{t("pages.finance.table.totalCost")}</li>
          <li>{t("pages.finance.table.rentPerBed")}</li>
          <li>{t("pages.finance.table.electricPerBed")}</li>
          <li>{t("pages.finance.table.rentPlusElectricPerBed")}</li>
          <li>{t("pages.finance.table.contractLabel")}</li>
          <li>{t("pages.finance.table.hotelRateLabel")}</li>
          <li>{t("pages.finance.table.portfolioTotal")}</li>
          <li>{t("pages.finance.table.customerTotal", { customer: "Acme" })}</li>
          <li>{t("pages.finance.empty.noPropertiesTitle")}</li>
          <li>{t("pages.finance.empty.noPropertiesDescription")}</li>
          <li>{t("pages.finance.empty.addProperty")}</li>
          <li>{t("pages.finance.exportedTitle")}</li>
          <li>{t("pages.finance.exportedDescription", { count: 3 })}</li>
        </ul>
      );
    }
    await act(async () => {
      root.render(<FinanceProbe />);
    });
    const html = container.textContent ?? "";
    // Headline + KPI tiles
    expect(html).toContain("Finanzas");
    expect(html).toContain("Descargar CSV");
    expect(html).toContain("Ingresos totales");
    expect(html).toContain("Costos totales");
    expect(html).toContain("Utilidad neta");
    // Chart + filter chrome
    expect(html).toContain("Ingresos vs costo por propiedad");
    expect(html).toContain("Todos los clientes");
    // Table headers
    expect(html).toContain("Propiedad");
    expect(html).toContain("Cliente");
    expect(html).toContain("Ocupación");
    expect(html).toContain("Costo de arrendamiento");
    expect(html).toContain("Costo de servicios");
    expect(html).toContain("Costo total");
    expect(html).toContain("Renta / cama");
    expect(html).toContain("Electricidad / cama");
    expect(html).toContain("Renta + electricidad / cama");
    // Hotel-rate inline labels
    expect(html).toContain("Contrato:");
    expect(html).toContain("Tarifa de hotel:");
    // Totals row
    expect(html).toContain("Total del portafolio");
    expect(html).toContain("Total de Acme");
    // Empty + export toast
    expect(html).toContain("Aún no hay propiedades");
    expect(html).toContain("Agregar propiedad");
    expect(html).toContain("Resumen financiero exportado");
    expect(html).toContain("Se descargaron 3 propiedades como CSV.");
    // No raw English leaked through any of the keys above.
    expect(html).not.toMatch(/Download CSV|Total Revenue|Net Profit|Portfolio Total|Add Property/);
  });

  it("formatUsd uses locale-aware currency formatting", async () => {
    // The currency formatter reads the active i18n language at call
    // time so callers don't need to thread a hook through every column.
    const { formatUsd } = await import("@/data/mockData");
    await i18n.changeLanguage("es");
    const spanish = formatUsd(1234567.89);
    await i18n.changeLanguage("en");
    const english = formatUsd(1234567.89);
    expect(spanish).not.toEqual(english);
    expect(english).toContain("$1,234,567.89");
    // Spanish uses period thousands separator and comma decimal.
    expect(spanish).toMatch(/1\.234\.567,89/);
  });
});
