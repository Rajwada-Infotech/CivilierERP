// One BOQ opened: details, lines, approval, print, edit / delete.
import React, { useState } from "react";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Trash2, Edit3, Printer, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-primary/5 px-2 font-semibold text-sm border border-foreground/30 bg-transparent"
            >
              <ArrowLeft size={15} /> Back
            </Button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--border))" }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "hsl(var(--primary))",
                fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {record.BoqNo || record.DocNo}
            </span>
            <ApprovalStatusChain table="BOQ" recordId={record.BoqID} fallback={<SheetMark text={record.Status || "Draft"} tone={statusTone(record.Status || "Draft")} />} />
          </div>

          {/* Right-side actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:bg-destructive/10 border-destructive/30"
              >
                <Trash2 size={13} className="mr-1.5" /> Delete
              </Button>
            )}
            {canEdit && (record.Status === "Draft" || record.Status === "Approved" || record.Status === "Rejected") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={acting}
                onClick={onEdit}
              >
                <Edit3 size={13} className="mr-1.5" /> Edit
              </Button>
            )}
            {record.Status === "Draft" && (
              <Button
                size="sm"
                disabled={acting}
                onClick={() => doTransition("submit")}
              >
                Submit for Approval <Send size={12} className="ml-1.5" />
              </Button>
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
                padding: "12px 16px",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background:
                  record.Status === "Pending"
                    ? "hsl(38 90% 95%)"
                    : record.Status === "Approved"
                      ? "hsl(142 70% 95%)"
                      : "hsl(0 80% 96%)",
                border: `1px solid ${record.Status === "Pending" ? "hsl(38 80% 85%)" : record.Status === "Approved" ? "hsl(142 60% 85%)" : "hsl(0 70% 88%)"}`,
                color:
                  record.Status === "Pending"
                    ? "hsl(38 80% 35%)"
                    : record.Status === "Approved"
                      ? "hsl(142 60% 30%)"
                      : "hsl(0 70% 38%)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {record.Status === "Pending"
                  ? "Awaiting admin approval from the Approval Inbox."
                  : null}
                {record.Status === "Approved" &&
                  `✓ Approved${record.ApprovedBy ? ` by ${record.ApprovedBy}` : ""}.`}
                {record.Status === "Rejected" &&
                  `✕ Rejected${record.RejectedBy ? ` by ${record.RejectedBy}` : ""}${record.RejectionNote ? ` — ${record.RejectionNote}` : ""}.`}
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
              value={<span className="tabular-nums">{record.DocNo}</span>}
            />
            <DetailRow label="Created By" value={record.CreatedBy} />
            <DetailRow
              label="Total Amount"
              value={
                <span className="tabular-nums text-primary font-bold">
                  {fmt(record.TotalAmount)}
                </span>
              }
            />
          </div>

          {record.Description && (
            <div
              style={{
                background: "hsl(var(--muted))",
                borderLeft: "3px solid hsl(var(--primary))",
                borderRadius: "0 6px 6px 0",
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
            borderTop: "1px solid hsl(var(--border))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            background: "hsl(var(--muted) / 0.5)",
            flexShrink: 0,
          }}
        >
          {canDelete && (
            <Button
              variant="outline"
              disabled={acting}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              <Trash2 size={14} className="mr-1.5" /> Delete
            </Button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {canPrint && (
              <Button variant="outline" onClick={onPrint} className="gap-1.5">
                <Printer size={14} /> Print
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {canEdit && canEditBoq(record.Status) && (
              <Button variant="secondary" disabled={acting} onClick={onEdit}>
                <Edit3 size={14} className="mr-1.5" /> Edit
              </Button>
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
              <Button variant="secondary" disabled={acting} onClick={onEdit}>
                <Edit3 size={14} className="mr-1.5" /> Edit
              </Button>
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
