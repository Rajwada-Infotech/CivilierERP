import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, AlertTriangle, CheckCircle2, Landmark, Pencil, Lock,
  ShieldCheck, Building2, ArrowRight,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/noc";
const NOC_TYPES = ["Organisation", "Bank"] as const;

// ─── Status badge ──────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Pending:  { text: "text-amber-700",   bar: "bg-amber-500" },
  Approved: { text: "text-blue-700",    bar: "bg-blue-500" },
  Issued:   { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected: { text: "text-rose-700",    bar: "bg-rose-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider",
      c.text,
    )}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

// ─── Detail row ────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading shrink-0">{label}</span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Fetchers ──────────────────────────────────────────────────────────────

async function fetchAll(type?: string, status?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (type && type !== "All") params.set("type", type);
    if (status && status !== "All") params.set("status", status);
    const r = await fetchWithAuth(`${API}?${params}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function fetchEligibleBookings(type: string): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${API}/eligible-bookings?type=${encodeURIComponent(type)}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ─── Edit dialog for loan tracking / notes ─────────────────────────────────

function EditNocDialog({ noc, onClose, onSaved }: { noc: any; onClose: () => void; onSaved: () => void }) {
  const [lss, setLss]   = useState(noc.LoanSanctionStatus || "");
  const [lsd, setLsd]   = useState(noc.LoanSanctionDate?.slice(0, 10) || "");
  const [lds, setLds]   = useState(noc.LoanDisbursementStatus || "");
  const [ldd, setLdd]   = useState(noc.LoanDisbursementDate?.slice(0, 10) || "");
  const [notes, setNotes] = useState(noc.Notes || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${noc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          LoanSanctionStatus: lss || null,
          LoanSanctionDate: lsd || null,
          LoanDisbursementStatus: lds || null,
          LoanDisbursementDate: ldd || null,
          Notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("NOC details updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit NOC Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {noc.NocType === "Bank" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Sanction Status</label>
                  <select value={lss} onChange={(e) => setLss(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="">—</option>
                    <option>Sanctioned</option>
                    <option>Pending</option>
                    <option>Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Sanction Date</label>
                  <input type="date" value={lsd} onChange={(e) => setLsd(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Disbursement Status</label>
                  <select value={lds} onChange={(e) => setLds(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="">—</option>
                    <option>Disbursed</option>
                    <option>Partial</option>
                    <option>Pending</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Disbursement Date</label>
                  <input type="date" value={ldd} onChange={(e) => setLdd(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  BookingId: "", NocType: "Organisation" as string, NocDate: "",
  Reason: "", BankName: "", LoanAccountNo: "", LoanAmount: "",
};

const CrmNoc: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");

  // Filter tabs
  const [typeFilter, setTypeFilter]     = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm]   = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [bankFieldsLocked, setBankFieldsLocked] = useState(true);

  // Detail / edit dialogs
  const [detailId, setDetailId] = useState<number | null>(null);
  const [markingIssued, setMarkingIssued] = useState(false);
  const [editNoc, setEditNoc] = useState<any>(null);

  usePageRights("crm-noc");

  // Data
  const { data: nocs = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-noc", typeFilter, statusFilter],
    queryFn: () => fetchAll(typeFilter, statusFilter),
    staleTime: 30_000,
  });

  const { data: eligibleBookings = [], isFetching: bkgFetching } = useQuery({
    queryKey: ["crm-noc-eligible", form.NocType],
    queryFn: () => fetchEligibleBookings(form.NocType),
    enabled: dialogOpen,
    staleTime: 0,
  });

  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });

  const detail = detailId != null ? (nocs as any[]).find((n: any) => n.Id === detailId) : null;

  // Gate: AFS must be Registered (eligible-bookings already enforces this, but
  // guard again here for deep-link cases where context is fetched separately)
  const agreementRegistered = context?.agreement?.Status === CrmStatus.REGISTERED;
  const canRequest = !!form.BookingId && agreementRegistered && !contextLoading && !saving;

  // Deep-link: open create dialog pre-filled with a bookingId
  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen) return;
    setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
    setDialogOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId]);

  // Auto-fill Bank NOC from loan tracking record
  useEffect(() => {
    if (form.NocType !== "Bank" || !context) return;
    setForm((f) => ({
      ...f,
      BankName:      f.BankName      || context.loanDetail?.BankName      || "",
      LoanAccountNo: f.LoanAccountNo || context.loanDetail?.LoanAccountNo || "",
      LoanAmount:    f.LoanAmount    || (context.loanDetail?.LoanAmount != null ? String(context.loanDetail.LoanAmount) : ""),
    }));
    setBankFieldsLocked(true);
  }, [form.NocType, context]);

  // Reset booking when type changes — a booking eligible for Org NOC might
  // already have a Bank NOC (so eligible list changes).
  const handleTypeChange = (t: string) => {
    setForm((f) => ({ ...f, NocType: t, BookingId: "" }));
    setBankFieldsLocked(true);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-noc"] });
    qc.invalidateQueries({ queryKey: ["crm-noc-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Select a booking"); return; }
    if (!agreementRegistered) { toast.error("Agreement for Sale must be Registered before a NOC can be requested"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), LoanAmount: form.LoanAmount || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`NOC ${data.NocNo} requested`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      invalidate();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkIssued = async () => {
    if (!detailId) return;
    setMarkingIssued(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/mark-issued`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("NOC marked as Issued");

      const current = (nocs as any[]).find((n) => n.Id === detailId);
      const siblingsIssued = current && (nocs as any[])
        .filter((n) => n.BookingId === current.BookingId && n.Id !== detailId)
        .every((n) => n.Status === "Issued");
      if (current && siblingsIssued) {
        promptNextStep(
          navigate,
          "All NOCs for this booking are issued — the pre-possession check can now proceed.",
          "/crm/pre-possession",
          "Go to Pre-Possession Check",
        );
      }
      setDetailId(null);
      invalidate();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setMarkingIssued(false);
    }
  };

  // Table columns
  const nocColumns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "NocNo", header: "NOC No", size: 120,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span>,
    },
    {
      accessorKey: "ApplicantName", header: "Customer", size: 200,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ),
    },
    {
      accessorKey: "NocType", header: "Type", size: 120,
      cell: (i) => {
        const t = i.getValue() as string;
        return (
          <span className={cn(
            "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium",
            t === "Bank" ? "text-blue-700 bg-blue-50 border-blue-200" : "text-purple-700 bg-purple-50 border-purple-200",
          )}>
            {t === "Bank" ? <Landmark size={10} /> : <Building2 size={10} />} {t}
          </span>
        );
      },
    },
    {
      id: "bankLoan", header: "Bank / Loan", size: 160, enableSorting: false,
      cell: (i) => {
        const n = i.row.original;
        return <span className="text-xs">{n.NocType === "Bank" ? `${n.BankName || "—"} · ${n.LoanAmount ? formatINR(n.LoanAmount) : "—"}` : "—"}</span>;
      },
    },
    {
      accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} />,
    },
    {
      accessorKey: "IssuedDate", header: "Issued", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{fmtDate(i.row.original.IssuedDate)}</span>,
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "No Objection Certificates"]} />
      <CrmShell
        title="No Objection Certificates (NOC)"
        subtitle="Organisation NOC — no outstanding dues; Bank NOC — lender's charge released after loan clearance"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
            >
              <Plus size={14} /> Request NOC
            </button>
          </div>
        }
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {(["All", "Organisation", "Bank"] as const).map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={cn("px-3 py-1.5 transition-colors", typeFilter === t ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {(["All", "Pending", "Approved", "Issued", "Rejected"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-3 py-1.5 transition-colors", statusFilter === s ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          data={nocs as any[]}
          columns={nocColumns}
          loading={isLoading}
          emptyMessage="No NOC requests matching the current filter"
          className="rounded-xl border border-border overflow-hidden bg-card"
          onRowClick={(row) => setDetailId(row.original.Id)}
        />

        {/* ── Request dialog ────────────────────────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading">Request NOC</DialogTitle>
            </DialogHeader>
            <div className="space-y-2.5">
              {/* NOC type first — changing type resets the booking selector */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">NOC Type</label>
                <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                  {NOC_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => handleTypeChange(t)}
                      className={cn("flex-1 py-1.5 transition-colors", form.NocType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Booking — shows only eligible bookings for the selected type */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
                {bkgFetching ? (
                  <p className="text-xs text-muted-foreground px-1">Loading eligible bookings…</p>
                ) : eligibleBookings.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed">
                    No eligible bookings for a {form.NocType} NOC. Requires: AFS Registered + no existing {form.NocType} NOC.
                  </p>
                ) : (
                  <select value={form.BookingId}
                    onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="">Select booking</option>
                    {(eligibleBookings as any[]).map((b: any) => (
                      <option key={b.Id} value={String(b.Id)}>
                        {b.BookingNo} — {b.ApplicantName} ({b.UnitNo})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Booking context preview */}
              {form.BookingId && !contextLoading && context && (
                <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] leading-relaxed space-y-0.5">
                  <div className="font-medium text-foreground">
                    {context.booking.ApplicantName}
                    <span className="text-muted-foreground font-normal"> · {context.booking.Mobile} · {context.booking.UnitNo}</span>
                  </div>
                  {context.agreement ? (
                    <div className={cn("flex items-center gap-1", agreementRegistered ? "text-green-700" : "text-amber-700")}>
                      {agreementRegistered
                        ? <CheckCircle2 size={11} />
                        : <AlertTriangle size={11} />}
                      {context.agreement.AgreementNo} — {context.agreement.Status}
                      {!agreementRegistered && <span className="font-medium"> (Registered required)</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-red-600 font-medium">
                      <AlertTriangle size={11} /> No agreement yet
                    </div>
                  )}
                  {context.existingNocs?.length > 0 && (
                    <div className="text-muted-foreground">
                      Existing NOCs: {context.existingNocs.map((n: any) => `${n.NocType}: ${n.Status}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {/* Bank NOC fields */}
              {form.NocType === "Bank" && (
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span className="flex items-center gap-1">
                      <Landmark size={11} />
                      {bankFieldsLocked ? "Auto-filled from Home Loan Tracking" : "Editing lender details"}
                    </span>
                    <button type="button" onClick={() => setBankFieldsLocked((l) => !l)}
                      className="flex items-center gap-1 text-primary hover:underline shrink-0">
                      {bankFieldsLocked ? <><Pencil size={10} /> Edit</> : <><Lock size={10} /> Lock</>}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { ph: "Bank Name",    val: form.BankName,      key: "BankName" },
                      { ph: "Loan A/C No.", val: form.LoanAccountNo, key: "LoanAccountNo" },
                      { ph: "Loan Amount",  val: form.LoanAmount,    key: "LoanAmount", num: true },
                    ].map(({ ph, val, key, num }) => (
                      <input key={key} type={num ? "number" : "text"} placeholder={ph} value={val}
                        readOnly={bankFieldsLocked}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className={cn("text-sm border border-border rounded px-2 py-1.5",
                          bankFieldsLocked ? "bg-muted/40 text-muted-foreground cursor-default" : "bg-background")} />
                    ))}
                  </div>
                </div>
              )}

              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                placeholder="Reason / purpose (optional)" rows={1}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleCreate} disabled={!canRequest}
                title={!agreementRegistered && form.BookingId ? "AFS must be Registered first" : undefined}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Requesting…" : "Request"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Detail dialog ─────────────────────────────────────────────── */}
        <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
          <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
            {detail && (
              <>
                <DialogHeader className="px-6 py-4 border-b border-border">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <ShieldCheck size={15} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.NocNo}</DialogTitle>
                      <DialogDescription className="text-[11px] mt-0.5">{detail.NocType} NOC</DialogDescription>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <StatusBadge status={detail.Status} />
                      {/* Edit button — available while not Issued (no point editing a closed NOC) */}
                      {detail.Status !== "Issued" && (
                        <button onClick={() => setEditNoc(detail)} title="Edit details"
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </DialogHeader>

                <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                  {/* Customer summary */}
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">{detail.ApplicantName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{detail.BookingNo} · {detail.UnitNo} · {detail.Mobile}</p>
                  </div>

                  {/* Fields */}
                  <div>
                    <DetailRow label="NOC Date"     value={fmtDate(detail.NocDate)} />
                    <DetailRow label="Reason"        value={detail.Reason || "—"} />
                    {detail.NocType === "Bank" && (
                      <>
                        <DetailRow label="Bank Name"     value={detail.BankName || "—"} />
                        <DetailRow label="Loan A/C No."  value={detail.LoanAccountNo || "—"} mono />
                        <DetailRow label="Loan Amount"   value={detail.LoanAmount ? formatINR(detail.LoanAmount) : "—"} mono />
                        <DetailRow label="Sanction"      value={
                          detail.LoanSanctionStatus
                            ? `${detail.LoanSanctionStatus}${detail.LoanSanctionDate ? " · " + fmtDate(detail.LoanSanctionDate) : ""}`
                            : "—"
                        } />
                        <DetailRow label="Disbursement"  value={
                          detail.LoanDisbursementStatus
                            ? `${detail.LoanDisbursementStatus}${detail.LoanDisbursementDate ? " · " + fmtDate(detail.LoanDisbursementDate) : ""}`
                            : "—"
                        } />
                      </>
                    )}
                    {detail.ApprovalDate && <DetailRow label="Approved"    value={fmtDate(detail.ApprovalDate)} />}
                    {detail.IssuedDate   && <DetailRow label="Issued"      value={fmtDate(detail.IssuedDate)} />}
                    {detail.Notes        && <DetailRow label="Notes"       value={<span className="italic">{detail.Notes}</span>} />}
                  </div>

                  {/* Action area — strictly status-gated */}
                  <div>
                    {detail.Status === "Issued" ? (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                        <CheckCircle2 size={16} />
                        Issued {fmtDate(detail.IssuedDate)} — no further action required
                      </div>
                    ) : detail.Status === CrmStatus.APPROVED ? (
                      <button onClick={handleMarkIssued} disabled={markingIssued}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                        <ArrowRight size={14} />
                        {markingIssued ? "Marking…" : "Mark as Issued"}
                      </button>
                    ) : detail.Status === CrmStatus.PENDING ? (
                      // ApprovalActions renders Approve + Reject for approver roles,
                      // and a "Pending approval" note for non-approvers.
                      <ApprovalActions
                        status={detail.Status}
                        recordId={detail.Id}
                        endpoint={API}
                        onSuccess={() => { invalidate(); setDetailId(null); }}
                      />
                    ) : detail.Status === CrmStatus.REJECTED ? (
                      <ApprovalActions
                        status={detail.Status}
                        recordId={detail.Id}
                        endpoint={API}
                        submitOnly
                        onSuccess={() => { invalidate(); setDetailId(null); }}
                      />
                    ) : null}
                  </div>
                </div>

                <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
                  <button onClick={() => setDetailId(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                    Close
                  </button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Edit dialog ───────────────────────────────────────────────── */}
        {editNoc && (
          <EditNocDialog
            noc={editNoc}
            onClose={() => setEditNoc(null)}
            onSaved={invalidate}
          />
        )}
      </CrmShell>
    </>
  );
};

export default CrmNoc;
