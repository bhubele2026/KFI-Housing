import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar, Badge, StatusDot, CARD_SHADOW } from "./primitives";

/** One bed row in a room card: avatar + name + shift sub + status badge.
 *  Set `open` for the dashed "+ assign bed" empty slot. */
export function Bed({
  name,
  sub,
  initials,
  accent,
  badge,
  open,
  draggable,
  actions,
  onDragStart,
  onDragEnd,
  testId,
  swatchTitle,
  needsCleaning,
}: {
  name?: string;
  sub?: ReactNode;
  initials?: string;
  accent?: string;
  badge?: { kind: "ok" | "risk" | "grey"; label: ReactNode };
  open?: boolean;
  draggable?: boolean;
  actions?: ReactNode;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  testId?: string;
  /** Hover/SR label for the colored avatar (e.g. the shift the color encodes). */
  swatchTitle?: string;
  /** Open bed still awaiting turnover. Display-only — never blocks a drop. */
  needsCleaning?: boolean;
}) {
  if (open) {
    return (
      <div className="mb-2 flex items-center justify-center gap-2 rounded-[11px] border border-dashed border-[#D7DEEA] bg-[repeating-linear-gradient(45deg,#fbfcfe,#fbfcfe_7px,#f3f6fb_7px,#f3f6fb_14px)] p-2 text-[13px] italic text-faint last:mb-0" data-testid={testId}>
        + assign bed
        {needsCleaning && (
          <span
            className="not-italic rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
            data-testid={testId ? `${testId}-needs-cleaning` : undefined}
            title="This open bed still needs cleaning — you can still assign someone (it'll clear on move)"
          >
            needs cleaning
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      className="group mb-2 flex items-center gap-2.5 rounded-[11px] bg-[#F8FAFD] p-2 last:mb-0"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={draggable ? { cursor: "grab" } : undefined}
      data-testid={testId}
    >
      <span title={swatchTitle} aria-label={swatchTitle} role={swatchTitle ? "img" : undefined} className="shrink-0">
        <Avatar initials={initials ?? "?"} accent={accent} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
        {sub != null && <div className="truncate text-[11px] font-medium text-muted-foreground">{sub}</div>}
      </div>
      {badge && (
        <Badge kind={badge.kind}>
          <StatusDot kind={badge.kind} />
          {badge.label}
        </Badge>
      )}
      {actions}
    </div>
  );
}

export function RoomCard({
  unit,
  occupied,
  capacity,
  children,
  onDragOverOpen,
}: {
  unit: ReactNode;
  occupied: number;
  capacity: number;
  children: ReactNode;
  onDragOverOpen?: boolean;
}) {
  const open = Math.max(0, capacity - occupied);
  return (
    <div className={cn("rounded-2xl bg-panel p-3.5", CARD_SHADOW, onDragOverOpen && "ring-2 ring-brand")}>
      <div className="mb-2.5 flex items-center justify-between">
        <b className="text-sm text-ink">{unit}</b>
        <span className={cn("text-[11px] font-bold", open === 0 ? "text-ok" : "text-warn")}>
          {open === 0 ? "Full" : `${open} open`}
        </span>
      </div>
      {children}
    </div>
  );
}
