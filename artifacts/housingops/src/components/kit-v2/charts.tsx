import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** SVG donut ring. Optional inner arc (dual ring, e.g. occupied + at-risk).
 *  Colors are token names ("grad1", "ok", "warn", "risk", "brand"). */
export function Ring({
  size = 128,
  stroke = 11,
  fraction,
  color = "grad1",
  inner,
  centerLabel,
  centerSub,
}: {
  size?: number;
  stroke?: number;
  fraction: number; // 0..1 outer
  color?: string;
  inner?: { fraction: number; color: string };
  centerLabel?: string;
  centerSub?: string;
}) {
  const cx = size / 2;
  const rOuter = cx - stroke - 1;
  const cOuter = 2 * Math.PI * rOuter;
  const rInner = rOuter - stroke - 3;
  const cInner = 2 * Math.PI * rInner;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${cx} ${cx})`} fill="none" strokeLinecap="round" strokeWidth={stroke}>
        <circle cx={cx} cy={cx} r={rOuter} stroke="hsl(var(--track))" />
        <circle
          cx={cx}
          cy={cx}
          r={rOuter}
          stroke={`hsl(var(--${color}))`}
          strokeDasharray={`${clamp(fraction) * cOuter} ${cOuter}`}
        />
        {inner && (
          <>
            <circle cx={cx} cy={cx} r={rInner} stroke="hsl(var(--track))" strokeWidth={stroke} />
            <circle
              cx={cx}
              cy={cx}
              r={rInner}
              stroke={`hsl(var(--${inner.color}))`}
              strokeWidth={stroke}
              strokeDasharray={`${clamp(inner.fraction) * cInner} ${cInner}`}
            />
          </>
        )}
      </g>
      {centerLabel != null && (
        <text x={cx} y={cx - 2} textAnchor="middle" fontSize={size * 0.2} fontWeight="800" fill="hsl(var(--ink))">
          {centerLabel}
        </text>
      )}
      {centerSub != null && (
        <text x={cx} y={cx + size * 0.13} textAnchor="middle" fontSize="9.5" letterSpacing="1" fontWeight="700" fill="hsl(var(--faint))">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

/** Filled area sparkline. `points` are y-values (any scale); auto-normalized. */
export function AreaChart({ points, height = 118 }: { points: number[]; height?: number }) {
  const W = 320;
  const pts = points.length >= 2 ? points : [0, 0];
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const step = W / (pts.length - 1);
  const top = 10;
  const usable = height - top - 6;
  const xy = pts.map((p, i) => [i * step, top + usable - ((p - min) / span) * usable] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${height} L0,${height} Z`;
  const last = xy[xy.length - 1];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="kit-area-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--brand2))" stopOpacity=".28" />
          <stop offset="1" stopColor="hsl(var(--brand2))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#kit-area-g)" />
      <path d={line} fill="none" stroke="hsl(var(--brand))" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="hsl(var(--brand))" />
    </svg>
  );
}

export type HeatKind = "f" | "h" | "m" | "r"; // full / high / open / at-risk
const HEAT_BG: Record<HeatKind, string> = {
  f: "bg-grad1",
  h: "bg-brand2",
  m: "bg-[#9DC0F5]",
  r: "bg-risk-soft ring-2 ring-inset ring-risk",
};

export function Heatmap({
  cells,
  cols = 8,
}: {
  cells: { kind: HeatKind; title?: string; onClick?: () => void }[];
  cols?: number;
}) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}>
      {cells.map((c, i) => {
        const interactive = !!c.onClick;
        const bubble = (
          <button
            key={i}
            type="button"
            onClick={c.onClick}
            aria-label={c.title ? `Open ${c.title}` : undefined}
            className={cn(
              "aspect-square rounded-full transition-transform hover:scale-110",
              // Signal that the existing click does something: pointer, a
              // subtle hover ring/shadow, and a visible keyboard focus ring.
              interactive &&
                "cursor-pointer hover:shadow-sm hover:ring-2 hover:ring-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
              HEAT_BG[c.kind],
            )}
          />
        );
        // No title → no tooltip (legend swatches etc.); just the bubble.
        if (!c.title) return <span key={i}>{bubble}</span>;
        return (
          // ~120ms open delay (vs the slow native title), styled white card.
          <Tooltip key={i} delayDuration={120}>
            <TooltipTrigger asChild>{bubble}</TooltipTrigger>
            <TooltipContent className="border-line bg-panel text-ink shadow-lg">
              {c.title}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
