import { cn } from "@/lib/utils";

/**
 * KFI Workforce Deployment logo, recreated as crisp inline SVG so it scales
 * cleanly at any size and tints with `currentColor` (white on the navy
 * sidebar, navy on light surfaces). Replaces the old raster PNGs.
 *
 * - variant "full"  → swoosh monogram + "WORKFORCE DEPLOYMENT" wordmark
 * - variant "mark"  → just the swoosh + KFI monogram (collapsed rail / favicon)
 */
export function KfiLogo({
  className,
  variant = "full",
  "data-testid": testId,
}: {
  className?: string;
  variant?: "full" | "mark";
  "data-testid"?: string;
}) {
  const Mark = (
    <svg
      viewBox="0 0 72 60"
      role="img"
      aria-label="KFI"
      className="h-full w-auto"
      fill="none"
    >
      {/* swoosh ring — open ellipse tilted slightly, like the brand mark */}
      <ellipse
        cx="36"
        cy="30"
        rx="33"
        ry="22"
        transform="rotate(-13 36 30)"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeDasharray="150 38"
        strokeDashoffset="20"
      />
      <text
        x="36"
        y="38"
        textAnchor="middle"
        fontFamily="inherit"
        fontWeight="800"
        fontSize="24"
        letterSpacing="0.5"
        fill="currentColor"
      >
        KFI
      </text>
    </svg>
  );

  if (variant === "mark") {
    return (
      <span data-testid={testId} className={cn("inline-block text-current", className)}>{Mark}</span>
    );
  }

  return (
    <div data-testid={testId} className={cn("flex items-center gap-3 text-current select-none", className)}>
      <span className="h-12 shrink-0">{Mark}</span>
      <div className="leading-[1.05]">
        <div className="text-[15px] font-light tracking-[0.22em]">WORKFORCE</div>
        <div className="text-[15px] font-light tracking-[0.22em]">DEPLOYMENT</div>
      </div>
    </div>
  );
}
