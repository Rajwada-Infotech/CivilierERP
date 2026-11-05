// One assignment opened at the side of the list, and the delete confirmation.
import React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PenSquare, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { deleteAssignment, getAssignment, type AssignmentDetail } from "@/api/fixedAssetAssignmentApi";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, fmtDate } from "../record/config";
import { UserMark } from "./pickers";

export function AssignmentPanel({ id, canEdit, onEdit, onClose }: { id: number; canEdit: boolean; onEdit: () => void; onClose: () => void }) {
  const { data: d } = useQuery<AssignmentDetail>({ queryKey: ["fixed-asset-assignment", id], queryFn: () => getAssignment(id) });
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Assignment" className="w-full max-w-sm bg-card flex flex-col overflow-y-auto" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: RULE }}>
          <div>
            <p className={LBL}>Assignment</p>
            <p className="font-heading text-base font-bold tabular-nums text-foreground">{d?.DocNo || "…"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        {!d ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="p-5 space-y-4">
            {d.UserImage && <img src={d.UserImage} alt="With the asset" className="w-full h-40 object-cover" style={{ border: RULE }} />}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserMark name={d.UserName || "?"} avatarUrl={d.UserAvatar} size={32} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{d.UserName || "—"}</p>
                  <p className={LBL}>Assigned to</p>
                </div>
              </div>
              <SheetMark text={d.IsCurrent ? "Has it now" : "Earlier"} tone={d.IsCurrent ? "done" : "waiting"} />
            </div>
            {d.ResponsibleUserName && (
              <div className="flex items-center gap-2.5">
                <UserMark name={d.ResponsibleUserName} avatarUrl={d.ResponsibleUserAvatar} size={32} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{d.ResponsibleUserName}</p>
                  <p className={LBL}>Responsible</p>
                </div>
              </div>
            )}
            <dl className="text-sm" style={{ borderTop: RULE }}>
              {[
                ["Date", fmtDate(d.DocDate)],
                ["Financial year", d.FinYear],
                ["Asset", d.AssetName],
                ["FA Item Code", d.FAItemCode],
                ["Asset code", d.AssetCode],
                ["Project", d.ProjectName],
                ["Company", d.CompanyName],
                ["Made by", d.SourceTransferId ? `User-Wise Asset Transfer ${d.SourceTransferDocNo || ""}`.trim() : "Entered here"],
                ["Remarks", d.Remarks],
                ["Entered by", d.CreatedBy],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.12)" }}>
                  <dt className={`${LBL} pt-0.5 shrink-0`}>{k}</dt>
                  <dd className="font-medium text-right break-words">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {canEdit && <button onClick={onEdit} className={`${KEY_INK} h-9 px-4 w-full`}><PenSquare size={13} /> Edit</button>}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

export function DeleteAssignmentDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteAssignment(id),
    onSuccess: () => {
      toast.success("Assignment deleted");
      ["fixed-asset-assignments", "fixed-asset-assignment", "fixed-asset-assignable-assets", "fixed-assets", "fixed-asset-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Delete this assignment?" className="bg-card w-full max-w-md" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Delete this assignment?</p>
        </div>
        <p className="px-5 py-4 text-sm text-foreground">It is removed for good, and the asset goes back to whoever its latest remaining assignment names.</p>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className={`${KEY_RED} h-9 px-4`}>{del.isPending ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
