import { formatPreviewValue } from "../config";
import { FormField } from "./parts";
import type { ApprovalReviewState } from "./useApprovalReview";

// The rest of the record, field by field.
export function ReviewDetails({ r }: { r: ApprovalReviewState }) {
  const { usesRungDetail, loadingDetail, detailFailed, extraFields, labelFor } = r;
  return (
    <>
      {/* Details — the rest of the record, form-style. Not shown for
          work-allocation-engineer — its own Engineers/Materials/
          Checkpoints sections above already cover its full record. */}
      {!usesRungDetail && <div>
        <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-2">Details</p>
        {loadingDetail ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[46px] bg-muted animate-pulse" />
            ))}
          </div>
        ) : detailFailed || extraFields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {detailFailed ? "Couldn't load the full record — showing summary only." : "No additional fields."}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {extraFields.map(([k, v]) => (
              <FormField key={k} label={labelFor(k)} value={formatPreviewValue(v)} />
            ))}
          </div>
        )}
      </div>}
    </>
  );
}
