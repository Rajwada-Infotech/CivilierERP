import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Trash2, AlertCircle, Search,
  Building2, Package, Calendar, FileText, Hash, Tag as TagIcon, Check, X, Boxes,
} from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getEligibleAssetItems, getFixedAssetTaggings, createFixedAssetTagging, deleteFixedAssetTagging,
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
  assetId: string;
  taggedQty: string;
  remarks: string;
}

const emptyForm = (finYear = ""): FormState => ({
  docDate:   new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  finYear,
  assetId:   "",
  taggedQty: "",
  remarks:   "",
});

type ViewMode = "list" | "form";

export default function FixedAssetTagging() {
  const rights = usePageRights("fixed-asset-tagging");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(activeFinYear));

  const [filterCompany, setFilterCompany] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterFinYear, setFilterFinYear] = useState("");
  const [search, setSearch] = useState("");

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

  // Eligible Fixed Asset Purchase Items — re-fetched whenever the form's
  // company/project/finYear scope changes, since a batch's own company/
  // project determines whether it should be selectable in that scope.
  const { data: eligibleItems = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["fixed-asset-eligible-items", form.companyId, form.projectId, form.finYear],
    queryFn: () => getEligibleAssetItems({
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      finYear:   form.finYear || undefined,
    }),
    enabled: viewMode === "form",
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

  const selectedItem = useMemo(
    () => ensureArray<EligibleAssetItem>(eligibleItems).find((i) => String(i.AssetId) === form.assetId) || null,
    [eligibleItems, form.assetId],
  );

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
      toast.success(`Tagged — ${r.docNo}`);
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteFixedAssetTagging,
    onSuccess: () => {
      toast.success("Tagging entry cancelled");
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => setForm(emptyForm(activeFinYear));
  const goToCreate = () => { resetForm(); setViewMode("form"); };

  const handleSave = () => {
    if (!form.companyId)  return toast.error("Company is required");
    if (!form.finYear)    return toast.error("Financial year is required");
    if (!form.projectId)  return toast.error("Project is required");
    if (!form.assetId)    return toast.error("Fixed asset purchase item is required");
    if (!form.docDate)    return toast.error("Date is required");
    const qty = parseFloat(form.taggedQty);
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Enter a valid quantity to tag");
    if (!selectedItem) return toast.error("Selected item is no longer available");
    if (qty > selectedItem.UntaggedQty) {
      return toast.error(`Only ${fmt(selectedItem.UntaggedQty)} unit(s) are untagged for this item`);
    }

    createMut.mutate({
      docDate:   form.docDate,
      companyId: Number(form.companyId),
      projectId: Number(form.projectId),
      finYear:   form.finYear,
      assetId:   Number(form.assetId),
      taggedQty: qty,
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
        title="New Fixed Asset Tagging"
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
              <Check size={13} /> {saving ? "Saving…" : "Save Tagging"}
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
                  onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); setField("assetId", ""); }}
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
                  onChange={(e) => { setField("projectId", e.target.value); setField("assetId", ""); }}
                  className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Financial Year *</label>
                <select value={form.finYear}
                  onChange={(e) => { setField("finYear", e.target.value); setField("assetId", ""); }}
                  className={inputCls}>
                  <option value="">Select year…</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Date *</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={Package}>Item to Tag</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
              <div className="sm:col-span-2">
                <label className={labelCls}><Hash size={11} /> Fixed Asset Purchase Item *</label>
                <select value={form.assetId} onChange={(e) => setField("assetId", e.target.value)} className={inputCls}
                  disabled={!form.companyId || !form.projectId || !form.finYear}>
                  <option value="">
                    {loadingEligible ? "Loading items…" : "Select item…"}
                  </option>
                  {ensureArray<EligibleAssetItem>(eligibleItems).map((i) => (
                    <option key={i.AssetId} value={i.AssetId}>
                      {i.AssetName}{i.AssetCode ? ` · ${i.AssetCode}` : ""} — Untagged: {fmt(i.UntaggedQty)}
                    </option>
                  ))}
                </select>
                {!loadingEligible && (form.companyId && form.projectId && form.finYear) && eligibleItems.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
                    <AlertCircle size={12} /> No untagged fixed-asset items available for this scope.
                  </p>
                )}
              </div>

              {selectedItem && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                    <SummaryCard label="Available Stock Qty" value={fmt(selectedItem.Quantity)} icon={Boxes} />
                    <SummaryCard label="Pending / Untagged Item Count" value={fmt(selectedItem.UntaggedQty)} color="text-violet-600 dark:text-violet-400" icon={AlertCircle} />
                  </div>
                  <div>
                    <label className={labelCls}>Quantity to Tag *</label>
                    <input type="number" min="0" step="0.001" max={selectedItem.UntaggedQty}
                      value={form.taggedQty} onChange={(e) => setField("taggedQty", e.target.value)}
                      placeholder="0" className={`${inputCls} font-semibold border-yellow-500/30 focus:ring-yellow-500/30 bg-yellow-500/[0.03]`} />
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
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Fixed Asset Tagging"]} />
    <GlassShell
      title="Fixed Asset Tagging"
      subtitle="Tag received fixed-asset stock and track untagged quantities"
      icon={TagIcon}
      accentColor="#eab308"
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Tagging
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Tagging Entries" value={fmt(stats.count)} icon={Boxes} />
        <SummaryCard label="Total Tagged Qty" value={fmt(stats.totalQty)} color="text-emerald-600 dark:text-emerald-400" icon={TagIcon} />
      </div>

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
                    <th className="px-4 py-3 text-left">Company / Project</th>
                    <th className="px-4 py-3 text-right">Tagged Qty</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Remarks</th>
                    <th className="px-4 py-3 text-right">Actions</th>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {rights.canDelete && t.Status === "Tagged" && (
                            <button onClick={() => setDeleteId(t.TagId)}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500" title="Cancel">
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

      {deleteId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Cancel this tagging entry?</p>
                <p className="text-xs text-muted-foreground mt-0.5">The tagged quantity will be released back to the untagged pool.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)}
                className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                Back
              </button>
              <button onClick={() => deleteMut.mutate(deleteId!)} disabled={deleteMut.isPending}
                className="shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive transition-all disabled:opacity-50">
                {deleteMut.isPending ? "Cancelling…" : "Cancel Entry"}
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
