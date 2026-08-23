import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Pencil, ListOrdered, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/milestone-master";

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmMilestoneMaster: React.FC = () => {
  const qc = useQueryClient();
  usePageRights("crm-milestone-master");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  // Opens locked (read-only) whenever editing an existing row — "New
  // Milestone" opens unlocked since there's nothing existing to protect.
  const [locked, setLocked] = useState(false);
  const inputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

  const { data: milestones = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchAll, staleTime: 30_000 });

  const resetForm = () => {
    setEditingId(null);
    setName(""); setSortOrder("");
    setLocked(false);
    setIsActive(true);
  };

  const openEdit = (m: any) => {
    setEditingId(m.Id);
    setName(m.Name);
    setSortOrder(String(m.SortOrder));
    setIsActive(m.IsActive !== false && m.IsActive !== 0);
    setLocked(true);
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
          SortOrder: sortOrder || 0,
          IsActive: isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(isEdit ? "Milestone updated" : "Milestone created");
      setDialogOpen(false);
      setLocked(true);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this milestone? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Milestone deleted");
      qc.invalidateQueries({ queryKey: ["crm-milestone-master"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingId(null);
    }
  };

  const milestoneColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "SortOrder", header: "Order", size: 80,
      cell: (i) => <span className="text-xs text-muted-foreground flex items-center gap-1"><ListOrdered size={11} /> {i.getValue() as number}</span> },
    { accessorKey: "Name", header: "Name", size: 180,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
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
          <button onClick={() => handleDelete(i.row.original.Id)} disabled={deletingId === i.row.original.Id}
            className="p-1 text-muted-foreground hover:text-red-600 disabled:opacity-40 disabled:pointer-events-none" title="Delete"><Trash2 size={13} /></button>
        </div>
      ) },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Milestone Master"]} />
      <CrmShell
        title="CRM — Milestone Master"
      subtitle="Reusable milestone steps — Payment Plan Master picks from this list instead of retyping names"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => { resetForm(); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Milestone
        </button>
        </div>
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
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span>{editingId != null ? "Edit Milestone" : "New Milestone"}</span>
              {editingId != null && locked && (
                <button onClick={() => setLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                  <Pencil size={12} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {editingId != null && locked && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 -mt-1">
              <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name *</label>
              <input type="text" value={name} readOnly={locked} onChange={(e) => setName(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sort Order</label>
              <input type="number" value={sortOrder} readOnly={locked} onChange={(e) => setSortOrder(e.target.value)}
                className={inputCls} />
            </div>
            <div className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${locked ? "opacity-70" : ""}`}>
              <div>
                <div className="text-xs font-medium text-foreground">Status</div>
                <p className="text-[11px] text-muted-foreground">
                  {isActive ? "Active — offered in the payment plan step picker." : "Inactive — hidden from the picker, kept for history."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!locked) setIsActive((v) => !v); }}
                disabled={locked}
                role="switch"
                aria-checked={isActive}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${isActive ? "bg-green-500" : "bg-muted-foreground/30"} ${locked ? "cursor-not-allowed" : ""}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isActive ? "translate-x-[18px]" : "translate-x-1"}`} />
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            {editingId != null && locked ? (
              <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                  {saving ? "Saving..." : editingId != null ? "Save Changes" : "Create"}
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmMilestoneMaster;