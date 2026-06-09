/**
 * ApprovalStatusChain
 *
 * Fetches and renders the approval trail for any record as a compact
 * horizontal stepper. Shows only the LATEST state (no history replay).
 *
 * Usage:
 *   <ApprovalStatusChain table="GoodsReceiptNotes" recordId={grn.GRNID} />
 *   <ApprovalStatusChain table="PurchaseOrders"    recordId={item._id} />
 *
 * `table` must match the TableName written by approvalService to ApprovalAuditLog:
 *   GoodsReceiptNotes | PurchaseOrders | WorkOrderHeader | ExpenseBooking |
 *   NewPayment | MaterialIssues | MaterialRequests | StockTransfers
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, ChevronRight } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";

export type ApprovalTable =
  | "GoodsReceiptNotes"
  | "PurchaseOrders"
  | "WorkOrderHeader"
  | "ExpenseBooking"
  | "NewPayment"
  | "MaterialIssues"
  | "MaterialRequests"
  | "StockTransfers";

interface TrailStep {
  level: number;
  label: string;
  status: "Pending" | "Approved" | "Rejected";
  approverEmail: string | null;
  role: string | null;
  actionAt: string | null;
  note: string | null;
}

interface TrailData {
  workflowName: string | null;
  steps: TrailStep[];
  currentLevel: number;
  fullyApproved: boolean;
  hasRejection: boolean;
  totalLevels: number;
}

interface Props {
  table: ApprovalTable;
  recordId: string | number | null | undefined;
  /** If true renders a condensed single-line badge instead of the stepper */
  compact?: boolean;
  className?: string;
}

function StepDot({
  status,
  isCurrent,
}: {
  status: string;
  isCurrent: boolean;
}) {
  if (status === "Approved")
    return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
  if (status === "Rejected")
    return <XCircle size={12} className="text-red-500 shrink-0" />;
  return (
    <Clock
      size={12}
      className={cn(
        "shrink-0",
        isCurrent ? "text-amber-500" : "text-muted-foreground/40",
      )}
    />
  );
}

export function ApprovalStatusChain({
  table,
  recordId,
  compact = false,
  className,
}: Props) {
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(
      `/api/approval-workflows/trail?module=${table}&id=${recordId}`,
    )
      .then((r) => r.json())
      .then((data: TrailData) => {
        if (!cancelled) setTrail(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [table, recordId]);

  if (loading) {
    return (
      <div className={cn("flex gap-1 items-center", className)}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-6 rounded-full bg-muted animate-pulse"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    );
  }

  if (!trail || trail.steps.length === 0) return null;

  // ── Compact: single badge showing current step only ─────────────────────────
  if (compact) {
    if (trail.fullyApproved) {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
            "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
            className,
          )}
        >
          <CheckCircle2 size={10} /> Approved
        </span>
      );
    }
    if (trail.hasRejection) {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
            "bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
            className,
          )}
        >
          <XCircle size={10} /> Rejected
        </span>
      );
    }
    const current = trail.steps[trail.currentLevel - 1] ?? trail.steps[0];
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
          "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
          className,
        )}
      >
        <Clock size={10} />L{current.level}/{trail.totalLevels}
      </span>
    );
  }

  // ── Full stepper ─────────────────────────────────────────────────────────────
  return (
    <div className={cn("flex items-center gap-0.5 flex-wrap", className)}>
      {trail.steps.map((step, idx) => {
        const isCurrent =
          step.level === trail.currentLevel && !trail.fullyApproved;
        const isDone = step.status === "Approved";
        const isRejected = step.status === "Rejected";

        return (
          <div key={step.level} className="flex items-center gap-0.5">
            <div
              title={
                step.approverEmail
                  ? `${step.label} — ${step.approverEmail}${step.actionAt ? ` (${new Date(step.actionAt).toLocaleDateString("en-IN")})` : ""}`
                  : step.label
              }
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors",
                isDone &&
                  "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
                isRejected &&
                  "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
                isCurrent &&
                  !isRejected &&
                  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
                !isDone &&
                  !isRejected &&
                  !isCurrent &&
                  "bg-muted/30 text-muted-foreground border-border",
              )}
            >
              <StepDot status={step.status} isCurrent={isCurrent} />
              <span>{step.label}</span>
            </div>
            {idx < trail.steps.length - 1 && (
              <ChevronRight
                size={10}
                className="text-muted-foreground/30 shrink-0"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
