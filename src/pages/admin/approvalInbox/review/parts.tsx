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

  const dot = isRejected
    ? "bg-red-500 ring-red-500/20"
    : isApproved
      ? "bg-emerald-500 ring-emerald-500/20"
      : isSubmitted
        ? "bg-sky-500 ring-sky-500/20"
        : "bg-amber-400 ring-amber-400/25";

  const Icon = isRejected ? XCircle : isApproved ? CheckCircle2 : isSubmitted ? SendHorizonal : Clock;

  return (
    <div className="flex gap-3">
      {/* Rail */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white ring-4 ${dot} ${isPending ? "animate-pulse" : ""}`}>
          <Icon size={13} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border min-h-[24px] mt-1" />}
      </div>

      {/* Content */}
      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-5"}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-foreground">{step.label}</p>
          <span
            className={`text-[0.5625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              isRejected
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : isApproved
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : isSubmitted
                    ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "bg-[#ffe2021a] text-amber-600 dark:text-amber-400"
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
          <blockquote className="mt-1.5 text-[0.6875rem] text-foreground/80 italic border-l-2 border-border pl-2.5 py-0.5">
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
      className={`text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${SOURCE_META[source].className}`}
    >
      {SOURCE_META[source].label}
    </span>
  </span>
);

// Where Quality Check stands on this activity.
export const QcStatusPill: React.FC<{ qc?: { decision: "APPROVED" | "REWORK" } | null }> = ({ qc }) => {
  const meta = !qc
    ? { label: "Not reviewed", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400" }
    : qc.decision === "APPROVED"
      ? { label: "Passed", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
      : { label: "Sent back for rework", cls: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" };
  return (
    <span className={`ml-auto text-[0.5625rem] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full normal-case ${meta.cls}`}>
      {meta.label}
    </span>
  );
};

// A checkpoint's Quality Check rating.
export const RATING_META: Record<string, { label: string; cls: string }> = {
  POOR: { label: "Poor", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  GOOD: { label: "Good", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  EXCELLENT: { label: "Excellent", cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
};

export const FormField: React.FC<{ label: string; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="min-w-0">
    <p className="text-[0.5625rem] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">{label}</p>
    <div className={`text-[0.8125rem] font-medium text-foreground rounded-xl px-3 py-2.5 break-words min-h-[38px] flex items-center border ${
      accent ? "bg-primary/5 border-primary/20 text-primary" : "bg-muted/30 border-border/50"
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
      <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
        <Package size={10} className="text-emerald-500" />
        {`Activities (${activities.length})`}
      </p>
      <div className="space-y-3">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group} className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/40 border-b border-border">
              <span className="text-xs font-heading font-semibold text-foreground">{group}</span>
              <span className="text-xs font-semibold text-foreground">{formatINR(rows.reduce((s, r) => s + num(r.GrandTotal), 0))}</span>
            </div>
            <div className="divide-y divide-border/50">
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
                          {a.HsnCode ? <span className="ml-1.5 text-[0.625rem] font-mono text-muted-foreground">SAC {String(a.HsnCode)}</span> : null}
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
                      <div className="mt-2 rounded-lg bg-muted/30 border border-border/50 divide-y divide-border/40">
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
    <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
      <Package size={10} className="text-emerald-500" />
      {title}
    </p>
    <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
      {rows.map((r, i) => (
        <div key={i} className="px-3 py-2.5 hover:bg-muted/20 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                {r.name}
                {r.code && <span className="ml-1.5 text-[0.625rem] font-mono text-muted-foreground">{r.code}</span>}
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
