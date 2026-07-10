import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Eye, Pencil, Trash2, AlertCircle, Search,
  Building2, Package, TrendingDown, IndianRupee, Calendar, User,
  FileText, MapPin, Hash, Cpu, ChevronDown, Check, X,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getSuppliers } from "@/api/grnApi";
import { getActiveDepreciationSetups, type DepreciationSetup } from "@/api/depreciationApi";
import {
  getFixedAssets, getFixedAsset, createFixedAsset, updateFixedAsset, deleteFixedAsset,
  type FixedAssetListItem, type FixedAssetDetail,
} from "@/api/fixedAssetApi";

// ── constants ─────────────────────────────────────────────────────────────────
const ASSET_CATEGORIES = [
  "Laptop", "Desktop", "Mobile Phone", "Printer", "Scanner",
  "Furniture", "Vehicle", "Machinery", "Other",
];

const ASSET_STATUS_OPTIONS = ["Active", "Sold", "Scrapped", "Under Maintenance"] as const;

const STATUS_COLORS: Record<string, string> = {
  Active:             "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Sold:               "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Scrapped:           "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Under Maintenance":"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
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
  const [filterCompany,  setFilterCompany]  = useState("");
  const [filterProject,  setFilterProject]  = useState("");
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
    return ensureArray<{ id: number; name: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const suppliers = ensureArray<{ LHeadId: number; LHeadName: string }>(suppliersRaw);

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

  // ── styles ────────────────────────────────────────────────────────────────
  const inputCls = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";
  const sectionTitle = "text-sm font-semibold text-foreground mb-4 flex items-center gap-2";
  const saving = createMut.isPending || updateMut.isPending;

  // ── summary card component ─────────────────────────────────────────────────
  const SummaryCard = ({ label, value, color = "" }: { label: string; value: string; color?: string }) => (
    <div className="bg-muted/40 rounded-lg p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-bold ${color}`}>{value}</p>
    </div>
  );

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
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition">
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-5 max-w-4xl">
          {/* header summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Purchase Cost"       value={fmtCur(d.PurchaseCost)} />
            <SummaryCard label="Annual Depreciation" value={dc ? fmtCur(dc.annualDep) : "—"} />
            <SummaryCard label="Total Depreciation"  value={dc ? fmtCur(dc.totalDep) : "—"} color="text-amber-600 dark:text-amber-400" />
            <SummaryCard label="Current Book Value"  value={dc ? fmtCur(dc.bookValue) : "—"} color="text-emerald-600 dark:text-emerald-400" />
          </div>

          {/* status + codes */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[d.AssetStatus] ?? ""}`}>
              {d.AssetStatus}
            </span>
            {d.AssetCode && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-mono">
                <Hash size={11} /> {d.AssetCode}
              </span>
            )}
            {d.DocNo && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-mono">
                <FileText size={11} /> {d.DocNo}
              </span>
            )}
          </div>

          {/* details grid */}
          <div className={sectionCls}>
            <p className={sectionTitle}><Package size={15} /> Asset Details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {[
                ["Asset Name",        d.AssetName],
                ["Category",          d.AssetCategory],
                ["Brand",             d.Brand],
                ["Model",             d.Model],
                ["Serial Number",     d.SerialNumber],
                ["Company",           d.CompanyName],
                ["Project",           d.ProjectName],
                ["Financial Year",    d.FinYear],
                ["Purchase Date",     fmtDate(d.PurchaseDate)],
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
              <p className={sectionTitle}><TrendingDown size={15} /> Depreciation Details</p>
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
              <p className={sectionTitle}><IndianRupee size={15} /> Sale Information</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
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
                <div className={`mt-3 p-3 rounded-lg text-center font-bold text-base ${pl.isProfit ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                  {pl.isProfit ? "Profit" : "Loss"} on Sale: {fmtCur(Math.abs(pl.value))}
                </div>
              )}
            </div>
          )}

          {d.Remarks && (
            <div className={sectionCls}>
              <p className={sectionTitle}><FileText size={15} /> Remarks</p>
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
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition disabled:opacity-50">
              <Check size={14} /> {saving ? "Saving…" : "Save Asset"}
            </button>
          </div>
        }
      >
        <div className="space-y-5 max-w-4xl">

          {/* ── Header Info ── */}
          <div className={sectionCls}>
            <p className={sectionTitle}><FileText size={15} /> Header Information</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Document Date</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Company</label>
                <select value={form.companyId} onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); }} className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; name: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project</label>
                <select value={form.projectId} onChange={(e) => setField("projectId", e.target.value)} className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            <p className={sectionTitle}><Package size={15} /> Asset Details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className={labelCls}>Fixed Asset Name *</label>
                <input type="text" value={form.assetName} onChange={(e) => setField("assetName", e.target.value)} placeholder="e.g. Dell Latitude 5520" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Asset Category *</label>
                <select value={form.assetCategory} onChange={(e) => handleCategoryChange(e.target.value)} className={inputCls}>
                  <option value="">Select category…</option>
                  {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
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
                <label className={labelCls}>Serial Number</label>
                <input type="text" value={form.serialNumber} onChange={(e) => setField("serialNumber", e.target.value)} placeholder="Serial / IMEI…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.assetStatus} onChange={(e) => setField("assetStatus", e.target.value)} className={inputCls}>
                  {ASSET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Purchase Date</label>
                <input type="date" value={form.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} className={inputCls} />
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
                <label className={labelCls}>Purchase Cost (₹) *</label>
                <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setField("purchaseCost", e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Quantity</label>
                <input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Location</label>
                <input type="text" value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="Office / Site…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <input type="text" value={form.department} onChange={(e) => setField("department", e.target.value)} placeholder="Department name…" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Custodian / Assigned To</label>
                <input type="text" value={form.custodian} onChange={(e) => setField("custodian", e.target.value)} placeholder="Employee name…" className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Depreciation Details ── */}
          <div className={sectionCls}>
            <p className={sectionTitle}><TrendingDown size={15} /> Depreciation Details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Purchase Cost"       value={fmtCur(parseFloat(form.purchaseCost))} />
                <SummaryCard label="Annual Depreciation" value={fmtCur(depCalc.annualDep)} />
                <SummaryCard label="Total Depreciation"  value={fmtCur(depCalc.totalDep)} color="text-amber-600 dark:text-amber-400" />
                <SummaryCard label="Current Book Value"  value={fmtCur(depCalc.bookValue)} color="text-emerald-600 dark:text-emerald-400" />
              </div>
            )}
            {form.assetCategory && !form.depreciationRate && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                <AlertCircle size={12} /> No active depreciation rate found for "{form.assetCategory}". Add one in Depreciation Setup.
              </p>
            )}
          </div>

          {/* ── Sale Section ── */}
          {(form.assetStatus === "Sold" || form.sellingPrice) && (
            <div className={sectionCls}>
              <p className={sectionTitle}><IndianRupee size={15} /> Asset Sale</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Selling Price (₹)</label>
                  <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setField("sellingPrice", e.target.value)} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Sale Date</label>
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
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Purchase Cost"   value={fmtCur(parseFloat(form.purchaseCost))} />
                  <SummaryCard label="Total Dep."      value={fmtCur(depCalc.totalDep)} />
                  <SummaryCard label="Book Value"      value={fmtCur(depCalc.bookValue)} />
                  <SummaryCard label="Selling Price"   value={fmtCur(parseFloat(form.sellingPrice))} />
                </div>
              )}
              {profitLoss && (
                <div className={`mt-3 p-3 rounded-lg text-center font-bold text-base ${profitLoss.isProfit ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
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
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg transition">
            <Plus size={16} /> New Asset
          </button>
        )
      }
    >
      {/* ── filters ── */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, serial…"
            className={`${inputCls} pl-8`} />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={`${inputCls} w-40`}>
          <option value="">All Categories</option>
          {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={`${inputCls} w-40`}>
          <option value="">All Status</option>
          {ASSET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterFinYear} onChange={(e) => setFilterFinYear(e.target.value)} className={`${inputCls} w-36`}>
          <option value="">All Years</option>
          {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
        </select>
      </div>

      {/* ── table ── */}
      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Cpu size={40} className="opacity-30" />
          <p className="text-sm">No fixed assets found</p>
          {rights.canCreate && (
            <button onClick={goToCreate}
              className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              <Plus size={13} /> Add First Asset
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Asset Code</th>
                <th className="px-4 py-3 text-left">Asset Name</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Company / Project</th>
                <th className="px-4 py-3 text-left">Purchase Date</th>
                <th className="px-4 py-3 text-right">Purchase Cost</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Book Value</th>
                <th className="px-4 py-3 text-right">Selling Price</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((a) => {
                const dc = a.PurchaseDate && a.DepreciationRate
                  ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
                  : null;
                return (
                  <tr key={a.AssetId} className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => goToView(a)}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.AssetCode || "—"}</td>
                    <td className="px-4 py-3 font-medium">{a.AssetName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.AssetCategory}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.CompanyName || "—"}{a.ProjectName ? ` / ${a.ProjectName}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.PurchaseDate)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtCur(a.PurchaseCost)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{a.DepreciationRate ? `${a.DepreciationRate}%` : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {dc ? fmtCur(dc.bookValue) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmtCur(a.SellingPrice)}</td>
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

      {/* ── delete confirm ── */}
      {deleteId && (
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
        </div>
      )}
    </MaterialShell>
  );
}
