import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, AlertCircle, Search,
  Building2, Package, Calendar, FileText, Hash, Boxes, IndianRupee,
  Upload, Trash2, X, Check,
} from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import {
  getInventoryImports, createInventoryImport, deleteInventoryImport,
  type InventoryImportListItem,
} from "@/api/fixedAssetInventoryImportApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function fmtCur(n: number | null | undefined) {
  if (n == null) return "—";
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const STATUS_COLORS: Record<string, string> = {
  Active:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Reversed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const inputCls   = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow";
const labelCls   = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";

function SectionHeader({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
        <Icon size={14} />
      </span>
      <p className="text-sm font-semibold text-foreground">{children}</p>
    </div>
  );
}

function SummaryCard({ label, value, color = "", icon: Icon }: { label: string; value: string; color?: string; icon?: React.ElementType }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3 text-center">
      {Icon && <Icon size={13} className={`mx-auto mb-1 ${color || "text-muted-foreground"}`} />}
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

interface FormState {
  docDate: string;
  companyId: string;
  projectId: string;
  godownId: string;
  itemId: string;
  quantity: string;
  rate: string;
  remarks: string;
}

const emptyForm = (): FormState => ({
  docDate:   new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  godownId:  "",
  itemId:    "",
  quantity:  "",
  rate:      "",
  remarks:   "",
});

type ViewMode = "list" | "form";

export default function FixedAssetInventoryImport() {
  const rights = usePageRights("fixed-asset-inventory-import");
  const qc     = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState("");
  const [reverseId, setReverseId] = useState<number | null>(null);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data queries ──────────────────────────────────────────────────────────
  const { data: imports = [], isLoading } = useQuery({
    queryKey: ["fixed-asset-inventory-imports"],
    queryFn:  () => getInventoryImports(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn:  () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn:  () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn:  getGodowns,
  });
  const { data: allItems = [] } = useQuery({
    queryKey: ["item-master-all"],
    queryFn:  getItems,
    enabled:  viewMode === "form",
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const godowns = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<Godown>(godownsData?.data)
      .filter((g) => !g.IsDeleted && g.IsActive)
      .filter((g) => g.EnterpriseID === Number(form.companyId))
      .filter((g) => !form.projectId || g.ProjectID === Number(form.projectId) || g.ProjectID == null);
  }, [godownsData, form.companyId, form.projectId]);

  // Only Fixed-Asset-category items belong in Fixed Asset Inventory — same
  // M_Type filter FA Inventory's own tagging screen applies.
  const fixedAssetItems = useMemo(
    () => ensureArray<DbItem>(allItems).filter((i) => i.M_Type === "Fixed Asset"),
    [allItems],
  );
  const selectedItem = fixedAssetItems.find((i) => i.M_Id === form.itemId) || null;

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<InventoryImportListItem>(imports);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((i) =>
        (i.DocNo || "").toLowerCase().includes(s) ||
        (i.ItemName || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [imports, search]);

  const stats = useMemo(() => {
    const active = ensureArray<InventoryImportListItem>(imports).filter((i) => i.Status === "Active");
    return { count: active.length, totalQty: active.reduce((s, i) => s + (i.Quantity || 0), 0) };
  }, [imports]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createInventoryImport,
    onSuccess: (r) => {
      toast.success(`Imported — ${r.docNo}`, {
        description: r.tagged > 0 ? `${r.tagged} FA Item Code(s) auto-generated` : "Complete tagging manually in FA Inventory",
      });
      qc.invalidateQueries({ queryKey: ["fixed-asset-inventory-imports"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverseMut = useMutation({
    mutationFn: deleteInventoryImport,
    onSuccess: () => {
      toast.success("Import reversed");
      qc.invalidateQueries({ queryKey: ["fixed-asset-inventory-imports"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      setReverseId(null);
    },
    onError: (e: Error) => { toast.error(e.message); setReverseId(null); },
  });

  const resetForm = () => setForm(emptyForm());
  const goToCreate = () => { resetForm(); setViewMode("form"); };

  const handleSave = () => {
    if (!form.docDate)  return toast.error("Date is required");
    if (!form.godownId) return toast.error("Godown is required");
    if (!form.itemId)   return toast.error("Item is required");
    const qty = parseFloat(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Enter a valid quantity");

    createMut.mutate({
      docDate:   form.docDate,
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      godownId:  Number(form.godownId),
      itemId:    form.itemId,
      quantity:  qty,
      rate:      form.rate ? parseFloat(form.rate) : undefined,
      remarks:   form.remarks || undefined,
    });
  };

  const saving = createMut.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title="New Inventory Import"
        subtitle="Manually bring a Fixed-Asset item into inventory when there's no GRN to receive it through"
        icon={Upload}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Check size={13} /> {saving ? "Importing…" : "Import"}
            </button>
          </div>
        }
      >
        <div className="max-w-3xl space-y-5">
          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Building2 size={11} /> Company</label>
                <select value={form.companyId}
                  onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); setField("godownId", ""); }}
                  className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project</label>
                <select value={form.projectId}
                  onChange={(e) => { setField("projectId", e.target.value); setField("godownId", ""); }}
                  className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Date *</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Boxes size={11} /> Godown *</label>
                <select value={form.godownId} onChange={(e) => setField("godownId", e.target.value)} className={inputCls}
                  disabled={!form.companyId}>
                  <option value="">Select godown…</option>
                  {godowns.map((g) => <option key={g.GodownID} value={g.GodownID}>{g.GodownName}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={Package}>Item Being Imported</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
              <div className="sm:col-span-2">
                <label className={labelCls}><Hash size={11} /> Item * <span className="text-muted-foreground/60 font-normal normal-case">(Fixed Asset category only)</span></label>
                <select value={form.itemId} onChange={(e) => setField("itemId", e.target.value)} className={inputCls}>
                  <option value="">Select item…</option>
                  {fixedAssetItems.map((i) => <option key={i.M_Id} value={i.M_Id}>{i.M_Name}{i.M_Group ? ` (${i.M_Group})` : ""}</option>)}
                </select>
                {fixedAssetItems.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
                    <AlertCircle size={12} /> No items tagged "Fixed Asset" in Item Master yet.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}><Hash size={11} /> Quantity *</label>
                <input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)}
                  placeholder="0" className={`${inputCls} font-semibold border-yellow-500/30 focus:ring-yellow-500/30 bg-yellow-500/[0.03]`} />
              </div>
              <div>
                <label className={labelCls}><IndianRupee size={11} /> Unit Rate</label>
                <input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setField("rate", e.target.value)}
                  placeholder="0.00" className={inputCls} />
              </div>
              {selectedItem && form.quantity && form.rate && (
                <div className="sm:col-span-2">
                  <SummaryCard label="Total Value" value={fmtCur(parseFloat(form.quantity) * parseFloat(form.rate))} icon={IndianRupee} color="text-yellow-600 dark:text-yellow-400" />
                </div>
              )}
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Remarks</SectionHeader>
            <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)}
              placeholder="Why this item is being imported manually (e.g. original GRN unavailable)…" className={inputCls} />
          </div>

          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <AlertCircle size={12} className="shrink-0" />
            This creates fresh Fixed Asset Inventory exactly like a GRN receipt — it'll appear as untagged stock in FA Inventory (or auto-tag immediately if a Project Alias and Financial Year are configured) and follow the same tagging/record workflow from there.
          </p>
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Inventory Import"]} />
    <GlassShell
      title="Inventory Import"
      subtitle="Manually bring Fixed-Asset items into inventory when there's no GRN to receive them through"
      icon={Upload}
      accentColor="#eab308"
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Import
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Active Imports" value={fmt(stats.count)} icon={Boxes} />
        <SummaryCard label="Total Qty Imported" value={fmt(stats.totalQty)} color="text-emerald-600 dark:text-emerald-400" icon={Upload} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4">
          <label className={labelCls}>Search</label>
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search doc no, item…"
              className={`${inputCls} pl-8`} />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Import History</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Full audit trail of manually-imported Fixed Asset inventory</p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                <Upload size={26} className="opacity-40" />
              </span>
              <p className="text-sm">No inventory imports yet</p>
              {rights.canCreate && (
                <button onClick={goToCreate}
                  className="mt-2 inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                  <Plus size={13} /> Add First Import
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Doc No</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-4 py-3 text-left">Company / Project</th>
                    <th className="px-4 py-3 text-left">Godown</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((i) => (
                    <tr key={i.ImportId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{i.DocNo || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.DocDate)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate">{i.ItemName || "—"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{i.AssetCategory || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {i.CompanyName || "—"}{i.ProjectName ? ` / ${i.ProjectName}` : ""}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{i.GodownName || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(i.Quantity)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[i.Status] ?? ""}`}>
                          {i.Status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {rights.canDelete && i.Status === "Active" && (
                            <button onClick={() => setReverseId(i.ImportId)}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500" title="Reverse">
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
        </CardContent>
      </Card>

      {/* ── reverse confirm ── */}
      {reverseId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-96 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Reverse this import?</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This removes the stock it created and any Fixed Asset Record / FA Item Code(s) generated from it. Blocked automatically if any unit has been transferred, sold, or scrapped.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReverseId(null)}
                className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                Cancel
              </button>
              <button onClick={() => reverseMut.mutate(reverseId!)} disabled={reverseMut.isPending}
                className="shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive transition-all disabled:opacity-50">
                {reverseMut.isPending ? "Reversing…" : "Reverse"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </GlassShell>
    </>
  );
}
