import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, AlertCircle, Search,
  Building2, Package, Calendar, FileText, Hash, Tag as TagIcon, X, Boxes,
} from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import {
  getEligibleAssetItems, getFixedAssetTaggings, createFixedAssetTagging,
  type EligibleAssetItem, type TaggingListItem,
} from "@/api/fixedAssetTaggingApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const STATUS_COLORS: Record<string, string> = {
  Tagged:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
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
  finYear: string;
  godownId: string;
  itemId: string;
  numberOfItems: string;
  remarks: string;
}

const emptyForm = (finYear = "", overrides: Partial<FormState> = {}): FormState => ({
  docDate:   new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  finYear,
  godownId:  "",
  itemId:    "",
  numberOfItems: "",
  remarks:   "",
  ...overrides,
});

type ViewMode = "list" | "form";

export default function FixedAssetTagging() {
  const rights = usePageRights("fixed-asset-tagging");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm(activeFinYear));

  const [filterCompany, setFilterCompany] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterFinYear, setFilterFinYear] = useState("");
  const [search, setSearch] = useState("");

  // Godown-wise stock panel — independent scope from the tagging form/list
  // filters, shown directly on the list view per the "fetch and display
  // Godown-wise Fixed Asset items with available quantity" requirement.
  const [stockCompanyId, setStockCompanyId] = useState("");
  const [stockProjectId, setStockProjectId] = useState("");
  const [stockGodownId, setStockGodownId] = useState("");

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data queries ──────────────────────────────────────────────────────────
  const { data: taggings = [], isLoading } = useQuery({
    queryKey: ["fixed-asset-taggings"],
    queryFn:  () => getFixedAssetTaggings(),
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

  // Eligible Fixed Asset items — re-fetched whenever the form's
  // company/project/finYear/godown scope changes; a Godown is required
  // since untagged quantity is computed per (item, godown).
  const { data: eligibleItems = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["fixed-asset-eligible-items", form.companyId, form.projectId, form.finYear, form.godownId],
    queryFn: () => getEligibleAssetItems({
      godownId:  Number(form.godownId),
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      finYear:   form.finYear || undefined,
    }),
    enabled: viewMode === "form" && !!form.godownId,
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const filterProjects = useMemo(() => {
    if (!filterCompany) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(filterCompany));
  }, [allProjects, filterCompany]);

  const godowns = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<Godown>(godownsData?.data)
      .filter((g) => !g.IsDeleted && g.IsActive)
      .filter((g) => g.EnterpriseID === Number(form.companyId))
      .filter((g) => !form.projectId || g.ProjectID === Number(form.projectId) || g.ProjectID == null);
  }, [godownsData, form.companyId, form.projectId]);

  const selectedItem = useMemo(
    () => ensureArray<EligibleAssetItem>(eligibleItems).find((i) => i.ItemId === form.itemId) || null,
    [eligibleItems, form.itemId],
  );

  // ── Godown-wise stock panel ───────────────────────────────────────────────
  const stockProjects = useMemo(() => {
    if (!stockCompanyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(stockCompanyId));
  }, [allProjects, stockCompanyId]);

  const stockGodowns = useMemo(() => {
    if (!stockCompanyId) return [];
    return ensureArray<Godown>(godownsData?.data)
      .filter((g) => !g.IsDeleted && g.IsActive)
      .filter((g) => g.EnterpriseID === Number(stockCompanyId))
      .filter((g) => !stockProjectId || g.ProjectID === Number(stockProjectId) || g.ProjectID == null);
  }, [godownsData, stockCompanyId, stockProjectId]);

  const { data: stockItems = [], isLoading: loadingStock } = useQuery({
    queryKey: ["fixed-asset-eligible-items", stockCompanyId, stockProjectId, "", stockGodownId],
    queryFn: () => getEligibleAssetItems({
      godownId:  Number(stockGodownId),
      companyId: stockCompanyId ? Number(stockCompanyId) : undefined,
      projectId: stockProjectId ? Number(stockProjectId) : undefined,
    }),
    enabled: !!stockGodownId,
  });

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<TaggingListItem>(taggings);
    if (filterCompany) r = r.filter((t) => String(t.CompanyId) === filterCompany);
    if (filterProject) r = r.filter((t) => String(t.ProjectId) === filterProject);
    if (filterFinYear) r = r.filter((t) => t.FinYear === filterFinYear);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((t) =>
        (t.DocNo || "").toLowerCase().includes(s) ||
        (t.AssetName || "").toLowerCase().includes(s) ||
        (t.AssetCode || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [taggings, filterCompany, filterProject, filterFinYear, search]);

  const stats = useMemo(() => {
    const live = ensureArray<TaggingListItem>(taggings).filter((t) => t.Status !== "Cancelled");
    return {
      count: live.length,
      totalQty: live.reduce((s, t) => s + (t.TaggedQty || 0), 0),
    };
  }, [taggings]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createFixedAssetTagging,
    onSuccess: (r) => {
      const preview = r.codes.slice(0, 3).join(", ") + (r.codes.length > 3 ? `, +${r.codes.length - 3} more` : "");
      toast.success(`Generated ${r.codes.length} FA Item Code${r.codes.length === 1 ? "" : "s"} — ${r.docNo}`, {
        description: preview,
      });
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => setForm(emptyForm(activeFinYear));
  const goToCreate = () => { resetForm(); setViewMode("form"); };
  const goToGenerate = (item: EligibleAssetItem) => {
    setForm(emptyForm(activeFinYear, {
      companyId: stockCompanyId,
      projectId: stockProjectId,
      godownId:  stockGodownId,
      itemId:    item.ItemId,
    }));
    setViewMode("form");
  };

  const handleSave = () => {
    if (!form.companyId)  return toast.error("Company is required");
    if (!form.finYear)    return toast.error("Financial year is required");
    if (!form.projectId)  return toast.error("Project is required");
    if (!form.godownId)   return toast.error("Godown is required");
    if (!form.itemId)     return toast.error("Item is required");
    if (!form.docDate)    return toast.error("Date is required");
    const count = parseInt(form.numberOfItems, 10);
    if (!Number.isFinite(count) || count <= 0 || String(count) !== form.numberOfItems.trim()) {
      return toast.error("Enter a valid whole number of items");
    }
    if (!selectedItem) return toast.error("Selected item is no longer available");
    if (count > selectedItem.UntaggedQty) {
      return toast.error(`Only ${fmt(selectedItem.UntaggedQty)} unit(s) are untagged for this item`);
    }

    createMut.mutate({
      docDate:   form.docDate,
      companyId: Number(form.companyId),
      projectId: Number(form.projectId),
      finYear:   form.finYear,
      godownId:  Number(form.godownId),
      itemId:    form.itemId,
      numberOfItems: count,
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
        title="New FA Inventory"
        subtitle="Tag received fixed-asset stock against a purchase batch"
        icon={TagIcon}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Hash size={13} /> {saving ? "Generating…" : "Generate ID"}
            </button>
          </div>
        }
      >
        <div className="max-w-3xl space-y-5">
          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Building2 size={11} /> Company *</label>
                <select value={form.companyId}
                  onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); setField("godownId", ""); setField("itemId", ""); }}
                  className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project *</label>
                <select value={form.projectId}
                  onChange={(e) => { setField("projectId", e.target.value); setField("godownId", ""); setField("itemId", ""); }}
                  className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Financial Year *</label>
                <select value={form.finYear}
                  onChange={(e) => { setField("finYear", e.target.value); setField("itemId", ""); }}
                  className={inputCls}>
                  <option value="">Select year…</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Date *</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Boxes size={11} /> Godown / Stock *</label>
                <select value={form.godownId}
                  onChange={(e) => { setField("godownId", e.target.value); setField("itemId", ""); }}
                  className={inputCls} disabled={!form.companyId || !form.projectId}>
                  <option value="">Select godown…</option>
                  {godowns.map((g) => <option key={g.GodownID} value={g.GodownID}>{g.GodownName}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={Package}>Item to Tag</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
              <div className="sm:col-span-2">
                <label className={labelCls}><Hash size={11} /> Item *</label>
                <select value={form.itemId} onChange={(e) => setField("itemId", e.target.value)} className={inputCls}
                  disabled={!form.godownId}>
                  <option value="">
                    {loadingEligible ? "Loading items…" : "Select item…"}
                  </option>
                  {ensureArray<EligibleAssetItem>(eligibleItems).map((i) => (
                    <option key={i.ItemId} value={i.ItemId}>
                      {i.ItemName}{i.AssetCategory ? ` (${i.AssetCategory})` : ""} — Untagged: {fmt(i.UntaggedQty)}
                    </option>
                  ))}
                </select>
                {form.godownId && !loadingEligible && eligibleItems.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
                    <AlertCircle size={12} /> No untagged fixed-asset items available at this godown.
                  </p>
                )}
              </div>

              {selectedItem && (
                <>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-heading font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/60 pb-1.5 mb-3">
                      Stock Item Info
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <SummaryCard label="Available Stock Qty" value={fmt(selectedItem.AvailableQty)} icon={Boxes} />
                      <SummaryCard label="Tagged Qty" value={fmt(selectedItem.TaggedQty)} color="text-muted-foreground" icon={TagIcon} />
                      <SummaryCard label="Untagged Qty" value={fmt(selectedItem.UntaggedQty)} color="text-violet-600 dark:text-violet-400" icon={AlertCircle} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}><Hash size={11} /> Number of Items *</label>
                    <input type="number" min="1" step="1" max={selectedItem.UntaggedQty}
                      value={form.numberOfItems} onChange={(e) => setField("numberOfItems", e.target.value)}
                      placeholder="0" className={`${inputCls} font-semibold border-yellow-500/30 focus:ring-yellow-500/30 bg-yellow-500/[0.03]`} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Clicking "Generate ID" creates this many unique FA Item Codes and saves them.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Remarks</SectionHeader>
            <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)}
              placeholder="Optional remarks…" className={inputCls} />
          </div>
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "FA Inventory"]} />
    <GlassShell
      title="FA Inventory"
      subtitle="Tag received fixed-asset stock and track untagged quantities"
      icon={TagIcon}
      accentColor="#eab308"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Tagging Entries" value={fmt(stats.count)} icon={Boxes} />
        <SummaryCard label="Total Tagged Qty" value={fmt(stats.totalQty)} color="text-emerald-600 dark:text-emerald-400" icon={TagIcon} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Godown-wise Stock</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Fixed-asset items currently available in a godown, with untagged quantity</p>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}><Building2 size={11} /> Company</label>
              <select value={stockCompanyId}
                onChange={(e) => { setStockCompanyId(e.target.value); setStockProjectId(""); setStockGodownId(""); }}
                className={inputCls}>
                <option value="">Select company…</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Project</label>
              <select value={stockProjectId}
                onChange={(e) => { setStockProjectId(e.target.value); setStockGodownId(""); }}
                className={inputCls} disabled={!stockCompanyId}>
                <option value="">Select project…</option>
                {stockProjects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}><Boxes size={11} /> Godown / Stock</label>
              <select value={stockGodownId} onChange={(e) => setStockGodownId(e.target.value)}
                className={inputCls} disabled={!stockCompanyId}>
                <option value="">Select godown…</option>
                {stockGodowns.map((g) => <option key={g.GodownID} value={g.GodownID}>{g.GodownName}</option>)}
              </select>
            </div>
          </div>

          {!stockGodownId ? (
            <p className="text-xs text-muted-foreground text-center py-6">Select a Godown to see available Fixed Asset items.</p>
          ) : loadingStock ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
          ) : stockItems.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No fixed-asset items with untagged stock at this godown.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Item</th>
                    <th className="px-4 py-2.5 text-left">Category</th>
                    <th className="px-4 py-2.5 text-right">Available</th>
                    <th className="px-4 py-2.5 text-right">Tagged</th>
                    <th className="px-4 py-2.5 text-right">Untagged</th>
                    {rights.canCreate && <th className="px-4 py-2.5 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ensureArray<EligibleAssetItem>(stockItems).map((i) => (
                    <tr key={i.ItemId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{i.ItemName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{i.AssetCategory || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmt(i.AvailableQty)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{fmt(i.TaggedQty)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-violet-600 dark:text-violet-400">{fmt(i.UntaggedQty)}</td>
                      {rights.canCreate && (
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => goToGenerate(i)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-600 dark:text-yellow-400 hover:underline">
                            <Hash size={11} /> Generate ID
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className={labelCls}>Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search doc no, asset name, code…"
                  className={`${inputCls} pl-8`} />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setFilterProject(""); }} className={inputCls}>
                <option value="">All Companies</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Project</label>
              <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className={inputCls} disabled={!filterCompany}>
                <option value="">All Projects</option>
                {filterProjects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Financial Year</label>
              <select value={filterFinYear} onChange={(e) => setFilterFinYear(e.target.value)} className={inputCls}>
                <option value="">All Years</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {(filterCompany || filterProject || filterFinYear || search) && (
              <button
                onClick={() => { setFilterCompany(""); setFilterProject(""); setFilterFinYear(""); setSearch(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-muted-foreground shrink-0">
              {filtered.length} of {stats.count} entries
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Tagging Transaction History</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Full audit trail of tagging entries</p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                <TagIcon size={26} className="opacity-40" />
              </span>
              <p className="text-sm">No tagging entries found</p>
              {rights.canCreate && (
                <button onClick={goToCreate}
                  className="mt-2 inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                  <Plus size={13} /> Add First Tagging
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
                    <th className="px-4 py-3 text-left">FA Item Code</th>
                    <th className="px-4 py-3 text-left">Company / Project</th>
                    <th className="px-4 py-3 text-right">Tagged Qty</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((t) => (
                    <tr key={t.TagId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{t.DocNo || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.DocDate)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate">{t.AssetName || "—"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">{t.AssetCode || "—"}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-yellow-600 dark:text-yellow-400">{t.FAItemCode || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.CompanyName || "—"}{t.ProjectName ? ` / ${t.ProjectName}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(t.TaggedQty)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.Status] ?? ""}`}>
                          {t.Status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{t.Remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </GlassShell>
    </>
  );
}
