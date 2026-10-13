import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, FileText, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { buildWorkbook, downloadBlob, type XlsxCell } from "@/lib/xlsxBook";

// GST documents for money given back (backend services/crmGstNotes.js):
// a refund voucher for money that was never invoiced, credit notes against
// invoices, and — past the credit-note deadline — the buyer's certificate.

const API = "/api/crm/refunds";
const fmt = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const kind = (n: any) => (n.Status === "TimeBarred" ? "GST paid certificate" : n.DocType === "CreditNote" ? "Credit note" : "Refund voucher");

async function getJson(url: string, init?: RequestInit) {
  const r = await fetchWithAuth(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

export async function openGstNotePdf(id: number) {
  const r = await fetchWithAuth(`${API}/gst-notes/${id}/pdf`);
  if (!r.ok) return toast.error("Couldn't open the document");
  window.open(URL.createObjectURL(await r.blob()), "_blank");
}

function NoteRows({ notes }: { notes: any[] }) {
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li key={n.Id} className="rounded-lg border border-border p-3 text-xs flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-48">
            <div className="font-medium text-sm">{kind(n)} <span className="font-mono text-muted-foreground">{n.DocNo || ""}</span></div>
            <div className="text-muted-foreground">{n.DocType === "CreditNote" ? `Against invoice ${n.AgainstRef}` : `Against ${n.AgainstRef || "the receipts"}`} · {day(n.DocDate)}</div>
            {n.Status === "TimeBarred"
              ? <div className="mt-1 text-amber-700 dark:text-amber-300 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />Past {day(n.DeadlineDate)} — no credit note can be declared. Give the buyer this certificate to claim the GST from the department.</div>
              : n.DocType === "CreditNote" ? <div className="mt-1 text-muted-foreground">Declare in GSTR-1 by {day(n.DeadlineDate)} (or the annual return, if filed earlier).</div> : null}
          </div>
          <div className="text-right tabular-nums">
            <div>{fmt(n.TotalAmount)}</div>
            <div className="text-muted-foreground">GST {fmt(n.GstAmount)}{n.GstRate != null ? ` @ ${Number(n.GstRate)}%` : ""}</div>
          </div>
          <button onClick={() => openGstNotePdf(n.Id)} className="h-8 px-2.5 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1"><FileText size={13} />PDF</button>
        </li>
      ))}
    </ul>
  );
}

/** One refund's GST documents; Finance can issue them for a refund paid before they existed. */
export function RefundGstNotesDialog({ refund, canEdit, onClose }: { refund: any; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["crm-refund-gst-notes", refund.Id];
  const { data: notes = [], isLoading, isError, error } = useQuery<any[]>({ queryKey: key, queryFn: () => getJson(`${API}/${refund.Id}/gst-notes`) });
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    setBusy(true);
    try { await getJson(`${API}/${refund.Id}/gst-notes`, { method: "POST" }); toast.success("GST documents issued"); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["crm-gst-notes"] }); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="font-heading">GST documents — {refund.RefundNo}</DialogTitle></DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : isError ? <p className="text-sm text-red-600">{(error as any)?.message || "Couldn't load the documents"} — refresh and try again.</p>
          : notes.length ? <NoteRows notes={notes} />
          : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">No GST document for this refund yet. They are issued when Finance's payout is approved; this one was paid before they existed, or no GST was charged on the booking.</p>
              {canEdit && <button onClick={issue} disabled={busy} className="h-9 px-4 text-sm btn-module text-white rounded-lg disabled:opacity-40">{busy ? "Issuing…" : "Issue GST documents"}</button>}
            </div>
          )}
        <p className="text-[0.6875rem] text-muted-foreground">Money never invoiced gets a refund voucher; money that was invoiced gets a credit note against each invoice. Cancellation charges kept get none — their GST stays payable.</p>
      </DialogContent>
    </Dialog>
  );
}

/** Every credit note and refund voucher in a period — for the GST return. */
export function GstNotesRegisterDialog({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const { data: notes = [], isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["crm-gst-notes", from, to],
    queryFn: () => getJson(`${API}/gst-notes?from=${from}&to=${to}`),
  });
  const total = (t: string, f: string) => notes.filter((n) => (t === "CreditNote" ? n.DocType === "CreditNote" && n.Status !== "TimeBarred" : t === "TimeBarred" ? n.Status === "TimeBarred" : n.DocType === t)).reduce((s, n) => s + Number(n[f] || 0), 0);
  const exportXlsx = async () => {
    const head: XlsxCell[] = ["Document", "No.", "Date", "Customer", "Property", "Booking", "Against", "Against date", "Taxable value", "GST rate %", "GST", "Total", "Declare by", "Refund"].map((v) => ({ v, s: "header" as const }));
    const rows: XlsxCell[][] = [head, ...notes.map((n) => [kind(n), n.DocNo || "", String(n.DocDate).slice(0, 10), n.CustomerName || "", n.Property, n.BookingNo, n.AgainstRef || "",
      n.AgainstDate ? String(n.AgainstDate).slice(0, 10) : "", Number(n.TaxableValue), n.GstRate != null ? Number(n.GstRate) : "", Number(n.GstAmount), Number(n.TotalAmount),
      n.DeadlineDate ? String(n.DeadlineDate).slice(0, 10) : "", n.RefundNo])];
    downloadBlob(await buildWorkbook([{ name: "GST documents", rows, widths: [20, 16, 12, 24, 18, 16, 22, 12, 14, 10, 12, 14, 12, 16], freezeBelowRow: 2 }]), `GST-credit-notes-refund-vouchers-${from}-to-${to}.xlsx`);
  };
  const input = "h-9 px-2 text-sm border border-border rounded-lg bg-background";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading">GST documents register</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="text-xs text-muted-foreground">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block`} /></label>
          <label className="text-xs text-muted-foreground">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block`} /></label>
          <button onClick={exportXlsx} disabled={!notes.length} className="h-9 px-3 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-40 ml-auto"><FileDown size={14} />Excel</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border p-3"><div className="text-muted-foreground">Credit notes — GST to reduce</div><div className="text-base font-semibold tabular-nums">{fmt(total("CreditNote", "GstAmount"))}</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-muted-foreground">Refund vouchers — GST on advances given back</div><div className="text-base font-semibold tabular-nums">{fmt(total("RefundVoucher", "GstAmount"))}</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-muted-foreground">Past the deadline — buyer claims</div><div className="text-base font-semibold tabular-nums">{fmt(total("TimeBarred", "GstAmount"))}</div></div>
        </div>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : isError ? <p className="text-sm text-red-600">{(error as any)?.message || "Couldn't load the documents"} — refresh and try again.</p>
          : notes.length ? <NoteRows notes={notes} /> : <p className="text-sm text-muted-foreground">Nothing issued in this period.</p>}
      </DialogContent>
    </Dialog>
  );
}
