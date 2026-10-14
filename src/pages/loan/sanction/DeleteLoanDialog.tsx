import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { fmt } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";

// Confirm before deleting a loan.
export function DeleteLoanDialog({ ls }: { ls: LoanSanctionState }) {
  const { deleteTarget, setDeleteTarget, deleting, payments, handleDelete } = ls;
  return (
    <>
      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} /> Delete Loan
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This will permanently delete <strong>{deleteTarget?.LoanNo}</strong> ({fmt(deleteTarget?.Amount)}).
            This cannot be undone. Deletion is blocked if any EMI has been marked paid or any
            repayment transaction exists — reverse those payments first.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {deleting ? "Deleting…" : "Delete Loan"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
