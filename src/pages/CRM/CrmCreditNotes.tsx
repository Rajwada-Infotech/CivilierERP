import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { buildWorkbook, downloadBlob, type XlsxCell } from "@/lib/xlsxBook";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, Download, ExternalLink, FileDown, FileText, Hourglass, Plus, Printer, RotateCcw, Search, Send, ShieldCheck } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";

// Credit Notes — the GST document for money given back to a CRM customer
// (backend services/crmGstNotes.js, issued when a refund's payout is approved):
//   on invoices   — reduces an invoice (s.34), declare by 30 Nov after its FY
//   on advances   — money never invoiced (the legal form: refund voucher, Rule 51)
//   past deadline — no credit note possible; the buyer's GST-paid certificate
// Raised without a refund too: an invoice reduced (discount, area change, price
// correction) and the money kept — approved, it lowers the booking and moves
// anything already paid above the new amount to the customer's account.
// Cancelling needs a second person; the number is kept. "To issue" lists paid
// refunds that carried GST but have none yet.

const API = "/api/crm/refunds";
const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function getJson(url: string, init?: RequestInit) {
  const r = await fetchWithAuth(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

type Kind = "invoice" | "advance" | "barred" | "cancelled" | "request";
const kindOf = (n: any): Kind => (["Draft", "Pending", "Rejected"].includes(n.Status) ? "request" : n.Status === "Cancelled" ? "cancelled" : n.Status === "TimeBarred" ? "barred" : n.DocType === "CreditNote" ? "invoice" : "advance");
const REASON_LABEL: Record<string, string> = { Discount: "Discount", AreaChange: "Area change", PriceCorrection: "Price correction", Other: "Other" };
const REQ_LABEL: Record<string, string> = { Draft: "Being prepared", Pending: "Waiting for approval", Rejected: "Sent back" };
const KIND: Record<Kind, { label: string; short: string; cls: string }> = {
  invoice: { label: "Credit note — on invoice", short: "On invoice", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900" },
  advance: { label: "Credit note — on advance (refund voucher)", short: "On advance", cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900" },
  barred: { label: "Past the deadline — GST paid certificate", short: "Past deadline", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900" },
  cancelled: { label: "Cancelled", short: "Cancelled", cls: "bg-muted text-muted-foreground border-border line-through" },
  request: { label: "Credit note — invoice reduced (not issued yet)", short: "Awaiting approval", cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900" },
};
const TABS = [["all", "All"], ["request", "Awaiting approval"], ["invoice", "On invoices"], ["advance", "On advances"], ["barred", "Past deadline"], ["cancelled", "Cancelled"], ["pending", "To issue"]] as const;
type Tab = (typeof TABS)[number][0];

function periods() {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    month: [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)],
    last: [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))],
    fy: [`${fyStart}-04-01`, ymd(now)],
    lastfy: [`${fyStart - 1}-04-01`, `${fyStart}-03-31`],
  } as Record<string, [string, string]>;
}
const PERIOD_LABEL: Record<string, string> = { month: "This month", last: "Last month", fy: "This financial year", lastfy: "Last financial year", custom: "Custom" };

/** Days to the declare-by date of a credit note on an invoice. */
function deadlineChip(n: any) {
  if (kindOf(n) !== "invoice" || !n.DeadlineDate) return null;
  const days = Math.ceil((new Date(n.DeadlineDate).getTime() - Date.now()) / 864e5);
  const cls = days < 0 ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 ${cls}`}><CalendarClock size={11} />{days < 0 ? `declare-by passed ${day(n.DeadlineDate)}` : `declare by ${day(n.DeadlineDate)} · ${days} day${days === 1 ? "" : "s"}`}</span>;
}

function PdfPreview({ id, version }: { id: number; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u: string | null = null; setUrl(null); setFailed(false);
    fetchWithAuth(`${API}/gst-notes/${id}/pdf`).then(async (r) => { if (!r.ok) throw new Error(); u = URL.createObjectURL(await r.blob()); setUrl(u); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, version]);
  if (failed) return <p className="p-6 text-sm text-red-600">Couldn't load the PDF — refresh and try again.</p>;
  if (!url) return <p className="p-6 text-sm text-muted-foreground">Preparing the PDF…</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-end">
        <a href={url} download className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"><Download size={13} />Download</a>
        <button onClick={() => { const w = window.open(url, "_blank"); w?.addEventListener("load", () => w.print()); }} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"><Printer size={13} />Print</button>
      </div>
      <iframe title="Credit note PDF" src={url} className="w-full h-[78vh] min-h-[520px] rounded-lg border border-border bg-white" />
    </div>
  );
}

/** Raise a credit note on an invoice, without a refund. */
function NewCreditNoteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const { data: invoices = [], isLoading } = useQuery<any[]>({ queryKey: ["crm-creditable-invoices", search], queryFn: () => getJson(`${API}/gst-notes/creditable-invoices?search=${encodeURIComponent(search)}`) });
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reasonType, setReasonType] = useState("Discount");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = invoices.find((x) => String(x.Id) === invoiceId);
  const amt = Number(amount || 0);
  const tooMuch = !!inv && amt > Number(inv.Open) + 0.005;
  const save = async () => {
    setBusy(true);
    try {
      const r = await getJson(`${API}/gst-notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ InvoiceId: Number(invoiceId), Amount: amt, ReasonType: reasonType, Remarks: remarks }) });
      toast.success("Credit note prepared — check it, then send it for approval");
      onCreated(r.Id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const label = "block text-xs font-medium text-muted-foreground mb-1";
  const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New credit note — invoice reduced</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">For a discount, area change or price correction where the money stays with us. Money paid back is a refund — its credit note comes with the refund.</p>
          <div>
            <label className={label}>Invoice</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice no., booking, unit or customer…" className={`${input} mb-2`} />
            <SearchableSelect value={invoiceId} onChange={(v) => { setInvoiceId(v); setAmount(""); }} placeholder={isLoading ? "Loading…" : invoices.length ? "Choose the invoice" : "No invoice can take a credit note"}
              searchPlaceholder="Filter…" options={invoices.map((x) => ({ value: String(x.Id), label: `${x.InvoiceNo} · ${x.Property} · ${x.CustomerName} · ${inr(x.Open)} left` }))} />
            {inv && <p className="mt-1 text-[0.6875rem] text-muted-foreground">Invoice {inr(inv.Amount)} on {day(inv.InvoiceDate)} · up to {inr(inv.Open)} can be credited · declare by {day(inv.Deadline)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Amount (incl. GST)</label>
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} ${tooMuch ? "border-red-500" : ""}`} />
              {tooMuch && <p className="mt-1 text-[0.6875rem] text-red-600">At most {inr(inv?.Open)}</p>}
            </div>
            <div>
              <label className={label}>Why</label>
              <select value={reasonType} onChange={(e) => setReasonType(e.target.value)} className={input}>
                {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>What changed (printed on the credit note)</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="e.g. Festive discount agreed on 12 Oct; super built-up area revised from 1,250 to 1,232 sq ft" className={`${input} h-auto py-2`} />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">On approval: the booking's value and this invoice's milestone come down by the amount; whatever the customer already paid above the new amount moves to their account as credit (use it on later milestones, or refund it from Refunds).</p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg border border-border hover:bg-muted">Close</button>
            <button onClick={save} disabled={busy || !inv || !(amt > 0) || tooMuch || !remarks.trim()} className="h-9 px-4 rounded-lg btn-module text-white disabled:opacity-40">{busy ? "Saving…" : "Prepare credit note"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A raised credit note before it is issued: edit, send for approval, approve / send back. */
function RequestPanel({ n, canEdit, refresh }: { n: any; canEdit: boolean; refresh: () => void }) {
  const [amount, setAmount] = useState(String(n.TotalAmount ?? ""));
  const [reasonType, setReasonType] = useState(n.ReasonType || "Discount");
  const [remarks, setRemarks] = useState(n.Remarks || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const editable = canEdit && ["Draft", "Rejected"].includes(n.Status);
  const dirty = Number(amount) !== Number(n.TotalAmount) || reasonType !== n.ReasonType || remarks !== (n.Remarks || "");
  const run = async (key: string, url: string, body: any, ok: string) => {
    setBusy(key);
    try { await getJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); toast.success(ok); setNote(""); refresh(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(""); }
  };
  const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background disabled:opacity-70";
  return (
    <div className="rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/40 dark:bg-orange-950/10 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{REQ_LABEL[n.Status]}</h3>
        <span className="text-xs text-muted-foreground">Raised {day(n.RequestedAt || n.CreatedAt)}{n.CreatedBy ? ` by ${n.CreatedBy}` : ""}</span>
      </div>
      {n.Status === "Rejected" && n.RejectionNote && <p className="text-xs text-red-600">Sent back: {n.RejectionNote}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">Amount (incl. GST)<input type="number" disabled={!editable} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} /></label>
        <label className="text-xs text-muted-foreground">Why<select disabled={!editable} value={reasonType} onChange={(e) => setReasonType(e.target.value)} className={input}>{Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="text-xs text-muted-foreground">Declare by<div className="h-9 flex items-center text-sm text-foreground">{day(n.DeadlineDate)}</div></div>
      </div>
      <label className="block text-xs text-muted-foreground">What changed<textarea disabled={!editable} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${input} h-auto py-2`} /></label>
      <p className="text-xs text-muted-foreground">On approval it is numbered and takes effect: booking value and the milestone of {n.AgainstRef} −{inr(n.TotalAmount)}; anything already paid above the new amount moves to the customer's account.</p>
      <div className="flex flex-wrap gap-2">
        {editable && <button disabled={!dirty || !!busy} onClick={() => run("save", `${API}/gst-notes/${n.Id}`, { Amount: Number(amount), ReasonType: reasonType, Remarks: remarks }, "Saved")} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40">Save</button>}
        {editable && <button disabled={dirty || !!busy} title={dirty ? "Save your changes first" : undefined} onClick={() => run("submit", `${API}/gst-notes/${n.Id}/submit`, null, "Sent for approval")} className="h-8 px-3 text-xs rounded-lg btn-module text-white inline-flex items-center gap-1.5 disabled:opacity-40"><Send size={12} />{n.Status === "Rejected" ? "Send again" : "Send for approval"}</button>}
      </div>
      {canEdit && n.Status === "Pending" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Approvers: approve here or in the Approval Inbox. Whoever raised it can't approve it.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Remarks (needed to send back)" className={`${input} h-auto py-2`} />
          <div className="flex gap-2">
            <button disabled={!!busy} onClick={() => run("approve", `${API}/gst-notes/${n.Id}/approve`, { note }, "Approved — credit note issued")} className="h-8 px-3 text-xs rounded-lg bg-green-600 text-white inline-flex items-center gap-1.5 disabled:opacity-40"><ShieldCheck size={12} />Approve</button>
            <button disabled={!!busy || !note.trim()} onClick={() => run("reject", `${API}/gst-notes/${n.Id}/reject`, { note }, "Sent back")} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40">Send back</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ id, canEdit, onChanged }: { id: number; canEdit: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: n, isLoading, isError, error } = useQuery<any>({ queryKey: ["crm-credit-note", id], queryFn: () => getJson(`${API}/gst-notes/${id}`) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !n) return <div className="rounded-xl border border-border p-10 text-center text-sm text-red-600">{(error as any)?.message || "Not found"}</div>;
  const k = kindOf(n);
  const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
  const norm = (x: any) => String(x || "").trim().toLowerCase();
  const sameState = !n.ProjectState || !n.CompanyState || norm(n.ProjectState) === norm(n.CompanyState);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["crm-credit-note"] }); onChanged(); };
  const doCancel = async () => {
    setBusy(true);
    try { await getJson(`${API}/gst-notes/${id}/cancel`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); toast.success("Cancellation sent for approval"); setCancelOpen(false); setReason(""); refresh(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const decideCancel = async (approve: boolean) => {
    setBusy(true);
    try { await getJson(`${API}/gst-notes/cancel-requests/${id}/${approve ? "approve" : "reject"}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: reason }) }); toast.success(approve ? "Cancellation approved" : "Cancellation turned down"); setReason(""); refresh(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const doReissue = async () => {
    setBusy(true);
    try { await getJson(`${API}/${n.RefundId}/gst-notes/reissue`, { method: "POST" }); toast.success("Re-issued"); refresh(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const banner =
    k === "invoice" ? <>Reduces invoice <b>{n.AgainstRef}</b>. Declare it in GSTR-1 by <b>{day(n.DeadlineDate)}</b> (or the annual return, if filed earlier); the GST below comes off what we owe.</>
    : k === "advance" ? <>The money came in as an advance with GST and was never invoiced, so it is given back on a refund voucher — the credit note for an advance. Its GST comes off the advances we paid tax on.</>
    : k === "barred" ? <>Invoice <b>{n.AgainstRef}</b> is past its declare-by date ({day(n.DeadlineDate)}), so no credit note can be issued and our GST stays as paid. Give the buyer this GST-paid certificate — they claim the GST from the department (Circular 188/20/2022).</>
    : k === "request" ? <>A credit note on invoice <b>{n.AgainstRef}</b> for {REASON_LABEL[n.ReasonType] || "a reduction"}: {n.Remarks}</>
    : <>Cancelled {day(n.CancelledAt)}{n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}. Its number stays in the series.{n.ReplacedByNo ? <> Replaced by <b>{n.ReplacedByNo}</b>.</> : null}</>;
  const allCancelled = k === "cancelled" && !(n.siblings || []).some((s: any) => s.Status !== "Cancelled");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{KIND[k].label}</div>
            <h2 className="text-xl font-semibold font-mono mt-0.5">{n.DocNo || (k === "request" ? "Not issued yet" : "No number (past deadline)")}</h2>
            <div className="text-sm mt-1">{n.CustomerName} <span className="text-muted-foreground">· {n.Property} · {n.ProjectName || ""}</span></div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{inr(n.TotalAmount)}</div>
            <div className="text-xs text-muted-foreground">GST {inr(n.GstAmount)}{n.GstRate != null ? ` @ ${Number(n.GstRate)}%` : ""} · {day(n.DocDate)}</div>
          </div>
        </div>
        {n.Source === "Adjustment" && k !== "request" && <p className="mt-2 text-xs text-muted-foreground">Invoice reduced — {REASON_LABEL[n.ReasonType] || "reduction"}{Number(n.MovedToAccount) > 0 ? ` · ${inr(n.MovedToAccount)} already paid moved to the customer's account` : ""}</p>}
        <p className={`mt-3 text-sm rounded-lg px-3 py-2 ${k === "barred" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : k === "cancelled" ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200" : "bg-muted/40"}`}>{banner}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit && ["invoice", "advance", "barred"].includes(k) && n.CancelApprovalStatus !== "Pending" && <button onClick={() => setCancelOpen(true)} className="h-8 px-3 text-xs rounded-lg border border-border text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1.5"><Ban size={13} />Cancel…</button>}
          {canEdit && allCancelled && !n.ReplacedByNo && <button onClick={doReissue} disabled={busy} className="h-8 px-3 text-xs rounded-lg btn-module text-white inline-flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={13} />Re-issue</button>}
          {n.RefundNo && <Link to={`/crm/refunds?search=${encodeURIComponent(n.RefundNo)}`} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5">Refund {n.RefundNo} <ExternalLink size={11} /></Link>}
          <Link to={`/crm/bookings?view=${n.BookingId}`} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5">Booking {n.BookingNo} <ExternalLink size={11} /></Link>
          {n.InvoiceId && <Link to={`/crm/invoices?invoiceId=${n.InvoiceId}`} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5">Invoice {n.AgainstRef} <ExternalLink size={11} /></Link>}
        </div>
        {n.CancelApprovalStatus === "Pending" && (
          <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20 p-3 text-sm space-y-2">
            <div><b>Cancellation asked</b> {day(n.CancelRequestedAt)} — {n.CancelRequestReason}. Waiting for a second person's approval (here or in the Approval Inbox).</div>
            {canEdit && (<>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Remarks (needed to keep it)" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background" />
              <div className="flex gap-2">
                <button onClick={() => decideCancel(true)} disabled={busy} className="h-8 px-3 text-xs rounded-lg bg-red-600 text-white disabled:opacity-40">Approve cancellation</button>
                <button onClick={() => decideCancel(false)} disabled={busy || !reason.trim()} className="h-8 px-3 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40">Keep it</button>
              </div>
            </>)}
          </div>
        )}
      </div>

      {k === "request" && <RequestPanel n={n} canEdit={canEdit} refresh={refresh} />}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-xl border border-border bg-card p-4"><PdfPreview id={id} version={`${n.Status}${n.CancelledAt || ""}`} /></div>
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1.5">
            <h3 className="text-sm font-semibold mb-1">Amounts</h3>
            <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span className="tabular-nums">{inr(n.TaxableValue)}</span></div>
            {sameState ? (<>
              <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{inr(half)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{inr(Number(n.GstAmount) - half)}</span></div>
            </>) : <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{inr(n.GstAmount)}</span></div>}
            <div className="flex justify-between font-semibold border-t border-border pt-1.5"><span>Total</span><span className="tabular-nums">{inr(n.TotalAmount)}</span></div>
            <div className="text-[0.6875rem] text-muted-foreground pt-1">Place of supply: {n.ProjectState || n.CompanyState || "where the property is"} · HSN/SAC {n.HsnCode || "—"}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1.5">
            <h3 className="text-sm font-semibold mb-1">Where it comes from</h3>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Against</span><span className="text-right">{n.AgainstRef || "—"}{n.AgainstDate ? ` · ${day(n.AgainstDate)}` : ""}</span></div>
            {n.RefundNo ? (<>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Refund</span><span>{n.RefundNo} · paid {day(n.RefundPaidAt)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Refund paid</span><span className="tabular-nums">{inr(n.RefundNet)}</span></div>
            </>) : (<>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Why</span><span>{REASON_LABEL[n.ReasonType] || "—"}</span></div>
              {Number(n.MovedToAccount) > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground">Moved to account</span><span className="tabular-nums">{inr(n.MovedToAccount)}</span></div>}
            </>)}
            {Number(n.RefundKept) > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground">Kept as charges</span><span className="tabular-nums">{inr(n.RefundKept)} <span className="text-muted-foreground">(no credit note; GST stays)</span></span></div>}
            {n.RefundReason && <div className="text-muted-foreground pt-1">“{n.RefundReason}”</div>}
            {k === "invoice" && <div className="pt-1">{deadlineChip(n)}</div>}
          </div>
          {(n.siblings || []).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-xs">
              <h3 className="text-sm font-semibold mb-2">Same refund</h3>
              <ul className="space-y-1.5">
                {n.siblings.map((x: any) => (
                  <li key={x.Id}><Link to={`?id=${x.Id}`} className="flex justify-between gap-2 hover:underline">
                    <span>{KIND[kindOf(x)].short} <span className="font-mono text-muted-foreground">{x.DocNo || ""}</span></span><span className="tabular-nums">{inr(x.TotalAmount)}</span>
                  </Link></li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1">
            <h3 className="text-sm font-semibold mb-1">History</h3>
            <div>{n.Source === "Adjustment" ? "Raised" : "Issued"} {day(n.CreatedAt)}{n.CreatedBy ? ` by ${n.CreatedBy}` : ""}{n.ReplacesNo ? ` — replaces ${n.ReplacesNo}` : ""}</div>
            {n.ApprovedAt && <div>Approved and issued {day(n.ApprovedAt)}</div>}
            {n.CancelRequestedAt && <div>Cancellation asked {day(n.CancelRequestedAt)} — {n.CancelRequestReason}{n.CancelApprovalStatus ? ` (${n.CancelApprovalStatus === "Pending" ? "waiting" : n.CancelApprovalStatus.toLowerCase()})` : ""}</div>}
            {n.CancelledAt && <div className="text-red-600">Cancelled {day(n.CancelledAt)}{n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}</div>}
            {n.ReplacedByNo && <div>Replaced by {n.ReplacedByNo}</div>}
          </div>
        </aside>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ask to cancel {n.DocNo || "this certificate"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{n.RefundNo ? `Every credit note of refund ${n.RefundNo} is cancelled together (they were worked out as one split); you can re-issue afterwards.` : "The booking value, the milestone and the customer's account go back as they were — only while the credit it gave hasn't been used or refunded."} A second person approves it. The number stays in the series; if it is already in a filed GST return, correct it there too.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is it being cancelled?" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCancelOpen(false)} className="h-9 px-4 rounded-lg border border-border hover:bg-muted">Keep it</button>
              <button onClick={doCancel} disabled={busy || !reason.trim()} className="h-9 px-4 rounded-lg bg-red-600 text-white disabled:opacity-40">{busy ? "Sending…" : "Ask to cancel"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PendingList({ canEdit, onIssued }: { canEdit: boolean; onIssued: (firstId?: number) => void }) {
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ["crm-credit-notes-pending"], queryFn: () => getJson(`${API}/gst-notes/pending`) });
  const [busy, setBusy] = useState<number | null>(null);
  const issue = async (refundId: number, re: boolean) => {
    setBusy(refundId);
    try {
      const out = await getJson(`${API}/${refundId}/gst-notes${re ? "/reissue" : ""}`, { method: "POST" });
      toast.success("Credit note issued");
      onIssued(Array.isArray(out) ? out.find((x: any) => x.Status !== "Cancelled")?.Id : undefined);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  if (isLoading) return <p className="text-sm text-muted-foreground p-6">Loading…</p>;
  if (!data.length) return <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><CheckCircle2 size={18} className="mx-auto mb-2 text-green-600" />Every paid refund that carried GST has its credit note.</div>;
  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border">
      <p className="p-4 text-xs text-muted-foreground">Paid refunds on bookings that were charged GST, without a live credit note — paid before credit notes existed, or their credit note was cancelled.</p>
      {data.map((r) => (
        <div key={r.RefundId} className="p-4 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex-1 min-w-48">
            <div className="font-medium">{r.CustomerName} <span className="font-normal text-muted-foreground">· {r.Property} · {r.ProjectName || ""}</span></div>
            <div className="text-xs text-muted-foreground">{r.RefundNo} · paid {day(r.PaidAt)} · {r.SourceType}{r.CancelledCount ? " · earlier credit note cancelled" : ""}</div>
          </div>
          <div className="tabular-nums">{inr(r.NetAmount)}</div>
          {canEdit && <button onClick={() => issue(r.RefundId, !!r.CancelledCount)} disabled={busy === r.RefundId} className="h-8 px-3 text-xs rounded-lg btn-module text-white disabled:opacity-40">{busy === r.RefundId ? "Issuing…" : r.CancelledCount ? "Re-issue" : "Issue credit note"}</button>}
        </div>
      ))}
    </div>
  );
}

const CrmCreditNotes: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-refunds");
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("id") ? Number(sp.get("id")) : null;
  const [tab, setTab] = useState<Tab>("all");
  const [period, setPeriod] = useState("fy");
  const P = periods();
  const [custom, setCustom] = useState<[string, string]>(P.month);
  const [from, to] = period === "custom" ? custom : P[period];
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data = [], isLoading, isFetching, dataUpdatedAt } = useQuery<any[]>({
    queryKey: ["crm-gst-notes", from, to],
    queryFn: () => getJson(`${API}/gst-notes?from=${from}&to=${to}`),
  });
  const { data: pending = [] } = useQuery<any[]>({ queryKey: ["crm-credit-notes-pending"], queryFn: () => getJson(`${API}/gst-notes/pending`) });
  const reload = () => { qc.invalidateQueries({ queryKey: ["crm-gst-notes"] }); qc.invalidateQueries({ queryKey: ["crm-credit-notes-pending"] }); qc.invalidateQueries({ queryKey: ["crm-credit-note"] }); };

  // ?refundId= opens that refund's first live credit note.
  const refundParam = sp.get("refundId");
  const { data: refundNotes } = useQuery<any[]>({ queryKey: ["crm-refund-gst-notes", refundParam], queryFn: () => getJson(`${API}/${refundParam}/gst-notes`), enabled: !!refundParam });
  useEffect(() => {
    if (!refundParam || !refundNotes) return;
    const first = refundNotes.find((x) => x.Status !== "Cancelled") || refundNotes[0];
    setSp((p) => { p.delete("refundId"); if (first) p.set("id", String(first.Id)); return p; }, { replace: true });
    if (!first) setTab("pending");
  }, [refundParam, refundNotes, setSp]);

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return data.filter((n) => (tab === "all" || tab === "pending" ? true : kindOf(n) === tab))
      .filter((n) => !t || [n.DocNo, n.CustomerName, n.Property, n.BookingNo, n.RefundNo, n.AgainstRef].some((v) => String(v || "").toLowerCase().includes(t)));
  }, [data, tab, search]);
  const sum = (k: Kind, f = "GstAmount") => data.filter((n) => kindOf(n) === k).reduce((s, n) => s + Number(n[f] || 0), 0);
  const count = (k: Kind) => data.filter((n) => kindOf(n) === k).length;
  const dueSoon = data.filter((n) => kindOf(n) === "invoice" && n.DeadlineDate && (new Date(n.DeadlineDate).getTime() - Date.now()) / 864e5 <= 30 && new Date(n.DeadlineDate).getTime() >= Date.now()).length;
  const pick = (id: number) => setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });

  const exportXlsx = async () => {
    const live = data.filter((n) => ["invoice", "advance"].includes(kindOf(n)));
    const norm = (x: any) => String(x || "").trim().toLowerCase();
    const split = (n: any) => {
      const same = !n.ProjectState || !n.CompanyState || norm(n.ProjectState) === norm(n.CompanyState);
      const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
      return same ? [half, Number(n.GstAmount) - half, 0] : [0, 0, Number(n.GstAmount)];
    };
    const H = (v: string): XlsxCell => ({ v, s: "header" });
    const detail: XlsxCell[][] = [["Type", "No.", "Date", "Status", "Customer", "Property", "Booking", "Against", "Against date", "HSN/SAC", "Rate %", "Taxable value", "CGST", "SGST", "IGST", "Total", "Declare by", "Refund", "Cancelled reason"].map(H),
      ...data.filter((n) => kindOf(n) !== "request").map((n) => { const [c, s, i] = split(n); return [KIND[kindOf(n)].label, n.DocNo || "", String(n.DocDate).slice(0, 10), n.Status, n.CustomerName || "", n.Property, n.BookingNo, n.AgainstRef || "", n.AgainstDate ? String(n.AgainstDate).slice(0, 10) : "", n.HsnCode || "", n.GstRate != null ? Number(n.GstRate) : "", Number(n.TaxableValue), c, s, i, Number(n.TotalAmount), n.DeadlineDate ? String(n.DeadlineDate).slice(0, 10) : "", n.RefundNo, n.CancelReason || ""]; })];
    const groups = new Map<string, number[]>();
    for (const n of live) {
      const key = `${kindOf(n) === "invoice" ? "Credit notes on invoices (GSTR-1 credit/debit notes)" : "Refund vouchers on advances (GSTR-1 advance adjustment)"}|${Number(n.GstRate || 0)}`;
      const g = groups.get(key) || [0, 0, 0, 0, 0, 0];
      const [c, s, i] = split(n);
      groups.set(key, [g[0] + 1, g[1] + Number(n.TaxableValue), g[2] + c, g[3] + s, g[4] + i, g[5] + Number(n.TotalAmount)]);
    }
    const summary: XlsxCell[][] = [[{ v: `Credit notes ${from} to ${to} — cancelled and past-deadline ones excluded`, s: "title" }], [],
      ["Where it goes", "Rate %", "Documents", "Taxable value", "CGST", "SGST", "IGST", "Total"].map(H),
      ...[...groups.entries()].map(([k, g]) => { const [where, rate] = k.split("|"); return [where, Number(rate), g[0], ...g.slice(1).map((x) => Math.round(x * 100) / 100)]; })];
    downloadBlob(await buildWorkbook([
      { name: "GSTR-1 summary", rows: summary, widths: [52, 8, 10, 16, 14, 14, 14, 16] },
      { name: "Credit notes", rows: detail, widths: [34, 16, 12, 11, 24, 18, 16, 22, 12, 10, 8, 14, 12, 12, 12, 14, 12, 16, 30], freezeBelowRow: 2 },
    ]), `Credit-notes-${from}-to-${to}.xlsx`);
  };

  const kpi = (label: string, value: string, sub: string, icon: React.ReactNode, onClick?: () => void, tone = "") => (
    <button onClick={onClick} className={`text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      <div className="text-[0.6875rem] text-muted-foreground">{sub}</div>
    </button>
  );

  return (
    <CrmShell title="Credit Notes" subtitle="GST credit notes for money given back to customers — issued with each refund"
      action={<div className="flex items-center gap-2">
        <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={reload} />
        {rights.canCreate && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-3 py-1.5 rounded-lg btn-module"><Plus size={13} />New credit note</button>}
        <button onClick={exportXlsx} disabled={!data.length} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-40"><FileDown size={13} />Excel for GST return</button>
      </div>}>
      <Breadcrumbs items={["CRM", "Finance", "Credit Notes"]} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {Object.keys(PERIOD_LABEL).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${period === p ? "btn-module text-white border-transparent" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}>{PERIOD_LABEL[p]}</button>
        ))}
        {period === "custom" && (<>
          <input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} className="h-8 px-2 text-xs border border-border rounded-lg bg-background" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} className="h-8 px-2 text-xs border border-border rounded-lg bg-background" />
        </>)}
        <span className="text-xs text-muted-foreground ml-auto">{day(from)} – {day(to)}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {kpi("On invoices", inr(sum("invoice")), `GST reduced · ${count("invoice")} note${count("invoice") === 1 ? "" : "s"}${dueSoon ? ` · ${dueSoon} due within 30 days` : ""}`, <FileText size={13} />, () => setTab("invoice"))}
        {kpi("On advances", inr(sum("advance")), `GST on advances given back · ${count("advance")}`, <FileText size={13} />, () => setTab("advance"))}
        {kpi("Past deadline", inr(sum("barred")), `GST the buyer claims · ${count("barred")}`, <AlertTriangle size={13} />, () => setTab("barred"))}
        {kpi("To issue", String(pending.length), pending.length ? "paid refunds without a credit note" : "nothing waiting", <Hourglass size={13} />, () => setTab("pending"), pending.length ? "ring-1 ring-amber-300 dark:ring-amber-800" : "")}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {TABS.map(([k, l]) => {
          const n = k === "pending" ? pending.length : k === "all" ? data.length : count(k as Kind);
          if (k === "request" && !n) return null;
          return <button key={k} onClick={() => setTab(k)} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${tab === k ? "btn-module text-white border-transparent" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}>{l}{n ? ` · ${n}` : ""}</button>;
        })}
      </div>

      {tab === "pending" ? <PendingList canEdit={rights.canEdit} onIssued={(id) => { reload(); if (id) { setTab("all"); pick(id); } }} /> : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="No., customer, property, refund, invoice…"
                className="w-full h-9 pl-8 pr-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {isLoading ? <p className="text-xs text-muted-foreground p-3">Loading…</p>
              : !list.length ? <p className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border">No credit notes here for {PERIOD_LABEL[period].toLowerCase()}. They are issued when a refund's payout is approved.</p>
              : (
                <div className="space-y-3 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto lg:pr-1">
                  {monthGroups(list).map(([month, rows]) => (
                  <section key={month}>
                    <div className="sticky top-0 z-[1] bg-background/95 backdrop-blur flex items-baseline justify-between px-1 py-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                      <span>{month}</span>
                      <span className="tabular-nums normal-case tracking-normal">{rows.length} · GST {inr(rows.filter((x) => ["invoice", "advance"].includes(kindOf(x))).reduce((s2, x) => s2 + Number(x.GstAmount || 0), 0))}</span>
                    </div>
                <ul className="space-y-2">
                  {rows.map((n) => {
                    const k = kindOf(n);
                    return (
                      <li key={n.Id}>
                        <button onClick={() => pick(n.Id)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selected === n.Id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-semibold font-mono truncate ${k === "cancelled" ? "line-through opacity-60" : ""}`}>{n.DocNo || (k === "request" ? REQ_LABEL[n.Status] : "Certificate")}</span>
                            <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${KIND[k].cls}`}>{KIND[k].short}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-xs truncate">{n.CustomerName}</span>
                            <span className="text-xs font-semibold tabular-nums shrink-0">{inr(n.TotalAmount)}</span>
                          </div>
                          <div className="text-[0.6875rem] text-muted-foreground mt-0.5 truncate">{n.Property} · {day(n.DocDate)} · {n.AgainstRef || n.RefundNo}</div>
                          <div className="text-[0.6875rem] mt-0.5 flex flex-wrap gap-x-2">{deadlineChip(n)}{n.CancelApprovalStatus === "Pending" && <span className="text-red-600">cancellation asked</span>}{n.Source === "Adjustment" && k !== "request" && <span className="text-muted-foreground">invoice reduced</span>}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                  </section>
                  ))}
                </div>
              )}
          </aside>
          <main className="min-w-0">
            {selected ? <Detail key={selected} id={selected} canEdit={rights.canEdit} onChanged={reload} />
              : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Choose a credit note to see it, download or print it.</div>}
          </main>
        </div>
      )}
      {creating && <NewCreditNoteDialog onClose={() => setCreating(false)} onCreated={(nid) => { setCreating(false); reload(); setTab("all"); pick(nid); }} />}
    </CrmShell>
  );
};

/** List rows by month of the document date, newest first. */
function monthGroups(rows: any[]): [string, any[]][] {
  const m = new Map<string, any[]>();
  for (const r of rows) {
    const k = new Date(r.DocDate).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()];
}

export default CrmCreditNotes;
