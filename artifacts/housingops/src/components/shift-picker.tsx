import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useData } from "@/context/data-store";
import { STANDARD_SHIFTS } from "@/data/mockData";

const NONE_VALUE = "__none__";
const ADD_VALUE = "__add_custom__";

export interface ShiftPickerProps {
  /** Current shift value (free-form string) or null when unassigned. */
  value: string | null;
  /** Called with the new shift value (or `null` for "—"). */
  onChange: (value: string | null) => void;
  /**
   * Customer that owns the occupant's property (used to look up
   * per-customer custom shift titles). When `null` only the standard
   * shifts are offered, and the "Add custom shift…" item is hidden.
   */
  customerId: string | null;
  /** Optional `data-testid` for the trigger. */
  testId?: string;
  /** Forwarded to the SelectTrigger className for layout tuning. */
  triggerClassName?: string;
  /** Render placeholder when value is null. Defaults to "—". */
  placeholder?: string;
}

/**
 * Reusable shift picker (Task #506). Shows the three standard shifts
 * (Days / Nights / Overnights), then any per-customer custom shift
 * titles, then an "Add custom shift…" affordance that opens a small
 * dialog and persists the new title onto the customer so it re-appears
 * on every future picker for that customer.
 */
export function ShiftPicker({
  value,
  onChange,
  customerId,
  testId,
  triggerClassName,
  placeholder = "—",
}: ShiftPickerProps) {
  const { customers, updateCustomer } = useData();
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const customer = customerId
    ? customers.find((c) => c.id === customerId) ?? null
    : null;
  const customShifts = useMemo(() => {
    const raw = customer?.customShifts ?? [];
    // Drop any custom title that collides with a standard one so the
    // picker doesn't render duplicate items.
    return raw.filter(
      (s) => s.trim() !== "" && !(STANDARD_SHIFTS as readonly string[]).includes(s),
    );
  }, [customer]);

  // The Select needs a stable string for "no shift". Map null ↔ NONE_VALUE.
  // If the current value isn't in any list (e.g. legacy shift on a
  // property whose customer's custom shifts list lost it), surface it as
  // a one-off item so the operator can still see what's set.
  const orphanedCustom = useMemo(() => {
    if (!value) return null;
    if ((STANDARD_SHIFTS as readonly string[]).includes(value)) return null;
    if (customShifts.includes(value)) return null;
    return value;
  }, [value, customShifts]);

  const handleValueChange = (next: string) => {
    if (next === ADD_VALUE) {
      setNewTitle("");
      setAddOpen(true);
      return;
    }
    if (next === NONE_VALUE) {
      onChange(null);
      return;
    }
    onChange(next);
  };

  const submitNewTitle = () => {
    const title = newTitle.trim();
    if (!title) return;
    // Persist on the customer so it shows up next time. Skip when the
    // title already exists (case-sensitive match) to keep the list tidy.
    if (customer) {
      const existing = customer.customShifts ?? [];
      if (
        !existing.includes(title) &&
        !(STANDARD_SHIFTS as readonly string[]).includes(title)
      ) {
        updateCustomer(customer.id, { customShifts: [...existing, title] });
      }
    }
    onChange(title);
    setAddOpen(false);
  };

  return (
    <>
      <Select value={value ?? NONE_VALUE} onValueChange={handleValueChange}>
        <SelectTrigger
          className={triggerClassName ?? "h-7 text-xs w-28"}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>—</SelectItem>
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Standard
            </SelectLabel>
            {STANDARD_SHIFTS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectGroup>
          {(customShifts.length > 0 || orphanedCustom) && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {customer ? `${customer.name} shifts` : "Custom"}
                </SelectLabel>
                {customShifts.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
                {orphanedCustom && !customShifts.includes(orphanedCustom) && (
                  <SelectItem value={orphanedCustom}>{orphanedCustom}</SelectItem>
                )}
              </SelectGroup>
            </>
          )}
          {customer && (
            <>
              <SelectSeparator />
              <SelectItem value={ADD_VALUE} data-testid="select-shift-add-custom">
                + Add custom shift…
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add custom shift</DialogTitle>
            <DialogDescription>
              {customer
                ? `Saved for ${customer.name} so it reappears next time.`
                : "Free-form shift title."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="custom-shift-title">Title</Label>
            <Input
              id="custom-shift-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Penda, Swing, Weekend"
              data-testid="input-custom-shift-title"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNewTitle();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitNewTitle}
              disabled={!newTitle.trim()}
              data-testid="button-custom-shift-save"
            >
              Save shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
