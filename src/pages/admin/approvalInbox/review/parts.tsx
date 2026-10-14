// Small pieces of the review panel: the approval chain node, source and QC marks, form fields,
// and the Work Order / BOQ line lists.
import React from "react";
import { formatINR } from "@/utils/formatCurrency";
import { type InboxItem } from "../config";
import { SOURCE_META, type SourceType } from "@/api/dependencyActivityAssignmentApi";
import { Package, CheckCircle2, XCircle, Clock, UserCheck, SendHorizonal } from "lucide-react";

// ─── Approval chain types — matches GET /api/approval-workflows/trail ────────

export interface ChainApprover {
  email: string | null;
  name: string | null;
  role: string | null;
  status: string;
  actionAt: string | null;
}

export interface ChainStep {
  level: number;
  label: string;
  status: string; // "Submitted" | "Pending" | "Approved" | "Rejected"
  approverEmail: string | null;
  approverName: string | null;
  role: string | null;
  actionAt: string | null;
  note: string | null;
  approvers?: ChainApprover[];
  workflowType?: string;
  isOrigin?: boolean;
  isTerminal?: boolean;
}

export interface ChainData {
  workflowName: string | null;
  workflowType: string;
  steps: ChainStep[];
  currentLevel: number;
  fullyApproved: boolean;
  hasRejection: boolean;
  totalLevels: number;
}

export function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function displayName(name: string | null, email: string | null): string {
  return name || email?.split("@")[0] || "—";
}

// A single node in the vertical timeline.
export const ChainNode: React.FC<{ step: ChainStep; isLast: boolean }> = ({ step, isLast }) => {
  const isApproved = step.status === "Approved";
  const isRejected = step.status === "Rejected";
  const isSubmitted = step.status === "Submitted";
  const isPending = step.status === "Pending";

  // Approved stays green and rejected red, as on the inbox; submitted is inked, waiting is a dashed outline.
  const dot = isRejected
    ? "bg-red-600 border-red-600 text-white"
    : isApproved
      ? "bg-emerald-600 border-emerald-600 text-white"
      : isSubmitted
        ? "bg-foreground border-foreground text-card"
        : "border-dashed border-foreground text-foreground";

  const Icon = isRejected ? XCircle : isApproved ? CheckCircle2 : isSubmitted ? SendHorizonal : Clock;

  return (
    <div className="flex gap-3">
      {/* Rail */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-7 h-7 flex items-center justify-center border ${dot}`}>
          <Icon size={13} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-foreground/40 min-h-[24px] mt-1" />}
      </div>

      {/* Content */}
      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-5"}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-foreground">{step.label}</p>
          <span
            className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border ${
              isRejected
                ? "text-red-600 border-red-500"
                : isApproved
                  ? "text-emerald-600 border-emerald-500"
                  : isSubmitted
                    ? "text-foreground border-foreground"
                    : "text-muted-foreground border-dashed border-foreground/50"
            }`}
          >
            {step.status}
          </span>
        </div>

        {step.workflowType === "parallel" && step.approvers?.length ? (
          <div className="mt-1.5 space-y-1">
            {step.approvers.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <UserCheck size={10} className="shrink-0" />
                <span className="text-foreground font-medium">{displayName(a.name, a.email)}</span>
                {a.role && <span className="opacity-60">· {a.role}</span>}
                <span className="opacity-60">· {a.status}</span>
                {a.actionAt && <span className="opacity-60">· {fmtWhen(a.actionAt)}</span>}
              </div>
            ))}
          </div>
        ) : step.approverEmail || step.actionAt ? (
          <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
            {displayName(step.approverName, step.approverEmail)}
            {step.role ? ` · ${step.role}` : ""}
            {step.actionAt ? ` · ${fmtWhen(step.actionAt)}` : ""}
          </p>
        ) : (
          <p className="text-[0.6875rem] text-muted-foreground/60 mt-0.5 italic">Awaiting action</p>
        )}

        {step.note && (
          <blockquote className="mt-1.5 text-[0.6875rem] text-foreground/80 italic border-l-2 border-foreground/40 pl-2.5 py-0.5">
            "{step.note}"
          </blockquote>
        )}
      </div>
    </div>
  );
};

// Who is supplying labour / material: the company or contractor's name, with the kind as a badge.
export const SourceBadgeWithName: React.FC<{ source: SourceType; name?: string | null }> = ({ source, name }) => (
  <span className="flex flex-wrap items-center gap-2">
    {name && <span className="text-foreground">{name}</span>}
    <span
      className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 ${SOURCE_META[source].className}`}
    >
      {SOURCE_META[source].label}
    </span>
  </span>
);

// Where Quality Check stands on this activity.
export const QcStatusPill: React.FC<{ qc?: { decision: "APPROVED" | "REWORK" } | null }> = ({ qc }) => {
  const meta = !qc
    ? { label: "Not reviewed", cls: "text-muted-foreground border border-dashed border-foreground/40" }
    : qc.decision === "APPROVED"
      ? { label: "Passed", cls: "text-emerald-600 border border-emerald-500" }
      : { label: "Sent back for rework", cls: "text-red-600 border border-red-500" };
  return (
    <span className={`ml-auto font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 ${meta.cls}`}>
      {meta.label}
    </span>
  );
};

// A checkpoint's Quality Check rating.
export const RATING_META: Record<string, { label: string; cls: string }> = {
  POOR: { label: "Poor", cls: "text-red-600 border border-red-500" },
  GOOD: { label: "Good", cls: "text-emerald-600 border border-emerald-500" },
  EXCELLENT: { label: "Excellent", cls: "bg-emerald-600 text-white border border-emerald-600" },
};

export const FormField: React.FC<{ label: string; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="min-w-0">
    <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">{label}</p>
    <div className={`text-[0.8125rem] font-medium text-foreground px-3 py-2.5 break-words min-h-[38px] flex items-center border ${
      accent ? "border-foreground font-semibold" : "border-foreground/25"
    }`}>
      {value ?? <span className="text-muted-foreground/40">—</span>}
    </div>
  </div>
);

export interface ApprovalReviewPanelProps {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
  onActionDone: (action: "approve" | "reject") => void;
}

// A Work Order's activities, grouped by activity group: per activity the rate, area, labour / material /
// GST breakdown and total, with its materials listed underneath.
export type WoMaterial = Record<string, unknown>;
export type WoActivity = Record<string, unknown> & { materials?: WoMaterial[] };
export const WoActivities: React.FC<{ activities: WoActivity[] }> = ({ activities }) => {
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const groups = new Map<string, WoActivity[]>();
  for (const a of activities) {
    const g = ((a.ActivityGroupName as string) || "Ungrouped").trim();
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  let n = 0;
  return (
    <div>
      <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2 flex items-center gap-1.5">
        <Package size={10} className="text-muted-foreground" />
        {`Activities (${activities.length})`}
      </p>
      <div className="space-y-3">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group} className="border border-foreground/25 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-foreground">
              <span className="text-xs font-heading font-semibold text-foreground">{group}</span>
              <span className="text-xs font-semibold text-foreground">{formatINR(rows.reduce((s, r) => s + num(r.GrandTotal), 0))}</span>
            </div>
            <div className="divide-y divide-foreground/10">
              {rows.map((a) => {
                n += 1;
                const mats = a.materials ?? [];
                const gstRate = a.HsnGstRate != null ? `${num(a.HsnGstRate)}%` : null;
                return (
                  <div key={String(a.Id ?? n)} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          <span className="text-muted-foreground mr-1.5">{n}.</span>
                          {(a.ActivityName as string) || "—"}
                          {a.HsnCode ? <span className="ml-1.5 text-[0.625rem] font-heading tabular-nums text-muted-foreground">SAC {String(a.HsnCode)}</span> : null}
                        </p>
                        {a.Remarks ? <p className="text-[0.6875rem] text-muted-foreground/80 mt-0.5 whitespace-pre-wrap">{String(a.Remarks)}</p> : null}
                      </div>
                      <span className="text-xs font-semibold text-foreground shrink-0">{formatINR(num(a.GrandTotal))}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                      {[
                        ["Area", `${num(a.Area).toLocaleString("en-IN")}${a.UOMName ? ` ${String(a.UOMName)}` : ""}`],
                        ["Rate", formatINR(num(a.Rate))],
                        ["Labour", formatINR(num(a.LabourAmount))],
                        ["Materials", formatINR(num(a.MaterialAmount))],
                        ...(gstRate ? [["GST", `${gstRate}${a.HsnGstType ? ` ${String(a.HsnGstType)}` : ""}`] as [string, string]] : []),
                      ].map(([k, v]) => (
                        <span key={k} className="text-[0.6875rem] text-muted-foreground">
                          {k}: <span className="text-foreground font-medium">{v}</span>
                        </span>
                      ))}
                    </div>
                    {mats.length > 0 && (
                      <div className="mt-2 border border-foreground/20 divide-y divide-foreground/10">
                        {mats.map((m, mi) => {
                          const q = num(m.Quantity);
                          const r = num(m.Rate);
                          return (
                            <div key={String(m.Id ?? mi)} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                              <div className="min-w-0">
                                <p className="text-[0.6875rem] font-medium text-foreground">{(m.ItemName as string) || "—"}</p>
                                <p className="text-[0.625rem] text-muted-foreground">
                                  {q.toLocaleString("en-IN")}{m.UOMName ? ` ${String(m.UOMName)}` : ""} × {formatINR(r)}
                                  {num(m.GSTRate) > 0 ? ` · GST ${num(m.GSTRate)}%` : ""}
                                  {m.SupplierNamePerLine ? ` · ${String(m.SupplierNamePerLine)}` : ""}
                                </p>
                              </div>
                              <span className="text-[0.6875rem] font-semibold text-foreground shrink-0">{formatINR(q * r)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// One BOQ list (Items or Activities): a card per line with its name, code, parent activity / group,
// description, the figures that matter, and the line amount.
export interface BoqLine { name: string; code: string; sub: string; description: string; facts: [string, string][]; amount: string }
export const BoqLines: React.FC<{ title: string; rows: BoqLine[] }> = ({ title, rows }) => (
  <div>
    <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2 flex items-center gap-1.5">
      <Package size={10} className="text-muted-foreground" />
      {title}
    </p>
    <div className="border border-foreground/25 divide-y divide-foreground/10 overflow-hidden">
      {rows.map((r, i) => (
        <div key={i} className="px-3 py-2.5 hover:bg-primary/5 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                {r.name}
                {r.code && <span className="ml-1.5 text-[0.625rem] font-heading tabular-nums text-muted-foreground">{r.code}</span>}
              </p>
              {r.sub && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{r.sub}</p>}
              {r.description && <p className="text-[0.6875rem] text-muted-foreground/80 mt-0.5 whitespace-pre-wrap">{r.description}</p>}
            </div>
            <span className="text-xs font-semibold text-foreground shrink-0">{r.amount}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
            {r.facts.map(([k, v]) => (
              <span key={k} className="text-[0.6875rem] text-muted-foreground">
                {k}: <span className="text-foreground font-medium">{v}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);
