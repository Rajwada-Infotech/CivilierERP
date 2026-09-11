import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { XCircle, CheckCircle2, Info, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";

const API = "/api/crm/cancellations";
const BKG_API = "/api/crm/bookings";

const statusColor: Record<string, string> = {
  Pending:  "text-orange-600 bg-orange-50 border-orange-200",
  FinancePending: "text-purple-600 bg-purple-50 border-purple-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
  Refunded: "text-green-600 bg-green-50 border-green-200",
};

const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchCancellations(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

const PAGE_SIZE = 20;
interface CancellationListFilters {
  search: string;
  companyId: string;
  projectId: string;
  blockId: string;
}
async function fetchCancellationsList(filters: CancellationListFilters, page: number): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  try {
    const r = await fetchWithAuth(`${API}?${params}`);
    if (!r.ok) return { rows: [], total: 0 };
    const data = await r.json();
    return { rows: data.rows || [], total: data.total || 0 };
  } catch { return { rows: [], total: 0 }; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCancellationPolicy(bookingId: string): Promise<any | null> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/policy?bookingId=${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}

const CrmCancellations: React.FC = () => {
  const rights = usePageRights("crm-cancellations");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || "";
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ BookingId: "", Reason: "", DeductionPercent: "" });
  // Policy data loaded when a booking is selected — shown to staff before submit
  const [policy, setPolicy] = useState<any | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);

  useEffect(() => {
    if (bookingIdParam && rights.canCreate) {
      setForm((f) => ({ ...f, BookingId: bookingIdParam }));
      setDialogOpen(true);
      setSearchParams(new URLSearchParams());
    }
  }, [bookingIdParam, setSearchParams, rights.canCreate]);

  const [saving, setSaving] = useState(false);

  // When BookingId changes, fetch the applicable policy slab and pre-fill
  // DeductionPercent. Staff can still override it — the slab info card
  // makes the policy visible so any deviation is a deliberate choice.
  useEffect(() => {
    if (!form.BookingId) { setPolicy(null); setForm((f) => ({ ...f, DeductionPercent: "" })); return; }
    let cancelled = false;
    setPolicyLoading(true);
    fetchCancellationPolicy(form.BookingId).then((p) => {
      if (cancelled) return;
      setPolicy(p);
      if (p?.DeductionPercent != null) {
        setForm((f) => ({ ...f, DeductionPercent: String(Number(p.DeductionPercent)) }));
      }
    }).finally(() => { if (!cancelled) setPolicyLoading(false); });
    return () => { cancelled = true; };
  }, [form.BookingId]);

  const listFilters: CancellationListFilters = useMemo(
    () => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, cpb]
  );
  const { data: listResult, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-cancellations", listFilters, page],
    queryFn: () => fetchCancellationsList(listFilters, page),
    staleTime: 30_000,
  });
  const cancellations = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const activeBookings = useMemo(() =>
    (bookings as any[]).filter((b: any) => b.Status !== CrmStatus.CANCELLED), [bookings]);

  const handleRequest = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(form.BookingId),
          Reason: form.Reason || null,
          // Only send DeductionPercent if staff actually changed it from the
          // policy suggestion — omitting it lets the backend re-resolve fresh.
          DeductionPercent: form.DeductionPercent !== "" ? parseFloat(form.DeductionPercent) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Cancellation requested — refund amount: ${fmt(data.refundAmt)}`);
      setDialogOpen(false);
      setForm({ BookingId: "", Reason: "", DeductionPercent: "" });
      setPolicy(null);
      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "CancellationNo", header: "Cancellation No", size: 130,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { accessorKey: "AmountPaidTillDate", header: "Paid Till Date", size: 110, cell: (i) => <span>{fmt(i.row.original.AmountPaidTillDate)}</span> },
    { id: "deduction", header: "Deduction", size: 130, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.DeductionPercent}% ({fmt(i.row.original.DeductionAmount)})</span> },
    { accessorKey: "RefundAmount", header: "Refund Amount", size: 120, cell: (i) => <span className="font-semibold text-green-600">{fmt(i.row.original.RefundAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "RequestedDate", header: "Requested", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.RequestedDate ? String(i.row.original.RequestedDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const c = i.row.original;
        return (
          <>
            {/* submitOnly: Approve/Reject only ever happen from the Admin
                Approval Inbox (admin/super_admin/marketing_head) */}
            <ApprovalActions
              status={c.Status}
              recordId={c.Id}
              endpoint={API}
              submitOnly
              onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-cancellations"] })}
            />
            {c.Status === CrmStatus.PENDING && <span className="text-xs text-muted-foreground">Pending admin approval</span>}
            {c.Status === CrmStatus.REJECTED && c.Notes && (
              <span className="text-xs text-red-600" title={c.Notes}>Rejected: {c.Notes.length > 40 ? c.Notes.slice(0, 40) + "…" : c.Notes}</span>
            )}
            {/* The money side moved to the Refunds page. Once a cancellation is
                Approved, the paid amount is parked as 'Held' credit and a draft
                CrmRefund is auto-created — shown here as a status chip that
                links out. Refund / re-booking actions all live on /crm/refunds. */}
            {(c.Status === CrmStatus.APPROVED || c.Status === "Cancelled") && (
              c.RefundId ? (
                <button onClick={() => navigate(`/crm/refunds?id=${c.RefundId}`)}
                  className={`flex items-center gap-1 text-xs hover:underline ${
                    c.SettlementStatus === "Settled" ? "text-green-600" : "text-primary"}`}>
                  {c.SettlementStatus === "Settled" ? <CheckCircle2 size={12} /> : null}
                  Refund {c.RefundNo}: {c.RefundStatus}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">Held credit parked — see Refunds</span>
              )
            )}
          </>
        );
      } },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Cancellations"]} />
      <CrmShell
        title="CRM — Cancellations & Refunds"
      subtitle="Booking cancellation requests with auto-calculated refund"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          {rights.canCreate && (
            <button onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
            <XCircle size={14} /> Request Cancellation
          </button>
          )}
        </div>
      }
    >
      <div className="flex gap-3 flex-wrap items-center mb-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
            placeholder="Search customer, booking, cancellation no... (Enter to search)"
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
      </div>

      <DataTable
        data={cancellations}
        columns={columns}
        loading={isLoading}
        emptyMessage="No cancellation requests"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />
      <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setPolicy(null); setForm({ BookingId: "", Reason: "", DeductionPercent: "" }); } }}>
        <DialogContent accent="crm" className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Request Cancellation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {activeBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>

            {/* Policy info card — shown once a booking is selected and the
                /policy endpoint returns a slab. Makes the penalty rule
                transparent to staff before they submit. */}
            {form.BookingId && (
              <div className={`rounded-lg border px-3 py-2 text-xs space-y-0.5 ${
                policyLoading
                  ? "border-border bg-muted/30 text-muted-foreground"
                  : policy
                    ? "border-blue-200 bg-blue-50/60 dark:bg-blue-900/10 text-blue-800 dark:text-blue-300"
                    : "border-border bg-muted/30 text-muted-foreground"
              }`}>
                <div className="flex items-center gap-1.5 font-semibold">
                  <Info size={11} />
                  {policyLoading ? "Loading cancellation policy…" : policy ? "Cancellation Policy" : "No policy configured — using system default"}
                </div>
                {!policyLoading && policy && (
                  <>
                    <p>{policy.PolicyName || "Policy"} · {policy.daysSinceBooking} day{policy.daysSinceBooking !== 1 ? "s" : ""} since booking</p>
                    <p>
                      Applicable slab: {policy.DaysFromBookingMin ?? 0}–{policy.DaysFromBookingMax != null ? policy.DaysFromBookingMax : "∞"} days
                      → <span className="font-bold">{Number(policy.DeductionPercent)}% deduction</span>
                    </p>
                    {policy.Notes && <p className="text-blue-600/80 dark:text-blue-400/70 italic">{policy.Notes}</p>}
                    {policy.source === "default" && <p className="text-amber-600">Using global system default (no project-specific policy)</p>}
                  </>
                )}
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Cancellation Charge (%)
                {policy && form.DeductionPercent !== String(Number(policy.DeductionPercent)) && form.DeductionPercent !== "" && (
                  <span className="ml-2 text-amber-600 font-medium">⚠ Overriding policy ({Number(policy.DeductionPercent)}%)</span>
                )}
              </label>
              <input type="number" min={0} max={100} step="0.01" value={form.DeductionPercent}
                placeholder={policyLoading ? "Loading…" : "Enter % or leave blank to auto-apply policy"}
                onChange={(e) => setForm((f) => ({ ...f, DeductionPercent: e.target.value }))}
                className={`w-full text-sm border rounded px-2 py-1.5 bg-background ${
                  policy && form.DeductionPercent !== "" && form.DeductionPercent !== String(Number(policy.DeductionPercent))
                    ? "border-amber-400 ring-1 ring-amber-400/40"
                    : "border-border"
                }`} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason</label>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setPolicy(null); setForm({ BookingId: "", Reason: "", DeductionPercent: "" }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRequest} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
    </>
  );
};

export default CrmCancellations;
