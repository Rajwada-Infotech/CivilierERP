/**
 * src/pages/engineering/DailyProgressReport.tsx
 *
 * Daily Progress Report (DPR) — Engineering Module
 * Shows all BOQ, Work Order, and Work Done documents created on a given date.
 * Includes export to CSV and PDF.
 *
 * Backend endpoint expected:
 *   GET /api/engineering/dpr?date=YYYY-MM-DD[&companyId=N][&projectId=N]
 */

import React, { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Calendar,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  HardHat,
  ClipboardList,
  AlertCircle,
  Layers,
  Hammer,
  Printer,
  FileSpreadsheet,
  TrendingUp,
  Activity,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BOQRow {
  BoqID: number;
  DocNo: string;
  BoqNo: string;
  BoqDate: string | null;
  CompanyName: string;
  ProjectName: string;
  Description: string;
  TotalAmount: number;
  Status: string;
  Remarks: string | null;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
  DocTypeDescription: string | null;
}

interface WOActivity {
  Id: number;
  WorkOrderHeaderId: number;
  ActivityGroupName: string | null;
  ActivityName: string | null;
  UOMName: string | null;
  Quantity: number | null;
  Rate: number | null;
  Amount: number | null;
  CompletionPercentage: number | null;
  Remarks: string | null;
}

interface WorkOrderRow {
  Id: number;
  DocNo: string;
  DocumentNumber: string;
  DocumentDate: string | null;
  TotalAmount: number;
  Status: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string | null;
  SupplierName: string | null;
  Remarks: string | null;
  BoqDocNo: string | null;
  ActivityCount: number;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
  DocTypeDescription: string | null;
  activities: WOActivity[];
}

interface WorkDoneRow {
  ID: number;
  DocNo: string;
  DocDate: string | null;
  CompanyName: string;
  ProjectName: string;
  SupplierName: string | null;
  ContractorName: string | null;
  WorkOrderNo: string | null;
  PeriodFrom: string | null;
  PeriodTo: string | null;
  DescriptionOfWork: string;
  QuantityDone: number | null;
  Unit: string | null;
  RatePerUnit: number | null;
  GrossAmount: number | null;
  Deductions: number | null;
  CertifiedAmount: number;
  Status: string;
  Remarks: string | null;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
}

interface DPRSummary {
  boqCount: number;
  boqTotal: number;
  woCount: number;
  woTotal: number;
  wdCount: number;
  wdTotal: number;
  grandTotal: number;
}

interface DPRResponse {
  date: string;
  summary: DPRSummary;
  boq: BOQRow[];
  workOrders: WorkOrderRow[];
  workDone: WorkDoneRow[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

const fmtNum = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const todayStr = () => new Date().toISOString().slice(0, 10);

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600 border-emerald-400/30",
  Closed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/30",
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/30",
  "Fully Received": "bg-emerald-500/10 text-emerald-600 border-emerald-400/30",
  Pending: "bg-amber-500/10  text-amber-600  border-amber-400/30",
  "In Progress": "bg-blue-500/10   text-blue-600   border-blue-400/30",
  Draft: "bg-muted         text-muted-foreground border-border",
  Open: "bg-blue-500/10   text-blue-600   border-blue-400/30",
  "Partially Received": "bg-violet-500/10 text-violet-600 border-violet-400/30",
  Rejected: "bg-red-500/10    text-red-500    border-red-400/30",
  Cancelled: "bg-red-500/10    text-red-500    border-red-400/30",
  Submitted: "bg-sky-500/10    text-sky-600    border-sky-400/30",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_COLORS[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border tracking-wide ${cls}`}
    >
      {status || "Draft"}
    </span>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  total,
  icon: Icon,
  accent,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 flex flex-col gap-3 relative overflow-hidden`}
    >
      <div
        className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-5 -translate-y-4 translate-x-4 ${accent}`}
      />
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg ${accent} bg-opacity-10`}>
          <Icon size={18} className="opacity-80" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground border border-border rounded-full px-2 py-0.5">
          {count} doc{count !== 1 ? "s" : ""}
        </span>
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-none tabular-nums">
          {fmt(total)}
        </p>
        <p className="text-xs text-muted-foreground mt-1 font-medium">
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Grand Total Card ─────────────────────────────────────────────────────────

function GrandTotalCard({
  summary,
  date,
}: {
  summary: DPRSummary;
  date: string;
}) {
  const totalDocs = summary.boqCount + summary.woCount + summary.wdCount;
  return (
    <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-5 flex flex-col gap-3 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg bg-primary/10">
          <TrendingUp size={18} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary border border-primary/20 rounded-full px-2 py-0.5">
          {totalDocs} total
        </span>
      </div>
      <div>
        <p className="text-3xl font-bold text-primary leading-none tabular-nums">
          {fmt(summary.grandTotal)}
        </p>
        <p className="text-xs text-muted-foreground mt-1 font-medium">
          Grand Total · {fmtDate(date)}
        </p>
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  count,
  total,
  accent,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  total: number;
  accent: string;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 rounded-t-xl border border-b-0 border-border ${accent} bg-opacity-5`}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} className="opacity-70" />
        <h3 className="text-sm font-bold text-foreground tracking-wide">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <span className="text-sm font-bold text-foreground tabular-nums">
        {fmt(total)}
      </span>
    </div>
  );
}

// ─── BOQ Table ────────────────────────────────────────────────────────────────

function BOQTable({ rows }: { rows: BOQRow[] }) {
  if (rows.length === 0)
    return <EmptyState label="No BOQ documents found for this date." />;

  return (
    <div className="border border-border border-t-0 rounded-b-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 font-semibold">Doc No</th>
              <th className="text-left px-4 py-2.5 font-semibold">Company</th>
              <th className="text-left px-4 py-2.5 font-semibold">Project</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Description
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">BOQ Date</th>
              <th className="text-right px-4 py-2.5 font-semibold">
                Total Amount
              </th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created By
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created At
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.BoqID} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded">
                    {r.DocNo || r.BoqNo || `BOQ-${r.BoqID}`}
                  </span>
                  {r.DocTypePrefix && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      [{r.DocTypePrefix}]
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-foreground max-w-[140px] truncate">
                  {r.CompanyName || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-foreground max-w-[140px] truncate">
                  {r.ProjectName || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                  {r.Description || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtDate(r.BoqDate)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-xs tabular-nums">
                  {fmt(r.TotalAmount)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={r.Status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {r.CreatedBy || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtDateTime(r.CreatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 border-t border-border">
              <td
                colSpan={5}
                className="px-4 py-2.5 text-xs font-semibold text-muted-foreground"
              >
                {rows.length} record{rows.length !== 1 ? "s" : ""}
              </td>
              <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">
                {fmt(rows.reduce((s, r) => s + (r.TotalAmount ?? 0), 0))}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Work Order Table (with expandable activities) ────────────────────────────

function WorkOrderTable({ rows }: { rows: WorkOrderRow[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (rows.length === 0)
    return <EmptyState label="No Work Order documents found for this date." />;

  return (
    <div className="border border-border border-t-0 rounded-b-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wider">
              <th className="w-8 px-2 py-2.5" />
              <th className="text-left px-4 py-2.5 font-semibold">Doc No</th>
              <th className="text-left px-4 py-2.5 font-semibold">Company</th>
              <th className="text-left px-4 py-2.5 font-semibold">Project</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Contractor
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">BOQ Ref</th>
              <th className="text-left px-4 py-2.5 font-semibold">Doc Date</th>
              <th className="text-center px-4 py-2.5 font-semibold">
                Activities
              </th>
              <th className="text-right px-4 py-2.5 font-semibold">
                Total Amount
              </th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created By
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created At
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = expanded.has(r.Id);
              const isPartial =
                r.Status === "Partially Received" || r.Status === "In Progress";
              return (
                <React.Fragment key={r.Id}>
                  <tr
                    className={`hover:bg-muted/30 transition-colors ${isOpen ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-2 py-3 text-center">
                      {r.activities.length > 0 && (
                        <button
                          onClick={() => toggle(r.Id)}
                          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-orange-600 bg-orange-500/8 px-2 py-0.5 rounded">
                          {r.DocNo || r.DocumentNumber || `WO-${r.Id}`}
                        </span>
                        {isPartial && (
                          <span className="text-[9px] font-bold text-violet-600 bg-violet-500/10 border border-violet-400/30 px-1.5 py-0.5 rounded-full">
                            PARTIAL
                          </span>
                        )}
                        {r.DocTypePrefix && (
                          <span className="text-[10px] text-muted-foreground">
                            [{r.DocTypePrefix}]
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground max-w-[130px] truncate">
                      {r.CompanyName || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground max-w-[130px] truncate">
                      {r.ProjectName || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[130px] truncate">
                      {r.ContractorName || r.SupplierName || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.BoqDocNo ? (
                        <span className="font-mono text-[11px] text-blue-600 bg-blue-500/8 px-1.5 py-0.5 rounded">
                          {r.BoqDocNo}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(r.DocumentDate)}
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground">
                      {r.ActivityCount}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-xs tabular-nums">
                      {fmt(r.TotalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={r.Status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.CreatedBy || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(r.CreatedAt)}
                    </td>
                  </tr>

                  {/* Expanded activities sub-table */}
                  {isOpen && r.activities.length > 0 && (
                    <tr>
                      <td colSpan={12} className="px-0 py-0 bg-muted/10">
                        <div className="mx-6 my-3 rounded-lg border border-border overflow-hidden">
                          <div className="px-3 py-2 bg-muted/50 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
                            <Activity size={11} />
                            Activities — {r.DocNo || `WO-${r.Id}`}
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/30 text-muted-foreground text-[10px] uppercase tracking-wider">
                                <th className="text-left px-3 py-2 font-semibold">
                                  Activity Group
                                </th>
                                <th className="text-left px-3 py-2 font-semibold">
                                  Activity
                                </th>
                                <th className="text-left px-3 py-2 font-semibold">
                                  UOM
                                </th>
                                <th className="text-right px-3 py-2 font-semibold">
                                  Qty
                                </th>
                                <th className="text-right px-3 py-2 font-semibold">
                                  Rate
                                </th>
                                <th className="text-right px-3 py-2 font-semibold">
                                  Amount
                                </th>
                                <th className="text-right px-3 py-2 font-semibold">
                                  Completion %
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {r.activities.map((a) => (
                                <tr key={a.Id} className="hover:bg-muted/20">
                                  <td className="px-3 py-2 text-foreground">
                                    {a.ActivityGroupName || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-foreground">
                                    {a.ActivityName || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {a.UOMName || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {fmtNum(a.Quantity)}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {fmt(a.Rate)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                    {fmt(a.Amount)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {a.CompletionPercentage != null ? (
                                      <div className="flex items-center justify-end gap-1.5">
                                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className="h-full bg-primary rounded-full transition-all"
                                            style={{
                                              width: `${Math.min(a.CompletionPercentage, 100)}%`,
                                            }}
                                          />
                                        </div>
                                        <span className="text-[10px] font-semibold">
                                          {a.CompletionPercentage}%
                                        </span>
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-muted/40 border-t border-border">
                                <td
                                  colSpan={5}
                                  className="px-3 py-2 text-[10px] font-semibold text-muted-foreground"
                                >
                                  {r.activities.length} activit
                                  {r.activities.length !== 1 ? "ies" : "y"}
                                </td>
                                <td className="px-3 py-2 text-right text-xs font-bold text-foreground tabular-nums">
                                  {fmt(
                                    r.activities.reduce(
                                      (s, a) => s + (a.Amount ?? 0),
                                      0,
                                    ),
                                  )}
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 border-t border-border">
              <td
                colSpan={8}
                className="px-4 py-2.5 text-xs font-semibold text-muted-foreground"
              >
                {rows.length} record{rows.length !== 1 ? "s" : ""} ·{" "}
                {rows.reduce((s, r) => s + r.activities.length, 0)} activities
              </td>
              <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">
                {fmt(rows.reduce((s, r) => s + (r.TotalAmount ?? 0), 0))}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Work Done Table ──────────────────────────────────────────────────────────

function WorkDoneTable({ rows }: { rows: WorkDoneRow[] }) {
  if (rows.length === 0)
    return <EmptyState label="No Work Done documents found for this date." />;

  return (
    <div className="border border-border border-t-0 rounded-b-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 font-semibold">Doc No</th>
              <th className="text-left px-4 py-2.5 font-semibold">Company</th>
              <th className="text-left px-4 py-2.5 font-semibold">Project</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Contractor
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">WO Ref</th>
              <th className="text-left px-4 py-2.5 font-semibold">Period</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Description
              </th>
              <th className="text-right px-4 py-2.5 font-semibold">Qty Done</th>
              <th className="text-right px-4 py-2.5 font-semibold">Rate</th>
              <th className="text-right px-4 py-2.5 font-semibold">
                Gross Amt
              </th>
              <th className="text-right px-4 py-2.5 font-semibold">
                Deductions
              </th>
              <th className="text-right px-4 py-2.5 font-semibold">
                Certified Amt
              </th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created By
              </th>
              <th className="text-left px-4 py-2.5 font-semibold">
                Created At
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.ID} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-500/8 px-2 py-0.5 rounded">
                      {r.DocNo || `WD-${r.ID}`}
                    </span>
                    {r.DocTypePrefix && (
                      <span className="text-[10px] text-muted-foreground">
                        [{r.DocTypePrefix}]
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-foreground max-w-[120px] truncate">
                  {r.CompanyName || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-foreground max-w-[120px] truncate">
                  {r.ProjectName || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">
                  {r.ContractorName || r.SupplierName || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {r.WorkOrderNo ? (
                    <span className="font-mono text-[11px] text-orange-600 bg-orange-500/8 px-1.5 py-0.5 rounded">
                      {r.WorkOrderNo}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {r.PeriodFrom || r.PeriodTo
                    ? `${fmtDate(r.PeriodFrom)} – ${fmtDate(r.PeriodTo)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                  {r.DescriptionOfWork || "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums">
                  {r.QuantityDone != null
                    ? `${fmtNum(r.QuantityDone)} ${r.Unit || ""}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums">
                  {r.RatePerUnit != null ? fmt(r.RatePerUnit) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums">
                  {fmt(r.GrossAmount)}
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums text-red-500">
                  {r.Deductions ? `(${fmt(r.Deductions)})` : "—"}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-xs tabular-nums">
                  {fmt(r.CertifiedAmount)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={r.Status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {r.CreatedBy || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtDateTime(r.CreatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 border-t border-border">
              <td
                colSpan={9}
                className="px-4 py-2.5 text-xs font-semibold text-muted-foreground"
              >
                {rows.length} record{rows.length !== 1 ? "s" : ""}
              </td>
              <td className="px-4 py-2.5 text-right text-xs font-bold tabular-nums">
                {fmt(rows.reduce((s, r) => s + (r.GrossAmount ?? 0), 0))}
              </td>
              <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500 tabular-nums">
                ({fmt(rows.reduce((s, r) => s + (r.Deductions ?? 0), 0))})
              </td>
              <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">
                {fmt(rows.reduce((s, r) => s + (r.CertifiedAmount ?? 0), 0))}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border border-border border-t-0 rounded-b-xl bg-muted/10 py-10 text-center">
      <AlertCircle
        size={28}
        className="mx-auto text-muted-foreground/40 mb-2"
      />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

function buildCSV(data: DPRResponse): string {
  const lines: string[] = [];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (...cells: unknown[]) => lines.push(cells.map(esc).join(","));

  row(`Daily Progress Report — ${data.date}`);
  row(
    `BOQ: ${data.summary.boqCount} docs`,
    `Work Orders: ${data.summary.woCount} docs`,
    `Work Done: ${data.summary.wdCount} docs`,
    `Grand Total: ${fmt(data.summary.grandTotal)}`,
  );
  lines.push("");

  // BOQ
  row("=== BOQ ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Description",
    "BOQ Date",
    "Total Amount",
    "Status",
    "Created By",
    "Created At",
  );
  for (const r of data.boq) {
    row(
      r.DocNo || r.BoqNo,
      r.CompanyName,
      r.ProjectName,
      r.Description,
      fmtDate(r.BoqDate),
      r.TotalAmount,
      r.Status,
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
  }
  lines.push("");

  // Work Orders
  row("=== WORK ORDERS ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Contractor",
    "BOQ Ref",
    "Doc Date",
    "Activities",
    "Total Amount",
    "Status",
    "Partial?",
    "Created By",
    "Created At",
  );
  for (const r of data.workOrders) {
    const isPartial =
      r.Status === "Partially Received" || r.Status === "In Progress";
    row(
      r.DocNo || r.DocumentNumber,
      r.CompanyName,
      r.ProjectName,
      r.ContractorName || r.SupplierName || "",
      r.BoqDocNo || "",
      fmtDate(r.DocumentDate),
      r.ActivityCount,
      r.TotalAmount,
      r.Status,
      isPartial ? "YES" : "NO",
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
    // Activities
    if (r.activities.length > 0) {
      row(
        "",
        "",
        "Activity Group",
        "Activity",
        "UOM",
        "Qty",
        "Rate",
        "Amount",
        "Completion %",
      );
      for (const a of r.activities) {
        row(
          "",
          "",
          a.ActivityGroupName || "",
          a.ActivityName || "",
          a.UOMName || "",
          a.Quantity ?? "",
          a.Rate ?? "",
          a.Amount ?? "",
          a.CompletionPercentage != null ? `${a.CompletionPercentage}%` : "",
        );
      }
    }
  }
  lines.push("");

  // Work Done
  row("=== WORK DONE ===");
  row(
    "Doc No",
    "Company",
    "Project",
    "Contractor",
    "WO Ref",
    "Period From",
    "Period To",
    "Description",
    "Qty Done",
    "Unit",
    "Rate",
    "Gross Amt",
    "Deductions",
    "Certified Amt",
    "Status",
    "Created By",
    "Created At",
  );
  for (const r of data.workDone) {
    row(
      r.DocNo,
      r.CompanyName,
      r.ProjectName,
      r.ContractorName || r.SupplierName || "",
      r.WorkOrderNo || "",
      fmtDate(r.PeriodFrom),
      fmtDate(r.PeriodTo),
      r.DescriptionOfWork,
      r.QuantityDone ?? "",
      r.Unit || "",
      r.RatePerUnit ?? "",
      r.GrossAmount ?? 0,
      r.Deductions ?? 0,
      r.CertifiedAmount,
      r.Status,
      r.CreatedBy,
      fmtDateTime(r.CreatedAt),
    );
  }

  return lines.join("\n");
}

function downloadCSV(data: DPRResponse) {
  const csv = buildCSV(data);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DPR_${data.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printPDF(
  printRef: React.RefObject<HTMLDivElement | null>,
  date: string,
) {
  const el = printRef.current;
  if (!el) return;

  const win = window.open("", "_blank");
  if (!win) return;

  // ── Safe DOM construction — no document.write() with untrusted HTML ─────────
  // Using document.write() with el.innerHTML (DOM-sourced) triggers
  // js/xss-through-dom. Instead we build the document via safe DOM APIs and
  // copy the print content with importNode(), which transfers the already-parsed
  // DOM tree without re-interpreting any text as HTML.
  const doc = win.document;

  doc.title = `DPR — ${date}`;

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  const style = doc.createElement("style");
  style.textContent = [
    "* { box-sizing: border-box; margin: 0; padding: 0; }",
    "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 24px; }",
    "h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }",
    "h2 { font-size: 13px; font-weight: 700; margin: 20px 0 6px; color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }",
    "h3 { font-size: 11px; font-weight: 600; margin: 12px 0 4px; color: #374151; }",
    ".summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 12px 0; }",
    ".card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }",
    ".card .val { font-size: 16px; font-weight: 700; }",
    ".card .lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }",
    "table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }",
    "th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; color: #6b7280; border: 1px solid #e5e7eb; }",
    "td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: top; }",
    "tr:nth-child(even) td { background: #f9fafb; }",
    "tfoot td { background: #f3f4f6; font-weight: 700; }",
    ".docno { font-family: monospace; font-weight: 700; }",
    ".badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 9px; font-weight: 600; border: 1px solid #e5e7eb; }",
    ".sub-table { margin: 0 16px 8px; }",
    ".sub-table th { background: #f9fafb; }",
    "@media print { body { padding: 0; } }",
  ].join("\n");
  doc.head.appendChild(style);

  // importNode deep-copies the already-parsed DOM node into the new document —
  // no HTML string is ever re-parsed, so there is no XSS vector.
  const imported = doc.importNode(el, true);
  doc.body.appendChild(imported);

  setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}

// ─── Print-friendly content builder ──────────────────────────────────────────

function PrintView({ data }: { data: DPRResponse }) {
  const { summary, boq, workOrders, workDone, date } = data;
  return (
    <>
      <h1>Daily Progress Report</h1>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
        Date: {fmtDate(date)} &nbsp;|&nbsp; Generated:{" "}
        {new Date().toLocaleString("en-IN")}
      </p>

      <div
        className="summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 12,
          margin: "16px 0",
        }}
      >
        {[
          { label: "BOQ", count: summary.boqCount, total: summary.boqTotal },
          {
            label: "Work Orders",
            count: summary.woCount,
            total: summary.woTotal,
          },
          {
            label: "Work Done",
            count: summary.wdCount,
            total: summary.wdTotal,
          },
          {
            label: "Grand Total",
            count: summary.boqCount + summary.woCount + summary.wdCount,
            total: summary.grandTotal,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div className="val" style={{ fontSize: 15, fontWeight: 700 }}>
              {fmt(c.total)}
            </div>
            <div
              className="lbl"
              style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}
            >
              {c.label} · {c.count} docs
            </div>
          </div>
        ))}
      </div>

      {/* BOQ */}
      <h2>BOQ Documents ({boq.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Description</th>
            <th>BOQ Date</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
            <th>Created By</th>
          </tr>
        </thead>
        <tbody>
          {boq.map((r) => (
            <tr key={r.BoqID}>
              <td className="docno">{r.DocNo || r.BoqNo}</td>
              <td>{r.CompanyName}</td>
              <td>{r.ProjectName}</td>
              <td>{r.Description}</td>
              <td>{fmtDate(r.BoqDate)}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.TotalAmount)}</td>
              <td>
                <span className="badge">{r.Status}</span>
              </td>
              <td>{r.CreatedBy}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Total ({boq.length})</td>
            <td style={{ textAlign: "right" }}>{fmt(summary.boqTotal)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      {/* Work Orders */}
      <h2>Work Orders ({workOrders.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Contractor</th>
            <th>BOQ Ref</th>
            <th>Acts</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workOrders.map((r) => (
            <React.Fragment key={r.Id}>
              <tr>
                <td className="docno">{r.DocNo || r.DocumentNumber}</td>
                <td>{r.CompanyName}</td>
                <td>{r.ProjectName}</td>
                <td>{r.ContractorName || r.SupplierName || "—"}</td>
                <td className="docno">{r.BoqDocNo || "—"}</td>
                <td style={{ textAlign: "center" }}>{r.ActivityCount}</td>
                <td style={{ textAlign: "right" }}>{fmt(r.TotalAmount)}</td>
                <td>
                  <span className="badge">{r.Status}</span>
                </td>
              </tr>
              {r.activities.length > 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{ padding: "4px 8px", background: "#f9fafb" }}
                  >
                    <table
                      style={{ width: "95%", margin: "4px auto", fontSize: 10 }}
                    >
                      <thead>
                        <tr>
                          <th>Activity Group</th>
                          <th>Activity</th>
                          <th>UOM</th>
                          <th style={{ textAlign: "right" }}>Qty</th>
                          <th style={{ textAlign: "right" }}>Rate</th>
                          <th style={{ textAlign: "right" }}>Amount</th>
                          <th style={{ textAlign: "right" }}>Completion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.activities.map((a) => (
                          <tr key={a.Id}>
                            <td>{a.ActivityGroupName || "—"}</td>
                            <td>{a.ActivityName || "—"}</td>
                            <td>{a.UOMName || "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              {fmtNum(a.Quantity)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {fmt(a.Rate)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {fmt(a.Amount)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {a.CompletionPercentage != null
                                ? `${a.CompletionPercentage}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Total ({workOrders.length})</td>
            <td style={{ textAlign: "right" }}>{fmt(summary.woTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* Work Done */}
      <h2>Work Done ({workDone.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Doc No</th>
            <th>Company</th>
            <th>Project</th>
            <th>Contractor</th>
            <th>WO Ref</th>
            <th>Description</th>
            <th style={{ textAlign: "right" }}>Gross</th>
            <th style={{ textAlign: "right" }}>Deduct.</th>
            <th style={{ textAlign: "right" }}>Certified</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workDone.map((r) => (
            <tr key={r.ID}>
              <td className="docno">{r.DocNo}</td>
              <td>{r.CompanyName}</td>
              <td>{r.ProjectName}</td>
              <td>{r.ContractorName || r.SupplierName || "—"}</td>
              <td className="docno">{r.WorkOrderNo || "—"}</td>
              <td>{r.DescriptionOfWork}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.GrossAmount)}</td>
              <td style={{ textAlign: "right" }}>
                {r.Deductions ? `(${fmt(r.Deductions)})` : "—"}
              </td>
              <td style={{ textAlign: "right" }}>{fmt(r.CertifiedAmount)}</td>
              <td>
                <span className="badge">{r.Status}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Total ({workDone.length})</td>
            <td style={{ textAlign: "right" }}>
              {fmt(workDone.reduce((s, r) => s + (r.GrossAmount ?? 0), 0))}
            </td>
            <td style={{ textAlign: "right" }}>
              ({fmt(workDone.reduce((s, r) => s + (r.Deductions ?? 0), 0))})
            </td>
            <td style={{ textAlign: "right" }}>{fmt(summary.wdTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DailyProgressReport() {
  const rights = usePageRights("daily-progress-report");
  const [date, setDate] = useState(todayStr());
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<DPRResponse>({
      queryKey: ["engineering-dpr", date],
      queryFn: async () => {
        const res = await fetchWithAuth(`/api/engineering/dpr?date=${date}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json().catch(() => ({}));
      },
      staleTime: 2 * 60 * 1000,
    });

  const handleCSV = useCallback(() => {
    if (data) downloadCSV(data);
  }, [data]);

  const handlePDF = useCallback(() => {
    if (data) printPDF(printRef, date);
  }, [data, date]);

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Breadcrumbs items={["Engineering", "Daily Progress Report"]} />
      <EngineeringShell
        title="Daily Progress Report"
        subtitle="BOQ · Work Orders · Work Done — documents created on a selected date"
        icon={ClipboardList}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date Picker */}
            <div className="relative flex items-center">
              <Calendar
                size={14}
                className="absolute left-2.5 text-muted-foreground pointer-events-none"
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>

            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
              />
              Refresh
            </button>

            {rights.canExport && (
              <button
                onClick={handleCSV}
                disabled={!data}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-40 font-heading font-medium"
              >
                <FileSpreadsheet size={13} className="text-emerald-600" />
                CSV
              </button>
            )}

            {rights.canPrint && (
              <button
                onClick={handlePDF}
                disabled={!data}
                className="gradient-engineering inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-heading font-semibold text-white rounded-lg disabled:opacity-40 transition-all"
              >
                <Printer size={13} />
                Print / PDF
              </button>
            )}
          </div>
        }
      >
      {/* Loading */}
      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 h-24 animate-pulse bg-muted/30"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-600">
              Failed to load DPR
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              {(error as Error)?.message ?? "Unknown error"}
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="BOQ Documents"
              count={data.summary.boqCount}
              total={data.summary.boqTotal}
              icon={Layers}
              accent="bg-blue-500 text-blue-600"
            />
            <SummaryCard
              label="Work Orders"
              count={data.summary.woCount}
              total={data.summary.woTotal}
              icon={HardHat}
              accent="bg-orange-500 text-orange-600"
            />
            <SummaryCard
              label="Work Done"
              count={data.summary.wdCount}
              total={data.summary.wdTotal}
              icon={Hammer}
              accent="bg-emerald-500 text-emerald-600"
            />
            <GrandTotalCard summary={data.summary} date={data.date} />
          </div>

          {/* Date info strip */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2.5 border border-border">
            <Calendar size={13} />
            <span>
              Showing documents created on{" "}
              <strong className="text-foreground">{fmtDate(data.date)}</strong>
            </span>
            {isFetching && (
              <RefreshCw
                size={12}
                className="animate-spin ml-auto text-primary"
              />
            )}
          </div>

          {/* ── BOQ Section ── */}
          <div>
            <SectionHeader
              icon={Layers}
              title="BOQ — Bill of Quantities"
              count={data.summary.boqCount}
              total={data.summary.boqTotal}
              accent="bg-blue-500/5 text-blue-600"
            />
            <BOQTable rows={data.boq} />
          </div>

          {/* ── Work Orders Section ── */}
          <div>
            <SectionHeader
              icon={HardHat}
              title="Work Orders"
              count={data.summary.woCount}
              total={data.summary.woTotal}
              accent="bg-orange-500/5 text-orange-600"
            />
            <WorkOrderTable rows={data.workOrders} />
          </div>

          {/* ── Work Done Section ── */}
          <div>
            <SectionHeader
              icon={Hammer}
              title="Work Done"
              count={data.summary.wdCount}
              total={data.summary.wdTotal}
              accent="bg-emerald-500/5 text-emerald-600"
            />
            <WorkDoneTable rows={data.workDone} />
          </div>
        </>
      )}
      </EngineeringShell>

      {/* Hidden print area */}
      <div style={{ display: "none" }}>
        <div ref={printRef}>{data && <PrintView data={data} />}</div>
      </div>
    </div>
  );
}
