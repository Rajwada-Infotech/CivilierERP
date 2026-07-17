import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/service-tickets";
const BKG_API = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";

const CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Other"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const STATUSES = ["Open", "Assigned", "InProgress", "Resolved", "Closed", "Reopened"];

const priorityColor: Record<string, string> = {
  Urgent: "text-red-600 bg-red-50 border-red-200",
  High:   "text-orange-600 bg-orange-50 border-orange-200",
  Normal: "text-blue-600 bg-blue-50 border-blue-200",
  Low:    "text-muted-foreground bg-muted/50 border-border",
};
const statusColor: Record<string, string> = {
  Open:       "text-orange-600 bg-orange-50 border-orange-200",
  Assigned:   "text-blue-600 bg-blue-50 border-blue-200",
  InProgress: "text-purple-600 bg-purple-50 border-purple-200",
  Resolved:   "text-green-600 bg-green-50 border-green-200",
  Closed:     "text-muted-foreground bg-muted/50 border-border",
  Reopened:   "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_FORM = { BookingId: "", Category: "Complaint", Priority: "Normal", Subject: "", Description: "", AssignedTo: "" };

async function fetchTickets(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({ queryKey: ["crm-service-tickets"], queryFn: fetchTickets, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });

  const filtered = useMemo(() =>
    (tickets as any[]).filter((t: any) => {
      const s = !search || t.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || t.TicketNo?.includes(search) || t.Subject?.toLowerCase().includes(search.toLowerCase());
      const st = statusFilter === "All" || t.Status === statusFilter;
      return s && st;
    }), [tickets, search, statusFilter]);

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
      toast.error(e.message);
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
      toast.success(`Ticket marked ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-service-tickets"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMarkInProgress = (id: number) => runAction(id, "mark-in-progress");

  const handleResolve = (id: number) => {
    const notes = window.prompt("Resolution notes:");
    if (!notes) return;
    runAction(id, "resolve", { ResolutionNotes: notes });
  };

  const handleClose = (id: number) => runAction(id, "close");

  const handleReopen = (id: number) => {
    const reason = window.prompt("Reason for reopening:");
    if (!reason) return;
    runAction(id, "reopen", { Reason: reason });
  };

  const isOverdue = (t: any) => t.SlaDueDate && new Date(t.SlaDueDate) < new Date() && !["Resolved", "Closed"].includes(t.Status);

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "TicketNo", header: "Ticket No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "Category", header: "Category", size: 100,
      cell: (i) => <span className="text-xs">{(i.getValue() as string).replace(/([A-Z])/g, " $1").trim()}</span> },
    { accessorKey: "Subject", header: "Subject", size: 180,
      cell: (i) => (
        <div className="max-w-xs truncate">
          {i.row.original.Subject}
          {i.row.original.RaisedByCustomer && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-600 font-medium">Customer</span>
          )}
        </div>
      ) },
    { accessorKey: "Priority", header: "Priority", size: 90,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${priorityColor[i.row.original.Priority] || ""}`}>{i.row.original.Priority}</span> },
    { accessorKey: "AssigneeName", header: "Assigned To", size: 110, cell: (i) => <span className="text-sm">{(i.getValue() as string) || "—"}</span> },
    { id: "slaDue", header: "SLA Due", size: 140, enableSorting: false,
      cell: (i) => {
        const t = i.row.original;
        const overdue = isOverdue(t);
        return (
          <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
            {t.SlaDueDate ? String(t.SlaDueDate).slice(0, 16).replace("T", " ") : "—"}
            {overdue && " (OVERDUE)"}
          </span>
        );
      } },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "rating", header: "Rating", size: 80, enableSorting: false,
      cell: (i) => i.row.original.CustomerRating ? (
        <span className="flex items-center gap-0.5 text-yellow-500 text-xs">
          <Star size={12} fill="currentColor" /> {i.row.original.CustomerRating}/5
        </span>
      ) : <span>—</span> },
    { id: "actions", header: "Actions", size: 150, enableSorting: false,
      cell: (i) => {
        const t = i.row.original;
        return (
          <div className="flex items-center gap-2 whitespace-nowrap">
            {t.Status === "Assigned" && (
              <button onClick={() => handleMarkInProgress(t.Id)} className="text-xs text-primary hover:underline">Start</button>
            )}
            {(t.Status === "Assigned" || t.Status === "InProgress") && (
              <button onClick={() => handleResolve(t.Id)} className="text-xs text-primary hover:underline">Resolve</button>
            )}
            {t.Status === "Resolved" && (
              <>
                <button onClick={() => handleClose(t.Id)} className="text-xs text-primary hover:underline">Close</button>
                <button onClick={() => handleReopen(t.Id)} className="text-xs text-red-600 hover:underline">Reopen</button>
              </>
            )}
            {t.Status === "Closed" && (
              <button onClick={() => handleReopen(t.Id)} className="text-xs text-red-600 hover:underline">Reopen</button>
            )}
          </div>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Service Tickets"
      subtitle="After-sales warranty, complaints & service requests"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Raise Ticket
        </button>
      }
    >
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket, customer, subject..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="All">All Statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No service tickets found"
        rowClassName={(row) => isOverdue(row.original) ? "bg-red-50/30" : ""}
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">Raise Service Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName} ({b.UnitNo})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
              <textarea value={form.Description} onChange={(e) => setForm((f) => ({ ...f, Description: e.target.value }))}
                rows={3} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assign To</label>
              <select value={form.AssignedTo} onChange={(e) => setForm((f) => ({ ...f, AssignedTo: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Unassigned —</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Raising..." : "Raise Ticket"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmServiceTickets;
