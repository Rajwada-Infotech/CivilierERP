// Reversing an import: first asks the server what it would take back (the stock, its FA Item Codes and any fixed
// asset records made from them), or why it can't be done, then reverses on confirm.
import React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { deleteInventoryImport, getInventoryImportReversalPlan } from "@/api/fixedAssetInventoryImportApi";
import { KEY_LINE, KEY_RED, LBL, RULE } from "../record/config";

export function ReverseImportDialog({ importId, docNo, onClose }: { importId: number; docNo: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: plan, isLoading, isError, error } = useQuery({ queryKey: ["fa-import-reversal-plan", importId], queryFn: () => getInventoryImportReversalPlan(importId) });
  const rev = useMutation({
    mutationFn: () => deleteInventoryImport(importId),
    onSuccess: () => {
      toast.success(`Reversed ${docNo || "the import"}`);
      ["fixed-asset-inventory-imports", "fixed-asset-eligible-items", "fixed-asset-pending-batches", "fixed-asset-taggings", "fa-unassigned-codes", "fixed-assets", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canReverse = !!plan?.reversible;
  const title = isLoading ? "Reverse this import?" : canReverse ? `Reverse ${docNo || "this import"}?` : "This import can't be reversed";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-card w-full max-w-md" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</p>
        </div>
        <div className="px-5 py-4 text-sm text-foreground space-y-2">
          {isLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Checking what depends on it…</p>
          ) : isError ? (
            <p className="text-destructive">{(error as Error)?.message}</p>
          ) : !canReverse ? (
            <p>{plan?.message}</p>
          ) : (
            <>
              <p>
                This takes back the imported stock, its {plan!.taggedCount ?? 0} FA Item Code{plan!.taggedCount === 1 ? "" : "s"}
                {plan!.unitCount ? ` and ${plan!.unitCount} fixed asset record${plan!.unitCount === 1 ? "" : "s"} made from them` : ""}.
              </p>
              {!!plan!.units?.length && (
                <ul className="max-h-40 overflow-y-auto text-xs font-heading tabular-nums" style={{ border: "1px solid hsl(var(--foreground) / 0.2)" }}>
                  {plan!.units.map((u) => (
                    <li key={u.assetId} className="px-3 py-1.5 flex justify-between gap-3" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.1)" }}>
                      <span className="truncate">{u.assetName}</span>
                      <span className="text-muted-foreground shrink-0">{u.faItemCode || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className={LBL}>The import stays in the history, marked reversed.</p>
            </>
          )}
        </div>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>{canReverse ? "Cancel" : "Close"}</button>
          {canReverse && (
            <button onClick={() => rev.mutate()} disabled={rev.isPending} className={`${KEY_RED} h-9 px-4`}>{rev.isPending ? "Reversing…" : "Reverse"}</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
