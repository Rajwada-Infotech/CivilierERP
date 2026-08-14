import { useEffect, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, RotateCcw, AlertTriangle, Tags } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getRoomCategories, createRoomCategory, updateRoomCategory, deleteRoomCategory,
  type RoomCategory,
} from "@/api/roomCategoryMasterApi";

const EMPTY = { categoryName: "", alias: "", sortOrder: "0", isActive: true };

export default function RoomCategoryMaster() {
  const rights = usePageRights("room-category-master");
  const qc = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["room-categories"],
    queryFn: getRoomCategories,
  });

  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState<RoomCategory | null>(null);
  const [form, setForm]         = useDraftForm("room-category-master", EMPTY, { skip: !!editing });
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<RoomCategory | null>(null);

  useEffect(() => {
    if (form.categoryName || form.alias) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit   = (r: RoomCategory) => {
    setEditing(r);
    setForm({ categoryName: r.categoryName, alias: r.alias, sortOrder: String(r.sortOrder ?? 0), isActive: !!r.isActive });
    setOpen(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["room-categories"] });

  const handleSave = async () => {
    if (!form.categoryName.trim()) { toast.error("Category Name is required"); return; }
    if (!form.alias.trim()) { toast.error("Alias is required"); return; }
    setSaving(true);
    try {
      const payload = {
        categoryName: form.categoryName.trim(),
        alias: form.alias.trim(),
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        isActive: form.isActive,
      };
      if (editing) {
        await updateRoomCategory(editing.id, payload);
        toast.success("Category updated");
      } else {
        await createRoomCategory(payload);
        toast.success("Category created");
      }
      await invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: RoomCategory) => {
    try {
      await deleteRoomCategory(r.id);
      toast.success("Category deactivated — existing compositions are untouched");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const reactivate = async (r: RoomCategory) => {
    try {
      await updateRoomCategory(r.id, { categoryName: r.categoryName, alias: r.alias, sortOrder: r.sortOrder, isActive: true });
      toast.success("Category reactivated");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const columns: ColumnDef<RoomCategory, unknown>[] = [
    {
      id: "sortOrder",
      header: "Order",
      cell: ({ row }) => <span className="text-xs text-muted-foreground font-mono">{row.original.sortOrder}</span>,
    },
    {
      id: "alias",
      header: "Alias (shown in dropdowns)",
      cell: ({ row }) => <span className="font-medium">{row.original.alias}</span>,
    },
    {
      id: "categoryName",
      header: "Category Name (internal)",
      cell: ({ row }) => <span className="text-muted-foreground text-xs font-mono">{row.original.categoryName}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-border inline-block" />Inactive
          </span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-1">
            {rights.canEdit && (
              <button
                onClick={() => openEdit(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
            )}
            {rights.canDelete && r.isActive && (
              <button
                onClick={() => setDeleting(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Deactivate"
              >
                <Trash2 size={13} />
              </button>
            )}
            {rights.canEdit && !r.isActive && (
              <button
                onClick={() => reactivate(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors"
                title="Reactivate"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 placeholder:text-muted-foreground";

  return (
    <CivilWorkDprShell
      title="Room Category Master"
      subtitle="Manage the room types used across every Unit's room composition"
      icon={Tags}
      action={
        rights.canCreate ? (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} /> New Category
          </button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Room Category Master" }]} />

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <DataTable columns={columns} data={categories} loading={isLoading} emptyMessage="No room categories found. Add one to get started." />
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Room Category" : "New Room Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Alias (shown to users) <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Master Bedroom"
                value={form.alias}
                onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Category Name (internal reference) <span className="text-red-500">*</span>
              </label>
              <input
                className={`${inputCls} font-mono`}
                placeholder="e.g. MASTER_BEDROOM"
                value={form.categoryName}
                onChange={(e) => setForm((p) => ({ ...p, categoryName: e.target.value }))}
                disabled={!!editing}
              />
              <p className="text-[11px] text-muted-foreground">
                {editing
                  ? "Kept stable once set — only the Alias above should normally change."
                  : "Used internally; auto-uppercased. Renaming the Alias later never breaks anything already saved."}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Sort Order
              </label>
              <input
                type="number"
                className={inputCls}
                value={form.sortOrder}
                onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive categories won't appear in the composition builder or Work Done</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${form.isActive ? "bg-emerald-500" : "bg-muted"}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${form.isActive ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? "Saving…" : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} /> Deactivate Category
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Deactivate <strong>{deleting?.alias}</strong>? Existing room compositions that already use it stay exactly as they are — this only hides it from new selections.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeleting(null)} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={() => deleting && handleDelete(deleting)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
            >
              Deactivate
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CivilWorkDprShell>
  );
}
