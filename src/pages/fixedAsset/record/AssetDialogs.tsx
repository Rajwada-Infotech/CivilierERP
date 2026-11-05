// The two ways an asset leaves the register: a plain delete, and Delete & Reverse, which also takes back the
// stock it came from (the GRN's received quantity or the imported inventory).
import React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { deleteFixedAsset, getFixedAssetReversalPlan, reverseFixedAsset } from "@/api/fixedAssetApi";
import { KEY_LINE, KEY_RED, LBL, RULE } from "./config";

const REFRESH = ["fixed-assets", "fa-unassigned-codes", "fixed-asset-taggings", "fixed-asset-eligible-items", "fixed-asset-inventory-imports", "fixed-asset-dashboard"];

const Sheet: React.FC<{ title: string; children: React.ReactNode; actions: React.ReactNode }> = ({ title, children, actions }) =>
  createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-card w-full max-w-md" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</p>
        </div>
        <div className="px-5 py-4 text-sm text-foreground space-y-2">{children}</div>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>{actions}</div>
      </div>
    </div>,
    document.body,
  );

export function DeleteAssetDialog({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: deleteFixedAsset,
    onSuccess: () => {
      toast.success("Asset deleted");
      REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet
      title="Delete this asset?"
      actions={
        <>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => del.mutate(assetId)} disabled={del.isPending} className={`${KEY_RED} h-9 px-4`}>{del.isPending ? "Deleting…" : "Delete"}</button>
        </>
      }
    >
      <p>The record is removed for good and its FA Item Code goes back to FA Inventory, unassigned.</p>
    </Sheet>
  );
}

export function ReverseAssetDialog({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: plan, isLoading } = useQuery({ queryKey: ["fa-reversal-plan", assetId], queryFn: () => getFixedAssetReversalPlan(assetId) });
  const rev = useMutation({
    mutationFn: reverseFixedAsset,
    onSuccess: (r) => {
      toast.success(r.grnDeleted ? "Asset reversed: GRN and inventory removed" : "Asset reversed: inventory removed");
      REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !plan) {
    return (
      <Sheet title="Delete & reverse" actions={<button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>}>
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Checking what depends on this asset…</p>
      </Sheet>
    );
  }
  if (!plan.reversible) {
    return (
      <Sheet title="This asset can't be reversed" actions={<button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>}>
        <p>{plan.message}</p>
      </Sheet>
    );
  }
  return (
    <Sheet
      title="Delete & reverse?"
      actions={
        <>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => rev.mutate(assetId)} disabled={rev.isPending} className={`${KEY_RED} h-9 px-4`}>{rev.isPending ? "Reversing…" : "Delete & reverse"}</button>
        </>
      }
    >
      <p>
        This removes for good{" "}
        {plan.sourceType === "GRN" ? <>the received quantity from GRN <span className="font-heading tabular-nums">{plan.grnDocNo}</span></> : "the imported inventory"}, its{" "}
        {plan.taggedCount} FA Item Code{plan.taggedCount === 1 ? "" : "s"}
        {plan.unitCount > 0 ? ` and ${plan.unitCount} fixed asset record${plan.unitCount === 1 ? "" : "s"}` : ""} made from it.
      </p>
      {plan.sourceType === "GRN" && <p className="text-muted-foreground">The GRN itself is deleted only if no other item on it still has stock; otherwise just this item's stock goes.</p>}
      <p className={LBL}>Use this only when the asset has to be received again through a new GRN or Inventory Import.</p>
    </Sheet>
  );
}
