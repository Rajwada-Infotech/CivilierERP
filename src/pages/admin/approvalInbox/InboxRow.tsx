// One record in the Approval Inbox: what it is, who and how much, where it stands, and the approve / review buttons.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Button } from "@/components/ui/button";
import { confirmEngineerAssignment } from "@/api/dependencyActivityAssignmentApi";
import { ClipboardCheck, ArrowUpRight, Inbox, CheckCircle2, XCircle, ArrowLeftRight, Warehouse, Building2, Eye, X, Loader2 } from "lucide-react";
import { ApprovalReviewPanel } from "../ApprovalReviewPanel";
import { InboxItem, MODULE_CONFIG, CRM_MODULES, CRM_APPROVER_ROLES, MR_APPROVER_ROLES, CRM_BOOKING_APPROVER_ROLES, DATE_APPROVER_ROLES, SUB_GATE_SUFFIX, REFUND_FINANCE_APPROVER_ROLES, SUB_GATE_MODULES, RESTRICTED_MODULES, needsBankReview, REVIEW_INSTEAD_LABEL, openInModulePath, fmtDate, fmtAmount, getEffectiveAmount } from "./config";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

// One engineer confirming their own task assignment — deliberately not
// routed through ApprovalActions (that component's whole job is picking an
// approver role/workflow, which doesn't apply here: isVisibleToViewer
// already means the only person who can ever see this row IS the engineer
// it's for).
const EngineerConfirmButton: React.FC<{ item: InboxItem; onDone: () => void }> = ({ item, onDone }) => {
  const [loading, setLoading] = useState(false);
  const handleConfirm = async () => {
    setLoading(true);
    try {
      const result = await confirmEngineerAssignment(Number(item.RecordId));
      toast.success(
        result.allApproved
          ? "Confirmed — activity moved to In Progress"
          : "Confirmed — waiting on the other assigned engineer(s)",
      );
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button
      size="sm"
      className={`${KEY} h-8 px-3 rounded-none bg-foreground text-card border border-foreground hover:bg-foreground/85 [&_svg]:size-3.5`}
      disabled={loading}
      onClick={handleConfirm}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Confirm
    </Button>
  );
};

// ─── Inbox row ────────────────────────────────────────────────────────────────

export const InboxRow: React.FC<{
  item: InboxItem;
  onActionDone: () => void;
  onOptimisticUpdate: (recordId: string, module: string) => void;
}> = ({ item, onActionDone, onOptimisticUpdate }) => {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;

  const approvedBy = item.ApprovedBy?.trim();
  const rejectedBy = item.RejectedBy?.trim();
  const party =
    item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const effectiveAmount = getEffectiveAmount(item);
  const [reviewOpen, setReviewOpen] = useState(false);

  const actions = (
    <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
      <button data-row-view
        onClick={() => setReviewOpen(true)}
        className={ACT}
        title="Review & Approve"
        aria-label="Review and approve"
      >
        <Eye size={14} />
      </button>
      {item.Module === "work-allocation-engineer" ? (
        // No role/workflow gate applies here at all — isVisibleToViewer
        // already restricted this row to exactly the engineer it's for, so
        // reaching this branch means the button is always safe to show.
        <EngineerConfirmButton
          item={item}
          onDone={() => {
            onOptimisticUpdate(item.RecordId, item.Module);
            onActionDone();
          }}
        />
      ) : item.Status === "Pending" && item._canAct === false ? (
        // Visible for awareness (named on some other level of this
        // record's workflow) but not their turn yet — Approve/Reject would
        // just 403 from transition()'s own per-level gate. Say so instead
        // of offering live-looking buttons that are guaranteed to fail.
        <span
          className={`${TAG} text-muted-foreground border-dashed border-foreground/50`}
          title="Named on this approval workflow, but this record hasn't reached your level yet."
        >
          Waiting on Level {item._currentLevel}
          {item._totalLevels ? ` of ${item._totalLevels}` : ""}
        </span>
      ) : (
        <ApprovalActions
          status={item.Status}
          recordId={item.RecordId}
          endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
          actionPathSuffix={SUB_GATE_SUFFIX[item.Module]}
          approverRoles={
            item.Module === "crm-refunds-finance" ? REFUND_FINANCE_APPROVER_ROLES
            : SUB_GATE_MODULES.has(item.Module) ? DATE_APPROVER_ROLES
            : item.Module === "crm-bookings" ? CRM_BOOKING_APPROVER_ROLES
            // Same role set as Received Payments (admin/super_admin/dba/
            // accounts_head) — matches approvalService.js's
            // MODULE_APPROVER_ROLE_OVERRIDES["crm-refund-payment"] exactly.
            : item.Module === "crm-money-receipts" || item.Module === "crm-refund-payment" ? MR_APPROVER_ROLES
            : CRM_MODULES.has(item.Module) ? CRM_APPROVER_ROLES
            // super_admin only — matches the backend's own gate exactly
            // (dependencyActivityAssignment.js's approve/reject routes:
            // named-on-the-level OR super_admin, never admin/dba generically).
            // Everyone else's button visibility comes from workflowVisible
            // (_canAct) below, not this role list.
            : item.Module === "civilworkdpr-approval" ? ["super_admin"]
            : undefined
          }
          // crm-applications'/crm-bookings' own PUT /:id/approve routes 400
          // until every Level-1/Level-2 checklist item is ticked — a one-click
          // Approve here can never succeed on its own, it can only ever
          // produce the "Complete the Level-X verification checklist..."
          // error toast. crm-brokerage's approve CAN succeed one-click (no
          // checklist gate), but the computed amount is meant to be reviewed
          // — and is only ever editable — before approval (see crmBrokerage.js
          // PUT /:id "can only be customized before approval"), so a blind
          // one-click Approve here skips the one chance to catch/adjust a
          // wrong figure. All three swap the Approve button for a direct
          // hand-off to their own review screen instead. Reject is untouched
          // for all of them — no checklist/review gate applies to rejecting.
          // CRM payments reach Finance with no deposit bank — Accounts sets
          // it on the Received Payment page first (the approve route refuses
          // without one), so "Review" opens that payment instead of Approve.
          reviewInstead={
            needsBankReview(item) && cfg?.navPath
              ? { label: "Review — set bank", onClick: () => navigate(openInModulePath(item, cfg.navPath)) }
              : REVIEW_INSTEAD_LABEL[item.Module] && cfg?.navPath
              ? { label: REVIEW_INSTEAD_LABEL[item.Module], onClick: () => navigate(openInModulePath(item, cfg.navPath)) }
              : undefined
          }
          restricted={RESTRICTED_MODULES.has(item.Module)}
          // Reaching this branch at all already means _canAct !== false (the
          // "waiting on level" badge above handles that case) — so for a
          // restricted module, this row being here means the inbox's own
          // isVisibleToViewer (approvalInbox.js) matched this viewer by
          // userId on the record's current Approval Setup level. See
          // ApprovalActions' workflowVisible prop doc.
          workflowVisible={item._canAct !== false}
          onSuccess={(action) => {
            if (action === "approve" || action === "reject") {
              onOptimisticUpdate(item.RecordId, item.Module);
            }
            onActionDone();
          }}
        />
      )}
      {/* The separate "open in preview" arrow is redundant for any module
          with a reviewInstead button while Pending — that button above
          already does the exact same navigation. Once it leaves Pending
          (Approved/Rejected/Cancelled), reviewInstead isn't rendered above,
          so the arrow comes back as the only way to open the record from
          this row. */}
      {cfg?.navPath && !((REVIEW_INSTEAD_LABEL[item.Module] || needsBankReview(item)) && item.Status === "Pending") && (
        <button
          onClick={() => navigate(openInModulePath(item, cfg.navPath))}
          className={ACT}
          title={`Open ${item.ModuleLabel} in preview`}
          aria-label={`Open ${item.ModuleLabel}`}
        >
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div>
      {reviewOpen && (
        <ApprovalReviewPanel
          item={item}
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onActionDone={() => {
            onOptimisticUpdate(item.RecordId, item.Module);
            onActionDone();
          }}
        />
      )}
      {/* ── Mobile card (< md) ─────────────────────────────────────────── */}
      <div className="md:hidden border-b border-foreground/15 last:border-0 px-4 py-3.5 space-y-3">
        {/* Row 1: module + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 flex items-center justify-center border border-foreground/40 text-foreground shrink-0">
              <Icon size={13} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {item.ModuleLabel}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">
                {item.Reference || `#${item.RecordId}`}
              </p>
            </div>
          </div>
          <SheetMark text={item.Status} tone={statusTone(item.Status)} />
        </div>

        {/* Row 2: party / transfer route + date */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {item.Module === "goods-receipt" && item.SourceTransferDocNo ? (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-heading tabular-nums text-[0.6875rem] font-semibold text-foreground truncate">
                {item.SourceTransferDocNo}
              </span>
              {item.FromGodownName && item.ToGodownName && (
                <span className="flex items-center gap-1 text-[0.625rem] truncate">
                  <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.FromGodownName}</span>
                  <ArrowLeftRight size={8} className="shrink-0" />
                  <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.ToGodownName}</span>
                </span>
              )}
            </div>
          ) : item.Module === "sale-orders" ? (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-foreground truncate">
                <span className="truncate">{item.ContractorName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <span className="truncate">{item.SupplierName}</span>
              </span>
              {item.FromGodownName && item.ToGodownName && (
                <span className="flex items-center gap-1 text-[0.625rem] truncate">
                  <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.FromGodownName}</span>
                  <ArrowLeftRight size={8} className="shrink-0" />
                  <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.ToGodownName}</span>
                </span>
              )}
            </div>
          ) : item.Module === "journal-voucher" && item.JournalVoucherSummary ? (
            <span className="truncate" title={item.JournalVoucherSummary}>
              {item.JournalVoucherSummary}
            </span>
          ) : item.Module === "fund-transfer" && item.ContractorName && item.SupplierName ? (
            <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-foreground truncate">
              <span className="truncate">{item.ContractorName}</span>
              <ArrowLeftRight size={8} className="shrink-0" />
              <span className="truncate">{item.SupplierName}</span>
            </span>
          ) : (
            <span className="truncate">{party}</span>
          )}
          <span className="shrink-0">{fmtDate(item.RecordDate)}</span>
        </div>

        {/* Row 2b: project (only when this module resolves to one) */}
        {item.ProjectName && (
          <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground -mt-1.5">
            <Building2 size={10} className="shrink-0" />
            <span className="truncate">{item.ProjectName}</span>
          </div>
        )}

        {/* Row 3: amount + approved/rejected by */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-heading tabular-nums font-semibold text-foreground">
            {fmtAmount(effectiveAmount)}
          </p>
          <div className="flex items-center gap-1.5">
            {approvedBy && (
              <span className={`${TAG} text-emerald-500 border-emerald-500 truncate max-w-[120px]`}>
                <CheckCircle2 size={9} /> {approvedBy}
              </span>
            )}
            {rejectedBy && (
              <span className={`${TAG} text-red-500 border-red-500 truncate max-w-[120px]`}>
                <XCircle size={9} /> {rejectedBy}
              </span>
            )}
          </div>
        </div>

        {/* Row 4: actions */}
        <div>{actions}</div>
      </div>

      {/* ── Desktop row (≥ md) ─────────────────────────────────────────── */}
      <div className="hidden md:flex items-stretch border-b border-foreground/15 last:border-0 hover:bg-primary/5 transition-colors group">
        {/* Wide screens: one table row. Narrower: a card — module on top,
            labelled details in a grid, actions on their own line. */}
        <div data-row className="flex-1 min-w-0 ai-row">
        {/* Col 1 — Module */}
        <div className="ai-c-mod flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 !p-0 !rounded-none flex items-center justify-center border border-foreground/40 text-foreground shrink-0">
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-semibold text-foreground truncate leading-tight">
              {item.ModuleLabel}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate mt-0.5">
              {item.Reference || `#${item.RecordId}`}
            </p>
          </div>
        </div>

        {/* Details group — separate table columns on wide screens
            (display: contents), one compact dotted line otherwise. */}
        <div className="ai-meta">
        {/* Col 2 — Date */}
        <div className="ai-c-date">
          <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Date</span>
          <p className="text-xs font-medium text-foreground">{fmtDate(item.RecordDate)}</p>
        </div>

        {/* Col 3 — Party / Transfer route */}
        <div className="ai-c-party min-w-0">
        <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Party / Transfer</span>
        {item.Module === "goods-receipt" && item.SourceTransferDocNo ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-heading text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              Transfer ref
            </span>
            <span className="font-heading tabular-nums text-xs font-semibold text-foreground truncate">
              {item.SourceTransferDocNo}
            </span>
            {item.FromGodownName && item.ToGodownName && (
              <span className="flex items-center gap-1 text-[0.625rem] text-muted-foreground truncate">
                <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{item.FromGodownName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{item.ToGodownName}</span>
              </span>
            )}
          </div>
        ) : item.Module === "sale-orders" ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-foreground truncate">
              <Building2 size={9} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{item.ContractorName}</span>
              <ArrowLeftRight
                size={8}
                className="shrink-0 text-muted-foreground"
              />
              <Building2 size={9} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{item.SupplierName}</span>
            </span>
            {item.FromGodownName && item.ToGodownName && (
              <span className="flex items-center gap-1 text-[0.625rem] text-muted-foreground truncate">
                <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{item.FromGodownName}</span>
                <ArrowLeftRight size={8} className="shrink-0" />
                <Warehouse size={9} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{item.ToGodownName}</span>
              </span>
            )}
          </div>
        ) : item.Module === "journal-voucher" && item.JournalVoucherSummary ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-heading text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              Account heads
            </span>
            <p className="text-xs text-foreground truncate" title={item.JournalVoucherSummary}>
              {item.JournalVoucherSummary}
            </p>
          </div>
        ) : item.Module === "fund-transfer" && item.ContractorName && item.SupplierName ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-heading text-[0.5625rem] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              From → To
            </span>
            <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-foreground truncate">
              <Building2 size={9} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{item.ContractorName}</span>
              <ArrowLeftRight size={8} className="shrink-0 text-muted-foreground" />
              <Building2 size={9} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{item.SupplierName}</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-foreground truncate">{party}</p>
        )}
        </div>

        {/* Col 4 — Project */}
        <div className="ai-c-project min-w-0">
          <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Project</span>
          {item.ProjectName ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-foreground truncate max-w-full" title={item.ProjectName}>
              <Building2 size={10} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{item.ProjectName}</span>
            </span>
          ) : (
            <span className="text-[0.625rem] text-muted-foreground/50 italic">—</span>
          )}
        </div>

        {/* Col 5 — Amount */}
        <div className="ai-c-amount min-w-0">
        <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Amount</span>
        <p className="text-[0.8125rem] font-heading font-bold text-foreground tabular-nums">
          {fmtAmount(effectiveAmount)}
        </p>
        </div>

        {/* Col 6 — Approved/Rejected By */}
        <div className="ai-c-by min-w-0">
        <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Approved / Rejected by</span>
        <div className="flex items-center gap-1.5 min-w-0">
          {approvedBy && (
            <span className={`${TAG} text-emerald-500 border-emerald-500 truncate max-w-[130px]`}>
              <CheckCircle2 size={9} /> {approvedBy}
            </span>
          )}
          {rejectedBy && (
            <span className={`${TAG} text-red-500 border-red-500 truncate max-w-[130px]`}>
              <XCircle size={9} /> {rejectedBy}
            </span>
          )}
          {!approvedBy && !rejectedBy && (
            <span className="text-[0.625rem] text-muted-foreground/50 italic">—</span>
          )}
        </div>
        </div>

        </div>

        {/* Col 7 — Status */}
        <div className="ai-c-status">
          <span className="ai-label block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Status</span>
          <div className="flex items-center">
            <SheetMark text={item.Status} tone={statusTone(item.Status)} />
          </div>
        </div>

        {/* Col 8 — Actions */}
        <div className="ai-c-actions flex items-center gap-1.5 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
          {actions}
        </div>
        </div>
      </div>
    </div>
  );
};
