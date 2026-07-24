import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Car, Trash2, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/parking";
const APP_API = "/api/crm/applications";

const EMPTY_FORM = { ApplicationId: "", ProjectId: "", BlockId: "", ParkingMasterId: "", ParkingSlotId: "", ParkingSlotNo: "", Quantity: "1", Notes: "" };

async function fetchAllotments(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchApplications(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${APP_API}?includeConverted=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/unit-master/projects"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBlocks(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/block-master"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchParkingRates(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/parking-master"); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAvailableSlots(projectId?: string, blockId?: string): Promise<any[]> {
  if (!projectId) return [];
  try {
    const params = new URLSearchParams({ projectId });
    if (blockId) params.set("blockId", blockId);
    const r = await fetchWithAuth(`/api/parking-matrix?${params}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

const inr = (n: number | null | undefined) =>
  n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

const CrmParkingBooking: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: allotments = [], isLoading } = useQuery({ queryKey: ["crm-parking-all"], queryFn: fetchAllotments, staleTime: 30_000 });
  const { data: applications = [] } = useQuery({ queryKey: ["crm-applications-dropdown"], queryFn: fetchApplications, staleTime: 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: blocks = [] } = useQuery({ queryKey: ["block-master"], queryFn: fetchBlocks, staleTime: 5 * 60_000 });
  const { data: parkingRates = [] } = useQuery({ queryKey: ["parking-master-all"], queryFn: fetchParkingRates, staleTime: 60_000 });
  const { data: slots = [] } = useQuery({
    queryKey: ["parking-matrix-standalone", form.ProjectId, form.BlockId],
    queryFn: () => fetchAvailableSlots(form.ProjectId, form.BlockId),
    enabled: dialogOpen && !!form.ProjectId,
  });

  const blocksForProject = useMemo(() =>
    form.ProjectId ? (blocks as any[]).filter((b: any) => String(b.ProjectId) === form.ProjectId) : (blocks as any[]),
    [blocks, form.ProjectId]);
  const ratesForScope = useMemo(() =>
    (parkingRates as any[]).filter((r: any) =>
      r.IsActive && (!form.ProjectId || String(r.ProjectId) === form.ProjectId) && (!r.BlockId || !form.BlockId || String(r.BlockId) === form.BlockId)
    ), [parkingRates, form.ProjectId, form.BlockId]);
  const selectedRate = ratesForScope.find((r: any) => String(r.Id) === form.ParkingMasterId);
  const availableSlots = useMemo(() =>
    (slots as any[]).filter((s: any) => s.Status === "Available" && (!selectedRate || s.ParkingType === selectedRate.ParkingType)),
    [slots, selectedRate]);

  const filtered = useMemo(() =>
    (allotments as any[]).filter((a: any) =>
      !search || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.Mobile?.includes(search) || a.BookingNo?.includes(search) || a.SlotNo?.toLowerCase().includes(search.toLowerCase())
    ), [allotments, search]);

  const totalValue = filtered.reduce((s: number, a: any) => s + Number(a.TotalAmount || 0), 0);

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setDialogOpen(false); };

  const handleCreate = async () => {
    if (!form.ApplicationId) { toast.error("Select a customer/application"); return; }
    if (!form.ParkingMasterId) { toast.error("Select a parking rate"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/standalone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: form.ApplicationId,
          ParkingMasterId: form.ParkingMasterId,
          ParkingSlotId: form.ParkingSlotId ? parseInt(form.ParkingSlotId) : null,
          ParkingSlotNo: form.ParkingSlotId ? undefined : (form.ParkingSlotNo || null),
          Quantity: parseInt(form.Quantity) || 1,
          Notes: form.Notes || null,
          // This page sells parking standalone — no unit, no Booking will
          // ever get created to convert a hold into a real sale later. The
          // Application wizard's Parking step is the only caller that wants
          // the hold-first behavior (crmParking.js POST /standalone).
          Immediate: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Parking booked — ${inr(data.TotalAmount)}`);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
      qc.invalidateQueries({ queryKey: ["parking-matrix-standalone"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-paid`, { method: "PUT" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Parking allotment released");
      qc.invalidateQueries({ queryKey: ["crm-parking-all"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName || "—"}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile || "—"}</div>
        </div>
      ) },
    { id: "booking", header: "Booking", size: 110, enableSorting: false,
      cell: (i) => i.row.original.BookingNo ? (
        <span className="font-mono text-xs">{i.row.original.BookingNo}</span>
      ) : (
        <span className="text-xs px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-600">Standalone</span>
      ) },
    { accessorKey: "CurrentParkingType", header: "Type", size: 100, cell: (i) => <span className="text-xs">{i.getValue() as string}</span> },
    { id: "slot", header: "Slot", size: 90, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.SlotNo || i.row.original.ParkingSlotNo || "—"}</span> },
    { accessorKey: "Quantity", header: "Qty", size: 60, cell: (i) => <span className="text-xs">{i.getValue() as number}</span> },
    { accessorKey: "TotalAmount", header: "Amount", size: 110, cell: (i) => <span className="font-semibold">{inr(i.row.original.TotalAmount)}</span> },
    { accessorKey: "PaymentStatus", header: "Status", size: 100,
      cell: (i) => (
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${i.row.original.PaymentStatus === "Paid" ? "text-green-600 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200"}`}>
          {i.row.original.PaymentStatus}
        </span>
      ) },
    { id: "actions", header: "Actions", size: 150, enableSorting: false,
      cell: (i) => {
        const a = i.row.original;
        return (
          <div className="flex items-center gap-2">
            {!a.BookingId && a.PaymentStatus !== "Paid" && (
              <button onClick={() => handleMarkPaid(a.Id)} className="text-xs text-green-600 hover:underline flex items-center gap-1">
                <CheckCircle2 size={12} /> Mark Paid
              </button>
            )}
            <button onClick={() => handleRemove(a.Id)} className="text-xs text-red-600 hover:underline flex items-center gap-1">
              <Trash2 size={12} /> Remove
            </button>
          </div>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Parking Booking"
      subtitle="Every parking allotment — sold alongside a unit booking or standalone — in one place"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Parking Booking
        </button>
      }
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, mobile, booking, slot..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-1.5 text-sm bg-muted/30 border border-border rounded-lg px-3 py-2">
          <Car size={14} className="text-muted-foreground" />
          <span className="text-muted-foreground">Total shown:</span>
          <span className="font-semibold">{inr(totalValue)}</span>
        </div>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No parking allotments yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">New Parking Booking</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground -mt-1">
              Standalone parking sale — not tied to a unit booking. To allot parking against an existing unit booking instead, open that booking's Details tab.
            </p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Customer / Application *</label>
              <select value={form.ApplicationId} onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select application</option>
                {(applications as any[]).map((a: any) => (
                  <option key={a.Id} value={String(a.Id)}>{a.ApplicantName} — {a.Mobile} ({a.ApplicationNo})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Project</label>
                <select value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, BlockId: "", ParkingMasterId: "", ParkingSlotId: "" }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select project</option>
                  {(projects as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Block</label>
                <select value={form.BlockId} onChange={(e) => setForm((f) => ({ ...f, BlockId: e.target.value, ParkingMasterId: "", ParkingSlotId: "" }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Any block</option>
                  {blocksForProject.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.Name || b.BlockName}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <select value={form.ParkingMasterId}
                onChange={(e) => setForm((f) => ({ ...f, ParkingMasterId: e.target.value, ParkingSlotId: "" }))}
                className="col-span-2 text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select parking rate</option>
                {ratesForScope.map((r: any) => (
                  <option key={r.Id} value={String(r.Id)}>{r.ParkingType} — {inr(r.Charge)} (+{r.GstRate}% GST)</option>
                ))}
              </select>
              {availableSlots.length > 0 ? (
                <select value={form.ParkingSlotId} onChange={(e) => setForm((f) => ({ ...f, ParkingSlotId: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Slot (optional)</option>
                  {availableSlots.map((s: any) => (
                    <option key={s.Id} value={String(s.Id)}>{s.SlotNo}{s.BlockName ? ` — ${s.BlockName}` : ""}</option>
                  ))}
                </select>
              ) : (
                <input placeholder="Slot No." value={form.ParkingSlotNo}
                  onChange={(e) => setForm((f) => ({ ...f, ParkingSlotNo: e.target.value }))}
                  className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
              )}
              <input type="number" min={1} placeholder="Qty" value={form.Quantity}
                onChange={(e) => setForm((f) => ({ ...f, Quantity: e.target.value }))}
                className="text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            {form.ProjectId && ratesForScope.length === 0 && (
              <p className="text-xs text-muted-foreground">No parking rate configured for this project/block yet — set one up in Matrix → Parking Matrix / Setup → Parking Master.</p>
            )}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={resetForm} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Booking..." : "Book Parking"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmParkingBooking;
