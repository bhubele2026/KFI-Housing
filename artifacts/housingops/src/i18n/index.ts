import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const SUPPORTED_LANGUAGES = ["en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = "housingops:language";

function readPersistedLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    // Safari Private Mode etc. — fall through to default.
  }
  return "en";
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        es: { translation: es },
      },
      lng: readPersistedLanguage(),
      fallbackLng: "en",
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      interpolation: { escapeValue: false },
      returnNull: false,
    });
}

// Expose the i18n instance to non-React modules (e.g. `data/mockData`'s
// currency formatters) so they can read the active language without
// importing react-i18next. This is intentional — mockData.ts is loaded
// from non-React contexts (CSV exports, calculations) where a hook
// can't run.
(globalThis as { i18next?: typeof i18n }).i18next = i18n;

export function persistLanguage(lng: SupportedLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Best-effort persistence.
  }
}

export function setLanguage(lng: SupportedLanguage) {
  persistLanguage(lng);
  void i18n.changeLanguage(lng);
}

/**
 * Map the active i18n language to a BCP-47 locale tag suitable for
 * Intl.DateTimeFormat / NumberFormat. Spanish defaults to es-ES.
 */
export function activeLocale(lng?: string): string {
  const normalized = (lng ?? i18n.language ?? "en").toLowerCase();
  if (normalized.startsWith("es")) return "es-ES";
  return "en-US";
}

export default i18n;
