import { AlertTriangle, ArrowRight, Loader2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HEAD, KEY_INK, KEY_LINE, LBL, RULE } from "./config";
import type { POState } from "./usePurchaseOrder";

const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DOC_LABEL: Record<string, string> = { grn: "GRN", "vehicle-in-out": "Vehicle In/Out" };

/**
 * Raising an amendment on a PO: the PO's old → new value, what follows down the chain (each GRN's old → new value;
 * Vehicle In/Out records read the PO's rate), anything that blocks it, and the mandatory reason. Nothing changes
 * until the amendment is approved.
 */
export function POAmendDialog({ m }: { m: POState }) {
  const { amendPreview: pv, setAmendPreview, amendReason, setAmendReason, amendSubmitting, submitAmendment } = m;
  const blocked = !!pv?.blockers.length;
  const grns = pv?.cascade.filter((c) => c.docType === "grn") ?? [];
  const others = pv?.cascade.filter((c) => c.docType !== "grn") ?? [];
  return (
    <Dialog open={!!pv} onOpenChange={(o) => !o && !amendSubmitting && setAmendPreview(null)}>
      <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: RULE }}>
            <p className={LBL}>Amendment · {pv?.docNo}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Raise an amendment</DialogTitle>
          </div>
        </DialogHeader>
        {pv && (
          <div className="space-y-4 min-w-0">
            {/* The PO's value */}
            <div className="flex items-center gap-3 text-sm">
              <span className={LBL}>Order value</span>
              <span className="tabular-nums text-muted-foreground">{inr(pv.oldValue)}</span>
              <ArrowRight size={13} className="text-muted-foreground shrink-0" />
              <span className="tabular-nums font-semibold text-foreground">{inr(pv.newValue)}</span>
            </div>

            {blocked ? (
              <div className="border border-destructive px-3 py-2.5 space-y-1.5">
                <p className="flex items-center gap-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-destructive">
                  <AlertTriangle size={12} /> This amendment can't be raised
                </p>
                {pv.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-destructive">{b}</p>
                ))}
              </div>
            ) : (
              <>
                {/* Down the chain */}
                <div className="space-y-1.5">
                  <p className={HEAD}>Follows down the chain</p>
                  {grns.length === 0 && others.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing has been received against this order yet — only the order changes.</p>
                  ) : (
                    <div className="border border-foreground/30 divide-y divide-foreground/15">
                      {grns.map((g) => (
                        <div key={`g${g.id}`} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="font-medium text-foreground min-w-0 truncate">{DOC_LABEL[g.docType]} {g.docNo}</span>
                          <span className="text-muted-foreground">{g.status}</span>
                          <span className="ml-auto tabular-nums text-muted-foreground">{inr(g.oldValue)}</span>
                          <ArrowRight size={11} className="text-muted-foreground shrink-0" />
                          <span className="tabular-nums font-semibold text-foreground">{inr(g.newValue)}</span>
                        </div>
                      ))}
                      {others.map((o) => (
                        <div key={`o${o.docType}${o.id}`} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="font-medium text-foreground min-w-0 truncate">{DOC_LABEL[o.docType] ?? o.docType} {o.docNo}</span>
                          <span className="ml-auto text-muted-foreground">follows the order's rates</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {grns.some((g) => g.status === "Approved") && (
                    <p className="text-[0.6875rem] text-muted-foreground">Approved GRNs are re-posted to the ledger at the new value.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="po-amend-reason" className={`${LBL} block`}>
                    Reason <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="po-amend-reason"
                    value={amendReason}
                    onChange={(e) => setAmendReason(e.target.value)}
                    rows={3}
                    placeholder="e.g. Supplier revised the rate per bag from ₹300 to ₹250"
                    className="w-full px-3 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-y"
                  />
                  <p className="text-[0.6875rem] text-muted-foreground">It goes for approval. The order and its GRNs change only once it is approved.</p>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button onClick={() => setAmendPreview(null)} disabled={amendSubmitting} className={`${KEY_LINE} h-9 px-4`}>
                {blocked ? "Close" : "Back to the order"}
              </button>
              {!blocked && (
                <button onClick={() => void submitAmendment()} disabled={amendSubmitting || !amendReason.trim()} className={`${KEY_INK} h-9 px-5`}>
                  {amendSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {amendSubmitting ? "Raising…" : "Raise amendment"}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
