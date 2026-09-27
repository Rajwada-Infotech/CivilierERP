import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ticket, Search, CheckCircle2, Clock, AlertCircle, Loader2, Plus } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getServiceTickets, markTicketInProgress, resolveServiceTicket, closeServiceTicket, reopenServiceTicket,
  type ServiceTicketRow, type TicketStatus,
} from "@/api/serviceTicketApi";

const TICKET_VIOLET = "#a78bfa";
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "\u2014");

const STATUS_COLOR: Record<string, string> = {
  Open:       "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Assigned:   "bg-sky-500/10 border-sky-500/20 text-sky-600",
  InProgress: "bg-violet-500/10 border-violet-500/20 text-violet-600",
  Resolved:   "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
  Closed:     "bg-muted border-border text-muted-foreground",
  Reopened:   "bg-orange-500/10 border-orange-500/20 text-orange-600",
};
const PRIORITY_COLOR: Record<string, string> = {
  Urgent: "bg-red-500/10 border-red-500/20 text-red-600",
  High:   "bg-orange-500/10 border-orange-500/20 text-orange-600",
  Normal: "bg-sky-500/10 border-sky-500/20 text-sky-600",
  Low:    "bg-muted border-border text-muted-foreground",
};
function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${STATUS_COLOR[status] || "bg-muted border-border text-muted-foreground"}`}>{status}</span>;
}
function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${PRIORITY_COLOR[priority] || "bg-muted border-border text-muted-foreground"}`}>{priority}</span>;
}

const STATUS_TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Open", value: "Open" },
  { label: "Assigned", value: "Assigned" },
  { label: "In Progress", value: "InProgress" },
  { label: "Resolved", value: "Resolved" },
  { label: "Closed", value: "Closed" },
];

export default function MaintenanceServiceRequests() {
  const rights = usePageRights("crm-service-tickets");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Always fetch WITHOUT pagination so we get a simple array; handedOverOnly
  // restricts results to post-handover (maintenance-eligible) customers.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["maint-service-tickets", { search, statusFilter }],
    queryFn: () =>
      getServiceTickets({
        handedOverOnly: true,
        ...(statusFilter && { status: statusFilter }),
        ...(search && { search }),
      }),
    select: (d) => (Array.isArray(d) ? d : (d as { rows: ServiceTicketRow[] }).rows ?? []),
  });

  const rows: ServiceTicketRow[] = (data as ServiceTicketRow[] | undefined) ?? [];

  const handleMarkInProgress = async (id: number) => {
    setActionLoading(true);
    try {
      await markTicketInProgress(id);
      toast.success("Marked In Progress");
      qc.invalidateQueries({ queryKey: ["maint-service-tickets"] });
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };

  const handleResolve = async () => {
    if (!resolveId) return;
    if (!resolutionNotes.trim()) { toast.error("Resolution notes required"); return; }
    setActionLoading(true);
    try {
      await resolveServiceTicket(resolveId, resolutionNotes.trim());
      toast.success("Ticket resolved");
      qc.invalidateQueries({ queryKey: ["maint-service-tickets"] });
      setResolveId(null); setResolutionNotes("");
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };

  const handleClose = async (id: number) => {
    setActionLoading(true);
    try {
      await closeServiceTicket(id);
      toast.success("Ticket closed");
      qc.invalidateQueries({ queryKey: ["maint-service-tickets"] });
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Service Requests"]} />
      <MaintenanceShell
        title="Service Requests"
        subtitle="Warranty, complaints and service requests for handed-over residents only"
        icon={Ticket}
      >
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, ticket no, subject\u2026"
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
            />
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className="px-3 py-1 rounded-md text-xs font-heading font-medium transition-all"
                style={active ? { background: `${TICKET_VIOLET}20`, color: TICKET_VIOLET, borderColor: `${TICKET_VIOLET}50`, border: "1px solid" } : {}}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Ticket list */}
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 size={22} className="animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-destructive">Failed to load tickets.</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 flex flex-col items-center gap-3">
            <Ticket size={24} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No service requests found for handed-over residents.</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {rows.map((t) => (
              <div key={t.Id} className="px-4 py-3 hover:bg-muted/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{t.TicketNo}</span>
                      <StatusBadge status={t.Status} />
                      <PriorityBadge priority={t.Priority} />
                      <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">{t.Category}</span>
                    </div>
                    <p className="text-sm font-heading font-semibold text-foreground truncate">{t.Subject}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                      {t.ApplicantName && <p className="text-xs text-muted-foreground">Customer: <span className="text-foreground">{t.ApplicantName}</span></p>}
                      {t.UnitNo && <p className="text-xs text-muted-foreground">Unit: <span className="text-foreground">{t.UnitNo}</span></p>}
                      {t.ProjectName && <p className="text-xs text-muted-foreground">Project: <span className="text-foreground">{t.ProjectName}</span></p>}
                      {t.AssigneeName && <p className="text-xs text-muted-foreground">Assigned: <span className="text-foreground">{t.AssigneeName}</span></p>}
                      {t.SlaDueDate && <p className="text-xs text-muted-foreground">SLA: <span className="text-foreground">{fmtDate(t.SlaDueDate)}</span></p>}
                    </div>
                  </div>
                  {rights.canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {t.Status === "Assigned" && (
                        <button onClick={() => handleMarkInProgress(t.Id)} disabled={actionLoading} title="Mark In Progress" className="p-1.5 rounded-md text-muted-foreground hover:text-violet-500 hover:bg-violet-500/10 transition-colors disabled:opacity-40">
                          <Clock size={14} />
                        </button>
                      )}
                      {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                        <button onClick={() => setResolveId(t.Id)} disabled={actionLoading} title="Resolve" className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {t.Status === "Resolved" && (
                        <button onClick={() => handleClose(t.Id)} disabled={actionLoading} title="Close" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40">
                          <AlertCircle size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </MaintenanceShell>

      {/* Resolve Dialog */}
      <Dialog open={resolveId !== null} onOpenChange={(o) => !o && setResolveId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading text-base">Resolve Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Resolution Notes *</label>
              <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} placeholder="Describe what was done to resolve this issue\u2026" className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => setResolveId(null)} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">Cancel</button>
              <button onClick={handleResolve} disabled={actionLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-emerald-600 text-white hover:opacity-90 transition-all disabled:opacity-60">
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Resolve
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}