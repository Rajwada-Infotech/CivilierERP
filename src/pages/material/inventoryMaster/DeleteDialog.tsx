import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, RefreshCw } from "lucide-react";
import { deleteGodown, type Godown } from "@/api/godownsApi";
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────
export function DeleteDialog({
  godown,
  onClose,
}: {
  godown: Godown | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: deleteGodown,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete godown"),
  });

  // Reset stale error state when the dialog opens for a new godown
  React.useEffect(() => {
    if (godown) mut.reset();
  }, [godown?.GodownID]);

  if (!godown) return null;

  return (
    <BodyPortal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
          <Trash2 size={20} className="text-red-500" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-sm font-heading font-bold text-foreground">
            Delete Godown?
          </h2>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {godown.GodownName}
            </span>{" "}
            will be permanently removed. This cannot be undone.
          </p>
        </div>
        {mut.error && (
          <p className="text-xs text-red-600 text-center">
            {(mut.error as Error).message}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => mut.mutate(godown.GodownID)}
            disabled={mut.isPending}
            className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {mut.isPending ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            Delete
          </button>
        </div>
      </div>
    </div></BodyPortal>
  );
}
