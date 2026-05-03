import { formatPropertyName } from "@/lib/property-name";
import { cn } from "@/lib/utils";

type PropertyNameCellProps = {
  name: string | null | undefined;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
};

export function PropertyNameCell({
  name,
  className,
  primaryClassName,
  secondaryClassName,
}: PropertyNameCellProps) {
  const { primary, secondary } = formatPropertyName(name);
  return (
    <div className={cn("flex flex-col gap-0.5 leading-tight", className)}>
      <span className={cn("font-medium text-foreground", primaryClassName)}>
        {primary || <span className="italic text-muted-foreground">Unnamed</span>}
      </span>
      {secondary && (
        <span
          className={cn(
            "text-xs font-normal text-muted-foreground tracking-wide",
            secondaryClassName,
          )}
        >
          {secondary}
        </span>
      )}
    </div>
  );
}
