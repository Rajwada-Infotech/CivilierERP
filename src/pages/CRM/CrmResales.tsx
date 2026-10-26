import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ArrowRightLeft, Building2, Plus, RefreshCw, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { localDay } from "./salesDeed/config";

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
// Both start as a draft and go to the Approval Inbox through "Send for approval"
// on the case, once the steps before it are done.

const fmt = (n: any) => (n == null || n === "" ? "—" : fmtRupees(Number(n)));

interface Deal {
  Id: number; Kind: "Resale" | "BuyBack" | null; BookingIds: string | null;
  PlotName: string | null; PlotNo: string | null; UnitName: string | null;
  FromBookingNo: string | null; FromCustomerName: string | null; ToCustomerName: string | null;
  ResaleDate: string | null; AgreedValue: number | null; OriginalValue: number | null; PaidAtTransfer: number | null;
  DeveloperFeeAmount: number | null; DeveloperFeeGstAmount: number | null;
  TdsAmount: number | null; BuyBackGstAmount: number | null; StampDutyAmount: number | null;
  Status: string; RejectionNote: string | null; Notes: string | null; ProjectId: number | null; PayoutNewPaymentId: number | null;
  StageLabel?: string | null; StageNo?: number | null; StageCount?: number | null; StageTodo?: number;
}
interface Holding {
  BookingId: number; BookingIds: number[]; BookingNos: string; UnitNo: string; Kind: string;
  ProjectName: string | null; BlockName: string | null; CustomerId: number; CustomerName: string | null; Mobile: string | null;
  TotalValue: number; Paid: number; OpenDeal: { Id: number; Kind: string; Status: string } | null; Conveyed?: boolean;
}

const getJson = async (url: string) => {
  const r = await fetchWithAuth(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
  return r.json();
};

const emptyForm = () => ({ Kind: "Resale" as "Resale" | "BuyBack", FromBookingId: "", ToCustomerId: "", AgreedValue: "", DeveloperFeeAmount: "",
  TdsAmount: "", BuyBackGstAmount: "", StampDutyAmount: "", ResaleDate: localDay(), Notes: "" });

/** What a case's status reads as on the list. */
const statusText = (d: Deal) =>
  d.Status === "Draft" ? "Being prepared"
  : d.Status === "Rejected" ? "Sent back"
  : d.Status === "Pending" ? "Awaiting approval"
  : d.Status === "Approved" && d.Kind === "BuyBack" && d.PayoutNewPaymentId ? "With Finance"
  : d.Status;
const statusTone = (s: string): "done" | "waiting" | "stopped" | "none" =>
  s === "Completed" ? "done" : s === "Rejected" ? "stopped" : s === "Cancelled" ? "none" : "waiting";

type ResaleTab = "all" | "progress" | "resale" | "buyback" | "completed" | "cancelled";

const CrmResales: React.FC = () => {
  const rights = usePageRights("crm-resales");
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Cancelling a case is confirmed, with a reason (kept on the case).
  const [cancelFor, setCancelFor] = useState<Deal | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [tab, setTab] = useState<ResaleTab>("all");

  const { data: deals = [], isLoading, isError, error, isFetching, refetch } = useQuery<Deal[]>({ queryKey: ["crm-resales"], queryFn: () => getJson(API) });
  const { data: holdings = [] } = useQuery<Holding[]>({ queryKey: ["crm-resale-holdings"], queryFn: () => getJson(`${API}/holdings`), enabled: open });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["crm-customers-dropdown"], queryFn: () => getJson("/api/crm/customers"), enabled: open, staleTime: 60_000 });

  const groups = useMemo(() => ({
    all: deals,
    progress: deals.filter((d) => !["Completed", "Cancelled"].includes(d.Status)),
    resale: deals.filter((d) => d.Kind === "Resale"),
    buyback: deals.filter((d) => d.Kind === "BuyBack"),
    completed: deals.filter((d) => d.Status === "Completed"),
    cancelled: deals.filter((d) => d.Status === "Cancelled"),
  }), [deals]);
  const rows = groups[tab];

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

  const cancelCase = async () => {
    if (!cancelFor || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      const r = await fetchWithAuth(`${API}/${cancelFor.Id}/cancel`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: cancelReason.trim() }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not cancel it");
      toast.success(out.message || "Cancelled");
      if (out.ledgerWarning) toast.warning(out.ledgerWarning);
      setCancelFor(null);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setCancelling(false); }
  };

  const save = async () => {
    if (!form.FromBookingId) return toast.error("Choose the property that is changing hands");
    if (form.Kind === "Resale" && !form.ToCustomerId) return toast.error("Choose the new buyer");
    // The server needs the price for both kinds (it goes on the transfer); the form used to let a resale go without it.
    if (!(Number(form.AgreedValue) > 0)) return toast.error(form.Kind === "BuyBack" ? "Enter the agreed buy-back price" : "Enter the price the buyers agreed");
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/deal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not record it");
      toast.success(out.message || "Recorded");
      setOpen(false);
      setForm(emptyForm());
      refresh();
      if (out.id) nav(`/crm/resales/${out.id}`); // straight into its case
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const figures: { label: string; value: number; note: string; tab: ResaleTab }[] = [
    { label: "In progress", value: groups.progress.length, note: "Open cases", tab: "progress" },
    { label: "Resales", value: groups.resale.length, note: "To another buyer", tab: "resale" },
    { label: "Buy-backs", value: groups.buyback.length, note: "Bought back by us", tab: "buyback" },
    { label: "Completed", value: groups.completed.length, note: `${groups.cancelled.length} cancelled`, tab: "completed" },
  ];
  const TABS: { id: ResaleTab; label: string }[] = [
    { id: "all", label: "All" }, { id: "progress", label: "In progress" }, { id: "resale", label: "Resales" },
    { id: "buyback", label: "Buy-backs" }, { id: "completed", label: "Completed" }, { id: "cancelled", label: "Cancelled" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;

  return (
    <>
      <Breadcrumbs items={["CRM", "Resale", "Resale Cases"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Resale"
        title="Resale Cases"
        subtitle="A sold property passing to a new buyer (once the seller is clear, the buyer is set up, the fee is paid and the deed of assignment is registered), or bought back by us at an agreed price and returned to stock."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => { setForm(emptyForm()); setOpen(true); }} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New resale or buy-back</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setTab(x.tab)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)} className={tabClass(tab === t.id)} style={{ borderRight: RULE_SOFT }}>
                    {t.label} <span className="tabular-nums">{groups[t.id].length}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Type</th><th className={th}>Property</th><th className={th}>From → to</th>
                    <th className={th}>Money</th><th className={th}>Where it stands</th><th className={th}>Status</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-destructive">{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{deals.length ? "No case matches this filter." : "No resale or buy-back cases yet."}</td></tr>
                  ) : rows.map((d) => {
                    const live = !!d.BookingIds && !["Completed", "Cancelled"].includes(d.Status);
                    return (
                      <tr key={d.Id} onClick={() => { if (d.BookingIds) nav(`/crm/resales/${d.Id}`); }}
                        className={`align-top transition-colors ${d.BookingIds ? "cursor-pointer hover:bg-primary/5" : ""}`} style={{ borderBottom: RULE_SOFT }}>
                        <td className="!px-4 !py-3.5">
                          <span className="inline-flex items-center gap-1 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]">
                            {d.Kind === "BuyBack" ? <><Undo2 size={11} /> Buy-back</> : <><ArrowRightLeft size={11} /> Resale</>}
                          </span>
                        </td>
                        <td className="!px-4 !py-3.5">
                          <div className="font-medium leading-snug">{d.UnitName || d.PlotName || d.PlotNo || "—"}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{d.FromBookingNo}</div>
                        </td>
                        <td className="!px-4 !py-3.5 text-xs leading-relaxed">
                          {d.FromCustomerName || "—"}<ArrowRightLeft size={10} className="inline mx-1 text-muted-foreground" />{d.Kind === "BuyBack" ? "Us (buy-back)" : d.ToCustomerName || "—"}
                        </td>
                        <td className="!px-4 !py-3.5 text-xs space-y-1">
                          <div><span className="text-muted-foreground">Paid so far </span><span className="font-heading tabular-nums">{fmt(d.PaidAtTransfer ?? d.OriginalValue)}</span></div>
                          <div><span className="text-muted-foreground">{d.Kind === "BuyBack" ? "Buy-back " : "Agreed "}</span><span className="font-heading tabular-nums">{fmt(d.AgreedValue)}</span></div>
                          {d.Kind !== "BuyBack" && Number(d.DeveloperFeeAmount) > 0 && <div><span className="text-muted-foreground">Our fee </span><span className="font-heading tabular-nums">{fmt(d.DeveloperFeeAmount)}</span></div>}
                        </td>
                        <td className="!px-4 !py-3.5">
                          {!d.StageLabel || !d.StageCount ? <span className="text-xs text-muted-foreground">—</span> : (
                            <div className="min-w-[170px] space-y-1.5">
                              <div className="text-xs font-medium leading-snug"><span className="font-heading tabular-nums">Step {d.StageNo} of {d.StageCount}</span>: {d.StageLabel}</div>
                              <div className="h-1.5" style={{ border: RULE_SOFT }}>
                                <div className="h-full bg-foreground" style={{ width: `${Math.round(((d.StageNo! - 1) / d.StageCount) * 100)}%` }} />
                              </div>
                              {!!d.StageTodo && <div className="text-[0.625rem] text-muted-foreground">{d.StageTodo} thing{d.StageTodo === 1 ? "" : "s"} left</div>}
                            </div>
                          )}
                        </td>
                        <td className="!px-4 !py-3.5" title={d.RejectionNote || undefined}><SheetMark text={statusText(d)} tone={statusTone(d.Status)} /></td>
                        <td className="!px-4 !py-3.5">
                          <div className="flex gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                            {d.BookingIds && <button onClick={() => nav(`/crm/resales/${d.Id}`)} className={`${live ? KEY_INK : KEY_LINE} h-7 px-2`}>{live ? "Open case" : "View case"}</button>}
                            {live && rights.canEdit && !(d.Kind === "BuyBack" && d.PayoutNewPaymentId) && (
                              <button onClick={() => { setCancelFor(d); setCancelReason(""); }} className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}>Cancel</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">{form.Kind === "BuyBack" ? "Buy back a property" : "Resell a property"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="inline-flex items-stretch" style={{ border: RULE }} role="tablist">
                {(["Resale", "BuyBack"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={form.Kind === k} onClick={() => setForm((f) => ({ ...f, Kind: k }))}
                    className={tabClass(form.Kind === k)} style={{ borderRight: RULE_SOFT }}>
                    {k === "Resale" ? "Resale to another buyer" : "Buy-back by us"}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <label className={`block ${LBL}`}>Property</label>
                <SearchableSelect sheet
                  value={form.FromBookingId}
                  onChange={(v) => setForm((f) => ({ ...f, FromBookingId: v }))}
                  placeholder="Choose a sold property"
                  searchPlaceholder="Search unit, booking or owner…"
                  options={holdings.filter((h) => !h.OpenDeal && !h.Conveyed).map((h) => ({
                    value: String(h.BookingId),
                    label: [h.UnitNo, h.Kind, h.CustomerName, h.BookingNos, h.ProjectName].filter(Boolean).join(" · "),
                  }))}
                />
                {holding ? (
                  <div className="mt-2 px-3 py-2 text-xs grid grid-cols-2 gap-x-3 gap-y-1" style={{ border: RULE_SOFT }}>
                    <span className="col-span-2 flex items-center gap-1.5 font-medium"><Building2 size={12} /> {holding.UnitNo} · {holding.Kind}</span>
                    <span className="text-muted-foreground">Owner</span><span>{holding.CustomerName}</span>
                    <span className="text-muted-foreground">Price</span><span className="font-heading tabular-nums">{fmt(holding.TotalValue)}</span>
                    <span className="text-muted-foreground">Paid so far</span><span className="font-heading tabular-nums">{fmt(holding.Paid)}</span>
                    <span className="text-muted-foreground">Still due</span><span className="font-heading tabular-nums">{fmt(Math.max(0, holding.TotalValue - holding.Paid))}</span>
                  </div>
                ) : <p className="text-[0.6875rem] text-muted-foreground">Not listed? It has an open case, or its sale deed is registered — use Ownership Changes.</p>}
              </div>

              {form.Kind === "Resale" ? (
                <>
                  <div className="space-y-1">
                    <label className={`block ${LBL}`}>New buyer</label>
                    <SearchableSelect sheet
                      value={form.ToCustomerId}
                      onChange={(v) => setForm((f) => ({ ...f, ToCustomerId: v }))}
                      placeholder="Choose the new buyer"
                      searchPlaceholder="Search name, mobile or customer no…"
                      options={customers.filter((c: any) => !holding || c.Id !== holding.CustomerId).map((c: any) => ({
                        value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · "),
                      }))}
                    />
                    <p className="text-[0.6875rem] text-muted-foreground">Not listed? Add them in <a href="/crm/customers" target="_blank" rel="noreferrer" className="underline underline-offset-2">Customers</a> first.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>Price agreed between buyers *</label>
                      <input type="number" min={0} value={form.AgreedValue} onChange={(e) => setForm((f) => ({ ...f, AgreedValue: e.target.value }))} className={`${INP} tabular-nums`} placeholder="Goes on the transfer" />
                    </div>
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>Our transfer fee</label>
                      <input type="number" min={0} value={form.DeveloperFeeAmount} onChange={(e) => setForm((f) => ({ ...f, DeveloperFeeAmount: e.target.value }))} className={`${INP} tabular-nums`} placeholder="Paid by the new buyer" />
                      {feeGstQ.data && <p className="text-[0.6875rem] text-muted-foreground tabular-nums">+ GST {fmt(feeGstQ.data.gstAmount)} ({feeGstQ.data.rate}%)</p>}
                      {feeGstQ.error && <p className="text-[0.6875rem] text-destructive">{(feeGstQ.error as Error).message}</p>}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>Agreed buy-back price *</label>
                      <input type="number" min={0} value={form.AgreedValue} onChange={(e) => setForm((f) => ({ ...f, AgreedValue: e.target.value }))} className={`${INP} tabular-nums`} />
                      {premium != null && <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{premium >= 0 ? `${fmt(premium)} above what was paid` : `${fmt(-premium)} below what was paid`}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>TDS</label>
                      <input type="number" min={0} value={form.TdsAmount} onChange={(e) => setForm((f) => ({ ...f, TdsAmount: e.target.value }))} className={`${INP} tabular-nums`} />
                      {tdsHint && <p className="text-[0.6875rem] text-muted-foreground">₹50 lakh or more: 1% TDS (sec. 194-IA) — confirm with your CA</p>}
                    </div>
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>GST (as advised)</label>
                      <input type="number" min={0} value={form.BuyBackGstAmount} onChange={(e) => setForm((f) => ({ ...f, BuyBackGstAmount: e.target.value }))} className={`${INP} tabular-nums`} />
                    </div>
                    <div className="space-y-1">
                      <label className={`block ${LBL}`}>Stamp duty (as advised)</label>
                      <input type="number" min={0} value={form.StampDutyAmount} onChange={(e) => setForm((f) => ({ ...f, StampDutyAmount: e.target.value }))} className={`${INP} tabular-nums`} />
                    </div>
                  </div>
                  <p className="text-[0.6875rem] text-muted-foreground">Any unpaid milestones are cancelled; we pay only the agreed price. Earlier invoices stay as they are.</p>
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Date</label>
                  <DateInput value={form.ResaleDate} onChange={(e) => setForm((f) => ({ ...f, ResaleDate: e.target.value }))} className={INP} />
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Notes</label>
                  <input value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} className={INP} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
              <button onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : "Open case"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!cancelFor} onOpenChange={(o) => !o && setCancelFor(null)}>
          <DialogContent className="max-w-md rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Cancel {cancelFor?.Kind === "BuyBack" ? "buy-back" : "resale"} case #{cancelFor?.Id}?</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">The property stays with its current owner and the case stops. Its unsigned transfer deed is cancelled with it, and the buyer's draft application is closed. A signed or registered deed, a fee invoice or payment, or a payout with Finance has to be settled first — you'll be told which.</p>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Reason *</label>
                <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Why is it being cancelled?" className={TEXTAREA} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setCancelFor(null)} className={`${KEY_LINE} h-9 px-4`}>Keep it</button>
              <button disabled={!cancelReason.trim() || cancelling} onClick={cancelCase} className={`${KEY_RED} h-9 px-4`}>{cancelling ? "Cancelling…" : "Cancel the case"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmResales;
