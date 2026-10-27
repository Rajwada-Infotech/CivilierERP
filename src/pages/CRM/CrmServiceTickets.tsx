import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, RefreshCw, Star } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

const API          = "/api/crm/service-tickets";
const SA_LEADS_API = "/api/sa/leads";

const CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const STATUSES   = ["Open", "Assigned", "InProgress", "Resolved", "Closed", "Reopened"];

const words = (s: string) => s.replace(/([A-Z])/g, " $1").trim();
const statusTone = (s: string): "done" | "waiting" | "stopped" | "none" =>
  s === "Resolved" ? "done" : s === "Reopened" ? "stopped" : s === "Closed" ? "none" : "waiting";

const EMPTY_FORM = { BookingId: "", Category: "Complaint", Priority: "Normal", Subject: "", Description: "", AssignedTo: "" };

const PAGE_SIZE = 20;
interface TicketListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }
async function fetchTicketsList(filters: TicketListFilters, page: number): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  // A failed load used to read as "No service tickets found".
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the tickets (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const CrmServiceTickets: React.FC = () => {
  const rights = usePageRights("crm-service-tickets");
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [saving, setSaving]         = useState(false);

  // Resolve / reopen: notes or a reason are required, so each has its own dialog.
  const [resolveFor, setResolveFor]   = useState<any | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [reopenFor, setReopenFor]     = useState<any | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  const listFilters: TicketListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb]
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-service-tickets", listFilters, page],
    queryFn: () => fetchTicketsList(listFilters, page),
    staleTime: 30_000,
  });
  const tickets = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const allCount = STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-service-ticket-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000, enabled: dialogOpen });
  const { data: users = [] }    = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000, enabled: rights.canEdit || rights.canCreate });

  const changed = () => {
    qc.invalidateQueries({ queryKey: ["crm-service-tickets"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const handleCreate = async () => {
    if (!form.BookingId || !form.Subject.trim()) { toast.error("Booking and Subject are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), AssignedTo: form.AssignedTo || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.TicketNo} raised`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const runAction = async (id: number, action: string, body?: object): Promise<boolean> => {
    if (busyIds.has(id)) return false;
    setBusyIds((s) => new Set(s).add(id));
    try {
      const res = await fetchWithAuth(`${API}/${id}/${action}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.status ?? "updated"}`);
      changed();
      return true;
    } catch (e: any) {
      toast.error(translateError(e.message));
      return false;
    } finally {
      setBusyIds((s) => { const next = new Set(s); next.delete(id); return next; });
    }
  };

  // Inline assign/reassign — fires PUT /:id with just AssignedTo
  const handleAssign = async (id: number, userId: string) => {
    if (!userId) return;
    try {
      const res = await fetchWithAuth(`${API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AssignedTo: parseInt(userId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success("Ticket assigned");
      changed();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleResolveConfirm = async () => {
    if (!resolveNotes.trim()) { toast.error("Resolution notes are required"); return; }
    setSaving(true);
    try { if (await runAction(resolveFor.Id, "resolve", { ResolutionNotes: resolveNotes.trim() })) setResolveFor(null); }
    finally { setSaving(false); }
  };
  const handleReopenConfirm = async () => {
    if (!reopenReason.trim()) { toast.error("Reason for reopening is required"); return; }
    setSaving(true);
    try { if (await runAction(reopenFor.Id, "reopen", { Reason: reopenReason.trim() })) setReopenFor(null); }
    finally { setSaving(false); }
  };

  const isOverdue = (t: any) => t.SlaDueDate && new Date(t.SlaDueDate) < new Date() && !["Resolved", "Closed"].includes(t.Status);

  const assignSelect = (t: any, placeholder: string) => (
    <SearchableNativeSelect defaultValue="" onChange={(e) => handleAssign(t.Id, e.target.value)}
      className="h-7 max-w-[9.5rem] text-[0.6875rem] border border-foreground/40 hover:border-foreground bg-card px-1.5 text-foreground outline-none">
      <option value="" disabled>{placeholder}</option>
      {(users as any[]).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
    </SearchableNativeSelect>
  );

  const figures = [
    { label: "Open", value: (counts.Open ?? 0) + (counts.Reopened ?? 0), note: `${counts.Reopened ?? 0} reopened`, go: () => updateFilter(setStatusFilter)("Open") },
    { label: "Being worked", value: (counts.Assigned ?? 0) + (counts.InProgress ?? 0), note: `${counts.InProgress ?? 0} in progress`, go: () => updateFilter(setStatusFilter)("InProgress") },
    { label: "Past SLA", value: counts.Overdue ?? 0, note: "Not resolved in time", go: () => updateFilter(setStatusFilter)("Overdue"), red: (counts.Overdue ?? 0) > 0 },
    { label: "Resolved", value: counts.Resolved ?? 0, note: `${counts.Closed ?? 0} closed`, go: () => updateFilter(setStatusFilter)("Resolved") },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3.5";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Service Tickets"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Service Tickets"
        subtitle="Warranty claims, complaints and service requests from owners: assigned, worked, resolved against their SLA, and closed or reopened."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {/* The server raises under the create right; the button was offered to everyone. */}
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Raise ticket</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={x.go} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {(["", ...STATUSES, "Overdue"] as const).map((s) => (
                  <button key={s || "all"} onClick={() => updateFilter(setStatusFilter)(s)} className={tabClass(statusFilter === s)} style={{ borderRight: RULE_SOFT }}>
                    {s === "" ? "All" : s === "Overdue" ? "Past SLA" : words(s)} <span className="tabular-nums">{s === "" ? allCount : counts[s] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                  placeholder="Search ticket, customer, subject…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Ticket</th><th className={th}>Customer</th><th className={th}>Category</th><th className={th}>Subject</th>
                    <th className={th}>Priority</th><th className={th}>Assigned to</th><th className={th}>SLA due</th><th className={th}>Status</th>
                    <th className={th}>Rating</th><th className={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={10} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={10} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : tickets.length === 0 ? (
                    <tr><td colSpan={10} className={`${td} text-center text-muted-foreground`}>{search || statusFilter || cpb.projectId ? "No ticket matches." : "No service tickets yet."}</td></tr>
                  ) : tickets.map((t: any) => {
                    const overdue = isOverdue(t);
                    return (
                      <tr key={t.Id} className="align-top" style={{ borderBottom: RULE_SOFT, borderLeft: overdue ? "3px solid hsl(var(--destructive))" : undefined }}>
                        <td className={td}><span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{t.TicketNo}</span></td>
                        <td className={td}>
                          <div className="font-medium leading-snug"><ApplicantNames name={t.ApplicantName} bookingId={t.BookingId} applicationId={t.ApplicationId} /></div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{t.BookingNo} · {t.UnitNo}</div>
                        </td>
                        <td className={`${td} text-xs`}>{words(t.Category || "")}</td>
                        <td className={td}>
                          <div className="max-w-xs leading-snug">{t.Subject}</div>
                          {t.RaisedByCustomer && <div className="mt-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">From the customer</div>}
                        </td>
                        <td className={td}>
                          <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border ${
                            t.Priority === "Urgent" ? "bg-destructive text-white border-destructive" : t.Priority === "High" ? "bg-foreground text-card border-foreground" : t.Priority === "Normal" ? "border-foreground/50" : "border-foreground/20 text-muted-foreground"}`}>{t.Priority}</span>
                        </td>
                        <td className={`${td} text-sm`}>{t.AssigneeName || "—"}</td>
                        <td className={td}>
                          <div className={`text-xs tabular-nums whitespace-nowrap ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{t.SlaDueDate ? fmtIstIso(t.SlaDueDate) : "—"}</div>
                          {overdue && <div className="mt-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive">Past SLA</div>}
                        </td>
                        <td className={td}>
                          {statusTone(t.Status) === "none"
                            ? <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{words(t.Status)}</span>
                            : <SheetMark text={words(t.Status)} tone={statusTone(t.Status) as "done" | "waiting" | "stopped"} />}
                        </td>
                        <td className={td}>
                          {t.CustomerRating
                            ? <span className="inline-flex items-center gap-0.5 text-xs font-heading tabular-nums"><Star size={12} fill="currentColor" /> {t.CustomerRating}/5</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={td}>
                          {rights.canEdit ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {t.Status === CrmStatus.OPEN && assignSelect(t, "Assign to…")}
                              {t.Status === "Assigned" && <>
                                <button onClick={() => runAction(t.Id, "mark-in-progress")} disabled={busyIds.has(t.Id)} className={`${KEY_INK} h-7 px-2`}>Start</button>
                                {assignSelect(t, "Reassign…")}
                              </>}
                              {t.Status === CrmStatus.IN_PROGRESS && assignSelect(t, "Reassign…")}
                              {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                                <button onClick={() => { setResolveFor(t); setResolveNotes(""); }} className={`${KEY_INK} h-7 px-2`}>Resolve</button>
                              )}
                              {t.Status === "Reopened" && <button onClick={() => runAction(t.Id, "mark-in-progress")} disabled={busyIds.has(t.Id)} className={`${KEY_LINE} h-7 px-2`}>Start work</button>}
                              {t.Status === CrmStatus.RESOLVED && <button onClick={() => runAction(t.Id, "close")} disabled={busyIds.has(t.Id)} className={`${KEY_LINE} h-7 px-2`}>Close</button>}
                              {(t.Status === CrmStatus.RESOLVED || t.Status === CrmStatus.CLOSED) && (
                                <button onClick={() => { setReopenFor(t); setReopenReason(""); }} className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}>Reopen</button>
                              )}
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
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

        {/* ── Raise ticket ── */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent className="max-w-lg rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Raise service ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Booking *</label>
                <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))} className={INP}>
                  <option value="">Select booking</option>
                  {(bookings as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName} (${b.UnitNo})`}</option>
                  ))}
                </SearchableNativeSelect>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Category</label>
                  <select value={form.Category} onChange={(e) => setForm((f) => ({ ...f, Category: e.target.value }))} className={INP}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Priority</label>
                  <select value={form.Priority} onChange={(e) => setForm((f) => ({ ...f, Priority: e.target.value }))} className={INP}>
                    {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Subject *</label>
                <input type="text" value={form.Subject} onChange={(e) => setForm((f) => ({ ...f, Subject: e.target.value }))} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Description</label>
                <textarea value={form.Description} onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))} rows={3} className={TEXTAREA} />
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Assign to</label>
                <SearchableNativeSelect value={form.AssignedTo} onChange={(e) => setForm((f) => ({ ...f, AssignedTo: e.target.value }))} className={INP}>
                  <option value="">— Unassigned —</option>
                  {(users as any[]).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </SearchableNativeSelect>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCreate} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Raising…" : "Raise ticket"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Resolve ── */}
        <Dialog open={!!resolveFor} onOpenChange={(o) => { if (!o) setResolveFor(null); }}>
          <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Resolve {resolveFor?.TicketNo}</DialogTitle>
              <DialogDescription className="text-xs">Describe what was done to resolve the issue. It stays on the ticket.</DialogDescription>
            </DialogHeader>
            <textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} placeholder="Resolution notes…" rows={4} className={TEXTAREA} />
            <DialogFooter className="gap-2">
              <button onClick={() => setResolveFor(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleResolveConfirm} disabled={saving || !resolveNotes.trim()} className={`${KEY_INK} h-9 px-4`}>{saving ? "Resolving…" : "Mark resolved"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Reopen ── */}
        <Dialog open={!!reopenFor} onOpenChange={(o) => { if (!o) setReopenFor(null); }}>
          <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Reopen {reopenFor?.TicketNo}</DialogTitle>
              <DialogDescription className="text-xs">Explain why it needs reopening. It's kept for the audit trail.</DialogDescription>
            </DialogHeader>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Reason for reopening…" rows={3} className={TEXTAREA} />
            <DialogFooter className="gap-2">
              <button onClick={() => setReopenFor(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleReopenConfirm} disabled={saving || !reopenReason.trim()} className={`${KEY_RED} h-9 px-4`}>{saving ? "Reopening…" : "Reopen"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmServiceTickets;
