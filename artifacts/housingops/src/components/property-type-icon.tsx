import { Hotel, Building2, Home, Building } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icon + tint for a property type so hotels vs apartments vs town houses read
 * at a glance in lists. Motel → Hotel icon (purple), Apartment → Building2
 * (blue), Town house → Home (teal), unknown → Building (slate).
 */
export function PropertyTypeIcon({
  type,
  className,
}: {
  type?: string | null;
  className?: string;
}) {
  const t = (type || "").toLowerCase();
  const { Icon, color, label } =
    t === "motel"
      ? { Icon: Hotel, color: "#9333ea", label: "Motel / hotel" }
      : t.includes("town")
        ? { Icon: Home, color: "#0f766e", label: "Town house" }
        : t === "apartment"
          ? { Icon: Building2, color: "#2563eb", label: "Apartment" }
          : { Icon: Building, color: "#64748b", label: "Property" };
  return (
    <span
      title={label}
      aria-label={label}
      data-testid="property-type-icon"
      className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", className)}
      style={{ color, backgroundColor: `${color}1a` }}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}
