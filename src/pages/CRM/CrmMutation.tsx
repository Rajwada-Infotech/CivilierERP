import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Plus, RotateCcw, CheckCircle2, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/mutation";
const BKG_API = "/api/crm/bookings";

const STATUS_CFG: Record<string, { text: string; bg: string; border: string }> = {
  Applied:  { text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"   },
  Approved: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Applied;
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", c.text, c.bg, c.border)}>
      {status}
    </span>
  );
}

const EMPTY_CREATE = { BookingId: "", ApplicationNo: "", ApplicationDate: "", Authority: "", Remarks: "" };
const EMPTY_EDIT = { Status: "Applied", ApplicationNo: "", ApplicationDate: "", ApprovedNo: "", ApprovedDate: "", Authority: "", Remarks: "" };

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Mutation records");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load bookings");
  return r.json();
}

const CrmMutation: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-mutation");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_EDIT });
  const [updating, setUpdating] = useState(false);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-mutation"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  const patch = (key: string, val: string) => setCreateForm((f) => ({ ...f, [key]: val }));
  const ePatch = (key: string, val: string) => setEditForm((f) => ({ ...f, [key]: val }));

  const openEdit = (r: any) => {
    setEditForm({
      Status: r.Status,
      ApplicationNo: r.ApplicationNo || "",
      ApplicationDate: r.ApplicationDate ? String(r.ApplicationDate).slice(0, 10) : "",
      ApprovedNo: r.ApprovedNo || "",
      ApprovedDate: r.ApprovedDate ? String(r.ApprovedDate).slice(0, 10) : "",
      Authority: r.Authority || "",
      Remarks: r.Remarks || "",
    });
    setEditId(r.Id);
  };

  // Deep-link support
  React.useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) { openEdit(existing); return; }
    if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setCreateForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setCreateOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length]);

  const handleCreate = async () => {
    if (!createForm.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(createForm.BookingId),
          ApplicationNo: createForm.ApplicationNo || undefined,
          ApplicationDate: createForm.ApplicationDate || undefined,
          Authority: createForm.Authority || undefined,
          Remarks: createForm.Remarks || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.MutationNo} started`);
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE });
      qc.invalidateQueries({ queryKey: ["crm-mutation"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editId) return;
    setUpdating(true);
    try {
      const res = await fetchWithAuth(`${API}/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Status: editForm.Status || undefined,
          ApplicationNo: editForm.ApplicationNo || undefined,
          ApplicationDate: editForm.ApplicationDate || undefined,
          ApprovedNo: editForm.ApprovedNo || undefined,
          ApprovedDate: editForm.ApprovedDate || undefined,
          Authority: editForm.Authority || undefined,
          Remarks: editForm.Remarks || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Updated");
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["crm-mutation"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "MutationNo", header: "MUT No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 170,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "DeedNo", header: "Deed", size: 100,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { accessorKey: "ApplicationNo", header: "Application No", size: 130,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "ApplicationDate", header: "Applied On", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ApplicationDate ? String(i.row.original.ApplicationDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "ApprovedNo", header: "Mutation No", size: 120,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "ApprovedDate", header: "Approved On", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ApprovedDate ? String(i.row.original.ApprovedDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "", size: 70, enableSorting: false,
      cell: (i) => canEdit ? (
        <button onClick={() => openEdit(i.row.original)} className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Pencil size={11} /> Edit
        </button>
      ) : null },
  ];

  return (
    <CrmShell
      title="CRM — Mutation"
      subtitle="Municipal property record transfer (Khata Transfer) after Sale Deed registration — gated on Registry Completed"
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
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start Mutation
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Legal" }, { label: "Mutation" }]} />

      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No mutation trackers yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateForm({ ...EMPTY_CREATE }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Start Mutation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={createForm.BookingId} onChange={(e) => patch("BookingId", e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Requires Sale Deed Registry to be Completed.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application No</label>
                <Input className="h-9 text-sm font-mono" placeholder="Optional" value={createForm.ApplicationNo} onChange={(e) => patch("ApplicationNo", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                <Input type="date" className="h-9 text-sm" value={createForm.ApplicationDate} onChange={(e) => patch("ApplicationDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Authority</label>
              <Input className="h-9 text-sm" placeholder="e.g. GHMC, MCGM, BDA" value={createForm.Authority} onChange={(e) => patch("Authority", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <Textarea rows={2} className="resize-none text-sm" value={createForm.Remarks} onChange={(e) => patch("Remarks", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_CREATE }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !createForm.BookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Update Mutation</DialogTitle>
            <DialogDescription className="text-xs">
              {(rows as any[]).find((r: any) => r.Id === editId)?.ApplicantName} · {(rows as any[]).find((r: any) => r.Id === editId)?.BookingNo}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select value={editForm.Status} onChange={(e) => ePatch("Status", e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="Applied">Applied</option>
                <option value="Approved">Approved</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application No</label>
                <Input className="h-9 text-sm font-mono" value={editForm.ApplicationNo} onChange={(e) => ePatch("ApplicationNo", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                <Input type="date" className="h-9 text-sm" value={editForm.ApplicationDate} onChange={(e) => ePatch("ApplicationDate", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Mutation / Khata No</label>
                <Input className="h-9 text-sm font-mono" placeholder="Approved No" value={editForm.ApprovedNo} onChange={(e) => ePatch("ApprovedNo", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Approval Date</label>
                <Input type="date" className="h-9 text-sm" value={editForm.ApprovedDate} onChange={(e) => ePatch("ApprovedDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Authority</label>
              <Input className="h-9 text-sm" placeholder="e.g. GHMC, MCGM" value={editForm.Authority} onChange={(e) => ePatch("Authority", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <Textarea rows={2} className="resize-none text-sm" value={editForm.Remarks} onChange={(e) => ePatch("Remarks", e.target.value)} />
            </div>
            {editForm.Status === "Approved" && editForm.ApprovedNo && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                <CheckCircle2 size={13} /> Mutation approved — municipal records updated.
              </div>
            )}
          </div>
          <DialogFooter className="pt-3 border-t border-border">
            <button onClick={() => setEditId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleUpdate} disabled={updating}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {updating ? "Saving..." : "Save Changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmMutation;
