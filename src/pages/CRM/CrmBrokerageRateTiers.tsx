import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Pencil, Percent, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/brokerage-rate-tiers";

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
const fmt = (n: number | null) => n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

// The default commission-rate brackets tierBrokeragePercent (in
// crmWorkflowGuards.js) falls back to when Application/Booking staff don't
// type an explicit commission override % — used to be hardcoded JS
// constants (2% under 1Cr, 1% at 1Cr+), now this real, editable table.
const CrmBrokerageRateTiers: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [minVal, setMinVal] = useState("");
  const [maxVal, setMaxVal] = useState("");
  const [rate, setRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const inputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

  const { data: tiers = [], isLoading } = useQuery({ queryKey: ["crm-brokerage-rate-tiers-master"], queryFn: fetchAll, staleTime: 30_000 });

  const resetForm = () => {
    setEditingId(null);
    setMinVal(""); setMaxVal(""); setRate("");
    setLocked(false);
    setIsActive(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.Id);
    setMinVal(String(t.MinDealValue));
    setMaxVal(t.MaxDealValue != null ? String(t.MaxDealValue) : "");
    setRate(String(t.RatePercent));
    setIsActive(t.IsActive !== false && t.IsActive !== 0);
    setLocked(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (minVal === "" || rate === "") { toast.error("Min Deal Value and Rate % are required"); return; }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MinDealValue: minVal, MaxDealValue: maxVal === "" ? null : maxVal,
          RatePercent: rate, IsActive: isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(isEdit ? "Tier updated" : "Tier created");
      setDialogOpen(false);
      setLocked(true);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers-master"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this tier? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Tier deleted");
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers-master"] });
      qc.invalidateQueries({ queryKey: ["crm-brokerage-rate-tiers"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { id: "range", header: "Deal Value Range", size: 220,
      cell: (i) => (
        <span className="font-mono text-xs">{fmt(i.row.original.MinDealValue)} — {i.row.original.MaxDealValue != null ? fmt(i.row.original.MaxDealValue) : "and above"}</span>
      ) },
    { accessorKey: "RatePercent", header: "Rate %", size: 100,
      cell: (i) => <span className="font-semibold flex items-center gap-1"><Percent size={12} className="text-primary" /> {i.row.original.RatePercent}%</span> },
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
    <SalesAutoShell
      title="CRM — Brokerage Rate Tiers"
      subtitle="Default commission % by deal value — only applies when Application/Booking staff don't type an explicit override"
      action={
        <button onClick={() => { resetForm(); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Tier
        </button>
      }
    >
      <DataTable
        data={tiers as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No rate tiers defined — the fallback default is 2%"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span>{editingId != null ? "Edit Tier" : "New Tier"}</span>
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
              <label className="text-xs text-muted-foreground block mb-1">Min Deal Value (₹) *</label>
              <input type="number" value={minVal} readOnly={locked} onChange={(e) => setMinVal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Max Deal Value (₹) — leave blank for no upper bound</label>
              <input type="number" value={maxVal} readOnly={locked} onChange={(e) => setMaxVal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Rate % *</label>
              <input type="number" step="0.01" min="0" max="10" value={rate} readOnly={locked} onChange={(e) => setRate(e.target.value)} className={inputCls} />
            </div>
            <div className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${locked ? "opacity-70" : ""}`}>
              <div>
                <div className="text-xs font-medium text-foreground">Status</div>
                <p className="text-[11px] text-muted-foreground">
                  {isActive ? "Active — used by the fallback rate lookup." : "Inactive — skipped, kept for history."}
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
    </SalesAutoShell>
  );
};

export default CrmBrokerageRateTiers;
