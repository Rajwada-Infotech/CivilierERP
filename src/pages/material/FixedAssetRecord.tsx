import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Eye, Pencil, Trash2, AlertCircle, Search,
  Building2, Package, TrendingDown, TrendingUp, IndianRupee, Calendar, User,
  FileText, MapPin, Hash, Cpu, Check, X,
  Boxes, Wallet, PackageCheck, Circle, CheckCircle2, PlayCircle,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getSuppliers } from "@/api/grnApi";
import { getActiveDepreciationSetups, type DepreciationSetup } from "@/api/depreciationApi";
import {
  getFixedAssets, getFixedAsset, createFixedAsset, updateFixedAsset, deleteFixedAsset,
  type FixedAssetListItem, type FixedAssetDetail,
} from "@/api/fixedAssetApi";
import { ASSET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from "./assetCategories";

// ── constants ─────────────────────────────────────────────────────────────────
const ASSET_STATUS_OPTIONS = ["Active", "Sold", "Scrapped", "Under Maintenance"] as const;

// Solid fills for the "Book Value by Category" bar chart — CATEGORY_COLORS
// are subtle badge tints (bg-x/10), too washed out to read as a bar fill.
const BAR_PALETTE = [
  "bg-emerald-500", "bg-blue-500", "bg-violet-500",
  "bg-amber-500", "bg-teal-500", "bg-rose-500",
];

const STATUS_COLORS: Record<string, string> = {
  Active:              "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Sold:                "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Scrapped:            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Under Maintenance": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

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
function fmtCurCompact(n: number | null | undefined) {
  if (n == null) return "—";
  return "₹" + new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

// ── depreciation calculation ──────────────────────────────────────────────────
function calcDepreciation(purchaseCost: number, rate: number, purchaseDate: string) {
  if (!purchaseCost || !rate || !purchaseDate) return null;
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / msPerYear);
  const annualDep = purchaseCost * (rate / 100);
  const totalDep  = Math.min(purchaseCost, annualDep * years);
  const bookValue = Math.max(0, purchaseCost - totalDep);
  return { years: parseFloat(years.toFixed(2)), annualDep, totalDep, bookValue };
}

// ── form shape ────────────────────────────────────────────────────────────────
interface FormState {
  docDate: string;
  companyId: string;
  projectId: string;
  finYear: string;
  assetName: string;
  assetCategory: string;
  brand: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  activationDate: string;
  purchaseInvoiceRef: string;
  supplierId: string;
  purchaseCost: string;
  quantity: string;
  location: string;
  department: string;
  custodian: string;
  depreciationSetupId: string;
  depreciationType: string;
  depreciationRate: string;
  usefulLife: string;
  assetStatus: string;
  sellingPrice: string;
  saleDate: string;
  buyerName: string;
  saleRemarks: string;
  remarks: string;
}

const emptyForm = (finYear = ""): FormState => ({
  docDate:            new Date().toISOString().slice(0, 10),
  companyId:          "",
  projectId:          "",
  finYear,
  assetName:          "",
  assetCategory:      "",
  brand:              "",
  model:              "",
  serialNumber:       "",
  purchaseDate:       "",
  activationDate:     "",
  purchaseInvoiceRef: "",
  supplierId:         "",
  purchaseCost:       "",
  quantity:           "1",
  location:           "",
  department:         "",
  custodian:          "",
  depreciationSetupId:"",
  depreciationType:   "",
  depreciationRate:   "",
  usefulLife:         "",
  assetStatus:        "Active",
  sellingPrice:       "",
  saleDate:           "",
  buyerName:          "",
  saleRemarks:        "",
  remarks:            "",
});

type ViewMode = "list" | "form" | "detail";

// ── small presentational helpers ──────────────────────────────────────────────
const inputCls    = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow";
const labelCls    = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls  = "bg-card border border-border rounded-xl p-5 space-y-4";

function SectionHeader({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
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

function DepreciationBar({ bookValue, cost }: { bookValue: number; cost: number }) {
  const pct = cost > 0 ? Math.min(100, Math.max(0, (bookValue / cost) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] || Package;
  const color = CATEGORY_COLORS[category] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${color}`}>
      <Icon size={15} />
    </span>
  );
}

function LivePreviewCard({ form, saving }: { form: FormState; saving: boolean }) {
  const Icon = CATEGORY_ICONS[form.assetCategory] || FileText;
  const fields = [
    { label: "Asset Name",     value: form.assetName || "—", done: !!form.assetName },
    { label: "Category",       value: form.assetCategory || "—", done: !!form.assetCategory },
    { label: "Brand / Model",  value: [form.brand, form.model].filter(Boolean).join(" · ") || "—", done: !!(form.brand || form.model) },
    { label: "Serial No.",     value: form.serialNumber || "—", done: !!form.serialNumber },
    { label: "Purchase Cost",  value: form.purchaseCost ? fmtCur(parseFloat(form.purchaseCost)) : "—", done: !!form.purchaseCost },
    { label: "Purchase Date",  value: form.purchaseDate ? fmtDate(form.purchaseDate) : "—", done: !!form.purchaseDate },
    { label: "Activation Date",value: form.activationDate ? fmtDate(form.activationDate) : "—", done: !!form.activationDate },
    { label: "Location",       value: form.location || "—", done: !!form.location },
    { label: "Custodian",      value: form.custodian || "—", done: !!form.custodian },
  ];
  const doneCount = fields.filter((f) => f.done).length;
  const pct = Math.round((doneCount / fields.length) * 100);

  return (
    <div className="relative bg-card border border-border rounded-xl overflow-hidden h-fit shadow-lg shadow-black/5 dark:shadow-black/20">
      <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-4 text-white">
        <p className="text-[10px] uppercase tracking-wide text-white/70 mb-1.5">Draft Document</p>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 shrink-0">
            <Icon size={16} />
          </span>
          <p className="text-sm font-bold truncate">{form.assetName || "New Fixed Asset"}</p>
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        {fields.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              {f.done ? <CheckCircle2 size={12} className="text-emerald-500 transition-colors" /> : <Circle size={12} className="text-muted-foreground/30" />}
              {f.label}
            </span>
            <span className={`font-medium text-right truncate transition-colors ${f.done ? "text-foreground" : "text-muted-foreground/50"}`}>
              {f.value}
            </span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-4">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">{pct}% filled</p>
      </div>

      {saving && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/95 backdrop-blur-sm">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse">
            <FileText size={20} />
          </span>
          <p className="text-xs font-medium text-muted-foreground">Creating record…</p>
        </div>
      )}
    </div>
  );
}

export default function FixedAssetRecord() {
  const rights = usePageRights("fixed-asset-record");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";

  const [viewMode,   setViewMode]   = useState<ViewMode>("list");
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [viewingId,  setViewingId]  = useState<number | null>(null);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);
  const [form,       setForm]       = useState<FormState>(emptyForm(activeFinYear));

  // ── filters ──
  const [filterCompany] = useState("");
  const [filterProject] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus,   setFilterStatus]   = useState("");
  const [filterFinYear,  setFilterFinYear]  = useState("");
  const [search,         setSearch]         = useState("");

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data queries ──────────────────────────────────────────────────────────
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn:  () => getFixedAssets(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn:  () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn:  () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn:  getSuppliers,
  });
  const { data: depSetups = [] } = useQuery({
    queryKey: ["depreciation-setups-active"],
    queryFn:  getActiveDepreciationSetups,
  });

  // ── detail query for view/edit ────────────────────────────────────────────
  const { data: detailData } = useQuery({
    queryKey: ["fixed-asset", viewingId ?? editingId],
    queryFn:  () => getFixedAsset((viewingId ?? editingId)!),
    enabled:  viewMode === "detail" || (viewMode === "form" && editingId != null),
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const suppliers = ensureArray<{ LHeadId: number; LHeadName: string }>(suppliersRaw);

  // Category options come from live Depreciation Setup rows (the actual
  // backend source) — falls back to the seed list only until the first
  // active rate is configured there.
  const categoryOptions = useMemo(() => {
    const fromSetups = Array.from(new Set(depSetups.map((d) => d.AssetCategory))).sort();
    return fromSetups.length > 0 ? fromSetups : ASSET_CATEGORIES;
  }, [depSetups]);

  // ── portfolio stats (for the KPI strip) ───────────────────────────────────
  const portfolioStats = useMemo(() => {
    const live = ensureArray<FixedAssetListItem>(assets).filter((a) => a.Status !== "Deleted");
    let totalCost = 0;
    let totalBookValue = 0;
    let activeCount = 0;
    let soldCount = 0;
    for (const a of live) {
      totalCost += a.PurchaseCost || 0;
      const dc = a.PurchaseDate && a.DepreciationRate
        ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
        : null;
      totalBookValue += dc ? dc.bookValue : (a.PurchaseCost || 0);
      if (a.AssetStatus === "Active") activeCount++;
      if (a.AssetStatus === "Sold") soldCount++;
    }
    return { count: live.length, totalCost, totalBookValue, activeCount, soldCount };
  }, [assets]);

  // ── book value by category (for the portfolio-style bar chart) ───────────
  const categoryBreakdown = useMemo(() => {
    const live = ensureArray<FixedAssetListItem>(assets).filter((a) => a.Status !== "Deleted");
    const map = new Map<string, number>();
    for (const a of live) {
      const dc = a.PurchaseDate && a.DepreciationRate
        ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
        : null;
      const bv = dc ? dc.bookValue : (a.PurchaseCost || 0);
      map.set(a.AssetCategory, (map.get(a.AssetCategory) || 0) + bv);
    }
    const entries = Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const max = entries.length ? entries[0][1] : 0;
    return { entries, max };
  }, [assets]);

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<FixedAssetListItem>(assets).filter((a) => a.Status !== "Deleted");
    if (filterCompany)  r = r.filter((a) => String(a.CompanyId)  === filterCompany);
    if (filterProject)  r = r.filter((a) => String(a.ProjectId)  === filterProject);
    if (filterCategory) r = r.filter((a) => a.AssetCategory      === filterCategory);
    if (filterStatus)   r = r.filter((a) => a.AssetStatus        === filterStatus);
    if (filterFinYear)  r = r.filter((a) => a.FinYear            === filterFinYear);
    if (search.trim())  {
      const s = search.toLowerCase();
      r = r.filter((a) =>
        a.AssetName.toLowerCase().includes(s) ||
        (a.AssetCode || "").toLowerCase().includes(s) ||
        (a.SerialNumber || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [assets, filterCompany, filterProject, filterCategory, filterStatus, filterFinYear, search]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createFixedAsset,
    onSuccess: (r) => {
      toast.success(`Asset created — ${r.docNo} (${r.assetCode})`);
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateFixedAsset>[1] }) =>
      updateFixedAsset(id, data),
    onSuccess: () => {
      toast.success("Asset updated");
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset", editingId] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteFixedAsset,
    onSuccess: () => {
      toast.success("Asset deleted");
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setForm(emptyForm(activeFinYear));
    setEditingId(null);
    setViewingId(null);
  };

  const goToCreate = () => {
    resetForm();
    setViewMode("form");
  };

  const goToEdit = useCallback((item: FixedAssetListItem) => {
    setEditingId(item.AssetId);
    setViewMode("form");
  }, []);

  const goToView = useCallback((item: FixedAssetListItem) => {
    setViewingId(item.AssetId);
    setViewMode("detail");
  }, []);

  // Populate form when detail loads for editing
  React.useEffect(() => {
    if (viewMode === "form" && editingId && detailData) {
      const d = detailData as FixedAssetDetail;
      setForm({
        docDate:             d.DocDate?.slice(0, 10) || "",
        companyId:           String(d.CompanyId || ""),
        projectId:           String(d.ProjectId || ""),
        finYear:             d.FinYear || "",
        assetName:           d.AssetName || "",
        assetCategory:       d.AssetCategory || "",
        brand:               d.Brand || "",
        model:               d.Model || "",
        serialNumber:        d.SerialNumber || "",
        purchaseDate:        d.PurchaseDate?.slice(0, 10) || "",
        activationDate:      d.ActivationDate?.slice(0, 10) || "",
        purchaseInvoiceRef:  d.PurchaseInvoiceRef || "",
        supplierId:          String(d.SupplierId || ""),
        purchaseCost:        String(d.PurchaseCost || ""),
        quantity:            String(d.Quantity || "1"),
        location:            d.Location || "",
        department:          d.Department || "",
        custodian:           d.Custodian || "",
        depreciationSetupId: String(d.DepreciationSetupId || ""),
        depreciationType:    d.DepreciationType || "",
        depreciationRate:    String(d.DepreciationRate || ""),
        usefulLife:          String(d.UsefulLife || ""),
        assetStatus:         d.AssetStatus || "Active",
        sellingPrice:        String(d.SellingPrice || ""),
        saleDate:            d.SaleDate?.slice(0, 10) || "",
        buyerName:           d.BuyerName || "",
        saleRemarks:         d.SaleRemarks || "",
        remarks:             d.Remarks || "",
      });
    }
  }, [viewMode, editingId, detailData]);

  // Auto-fetch depreciation when category changes
  const handleCategoryChange = (cat: string) => {
    setField("assetCategory", cat);
    const setup = depSetups.find((d) => d.AssetCategory === cat);
    if (setup) {
      setForm((p) => ({
        ...p,
        assetCategory:       cat,
        depreciationSetupId: String(setup.SetupId),
        depreciationType:    setup.DepreciationType,
        depreciationRate:    String(setup.DepreciationRate),
      }));
    } else {
      setForm((p) => ({
        ...p,
        assetCategory:       cat,
        depreciationSetupId: "",
        depreciationType:    "",
        depreciationRate:    "",
      }));
    }
  };

  const handleSave = () => {
    if (!form.assetName.trim())    return toast.error("Asset name is required");
    if (!form.assetCategory)       return toast.error("Asset category is required");
    if (!form.purchaseCost)        return toast.error("Purchase cost is required");

    const payload = {
      docDate:             form.docDate || undefined,
      companyId:           form.companyId ? Number(form.companyId) : undefined,
      projectId:           form.projectId ? Number(form.projectId) : undefined,
      finYear:             form.finYear || undefined,
      assetName:           form.assetName,
      assetCategory:       form.assetCategory,
      brand:               form.brand || undefined,
      model:               form.model || undefined,
      serialNumber:        form.serialNumber || undefined,
      purchaseDate:        form.purchaseDate || undefined,
      activationDate:      form.activationDate || undefined,
      purchaseInvoiceRef:  form.purchaseInvoiceRef || undefined,
      supplierId:          form.supplierId ? Number(form.supplierId) : undefined,
      purchaseCost:        parseFloat(form.purchaseCost) || 0,
      quantity:            parseFloat(form.quantity) || 1,
      location:            form.location || undefined,
      department:          form.department || undefined,
      custodian:           form.custodian || undefined,
      depreciationSetupId: form.depreciationSetupId ? Number(form.depreciationSetupId) : undefined,
      depreciationType:    form.depreciationType || undefined,
      depreciationRate:    form.depreciationRate ? parseFloat(form.depreciationRate) : undefined,
      usefulLife:          form.usefulLife ? parseInt(form.usefulLife, 10) : undefined,
      assetStatus:         form.assetStatus || "Active",
      sellingPrice:        form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
      saleDate:            form.saleDate || undefined,
      buyerName:           form.buyerName || undefined,
      saleRemarks:         form.saleRemarks || undefined,
      remarks:             form.remarks || undefined,
    };

    if (editingId) updateMut.mutate({ id: editingId, data: payload });
    else           createMut.mutate(payload);
  };

  // ── depreciation calc for form ────────────────────────────────────────────
  const depCalc = useMemo(() => {
    if (!form.purchaseCost || !form.depreciationRate || !form.purchaseDate) return null;
    return calcDepreciation(
      parseFloat(form.purchaseCost),
      parseFloat(form.depreciationRate),
      form.purchaseDate,
    );
  }, [form.purchaseCost, form.depreciationRate, form.purchaseDate]);

  const profitLoss = useMemo(() => {
    if (!depCalc || !form.sellingPrice) return null;
    const pl = parseFloat(form.sellingPrice) - depCalc.bookValue;
    return { value: pl, isProfit: pl >= 0 };
  }, [depCalc, form.sellingPrice]);

  const saving = createMut.isPending || updateMut.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "detail" && detailData) {
    const d = detailData as FixedAssetDetail;
    const dc = d.PurchaseDate && d.DepreciationRate
      ? calcDepreciation(d.PurchaseCost, d.DepreciationRate, d.PurchaseDate)
      : null;
    const pl = dc && d.SellingPrice != null
      ? { value: d.SellingPrice - dc.bookValue, isProfit: d.SellingPrice >= dc.bookValue }
      : null;

    return (
      <MaterialShell
        title={d.DocNo || "Fixed Asset"}
        subtitle={`${d.AssetCategory} · ${d.AssetCode || ""}`}
        icon={Cpu}
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition">
              <ArrowLeft size={14} /> Back
            </button>
            {rights.canEdit && (
              <button onClick={() => goToEdit(d as unknown as FixedAssetListItem)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white text-sm font-semibold hover:shadow-lg transition">
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-5 max-w-6xl">
          {/* hero header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 rounded-2xl p-5 text-white">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 shrink-0">
                  {React.createElement(CATEGORY_ICONS[d.AssetCategory] || Package, { size: 22 })}
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold truncate">{d.AssetName}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="inline-flex px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-medium">
                      {d.AssetCategory}
                    </span>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[d.AssetStatus] ?? "bg-white/15"}`}>
                      {d.AssetStatus}
                    </span>
                    {d.AssetCode && (
                      <span className="inline-flex items-center gap-1 text-xs text-white/70 font-mono">
                        <Hash size={11} /> {d.AssetCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-white/70">Current Book Value</p>
                <p className="text-2xl font-bold tabular-nums">{dc ? fmtCur(dc.bookValue) : fmtCur(d.PurchaseCost)}</p>
              </div>
            </div>
            {dc && (
              <div className="mt-4">
                <div className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full rounded-full bg-white/80" style={{ width: `${Math.min(100, (dc.bookValue / d.PurchaseCost) * 100)}%` }} />
                </div>
                <p className="text-[11px] text-white/70 mt-1.5">
                  {fmt((dc.bookValue / d.PurchaseCost) * 100)}% of original value remaining · {dc.years} yrs in service
                </p>
              </div>
            )}
          </div>

          {/* stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Purchase Cost"       value={fmtCur(d.PurchaseCost)} icon={Wallet} />
            <SummaryCard label="Annual Depreciation" value={dc ? fmtCur(dc.annualDep) : "—"} icon={TrendingDown} />
            <SummaryCard label="Total Depreciation"  value={dc ? fmtCur(dc.totalDep) : "—"} color="text-amber-600 dark:text-amber-400" icon={TrendingDown} />
            <SummaryCard label="Current Book Value"  value={dc ? fmtCur(dc.bookValue) : "—"} color="text-emerald-600 dark:text-emerald-400" icon={PackageCheck} />
          </div>

          {/* details grid */}
          <div className={sectionCls}>
            <SectionHeader icon={Package}>Asset Details</SectionHeader>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              {[
                ["Brand",             d.Brand],
                ["Model",             d.Model],
                ["Serial Number",     d.SerialNumber],
                ["Company",           d.CompanyName],
                ["Project",           d.ProjectName],
                ["Financial Year",    d.FinYear],
                ["Purchase Date",     fmtDate(d.PurchaseDate)],
                ["Activation Date",   d.ActivationDate ? fmtDate(d.ActivationDate) : null],
                ["Invoice Ref",       d.PurchaseInvoiceRef],
                ["Supplier",          d.SupplierName],
                ["Quantity",          fmt(d.Quantity)],
                ["Location",          d.Location],
                ["Department",        d.Department],
                ["Custodian",         d.Custodian],
                ["Useful Life",       d.UsefulLife ? `${d.UsefulLife} years` : null],
              ].map(([label, val]) => val ? (
                <div key={label as string}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium mt-0.5">{val}</p>
                </div>
              ) : null)}
            </div>
          </div>

          {/* depreciation */}
          {dc && (
            <div className={sectionCls}>
              <SectionHeader icon={TrendingDown}>Depreciation Details</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {[
                  ["Type",              d.DepreciationType],
                  ["Rate",              d.DepreciationRate ? `${d.DepreciationRate}% p.a.` : null],
                  ["Years Elapsed",     `${dc.years} yrs`],
                  ["Annual Dep.",       fmtCur(dc.annualDep)],
                  ["Total Dep.",        fmtCur(dc.totalDep)],
                  ["Book Value",        fmtCur(dc.bookValue)],
                ].map(([label, val]) => val ? (
                  <div key={label as string}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium mt-0.5">{val}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          )}

          {/* sale info */}
          {d.AssetStatus === "Sold" && (
            <div className={sectionCls}>
              <SectionHeader icon={IndianRupee}>Sale Information</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                {[
                  ["Buyer",        d.BuyerName],
                  ["Sale Date",    fmtDate(d.SaleDate)],
                  ["Purchase Cost",fmtCur(d.PurchaseCost)],
                  ["Book Value",   dc ? fmtCur(dc.bookValue) : null],
                  ["Selling Price",fmtCur(d.SellingPrice)],
                  ["Sale Remarks", d.SaleRemarks],
                ].map(([label, val]) => val ? (
                  <div key={label as string}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium mt-0.5">{val}</p>
                  </div>
                ) : null)}
              </div>
              {pl && (
                <div className={`flex items-center justify-center gap-2 p-3 rounded-lg font-bold text-base ${pl.isProfit ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                  {pl.isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  {pl.isProfit ? "Profit" : "Loss"} on Sale: {fmtCur(Math.abs(pl.value))}
                </div>
              )}
            </div>
          )}

          {d.Remarks && (
            <div className={sectionCls}>
              <SectionHeader icon={FileText}>Remarks</SectionHeader>
              <p className="text-sm text-muted-foreground">{d.Remarks}</p>
            </div>
          )}
        </div>
      </MaterialShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <MaterialShell
        title={editingId ? "Edit Fixed Asset" : "New Fixed Asset"}
        subtitle="Record a new fixed asset with depreciation details"
        icon={Cpu}
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition">
              <ArrowLeft size={14} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white text-sm font-semibold hover:shadow-lg transition disabled:opacity-50">
              <Check size={14} /> {saving ? "Saving…" : "Save Asset"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 xl:gap-8 items-start w-full max-w-[1600px]">
        <div className="space-y-5 min-w-0">
          {/* ── Header Info ── */}
          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Calendar size={11} /> Document Date</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Building2 size={11} /> Company</label>
                <select value={form.companyId} onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); }} className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project</label>
                <select value={form.projectId} onChange={(e) => setField("projectId", e.target.value)} className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Financial Year</label>
                <select value={form.finYear} onChange={(e) => setField("finYear", e.target.value)} className={inputCls}>
                  <option value="">Select year…</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} placeholder="Optional remarks…" className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Asset Details ── */}
          <div className={sectionCls}>
            <SectionHeader icon={Package}>Asset Details</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}>Fixed Asset Name *</label>
                <input type="text" value={form.assetName} onChange={(e) => setField("assetName", e.target.value)} placeholder="e.g. Dell Latitude 5520" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Asset Category *</label>
                <div className="relative">
                  <select value={form.assetCategory} onChange={(e) => handleCategoryChange(e.target.value)} className={`${inputCls} ${form.assetCategory ? "pl-9" : ""}`}>
                    <option value="">Select category…</option>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {form.assetCategory && (
                    <span className={`absolute left-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded ${CATEGORY_COLORS[form.assetCategory] || ""}`}>
                      {React.createElement(CATEGORY_ICONS[form.assetCategory] || Package, { size: 11 })}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>Brand</label>
                <input type="text" value={form.brand} onChange={(e) => setField("brand", e.target.value)} placeholder="e.g. Dell" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input type="text" value={form.model} onChange={(e) => setField("model", e.target.value)} placeholder="e.g. Latitude 5520" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Hash size={11} /> Serial Number</label>
                <input type="text" value={form.serialNumber} onChange={(e) => setField("serialNumber", e.target.value)} placeholder="Serial / IMEI…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.assetStatus} onChange={(e) => setField("assetStatus", e.target.value)} className={inputCls}>
                  {ASSET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Purchase Date</label>
                <input type="date" value={form.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><PlayCircle size={11} /> Activation Date</label>
                <input type="date" value={form.activationDate} onChange={(e) => setField("activationDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Purchase Invoice Ref</label>
                <input type="text" value={form.purchaseInvoiceRef} onChange={(e) => setField("purchaseInvoiceRef", e.target.value)} placeholder="Invoice number…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Supplier</label>
                <select value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} className={inputCls}>
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => <option key={s.LHeadId} value={s.LHeadId}>{s.LHeadName}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><IndianRupee size={11} /> Purchase Cost *</label>
                <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setField("purchaseCost", e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Quantity</label>
                <input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><MapPin size={11} /> Location</label>
                <input type="text" value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="Office / Site…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <input type="text" value={form.department} onChange={(e) => setField("department", e.target.value)} placeholder="Department name…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><User size={11} /> Custodian / Assigned To</label>
                <input type="text" value={form.custodian} onChange={(e) => setField("custodian", e.target.value)} placeholder="Employee name…" className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Depreciation Details ── */}
          <div className={sectionCls}>
            <SectionHeader icon={TrendingDown}>Depreciation Details</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}>Depreciation Type</label>
                <input type="text" value={form.depreciationType} readOnly placeholder="Auto-fetched…"
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
              </div>
              <div>
                <label className={labelCls}>Depreciation Rate (% p.a.)</label>
                <input type="text" value={form.depreciationRate ? `${form.depreciationRate}%` : ""} readOnly placeholder="Auto-fetched from category…"
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
              </div>
              <div>
                <label className={labelCls}>Useful Life (years, optional)</label>
                <input type="number" min="1" value={form.usefulLife} onChange={(e) => setField("usefulLife", e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* live calc */}
            {depCalc && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Purchase Cost"       value={fmtCur(parseFloat(form.purchaseCost))} icon={Wallet} />
                  <SummaryCard label="Annual Depreciation" value={fmtCur(depCalc.annualDep)} icon={TrendingDown} />
                  <SummaryCard label="Total Depreciation"  value={fmtCur(depCalc.totalDep)} color="text-amber-600 dark:text-amber-400" icon={TrendingDown} />
                  <SummaryCard label="Current Book Value"  value={fmtCur(depCalc.bookValue)} color="text-emerald-600 dark:text-emerald-400" icon={PackageCheck} />
                </div>
                <div>
                  <DepreciationBar bookValue={depCalc.bookValue} cost={parseFloat(form.purchaseCost)} />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {fmt((depCalc.bookValue / parseFloat(form.purchaseCost)) * 100)}% of value remaining · {depCalc.years} yrs in service
                  </p>
                </div>
              </>
            )}
            {form.assetCategory && !form.depreciationRate && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle size={12} /> No active depreciation rate found for "{form.assetCategory}". Add one in Depreciation Setup.
              </p>
            )}
          </div>

          {/* ── Sale Section ── */}
          {(form.assetStatus === "Sold" || form.sellingPrice) && (
            <div className={sectionCls}>
              <SectionHeader icon={IndianRupee}>Asset Sale</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 xl:gap-5">
                <div>
                  <label className={labelCls}>Selling Price (₹)</label>
                  <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setField("sellingPrice", e.target.value)} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}><Calendar size={11} /> Sale Date</label>
                  <input type="date" value={form.saleDate} onChange={(e) => setField("saleDate", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Buyer Name</label>
                  <input type="text" value={form.buyerName} onChange={(e) => setField("buyerName", e.target.value)} placeholder="Buyer name…" className={inputCls} />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className={labelCls}>Sale Remarks</label>
                  <input type="text" value={form.saleRemarks} onChange={(e) => setField("saleRemarks", e.target.value)} placeholder="Optional remarks…" className={inputCls} />
                </div>
              </div>
              {depCalc && form.sellingPrice && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Purchase Cost"   value={fmtCur(parseFloat(form.purchaseCost))} />
                  <SummaryCard label="Total Dep."      value={fmtCur(depCalc.totalDep)} />
                  <SummaryCard label="Book Value"      value={fmtCur(depCalc.bookValue)} />
                  <SummaryCard label="Selling Price"   value={fmtCur(parseFloat(form.sellingPrice))} />
                </div>
              )}
              {profitLoss && (
                <div className={`flex items-center justify-center gap-2 p-3 rounded-lg font-bold text-base ${profitLoss.isProfit ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                  {profitLoss.isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  {profitLoss.isProfit ? "Profit" : "Loss"} on Sale: {fmtCur(Math.abs(profitLoss.value))}
                </div>
              )}
            </div>
          )}

          {/* show sale section toggle when status is not Sold yet */}
          {form.assetStatus !== "Sold" && !form.sellingPrice && (
            <button type="button"
              onClick={() => setField("assetStatus", "Sold")}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
              <Plus size={14} /> Add Sale Details
            </button>
          )}
        </div>

        <LivePreviewCard form={form} saving={saving} />
        </div>
      </MaterialShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <MaterialShell
      title="Fixed Asset Record"
      subtitle="Track and manage all fixed assets with depreciation"
      icon={Cpu}
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white text-sm font-semibold hover:shadow-lg transition">
            <Plus size={16} /> New Asset
          </button>
        )
      }
    >
      {/* ── Portfolio summary — value hero + book-value-by-category chart,
          styled the same as PO/GRN's Card-based summary sections ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4 mb-5">
        <Card className="border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 px-5 py-4 text-white">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              Total Book Value
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {fmtCur(portfolioStats.totalBookValue)}
            </p>
            <p className="text-xs text-white/70 mt-1">
              of {fmtCur(portfolioStats.totalCost)} original purchase value
            </p>
          </div>
          <CardContent className="p-4">
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard label="Total Assets" value={fmt(portfolioStats.count)} icon={Boxes} />
              <SummaryCard label="Active" value={fmt(portfolioStats.activeCount)} color="text-emerald-600 dark:text-emerald-400" icon={PlayCircle} />
              <SummaryCard label="Sold" value={fmt(portfolioStats.soldCount)} color="text-amber-600 dark:text-amber-400" icon={IndianRupee} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-600 dark:text-emerald-400" />
              Book Value by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {categoryBreakdown.entries.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-9">
                No assets yet
              </p>
            ) : (
              <div className="flex items-end justify-between gap-2.5 h-[148px]">
                {categoryBreakdown.entries.map(([cat, value], i) => {
                  const Icon = CATEGORY_ICONS[cat] || Package;
                  const barColor = BAR_PALETTE[i % BAR_PALETTE.length];
                  const pct =
                    categoryBreakdown.max > 0
                      ? Math.max(8, (value / categoryBreakdown.max) * 100)
                      : 0;
                  return (
                    <div
                      key={cat}
                      className="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full"
                    >
                      <span
                        className="text-[9px] font-mono text-muted-foreground truncate w-full text-center"
                        title={fmtCurCompact(value)}
                      >
                        {fmtCurCompact(value)}
                      </span>
                      <div className="flex-1 w-full flex items-end justify-center">
                        <div
                          className={`w-6 rounded-t-md ${barColor} transition-all`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <Icon size={11} className="text-muted-foreground shrink-0" />
                      <span
                        className="text-[9px] text-muted-foreground truncate w-full text-center"
                        title={cat}
                      >
                        {cat}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── filters ── */}
      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className={labelCls}>Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, code, serial…"
                  className={`${inputCls} pl-8`} />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={inputCls}>
                <option value="">All Categories</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={inputCls}>
                <option value="">All Status</option>
                {ASSET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="w-full sm:w-48">
              <label className={labelCls}>Financial Year</label>
              <select value={filterFinYear} onChange={(e) => setFilterFinYear(e.target.value)} className={inputCls}>
                <option value="">All Years</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 sm:ml-auto">
              {(filterCategory || filterStatus || filterFinYear || search) && (
                <button
                  onClick={() => { setFilterCategory(""); setFilterStatus(""); setFilterFinYear(""); setSearch(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                >
                  Clear filters
                </button>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {filtered.length} of {portfolioStats.count} assets
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── register — same Card wrapper GRN.tsx uses for its register ── */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Asset Register</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} of {portfolioStats.count} asset{portfolioStats.count !== 1 ? "s" : ""}
          </p>
        </CardHeader>
        <CardContent className="p-0">
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
            <Cpu size={26} className="opacity-40" />
          </span>
          <p className="text-sm">No fixed assets found</p>
          {rights.canCreate && (
            <button onClick={goToCreate}
              className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              <Plus size={13} /> Add First Asset
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Company / Project</th>
                <th className="px-4 py-3 text-left">Purchase Date</th>
                <th className="px-4 py-3 text-right">Purchase Cost</th>
                <th className="px-4 py-3 text-left">Book Value</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((a) => {
                const dc = a.PurchaseDate && a.DepreciationRate
                  ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
                  : null;
                const bookValue = dc ? dc.bookValue : a.PurchaseCost;
                return (
                  <tr key={a.AssetId} className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => goToView(a)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <CategoryBadge category={a.AssetCategory} />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{a.AssetName}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{a.AssetCode || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.AssetCategory}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.CompanyName || "—"}{a.ProjectName ? ` / ${a.ProjectName}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.PurchaseDate)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{fmtCur(a.PurchaseCost)}</td>
                    <td className="px-4 py-3 min-w-[130px]">
                      <p className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{fmtCur(bookValue)}</p>
                      {dc && <div className="mt-1"><DepreciationBar bookValue={dc.bookValue} cost={a.PurchaseCost} /></div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[a.AssetStatus] ?? ""}`}>
                        {a.AssetStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => goToView(a)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="View">
                          <Eye size={13} />
                        </button>
                        {rights.canEdit && (
                          <button onClick={() => goToEdit(a)}
                            className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Edit">
                            <Pencil size={13} />
                          </button>
                        )}
                        {rights.canDelete && (
                          <button onClick={() => setDeleteId(a.AssetId)}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </CardContent>
      </Card>

      {/* ── delete confirm ── */}
      {deleteId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={20} className="text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Delete this asset?</p>
                <p className="text-xs text-muted-foreground mt-0.5">The asset will be marked as deleted and removed from the list.</p>
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
        </div>,
        document.body
      )}
    </MaterialShell>
  );
}
