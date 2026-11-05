// Changing a tagging entry's date or remarks, deleting one, and removing received stock nobody has tagged.
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { deleteFixedAssetTagging, deletePendingBatch, updateFixedAssetTagging, type TaggingListItem } from "@/api/fixedAssetTaggingApi";
import { Field, INP, KEY_INK, KEY_LINE, KEY_RED, RULE } from "../record/config";

const REFRESH = ["fixed-asset-taggings", "fixed-asset-inventory-imports", "fixed-asset-eligible-items", "fixed-asset-pending-batches", "fa-unassigned-codes", "fixed-assets", "fixed-asset-dashboard"];

const Sheet: React.FC<{ title: string; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }> = ({ title, children, actions, onClose }) =>
  createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-card w-full max-w-md" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</p>
        </div>
        <div className="px-5 py-4 text-sm text-foreground space-y-3">{children}</div>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>{actions}</div>
      </div>
    </div>,
    document.body,
  );

export function EditTaggingDialog({ tag, onClose }: { tag: TaggingListItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [docDate, setDocDate] = useState(tag.DocDate?.slice(0, 10) || "");
  const [remarks, setRemarks] = useState(tag.Remarks || "");
  const save = useMutation({
    mutationFn: () => updateFixedAssetTagging(tag.TagId, { docDate, remarks: remarks || undefined }),
    onSuccess: () => {
      toast.success("Tagging entry updated");
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-inventory-imports"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet
      title="Edit tagging entry"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => (docDate ? save.mutate() : toast.error("Enter the date."))} disabled={save.isPending} className={`${KEY_INK} h-9 px-4`}>
            <Check size={13} /> {save.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground font-heading tabular-nums">{tag.DocNo} · {tag.FAItemCode}</p>
      <Field label="Date" required>
        <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={INP} />
      </Field>
      <Field label="Remarks">
        <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={INP} />
      </Field>
    </Sheet>
  );
}

export function DeleteTaggingDialog({ tagId, onClose }: { tagId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: deleteFixedAssetTagging,
    onSuccess: () => {
      toast.success("Tagging entry deleted");
      REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet
      title="Delete this tagging entry?"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
          <button onClick={() => del.mutate(tagId)} disabled={del.isPending} className={`${KEY_RED} h-9 px-4`}>{del.isPending ? "Deleting…" : "Delete"}</button>
        </>
      }
    >
      <p>The entry is removed for good and its unit goes back to untagged stock.</p>
    </Sheet>
  );
}

export function DeletePendingDialog({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: deletePendingBatch,
    onSuccess: () => {
      toast.success("Removed from FA Inventory");
      REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => { toast.error(e.message); onClose(); },
  });
  return (
    <Sheet
      title="Remove this received stock?"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
          <button onClick={() => del.mutate(assetId)} disabled={del.isPending} className={`${KEY_RED} h-9 px-4`}>{del.isPending ? "Removing…" : "Remove"}</button>
        </>
      }
    >
      <p>It is removed from FA Inventory for good. The GRN itself is not changed.</p>
    </Sheet>
  );
}
