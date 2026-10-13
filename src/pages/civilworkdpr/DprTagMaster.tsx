import { useMemo, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getDprTags, createDprTag, updateDprTag, deleteDprTag, type DprTag } from "@/api/dprTagMasterApi";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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
      cell: ({ row }) => (
        <span className={`font-heading text-xs font-semibold tabular-nums ${row.original.activityCount ? "text-foreground" : "text-muted-foreground/50"}`}>{row.original.activityCount}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>,
    },
    { id: "createdBy", header: "Created By", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.createdBy ?? "—"}</span> },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {rights.canEdit && (
            <button onClick={() => openEdit(row.original)} className={ACT} title="Edit" aria-label="Edit">
              <Edit2 size={13} />
            </button>
          )}
          {rights.canDelete && (
            <button onClick={() => remove(row.original)} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors" title="Delete" aria-label="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const inputCls = "w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60";

  return (
    <>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "DPR Tag Master" }]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="DPR tags"
        subtitle="Tags that group activities for reporting. A new tag typed on an activity in Activity Master lands here by itself."
        action={
          rights.canCreate ? (
            <button onClick={openCreate} className={`${KEY} px-4 py-2 bg-foreground text-card border border-foreground`}>
              <Plus size={13} /> New tag
            </button>
          ) : undefined
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Tags", value: tags.length, note: "in all" },
              { label: "Active", value: tags.filter((x) => x.isActive).length, note: "offered in the tag picker" },
              { label: "In use", value: tags.filter((x) => x.activityCount > 0).length, note: "on at least one activity" },
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5">
              <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Tags</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{shown.length}</span>
            </p>
            <div className="relative w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tags…"
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          </div>
          <DataTable columns={columns} data={shown} loading={isLoading} emptyMessage="No tags yet. Add one, or type a new tag on an activity." />
        </div>
      </SheetShell>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sheet-frame max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>DPR tag</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{editing ? "Edit tag" : "New tag"}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Tag name <span className="text-destructive">*</span>
              </label>
              <input className={inputCls} maxLength={100} placeholder="e.g. Structure" value={name} onChange={(e) => setName(e.target.value)} />
              {editing && editing.activityCount > 0 && (
                <p className="text-[0.6875rem] text-muted-foreground">
                  Renaming updates all {editing.activityCount} activit{editing.activityCount === 1 ? "y" : "ies"} using this tag, and the Tag-Wise report.
                </p>
              )}
            </div>
            {editing && (
              <div className="flex items-center justify-between gap-3 border border-foreground/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive tags are hidden from the activity tag picker</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((v) => !v)}
                  aria-pressed={isActive}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${isActive ? "bg-foreground" : "bg-muted-foreground/30"}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-card transform transition-transform ${isActive ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button onClick={() => setOpen(false)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>Cancel</button>
              <button onClick={save} disabled={saving} className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}>
                {saving ? "Saving…" : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
