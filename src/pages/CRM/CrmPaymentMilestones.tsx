import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { AlertCircle, CheckCircle2, Clock, Plus, Wallet, RefreshCw, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/payments";
const BKG_API = "/api/crm/bookings";
const BANK_MASTER_API = "/api/bank-master";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PROJECT_BANK_API = "/api/crm/project-banks";

const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];

const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  Paid:    "text-green-600 bg-green-50 border-green-200",
  Overdue: "text-red-600 bg-red-50 border-red-200",
  Waived:  "text-muted-foreground bg-muted/50 border-border",
};
const statusIcon: Record<string, React.ReactNode> = {
  Pending: <Clock size={12} />,
  Paid:    <CheckCircle2 size={12} />,
  Overdue: <AlertCircle size={12} />,
  Waived:  <CheckCircle2 size={12} />,
};

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const pct = (paid: number, due: number) =>
  due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;

async function fetchMilestones(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchOnAccount(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}/on-account`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function fetchCompanyBanks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BANK_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Deposit bank, scoped to the booking's project — empty means "nothing
// linked", so the caller falls back to the full bank list itself.
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (!projectId) return [];
  try {
    const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function fetchCustomerBank(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const CrmPaymentMilestones: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bkgParam = sp.get("bookingId") || "";
  const [selectedBookingId, setSelectedBookingId] = useState(bkgParam);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [payForm, setPayForm] = useState({ AmountPaid: "", PaidDate: "", PaymentMode: "", TransactionRef: "", Remarks: "", DepositBankId: "" });
  const [saving, setSaving] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
  const [onAccountDialog, setOnAccountDialog] = useState(false);
  const [onAccountForm, setOnAccountForm] = useState({ Amount: "", ReceivedDate: "", PaymentMode: "", TransactionRef: "", Notes: "", DepositBankId: "" });
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings-dropdown"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: milestoneData, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-milestones", selectedBookingId],
    queryFn: () => fetchMilestones(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 30_000,
  });
  const { data: onAccountData } = useQuery({
    queryKey: ["crm-on-account", selectedBookingId],
    queryFn: () => fetchOnAccount(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 15_000,
  });
  const { data: companyBanks = [] } = useQuery({ queryKey: ["bank-master-dropdown"], queryFn: fetchCompanyBanks, staleTime: 5 * 60_000 });
  const { data: customerBank } = useQuery({
    queryKey: ["crm-customer-bank", selectedBookingId],
    queryFn: () => fetchCustomerBank(selectedBookingId),
    enabled: !!selectedBookingId,
    staleTime: 30_000,
  });

  const milestones: any[] = milestoneData?.milestones || [];
  const summary = milestoneData?.summary || {};
  const booking = milestoneData?.booking || null;
  const onAccountBalance = onAccountData?.availableBalance || 0;

  const { data: projectBanks = [] } = useQuery({
    queryKey: ["crm-project-banks-for", booking?.ProjectId],
    queryFn: () => fetchProjectBanks(booking?.ProjectId),
    enabled: !!booking?.ProjectId,
  });
  // /for-project already resolves the full exclusivity rule server-side
  // (tagged-only, or every untagged bank as the fallback pool) — falling
  // back further to the raw, unfiltered bank list here would silently
  // reintroduce banks tagged exclusively to a DIFFERENT project. Only use
  // the raw list when this booking's Project isn't known yet.
  const bankOptions = booking?.ProjectId ? projectBanks : companyBanks;
  // Bookings created before the payment-logic fix have Milestone #1 sized
  // off the payment plan's fixed % instead of the real BookingAmount — flag
  // that mismatch here so staff can one-click resync the schedule.
  const milestone1 = milestones.find((m) => m.MilestoneNo === 1);
  const needsResync = !!(
    booking?.BookingAmount &&
    milestone1 &&
    Math.abs(Number(milestone1.AmountDue) - Number(booking.BookingAmount)) >= 1
  );

  // Live preview for the Record Payment dialog — this milestone's own
  // remaining balance, and (if what's typed in exceeds it) how much of the
  // entry will be auto-parked to On Account instead of counted against this
  // milestone. Mirrors the cap the backend applies on save.
  const editingMilestone = milestones.find((m) => m.Id === editingId) || null;
  const editingBalance = editingMilestone
    ? Math.max(0, Number(editingMilestone.AmountDue) - Number(editingMilestone.AmountPaid || 0))
    : 0;
  const enteredPaid = payForm.AmountPaid ? parseFloat(payForm.AmountPaid) : 0;
  const previewOverflow = editingMilestone && enteredPaid > Number(editingMilestone.AmountDue)
    ? Math.round((enteredPaid - Number(editingMilestone.AmountDue)) * 100) / 100
    : 0;

  const handleOpenPayment = (m: any) => {
    setEditingId(m.Id);
    setPayForm({
      AmountPaid: m.AmountPaid != null ? String(m.AmountPaid) : "",
      PaidDate: m.PaidDate ? String(m.PaidDate).slice(0, 10) : "",
      PaymentMode: m.PaymentMode || "",
      TransactionRef: m.TransactionRef || "",
      Remarks: m.Remarks || "",
      // Auto-select if the milestone doesn't already have one recorded and
      // this project has exactly one bank linked (Setup > Project Bank
      // Mapping) — otherwise leave it for staff to pick from the dropdown.
      DepositBankId: m.DepositBankId != null ? String(m.DepositBankId)
        : projectBanks.length === 1 ? String(projectBanks[0].BId) : "",
    });
  };

  const handleWaive = async (m: any) => {
    const reason = window.prompt("Reason for waiving this milestone:");
    if (!reason) return;
    try {
      const res = await fetchWithAuth(`${API}/${m.Id}/waive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone waived");

      const allOthersCleared = milestones.filter((x) => x.Id !== m.Id).every((x) => ["Paid", "Waived"].includes(x.Status));
      if (allOthersCleared) {
        promptNextStep(navigate, "All payment milestones are cleared — the Sales Deed is ready to prepare.", "/crm/sales-deed", "Go to Sales Deed");
      }

      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleRecordPayment = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AmountPaid:    payForm.AmountPaid    ? parseFloat(payForm.AmountPaid) : undefined,
          PaidDate:      payForm.PaidDate      || undefined,
          PaymentMode:   payForm.PaymentMode   || undefined,
          TransactionRef:payForm.TransactionRef|| undefined,
          Remarks:       payForm.Remarks       || undefined,
          DepositBankId: payForm.DepositBankId || undefined,
          DepositBankName: payForm.DepositBankId
            ? (bankOptions as any[]).find((b: any) => String(b.BId) === payForm.DepositBankId)?.BName
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // A payment amount now submits into Finance's Received Payment queue
      // for approval (Account's Head/admin/super admin) instead of landing
      // on the milestone immediately — it won't show as Paid, and the
      // overpayment-cap/On Account split isn't resolved, until approved.
      if (data.submitted) {
        toast.success(`Submitted for Finance approval${data.RPDocNo ? ` — ${data.RPDocNo}` : ""}. It won't count as paid until approved.`);
      } else {
        toast.success("Milestone updated");
      }

      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const [resyncing, setResyncing] = useState(false);
  const handleResyncSchedule = async () => {
    if (!selectedBookingId) return;
    setResyncing(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${selectedBookingId}/resync-schedule`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.changed ? "Payment schedule resynced to the booking amount" : "Already up to date");
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setResyncing(false);
    }
  };

  const handleAddMilestone = async () => {
    if (!selectedBookingId || !addForm.MilestoneName.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${selectedBookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MilestoneName: addForm.MilestoneName,
          DueDate: addForm.DueDate || null,
          AmountDue: addForm.AmountDue ? parseFloat(addForm.AmountDue) : 0,
          ResponsibleDepartment: addForm.ResponsibleDepartment || null,
          RequiredDocuments: addForm.RequiredDocuments || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Milestone added");
      setAddDialog(false);
      setAddForm({ MilestoneName: "", DueDate: "", AmountDue: "", ResponsibleDepartment: "", RequiredDocuments: "" });
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDepositOnAccount = async () => {
    if (!selectedBookingId || !onAccountForm.Amount) return;
    setSaving(true);
    try {
      const bankName = onAccountForm.DepositBankId
        ? (bankOptions as any[]).find((b: any) => String(b.BId) === onAccountForm.DepositBankId)?.BName
        : undefined;
      const res = await fetchWithAuth(`${API}/booking/${selectedBookingId}/on-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Amount: parseFloat(onAccountForm.Amount),
          ReceivedDate: onAccountForm.ReceivedDate || null,
          PaymentMode: onAccountForm.PaymentMode || null,
          TransactionRef: onAccountForm.TransactionRef || null,
          Notes: onAccountForm.Notes || null,
          DepositBankId: onAccountForm.DepositBankId || undefined,
          DepositBankName: bankName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`On-account deposit ${data.ReceiptNo} recorded`);
      setOnAccountDialog(false);
      setOnAccountForm({ Amount: "", ReceivedDate: "", PaymentMode: "", TransactionRef: "", Notes: "", DepositBankId: "" });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyOnAccount = async (milestone: any) => {
    if (!onAccountData?.payments?.length) return;
    const available = onAccountData.payments.find((p: any) => Number(p.Amount) - Number(p.AppliedAmount) > 0);
    if (!available) return;
    const balance = Number(milestone.AmountDue) - Number(milestone.AmountPaid || 0);
    const remaining = Number(available.Amount) - Number(available.AppliedAmount);
    const amount = Math.min(balance, remaining);
    setApplyingId(milestone.Id);
    try {
      const res = await fetchWithAuth(`${API}/on-account/${available.Id}/apply`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MilestoneId: milestone.Id, Amount: amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`₹${amount.toLocaleString("en-IN")} applied from on-account balance`);
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setApplyingId(null);
    }
  };

  const milestoneColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "MilestoneNo", header: "#", size: 40,
      cell: (i) => <span className="text-muted-foreground">{i.getValue() as number}</span> },
    { accessorKey: "MilestoneName", header: "Milestone", size: 200,
      cell: (i) => (
        <span className="font-medium">
          {i.row.original.MilestoneName}
          {i.row.original.RequiredDocuments && (
            <div className="text-[10px] text-muted-foreground font-normal mt-0.5" title={i.row.original.RequiredDocuments}>
              Docs: {i.row.original.RequiredDocuments}
            </div>
          )}
        </span>
      ) },
    { accessorKey: "ResponsibleDepartment", header: "Dept", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ResponsibleDepartment || "—"}</span> },
    { accessorKey: "DueDate", header: "Due Date", size: 110,
      cell: (i) => {
        const m = i.row.original;
        const isOverdue = m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date();
        return (
          <span className="text-xs">
            {m.DueDate ? String(m.DueDate).slice(0, 10) : "—"}
            {isOverdue && <span className="ml-1 text-red-500 text-[10px]">OVERDUE</span>}
          </span>
        );
      } },
    { accessorKey: "AmountDue", header: "Amount Due", size: 120,
      cell: (i) => (
        <span className="font-semibold">
          {fmt(i.row.original.AmountDue)}
          {i.row.original.Percent != null && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">({Number(i.row.original.Percent)}%)</span>
          )}
        </span>
      ) },
    { accessorKey: "AmountPaid", header: "Amount Paid", size: 100,
      cell: (i) => (
        <span className="text-green-600 font-semibold">
          {fmt(i.row.original.AmountPaid)}
          {Number(i.row.original.PendingVerificationAmount) > 0 && (
            <div className="text-[10px] text-amber-700 font-normal">+{fmt(i.row.original.PendingVerificationAmount)} pending verification</div>
          )}
        </span>
      ) },
    { id: "balance", header: "Balance", size: 100, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
        return balance > 0
          ? <span className="text-red-600 font-semibold flex items-center gap-1"><ArrowDownCircle size={12} className="shrink-0" />{fmt(balance)}</span>
          : <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 size={12} className="shrink-0" />Settled</span>;
      } },
    { id: "status", header: "Status", size: 120, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        const isOverdue = m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date();
        const displayStatus = isOverdue && m.Status === "Pending" ? "Overdue" : m.Status;
        return (
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${statusColor[displayStatus] || ""}`}>
            {statusIcon[displayStatus]}{displayStatus}
          </span>
        );
      } },
    { accessorKey: "PaymentMode", header: "Payment Mode", size: 90,
      cell: (i) => <span className="text-xs">{i.row.original.PaymentMode || "—"}</span> },
    { accessorKey: "TransactionRef", header: "Ref", size: 90,
      cell: (i) => <span className="text-xs font-mono">{i.row.original.TransactionRef || "—"}</span> },
    { id: "actions", header: "", size: 160, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        return (
          <div className="flex items-center gap-2 whitespace-nowrap">
            {m.Status !== "Paid" && m.Status !== "Waived" && (
              <>
                <button onClick={() => handleOpenPayment(m)}
                  className="text-xs text-primary hover:underline">
                  Submit Payment
                </button>
                {onAccountBalance > 0 && (
                  <button onClick={() => handleApplyOnAccount(m)} disabled={applyingId === m.Id}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-40">
                    {applyingId === m.Id ? "Applying..." : "Apply On-Account"}
                  </button>
                )}
                <button onClick={() => handleWaive(m)}
                  className="text-xs text-muted-foreground hover:underline">
                  Waive
                </button>
              </>
            )}
          </div>
        );
      } },
  ];

  usePageRights("crm-payments");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Payments"]} />
      <CrmShell
        title="CRM — Payment Milestones"
      subtitle="Milestone-wise payment tracking for bookings"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}
    >
      {/* Booking selector */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-64">
          <label className="text-xs text-muted-foreground block mb-1">Select Booking</label>
          <select value={selectedBookingId} onChange={(e) => setSelectedBookingId(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
            <option value="">— Choose a booking —</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.Id} value={String(b.Id)}>
                {b.BookingNo} — {b.ApplicantName} · {b.UnitNo} {b.ProjectName ? `(${b.ProjectName})` : ""}
              </option>
            ))}
          </select>
        </div>
        {selectedBookingId && (
          <>
            <button onClick={() => setAddDialog(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
              <Plus size={14} /> Add Milestone
            </button>
            <button onClick={() => {
              setOnAccountForm((f) => ({ ...f, DepositBankId: projectBanks.length === 1 ? String(projectBanks[0].BId) : f.DepositBankId }));
              setOnAccountDialog(true);
            }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
              <Wallet size={14} /> Deposit On Account
            </button>
            {needsResync && (
              <button onClick={handleResyncSchedule} disabled={resyncing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-amber-300 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                <RefreshCw size={14} className={resyncing ? "animate-spin" : ""} /> {resyncing ? "Resyncing..." : "Resync Schedule"}
              </button>
            )}
          </>
        )}
      </div>

      {needsResync && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          Milestone 1's amount (₹{Number(milestone1.AmountDue).toLocaleString("en-IN")}) doesn't match this booking's actual booking amount (₹{Number(booking.BookingAmount).toLocaleString("en-IN")}) — click "Resync Schedule" to fix it and redistribute the remaining milestones.
        </div>
      )}

      {!selectedBookingId ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Select a booking to view its payment schedule</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading milestones...</div>
      ) : !milestoneData ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No milestone data found</div>
      ) : (
        <>
          {/* Booking summary — "Booking" is the whole deal (unit + parking +
              extra charges), not just the unit price, so the total shown
              here must be the same GrandTotal the milestone schedule is
              actually generated/redistributed against. Showing bare
              TotalValue here (as before) silently disagreed with what the
              milestones summed to whenever a booking had parking or extra
              charges attached. */}
          {booking && (() => {
            const grandTotal = Number(booking.GrandTotal ?? booking.TotalValue ?? 0);
            const parkingTotal = Number(booking.ParkingTotal || 0);
            const extraTotal = Number(booking.ExtraChargesTotal || 0);
            const hasExtras = parkingTotal > 0 || extraTotal > 0;
            return (
              <div className="rounded-xl border border-border p-4 space-y-4">
                <div>
                  <div className="font-semibold text-foreground">{booking.ApplicantName}</div>
                  <div className="text-xs text-muted-foreground">{booking.BookingNo} · {booking.UnitNo} {booking.ProjectName ? `· ${booking.ProjectName}` : ""}</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Price breakdown */}
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Price Breakdown</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted-foreground">Unit Value</span>
                        <span className="font-medium tabular-nums">{fmt(booking.TotalValue)}</span>
                      </div>
                      {parkingTotal > 0 && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">+ Parking</span>
                          <span className="font-medium tabular-nums">{fmt(parkingTotal)}</span>
                        </div>
                      )}
                      {extraTotal > 0 && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">+ Extra Charges</span>
                          <span className="font-medium tabular-nums">{fmt(extraTotal)}</span>
                        </div>
                      )}
                      <div className={`flex items-baseline justify-between ${hasExtras ? "pt-1.5 mt-0.5 border-t border-border" : ""}`}>
                        <span className="font-semibold text-foreground">Grand Total</span>
                        <span className="font-bold text-foreground tabular-nums">{fmt(grandTotal)}</span>
                      </div>
                      {booking.BookingAmount > 0 && (
                        <div className="flex items-baseline justify-between text-xs pt-1">
                          <span className="text-muted-foreground">Booking Amount (Milestone 1)</span>
                          <span className="text-muted-foreground tabular-nums">{fmt(booking.BookingAmount)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Collection summary */}
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Collection Summary</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted-foreground">Total Due</span>
                        <span className="font-medium tabular-nums">{fmt(summary.totalDue)}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted-foreground">Paid</span>
                        <span className="font-medium text-green-600 tabular-nums">{fmt(summary.totalPaid)}</span>
                      </div>
                      <div className="flex items-baseline justify-between pt-1.5 mt-0.5 border-t border-border">
                        <span className="font-semibold text-foreground">Balance (Underpaid)</span>
                        <span className={`font-bold tabular-nums flex items-center gap-1 ${summary.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {summary.balance > 0 && <ArrowDownCircle size={13} className="shrink-0" />}{fmt(summary.balance)}
                        </span>
                      </div>
                      {summary.overdue > 0 && (
                        <div className="flex items-baseline justify-between text-xs pt-1">
                          <span className="text-red-600 flex items-center gap-1"><AlertCircle size={11} /> Overdue</span>
                          <span className="text-red-600 font-medium">{summary.overdue} milestone(s)</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span>Collection Progress</span>
                        <span>{pct(summary.totalPaid, summary.totalDue)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${pct(summary.totalPaid, summary.totalDue)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* On-Account balance */}
          {onAccountData && (onAccountData.payments?.length > 0) && (
            <div className={`rounded-xl border p-4 ${onAccountBalance > 0 ? "border-emerald-200 bg-emerald-50/40" : "border-border"}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Wallet size={14} className={onAccountBalance > 0 ? "text-emerald-600" : "text-muted-foreground"} /> On-Account Balance (Overpaid)</h3>
                <span className={`text-lg font-bold flex items-center gap-1 ${onAccountBalance > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                  {onAccountBalance > 0 && <ArrowUpCircle size={16} className="shrink-0" />}{fmt(onAccountBalance)}
                </span>
              </div>
              <div className="space-y-1">
                {onAccountData.payments.map((p: any) => (
                  <div key={p.Id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.ReceiptNo} · {fmt(p.Amount)} · {p.PaymentMode || "—"}</span>
                    <span className={`px-1.5 py-0.5 rounded-full border font-medium ${p.Status === "Applied" ? "text-green-600 bg-green-50 border-green-200" : p.Status === "PartiallyApplied" ? "text-blue-600 bg-blue-50 border-blue-200" : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                      {p.Status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Milestone table */}
          <DataTable
            data={milestones}
            columns={milestoneColumns}
            emptyMessage="No milestones found"
            className="rounded-xl border border-border overflow-hidden bg-card"
            rowClassName={(row) => {
              const m = row.original as any;
              const isOverdue = m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date();
              return isOverdue ? "bg-red-50/30" : "";
            }}
          />
        </>
      )}

      {/* Record Payment Dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Submit Payment for Approval</DialogTitle></DialogHeader>
          <p className="text-[11px] text-muted-foreground -mt-2">Goes to Finance's Received Payment queue — Account's Head (or admin/super admin) must approve before it counts as paid.</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "AmountPaid",    label: "Amount Paid (₹)", type: "number" },
                { key: "PaidDate",      label: "Payment Date",     type: "date"   },
                { key: "TransactionRef",label: "Transaction Ref",  type: "text"   },
              ].map(({ key, label, type }) => (
                <div key={key} className={key === "TransactionRef" ? "col-span-2" : ""}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={payForm[key as keyof typeof payForm]}
                    onChange={(e) => setPayForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
              {editingMilestone && (
                <div className="col-span-2 -mt-1">
                  <p className="text-[11px] text-muted-foreground">
                    Due: <span className="font-medium text-foreground">{fmt(editingMilestone.AmountDue)}</span>
                    {" · "}Balance: <span className="font-medium text-foreground">{fmt(editingBalance)}</span>
                  </p>
                  {previewOverflow > 0 && (
                    <p className="text-[11px] text-blue-600 font-medium mt-0.5 flex items-center gap-1">
                      <Wallet size={11} /> ₹{previewOverflow.toLocaleString("en-IN")} beyond what's currently due — if still true when this is approved, it'll be parked to On Account instead of counted against this milestone.
                    </p>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                <select value={payForm.PaymentMode} onChange={(e) => setPayForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select mode</option>
                  {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">
                  Deposited To (Company Bank){projectBanks.length > 0 ? ` — scoped to this project${payForm.AmountPaid && bankOptions.length > 0 ? " *" : ""}` : ""}
                </label>
                <select value={payForm.DepositBankId} onChange={(e) => setPayForm((f) => ({ ...f, DepositBankId: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select company bank</option>
                  {(bankOptions as any[]).map((b: any) => (
                    <option key={b.BId} value={String(b.BId)}>{b.BName}{b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
                <textarea value={payForm.Remarks} onChange={(e) => setPayForm((f) => ({ ...f, Remarks: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>

            {customerBank && (customerBank.BankName || customerBank.AccountNo) && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Customer's Bank (on file, reference only)</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Bank</span>
                  <span className="font-medium text-right">{customerBank.BankName || "—"}</span>
                  <span className="text-muted-foreground">A/C No.</span>
                  <span className="font-medium text-right font-mono">{customerBank.AccountNo || "—"}</span>
                  <span className="text-muted-foreground">IFSC</span>
                  <span className="font-medium text-right font-mono">{customerBank.IfscCode || "—"}</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setEditingId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRecordPayment}
              disabled={saving || !!(payForm.AmountPaid && bankOptions.length > 0 && !payForm.DepositBankId)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Submitting..." : "Submit for Approval"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Milestone Dialog */}
      <Dialog open={addDialog} onOpenChange={(o) => { if (!o) setAddDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Add Custom Milestone</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Milestone Name *</label>
              <input type="text" value={addForm.MilestoneName}
                onChange={(e) => setAddForm((f) => ({ ...f, MilestoneName: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. PLC Charges" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Due Date</label>
              <input type="date" value={addForm.DueDate}
                onChange={(e) => setAddForm((f) => ({ ...f, DueDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Amount Due (₹)</label>
              <input type="number" value={addForm.AmountDue}
                onChange={(e) => setAddForm((f) => ({ ...f, AmountDue: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Responsible Department</label>
              <input type="text" value={addForm.ResponsibleDepartment}
                onChange={(e) => setAddForm((f) => ({ ...f, ResponsibleDepartment: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. Construction, Legal, Sales" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Required Documents</label>
              <input type="text" value={addForm.RequiredDocuments}
                onChange={(e) => setAddForm((f) => ({ ...f, RequiredDocuments: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                placeholder="e.g. Completion Certificate" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAddDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleAddMilestone} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Adding..." : "Add Milestone"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Deposit On Account Dialog */}
      <Dialog open={onAccountDialog} onOpenChange={(o) => { if (!o) setOnAccountDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><Wallet size={16} className="text-blue-600" /> Deposit On Account</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">For a customer paying more than what's currently due — held as a credit and applied to milestones as they come up, in order.</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Amount (₹) *</label>
              <input type="number" value={onAccountForm.Amount}
                onChange={(e) => setOnAccountForm((f) => ({ ...f, Amount: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Received Date</label>
                <input type="date" value={onAccountForm.ReceivedDate}
                  onChange={(e) => setOnAccountForm((f) => ({ ...f, ReceivedDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Mode</label>
                <select value={onAccountForm.PaymentMode} onChange={(e) => setOnAccountForm((f) => ({ ...f, PaymentMode: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select mode</option>
                  {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Transaction Ref</label>
              <input type="text" value={onAccountForm.TransactionRef}
                onChange={(e) => setOnAccountForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Deposited To (Company Bank){projectBanks.length > 0 ? ` — scoped to this project${bankOptions.length > 0 ? " *" : ""}` : ""}
              </label>
              <select value={onAccountForm.DepositBankId} onChange={(e) => setOnAccountForm((f) => ({ ...f, DepositBankId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select company bank</option>
                {(bankOptions as any[]).map((b: any) => (
                  <option key={b.BId} value={String(b.BId)}>{b.BName}{b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={onAccountForm.Notes} onChange={(e) => setOnAccountForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setOnAccountDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleDepositOnAccount}
              disabled={saving || !onAccountForm.Amount || (bankOptions.length > 0 && !onAccountForm.DepositBankId)}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Recording..." : "Record Deposit"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmPaymentMilestones;