import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/sales-deed";
const BKG_API = "/api/crm/bookings";

// Status is never manually picked — it's auto-derived server-side, level by
// level, from ExecutedBy / RegistrationNo / DeedDate actually being on
// record (see deriveDeedStatus in backend/routes/crmSalesDeed.js).
const statusColor: Record<string, string> = {
  Draft:      "text-muted-foreground bg-muted/50 border-border",
  Executed:   "text-blue-600 bg-blue-50 border-blue-200",
  Registered: "text-green-600 bg-green-50 border-green-200",
  Overdue:    "text-red-600 bg-red-50 border-red-200",
  Cancelled:  "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_FORM = { BookingId: "", DeedValue: "", StampDuty: "", RegistrationFee: "", SubRegistrarOffice: "", DeedDate: "" };
const EMPTY_PROGRESS_FORM = { ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmSalesDeed: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [progressDialog, setProgressDialog] = useState<number | null>(null);
  const [progressForm, setProgressForm] = useState({ ...EMPTY_PROGRESS_FORM });
  const [saving, setSaving] = useState(false);

  const { data: deeds = [], isLoading } = useQuery({ queryKey: ["crm-sales-deed"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Sale deed ${data.DeedNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openProgress = (d: any) => {
    setProgressForm({
      ExecutedBy: d.ExecutedBy || "", RegistrationNo: d.RegistrationNo || "",
      BookNo: d.BookNo || "", PartNo: d.PartNo || "",
      RegistrationDate: d.RegistrationDate ? String(d.RegistrationDate).slice(0, 10) : "",
      PossessionDate: d.PossessionDate ? String(d.PossessionDate).slice(0, 10) : "",
    });
    setProgressDialog(d.Id);
  };

  const handleSaveProgress = async () => {
    if (!progressDialog) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${progressDialog}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(progressForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Deed status: ${data.status}`);
      setProgressDialog(null);
      qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deedColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "DeedNo", header: "Deed No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "DeedValue", header: "Deed Value", size: 120,
      cell: (i) => <span>{i.row.original.DeedValue ? `₹${Number(i.row.original.DeedValue).toLocaleString("en-IN")}` : "—"}</span> },
    { accessorKey: "RegistrationNo", header: "Registration No", size: 130,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "directorApproval", header: "Director Approval", size: 150, enableSorting: false,
      cell: (i) => {
        const d = i.row.original;
        return d.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired" ? (
          <div className="flex flex-col gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${
              d.DirectorApprovalStatus === "Approved" ? "text-green-600 bg-green-50 border-green-200"
              : d.DirectorApprovalStatus === "Rejected" ? "text-red-600 bg-red-50 border-red-200"
              : "text-orange-600 bg-orange-50 border-orange-200"
            }`}>{d.DirectorApprovalStatus}</span>
            {d.DirectorApprovalStatus === "Pending" && (
              <ApprovalActions
                status={d.DirectorApprovalStatus}
                recordId={d.Id}
                endpoint={API}
                actionPathSuffix="director"
                approverRoles={["super_admin"]}
                onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-sales-deed"] })}
              />
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      } },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const d = i.row.original;
        return d.Status !== "Registered" && d.Status !== "Cancelled" ? (
          <button onClick={() => openProgress(d)} className="text-xs text-primary hover:underline">
            Update Execution/Registration
          </button>
        ) : null;
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Sale Deed"
      subtitle="Deed execution and registration tracking"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Deed
        </button>
      }
    >
      <DataTable
        data={deeds as any[]}
        columns={deedColumns}
        loading={isLoading}
        emptyMessage="No sale deeds"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">New Sale Deed</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Deed Value</label>
                <input type="number" value={form.DeedValue} onChange={(e) => setForm((f) => ({ ...f, DeedValue: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Stamp Duty</label>
                <input type="number" value={form.StampDuty} onChange={(e) => setForm((f) => ({ ...f, StampDuty: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration Fee</label>
                <input type="number" value={form.RegistrationFee} onChange={(e) => setForm((f) => ({ ...f, RegistrationFee: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Deed Date</label>
                <input type="date" value={form.DeedDate} onChange={(e) => setForm((f) => ({ ...f, DeedDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sub-Registrar Office</label>
              <input type="text" value={form.SubRegistrarOffice} onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!progressDialog} onOpenChange={(o) => { if (!o) setProgressDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Update Execution / Registration</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Status advances automatically once these facts are on record — it is not picked manually.</p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Executed By</label>
              <input type="text" value={progressForm.ExecutedBy}
                onChange={(e) => setProgressForm((f) => ({ ...f, ExecutedBy: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration No.</label>
                <input type="text" value={progressForm.RegistrationNo}
                  onChange={(e) => setProgressForm((f) => ({ ...f, RegistrationNo: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration Date</label>
                <input type="date" value={progressForm.RegistrationDate}
                  onChange={(e) => setProgressForm((f) => ({ ...f, RegistrationDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Book No.</label>
                <input type="text" value={progressForm.BookNo}
                  onChange={(e) => setProgressForm((f) => ({ ...f, BookNo: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Part No.</label>
                <input type="text" value={progressForm.PartNo}
                  onChange={(e) => setProgressForm((f) => ({ ...f, PartNo: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Possession Date</label>
                <input type="date" value={progressForm.PossessionDate}
                  onChange={(e) => setProgressForm((f) => ({ ...f, PossessionDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setProgressDialog(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSaveProgress} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmSalesDeed;
