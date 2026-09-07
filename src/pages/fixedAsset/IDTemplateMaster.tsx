import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, RotateCcw, AlertTriangle, Hash } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getIDTemplates, createIDTemplate, updateIDTemplate, deleteIDTemplate,
  type IDTemplate,
} from "@/api/idTemplateMasterApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const EMPTY = { projectId: "", projectAlias: "", isActive: true };

export default function IDTemplateMaster() {
  const rights = usePageRights("id-template-master");
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["id-templates"],
    queryFn: getIDTemplates,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IDTemplate | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<IDTemplate | null>(null);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (r: IDTemplate) => {
    setEditing(r);
    setForm({ projectId: String(r.projectId), projectAlias: r.projectAlias, isActive: r.isActive });
    setOpen(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["id-templates"] });

  const handleSave = async () => {
    if (!form.projectId) { toast.error("Project is required"); return; }
    if (!form.projectAlias.trim()) { toast.error("Project Alias is required"); return; }
    setSaving(true);
    try {
      const payload = {
        projectId: Number(form.projectId),
        projectAlias: form.projectAlias.trim(),
        isActive: form.isActive,
      };
      if (editing) {
        await updateIDTemplate(editing.id, payload);
        toast.success("ID template updated");
      } else {
        await createIDTemplate(payload);
        toast.success("ID template created");
      }
      await invalidate();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: IDTemplate) => {
    try {
      await deleteIDTemplate(r.id);
      toast.success("ID template deactivated");
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const reactivate = async (r: IDTemplate) => {
    try {
      await updateIDTemplate(r.id, { projectId: r.projectId, projectAlias: r.projectAlias, isActive: true });
      toast.success("ID template reactivated");
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const columns: ColumnDef<IDTemplate, unknown>[] = [
    {
      id: "projectName",
      header: "Project",
      cell: ({ row }) => <span className="font-medium">{row.original.projectName || "—"}</span>,
    },
    {
      id: "projectAlias",
      header: "Project Alias",
      cell: ({ row }) => <span className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400">{row.original.projectAlias}</span>,
    },
    {
      id: "sample",
      header: "Sample FA Item Code",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.projectAlias}/ItemName/0001/26-27</span>,
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
              <button onClick={() => openEdit(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                <Edit2 size={13} />
              </button>
            )}
            {rights.canDelete && r.isActive && (
              <button onClick={() => setDeleting(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Deactivate">
                <Trash2 size={13} />
              </button>
            )}
            {rights.canEdit && !r.isActive && (
              <button onClick={() => reactivate(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors" title="Reactivate">
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 placeholder:text-muted-foreground";

  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "ID Template Master"]} />
    <GlassShell
      title="ID Template Master"
      subtitle="Configure the Project Alias used to build FA Item Codes"
      icon={Hash}
      accentColor="#eab308"
      action={
        rights.canCreate ? (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 text-white hover:opacity-90 transition-opacity">
            <Plus size={14} /> New Template
          </button>
        ) : undefined
      }
    >
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <DataTable columns={columns} data={templates} loading={isLoading} emptyMessage="No ID templates configured yet. Add one per project to enable FA Inventory code generation." />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit ID Template" : "New ID Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Project <span className="text-red-500">*</span>
              </label>
              <select className={inputCls} value={form.projectId}
                onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}>
                <option value="">Select project…</option>
                {ensureArray<{ id: number; label: string }>(projects).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Project Alias <span className="text-red-500">*</span>
              </label>
              <input className={`${inputCls} font-mono`} placeholder="e.g. RG"
                value={form.projectAlias}
                onChange={(e) => setForm((p) => ({ ...p, projectAlias: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">
                Used as the first segment of every generated FA Item Code for this project, e.g. <span className="font-mono">RG/Laptop/0001/26-27</span>.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive templates block new code generation for this project</p>
              </div>
              <button type="button" onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${form.isActive ? "bg-emerald-500" : "bg-muted"}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${form.isActive ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? "Saving…" : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} /> Deactivate Template
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Deactivate the alias <strong>{deleting?.projectAlias}</strong> for <strong>{deleting?.projectName}</strong>? Codes already generated stay exactly as they are — this only blocks new tagging for this project until re-activated.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeleting(null)} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={() => deleting && handleDelete(deleting)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity">
              Deactivate
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </GlassShell>
    </>
  );
}
