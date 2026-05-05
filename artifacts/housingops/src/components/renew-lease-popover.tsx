import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CalendarPlus, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { addMonthsToYMD, formatYMDPretty } from "@/lib/lease-dates";
import type { Lease } from "@/data/mockData";

type LeaseStatus = Lease["status"];

const formatPretty = formatYMDPretty;

interface RenewLeasePopoverProps {
  currentEndDate: string;
  currentStatus: LeaseStatus;
  propertyName?: string;
  onRenew: (newEndDate: string, newStatus: LeaseStatus) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
}

export function RenewLeasePopover({ currentEndDate, currentStatus, propertyName, onRenew, trigger, align = "end" }: RenewLeasePopoverProps) {
  const [open, setOpen] = useState(false);
  const [customDate, setCustomDate] = useState(addMonthsToYMD(currentEndDate, 12));
  const { toast } = useToast();

  const sixMo = addMonthsToYMD(currentEndDate, 6);
  const oneYr = addMonthsToYMD(currentEndDate, 12);

  const apply = (newEndDate: string) => {
    if (!newEndDate || newEndDate <= currentEndDate) {
      toast({
        title: "Invalid date",
        description: "New end date must be after the current end date.",
        variant: "destructive",
      });
      return;
    }
    const previousEndDate = currentEndDate;
    const previousStatus = currentStatus;
    const newStatus: LeaseStatus = currentStatus === "Expired" ? "Active" : currentStatus;
    onRenew(newEndDate, newStatus);
    setOpen(false);
    toast({
      title: "Lease renewed",
      description: `${propertyName ? propertyName + " — " : ""}new end date ${formatPretty(newEndDate)}.`,
      duration: 12000,
      action: (
        <ToastAction
          altText="Undo lease renewal"
          onClick={() => {
            onRenew(previousEndDate, previousStatus);
            toast({
              title: "Renewal undone",
              description: `${propertyName ? propertyName + " — " : ""}end date restored to ${formatPretty(previousEndDate)}.`,
              duration: 6000,
            });
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        align={align}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2.5">
          <div>
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarPlus className="h-3.5 w-3.5 text-muted-foreground" />
              Renew lease
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Currently ends {formatPretty(currentEndDate)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => apply(sixMo)}
              className="flex items-center justify-between rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 text-left text-sm transition-colors"
            >
              <span className="font-medium">+6 months</span>
              <span className="text-xs text-muted-foreground">{formatPretty(sixMo)}</span>
            </button>
            <button
              type="button"
              onClick={() => apply(oneYr)}
              className="flex items-center justify-between rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 text-left text-sm transition-colors"
            >
              <span className="font-medium">+1 year</span>
              <span className="text-xs text-muted-foreground">{formatPretty(oneYr)}</span>
            </button>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Custom new end date</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={customDate}
                min={currentEndDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => apply(customDate)}
                aria-label="Apply custom date"
              >
                <Check className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
