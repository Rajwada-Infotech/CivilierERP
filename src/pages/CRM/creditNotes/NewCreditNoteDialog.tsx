// Raise a credit note on an invoice, without a refund: a discount, area change or price correction where the
// money stays with us. It goes for approval; approved, it lowers the booking.
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "../customers/config";
import { API, REASON_LABEL, day, getJson, inr } from "./config";

export function NewCreditNoteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const { data: invoices = [], isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["crm-creditable-invoices", q],
    queryFn: () => getJson(`${API}/gst-notes/creditable-invoices?search=${encodeURIComponent(q)}`),
  });
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [reasonType, setReasonType] = useState("Discount");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = invoices.find((x) => x.Id === invoiceId);
  const amt = Math.round(Number(amount || 0) * 100) / 100;
  const open = Number(inv?.Open || 0);
  const tooMuch = !!inv && amt > open + 0.005;
  // Same split the server uses: the booking's GST share of its total.
  const ratio = inv && Number(inv.BookingTotal) > 0 ? Number(inv.BookingGst) / Number(inv.BookingTotal) : 0;
  const gst = Math.round(amt * ratio * 100) / 100;
  const paid = Number(inv?.MilestonePaid || 0);
  const newDue = inv?.MilestoneDue != null ? Math.max(0, Number(inv.MilestoneDue) - amt) : null;
  const toAccount = newDue != null ? Math.max(0, paid - newDue) : 0;
  const daysLeft = inv ? Math.ceil((new Date(inv.Deadline).getTime() - Date.now()) / 864e5) : 0;
  const ready = !!inv && amt > 0 && !tooMuch && !!remarks.trim();

  const save = async () => {
    setBusy(true);
    try {
      const r = await getJson(`${API}/gst-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ InvoiceId: invoiceId, Amount: amt, ReasonType: reasonType, Remarks: remarks }),
      });
      toast.success("Credit note prepared — check it, then send it for approval");
      onCreated(r.Id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const row = (k: string, v: React.ReactNode, strong = false) => (
    <div className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${strong ? "font-semibold" : ""}`} style={{ borderBottom: RULE_SOFT }}>
      <span className="text-muted-foreground min-w-0">{k}</span>
      <span className="font-heading tabular-nums text-right shrink-0">{v}</span>
    </div>
  );
  const chip = (on: boolean) => `h-8 px-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw] max-w-5xl rounded-none p-0 gap-0 overflow-hidden" style={{ border: RULE }}>
        <DialogHeader className="px-5 pt-5 pb-3" style={{ borderBottom: RULE }}>
          <DialogTitle className="font-heading">New credit note — invoice reduced</DialogTitle>
          <DialogDescription className="text-xs">
            A discount, area change or price correction where the money stays with us. Money paid back is a refund — its credit note comes with the refund.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] max-h-[70vh] overflow-y-auto md:overflow-hidden">
          <section className="min-w-0 flex flex-col md:max-h-[70vh] md:border-r" style={{ borderColor: "hsl(var(--foreground) / 0.15)" }}>
            <div className="p-4 pb-3">
              <label className={`block mb-1 ${LBL}`}>1 · Invoice</label>
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice no., booking, unit or customer…" className={INP} />
            </div>
            <div className="px-4 pb-4 overflow-y-auto thin-scroll md:flex-1">
              {isError ? (
                <p className="text-xs text-destructive p-3">{(error as Error)?.message}</p>
              ) : isLoading ? (
                <p className="text-xs text-muted-foreground p-3">Loading…</p>
              ) : !invoices.length ? (
                <p className="text-xs text-muted-foreground p-4" style={{ border: RULE_SOFT }}>
                  {q ? `Nothing matches "${q}".` : "No invoice can take a credit note — they need value left and to be before their declare-by date, on a live booking."}
                </p>
              ) : (
                <div style={{ border: RULE_SOFT, borderBottom: 0 }}>
                  {invoices.map((x) => {
                    const on = x.Id === invoiceId;
                    return (
                      <button key={x.Id} onClick={() => { setInvoiceId(x.Id); setAmount(""); }}
                        className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-primary/10" : "hover:bg-primary/5"}`}
                        style={{ borderBottom: RULE_SOFT, borderLeft: on ? "3px solid hsl(var(--foreground))" : "3px solid transparent" }}>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-heading text-sm font-semibold tabular-nums truncate">{x.InvoiceNo}</span>
                          <span className={`${LBL} shrink-0`}>{x.InvoiceType}</span>
                        </div>
                        <div className="text-xs mt-1 truncate">{x.CustomerName}</div>
                        <div className="text-[0.6875rem] text-muted-foreground truncate">{x.Property}{x.ProjectName ? ` · ${x.ProjectName}` : ""} · {day(x.InvoiceDate)}</div>
                        <div className="flex items-center justify-between gap-2 mt-1 text-[0.6875rem] tabular-nums">
                          <span className="text-muted-foreground">Invoice {inr(x.Amount)}</span>
                          <span className="font-heading font-semibold">{inr(x.Open)} left</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="min-w-0 p-4 space-y-4 md:overflow-y-auto md:max-h-[70vh] thin-scroll">
            {!inv ? (
              <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-muted-foreground text-center p-6" style={{ border: RULE_SOFT }}>
                Choose the invoice on the left.
              </div>
            ) : (
              <>
                <div className="px-3 py-2.5 text-xs space-y-1" style={{ border: RULE_SOFT }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-heading font-semibold text-sm tabular-nums">{inv.InvoiceNo}</span>
                    <span className={`tabular-nums ${daysLeft <= 30 ? "font-semibold" : "text-muted-foreground"}`}>declare by {day(inv.Deadline)} · {daysLeft} day{daysLeft === 1 ? "" : "s"}</span>
                  </div>
                  <div className="truncate">{inv.CustomerName} · {inv.Property} · <span className="font-heading tabular-nums">{inv.BookingNo}</span></div>
                  {inv.MilestoneName && <div className="text-muted-foreground truncate tabular-nums">{inv.MilestoneName}: due {inr(inv.MilestoneDue)} · paid {inr(inv.MilestonePaid)}</div>}
                </div>

                <div>
                  <label className={`block mb-1 ${LBL}`}>2 · Why</label>
                  <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                    {Object.entries(REASON_LABEL).map(([k, v]) => (
                      <button key={k} onClick={() => setReasonType(k)} className={chip(reasonType === k)} style={{ borderRight: RULE_SOFT }}>{v}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={`block mb-1 ${LBL}`}>3 · Amount to credit (incl. GST)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                      className={`${INP} flex-1 min-w-[160px] tabular-nums ${tooMuch ? "!border-destructive" : ""}`} />
                    {[5, 10].map((p) => (
                      <button key={p} onClick={() => setAmount(String(Math.round(open * p) / 100))} className={`${KEY_LINE} h-9 px-3`}>{p}%</button>
                    ))}
                    <button onClick={() => setAmount(String(open))} className={`${KEY_LINE} h-9 px-3`}>All left</button>
                  </div>
                  <p className={`mt-1 text-[0.6875rem] tabular-nums ${tooMuch ? "text-destructive" : "text-muted-foreground"}`}>
                    {tooMuch ? `More than can be credited — at most ${inr(open)}` : `Up to ${inr(open)} can be credited on this invoice`}
                  </p>
                </div>

                <div>
                  <label className={`block mb-1 ${LBL}`}>4 · What changed (printed on the credit note)</label>
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} maxLength={500}
                    placeholder="e.g. Festive discount agreed on 12 Oct · super built-up area revised from 1,250 to 1,232 sq ft" className={TEXTAREA} />
                </div>

                <div className="text-xs" style={{ border: RULE_SOFT }}>
                  <div className={`px-3 py-2 ${LBL}`} style={{ borderBottom: RULE_SOFT }}>On approval</div>
                  {row("Taxable value", inr(amt - gst))}
                  {row(`GST${inv.GstRate ? ` @ ${Number(inv.GstRate)}%` : ""}`, inr(gst))}
                  {row("Credit note total", inr(amt), true)}
                  {row(open < Number(inv.Amount) ? "Invoice value (after earlier credit notes)" : "Invoice value", <>{inr(open)} → <b>{inr(Math.max(0, open - amt))}</b></>)}
                  {row("Booking value", <>{inr(inv.BookingTotal)} → <b>{inr(Number(inv.BookingTotal) - amt)}</b></>)}
                  {newDue != null && row("Milestone due", <>{inr(inv.MilestoneDue)} → <b>{inr(newDue)}</b></>)}
                  {row("Moves to the customer's account", <b>{inr(toAccount)}</b>)}
                  <p className="px-3 py-2 text-[0.6875rem] text-muted-foreground">GST on money we keep stays paid as an advance; it is given back only if that money is refunded.</p>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ borderTop: RULE }}>
          <span className="text-xs text-muted-foreground min-w-0 tabular-nums">
            {!inv ? "Step 1 of 4 — choose the invoice" : !amt ? "Enter the amount" : tooMuch ? "The amount is too high" : !remarks.trim() ? "Describe what changed" : `Ready: ${inr(amt)} on ${inv.InvoiceNo} — it goes for approval next`}
          </span>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
            <button onClick={save} disabled={busy || !ready} className={`${KEY_INK} h-9 px-4`}>{busy ? "Saving…" : "Prepare credit note"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
