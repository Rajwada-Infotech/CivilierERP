import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ArrowRightLeft, Building2, Info, Plus, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";

const API = "/api/crm/resales";

// Resale & Buy-back — any sold property (plot, villa with its plot, flat, shop)
// either passing to a new buyer or bought back by us.
//
// RESALE is an endorsement: the seller's booking itself passes to the new
// buyer, so what was paid stays credited to the property and the new buyer
// continues the remaining schedule. What the two buyers agree between
// themselves is theirs — never company revenue; only our transfer fee (paid
// by the new buyer) is.
// BUY-BACK is us buying the property back at an agreed price; Finance pays it
// and the property returns to stock to be sold again at a new price.
// Both go through the Approval Inbox (CRM head, then Finance).
const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900",
  Approved: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",
  Completed: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900",
  Cancelled: "text-muted-foreground bg-muted border-border",
  Rejected: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
};

const fmt = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const label = "text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5";
const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";

interface Deal {
  Id: number; Kind: "Resale" | "BuyBack" | null; BookingIds: string | null;
  PlotName: string | null; PlotNo: string | null; UnitName: string | null;
  FromBookingNo: string | null; FromCustomerName: string | null; ToCustomerName: string | null;
  ResaleDate: string | null; AgreedValue: number | null; OriginalValue: number | null; PaidAtTransfer: number | null;
  DeveloperFeeAmount: number | null; DeveloperFeeGstAmount: number | null;
  TdsAmount: number | null; BuyBackGstAmount: number | null; StampDutyAmount: number | null;
  Status: string; RejectionNote: string | null; Notes: string | null; ProjectId: number | null; PayoutNewPaymentId: number | null;
}
interface Holding {
  BookingId: number; BookingIds: number[]; BookingNos: string; UnitNo: string; Kind: string;
  ProjectName: string | null; BlockName: string | null; CustomerId: number; CustomerName: string | null; Mobile: string | null;
  TotalValue: number; Paid: number; OpenDeal: { Id: number; Kind: string; Status: string } | null;
}

const getJson = async (url: string) => {
  const r = await fetchWithAuth(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
  return r.json();
};

const EMPTY = { Kind: "Resale" as "Resale" | "BuyBack", FromBookingId: "", ToCustomerId: "", AgreedValue: "", DeveloperFeeAmount: "",
  TdsAmount: "", BuyBackGstAmount: "", StampDutyAmount: "", ResaleDate: new Date().toISOString().slice(0, 10), Notes: "" };

const CrmResales: React.FC = () => {
  const rights = usePageRights("crm-resales");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [paying, setPaying] = useState<Deal | null>(null);
  const [pay, setPay] = useState({ BankLHeadId: "", PaymentMode: "" });
  const { data: banks = [] } = useQuery<any[]>({
    queryKey: ["crm-project-banks", paying?.ProjectId],
    queryFn: () => getJson(`/api/crm/project-banks/for-project/${paying!.ProjectId}?excludeCash=1`),
    enabled: !!paying?.ProjectId,
  });

  const { data: deals = [], isLoading, dataUpdatedAt, isFetching } = useQuery<Deal[]>({ queryKey: ["crm-resales"], queryFn: () => getJson(API) });
  const { data: holdings = [] } = useQuery<Holding[]>({ queryKey: ["crm-resale-holdings"], queryFn: () => getJson(`${API}/holdings`), enabled: open });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["crm-customers-dropdown"], queryFn: () => getJson("/api/crm/customers"), enabled: open, staleTime: 60_000 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-resales"] });
    qc.invalidateQueries({ queryKey: ["crm-resale-holdings"] });
  };
  const holding = useMemo(() => holdings.find((h) => String(h.BookingId) === form.FromBookingId), [holdings, form.FromBookingId]);
  const feeGstQ = useQuery<{ gstAmount: number; rate: number }>({
    queryKey: ["crm-resale-fee-gst", form.DeveloperFeeAmount, holding?.Kind],
    queryFn: () => getJson(`${API}/fee-gst?amount=${encodeURIComponent(form.DeveloperFeeAmount)}&plot=${holding?.Kind === "Plot" ? 1 : 0}`),
    enabled: open && form.Kind === "Resale" && Number(form.DeveloperFeeAmount) > 0,
  });
  const premium = form.Kind === "BuyBack" && holding && Number(form.AgreedValue) > 0 ? Number(form.AgreedValue) - Number(holding.Paid || 0) : null;
  const tdsHint = form.Kind === "BuyBack" && Number(form.AgreedValue) >= 5000000;

  const act = async (d: Deal, path: string, body?: object, done?: string) => {
    try {
      const r = await fetchWithAuth(`${API}/${d.Id}/${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not do that");
      toast.success(out.message || done || "Done");
      if (out.ledgerWarning) toast.warning(out.ledgerWarning);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const save = async () => {
    if (!form.FromBookingId) return toast.error("Choose the property that is changing hands");
    if (form.Kind === "Resale" && !form.ToCustomerId) return toast.error("Choose the new buyer");
    if (form.Kind === "BuyBack" && !(Number(form.AgreedValue) > 0)) return toast.error("Enter the agreed buy-back price");
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/deal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not record it");
      toast.success(out.message || "Recorded");
      setOpen(false);
      setForm({ ...EMPTY });
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const columns: ColumnDef<Deal>[] = [
    {
      header: "Type", id: "kind",
      cell: ({ row }) => row.original.Kind === "BuyBack"
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300"><Undo2 size={11} /> Buy-back</span>
        : <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><ArrowRightLeft size={11} /> Resale</span>,
    },
    { header: "Property", id: "prop", cell: ({ row }) => <span className="font-medium text-foreground">{row.original.UnitName || row.original.PlotName || row.original.PlotNo || "—"}<span className="block text-[0.6875rem] font-normal text-muted-foreground">{row.original.FromBookingNo}</span></span> },
    { header: "From → To", id: "parties", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.FromCustomerName || "—"}<ArrowRightLeft size={10} className="inline mx-1" />{row.original.Kind === "BuyBack" ? "Us (buy-back)" : row.original.ToCustomerName || "—"}</span> },
    { header: "Paid by seller", id: "paid", cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.PaidAtTransfer ?? row.original.OriginalValue)}</span> },
    { header: "Agreed price", accessorKey: "AgreedValue", cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.AgreedValue)}</span> },
    { header: "Our fee", accessorKey: "DeveloperFeeAmount", cell: ({ row }) => <span className="tabular-nums">{row.original.Kind === "BuyBack" ? "—" : fmt(row.original.DeveloperFeeAmount)}</span> },
    {
      header: "Status", accessorKey: "Status",
      cell: ({ row }) => (
        <span title={row.original.RejectionNote || undefined} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[row.original.Status] || ""}`}>
          {row.original.Status === "Pending" ? "Awaiting approval"
            : row.original.Status === "Approved" && row.original.Kind === "BuyBack" && row.original.PayoutNewPaymentId ? "With Finance"
            : row.original.Status}
        </span>
      ),
    },
    {
      header: "", id: "actions",
      cell: ({ row }) => {
        const d = row.original;
        if (!rights.canEdit || !d.BookingIds || ["Completed", "Cancelled", "Rejected"].includes(d.Status)) return null;
        return (
          <div className="flex gap-1.5 justify-end">
            {d.Status === "Approved" && d.Kind === "Resale" && (
              <button onClick={() => { if (window.confirm(`Pass ${d.UnitName || d.PlotName} to ${d.ToCustomerName}? The booking, its schedule and the ${fmt(d.OriginalValue)} paid move to the new buyer.`)) act(d, "transfer"); }}
                className="px-2 h-7 text-[0.6875rem] rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">
                Transfer to buyer
              </button>
            )}
            {d.Status === "Approved" && d.Kind === "BuyBack" && !d.PayoutNewPaymentId && (
              <button onClick={() => { setPay({ BankLHeadId: "", PaymentMode: "" }); setPaying(d); }}
                className="px-2 h-7 text-[0.6875rem] rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">
                Send to Finance
              </button>
            )}
            {!(d.Kind === "BuyBack" && d.PayoutNewPaymentId) && <button onClick={() => act(d, "cancel", undefined, "Cancelled")}
              className="px-2 h-7 text-[0.6875rem] rounded-lg border border-border text-muted-foreground hover:bg-muted">
              Cancel
            </button>}
          </div>
        );
      },
    },
  ];

  return (
    <CrmShell title="Resale & Buy-back" subtitle="A sold property passing to a new buyer, or bought back by us">
      <Breadcrumbs items={["CRM", "Resale & Buy-back"]} />

      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 flex items-start gap-2 mb-3">
        <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Resale:</span> the booking passes to the new buyer with everything paid so far; they continue the schedule. The price the buyers agree is theirs, not company revenue — only <span className="font-medium text-foreground">our fee</span> (paid by the new buyer) is.{" "}
          <span className="font-medium text-foreground">Buy-back:</span> we pay the agreed price through Finance and the property returns to stock. Both are approved in the Approval Inbox — CRM head, then Finance.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refresh} />
        {rights.canCreate && (
          <button onClick={() => { setForm({ ...EMPTY }); setOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90">
            <Plus size={14} /> New resale or buy-back
          </button>
        )}
      </div>

      <DataTable columns={columns} data={deals} loading={isLoading} />

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent accent="crm" className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading">{form.Kind === "BuyBack" ? "Buy back a property" : "Resell a property"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30" role="tablist">
              {(["Resale", "BuyBack"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={form.Kind === k} onClick={() => setForm((f) => ({ ...f, Kind: k }))}
                  className={`px-3 h-8 text-xs font-semibold rounded-md ${form.Kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {k === "Resale" ? "Resale to another buyer" : "Buy-back by us"}
                </button>
              ))}
            </div>

            <div>
              <label className={label}>Property</label>
              <SearchableSelect
                value={form.FromBookingId}
                onChange={(v) => setForm((f) => ({ ...f, FromBookingId: v }))}
                placeholder="Choose a sold property"
                searchPlaceholder="Search unit, booking or owner…"
                options={holdings.filter((h) => !h.OpenDeal).map((h) => ({
                  value: String(h.BookingId),
                  label: [h.UnitNo, h.Kind, h.CustomerName, h.BookingNos, h.ProjectName].filter(Boolean).join(" · "),
                }))}
              />
              {holding && (
                <div className="mt-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span className="col-span-2 flex items-center gap-1.5 font-medium text-foreground"><Building2 size={12} /> {holding.UnitNo} · {holding.Kind}</span>
                  <span className="text-muted-foreground">Owner</span><span className="text-foreground">{holding.CustomerName}</span>
                  <span className="text-muted-foreground">Price</span><span className="tabular-nums">{fmt(holding.TotalValue)}</span>
                  <span className="text-muted-foreground">Paid so far</span><span className="tabular-nums">{fmt(holding.Paid)}</span>
                  <span className="text-muted-foreground">Still due</span><span className="tabular-nums">{fmt(Math.max(0, holding.TotalValue - holding.Paid))}</span>
                </div>
              )}
            </div>

            {form.Kind === "Resale" ? (
              <>
                <div>
                  <label className={label}>New buyer</label>
                  <SearchableSelect
                    value={form.ToCustomerId}
                    onChange={(v) => setForm((f) => ({ ...f, ToCustomerId: v }))}
                    placeholder="Choose the new buyer"
                    searchPlaceholder="Search name, mobile or customer no…"
                    options={customers.filter((c: any) => !holding || c.Id !== holding.CustomerId).map((c: any) => ({
                      value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · "),
                    }))}
                  />
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground">Not listed? Add them in <a href="/crm/customers" target="_blank" rel="noreferrer" className="text-primary hover:underline">Customers</a> first.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Price agreed between buyers</label>
                    <input type="number" min={0} value={form.AgreedValue} onChange={(e) => setForm((f) => ({ ...f, AgreedValue: e.target.value }))} className={input} placeholder="For the record" />
                  </div>
                  <div>
                    <label className={label}>Our transfer fee</label>
                    <input type="number" min={0} value={form.DeveloperFeeAmount} onChange={(e) => setForm((f) => ({ ...f, DeveloperFeeAmount: e.target.value }))} className={input} placeholder="Paid by the new buyer" />
                    {feeGstQ.data && <p className="mt-1 text-[0.6875rem] text-muted-foreground">+ GST {fmt(feeGstQ.data.gstAmount)} ({feeGstQ.data.rate}%)</p>}
                    {feeGstQ.error && <p className="mt-1 text-[0.6875rem] text-red-600">{(feeGstQ.error as Error).message}</p>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Agreed buy-back price</label>
                    <input type="number" min={0} value={form.AgreedValue} onChange={(e) => setForm((f) => ({ ...f, AgreedValue: e.target.value }))} className={input} />
                    {premium != null && <p className="mt-1 text-[0.6875rem] text-muted-foreground">{premium >= 0 ? `${fmt(premium)} above what was paid` : `${fmt(-premium)} below what was paid`}</p>}
                  </div>
                  <div>
                    <label className={label}>TDS</label>
                    <input type="number" min={0} value={form.TdsAmount} onChange={(e) => setForm((f) => ({ ...f, TdsAmount: e.target.value }))} className={input} />
                    {tdsHint && <p className="mt-1 text-[0.6875rem] text-muted-foreground">₹50 lakh or more: 1% TDS (sec. 194-IA) — confirm with your CA</p>}
                  </div>
                  <div>
                    <label className={label}>GST (as advised)</label>
                    <input type="number" min={0} value={form.BuyBackGstAmount} onChange={(e) => setForm((f) => ({ ...f, BuyBackGstAmount: e.target.value }))} className={input} />
                  </div>
                  <div>
                    <label className={label}>Stamp duty (as advised)</label>
                    <input type="number" min={0} value={form.StampDutyAmount} onChange={(e) => setForm((f) => ({ ...f, StampDutyAmount: e.target.value }))} className={input} />
                  </div>
                </div>
                <p className="text-[0.6875rem] text-muted-foreground">Any unpaid milestones are cancelled; we pay only the agreed price. Earlier invoices stay as they are.</p>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Date</label>
                <DateInput value={form.ResaleDate} onChange={(e) => setForm((f) => ({ ...f, ResaleDate: e.target.value }))} className={input} />
              </div>
              <div>
                <label className={label}>Notes</label>
                <input value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} className={input} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="px-3 h-9 text-sm rounded-lg border border-border hover:bg-muted">Close</button>
              <button onClick={save} disabled={saving} className="px-4 h-9 text-sm rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-60">
                {saving ? "Saving…" : "Send for approval"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null); }}>
        <DialogContent accent="crm" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Send buy-back to Finance</DialogTitle>
          </DialogHeader>
          {paying && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Property</span><span className="text-foreground">{paying.UnitName || paying.PlotName}</span>
                <span className="text-muted-foreground">Seller</span><span className="text-foreground">{paying.FromCustomerName}</span>
                <span className="text-muted-foreground">Agreed price</span><span className="tabular-nums">{fmt(paying.AgreedValue)}</span>
                <span className="text-muted-foreground">TDS</span><span className="tabular-nums">{fmt(paying.TdsAmount || 0)}</span>
                <span className="text-muted-foreground">Seller receives</span><span className="tabular-nums font-medium">{fmt(Number(paying.AgreedValue || 0) - Number(paying.TdsAmount || 0))}</span>
              </div>
              <div>
                <label className={label}>Pay from</label>
                <select value={pay.BankLHeadId} onChange={(e) => setPay((p) => ({ ...p, BankLHeadId: e.target.value }))} className={input}>
                  <option value="">Choose the company bank</option>
                  {banks.map((b: any) => (
                    <option key={b.BId} value={b.BId}>{[b.BName, b.BBranch, b.BAccountLast4 ? `····${b.BAccountLast4}` : null].filter(Boolean).join(" · ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Payment mode (optional)</label>
                <select value={pay.PaymentMode} onChange={(e) => setPay((p) => ({ ...p, PaymentMode: e.target.value }))} className={input}>
                  <option value="">Finance will set it</option>
                  {["NEFT", "RTGS", "IMPS", "UPI", "Cheque"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground">When Finance approves the voucher in Payments, the booking closes and the property returns to stock.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPaying(null)} className="px-3 h-9 text-sm rounded-lg border border-border hover:bg-muted">Close</button>
                <button disabled={!pay.BankLHeadId} onClick={async () => { await act(paying, "send-to-finance", pay, "Sent to Finance"); setPaying(null); }}
                  className="px-4 h-9 text-sm rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-60">
                  Send to Finance
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmResales;
