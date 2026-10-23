// Types, formatters, form conversions and the sheet styles shared by the Fixed Asset Depreciation Tag page and its parts.
import React from "react";
import type { ExportColumn } from "@/lib/export";
import type { FixedAssetDetail, FixedAssetListItem } from "@/api/fixedAssetApi";

export const ASSET_STATUS_OPTIONS = ["Pending", "Active", "Sold", "Scrapped", "Under Maintenance"] as const;
export const DEP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface FormState {
  docDate: string;
  companyId: string;
  projectId: string;
  finYear: string;
  assetName: string;
  sourceTagId: string;
  faItemCode: string;
  godownId: string;
  godownName: string;
  assetCategory: string;
  repairType: string;
  brand: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  activationDate: string;
  purchaseInvoiceRef: string;
  supplierId: string;
  purchaseCost: string;
  quantity: string;
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
  pictureBase64: string;
}

export const emptyForm = (finYear = ""): FormState => ({
  docDate: new Date().toISOString().slice(0, 10),
  companyId: "",
  projectId: "",
  finYear,
  assetName: "",
  sourceTagId: "",
  faItemCode: "",
  godownId: "",
  godownName: "",
  assetCategory: "",
  repairType: "",
  brand: "",
  model: "",
  serialNumber: "",
  purchaseDate: "",
  activationDate: "",
  purchaseInvoiceRef: "",
  supplierId: "",
  purchaseCost: "",
  quantity: "1",
  depreciationSetupId: "",
  depreciationType: "",
  depreciationRate: "",
  usefulLife: "",
  assetStatus: "Active",
  sellingPrice: "",
  saleDate: "",
  buyerName: "",
  saleRemarks: "",
  remarks: "",
  pictureBase64: "",
});

export const detailToForm = (d: FixedAssetDetail): FormState => ({
  docDate: d.DocDate?.slice(0, 10) || "",
  companyId: String(d.CompanyId || ""),
  projectId: String(d.ProjectId || ""),
  finYear: d.FinYear || "",
  assetName: d.AssetName || "",
  sourceTagId: String(d.SourceTagId || ""),
  faItemCode: d.FAItemCode || "",
  godownId: String(d.GodownID || ""),
  godownName: d.GodownName || "",
  assetCategory: d.AssetCategory || "",
  repairType: d.RepairType || "",
  brand: d.Brand || "",
  model: d.Model || "",
  serialNumber: d.SerialNumber || "",
  purchaseDate: d.PurchaseDate?.slice(0, 10) || "",
  activationDate: d.ActivationDate?.slice(0, 10) || "",
  purchaseInvoiceRef: d.PurchaseInvoiceRef || "",
  supplierId: String(d.SupplierId || ""),
  purchaseCost: String(d.PurchaseCost || ""),
  quantity: String(d.Quantity || "1"),
  depreciationSetupId: String(d.DepreciationSetupId || ""),
  depreciationType: d.DepreciationType || "",
  depreciationRate: String(d.DepreciationRate || ""),
  usefulLife: String(d.UsefulLife || ""),
  assetStatus: d.AssetStatus || "Active",
  sellingPrice: String(d.SellingPrice || ""),
  saleDate: d.SaleDate?.slice(0, 10) || "",
  buyerName: d.BuyerName || "",
  saleRemarks: d.SaleRemarks || "",
  remarks: d.Remarks || "",
  pictureBase64: d.PictureBase64 || "",
});

/** What the asset is worth on the books: cost less the depreciation actually posted against it. */
export const bookValue = (a: Pick<FixedAssetListItem, "PurchaseCost" | "Depreciated">) =>
  Math.max(0, (a.PurchaseCost || 0) - (a.Depreciated || 0));

/** Straight-line estimate from the purchase date, for the form before anything is posted. */
export function estimateDepreciation(purchaseCost: number, rate: number, purchaseDate: string) {
  if (!purchaseCost || !rate || !purchaseDate) return null;
  const years = Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const annualDep = purchaseCost * (rate / 100);
  const totalDep = Math.min(purchaseCost, annualDep * years);
  return { years: parseFloat(years.toFixed(2)), annualDep, totalDep, bookValue: Math.max(0, purchaseCost - totalDep) };
}

export const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));
export const fmtCur = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** How an asset's status reads as a sheet mark: in use is settled, scrapped has stopped, the rest are in between. */
export const assetTone = (status: string): "done" | "waiting" | "stopped" =>
  status === "Active" || status === "Sold" ? "done" : status === "Scrapped" ? "stopped" : "waiting";

export const ensureArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// What the register's Export writes: the assets the page is showing (search and filters applied).
const exportDate = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-IN") : "");
export const FA_REGISTER_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Doc Date", accessor: (r) => exportDate(r.DocDate) },
  { header: "Fin Year", accessor: "FinYear" },
  { header: "Asset Code", accessor: "AssetCode" },
  { header: "FA Item Code", accessor: "FAItemCode" },
  { header: "Asset Name", accessor: "AssetName" },
  { header: "Category", accessor: "AssetCategory" },
  { header: "Brand", accessor: "Brand" },
  { header: "Model", accessor: "Model" },
  { header: "Serial No", accessor: "SerialNumber" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Godown", accessor: "GodownName" },
  { header: "Location", accessor: "Location" },
  { header: "Department", accessor: "Department" },
  { header: "Custodian", accessor: "Custodian" },
  { header: "Supplier", accessor: "SupplierName" },
  { header: "Purchase Date", accessor: (r) => exportDate(r.PurchaseDate) },
  { header: "Activation Date", accessor: (r) => exportDate(r.ActivationDate) },
  { header: "Quantity", accessor: (r) => Number(r.Quantity) || 0 },
  { header: "Purchase Cost", accessor: (r) => Number(r.PurchaseCost) || 0 },
  { header: "Depreciation Rate %", accessor: (r) => (r.DepreciationRate == null ? "" : Number(r.DepreciationRate)) },
  { header: "Depreciation Posted", accessor: (r) => Number(r.Depreciated) || 0 },
  { header: "Book Value", accessor: (r) => bookValue(r as unknown as FixedAssetListItem) },
  { header: "Asset Status", accessor: "AssetStatus" },
];

// ── Sheet styles ──
export const RULE = "1px solid hsl(var(--foreground))";
export const RULE_SOFT = "1px solid hsl(var(--foreground) / 0.2)";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const KEY_RED = `${KEY} bg-destructive text-white border border-destructive`;
export const INP = "w-full h-10 border border-foreground/40 focus:border-foreground bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const READ_ONLY = "w-full h-10 border border-dashed border-foreground/30 bg-muted/30 px-3 text-sm text-muted-foreground flex items-center";

export const Field: React.FC<{ label: string; required?: boolean; note?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ label, required, note, className, children }) => (
  <div className={`space-y-1.5 min-w-0 ${className ?? ""}`}>
    <label className={`block ${LBL}`}>
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {note && <p className="text-[0.6875rem] text-muted-foreground">{note}</p>}
  </div>
);

/** A titled block of the form or the detail view. */
export const Block: React.FC<{ title: string; note?: React.ReactNode; children: React.ReactNode }> = ({ title, note, children }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <div className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</span>
      {note && <span className="text-[0.6875rem] text-muted-foreground">{note}</span>}
    </div>
    <div className="p-5 space-y-5">{children}</div>
  </div>
);

/** A row of figures in ruled cells. */
export const Figures: React.FC<{ items: { label: string; value: string; tone?: "red" | "blue" }[] }> = ({ items }) => (
  // The 1px gap over a ruled background draws the lines between cells at any column count.
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ border: RULE, background: "hsl(var(--foreground) / 0.2)" }}>
    {items.map((x) => (
      <div key={x.label} className="px-4 py-3 min-w-0 bg-card">
        <p className={LBL}>{x.label}</p>
        <p className={`font-heading text-base font-bold tabular-nums mt-0.5 truncate ${x.tone === "red" ? "text-destructive" : x.tone === "blue" ? "text-primary" : "text-foreground"}`}>{x.value}</p>
      </div>
    ))}
  </div>
);

/** Thin ruled bar: how much of the cost is still on the books. */
export const ValueBar: React.FC<{ value: number; cost: number }> = ({ value, cost }) => {
  const pct = cost > 0 ? Math.min(100, Math.max(0, (value / cost) * 100)) : 0;
  return (
    <span className="block h-[7px] w-full" style={{ border: "1px solid hsl(var(--foreground) / 0.5)" }}>
      <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
};
