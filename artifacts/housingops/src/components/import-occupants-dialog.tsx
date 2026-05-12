import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { getListOccupantsQueryKey } from "@workspace/api-client-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, Loader2, FileSpreadsheet } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type ImportOccupantsDialogProps = {
  trigger: React.ReactNode;
};

type ImportResponse = {
  created: number;
  skipped: number;
  skippedDetails: Array<{ row: number; name: string; reason: string }>;
  createdIds: string[];
};

// Column order shown in the downloaded template — must stay in sync
// with the header aliases the backend route accepts.
const TEMPLATE_HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Employee Id",
  "Company",
  "Customer",
  "Property",
  "Move-In Date",
  "Move-Out Date",
  "Charge Per Bed",
  "Billing Frequency",
  "Shift",
  "Status",
] as const;

const TEMPLATE_EXAMPLES: string[][] = [
  [
    "Jane Doe",
    "jane@example.com",
    "555-0101",
    "EMP-1001",
    "Acme Staffing",
    "Acme Manufacturing",
    "123 Main St House",
    "2026-01-15",
    "",
    "150",
    "Weekly",
    "Days",
    "Active",
  ],
  [
    "John Smith",
    "john@example.com",
    "555-0102",
    "EMP-1002",
    "Acme Staffing",
    "Acme Manufacturing",
    "123 Main St House",
    "2026-01-15",
    "",
    "150",
    "Weekly",
    "Nights",
    "Active",
  ],
];

const NOTES_LINES = [
  "Required columns: Name, Move-In Date.",
  "Move-In / Move-Out Date format: YYYY-MM-DD (e.g. 2026-01-15).",
  "Customer + Property must match an existing record (case-insensitive).",
  "Billing Frequency: Weekly, Biweekly, or Monthly (defaults to Monthly).",
  "Status: Active or Former (defaults to Active).",
  "Shift: Days, Nights, Overnights, or any custom shift you've added.",
  "Leave a column blank to skip it. Bed assignments are done in the app after import.",
];

function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: occupants template (header + example rows).
  const data: (string | number)[][] = [
    [...TEMPLATE_HEADERS],
    ...TEMPLATE_EXAMPLES,
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Generous default column widths so operators can read labels.
  ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({
    wch: Math.max(14, h.length + 4),
  }));
  XLSX.utils.book_append_sheet(wb, ws, "Occupants");

  // Sheet 2: instructions.
  const notes: string[][] = [["Instructions"], [""], ...NOTES_LINES.map((l) => [l])];
  const ws2 = XLSX.utils.aoa_to_sheet(notes);
  ws2["!cols"] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

  return wb;
}

function downloadTemplate(): void {
  const wb = buildTemplateWorkbook();
  XLSX.writeFile(wb, "occupants-import-template.xlsx");
}

export function ImportOccupantsDialog({ trigger }: ImportOccupantsDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setLastResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${baseUrl}api/occupants/import-xlsx`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body?.error ?? `Upload failed (HTTP ${res.status})`);
      }
      const body = (await res.json()) as ImportResponse;
      setLastResult(body);
      // Refresh the occupants list so newly imported people show up
      // everywhere (occupants page, dashboard, beds, etc.).
      await queryClient.invalidateQueries({
        queryKey: getListOccupantsQueryKey(),
      });
      if (body.created > 0) {
        toast({
          title: t("importOccupants.successTitle", "Occupants imported"),
          description: t(
            "importOccupants.successDescription",
            "Imported {{created}} occupants. {{skipped}} skipped.",
            { created: body.created, skipped: body.skipped },
          ),
        });
      } else {
        toast({
          title: t("importOccupants.noneImportedTitle", "No occupants imported"),
          description: t(
            "importOccupants.noneImportedDescription",
            "Every row was skipped — check the details below.",
          ),
          variant: "destructive",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: t("importOccupants.failedTitle", "Import failed"),
        description: message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="dialog-import-occupants"
      >
        <DialogHeader>
          <DialogTitle>
            {t("importOccupants.title", "Import occupants")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "importOccupants.description",
              "Download the Excel template, fill in your occupants, then upload the file to add them in bulk.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border p-4">
            <div className="mb-2 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium">
                {t("importOccupants.step1", "1. Download template")}
              </h4>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t(
                "importOccupants.step1Description",
                "An Excel file with the columns we need: name, customer, property, move-in date, charge, and more.",
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              data-testid="button-download-occupants-template"
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("importOccupants.downloadTemplate", "Download template")}
            </Button>
          </div>

          <div className="rounded-md border p-4">
            <div className="mb-2 flex items-center gap-2">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium">
                {t("importOccupants.step2", "2. Upload filled file")}
              </h4>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t(
                "importOccupants.step2Description",
                "We'll match each row to your existing customers and properties by name and create the occupants.",
              )}
            </p>
            <Button
              size="sm"
              onClick={handlePickFile}
              disabled={uploading}
              data-testid="button-upload-occupants-xlsx"
              className="w-full"
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {uploading
                ? t("importOccupants.uploading", "Uploading...")
                : t("importOccupants.upload", "Choose .xlsx file")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileSelected}
              data-testid="input-import-occupants-file"
            />
          </div>
        </div>

        {lastResult ? (
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="mb-2 text-sm font-medium">
              {t("importOccupants.resultTitle", "Last import result")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t(
                "importOccupants.resultSummary",
                "Created: {{created}} • Skipped: {{skipped}}",
                {
                  created: lastResult.created,
                  skipped: lastResult.skipped,
                },
              )}
            </div>
            {lastResult.skippedDetails.length > 0 ? (
              <ScrollArea className="mt-2 max-h-40 rounded border bg-background p-2">
                <ul className="space-y-1 text-xs">
                  {lastResult.skippedDetails.map((s, i) => (
                    <li key={i} data-testid={`skipped-row-${i}`}>
                      <span className="font-medium">Row {s.row}</span>
                      {s.name ? ` (${s.name})` : ""}: {s.reason}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            data-testid="button-close-import-occupants"
          >
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
