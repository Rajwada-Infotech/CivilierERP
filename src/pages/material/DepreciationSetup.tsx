import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, X, Check, Percent, AlertCircle, Search,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getDepreciationSetups, createDepreciationSetup, updateDepreciationSetup, deleteDepreciationSetup,
  type DepreciationSetup, type DepreciationPayload,
} from "@/api/depreciationApi";

const ASSET_CATEGORIES = [
  "Laptop", "Desktop", "Mobile Phone", "Printer", "Scanner",
  "Furniture", "Vehicle", "Machinery", "Other",
];

const DEPRECIATION_TYPES = [
  { value: "SLM", label: "SLM — Straight Line Method" },
  { value: "WDV", label: "WDV — Written Down Value" },
];

const GOVT_RATES = [5, 10, 15, 20, 25, 30, 33.33, 40, 50, 60, 100];

const STATUS_COLORS: Record<string, string> = {
  Active:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Inactive: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const emptyForm = (): DepreciationPayload => ({
  assetCategory:    "",
  depreciationType: "SLM",
  depreciationRate: 15,
  effectiveFrom:    new Date().toISOString().slice(0, 10),
  status:           "Active",
});

export default function DepreciationSetupPage() {
  const rights = usePageRights("depreciation-setup");
  const qc     = useQueryClient();

  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editingId,   setEditingId]   = useState<number | null>(null);
  const [deleteId,    setDeleteId]    = useState<number | null>(null);
  const [form,        setForm]        = useState(emptyForm());
  const [search,      setSearch]      = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "Active" | "Inactive">("");

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["depreciation-setups"],
    queryFn:  () => getDepreciationSetups(),
  });

  const filtered = useMemo(() => {
    let r = records;
    if (filterStatus) r = r.filter((x) => x.Status === filterStatus);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((x) => x.AssetCategory.toLowerCase().includes(s));
    }
    return r;
  }, [records, filterStatus, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["depreciation-setups"] });

  const createMut = useMutation({
    mutationFn: createDepreciationSetup,
    onSuccess:  () => { toast.success("Depreciation rate created"); invalidate(); closeDrawer(); },
    onError:    (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DepreciationPayload> }) => updateDepreciationSetup(id, data),
    onSuccess:  () => { toast.success("Depreciation rate updated"); invalidate(); closeDrawer(); },
    onError:    (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteDepreciationSetup,
    onSuccess:  () => { toast.success("Deleted"); invalidate(); setDeleteId(null); },
    onError:    (e: Error) => toast.error(e.message),
  });

  const openCreate = () => { setForm(emptyForm()); setEditingId(null); setDrawerOpen(true); };
  const openEdit   = (r: DepreciationSetup) => {
    setForm({
      assetCategory:    r.AssetCategory,
      depreciationType: r.DepreciationType,
      depreciationRate: r.DepreciationRate,
      effectiveFrom:    r.EffectiveFrom?.slice(0, 10) || "",
      status:           r.Status,
    });
    setEditingId(r.SetupId);
    setDrawerOpen(true);
  };
  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); };

  const handleSave = () => {
    if (!form.assetCategory)  return toast.error("Asset category is required");
    if (!form.depreciationRate) return toast.error("Depreciation rate is required");
    if (!form.effectiveFrom)  return toast.error("Effective from date is required");
    if (editingId) updateMut.mutate({ id: editingId, data: form });
    else           createMut.mutate(form);
  };

  const inputCls = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const saving   = createMut.isPending || updateMut.isPending;

  return (
    <MaterialShell
      title="Depreciation Setup"
      subtitle="Define annual depreciation rates for fixed asset categories"
      icon={Percent}
      action={
        rights.canCreate && (
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition">
            <Plus size={16} /> New Rate
          </button>
        )
      }
    >
      {/* ── filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search category…"
            className={`${inputCls} pl-8`}
          />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as "" | "Active" | "Inactive")}
          className={`${inputCls} w-36`}>
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {/* ── table ── */}
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Percent size={40} className="opacity-30" />
          <p className="text-sm">No depreciation rates found</p>
          {rights.canCreate && (
            <button onClick={openCreate}
              className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              <Plus size={13} /> Add First Rate
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Asset Category</th>
                <th className="px-4 py-3 text-left">Depreciation Type</th>
                <th className="px-4 py-3 text-right">Rate (%)</th>
                <th className="px-4 py-3 text-left">Effective From</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.SetupId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.AssetCategory}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.DepreciationType}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{r.DepreciationRate}%</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.EffectiveFrom ? new Date(r.EffectiveFrom).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.Status] ?? ""}`}>
                      {r.Status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {rights.canEdit && (
                        <button onClick={() => openEdit(r)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                          <Pencil size={13} />
                        </button>
                      )}
                      {rights.canDelete && (
                        <button onClick={() => setDeleteId(r.SetupId)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500">
                          <Trash2 size={13} />
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

      {/* ── drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closeDrawer} />
          <div className="w-full max-w-sm bg-card border-l border-border flex flex-col shadow-2xl">
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold">{editingId ? "Edit" : "New"} Depreciation Rate</h2>
              <button onClick={closeDrawer} className="p-1.5 rounded hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className={labelCls}>Asset Category *</label>
                <select value={form.assetCategory} onChange={(e) => setForm((p) => ({ ...p, assetCategory: e.target.value }))}
                  className={inputCls}>
                  <option value="">Select category…</option>
                  {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className={labelCls}>Depreciation Type</label>
                <select value={form.depreciationType} onChange={(e) => setForm((p) => ({ ...p, depreciationType: e.target.value }))}
                  className={inputCls}>
                  {DEPRECIATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className={labelCls}>Depreciation Rate (% per year) *</label>
                <select value={String(form.depreciationRate)} onChange={(e) => setForm((p) => ({ ...p, depreciationRate: parseFloat(e.target.value) }))}
                  className={inputCls}>
                  {GOVT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>

              <div>
                <label className={labelCls}>Effective From *</label>
                <input type="date" value={form.effectiveFrom}
                  onChange={(e) => setForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
                  className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "Active" | "Inactive" }))}
                  className={inputCls}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            {/* footer */}
            <div className="px-5 py-4 border-t border-border flex gap-2 justify-end">
              <button onClick={closeDrawer}
                className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                {saving ? "Saving…" : <><Check size={14} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── delete confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Delete this rate?</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This will permanently remove the depreciation setup. Assets using it will retain their copied rate.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)}
                className="h-8 px-3 rounded border border-border text-sm hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={() => deleteMut.mutate(deleteId!)} disabled={deleteMut.isPending}
                className="h-8 px-3 rounded bg-destructive text-white text-sm font-medium disabled:opacity-50">
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </MaterialShell>
  );
}
