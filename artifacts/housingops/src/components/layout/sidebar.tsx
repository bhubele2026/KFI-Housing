import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Building2, LayoutDashboard, Home, KeyRound, BedDouble, Users, Zap, DollarSign, LogOut, RotateCcw, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useData, type ImportSummary } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/leases", label: "Leases", icon: KeyRound },
  { href: "/beds", label: "Beds", icon: BedDouble },
  { href: "/occupants", label: "Occupants", icon: Users },
  { href: "/utilities", label: "Utilities", icon: Zap },
  { href: "/finance", label: "Finance", icon: DollarSign },
];

export function Sidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const { resetToSampleData, exportData, importData } = useData();
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ payload: unknown; fileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleConfirmReset = () => {
    resetToSampleData();
    setResetOpen(false);
    toast({
      title: "Sample data restored",
      description: "All saved changes were cleared and the demo data was reloaded.",
    });
  };

  const handleExport = () => {
    try {
      const payload = exportData();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = url;
      a.download = `housingops-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Data exported",
        description: `Saved ${a.download} with ${payload.data.properties.length} properties, ${payload.data.leases.length} leases, ${payload.data.beds.length} beds, ${payload.data.occupants.length} occupants, ${payload.data.utilities.length} utilities.`,
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate the export file. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePickImportFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPendingImport({ payload: parsed, fileName: file.name });
      setImportOpen(true);
    } catch {
      toast({
        title: "Could not read file",
        description: "That file is not valid JSON. Please choose a HousingOps export file.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    let summary: ImportSummary;
    try {
      summary = importData(pendingImport.payload);
    } catch {
      toast({
        title: "Import failed",
        description: "That file doesn't look like a HousingOps export. No changes were made.",
        variant: "destructive",
      });
      setImportOpen(false);
      setPendingImport(null);
      return;
    }
    setImportOpen(false);
    setPendingImport(null);
    toast({
      title: "Data imported",
      description: `Loaded ${summary.properties} properties, ${summary.leases} leases, ${summary.beds} beds, ${summary.occupants} occupants, ${summary.utilities} utilities.`,
    });
  };

  const handleCancelImport = () => {
    setImportOpen(false);
    setPendingImport(null);
  };

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border bg-sidebar-accent/30">
        <Building2 className="mr-3 h-6 w-6 text-primary" />
        <span className="text-xl font-bold tracking-tight">HousingOps</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-5 w-5 flex-shrink-0 transition-colors",
                    isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground"
                  )}
                  aria-hidden="true"
                />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 bg-sidebar-accent/10 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm shadow-sm">
              AM
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium">Admin Manager</p>
              <p className="text-xs text-sidebar-foreground/60">admin@housingops.com</p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleExport}
          data-testid="button-export-data"
        >
          <Download className="mr-2 h-4 w-4" />
          Export data
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handlePickImportFile}
          data-testid="button-import-data"
        >
          <Upload className="mr-2 h-4 w-4" />
          Import data
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileSelected}
          data-testid="input-import-file"
        />
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setResetOpen(true)}
          data-testid="button-reset-sample-data"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset to sample data
        </Button>
        <Button variant="outline" className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to sample data?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears every saved change in this browser — properties, leases, beds, occupants,
              and utilities — and reloads the original demo data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReset}
              data-testid="button-reset-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelImport();
          else setImportOpen(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current data with import?</AlertDialogTitle>
            <AlertDialogDescription>
              Importing <span className="font-medium">{pendingImport?.fileName ?? "this file"}</span> will
              replace every property, lease, bed, occupant, and utility in this browser with the contents
              of the file. Your current data will be lost. Consider exporting first if you want a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-import-cancel" onClick={handleCancelImport}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              data-testid="button-import-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Replace data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
