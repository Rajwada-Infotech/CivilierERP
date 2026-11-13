// One BOQ opened: details, lines, approval, print, edit / delete.
import React, { useState } from "react";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Trash2, Edit3, Printer, ArrowLeft, Send, FilePenLine } from "lucide-react";
import { KEY_INK, KEY_LINE, KEY_RED } from "@/components/sheet/sheetParts";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { BoqRecord, Company, Project, UomOption, apiFetch, fmt, fmtDate, rowToItem, rowToActivity, DetailRow, canEditBoq } from "./config";
import { LineEditor } from "./LineEditor";

// ─────────────────────────────────────────────────────────────────────────────
// Detail / View Modal
// ─────────────────────────────────────────────────────────────────────────────

export interface DetailModalProps {
  record: BoqRecord;
  uoms: UomOption[];
  onClose: () => void;
  onEdit: () => void;
  /** Amend an approved BOQ (with a reason; applied once approved — Work Orders still on its old rates follow). */
  onAmend?: () => void;
  onPrint: () => void;
  onRefresh: () => void;
  canDelete: boolean;
  canPrint: boolean;
  canEdit: boolean;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  record,
  uoms,
  onClose,
  onEdit,
  onAmend,
  onPrint,
  onRefresh,
  canDelete,
  canPrint,
  canEdit,
}) => {
  const [lineTab, setLineTab] = useState<"items" | "activities">("activities");
  const [acting, setActing] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const doDelete = async () => {
    setConfirmDelete(false);
    setActing(true);
    try {
      await apiFetch(`/boq/${record.BoqID}`, { method: "DELETE" });
      toast.success("BOQ deleted");
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    } finally {
      setActing(false);
    }
  };

  const doTransition = async (action: string) => {
    setActing(true);
    try {
      await apiFetch(`/api/boq/${record.BoqID}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      toast.success(
        action === "submit" ? "Submitted for approval" : "Status updated",
      );
      onRefresh();
    } catch (err: any) {
      toast.error(err.message ?? "Action failed");
    } finally {
      setActing(false);
    }
  };

  const itemsTotal = (record.BoqItems ?? []).reduce(
    (s, r) => s + (r.amount || 0),
    0,
  );
  const activitiesTotal = (record.BoqActivities ?? []).reduce(
    (s, r) => s + (r.amount || 0),
    0,
  );

  return (
    <div
      className="flex flex-col animate-in fade-in"
      style={{ minHeight: "calc(100vh - 112px)" }}
    >
      <div className="w-full flex flex-col">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 10,
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--foreground))",
            background: "hsl(var(--card))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
            <button type="button" onClick={onClose} className={`${KEY_LINE} h-8 px-3`}>
              <ArrowLeft size={12} /> Back
            </button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--foreground) / 0.2)" }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "hsl(var(--foreground))",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span className="font-heading">{record.BoqNo || record.DocNo}</span>
            </span>
            <ApprovalStatusChain table="BOQ" recordId={record.BoqID} fallback={<SheetMark text={record.Status || "Draft"} tone={statusTone(record.Status || "Draft")} />} />
          </div>

          {/* Right-side actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {canDelete && (
              <button type="button" disabled={acting} onClick={() => setConfirmDelete(true)} className={`${KEY_RED} h-8 px-3`}>
                <Trash2 size={12} /> Delete
              </button>
            )}
            {canEdit && (record.Status === "Draft" || record.Status === "Approved" || record.Status === "Rejected") && (
              <button type="button" disabled={acting} onClick={onEdit} className={`${KEY_LINE} h-8 px-3`}>
                <Edit3 size={12} /> Edit
              </button>
            )}
            {record.Status === "Draft" && (
              <button type="button" disabled={acting} onClick={() => doTransition("submit")} className={`${KEY_INK} h-8 px-3`}>
                <Send size={12} /> Submit for approval
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Status banner */}
          {record.Status !== "Draft" && (
            <div
              style={{
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: `1px solid ${record.Status === "Approved" ? "hsl(var(--primary))" : record.Status === "Rejected" ? "hsl(var(--destructive))" : "hsl(var(--foreground))"}`,
                background: record.Status === "Approved" ? "hsl(var(--primary) / 0.06)" : record.Status === "Rejected" ? "hsl(var(--destructive) / 0.06)" : "hsl(var(--foreground) / 0.04)",
                color: record.Status === "Rejected" ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
              }}
            >
              <SheetMark text={record.Status || "Draft"} tone={statusTone(record.Status || "Draft")} />
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {record.Status === "Pending"
                  ? "Awaiting admin approval from the Approval Inbox."
                  : null}
                {record.Status === "Approved" &&
                  `Approved${record.ApprovedBy ? ` by ${record.ApprovedBy}` : ""}.`}
                {record.Status === "Rejected" &&
                  `Rejected${record.RejectedBy ? ` by ${record.RejectedBy}` : ""}${record.RejectionNote ? ` — ${record.RejectionNote}` : ""}.`}
              </span>
            </div>
          )}

          {/* Header details grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            <DetailRow label="Company" value={record.CompanyName} />
            <DetailRow label="Project" value={record.ProjectName} />
            <DetailRow label="BOQ Date" value={fmtDate(record.BoqDate)} />
            <DetailRow
              label="Document No"
              value={<span className="font-heading tabular-nums">{record.DocNo}</span>}
            />
            <DetailRow label="Created By" value={record.CreatedBy} />
            <DetailRow label="Block" value={record.BlockName} />
            <DetailRow label="Floor" value={record.FloorNo ? `Floor ${record.FloorNo}` : null} />
            <DetailRow label="Room" value={record.RoomName} />
            <DetailRow
              label="Total Amount"
              value={
                <span className="font-heading tabular-nums text-foreground font-bold">
                  {fmt(record.TotalAmount)}
                </span>
              }
            />
          </div>

          {record.Description && (
            <div
              style={{
                background: "hsl(var(--foreground) / 0.04)",
                borderLeft: "3px solid hsl(var(--foreground))",
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              {record.Description}
            </div>
          )}

          {/* Line items viewer */}
          <LineEditor
            mode={lineTab === "items" ? "item" : "activity"}
            rows={
              lineTab === "items"
                ? (record.BoqItems ?? []).map(rowToItem)
                : (record.BoqActivities ?? []).map(rowToActivity)
            }
            uoms={uoms}
            boqActivities={(record.BoqActivities ?? []).map(rowToActivity)}
            itemsTotal={itemsTotal}
            activitiesTotal={activitiesTotal}
            onChange={() => {}}
            readOnly
            onTabChange={setLineTab}
          />
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid hsl(var(--foreground))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            background: "hsl(var(--card))",
            flexShrink: 0,
          }}
        >
          {canDelete && (
            <button type="button" disabled={acting} onClick={() => setConfirmDelete(true)} className={`${KEY_RED} h-9 px-4`}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {canPrint && (
              <button type="button" onClick={onPrint} className={`${KEY_LINE} h-9 px-4`}>
                <Printer size={13} /> Print
              </button>
            )}
            <button type="button" onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>
              Close
            </button>
            {canEdit && canEditBoq(record.Status) && (
              <button type="button" disabled={acting} onClick={onEdit} className={`${KEY_LINE} h-9 px-4`}>
                <Edit3 size={13} /> Edit
              </button>
            )}
            {canEditBoq(record.Status) && (
              <>
                <ApprovalActions
                  status={record.Status}
                  recordId={record.BoqID}
                  endpoint="/api/boq"
                  onSuccess={() => onRefresh()}
                  submitOnly
                />
              </>
            )}
            {canEdit && record.Status === "Approved" && (
              <button type="button" disabled={acting} onClick={onEdit} className={`${KEY_LINE} h-9 px-4`}>
                <Edit3 size={13} /> Edit
              </button>
            )}
            {canEdit && onAmend && record.Status === "Approved" && (
              <button type="button" disabled={acting} onClick={onAmend} title="Amend — change it with a reason; applies once approved" className={`${KEY_INK} h-9 px-5`}>
                <FilePenLine size={13} /> Amend
              </button>
            )}
          </div>
        </div>
      </div>
      <Dialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
        <DialogContent className="sheet-frame max-w-sm p-0 gap-0" style={{ margin: 0 }}>
          <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Bill of quantities</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete {record.BoqNo || record.DocNo}?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              The BOQ and all its items and activities are removed for good. A BOQ a work order is raised against cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-5 py-4">
            <button type="button" onClick={() => setConfirmDelete(false)} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-9 px-4 border border-foreground hover:bg-primary/10">
              Cancel
            </button>
            <button type="button" onClick={doDelete} disabled={acting} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-9 px-4 bg-destructive text-destructive-foreground border border-destructive disabled:opacity-40">
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
