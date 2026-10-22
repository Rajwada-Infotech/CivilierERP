import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
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
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { CrmSideDrawer } from "@/components/crm/CrmSideDrawer";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";

const API = "/api/crm/noc";

// ─── Status badge ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; badgeCls: string; accent: string }> = {
  Pending:  { label: "Pending",  badgeCls: "text-amber-700 bg-amber-50 border-amber-200",     accent: "border-l-amber-400" },
  Approved: { label: "Approved", badgeCls: "text-blue-700 bg-blue-50 border-blue-200",         accent: "border-l-blue-400" },
  Issued:   { label: "Issued",   badgeCls: "text-emerald-700 bg-emerald-50 border-emerald-200", accent: "border-l-emerald-500" },
  Rejected: { label: "Rejected", badgeCls: "text-rose-700 bg-rose-50 border-rose-200",         accent: "border-l-rose-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.Pending;
  return <span className={cn("text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", c.badgeCls)}>{c.label}</span>;
}

// ─── Detail row ────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted-foreground font-heading shrink-0">{label}</span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Fetchers ──────────────────────────────────────────────────────────────

interface ListPage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchNocList(q: CrmListQuery & { type: string }): Promise<ListPage> {
  const params = listParams(q);
  if (q.type !== "All") params.set("type", q.type);
  const r = await fetchWithAuth(`${API}?${params}`);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}

// No type param here — NOC type is resolved per booking (see NocType on
// each returned row), never chosen up front. Filtering this list by a
// pre-selected type before the user has even picked a booking would hide
// genuinely eligible bookings of the other type.
async function fetchEligibleBookings(): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${API}/eligible-bookings`);
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

// Deep-link lookup — fetches the NOC row for a specific booking directly from
// the server so the deep-link works even when the NOC is on page 2+ of the
// paginated list. Mirrors the same pattern used in CrmLegalMilestones and
// CrmHandover to fix the same class of pagination/deep-link bug.
async function fetchNocByBooking(bookingId: string, nocType?: string): Promise<any | null> {
  try {
    const params = new URLSearchParams({ bookingId });
    if (nocType) params.set("nocType", nocType);
    const r = await fetchWithAuth(`${API}/by-booking?${params}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ─── Edit dialog for loan tracking / notes ─────────────────────────────────

// Loan Sanction/Disbursement Status+Date used to be editable here too, but
// they were a second, disconnected copy of what the Loan Tracking page
// (CrmLoanDetail) already tracks — nothing in the workflow (resolveNocType,
// checkLoanProcessingCleared, the lifecycle bar, the Sales Deed page) ever
// read this copy, so a staff member filling it in here was writing to a
// field the system quietly ignored while trusting the wrong number if it
// ever drifted from the real one. Removed; see the Loan Tracking page for
// actual loan status. Only Notes is editable here now.
function EditNocDialog({ noc, onClose, onSaved }: { noc: any; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(noc.Notes || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${noc.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Notes: notes || null }),
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
      <DialogContent accent="crm" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit NOC Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
            className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
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
  const rights = usePageRights("crm-noc");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deepLinkNocType   = sp.get("nocType"); // "Bank" | "Organisation"

  const [typeFilter, setTypeFilter] = useState("All");
  const list = useCrmListState({ pageSize: 20, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const listFilters = { ...list.query, type: typeFilter };
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-noc", listFilters],
    queryFn: () => fetchNocList(listFilters),
    staleTime: 30_000,
  });
  const pageData = useSticky(data);
  const nocs = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};
  const showOnboarding = !isLoading && !isError && (counts.All ?? 0) === 0 && !list.hasFilters && typeFilter === "All";

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm]   = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [bankFieldsLocked, setBankFieldsLocked] = useState(true);

  // Detail / edit dialogs
  const [detailId, setDetailId] = useState<number | null>(null);
  const [markingIssued, setMarkingIssued] = useState(false);
  const [editNoc, setEditNoc] = useState<any>(null);

  const { data: eligibleBookings = [], isFetching: bkgFetching } = useQuery({
    queryKey: ["crm-noc-eligible"],
    queryFn: fetchEligibleBookings,
    enabled: dialogOpen,
    staleTime: 0,
  });

  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });

  const detail = detailId != null ? (nocs as any[]).find((n: any) => n.Id === detailId) : null;

  // Gate: AFS must be Registered — mandatory for every booking, no
  // project-type exception (eligible-bookings already enforces this; this
  // guards deep-link cases where context is fetched separately — must
  // mirror the backend gate in crmNoc.js POST / exactly).
  const agreementRegistered = context?.agreement?.Status === CrmStatus.REGISTERED;
  const canRequest = !!form.BookingId && agreementRegistered && !contextLoading && !saving;

  // Deep-link: ?bookingId=X&nocType=Bank|Organisation
  // BUG FIX: the old implementation scanned `nocs` (the paginated first page)
  // which meant a NOC on page 2+ was never found — the code then fell through
  // to opening the Create dialog, making it look like the NOC didn't exist.
  // Fix: resolve via a dedicated server lookup (same fix already applied in
  // CrmLegalMilestones and CrmHandover for the same class of bug).
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  useEffect(() => {
    if (!deepLinkBookingId || deepLinkResolved) return;
    setDeepLinkResolved(true);
    setSp((prev) => {
      prev.delete("bookingId");
      prev.delete("nocType");
      return prev;
    }, { replace: true }); // clear params so this only fires once
    const type = deepLinkNocType || "Organisation";
    fetchNocByBooking(deepLinkBookingId, type).then((existing) => {
      if (existing) {
        setDetailId(existing.Id);
      } else if (rights.canCreate) {
        setForm((f) => ({ ...f, BookingId: deepLinkBookingId, NocType: type }));
        setDialogOpen(true);
      }
    });
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

  // When booking changes, resolve NOC type from the booking's financing —
  // never a manual choice, since a booking only ever has one NOC type.
  const handleBookingChange = (bookingId: string) => {
    setForm((f) => {
      const bk = (eligibleBookings as any[]).find((b: any) => String(b.Id) === bookingId);
      const resolvedType = bk?.NocType || (bk?.HasLoan ? "Bank" : "Organisation");
      return { ...f, BookingId: bookingId, NocType: resolvedType };
    });
    setBankFieldsLocked(true);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-noc"] });
    qc.invalidateQueries({ queryKey: ["crm-noc-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
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
    if (detailId == null) return;
    setMarkingIssued(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/mark-issued`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("NOC marked as Issued");

      const current = (nocs as any[]).find((n) => n.Id === detailId);
      if (current) {
        // Check if both Bank + Org NOCs for this booking are now Issued
        const bookingNocs = (nocs as any[]).filter((n) => n.BookingId === current.BookingId);
        const allIssued = bookingNocs.length > 0 && bookingNocs.every(
          (n) => n.Id === detailId ? true : n.Status === "Issued",
        );
        if (allIssued) {
          promptNextStep(
            navigate,
            "All NOCs for this booking are issued — the pre-possession check can now proceed.",
            "/crm/pre-possession",
            "Go to Pre-Possession Check",
          );
        }
      }
      setDetailId(null);
      invalidate();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setMarkingIssued(false);
    }
  };

  const tabs: CrmStatusTab[] = [
    { key: "All",      label: "All",      count: counts.All ?? 0 },
    { key: "Pending",  label: "Pending",  count: counts.Pending ?? 0,  dot: "bg-amber-400" },
    { key: "Approved", label: "Approved", count: counts.Approved ?? 0, dot: "bg-blue-500" },
    { key: "Issued",   label: "Issued",   count: counts.Issued ?? 0,   dot: "bg-emerald-500" },
    { key: "Rejected", label: "Rejected", count: counts.Rejected ?? 0, dot: "bg-rose-500" },
  ];

  const columns: CrmColumn<any>[] = [
    { key: "nocNo", header: "NOC No", sortKey: "NocNo", cell: (i) => <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{i.NocNo}</span> },
    { key: "applicant", header: "Customer", sortKey: "ApplicantName", cell: (i) => (
      <div>
        <div className="font-medium"><ApplicantNames name={i.ApplicantName} bookingId={i.BookingId} applicationId={i.ApplicationId} /></div>
        <div className="text-xs text-muted-foreground">{i.BookingNo} · {i.UnitNo}</div>
      </div>
    ) },
    { key: "type", header: "Type", sortKey: "NocType", cell: (i) => (
      <span className={cn(
        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium whitespace-nowrap",
        i.NocType === "Bank" ? "text-blue-700 bg-blue-50 border-blue-200" : "text-purple-700 bg-purple-50 border-purple-200",
      )}>
        {i.NocType === "Bank" ? <Landmark size={10} /> : <Building2 size={10} />} {i.NocType}
      </span>
    ) },
    { key: "bankLoan", header: "Bank / Loan", cell: (i) => (
      <span className="text-xs whitespace-nowrap">{i.NocType === "Bank" ? `${i.BankName || "—"} · ${i.LoanAmount ? formatINR(i.LoanAmount) : "—"}` : "—"}</span>
    ) },
    { key: "status", header: "Status", sortKey: "Status", cell: (i) => <StatusBadge status={i.Status} /> },
    { key: "issued", header: "Issued", sortKey: "IssuedDate", className: "hidden lg:table-cell",
      cell: (i) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(i.IssuedDate)}</span> },
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
            {rights.canCreate && (
              <button
                onClick={() => setDialogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 btn-module text-white text-sm font-medium rounded-lg "
              >
                <Plus size={14} /> Request NOC
              </button>
            )}
          </div>
        }
      >
        {!showOnboarding && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border overflow-hidden text-xs shrink-0">
                {(["All", "Organisation", "Bank"] as const).map((t) => (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    className={cn("px-2.5 py-1.5 transition-colors font-medium", typeFilter === t ? "btn-module text-white" : "hover:bg-muted text-muted-foreground")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <CrmListToolbar tabs={tabs} status={list.status} onStatus={list.setStatus}
              searchValue={list.searchInput} onSearch={list.setSearchInput}
              placeholder="Search NOC, customer, booking…">
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
            </CrmListToolbar>

            <CrmDataTable
              columns={columns} rows={nocs as any[]} rowKey={(i) => i.Id}
              loading={isLoading} fetching={isFetching}
              error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort}
              onRowClick={(r) => setDetailId(r.Id)} activeKey={detailId}
              rowAccent={(r) => (STATUS_CONFIG[r.Status] ?? STATUS_CONFIG.Pending).accent}
              empty={<>No NOC requests match these filters. <button onClick={list.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
              page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
            />
          </div>
        )}

        {showOnboarding && (
          <div className="p-8 rounded-xl border-2 border-dashed border-border bg-muted/10 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <ShieldCheck size={26} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No NOC requests yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                Request one once a booking's Agreement for Sale is Registered.
              </p>
            </div>
            {rights.canCreate && (
              <button onClick={() => setDialogOpen(true)}
                className="flex items-center gap-1.5 text-sm px-4 py-2 btn-module text-white rounded-lg font-semibold mx-auto">
                <Plus size={13} /> Request NOC
              </button>
            )}
          </div>
        )}

        {/* ── Request dialog ────────────────────────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent accent="crm" className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">Request NOC</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">A single NOC per booking — Bank (loan-financed) or Organisation (self-funded), decided automatically by how the booking is financed</p>
            </DialogHeader>

            <div className="space-y-4">
              {/* Step 1 — Booking */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Booking *</label>
                {bkgFetching ? (
                  <p className="text-xs text-muted-foreground px-1 py-2">Loading eligible bookings…</p>
                ) : (eligibleBookings as any[]).length === 0 ? (
                  <div className="flex items-start gap-2 text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>No eligible bookings. Requires: AFS Registered at Sub-Registrar + no NOC already on file for the booking.</span>
                  </div>
                ) : (
                  <SearchableNativeSelect value={form.BookingId}
                    onChange={(e) => handleBookingChange(e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                    <option value="">Select booking…</option>
                    {(eligibleBookings as any[]).map((b: any) => (
                      <option key={b.Id} value={String(b.Id)}>
                        {b.BookingNo} — {b.ApplicantName} · {b.UnitNo}{b.HasLoan ? " (Home Loan)" : ""}
                      </option>
                    ))}
                  </SearchableNativeSelect>
                )}
              </div>

              {/* NOC type — resolved automatically from the booking's financing,
                  never a free choice (this booking has exactly one NOC). */}
              {form.BookingId && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">NOC Issued By</label>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-primary bg-primary/10 text-primary text-sm font-medium">
                    {form.NocType === "Bank" ? <Landmark size={14} /> : <Building2 size={14} />}
                    <span>{form.NocType === "Bank" ? "Bank (Lender)" : "Organisation (Developer)"}</span>
                    <span className="ml-auto text-[0.6875rem] font-normal text-primary/70">
                      {form.NocType === "Bank" ? "loan-financed booking" : "self-funded booking"}
                    </span>
                  </div>
                </div>
              )}

              {/* Booking context strip */}
              {form.BookingId && !contextLoading && context && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[0.6875rem] space-y-1">
                  <div className="font-semibold text-foreground text-xs">
                    <ApplicantNames name={context.booking.ApplicantName} bookingId={context.booking.Id} applicationId={context.booking.ApplicationId} />
                    <span className="text-muted-foreground font-normal"> · {context.booking.UnitNo}</span>
                  </div>
                  {context.agreement ? (
                    <div className={cn("flex items-center gap-1.5", agreementRegistered ? "text-green-700" : "text-sky-700")}>
                      {agreementRegistered ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {context.agreement.AgreementNo} — {context.agreement.Status}
                      {!agreementRegistered && <span className="font-medium ml-1">(Registered required)</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-600 font-medium">
                      <AlertTriangle size={11} /> No agreement on file
                    </div>
                  )}
                </div>
              )}

              {/* Bank loan fields — only for Bank NOC */}
              {form.NocType === "Bank" && form.BookingId && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Landmark size={11} /> Lender Details
                    </label>
                    <button type="button" onClick={() => setBankFieldsLocked((l) => !l)}
                      className="flex items-center gap-1 text-xs text-primary hover:underline">
                      {bankFieldsLocked ? <><Pencil size={10} /> Edit</> : <><Lock size={10} /> Lock</>}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      { ph: "Bank Name",    val: form.BankName,      key: "BankName" },
                      { ph: "Loan A/C No.", val: form.LoanAccountNo, key: "LoanAccountNo" },
                      { ph: "Loan Amount",  val: form.LoanAmount,    key: "LoanAmount", num: true },
                    ].map(({ ph, val, key, num }) => (
                      <input key={key} type={num ? "number" : "text"} placeholder={ph} value={val}
                        readOnly={bankFieldsLocked}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className={cn("text-sm border border-border rounded-lg px-2.5 py-1.5",
                          bankFieldsLocked ? "bg-muted/40 text-muted-foreground cursor-default" : "bg-background")} />
                    ))}
                  </div>
                </div>
              )}

              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                placeholder="Reason / purpose (optional)" rows={2}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border mt-2">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
                className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleCreate} disabled={!canRequest || !rights.canCreate}
                title={!agreementRegistered && form.BookingId ? "AFS must be Registered first" : undefined}
                className="px-5 py-2 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
                {saving ? "Requesting…" : "Request NOC"}
              </button>
            </div>
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

      {/* ── Detail drawer ─────────────────────────────────────────────── */}
      <CrmSideDrawer
        open={detailId != null}
        onClose={() => setDetailId(null)}
        title={detail?.NocNo ?? ""}
        subtitle={detail ? `${detail.NocType} NOC` : undefined}
        badge={detail && (
          <span className="flex items-center gap-2">
            <StatusBadge status={detail.Status} />
            {detail.Status !== "Issued" && (
              <button onClick={() => setEditNoc(detail)} title="Edit details"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Pencil size={13} />
              </button>
            )}
          </span>
        )}
      >
        {detail && (
          <div className="space-y-5">
            {/* Customer summary */}
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
              <p className="text-sm font-semibold text-foreground"><ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} /></p>
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
              ) : detail.Status === CrmStatus.APPROVED && rights.canEdit ? (
                <button onClick={handleMarkIssued} disabled={markingIssued}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium btn-module text-white rounded-lg hover:shadow-lg disabled:opacity-40 transition-colors">
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
        )}
      </CrmSideDrawer>
    </>
  );
};

export default CrmNoc;
