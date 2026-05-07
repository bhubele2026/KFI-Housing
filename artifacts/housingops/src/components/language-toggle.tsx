import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setLanguage, type SupportedLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

export interface LanguageToggleProps {
  /** Render as compact icon-only button (e.g. inside the collapsed sidebar). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Two-state EN/ES segmented toggle. Switching updates `i18n.language`
 * and persists the choice in `localStorage` so reloads keep the
 * operator's preferred language.
 */
export function LanguageToggle({ iconOnly = false, className }: LanguageToggleProps) {
  const { t, i18n } = useTranslation();
  const current = (i18n.language?.startsWith("es") ? "es" : "en") as SupportedLanguage;

  const handleSelect = (lng: SupportedLanguage) => {
    if (lng === current) return;
    setLanguage(lng);
  };

  const segment = (lng: SupportedLanguage, label: string) => {
    const active = current === lng;
    return (
      <button
        key={lng}
        type="button"
        onClick={() => handleSelect(lng)}
        aria-pressed={active}
        aria-label={t("language.switchTo", {
          language: lng === "en" ? t("language.english") : t("language.spanish"),
        })}
        data-testid={`button-language-${lng}`}
        className={cn(
          "px-2 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
        )}
      >
        {label}
      </button>
    );
  };

  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleSelect(current === "en" ? "es" : "en")}
            aria-label={t("language.tooltip")}
            data-testid="button-language-toggle-icon"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
              className,
            )}
          >
            <Languages className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {t("language.tooltip")} · {current.toUpperCase()}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 p-0.5",
        className,
      )}
      role="group"
      aria-label={t("language.label")}
      data-testid="language-toggle"
    >
      {segment("en", "EN")}
      {segment("es", "ES")}
    </div>
  );
}
