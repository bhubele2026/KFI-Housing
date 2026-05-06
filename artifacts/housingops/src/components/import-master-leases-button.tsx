import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useImportMasterLeases,
  getListLeasesQueryKey,
  getListPropertiesQueryKey,
  getListCustomersQueryKey,
  type MasterLeaseImportResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Loader2 } from "lucide-react";

/**
 * Admin trigger for the master-lease importer (task #288). Opens a hidden
 * file picker so the operator can upload an updated copy of the master
 * spreadsheet; if they cancel without picking a file, we fall back to the
 * bundled `attached_assets/Housing_Lease_MASTER_*.xlsx` on the server.
 *
 * The import is fully idempotent — re-running over the same data produces
 * zero new rows and never overwrites operator-edited landlord / payment
 * data — so we don't gate the button behind a confirmation dialog.
 */
export function ImportMasterLeasesButton() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);

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
        // The generated mutation accepts an optional body; pass an empty
        // object when no file is selected so the server falls back to the
        // bundled master file.
        data: file ? { file } : ({} as { file: File }),
      });
      // Refresh the cached list queries so the leases / customers /
      // properties pages reflect the import without a hard reload.
      await queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListLeasesQueryKey() });
      toast({
        title: "Master file imported",
        description: summarize(result),
      });
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
    </>
  );
}
