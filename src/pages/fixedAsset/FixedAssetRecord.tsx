import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Eye, Pencil, Trash2, AlertCircle, Search,
  Building2, Package, TrendingDown, TrendingUp, IndianRupee, Calendar,
  FileText, Hash, Cpu, Check, X, ChevronsUpDown, Loader2, Warehouse,
  Boxes, Wallet, PackageCheck, Circle, CheckCircle2, PlayCircle, Undo2, ShieldAlert,
  Image as ImageIcon, Upload, RefreshCw,
} from "lucide-react";
import { GlassShell, GlassCard } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getSuppliers } from "@/api/grnApi";
import { getActiveDepreciationSetups, type DepreciationSetup } from "@/api/depreciationApi";
import {
  getFixedAssets, getFixedAsset, createFixedAsset, updateFixedAsset, deleteFixedAsset,
  getFixedAssetReversalPlan, reverseFixedAsset,
  getAssetDepreciation, postAssetDepreciation, reverseAssetDepreciation,
  type FixedAssetListItem, type FixedAssetDetail,
} from "@/api/fixedAssetApi";
import { getSacCodes } from "@/api/hsnApi";
import { getUnassignedFAItemCodes, type UnassignedFAItemCode } from "@/api/fixedAssetTaggingApi";
import { ASSET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from "./assetCategories";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ── constants ─────────────────────────────────────────────────────────────────
const ASSET_STATUS_OPTIONS = ["Pending", "Active", "Sold", "Scrapped", "Under Maintenance"] as const;

// Solid fills for the "Book Value by Category" bar chart — CATEGORY_COLORS
// are subtle badge tints (bg-x/10), too washed out to read as a bar fill.
const BAR_PALETTE = [
  "bg-emerald-500", "bg-blue-500", "bg-violet-500",
  "bg-amber-500", "bg-teal-500", "bg-rose-500",
];

const STATUS_COLORS: Record<string, string> = {
  Pending:             "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
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

// ── FA Item Code searchable dropdown (shadcn Popover + Command) ───────────────
function FAItemCodeCombobox({
  codes, value, onSelect, loading,
}: {
  codes: UnassignedFAItemCode[];
  value: number | null;
  onSelect: (code: UnassignedFAItemCode) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = codes.find((c) => c.TagId === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground")}
        >
          <span className="truncate">{selected ? `${selected.FAItemCode} — ${selected.ItemName || "Item"}` : "Search FA Item Code…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search generated FA Item Codes…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>No unassigned FA Item Codes found. Generate one in FA Inventory first.</CommandEmpty>
                <CommandGroup>
                  {codes.map((c) => (
                    <CommandItem
                      key={c.TagId}
                      value={`${c.FAItemCode} ${c.ItemName || ""}`}
                      onSelect={() => { onSelect(c); setOpen(false); }}
                      className="data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50"
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === c.TagId ? "opacity-100" : "opacity-0")} />
                      <span className="flex flex-col min-w-0">
                        <span className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400 truncate">{c.FAItemCode}</span>
                        <span className="text-xs truncate">{c.ItemName || "—"}</span>
                        <span className="text-[11px] text-muted-foreground truncate">
                          {[c.CompanyName, c.ProjectName, c.GodownName].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── form shape ────────────────────────────────────────────────────────────────
interface FormState {
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

const emptyForm = (finYear = ""): FormState => ({
  docDate:            new Date().toISOString().slice(0, 10),
  companyId:          "",
  projectId:          "",
  finYear,
  assetName:          "",
  sourceTagId:        "",
  faItemCode:         "",
  godownId:           "",
  godownName:         "",
  assetCategory:      "",
  repairType:         "",
  brand:              "",
  model:              "",
  serialNumber:       "",
  purchaseDate:       "",
  activationDate:     "",
  purchaseInvoiceRef: "",
  supplierId:         "",
  purchaseCost:       "",
  quantity:           "1",
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
  pictureBase64:      "",
});

type ViewMode = "list" | "form" | "detail";

// ── small presentational helpers ──────────────────────────────────────────────
const inputCls    = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer";
const labelCls    = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
// Layout only — the glass background/border/blur comes from the
// `glassSection` style object (computed per-theme inside the component) so
// every section shares the same glass-panel look the list view uses.
const sectionCls  = "rounded-2xl p-5 space-y-4";

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

function SubGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-heading font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/60 pb-1.5">
        {label}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 xl:gap-5">
        {children}
      </div>
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

const DEP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monthly depreciation posting for an asset:
//   Dr Depreciation Expense A/c  /  Cr Accumulated Depreciation A/c
// The charge is computed by the backend from the asset's SLM/WDV rate.
function DepreciationPostingCard({ assetId, glassSection }: { assetId: number; glassSection: React.CSSProperties }) {
  const rights = usePageRights("fixed-asset-record");
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isFetching } = useQuery({
    queryKey: ["fa-depreciation", assetId, year, month],
    queryFn: () => getAssetDepreciation(assetId, year, month),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fa-depreciation", assetId] });
    qc.invalidateQueries({ queryKey: ["fixed-asset", assetId] });
  };
  const postMut = useMutation({
    mutationFn: () => postAssetDepreciation(assetId, year, month),
    onSuccess: (r) => { toast.success(`Depreciation posted — ${r.voucherNo}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reverseMut = useMutation({
    mutationFn: (entryId: number) => reverseAssetDepreciation(assetId, entryId),
    onSuccess: () => { toast.success("Depreciation entry reversed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = data?.plan ?? null;
  const dep = plan?.depreciation;
  const history = data?.history ?? [];
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 4 + i);

  return (
    <div className={sectionCls} style={glassSection}>
      <SectionHeader icon={TrendingDown}>Depreciation Posting</SectionHeader>
      <p className="text-xs text-muted-foreground">
        Depreciation Expense A/c Dr &nbsp;·&nbsp; To Accumulated Depreciation A/c — one entry per month,
        computed from the asset's {dep?.method || "SLM/WDV"} rate.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={`${inputCls} w-28`}>
            {DEP_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Year</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${inputCls} w-28`}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {rights.canEdit && plan && !plan.error && !plan.isPosted && (
          <button onClick={() => postMut.mutate()} disabled={postMut.isPending}
            className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
            <Check size={13} /> {postMut.isPending ? "Posting…" : `Post ${DEP_MONTHS[month - 1]} ${year}`}
          </button>
        )}
      </div>

      {isFetching && !data ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>
      ) : plan?.error ? (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 py-3">
          <AlertCircle size={14} /> {plan.error}
        </div>
      ) : dep ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              ["Opening Book Value", fmtCur(dep.openingBookValue), "this month"],
              [`Depreciation (${dep.ratePct}% ${dep.method})`, fmtCur(dep.depreciationAmount), "this month"],
              ["Closing Book Value", fmtCur(dep.closingBookValue), "this month"],
              ["Accumulated Dep. (to date)", fmtCur(dep.accumulatedDepreciation), `cumulative through ${DEP_MONTHS[month - 1]} ${year}`],
            ].map(([k, v, hint]) => (
              <div key={k} className="bg-muted/40 rounded-lg p-2">
                <p className="text-muted-foreground">{k}</p>
                <p className="font-semibold tabular-nums mt-0.5">{v}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Journal entry — {DEP_MONTHS[month - 1]} {year} only (current month's depreciation)
            </p>
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-center">Dr/Cr</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(plan.entries ?? []).map((e, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{e.account}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${e.debit ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
                        {e.debit ? "Dr" : "Cr"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCur(e.debit || e.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.isPosted && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Already posted for {DEP_MONTHS[month - 1]} {year}{plan.voucherRef ? ` · voucher ${plan.voucherRef}` : ""}.
            </p>
          )}
        </>
      ) : null}

      {history.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 mt-1">Posted Depreciation History</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  <th className="px-3 py-1.5 text-left">Period</th>
                  <th className="px-3 py-1.5 text-left">Voucher</th>
                  <th className="px-3 py-1.5 text-right">Opening</th>
                  <th className="px-3 py-1.5 text-right">Depreciation</th>
                  <th className="px-3 py-1.5 text-right">Closing</th>
                  <th className="px-3 py-1.5 text-center">Status</th>
                  <th className="px-3 py-1.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.EntryId} className={h.Status === "Reversed" ? "opacity-50" : ""}>
                    <td className="px-3 py-1.5">{DEP_MONTHS[h.PeriodMonth - 1]} {h.PeriodYear}</td>
                    <td className="px-3 py-1.5 font-mono">{h.VoucherNo || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.OpeningBookValue)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.DepreciationAmount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.ClosingBookValue)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${h.Status === "Reversed" ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>{h.Status}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {rights.canEdit && h.Status === "Posted" && (
                        <button onClick={() => reverseMut.mutate(h.EntryId)} disabled={reverseMut.isPending} title="Reverse this entry"
                          className="p-1 rounded text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-muted"><Undo2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DepreciationBar({ bookValue, cost }: { bookValue: number; cost: number }) {
  const pct = cost > 0 ? Math.min(100, Math.max(0, (bookValue / cost) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 transition-all"
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

// ── Item Picture upload ───────────────────────────────────────────────────────
const PICTURE_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp";
const PICTURE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function ItemPicturePicker({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !PICTURE_ACCEPT.includes(file.type)) {
      toast.error("Unsupported format — use JPG, JPEG, PNG or WEBP");
      return;
    }
    if (file.size > PICTURE_MAX_BYTES) {
      toast.error("Image too large — max 4 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.onerror = () => toast.error("Could not read the image file");
    reader.readAsDataURL(file);
  };

  return (
    <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
      <label className={labelCls}><ImageIcon size={11} /> Item Picture</label>
      <input
        ref={inputRef}
        type="file"
        accept={PICTURE_ACCEPT}
        className="hidden"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />
      {value ? (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-background p-3">
          <img
            src={value}
            alt="Fixed asset"
            className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
          />
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Picture attached to this asset.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <RefreshCw size={12} /> Change
              </button>
              <button type="button" onClick={() => onChange("")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={12} /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background py-6 text-muted-foreground hover:border-yellow-500/40 hover:bg-yellow-500/[0.03] transition-colors">
          <Upload size={16} />
          <span className="text-xs font-medium">Upload Picture</span>
          <span className="text-[10px] text-muted-foreground/70">JPG, JPEG, PNG or WEBP · max 4 MB</span>
        </button>
      )}
    </div>
  );
}

function LivePreviewCard({ form, saving, glassStyle }: { form: FormState; saving: boolean; glassStyle: React.CSSProperties }) {
  const Icon = CATEGORY_ICONS[form.assetCategory] || FileText;
  const fields = [
    { label: "Asset Name",     value: form.assetName || "—", done: !!form.assetName },
    { label: "Category",       value: form.assetCategory || "—", done: !!form.assetCategory },
    { label: "Brand / Model",  value: [form.brand, form.model].filter(Boolean).join(" · ") || "—", done: !!(form.brand || form.model) },
    { label: "Purchase Cost",  value: form.purchaseCost ? fmtCur(parseFloat(form.purchaseCost)) : "—", done: !!form.purchaseCost },
    { label: "Purchase Date",  value: form.purchaseDate ? fmtDate(form.purchaseDate) : "—", done: !!form.purchaseDate },
    { label: "Activation Date",value: form.activationDate ? fmtDate(form.activationDate) : "—", done: !!form.activationDate },
  ];
  const doneCount = fields.filter((f) => f.done).length;
  const pct = Math.round((doneCount / fields.length) * 100);

  return (
    <div className="relative rounded-2xl overflow-hidden h-fit" style={glassStyle}>
      <div className="bg-gradient-to-br from-yellow-500 via-amber-500 to-yellow-700 p-4 text-white">
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
              {f.done ? <CheckCircle2 size={12} className="text-yellow-500 transition-colors" /> : <Circle size={12} className="text-muted-foreground/30" />}
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
          <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">{pct}% filled</p>
      </div>

      {saving && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/95 backdrop-blur-sm">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 animate-pulse">
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
  const { theme } = useTheme();
  const isDark = theme !== "light";
  // Same glass-panel treatment GlassShell/GlassCard use elsewhere in the
  // Fixed Asset module, tinted to this module's own accent (#eab308) —
  // keeps every section visually consistent instead of a one-off flat look.
  const glassSection = {
    background: isDark ? "rgba(15,17,26,0.45)" : "rgba(255,255,255,0.72)",
    border: `1px solid ${isDark ? "rgba(234,179,8,0.15)" : "rgba(234,179,8,0.2)"}`,
    backdropFilter: "blur(16px) saturate(160%)",
    WebkitBackdropFilter: "blur(16px) saturate(160%)",
    boxShadow: isDark ? "0 4px 24px rgba(0,0,0,0.25)" : "0 4px 24px rgba(234,179,8,0.07)",
  } as const;

  const [viewMode,   setViewMode]   = useState<ViewMode>("list");
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [viewingId,  setViewingId]  = useState<number | null>(null);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);
  const [reverseId,  setReverseId]  = useState<number | null>(null);
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
  // SAC codes for the "Type of Repairs SAC Code" field — sourced from the
  // Material-module HSN master (rows with the "Is SAC Code" toggle on).
  const { data: sacCodes = [] } = useQuery({
    queryKey: ["hsn-sac-codes"],
    queryFn:  getSacCodes,
  });
  const { data: unassignedCodes = [], isLoading: codesLoading } = useQuery({
    queryKey: ["fa-unassigned-codes"],
    queryFn:  getUnassignedFAItemCodes,
    enabled:  viewMode === "form" && !editingId,
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
    let pendingCount = 0;
    for (const a of live) {
      totalCost += a.PurchaseCost || 0;
      const dc = a.PurchaseDate && a.DepreciationRate
        ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
        : null;
      totalBookValue += dc ? dc.bookValue : (a.PurchaseCost || 0);
      if (a.AssetStatus === "Active") activeCount++;
      if (a.AssetStatus === "Sold") soldCount++;
      if (a.AssetStatus === "Pending") pendingCount++;
    }
    return { count: live.length, totalCost, totalBookValue, activeCount, soldCount, pendingCount };
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
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
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
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete & Reverse GRN — distinct from the plain soft-delete above.
  const { data: reversePlan, isLoading: loadingReversePlan } = useQuery({
    queryKey: ["fa-reversal-plan", reverseId],
    queryFn:  () => getFixedAssetReversalPlan(reverseId!),
    enabled:  reverseId != null,
  });
  const reverseMut = useMutation({
    mutationFn: reverseFixedAsset,
    onSuccess: (r) => {
      toast.success(r.grnDeleted ? "Asset reversed — GRN and inventory removed" : "Asset reversed — inventory removed");
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-inventory-imports"] });
      setReverseId(null);
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
        sourceTagId:         String(d.SourceTagId || ""),
        faItemCode:          d.FAItemCode || "",
        godownId:            String(d.GodownID || ""),
        godownName:          d.GodownName || "",
        assetCategory:       d.AssetCategory || "",
        repairType:          d.RepairType || "",
        brand:               d.Brand || "",
        model:               d.Model || "",
        serialNumber:        d.SerialNumber || "",
        purchaseDate:        d.PurchaseDate?.slice(0, 10) || "",
        activationDate:      d.ActivationDate?.slice(0, 10) || "",
        purchaseInvoiceRef:  d.PurchaseInvoiceRef || "",
        supplierId:          String(d.SupplierId || ""),
        purchaseCost:        String(d.PurchaseCost || ""),
        quantity:            String(d.Quantity || "1"),
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
        pictureBase64:       d.PictureBase64 || "",
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

  const handleSelectCode = (c: UnassignedFAItemCode) => {
    setForm((p) => ({
      ...p,
      sourceTagId: String(c.TagId),
      faItemCode:  c.FAItemCode,
      assetName:   c.ItemName || "",
      companyId:   c.CompanyId ? String(c.CompanyId) : "",
      projectId:   c.ProjectId ? String(c.ProjectId) : "",
      godownId:    c.GodownId ? String(c.GodownId) : "",
      godownName:  c.GodownName || "",
    }));
  };

  const clearSelectedCode = () => {
    setForm((p) => ({ ...p, sourceTagId: "", faItemCode: "", assetName: "", godownId: "", godownName: "" }));
  };

  const handleSave = () => {
    if (!editingId && !form.sourceTagId) return toast.error("Select an FA Item Code");
    if (!form.assetName.trim())    return toast.error("Asset name is required");
    if (!form.assetCategory)       return toast.error("Asset category is required");
    if (!form.purchaseCost)        return toast.error("Purchase cost is required");

    const payload = {
      docDate:             form.docDate || undefined,
      companyId:           form.companyId ? Number(form.companyId) : undefined,
      projectId:           form.projectId ? Number(form.projectId) : undefined,
      finYear:             form.finYear || undefined,
      assetName:           form.assetName,
      sourceTagId:         !editingId && form.sourceTagId ? Number(form.sourceTagId) : undefined,
      assetCategory:       form.assetCategory,
      repairType:          form.repairType || null,
      brand:               form.brand || undefined,
      model:               form.model || undefined,
      serialNumber:        form.serialNumber || undefined,
      purchaseDate:        form.purchaseDate || undefined,
      activationDate:      form.activationDate || undefined,
      purchaseInvoiceRef:  form.purchaseInvoiceRef || undefined,
      supplierId:          form.supplierId ? Number(form.supplierId) : undefined,
      purchaseCost:        parseFloat(form.purchaseCost) || 0,
      quantity:            parseFloat(form.quantity) || 1,
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
      pictureBase64:       form.pictureBase64 || null,
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
      <GlassShell
        title={d.DocNo || "Fixed Asset"}
        subtitle={`${d.AssetCategory} · ${d.AssetCode || ""}`}
        icon={Cpu}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Back
            </button>
            {rights.canEdit && (
              <button onClick={() => goToEdit(d as unknown as FixedAssetListItem)}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-5 max-w-6xl">
          {/* hero header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-yellow-500 via-amber-500 to-yellow-700 rounded-2xl p-5 text-white">
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
                    {d.FAItemCode && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-mono font-medium">
                        <Boxes size={11} /> {d.FAItemCode}
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
            <SummaryCard label="Current Book Value"  value={dc ? fmtCur(dc.bookValue) : "—"} color="text-yellow-600 dark:text-yellow-400" icon={PackageCheck} />
          </div>

          {/* details grid */}
          <div className={sectionCls} style={glassSection}>
            <SectionHeader icon={Package}>Asset Details</SectionHeader>
            {d.PictureBase64 && (
              <div className="flex items-start gap-3">
                <img
                  src={d.PictureBase64}
                  alt={d.AssetName}
                  className="h-32 w-32 rounded-xl border border-border object-cover"
                />
                <p className="text-xs text-muted-foreground pt-1">Item Picture</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              {[
                ["FA Item Code",      d.FAItemCode],
                ["Type of Repairs SAC Code", d.RepairType],
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
            <div className={sectionCls} style={glassSection}>
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

          {/* depreciation posting */}
          <DepreciationPostingCard assetId={d.AssetId} glassSection={glassSection} />

          {/* sale info */}
          {d.AssetStatus === "Sold" && (
            <div className={sectionCls} style={glassSection}>
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
            <div className={sectionCls} style={glassSection}>
              <SectionHeader icon={FileText}>Remarks</SectionHeader>
              <p className="text-sm text-muted-foreground">{d.Remarks}</p>
            </div>
          )}
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title={editingId ? "Edit Fixed Asset" : "New Fixed Asset"}
        subtitle="Record a new fixed asset with depreciation details"
        icon={Cpu}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Check size={13} /> {saving ? "Saving…" : "Save Asset"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 xl:gap-8 items-start w-full max-w-[1600px]">
        <div className="space-y-5 min-w-0">
          {/* ── Header Info ── */}
          <div className={sectionCls} style={glassSection}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Calendar size={11} /> Document Date</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Building2 size={11} /> Company</label>
                <select value={form.companyId} onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); }} className={inputCls} disabled={!!form.sourceTagId}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project</label>
                <select value={form.projectId} onChange={(e) => setField("projectId", e.target.value)} className={inputCls} disabled={!form.companyId || !!form.sourceTagId}>
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
              <div className="sm:col-span-2 lg:col-span-4">
                <label className={labelCls}>Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} placeholder="Optional remarks…" className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Asset Details ── */}
          <div className={`${sectionCls} space-y-5`} style={glassSection}>
            <SectionHeader icon={Package}>Asset Details</SectionHeader>

            <SubGroup label="Identity">
              <div className="sm:col-span-2">
                <label className={labelCls}>Fixed Asset Name *</label>
                {form.sourceTagId ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{form.assetName}</p>
                      <p className="text-[11px] font-mono text-yellow-600 dark:text-yellow-400 truncate">{form.faItemCode}</p>
                      {form.godownName && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                          <Warehouse size={10} /> {form.godownName}
                        </p>
                      )}
                    </div>
                    {!editingId && (
                      <button type="button" onClick={clearSelectedCode}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Change">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ) : editingId ? (
                  <input type="text" value={form.assetName} onChange={(e) => setField("assetName", e.target.value)} placeholder="e.g. Dell Latitude 5520" className={inputCls} />
                ) : (
                  <FAItemCodeCombobox codes={unassignedCodes} value={null} onSelect={handleSelectCode} loading={codesLoading} />
                )}
                {!editingId && !form.sourceTagId && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Select a previously generated, unassigned FA Item Code from FA Inventory — Item Name, Company, Project and Godown auto-fill.
                  </p>
                )}
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
                <label className={labelCls}>Type of Repairs SAC Code</label>
                <select value={form.repairType} onChange={(e) => setField("repairType", e.target.value)} className={inputCls}>
                  <option value="">Select SAC code…</option>
                  {sacCodes.map((s) => (
                    <option key={s.HId} value={s.HCode}>
                      {s.HCode}{s.HShortDescription || s.HDescription ? ` — ${s.HShortDescription || s.HDescription}` : ""}
                    </option>
                  ))}
                  {form.repairType && !sacCodes.some((s) => s.HCode === form.repairType) && (
                    <option value={form.repairType}>{form.repairType}</option>
                  )}
                </select>
                {sacCodes.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    No SAC codes yet — add one in Material → Setup → HSN with “Is SAC Code” enabled.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}><Hash size={11} /> Doc No.</label>
                <input type="text" value={editingId ? (detailData as FixedAssetDetail | undefined)?.DocNo || "" : ""} readOnly
                  placeholder="Auto-generated on save"
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
              </div>
              <div>
                <label className={labelCls}>Brand</label>
                <input type="text" value={form.brand} onChange={(e) => setField("brand", e.target.value)} placeholder="e.g. Dell" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Model</label>
                <input type="text" value={form.model} onChange={(e) => setField("model", e.target.value)} placeholder="e.g. Latitude 5520" className={inputCls} />
              </div>
            </SubGroup>

            <SubGroup label="Status & Timeline">
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
            </SubGroup>

            <SubGroup label="Cost & Supplier">
              <div className="relative">
                <label className={labelCls}><IndianRupee size={11} /> Purchase Cost *</label>
                <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setField("purchaseCost", e.target.value)} placeholder="0.00"
                  className={`${inputCls} font-semibold border-yellow-500/30 focus:ring-yellow-500/30 bg-yellow-500/[0.03]`} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Supplier</label>
                <select value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} className={inputCls}>
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => <option key={s.LHeadId} value={s.LHeadId}>{s.LHeadName}</option>)}
                </select>
              </div>
            </SubGroup>

            <SubGroup label="Item Picture">
              <ItemPicturePicker
                value={form.pictureBase64}
                onChange={(v) => setField("pictureBase64", v)}
              />
            </SubGroup>

          </div>

          {/* ── Depreciation Details ── */}
          <div className={sectionCls} style={glassSection}>
            <SectionHeader icon={TrendingDown}>Depreciation Details</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
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
                  <SummaryCard label="Current Book Value"  value={fmtCur(depCalc.bookValue)} color="text-yellow-600 dark:text-yellow-400" icon={PackageCheck} />
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
            <div className={sectionCls} style={glassSection}>
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

        <LivePreviewCard
          form={form}
          saving={saving}
          glassStyle={glassSection}
        />
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Fixed Asset Depreciation Tag"]} />
    <GlassShell
      title="Fixed Asset Depreciation Tag"
      subtitle="Track and manage all fixed assets with depreciation"
      icon={Cpu}
      accentColor="#eab308"
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Asset
          </button>
        )
      }
    >
      {/* ── KPI strip — same GlassCard language as the rest of the Fixed
          Asset module (see FixedAssetDashboard). ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <GlassCard
          label="Total Book Value"
          value={fmtCur(portfolioStats.totalBookValue)}
          sub={`of ${fmtCur(portfolioStats.totalCost)} original`}
          icon={Wallet}
          accentColor="#eab308"
        />
        <GlassCard
          label="Total Assets"
          value={fmt(portfolioStats.count)}
          sub={portfolioStats.pendingCount > 0 ? `${fmt(portfolioStats.pendingCount)} pending` : undefined}
          icon={Boxes}
          accentColor="#3b82f6"
        />
        <GlassCard
          label="Active"
          value={fmt(portfolioStats.activeCount)}
          icon={PlayCircle}
          accentColor="#22c55e"
        />
        <GlassCard
          label="Sold"
          value={fmt(portfolioStats.soldCount)}
          icon={IndianRupee}
          accentColor="#f59e0b"
        />
      </div>

      {/* ── Book Value by Category ── */}
      <div className="rounded-2xl overflow-hidden mb-4" style={glassSection}>
        <div className="px-5 py-3.5 border-b border-yellow-500/15 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
            <TrendingUp size={14} />
          </span>
          <p className="text-sm font-semibold text-foreground">Book Value by Category</p>
        </div>
        <div className="p-5">
          {categoryBreakdown.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-9 text-muted-foreground">
              <Boxes size={20} className="opacity-40" />
              <p className="text-xs">No assets yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5">
              {categoryBreakdown.entries.map(([cat, value], i) => {
                const Icon = CATEGORY_ICONS[cat] || Package;
                const barColor = BAR_PALETTE[i % BAR_PALETTE.length];
                const pct =
                  categoryBreakdown.max > 0
                    ? Math.max(4, (value / categoryBreakdown.max) * 100)
                    : 0;
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground shrink-0">
                      <Icon size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground truncate" title={cat}>
                          {cat}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                          {fmtCurCompact(value)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── filters ── */}
      <div className="rounded-2xl overflow-hidden mb-4" style={glassSection}>
        <div className="px-5 py-3.5 border-b border-yellow-500/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
              <Search size={14} />
            </span>
            <p className="text-sm font-semibold text-foreground">Filters</p>
          </div>
          {(filterCategory || filterStatus || filterFinYear || search) && (
            <button
              onClick={() => { setFilterCategory(""); setFilterStatus(""); setFilterFinYear(""); setSearch(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <div>
              <label className={labelCls}>Financial Year</label>
              <select value={filterFinYear} onChange={(e) => setFilterFinYear(e.target.value)} className={inputCls}>
                <option value="">All Years</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── register ── */}
      <div className="rounded-2xl overflow-hidden" style={glassSection}>
        <div className="px-5 py-3.5 border-b border-yellow-500/15">
          <p className="text-sm font-semibold text-foreground">Asset Register</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} of {portfolioStats.count} asset{portfolioStats.count !== 1 ? "s" : ""}
          </p>
        </div>
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
              className="mt-2 inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
              <Plus size={13} /> Add First Asset
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="bg-yellow-500/5 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">FA Item Code</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Company / Project</th>
                <th className="px-4 py-3 text-left">Purchase Date</th>
                <th className="px-4 py-3 text-right">Purchase Cost</th>
                <th className="px-4 py-3 text-left">Book Value</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((a) => {
                const dc = a.PurchaseDate && a.DepreciationRate
                  ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
                  : null;
                const bookValue = dc ? dc.bookValue : a.PurchaseCost;
                return (
                  <tr key={a.AssetId} className="hover:bg-yellow-500/[0.04] transition-colors cursor-pointer"
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
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-yellow-600 dark:text-yellow-400">{a.FAItemCode || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.AssetCategory}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.CompanyName || "—"}{a.ProjectName ? ` / ${a.ProjectName}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.PurchaseDate)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{fmtCur(a.PurchaseCost)}</td>
                    <td className="px-4 py-3 min-w-[130px]">
                      <p className="font-mono tabular-nums text-yellow-600 dark:text-yellow-400">{fmtCur(bookValue)}</p>
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
                        {rights.canReverse && (
                          <button onClick={() => setReverseId(a.AssetId)}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-muted-foreground hover:text-red-500" title="Delete & Reverse GRN">
                            <Undo2 size={13} />
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
      </div>

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
                className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                Cancel
              </button>
              <button onClick={() => deleteMut.mutate(deleteId!)} disabled={deleteMut.isPending}
                className="shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive transition-all disabled:opacity-50">
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── delete & reverse confirm / blocked ── */}
      {reverseId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 w-[26rem] shadow-xl">
            {loadingReversePlan ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                <Loader2 size={14} className="animate-spin" /> Checking dependencies…
              </div>
            ) : reversePlan && !reversePlan.reversible ? (
              <>
                <div className="flex items-start gap-3 mb-4">
                  <ShieldAlert size={20} className="text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Can't reverse this asset</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{reversePlan.message}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setReverseId(null)}
                    className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                    Close
                  </button>
                </div>
              </>
            ) : reversePlan?.reversible ? (
              <>
                <div className="flex items-start gap-3 mb-4">
                  <Undo2 size={20} className="text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Delete &amp; Reverse GRN?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This will permanently remove{" "}
                      {reversePlan.sourceType === "GRN"
                        ? <>the received quantity from GRN <span className="font-mono">{reversePlan.grnDocNo}</span></>
                        : "the manually-imported inventory"}
                      , its {reversePlan.taggedCount} FA Item Code{reversePlan.taggedCount === 1 ? "" : "s"}
                      {reversePlan.unitCount > 0 ? ` and ${reversePlan.unitCount} completed Fixed Asset Record${reversePlan.unitCount === 1 ? "" : "s"}` : ""} derived from it.
                      {reversePlan.sourceType === "GRN" && (
                        <> The GRN itself is only deleted if no other item on it still has stock — otherwise just this item's stock is removed.</>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5">Do this only if the asset needs to be re-received via a new GRN or Inventory Import.</p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setReverseId(null)}
                    className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
                    Cancel
                  </button>
                  <button onClick={() => reverseMut.mutate(reverseId!)} disabled={reverseMut.isPending}
                    className="shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive transition-all disabled:opacity-50">
                    {reverseMut.isPending ? "Reversing…" : "Delete & Reverse"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </GlassShell>
    </>
  );
}
