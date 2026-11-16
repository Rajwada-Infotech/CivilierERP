import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ticket, Search, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import {
  ICON_ACT, SHEET_DIALOG, SheetTabs, TAG, TICKET_PRIORITY_TONE, TICKET_STATUS_TONE, ticketStatusLabel,
} from "@/components/maintenance/maintParts";
import { HrEmpty, HrError, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getServiceTickets, markTicketInProgress, resolveServiceTicket, closeServiceTicket,
  type ServiceTicketRow,
} from "@/api/serviceTicketApi";
import { ApplicantNames } from "@/components/crm/ApplicantNames";

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

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
  const { data, isLoading, error } = useQuery({
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

  const meta = (label: string, value: React.ReactNode) => (
    <p className="text-xs text-muted-foreground">{label}: <span className="text-foreground">{value}</span></p>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Service Requests"]} />
      <MaintenanceShell
        title="Service Requests"
        subtitle="Warranty, complaints and service requests for handed-over residents only"
        action={
          <div className="relative w-full sm:w-72">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, ticket no, subject…"
              className={`${HR_FIELD} pl-8`}
            />
          </div>
        }
      >
        <SheetTabs tabs={STATUS_TABS} value={statusFilter} onChange={setStatusFilter} />

        {isLoading ? (
          <div className="skel" style={{ height: 240 }} />
        ) : error ? (
          <HrError text="Failed to load tickets." />
        ) : rows.length === 0 ? (
          <div className="bg-card" style={{ border: HR_RULE }}>
            <HrEmpty icon={Ticket} title="No service requests" text="No service requests found for handed-over residents." />
          </div>
        ) : (
          <div className="bg-card divide-y divide-foreground/15" style={{ border: HR_RULE }}>
            {rows.map((t) => (
              <div key={t.Id} className="px-4 py-3 hover:bg-primary/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-1">
                      <span className={`text-xs text-foreground ${HR_NUM}`}>{t.TicketNo}</span>
                      <SheetMark text={ticketStatusLabel(t.Status)} tone={TICKET_STATUS_TONE[t.Status] ?? "waiting"} />
                      <SheetMark text={t.Priority} tone={TICKET_PRIORITY_TONE[t.Priority] ?? "draft"} />
                      {t.Category && <span className={TAG}>{t.Category}</span>}
                    </div>
                    <p className="text-sm font-heading font-semibold text-foreground truncate">{t.Subject}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                      {t.ApplicantName && meta("Customer", <ApplicantNames name={t.ApplicantName} bookingId={t.BookingId} />)}
                      {t.UnitNo && meta("Unit", t.UnitNo)}
                      {t.ProjectName && meta("Project", t.ProjectName)}
                      {t.AssigneeName && meta("Assigned", t.AssigneeName)}
                      {t.SlaDueDate && meta("SLA", <span className={HR_NUM}>{fmtDate(t.SlaDueDate)}</span>)}
                    </div>
                  </div>
                  {rights.canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {t.Status === "Assigned" && (
                        <button onClick={() => handleMarkInProgress(t.Id)} disabled={actionLoading} title="Mark In Progress" className={ICON_ACT}>
                          <Clock size={14} />
                        </button>
                      )}
                      {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                        <button onClick={() => setResolveId(t.Id)} disabled={actionLoading} title="Resolve" className={ICON_ACT}>
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {t.Status === "Resolved" && (
                        <button onClick={() => handleClose(t.Id)} disabled={actionLoading} title="Close" className={ICON_ACT}>
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
        <DialogContent className={`${SHEET_DIALOG} max-w-sm`} style={{ margin: 0 }}>
          <DialogHeader><DialogTitle className={HR_HEAD}>Resolve Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className={`block mb-1.5 ${HR_LBL}`}>Resolution Notes *</label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
                placeholder="Describe what was done to resolve this issue…"
                className={`${HR_FIELD} h-auto py-2 resize-none`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
              <button onClick={() => setResolveId(null)} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
              <button onClick={handleResolve} disabled={actionLoading} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Resolve
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
