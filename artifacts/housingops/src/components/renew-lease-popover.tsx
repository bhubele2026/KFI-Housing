import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CalendarPlus, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  addMonthsToYMDOrNull,
  formatYMDPrettyOrBlank,
  isBlankYMD,
} from "@/lib/lease-dates";
import type { Lease } from "@/data/mockData";

type LeaseStatus = Lease["status"];

const formatPretty = (s: string) => formatYMDPrettyOrBlank(s, "");

interface RenewLeasePopoverProps {
  currentEndDate: string;
  currentStatus: LeaseStatus;
  propertyName?: string;
  onRenew: (newEndDate: string, newStatus: LeaseStatus) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
}

export function RenewLeasePopover({ currentEndDate, currentStatus, propertyName, onRenew, trigger, align = "end" }: RenewLeasePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasCurrentEndDate = !isBlankYMD(currentEndDate);
  const initialCustomDate = addMonthsToYMDOrNull(currentEndDate, 12) ?? "";
  const [customDate, setCustomDate] = useState(initialCustomDate);
  const { toast } = useToast();

  const sixMo = addMonthsToYMDOrNull(currentEndDate, 6);
  const oneYr = addMonthsToYMDOrNull(currentEndDate, 12);

  const apply = (newEndDate: string | null) => {
    if (!newEndDate) {
      toast({
        title: t("dialogs.renewLease.invalidDateTitle"),
        description: t("dialogs.renewLease.invalidDatePickFirst"),
        variant: "destructive",
      });
      return;
    }
    if (hasCurrentEndDate && newEndDate <= currentEndDate) {
      toast({
        title: t("dialogs.renewLease.invalidDateTitle"),
        description: t("dialogs.renewLease.invalidDateAfterCurrent"),
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
      title: t("dialogs.renewLease.leaseRenewedTitle"),
      description: propertyName
        ? t("dialogs.renewLease.leaseRenewedWithProperty", { property: propertyName, date: formatPretty(newEndDate) })
        : t("dialogs.renewLease.leaseRenewedNoProperty", { date: formatPretty(newEndDate) }),
      duration: 12000,
      action: (
        <ToastAction
          altText={t("dialogs.renewLease.undoAlt")}
          onClick={() => {
            onRenew(previousEndDate, previousStatus);
            toast({
              title: t("dialogs.renewLease.renewalUndoneTitle"),
              description: propertyName
                ? t("dialogs.renewLease.renewalUndoneWithProperty", { property: propertyName, date: formatPretty(previousEndDate) })
                : t("dialogs.renewLease.renewalUndoneNoProperty", { date: formatPretty(previousEndDate) }),
              duration: 6000,
            });
          }}
        >
          {t("dialogs.renewLease.undoLabel")}
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
              {t("dialogs.renewLease.title")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasCurrentEndDate
                ? t("dialogs.renewLease.currentlyEnds", { date: formatPretty(currentEndDate) })
                : t("dialogs.renewLease.noEndDate")}
            </p>
          </div>

          {hasCurrentEndDate && sixMo && oneYr && (
            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => apply(sixMo)}
                className="flex items-center justify-between rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 text-left text-sm transition-colors"
              >
                <span className="font-medium">{t("dialogs.renewLease.plus6Months")}</span>
                <span className="text-xs text-muted-foreground">{formatPretty(sixMo)}</span>
              </button>
              <button
                type="button"
                onClick={() => apply(oneYr)}
                className="flex items-center justify-between rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 text-left text-sm transition-colors"
              >
                <span className="font-medium">{t("dialogs.renewLease.plus1Year")}</span>
                <span className="text-xs text-muted-foreground">{formatPretty(oneYr)}</span>
              </button>
            </div>
          )}

          {hasCurrentEndDate && <Separator />}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {hasCurrentEndDate ? t("dialogs.renewLease.customNewEndDate") : t("dialogs.renewLease.newEndDate")}
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={customDate}
                min={hasCurrentEndDate ? currentEndDate : undefined}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => apply(customDate)}
                aria-label={t("dialogs.renewLease.applyDateAria")}
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
