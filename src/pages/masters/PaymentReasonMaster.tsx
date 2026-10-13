import { useEffect, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2, RotateCcw, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getPaymentReasons, createPaymentReason, updatePaymentReason, deletePaymentReason,
  permanentlyDeletePaymentReason,
  type PaymentReason,
} from "@/api/paymentReasonApi";

const EMPTY = { name: "", description: "", isActive: true };

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const ACT_RED = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors";

export default function PaymentReasonMaster() {
  const rights = usePageRights("payment-reason-master");
  const qc = useQueryClient();

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["payment-reasons"],
    queryFn: getPaymentReasons,
  });

  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState<PaymentReason | null>(null);
  // This form only exists inside a Dialog, so a refresh closes it
  // regardless — persisting values alone wouldn't be visible again until
  // the dialog reopens. Rehydrate + reopen together (mount effect below).
  const [form, setForm]         = useDraftForm("payment-reason-master", EMPTY, { skip: !!editing });
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<PaymentReason | null>(null);
  const [purging, setPurging]   = useState<PaymentReason | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);

  useEffect(() => {
    if (form.name || form.description) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <SheetMark text={row.original.isActive ? "Active" : "Inactive"} tone={row.original.isActive ? "done" : "none"} />,
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
                className={ACT}
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
            )}
            {rights.canDelete && (
              <button
                onClick={() => setPurging(r)}
                className={ACT_RED}
                title="Delete permanently"
              >
                <Trash2 size={13} />
              </button>
            )}
            {rights.canDelete && r.isActive && (
              <button
                onClick={() => setDeleting(r)}
                className={ACT_RED}
                title="Deactivate"
              >
                <X size={13} />
              </button>
            )}
            {rights.canEdit && !r.isActive && (
              <button
                onClick={() => reactivate(r)}
                className={ACT}
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

  const inputCls = "w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60";

  return (
    <>
      <Breadcrumbs items={[{ label: "Finance", path: "/finance" }, { label: "Payment Reason Master" }]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Payment reasons"
        subtitle="The standard reasons offered when a payment is recorded."
        action={
          rights.canCreate ? (
            <button onClick={openCreate} className={`${KEY} px-4 py-2 bg-foreground text-card border border-foreground`}>
              <Plus size={13} /> New reason
            </button>
          ) : undefined
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Reasons", value: reasons.length, note: "in all" },
              { label: "Active", value: reasons.filter((r) => r.isActive).length, note: "offered when recording a payment" },
              { label: "Inactive", value: reasons.filter((r) => !r.isActive).length, note: "hidden from the list" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          <DataTable columns={columns} data={reasons} loading={isLoading} emptyMessage="No payment reasons found. Add one to get started." />
        </div>
      </SheetShell>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sheet-frame max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Payment reason</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{editing ? "Edit reason" : "New reason"}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Reason <span className="text-destructive">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. Advance against material"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Description
              </label>
              <textarea
                className={`${inputCls} resize-none h-20`}
                placeholder="Optional description…"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border border-foreground/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive reasons won't appear in dropdowns</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}
                aria-pressed={form.isActive}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none shrink-0 ${form.isActive ? "bg-foreground" : "bg-muted-foreground/30"}`}
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
        <DialogContent className="sheet-frame max-w-sm" style={{ margin: 0, border: "1.5px solid hsl(var(--destructive))" }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight text-foreground">Deactivate reason</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1 leading-relaxed">
            Deactivate <strong>{deleting?.name}</strong>? It will no longer appear in payment reason dropdowns.
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <button onClick={() => setDeleting(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
              Cancel
            </button>
            <button
              onClick={() => deleting && handleDelete(deleting)}
              className={`${KEY} h-9 px-4 bg-destructive text-destructive-foreground border border-destructive`}
            >
              Deactivate
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Permanent delete confirm dialog */}
      <Dialog open={!!purging} onOpenChange={() => !purgeBusy && setPurging(null)}>
        <DialogContent className="sheet-frame max-w-sm" style={{ margin: 0, border: "1.5px solid hsl(var(--destructive))" }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight text-foreground">Permanently delete reason</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1 leading-relaxed">
            This will permanently remove <strong>{purging?.name}</strong> from the database. This
            cannot be undone. If it's already used by existing payments, deletion will be blocked —
            use Deactivate instead.
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <button
              onClick={() => setPurging(null)}
              disabled={purgeBusy}
              className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
            >
              Cancel
            </button>
            <button
              onClick={() => purging && handlePurge(purging)}
              disabled={purgeBusy}
              className={`${KEY} h-9 px-4 bg-destructive text-destructive-foreground border border-destructive`}
            >
              {purgeBusy ? "Deleting…" : "Delete Permanently"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
