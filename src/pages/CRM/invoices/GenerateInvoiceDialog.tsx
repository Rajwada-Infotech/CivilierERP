// Generate an invoice for a booking: find the booking on the server, then choose what to invoice on the left and check it
// on the right before generating. Milestones ticked together become one invoice each. A Non-Invoice customer sees only
// their one Final invoice, because the server takes nothing else for them. Numbering (the standard series, a prefix, or
// one exact number) applies to on-account, maintenance and other invoices; milestone invoices use the standard series.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronRight, Search } from "lucide-react";
import { CrmStatus } from "@/constants/crmStatuses";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { GRID_SHEET_KEYS, GridSegment, GridToneMark } from "@/components/crm/CrmDataTable";
import {
  BKG_API, fetchBookingDetail, fetchBookingsForPicker, fetchOnAccount, fmtDate, fmtMoney, generateFinalInvoice, generateMilestoneInvoices, getMilestoneInsight,
} from "./config";

const { INP, KEY_INK, KEY_LINE, LBL } = GRID_SHEET_KEYS;
type Kind = "Milestone" | "OnAccount" | "Maintenance" | "Other";
type NumberMode = "auto" | "prefix" | "custom";

// A milestone's payment state: a separate question from billing, so it says "Paid" or "Balance" beside the amount.
function paymentWords(m: any) {
  if (m.Status === CrmStatus.PAID) return "Paid";
  if (m.Status === "Waived") return "Waived";
  return Number(m.AmountPaid) > 0 ? `Paid ${fmtMoney(m.AmountPaid)}` : "Not paid";
}

export function GenerateInvoiceDialog({ initialBookingId, onClose, onGenerated }: {
  initialBookingId: number | null; onClose: () => void; onGenerated: (bookingId: number) => void;
}) {
  const [bookingId, setBookingId] = useState<number | null>(initialBookingId);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useSearchAsYouType(searchInput, setSearch);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [kind, setKind] = useState<Kind>("Milestone");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [onAccountId, setOnAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [description, setDescription] = useState("");
  const [numberMode, setNumberMode] = useState<NumberMode>("auto");
  const [prefix, setPrefix] = useState("");
  const [exactNo, setExactNo] = useState("");
  // A Maintenance / Other invoice has no link to the plan; while the plan has money outstanding, staff confirm it isn't meant to settle that.
  const [ackUnlinked, setAckUnlinked] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: bookings = [], isFetching: bookingsLoading } = useQuery({
    queryKey: ["crm-bookings-for-invoice-picker", search, cpb],
    queryFn: () => fetchBookingsForPicker({ search, ...cpb }),
    enabled: bookingId == null,
    staleTime: 60_000,
  });
  const { data: bookingDetail, isError: bookingError, error: bookingErr } = useQuery({
    queryKey: ["crm-invoice-gen-booking-detail", bookingId], queryFn: () => fetchBookingDetail(bookingId as number), enabled: bookingId != null,
  });
  const { data: onAccountData } = useQuery({
    queryKey: ["crm-invoice-gen-on-account", bookingId], queryFn: () => fetchOnAccount(bookingId as number), enabled: bookingId != null,
  });
  const { data: existingInvoices = [] } = useQuery({
    queryKey: ["crm-invoice-gen-existing", bookingId],
    queryFn: async () => { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`); return r.ok ? r.json() : []; },
    enabled: bookingId != null,
  });

  const booking = bookingDetail?.booking;
  const milestones: any[] = bookingDetail?.milestones || [];
  const isReady = (m: any) => m.Status !== "Waived" && getMilestoneInsight(m, existingInvoices).tone === "ready";
  const readyMilestones = milestones.filter(isReady);
  const eligibleOnAccount = (onAccountData?.payments || []).filter(
    (p: any) => p.InvoiceId == null && p.Status !== "Applied" && p.Status !== "PartiallyApplied" && !existingInvoices.some((inv: any) => inv.OnAccountPaymentId === p.Id && inv.Status !== "Void"),
  );
  const outstanding = milestones.filter((m) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && Number(m.AmountDue || 0) - Number(m.AmountPaid || 0) > 0);
  const outstandingTotal = outstanding.reduce((s, m) => s + (Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)), 0);
  const isNonInvoice = bookingDetail?.customer?.InvoiceMode === "NonInvoice";
  const finalInvoice = (existingInvoices as any[]).find((inv) => inv.InvoiceType === "Final" && inv.Status !== "Void");
  const planDue = milestones.reduce((s, m) => s + (m.Status === "Waived" ? 0 : Number(m.AmountDue || 0)), 0);
  const finalDue = isNonInvoice && !finalInvoice && milestones.length > 0 && !milestones.some((m) => m.Status !== CrmStatus.PAID && m.Status !== "Waived");

  const tickedRows = milestones.filter((m) => ticked.has(m.Id));
  const chosenDeposit = eligibleOnAccount.find((p: any) => String(p.Id) === onAccountId);
  const lines: { label: string; amount: number }[] = kind === "Milestone" ? tickedRows.map((m) => ({ label: m.MilestoneName, amount: Number(m.AmountDue) }))
    : kind === "OnAccount" ? (chosenDeposit ? [{ label: chosenDeposit.ReceiptNo, amount: Number(chosenDeposit.Amount) }] : [])
    : Number(amount) > 0 ? [{ label: kind, amount: Number(amount) }] : [];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const unlinkedWarning = (kind === "Maintenance" || kind === "Other") && outstanding.length > 0;
  const numberMissing = kind !== "Milestone" && ((numberMode === "prefix" && !prefix.trim()) || (numberMode === "custom" && !exactNo.trim()));
  const blocked = !lines.length || numberMissing || (unlinkedWarning && !ackUnlinked);

  const toggle = (id: number) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = readyMilestones.length > 0 && readyMilestones.every((m) => ticked.has(m.Id));

  async function generate() {
    if (bookingId == null || blocked) return;
    setSaving(true);
    try {
      if (kind === "Milestone") {
        const d = await generateMilestoneInvoices(tickedRows.map((m) => ({ bookingId, milestoneId: m.Id })));
        if (d.succeeded.length) toast.success(d.succeeded.length === 1 ? `Invoice ${d.succeeded[0].InvoiceNo} generated` : `${d.succeeded.length} invoices generated`);
        if (d.skipped.length) toast.error(`${d.skipped.length} not generated: ${d.skipped.map((s) => s.reason).join("; ")}`);
        if (d.succeeded.length) onGenerated(bookingId);
        return;
      }
      const body: any = {
        InvoiceType: kind, Description: description,
        InvoicePrefix: numberMode === "prefix" ? prefix.trim() : undefined,
        CustomInvoiceNo: numberMode === "custom" ? exactNo.trim() : undefined,
      };
      if (kind === "OnAccount") body.OnAccountPaymentId = parseInt(onAccountId, 10);
      else { body.Amount = parseFloat(amount); body.InvoiceDate = invoiceDate; }
      const res = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not generate the invoice");
      toast.success(`Invoice ${data.InvoiceNo} generated`);
      onGenerated(bookingId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  }
  async function generateFinal() {
    if (bookingId == null) return;
    setSaving(true);
    try {
      const d = await generateFinalInvoice(bookingId);
      toast.success(d.message || "Final invoice generated");
      onGenerated(bookingId);
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSaving(false); }
  }

  const kinds: { key: Kind; label: string; count?: number }[] = [
    { key: "Milestone", label: "Milestones", count: readyMilestones.length },
    ...(eligibleOnAccount.length ? [{ key: "OnAccount" as const, label: "On-account deposit", count: eligibleOnAccount.length }] : []),
    { key: "Maintenance", label: "Maintenance" },
    { key: "Other", label: "Other" },
  ];
  const warnBox = "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("!p-0 !gap-0 overflow-hidden w-[96vw]", bookingId == null ? "max-w-3xl" : "max-w-5xl")}>
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle>Generate invoice</DialogTitle>
          <DialogDescription className="text-xs">{bookingId == null ? "Find the booking to invoice." : "Choose what to invoice, and check it before generating."}</DialogDescription>
        </DialogHeader>

        {bookingId == null ? (
          <div className="p-5 space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus aria-label="Search bookings" placeholder="Booking no., customer, mobile or unit" className={cn(INP, "pl-9")} />
            </div>
            <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
            <div className="max-h-[52vh] overflow-y-auto thin-scroll rounded-md border border-border divide-y divide-border">
              {(bookings as any[]).map((b) => (
                <button key={b.Id} type="button" onClick={() => setBookingId(b.Id)} className="w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate"><ApplicantNames name={b.ApplicantName} bookingId={b.Id} applicationId={b.ApplicationId} /></span>
                    <span className="block text-xs text-muted-foreground truncate tabular-nums">{b.BookingNo} · {b.UnitNo || "—"}{b.ProjectName ? ` · ${b.ProjectName}` : ""}{b.Mobile ? ` · ${b.Mobile}` : ""}</span>
                  </span>
                  <GridToneMark text={b.Status} tone={b.Status === CrmStatus.APPROVED ? "done" : "waiting"} />
                  <span className="text-right shrink-0 tabular-nums">
                    <span className="block text-sm font-semibold">{fmtMoney(b.GrandTotal ?? b.TotalValue)}</span>
                    <span className="block text-[0.6875rem] text-muted-foreground">{fmtDate(b.BookingDate)}</span>
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                </button>
              ))}
              {!(bookings as any[]).length && <p className="px-3 py-8 text-center text-xs text-muted-foreground">{bookingsLoading ? "Searching…" : "No booking matches."}</p>}
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">The newest 25 matches are shown. Search to find any other booking.</p>
          </div>
        ) : bookingError ? (
          <p className="p-5 text-sm text-destructive">{translateError((bookingErr as Error)?.message || "Could not load the booking.")}</p>
        ) : !booking ? (
          <p className="p-5 text-xs text-muted-foreground">Loading the booking…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_19rem]">
            {/* Left: what to invoice */}
            <div className="p-5 space-y-3 md:max-h-[70vh] overflow-y-auto thin-scroll min-w-0">
              {isNonInvoice ? (
                <div className="rounded-md border border-border px-4 py-3 space-y-1.5 text-sm">
                  <p className="font-semibold">This customer takes one final invoice</p>
                  <p className="text-xs text-muted-foreground">No milestone, on-account, maintenance or other invoices. One final invoice for what is due is generated once everything is paid. To invoice by milestone, change the customer's invoice setting in their customer record first.</p>
                </div>
              ) : finalInvoice ? (
                <div className="rounded-md border border-border px-4 py-3 text-sm">
                  <p className="font-semibold">This booking is invoiced by final invoice {finalInvoice.InvoiceNo}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Void it first if milestone invoices are needed, so nothing is invoiced twice.</p>
                </div>
              ) : (
                <>
                  <GridSegment<Kind> label="What to invoice" options={kinds} value={kind} onChange={(k) => { setKind(k); setAckUnlinked(false); }} />
                  {kind === "Milestone" && (
                    <div className="rounded-md border border-border overflow-hidden">
                      <div className="px-3 h-9 flex items-center justify-between gap-2 bg-muted border-b border-border text-xs">
                        <label className={cn("inline-flex items-center gap-2 font-semibold", !readyMilestones.length && "opacity-50")}>
                          <input type="checkbox" disabled={!readyMilestones.length} checked={allTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(readyMilestones.map((m) => m.Id)))} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                          All due for invoicing ({readyMilestones.length})
                        </label>
                        <span className="text-muted-foreground">Each ticked milestone gets its own invoice</span>
                      </div>
                      {milestones.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No payment plan on this booking.</p> : (
                        <ul className="divide-y divide-border/70">
                          {milestones.map((m) => {
                            const ready = isReady(m);
                            const insight = m.Status === "Waived" ? "Waived" : getMilestoneInsight(m, existingInvoices).message;
                            return (
                              <li key={m.Id}>
                                <label className={cn("flex items-center gap-3 px-3 py-2 text-[0.8125rem]", ready ? "cursor-pointer hover:bg-muted/40" : "text-muted-foreground", ticked.has(m.Id) && "bg-primary/5")}>
                                  <input type="checkbox" disabled={!ready} checked={ticked.has(m.Id)} onChange={() => toggle(m.Id)} aria-label={`Invoice ${m.MilestoneName}`} className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-30" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block font-medium truncate"><span className="tabular-nums mr-1.5 opacity-60">{m.MilestoneNo}</span>{m.MilestoneName}</span>
                                    <span className={cn("block text-xs", ready ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{insight}</span>
                                  </span>
                                  <span className="text-right shrink-0 tabular-nums">
                                    <span className="block font-medium">{fmtMoney(m.AmountDue)}</span>
                                    <span className="block text-xs text-muted-foreground">{paymentWords(m)}</span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                  {kind === "OnAccount" && (
                    <div>
                      <label className={cn("block mb-1", LBL)}>Deposit to invoice</label>
                      <SearchableNativeSelect value={onAccountId} onChange={(e) => setOnAccountId(e.target.value)} className={INP}>
                        <option value="">Select an on-account deposit</option>
                        {eligibleOnAccount.map((p: any) => <option key={p.Id} value={String(p.Id)}>{`${p.ReceiptNo} · ${fmtMoney(p.Amount)}`}</option>)}
                      </SearchableNativeSelect>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">On account: {fmtMoney(onAccountData?.availableBalance ?? 0)}</p>
                    </div>
                  )}
                  {(kind === "Maintenance" || kind === "Other") && (
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={cn("block mb-1", LBL)}>Invoice amount</label><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(INP, "tabular-nums")} /></div>
                      <div><label className={cn("block mb-1", LBL)}>Invoice date</label><DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={INP} /></div>
                    </div>
                  )}
                  {unlinkedWarning && (
                    <div className={warnBox}>
                      <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
                      <div className="space-y-1.5">
                        <p>This booking has <b className="tabular-nums">{fmtMoney(outstandingTotal)}</b> outstanding on its payment plan. This invoice is not linked to the plan and records no payment against it.</p>
                        <label className="flex items-center gap-1.5 font-medium cursor-pointer">
                          <input type="checkbox" checked={ackUnlinked} onChange={(e) => setAckUnlinked(e.target.checked)} className="accent-[hsl(var(--primary))]" /> This invoice is separate from that balance
                        </label>
                      </div>
                    </div>
                  )}
                  {kind !== "Milestone" && (
                    <>
                      <div><label className={cn("block mb-1", LBL)}>Description (optional)</label><input value={description} onChange={(e) => setDescription(e.target.value)} className={INP} /></div>
                      <div className="space-y-2">
                        <GridSegment<NumberMode> label="Invoice number" value={numberMode} onChange={setNumberMode}
                          options={[{ key: "auto", label: "Next in series" }, { key: "prefix", label: "Own prefix" }, { key: "custom", label: "Exact number" }]} />
                        {numberMode === "auto" && <p className="text-xs text-muted-foreground tabular-nums">The next INV-{new Date().getFullYear()}-NNNNN.</p>}
                        {numberMode === "prefix" && (
                          <div>
                            <input aria-label="Invoice number prefix" placeholder="TSTRSD" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={10} className={cn(INP, "uppercase tabular-nums")} />
                            <p className="text-xs text-muted-foreground mt-1 tabular-nums">Generates as {prefix.trim() || "PREFIX"}-{new Date().getFullYear()}-NNNNN, its own series.</p>
                          </div>
                        )}
                        {numberMode === "custom" && (
                          <div>
                            <input aria-label="Exact invoice number" value={exactNo} onChange={(e) => setExactNo(e.target.value)} maxLength={30} className={cn(INP, "tabular-nums")} />
                            <p className="text-xs text-muted-foreground mt-1">Used exactly as typed. It must not be used on any other invoice.</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Right: the booking, and what will be generated */}
            <aside className="p-5 bg-muted/30 border-t md:border-t-0 md:border-l border-border flex flex-col gap-4 min-w-0">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold min-w-0"><ApplicantNames name={booking.ApplicantName} bookingId={bookingId} applicationId={booking.ApplicationId} /></p>
                  {initialBookingId == null && <button type="button" onClick={() => { setBookingId(null); setTicked(new Set()); setAckUnlinked(false); }} className="text-xs text-primary hover:underline shrink-0">Change</button>}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{booking.BookingNo}</p>
                <p className="text-xs text-muted-foreground">{[booking.CompanyName, booking.ProjectName, [booking.BlockName, booking.UnitNo].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}</p>
              </div>
              {isNonInvoice ? (
                <div className="flex-1 flex flex-col gap-3 text-xs">
                  <div className="flex-1">
                    {finalInvoice ? <p className="flex items-center gap-1.5 font-medium"><Check size={13} className="text-emerald-600" /> Final invoice {finalInvoice.InvoiceNo} is generated.</p>
                      : finalDue ? <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">Final invoice</span><span className="text-lg font-semibold tabular-nums">{fmtMoney(planDue)}</span></div>
                      : <p className="text-muted-foreground tabular-nums">{fmtMoney(outstandingTotal)} is still outstanding. The final invoice is available once everything is paid.</p>}
                  </div>
                  {finalDue && <p className="text-muted-foreground">It takes the next invoice number and shows in the customer's portal. It can't be deleted after this, only voided with a reason.</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className={cn(KEY_LINE, "h-9 px-4 flex-1")}>{finalDue ? "Cancel" : "Close"}</button>
                    {finalDue && <button type="button" onClick={generateFinal} disabled={saving} className={cn(KEY_INK, "h-9 px-4 flex-1")}>{saving ? "Generating…" : "Generate"}</button>}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  <div className="flex-1 min-h-0">
                    <p className={cn("mb-1.5", LBL)}>To be generated</p>
                    {!lines.length ? <p className="text-xs text-muted-foreground">Nothing chosen yet.</p> : (
                      <ul className="space-y-1 text-[0.8125rem] max-h-48 overflow-y-auto thin-scroll">
                        {lines.map((l) => <li key={l.label} className="flex justify-between gap-3"><span className="truncate">{l.label}</span><span className="tabular-nums shrink-0">{fmtMoney(l.amount)}</span></li>)}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                    <span className="text-xs text-muted-foreground">{lines.length} invoice{lines.length === 1 ? "" : "s"}</span>
                    <span className="text-lg font-semibold tabular-nums">{fmtMoney(total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Each takes the next invoice number and shows in the customer's portal. It can't be deleted after this, only voided with a reason.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className={cn(KEY_LINE, "h-9 px-4 flex-1")}>Cancel</button>
                    <button type="button" onClick={generate} disabled={saving || blocked || !!finalInvoice} className={cn(KEY_INK, "h-9 px-4 flex-1")}>{saving ? "Generating…" : "Generate"}</button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
