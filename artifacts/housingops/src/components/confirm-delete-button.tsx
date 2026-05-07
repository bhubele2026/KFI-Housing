import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export interface ConfirmDeleteButtonProps {
  /** Anything clickable. The dialog opens when this element is clicked. */
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  onConfirm: () => void;
  /** data-testid on the dialog content for regression tests. */
  testId?: string;
}

/**
 * Wraps a trigger element with an AlertDialog confirmation flow before
 * firing {@link onConfirm}. Used for every destructive row-level action
 * (delete lease/bed/utility/room) so the operator can't accidentally
 * nuke data with a stray click during the demo.
 *
 * The dialog manages its own open state so callers don't have to wire
 * a useState for each delete button. The trigger's existing handlers
 * (e.g. `e.stopPropagation()` on a clickable table row) still run —
 * Radix merges its open-handler with the trigger's existing onClick.
 */
export function ConfirmDeleteButton({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  testId,
}: ConfirmDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("confirmDelete.delete");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent
        data-testid={testId}
        // Stop propagation on the dialog itself so clicks inside the
        // dialog (e.g. on the Cancel/Delete buttons) never bubble back
        // up to a clickable parent row in tables like leases-table.
        onClick={(e) => e.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-delete-cancel">
            {t("confirmDelete.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete-confirm"
          >
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
