import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useImportMasterLeases,
  getListLeasesQueryKey,
  getListPropertiesQueryKey,
  getListCustomersQueryKey,
  type MasterLeaseImportResult,
  type MasterLeaseImportRowDecision,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

export function ImportMasterLeasesButton() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<MasterLeaseImportResult | null>(null);

  const { mutateAsync } = useImportMasterLeases();

  const summarize = (result: MasterLeaseImportResult): string => {
    const parts: string[] = [];
    if (result.customersCreated > 0)
      parts.push(`${result.customersCreated} new customer(s)`);
    if (result.propertiesCreated > 0)
      parts.push(`${result.propertiesCreated} new propert(y/ies)`);
    if (result.leasesCreated > 0)
      parts.push(`${result.leasesCreated} new lease(s)`);
    if (parts.length === 0) parts.push("no new rows");
    if (result.rowsNeedingReview.length > 0) {
      parts.push(`${result.rowsNeedingReview.length} flagged for review`);
    }
    return parts.join(", ");
  };

  const runImport = async (file: File | null) => {
    setPending(true);
    try {
      const result = await mutateAsync({
        data: file ? { file } : ({} as { file: File }),
      });
      await queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListLeasesQueryKey() });
      setImportResult(result);
      setResultDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Master file import failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        data-testid="input-import-master-file"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          void runImport(file);
        }}
      />
      <Button
        variant="outline"
        disabled={pending}
        data-testid="button-import-master-leases"
        onClick={() => fileInput.current?.click()}
        title="Re-import the master housing-lease spreadsheet (idempotent)"
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="mr-2 h-4 w-4" />
        )}
        Import master file
      </Button>

      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="master-import-results-dialog">
          <DialogHeader>
            <DialogTitle>Master file imported</DialogTitle>
            <DialogDescription>
              {importResult ? summarize(importResult) : ""}
            </DialogDescription>
          </DialogHeader>

          {importResult && (
            <div className="space-y-4 py-2">
              <FixupsSection rows={importResult.rowsWithFixups} />
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setResultDialogOpen(false)} data-testid="button-close-import-results">
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FixupsSection({ rows }: { rows: MasterLeaseImportRowDecision[] }) {
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        data-testid="no-fixups-message"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        No fix-ups needed — every cell was canonical.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="fixups-section">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-sm font-medium">
          {rows.length} row{rows.length === 1 ? "" : "s"} had values rewritten
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        These source-file cells were automatically corrected during import. Consider
        fixing them upstream so future imports don't need the coercion.
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <FixupRowCard key={`${row.sourceRow}-${row.customerName}`} row={row} />
        ))}
      </div>
    </div>
  );
}

function FixupRowCard({ row }: { row: MasterLeaseImportRowDecision }) {
  return (
    <div
      className="rounded-md border bg-muted/30 p-3 space-y-2"
      data-testid={`fixup-row-${row.sourceRow}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="font-mono text-xs">
          Row {row.sourceRow}
        </Badge>
        <span className="text-sm font-medium truncate">{row.customerName}</span>
      </div>
      <div className="space-y-1">
        {row.fixups.map((f, i) => (
          <div
            key={`${f.field}-${i}`}
            className="flex items-start gap-1.5 text-xs"
          >
            <Badge variant="secondary" className="shrink-0 font-mono text-[11px] px-1.5">
              {f.field}
            </Badge>
            <span className="text-muted-foreground truncate" title={f.before}>
              {f.before}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" />
            <span className="font-medium truncate" title={f.after}>
              {f.after}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
