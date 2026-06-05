import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import type { AccountClassification } from "./types";

function apiBase(): string {
  return import.meta.env.BASE_URL ?? "/";
}

export function AccountClassificationRules({
  rows,
  onChanged,
}: {
  rows: AccountClassification[];
  onChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const update = async (
    id: string,
    classification: "rent" | "utility" | "other",
  ) => {
    try {
      const res = await fetch(
        `${apiBase()}api/qbo/mapping-rules/account/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classification }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
    } catch (err) {
      toast({
        title: "Failed to update classification",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Choose how each QuickBooks income / expense account maps to rent or
        utilities for reconciliation. Memo rules override account
        classifications when both match.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead className="w-40">Classification</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground">
                Sync QuickBooks once so accounts appear here.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.accountName}</TableCell>
                <TableCell>
                  <Select
                    value={c.classification}
                    onValueChange={(v) =>
                      void update(c.id, v as "rent" | "utility" | "other")
                    }
                  >
                    <SelectTrigger data-testid={`account-class-${c.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rent">Rent</SelectItem>
                      <SelectItem value="utility">Utility</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
