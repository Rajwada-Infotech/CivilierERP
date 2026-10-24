// CRM Handover: scheduling the key handover, the snag inspection and its defect list, and completing the handover
// (the date, who handed the keys, final dues cleared and the customer's acknowledgement on record).
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckSquare, Key, Plus, RefreshCw, Square, User } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/handover";
const SA_LEADS_API = "/api/sa/leads";

// The server's state machine, mirrored so no step is offered that it would refuse.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Scheduled: ["SnagInspection", "Cancelled"],
  SnagInspection: ["SnagPending", "Cancelled"],
  SnagPending: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};
const STEPS = ["Scheduled", "SnagInspection", "SnagPending", "Completed"] as const;
const STATUS_LABEL: Record<string, string> = { Scheduled: "Scheduled", SnagInspection: "Inspecting", SnagPending: "Snags to fix", Completed: "Completed", Cancelled: "Cancelled" };
const ACTION_LABEL: Record<string, string> = { SnagInspection: "Start inspection", SnagPending: "Inspection done", Completed: "Complete handover", Cancelled: "Cancel handover" };
const tone = (s: string): "done" | "waiting" | "stopped" => (s === "Completed" ? "done" : s === "Cancelled" ? "stopped" : "waiting");

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];
const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none";

// Dates where the user is (toISOString gives the UTC date, a day behind before 05:30 IST).
const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const emptySchedule = () => ({ BookingId: "", ScheduledDate: localDay(7), Notes: "" });

async function fetchHandoverByBooking(bookingId: string): Promise<any | null> {
  try {
    const r = await fetchWithAuth(`${API}?bookingId=${bookingId}`);
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch { return null; }
}

const PAGE_SIZE = 20;
interface HandoverListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }
// Throws, so a failed load shows as one instead of an empty list.
async function fetchHandoversList(filters: HandoverListFilters, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status !== "All") params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the handovers (${r.status}).`);
  return { rows: (data.rows || []) as any[], total: Number(data.total || 0), statusCounts: (data.statusCounts || {}) as Record<string, number> };
}
async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Could not load the handover.");
  return r.json();
}
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
// Staff who can hand the keys over (readable with the Handover right; it needed Sales Automation's, so the list was
// empty and a handover could not be completed).
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ label, children, hint }) => (
  <label className="block space-y-1"><span className={`block ${LBL}`}>{label}</span>{children}{hint && <span className="block text-[0.6875rem] text-muted-foreground">{hint}</span>}</label>
);
const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>{children}</div>;
const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">{children}</DialogTitle></DialogHeader>
);

/** The four steps as square marks: done solid, current outlined. */
const StepBar: React.FC<{ status: string }> = ({ status }) => {
  const at = STEPS.indexOf(status as any);
  return (
    <div className="flex items-center flex-wrap gap-y-2">
      {STEPS.map((s, i) => {
        const done = status === "Completed" || (at > i);
        const cur = at === i && status !== "Completed";
        return (
          <React.Fragment key={s}>
            <span className="flex items-center gap-1.5">
              <span className={`w-5 h-5 flex items-center justify-center font-heading text-[0.5625rem] font-bold ${done ? "bg-foreground text-card" : cur ? "border-2 border-foreground" : "border border-foreground/25 text-muted-foreground"}`}>{i + 1}</span>
              <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] ${done || cur ? "" : "text-muted-foreground"}`}>{STATUS_LABEL[s]}</span>
            </span>
            {i < STEPS.length - 1 && <span className={`w-6 h-px mx-2 ${done ? "bg-foreground" : "bg-foreground/25"}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const CrmHandover: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const rights = usePageRights("crm-handover");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [newDialog, setNewDialog] = useState(false);
  const [snagDialog, setSnagDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newForm, setNewForm] = useState(emptySchedule);
  const [snagForm, setSnagForm] = useState({ Category: "Electrical", Description: "" });
  const [completeForm, setCompleteForm] = useState({ ActualHandoverDate: "", KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });

  const listFilters: HandoverListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb],
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-handovers", listFilters, page],
    queryFn: () => fetchHandoversList(listFilters, page),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const handovers = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const countOf = (s: string) => (s === "All" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[s] || 0);

  const { data: detail, isError: detailError } = useQuery({
    queryKey: ["crm-handover-detail", selectedId],
    queryFn: () => fetchDetail(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  // Only bookings that pass every handover gate.
  const { data: eligibleBookings = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["crm-handover-eligible"], queryFn: fetchEligibleBookings, staleTime: 2 * 60_000, enabled: newDialog,
  });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000, enabled: completeDialog });

  // ?bookingId=X opens that booking's handover, or the Schedule dialog for it.
  useEffect(() => {
    if (!deepLinkBookingId) return;
    setSp({}, { replace: true });
    fetchHandoverByBooking(deepLinkBookingId).then((existing) => {
      if (existing) setSelectedId(existing.Id);
      else if (rights.canCreate) { setNewForm({ ...emptySchedule(), BookingId: deepLinkBookingId }); setNewDialog(true); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId]);

  const refresh = (withDetail = true) => {
    ["crm-handovers", "crm-handover-eligible", "crm-booking-lifecycle", "crm-legal-milestones", "crm-dashboard", "crm-possession-notice"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (withDetail && selectedId != null) qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
  };
  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "The handover could not be changed.");
    return d;
  };

  const handleSchedule = async () => {
    if (!newForm.BookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      await call(API, "POST", { BookingId: parseInt(newForm.BookingId), ScheduledDate: newForm.ScheduledDate || null, Notes: newForm.Notes || null });
      toast.success("Handover scheduled");
      setNewDialog(false);
      // The default date comes back for the next one (it was left empty).
      setNewForm(emptySchedule());
      refresh(false);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleAddSnag = async () => {
    if (selectedId == null || !snagForm.Description.trim()) return void toast.error("Describe the defect.");
    setSaving(true);
    try {
      await call(`${API}/${selectedId}/snags`, "POST", snagForm);
      toast.success("Snag raised");
      setSnagDialog(false);
      setSnagForm({ Category: "Electrical", Description: "" });
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleResolveSnag = async (snagId: number) => {
    if (selectedId == null) return;
    try {
      await call(`${API}/${selectedId}/snags/${snagId}`, "PUT", { Status: CrmStatus.RESOLVED });
      toast.success("Snag resolved");
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const moveTo = async (targetStatus: string) => {
    if (selectedId == null) return;
    if (targetStatus === "Completed") {
      // Completing needs the full record; the date defaults to today.
      setCompleteForm({ ActualHandoverDate: localDay(), KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });
      return setCompleteDialog(true);
    }
    // Cancelling asks first (it went through on one click).
    if (targetStatus === "Cancelled") return setCancelDialog(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", { Status: targetStatus });
      toast.success(`Handover: ${STATUS_LABEL[targetStatus] ?? targetStatus}`);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleCancel = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", { Status: "Cancelled" });
      toast.success("Handover cancelled");
      setCancelDialog(false);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleComplete = async () => {
    if (selectedId == null) return;
    if (!completeForm.ActualHandoverDate) return void toast.error("Enter the handover date.");
    if (completeForm.ActualHandoverDate > localDay()) return void toast.error("The handover date can't be in the future.");
    if (!completeForm.KeyHandoverBy) return void toast.error("Select who handed over the keys.");
    if (!completeForm.FinalDuesCleared) return void toast.error("Confirm that every final due is cleared.");
    if (!completeForm.CustomerAcknowledged) return void toast.error("Confirm that the customer took possession.");
    setSaving(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", {
        Status: "Completed", ActualHandoverDate: completeForm.ActualHandoverDate,
        KeyHandoverBy: parseInt(completeForm.KeyHandoverBy), FinalDuesCleared: true, CustomerAcknowledged: true,
      });
      toast.success("Handover completed");
      setCompleteDialog(false);
      refresh();
      promptNextStep(navigate, "Handover completed: raise after-sales service tickets for any warranty or follow-up issue.", "/crm/service-tickets", "Go to Service Tickets");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const h = detail?.handover;
  const currentStatus = h?.Status ?? "";
  const nextSteps = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  const snags: any[] = detail?.snags ?? [];
  const openSnags = snags.filter((s) => s.Status !== CrmStatus.RESOLVED).length;

  const figures = [
    { label: "Handovers", value: countOf("All"), note: `${countOf("Scheduled")} scheduled`, go: "All" },
    { label: "Inspecting", value: countOf("SnagInspection") + countOf("SnagPending"), note: `${countOf("SnagPending")} with snags to fix`, go: "SnagPending" },
    { label: "Completed", value: countOf("Completed"), note: "Keys handed over", go: "Completed" },
    { label: "Cancelled", value: countOf("Cancelled"), note: "Not going ahead", go: "Cancelled" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Handover"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Possession"
        title="Handover"
        subtitle="Schedule the key handover, inspect for snags and fix them, then hand over: dues cleared and the customer's acknowledgement on record."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => { setNewForm(emptySchedule()); setNewDialog(true); }} className={`${KEY_INK} h-9 px-4`}><Key size={13} /> Schedule handover</button>}
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

          <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100vh-340px)] md:min-h-[460px]">
            {/* List */}
            <div className="w-full md:w-80 shrink-0 flex flex-col bg-card min-h-0" style={{ border: RULE }}>
              <div className="p-3 space-y-2" style={{ borderBottom: RULE }}>
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                  placeholder="Search customer or booking…"
                  className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <select value={statusFilter} onChange={(e) => updateFilter(setStatusFilter)(e.target.value)} className={`${INP} text-xs`}>
                  {["All", ...STEPS, "Cancelled"].map((s) => <option key={s} value={s}>{s === "All" ? "All statuses" : STATUS_LABEL[s]} ({countOf(s)})</option>)}
                </select>
                <CrmCompanyProjectBlockFilter stacked value={cpb} onChange={updateFilter(setCpb)} />
              </div>
              <div className="flex-1 overflow-y-auto max-h-[45vh] md:max-h-none">
                {isError ? (
                  <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
                ) : isLoading ? (
                  <p className="p-4 text-center text-muted-foreground text-sm">Loading…</p>
                ) : handovers.length === 0 ? (
                  <div className="p-5 text-center space-y-2">
                    <Key size={18} className="mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">{search || statusFilter !== "All" || cpb.projectId ? "No handover matches." : "No handover scheduled yet"}</p>
                    {!(search || statusFilter !== "All" || cpb.projectId) && (
                      <p className="text-xs text-muted-foreground">A handover can be scheduled once the agreement is registered, the possession notice acknowledged, the NOC issued and no dues are overdue.</p>
                    )}
                  </div>
                ) : handovers.map((r: any) => {
                  const on = selectedId === r.Id;
                  return (
                    <button key={r.Id} onClick={() => setSelectedId(r.Id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`} style={{ borderBottom: RULE_SOFT }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold truncate"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></span>
                        <span className={on ? "[&_*]:!text-card" : ""}><SheetMark text={STATUS_LABEL[r.Status] ?? r.Status} tone={tone(r.Status)} /></span>
                      </div>
                      <div className={`mt-0.5 text-[0.6875rem] tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>
                        {[r.BookingNo, r.UnitNo].filter(Boolean).join(" · ")}{r.ScheduledDate ? ` · ${fmtDate(r.ScheduledDate)}` : ""}
                      </div>
                      {r.OpenSnagCount > 0 && (
                        <div className={`mt-0.5 text-[0.6875rem] font-semibold flex items-center gap-1 ${on ? "" : "text-destructive"}`}><AlertTriangle size={10} /> {r.OpenSnagCount} open snag{r.OpenSnagCount === 1 ? "" : "s"}</div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
            </div>

            {/* Detail */}
            <div className="flex-1 min-w-0 min-h-[40vh] md:min-h-0 overflow-y-auto space-y-4">
              {selectedId == null ? (
                <div className="h-full min-h-[200px] flex items-center justify-center text-muted-foreground text-sm bg-card" style={{ border: RULE_SOFT }}>Pick a handover on the left.</div>
              ) : detailError ? (
                <p className="p-6 text-center text-sm text-destructive bg-card" style={{ border: RULE_SOFT }}>Could not load this handover.</p>
              ) : !h ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <section className="bg-card" style={{ border: RULE }}>
                    <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: RULE }}>
                      <div className="min-w-0">
                        <span className={`block ${LBL}`}>Handover</span>
                        <h2 className="font-heading text-lg font-bold truncate"><ApplicantNames name={h.ApplicantName} bookingId={h.BookingId} applicationId={h.ApplicationId} /></h2>
                        <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{[h.BookingNo, h.UnitNo].filter(Boolean).join(" · ")}</p>
                      </div>
                      <SheetMark text={STATUS_LABEL[h.Status] ?? h.Status} tone={tone(h.Status)} />
                    </div>
                    {h.Status !== "Cancelled" && <div className="px-4 py-3" style={{ borderBottom: RULE_SOFT }}><StepBar status={h.Status} /></div>}
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "hsl(var(--foreground) / 0.12)" }}>
                      {[
                        ["Scheduled for", fmtDate(h.ScheduledDate)],
                        ["Handed over", fmtDate(h.ActualHandoverDate)],
                        ["Final dues", h.FinalDuesCleared ? "Cleared" : "Not confirmed"],
                        ["Customer", h.CustomerAcknowledged ? "Took possession" : "Not yet"],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-card px-3 py-2 min-w-0"><dt className={LBL}>{k}</dt><dd className="text-sm font-medium mt-0.5 tabular-nums">{v}</dd></div>
                      ))}
                    </dl>
                    {h.KeyHandoverByName && (
                      <p className="px-4 py-2 text-xs flex items-center gap-1.5" style={{ borderTop: RULE_SOFT }}><User size={12} /> Keys handed over by <span className="font-semibold">{h.KeyHandoverByName}</span></p>
                    )}
                    {rights.canEdit && nextSteps.length > 0 && (
                      <div className="px-4 py-3 flex flex-wrap gap-2" style={{ borderTop: RULE }}>
                        {nextSteps.map((s) => (
                          <button key={s} onClick={() => moveTo(s)}
                            disabled={s === "Completed" && openSnags > 0}
                            title={s === "Completed" && openSnags > 0 ? "Resolve the open snags first." : undefined}
                            className={s === "Cancelled" ? `${KEY_LINE} h-9 px-3 !text-destructive !border-destructive` : s === "Completed" ? `${KEY_INK} h-9 px-4` : `${KEY_LINE} h-9 px-3`}>
                            {ACTION_LABEL[s] ?? s} {s !== "Cancelled" && <ArrowRight size={12} />}
                          </button>
                        ))}
                        {openSnags > 0 && nextSteps.includes("Completed") && <span className="self-center text-xs text-destructive">{openSnags} snag{openSnags === 1 ? "" : "s"} still open</span>}
                      </div>
                    )}
                  </section>

                  <section className="bg-card" style={{ border: RULE }}>
                    <div className="px-4 py-2.5 flex items-center justify-between gap-2" style={{ borderBottom: RULE }}>
                      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Snags and defects <span className="tabular-nums text-muted-foreground">{snags.length}</span></span>
                      {rights.canCreate && !["Completed", "Cancelled"].includes(currentStatus) && (
                        <button onClick={() => setSnagDialog(true)} className={`${KEY_LINE} h-8 px-2.5`}><Plus size={12} /> Raise snag</button>
                      )}
                    </div>
                    {snags.length === 0 ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">No snags raised.</p>
                    ) : snags.map((s: any) => {
                      const resolved = s.Status === CrmStatus.RESOLVED;
                      return (
                        <div key={s.Id} className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <div className="min-w-0 flex items-start gap-2.5">
                            {resolved ? <CheckSquare size={15} className="shrink-0 mt-0.5" /> : <Square size={15} className="shrink-0 mt-0.5 text-destructive" />}
                            <div className="min-w-0">
                              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em]">{s.Category}</p>
                              <p className="text-sm">{s.Description}</p>
                              <p className="text-[0.6875rem] text-muted-foreground">{[s.RaisedByName && `Raised by ${s.RaisedByName}`, s.ResolvedByName && `resolved by ${s.ResolvedByName}`].filter(Boolean).join(" · ")}</p>
                            </div>
                          </div>
                          {resolved ? <SheetMark text="Resolved" tone="done" />
                            : rights.canEdit ? <button onClick={() => handleResolveSnag(s.Id)} className={`${KEY_LINE} h-8 px-2.5 shrink-0`}>Mark resolved</button> : <SheetMark text="Open" tone="stopped" />}
                        </div>
                      );
                    })}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </SheetShell>

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><Key size={14} /> Schedule handover</Title>
          <Field label="Booking *" hint="Only bookings ready for it: agreement registered, possession notice acknowledged, NOC issued, no overdue dues.">
            <SearchableSelect value={newForm.BookingId} onChange={(v) => setNewForm((f) => ({ ...f, BookingId: v }))}
              placeholder={loadingEligible ? "Loading bookings…" : eligibleBookings.length ? "Select booking" : "No booking is ready for handover"}
              searchPlaceholder="Search booking, customer or unit…"
              options={(eligibleBookings as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo].filter(Boolean).join(" · ") }))} />
          </Field>
          <Field label="Scheduled for"><DateInput value={newForm.ScheduledDate} onChange={(e) => setNewForm((f) => ({ ...f, ScheduledDate: e.target.value }))} className={INP} /></Field>
          <Field label="Notes"><textarea value={newForm.Notes} onChange={(e) => setNewForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} className={`${INP} h-auto py-2 resize-none`} /></Field>
          <Foot>
            <button onClick={() => setNewDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleSchedule} disabled={saving || !newForm.BookingId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Scheduling…" : "Schedule"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={snagDialog} onOpenChange={(o) => { if (!o) setSnagDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><AlertTriangle size={14} /> Raise snag</Title>
          <Field label="Category">
            <select value={snagForm.Category} onChange={(e) => setSnagForm((f) => ({ ...f, Category: e.target.value }))} className={INP}>
              {SNAG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Defect *"><textarea value={snagForm.Description} onChange={(e) => setSnagForm((f) => ({ ...f, Description: e.target.value }))} rows={3} className={`${INP} h-auto py-2 resize-none`} /></Field>
          <Foot>
            <button onClick={() => setSnagDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleAddSnag} disabled={saving || !snagForm.Description.trim()} className={`${KEY_INK} h-9 px-4`}>{saving ? "Raising…" : "Raise snag"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialog} onOpenChange={(o) => { if (!o) setCancelDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title>Cancel handover</Title>
          <p className="text-sm">Cancel the handover for {h?.ApplicantName} ({h?.BookingNo})? It can't be resumed; a new one would be scheduled.</p>
          <Foot>
            <button onClick={() => setCancelDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
            <button onClick={handleCancel} disabled={saving} className={`${KEY_RED} h-9 px-4`}>{saving ? "Cancelling…" : "Cancel handover"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      {/* The four things the server requires for Completed: the date, who handed the keys, final dues cleared, and
          the customer's acknowledgement. */}
      <Dialog open={completeDialog} onOpenChange={(o) => { if (!o) setCompleteDialog(false); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><Key size={14} /> Complete handover</Title>
          <p className="text-xs text-muted-foreground -mt-2">The permanent record of the key handover; every item is needed.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Handed over on *"><DateInput value={completeForm.ActualHandoverDate} onChange={(e) => setCompleteForm((f) => ({ ...f, ActualHandoverDate: e.target.value }))} className={INP} /></Field>
            <Field label="Keys handed by *">
              <SearchableSelect value={completeForm.KeyHandoverBy} onChange={(v) => setCompleteForm((f) => ({ ...f, KeyHandoverBy: v }))}
                placeholder={users.length ? "Select staff" : "No staff listed"} searchPlaceholder="Search staff…" options={users} />
            </Field>
          </div>
          <div style={{ border: RULE }}>
            {([
              ["FinalDuesCleared", "Every final due is cleared: no payment demand remains on this booking."],
              ["CustomerAcknowledged", "The customer took possession and received the keys."],
            ] as const).map(([k, text], i) => (
              <label key={k} className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-primary/5" style={i === 0 ? { borderBottom: RULE_SOFT } : undefined}>
                <input type="checkbox" checked={completeForm[k]} onChange={(e) => setCompleteForm((f) => ({ ...f, [k]: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-foreground" />
                <span className="text-sm">{text}</span>
              </label>
            ))}
          </div>
          <Foot>
            <button onClick={() => setCompleteDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleComplete} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Completing…" : "Complete handover"}</button>
          </Foot>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmHandover;
