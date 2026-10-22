import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Star } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";

const API         = "/api/crm/service-tickets";
const BKG_API     = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";

const CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const STATUSES   = ["Open", "Assigned", "InProgress", "Resolved", "Closed", "Reopened"];

const priorityColor: Record<string, string> = {
  Urgent: "text-red-600 bg-red-50 border-red-200",
  High:   "text-sky-600 bg-sky-50 border-sky-200",
  Normal: "text-blue-600 bg-blue-50 border-blue-200",
  Low:    "text-muted-foreground bg-muted/50 border-border",
};
const statusColor: Record<string, string> = {
  Open:       "text-sky-600 bg-sky-50 border-sky-200",
  Assigned:   "text-blue-600 bg-blue-50 border-blue-200",
  InProgress: "text-purple-600 bg-purple-50 border-purple-200",
  Resolved:   "text-green-600 bg-green-50 border-green-200",
  Closed:     "text-muted-foreground bg-muted/50 border-border",
  Reopened:   "text-red-600 bg-red-50 border-red-200",
};
const STATUS_ACCENT: Record<string, string> = {
  Open:       "border-l-sky-400",
  Assigned:   "border-l-blue-400",
  InProgress: "border-l-purple-400",
  Resolved:   "border-l-green-500",
  Closed:     "border-l-border",
  Reopened:   "border-l-red-500",
};

const EMPTY_FORM = { BookingId: "", Category: "Complaint", Priority: "Normal", Subject: "", Description: "", AssignedTo: "" };

interface ListPage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchTicketsList(q: CrmListQuery): Promise<ListPage> {
  const r = await fetchWithAuth(`${API}?${listParams(q)}`);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
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
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [form, setForm]               = useState({ ...EMPTY_FORM });
  const [saving, setSaving]           = useState(false);

  // Resolve dialog state
  const [resolveDialog, setResolveDialog]   = useState(false);
  const [resolveTicketId, setResolveTicketId] = useState<number | null>(null);
  const [resolveNotes, setResolveNotes]     = useState("");

  // Reopen dialog state
  const [reopenDialog, setReopenDialog]   = useState(false);
  const [reopenTicketId, setReopenTicketId] = useState<number | null>(null);
  const [reopenReason, setReopenReason]   = useState("");

  const list = useCrmListState({ pageSize: 25, defaultSort: { key: "Priority", dir: "asc" } });
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-service-tickets", list.query], queryFn: () => fetchTicketsList(list.query), staleTime: 30_000 });
  const pageData = useSticky(data);
  const tickets = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};
  const showOnboarding = !isLoading && !isError && (counts.All ?? 0) === 0 && !list.hasFilters;
  const { data: bookings = [] }           = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] }             = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
    if (!form.BookingId || !form.Subject.trim()) { toast.error("Booking and Subject are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), AssignedTo: form.AssignedTo || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.TicketNo} raised`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-service-tickets"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (id: number, action: string, body?: object) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/${action}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.status ?? "updated"}`);
      qc.invalidateQueries({ queryKey: ["crm-service-tickets"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Ticket assigned");
      qc.invalidateQueries({ queryKey: ["crm-service-tickets"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleMarkInProgress = (id: number) => runAction(id, "mark-in-progress");
  const handleClose          = (id: number) => runAction(id, "close");

  // Open resolve dialog (replaces window.prompt)
  const openResolveDialog = (id: number) => {
    setResolveTicketId(id);
    setResolveNotes("");
    setResolveDialog(true);
  };
  const handleResolveConfirm = async () => {
    if (!resolveNotes.trim()) { toast.error("Resolution notes are required"); return; }
    setSaving(true);
    try {
      await runAction(resolveTicketId!, "resolve", { ResolutionNotes: resolveNotes.trim() });
      setResolveDialog(false);
    } finally {
      setSaving(false);
    }
  };

  // Open reopen dialog (replaces window.prompt)
  const openReopenDialog = (id: number) => {
    setReopenTicketId(id);
    setReopenReason("");
    setReopenDialog(true);
  };
  const handleReopenConfirm = async () => {
    if (!reopenReason.trim()) { toast.error("Reason for reopening is required"); return; }
    setSaving(true);
    try {
      await runAction(reopenTicketId!, "reopen", { Reason: reopenReason.trim() });
      setReopenDialog(false);
    } finally {
      setSaving(false);
    }
  };

  const isOverdue = (t: any) => t.SlaDueDate && new Date(t.SlaDueDate) < new Date() && !["Resolved", "Closed"].includes(t.Status);

  const columns: CrmColumn<any>[] = [
    { key: "ticketNo", header: "Ticket No", sortKey: "TicketNo",
      cell: (t) => <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{t.TicketNo}</span> },
    { key: "applicant", header: "Customer", sortKey: "ApplicantName",
      cell: (t) => (
        <div>
          <div className="font-medium"><ApplicantNames name={t.ApplicantName} bookingId={t.BookingId} applicationId={t.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground">{t.BookingNo} · {t.UnitNo}</div>
        </div>
      ) },
    { key: "category", header: "Category", sortKey: "Category", className: "hidden lg:table-cell",
      cell: (t) => <span className="text-xs whitespace-nowrap">{String(t.Category).replace(/([A-Z])/g, " $1").trim()}</span> },
    { key: "subject", header: "Subject", className: "hidden md:table-cell",
      cell: (t) => (
        <div className="max-w-xs truncate">
          {t.Subject}
          {t.RaisedByCustomer && (
            <span className="ml-1.5 text-[0.625rem] px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-600 font-medium">Customer</span>
          )}
        </div>
      ) },
    { key: "priority", header: "Priority", sortKey: "Priority",
      cell: (t) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${priorityColor[t.Priority] || ""}`}>{t.Priority}</span> },
    { key: "assignee", header: "Assigned To", className: "hidden lg:table-cell",
      cell: (t) => <span className="text-sm whitespace-nowrap">{t.AssigneeName || "—"}</span> },
    { key: "slaDue", header: "SLA Due", sortKey: "SlaDueDate", className: "hidden xl:table-cell",
      cell: (t) => {
        const overdue = isOverdue(t);
        return (
          <span className={`text-xs whitespace-nowrap ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
            {t.SlaDueDate ? fmtIstIso(t.SlaDueDate) : "—"}
            {overdue && " (OVERDUE)"}
          </span>
        );
      } },
    { key: "status", header: "Status", sortKey: "Status",
      cell: (t) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${statusColor[t.Status] || ""}`}>{t.Status}</span> },
    { key: "rating", header: "Rating", className: "hidden xl:table-cell",
      cell: (t) => t.CustomerRating ? (
        <span className="flex items-center gap-0.5 text-yellow-500 text-xs whitespace-nowrap">
          <Star size={12} fill="currentColor" /> {t.CustomerRating}/5
        </span>
      ) : <span className="text-xs text-muted-foreground">—</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap",
      cell: (t) => (
          <div className="flex items-center justify-end gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* Open: Assign dropdown */}
            {t.Status === CrmStatus.OPEN && (
              <SearchableNativeSelect
                defaultValue=""
                onChange={(e) => handleAssign(t.Id, e.target.value)}
                className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-muted-foreground hover:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" disabled>Assign to…</option>
                {(users as any[]).map((u: any) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </SearchableNativeSelect>
            )}
            {/* Assigned: Start work + Reassign */}
            {t.Status === "Assigned" && (
              <>
                <button onClick={() => handleMarkInProgress(t.Id)} className="text-xs text-primary hover:underline">Start</button>
                <SearchableNativeSelect
                  defaultValue=""
                  onChange={(e) => handleAssign(t.Id, e.target.value)}
                  className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-muted-foreground hover:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="" disabled>Reassign…</option>
                  {(users as any[]).map((u: any) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </SearchableNativeSelect>
              </>
            )}
            {/* InProgress: Reassign available */}
            {t.Status === CrmStatus.IN_PROGRESS && (
              <SearchableNativeSelect
                defaultValue=""
                onChange={(e) => handleAssign(t.Id, e.target.value)}
                className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-muted-foreground hover:border-primary focus:outline-none"
              >
                <option value="" disabled>Reassign…</option>
                {(users as any[]).map((u: any) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </SearchableNativeSelect>
            )}
            {/* Assigned/InProgress/Reopened: Resolve */}
            {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
              <button onClick={() => openResolveDialog(t.Id)} className="text-xs text-primary hover:underline">Resolve</button>
            )}
            {/* Reopened: also allow restarting to InProgress */}
            {t.Status === "Reopened" && (
              <button onClick={() => handleMarkInProgress(t.Id)} className="text-xs text-purple-600 hover:underline">Start Work</button>
            )}
            {/* Resolved: Close or Reopen */}
            {t.Status === CrmStatus.RESOLVED && (
              <>
                <button onClick={() => handleClose(t.Id)} className="text-xs text-primary hover:underline">Close</button>
                <button onClick={() => openReopenDialog(t.Id)} className="text-xs text-red-600 hover:underline">Reopen</button>
              </>
            )}
            {/* Closed: Reopen only */}
            {t.Status === CrmStatus.CLOSED && (
              <button onClick={() => openReopenDialog(t.Id)} className="text-xs text-red-600 hover:underline">Reopen</button>
            )}
          </div>
      ) },
  ];

  usePageRights("crm-service-tickets");

  const tabs: CrmStatusTab[] = STATUSES.map((s) => ({
    key: s, label: s.replace(/([A-Z])/g, " $1").trim(), count: counts[s] ?? 0,
    dot: s === "Open" ? "bg-sky-500" : s === "Assigned" ? "bg-blue-500" : s === "InProgress" ? "bg-purple-500"
      : s === "Resolved" ? "bg-green-500" : s === "Closed" ? "bg-muted-foreground/50" : "bg-red-500",
  }));
  tabs.unshift({ key: "All", label: "All", count: counts.All ?? 0 });

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Service Tickets"]} />
      <CrmShell
        title="CRM — Service Tickets"
      subtitle="After-sales warranty, complaints & service requests"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 btn-module text-white text-sm font-medium rounded-lg ">
          <Plus size={14} /> Raise Ticket
        </button>
        </div>
      }
    >
      {!showOnboarding && (
        <div className="space-y-3">
          <CrmListToolbar tabs={tabs} status={list.status} onStatus={list.setStatus}
            searchValue={list.searchInput} onSearch={list.setSearchInput}
            placeholder="Search ticket, customer, subject…">
            <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          </CrmListToolbar>

          <CrmDataTable
            columns={columns} rows={tickets} rowKey={(t) => t.Id}
            loading={isLoading} fetching={isFetching}
            error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
            sort={list.sort} onSort={list.toggleSort}
            rowAccent={(t) => isOverdue(t) ? "border-l-red-500" : (STATUS_ACCENT[t.Status] ?? undefined)}
            empty={<>No service tickets match these filters. <button onClick={list.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
            page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
          />
        </div>
      )}

      {showOnboarding && (
        <div className="p-8 rounded-xl border-2 border-dashed border-border bg-muted/10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Plus size={26} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">No service tickets yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
              Raise one for any post-handover warranty, complaint, or service request.
            </p>
          </div>
          <button onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 text-sm px-4 py-2 btn-module text-white rounded-lg font-semibold mx-auto">
            <Plus size={13} /> Raise Ticket
          </button>
        </div>
      )}

      {/* ── Raise Ticket dialog ───────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent accent="crm" className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">Raise Service Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName} ({b.UnitNo})</option>
                ))}
              </SearchableNativeSelect>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Category</label>
                <select value={form.Category} onChange={(e) => setForm((f) => ({ ...f, Category: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Priority</label>
                <select value={form.Priority} onChange={(e) => setForm((f) => ({ ...f, Priority: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Subject *</label>
              <input type="text" value={form.Subject} onChange={(e) => setForm((f) => ({ ...f, Subject: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <Textarea value={form.Description} onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
                rows={3} className="w-full text-sm resize-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assign To</label>
              <SearchableNativeSelect value={form.AssignedTo} onChange={(e) => setForm((f) => ({ ...f, AssignedTo: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Unassigned —</option>
                {(users as any[]).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </SearchableNativeSelect>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
              {saving ? "Raising..." : "Raise Ticket"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resolve dialog (replaces window.prompt) ───────────────────────── */}
      <Dialog open={resolveDialog} onOpenChange={(o) => { if (!o) setResolveDialog(false); }}>
        <DialogContent accent="crm" className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Resolve Ticket</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">Describe what was done to resolve the issue. This is stored permanently on the ticket.</p>
          <Textarea
            value={resolveNotes}
            onChange={(e) => setResolveNotes(e.target.value)}
            placeholder="Resolution notes..."
            rows={4}
            className="resize-none mt-1"
          />
          <DialogFooter>
            <button onClick={() => setResolveDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleResolveConfirm} disabled={saving}
              className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
              {saving ? "Resolving..." : "Mark Resolved"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen dialog (replaces window.prompt) ────────────────────────── */}
      <Dialog open={reopenDialog} onOpenChange={(o) => { if (!o) setReopenDialog(false); }}>
        <DialogContent accent="crm" className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Reopen Ticket</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">Explain why this ticket needs to be reopened. Required for audit trail.</p>
          <Textarea
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="Reason for reopening..."
            rows={3}
            className="resize-none mt-1"
          />
          <DialogFooter>
            <button onClick={() => setReopenDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleReopenConfirm} disabled={saving}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">
              {saving ? "Reopening..." : "Reopen"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmShell>
    </>
  );
};

export default CrmServiceTickets;
