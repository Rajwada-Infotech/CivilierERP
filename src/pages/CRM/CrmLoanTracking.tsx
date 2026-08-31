import React, { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Landmark, Pencil, Lock, Sparkles, CheckCircle2,
  CircleDot, Circle, XCircle, IndianRupee, Phone, User,
  Hash, Building2, BadgeCheck, CalendarDays, Wallet,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const BKG_API = "/api/crm/bookings";
const WC_API  = "/api/crm/welcome-calls";

// ── Status meta ───────────────────────────────────────────────────────────────
type LoanStatus = "NotApplied" | "Applied" | "Sanctioned" | "Disbursed" | "Rejected";

const STATUS_ORDER: LoanStatus[] = ["NotApplied", "Applied", "Sanctioned", "Disbursed"];

const STATUS_META: Record<string, { label: string; pill: string; icon: React.ElementType }> = {
  NotApplied: { label: "Not Applied", pill: "text-muted-foreground bg-muted/60 border-border",            icon: Circle },
  Applied:    { label: "Applied",     pill: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800", icon: CircleDot },
  Sanctioned: { label: "Sanctioned",  pill: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700", icon: BadgeCheck },
  Disbursed:  { label: "Disbursed",   pill: "text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-700", icon: CheckCircle2 },
  Rejected:   { label: "Rejected",    pill: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800", icon: XCircle },
};

const SANCTION_STATUSES: LoanStatus[] = ["NotApplied", "Applied", "Sanctioned", "Disbursed", "Rejected"];

const EMPTY_FORM = {
  BankName: "", BranchName: "", LoanAmount: "", SanctionStatus: "NotApplied" as LoanStatus,
  SanctionDate: "", LoanAccountNo: "", RmName: "", RmContact: "", Notes: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) =>
  n != null && n !== 0 ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchLoanSummary(): Promise<any[]> {
  try {
    const r = await fetchWithAuth("/api/crm/loan-summary");
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function fetchBankPreferences(bookingId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${WC_API}/${bookingId}/bank-preferences`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function LoanStepper({ status }: { status: string }) {
  const steps = STATUS_ORDER;
  const idx = steps.indexOf(status as LoanStatus);
  const isRejected = status === "Rejected";
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((step, i) => {
        const done  = !isRejected && idx >= i;
        const curr  = !isRejected && idx === i;
        const meta  = STATUS_META[step];
        const Icon  = meta.icon;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center flex-1 min-w-0">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full border-2 transition-colors ${
                done
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : curr
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-600"
                  : "border-border bg-muted/30 text-muted-foreground"
              }`}>
                <Icon size={13} />
              </div>
              <span className={`text-[10px] mt-1 text-center leading-tight ${
                done ? "text-emerald-600 dark:text-emerald-400 font-medium" :
                curr ? "text-blue-600 dark:text-blue-400 font-medium" : "text-muted-foreground"
              }`}>{meta.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-shrink-0 h-0.5 w-6 mx-0.5 rounded ${
                !isRejected && idx > i ? "bg-emerald-400" : "bg-border"
              }`} />
            )}
          </React.Fragment>
        );
      })}
      {isRejected && (
        <div className="flex flex-col items-center ml-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-full border-2 border-red-400 bg-red-50 dark:bg-red-950/40 text-red-500">
            <XCircle size={13} />
          </div>
          <span className="text-[10px] mt-1 text-red-500 font-medium">Rejected</span>
        </div>
      )}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.NotApplied;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${m.pill}`}>
      {status === "NotApplied" ? "Not Applied" : status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const CrmLoanTracking: React.FC = () => {
  const qc = useQueryClient();
  const { rights } = usePageRights("crm-loan-details");
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");

  const [activeTab, setActiveTab] = useState<string>("All");
  const [editingRow, setEditingRow]   = useState<any | null>(null);
  const [form, setForm]     = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);

  const inputCls = `w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 ${
    locked ? "opacity-60 cursor-not-allowed bg-muted/20" : ""
  }`;

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-loan-summary"],
    queryFn: fetchLoanSummary,
    staleTime: 30_000,
  });

  const { data: bankPreferences = [] } = useQuery({
    queryKey: ["crm-bank-preferences", editingRow?.BookingId],
    queryFn: () => fetchBankPreferences(editingRow!.BookingId),
    enabled: !!editingRow && !locked,
    staleTime: 60_000,
  });

  // ── Derived stats ───────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const r = rows as any[];
    const notApplied  = r.filter((x) => x.SanctionStatus === "NotApplied").length;
    const applied     = r.filter((x) => x.SanctionStatus === "Applied").length;
    const sanctioned  = r.filter((x) => x.SanctionStatus === "Sanctioned").length;
    const disbursed   = r.filter((x) => x.SanctionStatus === "Disbursed").length;
    const rejected    = r.filter((x) => x.SanctionStatus === "Rejected").length;
    const totalDisbursedAmt = r.reduce((s, x) => s + (x.DisbursedAmount || 0), 0);
    return { notApplied, applied, sanctioned, disbursed, rejected, totalDisbursedAmt };
  }, [rows]);

  const TABS = [
    { key: "All",        label: "All",          count: (rows as any[]).length },
    { key: "NotApplied", label: "Not Applied",   count: stats.notApplied },
    { key: "Applied",    label: "Applied",        count: stats.applied },
    { key: "Sanctioned", label: "Sanctioned",     count: stats.sanctioned },
    { key: "Disbursed",  label: "Disbursed",      count: stats.disbursed },
    { key: "Rejected",   label: "Rejected",       count: stats.rejected },
  ];

  const filtered = useMemo(() =>
    (rows as any[]).filter((r: any) => activeTab === "All" || r.SanctionStatus === activeTab),
    [rows, activeTab]
  );

  // ── Dialog helpers ──────────────────────────────────────────────────────────
  const openRow = (row: any) => {
    setEditingRow(row);
    setForm(row.LoanId ? {
      BankName:      row.BankName      || "",
      BranchName:    row.BranchName    || "",
      LoanAmount:    row.LoanAmount    != null ? String(row.LoanAmount) : "",
      SanctionStatus: row.SanctionStatus || "NotApplied",
      SanctionDate:  row.SanctionDate ? String(row.SanctionDate).slice(0, 10) : "",
      LoanAccountNo: row.LoanAccountNo || "",
      RmName:        row.RmName        || "",
      RmContact:     row.RmContact     || "",
      Notes:         row.Notes         || "",
    } : { ...EMPTY_FORM });
    setLocked(!!row.LoanId);
  };

  const closeDialog = () => {
    setEditingRow(null);
    setLocked(false);
    setForm({ ...EMPTY_FORM });
  };

  // Deep-link: jump into a specific booking's dialog on mount
  useEffect(() => {
    if (!deepLinkBookingId || editingRow || (rows as any[]).length === 0) return;
    const id = parseInt(deepLinkBookingId, 10);
    const row = (rows as any[]).find((r: any) => r.BookingId === id);
    if (row) openRow(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, (rows as any[]).length]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!editingRow) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${editingRow.BookingId}/loan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Loan details saved");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-loan-summary"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Columns ───────────────────────────────────────────────────────────────────
  const columns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "BookingNo", header: "Booking", size: 110,
      cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span>,
    },
    {
      accessorKey: "ApplicantName", header: "Customer", size: 180,
      cell: (i) => (
        <div>
          <div className="font-medium text-sm">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.UnitNo} · {i.row.original.Mobile}</div>
        </div>
      ),
    },
    {
      id: "totalValue", header: "Booking Value", size: 120,
      cell: (i) => <span className="text-sm">{fmt(i.row.original.TotalValue)}</span>,
    },
    {
      id: "bank", header: "Bank", size: 130, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="text-sm">{i.row.original.BankName || <span className="text-muted-foreground">—</span>}</div>
          {i.row.original.BranchName && <div className="text-xs text-muted-foreground">{i.row.original.BranchName}</div>}
        </div>
      ),
    },
    {
      id: "loanAmount", header: "Sanctioned", size: 110, enableSorting: false,
      cell: (i) => <span className="text-sm">{fmt(i.row.original.LoanAmount)}</span>,
    },
    {
      id: "disbursed", header: "Disbursed (Actual)", size: 130, enableSorting: false,
      cell: (i) => {
        const d = i.row.original.DisbursedAmount;
        return <span className={`text-sm font-medium ${d > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{fmt(d)}</span>;
      },
    },
    {
      id: "status", header: "Status", size: 110, enableSorting: false,
      cell: (i) => <StatusPill status={i.row.original.SanctionStatus} />,
    },
    {
      id: "rm", header: "Bank RM", size: 150, enableSorting: false,
      cell: (i) => {
        const { RmName, RmContact } = i.row.original;
        return RmName
          ? <div><div className="text-sm">{RmName}</div><div className="text-xs text-muted-foreground">{RmContact}</div></div>
          : <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <CrmShell
      title="Home Loan Tracking"
      subtitle="Track bank coordination and disbursement status for every booking"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}
    >

      {/* ── Summary metric cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Not Applied",  value: stats.notApplied,  color: "text-muted-foreground", bg: "bg-muted/40" },
          { label: "Applied",      value: stats.applied,     color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/30" },
          { label: "Sanctioned",   value: stats.sanctioned,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
          { label: "Disbursed",    value: stats.disbursed,   color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
        ].map((m) => (
          <div key={m.label} className={`rounded-xl border border-border px-4 py-3 ${m.bg}`}>
            <div className={`text-2xl font-bold font-heading ${m.color}`}>{m.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      {/* ── Total disbursed callout ── */}
      {stats.totalDisbursedAmt > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
          <Wallet size={14} />
          Total disbursed via Home Loan receipts: {fmt(stats.totalDisbursedAmt)}
        </div>
      )}

      {/* ── Status filter tabs ── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 thin-scroll">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? "bg-primary-foreground/20" : "bg-muted"
            }`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        emptyMessage="No bookings match the selected filter"
        className="rounded-xl border border-border overflow-hidden bg-card"
        onRowClick={(row) => openRow(row.original)}
        getRowId={(r) => String(r.BookingId)}
      />

      {/* ── Edit / View Dialog ── */}
      <Dialog open={!!editingRow} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span className="flex items-center gap-2"><Landmark size={16} /> Home Loan Details</span>
              {editingRow?.LoanId && locked && rights?.edit && (
                <button
                  onClick={() => setLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0"
                >
                  <Pencil size={11} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          {editingRow && (
            <div className="space-y-4">

              {/* Booking info card */}
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    <User size={13} className="text-muted-foreground" />
                    {editingRow.ApplicantName}
                  </div>
                  <StatusPill status={editingRow.SanctionStatus} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Hash size={10} /> {editingRow.BookingNo}</span>
                  <span className="flex items-center gap-1"><Building2 size={10} /> Unit {editingRow.UnitNo}</span>
                  <span className="flex items-center gap-1"><Phone size={10} /> {editingRow.Mobile}</span>
                  <span className="flex items-center gap-1"><IndianRupee size={10} /> {fmt(editingRow.TotalValue)} booking value</span>
                </div>
              </div>

              {/* Loan progress stepper */}
              <div className="px-2 py-3 rounded-xl border border-border bg-card">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mb-3 px-1">Loan Progress</p>
                <LoanStepper status={editingRow.SanctionStatus} />
              </div>

              {/* Disbursement comparison (only when a loan record exists) */}
              {editingRow.LoanId && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${
                  editingRow.SanctionStatus === "Disbursed" && editingRow.LoanAmount > 0 &&
                  Math.abs((editingRow.DisbursedAmount || 0) - editingRow.LoanAmount) > 1
                    ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700"
                    : "border-border bg-muted/20"
                }`}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Sanctioned Amount</p>
                      <p className="font-semibold">{fmt(editingRow.LoanAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Disbursed via Receipts</p>
                      <p className={`font-semibold ${editingRow.DisbursedAmount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {fmt(editingRow.DisbursedAmount)}
                      </p>
                    </div>
                  </div>
                  {editingRow.SanctionStatus === "Disbursed" && editingRow.LoanAmount > 0 &&
                   Math.abs((editingRow.DisbursedAmount || 0) - editingRow.LoanAmount) > 1 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                      Sanctioned and disbursed amounts don't match — check with Accounts.
                    </p>
                  )}
                </div>
              )}

              {/* Lock notice */}
              {locked && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5">
                  <Lock size={11} /> Viewing only — click Edit to make changes.
                </div>
              )}

              {/* Welcome Call bank suggestions (edit mode only) */}
              {!locked && (bankPreferences as any[]).length > 0 && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400 mb-2">
                    <Sparkles size={11} /> Bank preferences from Welcome Call
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(bankPreferences as any[]).map((bp: any) => (
                      <button
                        key={bp.Id}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, BankName: bp.BankName }))}
                        title={bp.Remarks ? `Note: ${bp.Remarks}` : `Use ${bp.BankName}`}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-blue-300 bg-white dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                      >
                        <Landmark size={10} />
                        {bp.BankName}
                        {bp.Remarks && <span className="text-blue-400 dark:text-blue-500"> · {bp.Remarks}</span>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-blue-500 mt-1.5">Tap a bank to auto-fill the Bank Name below.</p>
                </div>
              )}

              {/* Sanction Status */}
              {!locked && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1 font-medium">Sanction Status</label>
                  <select
                    value={form.SanctionStatus}
                    onChange={(e) => setForm((f) => ({ ...f, SanctionStatus: e.target.value as LoanStatus }))}
                    className={inputCls}
                  >
                    {SANCTION_STATUSES.map((s) => (
                      <option key={s} value={s}>{s === "NotApplied" ? "Not Applied" : s}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Bank details */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "BankName",     label: "Bank Name",        type: "text", span: 1 },
                  { key: "BranchName",   label: "Branch",           type: "text", span: 1 },
                  { key: "LoanAmount",   label: "Sanctioned Amount (₹)", type: "number", span: 1 },
                  { key: "SanctionDate", label: "Sanction Date",    type: "date",   span: 1 },
                  { key: "LoanAccountNo", label: "Loan Account No", type: "text", span: 2 },
                ].map(({ key, label, type, span }) => (
                  <div key={key} className={span === 2 ? "col-span-2" : ""}>
                    <label className="text-xs text-muted-foreground block mb-1 font-medium">{label}</label>
                    {locked ? (
                      <p className="text-sm px-3 py-2 rounded-lg border border-border bg-muted/20">
                        {(form as any)[key] || <span className="text-muted-foreground">—</span>}
                      </p>
                    ) : (
                      <input
                        type={type}
                        value={(form as any)[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className={inputCls}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* RM details */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "RmName",    label: "RM Name",    type: "text" },
                  { key: "RmContact", label: "RM Contact", type: "text" },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground block mb-1 font-medium">{label}</label>
                    {locked ? (
                      <p className="text-sm px-3 py-2 rounded-lg border border-border bg-muted/20">
                        {(form as any)[key] || <span className="text-muted-foreground">—</span>}
                      </p>
                    ) : (
                      <input
                        type={type}
                        value={(form as any)[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className={inputCls}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1 font-medium">Notes</label>
                {locked ? (
                  <p className="text-sm px-3 py-2 rounded-lg border border-border bg-muted/20 min-h-[60px] whitespace-pre-wrap">
                    {form.Notes || <span className="text-muted-foreground">—</span>}
                  </p>
                ) : (
                  <textarea
                    value={form.Notes}
                    onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                    rows={3}
                    className={`${inputCls} resize-none`}
                  />
                )}
              </div>

              {/* Metadata */}
              {editingRow.LoanCreatedAt && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays size={10} />
                    Added {new Date(editingRow.LoanCreatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  {editingRow.LoanUpdatedAt && (
                    <span>Updated {new Date(editingRow.LoanUpdatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                {locked ? (
                  <button onClick={closeDialog} className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                    Close
                  </button>
                ) : (
                  <>
                    <button onClick={closeDialog} className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      {saving ? "Saving…" : editingRow.LoanId ? "Update" : "Save"}
                    </button>
                  </>
                )}
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmLoanTracking;
