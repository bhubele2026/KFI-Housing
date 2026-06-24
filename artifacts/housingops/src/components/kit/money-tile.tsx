import { cn } from "@/lib/utils";

function fmt(amount: number, opts?: { cents?: boolean }): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts?.cents ? 2 : 0,
    maximumFractionDigits: opts?.cents ? 2 : 0,
  }).format(amount);
}

export interface MoneyStat {
  label: string;
  amount: number;
  /** Smaller helper line under the figure. */
  hint?: string;
  /** Draw bigger / bolder — use for the headline figure (e.g. Net spread). */
  emphasize?: boolean;
  /**
   * Color rule. "auto" = red when negative, ink otherwise (the spread).
   * "risk"/"ok"/"warn" force a meaning. Default neutral ink.
   */
  tone?: "auto" | "ok" | "warn" | "risk" | "neutral";
  cents?: boolean;
}

function toneClass(stat: MoneyStat): string {
  const t = stat.tone ?? "neutral";
  if (t === "auto") return stat.amount < 0 ? "text-risk" : "text-ink";
  if (t === "ok") return "text-ok";
  if (t === "warn") return "text-warn";
  if (t === "risk") return "text-risk";
  return "text-ink";
}

export interface MoneyTileProps {
  /** Optional heading above the stats (e.g. property name or "This property"). */
  title?: string;
  stats: MoneyStat[];
  className?: string;
  testId?: string;
}

/**
 * The money truth for one property/client — Rent we pay · Collected ·
 * Utilities · Net spread. All figures tabular so columns align like the
 * managers' spreadsheet; Net spread goes red the moment it's negative
 * (we're paying more than we recover). Used on the dashboard, the Property
 * Board, and the Money view.
 */
export function MoneyTile({ title, stats, className, testId }: MoneyTileProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-panel p-3",
        className,
      )}
      data-testid={testId}
    >
      {title && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div key={`${s.label}-${i}`} className={cn(s.emphasize && "sm:order-last")}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
            <p
              className={cn(
                "tabular-nums leading-tight",
                s.emphasize ? "text-xl font-bold" : "text-base font-semibold",
                toneClass(s),
              )}
            >
              {fmt(s.amount, { cents: s.cents })}
            </p>
            {s.hint && (
              <p className="text-[11px] text-muted-foreground">{s.hint}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Convenience builder for the canonical 4-stat property tile so callers don't
 * re-spell the labels/tones. `net` is auto-toned red-when-negative and
 * emphasized.
 */
export function buildPropertyMoneyStats(input: {
  rentWePay: number;
  collected: number;
  utilities: number;
}): MoneyStat[] {
  const net = input.collected - input.rentWePay - input.utilities;
  return [
    { label: "Rent we pay", amount: input.rentWePay, tone: "neutral" },
    { label: "Collected", amount: input.collected, tone: "ok" },
    { label: "Utilities", amount: input.utilities, tone: "neutral" },
    { label: "Net spread", amount: net, tone: "auto", emphasize: true },
  ];
}
