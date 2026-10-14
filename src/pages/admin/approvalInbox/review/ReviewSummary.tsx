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
      <div className="border border-foreground overflow-hidden">
        <div className="px-5 py-4">
          <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-1">
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
            <p className="mt-1.5 flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground">
              <Clock size={10} /> Awaiting your approval
            </p>
          )}
        </div>
        {!usesRungDetail && rawTdsAmount > 0 && (
          <div className="grid grid-cols-2 divide-x divide-foreground/20 border-t border-foreground/40">
            <div className="px-5 py-3">
              <p className="text-[0.5625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-1">
                TDS Deducted{tdsPercentage != null ? ` (${tdsPercentage}%)` : ""}
              </p>
              <p className="text-lg font-bold font-heading text-foreground tabular-nums">
                − {fmtAmount(rawTdsAmount)}
              </p>
              {(tdsName || tdsNature) && (
                <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{tdsName || tdsNature}</p>
              )}
            </div>
            <div className="px-5 py-3">
              <p className="text-[0.5625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-1">
                Net Payable (After TDS)
              </p>
              <p className="text-lg font-bold font-heading text-foreground tabular-nums">
                {fmtAmount(netPayableAfterTds)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Overview — form-style fields */}
      <div>
        <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2">Overview</p>
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
