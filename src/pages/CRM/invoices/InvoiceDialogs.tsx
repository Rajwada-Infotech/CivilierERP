// An invoice's PDF, and voiding one.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Download, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "../customers/config";
import { BKG_API, CreditedNote, DIALOG, InvoiceMark, fmtMoney, type InvoiceRow } from "./config";

export function InvoicePreviewDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${BKG_API}/${invoice.BookingId}/invoices/${invoice.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.BookingId, invoice.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-2xl ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="font-heading flex items-center gap-2 tabular-nums"><FileText size={15} /> {invoice.InvoiceNo}</DialogTitle>
            {blobUrl && <a href={blobUrl} download={`${invoice.InvoiceNo}.pdf`} className={`${KEY_INK} h-8 px-3 shrink-0`}><Download size={12} /> Download PDF</a>}
          </div>
          <DialogDescription className="text-xs flex items-center gap-2 flex-wrap tabular-nums">
            {invoice.InvoiceType} · {fmtMoney(invoice.Amount)} · <span className="font-heading">{invoice.BookingNo}</span> · <InvoiceMark inv={invoice} />
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] overflow-hidden" style={{ border: RULE_SOFT }}>
          {failed ? <span className="text-sm text-destructive">Could not load the invoice PDF.</span>
            : !blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={invoice.InvoiceNo} className="w-full h-[60vh] border-0" />}
        </div>
        <CreditedNote inv={invoice} />
        {invoice.Status === "Void" && <p className="text-xs text-destructive">Voided{invoice.VoidReason ? ` — ${invoice.VoidReason}` : ""}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceDialog({ invoice, onClose, onVoided }: { invoice: InvoiceRow; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleVoid() {
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("A reason is required to void an invoice"); return; }
    setBusy(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${invoice.BookingId}/invoices/${invoice.Id}/void`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Void failed" }));
        toast.error(err.error || "Void failed");
        return;
      }
      toast.success(`${invoice.InvoiceNo} voided`);
      onVoided();
    } catch {
      toast.error("Network error — could not void invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><Ban size={15} /> Void {invoice.InvoiceNo}?</DialogTitle>
          <DialogDescription className="text-xs tabular-nums">
            {invoice.InvoiceType} · {fmtMoney(invoice.Amount)} · {invoice.BookingNo}. It stays on record for audit, and frees the slot so a corrected one can be generated in its place.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className={`block mb-1 ${LBL}`}>Reason *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this invoice being voided?" rows={3} className={TEXTAREA} autoFocus />
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} disabled={busy} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={handleVoid} disabled={busy || !reason.trim()} className={`${KEY_RED} h-9 px-4`}><Ban size={13} /> {busy ? "Voiding…" : "Void invoice"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
