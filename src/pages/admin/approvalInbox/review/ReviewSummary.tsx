import { fmtDate, fmtAmount } from "../config";
import { Clock } from "lucide-react";
import { FormField } from "./parts";
import type { ApprovalReviewState } from "./useApprovalReview";

// The amount (or days) up top, with TDS where it applies, and the overview fields.
export function ReviewSummary({ r }: { r: ApprovalReviewState }) {
  const { item, cfg, usesRungDetail, rungDetail, effectiveAmount, party, hidePartyField, rawTdsAmount, tdsName, tdsNature, tdsPercentage, netPayableAfterTds } = r;
  return (
    <>
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
          <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {usesRungDetail ? "Total Days" : rawTdsAmount > 0 ? "Total Amount (Before TDS)" : "Total Amount"}
          </p>
          <p className="text-3xl font-bold font-heading text-foreground tabular-nums tracking-tight">
            {usesRungDetail
              ? rungDetail?.assignment?.days != null
                ? `${rungDetail.assignment.days} day${rungDetail.assignment.days === 1 ? "" : "s"}`
                : "—"
              : fmtAmount(effectiveAmount)}
          </p>
          {item.Status === "Pending" && (
            <p className="text-[0.6875rem] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1 font-medium">
              <Clock size={10} /> Awaiting your approval
            </p>
          )}
        </div>
        {!usesRungDetail && rawTdsAmount > 0 && (
          <div className="grid grid-cols-2 divide-x divide-border border-t border-border/60 bg-background/40">
            <div className="px-5 py-3">
              <p className="text-[0.5625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                TDS Deducted{tdsPercentage != null ? ` (${tdsPercentage}%)` : ""}
              </p>
              <p className="text-lg font-bold font-heading text-amber-600 dark:text-amber-400 tabular-nums">
                − {fmtAmount(rawTdsAmount)}
              </p>
              {(tdsName || tdsNature) && (
                <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{tdsName || tdsNature}</p>
              )}
            </div>
            <div className="px-5 py-3">
              <p className="text-[0.5625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Net Payable (After TDS)
              </p>
              <p className="text-lg font-bold font-heading text-emerald-600 dark:text-emerald-400 tabular-nums">
                {fmtAmount(netPayableAfterTds)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Overview — form-style fields */}
      <div>
        <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Overview</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <FormField label={usesRungDetail ? "Start Date" : "Date"} value={fmtDate(item.RecordDate)} />
          {!hidePartyField && <FormField label="Party" value={party} />}
          {item.ProjectName && <FormField label="Project" value={item.ProjectName} />}
          <FormField label="Created By" value={item.CreatedBy || "—"} />
          {usesRungDetail ? (
            <FormField label="End Date" value={fmtDate(rungDetail?.assignment?.endDate ?? null)} />
          ) : (
            <FormField label="Last Modified" value={fmtDate(item.LastModified)} />
          )}
          {item.Module === "goods-receipt" && item.SourceTransferDocNo && (
            <FormField label="Transfer Ref" value={item.SourceTransferDocNo} />
          )}
          {item.FromGodownName && <FormField label="From Godown" value={item.FromGodownName} />}
          {item.ToGodownName && <FormField label="To Godown" value={item.ToGodownName} />}
        </div>
      </div>
    </>
  );
}
