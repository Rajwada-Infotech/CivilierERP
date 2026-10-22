import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KEY, KEY_LINE, LBL, RULE } from "./config";
import type { IssuesState } from "./useIssues";

// Confirm before deleting an issue: deleting it puts the issued stock back in the godown.
export function IssueDeleteDialog({ m }: { m: IssuesState }) {
  const { deletingIssue, setDeletingIssue, deleteMutation } = m;
  const close = () => setDeletingIssue(null);
  return (
    <Dialog open={!!deletingIssue} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sheet-frame max-w-sm p-0 gap-0" style={{ margin: 0 }}>
        <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>Material issue</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
            Delete {deletingIssue?.DocNo || deletingIssue?.IssueNo || "this issue"}?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            The issue is removed for good and its quantities go back into {deletingIssue?.GodownName || "the godown"}'s stock.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button type="button" onClick={close} className={`${KEY_LINE} h-9 px-4`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate(deletingIssue.IssueId);
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
