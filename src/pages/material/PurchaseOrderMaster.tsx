import React, { useEffect, useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import {
  getPurchaseOrders,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getSuppliers,
  getCompanies,
  getProjects,
  getUOMs,
<<<<<<< HEAD
  type GSTConfig,
  type GSTType,
} from "@/api/purchaseOrdersApi";

const PurchaseOrderMaster = () => {
=======
  type PurchaseOrder,
} from "@/api/purchaseOrdersApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getTCRecords } from "@/api/tcMasterApi";
import { getEnterprises } from "@/api/enterpriseApi";
import {
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Package,
  Calendar,
  Hash,
  Building2,
  FolderPlus,
  FileText,
  IndianRupee,
  Eye,
  PenSquare,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  BadgeCheck,
  Clock,
  XCircle,
  AlertCircle,
  Check,
  ShoppingCart,
  Boxes,
  TrendingUp,
  Filter,
  MoreVertical,
  User,
  SortAsc,
  List,
  ClipboardList,
  X,
  CheckCircle2,
  CircleDollarSign,
  Truck,
  Link2,
  Printer,
  Receipt,
} from "lucide-react";

// ─── PO Chain Status Hook ─────────────────────────────────────────────────────

interface ChainStatus {
  expenseCount: number;
  latestExpenseDocNo: string | null;
  latestExpenseStatus: string | null;
  latestExpenseAmount: number | null;
  paymentCount: number;
  latestPaymentAmount: number | null;
  isPaid: boolean;
}

function usePOChainStatus(poId: string | null) {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!poId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    fetchWithAuth(
      `/api/expense-booking/chain-status?sourceType=PO&sourceId=${poId}`,
    )
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [poId]);

  return { status, loading };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface POLineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemDescription: string;
  quantity: number;
  uomId: number | null;
  unit: string;
  rate: number;
  cgstRate: number; // from item master M_CGST
  sgstRate: number; // from item master M_SGST
  igstRate: number; // from item master M_IGST
  gstRate: number; // effective total GST % (igst if set, else cgst+sgst)
  taxAmount: number; // qty * rate * gstRate / 100
  amount: number; // qty * rate + taxAmount (inclusive of GST)
}

interface POForm {
  poNumber: string;
  poDate: string;
  expectedDate: string;
  supplierId: string;
  companyId: string;
  projectId: string;
  paymentTerms: string;
  remarks: string;
  docTypeId: number | null;
  docNo: string;
}

interface DropdownOption {
  id: number | string;
  name: string;
}

interface TCRecord {
  id: number;
  name: string;
  terms: string;
}

interface POListItem {
  _id: string;
  poNumber: string;
  poDate: string;
  supplierName: string;
  companyName: string;
  projectName: string;
  totalAmount: number;
  status: string;
  docNo: string;
  remarks: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? ""
    : dt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

function ensureArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

const EMPTY_LINE = (): POLineItem => ({
  id: uid(),
  itemId: "",
  itemName: "",
  itemDescription: "",
  quantity: 1,
  uomId: null,
  unit: "",
  rate: 0,
  cgstRate: 0,
  sgstRate: 0,
  igstRate: 0,
  gstRate: 0,
  taxAmount: 0,
  amount: 0,
});

const EMPTY_FORM = (): POForm => ({
  poNumber: "",
  poDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  supplierId: "",
  companyId: "",
  projectId: "",
  paymentTerms: "",
  remarks: "",
  docTypeId: null,
  docNo: "",
});

// ─── Shared styles (matching WorkOrderMaster) ─────────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";

const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const cellSelect =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

const SelectSkeleton = () => (
  <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
);

// ─── Status helpers ───────────────────────────────────────────────────────────

const getStatusConfig = (status: string) => {
  const s = (status || "Draft").toLowerCase();
  if (s === "approved" || s === "received")
    return {
      icon: <BadgeCheck size={12} />,
      cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    };
  if (s === "pending" || s === "issued")
    return {
      icon: <Clock size={12} />,
      cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    };
  if (s === "rejected" || s === "closed")
    return {
      icon: <XCircle size={12} />,
      cls: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
    };
  if (s === "partially received")
    return {
      icon: <AlertCircle size={12} />,
      cls: "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    };
  return {
    icon: <FileText size={12} />,
    cls: "bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  };
};

const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const cfg = getStatusConfig(status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.cls}`}
    >
      {cfg.icon}
      {status}
    </span>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

type ViewMode = "list" | "create" | "edit" | "view";

const PurchaseOrderMaster: React.FC = () => {
>>>>>>> origin/dev
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 10;

  // Tracks selected company id so we can filter the project dropdown client-side
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(
    null,
  );
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [poFormPatch, setPoFormPatch] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [poFormPatchKey, setPoFormPatchKey] = useState(0);
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter((fy) => fy.status === "Active");
  const [selectedFinYear, setSelectedFinYear] = useState("");

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) setSelectedFinYear(activeFinYear);
  }, [activeFinYear, selectedFinYear]);

<<<<<<< HEAD
=======
  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState<POForm>(EMPTY_FORM());
  const [lineItems, setLineItems] = useState<POLineItem[]>([EMPTY_LINE()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);

  // ── Remote data ───────────────────────────────────────────────────────────
  const { data: dbData, isLoading } = useQuery({
    queryKey: ["purchase-orders", page, limit],
    queryFn: () => getPurchaseOrders({ page, limit }),
  });

  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });
  const { data: companiesRaw = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: getCompanies,
  });
  const { data: projectsRaw = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const { data: uomsRaw = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUOMs,
  });
  const { data: itemsRaw = [] } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });
  const { data: tcRaw = [] } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
  });

  const { data: enterprisesRaw = [] } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
  });

  // ── Normalise data ────────────────────────────────────────────────────────
  const suppliers = useMemo(
    () =>
      (suppliersRaw as any[]).map((s) => ({
        id: String(s.LHeadId),
        name: s.LHeadName ?? "",
      })),
    [suppliersRaw],
  );

  const companies = useMemo(
    () =>
      (companiesRaw as any[]).map((c) => ({
        id: String(c.id),
        name: c.label ?? "",
      })),
    [companiesRaw],
  );

  const allProjects = useMemo(
    () =>
      (projectsRaw as any[]).map((p) => ({
        id: String(p.id),
        name: p.label ?? "",
      })),
    [projectsRaw],
  );

  const uoms = useMemo(
    () =>
      (uomsRaw as any[])
        .filter((u) => u.IsActive !== false && u.IsActive !== 0)
        .map((u) => ({
          id: Number(u.Id),
          name: u.UOMName ?? "",
          code: (u.UOMCode ?? "").toString().trim(),
        }))
        .filter((u) => u.name !== ""),
    [uomsRaw],
  );

  const items = useMemo(
    () =>
      (itemsRaw as DbItem[]).map((i) => ({
        id: i.M_Id,
        name: i.M_Name,
        description: i.M_Description ?? "",
        hsn: i.M_HSN ?? "",
        uom: i.M_UOM ?? "",
        cgst: Number(i.M_CGST ?? 0),
        sgst: Number(i.M_SGST ?? 0),
        igst: Number(i.M_IGST ?? 0),
      })),
    [itemsRaw],
  );

  const tcRecords = useMemo(
    () =>
      ensureArray<any>(tcRaw)
        .filter((t) => t.isActive !== false)
        .map((t) => ({
          id: Number(t.Id),
          name: String(t.Name ?? ""),
          terms: String(t.TermsAndCondition ?? ""),
        })),
    [tcRaw],
  );

  // ── Enterprise logo ───────────────────────────────────────────────────────
  const enterpriseLogo = useMemo(() => {
    const list = ensureArray<any>(enterprisesRaw);
    const enterprise =
      list.find((e) => e.entity_type === "Enterprise") ?? list[0];
    return enterprise?.logo ?? null;
  }, [enterprisesRaw]);

  // ── Print handler ─────────────────────────────────────────────────────────
  const handlePrint = () => {
    const supplier =
      suppliers.find((s) => s.id === form.supplierId)?.name ?? "—";
    const company = companies.find((c) => c.id === form.companyId)?.name ?? "—";
    const project =
      allProjects.find((p) => p.id === form.projectId)?.name ?? "—";

    const logoHtml = enterpriseLogo
      ? `<img src="${enterpriseLogo}" alt="Company Logo" style="height:60px;max-width:180px;object-fit:contain;" />`
      : `<div style="font-size:22px;font-weight:700;color:#4f46e5;">${company}</div>`;

    const itemRows = lineItems
      .map(
        (li, i) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 10px;text-align:center;color:#6b7280;">${i + 1}</td>
        <td style="padding:8px 10px;font-weight:500;">${li.itemName || "—"}</td>
        <td style="padding:8px 10px;color:#6b7280;">${li.itemDescription || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">${li.quantity}</td>
        <td style="padding:8px 10px;text-align:center;">${li.unit || "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">₹${li.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px 10px;text-align:center;">${li.gstRate > 0 ? li.gstRate + "%" : "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:600;">₹${li.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`,
      )
      .join("");

    const tcHtml = form.paymentTerms
      ? `<div style="margin-top:24px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:8px;">Terms &amp; Conditions</div>
          <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.6;">${form.paymentTerms}</div>
         </div>`
      : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Purchase Order — ${form.poNumber || "—"}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 32px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; padding: 9px 10px; text-align: left; }
    .total-row td { padding: 6px 10px; }
    .grand-total { font-size: 15px; font-weight: 700; color: #4f46e5; border-top: 2px solid #4f46e5; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #4f46e5;">
    <div>${logoHtml}</div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PURCHASE ORDER</div>
      <div style="font-size:16px;font-weight:700;font-family:monospace;margin-top:4px;">${form.poNumber || "—"}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Date: ${fmtDate(form.poDate)}</div>
      ${form.expectedDate ? `<div style="font-size:12px;color:#6b7280;">Expected: ${fmtDate(form.expectedDate)}</div>` : ""}
    </div>
  </div>

  <!-- Meta -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Supplier</div>
      <div style="font-weight:600;">${supplier}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Company</div>
      <div style="font-weight:600;">${company}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Project / Site</div>
      <div style="font-weight:600;">${project}</div>
    </div>
  </div>

  <!-- Items -->
  <table>
    <thead>
      <tr>
        <th style="width:36px;">#</th>
        <th>Item</th>
        <th>Description</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:center;">UOM</th>
        <th style="text-align:right;">Rate (₹)</th>
        <th style="text-align:center;">GST</th>
        <th style="text-align:right;">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-top:16px;">
    <table style="width:280px;">
      <tbody>
        <tr class="total-row">
          <td style="color:#6b7280;">Subtotal (excl. GST)</td>
          <td style="text-align:right;font-family:monospace;">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
        ${totalCgst > 0 ? `<tr class="total-row"><td style="color:#6b7280;">CGST</td><td style="text-align:right;font-family:monospace;">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>` : ""}
        ${totalSgst > 0 ? `<tr class="total-row"><td style="color:#6b7280;">SGST</td><td style="text-align:right;font-family:monospace;">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>` : ""}
        ${totalIgst > 0 ? `<tr class="total-row"><td style="color:#6b7280;">IGST</td><td style="text-align:right;font-family:monospace;">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>` : ""}
        <tr class="total-row grand-total">
          <td>Grand Total</td>
          <td style="text-align:right;font-family:monospace;">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${tcHtml}

  <!-- Remarks -->
  ${form.remarks ? `<div style="margin-top:24px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${form.remarks}</div></div>` : ""}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("Pop-up blocked — please allow pop-ups for this site.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  // ── Derived list data ─────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  const listData: POListItem[] = dbItems.map((item) => ({
    _id: String(item.PurchaseOrderID ?? ""),
    poNumber: item.PurchaseOrderNo ?? "",
    poDate: item.PODate ?? "",
    supplierName:
      suppliers.find((s) => s.id === String(item.SupplierID))?.name ??
      item.SupplierName ??
      "",
    companyName:
      companies.find((c) => c.id === String(item.CompanyId))?.name ??
      item.CompanyName ??
      "",
    projectName:
      allProjects.find((p) => p.id === String(item.ProjectId))?.name ??
      item.ProjectName ??
      "",
    totalAmount: Number(item.TotalAmount ?? 0),
    status: item.Status ?? "Draft",
    docNo: item.DocNo ?? "",
    remarks: item.Remarks ?? "",
  }));

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return listData;
    const q = searchQuery.toLowerCase();
    return listData.filter(
      (r) =>
        r.poNumber.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.companyName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q),
    );
  }, [listData, searchQuery]);

  // ── Computed totals ───────────────────────────────────────────────────────
  const { subtotal, totalCgst, totalSgst, totalIgst, totalTax, grandTotal } =
    useMemo(() => {
      const sub = lineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
      const cgst = lineItems.reduce((s, li) => {
        if (li.igstRate > 0) return s; // IGST item — no CGST
        return s + (li.quantity * li.rate * li.cgstRate) / 100;
      }, 0);
      const sgst = lineItems.reduce((s, li) => {
        if (li.igstRate > 0) return s; // IGST item — no SGST
        return s + (li.quantity * li.rate * li.sgstRate) / 100;
      }, 0);
      const igst = lineItems.reduce((s, li) => {
        if (li.igstRate <= 0) return s;
        return s + (li.quantity * li.rate * li.igstRate) / 100;
      }, 0);
      const tax = cgst + sgst + igst;
      return {
        subtotal: sub,
        totalCgst: cgst,
        totalSgst: sgst,
        totalIgst: igst,
        totalTax: tax,
        grandTotal: sub + tax,
      };
    }, [lineItems]);

  // Chain status — must be here (before any early returns) to satisfy Rules of Hooks
  const { status: poChainStatus, loading: poChainLoading } = usePOChainStatus(
    editingId ?? null,
  );

  // ── Doc number helpers ────────────────────────────────────────────────────
>>>>>>> origin/dev
  const applyPoDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
    setPoDocNo(docNo);
    setPoFormPatch({
      poNumber: docNo,
      docNo,
      docTypeId,
    });
    setPoFormPatchKey((current) => current + 1);
  };

  const refreshPoDocNumber = async (
    docTypeId: number | null = poDocTypeId,
    finYearOverride = selectedFinYear,
  ) => {
    if (!docTypeId) {
      applyPoDocNumber(null, "");
      return "";
    }
    const nextDocNo = await fetchNextDocNumber(
      docTypeId,
      finYearOverride || undefined,
    );
    applyPoDocNumber(docTypeId, nextDocNo);
    setDocRefreshTrigger((current) => current + 1);
    return nextDocNo;
  };

<<<<<<< HEAD
  // ── Remote data ──────────────────────────────────────────────────────────────
  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["purchase-orders", page, limit],
    queryFn: () => getPurchaseOrders({ page, limit }),
  });
=======
  // ── Line item helpers ─────────────────────────────────────────────────────
  const updateLine = (idx: number, patch: Partial<POLineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const updated = { ...li, ...patch };
        const baseAmount = updated.quantity * updated.rate;
        updated.taxAmount = (baseAmount * updated.gstRate) / 100;
        updated.amount = baseAmount + updated.taxAmount;
        return updated;
      }),
    );
  };
>>>>>>> origin/dev

  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });

// Separate fetches for companies and projects
  const { data: companiesRaw = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: getCompanies,
  });
  const { data: projectsRaw = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });

<<<<<<< HEAD
  // UOMMaster — fields: Id, UOMName (confirmed from uomMaster.js SELECT query)
  const { data: uomsRaw = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUOMs,
  });
  const { data: itemsRaw = [] } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });
  const { data: hsnRaw = [] } = useQuery({
    queryKey: ["hsn-master"],
    queryFn: getHsn,
  });
=======
  const handleItemSelect = (idx: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const itemUomNorm = item.uom.trim().toLowerCase();
    const uomMatch = uoms.find(
      (u) =>
        u.code.toLowerCase() === itemUomNorm ||
        u.name.toLowerCase() === itemUomNorm,
    );
    // Use CGST+SGST when both are set (intra-state); fall back to IGST (inter-state)
    const useCgstSgst = item.cgst > 0 && item.sgst > 0;
    const gstRate = useCgstSgst ? item.cgst + item.sgst : item.igst;
    updateLine(idx, {
      itemId,
      itemName: item.name,
      itemDescription: item.description,
      uomId: uomMatch?.id ?? null,
      unit: uomMatch?.name ?? item.uom,
      cgstRate: useCgstSgst ? item.cgst : 0,
      sgstRate: useCgstSgst ? item.sgst : 0,
      igstRate: useCgstSgst ? 0 : item.igst,
      gstRate,
    });
  };
>>>>>>> origin/dev

  // ── Normalise raw data ───────────────────────────────────────────────────────
  const suppliers: Array<{ id: number; name: string }> = (
    suppliersRaw as any[]
  ).map((s) => ({ id: s.LHeadId, name: s.LHeadName }));

<<<<<<< HEAD
// Companies from API: account-head/options?type=C returns [{ id, label, ... }]
  const companies = useMemo(
    () =>
      (companiesRaw as any[]).map((c) => ({
        id: c.id,
        name: c.label ?? "",
        belongsTo: null,
      })),
    [companiesRaw],
  );

  // Projects from API: account-head/options?type=P returns [{ id, label, ... }]
  const allProjects = useMemo(
    () =>
      (projectsRaw as any[]).map((p) => ({
        id: p.id,
        name: p.label ?? "",
        belongsTo: null,
      })),
    [projectsRaw],
  );

  // Show all projects (can't filter by belongsTo since account-head options don't have that field)
  const filteredProjects = useMemo(() => allProjects, [allProjects]);

  // UOM: field names from DB are "Id" and "UOMName" (confirmed from uomMaster.js)
  // Only show active UOMs (IsActive = true/1)
  const uoms: Array<{ id: number; name: string }> = (uomsRaw as any[])
    .filter((u) => u.IsActive !== false && u.IsActive !== 0)
    .map((u) => ({ id: u.Id, name: u.UOMName ?? "" }))
    .filter((u) => u.name !== "");

  // ── Dropdown option string arrays ────────────────────────────────────────────
  const supplierOptions = suppliers.map((s) => s.name);
  const companyOptions = companies.map((c) => c.name);
  const projectOptions = filteredProjects.map((p) => p.name);
  const uomOptions = uoms.map((u) => u.name);

  // ── Pagination ───────────────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  // ── Map DB rows → UI records ─────────────────────────────────────────────────
  const mappedData: RecordWithId[] = dbItems.map((item) => {
    const supplierName =
      suppliers.find((s) => s.id === item.SupplierID)?.name ??
      item.SupplierName ??
      "";
    const companyName =
      companies.find((c) => c.id === item.CompanyId)?.name ??
      item.CompanyName ??
      "";
    const projectName =
      allProjects.find((p) => p.id === item.ProjectId)?.name ??
      item.ProjectName ??
      "";

    return {
      _id: String(item.PurchaseOrderID ?? ""),
      poNumber: item.PurchaseOrderNo ?? "",
      poDate: item.PODate ?? "",
      expectedDate: item.ExpectedDeliveryDate ?? "",
      supplierName,
      companyName,
      projectName,
      itemDescription: item.ItemDescription ?? "",
      quantity: Number(item.Quantity ?? 0),
      unit: item.Unit ?? "",
      rate: Number(item.Rate ?? 0),
      totalAmount: Number(item.TotalAmount ?? 0),
      paymentTerms: item.PaymentTerms ?? "",
      status: item.Status ?? "Draft",
      remarks: item.Remarks ?? "",
      docTypeId: item.DocTypeId ?? null,
      docNo: item.DocNo ?? "",
      docTypePrefix: item.DocTypePrefix ?? "",
      gstApplicable: item.GST?.applicable ? "Yes" : "No",
      gstType: item.GST?.type ?? "cgst_sgst",
      gstRate: item.GST?.rate ?? 18,
    };
  });

  // ── Map UI record → DB payload ───────────────────────────────────────────────
  const toPayload = (r: Record<string, unknown>) => {
    const supplier = suppliers.find(
      (s) => s.name === (r.supplierName as string),
    );
    const company = companies.find((c) => c.name === (r.companyName as string));
    const project = allProjects.find(
      (p) => p.name === (r.projectName as string),
    );
    const finalNumber = (r.poNumber as string) || null;
    return {
      PurchaseOrderNo: finalNumber,
      PODate: (r.poDate as string) || null,
      ExpectedDeliveryDate: (r.expectedDate as string) || null,
      SupplierID: supplier?.id ?? null,
      CompanyId: company?.id ?? null,
      ProjectId: project?.id ?? null,
      ItemDescription: (r.itemDescription as string) || null,
      Quantity: Number(r.quantity) || 0,
      Unit: (r.unit as string) || null,
      Rate: Number(r.rate) || 0,
      TotalAmount: Number(r.totalAmount) || 0,
      PaymentTerms: (r.paymentTerms as string) || null,
      Status: (r.status as string) || "Draft",
      Remarks: (r.remarks as string) || null,
      DocTypeId: (r.docTypeId as number | null) ?? poDocTypeId,
      DocNo: finalNumber || (r.docNo as string) || poDocNo || null,
      finYear: selectedFinYear || null,
      GST: {
        applicable: (r.gstApplicable as string) === "Yes",
        type: ((r.gstType as GSTType) || "cgst_sgst"),
        rate: Number(r.gstRate) || 0,
      },
=======
  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.poNumber) e.poNumber = true;
    if (!form.poDate) e.poDate = true;
    if (!form.supplierId) e.supplierId = true;
    if (lineItems.every((li) => !li.itemName && !li.quantity))
      e.lineItems = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const toPayload = () => {
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    const company = companies.find((c) => c.id === form.companyId);
    const project = allProjects.find((p) => p.id === form.projectId);
    const validItems = lineItems.filter((li) => li.itemName || li.quantity > 0);
    return {
      PurchaseOrderNo: form.poNumber || null,
      PODate: form.poDate || null,
      ExpectedDeliveryDate: form.expectedDate || null,
      SupplierID: supplier ? Number(supplier.id) : null,
      CompanyId: company ? Number(company.id) : null,
      ProjectId: project ? Number(project.id) : null,
      ItemDescription: validItems.map((li) => li.itemName).join(", ") || null,
      Quantity: validItems.reduce((s, li) => s + li.quantity, 0),
      Unit: validItems[0]?.unit || null,
      Rate: validItems[0]?.rate || 0,
      TotalAmount: grandTotal,
      POItems: validItems.map((li) => ({
        itemDescription:
          li.itemName + (li.itemDescription ? ` — ${li.itemDescription}` : ""),
        unit: li.unit,
        quantity: li.quantity,
        rate: li.rate,
        tax: li.gstRate,
        amount: li.amount,
      })),
      PaymentTerms:
        selectedTCs.length > 0
          ? selectedTCs.map((tc) => `${tc.name}: ${tc.terms}`).join("\n\n")
          : form.paymentTerms || null,
      Status: "Draft",
      Remarks: form.remarks || null,
      DocTypeId: form.docTypeId ?? poDocTypeId,
      DocNo: form.poNumber || form.docNo || poDocNo || null,
      finYear: selectedFinYear || null,
>>>>>>> origin/dev
    };
  };

  // ── CRUD handler ─────────────────────────────────────────────────────────────
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addPurchaseOrder(toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order created successfully!");
        const savedDocTypeId =
          (event.record.docTypeId as number | null) ?? poDocTypeId;
        const nextDocNo = await refreshPoDocNumber(savedDocTypeId);
        return {
          poNumber: nextDocNo,
          docNo: nextDocNo,
          docTypeId: savedDocTypeId,
        };
      } else if (event.action === "update") {
        await updatePurchaseOrder(event.id, toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order updated successfully!");
      } else if (event.action === "delete") {
        await deletePurchaseOrder(event.id);
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order deleted successfully!");
      }
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
      throw err;
    }
    return undefined;
  };

  // ── Reactive field logic ─────────────────────────────────────────────────────
  const handleFieldChange = (
    record: Record<string, any>,
    fieldName: string,
  ) => {
    let updated = { ...record };

    // Auto-calculate Total Amount
    if (fieldName === "quantity" || fieldName === "rate") {
      const qty = Number(updated.quantity) || 0;
      const rate = Number(updated.rate) || 0;
      updated = { ...updated, totalAmount: qty * rate };
    }

<<<<<<< HEAD
    // When Company changes:
    //  1. Update selectedCompanyId → filteredProjects recomputes via useMemo
    //  2. Clear projectName so stale value isn't carried forward
    if (fieldName === "companyName") {
      const matched = companies.find((c) => c.name === updated.companyName);
      setSelectedCompanyId(matched?.id ?? null);
      updated = { ...updated, projectName: "" };
    }

    return updated;
=======
  // ── Navigation ────────────────────────────────────────────────────────────
  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
  };

  const goToCreate = () => {
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
    setViewMode("create");
  };

  const goToEdit = (item: POListItem) => {
    const raw = dbItems.find((d) => String(d.PurchaseOrderID) === item._id);
    if (!raw) return;

    const supplier = suppliers.find((s) => s.name === item.supplierName);
    const company = companies.find((c) => c.name === item.companyName);
    const project = allProjects.find((p) => p.name === item.projectName);

    setForm({
      poNumber: raw.PurchaseOrderNo ?? "",
      poDate: raw.PODate ? raw.PODate.slice(0, 10) : "",
      expectedDate: raw.ExpectedDeliveryDate
        ? raw.ExpectedDeliveryDate.slice(0, 10)
        : "",
      supplierId: supplier?.id ?? "",
      companyId: company?.id ?? "",
      projectId: project?.id ?? "",
      paymentTerms: raw.PaymentTerms ?? "",
      remarks: raw.Remarks ?? "",
      docTypeId: raw.DocTypeId ?? null,
      docNo: raw.DocNo ?? "",
    });

    // Restore line items from POItems or legacy fields
    const poItems = raw.POItems ?? [];
    if (poItems.length > 0) {
      setLineItems(
        poItems.map((pi: any) => {
          const qty = Number(pi.quantity ?? 0);
          const rate = Number(pi.rate ?? 0);
          const gstRate = Number(pi.tax ?? 0);
          const taxAmount = (qty * rate * gstRate) / 100;
          const unitStr = (pi.unit ?? "").trim().toLowerCase();
          const uomMatch = uoms.find(
            (u) =>
              u.code.toLowerCase() === unitStr ||
              u.name.toLowerCase() === unitStr,
          );
          // We don't have individual rates on saved items — keep gstRate as total
          // igst assumed if no split available; user can re-select item to restore split
          return {
            id: uid(),
            itemId: "",
            itemName: pi.itemDescription ?? "",
            itemDescription: "",
            quantity: qty,
            uomId: uomMatch?.id ?? null,
            unit: uomMatch?.name ?? pi.unit ?? "",
            rate,
            cgstRate: 0,
            sgstRate: 0,
            igstRate: gstRate, // store as igst so totalTax still sums correctly
            gstRate,
            taxAmount,
            amount: qty * rate + taxAmount,
          };
        }),
      );
    } else {
      const qty = Number(raw.Quantity ?? 0);
      const rate = Number(raw.Rate ?? 0);
      setLineItems([
        {
          id: uid(),
          itemId: "",
          itemName: raw.ItemDescription ?? "",
          itemDescription: "",
          quantity: qty,
          uomId: null,
          unit: raw.Unit ?? "",
          rate,
          cgstRate: 0,
          sgstRate: 0,
          igstRate: 0,
          gstRate: 0,
          taxAmount: 0,
          amount: qty * rate,
        },
      ]);
    }
    setEditingId(item._id);
    setSelectedTCs([]); // T&C restored from PaymentTerms text — user can re-select
    setViewMode("edit");
>>>>>>> origin/dev
  };

  const refetchPOs = () =>
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });

  // ── Column renderers ─────────────────────────────────────────────────────────
  const columnRenderers = {
    poDate: (value: unknown) => {
      const d = new Date(String(value));
      return isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
    },
    totalAmount: (value: unknown) =>
      `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (_value: unknown, row: RecordWithId) => (
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={String(row.status ?? "")} />
        <ApprovalActions
          status={String(row.status ?? "")}
          recordId={row._id}
          endpoint="/api/purchase-orders"
          onSuccess={refetchPOs}
        />
      </div>
    ),
  };

  // ── Field definitions ────────────────────────────────────────────────────────
  // NOTE: projectOptions is derived from filteredProjects which updates automatically
  // when selectedCompanyId changes — MasterPage will re-render with fresh options.
  const FIELDS: FieldDef[] = [
    {
      name: "poNumber",
      label: "Purchase Order No",
      type: "text",
      required: true,
      uppercase: true,
    },
    { name: "poDate", label: "PO Date", type: "date", required: true },
    {
      name: "expectedDate",
      label: "Expected Delivery",
      type: "date",
      required: true,
    },
    {
      name: "supplierName",
      label: "Supplier",
      type: "select",
      required: true,
      options: supplierOptions,
    },
    {
      // Filtered client-side: only enterprise rows where business_type = 'C'
      name: "companyName",
      label: "Company Name",
      type: "select",
      options: companyOptions,
    },
    {
      // Filtered client-side: business_type = 'P', further narrowed by belongs_to
      // when a company is selected above
      name: "projectName",
      label: "Project / Site",
      type: "select",
      options: projectOptions,
    },
    {
      name: "itemDescription",
      label: "Item Description",
      type: "textarea",
      required: true,
      fullWidth: true,
    },
    { name: "quantity", label: "Quantity", type: "number", required: true },
    {
      // UOM dropdown — data from dbo.UOMMaster via GET /api/uom-master
      // DB fields used: Id (id), UOMName (name) — only IsActive records shown
      name: "unit",
      label: "Unit",
      type: "select",
      required: true,
      options: uomOptions,
    },
    { name: "rate", label: "Rate (₹)", type: "number", required: true },
    {
      name: "totalAmount",
      label: "Total Amount (₹)",
      type: "number",
      required: true,
      prefix: "₹",
    },
    { name: "paymentTerms", label: "Payment Terms", type: "textarea" },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: ["Draft", "Issued", "Partially Received", "Received", "Closed"],
    },
    {
      name: "gstApplicable",
      label: "GST Applicable",
      type: "select",
      options: ["No", "Yes"],
    },
    {
      name: "gstType",
      label: "GST Type",
      type: "select",
      options: ["cgst_sgst", "igst"],
    },
    { name: "gstRate", label: "GST Rate (%)", type: "number" },
    { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  ];

  // ── Column definitions ───────────────────────────────────────────────────────
  const COLUMNS: ColumnDef[] = [
    { key: "poNumber", label: "PO No" },
    { key: "docNo", label: "Doc No" },
    { key: "supplierName", label: "Supplier" },
    { key: "companyName", label: "Company", hideOnMobile: true },
    { key: "projectName", label: "Project / Site", hideOnMobile: true },
    { key: "itemDescription", label: "Item", hideOnMobile: true },
    { key: "quantity", label: "Qty", hideOnMobile: true },
    { key: "unit", label: "Unit", hideOnMobile: true },
    { key: "totalAmount", label: "Amount" },
    { key: "status", label: "Status" },
  ];

  const EXPORT_COLUMNS: ExportColumn[] = [
    { header: "PO No", accessor: "poNumber" },
    { header: "Doc No", accessor: "docNo" },
    { header: "Supplier", accessor: "supplierName" },
    { header: "Company", accessor: "companyName" },
    { header: "Project / Site", accessor: "projectName" },
    { header: "Item", accessor: "itemDescription" },
    { header: "Qty", accessor: "quantity" },
    { header: "Unit", accessor: "unit" },
    { header: "Amount", accessor: "totalAmount" },
    { header: "Status", accessor: "status" },
    { header: "Remarks", accessor: "remarks" },
  ];

  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground">
        Loading purchase orders...
      </div>
    );
  if (error)
    return (
      <div className="p-6 text-destructive">
        Failed to load purchase orders.
      </div>
    );

  return (
    <>
<<<<<<< HEAD
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Purchase Order Master
      </h1>
      <div className="mb-4 rounded-xl bg-card border border-border p-4">
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
          Fin Year
        </label>
        <select
          value={selectedFinYear}
          onChange={(e) => {
            const nextFinYear = e.target.value;
            setSelectedFinYear(nextFinYear);
            if (poDocTypeId) void refreshPoDocNumber(poDocTypeId, nextFinYear);
          }}
          className="mb-4 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select Fin Year...</option>
          {finYearOptions.map((fy) => (
            <option key={fy.id} value={fy.year}>
              {fy.year}
            </option>
          ))}
        </select>
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
          Document Type &amp; Number
        </label>
        <DocNumberPreview
          module="PO"
          finYear={selectedFinYear || undefined}
          selectedDocTypeId={poDocTypeId}
          preview={poDocNo}
          refreshTrigger={docRefreshTrigger}
          onSelect={applyPoDocNumber}
        />
      </div>
      <MasterPage
        title="Purchase Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={mappedData}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
        onFieldChange={handleFieldChange}
        externalFormPatch={poFormPatch}
        externalFormPatchKey={poFormPatchKey}
        exportConfig={{
          title: "Purchase Order Master",
          filename: "purchase-orders",
          columns: EXPORT_COLUMNS,
        }}
      />
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages} ({totalRecords} records)
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
=======
      <Breadcrumbs
        items={[
          "Dashboard",
          "Material",
          "Purchase Order Master",
          viewMode === "create" ? "New" : viewMode === "edit" ? "Edit" : "View",
        ]}
      />

      {/* Form Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={goToList}
            className="p-2 rounded-xl border border-border hover:bg-muted transition text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShoppingCart size={18} className="text-primary" />
              {viewMode === "create"
                ? "New Purchase Order"
                : viewMode === "edit"
                  ? "Edit Purchase Order"
                  : `Purchase Order — ${form.poNumber || "—"}`}
            </h1>
          </div>
        </div>

        {!isReadOnly && (
          <div className="flex items-center gap-2">
            <button
              onClick={goToList}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition"
            >
              <RotateCcw size={14} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition shadow-sm"
            >
              {saved ? (
                <Check size={14} />
              ) : saving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saved ? "Saved!" : saving ? "Saving…" : "Save Order"}
            </button>
          </div>
        )}
        {isReadOnly && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted transition"
            >
              <Printer size={14} />
              Print
            </button>
            <button
              onClick={() => setViewMode("edit")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition shadow-sm"
            >
              <PenSquare size={14} />
              Edit
            </button>
          </div>
        )}
      </div>

      <div className="space-y-5">
        {/* ── Document Type & Fin Year Card ─────────────────────────────────── */}
        {!isReadOnly && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
              <Hash size={11} className="text-primary" />
              Document Configuration
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Financial Year</FieldLabel>
                <select
                  value={selectedFinYear}
                  onChange={(e) => {
                    const nextFinYear = e.target.value;
                    setSelectedFinYear(nextFinYear);
                    if (poDocTypeId)
                      void refreshPoDocNumber(poDocTypeId, nextFinYear);
                  }}
                  className={selectCls}
                >
                  <option value="">Select Fin Year…</option>
                  {finYearOptions.map((fy) => (
                    <option key={fy.id} value={fy.year}>
                      {fy.year}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Document Type &amp; Number</FieldLabel>
                <DocNumberPreview
                  module="PO"
                  finYear={selectedFinYear || undefined}
                  selectedDocTypeId={poDocTypeId}
                  preview={poDocNo}
                  refreshTrigger={docRefreshTrigger}
                  onSelect={applyPoDocNumber}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Header Details Card ───────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
            <FileText size={11} className="text-primary" />
            Order Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* PO Number */}
            <div>
              <FieldLabel required>PO Number</FieldLabel>
              <input
                value={form.poNumber}
                onChange={(e) =>
                  setField("poNumber", e.target.value.toUpperCase())
                }
                readOnly={isReadOnly}
                className={`${inputCls} font-mono ${errors.poNumber ? "border-red-400" : ""} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
                placeholder="Auto-generated"
              />
            </div>

            {/* PO Date */}
            <div>
              <FieldLabel required>PO Date</FieldLabel>
              <input
                type="date"
                value={form.poDate}
                onChange={(e) => setField("poDate", e.target.value)}
                readOnly={isReadOnly}
                className={`${inputCls} ${errors.poDate ? "border-red-400" : ""} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
              />
            </div>

            {/* Expected Delivery */}
            <div>
              <FieldLabel>Expected Delivery</FieldLabel>
              <input
                type="date"
                value={form.expectedDate}
                onChange={(e) => setField("expectedDate", e.target.value)}
                readOnly={isReadOnly}
                className={`${inputCls} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
              />
            </div>

            {/* Supplier */}
            <div>
              <FieldLabel required>Supplier</FieldLabel>
              {isReadOnly ? (
                <div className={`${inputCls} bg-muted/30`}>
                  {suppliers.find((s) => s.id === form.supplierId)?.name || "—"}
                </div>
              ) : (
                <select
                  value={form.supplierId}
                  onChange={(e) => setField("supplierId", e.target.value)}
                  className={`${selectCls} ${errors.supplierId ? "border-red-400" : ""}`}
                >
                  <option value="">— Select Supplier —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Company */}
            <div>
              <FieldLabel>Company Name</FieldLabel>
              {isReadOnly ? (
                <div className={`${inputCls} bg-muted/30`}>
                  {companies.find((c) => c.id === form.companyId)?.name || "—"}
                </div>
              ) : (
                <select
                  value={form.companyId}
                  onChange={(e) => setField("companyId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">— Select Company —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Project */}
            <div>
              <FieldLabel>Project / Site</FieldLabel>
              {isReadOnly ? (
                <div className={`${inputCls} bg-muted/30`}>
                  {allProjects.find((p) => p.id === form.projectId)?.name ||
                    "—"}
                </div>
              ) : (
                <select
                  value={form.projectId}
                  onChange={(e) => setField("projectId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">— Select Project —</option>
                  {allProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* ── Line Items Card ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Boxes size={11} className="text-primary" />
              Item Cart
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 min-w-[18px]">
                {lineItems.length}
              </span>
            </h3>
            {!isReadOnly && (
              <button
                onClick={addLine}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition"
              >
                <Plus size={13} />
                Add Item
              </button>
            )}
          </div>

          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-8">
                    #
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[180px]">
                    Item
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[200px]">
                    Description
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">
                    Qty
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-32">
                    UOM
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">
                    Rate (₹)
                  </th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-20">
                    GST %
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">
                    Amount (₹)
                  </th>
                  {!isReadOnly && <th className="px-3 py-2.5 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lineItems.map((li, idx) => (
                  <tr
                    key={li.id}
                    className="group hover:bg-muted/10 transition-colors"
                  >
                    {/* Row number */}
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground font-mono">
                      {idx + 1}
                    </td>

                    {/* Item selector */}
                    <td className="px-3 py-2">
                      {isReadOnly ? (
                        <span className="text-sm font-medium text-foreground">
                          {li.itemName || "—"}
                        </span>
                      ) : (
                        <select
                          value={li.itemId}
                          onChange={(e) =>
                            handleItemSelect(idx, e.target.value)
                          }
                          className={cellSelect}
                        >
                          <option value="">— Select Item —</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Description (auto-filled or editable) */}
                    <td className="px-3 py-2">
                      {isReadOnly ? (
                        <span className="text-xs text-muted-foreground">
                          {li.itemDescription || "—"}
                        </span>
                      ) : (
                        <input
                          value={li.itemDescription}
                          onChange={(e) =>
                            updateLine(idx, { itemDescription: e.target.value })
                          }
                          placeholder="Description…"
                          className={cellInput}
                        />
                      )}
                    </td>

                    {/* Qty */}
                    <td className="px-3 py-2">
                      {isReadOnly ? (
                        <span className="text-sm font-medium">
                          {li.quantity}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={li.quantity}
                          onChange={(e) =>
                            updateLine(idx, {
                              quantity: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={`${cellInput} text-right`}
                        />
                      )}
                    </td>

                    {/* UOM */}
                    <td className="px-3 py-2">
                      {isReadOnly ? (
                        <span className="text-sm text-muted-foreground">
                          {li.unit || "—"}
                        </span>
                      ) : (
                        <select
                          value={li.uomId ?? ""}
                          onChange={(e) => {
                            const uom = uoms.find(
                              (u) => u.id === Number(e.target.value),
                            );
                            updateLine(idx, {
                              uomId: uom?.id ?? null,
                              unit: uom?.name ?? "",
                            });
                          }}
                          className={cellSelect}
                        >
                          <option value="">— UOM —</option>
                          {uoms.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Rate */}
                    <td className="px-3 py-2">
                      {isReadOnly ? (
                        <span className="text-sm text-right block font-mono">
                          ₹{li.rate.toLocaleString("en-IN")}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          value={li.rate}
                          onChange={(e) =>
                            updateLine(idx, {
                              rate: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={`${cellInput} text-right font-mono`}
                        />
                      )}
                    </td>

                    {/* GST % — shows breakdown label */}
                    <td className="px-3 py-2 text-center">
                      {li.gstRate > 0 ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                            {li.gstRate}%
                          </span>
                          {li.igstRate > 0 ? (
                            <span className="text-[10px] text-muted-foreground font-medium">
                              IGST
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground font-medium">
                              CGST+SGST
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Amount (base + GST) */}
                    <td className="px-3 py-2 text-right">
                      <span className="text-sm font-semibold font-mono text-foreground">
                        ₹
                        {li.amount.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      {li.taxAmount > 0 && (
                        <span className="block text-[10px] text-muted-foreground font-normal">
                          +₹
                          {li.taxAmount.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          GST
                        </span>
                      )}
                    </td>

                    {/* Remove */}
                    {!isReadOnly && (
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeLine(idx)}
                          disabled={lineItems.length === 1}
                          className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition disabled:opacity-30"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals footer */}
          <div className="border-t border-border bg-muted/10 px-5 py-5 space-y-4">
            {/* Tax rate breakdown — shown only when at least one item has GST */}
            {totalTax > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Tax Rates{" "}
                  <span className="text-primary font-medium normal-case tracking-normal">
                    (auto-filled from Item Master)
                  </span>
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {/* CGST */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      CGST (%)
                    </p>
                    <div className="flex items-center rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">
                      <span className="flex-1">
                        {totalCgst > 0
                          ? (lineItems.find((li) => li.cgstRate > 0)
                              ?.cgstRate ?? 0)
                          : 0}
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        %
                      </span>
                    </div>
                    {totalCgst > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {fmt(totalCgst)}
                      </p>
                    )}
                  </div>

                  {/* SGST */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      SGST (%)
                    </p>
                    <div className="flex items-center rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">
                      <span className="flex-1">
                        {totalSgst > 0
                          ? (lineItems.find((li) => li.sgstRate > 0)
                              ?.sgstRate ?? 0)
                          : 0}
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        %
                      </span>
                    </div>
                    {totalSgst > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {fmt(totalSgst)}
                      </p>
                    )}
                  </div>

                  {/* IGST */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      IGST (%)
                    </p>
                    <div className="flex items-center rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground">
                      <span className="flex-1">
                        {totalIgst > 0
                          ? (lineItems.find((li) => li.igstRate > 0)
                              ?.igstRate ?? 0)
                          : 0}
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        %
                      </span>
                    </div>
                    {totalIgst > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {fmt(totalIgst)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Amount summary */}
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal (excl. GST)</span>
                  <span className="font-mono">{fmt(subtotal)}</span>
                </div>
                {totalCgst > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>CGST</span>
                    <span className="font-mono">{fmt(totalCgst)}</span>
                  </div>
                )}
                {totalSgst > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>SGST</span>
                    <span className="font-mono">{fmt(totalSgst)}</span>
                  </div>
                )}
                {totalIgst > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>IGST</span>
                    <span className="font-mono">{fmt(totalIgst)}</span>
                  </div>
                )}
                {/* Combined total tax row when both CGST/SGST and IGST exist */}
                {totalTax > 0 && totalCgst > 0 && totalIgst > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground border-t border-dashed border-border pt-1">
                    <span>Total Tax</span>
                    <span className="font-mono">{fmt(totalTax)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-foreground border-t border-border pt-2">
                  <span>Grand Total</span>
                  <span className="font-mono text-primary">
                    {fmt(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Terms & Conditions Card ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <ClipboardList size={11} className="text-primary" />
              Terms &amp; Conditions
            </h3>
            {!isReadOnly && (
              <div className="relative">
                <button
                  onClick={() => setTcDropdownOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition"
                >
                  <Plus size={13} />
                  Add T&amp;C
                </button>
                {tcDropdownOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setTcDropdownOpen(false)}
                    />
                    {/* Dropdown */}
                    <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Select Terms &amp; Conditions
                        </p>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-border">
                        {tcRecords.length === 0 ? (
                          <p className="px-4 py-6 text-xs text-center text-muted-foreground">
                            No T&amp;C records found
                          </p>
                        ) : (
                          tcRecords.map((tc) => {
                            const isSelected = selectedTCs.some(
                              (s) => s.id === tc.id,
                            );
                            return (
                              <button
                                key={tc.id}
                                onClick={() => {
                                  setSelectedTCs((prev) =>
                                    isSelected
                                      ? prev.filter((s) => s.id !== tc.id)
                                      : [...prev, tc],
                                  );
                                }}
                                className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-primary/5" : ""}`}
                              >
                                <span
                                  className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-primary border-primary" : "border-border"}`}
                                >
                                  {isSelected && (
                                    <Check
                                      size={10}
                                      className="text-primary-foreground"
                                    />
                                  )}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm font-medium text-foreground truncate">
                                    {tc.name}
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                                    {tc.terms}
                                  </span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                      <div className="px-3 py-2 border-t border-border">
                        <button
                          onClick={() => setTcDropdownOpen(false)}
                          className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Selected T&C list */}
          {selectedTCs.length > 0 ? (
            <div className="space-y-2 mb-4">
              {selectedTCs.map((tc, idx) => (
                <div
                  key={tc.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3"
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {tc.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                      {tc.terms}
                    </p>
                  </div>
                  {!isReadOnly && (
                    <button
                      onClick={() =>
                        setSelectedTCs((prev) =>
                          prev.filter((s) => s.id !== tc.id),
                        )
                      }
                      className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !isReadOnly && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 mb-4 text-muted-foreground text-xs">
                <ClipboardList size={14} className="opacity-40" />
                <span>
                  No terms selected — click <strong>+ Add T&amp;C</strong> to
                  add from master
                </span>
              </div>
            )
          )}

          {/* Remarks */}
          <div>
            <FieldLabel>Remarks</FieldLabel>
            <textarea
              value={form.remarks}
              onChange={(e) => setField("remarks", e.target.value)}
              readOnly={isReadOnly}
              rows={3}
              placeholder="Additional notes…"
              className={`${inputCls} resize-none ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
            />
          </div>
        </div>

        {/* ── Flow Status Panel (view mode only) ────────────────────────────── */}
        {isReadOnly && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
              <Link2 size={11} className="text-primary" />
              Purchase Flow Status
            </h3>

            {poChainLoading ? (
              <div className="flex items-center gap-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 flex-1 bg-muted animate-pulse rounded-xl"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Step 1: GRN */}
                <div className="rounded-xl border border-border bg-muted/20 p-3 flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                    <Truck
                      size={13}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      GRN
                    </p>
                    <p className="text-xs font-semibold text-foreground">
                      Goods Received
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Check GRN list for receipts against this PO
                    </p>
                  </div>
                </div>

                {/* Step 2: Expense Booking */}
                <div
                  className={`rounded-xl border p-3 flex items-start gap-3 ${
                    (poChainStatus?.expenseCount ?? 0) > 0
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      (poChainStatus?.expenseCount ?? 0) > 0
                        ? "bg-emerald-100 dark:bg-emerald-950/40"
                        : "bg-muted"
                    }`}
                  >
                    {(poChainStatus?.expenseCount ?? 0) > 0 ? (
                      <CheckCircle2
                        size={13}
                        className="text-emerald-600 dark:text-emerald-400"
                      />
                    ) : (
                      <Receipt size={13} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      Expense Booking
                    </p>
                    {(poChainStatus?.expenseCount ?? 0) > 0 ? (
                      <>
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {poChainStatus!.expenseCount} booking
                          {poChainStatus!.expenseCount > 1 ? "s" : ""}
                        </p>
                        {poChainStatus?.latestExpenseDocNo && (
                          <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                            {poChainStatus.latestExpenseDocNo}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not booked yet
                      </p>
                    )}
                  </div>
                </div>

                {/* Step 3: Payment */}
                <div
                  className={`rounded-xl border p-3 flex items-start gap-3 ${
                    poChainStatus?.isPaid
                      ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      poChainStatus?.isPaid
                        ? "bg-blue-100 dark:bg-blue-950/40"
                        : "bg-muted"
                    }`}
                  >
                    <CircleDollarSign
                      size={13}
                      className={
                        poChainStatus?.isPaid
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-muted-foreground"
                      }
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      Payment
                    </p>
                    {poChainStatus?.isPaid ? (
                      <>
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                          {poChainStatus.paymentCount} payment
                          {poChainStatus.paymentCount > 1 ? "s" : ""}
                        </p>
                        {poChainStatus.latestPaymentAmount != null && (
                          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                            ₹
                            {poChainStatus.latestPaymentAmount.toLocaleString(
                              "en-IN",
                            )}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not paid yet
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom action bar */}
        {!isReadOnly && (
          <div className="flex items-center justify-end gap-3 pb-6">
            <button
              onClick={goToList}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition"
            >
              <RotateCcw size={14} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition shadow-sm"
            >
              {saved ? (
                <Check size={14} />
              ) : saving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saved ? "Saved!" : saving ? "Saving…" : "Save Purchase Order"}
            </button>
          </div>
        )}
>>>>>>> origin/dev
      </div>
    </>
  );
};

export default PurchaseOrderMaster;