import { useMemo, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { preventEnterSubmit } from "@/hooks/useDraftForm";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, Search, Tags } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getDprTags, createDprTag, updateDprTag, deleteDprTag, type DprTag } from "@/api/dprTagMasterApi";

export default function DprTagMaster() {
  const rights = usePageRights("dpr-tag-master");
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useQuery({ queryKey: ["dpr-tags"], queryFn: getDprTags });

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DprTag | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tags.filter((t) => t.tagName.toLowerCase().includes(q)) : tags;
  }, [tags, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dpr-tags"] });

  const openCreate = () => { setEditing(null); setName(""); setIsActive(true); setOpen(true); };
  const openEdit = (t: DprTag) => { setEditing(t); setName(t.tagName); setIsActive(t.isActive); setOpen(true); };

  const save = async () => {
    if (!name.trim()) { toast.error("Tag name is required"); return; }
    setSaving(true);
    try {
      if (editing) await updateDprTag(editing.id, { tagName: name.trim(), isActive });
      else await createDprTag(name.trim());
      toast.success(editing ? "Tag updated" : "Tag added");
      await invalidate();
      qc.invalidateQueries({ queryKey: ["activities"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: DprTag) => {
    if (!window.confirm(`Delete tag "${t.tagName}"?`)) return;
    try {
      await deleteDprTag(t.id);
      toast.success("Tag deleted");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  };

  const columns: ColumnDef<DprTag, unknown>[] = [
    { id: "tagName", header: "Tag", cell: ({ row }) => <span className="font-medium">{row.original.tagName}</span> },
    {
      id: "activityCount",
      header: "Activities",
      cell: ({ row }) => <span className="text-xs text-muted-foreground tabular-nums">{row.original.activityCount}</span>,
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
    { id: "createdBy", header: "Created By", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.createdBy ?? "—"}</span> },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {rights.canEdit && (
            <button onClick={() => openEdit(row.original)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
              <Edit2 size={13} />
            </button>
          )}
          {rights.canDelete && (
            <button onClick={() => remove(row.original)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 placeholder:text-muted-foreground";

  return (
    <CivilWorkDprShell
      title="DPR Tag Master"
      subtitle="Tags that group Civil Work DPR activities — new tags typed in the Activity Master land here automatically"
      icon={Tags}
      action={
        rights.canCreate ? (
          <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium btn-module text-white hover:opacity-90 transition-opacity">
            <Plus size={14} /> New Tag
          </button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "DPR Tag Master" }]} />

      <div className="relative mb-3 max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags…" className={`${inputCls} pl-8`} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <DataTable columns={columns} data={shown} loading={isLoading} emptyMessage="No tags yet. Add one, or type a new tag on an activity." />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Tag" : "New Tag"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Tag Name <span className="text-red-500">*</span>
              </label>
              <input className={inputCls} maxLength={100} placeholder="e.g. Structure" value={name} onChange={(e) => setName(e.target.value)} />
              {editing && editing.activityCount > 0 && (
                <p className="text-[0.6875rem] text-muted-foreground">
                  Renaming updates all {editing.activityCount} activit{editing.activityCount === 1 ? "y" : "ies"} using this tag, and the Tag-Wise report.
                </p>
              )}
            </div>
            {editing && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive tags are hidden from the activity tag picker</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${isActive ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${isActive ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium btn-module text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? "Saving…" : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </CivilWorkDprShell>
  );
}
