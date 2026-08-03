import { useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, RotateCcw, AlertTriangle, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getPaymentReasons, createPaymentReason, updatePaymentReason, deletePaymentReason,
  permanentlyDeletePaymentReason,
  type PaymentReason,
} from "@/api/paymentReasonApi";

const EMPTY = { name: "", description: "", isActive: true };

export default function PaymentReasonMaster() {
  const rights = usePageRights("payment-reason-master");
  const qc = useQueryClient();

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["payment-reasons"],
    queryFn: getPaymentReasons,
  });

  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState<PaymentReason | null>(null);
  const [form, setForm]         = useState(EMPTY);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<PaymentReason | null>(null);
  const [purging, setPurging]   = useState<PaymentReason | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit   = (r: PaymentReason) => {
    setEditing(r);
    setForm({ name: r.name, description: r.description ?? "", isActive: !!r.isActive });
    setOpen(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["payment-reasons"] });

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Reason is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updatePaymentReason(editing.id, { name: form.name.trim(), description: form.description.trim(), isActive: form.isActive });
        toast.success("Reason updated");
      } else {
        await createPaymentReason({ name: form.name.trim(), description: form.description.trim(), isActive: form.isActive });
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

  const handleDelete = async (r: PaymentReason) => {
    try {
      await deletePaymentReason(r.id);
      toast.success("Reason deactivated");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const handlePurge = async (r: PaymentReason) => {
    setPurgeBusy(true);
    try {
      await permanentlyDeletePaymentReason(r.id);
      toast.success("Reason permanently deleted");
      await invalidate();
      setPurging(null);
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    } finally {
      setPurgeBusy(false);
    }
  };

  const reactivate = async (r: PaymentReason) => {
    try {
      await updatePaymentReason(r.id, { name: r.name, description: r.description ?? "", isActive: true });
      toast.success("Reason reactivated");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const columns: ColumnDef<PaymentReason, unknown>[] = [
    {
      id: "name",
      header: "Reason",
      meta: { className: "w-[30%] sm:w-[26%]" },
      cell: ({ row }) => (
        <span className="font-medium truncate block">{row.original.name}</span>
      ),
    },
    {
      id: "description",
      header: "Description",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs block truncate">
          {row.original.description || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      meta: { className: "w-24 sm:w-28" },
      cell: ({ row }) =>
        row.original.isActive ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-border inline-block shrink-0" />Inactive
          </span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      meta: { className: "w-28" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {rights.canEdit && (
              <button
                onClick={() => openEdit(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
            )}
            {rights.canDelete && (
              <button
                onClick={() => setPurging(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete permanently"
              >
                <Trash2 size={13} />
              </button>
            )}
            {rights.canDelete && r.isActive && (
              <button
                onClick={() => setDeleting(r)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Deactivate"
              >
                <X size={13} />
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
      title="Payment Reason Master"
      subtitle="Manage the standard reasons used when recording a payment"
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
      <Breadcrumbs items={[{ label: "Finance", path: "/finance" }, { label: "Payment Reason Master" }]} />

      <DataTable columns={columns} data={reasons} loading={isLoading} emptyMessage="No payment reasons found. Add one to get started." />

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Payment Reason" : "New Payment Reason"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Reason <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Advance against material"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Description
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
            Deactivate <strong>{deleting?.name}</strong>? It will no longer appear in payment reason dropdowns.
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

      {/* Permanent delete confirm dialog */}
      <Dialog open={!!purging} onOpenChange={() => !purgeBusy && setPurging(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} /> Permanently Delete Reason
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This will permanently remove <strong>{purging?.name}</strong> from the database. This
            cannot be undone. If it's already used by existing payments, deletion will be blocked —
            use Deactivate instead.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPurging(null)}
              disabled={purgeBusy}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => purging && handlePurge(purging)}
              disabled={purgeBusy}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {purgeBusy ? "Deleting…" : "Delete Permanently"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </FinanceShell>
  );
}
