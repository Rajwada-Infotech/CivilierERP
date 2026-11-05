import { useEffect, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateRoomData } from "@/lib/roomQueries";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, RotateCcw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getRoomCategories, createRoomCategory, updateRoomCategory, deleteRoomCategory, getRoomCategoryUsage, getRoomCategoryRenameCount,
  type RoomCategory,
} from "@/api/roomCategoryMasterApi";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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

  // Renaming the Alias can rename the category's existing rooms too.
  const [renameRooms, setRenameRooms] = useState(true);
  const aliasChanged = !!editing && form.alias.trim() !== "" && form.alias.trim() !== editing.alias;
  const { data: renameCount } = useQuery({
    queryKey: ["room-category-rename-count", editing?.id],
    queryFn: () => getRoomCategoryRenameCount(editing!.id),
    enabled: aliasChanged,
  });

  // Usage of the category being deactivated, for the confirm dialog.
  const { data: deletingUsage, isLoading: loadingUsage } = useQuery({
    queryKey: ["room-category-usage", deleting?.id],
    queryFn: () => getRoomCategoryUsage(deleting!.id),
    enabled: !!deleting,
  });

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
        const r = await updateRoomCategory(editing.id, { ...payload, renameRooms: aliasChanged && renameRooms });
        toast.success(r.roomsRenamed ? `Category updated — ${r.roomsRenamed} room(s) renamed` : "Category updated");
        if (r.roomsRenamed) invalidateRoomData(qc);
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
      cell: ({ row }) => <span className="font-heading text-xs tabular-nums text-muted-foreground">{row.original.sortOrder}</span>,
    },
    {
      id: "alias",
      header: "Alias (shown in dropdowns)",
      cell: ({ row }) => <span className={`font-medium ${row.original.isActive ? "text-foreground" : "text-muted-foreground"}`}>{row.original.alias}</span>,
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
        row.original.isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>,
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
                className={ACT}
                title="Edit" aria-label="Edit"
              >
                <Edit2 size={13} />
              </button>
            )}
            {rights.canDelete && r.isActive && (
              <button
                onClick={() => setDeleting(r)}
                className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                title="Deactivate" aria-label="Deactivate"
              >
                <Trash2 size={13} />
              </button>
            )}
            {rights.canEdit && !r.isActive && (
              <button
                onClick={() => reactivate(r)}
                className={ACT}
                title="Reactivate" aria-label="Reactivate"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const inputCls = "w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-60";

  const active = categories.filter((c) => c.isActive).length;

  return (
    <>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Room Master" }]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Room types"
        subtitle="The room types every unit's room composition is counted in. The alias is what people see; the category name stays fixed underneath."
        action={
          rights.canCreate ? (
            <button onClick={openCreate} className={`${KEY} px-4 py-2 bg-foreground text-card border border-foreground`}>
              <Plus size={13} /> New room type
            </button>
          ) : undefined
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Room types", value: categories.length, note: "in all" },
              { label: "Active", value: active, note: "offered in layouts and Work Allocation" },
              { label: "Inactive", value: categories.length - active, note: "kept where already used" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <DataTable columns={columns} data={categories} loading={isLoading} emptyMessage="No room types yet. Add one to get started." />
        </div>
      </SheetShell>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sheet-frame max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Room type</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{editing ? "Edit room type" : "New room type"}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Alias (shown to users) <span className="text-destructive">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Master Bedroom"
                value={form.alias}
                onChange={(e) => setForm((p) => ({ ...p, alias: e.target.value }))}
              />
              {aliasChanged && (renameCount?.rooms ?? 0) > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="accent-foreground" checked={renameRooms} onChange={(e) => setRenameRooms(e.target.checked)} />
                  Also rename {renameCount!.rooms} existing room(s) from "{editing!.alias}" to "{form.alias.trim()}" (Flat Master history stays attached)
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Category Name (internal reference) <span className="text-destructive">*</span>
              </label>
              <input
                className={`${inputCls} font-mono`}
                placeholder="e.g. MASTER_BEDROOM"
                value={form.categoryName}
                onChange={(e) => setForm((p) => ({ ...p, categoryName: e.target.value }))}
                disabled={!!editing}
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                {editing
                  ? "Kept stable once set — only the Alias above should normally change."
                  : "Used internally; auto-uppercased. Renaming the Alias later never breaks anything already saved."}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Sort Order
              </label>
              <input
                type="number"
                className={inputCls}
                value={form.sortOrder}
                onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border border-foreground/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Inactive categories won't appear in the composition builder or Work Allocation</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}
                aria-pressed={form.isActive}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.isActive ? "bg-foreground" : "bg-muted-foreground/30"}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-card transform transition-transform ${form.isActive ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button
                onClick={() => setOpen(false)}
                className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}
              >
                {saving ? "Saving…" : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="sheet-frame max-w-sm" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Room type</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Deactivate {deleting?.alias}</DialogTitle>
            </div>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Deactivate <strong>{deleting?.alias}</strong>? It is only hidden from new selections — layouts, layout overrides and rooms that already use it keep it exactly as they are.
          </p>
          <p className="text-xs text-muted-foreground">
            {loadingUsage ? "Checking where it is used…" : deletingUsage
              ? `In use: ${deletingUsage.layouts} layout(s), ${deletingUsage.overrides} layout override(s), ${deletingUsage.rooms} room(s).`
              : null}
          </p>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={() => setDeleting(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
              Cancel
            </button>
            <button
              onClick={() => deleting && handleDelete(deleting)}
              className={`${KEY} h-9 px-5 bg-destructive text-destructive-foreground border border-destructive`}
            >
              Deactivate
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
