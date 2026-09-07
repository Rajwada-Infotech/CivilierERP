/**
 * ApprovalStatusChain
 *
 * Single badge showing approval state. Display logic varies by workflow type:
 *
 *  sequential — show the latest approver's name (who last acted)
 *  any        — show who acted first (they unlocked the record)
 *  parallel   — show who acted most recently across all parallel approvers
 *
 * Badge format:  "{Level label} · {approverName} · Approved / Rejected / Pending"
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
  | "WorkDone"
  | "SaleOrders"
  | "VehicleInOut"
  | "Contract";

interface Approver {
  email: string | null;
  name: string | null;
  role: string | null;
  status: string;
  actionAt: string | null;
}

interface TrailStep {
  level: number;
  label: string;
  status: "Pending" | "Approved" | "Rejected";
  approverEmail: string | null;
  approverName: string | null;
  role: string | null;
  actionAt: string | null;
  note: string | null;
  approvers?: Approver[]; // parallel only
  workflowType?: string;
}

interface TrailData {
  workflowName: string | null;
  workflowType: string;
  steps: TrailStep[];
  currentLevel: number;
  fullyApproved: boolean;
  hasRejection: boolean;
  totalLevels: number;
}

interface Props {
  table: ApprovalTable;
  recordId: string | number | null | undefined;
  compact?: boolean; // kept for compat, no-op
  className?: string;
  /** Rendered instead of null when there's no workflow/trail yet for this
   *  record (e.g. no active workflow configured, or steps haven't started).
   *  Lets callers show a plain status pill as a graceful fallback rather
   *  than an empty cell. */
  fallback?: React.ReactNode;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function badgeText(
  step: TrailStep,
  status: "Approved" | "Rejected" | "Pending",
): string {
  // Keep badge compact — just "L1 · Approved". Full name is in the tooltip.
  return `${step.label} · ${status}`;
}

function tooltipText(step: TrailStep): string {
  if (step.workflowType === "parallel" && step.approvers?.length) {
    return step.approvers
      .map(
        (a) =>
          `${a.name || a.email} — ${a.status}${a.actionAt ? ` (${fmtDate(a.actionAt)})` : ""}`,
      )
      .join("\n");
  }
  const name = step.approverName || step.approverEmail?.split("@")[0] || "";
  const when = step.actionAt ? ` (${fmtDate(step.actionAt)})` : "";
  const label = `${step.label}${name ? ` · ${name}` : ""}`;
  return label ? `${label}${when}` : step.label;
}

export function ApprovalStatusChain({ table, recordId, className, fallback = null }: Props) {
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(
      `/api/approval-workflows/trail?module=${table}&id=${recordId}`,
    )
      .then((r) => (r.ok ? r.json().catch(() => null) : null))
      .then((data: TrailData | null) => {
        // A failed request (e.g. 429 from a burst of concurrent card
        // fetches) or a malformed body must not be treated as a valid
        // trail — only accept it once it actually has a steps array.
        if (!cancelled) setTrail(data && Array.isArray(data.steps) ? data : null);
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
        <div className="h-4 w-24 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (!trail) return <>{fallback}</>;

  // Filter out Level 0 (submission marker) — resilient even if backend sends it
  const steps = trail.steps.filter((s) => s.level > 0);
  if (steps.length === 0) return <>{fallback}</>;

  const fullyApproved = steps.every((s) => s.status === "Approved");
  const rejectedStep = steps.find((s) => s.status === "Rejected");
  const currentStep =
    steps.find((s) => s.status !== "Approved") ?? steps[steps.length - 1];

  // ── Fully approved ──────────────────────────────────────────────────────────
  if (fullyApproved) {
    const last = steps[steps.length - 1];
    return (
      <span
        title={tooltipText(last)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold",
          "whitespace-nowrap",
          "bg-emerald-100 text-emerald-700 border border-emerald-200",
          "dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
          className,
        )}
      >
        <CheckCircle2 size={10} />
        {badgeText(last, "Approved")}
      </span>
    );
  }

  // ── Rejected ────────────────────────────────────────────────────────────────
  if (rejectedStep) {
    return (
      <span
        title={tooltipText(rejectedStep)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold",
          "whitespace-nowrap",
          "bg-red-100 text-red-700 border border-red-200",
          "dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
          className,
        )}
      >
        <XCircle size={10} />
        {badgeText(rejectedStep, "Rejected")}
      </span>
    );
  }

  // ── Pending ─────────────────────────────────────────────────────────────────
  return (
    <span
      title={tooltipText(currentStep)}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold",
        "whitespace-nowrap",
        "bg-amber-100 text-amber-700 border border-amber-200",
        "dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
        className,
      )}
    >
      <Clock size={10} />
      {badgeText(currentStep, "Pending")}
    </span>
  );
}
