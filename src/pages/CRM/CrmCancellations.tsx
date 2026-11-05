import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ArrowRight, Info, RefreshCw, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

const API = "/api/crm/cancellations";

const STATUSES = ["Pending", "FinancePending", "Approved", "Rejected", "Refunded"];
const statusText = (s: string) => (s === "FinancePending" ? "With Finance" : s);
const statusTone = (s: string): "done" | "waiting" | "stopped" =>
  s === "Approved" || s === "Refunded" || s === "Cancelled" ? "done" : s === "Rejected" ? "stopped" : "waiting";

const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");

const PAGE_SIZE = 20;
interface CancellationListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }
async function fetchCancellationsList(filters: CancellationListFilters, page: number): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  // A failed load used to read as "No cancellation requests".
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the cancellations (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCancellationPolicy(bookingId: string): Promise<any | null> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/policy?bookingId=${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}

/** What a refund nets: the paid amount less the deduction, which is taken only if the customer takes a refund. */
const deductionOf = (r: any) => Math.round(Number(r.AmountPaidTillDate || 0) * Number(r.DeductionPercent || 0)) / 100;

const CrmCancellations: React.FC = () => {
  const rights = usePageRights("crm-cancellations");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || "";
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bookingIdParam && rights.canCreate) {
      setForm((f) => ({ ...f, BookingId: bookingIdParam }));
      setDialogOpen(true);
      setSearchParams(new URLSearchParams());
    }
  }, [bookingIdParam, setSearchParams, rights.canCreate]);

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
      if (p?.DeductionPercent != null) setForm((f) => ({ ...f, DeductionPercent: String(Number(p.DeductionPercent)) }));
    }).finally(() => { if (!cancelled) setPolicyLoading(false); });
    return () => { cancelled = true; };
  }, [form.BookingId]);

  const listFilters: CancellationListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb]
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-cancellations", listFilters, page],
    queryFn: () => fetchCancellationsList(listFilters, page),
    staleTime: 30_000,
  });
  const cancellations = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-cancellation-bookings"], queryFn: fetchBookings, staleTime: 60_000, enabled: dialogOpen });

  const closeDialog = () => { setDialogOpen(false); setPolicy(null); setForm({ BookingId: "", Reason: "", DeductionPercent: "" }); };

  const handleRequest = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!form.Reason.trim()) { toast.error("Give the reason for the cancellation"); return; }
    const pct = form.DeductionPercent !== "" ? parseFloat(form.DeductionPercent) : undefined;
    if (pct != null && (!(pct >= 0) || pct > 100)) { toast.error("The charge must be between 0 and 100%"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(form.BookingId),
          Reason: form.Reason.trim() || undefined,
          // Only send DeductionPercent if staff actually changed it from the
          // policy suggestion — omitting it lets the backend re-resolve fresh.
          DeductionPercent: pct,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error);
      toast.success(`Cancellation requested — ${fmt(data.refundAmt)} will be held as credit (deduction only if refunded)`);
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
      qc.invalidateQueries({ queryKey: ["crm-cancellation-bookings"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const overriding = policy && form.DeductionPercent !== "" && form.DeductionPercent !== String(Number(policy.DeductionPercent));
  const figures = [
    { label: "Requested", value: allCount, note: `${counts.Rejected ?? 0} rejected`, go: "" },
    { label: "Awaiting approval", value: counts.Pending ?? 0, note: "In the Approval Inbox", go: "Pending" },
    { label: "With Finance", value: counts.FinancePending ?? 0, note: "Approved, Finance to settle", go: "FinancePending" },
    { label: "Approved", value: (counts.Approved ?? 0) + (counts.Refunded ?? 0), note: `${counts.Refunded ?? 0} refunded`, go: "Approved" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3.5";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Cancellations"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Cancellations"
        subtitle="Booking cancellation requests: the paid amount is held as credit on approval, the policy's deduction taken only if the customer takes a refund. Refunds and re-bookings carry on in Refunds."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><XCircle size={13} /> Request cancellation</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => updateFilter(setStatusFilter)(x.go)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {(["", ...STATUSES] as const).map((s) => (
                  <button key={s || "all"} onClick={() => updateFilter(setStatusFilter)(s)} className={tabClass(statusFilter === s)} style={{ borderRight: RULE_SOFT }}>
                    {s === "" ? "All" : statusText(s)} <span className="tabular-nums">{s === "" ? allCount : counts[s] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                  placeholder="Search customer, booking, cancellation no…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[1000px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Cancellation</th><th className={th}>Customer</th><th className={`${th} !text-right`}>Paid till date</th>
                    <th className={`${th} !text-right`}>Deduction if refunded</th><th className={`${th} !text-right`}>Refund if taken</th>
                    <th className={th}>Status</th><th className={th}>Requested</th><th className={th}>Next</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={8} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : cancellations.length === 0 ? (
                    <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>{search || statusFilter || cpb.projectId ? "No cancellation matches." : "No cancellation requests yet."}</td></tr>
                  ) : cancellations.map((c: any) => {
                    const deduction = deductionOf(c);
                    const net = Math.max(0, Number(c.AmountPaidTillDate || 0) - deduction);
                    return (
                      <tr key={c.Id} className="align-top" style={{ borderBottom: RULE_SOFT }}>
                        <td className={td}>
                          <div className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{c.CancellationNo}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{c.BookingNo}</div>
                        </td>
                        <td className={td}>
                          <div className="font-medium leading-snug"><ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /></div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{c.Mobile}</div>
                        </td>
                        <td className={`${td} text-right font-heading tabular-nums`}>{fmt(c.AmountPaidTillDate)}</td>
                        <td className={`${td} text-right`} title="Deducted only if the customer takes a refund; a re-booking keeps the full amount">
                          <div className="font-heading tabular-nums">{fmt(deduction)}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{Number(c.DeductionPercent)}%</div>
                        </td>
                        <td className={`${td} text-right font-heading font-semibold tabular-nums`} title={`The full ${fmt(c.AmountPaidTillDate)} is held as credit; a re-booking uses all of it`}>{fmt(net)}</td>
                        <td className={td}><SheetMark text={statusText(c.Status)} tone={statusTone(c.Status)} /></td>
                        <td className={`${td} text-xs text-muted-foreground tabular-nums`}>{c.RequestedDate ? String(c.RequestedDate).slice(0, 10) : "—"}</td>
                        <td className={td}>
                          <div className="flex flex-col items-start gap-1.5">
                            {/* submitOnly: Approve/Reject only ever happen from the Admin Approval Inbox */}
                            {rights.canEdit && (
                              <ApprovalActions status={c.Status} recordId={c.Id} endpoint={API} submitOnly
                                onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-cancellations"] })} />
                            )}
                            {c.Status === CrmStatus.PENDING && <span className="text-xs text-muted-foreground">Waiting in the Approval Inbox</span>}
                            {c.Status === CrmStatus.REJECTED && c.Notes && (
                              <span className="text-xs text-destructive max-w-[16rem]" title={c.Notes}>Rejected: {c.Notes.length > 60 ? c.Notes.slice(0, 60) + "…" : c.Notes}</span>
                            )}
                            {/* Once approved, the paid amount is parked as held credit and a draft refund made: the refund /
                                re-booking itself lives on the Refunds page. */}
                            {(c.Status === CrmStatus.APPROVED || c.Status === "Cancelled") && (
                              c.RefundId != null ? (
                                <button onClick={() => navigate(`/crm/refunds?id=${c.RefundId}`)} className={`${KEY_LINE} h-7 px-2 whitespace-nowrap`}>
                                  Refund {c.RefundNo}: {c.SettlementStatus === "Settled" ? "settled" : c.RefundStatus} <ArrowRight size={11} />
                                </button>
                              ) : <span className="text-xs text-muted-foreground">Held credit parked — see Refunds</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogContent className="max-w-md rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Request cancellation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Booking *</label>
                <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))} className={INP}>
                  <option value="">Select booking</option>
                  {(bookings as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName}${b.UnitNo ? ` (${b.UnitNo})` : ""}`}</option>
                  ))}
                </SearchableNativeSelect>
              </div>

              {/* The policy slab for this booking, so any override is a deliberate choice. */}
              {form.BookingId && (
                <div className="px-3 py-2.5 text-xs space-y-1" style={{ border: RULE_SOFT, borderLeft: policy ? "3px solid hsl(var(--foreground))" : RULE_SOFT }}>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Info size={11} />
                    {policyLoading ? "Loading the cancellation policy…" : policy ? "Cancellation policy" : "No policy configured — the system default applies"}
                  </div>
                  {!policyLoading && policy && (
                    <>
                      <p>{policy.PolicyName || "Policy"} · <span className="tabular-nums">{policy.daysSinceBooking}</span> day{policy.daysSinceBooking !== 1 ? "s" : ""} since booking</p>
                      <p className="tabular-nums">
                        Slab {policy.DaysFromBookingMin ?? 0}–{policy.DaysFromBookingMax != null ? policy.DaysFromBookingMax : "∞"} days → <span className="font-bold">{Number(policy.DeductionPercent)}% deduction</span>
                      </p>
                      {policy.Notes && <p className="text-muted-foreground italic">{policy.Notes}</p>}
                      {policy.source === "default" && <p className="text-muted-foreground">The global default (no policy for this project).</p>}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className={`block ${LBL}`}>
                  Cancellation charge (%)
                  {overriding && <span className="ml-2 text-destructive normal-case tracking-normal">overriding the policy ({Number(policy.DeductionPercent)}%)</span>}
                </label>
                <input type="number" min={0} max={100} step="0.01" value={form.DeductionPercent}
                  placeholder={policyLoading ? "Loading…" : "Leave blank to apply the policy"}
                  onChange={(e) => setForm((f) => ({ ...f, DeductionPercent: e.target.value }))}
                  className={`${INP} tabular-nums ${overriding ? "!border-destructive" : ""}`} />
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Reason *</label>
                <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} rows={2} className={TEXTAREA} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={closeDialog} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleRequest} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Submitting…" : "Submit request"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmCancellations;
