import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RotateCcw, Pencil, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { cn } from "@/lib/utils";

const API = "/api/crm/oc-cc";
const PROJ_API = "/api/unit-master/projects";

const CERT_TYPES = ["OC", "CC", "OC+CC"] as const;
const STATUSES   = ["Applied", "Received"] as const;

const STATUS_CFG: Record<string, { text: string; bg: string; border: string }> = {
  Applied:  { text: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"  },
  Received: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Applied;
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", c.text, c.bg, c.border)}>
      {status}
    </span>
  );
}

const EMPTY_FORM = {
  ProjectId: "", CertType: "OC" as string, Status: "Applied" as string,
  ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "",
};

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load OC/CC records");
  return r.json();
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJ_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmOcCc: React.FC = () => {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePageRights("crm-oc-cc");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [updating, setUpdating] = useState(false);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-oc-cc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });

  const patch = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));
  const ePatch = (key: string, val: string) => setEditForm((f) => ({ ...f, [key]: val }));

  const openEdit = (r: any) => {
    setEditForm({
      ProjectId: String(r.ProjectId), CertType: r.CertType, Status: r.Status,
      ApplicationDate: r.ApplicationDate ? String(r.ApplicationDate).slice(0, 10) : "",
      ReceivedDate: r.ReceivedDate ? String(r.ReceivedDate).slice(0, 10) : "",
      CertificateNo: r.CertificateNo || "", IssuedBy: r.IssuedBy || "", Remarks: r.Remarks || "",
    });
    setEditId(r.Id);
  };

  const handleCreate = async () => {
    if (!form.ProjectId) { toast.error("Project is required"); return; }
    if (!form.CertType)  { toast.error("Certificate type is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: parseInt(form.ProjectId),
          CertType: form.CertType,
          Status: form.Status,
          ApplicationDate: form.ApplicationDate || undefined,
          ReceivedDate: form.ReceivedDate || undefined,
          CertificateNo: form.CertificateNo || undefined,
          IssuedBy: form.IssuedBy || undefined,
          Remarks: form.Remarks || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("OC/CC application recorded");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
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
          CertType: editForm.CertType || undefined,
          Status: editForm.Status || undefined,
          ApplicationDate: editForm.ApplicationDate || undefined,
          ReceivedDate: editForm.ReceivedDate || undefined,
          CertificateNo: editForm.CertificateNo || undefined,
          IssuedBy: editForm.IssuedBy || undefined,
          Remarks: editForm.Remarks || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Updated");
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "ProjectName", header: "Project", size: 170,
      cell: (i) => <span className="font-medium text-sm">{i.getValue() as string}</span> },
    { accessorKey: "CertType", header: "Type", size: 80,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { accessorKey: "ApplicationDate", header: "Applied On", size: 110,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ApplicationDate ? String(i.row.original.ApplicationDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "ReceivedDate", header: "Received On", size: 110,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.ReceivedDate ? String(i.row.original.ReceivedDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "CertificateNo", header: "Certificate No", size: 140,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "IssuedBy", header: "Authority", size: 140,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { id: "actions", header: "", size: 70, enableSorting: false,
      cell: (i) => canEdit ? (
        <button onClick={() => openEdit(i.row.original)} className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Pencil size={11} /> Edit
        </button>
      ) : null },
  ];

  return (
    <CrmShell
      title="Occupancy & Completion Certificate (OC / CC)"
      subtitle="Local authority certificate confirming the building is structurally complete and fit for occupation — required before handing over possession to buyers"
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
              <Plus size={14} /> Add OC/CC Application
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Closure" }, { label: "OC / CC" }]} />

      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No OC/CC applications recorded yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Add OC / CC Application</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Project *</label>
              <select value={form.ProjectId} onChange={(e) => patch("ProjectId", e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select project</option>
                {(projects as any[]).map((p: any) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Certificate Type *</label>
                <select value={form.CertType} onChange={(e) => patch("CertType", e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {CERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Status</label>
                <select value={form.Status} onChange={(e) => patch("Status", e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                <Input type="date" className="h-9 text-sm" value={form.ApplicationDate} onChange={(e) => patch("ApplicationDate", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Received Date</label>
                <Input type="date" className="h-9 text-sm" value={form.ReceivedDate} onChange={(e) => patch("ReceivedDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Certificate No</label>
              <Input className="h-9 text-sm font-mono" placeholder="Optional" value={form.CertificateNo} onChange={(e) => patch("CertificateNo", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Issuing Authority</label>
              <Input className="h-9 text-sm" placeholder="e.g. GHMC, MCGM, BDA" value={form.IssuedBy} onChange={(e) => patch("IssuedBy", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <Textarea rows={2} className="resize-none text-sm" value={form.Remarks} onChange={(e) => patch("Remarks", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setCreateOpen(false); setForm({ ...EMPTY_FORM }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !form.ProjectId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Update OC / CC Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Certificate Type</label>
                <select value={editForm.CertType} onChange={(e) => ePatch("CertType", e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {CERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Status</label>
                <select value={editForm.Status} onChange={(e) => ePatch("Status", e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                <Input type="date" className="h-9 text-sm" value={editForm.ApplicationDate} onChange={(e) => ePatch("ApplicationDate", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Received Date</label>
                <Input type="date" className="h-9 text-sm" value={editForm.ReceivedDate} onChange={(e) => ePatch("ReceivedDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Certificate No</label>
              <Input className="h-9 text-sm font-mono" value={editForm.CertificateNo} onChange={(e) => ePatch("CertificateNo", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Issuing Authority</label>
              <Input className="h-9 text-sm" value={editForm.IssuedBy} onChange={(e) => ePatch("IssuedBy", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <Textarea rows={2} className="resize-none text-sm" value={editForm.Remarks} onChange={(e) => ePatch("Remarks", e.target.value)} />
            </div>
            {editForm.Status === "Received" && editForm.CertificateNo && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                <CheckCircle2 size={13} /> Certificate No recorded — possession clearance ready.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setEditId(null)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleUpdate} disabled={updating}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {updating ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmOcCc;
