import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewAmendment, raiseAmendment, type AmendableDocType, type AmendmentPreview, type CascadeEntry } from "@/api/docAmendmentsApi";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9";
const RULE = "1px solid hsl(var(--foreground))";
const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CASCADE_LABEL: Record<string, string> = {
  grn: "GRN",
  "vehicle-in-out": "Vehicle In/Out",
  ledger: "Ledger entry",
  "work-order": "Work Order",
  "work-done": "Work Done",
};

function CascadeRow({ c }: { c: CascadeEntry }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <span className="font-medium text-foreground min-w-0 truncate">
        {CASCADE_LABEL[c.docType] ?? c.docType} {c.docType === "ledger" ? "" : c.docNo}
      </span>
      {c.docType !== "ledger" && <span className="text-muted-foreground">{c.status}</span>}
      {c.oldValue == null && c.newValue == null ? (
        <span className="ml-auto text-muted-foreground">follows the new rates</span>
      ) : c.docType === "ledger" ? (
        <span className="ml-auto text-muted-foreground">reversed and posted again at the new value</span>
      ) : (
        <>
          <span className="ml-auto tabular-nums text-muted-foreground">{inr(c.oldValue)}</span>
          <ArrowRight size={11} className="text-muted-foreground shrink-0" />
          <span className="tabular-nums font-semibold text-foreground">{inr(c.newValue)}</span>
        </>
      )}
    </div>
  );
}

/**
 * Amendment mode for a document page (the universal amendment logic — backend services/docAmendment.js).
 *
 *   const amend = useAmendMode("journal-voucher", "Journal Voucher");
 *   amend.start(row.id)                     — the Amend key: then open the page's own edit form on that row
 *   if (await amend.intercept(id, payload)) return;   — first line of the page's save, before its update request
 *   {amend.dialog}                          — render once
 *   amend.stop()                            — when the form is closed
 *
 * In amendment mode, saving doesn't edit the document: it shows the review (old → new value, what follows, anything
 * that blocks it), asks for the mandatory reason, and raises the amendment for approval. The document changes only
 * once it is approved.
 */
export function useAmendMode(docType: AmendableDocType, label: string, opts: { onRaised?: () => void } = {}) {
  const qc = useQueryClient();
  const [amendingId, setAmendingId] = useState<string | number | null>(null);
  const [proposed, setProposed] = useState<unknown>(null);
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const start = (id: string | number) => {
    setAmendingId(id);
    setReason("");
    setPreview(null);
    toast.info(`Amending this ${label}: change what you need, then save to review the amendment.`);
  };
  const stop = () => {
    setAmendingId(null);
    setPreview(null);
    setProposed(null);
    setReason("");
  };

  /** True when this save was taken as an amendment (the page must then not send its own update). */
  const intercept = async (id: string | number | null | undefined, payload: unknown): Promise<boolean> => {
    if (amendingId == null || id == null || String(id) !== String(amendingId)) return false;
    setChecking(true);
    try {
      setProposed(payload);
      setPreview(await previewAmendment(docType, id, payload));
    } catch (e: any) {
      toast.error(e?.message || "Could not check the amendment.");
    } finally {
      setChecking(false);
    }
    return true;
  };

  const submit = async () => {
    if (amendingId == null) return;
    if (!reason.trim()) {
      toast.error("Give a reason for the amendment.");
      return;
    }
    setSubmitting(true);
    try {
      await raiseAmendment(docType, amendingId, proposed, reason.trim());
      await qc.invalidateQueries({ queryKey: ["doc-amendments"] });
      toast.success(`Amendment raised — the ${label} changes once it is approved.`);
      stop();
      opts.onRaised?.();
    } catch (e: any) {
      toast.error(e?.message || "Could not raise the amendment.");
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = !!preview?.blockers.length;
  const dialog = (
    <Dialog open={!!preview} onOpenChange={(o) => !o && !submitting && setPreview(null)}>
      <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: RULE }}>
            <p className={LBL}>Amendment · {label} {preview?.docNo}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Raise an amendment</DialogTitle>
          </div>
        </DialogHeader>
        {preview && (
          <div className="space-y-4 min-w-0">
            <div className="flex items-center gap-3 text-sm">
              <span className={LBL}>Value</span>
              <span className="tabular-nums text-muted-foreground">{inr(preview.oldValue)}</span>
              <ArrowRight size={13} className="text-muted-foreground shrink-0" />
              <span className="tabular-nums font-semibold text-foreground">{inr(preview.newValue)}</span>
            </div>
            {blocked ? (
              <div className="border border-destructive px-3 py-2.5 space-y-1.5">
                <p className="flex items-center gap-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-destructive">
                  <AlertTriangle size={12} /> This amendment can't be raised
                </p>
                {preview.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-destructive">{b}</p>
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className={HEAD}>When approved</p>
                  {preview.cascade.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Only this {label} changes.</p>
                  ) : (
                    <div className="border border-foreground/30 divide-y divide-foreground/15">
                      {preview.cascade.map((c) => (
                        <CascadeRow key={`${c.docType}-${c.id}`} c={c} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="amend-reason" className={`${LBL} block`}>
                    Reason <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="amend-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Why it is being amended"
                    className="w-full px-3 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-y"
                  />
                  <p className="text-[0.6875rem] text-muted-foreground">It goes for approval. Nothing changes until it is approved.</p>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button onClick={() => setPreview(null)} disabled={submitting} className={`${KEY} px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                {blocked ? "Close" : `Back to the ${label}`}
              </button>
              {!blocked && (
                <button onClick={() => void submit()} disabled={submitting || !reason.trim()} className={`${KEY} px-5 bg-foreground text-card border border-foreground`}>
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {submitting ? "Raising…" : "Raise amendment"}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return { amending: amendingId != null, amendingId, start, stop, intercept, checking, dialog };
}
