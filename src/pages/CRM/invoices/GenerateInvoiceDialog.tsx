// Generate an invoice for a booking. Pick the booking (search, narrowed by company / project / block), see its
// payment plan with each milestone's billing and payment state, then invoice one milestone, tick several to
// generate together, or raise an on-account / maintenance / other invoice. Numbering: the standard series, a
// custom prefix that still counts up, or one exact number. A Non-Invoice customer gets one final invoice.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { CrmStatus } from "@/constants/crmStatuses";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SheetMark } from "@/components/sheet/Sheet";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "../customers/config";
import {
  BKG_API, DIALOG, fetchBookingDetail, fetchBookingsForPicker, fetchOnAccount, fmtDate, fmtMoney, getMilestoneInsight,
} from "./config";

// A milestone's payment state — a separate question from billing, so labelled "Payment".
function PaymentMark({ m }: { m: any }) {
  if (m.Status === CrmStatus.PAID) return <SheetMark text="Payment: paid" tone="done" />;
  if (m.Status === "Waived") return <SheetMark text="Payment: waived" tone="none" />;
  if (Number(m.AmountPaid) > 0) return <SheetMark text="Payment: partial" tone="waiting" />;
  return <SheetMark text="Payment: pending" tone="waiting" />;
}

export function GenerateInvoiceDialog({ initialBookingId, onClose, onGenerated }: {
  initialBookingId: number | null; onClose: () => void; onGenerated: (bookingId: number) => void;
}) {
  const [bookingId, setBookingId] = useState<number | null>(initialBookingId);
  const [bookingSearch, setBookingSearch] = useState("");
  // Company -> Project -> Block, built from the one bookings list (each booking carries its ids and names).
  const [hCompanyId, setHCompanyId] = useState("");
  const [hProjectId, setHProjectId] = useState("");
  const [hBlockId, setHBlockId] = useState("");
  const [form, setForm] = useState({
    InvoiceType: "Milestone", MilestoneId: "", OnAccountPaymentId: "", Amount: "", InvoiceDate: new Date().toLocaleDateString("en-CA"), Description: "",
    NumberMode: "auto" as "auto" | "prefix" | "custom", InvoicePrefix: "", CustomInvoiceNo: "",
  });
  const [saving, setSaving] = useState(false);
  // True only when the type was switched by the eligibility effect below, never by the user — it explains why.
  const [autoSelected, setAutoSelected] = useState(false);
  // A Maintenance / Other invoice has no link to any milestone or receipt; while the plan still has money
  // outstanding, Generate stays shut until staff confirm it isn't meant to settle that.
  const [ackUnlinked, setAckUnlinked] = useState(false);
  // Ready milestones ticked to generate together, independent of the single choice.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery({
    queryKey: ["crm-bookings-for-invoice-picker"],
    queryFn: fetchBookingsForPicker,
    enabled: bookingId == null,
    staleTime: 60_000,
  });
  const { data: bookingDetail, isError: bookingError, error: bookingErr } = useQuery({
    queryKey: ["crm-invoice-gen-booking-detail", bookingId],
    queryFn: () => fetchBookingDetail(bookingId as number),
    enabled: bookingId != null,
  });
  const { data: onAccountData } = useQuery({
    queryKey: ["crm-invoice-gen-on-account", bookingId],
    queryFn: () => fetchOnAccount(bookingId as number),
    enabled: bookingId != null,
  });
  const { data: existingInvoices = [], refetch: refetchExisting } = useQuery({
    queryKey: ["crm-invoice-gen-existing", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`);
      return r.ok ? r.json() : [];
    },
    enabled: bookingId != null,
  });

  const booking = bookingDetail?.booking;
  const milestones: any[] = bookingDetail?.milestones || [];
  const eligibleMilestones = milestones.filter((m) => getMilestoneInsight(m, existingInvoices).tone === "ready");
  const eligibleOnAccount = (onAccountData?.payments || []).filter(
    (p: any) => p.InvoiceId == null && p.Status !== "Applied" && p.Status !== "PartiallyApplied" && !existingInvoices.some((inv: any) => inv.OnAccountPaymentId === p.Id && inv.Status !== "Void")
  );
  const outstandingMilestones = milestones.filter(
    (m) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && (Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)) > 0
  );
  const outstandingTotal = outstandingMilestones.reduce((s, m) => s + (Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)), 0);
  // Non-Invoice customers get ONE final invoice for the grand total once everything is paid.
  const isNonInvoice = bookingDetail?.customer?.InvoiceMode === "NonInvoice";
  const finalInvoice = (existingInvoices as any[]).find((inv) => inv.InvoiceType === "Final" && inv.Status !== "Void");
  const [finalBusy, setFinalBusy] = useState(false);
  const generateFinal = async () => {
    if (bookingId == null) return;
    setFinalBusy(true);
    try {
      const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices/final`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not generate the final invoice");
      toast.success(d.message || "Final invoice generated");
      await refetchExisting();
      onGenerated(bookingId as number);
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setFinalBusy(false); }
  };
  const showUnlinkedWarning = (form.InvoiceType === "Maintenance" || form.InvoiceType === "Other") && outstandingMilestones.length > 0;

  // Once eligibility is known, land on a type that has something to invoice.
  useEffect(() => {
    if (!booking) return;
    if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length > 0) {
      setForm((f) => ({ ...f, InvoiceType: "OnAccount" }));
      setAutoSelected(true);
    } else if (form.InvoiceType === "Milestone" && eligibleMilestones.length === 0 && eligibleOnAccount.length === 0) {
      setForm((f) => ({ ...f, InvoiceType: "Maintenance" }));
      setAutoSelected(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, eligibleMilestones.length, eligibleOnAccount.length]);

  function distinctBy(list: any[], idKey: string, nameKey: string) {
    const seen = new Map<string, string>();
    for (const b of list) {
      const id = b[idKey];
      if (id == null || seen.has(String(id))) continue;
      seen.set(String(id), b[nameKey] || `#${id}`);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }
  const hCompanies = useMemo(() => distinctBy(bookings, "CompanyId", "CompanyName"), [bookings]);
  const hProjectPool = useMemo(() => hCompanyId ? bookings.filter((b: any) => String(b.CompanyId) === hCompanyId) : bookings, [bookings, hCompanyId]);
  const hProjects = useMemo(() => distinctBy(hProjectPool, "ProjectId", "ProjectName"), [hProjectPool]);
  const hBlockPool = useMemo(() => hProjectId ? hProjectPool.filter((b: any) => String(b.ProjectId) === hProjectId) : hProjectPool, [hProjectPool, hProjectId]);
  const hBlocks = useMemo(() => distinctBy(hBlockPool, "BlockId", "BlockName"), [hBlockPool]);
  // Search narrows within whatever company / project / block is picked.
  const filteredBookings = useMemo(() => {
    let list = hBlockId ? hBlockPool.filter((b: any) => String(b.BlockId) === hBlockId) : hBlockPool;
    const q = bookingSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((b: any) => [b.BookingNo, b.ApplicantName, b.Mobile, b.ProjectName, b.UnitNo].some((v) => String(v || "").toLowerCase().includes(q)));
    }
    return list.slice(0, 40);
  }, [hBlockPool, hBlockId, bookingSearch]);

  async function handleGenerate() {
    if (form.InvoiceType === "Milestone" && !form.MilestoneId) { toast.error("Select a milestone"); return; }
    if (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId) { toast.error("Select an on-account payment"); return; }
    if (!["Milestone", "OnAccount"].includes(form.InvoiceType) && !(Number(form.Amount) > 0)) { toast.error("Enter the amount"); return; }
    if (form.NumberMode === "prefix" && !form.InvoicePrefix.trim()) { toast.error("Enter a prefix, or switch to Auto"); return; }
    if (form.NumberMode === "custom" && !form.CustomInvoiceNo.trim()) { toast.error("Enter the invoice number, or switch to Auto"); return; }
    setSaving(true);
    try {
      const body: any = {
        InvoiceType: form.InvoiceType, Description: form.Description,
        InvoicePrefix: form.NumberMode === "prefix" ? form.InvoicePrefix.trim() : undefined,
        CustomInvoiceNo: form.NumberMode === "custom" ? form.CustomInvoiceNo.trim() : undefined,
      };
      // Milestone invoices (incl. the Booking Amount) go through the shared bulk-generate path — the one
      // sanctioned, demand-gated route. POST /:id/invoices only takes Maintenance / Other / OnAccount.
      if (form.InvoiceType === "Milestone") {
        const res = await fetchWithAuth(`${BKG_API}/invoices/bulk-generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ bookingId, milestoneId: parseInt(form.MilestoneId, 10) }] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to generate invoice");
        const ok = data.succeeded?.[0];
        if (!ok) throw new Error(data.skipped?.[0]?.reason || "Failed to generate invoice");
        toast.success(`Invoice ${ok.InvoiceNo} generated`);
        onGenerated(bookingId as number);
        return;
      }
      if (form.InvoiceType === "OnAccount") body.OnAccountPaymentId = parseInt(form.OnAccountPaymentId, 10);
      else { body.Amount = parseFloat(form.Amount); body.InvoiceDate = form.InvoiceDate; }
      const res = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate invoice");
      toast.success(`Invoice ${data.InvoiceNo} generated`);
      onGenerated(bookingId as number);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  }

  const toggleBulk = (id: number) => setBulkSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function handleBulkGenerate() {
    if (!bulkSelected.size || bookingId == null) return;
    setBulkBusy(true);
    try {
      const items = Array.from(bulkSelected).map((milestoneId) => ({ bookingId, milestoneId }));
      const res = await fetchWithAuth(`${BKG_API}/invoices/bulk-generate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bulk generation failed");
      const succeeded = data.succeeded?.length || 0;
      const skipped = data.skipped?.length || 0;
      if (succeeded) toast.success(`${succeeded} invoice${succeeded !== 1 ? "s" : ""} generated`);
      if (skipped) toast.error(`${skipped} skipped — ${data.skipped.map((s: any) => s.reason).join("; ")}`);
      setBulkSelected(new Set());
      refetchExisting();
      onGenerated(bookingId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBulkBusy(false);
    }
  }

  const pickType = (t: string) => { setForm((f) => ({ ...f, InvoiceType: t, MilestoneId: "" })); setAutoSelected(false); setAckUnlinked(false); };
  const tabKey = (on: boolean) => `inline-flex items-center h-8 px-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const sel = `${INP} text-xs`;
  const dateInp = "!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-sm tabular-nums";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-xl max-h-[88vh] overflow-y-auto thin-scroll ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading">Generate invoice</DialogTitle>
          <DialogDescription className="text-xs">{bookingId == null ? "Choose the booking." : "Choose what to invoice from the booking's payment plan."}</DialogDescription>
        </DialogHeader>

        {bookingId == null ? (
          <div className="space-y-2.5">
            <input value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} autoFocus placeholder="Search booking no, applicant, mobile or project…" className={INP} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select value={hCompanyId} onChange={(e) => { setHCompanyId(e.target.value); setHProjectId(""); setHBlockId(""); }} className={sel}>
                <option value="">Company: any</option>
                {hCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={hProjectId} onChange={(e) => { setHProjectId(e.target.value); setHBlockId(""); }} className={sel}>
                <option value="">Project: any</option>
                {hProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={hBlockId} onChange={(e) => setHBlockId(e.target.value)} className={sel}>
                <option value="">Block: any</option>
                {hBlocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {bookingsLoading ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Loading bookings…</p>
            ) : (
              <div className="max-h-72 overflow-y-auto thin-scroll" style={{ border: RULE_SOFT }}>
                {filteredBookings.map((b: any) => (
                  <button key={b.Id} onClick={() => setBookingId(b.Id)} className="w-full text-left px-3 py-2.5 hover:bg-primary/5 flex items-center gap-3 transition-colors" style={{ borderBottom: RULE_SOFT }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-heading text-xs font-semibold tabular-nums">{b.BookingNo}</span>
                        <SheetMark text={b.Status} tone={b.Status === CrmStatus.APPROVED ? "done" : b.Status === CrmStatus.REJECTED || b.Status === CrmStatus.CANCELLED ? "stopped" : "waiting"} />
                      </div>
                      <div className="text-sm font-medium truncate mt-0.5"><ApplicantNames name={b.ApplicantName} bookingId={b.Id} applicationId={b.ApplicationId} /></div>
                      <div className="text-xs text-muted-foreground truncate">{b.ProjectName || "—"} · Unit {b.UnitNo || "—"}{b.Mobile ? ` · ${b.Mobile}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-heading text-sm font-semibold tabular-nums">{fmtMoney(b.GrandTotal ?? b.TotalValue)}</div>
                      <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDate(b.BookingDate)}</div>
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </button>
                ))}
                {!filteredBookings.length && <div className="px-3 py-8 text-center text-xs text-muted-foreground">No booking matches.</div>}
              </div>
            )}
          </div>
        ) : bookingError ? (
          <p className="text-sm text-destructive py-4">{(bookingErr as Error)?.message}</p>
        ) : !booking ? (
          <p className="text-xs text-muted-foreground py-4">Loading booking…</p>
        ) : (
          <div className="space-y-3">
            <div className="px-3 py-2.5 space-y-2" style={{ border: RULE_SOFT }}>
              <div className="flex items-center justify-between">
                <span className="font-heading text-sm font-semibold tabular-nums">{booking.BookingNo}</span>
                {initialBookingId == null && (
                  <button onClick={() => { setBookingId(null); setAckUnlinked(false); setBulkSelected(new Set()); }} className="text-xs underline underline-offset-2">Change</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {[
                  ["Customer", <ApplicantNames key="c" name={booking.ApplicantName} bookingId={booking.BookingId} applicationId={booking.ApplicationId} />],
                  ["Company", booking.CompanyName || "—"],
                  ["Project", booking.ProjectName || "—"],
                  ["Block / unit", [booking.BlockName, booking.UnitNo].filter(Boolean).join(" / ") || "—"],
                ].map(([l, v]) => (
                  <div key={String(l)}><div className={LBL}>{l}</div><div className="font-medium truncate mt-0.5">{v}</div></div>
                ))}
              </div>
            </div>

            {isNonInvoice && (
              <div className="px-3 py-2.5 space-y-2 text-xs" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                <p className="font-semibold">Non-Invoice customer — one final invoice</p>
                <p className="text-muted-foreground">No milestone invoices for this customer. One final invoice for the grand total ({fmtMoney(Number(booking?.GrandTotal || 0))}) is generated once everything is paid.</p>
                {finalInvoice ? (
                  <p className="font-medium">Final invoice <span className="font-heading tabular-nums">{finalInvoice.InvoiceNo}</span> generated.</p>
                ) : outstandingMilestones.length > 0 ? (
                  <p className="text-muted-foreground tabular-nums">{fmtMoney(outstandingTotal)} still outstanding — the final invoice becomes available when it is paid.</p>
                ) : (
                  <button type="button" onClick={generateFinal} disabled={finalBusy} className={`${KEY_INK} h-8 px-3`}>{finalBusy ? "Generating…" : "Generate final invoice"}</button>
                )}
              </div>
            )}

            <div style={{ border: RULE_SOFT }}>
              <div className={`px-3 py-2 flex items-center justify-between gap-2 ${LBL}`} style={{ borderBottom: RULE_SOFT }}>
                <span>Payment plan</span>
                <span className="normal-case tracking-normal font-normal">Pick one to invoice · tick several to generate together</span>
              </div>
              <div className="max-h-60 overflow-y-auto thin-scroll">
                {milestones.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-3">No milestone schedule on this booking.</p>
                ) : milestones.map((m: any) => {
                  const insight = getMilestoneInsight(m, existingInvoices);
                  const eligible = insight.tone === "ready";
                  const selected = form.InvoiceType === "Milestone" && form.MilestoneId === String(m.Id);
                  return (
                    <div key={m.Id} className={`px-3 py-2.5 flex items-start gap-2.5 text-xs ${selected ? "bg-primary/10" : eligible ? "hover:bg-primary/5" : ""}`}
                      style={{ borderBottom: RULE_SOFT, borderLeft: selected ? "3px solid hsl(var(--foreground))" : "3px solid transparent" }}>
                      {eligible ? (
                        <input type="checkbox" checked={bulkSelected.has(m.Id)} onChange={() => toggleBulk(m.Id)} className="mt-0.5 shrink-0 accent-foreground" aria-label={`Tick ${m.MilestoneName}`} />
                      ) : <span className="w-[13px] shrink-0" />}
                      <button disabled={!eligible}
                        onClick={() => { setForm((f) => ({ ...f, InvoiceType: "Milestone", MilestoneId: String(m.Id), OnAccountPaymentId: "", Amount: "" })); setAutoSelected(false); setAckUnlinked(false); }}
                        className={`min-w-0 flex-1 text-left ${eligible ? "cursor-pointer" : "cursor-not-allowed opacity-75"}`}>
                        <div className="font-medium"><span className="font-heading tabular-nums text-muted-foreground">{m.MilestoneNo}.</span> {m.MilestoneName}</div>
                        <div className="flex items-center gap-3 flex-wrap mt-1"><PaymentMark m={m} /></div>
                        <div className={`mt-1 ${insight.tone === "ready" ? "font-semibold" : "text-muted-foreground"}`}>Billing: {insight.message}</div>
                      </button>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="font-heading font-semibold">{fmtMoney(m.AmountDue)}</div>
                        <div className="text-[0.6875rem] text-muted-foreground mt-0.5">Paid {fmtMoney(m.AmountPaid)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-3 py-2 flex flex-wrap items-center gap-2">
                <span className={LBL}>or</span>
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {eligibleOnAccount.length > 0 && <button onClick={() => pickType("OnAccount")} className={tabKey(form.InvoiceType === "OnAccount")} style={{ borderRight: RULE_SOFT }}>On-account payment</button>}
                  <button onClick={() => pickType("Maintenance")} className={tabKey(form.InvoiceType === "Maintenance")} style={{ borderRight: RULE_SOFT }}>Maintenance</button>
                  <button onClick={() => pickType("Other")} className={tabKey(form.InvoiceType === "Other")}>Other</button>
                </div>
              </div>
              {autoSelected && (
                <p className="px-3 py-2 text-[0.6875rem]" style={{ borderTop: RULE_SOFT }}>
                  No milestone can be invoiced on this booking yet, so <b>{form.InvoiceType}</b> was picked — choose another type if that's not what you want.
                </p>
              )}
            </div>

            {bulkSelected.size > 0 && (
              <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-3 py-2 bg-card" style={{ border: RULE }}>
                <span className="text-xs font-medium tabular-nums">{bulkSelected.size} milestone{bulkSelected.size !== 1 ? "s" : ""} ticked</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setBulkSelected(new Set())} className={`${KEY_LINE} h-8 px-3`}>Clear</button>
                  <button onClick={handleBulkGenerate} disabled={bulkBusy} className={`${KEY_INK} h-8 px-3`}>
                    {bulkBusy ? "Generating…" : `Generate ${bulkSelected.size} invoice${bulkSelected.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}

            {form.InvoiceType === "OnAccount" && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground tabular-nums">On-account balance available: <b className="text-foreground font-heading">{fmtMoney(onAccountData?.availableBalance ?? 0)}</b></p>
                <SearchableNativeSelect value={form.OnAccountPaymentId} onChange={(e) => setForm((f) => ({ ...f, OnAccountPaymentId: e.target.value }))} className={INP}>
                  <option value="">Select an on-account payment…</option>
                  {eligibleOnAccount.map((p: any) => <option key={p.Id} value={String(p.Id)}>{`${p.ReceiptNo} — ${fmtMoney(p.Amount)}`}</option>)}
                </SearchableNativeSelect>
              </div>
            )}
            {(form.InvoiceType === "Maintenance" || form.InvoiceType === "Other") && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={`block mb-1 ${LBL}`}>Amount *</label>
                  <input type="number" value={form.Amount} onChange={(e) => setForm((f) => ({ ...f, Amount: e.target.value }))} className={`${INP} tabular-nums`} />
                </div>
                <div>
                  <label className={`block mb-1 ${LBL}`}>Invoice date</label>
                  <DateInput value={form.InvoiceDate} onChange={(e) => setForm((f) => ({ ...f, InvoiceDate: e.target.value }))} className={dateInp} />
                </div>
              </div>
            )}
            {showUnlinkedWarning && (
              <div className="px-3 py-2.5 space-y-2 text-[0.6875rem]" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                <p>
                  This booking still has <b className="tabular-nums">{fmtMoney(outstandingTotal)}</b> outstanding on{" "}
                  {outstandingMilestones.length === 1 ? <>"{outstandingMilestones[0].MilestoneName}"</> : `${outstandingMilestones.length} milestones`}.
                  A {form.InvoiceType} invoice is unrelated to the payment plan and records no payment against it — to settle that balance, use the payment / receipt flow, then a Milestone invoice once its demand is raised.
                </p>
                <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                  <input type="checkbox" checked={ackUnlinked} onChange={(e) => setAckUnlinked(e.target.checked)} className="accent-foreground" />
                  This invoice is unrelated to that outstanding balance — go ahead
                </label>
              </div>
            )}
            <div>
              <label className={`block mb-1 ${LBL}`}>Description (optional)</label>
              <input value={form.Description} onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))} className={INP} />
            </div>

            <div className="p-2.5 space-y-2" style={{ border: RULE_SOFT }}>
              <div className={LBL}>Invoice number</div>
              <div className="inline-flex items-stretch" style={{ border: RULE }}>
                {([{ key: "auto", label: "Auto" }, { key: "prefix", label: "Custom prefix" }, { key: "custom", label: "Exact number" }] as const).map((o, i) => (
                  <button key={o.key} onClick={() => setForm((f) => ({ ...f, NumberMode: o.key }))} className={tabKey(form.NumberMode === o.key)} style={{ borderRight: i < 2 ? RULE_SOFT : undefined }}>{o.label}</button>
                ))}
              </div>
              {form.NumberMode === "auto" && <p className="text-[0.6875rem] text-muted-foreground tabular-nums">The standard series — the next INV-{new Date().getFullYear()}-NNNNN.</p>}
              {form.NumberMode === "prefix" && (
                <div>
                  <input placeholder="e.g. TSTRSD" value={form.InvoicePrefix} onChange={(e) => setForm((f) => ({ ...f, InvoicePrefix: e.target.value.toUpperCase() }))} className={`${INP} font-heading uppercase tabular-nums`} maxLength={10} />
                  <p className="text-[0.6875rem] text-muted-foreground mt-1 tabular-nums">Generates as {form.InvoicePrefix.trim() ? form.InvoicePrefix.trim().toUpperCase() : "PREFIX"}-{new Date().getFullYear()}-NNNNN — its own series, counting up.</p>
                </div>
              )}
              {form.NumberMode === "custom" && (
                <div>
                  <input placeholder="Exact invoice number" value={form.CustomInvoiceNo} onChange={(e) => setForm((f) => ({ ...f, CustomInvoiceNo: e.target.value }))} className={`${INP} font-heading tabular-nums`} maxLength={30} />
                  <p className="text-[0.6875rem] text-muted-foreground mt-1">Used exactly as typed — must be unique across every invoice.</p>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          {bookingId != null && booking && (
            <button onClick={handleGenerate}
              disabled={saving || (form.InvoiceType === "Milestone" && !form.MilestoneId) || (form.InvoiceType === "OnAccount" && !form.OnAccountPaymentId) || (showUnlinkedWarning && !ackUnlinked)}
              className={`${KEY_INK} h-9 px-4`}>
              {saving ? "Generating…" : "Generate"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
