import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n, { LANGUAGE_STORAGE_KEY, setLanguage, activeLocale } from "./index";

function Probe() {
  const { t } = useTranslation();
  return (
    <div>
      <span data-testid="dashboard-label">{t("nav.dashboard")}</span>
      <span data-testid="lang">{t("language.label")}</span>
    </div>
  );
}

function renderProbe(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <Probe />
      </I18nextProvider>,
    );
  });
  return root;
}

describe("i18n", () => {
  let container: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it("renders English by default", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = renderProbe(container);
    expect(container.querySelector("[data-testid='dashboard-label']")?.textContent).toBe("Dashboard");
    expect(container.querySelector("[data-testid='lang']")?.textContent).toBe("Language");
  });

  it("switches to Spanish when setLanguage('es') is called", async () => {
    await act(async () => {
      setLanguage("es");
      await i18n.loadLanguages("es");
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = renderProbe(container);
    expect(container.querySelector("[data-testid='dashboard-label']")?.textContent).toBe("Panel");
    expect(container.querySelector("[data-testid='lang']")?.textContent).toBe("Idioma");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
  });

  it("activeLocale maps language to BCP-47 tag", () => {
    expect(activeLocale("en")).toBe("en-US");
    expect(activeLocale("es")).toBe("es-ES");
    expect(activeLocale("es-MX")).toBe("es-ES");
    expect(activeLocale("en-GB")).toBe("en-US");
  });
});
