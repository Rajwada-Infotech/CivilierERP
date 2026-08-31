import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { AlertCircle, CheckCircle2, Clock, Plus, Wallet, RefreshCw, ArrowDownCircle, ArrowUpCircle, AlertTriangle, MessageSquare } from "lucide-react";
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

const bookingStatusColor: Record<string, string> = {
  Approved:        "text-green-700 bg-green-50 border-green-200",
  "Pending Approval": "text-orange-700 bg-orange-50 border-orange-200",
  Cancelled:       "text-red-700 bg-red-50 border-red-200",
  Draft:           "text-muted-foreground bg-muted/50 border-border",
};

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const pct = (paid: number, due: number) =>
  due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;

const todayStr = () => new Date().toISOString().slice(0, 10);

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
  const [applyDialog, setApplyDialog] = useState<{ payment: any; milestone: any | null; amount: string } | null>(null);
  const [applyMilestoneId, setApplyMilestoneId] = useState<string>("");
  const [waiveDialog, setWaiveDialog] = useState<{ milestone: any; reason: string } | null>(null);
  const [remarksDialog, setRemarksDialog] = useState<{ milestone: any } | null>(null);

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

  // Total pending finance approval across all milestones
  const totalPendingVerification = milestones.reduce(
    (s: number, m: any) => s + Number(m.PendingVerificationAmount || 0), 0
  );

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

  const milestone1 = milestones.find((m) => m.MilestoneNo === 1);
  const needsResync = !!(
    booking?.BookingAmount &&
    milestone1 &&
    Math.abs(Number(milestone1.AmountDue) - Number(booking.BookingAmount)) >= 1
  );

  // Live preview for the Record Payment dialog
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
    const remaining = Math.max(0, Number(m.AmountDue) - Number(m.AmountPaid || 0));
    setPayForm({
      // Pre-fill with remaining balance if nothing is recorded yet; show existing value otherwise
      AmountPaid: m.AmountPaid != null && Number(m.AmountPaid) > 0 ? String(m.AmountPaid) : (remaining > 0 ? String(remaining) : ""),
      PaidDate: m.PaidDate ? String(m.PaidDate).slice(0, 10) : todayStr(),
      PaymentMode: m.PaymentMode || "",
      TransactionRef: m.TransactionRef || "",
      Remarks: m.Remarks || "",
      DepositBankId: m.DepositBankId != null ? String(m.DepositBankId)
        : projectBanks.length === 1 ? String(projectBanks[0].BId) : "",
    });
  };

  const handleWaive = (m: any) => {
    setWaiveDialog({ milestone: m, reason: "" });
  };

  const [waiving, setWaiving] = useState(false);
  const handleWaiveConfirm = async () => {
    if (!waiveDialog?.reason.trim()) return;
    setWaiving(true);
    try {
      const res = await fetchWithAuth(`${API}/${waiveDialog.milestone.Id}/waive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: waiveDialog.reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone waived");
      setWaiveDialog(null);

      const allOthersCleared = milestones.filter((x) => x.Id !== waiveDialog.milestone.Id).every((x) => ["Paid", "Waived"].includes(x.Status));
      if (allOthersCleared) {
        promptNextStep(navigate, "All payment milestones are cleared — the Sales Deed is ready to prepare.", "/crm/sales-deed", "Go to Sales Deed");
      }

      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setWaiving(false);
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
      toast.success(`On-account deposit submitted for Finance approval${data.RPDocNo ? ` — ${data.RPDocNo}` : ""}. It won't appear until approved.`);
      setOnAccountDialog(false);
      setOnAccountForm({ Amount: "", ReceivedDate: "", PaymentMode: "", TransactionRef: "", Notes: "", DepositBankId: "" });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const openApplyDialog = (payment: any, milestone: any | null) => {
    const remaining = Number(payment.Amount) - Number(payment.AppliedAmount || 0);
    const milestoneBalance = milestone ? Number(milestone.AmountDue) - Number(milestone.AmountPaid || 0) : remaining;
    const defaultAmount = milestone ? Math.min(remaining, milestoneBalance) : remaining;
    setApplyMilestoneId(milestone ? String(milestone.Id) : "");
    setApplyDialog({ payment, milestone, amount: String(defaultAmount) });
  };

  const handleConfirmApply = async () => {
    if (!applyDialog) return;
    const milId = applyDialog.milestone?.Id ?? parseInt(applyMilestoneId);
    if (!milId) { toast.error("Select a milestone to apply to"); return; }
    const amount = parseFloat(applyDialog.amount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/on-account/${applyDialog.payment.Id}/apply`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MilestoneId: milId, Amount: amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`₹${amount.toLocaleString("en-IN")} applied from ${applyDialog.payment.ReceiptNo}`);
      setApplyDialog(null);
      qc.invalidateQueries({ queryKey: ["crm-milestones", selectedBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-on-account", selectedBookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const milestoneColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "MilestoneNo", header: "#", size: 40,
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue() as number}</span> },
    { accessorKey: "MilestoneName", header: "Milestone", size: 200,
      cell: (i) => {
        const m = i.row.original;
        const demandColor =
          m.DemandStatus === "Demanded" ? "text-blue-700 bg-blue-50 border-blue-200" :
          m.DemandStatus === CrmStatus.PAID ? "text-green-700 bg-green-50 border-green-200" : null;
        return (
          <span className="font-medium text-sm">
            {m.MilestoneName}
            {m.DemandStatus && m.DemandStatus !== CrmStatus.PENDING && demandColor && (
              <div className="mt-0.5 flex items-center gap-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${demandColor}`}>
                  {m.DemandStatus === "Demanded" ? `Demand Raised${m.DemandNo ? ` · ${m.DemandNo}` : ""}` : `Demand ${m.DemandStatus}`}
                </span>
                {m.DemandRaisedOn && (
                  <span className="text-[10px] text-muted-foreground">{fmtDate(m.DemandRaisedOn)}</span>
                )}
              </div>
            )}
            {m.RequiredDocuments && (
              <div className="text-[10px] text-muted-foreground font-normal mt-0.5 truncate max-w-[180px]" title={m.RequiredDocuments}>
                Docs: {m.RequiredDocuments}
              </div>
            )}
          </span>
        );
      } },
    { accessorKey: "ResponsibleDepartment", header: "Dept", size: 90,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ResponsibleDepartment || "—"}</span> },
    { accessorKey: "DueDate", header: "Due Date", size: 110,
      cell: (i) => {
        const m = i.row.original;
        const isOverdue = m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date();
        return (
          <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : ""}`}>
            {fmtDate(m.DueDate)}
          </span>
        );
      } },
    { accessorKey: "AmountDue", header: "Amount Due", size: 130,
      cell: (i) => (
        <span className="font-semibold text-sm">
          {fmt(i.row.original.AmountDue)}
          {i.row.original.Percent != null && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">({Number(i.row.original.Percent)}%)</span>
          )}
        </span>
      ) },
    { accessorKey: "AmountPaid", header: "Amount Paid", size: 120,
      cell: (i) => {
        const m = i.row.original;
        return (
          <span className="text-green-600 font-semibold text-sm">
            {fmt(m.AmountPaid)}
            {Number(m.PendingVerificationAmount) > 0 && (
              <div className="text-[10px] text-amber-700 font-normal">
                +{fmt(m.PendingVerificationAmount)} pending
              </div>
            )}
          </span>
        );
      } },
    { accessorKey: "PaidDate", header: "Paid On", size: 110,
      cell: (i) => {
        const m = i.row.original;
        if (!m.PaidDate) return <span className="text-xs text-muted-foreground">—</span>;
        return <span className="text-xs">{fmtDate(m.PaidDate)}</span>;
      } },
    { id: "balance", header: "Balance", size: 110, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
        if (m.Status === "Waived") return <span className="text-xs text-muted-foreground">—</span>;
        return balance > 0
          ? <span className="text-red-600 font-semibold text-sm flex items-center gap-1"><ArrowDownCircle size={12} className="shrink-0" />{fmt(balance)}</span>
          : <span className="text-emerald-600 font-semibold text-sm flex items-center gap-1"><CheckCircle2 size={12} className="shrink-0" />Settled</span>;
      } },
    { id: "status", header: "Status", size: 110, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        const isOverdue = m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date();
        const displayStatus = isOverdue ? "Overdue" : m.Status;
        return (
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${statusColor[displayStatus] || ""}`}>
            {statusIcon[displayStatus]}{displayStatus}
          </span>
        );
      } },
    { accessorKey: "PaymentMode", header: "Payment Mode", size: 120,
      cell: (i) => {
        const m = i.row.original;
        return (
          <span className="text-xs">
            {m.PaymentMode || "—"}
            {m.DepositBankName && (
              <div className="text-[10px] text-muted-foreground font-normal mt-0.5 truncate max-w-[110px]" title={m.DepositBankName}>{m.DepositBankName}</div>
            )}
          </span>
        );
      } },
    { accessorKey: "TransactionRef", header: "Ref / Remarks", size: 130,
      cell: (i) => {
        const m = i.row.original;
        return (
          <span className="text-xs">
            <span className="font-mono">{m.TransactionRef || "—"}</span>
            {m.Remarks && (
              <button
                onClick={() => setRemarksDialog({ milestone: m })}
                title={m.Remarks}
                className="ml-1.5 text-muted-foreground hover:text-foreground align-middle inline-flex"
              >
                <MessageSquare size={11} />
              </button>
            )}
          </span>
        );
      } },
    { id: "actions", header: "", size: 150, enableSorting: false,
      cell: (i) => {
        const m = i.row.original;
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {m.Status !== CrmStatus.PAID && m.Status !== "Waived" && (
              <>
                <button onClick={() => handleOpenPayment(m)}
                  className="text-xs px-2 py-1 border border-primary text-primary rounded-md hover:bg-primary hover:text-primary-foreground transition-colors font-medium">
                  Pay
                </button>
                {onAccountBalance > 0 && (() => {
                  const pmt = onAccountData?.payments?.find((p: any) => Number(p.Amount) - Number(p.AppliedAmount || 0) > 0);
                  return pmt ? (
                    <button onClick={() => openApplyDialog(pmt, m)}
                      className="text-xs px-2 py-1 border border-blue-400 text-blue-600 rounded-md hover:bg-blue-50 transition-colors font-medium">
                      Adjust On A/c
                    </button>
                  ) : null;
                })()}
                <button onClick={() => handleWaive(m)}
                  className="text-xs px-2 py-1 border border-border text-muted-foreground rounded-md hover:bg-muted transition-colors font-medium">
                  Waive
                </button>
              </>
            )}
          </div>
        );
      } },
  ];

  usePageRights("crm-payments");

  const collectionPct = pct(summary.totalPaid || 0, summary.totalDue || 0);
  const pendingPct = summary.totalDue > 0
    ? Math.min(100 - collectionPct, Math.round((totalPendingVerification / summary.totalDue) * 100))
    : 0;

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
          <div className="py-16 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading milestones...
          </div>
        ) : !milestoneData ? (
          <div className="py-16 text-center text-muted-foreground text-sm">No milestone data found</div>
        ) : (
          <>
            {/* Booking summary card */}
            {booking && (() => {
              const grandTotal = Number(booking.GrandTotal ?? booking.TotalValue ?? 0);
              const parkingTotal = Number(booking.ParkingTotal || 0);
              const extraTotal = Number(booking.ExtraChargesTotal || 0);
              const hasExtras = parkingTotal > 0 || extraTotal > 0;
              const bkgStatus = booking.BookingStatus;
              return (
                <div className="rounded-xl border border-border p-4 space-y-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground">{booking.ApplicantName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {booking.BookingNo} · {booking.UnitNo}{booking.ProjectName ? ` · ${booking.ProjectName}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                    {bkgStatus && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${bookingStatusColor[bkgStatus] || "text-muted-foreground bg-muted/50 border-border"}`}>
                        {bkgStatus}
                      </span>
                    )}
                    {booking.Mobile && (
                      <span className="text-xs text-muted-foreground">{booking.Mobile}</span>
                    )}
                  </div>
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
                            <span className="text-muted-foreground">Booking Amount (M1)</span>
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
                          <span className="text-muted-foreground">Collected</span>
                          <span className="font-medium text-green-600 tabular-nums">{fmt(summary.totalPaid)}</span>
                        </div>
                        {totalPendingVerification > 0 && (
                          <div className="flex items-baseline justify-between">
                            <span className="text-amber-700 flex items-center gap-1"><Clock size={11} /> Pending Approval</span>
                            <span className="text-amber-700 font-medium tabular-nums">{fmt(totalPendingVerification)}</span>
                          </div>
                        )}
                        <div className="flex items-baseline justify-between pt-1.5 mt-0.5 border-t border-border">
                          <span className="font-semibold text-foreground">Balance</span>
                          <span className={`font-bold tabular-nums flex items-center gap-1 ${summary.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {summary.balance > 0 && <ArrowDownCircle size={13} className="shrink-0" />}{fmt(summary.balance)}
                          </span>
                        </div>
                        {summary.overdue > 0 && (
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="text-red-600 flex items-center gap-1"><AlertCircle size={11} /> Overdue</span>
                            <span className="text-red-600 font-medium">{summary.overdue} milestone{summary.overdue > 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </div>
                      {/* Segmented progress bar: green = collected, amber = pending approval */}
                      <div className="mt-3">
                        <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                          <span>Collection Progress</span>
                          <span>{collectionPct}%{pendingPct > 0 ? ` (+${pendingPct}% pending)` : ""}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                          <div className="h-full bg-green-500 transition-all" style={{ width: `${collectionPct}%` }} />
                          {pendingPct > 0 && (
                            <div className="h-full bg-amber-400 transition-all" style={{ width: `${pendingPct}%` }} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* On-Account balance */}
            {onAccountData && (onAccountData.payments?.length > 0) && (
              <div className={`rounded-xl border p-4 ${onAccountBalance > 0 ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-border"}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Wallet size={14} className={onAccountBalance > 0 ? "text-emerald-600" : "text-muted-foreground"} />
                    On-Account Balance
                  </h3>
                  <span className={`text-lg font-bold flex items-center gap-1 ${onAccountBalance > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {onAccountBalance > 0 && <ArrowUpCircle size={16} className="shrink-0" />}{fmt(onAccountBalance)}
                  </span>
                </div>
                <div className="space-y-2">
                  {onAccountData.payments.map((p: any) => {
                    const remaining = Number(p.Amount) - Number(p.AppliedAmount || 0);
                    const canApply = remaining > 0 && p.Status !== "Applied";
                    return (
                      <div key={p.Id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-muted-foreground min-w-0">
                          <span className="font-medium text-foreground">{p.ReceiptNo}</span>
                          {" · "}{fmt(p.Amount)}
                          {p.PaymentMode ? ` · ${p.PaymentMode}` : ""}
                          {p.ReceivedDate ? ` · ${fmtDate(p.ReceivedDate)}` : ""}
                          {remaining > 0 && remaining < Number(p.Amount) && (
                            <span className="text-emerald-700 font-medium"> · {fmt(remaining)} remaining</span>
                          )}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`px-1.5 py-0.5 rounded-full border font-medium ${
                            p.Status === "Applied" ? "text-green-600 bg-green-50 border-green-200"
                            : p.Status === "PartiallyApplied" ? "text-blue-600 bg-blue-50 border-blue-200"
                            : "text-orange-600 bg-orange-50 border-orange-200"
                          }`}>
                            {p.Status === "PartiallyApplied" ? "Partial" : p.Status}
                          </span>
                          {canApply && (
                            <button onClick={() => openApplyDialog(p, null)}
                              className="px-2 py-0.5 rounded border border-blue-400 text-blue-600 bg-white dark:bg-transparent hover:bg-blue-50 font-medium transition-colors">
                              Apply →
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                const isOverdue = m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date();
                return isOverdue ? "bg-red-50/30 dark:bg-red-950/10" : "";
              }}
            />
          </>
        )}

        {/* Record Payment Dialog */}
        <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading">Submit Payment for Approval</DialogTitle>
              {editingMilestone && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">{editingMilestone.MilestoneName}</span>
                  {" — "}{fmt(editingMilestone.AmountDue)}
                  {editingBalance > 0 && <span className="text-muted-foreground"> · Balance: {fmt(editingBalance)}</span>}
                </p>
              )}
            </DialogHeader>
            <p className="text-[11px] text-muted-foreground -mt-2">Goes to Finance's Received Payment queue — Account's Head (or admin/super admin) must approve before it counts as paid.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Amount Paid (₹)</label>
                  <input type="number" value={payForm.AmountPaid}
                    onChange={(e) => setPayForm((f) => ({ ...f, AmountPaid: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Payment Date</label>
                  <input type="date" value={payForm.PaidDate}
                    onChange={(e) => setPayForm((f) => ({ ...f, PaidDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                {previewOverflow > 0 && (
                  <div className="col-span-2 -mt-1">
                    <p className="text-[11px] text-blue-600 font-medium flex items-center gap-1">
                      <Wallet size={11} /> ₹{previewOverflow.toLocaleString("en-IN")} beyond what's due — will be parked to On Account if still true when approved.
                    </p>
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
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Transaction Ref</label>
                  <input type="text" value={payForm.TransactionRef}
                    onChange={(e) => setPayForm((f) => ({ ...f, TransactionRef: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1">
                    Deposited To (Company Bank){projectBanks.length > 0 ? ` — scoped to this project` : ""}
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
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Customer's Bank (reference only)</p>
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
              <div className="grid grid-cols-2 gap-3">
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
              <button onClick={handleAddMilestone} disabled={saving || !addForm.MilestoneName.trim()}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Adding..." : "Add Milestone"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Deposit On Account Dialog */}
        <Dialog open={onAccountDialog} onOpenChange={(o) => { if (!o) setOnAccountDialog(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading flex items-center gap-1.5"><Wallet size={16} className="text-blue-600" /> Submit On-Account Deposit</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground -mt-2">Goes to Finance's Received Payment queue for approval. Once approved, it's held as a credit and auto-applied to the next due milestone in sequence.</p>
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
                  Deposited To (Company Bank){projectBanks.length > 0 ? ` — scoped to this project` : ""}
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
                {saving ? "Submitting..." : "Submit for Approval"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Apply On Account Dialog */}
        <Dialog open={!!applyDialog} onOpenChange={(o) => { if (!o) setApplyDialog(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-1.5">
                <Wallet size={16} className="text-blue-600" /> Apply On-Account to Milestone
              </DialogTitle>
            </DialogHeader>
            {applyDialog && (() => {
              const remaining = Number(applyDialog.payment.Amount) - Number(applyDialog.payment.AppliedAmount || 0);
              const unpaidMilestones = milestones.filter((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && (Number(m.AmountDue) - Number(m.AmountPaid || 0)) > 0);
              const chosenMilId = applyDialog.milestone?.Id ?? parseInt(applyMilestoneId);
              const chosenMil = applyDialog.milestone ?? milestones.find((m: any) => m.Id === chosenMilId);
              const milBalance = chosenMil ? Number(chosenMil.AmountDue) - Number(chosenMil.AmountPaid || 0) : 0;
              return (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment</span>
                      <span className="font-medium">{applyDialog.payment.ReceiptNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total received</span>
                      <span>{fmt(applyDialog.payment.Amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available to apply</span>
                      <span className="font-semibold text-emerald-700">{fmt(remaining)}</span>
                    </div>
                  </div>

                  {applyDialog.milestone ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Applying to milestone</p>
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-medium">
                        {applyDialog.milestone.MilestoneName}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({fmt(milBalance)} outstanding)</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Apply to milestone <span className="text-red-500">*</span></label>
                      <select value={applyMilestoneId} onChange={(e) => {
                        setApplyMilestoneId(e.target.value);
                        const m = milestones.find((x: any) => String(x.Id) === e.target.value);
                        if (m) {
                          const bal = Number(m.AmountDue) - Number(m.AmountPaid || 0);
                          setApplyDialog((d) => d ? { ...d, amount: String(Math.min(remaining, bal)) } : d);
                        }
                      }} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                        <option value="">— select —</option>
                        {unpaidMilestones.map((m: any) => (
                          <option key={m.Id} value={String(m.Id)}>
                            {m.MilestoneName} — {fmt(Number(m.AmountDue) - Number(m.AmountPaid || 0))} due
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Amount to apply</label>
                    <input type="number" min="1" max={remaining}
                      value={applyDialog.amount}
                      onChange={(e) => setApplyDialog((d) => d ? { ...d, amount: e.target.value } : d)}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                    {chosenMil && milBalance > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Milestone outstanding: {fmt(milBalance)} · Available: {fmt(remaining)}
                        {parseFloat(applyDialog.amount) >= milBalance && <span className="text-emerald-700 ml-1">— will fully settle this milestone</span>}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-1 border-t border-border">
                    <button onClick={() => setApplyDialog(null)}
                      className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                    <button onClick={handleConfirmApply} disabled={saving || !applyDialog.amount || (!applyDialog.milestone && !applyMilestoneId)}
                      className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40">
                      {saving ? "Applying…" : `Apply ${applyDialog.amount ? fmt(parseFloat(applyDialog.amount)) : ""}`}
                    </button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Waive Dialog */}
        <Dialog open={!!waiveDialog} onOpenChange={(o) => { if (!o) setWaiveDialog(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-1.5 text-amber-700">
                <AlertTriangle size={16} /> Waive Milestone
              </DialogTitle>
            </DialogHeader>
            {waiveDialog && (
              <>
                <p className="text-sm text-muted-foreground">
                  Waiving <span className="font-medium text-foreground">{waiveDialog.milestone.MilestoneName}</span> ({fmt(waiveDialog.milestone.AmountDue)}) marks it as cleared without payment. This cannot be undone.
                </p>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Reason *</label>
                  <textarea
                    value={waiveDialog.reason}
                    onChange={(e) => setWaiveDialog((d) => d ? { ...d, reason: e.target.value } : d)}
                    rows={3}
                    placeholder="e.g. Discount approved by management, PLC waiver agreed in negotiation…"
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  <button onClick={() => setWaiveDialog(null)}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                  <button onClick={handleWaiveConfirm}
                    disabled={waiving || !waiveDialog.reason.trim()}
                    className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-40">
                    {waiving ? "Waiving..." : "Confirm Waive"}
                  </button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Remarks Dialog */}
        <Dialog open={!!remarksDialog} onOpenChange={(o) => { if (!o) setRemarksDialog(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-1.5">
                <MessageSquare size={15} /> Payment Remarks
              </DialogTitle>
            </DialogHeader>
            {remarksDialog && (
              <>
                <p className="text-xs text-muted-foreground">{remarksDialog.milestone.MilestoneName} · {fmtDate(remarksDialog.milestone.PaidDate)}</p>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3 leading-relaxed">{remarksDialog.milestone.Remarks}</p>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setRemarksDialog(null)}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmPaymentMilestones;
