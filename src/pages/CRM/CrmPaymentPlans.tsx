import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/payment-plans";

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmPaymentPlans: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState([{ MilestoneName: "Booking", Percent: "" }]);
  const [saving, setSaving] = useState(false);

  const { data: plans = [], isLoading } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchAll, staleTime: 30_000 });

  const totalPct = items.reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);

  const handleCreate = async () => {
    if (!planName.trim()) { toast.error("Plan name is required"); return; }
    if (Math.round(totalPct * 100) !== 10000) { toast.error(`Percentages must sum to 100 (currently ${totalPct})`); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PlanName: planName, Description: description, Items: items }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Payment plan created");
      setDialogOpen(false);
      setPlanName(""); setDescription(""); setItems([{ MilestoneName: "Booking", Percent: "" }]);
      qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Payment Plan Master"
      subtitle="Reusable milestone templates, applied per application/booking"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Plan
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : plans.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No payment plans defined</div>
        ) : (plans as any[]).map((p: any) => (
          <div key={p.Id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{p.PlanName}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${p.IsActive ? "text-green-600 bg-green-50 border-green-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
                {p.IsActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{p.Description || "—"}</p>
            <div className="text-xs text-muted-foreground">{p.ItemCount} milestone(s) · {p.TotalPercent}% total</div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">New Payment Plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Plan Name *</label>
              <input type="text" value={planName} onChange={(e) => setPlanName(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Milestones (must total 100%)</label>
                <span className={`text-xs font-medium ${Math.round(totalPct * 100) === 10000 ? "text-green-600" : "text-red-600"}`}>{totalPct}%</span>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input type="text" placeholder="Milestone name" value={it.MilestoneName}
                      onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, MilestoneName: e.target.value } : x))}
                      className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background" />
                    <input type="number" placeholder="%" value={it.Percent}
                      onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, Percent: e.target.value } : x))}
                      className="w-20 text-sm border border-border rounded px-2 py-1.5 bg-background" />
                    <button onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}
                      className="p-1.5 text-muted-foreground hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => setItems((arr) => [...arr, { MilestoneName: "", Percent: "" }])}
                className="text-xs text-primary hover:underline mt-2">+ Add milestone</button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDialogOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmPaymentPlans;
