import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KEY, KEY_LINE, LBL, RULE } from "./config";
import type { IssueReturnState } from "./useIssueReturn";

// Confirm before deleting a return (only draft or rejected ones, which never touched stock).
export function IRDeleteDialog({ m }: { m: IssueReturnState }) {
  const { deleting, setDeleting, deleteMut } = m;
  const close = () => setDeleting(null);
  return (
    <Dialog open={!!deleting} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sheet-frame max-w-sm p-0 gap-0" style={{ margin: 0 }}>
        <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>Issue return</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete {deleting?.DocNo || "this return"}?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">The return is removed for good. It was never approved, so no stock moves.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button type="button" onClick={close} className={`${KEY_LINE} h-9 px-4`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={deleteMut.isPending}
            onClick={() => {
              deleteMut.mutate(deleting!.ReturnId);
              close();
            }}
            className={`${KEY} h-9 px-4 bg-destructive text-destructive-foreground border border-destructive`}
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
