import React, { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, AlertCircle, Search,
  Building2, Package, Calendar, FileText, Hash, Tag as TagIcon, X, Boxes,
  Download, Upload, Loader2, Check,
} from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getItems } from "@/api/itemMasterApi";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
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

const RECORD_COLORS: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Done:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
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
  numberOfItems: string;
  remarks: string;
}

const emptyForm = (overrides: Partial<FormState> = {}): FormState => ({
  docDate:   new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  godownId:  "",
  itemId:    "",
  numberOfItems: "",
  remarks:   "",
  ...overrides,
});

// Financial Year is always derived from the Document Date — never picked
// manually — so a tagging entry's date and its FinYear can never drift
// apart the way independently-selected values could (which is exactly what
// broke the Tagging Transaction History "Financial Year" filter before).
function deriveFinYear(docDate: string, finYears: { year: string; startDate: string; endDate: string }[]): string {
  if (!docDate) return "";
  const match = finYears.find((f) => f.startDate && f.endDate && docDate >= f.startDate && docDate <= f.endDate);
  return match?.year || "";
}

type ViewMode = "list" | "form";

export default function FixedAssetTagging() {
  const rights = usePageRights("fixed-asset-tagging");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm());

  const effectiveFinYear = useMemo(() => deriveFinYear(form.docDate, finYears), [form.docDate, finYears]);

  const [filterCompany, setFilterCompany] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
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
  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn:  getGodowns,
  });

  // Eligible Fixed Asset items — re-fetched whenever the form's
  // company/project/finYear/godown scope changes; a Godown is required
  // since untagged quantity is computed per (item, godown).
  const { data: eligibleItems = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["fixed-asset-eligible-items", form.companyId, form.projectId, effectiveFinYear, form.godownId],
    queryFn: () => getEligibleAssetItems({
      godownId:  Number(form.godownId),
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      finYear:   effectiveFinYear || undefined,
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

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<TaggingListItem>(taggings);
    if (filterCompany) r = r.filter((t) => String(t.CompanyId) === filterCompany);
    if (filterProject) r = r.filter((t) => String(t.ProjectId) === filterProject);
    if (filterFromDate) r = r.filter((t) => t.DocDate && new Date(t.DocDate) >= new Date(filterFromDate));
    if (filterToDate)   r = r.filter((t) => t.DocDate && new Date(t.DocDate) <= new Date(`${filterToDate}T23:59:59`));
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((t) =>
        (t.DocNo || "").toLowerCase().includes(s) ||
        (t.AssetName || "").toLowerCase().includes(s) ||
        (t.AssetCode || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [taggings, filterCompany, filterProject, filterFromDate, filterToDate, search]);

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

  const resetForm = () => setForm(emptyForm());
  const goToCreate = () => { resetForm(); setViewMode("form"); };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    const validRows = importPreview.filter((r) => r.status === "valid");
    if (validRows.length === 0) return;

    setImportSubmitting(true);
    const finalResults = [...importPreview];

    // Sequential, not Promise.all — mirrors the manual "Generate ID" flow
    // (one create call at a time) and keeps per-row error attribution clean.
    for (const row of validRows) {
      const idx = finalResults.findIndex((r) => r.row === row.row);
      try {
        await createFixedAssetTagging({
          docDate: row.docDate,
          companyId: row.companyId,
          projectId: row.projectId!,
          godownId: row.godownId!,
          itemId: row.itemId!,
          numberOfItems: row.quantity,
          remarks: row.remarks || undefined,
        });
        finalResults[idx] = { ...row, status: "success" };
      } catch (err) {
        finalResults[idx] = { ...row, status: "error", message: err instanceof Error ? err.message : "Failed to create" };
      }
    }

    setImportPreview(finalResults);
    setImportDone(true);
    setImportSubmitting(false);

    const successCount = finalResults.filter((r) => r.status === "success").length;
    const errorCount = finalResults.length - successCount;
    if (successCount > 0) {
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
    }
    if (errorCount === 0) {
      toast.success(`Imported ${successCount} row${successCount === 1 ? "" : "s"} ✓`);
    } else if (successCount === 0) {
      toast.error(`Import failed for all ${errorCount} row${errorCount === 1 ? "" : "s"}.`);
    } else {
      toast.warning(`Imported ${successCount} of ${finalResults.length} rows — ${errorCount} failed.`);
    }
  };

  const closeImportDialog = () => { setImportPreview(null); setImportDone(false); };

  const handleSave = () => {
    if (!form.companyId)  return toast.error("Company is required");
    if (!form.docDate)    return toast.error("Date is required");
    if (!effectiveFinYear) return toast.error("This date doesn't fall in any configured Financial Year");
    if (!form.projectId)  return toast.error("Project is required");
    if (!form.godownId)   return toast.error("Godown is required");
    if (!form.itemId)     return toast.error("Item is required");
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
      finYear:   effectiveFinYear,
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
                <label className={labelCls}><Calendar size={11} /> Date *</label>
                <input type="date" value={form.docDate}
                  onChange={(e) => setForm((p) => ({ ...p, docDate: e.target.value, itemId: "" }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Financial Year</label>
                <input type="text" value={effectiveFinYear || "No FY configured for this date"} readOnly
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
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
      action={
        rights.canCreate ? (
          <div className="flex items-center gap-2">
            <input ref={importFileInputRef} type="file" accept=".csv"
              onChange={handleImportFileChange} className="hidden" />
            <button onClick={handleDownloadImportTemplate}
              title="Download a blank CSV import template (opens/edits fine in Excel)"
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <Download size={13} /> <span className="hidden sm:inline">Template</span>
            </button>
            <button onClick={handleImportClick} disabled={importValidating}
              title="Bulk import FA Inventory rows from Excel/CSV"
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              {importValidating ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {importValidating ? "Validating…" : "Import from Excel"}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Tagging Entries" value={fmt(stats.count)} icon={Boxes} />
        <SummaryCard label="Total Tagged Qty" value={fmt(stats.totalQty)} color="text-emerald-600 dark:text-emerald-400" icon={TagIcon} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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
              <label className={labelCls}><Calendar size={11} /> From Date</label>
              <input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><Calendar size={11} /> To Date</label>
              <input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {(filterCompany || filterProject || filterFromDate || filterToDate || search) && (
              <button
                onClick={() => { setFilterCompany(""); setFilterProject(""); setFilterFromDate(""); setFilterToDate(""); setSearch(""); }}
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
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Record</th>
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
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.Status] ?? ""}`}>
                          {t.Status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.RecordStatus ? (
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${RECORD_COLORS[t.RecordStatus] ?? ""}`}>
                            {t.RecordStatus}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
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

      <Dialog open={!!importPreview} onOpenChange={(open) => { if (!open) closeImportDialog(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              {importDone ? "Import Results" : "Review Import"}
            </DialogTitle>
          </DialogHeader>
          {importPreview && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check size={14} />
                  {importPreview.filter((r) => r.status === "valid" || r.status === "success").length}{" "}
                  {importDone ? "succeeded" : "valid"}
                </span>
                {importPreview.some((r) => r.status === "error") && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <X size={14} />
                    {importPreview.filter((r) => r.status === "error").length}{" "}
                    {importDone ? "failed" : "rejected"}
                  </span>
                )}
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">Company / Project</th>
                      <th className="px-3 py-2 text-left">Godown</th>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Qty</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {importPreview.map((r) => (
                      <tr key={r.row} className={r.status === "error" ? "bg-destructive/5" : ""}>
                        <td className="px-3 py-2">{r.row}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate">{r.companyLabel} / {r.projectLabel}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{r.godownLabel}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate">{r.itemName}</td>
                        <td className="px-3 py-2">{r.docDate}</td>
                        <td className="px-3 py-2">{r.quantity || "—"}</td>
                        <td className="px-3 py-2 max-w-[260px]">
                          {r.status === "error" ? (
                            <span className="text-destructive">{r.message}</span>
                          ) : r.status === "success" ? (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check size={12} /> Imported</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
            {!importDone ? (
              <>
                <button onClick={closeImportDialog}
                  className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                  Cancel
                </button>
                <button onClick={handleConfirmImport}
                  disabled={importSubmitting || !importPreview?.some((r) => r.status === "valid")}
                  className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
                  {importSubmitting ? "Importing…" : `Import ${importPreview?.filter((r) => r.status === "valid").length || 0} Valid Row(s)`}
                </button>
              </>
            ) : (
              <button onClick={closeImportDialog}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                Close
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </GlassShell>
    </>
  );
}
