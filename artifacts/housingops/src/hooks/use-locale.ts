import { useTranslation } from "react-i18next";
import { activeLocale } from "@/i18n";

/**
 * Returns the BCP-47 locale tag (`en-US` or `es-ES`) corresponding to
 * the currently-active i18n language. Use this when feeding
 * `Intl.DateTimeFormat`, `Intl.NumberFormat`, or `date-fns` so dates,
 * numbers, and currency render in the user's preferred language.
 */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return activeLocale(i18n.language);
}
