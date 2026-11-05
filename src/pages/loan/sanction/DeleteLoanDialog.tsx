import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { fmt, RULE, KEY, KEY_LINE, labelCls } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";

// Confirm before deleting a loan.
export function DeleteLoanDialog({ ls }: { ls: LoanSanctionState }) {
  const { deleteTarget, setDeleteTarget, deleting, payments, handleDelete } = ls;
  return (
    <>
      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => !deleting && setDeleteTarget(null)}>
        <DialogContent className="sheet-frame max-w-sm" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={labelCls}>Loan {deleteTarget?.LoanNo}</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete loan</DialogTitle>
            </div>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This will permanently delete <strong>{deleteTarget?.LoanNo}</strong> ({fmt(deleteTarget?.Amount)}).
            This cannot be undone. Deletion is blocked if any EMI has been marked paid or any
            repayment transaction exists — reverse those payments first.
          </p>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className={`${KEY_LINE} h-9 px-4`}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${KEY} h-9 px-5 bg-destructive text-destructive-foreground border border-destructive`}
            >
              {deleting ? "Deleting…" : "Delete loan"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
