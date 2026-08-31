/**
 * ApprovalReviewPanel.tsx — full-screen centered review modal for the
 * Approval Inbox, styled like a proper "issue detail" workspace rather than
 * a side drawer: a two-column takeover — record details on the left, the
 * approval chain pinned on the right — with the Approve/Reject action bar
 * anchored across the bottom.
 *
 * Built as a plain fixed-position overlay (not a Radix Dialog) so that
 * ApprovalActions' own reject-note Dialog can nest inside it without two
 * Dialog portals fighting over focus/scroll-lock.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import type { ApprovalTable } from "@/components/ApprovalStatusChain";
import {
  type InboxItem,
  MODULE_CONFIG,
  MODULE_APPROVAL_TABLE,
  SUB_GATE_SUFFIX,
  SUB_GATE_MODULES,
  CRM_MODULES,
  CRM_APPROVER_ROLES,
  DATE_APPROVER_ROLES,
  RESTRICTED_MODULES,
  openInModulePath,
  fmtDate,
  fmtAmount,
  getEffectiveAmount,
  PREVIEW_HIDDEN_KEYS,
  stripDbPrefix,
  isIdField,
  isJsonBlob,
  labelizeKey,
  extractLineItems,
  formatPreviewValue,
} from "./ApprovalInbox";
import {
  X,
  ClipboardCheck,
  Package,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  SendHorizonal,
} from "lucide-react";

// ─── Approval chain types — matches GET /api/approval-workflows/trail ────────

interface ChainApprover {
  email: string | null;
  name: string | null;
  role: string | null;
  status: string;
  actionAt: string | null;
}

interface ChainStep {
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

interface ChainData {
  workflowName: string | null;
  workflowType: string;
  steps: ChainStep[];
  currentLevel: number;
  fullyApproved: boolean;
  hasRejection: boolean;
  totalLevels: number;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayName(name: string | null, email: string | null): string {
  return name || email?.split("@")[0] || "—";
}

// A single node in the vertical timeline.
const ChainNode: React.FC<{ step: ChainStep; isLast: boolean }> = ({ step, isLast }) => {
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
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              isRejected
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : isApproved
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : isSubmitted
                    ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}
          >
            {step.status}
          </span>
        </div>

        {step.workflowType === "parallel" && step.approvers?.length ? (
          <div className="mt-1.5 space-y-1">
            {step.approvers.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <UserCheck size={10} className="shrink-0" />
                <span className="text-foreground font-medium">{displayName(a.name, a.email)}</span>
                {a.role && <span className="opacity-60">· {a.role}</span>}
                <span className="opacity-60">· {a.status}</span>
                {a.actionAt && <span className="opacity-60">· {fmtWhen(a.actionAt)}</span>}
              </div>
            ))}
          </div>
        ) : step.approverEmail || step.actionAt ? (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {displayName(step.approverName, step.approverEmail)}
            {step.role ? ` · ${step.role}` : ""}
            {step.actionAt ? ` · ${fmtWhen(step.actionAt)}` : ""}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5 italic">Awaiting action</p>
        )}

        {step.note && (
          <blockquote className="mt-1.5 text-[11px] text-foreground/80 italic border-l-2 border-border pl-2.5 py-0.5">
            "{step.note}"
          </blockquote>
        )}
      </div>
    </div>
  );
};

const FormField: React.FC<{ label: string; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">{label}</p>
    <div className={`text-[13px] font-medium text-foreground rounded-xl px-3 py-2.5 break-words min-h-[38px] flex items-center border ${
      accent ? "bg-primary/5 border-primary/20 text-primary" : "bg-muted/30 border-border/50"
    }`}>
      {value ?? <span className="text-muted-foreground/40">—</span>}
    </div>
  </div>
);

interface ApprovalReviewPanelProps {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
  onActionDone: (action: "approve" | "reject") => void;
}

export const ApprovalReviewPanel: React.FC<ApprovalReviewPanelProps> = ({ item, open, onClose, onActionDone }) => {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;
  const approvalTable: ApprovalTable | undefined = MODULE_APPROVAL_TABLE[item.Module];

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);

  const [chain, setChain] = useState<ChainData | null>(null);
  const [loadingChain, setLoadingChain] = useState(false);

  // Locks page scroll while the panel is open — matches standard drawer behaviour.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDetail(null);
    setDetailFailed(false);
    if (cfg?.apiEndpoint) {
      setLoadingDetail(true);
      fetchWithAuth(`${cfg.apiEndpoint}/${item.RecordId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          if (!cancelled) setDetail(data && typeof data === "object" ? data : null);
        })
        .catch(() => {
          if (!cancelled) setDetailFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoadingDetail(false);
        });
    }

    setChain(null);
    if (approvalTable) {
      setLoadingChain(true);
      fetchWithAuth(`/api/approval-workflows/trail?module=${approvalTable}&id=${item.RecordId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          if (!cancelled) setChain(data);
        })
        .catch(() => {
          /* chain section just stays hidden */
        })
        .finally(() => {
          if (!cancelled) setLoadingChain(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, item.Module, item.RecordId, cfg?.apiEndpoint, approvalTable]);

  if (!open) return null;

  const effectiveAmount = getEffectiveAmount(item);
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const lineItems = extractLineItems(detail);
  const extraFields = detail
    ? Object.entries(detail).filter(
        ([k, v]) =>
          !PREVIEW_HIDDEN_KEYS.has(stripDbPrefix(k).toLowerCase()) &&
          !isIdField(k) &&
          !isJsonBlob(v) &&
          !(Array.isArray(v) && v.length === 0) &&
          typeof v !== "object",
      )
    : [];

  const chainSection = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
        <UserCheck size={11} /> Approval Chain
      </p>
      {!approvalTable ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5 text-center">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center mx-auto mb-2">
            <UserCheck size={16} className="text-muted-foreground/50" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">No tracked workflow</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">This module's approval chain is managed directly.</p>
        </div>
      ) : loadingChain ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !chain || chain.steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <div>
          {chain.steps.map((step, i) => (
            <ChainNode key={`${step.level}-${step.actionAt ?? i}`} step={step} isLast={i === chain.steps.length - 1} />
          ))}
        </div>
      )}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Modal takeover */}
      <div className="relative w-full h-full sm:h-[min(90vh,880px)] sm:w-[min(94vw,1160px)] bg-background sm:rounded-2xl shadow-2xl ring-1 ring-border/60 flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        {/* Header — coloured gradient keyed to the module accent */}
        <div className="shrink-0 border-b border-border px-5 sm:px-6 py-4 flex items-center gap-3"
          style={{ background: (() => {
            const c = cfg?.color ?? "";
            const m = c.match(/text-(\w+)-(\d+)/);
            if (!m) return undefined;
            const map: Record<string, Record<string, string>> = {
              blue: { 500: "#3b82f6" }, amber: { 500: "#f59e0b", 600: "#d97706" },
              emerald: { 500: "#10b981", 600: "#059669" }, violet: { 500: "#8b5cf6", 600: "#7c3aed" },
              rose: { 500: "#f43f5e" }, teal: { 500: "#14b8a6", 600: "#0d9488" },
              indigo: { 400: "#818cf8", 500: "#6366f1" }, orange: { 500: "#f97316" },
              cyan: { 500: "#06b6d4" }, fuchsia: { 500: "#d946ef", 600: "#c026d3" },
              sky: { 500: "#0ea5e9" }, purple: { 500: "#a855f7" }, lime: { 600: "#65a30d" },
            };
            const hex = map[m[1]]?.[m[2]];
            return hex ? `linear-gradient(135deg, ${hex}18 0%, ${hex}06 100%)` : undefined;
          })() }}
        >
          <div className={`p-2.5 rounded-xl shrink-0 shadow-sm ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
            <Icon size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-foreground truncate leading-tight">{item.ModuleLabel}</p>
            <p className="text-[12px] text-muted-foreground font-mono truncate mt-0.5">
              {item.Reference || `#${item.RecordId}`}
            </p>
          </div>
          <StatusBadge status={item.Status} />
          <button
            onClick={onClose}
            className="ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
          >
            <X size={17} />
          </button>
        </div>

        {/* Body — two columns on large screens: details left, chain pinned right */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: record details */}
          <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
            {/* Amount hero */}
            <div className="rounded-2xl border border-border overflow-hidden"
              style={{ background: (() => {
                const c = cfg?.color ?? "";
                const m = c.match(/text-(\w+)-(\d+)/);
                if (!m) return undefined;
                const map: Record<string, Record<string, string>> = {
                  blue: { 500: "#3b82f6" }, amber: { 500: "#f59e0b", 600: "#d97706" },
                  emerald: { 500: "#10b981", 600: "#059669" }, violet: { 500: "#8b5cf6", 600: "#7c3aed" },
                  rose: { 500: "#f43f5e" }, teal: { 500: "#14b8a6", 600: "#0d9488" },
                  indigo: { 400: "#818cf8", 500: "#6366f1" }, orange: { 500: "#f97316" },
                  cyan: { 500: "#06b6d4" }, fuchsia: { 500: "#d946ef", 600: "#c026d3" },
                  sky: { 500: "#0ea5e9" }, purple: { 500: "#a855f7" }, lime: { 600: "#65a30d" },
                };
                const hex = map[m[1]]?.[m[2]];
                return hex ? `linear-gradient(135deg, ${hex}22 0%, ${hex}0a 100%)` : undefined;
              })() }}
            >
              <div className="px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Total Amount</p>
                <p className="text-3xl font-bold font-heading text-foreground tabular-nums tracking-tight">
                  {fmtAmount(effectiveAmount)}
                </p>
                {item.Status === "Pending" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1 font-medium">
                    <Clock size={10} /> Awaiting your approval
                  </p>
                )}
              </div>
            </div>

            {/* Overview — form-style fields */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Overview</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <FormField label="Date" value={fmtDate(item.RecordDate)} />
                <FormField label="Party" value={party} />
                <FormField label="Created By" value={item.CreatedBy || "—"} />
                <FormField label="Last Modified" value={fmtDate(item.LastModified)} />
                {item.Module === "goods-receipt" && item.SourceTransferDocNo && (
                  <FormField label="Transfer Ref" value={item.SourceTransferDocNo} />
                )}
                {item.FromGodownName && <FormField label="From Godown" value={item.FromGodownName} />}
                {item.ToGodownName && <FormField label="To Godown" value={item.ToGodownName} />}
              </div>
            </div>

            {item.RejectionNote && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/5 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-red-500/80 mb-0.5">
                  Rejection Note
                </p>
                <p className="text-xs text-foreground">{item.RejectionNote}</p>
              </div>
            )}

            {/* Line items */}
            {lineItems.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Package size={10} className="text-emerald-500" /> Items ({lineItems.length})
                </p>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-left">Item</th>
                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Qty</th>
                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Rate</th>
                        <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {lineItems.map((li, i) => {
                        const name = (li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—") as string;
                        const qty = Number(li.Quantity ?? li.quantity ?? 0);
                        const rate = Number(li.Rate ?? li.rate ?? 0);
                        const amount = Number(li.LineAmount ?? li.amount ?? qty * rate);
                        return (
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-medium">{name}</td>
                            <td className="px-3 py-2 text-right">{qty.toLocaleString("en-IN")}</td>
                            <td className="px-3 py-2 text-right">{formatINR(rate)}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatINR(amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Details — the rest of the record, form-style */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Details</p>
              {loadingDetail ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-[46px] rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : detailFailed || extraFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {detailFailed ? "Couldn't load the full record — showing summary only." : "No additional fields."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {extraFields.map(([k, v]) => (
                    <FormField key={k} label={labelizeKey(k)} value={formatPreviewValue(v)} />
                  ))}
                </div>
              )}
            </div>

            {/* Chain shows here too on small screens, where the sidebar collapses out */}
            <div className="lg:hidden pt-1">{chainSection}</div>

            {cfg?.navPath && (
              <button
                onClick={() => {
                  onClose();
                  navigate(openInModulePath(item, cfg.navPath));
                }}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/8 hover:border-primary/30 transition-all"
              >
                <ArrowUpRight size={14} className="shrink-0" />
                Open full record in {item.ModuleLabel}
              </button>
            )}
          </div>

          {/* Right: approval chain, pinned — desktop only */}
          <div className="hidden lg:block w-[340px] shrink-0 border-l border-border bg-muted/5 overflow-y-auto px-5 py-5">
            {chainSection}
          </div>
        </div>

        {/* Footer — the action bar, spanning full width */}
        <div className="shrink-0 border-t border-border px-5 sm:px-6 py-4 bg-muted/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            {item.Status === "Pending" ? "Review the details above before taking action." : `This record is ${item.Status.toLowerCase()}.`}
          </p>
          <ApprovalActions
            status={item.Status}
            recordId={item.RecordId}
            endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
            actionPathSuffix={SUB_GATE_SUFFIX[item.Module]}
            approverRoles={
              SUB_GATE_MODULES.has(item.Module) ? DATE_APPROVER_ROLES
              : CRM_MODULES.has(item.Module) ? CRM_APPROVER_ROLES
              : undefined
            }
            restricted={RESTRICTED_MODULES.has(item.Module)}
            className="[&_button]:h-10 [&_button]:px-5 [&_button]:text-sm [&_button]:font-semibold [&_button]:rounded-xl"
            onSuccess={(action) => {
              if (action === "approve" || action === "reject") {
                onActionDone(action);
                onClose();
              }
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};
