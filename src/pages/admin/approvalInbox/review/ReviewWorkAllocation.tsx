import { Package, CheckCircle2, XCircle, Circle, CalendarDays, UserRound, ShieldCheck, ListChecks } from "lucide-react";
import { SourceBadgeWithName, QcStatusPill, RATING_META, FormField } from "./parts";
import type { ApprovalReviewState } from "./useApprovalReview";

// Work allocation records: engineers, labour and material source, description and checkpoints.
export function ReviewWorkAllocation({ r }: { r: ApprovalReviewState }) {
  const { usesRungDetail, rungDetail, engineers, loadingRungDetail } = r;
  return (
    <>
      {/* Work Allocation — engineers, labour/material source, description,
          checkpoints. Same fields RungAssignmentModal.tsx's "Assign
          engineers & material" form shows, read-only here for review. */}
      {usesRungDetail && (
        loadingRungDetail ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[46px] rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : rungDetail?.assignment ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <UserRound size={10} className="text-cyan-500" /> Engineers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {rungDetail.assignment.engineerIds.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">None assigned</span>
                  ) : (
                    rungDetail.assignment.engineerIds.map((id) => (
                      <span
                        key={id}
                        className="text-xs font-medium bg-muted border border-border px-2.5 py-1 rounded-lg text-foreground"
                      >
                        {engineers.find((e) => e.id === id)?.name || `#${id}`}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={10} className="text-violet-500" /> Quality Check
                  <QcStatusPill qc={rungDetail.assignment.qcStatus} />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(rungDetail.assignment.qcUserIds || []).length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No QC engineer assigned</span>
                  ) : (
                    rungDetail.assignment.qcUserIds.map((id) => (
                      <span
                        key={id}
                        className="text-xs font-medium bg-muted border border-border px-2.5 py-1 rounded-lg text-foreground"
                      >
                        {engineers.find((e) => e.id === id)?.name || `#${id}`}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {rungDetail.assignment.labourSource && (
                <FormField
                  label="Labour Given By"
                  value={
                    <SourceBadgeWithName
                      source={rungDetail.assignment.labourSource}
                      name={rungDetail.assignment.labourSourceName}
                    />
                  }
                />
              )}
              {rungDetail.assignment.materialSource && (
                <FormField
                  label="Material Given By"
                  value={
                    <SourceBadgeWithName
                      source={rungDetail.assignment.materialSource}
                      name={rungDetail.assignment.materialSourceName}
                    />
                  }
                />
              )}
            </div>

            {rungDetail.assignment.description && (
              <div>
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Description</p>
                <p className="text-xs text-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
                  {rungDetail.assignment.description}
                </p>
              </div>
            )}

            {(rungDetail.assignment.materials.length > 0 || rungDetail.assignment.remarks) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Package size={10} className="text-emerald-500" /> Materials ({rungDetail.assignment.materials.length})
                  </p>
                  {rungDetail.assignment.materials.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No materials entered</p>
                  ) : (
                    <div className="rounded-xl border border-border divide-y divide-border/50">
                      {rungDetail.assignment.materials.map((m, i) => {
                        const candidate = rungDetail.candidateItems.find((c) => c.itemId === m.itemId);
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                            <span className="font-medium text-foreground">{candidate?.itemName || `#${m.itemId}`}</span>
                            <span className="text-muted-foreground shrink-0">
                              {m.quantity.toLocaleString("en-IN")}{candidate?.uom ? ` ${candidate.uom}` : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Remarks</p>
                  {rungDetail.assignment.remarks ? (
                    <p className="text-xs text-foreground whitespace-pre-wrap break-words bg-muted/30 border border-border rounded-lg px-3 py-2.5">
                      {rungDetail.assignment.remarks}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No remarks</p>
                  )}
                </div>
              </div>
            )}

            {rungDetail.assignment.checkpoints.length > 0 && (
              <div>
                <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ListChecks size={10} className="text-cyan-500" /> Checkpoints ({rungDetail.assignment.checkpoints.length})
                </p>
                <div className="rounded-xl border border-border divide-y divide-border/50">
                  {rungDetail.assignment.checkpoints.map((cp) => {
                    const qcCheck = rungDetail.assignment?.qcStatus?.checks?.find((c) => c.fieldName === cp.fieldName);
                    const rating = qcCheck?.rating ? RATING_META[qcCheck.rating] : null;
                    const failed = qcCheck?.rating === "POOR";
                    return (
                      <div key={cp.id ?? cp.fieldName} className="flex items-center gap-2 px-3 py-2 text-xs">
                        {failed ? (
                          <XCircle size={13} className="text-red-500 shrink-0" />
                        ) : cp.isChecked || qcCheck?.passed ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <Circle size={13} className="text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={cp.isChecked || qcCheck ? "text-foreground" : "text-muted-foreground"}>{cp.fieldName}</span>
                        {qcCheck?.note && (
                          <span className="text-[0.625rem] text-muted-foreground italic truncate" title={qcCheck.note}>
                            {qcCheck.note}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          {cp.isDaily && (
                            <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-muted-foreground/70 flex items-center gap-1">
                              <CalendarDays size={10} /> Daily{cp.updateCount ? ` · ${cp.updateCount}` : ""}
                            </span>
                          )}
                          {rating && (
                            <span className={`text-[0.5625rem] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${rating.cls}`}>
                              {rating.label}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Couldn't load the full assignment — showing summary only.</p>
        )
      )}
    </>
  );
}
