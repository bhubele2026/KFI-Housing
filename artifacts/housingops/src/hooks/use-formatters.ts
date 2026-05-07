import { useMemo } from "react";
import { useLocale } from "@/hooks/use-locale";
import { isBlankYMD, parseYMD } from "@/lib/lease-dates";

/**
 * Locale-aware formatters keyed off the active i18n language. Use
 * these instead of the hard-coded `en-US` `Intl.*` instances in
 * `data/mockData.ts` whenever you're rendering currency, numbers, or
 * dates in user-visible UI — so Spanish operators see `1.234,56 US$`
 * and `15 dic 2025` instead of `$1,234.56` and `12/15/2025`.
 *
 * The hook returns memoized formatter functions; the underlying
 * `Intl.*` instances are only rebuilt when the locale changes.
 */
export function useFormatters() {
  const locale = useLocale();
  return useMemo(() => {
    const usd = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
    });
    const usdWhole = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
    const num = new Intl.NumberFormat(locale);
    const dateMedium = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const dateLong = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const dateShort = new Intl.DateTimeFormat(locale, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });

    function dateFromYmd(ymd: string): Date | null {
      if (isBlankYMD(ymd)) return null;
      try {
        const { year, month, day } = parseYMD(ymd);
        return new Date(year, month - 1, day);
      } catch {
        return null;
      }
    }

    return {
      locale,
      formatCurrency: (amount: number) => usd.format(amount),
      formatCurrencyWhole: (amount: number) => usdWhole.format(amount),
      formatNumber: (n: number) => num.format(n),
      /** Formats a YYYY-MM-DD string as a localized medium date (e.g. `Dec 15, 2025` / `15 dic 2025`). */
      formatYmdMedium: (ymd: string): string => {
        const d = dateFromYmd(ymd);
        return d ? dateMedium.format(d) : ymd;
      },
      /** Formats a YYYY-MM-DD string as a localized long date. */
      formatYmdLong: (ymd: string): string => {
        const d = dateFromYmd(ymd);
        return d ? dateLong.format(d) : ymd;
      },
      /** Formats a YYYY-MM-DD string as a localized numeric short date. */
      formatYmdShort: (ymd: string): string => {
        const d = dateFromYmd(ymd);
        return d ? dateShort.format(d) : ymd;
      },
      /** Formats a Date in the active locale's medium style. */
      formatDateMedium: (d: Date) => dateMedium.format(d),
    };
  }, [locale]);
}
