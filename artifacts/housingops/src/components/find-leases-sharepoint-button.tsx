import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CloudDownload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface ScanFile { folder: string; file: string; lastModified: string; isNew: boolean; }
interface ScanResult {
  configured: boolean;
  message?: string;
  error?: string;
  scannedFolders?: number;
  leaseDocsFound?: number;
  newCount?: number;
  files?: ScanFile[];
  expiry?: { active: number; expired: number; upcoming: number; total: number };
  note?: string;
}

/**
 * "Find new leases" — scans the SharePoint master lease folder via the
 * api-server (which talks to Microsoft Graph). Shows new vs known lease docs
 * and lease expiry stats; if Graph isn't configured yet, shows a setup note.
 */
export function FindLeasesSharePointButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const scan = async () => {
    setOpen(true);
    setLoading(true);
    setResult(null);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${baseUrl}api/leases/scan-sharepoint`, { method: "POST" });
      setResult((await res.json()) as ScanResult);
    } catch {
      setResult({ configured: true, error: "Couldn't reach the server. Try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={scan} data-testid="button-find-leases-sharepoint">
        <CloudDownload className="mr-2 h-4 w-4" />
        Find new leases
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Find new leases — SharePoint</DialogTitle>
            <DialogDescription>
              Scans the “Housing Master File and Leases / Leases” folder and flags leases not yet in the app.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning SharePoint…
            </div>
          )}

          {!loading && result && (
            <div className="space-y-4">
              {result.expiry && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">{result.expiry.active} active</Badge>
                  <Badge variant="secondary" className="text-amber-700">{result.expiry.upcoming} upcoming</Badge>
                  <Badge variant="secondary" className="text-red-700">{result.expiry.expired} expired</Badge>
                  <span className="text-muted-foreground">of {result.expiry.total} leases in app</span>
                </div>
              )}

              {result.configured === false && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{result.message}</span>
                </div>
              )}

              {result.error && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{result.error}</span>
                </div>
              )}

              {result.configured && !result.error && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Scanned {result.scannedFolders} folders · {result.leaseDocsFound} lease docs ·{" "}
                    <span className="font-semibold">{result.newCount} new</span>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-md border">
                    {(result.files ?? []).map((f, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-0">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{f.file}</div>
                          <div className="truncate text-xs text-muted-foreground">{f.folder}</div>
                        </div>
                        {f.isNew ? (
                          <Badge className="bg-blue-600">New</Badge>
                        ) : (
                          <Badge variant="secondary">In app</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  {result.note && <p className="text-xs text-muted-foreground">{result.note}</p>}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
