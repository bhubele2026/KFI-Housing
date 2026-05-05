import { formatDistanceToNow } from "date-fns";
import { useNow } from "@/hooks/use-now";

interface CheckedAgoLabelProps {
  /** Epoch ms of the moment being described. */
  timestamp: number;
  /** Optional className applied to the rendered span. */
  className?: string;
  /** Optional data-testid for tests pinning down a specific row. */
  testId?: string;
}

/**
 * Renders a self-refreshing "Checked N <unit> ago" label for a single
 * timestamp. Subscribes to the shared minute-tick clock from `useNow`
 * so an idle page (operator stepped away, no other state changes) still
 * advances "5 minutes ago" → "6 minutes ago" without needing a parent
 * re-render.
 *
 * Scoped to its own component so the tick re-renders only this label,
 * not the entire page that hosts it — the rollup row, the table below,
 * the toolbar, etc. all stay untouched between ticks.
 */
export function CheckedAgoLabel({
  timestamp,
  className,
  testId,
}: CheckedAgoLabelProps) {
  // Subscribe to the shared minute clock. We don't use the returned
  // value directly (date-fns reads `Date.now()` itself); we just need
  // the re-render so `formatDistanceToNow` recomputes off a fresh
  // current time.
  useNow(60_000);
  return (
    <span
      className={className}
      data-testid={testId}
      title={new Date(timestamp).toLocaleString()}
    >
      {`Checked ${formatDistanceToNow(timestamp, { addSuffix: true })}`}
    </span>
  );
}
