import { useState } from "react";
import { Building2, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Building } from "@/data/mockData";

export interface BuildingPickerProps {
  /**
   * Buildings the operator can choose from. Typically the parent
   * property's full list (filtered upstream); the picker itself does
   * not look up buildings by property.
   */
  buildings: readonly Building[];
  /** Currently-assigned building id, or null/undefined when unassigned. */
  selectedId: string | null | undefined;
  /**
   * Called when the operator picks a building (id) or clears the
   * assignment ("Unassigned" → null). The parent persists this via
   * updateRoom / updateLease.
   */
  onSelect: (buildingId: string | null) => void;
  /** Trigger element — typically the existing "Building unassigned" badge. */
  trigger: React.ReactNode;
  /** Test id for the popover content. */
  contentTestId?: string;
}

/**
 * Inline picker for assigning a building to a room or lease (Task #591).
 *
 * Wraps an existing trigger (the "Building unassigned" badge or current
 * building label) in a Popover that lists the property's buildings as
 * clickable rows plus an "Unassigned" option to clear the field. Selecting
 * a row calls `onSelect` and immediately closes the popover so the badge
 * label can update via the optimistic `updateRoom` / `updateLease` flow.
 */
export function BuildingPicker({
  buildings,
  selectedId,
  onSelect,
  trigger,
  contentTestId,
}: BuildingPickerProps) {
  const [open, setOpen] = useState(false);

  const handlePick = (id: string | null) => {
    if ((selectedId ?? null) !== id) {
      onSelect(id);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-1"
        onClick={(e) => e.stopPropagation()}
        data-testid={contentTestId}
      >
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Assign building
        </div>
        <div className="flex flex-col">
          {buildings.map((b) => {
            const isSelected = selectedId === b.id;
            return (
              <Button
                key={b.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start gap-2 h-8 px-2 font-normal",
                  isSelected && "bg-muted",
                )}
                onClick={() => handlePick(b.id)}
                data-testid={`building-picker-option-${b.id}`}
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate flex-1 text-left">{b.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
              </Button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "justify-start gap-2 h-8 px-2 font-normal italic text-muted-foreground",
              !selectedId && "bg-muted",
            )}
            onClick={() => handlePick(null)}
            data-testid="building-picker-option-unassigned"
          >
            <span className="truncate flex-1 text-left">Unassigned</span>
            {!selectedId && <Check className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
