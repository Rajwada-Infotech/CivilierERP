import { CrmStatus, isBookingClosed } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Hourglass, Landmark, ListChecks, MessageSquare, Plus, Receipt, RefreshCw, Send, Undo2, Wallet } from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import { DateInput } from "@/components/ui/date-input";
import {
  CrmGrid, GridColumnChooser, GridDialog, GridGuidance, GridRelated, GridSavedViews, GridSearch, GridStatusPill, GridTabs, GridToggleChip,
  exportGrid, useGridPrefs, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import {
  API, BKG_API, PAY_MODES, RIBBON, modeHasBank, fmt, fmtDate, fmtShort, todayStr, milestoneFill, nextOpenMilestone, pct,
  fetchLedger, fetchLedgerExport, fetchLedgerSummary, fetchMilestones, fetchMoneyReceipts, fetchOnAccount, fetchCustomerBank,
  type DeskTab,
  pendingWaiverIds, planCoverage,
} from "./payments/config";
import { BookingReminders } from "./CrmReminderSetup";
import { MATRIX_BTN, MATRIX_BTN_BRAND } from "./matrix/shared";
import {
  CollectionBar, EntryTable, Initials, LEDGER_COLS, LedgerMobileCard, MilestoneTable, MoneyTrail,
  OnAccountPanel, PlanRibbon, PriceTable, RibbonLegend, TONE_AMBER_TEXT, TONE_EMERALD_TEXT, TONE_ROSE_TEXT,
  TONE_SKY_TEXT, TokenNote, WaiverSection,
} from "./payments/parts";

const { INP, KEY_INK, KEY_LINE, LBL, TEXTAREA } = GRID_SHEET_KEYS;
const LABEL = `block mb-1.5 ${LBL}`;
const roundPaise = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isMoneyAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7;
};
const PREFS_KEY = "crm-payments-queue-cols-v5";
const VIEWS_KEY = "crm-payments-queue-views";
const DESK_TABS: { key: DeskTab; label: string }[] = [
  { key: "everything", label: "All bookings" }, { key: "all", label: "Live" }, { key: "attention", label: "Needs action" }, { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Due in 30 days" }, { key: "finance", label: "Pending with Finance" }, { key: "recorded", label: "Awaiting booking approval" },
  { key: "collected", label: "Fully received" }, { key: "closed", label: "Closed" },
];

const CrmPaymentMilestones: React.FC = () => {
  const rights = usePageRights("crm-payments");
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const selectedBookingId = sp.get("bookingId") || "";
  const [editingId, setEditingId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState({ AmountPaid: "", PaidDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Remarks: "" });
  const [saving, setSaving] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
  const [onAccountDialog, setOnAccountDialog] = useState(false);
  const [onAccountForm, setOnAccountForm] = useState({ Amount: "", ReceivedDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Notes: "" });
  const [applyDialog, setApplyDialog] = useState<{ payment: any; milestone: any | null; amount: string } | null>(null);
  const [applyMilestoneId, setApplyMilestoneId] = useState<string>("");
  const [waiveDialog, setWaiveDialog] = useState<{ milestone: any; reason: string } | null>(null);
  const [demandDialog, setDemandDialog] = useState<{ milestone: any; notes: string } | null>(null);
  const [undoDemandDialog, setUndoDemandDialog] = useState<any | null>(null);
  const [remarksDialog, setRemarksDialog] = useState<{ milestone: any } | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [raisingDemand, setRaisingDemand] = useState(false);
  const [undoingDemand, setUndoingDemand] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  type RecordTab = "schedule" | "trail" | "wallet" | "approvals" | "terms";
  const [recordTab, setRecordTab] = useState<RecordTab>("schedule");

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
  const { data: ledgerSummary, isFetching: summaryFetching, error: summaryError, refetch: refetchSummary } = useQuery({
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
  const clearQueueFilters = () => { list.reset(); setTabRaw("everything"); setAgeRaw(""); };
  const hasQueueFilters = list.hasFilters || !!age || tab !== "everything";
  const exportBookingSchedule = () => {
    const cols: GridCol<any>[] = [
      { id: "no", label: "#", cell: () => null, csv: (m) => m.MilestoneNo },
      { id: "name", label: "Milestone", cell: () => null, csv: (m) => m.MilestoneName },
      { id: "dueDate", label: "Due Date", cell: () => null, csv: (m) => (m.DueDate ? String(m.DueDate).slice(0, 10) : "") },
      { id: "amountDue", label: "Amount Due", cell: () => null, csv: (m) => m.AmountDue },
      { id: "adjusted", label: "Adjusted", cell: () => null, csv: (m) => m.AmountPaid || 0 },
      { id: "held", label: "On Account", cell: () => null, csv: (m) => m.HeldOnAccount || 0 },
      { id: "finance", label: "With Finance", cell: () => null, csv: (m) => m.WithFinanceCover || 0 },
      { id: "balance", label: "Balance", cell: () => null, csv: (m) => milestoneFill(m).missing },
      { id: "demand", label: "Demand", cell: () => null, csv: (m) => (m.DemandNo ? `${m.DemandStatus} (${m.DemandNo})` : m.DemandStatus || "") },
      { id: "status", label: "Status", cell: () => null, csv: (m) => m.Status },
    ];
    exportGrid(milestones, cols, `${booking?.BookingNo || selectedBookingId}-payment-schedule`);
  };
  const exportMoneyTrail = () => {
    const rows: any[] = money?.trail?.rows || [];
    const cols: GridCol<any>[] = [
      { id: "date", label: "Date", cell: () => null, csv: (r) => (r.date ? String(r.date).slice(0, 10) : "") },
      { id: "docs", label: "Documents", cell: () => null, csv: (r) => (r.docs?.length ? r.docs.join(" -> ") : r.note || "") },
      { id: "milestone", label: "Milestone", cell: () => null, csv: (r) => r.milestone || "" },
      { id: "mode", label: "Mode", cell: () => null, csv: (r) => r.mode || "" },
      { id: "ref", label: "Reference", cell: () => null, csv: (r) => r.ref || "" },
      { id: "amount", label: "Gross Amount", cell: () => null, csv: (r) => r.amount || 0 },
      { id: "settled", label: "Adjusted", cell: () => null, csv: (r) => r.settled || 0 },
      { id: "held", label: "On Account", cell: () => null, csv: (r) => r.held || 0 },
      { id: "refunded", label: "Refunded", cell: () => null, csv: (r) => r.refunded || 0 },
      { id: "stage", label: "Stage", cell: () => null, csv: (r) => r.stage || "" },
    ];
    exportGrid(rows, cols, `${booking?.BookingNo || selectedBookingId}-collection-trail`);
  };
  const openBooking = (id: number) => { setActiveMilestone(null); setRecordTab("schedule"); setSp({ bookingId: String(id) }); };
  const closeBooking = () => { setActiveMilestone(null); setRecordTab("schedule"); setSp({}); };
  // Walking the queue: the next booking in the same order, without going back to the list.
  const queueAt = queueRows.findIndex((r) => String(r.BookingId) === selectedBookingId);
  const pickMilestone = (m: any) => {
    setRecordTab("schedule");
    setActiveMilestone(m.Id);
    requestAnimationFrame(() => {
      const compact = document.getElementById(`milestone-${m.Id}`);
      const target = compact?.getClientRects().length ? compact : document.getElementById(`milestone-desktop-${m.Id}`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const { data: milestoneData, isLoading, isError, error: milestoneError, isFetching, refetch } = useQuery({
    queryKey: ["crm-milestones", selectedBookingId],
    queryFn: () => fetchMilestones(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 30_000,
    retry: 1,
  });
  const { data: onAccountData, isLoading: onAccountLoading, error: onAccountError, refetch: refetchOnAccount } = useQuery({ queryKey: ["crm-on-account", selectedBookingId], queryFn: () => fetchOnAccount(selectedBookingId), enabled: !!selectedBookingId, staleTime: 15_000 });
  const { data: moneyReceipts, isLoading: receiptsLoading, error: receiptsError, refetch: refetchMoneyReceipts } = useQuery({ queryKey: ["crm-money-receipts", selectedBookingId], queryFn: () => fetchMoneyReceipts(selectedBookingId), enabled: !!selectedBookingId, staleTime: 15_000 });
  const { data: customerBank, isLoading: customerBankLoading, error: customerBankError, refetch: refetchCustomerBank } = useQuery({ queryKey: ["crm-customer-bank", selectedBookingId], queryFn: () => fetchCustomerBank(selectedBookingId), enabled: !!selectedBookingId && modeHasBank(payForm.PaymentMode), staleTime: 30_000 });
  const { data: bookingUnitChange, error: unitChangeError, isFetching: unitChangeFetching, refetch: refetchUnitChange } = useQuery({
    queryKey: ["crm-booking-unit-change", selectedBookingId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${BKG_API}/${selectedBookingId}/unit-change`);
      if (!res.ok) throw new Error("Could not load the unit change");
      const data = await res.json().catch(() => undefined);
      const requestId = data?.Id;
      const validRequestId = (typeof requestId === "number" && Number.isFinite(requestId))
        || (typeof requestId === "string" && requestId.trim() !== "" && Number.isFinite(Number(requestId)));
      if (data !== null && (!data || typeof data !== "object" || !validRequestId)) {
        throw new Error("The unit-change response was invalid.");
      }
      return data;
    },
    enabled: !!selectedBookingId,
    staleTime: 30_000,
  });

  const milestones: any[] = milestoneData?.milestones || [];
  const summary = milestoneData?.summary || {};
  const booking = milestoneData?.booking || null;
  const unitChanged = booking?.BookingStatus === "UnitChanged";
  const bookingClosed = isBookingClosed(booking?.BookingStatus);
  const unitChangeMissing = unitChanged && !bookingUnitChange && !unitChangeFetching && !unitChangeError;
  const { data: destinationCreditData, error: destinationCreditError, isFetching: destinationCreditFetching, refetch: refetchDestinationCredit } = useQuery({
    queryKey: ["crm-unit-change-destination-credit", bookingUnitChange?.TargetBookingId],
    queryFn: () => fetchOnAccount(String(bookingUnitChange.TargetBookingId)),
    enabled: unitChanged && !!bookingUnitChange?.TargetBookingId,
    staleTime: 15_000,
  });
  const onAccountBalance = onAccountData?.availableBalance || 0;
  const onAccountKnown = !!onAccountData && !onAccountLoading && !onAccountError;
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
    onAccountKnown && !notFullyPaid && nextOutstandingMilestone && nextMilestoneBalance > 0 &&
    nextOutstandingMilestone.DemandStatus !== CrmStatus.PENDING
  );
  // The booking's money by stage, from the server (verified / with Finance / still to collect).
  const money = milestoneData?.money || null;

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
    });
  };

  const handleRaiseDemandConfirm = async () => {
    if (!demandDialog) return;
    setRaisingDemand(true);
    try {
      const res = await fetchWithAuth(`${API}/${demandDialog.milestone.Id}/demand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Notes: demandDialog.notes.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not raise demand");
      toast.success(
        data.settled > 0
          ? `Demand ${data.DemandNo || "raised"} — ${data.settled} milestone${data.settled === 1 ? "" : "s"} auto-adjusted from On-Account`
          : `Demand raised${data.DemandNo ? `: ${data.DemandNo}` : ""}`,
      );
      setDemandDialog(null);
      reloadMilestones();
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRaisingDemand(false); }
  };

  const handleUndoDemandConfirm = async () => {
    if (!undoDemandDialog) return;
    setUndoingDemand(true);
    try {
      const res = await fetchWithAuth(`${API}/${undoDemandDialog.Id}/demand/undo`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not undo demand");
      toast.success("Demand reverted back to Pending");
      setUndoDemandDialog(null);
      reloadMilestones();
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUndoingDemand(false); }
  };

  const handleResubmitReturned = (entry: any) => {
    const matched = entry.milestone
      ? milestones.find((m) => m.MilestoneName === entry.milestone && m.Status !== CrmStatus.PAID && m.Status !== "Waived")
      : null;
    if (matched) {
      setEditingId(matched.Id);
      setPayForm({
        AmountPaid: entry.amount != null ? String(entry.amount) : "",
        PaidDate: todayStr(),
        PaymentMode: entry.mode || "",
        BankName: "",
        TransactionRef: "",
        Remarks: `Corrected entry${entry.docNo ? ` (replaces ${entry.docNo})` : ""}`,
      });
      return;
    }
    setOnAccountForm({
      Amount: entry.amount != null ? String(entry.amount) : "",
      ReceivedDate: todayStr(),
      PaymentMode: entry.mode || "",
      BankName: "",
      TransactionRef: "",
      Notes: `Corrected entry${entry.docNo ? ` (replaces ${entry.docNo})` : ""}`,
    });
    setOnAccountDialog(true);
  };

  const handleWaiveConfirm = async () => {
    if ((waiveDialog?.reason.trim().length || 0) < 10) return;
    setWaiving(true);
    try {
      const res = await fetchWithAuth(`${API}/${waiveDialog.milestone.Id}/waive`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Reason: waiveDialog.reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success("Waiver sent for approval. The milestone stays due until it is approved.");
      setWaiveDialog(null);
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setWaiving(false); }
  };

  const handleRecordPayment = async () => {
    if (editingId == null) return;
    if (!(isMoneyAmount(enteredPaid) && enteredPaid > 0)) { toast.error("Enter a valid amount received in rupees and paise"); return; }
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
    if (!isMoneyAmount(amountDue) || amountDue <= 0) {
      toast.error("Enter an Amount Due greater than zero, using up to two decimal places");
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
    if (!selectedBookingId || !isMoneyAmount(onAccountForm.Amount) || !(Number(onAccountForm.Amount) > 0)) { toast.error("Enter a valid amount received in rupees and paise"); return; }
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
      setOnAccountForm({ Amount: "", ReceivedDate: "", PaymentMode: "", BankName: "", TransactionRef: "", Notes: "" });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
      reloadMilestones();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const openApplyDialog = (payment: any, milestone: any | null) => {
    const remaining = roundPaise(Number(payment.Amount) - Number(payment.AppliedAmount || 0));
    const milestoneBalance = milestone ? roundPaise(Number(milestone.AmountDue) - Number(milestone.AmountPaid || 0)) : remaining;
    setApplyMilestoneId(milestone ? String(milestone.Id) : "");
    setApplyDialog({ payment, milestone, amount: String(milestone ? Math.min(remaining, milestoneBalance) : remaining) });
  };

  const handleConfirmApply = async () => {
    if (!applyDialog) return;
    const milId = applyDialog.milestone?.Id ?? parseInt(applyMilestoneId);
    if (milId == null || Number.isNaN(milId)) { toast.error("Select a milestone to apply to"); return; }
    const amount = parseFloat(applyDialog.amount);
    if (!isMoneyAmount(amount) || amount <= 0) { toast.error("Enter a valid amount in rupees and paise"); return; }
    const target = applyDialog.milestone ?? milestones.find((m: any) => m.Id === milId);
    const available = roundPaise(Number(applyDialog.payment.Amount) - Number(applyDialog.payment.AppliedAmount || 0));
    const balance = target ? roundPaise(Number(target.AmountDue) - Number(target.AmountPaid || 0)) : 0;
    if (!target || amount > available || amount > balance) {
      toast.error("The amount must fit both the available deposit and milestone balance");
      return;
    }
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

  const modeSelect = (value: string, onChange: (mode: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INP}>
      <option value="">Select mode</option>
      {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
  const depositNote = (
    <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-2.5 flex items-start gap-2.5">
      <Landmark size={14} className="text-muted-foreground mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Deposit bank</span> — Accounts assigns the receiving bank on the Received Payment before approving.
      </p>
    </div>
  );

  // What the plan needs next, in one clear, accurate sentence.
  const nextUp = nextOpenMilestone(milestones);
  const nextSentence = (() => {
    if (!money || !milestones.length) return null;
    if (unitChanged) {
      return (
        <>
          This booking closed when the unit changed. Its {fmt(summary.totalDue)} payment schedule is historical, not due for collection here.{" "}
          {bookingUnitChange?.Id ? (
            <>
              <Link to={`/crm/unit-changes?id=${bookingUnitChange.Id}`} className="text-primary font-medium underline underline-offset-2">
                View {bookingUnitChange.RequestNo || "unit-change request"}
              </Link>
              {bookingUnitChange.TargetBookingId ? (
                <>
                  {" "}for the credit moved, and{" "}
                  <Link to={`/crm/payments?bookingId=${bookingUnitChange.TargetBookingId}`} className="text-primary font-medium underline underline-offset-2">
                    open the new booking
                  </Link>{" "}
                  for its current balance.
                </>
              ) : (
                " for its status and credit details."
              )}
            </>
          ) : unitChangeFetching ? (
            "Loading unit-change request details."
          ) : unitChangeError ? (
            "Unit-change request details could not be loaded."
          ) : (
            "No linked unit-change request was found; destination credit cannot be verified."
          )}
        </>
      );
    }
    if (bookingClosed) return "This booking is closed. Its payment schedule is shown for history; no further collection or adjustments can be made.";
    const onAccountHeld = Number(money.held || 0);
    const pendingPipeline = Number(money.inVerification || 0) + Number(money.recorded || 0);
    if (!nextUp) {
      return notFullyPaid
        ? `All milestones are covered, with ${fmt(pendingPipeline)} currently pending Finance verification.`
        : "Full booking amount received and approved. Held On-Account deposits adjust to demanded milestones automatically in schedule order.";
    }
    if (notFullyPaid) {
      return `Next: ${nextUp.MilestoneName} (balance ${fmt(milestoneFill(nextUp).missing)}). New receipts stay On Account${onAccountHeld > 0 ? ` (${fmt(onAccountHeld)} held)` : ""}${pendingPipeline > 0 ? `, plus ${fmt(pendingPipeline)} awaiting Finance` : ""} until full booking due (${fmt(money.totalDue)}) is received and approved.`;
    }
    if (nextUp.DemandStatus === CrmStatus.PENDING) {
      return `Full booking amount is covered — raise the Demand on ${nextUp.MilestoneName} first so held On-Account funds can adjust to it automatically.`;
    }
    return `Next: ${nextUp.MilestoneName} (balance ${fmt(milestoneFill(nextUp).missing)}). Full booking amount is covered — demanded milestones settle automatically from On-Account funds.`;
  })();

  const openDeposit = () => {
    setOnAccountForm((f) => ({ ...f, ReceivedDate: f.ReceivedDate || todayStr() }));
    setOnAccountDialog(true);
  };
  const refreshQueue = () => { refetchLedger(); refetchSummary(); };
  const lateRungs = (figures?.ages || []).filter((a) => a.count > 0);

  const collectedAll = figures ? figures.settled + figures.held : 0;
  const pipelineAll = figures ? roundPaise(figures.withFinance + figures.recorded) : 0;
  const notDueAll = figures ? Math.max(0, roundPaise(figures.toCollect - figures.overdue)) : 0;
  const receivedAll = figures ? collectedAll + figures.withFinance + figures.recorded : 0;
  const coverage = planCoverage(receivedAll, figures?.totalDue || 0, figures?.toCollect || 0);
  const coveragePct = figures ? pct(coverage.covered, figures.totalDue) : 0;

  const queue = (
    <div hidden={!!selectedBookingId} className="space-y-4">
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4 border-b border-border">
          <div className="flex items-start gap-3.5 min-w-0 flex-1 basis-72">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.6875rem] uppercase tracking-wider font-semibold text-muted-foreground">CRM · Finance</p>
                {figures && (
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold border border-emerald-500/30 bg-emerald-500/10 tabular-nums", TONE_EMERALD_TEXT)}>
                    {coveragePct}% received
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Payment Milestones</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Monitor scheduled receivables, Finance approvals, On-Account holds, and overdue risk across bookings.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SentBackPanel chip />
            <Link to="/crm/demands" className={MATRIX_BTN}><Send size={13} /> Demands Desk</Link>
            <button type="button" onClick={refreshQueue} disabled={ledgerFetching || summaryFetching} className={MATRIX_BTN} title="Refresh totals and bookings" aria-label="Refresh">
              <RefreshCw size={13} className={(ledgerFetching || summaryFetching) ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border bg-muted/15">
          <button type="button" onClick={() => setTab("everything")}
            title={figures ? `Total scheduled across filtered scope: ${fmt(figures.totalDue)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", tab === "everything" && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Total scheduled</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {figures ? fmtShort(figures.totalDue) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures ? `${coveragePct}% received · ${figures.counts.all} live booking${figures.counts.all === 1 ? "" : "s"}` : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab("collected")}
            title={figures ? `Adjusted ${fmt(figures.settled)} · On account ${fmt(figures.held)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", tab === "collected" && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Approved by Finance</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures ? TONE_EMERALD_TEXT : "text-muted-foreground")}>
              {figures ? fmtShort(collectedAll) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures ? `${fmtShort(figures.settled)} adjusted · ${fmtShort(figures.held)} held` : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab(figures && figures.withFinance > 0 ? "finance" : "recorded")}
            title={figures ? `Pending with Finance ${fmt(figures.withFinance)} · Not sent ${fmt(figures.recorded)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", (tab === "finance" || tab === "recorded") && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Verification pipeline</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures && pipelineAll > 0 ? TONE_AMBER_TEXT : "text-foreground")}>
              {figures ? fmtShort(pipelineAll) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {figures ? `${fmtShort(figures.withFinance)} Finance (${figures.counts.finance}) · ${fmtShort(figures.recorded)} pre-approval` : "Totals unavailable"}
            </p>
          </button>

          <button type="button" onClick={() => setTab(figures && figures.overdue > 0 ? "overdue" : "soon")}
            title={figures ? `Overdue ${fmt(figures.overdue)} · Upcoming ${fmt(notDueAll)}` : undefined}
            className={cn("px-5 py-3 text-left transition hover:bg-muted/35 min-w-0", (tab === "overdue" || tab === "soon") && "bg-primary/[0.04] shadow-[inset_0_-2px_0_hsl(var(--primary))]")}>
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Balance to collect</p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums", figures && figures.overdue > 0 ? TONE_ROSE_TEXT : "text-foreground")}>
              {figures ? fmtShort(figures.toCollect) : summaryFetching ? "Checking…" : "Unavailable"}
            </p>
            <p className={cn("text-[0.6875rem] tabular-nums", figures && figures.overdue > 0 ? TONE_ROSE_TEXT : "text-muted-foreground")}>
              {figures
                ? figures.overdue > 0
                  ? `${fmtShort(figures.overdue)} overdue (${figures.counts.overdue}) · ${fmtShort(notDueAll)} upcoming`
                  : `${fmtShort(notDueAll)} upcoming · ${figures.counts.soon} due 30d`
                : "Totals unavailable"}
            </p>
          </button>
        </div>

        <div className="px-5 py-3 space-y-2.5">
          {figures ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", RIBBON.settled.cls)} /> Approved ({fmtShort(collectedAll)})</span>
                  <span className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", RIBBON.finance.cls)} /> With Finance ({fmtShort(figures.withFinance)})</span>
                  <span className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", RIBBON.recorded.cls)} /> Awaiting booking approval ({fmtShort(figures.recorded)})</span>
                  {figures.overdue > 0 && <span className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", RIBBON.late.cls)} /> Overdue ({fmtShort(figures.overdue)})</span>}
                </div>
                <span className="tabular-nums font-medium text-foreground">
                  {fmtShort(receivedAll)} received <span className="text-muted-foreground font-normal">· {fmtShort(figures.toCollect)} balance to collect</span>
                </span>
              </div>
              <CollectionBar
                due={figures.totalDue}
                collected={Math.max(0, collectedAll - coverage.excess)}
                finance={figures.withFinance}
                recorded={figures.recorded}
                overdue={figures.overdue}
                title={`Total due ${fmt(figures.totalDue)} · Adjusted ${fmt(figures.settled)} · On account ${fmt(figures.held)} · Overdue ${fmt(figures.overdue)}`}
              />
              {lateRungs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.6875rem]">
                  <span className="text-muted-foreground font-medium mr-1">Overdue aging:</span>
                  {lateRungs.map((a) => {
                    const active = tab === "overdue" && age === a.key;
                    return (
                      <button key={a.key} type="button"
                        onClick={() => { setTabRaw("overdue"); setAgeRaw(active ? "" : a.key); list.setPage(1); }}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border tabular-nums transition",
                          active
                            ? "border-rose-500/50 bg-rose-500/15 font-semibold text-rose-300 [[data-theme]_&]:text-rose-700"
                            : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-rose-500/35",
                        )}>
                        <span>{a.label}</span>
                        <span className="font-semibold text-foreground">{fmtShort(a.amount)}</span>
                        <span>({a.count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{summaryFetching ? "Loading collection breakdown…" : "Collection breakdown unavailable"}</p>
          )}
        </div>
      </div>

      {summaryError && (
        <GridGuidance
          tone="waiting"
          title={figures ? "Could not refresh payment totals — showing last loaded figures." : "Payment totals are unavailable."}
          text="Use Refresh to retry loading live summary figures."
        />
      )}
      {!summaryError && coverage.excess > 0 && figures && (
        <GridGuidance
          tone="moving"
          title={`${fmt(coverage.excess)} received exceeds scheduled dues on those bookings.`}
          text={`${fmt(coverage.covered)} counts against the ${fmt(figures.totalDue)} scheduled due; excess stays On Account or refundable.`}
        />
      )}

      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<DeskTab> label="Queues" active={tab} onChange={setTab} panelId="payment-milestones-queue-panel"
          tabs={DESK_TABS.map((t) => ({ ...t, count: figures ? figures.counts[t.key] : null }))} />
        <div id="payment-milestones-queue-panel" role="tabpanel" aria-labelledby={`payment-milestones-queue-panel-tab-${tab}`} tabIndex={0}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-border bg-muted/20">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, mobile, booking or unit" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {tab === "overdue" && lateRungs.map((a) => (
            <GridToggleChip key={a.key} label={a.label} count={a.count} on={age === a.key} onChange={(on) => setAge(on ? a.key : "")} />
          ))}
          {hasQueueFilters && (
            <button type="button" onClick={clearQueueFilters} className={MATRIX_BTN}>
              Clear filters
            </button>
          )}
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
            {rights.canExport && <button type="button" onClick={handleExport} disabled={exporting || !ledger?.total} className={MATRIX_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>}
          </div>
        </div>
        <CrmGrid cols={LEDGER_COLS} prefs={prefs} onPrefs={setPrefs} rows={queueRows} rowKey={(r) => r.BookingId} noRowNumbers
          mobileCardRenderer={(row) => <LedgerMobileCard row={row} onOpen={() => openBooking(row.BookingId)} />}
          loading={ledgerLoading} fetching={ledgerFetching} error={ledgerError ? translateError((ledgerError as Error).message) : null} onRetry={() => refetchLedger()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openBooking(r.BookingId)} activeKey={selectedBookingId ? Number(selectedBookingId) : null}
          empty={list.hasFilters || age ? "No booking matches these filters." : "No bookings here."}
          page={list.page} pageSize={pageSize} total={ledger?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
        </div>
      </div>
    </div>
  );

  const accountCount = onAccountData?.payments?.length || 0;
  const financeRows = money?.entries || [];
  const returnedRows = money?.returned || [];
  const received = (money?.collected || 0) + (money?.inVerification || 0) + (money?.recorded || 0);
  const movedReceipt = money?.trail?.rows?.find((r: any) => r.stage === "unitChange");
  const heldUnitChangeCredit = onAccountData?.payments?.find((p: any) => p.PaymentMode === "HeldCredit");
  const destinationUnitChangeCredit = destinationCreditData?.payments?.find((p: any) => p.PaymentMode === "RebookingCredit");

  const firstApplicableDeposit = !unitChanged && onAccountBalance > 0
    ? (onAccountData?.payments || []).find((p: any) => !["Bounced", "Held", "Void", "Cancelled", "Refunded"].includes(p.Status) && Number(p.Amount) - Number(p.AppliedAmount || 0) > 0)
    : null;
  const bookingTabs: { key: RecordTab; label: string; count?: number | null }[] = [
    { key: "schedule", label: "Payment schedule", count: milestones.length },
    { key: "trail", label: "Collection trail", count: money?.trail?.rows?.length || 0 },
    ...(!unitChanged ? [{ key: "wallet" as const, label: "On-account wallet", count: accountCount }] : []),
    { key: "approvals", label: "Finance & returns", count: financeRows.length + returnedRows.length },
    { key: "terms", label: "Price & waivers", count: (milestoneData?.waivers?.length || 0) > 0 ? milestoneData.waivers.length : undefined },
  ];
  const resolvedTab: RecordTab = unitChanged && recordTab === "wallet" ? "schedule" : recordTab;

  const record = isLoading ? (
    <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading the plan…</div>
  ) : isError ? (
    <div role="alert" className={cn(GRID_CARD, "rounded-xl px-6 py-12 text-center space-y-3")}>
      <p className="text-sm font-medium text-destructive">
        Could not load the payment plan{milestoneError instanceof Error ? `: ${translateError(milestoneError.message)}` : ""}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={closeBooking} className={MATRIX_BTN}><ArrowLeft size={13} /> All bookings</button>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className={MATRIX_BTN_BRAND}>
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  ) : !milestoneData || !booking ? (
    <div className={cn(GRID_CARD, "rounded-xl px-6 py-12 text-center space-y-3")}>
      <p className="text-sm text-muted-foreground">This booking was not found.</p>
      <div className="flex justify-center">
        <button type="button" onClick={closeBooking} className={MATRIX_BTN}><ArrowLeft size={13} /> All bookings</button>
      </div>
    </div>
  ) : (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={closeBooking} className={MATRIX_BTN}><ArrowLeft size={13} /> All bookings</button>
          {queueAt >= 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1 py-0.5">
              <button type="button" onClick={() => openBooking(queueRows[queueAt - 1].BookingId)} disabled={queueAt === 0} className={cn(MATRIX_BTN, "!h-7 w-7 !px-0 border-0")} title="Previous booking in the queue" aria-label="Previous booking in the queue"><ChevronLeft size={14} /></button>
              <span className="text-xs text-muted-foreground tabular-nums px-1.5">{queueAt + 1} / {queueRows.length}</span>
              <button type="button" onClick={() => openBooking(queueRows[queueAt + 1].BookingId)} disabled={queueAt === queueRows.length - 1} className={cn(MATRIX_BTN, "!h-7 w-7 !px-0 border-0")} title="Next booking in the queue" aria-label="Next booking in the queue"><ChevronRight size={14} /></button>
            </span>
          )}
          <Link to={`/crm/bookings?view=${selectedBookingId}`} className={MATRIX_BTN}><ExternalLink size={13} /> Booking {booking.BookingNo}</Link>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className={MATRIX_BTN} title="Refresh booking ledger" aria-label="Refresh">
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <section className={cn(GRID_CARD, "rounded-xl overflow-hidden")} aria-label="Booking payment summary">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4 border-b border-border">
          <div className="flex items-start gap-3 min-w-0 flex-1 basis-80">
            <Initials name={booking.ApplicantName} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono font-medium text-foreground">{booking.BookingNo}</span>
                <span>·</span>
                <span>Payment plan</span>
                {booking.BookingStatus && <GridStatusPill status={booking.BookingStatus} />}
              </div>
              <h1 className="mt-1 text-xl font-bold tracking-tight capitalize text-foreground truncate">
                <ApplicantNames name={booking.ApplicantName} bookingId={Number(selectedBookingId)} />
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                {[booking.UnitNo, booking.ProjectName, booking.Mobile].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {rights.canEdit && !bookingClosed && needsResync && (
              <button type="button" onClick={handleResyncSchedule} disabled={resyncing} className={MATRIX_BTN}>
                <RefreshCw size={13} className={resyncing ? "animate-spin" : ""} /> {resyncing ? "Resyncing…" : "Resync schedule"}
              </button>
            )}
            {rights.canCreate && !bookingClosed && <button type="button" onClick={() => setAddDialog(true)} className={MATRIX_BTN}><Plus size={13} /> Add milestone</button>}
            {rights.canCreate && !bookingClosed && <button type="button" onClick={openDeposit} className={MATRIX_BTN_BRAND}><Wallet size={13} /> Deposit on account</button>}
          </div>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border bg-muted/15">
          <div className="px-5 py-3 min-w-0" title={unitChanged ? (bookingUnitChange ? `Moved to new booking: ${fmt(bookingUnitChange.MovedAmount)}` : undefined) : `Adjusted ${fmt(money?.adjusted)} · On account ${fmt(money?.held)}`}>
            <dt className="text-xs text-muted-foreground font-medium">{unitChanged ? "Money carried forward" : "Approved by Finance"}</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", TONE_EMERALD_TEXT)}>
              {unitChanged ? (bookingUnitChange ? fmtShort(bookingUnitChange.MovedAmount) : unitChangeFetching ? "Checking…" : "Unavailable") : fmtShort(money?.collected)}
            </dd>
            <dd className="text-[0.6875rem] text-muted-foreground tabular-nums">
              {unitChanged ? (bookingUnitChange ? "See unit-change request" : "Request details unavailable") : `${fmtShort(money?.adjusted)} adjusted · ${fmtShort(money?.held)} on account`}
            </dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={fmt(money?.inVerification)}>
            <dt className="text-xs text-muted-foreground font-medium">Pending with Finance</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", Number(money?.inVerification || 0) > 0 ? TONE_AMBER_TEXT : "text-foreground")}>{fmtShort(money?.inVerification)}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground">{money?.inVerificationCount ? `${money.inVerificationCount} awaiting Accounts` : "None pending"}</dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={fmt(money?.recorded)}>
            <dt className="text-xs text-muted-foreground font-medium">Awaiting booking approval</dt>
            <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", Number(money?.recorded || 0) > 0 ? TONE_SKY_TEXT : "text-foreground")}>{fmtShort(money?.recorded)}</dd>
            <dd className="text-[0.6875rem] text-muted-foreground">Sent to Finance when booking approved</dd>
          </div>

          <div className="px-5 py-3 min-w-0" title={fmt(unitChanged ? summary.totalDue : money?.toCollect)}>
            <dt className="text-xs text-muted-foreground font-medium">{unitChanged ? "Old schedule" : "Balance to collect"}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{fmtShort(unitChanged ? summary.totalDue : money?.toCollect)}</dd>
            <dd className={cn("text-[0.6875rem] tabular-nums", !unitChanged && Number(summary.overdue || 0) > 0 ? cn("font-semibold", TONE_ROSE_TEXT) : "text-muted-foreground")}>
              {unitChanged ? "Historical · not collectible" : Number(summary.overdue || 0) > 0 ? `${fmtShort(summary.overdue)} overdue · ${pct(received, summary.totalDue || 0)}% covered` : `${fmtShort(received)} received · ${pct(received, summary.totalDue || 0)}% covered`}
            </dd>
          </div>
        </dl>

        <div className="px-5 py-3 space-y-2">
          {unitChanged ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Historical payment schedule · {fmt(summary.totalDue)} · not collectible on this closed booking
            </div>
          ) : (
            <>
              <PlanRibbon plan={milestones} activeId={activeMilestone} onPick={pickMilestone} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <RibbonLegend />
                {activeMilestone != null && (() => {
                  const picked = milestones.find((x) => x.Id === activeMilestone);
                  if (!picked) return null;
                  return (
                    <span className="inline-flex items-center gap-2 text-[0.6875rem] rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5">
                      <span className="font-medium text-foreground">
                        Focused: #{picked.MilestoneNo} {picked.MilestoneName}
                      </span>
                      <button type="button" onClick={() => setActiveMilestone(null)} className="text-primary font-semibold hover:underline">Clear</button>
                    </span>
                  );
                })()}
              </div>
            </>
          )}
        </div>

        {!unitChanged && !bookingClosed && milestones.length > 0 && (onAccountBalance > 0 || !!nextUp || (!notFullyPaid && nextOutstandingMilestone?.DemandStatus === CrmStatus.PENDING)) && (
          <div className="border-t border-border bg-muted/15 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {onAccountBalance > 0 && (
                <div className="inline-flex items-center gap-2">
                  {notFullyPaid ? (
                    <>
                      <Hourglass size={13} className={TONE_AMBER_TEXT} />
                      <span>
                        <span className="font-semibold text-foreground">On-account held ({fmtShort(onAccountBalance)}):</span>{" "}
                        <button type="button" onClick={() => setRecordTab("wallet")} className={cn("font-semibold underline underline-offset-2", TONE_AMBER_TEXT)}>
                          {fmt(fullPaymentShortfall)} shortfall
                        </button>{" "}
                        <span className="text-muted-foreground">before auto-adjustment</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={13} className={TONE_EMERALD_TEXT} />
                      <span>
                        <span className={cn("font-semibold", TONE_EMERALD_TEXT)}>Full booking covered</span>{" "}
                        <span className="text-muted-foreground">— held deposits auto-settle on demanded milestones</span>
                      </span>
                    </>
                  )}
                </div>
              )}

              {!notFullyPaid && onAccountBalance > 0 && nextOutstandingMilestone ? (
                <div className="inline-flex items-center gap-2">
                  <span className="text-muted-foreground">Settlement target:</span>
                  <button type="button" onClick={() => pickMilestone(nextOutstandingMilestone)} className="font-semibold text-foreground hover:text-primary underline-offset-2 hover:underline">
                    #{nextOutstandingMilestone.MilestoneNo} {nextOutstandingMilestone.MilestoneName} ({fmtShort(nextMilestoneBalance)})
                  </button>
                  {nextOutstandingMilestone.DemandStatus === CrmStatus.PENDING ? (
                    rights.canEdit ? (
                      <button type="button" onClick={() => setDemandDialog({ milestone: nextOutstandingMilestone, notes: "" })}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-300 [[data-theme]_&]:text-amber-700 hover:bg-amber-500/20">
                        Demand needed · Raise now
                      </button>
                    ) : <span className={cn("text-[0.6875rem] font-medium", TONE_AMBER_TEXT)}>Demand pending</span>
                  ) : (
                    <span className={cn("inline-flex items-center gap-1 text-[0.6875rem] font-medium", TONE_EMERALD_TEXT)}>
                      <CheckCircle2 size={11} /> {nextOutstandingMilestone.DemandNo || "Demanded"}
                    </span>
                  )}
                </div>
              ) : nextUp ? (
                <div className="inline-flex items-center gap-2">
                  <span className="text-muted-foreground">Next to pay:</span>
                  <button type="button" onClick={() => pickMilestone(nextUp)} className="font-semibold text-foreground hover:text-primary underline-offset-2 hover:underline">
                    #{nextUp.MilestoneNo} {nextUp.MilestoneName} ({fmt(milestoneFill(nextUp).missing)} due {fmtDate(nextUp.DueDate)})
                  </button>
                </div>
              ) : null}
            </div>

            {rights.canEdit && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {canManuallyApplyOnAccount && firstApplicableDeposit && nextOutstandingMilestone ? (
                  <button type="button" onClick={() => openApplyDialog(firstApplicableDeposit, nextOutstandingMilestone)} className={MATRIX_BTN_BRAND}>
                    Apply on-account ({fmtShort(Math.min(onAccountBalance, nextMilestoneBalance))}) <ArrowRight size={13} />
                  </button>
                ) : !notFullyPaid && onAccountBalance > 0 && nextOutstandingMilestone?.DemandStatus === CrmStatus.PENDING ? (
                  <button type="button" onClick={() => setDemandDialog({ milestone: nextOutstandingMilestone, notes: "" })} className={MATRIX_BTN_BRAND}>
                    <Send size={13} /> Raise demand &amp; settle
                  </button>
                ) : nextUp ? (
                  <button type="button" onClick={() => handleOpenPayment(nextUp)} className={MATRIX_BTN_BRAND}>
                    Pay #{nextUp.MilestoneNo} ({fmtShort(milestoneFill(nextUp).missing)}) <ArrowRight size={13} />
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>

      {returnedRows.length > 0 && (
        <div role="region" aria-label="Rejected payments requiring correction" className="rounded-xl border border-rose-500/35 bg-rose-500/[0.06] px-4 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={16} className={TONE_ROSE_TEXT} />
              <span>{returnedRows.length} payment entry{returnedRows.length === 1 ? "" : " entries"} rejected by Finance</span>
            </div>
            <button type="button" onClick={() => setRecordTab("approvals")} className="text-xs font-semibold text-primary hover:underline">
              Inspect all Finance entries
            </button>
          </div>
          <div className="divide-y divide-rose-500/20 rounded-lg border border-rose-500/20 bg-card/80">
            {returnedRows.slice(0, 3).map((e: any) => (
              <div key={e.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-foreground">{e.docNo || `#${e.id}`}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium text-foreground">{e.milestone || "On Account"}</span>
                    <span className="font-semibold tabular-nums line-through text-muted-foreground">{fmt(e.amount)}</span>
                  </div>
                  <p className={cn("text-[0.6875rem]", TONE_ROSE_TEXT)}>
                    Rejected by {e.returnedBy || "Finance"}{e.returnedAt ? ` on ${fmtDate(e.returnedAt)}` : ""}{e.reason ? `: “${e.reason}”` : ""}
                  </p>
                </div>
                {rights.canEdit && !bookingClosed && (
                  <button type="button" onClick={() => handleResubmitReturned(e)} className={cn(MATRIX_BTN, "!h-7 !px-2.5 text-xs shrink-0")}>
                    Correct &amp; re-enter
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(unitChanged || bookingClosed || Number(summary.waivedDue) > 0 || Number(money?.excess) > 0) && nextSentence && (
        <GridGuidance
          tone={unitChanged || bookingClosed ? "stopped" : !notFullyPaid ? "done" : "moving"}
          title={unitChanged ? "Booking closed (Unit Changed)" : bookingClosed ? "Closed Booking" : Number(money?.excess) > 0 ? "Excess Credit Available" : "Waiver Price Adjustment"}
          text={(
            <span className="space-y-1 block">
              <span className="block">{nextSentence}</span>
              {Number(summary.waivedDue) > 0 && (
                <span className="block">Agreed price {fmt(Number(booking.GrandTotal) || 0)}, less {fmt(Number(summary.waivedDue) || 0)} waived: {fmt(Number(summary.totalDue) || 0)} net billable.</span>
              )}
              {Number(money?.excess) > 0 && (
                <span className={cn("block font-medium", TONE_AMBER_TEXT)}>
                  {fmt(Number(money?.excess) || 0)} on account is above what is still billable.{" "}
                  <Link to={`/crm/refunds?newForBooking=${selectedBookingId}`} className="text-primary font-semibold underline underline-offset-2">Refund or adjust it</Link>.
                </span>
              )}
            </span>
          )}
        />
      )}

      {unitChanged && (
        <GridRelated icon={Wallet} title="One payment · movement across bookings">
          <div className="px-4 py-3 border-b border-border/70 text-xs text-muted-foreground">
            The customer paid once. The records below show that same money leaving this booking, being held for the unit change, and arriving on the new booking. Hold and transfer rows are internal steps, not extra payments.
          </div>
          {unitChangeError && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2 text-xs text-destructive">
            <span>{unitChangeFetching ? "Refreshing unit-change details…" : "Could not load the unit-change request details."}</span>
            <button type="button" onClick={() => refetchUnitChange()} className="font-semibold underline underline-offset-2">Retry</button>
          </div>}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="p-4 min-w-0">
              <div className="text-xs text-muted-foreground">Customer payment · counted once</div>
              <div className="mt-1 font-semibold tabular-nums">{movedReceipt ? fmt(movedReceipt.amount) : "Unavailable"}</div>
              <div className="mt-1 text-xs text-muted-foreground break-words">{movedReceipt ? movedReceipt.docs?.join(" → ") || "No receipt documents attached" : "Original receipt details unavailable"}</div>
            </div>
            <div className="p-4 min-w-0">
              <div className="text-xs text-muted-foreground">Internal unit-change hold</div>
              <div className="mt-1 font-semibold">No new payment</div>
              <div className="mt-1 text-xs text-muted-foreground break-words">{unitChangeError || unitChangeMissing ? "Request reference unavailable" : unitChangeFetching && !bookingUnitChange ? "Loading request details…" : heldUnitChangeCredit?.ReceiptNo || bookingUnitChange?.RequestNo || "Unit-change credit"}</div>
            </div>
            <div className="p-4 min-w-0">
              <div className="text-xs text-muted-foreground">Same credit · now on the new booking</div>
              <div className="mt-1 font-semibold tabular-nums">{unitChangeError || unitChangeMissing ? "Unavailable" : unitChangeFetching && !bookingUnitChange ? "Checking request…" : destinationCreditError ? "Balance unavailable" : destinationCreditFetching && !destinationCreditData ? "Checking balance…" : `${fmt(Math.max(0, Number(destinationUnitChangeCredit?.Amount || bookingUnitChange?.CreditCarriedAmount || 0) - Number(destinationUnitChangeCredit?.AppliedAmount || 0)))} available`}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {unitChangeError || unitChangeMissing ? "Unit-change request details unavailable" : unitChangeFetching && !bookingUnitChange ? "Loading the unit-change request…" : destinationCreditError ? <button type="button" onClick={() => refetchDestinationCredit()} className="font-semibold underline underline-offset-2">Retry balance lookup</button> : destinationCreditFetching && !destinationCreditData ? "Loading the new booking's on-account details…" : destinationUnitChangeCredit ? `${destinationUnitChangeCredit.ReceiptNo} · ${fmt(Math.max(0, Number(destinationUnitChangeCredit.Amount) - Number(destinationUnitChangeCredit.AppliedAmount || 0)))} still on account` : bookingUnitChange?.TargetBookingNo || "Destination credit"}
                {bookingUnitChange?.TargetBookingId && <> · <Link to={`/crm/payments?bookingId=${bookingUnitChange.TargetBookingId}`} className="underline underline-offset-2">Open booking {bookingUnitChange.TargetBookingNo || ""}</Link></>}
              </div>
            </div>
          </div>
        </GridRelated>
      )}
      {needsResync && (
        <GridGuidance tone="stopped" title={!milestone1 ? "No Booking Amount milestone" : "Milestone 1 doesn't match the booking amount"}
          text={!milestone1
            ? "Resync the schedule to generate it; schedule rows that already exist are kept for review."
            : <>Milestone 1 ({fmt(milestone1.AmountDue)}) doesn't match this booking's booking amount ({fmt(booking.BookingAmount)}). Resync the schedule to fix it and redistribute the remaining milestones.</>} />
      )}
      {receiptsError ? (
        <div role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs", TONE_AMBER_TEXT)}>
          <span>{receiptsLoading ? "Loading token receipt details…" : "Could not verify token receipt details."}</span>
          <button type="button" onClick={() => refetchMoneyReceipts()} className="text-primary font-semibold underline underline-offset-2">Retry</button>
        </div>
      ) : receiptsLoading ? (
        Number(booking.TokenValue) > 0 ? <p role="status" className="text-xs text-muted-foreground">Loading token receipt details…</p> : null
      ) : <TokenNote booking={booking} bookingId={selectedBookingId} moneyReceipts={moneyReceipts || []} />}

      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<RecordTab>
          label="Booking ledger sections"
          active={resolvedTab}
          onChange={setRecordTab}
          panelId="booking-payment-workbench-panel"
          tabs={bookingTabs}
          end={(
            <div className="flex items-center gap-1.5 py-1.5 mr-1">
              {resolvedTab === "schedule" && rights.canExport && milestones.length > 0 && (
                <button type="button" onClick={exportBookingSchedule} className={cn(MATRIX_BTN, "!h-7 !px-2.5 text-xs")}>
                  <Download size={12} /> Export CSV
                </button>
              )}
              {resolvedTab === "trail" && rights.canExport && (money?.trail?.rows?.length || 0) > 0 && (
                <button type="button" onClick={exportMoneyTrail} className={cn(MATRIX_BTN, "!h-7 !px-2.5 text-xs")}>
                  <Download size={12} /> Export CSV
                </button>
              )}
              {resolvedTab === "wallet" && rights.canCreate && !bookingClosed && (
                <button type="button" onClick={openDeposit} className={cn(MATRIX_BTN, "!h-7 !px-2.5 text-xs")}>
                  <Plus size={12} /> Deposit on account
                </button>
              )}
            </div>
          )}
        />

        <div id="booking-payment-workbench-panel" role="tabpanel" aria-labelledby={`booking-payment-workbench-panel-tab-${resolvedTab}`} tabIndex={0}>
          {resolvedTab === "schedule" && (
            <MilestoneTable
              milestones={milestones}
              canEdit={rights.canEdit && !bookingClosed}
              closed={bookingClosed}
              onAccountData={onAccountError ? null : onAccountData}
              onAccountBalance={onAccountError ? 0 : onAccountBalance}
              notFullyPaid={notFullyPaid}
              fullPaymentShortfall={fullPaymentShortfall}
              activeId={activeMilestone}
              pendingWaivers={pendingWaiverIds(milestoneData.waivers)}
              nextMilestone={nextOutstandingMilestone}
              canManuallyApply={canManuallyApplyOnAccount}
              onPay={handleOpenPayment}
              onApply={openApplyDialog}
              onWaive={(m) => setWaiveDialog({ milestone: m, reason: "" })}
              onRemarks={(m) => setRemarksDialog({ milestone: m })}
              onRaiseDemand={rights.canEdit && !bookingClosed ? (m) => setDemandDialog({ milestone: m, notes: "" }) : undefined}
              onUndoDemand={rights.canEdit && !bookingClosed ? setUndoDemandDialog : undefined}
              onInspectWallet={!unitChanged ? () => setRecordTab("wallet") : undefined}
            />
          )}

          {resolvedTab === "trail" && (
            <MoneyTrail trail={money?.trail} totalDue={summary.totalDue || 0} />
          )}

          {resolvedTab === "wallet" && !unitChanged && (
            <OnAccountPanel
              onAccountData={onAccountData}
              loading={onAccountLoading}
              error={onAccountError ? translateError((onAccountError as Error).message) : null}
              onRetry={() => refetchOnAccount()}
              notFullyPaid={notFullyPaid}
              fundsOnHand={bookingFundsOnHand}
              requiredAmount={bookingRequiredAmount}
              fullPaymentShortfall={fullPaymentShortfall}
              inVerification={money?.inVerification || 0}
              milestones={milestones}
              canManuallyApply={canManuallyApplyOnAccount}
              canEdit={rights.canEdit && !bookingClosed}
              onApply={(p) => openApplyDialog(p, null)}
            />
          )}

          {resolvedTab === "approvals" && (
            <div className="divide-y divide-border">
              {financeRows.length === 0 && returnedRows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No payment entries currently pending or rejected by Finance.
                </div>
              ) : (
                <>
                  {returnedRows.length > 0 && (
                    <div>
                      <div className="px-4 py-2.5 bg-rose-500/[0.06] border-b border-border flex items-center gap-2 text-xs font-semibold">
                        <AlertTriangle size={13} className={TONE_ROSE_TEXT} />
                        <span>Rejected by Finance ({returnedRows.length})</span>
                      </div>
                      <EntryTable rows={returnedRows} returned />
                    </div>
                  )}
                  {financeRows.length > 0 && (
                    <div>
                      <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2 text-xs font-semibold">
                        <Hourglass size={13} className={TONE_AMBER_TEXT} />
                        <span>Pending Finance approval ({financeRows.length})</span>
                      </div>
                      <EntryTable rows={financeRows} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {resolvedTab === "terms" && (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4 items-start">
              <GridRelated icon={Receipt} title="Booking Price Breakdown">
                <PriceTable booking={booking} />
              </GridRelated>
              <div className="min-w-0">
                {(milestoneData.waivers || []).length > 0 ? (
                  <WaiverSection waivers={milestoneData.waivers || []} canEdit={rights.canEdit && !bookingClosed} onChanged={reloadMilestones} />
                ) : (
                  <div className={cn(GRID_CARD, "rounded-lg px-4 py-8 text-center text-xs text-muted-foreground")}>
                    No waivers or waiver requests recorded on this booking.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Its reminders (Reminder Setup): tucked below the payment schedule so active/paused alerts remain handy without pushing the table below the fold. */}
      <BookingReminders bookingId={Number(selectedBookingId)} canEdit={rights.canEdit} />
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
        <GridDialog
          open={editingId != null}
          onClose={() => { if (!saving) setEditingId(null); }}
          icon={Wallet}
          title="Submit payment for approval"
          description="Goes to Finance's Received Payment queue — the Accounts head (or an admin) approves it before it counts as paid."
          width="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={() => setEditingId(null)} disabled={saving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button type="button" onClick={handleRecordPayment} disabled={saving || !isMoneyAmount(payForm.AmountPaid) || !(Number(payForm.AmountPaid) > 0)} className={`${KEY_INK} h-9 px-4`}>{saving ? "Submitting…" : "Submit for approval"}</button>
            </>
          }
        >
          <div className="space-y-4 max-h-[65vh] overflow-y-auto thin-scroll pr-1">
            {editingMilestone && (
              <div className="rounded-xl border border-border bg-muted/25 px-4 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className={LBL}>Milestone</p>
                  <p className="text-sm font-semibold truncate mt-0.5">#{editingMilestone.MilestoneNo} {editingMilestone.MilestoneName}</p>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right"><p className={LBL}>Amount due</p><p className="text-sm font-heading font-semibold tabular-nums mt-0.5">{fmt(editingMilestone.AmountDue)}</p></div>
                  <div className="text-right"><p className={LBL}>Balance</p><p className="text-lg font-heading font-bold tabular-nums mt-0.5">{fmt(editingBalance)}</p></div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL} htmlFor="milestone-payment-amount">Amount received now (₹)</label>
                <input id="milestone-payment-amount" type="number" min={0} step="0.01" value={payForm.AmountPaid} onChange={(e) => setPayForm((f) => ({ ...f, AmountPaid: e.target.value }))} className={`${INP} font-semibold tabular-nums`} />
              </div>
              <div>
                <label className={LABEL} htmlFor="milestone-payment-date">Payment date</label>
                <DateInput id="milestone-payment-date" value={payForm.PaidDate} max={todayStr()} onChange={(e) => setPayForm((f) => ({ ...f, PaidDate: e.target.value }))} className={INP} />
              </div>
              <div>
                <label className={LABEL} htmlFor="milestone-payment-mode">Payment mode</label>
                {modeSelect(payForm.PaymentMode, (mode) => setPayForm((f) => ({ ...f, PaymentMode: mode, BankName: modeHasBank(mode) ? f.BankName : "" })), "milestone-payment-mode")}
              </div>
              {previewOverflow > 0 && (
                <p className="col-span-2 sm:col-span-3 rounded-lg border border-border bg-muted/20 text-[0.6875rem] font-medium flex items-center gap-1.5 px-3 py-2">
                  <Wallet size={12} className="shrink-0 text-primary" /> {fmt(previewOverflow)} above the amount due. It stays On Account when approved.
                </p>
              )}
              {modeHasBank(payForm.PaymentMode) && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Customer's bank</label>
                  <BankNamePicker ariaLabel="Customer's bank" value={payForm.BankName} onChange={(v) => setPayForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
                </div>
              )}
              <div className={modeHasBank(payForm.PaymentMode) ? "col-span-2" : "col-span-2 sm:col-span-3"}>
                <label className={LABEL} htmlFor="milestone-payment-ref">Transaction ref</label>
                <input id="milestone-payment-ref" type="text" value={payForm.TransactionRef} placeholder="UTR / cheque / reference no." onChange={(e) => setPayForm((f) => ({ ...f, TransactionRef: e.target.value }))} className={INP} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL} htmlFor="milestone-payment-remarks">Remarks</label>
                <textarea id="milestone-payment-remarks" value={payForm.Remarks} onChange={(e) => setPayForm((f) => ({ ...f, Remarks: e.target.value }))} rows={2} placeholder="Optional note for Finance…" className={TEXTAREA} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {depositNote}
              {modeHasBank(payForm.PaymentMode) && <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs">
                <p className={`${LBL} mb-1.5`}>Bank on file (KYC) — reference only</p>
                {customerBankLoading ? <p role="status" className="text-muted-foreground">Loading bank details…</p> : customerBankError ? (
                  <p role="alert" className={TONE_ROSE_TEXT}>Could not load KYC bank details. <button type="button" onClick={() => refetchCustomerBank()} className="text-primary font-semibold underline underline-offset-2">Retry</button></p>
                ) : customerBank?.BankName || customerBank?.AccountNo ? (
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.6875rem]">
                    <span className="text-muted-foreground">Bank</span><span className="font-medium text-right truncate">{customerBank.BankName || "—"}</span>
                    <span className="text-muted-foreground">A/C no.</span><span className="font-medium text-right tabular-nums">{customerBank.AccountNo || "—"}</span>
                    <span className="text-muted-foreground">IFSC</span><span className="font-medium text-right tabular-nums">{customerBank.IfscCode || "—"}</span>
                  </div>
                ) : <p className="text-muted-foreground">No KYC bank details on file.</p>}
              </div>}
            </div>
          </div>
        </GridDialog>

        {/* Add milestone */}
        <GridDialog
          open={addDialog}
          onClose={() => { if (!saving) setAddDialog(false); }}
          icon={Plus}
          title="Add custom milestone"
          description="Adds a custom billing stage to this booking's payment schedule."
          width="max-w-lg"
          footer={
            <>
              <button type="button" onClick={() => setAddDialog(false)} disabled={saving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button type="button" onClick={handleAddMilestone} disabled={saving || !addForm.MilestoneName.trim() || !isMoneyAmount(addForm.AmountDue) || !(Number(addForm.AmountDue) > 0)} className={`${KEY_INK} h-9 px-4`}>{saving ? "Adding…" : "Add milestone"}</button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className={LABEL} htmlFor="add-milestone-name">Milestone name *</label>
              <input id="add-milestone-name" type="text" value={addForm.MilestoneName} onChange={(e) => setAddForm((f) => ({ ...f, MilestoneName: e.target.value }))} className={INP} placeholder="e.g. PLC charges" autoFocus />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="add-milestone-date">Due date</label>
                <DateInput id="add-milestone-date" value={addForm.DueDate} onChange={(e) => setAddForm((f) => ({ ...f, DueDate: e.target.value }))} className={INP} />
              </div>
              <div>
                <label className={LABEL} htmlFor="add-milestone-amount">Amount due (₹) *</label>
                <input id="add-milestone-amount" type="number" min={0} step="0.01" value={addForm.AmountDue} onChange={(e) => setAddForm((f) => ({ ...f, AmountDue: e.target.value }))} className={`${INP} tabular-nums`} />
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="add-milestone-department">Responsible department</label>
              <input id="add-milestone-department" type="text" value={addForm.ResponsibleDepartment} onChange={(e) => setAddForm((f) => ({ ...f, ResponsibleDepartment: e.target.value }))} className={INP} placeholder="e.g. Construction, Legal, Sales" />
            </div>
            <div>
              <label className={LABEL} htmlFor="add-milestone-documents">Required documents</label>
              <input id="add-milestone-documents" type="text" value={addForm.RequiredDocuments} onChange={(e) => setAddForm((f) => ({ ...f, RequiredDocuments: e.target.value }))} className={INP} placeholder="e.g. Completion certificate" />
            </div>
          </div>
        </GridDialog>

        {/* Deposit on account */}
        <GridDialog
          open={onAccountDialog}
          onClose={() => { if (!saving) setOnAccountDialog(false); }}
          icon={Landmark}
          title="Submit on-account deposit"
          description="Goes to Finance's Received Payment queue. Once approved it's held as credit and auto-adjusted sequentially once full booking dues are covered."
          width="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={() => setOnAccountDialog(false)} disabled={saving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button type="button" onClick={handleDepositOnAccount} disabled={saving || !isMoneyAmount(onAccountForm.Amount) || !(Number(onAccountForm.Amount) > 0)} className={`${KEY_INK} h-9 px-4`}>{saving ? "Submitting…" : "Submit for approval"}</button>
            </>
          }
        >
          <div className="space-y-4 max-h-[65vh] overflow-y-auto thin-scroll pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL} htmlFor="on-account-amount">Amount (₹) *</label>
                <input id="on-account-amount" type="number" min={0} step="0.01" value={onAccountForm.Amount} onChange={(e) => setOnAccountForm((f) => ({ ...f, Amount: e.target.value }))} className={`${INP} font-semibold tabular-nums`} />
              </div>
              <div>
                <label className={LABEL} htmlFor="on-account-date">Received date</label>
                <DateInput id="on-account-date" value={onAccountForm.ReceivedDate} max={todayStr()} onChange={(e) => setOnAccountForm((f) => ({ ...f, ReceivedDate: e.target.value }))} className={INP} />
              </div>
              <div>
                <label className={LABEL} htmlFor="on-account-mode">Payment mode</label>
                {modeSelect(onAccountForm.PaymentMode, (mode) => setOnAccountForm((f) => ({ ...f, PaymentMode: mode, BankName: modeHasBank(mode) ? f.BankName : "" })), "on-account-mode")}
              </div>
              {modeHasBank(onAccountForm.PaymentMode) && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Customer's bank</label>
                  <BankNamePicker ariaLabel="Customer's bank" value={onAccountForm.BankName} onChange={(v) => setOnAccountForm((f) => ({ ...f, BankName: v }))} placeholder="Select customer's bank…" otherPlaceholder="Bank of customer" />
                </div>
              )}
              <div className={modeHasBank(onAccountForm.PaymentMode) ? "col-span-2" : "col-span-2 sm:col-span-3"}>
                <label className={LABEL} htmlFor="on-account-ref">Transaction ref</label>
                <input id="on-account-ref" type="text" value={onAccountForm.TransactionRef} placeholder="UTR / cheque / reference no." onChange={(e) => setOnAccountForm((f) => ({ ...f, TransactionRef: e.target.value }))} className={INP} />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className={LABEL} htmlFor="on-account-notes">Notes</label>
                <textarea id="on-account-notes" value={onAccountForm.Notes} onChange={(e) => setOnAccountForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} placeholder="Optional note for Finance…" className={TEXTAREA} />
              </div>
            </div>
            {depositNote}
          </div>
        </GridDialog>

        {/* Apply on-account to a milestone */}
        {applyDialog && (() => {
          const remaining = roundPaise(Number(applyDialog.payment.Amount) - Number(applyDialog.payment.AppliedAmount || 0));
          const unpaid = canManuallyApplyOnAccount && nextOutstandingMilestone ? [nextOutstandingMilestone] : [];
          const chosenMil = applyDialog.milestone ?? milestones.find((m: any) => m.Id === parseInt(applyMilestoneId));
          const milBalance = chosenMil ? roundPaise(Number(chosenMil.AmountDue) - Number(chosenMil.AmountPaid || 0)) : 0;
          const chosenTargetEligible = canManuallyApplyOnAccount && !!chosenMil && chosenMil.Id === nextOutstandingMilestone?.Id;
          const amountLimit = Math.min(remaining, roundPaise(Math.max(0, milBalance)));
          const applyAmount = Number(applyDialog.amount);
          const amountValid = isMoneyAmount(applyAmount) && applyAmount > 0 && applyAmount <= amountLimit;
          return (
            <GridDialog
              open
              onClose={() => { if (!saving) setApplyDialog(null); }}
              icon={Wallet}
              title="Apply on-account to a milestone"
              description="Allocates cleared On-Account credit onto the next eligible demanded milestone."
              width="max-w-lg"
              footer={
                <>
                  <button type="button" onClick={() => setApplyDialog(null)} disabled={saving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                  <button type="button" onClick={handleConfirmApply} disabled={saving || (!applyDialog.milestone && !applyMilestoneId) || !chosenTargetEligible || !amountValid} className={`${KEY_INK} h-9 px-4`}>
                    {saving ? "Applying…" : `Apply ${applyDialog.amount ? fmt(parseFloat(applyDialog.amount)) : ""}`}
                  </button>
                </>
              }
            >
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-muted/25 p-3.5 text-sm">
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Payment</span><span className="font-heading font-semibold tabular-nums">{applyDialog.payment.ReceiptNo}</span></div>
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Total received</span><span className="font-heading tabular-nums">{fmt(applyDialog.payment.Amount)}</span></div>
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Available to apply</span><span className="font-heading font-bold tabular-nums">{fmt(remaining)}</span></div>
                </div>
                {applyDialog.milestone ? (
                  <div>
                    <p className={LABEL}>Applying to</p>
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm font-medium">
                      {applyDialog.milestone.MilestoneName}
                      <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">({fmt(milBalance)} outstanding)</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={LABEL} htmlFor="apply-milestone-target">Apply to milestone *</label>
                    <select id="apply-milestone-target" value={applyMilestoneId} className={INP} onChange={(e) => {
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
                  <label className={LABEL} htmlFor="apply-milestone-amount">Amount to apply</label>
                  <input id="apply-milestone-amount" type="number" min="0.01" step="0.01" max={chosenMil ? amountLimit : remaining} value={applyDialog.amount} onChange={(e) => setApplyDialog((d) => (d ? { ...d, amount: e.target.value } : d))} className={`${INP} tabular-nums`} />
                  {chosenMil && milBalance > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      Outstanding {fmt(milBalance)} · available {fmt(remaining)}
                      {parseFloat(applyDialog.amount) >= milBalance && <span className="text-foreground font-medium ml-1">— adjusts this milestone in full</span>}
                    </p>
                  )}
                </div>
                {chosenMil && !chosenTargetEligible && (
                  <p className={cn("text-xs", TONE_ROSE_TEXT)}>
                    {!onAccountKnown ? <>Could not verify the on-account balance. <button type="button" onClick={() => refetchOnAccount()} className="text-primary font-semibold underline underline-offset-2">Retry lookup</button> before applying money.</>
                      : notFullyPaid ? `${fmt(fullPaymentShortfall)} more is needed before deposits are adjusted to the milestones.`
                      : nextOutstandingMilestone?.DemandStatus === CrmStatus.PENDING ? `Raise the Demand for ${nextOutstandingMilestone.MilestoneName} first.`
                      : "Only the next outstanding milestone can take on-account money."}
                  </p>
                )}
              </div>
            </GridDialog>
          );
        })()}

        {/* Waive */}
        {waiveDialog && (
          <GridDialog
            open
            onClose={() => { if (!waiving) setWaiveDialog(null); }}
            icon={AlertTriangle}
            title="Ask to waive this milestone"
            description={`${waiveDialog.milestone.MilestoneName} · ${fmt(Math.max(0, Number(waiveDialog.milestone.AmountDue) - Number(waiveDialog.milestone.AmountPaid || 0)))} remaining`}
            width="max-w-lg"
            footer={
              <>
                <button type="button" onClick={() => setWaiveDialog(null)} disabled={waiving} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                <button type="button" onClick={handleWaiveConfirm} disabled={waiving || waiveDialog.reason.trim().length < 10} title={waiveDialog.reason.trim().length < 10 ? "Say why: at least 10 characters" : undefined} className={`${KEY_INK} h-9 px-4`}>{waiving ? "Sending…" : "Send for approval"}</button>
              </>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{waiveDialog.milestone.MilestoneName}</span>: <span className="font-semibold tabular-nums text-foreground">{fmt(Math.max(0, Number(waiveDialog.milestone.AmountDue) - Number(waiveDialog.milestone.AmountPaid || 0)))}</span> would no longer be owed. This goes for approval, and the milestone stays due until it is approved. Once approved it counts as a discount: invoices bill the lower amount.
              </p>
              {milestoneFill(waiveDialog.milestone).held + milestoneFill(waiveDialog.milestone).finance + milestoneFill(waiveDialog.milestone).recorded > 0 && (
                <p className="text-xs flex items-start gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5">
                  <AlertTriangle size={13} className={cn("shrink-0 mt-0.5", TONE_AMBER_TEXT)} />
                  <span>The customer has already paid <b className="tabular-nums">{fmt(milestoneFill(waiveDialog.milestone).held + milestoneFill(waiveDialog.milestone).finance + milestoneFill(waiveDialog.milestone).recorded)}</b> towards this milestone. If it is waived, that money moves to later milestones, and anything beyond them is left to refund or adjust.</span>
                </p>
              )}
              <div>
                <label className={LABEL} htmlFor="waiver-reason">Reason *</label>
                <textarea id="waiver-reason" value={waiveDialog.reason} onChange={(e) => setWaiveDialog((d) => (d ? { ...d, reason: e.target.value } : d))} rows={3} autoFocus
                  placeholder="e.g. Discount approved by management, PLC waiver agreed in negotiation…" className={TEXTAREA} />
              </div>
            </div>
          </GridDialog>
        )}

        {/* Raise payment demand */}
        {demandDialog && (
          <GridDialog
            open
            onClose={() => { if (!raisingDemand) setDemandDialog(null); }}
            icon={Send}
            title="Raise payment demand"
            description="Generates a Demand No., notifies the assigned CRM executive, and auto-settles if full booking funds are held On Account."
            width="max-w-lg"
            footer={
              <>
                <button type="button" onClick={() => setDemandDialog(null)} disabled={raisingDemand} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                <button type="button" onClick={handleRaiseDemandConfirm} disabled={raisingDemand} className={`${KEY_INK} h-9 px-4`}>
                  <Send size={13} /> {raisingDemand ? "Raising…" : "Raise demand"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/25 divide-y divide-border/70 text-xs">
                <div className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-muted-foreground">Milestone</span>
                  <span className="font-semibold text-foreground text-right">#{demandDialog.milestone.MilestoneNo} {demandDialog.milestone.MilestoneName}</span>
                </div>
                <div className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-muted-foreground">Due amount</span>
                  <span className="font-semibold tabular-nums">{fmt(Math.max(0, Number(demandDialog.milestone.AmountDue) - Number(demandDialog.milestone.AmountPaid || 0)))}</span>
                </div>
                <div className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-muted-foreground">Due date</span>
                  <span className="tabular-nums">{fmtDate(demandDialog.milestone.DueDate)}</span>
                </div>
              </div>
              {!notFullyPaid && onAccountBalance > 0 && (
                <p className={cn("rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs flex items-start gap-2", TONE_EMERALD_TEXT)}>
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  <span>Full booking amount is already on hand — raising this Demand will automatically adjust eligible held On-Account funds.</span>
                </p>
              )}
              <div>
                <label className={LABEL} htmlFor="raise-demand-notes">Notes (optional)</label>
                <textarea id="raise-demand-notes" value={demandDialog.notes} onChange={(e) => setDemandDialog((d) => (d ? { ...d, notes: e.target.value } : d))} rows={2} placeholder="Any remarks for this demand notice…" className={TEXTAREA} />
              </div>
            </div>
          </GridDialog>
        )}

        {/* Undo payment demand */}
        {undoDemandDialog && (
          <GridDialog
            open
            onClose={() => { if (!undoingDemand) setUndoDemandDialog(null); }}
            icon={Undo2}
            title={`Undo demand ${undoDemandDialog.DemandNo || ""}?`}
            description={`#${undoDemandDialog.MilestoneNo} ${undoDemandDialog.MilestoneName}`}
            width="max-w-md"
            footer={
              <>
                <button type="button" onClick={() => setUndoDemandDialog(null)} disabled={undoingDemand} className={`${KEY_LINE} h-9 px-4`}>Keep demand</button>
                <button type="button" onClick={handleUndoDemandConfirm} disabled={undoingDemand} className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md border border-destructive bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-40">
                  <Undo2 size={13} /> {undoingDemand ? "Reverting…" : "Undo demand"}
                </button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              The demand status resets to <strong className="text-foreground">Pending</strong> and its demand number ({undoDemandDialog.DemandNo || "current"}) is cleared. Only unpaid demanded milestones can be reverted.
            </p>
          </GridDialog>
        )}

        {/* Remarks */}
        {remarksDialog && (
          <GridDialog
            open
            onClose={() => setRemarksDialog(null)}
            icon={MessageSquare}
            title="Payment remarks"
            description={`${remarksDialog.milestone.MilestoneName} · ${fmtDate(remarksDialog.milestone.PaidDate)}`}
            width="max-w-md"
            footer={<button type="button" onClick={() => setRemarksDialog(null)} className={`${KEY_LINE} h-9 px-4`}>Close</button>}
          >
            <p className="text-sm rounded-xl border border-border bg-muted/20 p-3.5 leading-relaxed">{remarksDialog.milestone.Remarks}</p>
          </GridDialog>
        )}
    </>
  );
};

export default CrmPaymentMilestones;
