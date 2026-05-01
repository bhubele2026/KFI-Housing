import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type StarRatingSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<StarRatingSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const GAP_CLASSES: Record<StarRatingSize, string> = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1.5",
};

interface StarRatingProps {
  /** Current rating, 0–5. May be a decimal in read-only display mode. */
  value: number;
  /** Called with the new whole-star value (0–5) when a star is clicked. Required for interactive mode. */
  onChange?: (value: number) => void;
  size?: StarRatingSize;
  /** When true, renders as a non-interactive display only. */
  readOnly?: boolean;
  /** Accessible label for screen readers (e.g. "Cleanliness rating"). */
  ariaLabel?: string;
  className?: string;
  /** Optional test id applied to the wrapper. */
  testId?: string;
}

/**
 * Five-star rating control. Interactive mode lets the user click a star to set the
 * value (clicking the same value clears it back to 0). Read-only mode supports
 * decimal values and renders partial fills for things like an average score.
 */
export function StarRating({
  value,
  onChange,
  size = "md",
  readOnly = false,
  ariaLabel,
  className,
  testId,
}: StarRatingProps) {
  const interactive = !readOnly && typeof onChange === "function";
  const sizeClass = SIZE_CLASSES[size];
  const safeValue = Math.max(0, Math.min(5, value));

  return (
    <div
      className={cn("inline-flex items-center", GAP_CLASSES[size], className)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, safeValue - (n - 1)));
        const handleClick = interactive
          ? () => onChange!(n === Math.round(safeValue) ? 0 : n)
          : undefined;

        const stars = (
          <span className="relative inline-flex" aria-hidden="true">
            <Star className={cn(sizeClass, "text-muted-foreground/40")} />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star className={cn(sizeClass, "fill-amber-400 text-amber-400")} />
              </span>
            )}
          </span>
        );

        if (!interactive) {
          return (
            <span key={n} className="inline-flex">
              {stars}
            </span>
          );
        }

        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === Math.round(safeValue)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={handleClick}
            className="inline-flex cursor-pointer rounded-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            data-testid={testId ? `${testId}-star-${n}` : undefined}
          >
            {stars}
          </button>
        );
      })}
    </div>
  );
}
