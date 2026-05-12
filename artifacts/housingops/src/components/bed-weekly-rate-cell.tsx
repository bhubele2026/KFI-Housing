import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/data/mockData";

// Per-bed "current weekly rate" cell (Task #598). Renders the
// rate effective for the most-recent Saturday and exposes a
// dialog with the full history (add / overwrite / delete). The
// roll-forward semantic lives on the server: each row sets the
// rate from its Saturday onward until a later row supersedes it.

type RateRow = {
  id: string;
  bedId: string;
  effectivePayWeekEndDate: string;
  weeklyRate: number;
  source: string;
  note: string;
};

function mostRecentSaturdayString(): string {
  const d = new Date();
  // 6 = Saturday; rewind to the latest Sat on or before today.
  const diff = (d.getDay() - 6 + 7) % 7;
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function effectiveRate(rows: RateRow[], asOf: string): number {
  // Rows arrive sorted DESC from the server — first row whose
  // effective date is ≤ `asOf` wins.
  for (const r of rows) {
    if (r.effectivePayWeekEndDate <= asOf) return r.weeklyRate;
  }
  return 0;
}

export function BedWeeklyRateCell({ bedId }: { bedId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  const queryKey = useMemo(
    () => ["bed-weekly-rates", bedId] as const,
    [bedId],
  );
  const { data } = useQuery<RateRow[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${baseUrl}api/beds/${bedId}/weekly-rates`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return (await res.json()) as RateRow[];
    },
  });
  const rows = data ?? [];
  const asOf = mostRecentSaturdayString();
  const current = effectiveRate(rows, asOf);

  const [open, setOpen] = useState(false);
  // Form state for adding / overwriting an entry. Defaults to the
  // most-recent Saturday so the common path ("set the rate from
  // now on") is one click + one number.
  const [formDate, setFormDate] = useState(asOf);
  const [formAmount, setFormAmount] = useState<string>(String(current || ""));
  const [formNote, setFormNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormDate(asOf);
      setFormAmount(String(current || ""));
      setFormNote("");
      setError(null);
    }
  }, [open, asOf, current]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const handleSave = async () => {
    setError(null);
    const amt = Number(formAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError(t("pages.propertyDetail.bedRate.invalidAmount"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}api/beds/${bedId}/weekly-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectivePayWeekEndDate: formDate,
          weeklyRate: amt,
          note: formNote,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (rateId: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${baseUrl}api/beds/${bedId}/weekly-rates/${rateId}`,
        { method: "DELETE" },
      );
      if (res.ok) refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex items-center justify-end gap-1.5"
      data-testid={`cell-bed-weekly-rate-${bedId}`}
    >
      <span className="tabular-nums">{formatUsd(current)}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            data-testid={`button-bed-weekly-rate-${bedId}`}
            aria-label={t("pages.propertyDetail.bedRate.editAria")}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pages.propertyDetail.bedRate.title")}</DialogTitle>
            <DialogDescription>
              {t("pages.propertyDetail.bedRate.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`bed-rate-date-${bedId}`} className="text-xs">
                  {t("pages.propertyDetail.bedRate.effectiveSaturday")}
                </Label>
                <Input
                  id={`bed-rate-date-${bedId}`}
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  data-testid={`input-bed-rate-date-${bedId}`}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor={`bed-rate-amount-${bedId}`}
                  className="text-xs"
                >
                  {t("pages.propertyDetail.bedRate.weeklyAmount")}
                </Label>
                <Input
                  id={`bed-rate-amount-${bedId}`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  data-testid={`input-bed-rate-amount-${bedId}`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`bed-rate-note-${bedId}`} className="text-xs">
                {t("pages.propertyDetail.bedRate.note")}
              </Label>
              <Input
                id={`bed-rate-note-${bedId}`}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder={t("pages.propertyDetail.bedRate.notePlaceholder")}
                data-testid={`input-bed-rate-note-${bedId}`}
              />
            </div>
            {error && (
              <p
                className="text-xs text-destructive"
                data-testid={`text-bed-rate-error-${bedId}`}
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                onClick={handleSave}
                disabled={busy}
                data-testid={`button-save-bed-rate-${bedId}`}
              >
                {t("pages.propertyDetail.bedRate.save")}
              </Button>
            </DialogFooter>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold mb-2">
                {t("pages.propertyDetail.bedRate.history")}
              </p>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("pages.propertyDetail.bedRate.empty")}
                </p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-auto">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 text-xs"
                      data-testid={`row-bed-rate-${bedId}-${r.effectivePayWeekEndDate}`}
                    >
                      <span className="font-mono">
                        {r.effectivePayWeekEndDate}
                      </span>
                      <span className="tabular-nums">
                        {formatUsd(r.weeklyRate)}
                      </span>
                      <span className="flex-1 truncate text-muted-foreground">
                        {r.note}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleDelete(r.id)}
                        disabled={busy}
                        aria-label={t(
                          "pages.propertyDetail.bedRate.deleteAria",
                        )}
                        data-testid={`button-delete-bed-rate-${bedId}-${r.effectivePayWeekEndDate}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
