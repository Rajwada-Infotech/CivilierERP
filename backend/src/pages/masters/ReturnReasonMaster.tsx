import { useEffect, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getReturnReasons, createReturnReason, updateReturnReason, deleteReturnReason,
  type ReturnReason,
} from "@/api/returnReasonApi";

const EMPTY = { name: "", description: "", isActive: true };

export default function ReturnReasonMaster() {
  const rights = usePageRights("return-reason-master");
  const qc = useQueryClient();

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["return-reasons"],
    queryFn: getReturnReasons,
  });

  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState<ReturnReason | null>(null);
  // This form only exists inside a Dialog (unlike the other masters' always-
  // visible inline forms), so a refresh closes it regardless — persisting
  // the values alone wouldn't be visible again until the dialog reopens.
  // Rehydrate + reopen together (see the mount effect below) so a refresh
  // mid-typing actually shows the restored draft, not just silently keeps
  // it in localStorage.
  const [form, setForm]         = useDraftForm("return-reason-master", EMPTY, { skip: !!editing });
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<ReturnReason | null>(null);

  useEffect(() => {
    if (form.name || form.description) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit   = (r: ReturnReason) => {
    setEditing(r);
    setForm({ name: r.name, description: r.description ?? "", isActive: !!r.isActive });
    setOpen(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["return-reasons"] });

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Reason Name is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateReturnReason(editing.id, { name: form.name.trim(), description: form.description.trim(), isActive: form.isActive });
        toast.success("Reason updated");
      } else {
        await createReturnReason({ name: form.name.trim(), description: form.description.trim(), isActive: form.isActive });
        toast.success("Reason created");
      }
      await invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: ReturnReason) => {
    try {
      await deleteReturnReason(r.id);
      toast.success("Reason deactivated");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const reactivate = async (r: ReturnReason) => {
    try {
      await updateReturnReason(r.id, { name: r.name, description: r.description ?? "", isActive: true });
      toast.success("Reason reactivated");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const columns: ColumnDef<ReturnReason, unknown>[] = [
    {
      id: "name",
      header: "Reason Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs max-w-xs block truncate">
          {row.original.description || "—"}
        </span>
      ),
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

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

  return (
    <FinanceShell
      title="Return Reason Master"
      subtitle="Manage cheque return / bounce reasons for BRS reconciliation"
      action={
        rights.canCreate ? (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} /> New Reason
          </button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Finance", path: "/finance" }, { label: "Return Reason Master" }]} />

      <DataTable columns={columns} data={reasons} loading={isLoading} emptyMessage="No return reasons found. Add one to get started." />

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Return Reason" : "New Return Reason"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Reason Name <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Insufficient Funds"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Reason Description
              </label>
              <textarea
                className={`${inputCls} resize-none h-20`}
                placeholder="Optional description…"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive reasons won't appear in dropdowns</p>
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
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
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
              <AlertTriangle size={16} /> Deactivate Reason
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Deactivate <strong>{deleting?.name}</strong>? It will no longer appear in the BRS bounce reason dropdown.
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
    </FinanceShell>
  );
}
