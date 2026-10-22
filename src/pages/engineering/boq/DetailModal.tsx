// One BOQ opened: details, lines, approval, print, edit / delete.
import React, { useState } from "react";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Trash2, Edit3, Printer, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
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

  const doDelete = async () => {
    if (!window.confirm("Delete this BOQ and all its items/activities?"))
      return;
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
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted px-2 font-semibold text-sm border border-border bg-transparent"
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
            <ApprovalStatusChain table="BOQ" recordId={record.BoqID} fallback={<StatusBadge status={record.Status} />} />
          </div>

          {/* Right-side actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={doDelete}
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
              onClick={doDelete}
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
    </div>
  );
};
