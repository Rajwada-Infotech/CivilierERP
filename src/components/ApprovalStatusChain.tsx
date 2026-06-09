/**
 * ApprovalStatusChain
 *
 * Renders a single compact badge showing the approval state of any record.
 * Format: "{Level label} · Approved / Rejected / Pending"
 *
 * Usage:
 *   <ApprovalStatusChain table="MaterialRequests" recordId={mr.MRId} />
 *
 * `table` must match the TableName written by approvalService to ApprovalAuditLog.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
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
  | "StockTransfers"
  | "BOQ"
  | "WorkDone";

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
  /** @deprecated — all usages are now single-badge; prop kept for backward compat */
  compact?: boolean;
  className?: string;
}

export function ApprovalStatusChain({ table, recordId, className }: Props) {
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(`/api/approval-workflows/trail?module=${table}&id=${recordId}`)
      .then((r) => r.json())
      .then((data: TrailData) => { if (!cancelled) setTrail(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [table, recordId]);

  if (loading) {
    return (
      <div className={cn("flex gap-1 items-center", className)}>
        <div className="h-4 w-20 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (!trail) return null;

  // Filter out Level 0 — it's a submission marker, not an approver step.
  // This makes the frontend resilient even if the backend sends Level 0.
  const steps = trail.steps.filter((s) => s.level > 0);
  if (steps.length === 0) return null;

  // Derive state from the filtered steps
  const fullyApproved = steps.every((s) => s.status === "Approved");
  const rejectedStep  = steps.find((s) => s.status === "Rejected");
  const currentStep   = steps.find((s) => s.status !== "Approved") ?? steps[steps.length - 1];

  // ── Fully approved ──────────────────────────────────────────────────────────
  if (fullyApproved) {
    const last = steps[steps.length - 1];
    const tip = last.approverEmail
      ? `${last.label} — ${last.approverEmail}${last.actionAt ? ` (${new Date(last.actionAt).toLocaleDateString("en-IN")})` : ""}`
      : last.label;
    return (
      <span
        title={tip}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
          "bg-emerald-100 text-emerald-700 border border-emerald-200",
          "dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
          className,
        )}
      >
        <CheckCircle2 size={10} />
        {last.label} · Approved
      </span>
    );
  }

  // ── Rejected ────────────────────────────────────────────────────────────────
  if (rejectedStep) {
    const tip = rejectedStep.approverEmail
      ? `${rejectedStep.label} — ${rejectedStep.approverEmail}${rejectedStep.note ? `: ${rejectedStep.note}` : ""}`
      : rejectedStep.label;
    return (
      <span
        title={tip}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
          "bg-red-100 text-red-700 border border-red-200",
          "dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
          className,
        )}
      >
        <XCircle size={10} />
        {rejectedStep.label} · Rejected
      </span>
    );
  }

  // ── Pending at current level ────────────────────────────────────────────────
  return (
    <span
      title={currentStep.label}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
        "bg-amber-100 text-amber-700 border border-amber-200",
        "dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
        className,
      )}
    >
      <Clock size={10} />
      {currentStep.label} · Pending
    </span>
  );
}
