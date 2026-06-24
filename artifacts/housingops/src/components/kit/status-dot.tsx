import { cn } from "@/lib/utils";

export type StatusKind = "ok" | "warn" | "risk" | "neutral";

const DOT: Record<StatusKind, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  risk: "bg-risk",
  neutral: "bg-muted-foreground/50",
};

const SIZE = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-2.5 w-2.5",
} as const;

export interface StatusDotProps {
  status: StatusKind;
  /** Optional inline label shown after the dot. */
  label?: string;
  size?: keyof typeof SIZE;
  className?: string;
  testId?: string;
}

/**
 * The one status indicator for the whole app. A status color ALWAYS means the
 * same thing (see the Design System): ok = full / paid / linked,
 * warn = needs a look / partial, risk = money leak / $0 / not in payroll,
 * neutral = unknown / pending. Learned once, read everywhere.
 */
export function StatusDot({
  status,
  label,
  size = "md",
  className,
  testId,
}: StatusDotProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      data-testid={testId}
      data-status={status}
    >
      <span
        className={cn("inline-block shrink-0 rounded-full", SIZE[size], DOT[status])}
        aria-hidden="true"
      />
      {label != null && (
        <span className="text-xs leading-none text-muted-foreground">{label}</span>
      )}
    </span>
  );
}
