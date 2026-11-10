import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { fmtIstDateTime } from "@/lib/istTime";
import { formatINR } from "@/utils/formatCurrency";
import { getAmendment, listAmendments, retryApplyAmendment, type DocAmendment } from "@/api/docAmendmentsApi";
import { AmendmentDiff } from "./AmendmentDiff";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const TAG = "inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
const DOC_LABEL: Record<string, string> = {
  "purchase-order": "Purchase Order",
  "expense-booking": "Invoice",
  payment: "Payment",
  "received-payment": "Received Payment",
  "journal-voucher": "Journal Voucher",
  "fund-transfer": "Fund Transfer",
  boq: "BOQ",
  "work-order": "Work Order",
  "work-done": "Work Done",
};
const inr = (v: number | null) => (v == null ? "—" : formatINR(v, { decimals: 2 }));

/** Where an amendment stands: waiting, applied, approved but not applied (with why), or rejected. */
function StateTag({ a }: { a: DocAmendment }) {
  if (a.status === "Rejected") return <span className={`${TAG} text-muted-foreground border-foreground/40`}>Rejected</span>;
  if (a.status === "Approved" && a.appliedAt) return <span className={`${TAG} bg-foreground text-card border-foreground`}>Applied</span>;
  if (a.status === "Approved") return <span className={`${TAG} text-destructive border-destructive`}>Approved · not applied</span>;
  return <span className={`${TAG} text-foreground border-dashed border-foreground`}>Waiting for approval</span>;
}

/**
 * The amendment requests of one module (dbo.DocAmendment): each with its document, where it stands, the reason and the
 * value it changes; open one to see line by line what it changes and how its GRNs follow. An approved one that could
 * not be applied shows why, and an admin can try applying it again.
 */
export function AmendmentRequests({ module }: { module: string }) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "admin";
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["doc-amendments", module], queryFn: () => listAmendments({ module }) });
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useQuery({ queryKey: ["doc-amendment", openId], queryFn: () => getAmendment(openId as number), enabled: openId != null });
  const [retrying, setRetrying] = useState<number | null>(null);

  const retry = async (id: number) => {
    setRetrying(id);
    try {
      const r = await retryApplyAmendment(id);
      toast.success(r.message);
      await qc.invalidateQueries({ queryKey: ["doc-amendments"] });
      await qc.invalidateQueries({ queryKey: ["doc-amendment", id] });
    } catch (e: any) {
      toast.error(e?.message || "Could not apply it.");
    } finally {
      setRetrying(null);
    }
  };

  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
      <div className="px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
        <span className={HEAD}>Amendment requests</span>
        <p className="text-xs text-muted-foreground mt-1">
          Approved documents amended with a reason. Each applies — to the document and whatever follows from it — once it is
          approved. Raise one with the Amend key on an approved document.
        </p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No amendment requests yet.</p>
      ) : (
        <div className="divide-y divide-foreground/15">
          {rows.map((a) => (
            <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="w-full text-left px-4 py-3 hover:bg-primary/5 transition-colors space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-sm font-bold tracking-tight text-foreground">{a.docNo}</span>
                <span className={LBL}>{DOC_LABEL[a.docType] ?? a.docType}</span>
                <span className="ml-auto"><StateTag a={a} /></span>
              </div>
              <p className="text-xs text-foreground line-clamp-2">{a.reason}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  {inr(a.oldValue)} <ArrowRight size={10} /> <span className="text-foreground font-semibold">{inr(a.newValue)}</span>
                </span>
                <span>Raised by {a.requestedBy} · {fmtIstDateTime(a.requestedAt)}</span>
                {a.decidedBy && <span>{a.status === "Rejected" ? "Rejected" : "Approved"} by {a.decidedBy}</span>}
              </div>
              {a.status === "Approved" && !a.appliedAt && a.applyError && <p className="text-[0.6875rem] text-destructive">{a.applyError}</p>}
            </button>
          ))}
        </div>
      )}

      <Dialog open={openId != null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="sheet-frame max-w-2xl max-h-[90dvh] overflow-y-auto" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3 flex items-end justify-between gap-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <div>
                <p className={LBL}>Amendment · {open ? DOC_LABEL[open.docType] ?? open.docType : ""}</p>
                <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{open?.docNo}</DialogTitle>
              </div>
              {open && <StateTag a={open} />}
            </div>
          </DialogHeader>
          {detail.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : detail.data ? (
            <div className="space-y-4">
              {detail.data.status === "Rejected" && detail.data.rejectionNote && (
                <div className="border border-destructive px-3 py-2">
                  <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-destructive mb-0.5">Rejected because</p>
                  <p className="text-xs text-foreground">{detail.data.rejectionNote}</p>
                </div>
              )}
              {detail.data.status === "Approved" && !detail.data.appliedAt && (
                <div className="border border-destructive px-3 py-2 space-y-2">
                  <p className="text-xs text-destructive">Approved, but it could not be applied{detail.data.applyError ? `: ${detail.data.applyError}` : "."}</p>
                  {isAdmin && (
                    <button
                      onClick={() => void retry(detail.data!.id)}
                      disabled={retrying === detail.data.id}
                      className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center gap-1.5 h-8 px-3 border border-foreground text-foreground hover:bg-primary/10 disabled:opacity-40"
                    >
                      {retrying === detail.data.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Try applying again
                    </button>
                  )}
                </div>
              )}
              <AmendmentDiff d={detail.data} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">Couldn't load this amendment.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
