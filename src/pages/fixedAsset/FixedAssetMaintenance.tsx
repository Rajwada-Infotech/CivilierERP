import React, { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Search, Building2, Package, Calendar, Hash, FileText,
  Check, X, Wrench, Loader2, ChevronsUpDown, Eye, Pencil, Trash2,
  AlertTriangle, BookOpen, IndianRupee, Send, Printer,
} from "lucide-react";
import { escapeHtml } from "@/utils/escapeHtml";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getMaintAssets, getMaintVendors, getMaintenanceList, getMaintenance,
  getFaItemCodesByItem,
  createMaintenance, updateMaintenance, postMaintenance, deleteMaintenance,
  REPAIR_EXPENSE_TYPES, REPAIR_EXPENSE_LABEL,
  type FAMaintAsset, type MaintenanceItem, type RepairExpenseType, type PostingPlan,
} from "@/api/fixedAssetMaintenanceApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function fmtAmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const inputCls   = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-60";
const labelCls   = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";

const STATUS_COLORS: Record<MaintenanceItem["Status"], string> = {
  Draft:     "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Posted:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Cancelled: "bg-muted text-muted-foreground",
};

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

// ── Item Selection combobox (distinct item names among valid FA records) ─────
function ItemCombobox({
  items, value, onSelect, disabled, loading,
}: { items: string[]; value: string; onSelect: (name: string) => void; disabled?: boolean; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          className={cn("w-full justify-between font-normal h-9", !value && "text-muted-foreground")}>
          <span className="truncate">{value || "Select item…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search item…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>No valid Fixed Assets found.</CommandEmpty>
                <CommandGroup>
                  {items.map((it) => (
                    <CommandItem key={it} value={it} onSelect={() => { onSelect(it); setOpen(false); }}
                      className="data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50">
                      <Check className={cn("mr-2 h-4 w-4", it === value ? "opacity-100" : "opacity-0")} />
                      <span className="text-xs truncate">{it}</span>
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

// ── FA Item Code combobox (codes for the selected item) ─────────────────────
function FAItemCodeCombobox({
  assets, value, onSelect, disabled,
}: { assets: FAMaintAsset[]; value: string; onSelect: (a: FAMaintAsset) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground")}>
          <span className="truncate">{selected ? selected.FAItemCode : "Select FA Item Code…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code…" />
          <CommandList>
            <CommandEmpty>No FA Item Code found for this Item.</CommandEmpty>
            <CommandGroup>
              {assets.map((a) => (
                <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName}`}
                  onSelect={() => { onSelect(a); setOpen(false); }}
                  className="data-[selected=true]:bg-neutral-900 data-[selected=true]:text-neutral-50">
                  <Check className={cn("mr-2 h-4 w-4", String(a.AssetId) === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-col min-w-0">
                    <span className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400 truncate">{a.FAItemCode}</span>
                    <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface FormState {
  companyId: string;
  projectId: string;
  docNo: string;
  docDate: string;
  itemName: string;      // Item Selection
  assetId: string;       // FA Item Code
  remarks: string;
  vendorId: string;
  repairExpenseType: RepairExpenseType | "";
  amount: string;
}
const emptyForm = (): FormState => ({
  companyId: "", projectId: "", docNo: "", docDate: new Date().toISOString().slice(0, 10),
  itemName: "", assetId: "", remarks: "", vendorId: "", repairExpenseType: "", amount: "",
});

const round2 = (n: number) => Math.round(n * 100) / 100;

// Standalone light-themed print document for a Maintenance & Repair voucher —
// same blob-URL + window.print() pattern used by GRN.tsx (the live modal uses
// theme CSS variables that don't print cleanly).
function printMaintenanceVoucher(d: MaintenanceItem) {
  const money = (n: number | null | undefined) =>
    "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
  const taxable = d.TaxableAmount ?? d.Amount;
  const rows: Array<[string, string]> = [
    ["Doc Number", d.DocNo || "—"],
    ["Doc Date", d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : "—"],
    ["Company", d.CompanyName || "—"],
    ["Project", d.ProjectName || "—"],
    ["Item", d.ItemName || "—"],
    ["FA Item Code", d.FAItemCode || "—"],
    ["Vendor", d.VendorName || "—"],
    ["Repair Expense Type", REPAIR_EXPENSE_LABEL[d.RepairExpenseType] || d.RepairExpenseType],
    ["SAC Code", d.SacCode || "—"],
    ["Status", d.Status],
    ["Voucher No", d.VoucherNo || "—"],
  ];
  const infoHtml = rows
    .map(([k, v]) => `<div class="field"><label>${escapeHtml(k)}</label><span>${escapeHtml(v)}</span></div>`)
    .join("");

  const entries = d.posting && !d.posting.error ? d.posting.entries : [];
  const entryRows = entries
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.account)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${e.debit ? "Dr" : "Cr"}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">${money(e.debit || e.credit)}</td>
      </tr>`,
    )
    .join("");
  const totalDr = entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCr = entries.reduce((s, e) => s + (e.credit || 0), 0);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(d.DocNo || "Maintenance Voucher")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; margin: 22px 0 26px; }
  .field { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
  .field label { color: #6b7280; }
  .field span { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; text-align: left; }
  @media print { body { padding: 16px; } }
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #4f46e5;">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;">${escapeHtml(d.CompanyName || "CivilierERP")}</div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;">FA MAINTENANCE &amp; REPAIR</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;margin-top:4px;">${escapeHtml(d.DocNo || "—")}</div>
    </div>
  </div>

  <div class="grid">${infoHtml}</div>

  <div style="display:flex;justify-content:flex-end;margin-bottom:22px;">
    <table style="width:280px;">
      <tbody>
        <tr><td style="color:#6b7280;padding:5px 8px;">Taxable Amount</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">${money(taxable)}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 8px;">GST @ ${d.GstRatePct ?? 0}%</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">${money(d.GstAmount)}</td></tr>
        <tr style="border-top:2px solid #4f46e5;"><td style="padding:8px;font-weight:800;">Total (incl. GST)</td><td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;color:#4f46e5;">${money(d.TotalAmount ?? d.Amount)}</td></tr>
      </tbody>
    </table>
  </div>

  ${entries.length ? `
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:8px;">Accounting Entry</div>
  <table>
    <thead><tr><th>Account</th><th style="text-align:center;">Dr/Cr</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>${entryRows}
      <tr style="border-top:2px solid #4f46e5;font-weight:800;">
        <td style="padding:8px 10px;">Total</td>
        <td style="padding:8px 10px;text-align:center;">Dr ${money(totalDr)}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">Cr ${money(totalCr)}</td>
      </tr>
    </tbody>
  </table>` : ""}

  ${d.Remarks ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${escapeHtml(d.Remarks)}</div></div>` : ""}

  <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank", "width=960,height=720");
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    toast.error("Pop-up blocked — please allow pop-ups for this site.");
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  win.onload = () => { win.focus(); win.print(); };
}

// Local preview mirrors the backend posting rule exactly:
//   Dr Direct/Indirect Repair Expense A/c            taxable
//   Dr GST Credit Available (Input GST)              GST
//   Cr Vendor                                        taxable + GST
function localPostingPreview(
  f: FormState,
  vendorLabel: string,
  sac: { code: string | null; ratePct: number | null; desc: string | null },
): PostingPlan | null {
  const taxable = Number(f.amount);
  if (!f.repairExpenseType || !f.vendorId || !Number.isFinite(taxable) || taxable <= 0) return null;

  if (!sac.code) {
    return {
      voucherNo: f.docNo || "Auto-generated on save", isPosted: false, entries: [],
      error: "SAC Code is not configured for the selected FA Item Code. Set it on the Fixed Asset Depreciation Tag.",
    };
  }
  if (sac.ratePct == null) {
    return {
      voucherNo: f.docNo || "Auto-generated on save", isPosted: false, entries: [],
      error: `Applicable GST rate is not configured for SAC Code "${sac.code}" in the HSN master.`,
    };
  }

  const expenseAcct = f.repairExpenseType === "Direct"
    ? "Direct Repair Expense A/c"
    : "Indirect Repair Expense A/c";
  const gstAmount = round2(taxable * sac.ratePct / 100);
  const total = round2(taxable + gstAmount);

  return {
    voucherNo: f.docNo || "Auto-generated on save",
    isPosted: false,
    gst: {
      sacCode: sac.code, sacDescription: sac.desc, ratePct: sac.ratePct,
      cgst: 0, sgst: 0, igst: 0,
      taxableAmount: taxable, gstAmount, totalAmount: total,
    },
    entries: [
      { account: expenseAcct, debit: taxable, credit: 0 },
      { account: "GST Credit Available", debit: gstAmount, credit: 0 },
      { account: vendorLabel || "Vendor A/c", debit: 0, credit: total },
    ],
  };
}

export default function FixedAssetMaintenance() {
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-maintenance");

  const [viewMode, setViewMode] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [tab, setTab] = useState<"details" | "posting">("details");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | MaintenanceItem["Status"]>("");

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["fa-maintenance"],
    queryFn: () => getMaintenanceList(),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["fa-maintenance-vendors"], queryFn: getMaintVendors,
  });
  const { data: assets = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["fa-maintenance-assets", form.companyId, form.projectId],
    queryFn: () => getMaintAssets({
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
    }),
    enabled: viewMode === "form",
  });

  // FA Item Codes for the selected Item — loaded from the backend, filtered
  // server-side to codes that belong to this Item / Company / Project.
  const { data: codesForItem = [], isFetching: loadingCodes } = useQuery({
    queryKey: ["fa-maintenance-codes", form.companyId, form.projectId, form.itemName],
    queryFn: () => getFaItemCodesByItem({
      itemName: form.itemName,
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
    }),
    enabled: viewMode === "form" && !!form.itemName,
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const itemNames = useMemo(
    () => Array.from(new Set(ensureArray<FAMaintAsset>(assets).map((a) => a.AssetName))).sort(),
    [assets],
  );
  const vendorLabel = useMemo(
    () => ensureArray<{ id: number; label: string }>(vendors).find((v) => String(v.id) === form.vendorId)?.label || "",
    [vendors, form.vendorId],
  );

  // The FA record chosen as the FA Item Code — carries its configured SAC
  // code + resolved GST rate (from the Fixed Asset Depreciation Tag / HSN).
  const selectedAsset = useMemo(
    () => ensureArray<FAMaintAsset>(codesForItem).find((a) => String(a.AssetId) === form.assetId) || null,
    [codesForItem, form.assetId],
  );
  const sacInfo = useMemo(() => ({
    code: selectedAsset?.SacCode ?? null,
    ratePct: selectedAsset?.GstRatePct ?? null,
    desc: selectedAsset?.SacDescription ?? null,
  }), [selectedAsset]);

  // ── edit populate ─────────────────────────────────────────────────────────
  const { data: editDetail } = useQuery({
    queryKey: ["fa-maintenance", editingId],
    queryFn: () => getMaintenance(editingId!),
    enabled: editingId != null && viewMode === "form",
  });
  React.useEffect(() => {
    if (editingId && editDetail) {
      const d = editDetail;
      setForm({
        companyId: String(d.CompanyId || ""),
        projectId: String(d.ProjectId || ""),
        docNo: d.DocNo || "",
        docDate: d.DocDate?.slice(0, 10) || "",
        itemName: d.ItemName || "",
        assetId: String(d.AssetId || ""),
        remarks: d.Remarks || "",
        vendorId: String(d.VendorId || ""),
        repairExpenseType: d.RepairExpenseType,
        amount: d.Amount != null ? String(d.Amount) : "",
      });
    }
  }, [editingId, editDetail]);

  const { data: viewDetail } = useQuery({
    queryKey: ["fa-maintenance", viewingId],
    queryFn: () => getMaintenance(viewingId!),
    enabled: viewingId != null,
  });

  // ── derived ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<MaintenanceItem>(records);
    if (filterStatus) r = r.filter((c) => c.Status === filterStatus);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((c) =>
        (c.DocNo || "").toLowerCase().includes(s) ||
        (c.FAItemCode || "").toLowerCase().includes(s) ||
        (c.ItemName || "").toLowerCase().includes(s) ||
        (c.VendorName || "").toLowerCase().includes(s));
    }
    return r;
  }, [records, search, filterStatus]);

  const stats = useMemo(() => {
    const live = ensureArray<MaintenanceItem>(records);
    return {
      total: live.length,
      draft: live.filter((c) => c.Status === "Draft").length,
      posted: live.filter((c) => c.Status === "Posted").length,
      value: live.filter((c) => c.Status === "Posted").reduce((s, c) => s + Number(c.TotalAmount ?? c.Amount ?? 0), 0),
    };
  }, [records]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fa-maintenance"] });
  };
  const createMut = useMutation({
    mutationFn: createMaintenance,
    onSuccess: (r) => { toast.success(r?.docNo ? `Saved (Draft) — ${r.docNo}` : "Maintenance record saved (Draft)"); invalidate(); backToList(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMaintenance>[1] }) => updateMaintenance(id, data),
    onSuccess: (r) => {
      toast.success(r?.wasPosted
        ? "Record updated — previous posting reversed, re-post from the Posting tab"
        : "Maintenance record updated");
      invalidate(); backToList();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const postMut = useMutation({
    mutationFn: (id: number) => postMaintenance(id),
    onSuccess: (r) => { toast.success(`Posted to GL — voucher ${r.voucherNo}`); invalidate(); backToList(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteMaintenance,
    onSuccess: () => { toast.success("Record cancelled / reversed"); invalidate(); setDeleteId(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => { setForm(emptyForm()); setEditingId(null); setTab("details"); };
  const backToList = () => { resetForm(); setViewMode("list"); };
  const goToCreate = () => {
    resetForm();
    setViewMode("form");
  };
  const goToEdit = (c: MaintenanceItem) => {
    if (c.Status === "Cancelled") { toast.error("Cancelled records cannot be edited"); return; }
    resetForm(); setEditingId(c.MaintenanceId); setViewMode("form");
  };

  const validate = (): string | null => {
    if (!form.companyId) return "Company is mandatory";
    if (!form.projectId) return "Project is mandatory";
    if (!form.docDate) return "Doc Date is mandatory";
    if (!form.itemName) return "Item Selection is mandatory";
    if (!form.assetId) return "FA Item Code is mandatory";
    if (!form.vendorId) return "Vendor is mandatory";
    if (!form.repairExpenseType) return "Repair Expense Type is mandatory";
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return "Amount must be greater than zero";
    return null;
  };

  const buildPayload = () => ({
    companyId: Number(form.companyId),
    projectId: Number(form.projectId),
    docDate: form.docDate,
    itemName: form.itemName,
    assetId: Number(form.assetId),
    vendorId: Number(form.vendorId),
    repairExpenseType: form.repairExpenseType as RepairExpenseType,
    amount: Number(form.amount),
    remarks: form.remarks || undefined,
  });

  const handleSave = () => {
    const err = validate();
    if (err) return toast.error(err);
    if (editingId) updateMut.mutate({ id: editingId, data: buildPayload() });
    else createMut.mutate(buildPayload());
  };

  const handleSaveAndPost = async () => {
    const err = validate();
    if (err) return toast.error(err);
    try {
      let id = editingId;
      if (id) await updateMaintenance(id, buildPayload());
      else id = (await createMaintenance(buildPayload())).maintenanceId;
      await postMut.mutateAsync(id!);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const busy = createMut.isPending || updateMut.isPending || postMut.isPending;
  const preview = editingId && editDetail?.posting && !editDetail.posting.error && editDetail.AssetId === Number(form.assetId)
    ? editDetail.posting
    : localPostingPreview(form, vendorLabel, sacInfo);

  // ═════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title={editingId ? "Edit Maintenance & Repair" : "New Maintenance & Repair"}
        subtitle="Record repair/maintenance spend against a Fixed Asset"
        icon={Wrench}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={backToList}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={busy}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-yellow-500/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10 transition-all disabled:opacity-50">
              <Check size={13} /> {editingId ? (editDetail?.Status === "Posted" ? "Save & Unpost" : "Update Draft") : "Save Draft"}
            </button>
            <button onClick={handleSaveAndPost} disabled={busy}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Send size={13} /> {busy ? "Working…" : "Save & Post"}
            </button>
          </div>
        }
      >
        <div className="w-full max-w-[1100px]">
          {editingId && editDetail?.Status === "Posted" && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                This record is <b>Posted</b> (voucher {editDetail.VoucherNo}). Saving will reverse the current
                accounting entry and return it to Draft — use <b>Save &amp; Post</b> to re-post with the new values.
              </span>
            </div>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="mb-4">
              <TabsTrigger value="details">Transaction</TabsTrigger>
              <TabsTrigger value="posting">Posting</TabsTrigger>
            </TabsList>

            {/* ── TRANSACTION TAB ── */}
            <TabsContent value="details" className="space-y-5">
              <div className={sectionCls}>
                <SectionHeader icon={Building2}>Header</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}><Building2 size={11} /> Company *</label>
                    <select value={form.companyId} disabled={!!editingId}
                      onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "", itemName: "", assetId: "" }))}
                      className={inputCls}>
                      <option value="">Select company…</option>
                      {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project *</label>
                    <select value={form.projectId} disabled={!form.companyId || !!editingId}
                      onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, itemName: "", assetId: "" }))}
                      className={inputCls}>
                      <option value="">Select project…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}><Hash size={11} /> Doc Number</label>
                    <input type="text" readOnly disabled
                      value={form.docNo || "Auto-generated on save"}
                      title="Automatically generated by the system when the record is saved"
                      className={`${inputCls} bg-muted/40 text-muted-foreground cursor-not-allowed`} />
                  </div>
                  <div>
                    <label className={labelCls}><Calendar size={11} /> Doc Date *</label>
                    <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>

              <div className={sectionCls}>
                <SectionHeader icon={Package}>Fixed Asset</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}><Package size={11} /> Item Selection *</label>
                    <ItemCombobox items={itemNames} value={form.itemName} loading={loadingAssets}
                      disabled={!form.companyId || !form.projectId || !!editingId}
                      onSelect={(name) => setForm((p) => ({ ...p, itemName: name, assetId: "" }))} />
                  </div>
                  <div>
                    <label className={labelCls}><Hash size={11} /> FA Item Code *</label>
                    <FAItemCodeCombobox assets={codesForItem} value={form.assetId} disabled={!form.itemName || !!editingId}
                      onSelect={(a) => setField("assetId", String(a.AssetId))} />
                    {form.itemName && !editingId && (
                      loadingCodes ? (
                        <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Loading FA Item Codes…</p>
                      ) : codesForItem.length === 0 ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">No FA Item Code found for this Item.</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground mt-1">{codesForItem.length} FA Item Code{codesForItem.length > 1 ? "s" : ""} for “{form.itemName}”.</p>
                      )
                    )}
                  </div>
                </div>
                {!form.companyId || !form.projectId ? (
                  <p className="text-[11px] text-muted-foreground">Select Company and Project to load valid, active Fixed Assets.</p>
                ) : itemNames.length === 0 && !loadingAssets ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">No valid/active Fixed Asset records for this Company / Project.</p>
                ) : null}
              </div>

              <div className={sectionCls}>
                <SectionHeader icon={FileText}>Repair Details</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Vendor *</label>
                    <select value={form.vendorId} onChange={(e) => setField("vendorId", e.target.value)} className={inputCls}>
                      <option value="">Select vendor…</option>
                      {ensureArray<{ id: number; label: string; code: string | null }>(vendors).map((v) => (
                        <option key={v.id} value={v.id}>{v.label}{v.code ? ` (${v.code})` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Repair Expense Type *</label>
                    <select value={form.repairExpenseType}
                      onChange={(e) => setField("repairExpenseType", e.target.value as RepairExpenseType)} className={inputCls}>
                      <option value="">Select…</option>
                      {REPAIR_EXPENSE_TYPES.map((t) => <option key={t} value={t}>{REPAIR_EXPENSE_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}><IndianRupee size={11} /> Repair Expense Amount (taxable) *</label>
                    <input type="number" min="0" step="0.01" value={form.amount}
                      onChange={(e) => setField("amount", e.target.value)} placeholder="0.00" className={inputCls} />
                    {sacInfo.code && sacInfo.ratePct != null && Number(form.amount) > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        SAC {sacInfo.code} · GST {sacInfo.ratePct}% = ₹{fmtAmt(round2(Number(form.amount) * sacInfo.ratePct / 100))}
                        &nbsp;·&nbsp; Total ₹{fmtAmt(round2(Number(form.amount) * (1 + sacInfo.ratePct / 100)))}
                      </p>
                    )}
                    {form.assetId && !sacInfo.code && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        No SAC Code configured for this FA Item Code — set it on the Fixed Asset Depreciation Tag before posting.
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className={labelCls}>Remarks</label>
                    <textarea value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} rows={3}
                      placeholder="Nature of repair / maintenance…"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── POSTING TAB ── */}
            <TabsContent value="posting">
              <div className={sectionCls}>
                <SectionHeader icon={BookOpen}>Accounting Entry</SectionHeader>
                <p className="text-xs text-muted-foreground">
                  Repairs &amp; Maintenance A/c Dr &nbsp;·&nbsp; Input GST (GST Credit Available) A/c Dr &nbsp;·&nbsp; Vendor A/c Cr.
                  The expense account comes from the Repair Expense Type, the GST rate from the SAC Code
                  configured against the FA Item Code (Fixed Asset Depreciation Tag → HSN master), and the
                  credit is the selected Vendor's ledger.
                </p>
                {!preview ? (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 py-6">
                    <AlertTriangle size={14} /> Select FA Item Code, Vendor, Repair Expense Type and Amount to preview the posting.
                  </div>
                ) : preview.error ? (
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 py-6">
                    <AlertTriangle size={14} /> {preview.error}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    {preview.gst && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
                        <div className="bg-muted/40 rounded-lg p-2">
                          <p className="text-muted-foreground">SAC Code</p>
                          <p className="font-semibold">{preview.gst.sacCode || "—"}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2">
                          <p className="text-muted-foreground">GST Rate</p>
                          <p className="font-semibold">{preview.gst.ratePct}%</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2">
                          <p className="text-muted-foreground">GST Amount</p>
                          <p className="font-semibold tabular-nums">₹{fmtAmt(preview.gst.gstAmount)}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2">
                          <p className="text-muted-foreground">Total (incl. GST)</p>
                          <p className="font-semibold tabular-nums">₹{fmtAmt(preview.gst.totalAmount)}</p>
                        </div>
                      </div>
                    )}
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left">Account</th>
                          <th className="px-4 py-2.5 text-center">Dr/Cr</th>
                          <th className="px-4 py-2.5 text-right">Debit</th>
                          <th className="px-4 py-2.5 text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.entries.map((e, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2.5">{e.account}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${e.debit ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
                                {e.debit ? "Dr" : "Cr"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{e.debit ? fmtAmt(e.debit) : "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{e.credit ? fmtAmt(e.credit) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-border font-semibold">
                          <td className="px-4 py-2.5 text-right" colSpan={2}>Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmt(preview.entries.reduce((s, e) => s + e.debit, 0))}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmt(preview.entries.reduce((s, e) => s + e.credit, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Voucher: <span className="font-mono">{preview.voucherNo}</span>
                      {preview.isPosted && <span className="ml-2 text-emerald-600 dark:text-emerald-400">• already posted</span>}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </GlassShell>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "FA Maintenance & Repair"]} />
      <GlassShell
        title="FA Maintenance & Repair"
        subtitle="Record maintenance/repair expenses against a Fixed Asset and post the accounting entry"
        icon={Wrench}
        accentColor="#eab308"
        action={rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Record
          </button>
        )}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Total</p>
            <p className="text-base font-bold tabular-nums">{stats.total}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Draft</p>
            <p className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{stats.draft}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Posted</p>
            <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{stats.posted}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Posted Value</p>
            <p className="text-base font-bold tabular-nums">₹{fmtAmt(stats.value)}</p>
          </div>
        </div>

        <Card className="border-border shadow-sm mb-5">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className={labelCls}>Search</label>
              <div className="relative max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Doc no, FA Item Code, item, vendor…" className={`${inputCls} pl-8`} />
                {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
              </div>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className={`${inputCls} sm:w-44`}>
                <option value="">All</option>
                <option value="Draft">Draft</option>
                <option value="Posted">Posted</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-base font-semibold">Maintenance &amp; Repair Records</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60"><Wrench size={26} className="opacity-40" /></span>
                <p className="text-sm">No maintenance records found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1000px]">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left">Doc No</th>
                      <th className="px-4 py-3 text-left">FA Item Code</th>
                      <th className="px-4 py-3 text-left">Vendor</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((c) => (
                      <tr key={c.MaintenanceId} onClick={() => setViewingId(c.MaintenanceId)}
                        className="hover:bg-muted/30 transition-colors cursor-pointer">
                        <td className="px-4 py-3 font-mono text-xs">
                          {c.DocNo}
                          <span className="block text-[10px] font-sans text-muted-foreground">{fmtDate(c.DocDate)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-yellow-600 dark:text-yellow-400 truncate">{c.FAItemCode || "—"}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{c.ItemName || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{c.VendorName || "—"}</td>
                        <td className="px-4 py-3 text-xs">{REPAIR_EXPENSE_LABEL[c.RepairExpenseType]}</td>
                        <td className="px-4 py-3 text-right tabular-nums">₹{fmtAmt(c.Amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.Status]}`}>{c.Status}</span>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setViewingId(c.MaintenanceId)} title="View"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Eye size={14} /></button>
                            {rights.canPrint && (
                              <button
                                onClick={async () => {
                                  try { printMaintenanceVoucher(await getMaintenance(c.MaintenanceId)); }
                                  catch (e) { toast.error((e as Error).message); }
                                }}
                                title="Print voucher"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Printer size={14} /></button>
                            )}
                            {rights.canEdit && c.Status === "Draft" && (
                              <button onClick={() => postMut.mutate(c.MaintenanceId)} title="Post to GL"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-muted transition-colors"><Send size={14} /></button>
                            )}
                            {rights.canEdit && c.Status !== "Cancelled" && (
                              <button onClick={() => goToEdit(c)} title={c.Status === "Posted" ? "Edit (reverses the posting)" : "Edit"}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400 hover:bg-muted transition-colors"><Pencil size={14} /></button>
                            )}
                            {rights.canDelete && (
                              <button onClick={() => setDeleteId(c.MaintenanceId)} title={c.Status === "Posted" ? "Reverse & cancel" : "Cancel"}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-muted transition-colors"><Trash2 size={14} /></button>
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

        {/* ── View drawer ── */}
        {viewingId != null && viewDetail && createPortal(
          <div className="fixed inset-0 z-[70] flex">
            <div className="flex-1 bg-black/40" onClick={() => setViewingId(null)} />
            <div className="w-full max-w-md bg-background border-l border-border h-full overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base">{viewDetail.DocNo}</h3>
                <div className="flex items-center gap-1">
                  {rights.canPrint && (
                    <button onClick={() => printMaintenanceVoucher(viewDetail)} title="Print voucher"
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><Printer size={15} /></button>
                  )}
                  <button onClick={() => setViewingId(null)} className="p-1.5 rounded-lg hover:bg-muted"><X size={15} /></button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ["Company", viewDetail.CompanyName],
                  ["Project", viewDetail.ProjectName],
                  ["Doc Date", fmtDate(viewDetail.DocDate)],
                  ["Item", viewDetail.ItemName],
                  ["FA Item Code", viewDetail.FAItemCode],
                  ["Vendor", viewDetail.VendorName],
                  ["Repair Expense Type", REPAIR_EXPENSE_LABEL[viewDetail.RepairExpenseType]],
                  ["SAC Code", viewDetail.SacCode || "—"],
                  ["Taxable Amount", `₹${fmtAmt(viewDetail.TaxableAmount ?? viewDetail.Amount)}`],
                  ["GST", `${viewDetail.GstRatePct ?? 0}%  ·  ₹${fmtAmt(viewDetail.GstAmount ?? 0)}`],
                  ["Total (incl. GST)", `₹${fmtAmt(viewDetail.TotalAmount ?? viewDetail.Amount)}`],
                  ["Status", viewDetail.Status],
                  ["Voucher", viewDetail.VoucherNo || "—"],
                  ["Remarks", viewDetail.Remarks || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>
              {viewDetail.posting && !viewDetail.posting.error && (
                <div className="border border-border rounded-xl p-4">
                  <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><BookOpen size={12} /> Posting</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        <th className="py-1 text-left font-medium">Account</th>
                        <th className="py-1 text-center font-medium">Dr/Cr</th>
                        <th className="py-1 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {viewDetail.posting.entries.map((e, i) => (
                        <tr key={i}>
                          <td className="py-1.5">{e.account}</td>
                          <td className="py-1.5 text-center">
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${e.debit ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
                              {e.debit ? "Dr" : "Cr"}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{fmtAmt(e.debit || e.credit)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border font-semibold">
                        <td className="py-1.5" colSpan={2}>Total</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {fmtAmt(viewDetail.posting.entries.reduce((s, e) => s + (e.debit || 0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {rights.canEdit && viewDetail.Status !== "Cancelled" && (
                <div className="flex gap-2">
                  <button onClick={() => { const c = viewDetail; setViewingId(null); goToEdit(c); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 font-semibold text-xs px-3 py-2 rounded-lg border border-yellow-500/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10">
                    <Pencil size={13} /> Edit
                  </button>
                  {viewDetail.Status === "Draft" && (
                    <button onClick={() => { setViewingId(null); postMut.mutate(viewDetail.MaintenanceId); }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 font-semibold text-white text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600">
                      <Send size={13} /> Post to GL
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

        {/* ── Delete confirm ── */}
        {deleteId != null && createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteId(null)} />
            <div className="relative bg-background border border-border rounded-2xl p-6 max-w-sm w-full space-y-4">
              <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
                <AlertTriangle size={20} />
                <h3 className="font-semibold">Cancel this record?</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                A posted record will also have its GL voucher reversed. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteId(null)} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">Keep</button>
                <button onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {deleteMut.isPending ? "Working…" : "Cancel Record"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </GlassShell>
    </>
  );
}
