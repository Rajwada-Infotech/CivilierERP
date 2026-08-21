import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Lock, Pencil, ScrollText, RotateCcw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/sales-deed";
const BKG_API = "/api/crm/bookings";

// Status is never manually picked � it's auto-derived server-side, level by
// level, from ExecutedBy / RegistrationNo / DeedDate actually being on
// record (see deriveDeedStatus in backend/routes/crmSalesDeed.js).
const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Draft:      { text: "text-muted-foreground", bar: "bg-border" },
  Executed:   { text: "text-blue-700",   bar: "bg-blue-500" },
  Registered: { text: "text-emerald-700", bar: "bg-emerald-500" },
  Overdue:    { text: "text-rose-700",   bar: "bg-rose-500" },
  Cancelled:  { text: "text-rose-700",   bar: "bg-rose-500" },
};
const APPROVAL_CFG: Record<string, { text: string; bar: string }> = {
  Approved:    { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected:    { text: "text-rose-700",    bar: "bg-rose-500" },
  Pending:     { text: "text-amber-700",   bar: "bg-amber-500" },
  NotSent:     { text: "text-muted-foreground", bar: "bg-border" },
  NotRequired: { text: "text-muted-foreground", bar: "bg-border" },
};

function StatusBadge({ status, cfg = STATUS_CFG }: { status: string; cfg?: typeof STATUS_CFG }) {
  const c = cfg[status] ?? cfg.Draft ?? { text: "text-muted-foreground", bar: "bg-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading shrink-0">{label}</span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">{children}</h3>
      {action}
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "�";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const EMPTY_FORM = { BookingId: "", DeedValue: "", StampDuty: "", RegistrationFee: "", SubRegistrarOffice: "", DeedDate: "" };
const EMPTY_DEED_FORM = { DeedValue: "", StampDuty: "", RegistrationFee: "", SubRegistrarOffice: "", DeedDate: "" };
const EMPTY_PROGRESS_FORM = { ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const CrmSalesDeed: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [deedForm, setDeedForm] = useState({ ...EMPTY_DEED_FORM });
  const [deedFormEditing, setDeedFormEditing] = useState(false);
  const [savingDeed, setSavingDeed] = useState(false);
  const [progressForm, setProgressForm] = useState({ ...EMPTY_PROGRESS_FORM });
  const [savingProgress, setSavingProgress] = useState(false);
  const [sendingToCustomer, setSendingToCustomer] = useState(false);

  const { data: deeds = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-sales-deed"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-sales-deed-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });

  const trackedBookingIds = new Set((deeds as any[]).map((d: any) => d.BookingId));
  const eligibleBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  const agreementExecuted = context?.agreement?.Status === CrmStatus.EXECUTED;
  // Loan Processing only exists as a gate at all for a booking explicitly
  // marked Loan-Financed � Self-Funded and undeclared bookings never had a
  // loan to process, so they clear immediately (see
  // checkLoanProcessingCleared in crmWorkflowGuards.js). Construction
  // milestone payments (Foundation, Slab Casting, etc.) are a separate,
  // genuinely parallel track and never gate this either.
  const isLoanFinanced = context?.booking?.FinancingType === "LoanFinanced";
  const loanCleared = !context?.loanBlockReason;
  const canCreate = !!form.BookingId && agreementExecuted && loanCleared && !contextLoading;

  const detail = detailId != null ? (deeds as any[]).find((d: any) => d.Id === detailId) : null;
  // Deed Value / Stamp Duty / Registration Fee / Sub-Registrar Office / Deed
  // Date can only be corrected before the deed has been sent to the customer
  // for approval � once sent, the customer (and later the director) is
  // signing off on those exact numbers, and Stamp Duty / Registration Fee
  // also feed Query Payment's live-computed amount (see crmSalesDeed.js
  // PUT /:id for the matching server-side guard).
  const deedFieldsLocked = !!detail?.SentToCustomerAt;
  const progressLocked = detail && (detail.Status === CrmStatus.REGISTERED || detail.Status === CrmStatus.CANCELLED);

  // Deep-link from Legal Milestones: pre-fill New Deed with this booking if
  // it doesn't have one yet.
  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen) return;
    if ((deeds as any[]).some((d: any) => String(d.BookingId) === deepLinkBookingId)) return;
    if ((bookings as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, deeds.length, bookings.length]);

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!canCreate) { toast.error("This booking isn't eligible for a sale deed yet"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sale deed ${data.DeedNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (d: any) => {
    setDeedForm({
      DeedValue: d.DeedValue != null ? String(d.DeedValue) : "",
      StampDuty: d.StampDuty != null ? String(d.StampDuty) : "",
      RegistrationFee: d.RegistrationFee != null ? String(d.RegistrationFee) : "",
      SubRegistrarOffice: d.SubRegistrarOffice || "",
      DeedDate: d.DeedDate ? String(d.DeedDate).slice(0, 10) : "",
    });
    setProgressForm({
      ExecutedBy: d.ExecutedBy || "", RegistrationNo: d.RegistrationNo || "",
      BookNo: d.BookNo || "", PartNo: d.PartNo || "",
      RegistrationDate: d.RegistrationDate ? String(d.RegistrationDate).slice(0, 10) : "",
      PossessionDate: d.PossessionDate ? String(d.PossessionDate).slice(0, 10) : "",
    });
    setDeedFormEditing(false);
    setDetailId(d.Id);
  };

  const handleSaveDeedFields = async () => {
    if (!detailId) return;
    setSavingDeed(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deedForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Deed details updated");
      setDeedFormEditing(false);
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingDeed(false);
    }
  };

  const handleSaveProgress = async () => {
    if (!detailId) return;
    setSavingProgress(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(progressForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Deed status: ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      // Deed approval changes handover eligibility and dashboard KPIs
      qc.invalidateQueries({ queryKey: ["crm-handover-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingProgress(false);
    }
  };

  // The customer-portal approval loop is normally auto-triggered the moment
  // ExecutedBy is first set (see crmSalesDeed.js PUT /:id) � but that's a
  // best-effort convenience, not the only path, so staff need an explicit
  // fallback for cases the auto-trigger doesn't cover (e.g. it silently
  // missed a deed whose ExecutedBy and RegistrationNo were set together in
  // one request � a real bug that left a deed fully Registered with the
  // customer never having been asked to approve it).
  const handleSendToCustomer = async () => {
    if (!detailId) return;
    setSendingToCustomer(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/send-to-customer`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent to customer for approval");
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      // Customer sent ? dashboard "deeds awaiting customer" count changes
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSendingToCustomer(false);
    }
  };

  const deedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "DeedNo", header: "Deed No", size: 110,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="font-mono text-xs font-semibold text-primary hover:underline">
          {i.getValue() as string}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="text-left hover:underline">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} � {i.row.original.UnitNo}</div>
        </button>
      ) },
    { accessorKey: "DeedValue", header: "Deed Value", size: 120,
      cell: (i) => <span className="font-mono text-xs">{i.row.original.DeedValue ? formatINR(i.row.original.DeedValue) : "�"}</span> },
    { accessorKey: "RegistrationNo", header: "Registration No", size: 130,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "�"}</span> },
    { accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { id: "customerApproval", header: "Customer Approval", size: 140, enableSorting: false,
      cell: (i) => {
        const d = i.row.original;
        return d.CustomerApprovalStatus && d.CustomerApprovalStatus !== "NotSent" ? (
          <StatusBadge status={d.CustomerApprovalStatus} cfg={APPROVAL_CFG} />
        ) : (
          <span className="text-xs text-muted-foreground">Not sent</span>
        );
      } },
    { id: "directorApproval", header: "Director Approval", size: 140, enableSorting: false,
      cell: (i) => {
        const d = i.row.original;
        return d.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired" ? (
          <StatusBadge status={d.DirectorApprovalStatus} cfg={APPROVAL_CFG} />
        ) : (
          <span className="text-xs text-muted-foreground">�</span>
        );
      } },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <button onClick={() => openDetail(i.row.original)} className="text-xs text-primary hover:underline">
          Open
        </button>
      ) },
  ];

  return (
    <CrmShell
      title="CRM � Sale Deed"
      subtitle="Deed execution and registration tracking"
      action={
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Refreshing�" : "Refresh"}
            </button>
          )}
          <button onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
            <Plus size={14} /> New Deed
          </button>
        </div>
      }
    >
      <DataTable
        data={deeds as any[]}
        columns={deedColumns}
        loading={isLoading}
        emptyMessage="No sale deeds"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* -- New Sale Deed ----------------------------------------------- */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Plus size={15} className="text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold font-heading">New Sale Deed</DialogTitle>
                <DialogDescription className="text-[11px] mt-0.5">Start deed preparation for a booking</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value, DeedValue: "" }))}
                className="w-full h-10 text-sm border border-border rounded-lg px-3 bg-background">
                <option value="">Select booking</option>
                {eligibleBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} � {b.ApplicantName}</option>
                ))}
              </select>
              {eligibleBookings.length === 0 && (
                <p className="text-xs text-muted-foreground">Every booking already has a sale deed.</p>
              )}
            </div>

            {form.BookingId && (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 space-y-1.5">
                {contextLoading ? (
                  <div className="text-xs text-muted-foreground">Checking eligibility...</div>
                ) : !context ? (
                  <div className="text-xs text-muted-foreground">Couldn't load booking details.</div>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground">{context.booking?.ApplicantName}</p>
                    <p className="text-xs text-muted-foreground -mt-1">{context.booking?.BookingNo} � {context.booking?.UnitNo} � Booking Value {formatINR(context.booking?.GrandTotal)}</p>
                    <div className={cn("flex items-center gap-1.5 text-xs pt-1", agreementExecuted ? "text-emerald-700" : "text-rose-600")}>
                      {agreementExecuted ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      Agreement {context.agreement ? `(${context.agreement.AgreementNo}) � ${context.agreement.Status}` : "� not created yet"}
                    </div>
                    {isLoanFinanced && (
                      <div className="space-y-1">
                        <div className={cn("flex items-center gap-1.5 text-xs", loanCleared ? "text-emerald-700" : "text-rose-600")}>
                          {loanCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Loan Processing � {loanCleared ? context.loanDetail?.SanctionStatus : context.loanBlockReason}
                        </div>
                        {!loanCleared && (
                          <button
                            onClick={() => navigate(`/crm/loan-details?bookingId=${form.BookingId}`)}
                            className="flex items-center gap-1 text-xs text-primary hover:underline pl-[18px]"
                          >
                            Go to Loan Tracking <ExternalLink size={10} />
                          </button>
                        )}
                      </div>
                    )}
                    {!canCreate && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600 pt-0.5">
                        <AlertTriangle size={12} /> Not yet eligible � resolve the items above first.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Deed Value</label>
                <Input type="number" className="h-10 font-mono" value={form.DeedValue} onChange={(e) => setForm((f) => ({ ...f, DeedValue: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Stamp Duty</label>
                <Input type="number" className="h-10 font-mono" value={form.StampDuty} onChange={(e) => setForm((f) => ({ ...f, StampDuty: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Registration Fee</label>
                <Input type="number" className="h-10 font-mono" value={form.RegistrationFee} onChange={(e) => setForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Deed Date</label>
                <Input type="date" className="h-10" value={form.DeedDate} onChange={(e) => setForm((f) => ({ ...f, DeedDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Sub-Registrar Office</label>
              <Input className="h-10" value={form.SubRegistrarOffice} onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
            </div>
          </div>

          <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !canCreate}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? "Creating..." : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -- Deed detail � the single place to view AND act on a deed: core
          deed fields (editable until sent to customer), execution/
          registration progress, and the approval chain. --------------- */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
          {detail && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ScrollText size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.DeedNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">Sale Deed details</DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={detail.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{detail.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detail.BookingNo} � {detail.UnitNo} � {detail.Mobile}</p>
                </div>

                <div>
                  <SectionLabel action={!deedFieldsLocked && !deedFormEditing && (
                    <button onClick={() => setDeedFormEditing(true)} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                      <Pencil size={11} /> Edit
                    </button>
                  )}>
                    Deed Details
                  </SectionLabel>
                  {deedFieldsLocked && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 mb-2">
                      <Lock size={11} /> Locked � sent to the customer for approval on {fmtDate(detail.SentToCustomerAt)}.
                    </div>
                  )}
                  {deedFormEditing ? (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Deed Value</label>
                          <Input type="number" className="h-10 font-mono" value={deedForm.DeedValue} onChange={(e) => setDeedForm((f) => ({ ...f, DeedValue: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Stamp Duty</label>
                          <Input type="number" className="h-10 font-mono" value={deedForm.StampDuty} onChange={(e) => setDeedForm((f) => ({ ...f, StampDuty: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Registration Fee</label>
                          <Input type="number" className="h-10 font-mono" value={deedForm.RegistrationFee} onChange={(e) => setDeedForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Deed Date</label>
                          <Input type="date" className="h-10" value={deedForm.DeedDate} onChange={(e) => setDeedForm((f) => ({ ...f, DeedDate: e.target.value }))} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Sub-Registrar Office</label>
                        <Input className="h-10" value={deedForm.SubRegistrarOffice} onChange={(e) => setDeedForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setDeedFormEditing(false)} className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                        <button onClick={handleSaveDeedFields} disabled={savingDeed}
                          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                          {savingDeed ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <DetailRow label="Deed Value" value={detail.DeedValue ? formatINR(detail.DeedValue) : "�"} mono />
                      <DetailRow label="Stamp Duty" value={detail.StampDuty ? formatINR(detail.StampDuty) : "�"} mono />
                      <DetailRow label="Registration Fee" value={detail.RegistrationFee ? formatINR(detail.RegistrationFee) : "�"} mono />
                      <DetailRow label="Deed Date" value={fmtDate(detail.DeedDate)} />
                      <DetailRow label="Sub-Registrar Office" value={detail.SubRegistrarOffice || "�"} />
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Execution &amp; Registration</SectionLabel>
                  {progressLocked ? (
                    <div>
                      <DetailRow label="Executed By" value={detail.ExecutedBy || "�"} />
                      <DetailRow label="Registration No." value={detail.RegistrationNo || "�"} mono />
                      <DetailRow label="Registration Date" value={fmtDate(detail.RegistrationDate)} />
                      <DetailRow label="Book No. / Part No." value={`${detail.BookNo || "�"} / ${detail.PartNo || "�"}`} />
                      <DetailRow label="Possession Date" value={fmtDate(detail.PossessionDate)} />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">Status advances automatically once these facts are on record � it is not picked manually.</p>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Executed By</label>
                        <Input className="h-10" value={progressForm.ExecutedBy} onChange={(e) => setProgressForm((f) => ({ ...f, ExecutedBy: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Registration No.</label>
                          <Input className="h-10 font-mono" value={progressForm.RegistrationNo} onChange={(e) => setProgressForm((f) => ({ ...f, RegistrationNo: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Registration Date</label>
                          <Input type="date" className="h-10" value={progressForm.RegistrationDate} onChange={(e) => setProgressForm((f) => ({ ...f, RegistrationDate: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Book No.</label>
                          <Input className="h-10" value={progressForm.BookNo} onChange={(e) => setProgressForm((f) => ({ ...f, BookNo: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Part No.</label>
                          <Input className="h-10" value={progressForm.PartNo} onChange={(e) => setProgressForm((f) => ({ ...f, PartNo: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Possession Date</label>
                          <Input type="date" className="h-10" value={progressForm.PossessionDate} onChange={(e) => setProgressForm((f) => ({ ...f, PossessionDate: e.target.value }))} />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button onClick={handleSaveProgress} disabled={savingProgress}
                          className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                          {savingProgress ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Approvals</SectionLabel>
                  <DetailRow label="Customer Approval" value={<StatusBadge status={detail.CustomerApprovalStatus || "NotSent"} cfg={APPROVAL_CFG} />} />
                  {!detail.SentToCustomerAt && detail.Status !== CrmStatus.REGISTERED && (
                    <div className="flex justify-end pb-2">
                      <button onClick={handleSendToCustomer} disabled={sendingToCustomer}
                        className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted disabled:opacity-40 transition-colors">
                        {sendingToCustomer ? "Sending..." : "Send to Customer for Approval"}
                      </button>
                    </div>
                  )}
                  {detail.DirectorApprovalStatus && detail.DirectorApprovalStatus !== "NotRequired" && (
                    <DetailRow
                      label="Director Approval"
                      value={
                        <div className="flex items-center gap-2 justify-end">
                          <StatusBadge status={detail.DirectorApprovalStatus} cfg={APPROVAL_CFG} />
                          {detail.DirectorApprovalStatus === CrmStatus.PENDING && (
                            <ApprovalActions
                              status={detail.DirectorApprovalStatus}
                              recordId={detail.Id}
                              endpoint={API}
                              actionPathSuffix="director"
                              approverRoles={["super_admin"]}
                              onSuccess={() => { qc.invalidateQueries({ queryKey: ["crm-sales-deed"] }); setDetailId(null); }}
                            />
                          )}
                        </div>
                      }
                    />
                  )}
                </div>
              </div>

              <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
                <button onClick={() => setDetailId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Close</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmSalesDeed;
