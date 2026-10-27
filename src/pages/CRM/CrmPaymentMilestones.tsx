import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { AlertTriangle, Landmark, MessageSquare, Plus, RefreshCw, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { SheetShell } from "@/components/sheet/Sheet";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import {
  API, BKG_API, PAY_MODES, type BookingPickerScope, modeHasBank, fmt, fmtDate, todayStr,
  fetchBookings, fetchMilestones, fetchMoneyReceipts, fetchOnAccount, fetchProjectBanks, fetchCustomerBank,
} from "./payments/config";
import { BookingSummary, MilestoneTable, OnAccountPanel } from "./payments/parts";

const LABEL = `block mb-1.5 ${LBL}`;
const DIALOG = "rounded-none p-5 gap-4";

const CrmPaymentMilestones: React.FC = () => {
  const rights = usePageRights("crm-payments");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const selectedBookingId = sp.get("bookingId") || "";
  const [editingId, setEditingId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState({ AmountPaid: "", PaidDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Remarks: "", DepositBankId: "" });
  const [saving, setSaving] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
  const [onAccountDialog, setOnAccountDialog] = useState(false);
  const [onAccountForm, setOnAccountForm] = useState({ Amount: "", ReceivedDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Notes: "", DepositBankId: "" });
  const [applyDialog, setApplyDialog] = useState<{ payment: any; milestone: any | null; amount: string } | null>(null);
  const [applyMilestoneId, setApplyMilestoneId] = useState<string>("");
  const [waiveDialog, setWaiveDialog] = useState<{ milestone: any; reason: string } | null>(null);
  const [remarksDialog, setRemarksDialog] = useState<{ milestone: any } | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  // The booking picker's scope (see fetchBookings).
  const [pickerCpb, setPickerCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [pickerSearchInput, setPickerSearchInput] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const pickerScope: BookingPickerScope = useMemo(
    () => ({ companyId: pickerCpb.companyId, projectId: pickerCpb.projectId, blockId: pickerCpb.blockId, search: pickerSearch }),
    [pickerCpb, pickerSearch],
  );
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings-dropdown", pickerScope], queryFn: () => fetchBookings(pickerScope), staleTime: 5 * 60_000 });
  const { data: milestoneData, isLoading, isError, error: milestoneError, isFetching, refetch } = useQuery({
    queryKey: ["crm-milestones", selectedBookingId],
    queryFn: () => fetchMilestones(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 30_000,
    retry: 1,
  });
  const { data: onAccountData } = useQuery({ queryKey: ["crm-on-account", selectedBookingId], queryFn: () => fetchOnAccount(selectedBookingId), enabled: !!selectedBookingId, staleTime: 15_000 });
  const { data: moneyReceipts = [] } = useQuery({ queryKey: ["crm-money-receipts", selectedBookingId], queryFn: () => fetchMoneyReceipts(selectedBookingId), enabled: !!selectedBookingId, staleTime: 15_000 });
  const { data: customerBank } = useQuery({ queryKey: ["crm-customer-bank", selectedBookingId], queryFn: () => fetchCustomerBank(selectedBookingId), enabled: !!selectedBookingId, staleTime: 30_000 });

  const milestones: any[] = milestoneData?.milestones || [];
  const summary = milestoneData?.summary || {};
  const booking = milestoneData?.booking || null;
  const onAccountBalance = onAccountData?.availableBalance || 0;
  // Funded = what's settled on milestones plus the on-account money still usable, against the dues that aren't
  // waived (the GrandTotal when there's no schedule yet) — the backend's gate in applyOnAccountToMilestone. Applied
  // deposits are already in totalPaid, so only their unapplied remainder counts on top.
  const bookingRequiredAmount = milestones.length > 0
    ? Number(summary.totalDue || 0)
    : Number(booking?.GrandTotal ?? booking?.TotalValue ?? 0);
  const bookingFundsOnHand = Number(summary.totalPaid || 0) + Number(onAccountBalance || 0);
  const notFullyPaid = bookingRequiredAmount > 0 && bookingFundsOnHand + 0.005 < bookingRequiredAmount;
  const fullPaymentShortfall = Math.max(0, Math.round((bookingRequiredAmount - bookingFundsOnHand) * 100) / 100);
  // Manual apply goes to the next unpaid milestone only, and only once its Demand is raised (the sweep's order).
  const nextOutstandingMilestone = [...milestones]
    .sort((a: any, b: any) => Number(a.MilestoneNo) - Number(b.MilestoneNo))
    .find((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived");
  const nextMilestoneBalance = nextOutstandingMilestone
    ? Math.max(0, Number(nextOutstandingMilestone.AmountDue) - Number(nextOutstandingMilestone.AmountPaid || 0))
    : 0;
  const canManuallyApplyOnAccount = !!(
    !notFullyPaid && nextOutstandingMilestone && nextMilestoneBalance > 0 &&
    nextOutstandingMilestone.DemandStatus !== CrmStatus.PENDING
  );
  const totalPendingVerification = milestones.reduce((s: number, m: any) => s + Number(m.PendingVerificationAmount || 0), 0);

  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-project-banks-for", booking?.ProjectId],
    queryFn: () => fetchProjectBanks(booking?.ProjectId),
    enabled: booking?.ProjectId != null,
  });

  // The core Booking Amount row: a parking / extra-charge row can also be numbered 1.
  const milestone1 = milestones.find((m) => m.MilestoneNo === 1 && !m.ParkingAllotmentId && !m.ExtraChargeId);
  const needsResync = !!booking?.BookingAmount && (!milestone1 || Math.abs(Number(milestone1.AmountDue) - Number(booking.BookingAmount)) >= 1);

  // Live preview for the Record Payment dialog
  const editingMilestone = milestones.find((m) => m.Id === editingId) || null;
  const editingBalance = editingMilestone ? Math.max(0, Number(editingMilestone.AmountDue) - Number(editingMilestone.AmountPaid || 0)) : 0;
  const enteredPaid = payForm.AmountPaid ? parseFloat(payForm.AmountPaid) : 0;
  // What's entered is a NEW payment, so it overflows past the balance still due.
  const previewOverflow = editingMilestone && enteredPaid > editingBalance ? Math.round((enteredPaid - editingBalance) * 100) / 100 : 0;

  const reloadMilestones = () => qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });

  const handleOpenPayment = (m: any) => {
    setEditingId(m.Id);
    const remaining = Math.max(0, Number(m.AmountDue) - Number(m.AmountPaid || 0));
    setPayForm({
      // A NEW payment (a receipt), not a running total — it starts at what's still due.
      AmountPaid: remaining > 0 ? String(remaining) : "",
      PaidDate: todayStr(),
      PaymentMode: "",
      // Deliberately not pre-filled from the KYC bank: a customer can pay from any account (the bank on file shows
      // below as reference). A new payment's own details — never the previous payment's cheque / ref.
      BankName: "",
      TransactionRef: "",
      Remarks: "",
      DepositBankId: m.DepositBankId != null ? String(m.DepositBankId) : projectBanks.length === 1 ? String(projectBanks[0].BId) : "",
    });
  };

  const handleWaiveConfirm = async () => {
    if (!waiveDialog?.reason.trim()) return;
    setWaiving(true);
    try {
      const res = await fetchWithAuth(`${API}/${waiveDialog.milestone.Id}/waive`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Reason: waiveDialog.reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone waived");
      const allOthersCleared = milestones.filter((x) => x.Id !== waiveDialog.milestone.Id).every((x) => ["Paid", "Waived"].includes(x.Status));
      setWaiveDialog(null);
      if (allOthersCleared) promptNextStep(navigate, "All payment milestones are cleared — the Sales Deed is ready to prepare.", "/crm/sales-deed", "Go to Sales Deed");
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setWaiving(false); }
  };

  const handleRecordPayment = async () => {
    if (editingId == null) return;
    if (!(enteredPaid > 0)) { toast.error("Enter the amount received"); return; }
    // No deposit bank here — CRM records the money received; Accounts assigns the bank on the Received Payment.
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editingId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AmountPaid: payForm.AmountPaid ? parseFloat(payForm.AmountPaid) : undefined,
          PaidDate: payForm.PaidDate || undefined,
          PaymentMode: payForm.PaymentMode || undefined,
          BankName: payForm.BankName || undefined,
          TransactionRef: payForm.TransactionRef || undefined,
          Remarks: payForm.Remarks || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(data.submitted ? `Submitted for Finance approval${data.RPDocNo ? ` — ${data.RPDocNo}` : ""}. It won't count as paid until approved.` : "Milestone updated");
      setEditingId(null);
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleResyncSchedule = async () => {
    if (!selectedBookingId) return;
    setResyncing(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${selectedBookingId}/resync-schedule`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(data.changed ? "Payment schedule resynced to the booking amount" : "Already up to date");
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setResyncing(false); }
  };

  const handleAddMilestone = async () => {
    if (!selectedBookingId || !addForm.MilestoneName.trim()) return;
    const amountDue = Number(addForm.AmountDue);
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
      toast.error("Enter an Amount Due greater than zero");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${selectedBookingId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MilestoneName: addForm.MilestoneName,
          DueDate: addForm.DueDate || null,
          AmountDue: amountDue,
          ResponsibleDepartment: addForm.ResponsibleDepartment || null,
          RequiredDocuments: addForm.RequiredDocuments || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      toast.success("Milestone added");
      setAddDialog(false);
      setAddForm({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleDepositOnAccount = async () => {
    if (!selectedBookingId || !(Number(onAccountForm.Amount) > 0)) { toast.error("Enter the amount received"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${selectedBookingId}/on-account`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Amount: parseFloat(onAccountForm.Amount),
          ReceivedDate: onAccountForm.ReceivedDate || null,
          PaymentMode: onAccountForm.PaymentMode || null,
          BankName: onAccountForm.BankName || null,
          TransactionRef: onAccountForm.TransactionRef || null,
          Notes: onAccountForm.Notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`On-account deposit submitted for Finance approval${data.RPDocNo ? ` — ${data.RPDocNo}` : ""}. It won't appear until approved.`);
      setOnAccountDialog(false);
      setOnAccountForm({ Amount: "", ReceivedDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Notes: "", DepositBankId: "" });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const openApplyDialog = (payment: any, milestone: any | null) => {
    const remaining = Number(payment.Amount) - Number(payment.AppliedAmount || 0);
    const milestoneBalance = milestone ? Number(milestone.AmountDue) - Number(milestone.AmountPaid || 0) : remaining;
    setApplyMilestoneId(milestone ? String(milestone.Id) : "");
    setApplyDialog({ payment, milestone, amount: String(milestone ? Math.min(remaining, milestoneBalance) : remaining) });
  };

  const handleConfirmApply = async () => {
    if (!applyDialog) return;
    const milId = applyDialog.milestone?.Id ?? parseInt(applyMilestoneId);
    if (milId == null || Number.isNaN(milId)) { toast.error("Select a milestone to apply to"); return; }
    const amount = parseFloat(applyDialog.amount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/on-account/${applyDialog.payment.Id}/apply`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ MilestoneId: milId, Amount: amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`${fmt(amount)} applied from ${applyDialog.payment.ReceiptNo}`);
      setApplyDialog(null);
      reloadMilestones();
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-money-receipts", selectedBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-booking-money-receipts", Number(selectedBookingId)] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const modeSelect = (value: string, onChange: (mode: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INP}>
      <option value="">Select mode</option>
      {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
  const depositNote = (
    <div className="px-3 py-2.5 flex items-start gap-2" style={{ border: RULE_SOFT }}>
      <Landmark size={13} className="text-muted-foreground mt-0.5 shrink-0" />
      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Deposit bank</span> — Accounts assigns it on the Received Payment before approving.</p>
    </div>
  );

  const figures = booking ? [
    { label: "Total due", value: fmt(summary.totalDue), note: `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}` },
    { label: "Collected", value: fmt(summary.totalPaid), note: totalPendingVerification > 0 ? `${fmt(totalPendingVerification)} pending approval` : "Approved by Finance" },
    { label: "Balance", value: fmt(summary.balance), note: onAccountBalance > 0 ? `${fmt(onAccountBalance)} on-account` : "Still to collect", red: summary.balance > 0 },
    { label: "Overdue", value: String(summary.overdue || 0), note: "Milestones past due", red: (summary.overdue || 0) > 0 },
  ] : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Payments"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Payment Milestones"
        subtitle="A booking's payment schedule: what's due, what's collected (Finance approves every payment before it counts), on-account money, waivers and the balance."
        action={selectedBookingId
          ? <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
          : undefined}
      >
        <div className="space-y-5">
          {/* Booking picker, scoped so it stays workable as the portfolio grows */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <CrmCompanyProjectBlockFilter value={pickerCpb} onChange={(v) => { setPickerCpb(v); setSp({}, { replace: true }); }} />
                <input value={pickerSearchInput} onChange={(e) => setPickerSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setPickerSearch(pickerSearchInput.trim()); setSp({}, { replace: true }); } }}
                  placeholder="Booking no / customer… (Enter)"
                  className="h-9 w-60 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-64">
                  <label className={LABEL}>Booking <span className="normal-case tracking-normal font-normal tabular-nums">({(bookings as any[]).length} in scope)</span></label>
                  <SearchableNativeSelect value={selectedBookingId} onChange={(e) => setSp(e.target.value ? { bookingId: e.target.value } : {}, { replace: true })} className={INP}>
                    <option value="">— Choose a booking —</option>
                    {(bookings as any[]).map((b: any) => (
                      <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName} · ${b.UnitNo}${b.ProjectName ? ` (${b.ProjectName})` : ""}`}</option>
                    ))}
                  </SearchableNativeSelect>
                </div>
                {selectedBookingId && rights.canCreate && (
                  <>
                    <button onClick={() => setAddDialog(true)} className={`${KEY_LINE} h-9 px-3`}><Plus size={13} /> Add milestone</button>
                    <button onClick={() => {
                      setOnAccountForm((f) => ({ ...f, ReceivedDate: f.ReceivedDate || todayStr(), DepositBankId: projectBanks.length === 1 ? String(projectBanks[0].BId) : f.DepositBankId }));
                      setOnAccountDialog(true);
                    }} className={`${KEY_INK} h-9 px-3`}><Wallet size={13} /> Deposit on account</button>
                  </>
                )}
                {selectedBookingId && rights.canEdit && needsResync && (
                  <button onClick={handleResyncSchedule} disabled={resyncing} className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}>
                    <RefreshCw size={13} className={resyncing ? "animate-spin" : ""} /> {resyncing ? "Resyncing…" : "Resync schedule"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {needsResync && (
            <div className="bg-card px-4 py-3 text-sm flex items-start gap-2" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--destructive))" }}>
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-destructive" />
              <span>{!milestone1
                ? "This booking has no Booking Amount milestone. Resync the schedule to generate it; schedule rows that already exist are kept for review."
                : <>Milestone 1 ({fmt(milestone1.AmountDue)}) doesn't match this booking's booking amount ({fmt(booking.BookingAmount)}). Resync the schedule to fix it and redistribute the remaining milestones.</>}</span>
            </div>
          )}

          {!selectedBookingId ? (
            <div className="bg-card py-16 text-center text-muted-foreground text-sm" style={{ border: RULE }}>Choose a booking to see its payment schedule.</div>
          ) : isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading milestones…</div>
          ) : isError ? (
            <div className="py-16 text-center text-destructive text-sm">Failed to load milestones{milestoneError instanceof Error ? `: ${milestoneError.message}` : ""}</div>
          ) : !milestoneData ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No milestone data found.</div>
          ) : (
            <>
              {figures.length > 0 && (
                <div className="bg-card" style={{ border: RULE }}>
                  <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                    {figures.map((x) => (
                      <div key={x.label}>
                        <span className="label">{x.label}</span>
                        <p className="figure" style={{ fontSize: "clamp(16px, 1.7vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{x.value}</p>
                        <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {booking && <BookingSummary booking={booking} summary={summary} onAccountBalance={onAccountBalance} totalPendingVerification={totalPendingVerification} moneyReceipts={moneyReceipts as any[]} />}
              {onAccountData && onAccountData.payments?.length > 0 && (
                <OnAccountPanel onAccountData={onAccountData} onAccountBalance={onAccountBalance} notFullyPaid={notFullyPaid}
                  fundsOnHand={bookingFundsOnHand} requiredAmount={bookingRequiredAmount} fullPaymentShortfall={fullPaymentShortfall}
                  milestones={milestones} canManuallyApply={canManuallyApplyOnAccount}
                  canEdit={rights.canEdit} onApply={(p) => openApplyDialog(p, null)} />
              )}
              <MilestoneTable milestones={milestones} canEdit={rights.canEdit} onAccountData={onAccountData} onAccountBalance={onAccountBalance}
                notFullyPaid={notFullyPaid} fullPaymentShortfall={fullPaymentShortfall}
                nextMilestone={nextOutstandingMilestone} canManuallyApply={canManuallyApplyOnAccount}
                onPay={handleOpenPayment} onApply={openApplyDialog} onWaive={(m) => setWaiveDialog({ milestone: m, reason: "" })} onRemarks={(m) => setRemarksDialog({ milestone: m })} />
            </>
          )}
        </div>

        {/* Record payment */}
        <Dialog open={editingId != null} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
          <DialogContent className={`max-w-2xl ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Submit payment for approval</DialogTitle>
              <DialogDescription className="text-xs">Goes to Finance's Received Payment queue — the Accounts head (or an admin) approves it before it counts as paid.</DialogDescription>
            </DialogHeader>
            {editingMilestone && (
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3" style={{ border: RULE, borderLeft: "3px solid hsl(var(--foreground))" }}>
                <div className="min-w-0">
                  <p className={LBL}>Milestone</p>
                  <p className="text-sm font-semibold truncate mt-0.5">{editingMilestone.MilestoneName}</p>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right"><p className={LBL}>Amount due</p><p className="text-sm font-heading font-semibold tabular-nums mt-0.5">{fmt(editingMilestone.AmountDue)}</p></div>
                  <div className="text-right"><p className={LBL}>Balance</p><p className="text-lg font-heading font-bold tabular-nums mt-0.5">{fmt(editingBalance)}</p></div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Amount received now (₹)</label>
                <input type="number" min={0} value={payForm.AmountPaid} onChange={(e) => setPayForm((f) => ({ ...f, AmountPaid: e.target.value }))} className={`${INP} font-semibold tabular-nums`} />
              </div>
              <div>
                <label className={LABEL}>Payment date</label>
                <DateInput value={payForm.PaidDate} max={todayStr()} onChange={(e) => setPayForm((f) => ({ ...f, PaidDate: e.target.value }))} className={INP} />
              </div>
              <div>
                <label className={LABEL}>Payment mode</label>
                {modeSelect(payForm.PaymentMode, (mode) => setPayForm((f) => ({ ...f, PaymentMode: mode, BankName: modeHasBank(mode) ? f.BankName : "" })))}
              </div>
              {previewOverflow > 0 && (
                <p className="col-span-2 sm:col-span-3 text-[0.6875rem] font-medium flex items-center gap-1.5 px-2.5 py-1.5" style={{ border: RULE_SOFT }}>
                  <Wallet size={12} className="shrink-0" /> {fmt(previewOverflow)} beyond what's due — parked to On Account if still so when approved.
                </p>
              )}
              {modeHasBank(payForm.PaymentMode) && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Customer's bank</label>
                  <BankNamePicker sheet value={payForm.BankName} onChange={(v) => setPayForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
                </div>
              )}
              <div className={modeHasBank(payForm.PaymentMode) ? "col-span-2" : "col-span-2 sm:col-span-3"}>
                <label className={LABEL}>Transaction ref</label>
                <input type="text" value={payForm.TransactionRef} placeholder="UTR / cheque / reference no." onChange={(e) => setPayForm((f) => ({ ...f, TransactionRef: e.target.value }))} className={INP} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL}>Remarks</label>
                <textarea value={payForm.Remarks} onChange={(e) => setPayForm((f) => ({ ...f, Remarks: e.target.value }))} rows={2} placeholder="Optional note for Finance…" className={TEXTAREA} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {depositNote}
              {customerBank && (customerBank.BankName || customerBank.AccountNo) ? (
                <div className="px-3 py-2.5" style={{ border: RULE_SOFT }}>
                  <p className={`${LBL} mb-1.5`}>Bank on file (KYC) — reference only</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.6875rem]">
                    <span className="text-muted-foreground">Bank</span><span className="font-medium text-right truncate">{customerBank.BankName || "—"}</span>
                    <span className="text-muted-foreground">A/C no.</span><span className="font-medium text-right tabular-nums">{customerBank.AccountNo || "—"}</span>
                    <span className="text-muted-foreground">IFSC</span><span className="font-medium text-right tabular-nums">{customerBank.IfscCode || "—"}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setEditingId(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleRecordPayment} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Submitting…" : "Submit for approval"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add milestone */}
        <Dialog open={addDialog} onOpenChange={(o) => { if (!o) setAddDialog(false); }}>
          <DialogContent className={`max-w-sm ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Add custom milestone</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Milestone name *</label>
                <input type="text" value={addForm.MilestoneName} onChange={(e) => setAddForm((f) => ({ ...f, MilestoneName: e.target.value }))} className={INP} placeholder="e.g. PLC charges" autoFocus />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Due date</label>
                  <DateInput value={addForm.DueDate} onChange={(e) => setAddForm((f) => ({ ...f, DueDate: e.target.value }))} className={INP} />
                </div>
                <div>
                  <label className={LABEL}>Amount due (₹)</label>
                  <input type="number" min={0} value={addForm.AmountDue} onChange={(e) => setAddForm((f) => ({ ...f, AmountDue: e.target.value }))} className={`${INP} tabular-nums`} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Responsible department</label>
                <input type="text" value={addForm.ResponsibleDepartment} onChange={(e) => setAddForm((f) => ({ ...f, ResponsibleDepartment: e.target.value }))} className={INP} placeholder="e.g. Construction, Legal, Sales" />
              </div>
              <div>
                <label className={LABEL}>Required documents</label>
                <input type="text" value={addForm.RequiredDocuments} onChange={(e) => setAddForm((f) => ({ ...f, RequiredDocuments: e.target.value }))} className={INP} placeholder="e.g. Completion certificate" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setAddDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleAddMilestone} disabled={saving || !addForm.MilestoneName.trim()} className={`${KEY_INK} h-9 px-4`}>{saving ? "Adding…" : "Add milestone"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Deposit on account */}
        <Dialog open={onAccountDialog} onOpenChange={(o) => { if (!o) setOnAccountDialog(false); }}>
          <DialogContent className={`max-w-2xl ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-1.5"><Wallet size={16} /> Submit on-account deposit</DialogTitle>
              <DialogDescription className="text-xs">Goes to Finance's Received Payment queue. Once approved it's held as credit and applied to the next due milestone, in order.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Amount (₹) *</label>
                <input type="number" min={0} value={onAccountForm.Amount} onChange={(e) => setOnAccountForm((f) => ({ ...f, Amount: e.target.value }))} className={`${INP} font-semibold tabular-nums`} />
              </div>
              <div>
                <label className={LABEL}>Received date</label>
                <DateInput value={onAccountForm.ReceivedDate} max={todayStr()} onChange={(e) => setOnAccountForm((f) => ({ ...f, ReceivedDate: e.target.value }))} className={INP} />
              </div>
              <div>
                <label className={LABEL}>Payment mode</label>
                {modeSelect(onAccountForm.PaymentMode, (mode) => setOnAccountForm((f) => ({ ...f, PaymentMode: mode, BankName: modeHasBank(mode) ? f.BankName : "" })))}
              </div>
              {modeHasBank(onAccountForm.PaymentMode) && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Customer's bank</label>
                  <BankNamePicker sheet value={onAccountForm.BankName} onChange={(v) => setOnAccountForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
                </div>
              )}
              <div className={modeHasBank(onAccountForm.PaymentMode) ? "col-span-2" : "col-span-2 sm:col-span-3"}>
                <label className={LABEL}>Transaction ref</label>
                <input type="text" value={onAccountForm.TransactionRef} placeholder="UTR / cheque / reference no." onChange={(e) => setOnAccountForm((f) => ({ ...f, TransactionRef: e.target.value }))} className={INP} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL}>Notes</label>
                <textarea value={onAccountForm.Notes} onChange={(e) => setOnAccountForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} placeholder="Optional note for Finance…" className={TEXTAREA} />
              </div>
            </div>
            {depositNote}
            <DialogFooter className="gap-2">
              <button onClick={() => setOnAccountDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleDepositOnAccount} disabled={saving || !onAccountForm.Amount} className={`${KEY_INK} h-9 px-4`}>{saving ? "Submitting…" : "Submit for approval"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Apply on-account to a milestone */}
        <Dialog open={!!applyDialog} onOpenChange={(o) => { if (!o) setApplyDialog(null); }}>
          <DialogContent className={`max-w-sm ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><Wallet size={16} /> Apply on-account to a milestone</DialogTitle></DialogHeader>
            {applyDialog && (() => {
              const remaining = Number(applyDialog.payment.Amount) - Number(applyDialog.payment.AppliedAmount || 0);
              const unpaid = canManuallyApplyOnAccount && nextOutstandingMilestone ? [nextOutstandingMilestone] : [];
              const chosenMil = applyDialog.milestone ?? milestones.find((m: any) => m.Id === parseInt(applyMilestoneId));
              const milBalance = chosenMil ? Number(chosenMil.AmountDue) - Number(chosenMil.AmountPaid || 0) : 0;
              const chosenTargetEligible = canManuallyApplyOnAccount && !!chosenMil && chosenMil.Id === nextOutstandingMilestone?.Id;
              return (
                <>
                  <div className="p-3 text-sm" style={{ border: RULE_SOFT }}>
                    <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Payment</span><span className="font-heading font-semibold tabular-nums">{applyDialog.payment.ReceiptNo}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Total received</span><span className="font-heading tabular-nums">{fmt(applyDialog.payment.Amount)}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Available to apply</span><span className="font-heading font-bold tabular-nums">{fmt(remaining)}</span></div>
                  </div>
                  {applyDialog.milestone ? (
                    <div>
                      <p className={LABEL}>Applying to</p>
                      <div className="px-3 py-2.5 text-sm font-medium" style={{ border: RULE_SOFT }}>
                        {applyDialog.milestone.MilestoneName}
                        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">({fmt(milBalance)} outstanding)</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={LABEL}>Apply to milestone *</label>
                      <select value={applyMilestoneId} className={INP} onChange={(e) => {
                        const val = e.target.value;
                        setApplyMilestoneId(val);
                        const m = milestones.find((x: any) => String(x.Id) === val);
                        if (m) setApplyDialog((d) => (d ? { ...d, amount: String(Math.min(remaining, Number(m.AmountDue) - Number(m.AmountPaid || 0))) } : d));
                      }}>
                        <option value="">— select a milestone —</option>
                        {unpaid.map((m: any) => <option key={m.Id} value={String(m.Id)}>{`${m.MilestoneName} — ${fmt(Number(m.AmountDue) - Number(m.AmountPaid || 0))} due`}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={LABEL}>Amount to apply</label>
                    <input type="number" min="1" max={remaining} value={applyDialog.amount} onChange={(e) => setApplyDialog((d) => (d ? { ...d, amount: e.target.value } : d))} className={`${INP} tabular-nums`} />
                    {chosenMil && milBalance > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                        Outstanding {fmt(milBalance)} · available {fmt(remaining)}
                        {parseFloat(applyDialog.amount) >= milBalance && <span className="text-foreground font-medium ml-1">— settles this milestone in full</span>}
                      </p>
                    )}
                  </div>
                  {chosenMil && !chosenTargetEligible && (
                    <p className="text-xs text-destructive">
                      {notFullyPaid ? `${fmt(fullPaymentShortfall)} more in valid payments is needed before anything settles.`
                        : nextOutstandingMilestone?.DemandStatus === CrmStatus.PENDING ? `Raise the Demand for ${nextOutstandingMilestone.MilestoneName} first.`
                        : "Only the next outstanding milestone can take on-account money."}
                    </p>
                  )}
                  <DialogFooter className="gap-2">
                    <button onClick={() => setApplyDialog(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                    <button onClick={handleConfirmApply} disabled={saving || !applyDialog.amount || (!applyDialog.milestone && !applyMilestoneId) || !chosenTargetEligible} className={`${KEY_INK} h-9 px-4`}>
                      {saving ? "Applying…" : `Apply ${applyDialog.amount ? fmt(parseFloat(applyDialog.amount)) : ""}`}
                    </button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Waive */}
        <Dialog open={!!waiveDialog} onOpenChange={(o) => { if (!o) setWaiveDialog(null); }}>
          <DialogContent className={`max-w-sm ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><AlertTriangle size={16} className="text-destructive" /> Waive milestone</DialogTitle></DialogHeader>
            {waiveDialog && (
              <>
                <p className="text-sm text-muted-foreground">
                  Waiving <span className="font-semibold text-foreground">{waiveDialog.milestone.MilestoneName}</span> (<span className="font-heading tabular-nums">{fmt(waiveDialog.milestone.AmountDue)}</span>) clears it without payment. This can't be undone.
                </p>
                <div>
                  <label className={LABEL}>Reason *</label>
                  <textarea value={waiveDialog.reason} onChange={(e) => setWaiveDialog((d) => (d ? { ...d, reason: e.target.value } : d))} rows={3} autoFocus
                    placeholder="e.g. Discount approved by management, PLC waiver agreed in negotiation…" className={TEXTAREA} />
                </div>
                <DialogFooter className="gap-2">
                  <button onClick={() => setWaiveDialog(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                  <button onClick={handleWaiveConfirm} disabled={waiving || !waiveDialog.reason.trim()} className={`${KEY_INK} h-9 px-4 !bg-destructive !border-destructive`}>{waiving ? "Waiving…" : "Waive milestone"}</button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Remarks */}
        <Dialog open={!!remarksDialog} onOpenChange={(o) => { if (!o) setRemarksDialog(null); }}>
          <DialogContent className={`max-w-sm ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><MessageSquare size={15} /> Payment remarks</DialogTitle></DialogHeader>
            {remarksDialog && (
              <>
                <p className="text-xs text-muted-foreground tabular-nums">{remarksDialog.milestone.MilestoneName} · {fmtDate(remarksDialog.milestone.PaidDate)}</p>
                <p className="text-sm p-3 leading-relaxed" style={{ border: RULE_SOFT }}>{remarksDialog.milestone.Remarks}</p>
                <DialogFooter><button onClick={() => setRemarksDialog(null)} className={`${KEY_LINE} h-9 px-4`}>Close</button></DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmPaymentMilestones;
