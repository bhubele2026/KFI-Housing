import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Mockup card shadow (0 1px 2px / 0 4px 14px) + the hover-lift variant. */
export const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(16,24,40,.05),0_4px_14px_rgba(16,24,40,.06)]";
export const CARD_SHADOW_HOVER = "hover:shadow-[0_8px_24px_rgba(16,24,40,.10)]";

export function Card({
  className,
  children,
  onClick,
  testId,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <div
      className={cn("rounded-[18px] bg-panel p-5", CARD_SHADOW, className)}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Tiny uppercase letter-spaced grey label (the mockup .lab). */
export function Lab({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[11px] font-bold uppercase tracking-[0.6px] text-faint", className)}>
      {children}
    </div>
  );
}

export function CardHead({ label, link }: { label: ReactNode; link?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center justify-between">
      <Lab>{label}</Lab>
      {link}
    </div>
  );
}

const AV_BG: Record<string, string> = {
  blue: "bg-brand",
  purple: "bg-purple",
  teal: "bg-teal",
  orange: "bg-warn",
  red: "bg-risk",
  slate: "bg-[#64748B]",
  sky: "bg-[#0EA5E9]",
};

/** Colored avatar circle with initials. `accent` cycles category colors. */
export function Avatar({
  initials,
  accent = "blue",
  size = 30,
  className,
}: {
  initials: string;
  accent?: keyof typeof AV_BG | string;
  size?: number;
  className?: string;
}) {
  const bg = AV_BG[accent] ?? "bg-brand";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        bg,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** Deterministic category accent from a string (matches the mockup's mix). */
const ACCENTS = ["blue", "purple", "teal", "orange", "slate", "sky"] as const;
export function accentFor(seed: string): (typeof ACCENTS)[number] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
export function initialsOf(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function StatCard({
  label,
  value,
  sub,
  tone = "ink",
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "ok" | "warn" | "risk" | "brand";
  testId?: string;
}) {
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "risk" ? "text-risk" : tone === "brand" ? "text-brand" : "text-ink";
  return (
    <div className={cn("rounded-[18px] bg-panel p-[18px]", CARD_SHADOW)} data-testid={testId}>
      <Lab className="mb-1">{label}</Lab>
      <div className={cn("text-[26px] font-extrabold tracking-[-0.3px] tabular-nums", toneClass)}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export interface ERow {
  label: ReactNode;
  value: ReactNode;
  tone?: "ink" | "ok" | "risk";
}

/** Clickable entity card: avatar + name/sub + key/value rows. The Customers /
 *  Properties grids are built from these. */
export function EntityCard({
  initials,
  accent,
  name,
  sub,
  rows,
  onClick,
  className,
  testId,
}: {
  initials: string;
  accent?: string;
  name: ReactNode;
  sub?: ReactNode;
  rows?: ERow[];
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "cursor-pointer rounded-2xl bg-panel p-4 transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        CARD_SHADOW,
        CARD_SHADOW_HOVER,
        className,
      )}
      onClick={onClick}
      role={onClick ? "link" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      data-testid={testId}
    >
      <div className="mb-3 flex items-center gap-3">
        <Avatar initials={initials} accent={accent} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-ink">{name}</div>
          {sub != null && <div className="truncate text-xs font-medium text-muted-foreground">{sub}</div>}
        </div>
      </div>
      {rows?.map((r, i) => (
        <div key={i} className="flex justify-between py-1 text-[12.5px] text-muted-foreground">
          <span>{r.label}</span>
          <b className={r.tone === "ok" ? "text-ok" : r.tone === "risk" ? "text-risk" : "text-ink"}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Badge({
  kind = "grey",
  children,
  className,
}: {
  kind?: "ok" | "risk" | "grey";
  children: ReactNode;
  className?: string;
}) {
  const c =
    kind === "ok" ? "bg-ok-soft text-ok" : kind === "risk" ? "bg-risk-soft text-risk" : "bg-track text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", c, className)}>
      {children}
    </span>
  );
}

export function StatusDot({ kind = "grey", className }: { kind?: "ok" | "risk" | "grey" | "warn"; className?: string }) {
  const c = kind === "ok" ? "bg-ok" : kind === "risk" ? "bg-risk" : kind === "warn" ? "bg-warn" : "bg-faint";
  return <span className={cn("inline-block h-[7px] w-[7px] shrink-0 rounded-full", c, className)} aria-hidden />;
}

export function Pill({ kind = "grey", children }: { kind?: "ok" | "risk" | "grey"; children: ReactNode }) {
  const c =
    kind === "ok" ? "bg-ok-soft text-ok" : kind === "risk" ? "bg-risk-soft text-risk" : "bg-track text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", c)}>{children}</span>;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-[9px] bg-track p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[7px] px-[11px] py-[5px] text-xs font-bold transition-colors",
            o.value === value ? "bg-panel text-ink shadow-[0_1px_2px_rgba(16,24,40,.12)]" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
