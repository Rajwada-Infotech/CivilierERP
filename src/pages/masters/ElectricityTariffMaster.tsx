import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getElectricityTariffs,
  getElectricityTariff,
  createElectricityTariff,
  updateElectricityTariff,
  getElectricityProviders,
  type ElectricityTariff,
} from "@/api/electricityMaintenanceApi";

const PAGE_KEY = "electricity-tariff-master";
const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const fieldCls = "w-full px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 text-foreground";
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const fmt = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

export default function ElectricityTariffMaster() {
  const rights = usePageRights(PAGE_KEY);
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ["electricity-tariffs"], queryFn: getElectricityTariffs });
  const rows: ElectricityTariff[] = Array.isArray(data) ? data : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Electricity Tariff Master"]} />
      <MaintenanceShell
        title="Electricity Tariff Master"
        subtitle="Slab-wise electricity rates by provider — never hard-coded"
        icon={Receipt}
        action={
          rights.canCreate && (
            <button onClick={() => { setEditingId(null); setFormOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white">
              <Plus size={13} /> Add Tariff
            </button>
          )
        }
      >
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-red-500">Failed to load tariffs.</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No tariffs configured yet.</div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Provider</th>
                  <th className="text-left px-4 py-2.5">Tariff Name</th>
                  <th className="text-left px-4 py-2.5">Effective From</th>
                  <th className="text-left px-4 py-2.5">Effective To</th>
                  <th className="text-left px-4 py-2.5">Billing Cycle</th>
                  <th className="text-left px-4 py-2.5">Slabs</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={t.Id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium text-foreground">{t.ProviderName}</td>
                    <td className="px-4 py-2.5">{t.TariffName}</td>
                    <td className="px-4 py-2.5">{fmtDate(t.EffectiveFrom)}</td>
                    <td className="px-4 py-2.5">{fmtDate(t.EffectiveTo)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.BillingCycle}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.SlabCount}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${t.Status === "Active" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-muted border-border text-muted-foreground"}`}>{t.Status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {rights.canEdit && (
                          <button onClick={() => { setEditingId(t.Id); setFormOpen(true); }} title="Edit" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MaintenanceShell>

      {formOpen && (
        <TariffFormDialog
          tariffId={editingId}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); queryClient.invalidateQueries({ queryKey: ["electricity-tariffs"] }); }}
        />
      )}
    </>
  );
}

interface SlabDraft { slabFrom: string; slabTo: string; ratePerUnit: string }

function TariffFormDialog({ tariffId, onClose, onSaved }: { tariffId: number | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = tariffId !== null;
  const [providerId, setProviderId] = useState("");
  const [tariffName, setTariffName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [billingCycle, setBillingCycle] = useState("Monthly");
  const [fixedCharge, setFixedCharge] = useState("0");
  const [minimumCharge, setMinimumCharge] = useState("0");
  const [additionalCharge, setAdditionalCharge] = useState("0");
  const [status, setStatus] = useState("Active");
  const [slabs, setSlabs] = useState<SlabDraft[]>([{ slabFrom: "0", slabTo: "", ratePerUnit: "" }]);
  const [saving, setSaving] = useState(false);

  const { data: providers } = useQuery({ queryKey: ["electricity-providers"], queryFn: getElectricityProviders });
  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["electricity-tariff", tariffId],
    queryFn: () => getElectricityTariff(tariffId!),
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (existing) {
      setProviderId(String(existing.ProviderId));
      setTariffName(existing.TariffName);
      setEffectiveFrom(existing.EffectiveFrom?.slice(0, 10) || "");
      setEffectiveTo(existing.EffectiveTo?.slice(0, 10) || "");
      setBillingCycle(existing.BillingCycle);
      setFixedCharge(String(existing.FixedCharge));
      setMinimumCharge(String(existing.MinimumCharge));
      setAdditionalCharge(String(existing.AdditionalCharge));
      setStatus(existing.Status);
      setSlabs((existing.slabs || []).map((s) => ({ slabFrom: String(s.SlabFrom), slabTo: s.SlabTo === null ? "" : String(s.SlabTo), ratePerUnit: String(s.RatePerUnit) })));
    }
  }, [existing]);

  const updateSlab = (i: number, patch: Partial<SlabDraft>) => setSlabs((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSlab = () => setSlabs((prev) => [...prev, { slabFrom: prev.length ? prev[prev.length - 1].slabTo || "" : "0", slabTo: "", ratePerUnit: "" }]);
  const removeSlab = (i: number) => setSlabs((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!providerId) { toast.error("Provider is required"); return; }
    if (!tariffName.trim()) { toast.error("Tariff Name is required"); return; }
    if (!effectiveFrom) { toast.error("Effective From is required"); return; }
    const parsedSlabs = slabs.map((s) => ({
      slabFrom: Number(s.slabFrom), slabTo: s.slabTo === "" ? null : Number(s.slabTo), ratePerUnit: Number(s.ratePerUnit),
    }));
    if (parsedSlabs.length === 0 || parsedSlabs.some((s) => Number.isNaN(s.slabFrom) || Number.isNaN(s.ratePerUnit))) {
      toast.error("Every slab needs a valid From unit and rate");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        providerId: Number(providerId), tariffName: tariffName.trim(), effectiveFrom, effectiveTo: effectiveTo || null,
        billingCycle, fixedCharge: Number(fixedCharge) || 0, minimumCharge: Number(minimumCharge) || 0,
        additionalCharge: Number(additionalCharge) || 0, status, slabs: parsedSlabs,
      };
      if (isEdit) {
        await updateElectricityTariff(tariffId!, payload);
        toast.success("Tariff updated");
      } else {
        await createElectricityTariff(payload);
        toast.success("Tariff created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save tariff");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading text-base">{isEdit ? "Edit Tariff" : "Add Tariff"}</DialogTitle></DialogHeader>
        {isEdit && loadingExisting ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Provider</label>
                <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={fieldCls}>
                  <option value="">Select provider…</option>
                  {(providers || []).map((p) => (<option key={p.Id} value={p.Id}>{p.Name}</option>))}
                </select>
              </div>
              <div><label className={labelCls}>Tariff Name</label><input value={tariffName} onChange={(e) => setTariffName(e.target.value)} className={fieldCls} /></div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Effective From</label><input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={fieldCls} /></div>
              <div><label className={labelCls}>Effective To</label><input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className={fieldCls} /></div>
              <div>
                <label className={labelCls}>Billing Cycle</label>
                <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className={fieldCls}>
                  <option value="Monthly">Monthly</option>
                  <option value="3 Monthly">3 Monthly</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Fixed Charge (₹)</label><input type="number" value={fixedCharge} onChange={(e) => setFixedCharge(e.target.value)} className={fieldCls} /></div>
              <div><label className={labelCls}>Minimum Charge (₹)</label><input type="number" value={minimumCharge} onChange={(e) => setMinimumCharge(e.target.value)} className={fieldCls} /></div>
              <div><label className={labelCls}>Additional Charge (₹)</label><input type="number" value={additionalCharge} onChange={(e) => setAdditionalCharge(e.target.value)} className={fieldCls} /></div>
            </div>

            {isEdit && (
              <div>
                <label className={labelCls}>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldCls}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls} style={{ marginBottom: 0 }}>Slabs</label>
                <button onClick={addSlab} type="button" className="text-xs font-heading font-medium text-primary hover:underline">+ Add Slab</button>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">From (units)</th>
                      <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">To (units, blank = open-ended)</th>
                      <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">Rate / Unit (₹)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {slabs.map((s, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1.5"><input type="number" value={s.slabFrom} onChange={(e) => updateSlab(i, { slabFrom: e.target.value })} className="w-full bg-transparent border border-border rounded px-2 py-1 text-foreground" /></td>
                        <td className="px-2 py-1.5"><input type="number" value={s.slabTo} onChange={(e) => updateSlab(i, { slabTo: e.target.value })} placeholder="open-ended" className="w-full bg-transparent border border-border rounded px-2 py-1 text-foreground" /></td>
                        <td className="px-2 py-1.5"><input type="number" step="0.01" value={s.ratePerUnit} onChange={(e) => updateSlab(i, { ratePerUnit: e.target.value })} className="w-full bg-transparent border border-border rounded px-2 py-1 text-foreground" /></td>
                        <td className="px-1 py-1.5 text-center">
                          {slabs.length > 1 && (
                            <button onClick={() => removeSlab(i)} type="button" className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">e.g. 0–100 units @ ₹5/unit, 100–200 units @ ₹7/unit, 200+ units @ ₹9/unit.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
                {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
