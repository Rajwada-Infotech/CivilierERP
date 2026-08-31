import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CalendarClock, CheckCircle2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/afs-registry";
const BKG_API = "/api/crm/bookings";

const statusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Scheduled: "text-blue-600 bg-blue-50 border-blue-200",
  Completed: "text-green-600 bg-green-50 border-green-200",
};

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load AFS Registry trackers");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load bookings");
  return r.json();
}

const CrmAfsRegistry: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate } = usePageRights("crm-afs-registry");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [completeId, setCompleteId] = useState<number | null>(null);
  const [completedDate, setCompletedDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-afs-registry"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen || trackedBookingIds.has(parseInt(deepLinkBookingId))) return;
    if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setBookingId(deepLinkBookingId);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length, bookings.length]);

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.AfsRegNo} started`);
      setDialogOpen(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleId || !scheduledDate) { toast.error("Date is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${scheduleId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ScheduledDate: scheduledDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Scheduled");
      setScheduleId(null);
      setScheduledDate("");
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleComplete = async () => {
    if (!completeId) return;
    try {
      const res = await fetchWithAuth(`${API}/${completeId}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CompletedDate: completedDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("AFS Registry completed — enter AfsRegistrationNo on the Agreement record now");
      setCompleteId(null);
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "AfsRegNo", header: "AREG No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "AgreementNo", header: "Agreement", size: 110,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "AfsRegistrationNo", header: "AFS Reg No", size: 120,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "ScheduledDate", header: "Scheduled", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ScheduledDate ? String(i.row.original.ScheduledDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 200, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.Status === "Completed") {
          return r.AfsRegistrationNo
            ? <span className="text-xs text-muted-foreground">Registered ✓</span>
            : <span className="text-xs text-amber-600">Enter AFS Reg No on Agreement</span>;
        }
        return (
          <div className="flex items-center gap-2">
            {r.Status === CrmStatus.PENDING && (
              <button onClick={() => { setScheduleId(r.Id); setScheduledDate(""); }}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                <CalendarClock size={11} /> Schedule
              </button>
            )}
            {r.Status === "Scheduled" && (
              <button onClick={() => { setCompleteId(r.Id); setCompletedDate(new Date().toISOString().slice(0, 10)); }}
                className="flex items-center gap-1 text-xs text-green-700 hover:underline">
                <CheckCircle2 size={11} /> Mark Completed
              </button>
            )}
          </div>
        );
      } },
  ];

  return (
    <CrmShell
      title="Agreement Registration — Sub-Registrar Visit 1"
      subtitle="Both parties appear at the Sub-Registrar's Office to officially register the Agreement for Sale — requires registration fees to be confirmed first"
      action={
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {canCreate && (
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start AFS Registry
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Legal" }, { label: "Agreement Registration Visit" }]} />

      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No AFS Registry trackers yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Start dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Start AFS Registry</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select booking</option>
              {startableBookings.map((b: any) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Requires AFS Query Payment to be Confirmed for this booking first.</p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setBookingId(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleStart} disabled={saving || !bookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule dialog */}
      <Dialog open={!!scheduleId} onOpenChange={(o) => !o && setScheduleId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="font-heading">Schedule AFS Registration</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Appointment Date *</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setScheduleId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSchedule}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">Save</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Complete dialog */}
      <Dialog open={!!completeId} onOpenChange={(o) => !o && setCompleteId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="font-heading">Mark AFS Registry Completed</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Completed Date</label>
            <input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            <p className="text-[11px] text-muted-foreground mt-2">
              After confirming, enter the AFS Registration No on the Agreement record (Mark Registered).
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setCompleteId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleComplete}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">Confirm Completed</button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmAfsRegistry;
