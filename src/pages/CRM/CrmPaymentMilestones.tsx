import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, ExternalLink, Hourglass, Landmark, ListChecks, MessageSquare, Plus, Receipt, RefreshCw, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import { DateInput } from "@/components/ui/date-input";
import {
  CrmGrid, GridColumnChooser, GridGuidance, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToggleChip,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import {
  API, BKG_API, PAY_MODES, modeHasBank, fmt, fmtDate, fmtShort, todayStr, isOverdue, milestoneFill, nextOpenMilestone, pct,
  fetchLedger, fetchLedgerExport, fetchLedgerSummary, fetchMilestones, fetchMoneyReceipts, fetchOnAccount, fetchProjectBanks, fetchCustomerBank,
  type DeskTab, type LedgerRow,
} from "./payments/config";
import { BAND_DOT, CollectionBar, EntryTable, LEDGER_COLS, MilestoneTable, MoneyBand, MoneyTrail, OnAccountPanel, PlanRibbon, PriceTable, TokenNote } from "./payments/parts";

const { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } = GRID_SHEET_KEYS;
const LABEL = `block mb-1.5 ${LBL}`;
const DIALOG = "p-5 gap-4";
const PREFS_KEY = "crm-payments-queue-cols-v5";
const BAND_KEY = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-white/25 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50";
const BAND_KEY_MAIN = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-white text-xs font-semibold text-slate-900 hover:bg-slate-100";
const VIEWS_KEY = "crm-payments-queue-views";
const DESK_TABS: { key: DeskTab; label: string }[] = [
  { key: "everything", label: "All bookings" }, { key: "all", label: "Live" }, { key: "attention", label: "Needs action" }, { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Due in 30 days" }, { key: "finance", label: "Pending with Finance" }, { key: "recorded", label: "Not sent to Finance" },
  { key: "collected", label: "Fully received" }, { key: "closed", label: "Closed" },
];

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

  // The work queue: one page of bookings from the server, what needs action first. The figures are their own call, so
  // paging and sorting never work them out again.
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: { key: "Priority", dir: "desc" } });
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, LEDGER_COLS);
  const [tab, setTabRaw] = useState<DeskTab>("everything");
  const [age, setAgeRaw] = useState("");
  const setTab = (t: DeskTab) => { setTabRaw(t); setAgeRaw(""); list.setPage(1); };
  const setAge = (k: string) => { setAgeRaw(k); list.setPage(1); };
  const [exporting, setExporting] = useState(false);
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null);
  const deskParams = useMemo(() => {
    const p = listParams(list.query, "All");
    p.delete("status");
    p.set("focus", tab);
    if (age) p.set("age", age);
    return p;
  }, [list.query, tab, age]);
  const scopeParams = useMemo(() => {
    const p = new URLSearchParams();
    if (list.query.search) p.set("search", list.query.search);
    if (list.query.companyId) p.set("companyId", list.query.companyId);
    if (list.query.projectId) p.set("projectId", list.query.projectId);
    if (list.query.blockId) p.set("blockId", list.query.blockId);
    return p;
  }, [list.query.search, list.query.companyId, list.query.projectId, list.query.blockId]);
  const { data: ledgerData, isLoading: ledgerLoading, isFetching: ledgerFetching, error: ledgerError, refetch: refetchLedger } = useQuery({
    queryKey: ["crm-payments-ledger", "rows", deskParams.toString()],
    queryFn: () => fetchLedger(deskParams),
    enabled: !selectedBookingId,
    staleTime: 30_000,
  });
  const { data: ledgerSummary, refetch: refetchSummary } = useQuery({
    queryKey: ["crm-payments-ledger", "summary", scopeParams.toString()],
    queryFn: () => fetchLedgerSummary(scopeParams),
    enabled: !selectedBookingId,
    staleTime: 60_000,
  });
  const ledger = useSticky(ledgerData);
  const figures = useSticky(ledgerSummary);
  const queueRows = ledger?.rows ?? [];
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(deskParams);
      p.delete("page"); p.delete("pageSize");
      exportGrid(await fetchLedgerExport(p), LEDGER_COLS, `payment-milestones-${tab}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const openBooking = (id: number) => { setActiveMilestone(null); setSp({ bookingId: String(id) }); };
  const closeBooking = () => { setActiveMilestone(null); setSp({}); };
  // Walking the queue: the next booking in the same order, without going back to the list.
  const queueAt = queueRows.findIndex((r) => String(r.BookingId) === selectedBookingId);
  const pickMilestone = (m: any) => {
    setActiveMilestone(m.Id);
    requestAnimationFrame(() => document.getElementById(`milestone-${m.Id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

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
  // The booking's money by stage, from the server (verified / with Finance / still to collect).
  const money = milestoneData?.money || null;

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

  const reloadMilestones = () => {
    qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    qc.invalidateQueries({ queryKey: ["crm-payments-ledger"] });
  };

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
      reloadMilestones();
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

  // What the plan needs next, in one sentence.
  const planOverdue = milestones.filter(isOverdue).length;
  const nextUp = nextOpenMilestone(milestones);
  const nextSentence = (() => {
    if (!money || !milestones.length) return null;
    if (!nextUp) return notFullyPaid ? `All milestones are covered, including ${fmt(money.inVerification + money.recorded)} pending Finance approval.` : "Full booking amount received. Deposits are adjusted to the milestones automatically, in order.";
    return `Next: ${nextUp.MilestoneName}, balance ${fmt(milestoneFill(nextUp).missing)}. Payments stay on account and are adjusted to the milestones once the full booking amount is received and approved.`;
  })();

  const openDeposit = () => {
    setOnAccountForm((f) => ({ ...f, ReceivedDate: f.ReceivedDate || todayStr(), DepositBankId: projectBanks.length === 1 ? String(projectBanks[0].BId) : f.DepositBankId }));
    setOnAccountDialog(true);
  };
  const refreshQueue = () => { refetchLedger(); refetchSummary(); };
  const lateRungs = (figures?.ages || []).filter((a) => a.count > 0);

  const refreshOnBand = (onClick: () => void, busy: boolean) => (
    <button type="button" onClick={onClick} disabled={busy} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /></button>
  );
  const collectedAll = figures ? figures.settled + figures.held : 0;
  const receivedAll = figures ? collectedAll + figures.withFinance + figures.recorded : 0;

  const queue = (
    <div hidden={!!selectedBookingId} className="space-y-4">
      <MoneyBand eyebrow="CRM · Finance" title="Payment Milestones" sub="Receipts and balances across live bookings."
        actions={<><SentBackPanel chip />{refreshOnBand(refreshQueue, ledgerFetching)}</>}
        lead={fmtShort(receivedAll)} leadNote={figures ? `received of ${fmtShort(figures.totalDue)} · ${pct(receivedAll, figures.totalDue)}%` : ""}
        bar={<CollectionBar onDark due={figures?.totalDue || 0} collected={collectedAll} finance={figures?.withFinance || 0} recorded={figures?.recorded || 0}
          title={figures ? `Total due ${fmt(figures.totalDue)} · Adjusted ${fmt(figures.settled)} · On account ${fmt(figures.held)}` : undefined} />}
        figures={[
          { label: "Approved by Finance", dot: BAND_DOT.collected, value: fmtShort(collectedAll), note: `${fmtShort(figures?.held)} on account`, exact: figures ? `Adjusted ${fmt(figures.settled)} · On account ${fmt(figures.held)}` : undefined },
          { label: "Pending with Finance", dot: BAND_DOT.finance, value: fmtShort(figures?.withFinance), note: `${figures?.counts.finance ?? 0} booking${figures?.counts.finance === 1 ? "" : "s"}`, exact: fmt(figures?.withFinance) },
          { label: "Not sent to Finance", dot: BAND_DOT.recorded, value: fmtShort(figures?.recorded), note: `${figures?.counts.recorded ?? 0} booking${figures?.counts.recorded === 1 ? "" : "s"}`, exact: fmt(figures?.recorded) },
          { label: "Balance to collect", dot: BAND_DOT.notDue, value: fmtShort(figures?.toCollect), note: "Yet to be received", exact: fmt(figures?.toCollect) },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<DeskTab> label="Queues" active={tab} onChange={setTab}
          tabs={DESK_TABS.map((t) => ({ ...t, count: figures ? figures.counts[t.key] : null }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, mobile, booking or unit" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {tab === "overdue" && lateRungs.map((a) => (
            <GridToggleChip key={a.key} label={a.label} count={a.count} on={age === a.key} onChange={(on) => setAge(on ? a.key : "")} />
          ))}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey={VIEWS_KEY}
              current={{ status: "All", search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize, extra: { tab, age } }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply(v);
                const x = (v.extra ?? {}) as { tab?: DeskTab; age?: string };
                setTabRaw(x.tab && DESK_TABS.some((t) => t.key === x.tab) ? x.tab : "everything");
                setAgeRaw(x.age || "");
              }} />
            <GridColumnChooser cols={LEDGER_COLS} prefs={prefs} onChange={setPrefs} />
            <button type="button" onClick={handleExport} disabled={exporting || !ledger?.total} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        <CrmGrid cols={LEDGER_COLS} prefs={prefs} onPrefs={setPrefs} rows={queueRows} rowKey={(r) => r.BookingId} noRowNumbers
          loading={ledgerLoading} fetching={ledgerFetching} error={ledgerError ? translateError((ledgerError as Error).message) : null} onRetry={() => refetchLedger()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openBooking(r.BookingId)} activeKey={selectedBookingId ? Number(selectedBookingId) : null}
          empty={list.hasFilters || age ? "No booking matches these filters." : "No bookings here."}
          page={list.page} pageSize={pageSize} total={ledger?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>
    </div>
  );

  const accountCount = onAccountData?.payments?.length || 0;
  const financeRows = money?.entries || [];
  const returnedRows = money?.returned || [];
  const received = (money?.collected || 0) + (money?.inVerification || 0) + (money?.recorded || 0);

  const record = isLoading ? (
    <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading the plan…</div>
  ) : isError ? (
    <div className="py-16 text-center text-destructive text-sm">Could not load the plan{milestoneError instanceof Error ? `: ${translateError(milestoneError.message)}` : ""}</div>
  ) : !milestoneData || !booking ? (
    <div className="py-16 text-center text-muted-foreground text-sm">This booking was not found.</div>
  ) : (
    <>
      <MoneyBand eyebrow={`Payment plan · ${booking.BookingNo}`}
        title={<ApplicantNames name={booking.ApplicantName} bookingId={Number(selectedBookingId)} />}
        sub={<span className="tabular-nums">{booking.UnitNo}{booking.ProjectName ? ` · ${booking.ProjectName}` : ""}{booking.Mobile ? ` · ${booking.Mobile}` : ""}</span>}
        status={booking.BookingStatus ? <span className="inline-flex items-center h-5 px-2 rounded-full border border-white/25 text-[0.6875rem] font-medium text-slate-200">{booking.BookingStatus}</span> : undefined}
        actions={
          <>
            <button type="button" onClick={closeBooking} className={BAND_KEY}><ArrowLeft size={13} /> All bookings</button>
            {queueAt >= 0 && (
              <span className="inline-flex items-center gap-1">
                <button type="button" onClick={() => openBooking(queueRows[queueAt - 1].BookingId)} disabled={queueAt === 0} className={cn(BAND_KEY, "w-9 !px-0")} title="Previous booking in the queue" aria-label="Previous booking in the queue"><ChevronLeft size={14} /></button>
                <span className="text-xs text-slate-400 tabular-nums px-1">{queueAt + 1} of {queueRows.length}</span>
                <button type="button" onClick={() => openBooking(queueRows[queueAt + 1].BookingId)} disabled={queueAt === queueRows.length - 1} className={cn(BAND_KEY, "w-9 !px-0")} title="Next booking in the queue" aria-label="Next booking in the queue"><ChevronRight size={14} /></button>
              </span>
            )}
            <Link to={`/crm/bookings?view=${selectedBookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open booking</Link>
            {rights.canEdit && needsResync && (
              <button type="button" onClick={handleResyncSchedule} disabled={resyncing} className={BAND_KEY}>
                <RefreshCw size={13} className={resyncing ? "animate-spin" : ""} /> {resyncing ? "Resyncing…" : "Resync schedule"}
              </button>
            )}
            {rights.canCreate && <button type="button" onClick={() => setAddDialog(true)} className={BAND_KEY}><Plus size={13} /> Add milestone</button>}
            {rights.canCreate && <button type="button" onClick={openDeposit} className={BAND_KEY_MAIN}><Wallet size={13} /> Deposit on account</button>}
            {refreshOnBand(() => refetch(), isFetching)}
          </>
        }
        lead={fmtShort(received)} leadNote={`received of ${fmtShort(summary.totalDue)} · ${pct(received, summary.totalDue || 0)}%`}
        bar={<PlanRibbon onDark plan={milestones} activeId={activeMilestone} onPick={pickMilestone} />}
        figures={[
          { label: "Approved by Finance", dot: BAND_DOT.collected, value: fmtShort(money?.collected), note: `${fmtShort(money?.held)} on account`, exact: `Adjusted ${fmt(money?.adjusted)} · On account ${fmt(money?.held)}` },
          { label: "Pending with Finance", dot: BAND_DOT.finance, value: fmtShort(money?.inVerification), note: money?.inVerificationCount ? `${money.inVerificationCount} pending` : "None pending", exact: fmt(money?.inVerification) },
          { label: "Not sent to Finance", dot: BAND_DOT.recorded, value: fmtShort(money?.recorded), note: "Sent on Director approval", exact: fmt(money?.recorded) },
          { label: "Balance to collect", dot: BAND_DOT.notDue, value: fmtShort(money?.toCollect), note: "Yet to be received", exact: fmt(money?.toCollect) },
        ]}
        footer={nextSentence} />
      {needsResync && (
        <GridGuidance tone="stopped" title={!milestone1 ? "No Booking Amount milestone" : "Milestone 1 doesn't match the booking amount"}
          text={!milestone1
            ? "Resync the schedule to generate it; schedule rows that already exist are kept for review."
            : <>Milestone 1 ({fmt(milestone1.AmountDue)}) doesn't match this booking's booking amount ({fmt(booking.BookingAmount)}). Resync the schedule to fix it and redistribute the remaining milestones.</>} />
      )}
      <TokenNote booking={booking} moneyReceipts={moneyReceipts as any[]} />
      <GridRelated icon={Wallet} title="Receipts" count={money?.trail?.rows?.length || 0}>
        <MoneyTrail trail={money?.trail} totalDue={summary.totalDue || 0} />
      </GridRelated>
      <GridRelated icon={ListChecks} title="Payment schedule" count={milestones.length}>
        <MilestoneTable milestones={milestones} canEdit={rights.canEdit} onAccountData={onAccountData} onAccountBalance={onAccountBalance}
          notFullyPaid={notFullyPaid} fullPaymentShortfall={fullPaymentShortfall} activeId={activeMilestone}
          nextMilestone={nextOutstandingMilestone} canManuallyApply={canManuallyApplyOnAccount}
          onPay={handleOpenPayment} onApply={openApplyDialog} onWaive={(m) => setWaiveDialog({ milestone: m, reason: "" })} onRemarks={(m) => setRemarksDialog({ milestone: m })} />
      </GridRelated>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
        <GridRelated icon={Landmark} title="On-account deposits" count={accountCount}>
          <OnAccountPanel onAccountData={onAccountData} notFullyPaid={notFullyPaid}
            fundsOnHand={bookingFundsOnHand} requiredAmount={bookingRequiredAmount} fullPaymentShortfall={fullPaymentShortfall}
            inVerification={money?.inVerification || 0}
            milestones={milestones} canManuallyApply={canManuallyApplyOnAccount}
            canEdit={rights.canEdit} onApply={(p) => openApplyDialog(p, null)} />
        </GridRelated>
        <GridRelated icon={Receipt} title="Price"><PriceTable booking={booking} /></GridRelated>
      </div>
      {financeRows.length > 0 && <GridRelated icon={Hourglass} title="Pending with Finance" count={financeRows.length}><EntryTable rows={financeRows} /></GridRelated>}
      {returnedRows.length > 0 && <GridRelated icon={AlertTriangle} title="Rejected by Finance" count={returnedRows.length}><EntryTable rows={returnedRows} returned /></GridRelated>}
    </>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Payments"]} />
      <div className="space-y-4">
        {/* The queue stays mounted while a plan is open, so its tab, search, filters, sort and page survive the round trip. */}
        {queue}
        {selectedBookingId && record}
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
                  <Wallet size={12} className="shrink-0" /> {fmt(previewOverflow)} above the amount due. It stays On Account when approved.
                </p>
              )}
              {modeHasBank(payForm.PaymentMode) && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Customer's bank</label>
                  <BankNamePicker value={payForm.BankName} onChange={(v) => setPayForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
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
                  <BankNamePicker value={onAccountForm.BankName} onChange={(v) => setOnAccountForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
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
                        {parseFloat(applyDialog.amount) >= milBalance && <span className="text-foreground font-medium ml-1">— adjusts this milestone in full</span>}
                      </p>
                    )}
                  </div>
                  {chosenMil && !chosenTargetEligible && (
                    <p className="text-xs text-destructive">
                      {notFullyPaid ? `${fmt(fullPaymentShortfall)} more is needed before deposits are adjusted to the milestones.`
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
    </>
  );
};

export default CrmPaymentMilestones;
