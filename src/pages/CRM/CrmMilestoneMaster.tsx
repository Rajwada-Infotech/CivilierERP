import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Pencil, ListOrdered } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/milestone-master";

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmMilestoneMaster: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [defaultPercent, setDefaultPercent] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: milestones = [], isLoading } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchAll, staleTime: 30_000 });

  const resetForm = () => {
    setEditingId(null);
    setName(""); setDefaultPercent(""); setSortOrder("");
  };

  const openEdit = (m: any) => {
    setEditingId(m.Id);
    setName(m.Name);
    setDefaultPercent(m.DefaultPercent != null ? String(m.DefaultPercent) : "");
    setSortOrder(String(m.SortOrder));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Name: name.trim(),
          DefaultPercent: defaultPercent || null,
          SortOrder: sortOrder || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(isEdit ? "Milestone updated" : "Milestone created");
      setDialogOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone deleted");
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const milestoneColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "SortOrder", header: "Order", size: 80,
      cell: (i) => <span className="text-xs text-muted-foreground flex items-center gap-1"><ListOrdered size={11} /> {i.getValue() as number}</span> },
    { accessorKey: "Name", header: "Name", size: 180,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "DefaultPercent", header: "Default %", size: 100,
      cell: (i) => <span className="text-xs">{i.row.original.DefaultPercent != null ? `${i.row.original.DefaultPercent}%` : "—"}</span> },
    { accessorKey: "IsActive", header: "Status", size: 100,
      cell: (i) => (
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${i.row.original.IsActive ? "text-green-600 bg-green-50 border-green-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
          {i.row.original.IsActive ? "Active" : "Inactive"}
        </span>
      ) },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-1.5">
          <button onClick={() => openEdit(i.row.original)} className="p-1 text-muted-foreground hover:text-primary" title="Edit"><Pencil size={13} /></button>
          <button onClick={() => handleDelete(i.row.original.Id)} className="p-1 text-muted-foreground hover:text-red-600" title="Delete"><Trash2 size={13} /></button>
        </div>
      ) },
  ];

  return (
    <SalesAutoShell
      title="CRM — Milestone Master"
      subtitle="Reusable milestone steps — Payment Plan Master picks from this list instead of retyping names"
      action={
        <button onClick={() => { resetForm(); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Milestone
        </button>
      }
    >
      <DataTable
        data={milestones as any[]}
        columns={milestoneColumns}
        loading={isLoading}
        emptyMessage="No milestones defined"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">{editingId != null ? "Edit Milestone" : "New Milestone"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Default %</label>
                <input type="number" value={defaultPercent} onChange={(e) => setDefaultPercent(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Sort Order</label>
                <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : editingId != null ? "Save Changes" : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmMilestoneMaster;
