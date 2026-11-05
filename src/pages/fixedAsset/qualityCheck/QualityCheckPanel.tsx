// One quality check opened at the side of the list, the delete confirmation, and a full-size picture viewer.
import React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CalendarPlus, CheckCircle2, Loader2, PenSquare, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { deleteQualityCheck, getQualityCheck, type QualityCheckItem } from "@/api/fixedAssetQualityCheckApi";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, fmtDate } from "../record/config";
import { QC_REFRESH } from "./QualityCheckForm";

export const conditionTone = (s: string) => (s === "Good" ? "done" : s === "Defective" ? "stopped" : "waiting") as "done" | "waiting" | "stopped";
export const followUpTone = (s: string, overdue?: boolean) => (overdue ? "stopped" : s === "Completed" ? "done" : s === "Cancelled" ? "none" : "waiting") as "done" | "waiting" | "stopped" | "none";

export function QualityCheckPanel({
  id, canEdit, canCreate, onEdit, onFollowUp, onStatus, onView, onClose,
}: {
  id: number; canEdit: boolean; canCreate: boolean;
  onEdit: () => void; onFollowUp: (c: QualityCheckItem) => void; onStatus: (status: "Completed" | "Cancelled") => void;
  onView: (src: string, label: string) => void; onClose: () => void;
}) {
  const { data: d } = useQuery<QualityCheckItem>({ queryKey: ["fa-quality-check", id], queryFn: () => getQualityCheck(id) });
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Quality check" className="w-full max-w-sm bg-card flex flex-col overflow-y-auto" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: RULE }}>
          <div>
            <p className={LBL}>Quality check</p>
            <p className="font-heading text-base font-bold tabular-nums text-foreground">{d?.DocNo || "…"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        {!d ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="p-5 space-y-4">
            {(d.ItemPicture || d.UserPhoto) && (
              <div className="flex gap-3">
                {d.ItemPicture && (
                  <button type="button" onClick={() => onView(d.ItemPicture!, `Asset · ${d.DocNo || ""}`)} title="View full size">
                    <img src={d.ItemPicture} alt="Asset" className="h-20 w-20 object-cover" style={{ border: RULE }} />
                  </button>
                )}
                {d.UserPhoto && (
                  <button type="button" onClick={() => onView(d.UserPhoto!, "Person with it")} title="View full size">
                    <img src={d.UserPhoto} alt="Person" className="h-20 w-20 object-cover" style={{ border: RULE }} />
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <SheetMark text={d.QualityStatus} tone={conditionTone(d.QualityStatus)} />
              <SheetMark text={d.IsOverdue ? "Overdue" : d.FollowUpStatus} tone={followUpTone(d.FollowUpStatus, d.IsOverdue === 1)} />
            </div>
            <dl className="text-sm" style={{ borderTop: RULE }}>
              {[
                ["Checked on", fmtDate(d.DocDate)],
                ["Asset", d.ItemName],
                ["FA Item Code", d.FAItemCode],
                ["Asset code", d.AssetCode],
                ["Had it", d.CurrentUserName],
                ["Project", d.ProjectName],
                ["Remarks", d.Remarks],
                ["Check again on", fmtDate(d.NextFollowUpDate)],
                ["Type", d.FollowUpType],
                ["Responsible", d.ResponsibleUserName],
                ["Last checked on", fmtDate(d.LastFollowUpDate)],
                ["Follow-up remarks", d.FollowUpRemarks],
                ["What to do next", d.NextActionNotes],
                ["Entered by", d.CreatedBy],
                ...(d.CompletedAt ? [["Closed", `${d.CompletedBy || ""} · ${fmtDate(d.CompletedAt)}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.12)" }}>
                  <dt className={`${LBL} pt-0.5 shrink-0`}>{k}</dt>
                  <dd className="font-medium text-right break-words">{v && v !== "—" ? v : "—"}</dd>
                </div>
              ))}
            </dl>
            {canEdit && d.FollowUpStatus === "Pending" && (
              <div className="flex gap-2">
                <button onClick={() => onStatus("Completed")} className={`${KEY_INK} h-9 px-3 flex-1`}><CheckCircle2 size={13} /> Done</button>
                <button onClick={() => onStatus("Cancelled")} className={`${KEY_LINE} h-9 px-3 flex-1`}><Ban size={13} /> Cancel it</button>
              </div>
            )}
            <div className="flex gap-2">
              {canCreate && <button onClick={() => onFollowUp(d)} className={`${KEY_LINE} h-9 px-3 flex-1`}><CalendarPlus size={13} /> Next check</button>}
              {canEdit && <button onClick={onEdit} className={`${KEY_LINE} h-9 px-3 flex-1`}><PenSquare size={13} /> Edit</button>}
            </div>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

export function DeleteQualityCheckDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteQualityCheck(id),
    onSuccess: () => {
      toast.success("Quality check deleted");
      QC_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Delete this quality check?" className="bg-card w-full max-w-md" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Delete this quality check?</p>
        </div>
        <p className="px-5 py-4 text-sm text-foreground">It is removed for good, and its reminders stop.</p>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className={`${KEY_RED} h-9 px-4`}>{del.isPending ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PictureViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8 bg-black/80" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 w-9 h-9 inline-flex items-center justify-center text-white" style={{ border: "1px solid rgba(255,255,255,0.6)" }}><X size={18} /></button>
      <figure className="flex flex-col items-center gap-3 max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={label} className="max-w-full max-h-[82vh] object-contain" />
        <figcaption className="text-xs text-white/80">{label}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}
