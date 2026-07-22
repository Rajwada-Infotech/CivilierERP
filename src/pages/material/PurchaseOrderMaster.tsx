import { generateUUID } from "../../utils/cryptoPolyfill";
import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { escapeHtml, safeHtml } from "@/utils/escapeHtml";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { MaterialShell } from "@/components/material/MaterialShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ItemPicker } from "./ItemPicker";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  fetchNextDocNumber,
  fetchDocTypes,
  type DocType,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import {
  getPurchaseOrders,
  getPurchaseOrderById,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getSuppliers,
  getCompanies,
  getProjects,
  getUOMs,
  getSupplierDetails,
  getCompanyDetails,
  getItemsWithGST,
  type CreatePOPayload,
  type SupplierDetails,
  type CompanyDetails,
} from "@/api/purchaseOrdersApi";
import {
  type MRPOPrefill,
  getMRPOPrefill,
  getApprovedMRList,
} from "@/api/materialRequestApi";
import { type WDPOPrefill } from "@/api/engineeringApi";
import { type WOPOPrefill } from "@/api/workOrderApi";
import { type QTPOPrefill } from "@/api/quotationApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getTCRecords } from "@/api/tcMasterApi";
import { getEnterprises } from "@/api/enterpriseApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Hash,
  FileText,
  Eye,
  ArrowLeft,
  Search,
  RefreshCw,
  BadgeCheck,
  Clock,
  XCircle,
  AlertCircle,
  Check,
  ShoppingCart,
  Boxes,
  User,
  ClipboardList,
  X,
  CheckCircle2,
  CircleDollarSign,
  Truck,
  Link2,
  Printer,
  Receipt,
  ChevronDown,
  CalendarDays,
  FilePenLine,
  Package,
  Phone,
  Mail,
  MapPin,
  Building2,
  Download,
  Upload,
  Loader2 as Loader2Icon,
  MessageCircle,
  Lock,
} from "lucide-react";
import { exportToCsv, parseCsv } from "@/lib/export";
import { relevantUOMs, convertRate } from "@/lib/uomConversion";
import {
  alternatesForItem,
  getItemUomFactor,
  convertItemRate,
  convertItemQuantity,
} from "@/lib/itemUomAlternates";
import { getAllItemUomAlternates } from "@/api/itemUomAlternatesApi";
import { useAuth } from "@/contexts/AuthContext";
import { OrderChat } from "@/components/orders/OrderChat";

// ─── Template columns ─────────────────────────────────────────────────────────
const PO_TEMPLATE_COLUMNS = [
  { header: "Document Type", accessor: "Document Type" },
  { header: "Supplier", accessor: "Supplier" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "PO Date (YYYY-MM-DD)", accessor: "PO Date (YYYY-MM-DD)" },
  {
    header: "Expected Delivery Date (YYYY-MM-DD)",
    accessor: "Expected Delivery Date (YYYY-MM-DD)",
  },
  { header: "Payment Terms", accessor: "Payment Terms" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
  { header: "Rate", accessor: "Rate" },
  { header: "GST %", accessor: "GST %" },
];

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
      .then((r) => r.json().catch(() => ({})))
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
  uomLocked?: boolean; // true for quotation-sourced lines — UOM must match what was quoted
  mrItemId?: number | null; // source MaterialRequestItems row, when this line came from an MR
  mrPendingQty?: number | null; // cap for this line's quantity — remaining balance on that MR item
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
  status: string;
  costCenterId: string;
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
  poType: string;
  sourceWODocNo: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => generateUUID();

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
  status: "Draft",
  costCenterId: "",
});

// ─── Shared styles (matching WorkOrderMaster) ─────────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";

const cellSelect =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
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
      cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    };
  if (s === "short closed")
    return {
      icon: <XCircle size={12} />,
      cls: "bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700",
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

// Items are tagged with CGST, SGST, and IGST rates all at once in Item
// Master — which one actually applies depends on whether the supplier and
// ordering company share a GST state. Shared by every line-item source
// (manual item pick, MR prefill, Quotation prefill) so a PO's GST split
// isn't at the mercy of whichever fields happen to be populated on the
// item master row — most items only ever have M_IGST filled in, which
// used to mean every prefilled line showed IGST regardless of whether the
// order was actually intrastate.
function resolveLineGstSplit(
  cgst: number,
  sgst: number,
  igst: number,
  resolvedTotal: number,
  isIntraState: boolean,
): { cgstRate: number; sgstRate: number; igstRate: number; gstRate: number } {
  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;
  if (isIntraState) {
    if (cgst > 0 || sgst > 0) {
      cgstRate = cgst;
      sgstRate = sgst;
    } else if (igst > 0) {
      // Only an IGST rate is on file — split it evenly for an intrastate order.
      cgstRate = igst / 2;
      sgstRate = igst / 2;
    } else if (resolvedTotal > 0) {
      cgstRate = resolvedTotal / 2;
      sgstRate = resolvedTotal / 2;
    }
  } else {
    if (igst > 0) {
      igstRate = igst;
    } else if (cgst > 0 || sgst > 0) {
      // Only a CGST/SGST split is on file — combine it for an interstate order.
      igstRate = cgst + sgst;
    } else if (resolvedTotal > 0) {
      igstRate = resolvedTotal;
    }
  }
  return { cgstRate, sgstRate, igstRate, gstRate: cgstRate + sgstRate + igstRate };
}

// ─── Main Component ───────────────────────────────────────────────────────────

type ViewMode = "list" | "create" | "edit" | "view";

const PurchaseOrderMaster: React.FC = () => {
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const rights = usePageRights("purchase-orders");
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { finYears } = useFinYear();

  // ── MR prefill (when navigated from Material Request "Create PO") ─────────
  const mrPrefill =
    (location.state as { mrPrefill?: MRPOPrefill } | null)?.mrPrefill ?? null;

  // ── WD prefill (when navigated from Work Done "Create Material PO") ──────
  const wdPrefill =
    (location.state as { wdPrefill?: WDPOPrefill } | null)?.wdPrefill ?? null;

  // ── WO prefill (when navigated from Work Order "Create Material PO") ──────
  const woPrefill =
    (location.state as { woPrefill?: WOPOPrefill } | null)?.woPrefill ?? null;

  // ── QT prefill (when navigated from the L1 Price Comparative Chart) ───────
  const qtPrefill =
    (location.state as { qtPrefill?: QTPOPrefill } | null)?.qtPrefill ?? null;

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingPO, setViewingPO] = useState<any | null>(null);
  const [viewingPOSupplier, setViewingPOSupplier] =
    useState<SupplierDetails | null>(null);
  const [viewingPOCompany, setViewingPOCompany] =
    useState<CompanyDetails | null>(null);
  const [viewingPOProject, setViewingPOProject] =
    useState<CompanyDetails | null>(null);
  const [viewingTab, setViewingTab] = useState<"details" | "supplier">("details");
  const { currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const limit = 10;
  const [poTypeFilter, setPoTypeFilter] = useState<string>(""); // "" = All

  // ── Doc number state ──────────────────────────────────────────────────────
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const poDocTypeIdRef = useRef<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [, setPoFormPatchKey] = useState(0);
  const [, setDocRefreshTrigger] = useState(0);

  // ── PO doc types (for the plain Document Type & Number select) ───────────
  const [poDocTypes, setPoDocTypes] = useState<DocType[]>([]);
  const [poDocTypesLoading, setPoDocTypesLoading] = useState(true);

  useEffect(() => {
    setPoDocTypesLoading(true);
    fetchDocTypes("PO")
      .then((types) => {
        // Mirror the ExB-PO exclusion that DocNumberPreview applied internally
        const filtered = types.filter((dt) => {
          const label = dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix;
          return !label.startsWith("ExB-PO");
        });
        setPoDocTypes(filtered);
        // Auto-select QPO when arriving from L1 chart, DPO otherwise
        if (!poDocTypeId && filtered.length > 0) {
          const preferredPrefix = qtPrefill ? "QPO" : "DPO";
          const preferred =
            filtered.find((dt) => (dt.DocNoPrefix ?? dt.Prefix) === preferredPrefix) ??
            filtered.find((dt) => (dt.DocNoPrefix ?? dt.Prefix) === "DPO") ??
            filtered[0];
          fetchNextDocNumber(
            preferred.TypeOfDocId,
            selectedFinYear || undefined,
          ).then((docNo) => applyPoDocNumber(preferred.TypeOfDocId, docNo));
        }
      })
      .finally(() => setPoDocTypesLoading(false));
    // qtPrefill is included so arriving from the L1 chart via a
    // location.state update (without a full remount of this page) still
    // re-evaluates the QPO-vs-DPO auto-select instead of using whatever
    // was captured on the very first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtPrefill]);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter(
    (fy) => fy.status === "Active" && !fy.locked,
  );
  const [selectedFinYear, setSelectedFinYear] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) setSelectedFinYear(activeFinYear);
  }, [activeFinYear, selectedFinYear]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState<POForm>(EMPTY_FORM());
  const [lineItems, setLineItems] = useState<POLineItem[]>([EMPTY_LINE()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteBlockInfo, setDeleteBlockInfo] = useState<{
    reason: string;
    grns?: { grnId: number; grnNo: string; status: string }[];
    expenseBookings?: { id: number; docNo: string; status: string }[];
    clearedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      brsId: number;
      expenseDocNo: string;
    }[];
    linkedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      expenseDocNo: string;
    }[];
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);
  // Source MR reference — set when form is opened from a Material Request
  const [sourceMR, setSourceMR] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Source Quotation reference — set when form is opened from the L1 Chart
  const [sourceQT, setSourceQT] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // ── Approved MR dropdown ──────────────────────────────────────────────────
  const [mrDropdownValue, setMrDropdownValue] = useState<string>("");
  const [mrDropdownLoading, setMrDropdownLoading] = useState(false);
  const [mrDropdownError, setMrDropdownError] = useState<string | null>(null);
  // Filters applied BEFORE the MR dropdown to narrow approved MRs
  const [mrFilterCompanyId, setMrFilterCompanyId] = useState<string>("");
  const [mrFilterProjectId, setMrFilterProjectId] = useState<string>("");

  // Source WD reference — set when form is opened from a Work Done entry
  const [sourceWD, setSourceWD] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Source WO reference — set when form is opened from a Work Order (Material PO)
  const [sourceWO, setSourceWO] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Source Sale Invoice reference — manually linked by user on the PO form
  const [sourceSaleInvoice, setSourceSaleInvoice] = useState<{
    id: number;
    docNo: string;
  } | null>(null);
  const [saleInvoiceInput, setSaleInvoiceInput] = useState("");

  // ── Supplier & Company detail state (auto-fetched on selection) ────────────────────
  const [supplierDetails, setSupplierDetails] =
    useState<SupplierDetails | null>(null);
  const [companyDetails, setCompanyDetails] = useState<CompanyDetails | null>(
    null,
  );

  // Whether the selected supplier and company are in the same GST state —
  // drives CGST+SGST vs IGST on every line item below. Mirrors the same
  // normalizeState + fallback-to-intrastate pattern used server-side in
  // expenseBooking.js / buildGrnGstData.js, so a PO and its downstream
  // GRN/invoice never disagree on tax mode. Defaults to intrastate when
  // either state is unknown, rather than silently charging IGST.
  const normalizeState = (v: string | null | undefined) =>
    String(v || "").trim().toLowerCase();
  const isIntraState = useMemo(() => {
    const supState = normalizeState(supplierDetails?.LGSTState);
    const compState = normalizeState(companyDetails?.state);
    return !supState || !compState || supState === compState;
  }, [supplierDetails?.LGSTState, companyDetails?.state]);
  // Reuses CompanyDetails shape — the enterprise table holds Project rows
  // too, so the same getCompanyDetails() lookup gives us the project's
  // address to show as the PO's delivery address.
  const [projectDetails, setProjectDetails] = useState<CompanyDetails | null>(
    null,
  );

  // Must be declared after sourceMR, sourceWD, sourceWO — all used in `enabled`
  const { data: approvedMRs = [], isLoading: approvedMRsLoading } = useQuery({
    queryKey: ["approvedMRList", mrFilterCompanyId, mrFilterProjectId],
    queryFn: () =>
      getApprovedMRList({
        companyId: mrFilterCompanyId || undefined,
        projectId: mrFilterProjectId || undefined,
      }),
    enabled: viewMode === "create" && !sourceMR && !sourceWD && !sourceWO,
    staleTime: 30_000,
  });

  // ── Remote data ───────────────────────────────────────────────────────────
  const { data: dbData, isLoading } = useQuery({
    queryKey: ["purchase-orders", page, limit, poTypeFilter],
    queryFn: () =>
      getPurchaseOrders({
        page,
        limit,
        poType: poTypeFilter || undefined,
        includeShortClosed: true,
      }),
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
  const { data: itemUomAlternates = [] } = useQuery({
    queryKey: ["item-uom-alternates"],
    queryFn: getAllItemUomAlternates,
    staleTime: 60_000,
  });
  const { data: itemsRaw = [] } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });
  // HSN-resolved GST rates — authoritative source for GST%, since
  // Item_Master_Group.M_CGST/M_SGST/M_IGST are often stale/unset while the
  // HSN Master has the current rate (see getItemsWithGST for resolution order).
  const { data: itemsGstRaw = [] } = useQuery({
    queryKey: ["items-with-gst"],
    queryFn: getItemsWithGST,
  });
  const { data: tcRaw = [] } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
  });

  const { data: enterprisesRaw = [] } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
  });

  const { data: costCenters = [] } = useQuery<{ id: number; label: string }[]>({
    queryKey: ["cost-centers-po"],
    queryFn: () =>
      fetchWithAuth("/api/cost-center/options").then((r) =>
        r.json().catch(() => ({})),
      ),
  });

  // ── Normalise data ────────────────────────────────────────────────────────
  const suppliers = useMemo(
    () =>
      ensureArray<any>(suppliersRaw).map((s) => ({
        id: String(s.LHeadId),
        name: s.LHeadName ?? "",
      })),
    [suppliersRaw],
  );

  const companies = useMemo(
    () =>
      ensureArray<any>(companiesRaw).map((c) => ({
        id: String(c.id),
        name: c.label ?? "",
      })),
    [companiesRaw],
  );

  const allProjects = useMemo(
    () =>
      ensureArray<any>(projectsRaw).map((p) => ({
        id: String(p.id),
        name: p.label ?? "",
        belongsTo: p.belongs_to ?? null,
        companyId: p.company_id != null ? String(p.company_id) : null,
      })),
    [projectsRaw],
  );

  // Projects filtered by the MR filter company (for the MR filter dropdown)
  const filteredMRProjects = useMemo(() => {
    if (!mrFilterCompanyId) return allProjects;
    return allProjects.filter((p) => p.companyId === mrFilterCompanyId);
  }, [allProjects, mrFilterCompanyId]);

  // Projects filtered by the form's selected company (for Order Details)
  const filteredFormProjects = useMemo(() => {
    if (!form.companyId) return allProjects;
    return allProjects.filter((p) => p.companyId === form.companyId);
  }, [allProjects, form.companyId]);

  const uoms = useMemo(
    () =>
      ensureArray<any>(uomsRaw)
        .filter((u) => u.IsActive !== false && u.IsActive !== 0)
        .map((u) => ({
          id: Number(u.Id),
          name: u.UOMName ?? "",
          code: (u.UOMCode ?? "").toString().trim(),
          category: (u.UOMCategory ?? null) as string | null,
          baseFactor: Number(u.BaseFactor) || 1,
        }))
        .filter((u) => u.name !== ""),
    [uomsRaw],
  );

  const itemsGstById = useMemo(() => {
    const map = new Map<string, { gstRate: number; hsnCode: string | null }>();
    for (const i of itemsGstRaw) map.set(String(i.id), i);
    return map;
  }, [itemsGstRaw]);

  const items = useMemo(
    () =>
      ensureArray<DbItem>(itemsRaw).map((i) => ({
        id: i.M_Id,
        name: i.M_Name,
        description: i.M_Description ?? "",
        hsn: i.M_HSN ?? "",
        uom: i.M_UOM ?? "",
        itemType: i.M_Type ?? "",
        cgst: Number(i.M_CGST ?? 0),
        sgst: Number(i.M_SGST ?? 0),
        igst: Number(i.M_IGST ?? 0),
        // HSN-resolved rate — takes precedence over the raw item-master
        // columns above, which are frequently stale/unset.
        resolvedGstRate: itemsGstById.get(String(i.M_Id))?.gstRate ?? null,
      })),
    [itemsRaw, itemsGstById],
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

  // ── Company logo — prefer the selected company's own logo; fall back to enterprise logo ──
  const enterpriseLogo = useMemo(() => {
    const list = ensureArray<any>(enterprisesRaw);
    const enterprise =
      list.find((e) => e.entity_type === "Enterprise") ?? list[0];
    return (enterprise?.logo as string | null) ?? null;
  }, [enterprisesRaw]);

  // The logo shown in print/preview: company-specific first, then enterprise fallback
  const activeLogo = companyDetails?.logo ?? enterpriseLogo;

  // ── Print handler — uses Blob URL so base64 logo renders correctly ─────────
  const handlePrint = () => {
    // All of these snapshots are interpolated into the print HTML below, so
    // they are HTML-escaped at the source to prevent stored data (supplier
    // names, addresses, remarks, etc.) from injecting markup/script into the
    // print window (which is same-origin and can read the auth token).
    const supplier = escapeHtml(
      suppliers.find((s) => s.id === form.supplierId)?.name ?? "—",
    );
    const company = escapeHtml(
      companies.find((c) => c.id === form.companyId)?.name ?? "—",
    );
    const project = escapeHtml(
      allProjects.find((p) => p.id === form.projectId)?.name ?? "—",
    );

    // Supplier & company detail snapshots for print
    const supAddr = escapeHtml(supplierDetails?.LHeadAddress ?? "");
    const supContact = escapeHtml(supplierDetails?.LHeadContactPerson ?? "");
    const supGST = escapeHtml(supplierDetails?.LGST ?? "");
    const supPhone = escapeHtml(supplierDetails?.LHeadPhone ?? "");
    const supEmail = escapeHtml(supplierDetails?.LHeadEmail ?? "");
    const compAddr = escapeHtml(
      [
        companyDetails?.address,
        companyDetails?.address_line2,
        companyDetails?.city,
        companyDetails?.state,
        companyDetails?.pincode,
      ]
        .filter(Boolean)
        .join(", "),
    );
    const compGST = escapeHtml(companyDetails?.gst_no ?? "");
    const compEmail = escapeHtml(companyDetails?.email ?? "");
    const compPhone = escapeHtml(companyDetails?.phone_number ?? "");

    // Logo: company-specific logo first, then enterprise fallback
    const logoHtml = activeLogo
      ? `<img src="${escapeHtml(activeLogo)}" alt="Logo" style="height:64px;max-width:200px;object-fit:contain;" />`
      : `<span style="font-size:20px;font-weight:800;color:#4f46e5;">${company}</span>`;

    // PO status badge for print
    const poStatus = form.status || "Draft";
    const statusColors: Record<
      string,
      { bg: string; color: string; border: string }
    > = {
      approved: { bg: "#f0fdf4", color: "#166534", border: "#86efac" },
      pending: { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
      draft: { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
      rejected: { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
    };
    const sc = statusColors[poStatus.toLowerCase()] ?? statusColors.draft;
    const statusHtml = `<span style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sc.bg};color:${sc.color};border:1px solid ${sc.border};letter-spacing:0.05em;">${escapeHtml(poStatus.toUpperCase())}</span>`;

    const itemRows = lineItems
      .map(
        (li, i) => safeHtml`
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
        <td style="padding:8px 10px;font-weight:500;">${li.itemName || "—"}</td>
        <td style="padding:8px 10px;color:#6b7280;font-size:12px;">${li.itemDescription || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">${li.quantity}</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;">${li.unit || "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">₹${li.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px 10px;text-align:center;">${li.gstRate > 0 ? li.gstRate + "%" : "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;">₹${li.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`,
      )
      .join("");

    const taxRows = [
      totalCgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">CGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalSgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">SGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalIgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">IGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
    ].join("");

    const tcHtml = form.paymentTerms
      ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
           <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:8px;">Terms &amp; Conditions</div>
           <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.7;">${escapeHtml(form.paymentTerms)}</div>
         </div>`
      : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>PO — ${escapeHtml(form.poNumber || "—")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; }
    @media print {
      body { padding: 16px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #4f46e5;margin-bottom:28px;">
    <div>${logoHtml}</div>
    <div style="text-align:right;">
      <div style="font-size:24px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PURCHASE ORDER</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${escapeHtml(form.poNumber || "—")}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px;">Date: <strong>${fmtDate(form.poDate)}</strong></div>
      ${form.expectedDate ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">Expected: <strong>${fmtDate(form.expectedDate)}</strong></div>` : ""}
      ${statusHtml}
    </div>
  </div>

  <!-- Party details -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;">
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Supplier</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${supplier}</div>
      ${supAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${supAddr}</div>` : ""}
      ${supContact ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Contact: <strong style="color:#111827;">${supContact}</strong></div>` : ""}
      ${supPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${supPhone}</div>` : ""}
      ${supEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${supEmail}</div>` : ""}
      ${supGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${supGST}</span></div>` : ""}
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Billing Details</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${company}</div>
      ${compAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${compAddr}</div>` : ""}
      ${compPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${compPhone}</div>` : ""}
      ${compEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${compEmail}</div>` : ""}
      ${compGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${compGST}</span></div>` : ""}
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Project / Site</div>
      <div style="font-weight:600;font-size:13px;">${project}</div>
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center;">#</th>
        <th style="text-align:left;">Item</th>
        <th style="text-align:left;">Description</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:center;">UOM</th>
        <th style="text-align:right;">Rate (₹)</th>
        <th style="text-align:center;">GST %</th>
        <th style="text-align:right;">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-top:16px;">
    <table style="width:260px;border-collapse:collapse;">
      <tbody>
        <tr><td style="color:#6b7280;padding:5px 8px;">Subtotal (excl. GST)</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
        ${taxRows}
        <tr style="border-top:2px solid #4f46e5;">
          <td style="padding:8px;font-weight:800;font-size:14px;">Grand Total</td>
          <td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;font-size:15px;color:#4f46e5;">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${tcHtml}

  ${form.remarks ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${escapeHtml(form.remarks)}</div></div>` : ""}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body>
</html>`;

    // Use Blob URL — avoids document.write CSP issues with base64 images
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank", "width=960,height=720");
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error("Pop-up blocked — please allow pop-ups for this site.");
      return;
    }
    // Revoke after enough time for the window to load and print
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  // ── Derived list data ─────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  const listData: POListItem[] = useMemo(
    () =>
      dbItems.map((item) => ({
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
        poType: item.POType ?? "Direct",
        sourceWODocNo: item.SourceWODocNo ?? null,
      })),
    [dbItems, suppliers, companies, allProjects],
  );

  // ── Pre-populate form when arriving from Material Request ─────────────────
  useEffect(() => {
    if (
      !mrPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    )
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(mrPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(mrPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: mrPrefill.Remarks ?? prev.remarks,
    }));

    const prefillLines: POLineItem[] = mrPrefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
      // Default to what's actually still pending on this MR item, not the
      // original full requested qty — a second/third PO off the same MR
      // should only ever offer the remaining balance.
      const pendingQty = Number(it.PendingQty ?? it.Quantity ?? 1);
      const qty = pendingQty;
      const rate = 0;
      const taxAmount = (qty * rate * gstRate) / 100;

      // Resolve UOM: match UOMCode against master code, fallback to UOMName
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;

      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        mrItemId: it.MRItemId ?? null,
        mrPendingQty: pendingQty,
      };
    });

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceMR({ id: mrPrefill.MRId, docNo: mrPrefill.DocNo });

    // Auto-select fin year from MR
    if (mrPrefill.FinYearId) {
      const matchFY = finYears.find(
        (fy) => String(fy.id) === String(mrPrefill.FinYearId),
      );
      if (matchFY) setSelectedFinYear(matchFY.year);
    }

    setViewMode("create");
    // Only run once when mrPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrPrefill, companies.length, allProjects.length, uoms.length]);

  // ── Pre-populate form when arriving from the L1 Price Comparative Chart ───
  // The winning supplier and their quoted rates are already known — unlike
  // the MR prefill, this pre-fills supplierId and each line's rate too.
  useEffect(() => {
    if (
      !qtPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    )
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(qtPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(qtPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      supplierId: qtPrefill.SupplierId
        ? String(qtPrefill.SupplierId)
        : prev.supplierId,
      remarks: qtPrefill.Remarks ?? prev.remarks,
    }));

    const prefillLines: POLineItem[] = qtPrefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
      const qty = Number(it.Quantity ?? 1);
      const rate = Number(it.Rate ?? 0);
      const taxAmount = (qty * rate * gstRate) / 100;

      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;

      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        uomLocked: true,
      };
    });

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceQT({ id: qtPrefill.QuotationId, docNo: qtPrefill.DocNo });
    if (qtPrefill.SourceMRId && qtPrefill.SourceMRDocNo) {
      setSourceMR({ id: qtPrefill.SourceMRId, docNo: qtPrefill.SourceMRDocNo });
    }

    setViewMode("create");
    // Only run once when qtPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtPrefill, companies.length, allProjects.length, uoms.length]);

  // ── Pre-populate form when arriving from Work Done "Create WO_PO" ─────────
  useEffect(() => {
    if (!wdPrefill || companies.length === 0 || allProjects.length === 0)
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(wdPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(wdPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: wdPrefill.Remarks ?? prev.remarks,
    }));

    const prefillLines: POLineItem[] = wdPrefill.items.map((it) => ({
      id: uid(),
      itemId: "",
      itemName: "",
      itemDescription: it.itemDescription ?? "",
      quantity: Number(it.quantity) || 1,
      uomId: null,
      unit: it.unit ?? "LS",
      rate: Number(it.rate) || 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      gstRate: 0,
      taxAmount: 0,
      amount: Number(it.amount) || 0,
    }));

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceWD({ id: wdPrefill.WDId, docNo: wdPrefill.DocNo });
    setViewMode("create");
    // Only run once when wdPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdPrefill, companies.length, allProjects.length]);

  // ── Apply WO prefill (material lines from Work Order) ─────────────────────
  useEffect(() => {
    if (
      !woPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      suppliers.length === 0 ||
      uoms.length === 0 ||
      items.length === 0
    )
      return;

    // Try to match a single supplier from the prefill items
    const supplierNames = [
      ...new Set(woPrefill.items.map((i) => i.supplierName).filter(Boolean)),
    ];
    const matchedSupplier =
      supplierNames.length === 1
        ? suppliers.find(
            (s) => s.name.toLowerCase() === supplierNames[0]!.toLowerCase(),
          )
        : null;

    setForm((prev) => ({
      ...prev,
      companyId: woPrefill.CompanyId
        ? String(woPrefill.CompanyId)
        : prev.companyId,
      projectId: woPrefill.ProjectId
        ? String(woPrefill.ProjectId)
        : prev.projectId,
      supplierId: matchedSupplier ? matchedSupplier.id : prev.supplierId,
    }));
    const prefillLines: POLineItem[] = woPrefill.items.map((it) => {
      // Split combined GST% into CGST+SGST halves (intra-state assumption for WO-PO).
      // If the item later gets an IGST designation the user can override in the line.
      const totalGst = Number(it.tax) || 0;
      const halfGst = totalGst / 2;
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      const base = qty * rate;
      const taxAmt = (base * totalGst) / 100;

      // Resolve unit string → UOM master entry
      // 1. Try direct match on the unit string (code or name)
      const unitNorm = (it.unit || "").trim().toLowerCase();
      let uomMatch = unitNorm
        ? (uoms.find(
            (u) =>
              u.code.toLowerCase() === unitNorm ||
              u.name.toLowerCase() === unitNorm,
          ) ?? null)
        : null;

      // 2. Fallback: look up item master M_UOM when itemId is available
      if (!uomMatch && it.itemId) {
        const masterItem = items.find((i) => i.id === it.itemId);
        if (masterItem?.uom) {
          const mUomNorm = masterItem.uom.trim().toLowerCase();
          uomMatch =
            uoms.find(
              (u) =>
                u.code.toLowerCase() === mUomNorm ||
                u.name.toLowerCase() === mUomNorm,
            ) ?? null;
        }
      }

      return {
        id: generateUUID(),
        itemId: it.itemId || "",
        itemName: it.itemDescription,
        itemDescription: it.itemDescription,
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.unit ?? "",
        rate,
        cgstRate: halfGst,
        sgstRate: halfGst,
        igstRate: 0,
        gstRate: totalGst,
        taxAmount: taxAmt,
        amount: base + taxAmt,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceWO({
      id: woPrefill.WOId,
      docNo: woPrefill.DocNo || woPrefill.DocumentNumber,
    });
    setViewMode("create");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    woPrefill,
    companies.length,
    allProjects.length,
    suppliers.length,
    uoms.length,
    items.length,
  ]);

  // ── Apply an MRPOPrefill object to the form (shared by both prefill paths) ──
  const applyMRPrefill = (prefill: MRPOPrefill) => {
    const matchCompany = companies.find(
      (c) => String(c.id) === String(prefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(prefill.ProjectId),
    );

    // Resolve fin year: match prefill.FinYearId against context finYears
    if (prefill.FinYearId) {
      const matchFY = finYears.find(
        (fy) => String(fy.id) === String(prefill.FinYearId),
      );
      if (matchFY) setSelectedFinYear(matchFY.year);
    }

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: prefill.Remarks ?? prev.remarks,
    }));
    const prefillLines: POLineItem[] = prefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
      const pendingQty = Number(it.PendingQty ?? it.Quantity ?? 1);
      const qty = pendingQty;
      const rate = 0;
      const taxAmount = (qty * rate * gstRate) / 100;
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;
      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        mrItemId: it.MRItemId ?? null,
        mrPendingQty: pendingQty,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceMR({ id: prefill.MRId, docNo: prefill.DocNo });
    setMrDropdownError(null);
  };

  const handleMRDropdownSelect = async (mrId: string) => {
    setMrDropdownValue(mrId);
    if (!mrId) return;
    if (
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    ) {
      setMrDropdownError("Master data still loading — please wait a moment.");
      return;
    }
    setMrDropdownLoading(true);
    setMrDropdownError(null);
    try {
      const prefill = await getMRPOPrefill(Number(mrId));
      applyMRPrefill(prefill);
      setViewMode("create");
    } catch (err: any) {
      setMrDropdownError(err.message ?? "Could not load Material Request.");
    } finally {
      setMrDropdownLoading(false);
    }
  };

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
      // A line is CGST+SGST when cgstRate or sgstRate > 0; otherwise IGST
      const cgst = lineItems.reduce((s, li) => {
        if (li.cgstRate <= 0) return s;
        return s + (li.quantity * li.rate * li.cgstRate) / 100;
      }, 0);
      const sgst = lineItems.reduce((s, li) => {
        if (li.sgstRate <= 0) return s;
        return s + (li.quantity * li.rate * li.sgstRate) / 100;
      }, 0);
      const igst = lineItems.reduce((s, li) => {
        if (li.cgstRate > 0 || li.sgstRate > 0) return s; // CGST+SGST item — no IGST
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
  const applyPoDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
    poDocTypeIdRef.current = docTypeId;
    setPoDocNo(docNo);
    setForm((p) => ({ ...p, poNumber: docNo, docNo, docTypeId }));
    setPoFormPatchKey((c) => c + 1);
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
    setDocRefreshTrigger((c) => c + 1);
    return nextDocNo;
  };

  // ── Auto-select WO_PO doc type when form is opened from a Work Order ─────
  useEffect(() => {
    if (!sourceWO || poDocTypeIdRef.current) return; // already selected or not a WO-sourced form
    fetchDocTypes("WO_PO").then(async (docTypes) => {
      // Lock to the doc type whose Prefix is "WO-PO" (dash, as seeded in TypeOfDoc)
      // Fall back to "WO_PO" (underscore) for legacy installs
      const woPo =
        docTypes.find((d) => d.Prefix === "WO-PO") ??
        docTypes.find((d) => d.Prefix === "WO_PO");
      if (!woPo) return;
      const nextDocNo = await fetchNextDocNumber(
        woPo.TypeOfDocId,
        selectedFinYear || undefined,
      );
      applyPoDocNumber(woPo.TypeOfDocId, nextDocNo);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceWO, selectedFinYear]);

  // ── Auto-switch doc type between PO (MR/Sale Invoice) and DPO (Direct) ───
  useEffect(() => {
    if (viewMode !== "create" || sourceWO) return; // WO has its own effect
    const hasMROrSI = !!(sourceMR || sourceSaleInvoice);
    const targetPrefix = hasMROrSI ? "PO" : "DPO";
    const target = poDocTypes.find(
      (dt) => (dt.DocNoPrefix ?? dt.Prefix) === targetPrefix,
    );
    if (!target) return;
    // Use ref to avoid stale closure on poDocTypeId
    if (poDocTypeIdRef.current === target.TypeOfDocId) return;
    fetchNextDocNumber(target.TypeOfDocId, selectedFinYear || undefined).then(
      (docNo) => applyPoDocNumber(target.TypeOfDocId, docNo),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMR, sourceSaleInvoice, sourceWO, viewMode, poDocTypes]);

  // ── Line item helpers ─────────────────────────────────────────────────────
  const updateLine = (idx: number, patch: Partial<POLineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const updated = { ...li, ...patch };
        const baseAmount = updated.quantity * updated.rate;
        // Recalculate gstRate from whichever split is active
        if (
          patch.igstRate !== undefined ||
          patch.cgstRate !== undefined ||
          patch.sgstRate !== undefined
        ) {
          updated.gstRate =
            updated.cgstRate > 0 || updated.sgstRate > 0
              ? updated.cgstRate + updated.sgstRate
              : updated.igstRate;
        }
        updated.taxAmount = (baseAmount * updated.gstRate) / 100;
        updated.amount = baseAmount + updated.taxAmount;
        return updated;
      }),
    );
  };

  const addLine = () => setLineItems((p) => [...p, EMPTY_LINE()]);

  const removeLine = (idx: number) => {
    if (lineItems.length === 1) return;
    setLineItems((p) => p.filter((_, i) => i !== idx));
  };

  const handleItemSelect = (idx: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const itemUomNorm = item.uom.trim().toLowerCase();
    const uomMatch = uoms.find(
      (u) =>
        u.code.toLowerCase() === itemUomNorm ||
        u.name.toLowerCase() === itemUomNorm,
    );
    // Items are tagged with CGST, SGST, and IGST rates all at once — which
    // one actually applies depends on whether the supplier and the ordering
    // company are in the same GST state (isIntraState, computed above from
    // supplierDetails.LGSTState vs companyDetails.state). Same state →
    // CGST+SGST; different state → IGST. This is why the identical item can
    // price out differently on two POs raised against two different-state
    // suppliers.
    const { cgstRate, sgstRate, igstRate, gstRate } = resolveLineGstSplit(
      Number(item.cgst ?? 0),
      Number(item.sgst ?? 0),
      Number(item.igst ?? 0),
      item.resolvedGstRate ?? 0,
      isIntraState,
    );

    updateLine(idx, {
      itemId,
      itemName: item.name,
      itemDescription: item.description,
      uomId: uomMatch?.id ?? null,
      unit: uomMatch?.name ?? item.uom,
      cgstRate,
      sgstRate,
      igstRate,
      gstRate,
    });
  };

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setField = <K extends keyof POForm>(key: K, value: POForm[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    const hasBackendNumbering =
      viewMode === "create" && !!(form.docTypeId ?? poDocTypeId);
    if (!form.poNumber && !hasBackendNumbering) e.poNumber = true;
    if (!form.poDate) e.poDate = true;
    if (!form.supplierId) e.supplierId = true;
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.costCenterId) e.costCenterId = true;
    if (lineItems.every((li) => !li.itemName && !li.quantity))
      e.lineItems = true;
    setErrors(e);
    if (Object.keys(e).length > 0) return false;

    // MR-sourced lines can't exceed what's still pending on that MR item —
    // a repeat PO off the same MR must stay within the remaining balance.
    const overCap = lineItems.find(
      (li) =>
        li.mrItemId != null &&
        li.mrPendingQty != null &&
        li.quantity - li.mrPendingQty > 0.0001,
    );
    if (overCap) {
      toast.error(
        `"${overCap.itemName}" exceeds the pending Material Request quantity (max ${overCap.mrPendingQty}).`,
      );
      return false;
    }
    return true;
  };

  const toPayload = () => {
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    const company = companies.find((c) => c.id === form.companyId);
    const project = allProjects.find((p) => p.id === form.projectId);
    const validItems = lineItems.filter((li) => li.itemName || li.quantity > 0);
    const docTypeId = form.docTypeId ?? poDocTypeId;
    const backendNumbered = viewMode === "create" && !!docTypeId;
    return {
      PurchaseOrderNo: backendNumbered ? null : form.poNumber || null,
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
        itemId: li.itemId || null,
        itemDescription: li.itemName,
        description: li.itemDescription || null,
        unit: li.unit,
        uomId: li.uomId ?? null,
        quantity: li.quantity,
        rate: li.rate,
        tax: li.gstRate,
        cgstRate: li.cgstRate,
        sgstRate: li.sgstRate,
        igstRate: li.igstRate,
        gstType: li.igstRate > 0 ? "igst" : "cgst_sgst",
        amount: li.amount,
        mrItemId: li.mrItemId ?? null,
      })),
      PaymentTerms:
        selectedTCs.length > 0
          ? selectedTCs.map((tc) => `${tc.name}: ${tc.terms}`).join("\n\n")
          : form.paymentTerms || null,
      Status:
        viewMode === "edit"
          ? (listData.find((r) => r._id === editingId)?.status ?? "Draft")
          : "Pending", // creation always auto-submits; backend ignores this field on create anyway
      Remarks: form.remarks || null,
      CostCenterId: form.costCenterId ? parseInt(form.costCenterId, 10) : null,
      DocTypeId: docTypeId,
      DocNo: backendNumbered
        ? null
        : form.poNumber || form.docNo || poDocNo || null,
      finYear: selectedFinYear || null,
      // Source tracking
      SourceMRId: sourceMR?.id ?? null,
      SourceMRDocNo: sourceMR?.docNo ?? null,
      SourceQTId: sourceQT?.id ?? null,
      SourceQTDocNo: sourceQT?.docNo ?? null,
      SourceWDId: sourceWD?.id ?? null,
      SourceWDDocNo: sourceWD?.docNo ?? null,
      SourceWOId: sourceWO?.id ?? null,
      SourceWODocNo: sourceWO?.docNo ?? null,
      SourceSaleOrderId: null,
      SourceSaleOrderDocNo: null,
      SourceSaleInvoiceId: sourceSaleInvoice?.id ?? null,
      SourceSaleInvoiceDocNo: sourceSaleInvoice?.docNo ?? null,
      POType: (sourceQT
        ? "QPO"
        : sourceMR
          ? "Normal"
          : sourceWD || sourceWO
            ? "WO_PO"
            : "Direct") as "Normal" | "WO_PO" | "Direct" | "QPO",
    };
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      if (viewMode === "create") {
        const created = await addPurchaseOrder(toPayload());
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        if (created?.PurchaseOrderNo) {
          setForm((p) => ({
            ...p,
            poNumber: created.PurchaseOrderNo,
            docNo: created.PurchaseOrderNo,
          }));
          setPoDocNo(created.PurchaseOrderNo);
        }
        toast.success("Purchase Order created and sent for approval!");
        const savedDocTypeId = form.docTypeId ?? poDocTypeId;
        await refreshPoDocNumber(savedDocTypeId);
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          goToList();
        }, 1200);
      } else if (viewMode === "edit" && editingId) {
        await updatePurchaseOrder(editingId, toPayload());
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        toast.success("Purchase Order updated successfully!");
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          goToList();
        }, 1200);
      }
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/purchase-orders/${id}/can-delete`);
      const data = await res.json();
      if (!data.deletable) {
        setDeleteBlockInfo(data);
        return;
      }
      setDeleteConfirmId(id);
    } catch (err: any) {
      toast.error(`Check failed: ${err.message}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deletePurchaseOrder(deleteConfirmId);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase Order deleted.");
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleApprovalSuccess = async (
    recordId?: string,
    action?: "submit" | "approve" | "reject",
  ) => {
    // Optimistically update the cached row status so the UI reflects
    // the change immediately without waiting for the refetch round-trip.
    if (recordId && action) {
      const nextStatus =
        action === "submit"
          ? "Pending"
          : action === "approve"
            ? "Approved"
            : "Rejected";

      queryClient.setQueriesData<any>(
        { queryKey: ["purchase-orders"] },
        (old: any) => {
          if (!old) return old;
          // handle both raw-array and { data: [] } response shapes
          const rows: any[] = Array.isArray(old) ? old : (old?.data ?? []);
          const updated = rows.map((row: any) =>
            String(row.PurchaseOrderID) === recordId
              ? { ...row, Status: nextStatus }
              : row,
          );
          return Array.isArray(old) ? updated : { ...old, data: updated };
        },
      );
    }

    // Small delay to let the server-side cache version bump propagate
    // across workers before the refetch hits Redis.
    await new Promise((r) => setTimeout(r, 400));
    // Then invalidate so the server state syncs in the background.
    await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  // ── Auto-fetch supplier details on supplierId change ────────────────────
  useEffect(() => {
    if (!form.supplierId) {
      setSupplierDetails(null);
      return;
    }
    getSupplierDetails(form.supplierId).then(setSupplierDetails);
  }, [form.supplierId]);

  // ── Auto-fetch company details on companyId change ────────────────────────
  useEffect(() => {
    if (!form.companyId) {
      setCompanyDetails(null);
      return;
    }
    getCompanyDetails(form.companyId).then(setCompanyDetails);
  }, [form.companyId]);

  // ── Auto-fetch project details on projectId change (delivery address) ─────
  useEffect(() => {
    if (!form.projectId) {
      setProjectDetails(null);
      return;
    }
    getCompanyDetails(form.projectId).then(setProjectDetails);
  }, [form.projectId]);

  // ── Print from preview modal ──────────────────────────────────────────────
  const handlePrintFromPreview = () => {
    if (!viewingPO) return;
    const sup = viewingPOSupplier;
    const comp = viewingPOCompany;
    const proj = viewingPOProject;

    const supplierName =
      viewingPO.SupplierName ?? viewingPO.supplierName ?? "—";
    const companyName = viewingPO.CompanyName ?? viewingPO.companyName ?? "—";
    const projectName = viewingPO.ProjectName ?? viewingPO.projectName ?? "—";
    const poNumber = viewingPO.PurchaseOrderNo ?? viewingPO.poNumber ?? "—";
    const poDate = viewingPO.PODate ?? viewingPO.poDate ?? "";
    const expectedDate = viewingPO.ExpectedDeliveryDate ?? "";
    const poStatus = viewingPO.Status ?? viewingPO.status ?? "Draft";
    const remarks = viewingPO.Remarks ?? viewingPO.remarks ?? "";
    const payTerms = viewingPO.PaymentTerms ?? viewingPO.paymentTerms ?? "";

    const supplierNameEsc = escapeHtml(String(supplierName));
    const companyNameEsc = escapeHtml(String(companyName));
    const projectNameEsc = escapeHtml(String(projectName));
    const poNumberEsc = escapeHtml(String(poNumber));
    const poDateEsc = escapeHtml(String(poDate));
    const expectedDateEsc = escapeHtml(String(expectedDate));
    const remarksEsc = escapeHtml(String(remarks));
    const payTermsEsc = escapeHtml(String(payTerms));

    const isSafeLogoUrl =
      typeof activeLogo === "string" &&
      /^(https?:\/\/|data:image\/|\/)/i.test(activeLogo);
    const safeLogoSrc = isSafeLogoUrl ? escapeHtml(activeLogo) : "";
    const logoHtml = safeLogoSrc
      ? `<img src="${safeLogoSrc}" alt="Logo" style="height:64px;max-width:200px;object-fit:contain;" />`
      : `<span style="font-size:20px;font-weight:800;color:#4f46e5;">${companyNameEsc}</span>`;

    const statusColors: Record<
      string,
      { bg: string; color: string; border: string }
    > = {
      approved: { bg: "#f0fdf4", color: "#166534", border: "#86efac" },
      pending: { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
      draft: { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
      rejected: { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
    };
    const sc = statusColors[poStatus.toLowerCase()] ?? statusColors.draft;
    const statusHtml = `<span style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sc.bg};color:${sc.color};border:1px solid ${sc.border};letter-spacing:0.05em;">${poStatus.toUpperCase()}</span>`;

    const lineItemsArr: any[] = Array.isArray(viewingPO.LineItems)
      ? viewingPO.LineItems
      : Array.isArray(viewingPO.POItems)
        ? viewingPO.POItems
        : [];
    const itemRows = lineItemsArr
      .map((li: any, i: number) => {
        const name = li.ItemName ?? li.itemName ?? li.Description ?? "—";
        const desc = li.itemDescription ?? li.Description ?? "—";
        const qty = Number(li.Quantity ?? li.quantity ?? 0);
        const unit = li.UomName ?? li.UOMSymbol ?? li.unit ?? "—";
        const rate = Number(li.Rate ?? li.rate ?? 0);
        const tax = Number(li.TaxPct ?? li.gstRate ?? li.tax ?? 0);
        const amt = Number(li.LineAmount ?? li.amount ?? qty * rate);
        return `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
        <td style="padding:8px 10px;font-weight:500;">${name}</td>
        <td style="padding:8px 10px;color:#6b7280;font-size:12px;">${desc}</td>
        <td style="padding:8px 10px;text-align:center;">${qty}</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;">${unit}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">₹${rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px 10px;text-align:center;">${tax > 0 ? tax + "%" : "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;">₹${amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`;
      })
      .join("");

    const grandTotal = Number(
      viewingPO.TotalAmount ?? viewingPO.totalAmount ?? 0,
    );
    const subtotalVal = lineItemsArr.reduce(
      (s: number, li: any) =>
        s +
        Number(li.Quantity ?? li.quantity ?? 0) *
          Number(li.Rate ?? li.rate ?? 0),
      0,
    );
    // Per-line CGST/SGST/IGST breakdown — previously this print only ever
    // showed a Subtotal → Grand Total jump with no tax line at all, even
    // though the item table's own GST% column proved tax was applied.
    let totalCgstVal = 0;
    let totalSgstVal = 0;
    let totalIgstVal = 0;
    for (const li of lineItemsArr) {
      const base =
        Number(li.Quantity ?? li.quantity ?? 0) * Number(li.Rate ?? li.rate ?? 0);
      totalCgstVal += (base * Number(li.CgstRate ?? li.cgstRate ?? 0)) / 100;
      totalSgstVal += (base * Number(li.SgstRate ?? li.sgstRate ?? 0)) / 100;
      totalIgstVal += (base * Number(li.IgstRate ?? li.igstRate ?? 0)) / 100;
    }
    const taxRowsPreview = [
      totalCgstVal > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">CGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalCgstVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalSgstVal > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">SGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalSgstVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalIgstVal > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">IGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalIgstVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
    ].join("");

    const tcHtml = payTermsEsc
      ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:8px;">Terms &amp; Conditions</div><div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.7;">${payTermsEsc}</div></div>`
      : "";

    const supAddr = escapeHtml(sup?.LHeadAddress ?? "");
    const supContact = escapeHtml(sup?.LHeadContactPerson ?? "");
    const supGST = escapeHtml(sup?.LGST ?? "");
    const supPhone = escapeHtml(sup?.LHeadPhone ?? "");
    const supEmail = escapeHtml(sup?.LHeadEmail ?? "");
    const compAddr = escapeHtml(
      [comp?.address, comp?.address_line2, comp?.city, comp?.state, comp?.pincode]
        .filter(Boolean)
        .join(", "),
    );
    const compGST = escapeHtml(comp?.gst_no ?? "");
    const compEmail = escapeHtml(comp?.email ?? "");
    const compPhone = escapeHtml(comp?.phone_number ?? "");
    const projAddr = escapeHtml(
      proj ? [proj.address, proj.city, proj.state].filter(Boolean).join(", ") : "",
    );

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>PO — ${poNumberEsc}</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; } table { width: 100%; border-collapse: collapse; } thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; } @media print { body { padding: 16px; } }</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #4f46e5;margin-bottom:28px;">
  <div>${logoHtml}</div>
  <div style="text-align:right;">
    <div style="font-size:24px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PURCHASE ORDER</div>
    <div style="font-size:15px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${poNumberEsc}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:6px;">Date: <strong>${fmtDate(poDateEsc)}</strong></div>
    ${expectedDateEsc ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">Expected: <strong>${fmtDate(expectedDateEsc)}</strong></div>` : ""}
    ${statusHtml}
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;">
  <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Supplier</div>
    <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${supplierNameEsc}</div>
    ${supAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${supAddr}</div>` : ""}
    ${supContact ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Contact: <strong style="color:#111827;">${supContact}</strong></div>` : ""}
    ${supPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${supPhone}</div>` : ""}
    ${supEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${supEmail}</div>` : ""}
    ${supGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${supGST}</span></div>` : ""}
  </div>
  <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Billing Details</div>
    <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${companyNameEsc}</div>
    ${compAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${compAddr}</div>` : ""}
    ${compPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${compPhone}</div>` : ""}
    ${compEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${compEmail}</div>` : ""}
    ${compGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${compGST}</span></div>` : ""}
  </div>
  <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Project / Site</div>
    <div style="font-weight:600;font-size:13px;">${projectNameEsc}</div>
    ${projAddr}
  </div>
</div>
<table><thead><tr>
  <th style="width:32px;text-align:center;">#</th>
  <th style="text-align:left;">Item</th>
  <th style="text-align:left;">Description</th>
  <th style="text-align:center;">Qty</th>
  <th style="text-align:center;">UOM</th>
  <th style="text-align:right;">Rate (₹)</th>
  <th style="text-align:center;">GST %</th>
  <th style="text-align:right;">Amount (₹)</th>
</tr></thead><tbody>${itemRows}</tbody></table>
<div style="display:flex;justify-content:flex-end;margin-top:16px;">
  <table style="width:260px;border-collapse:collapse;"><tbody>
    <tr><td style="color:#6b7280;padding:5px 8px;">Subtotal (excl. GST)</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${subtotalVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
    ${taxRowsPreview}
    <tr style="border-top:2px solid #4f46e5;"><td style="padding:8px;font-weight:800;font-size:14px;">Grand Total</td><td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;font-size:15px;color:#4f46e5;">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
  </tbody></table>
</div>
${tcHtml}
${remarksEsc ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${remarksEsc}</div></div>` : ""}
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
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  // ── Auto-fetch details for preview pop-out ────────────────────────────────
  useEffect(() => {
    if (!viewingPO) {
      setViewingPOSupplier(null);
      setViewingPOCompany(null);
      setViewingPOProject(null);
      return;
    }
    const suppId = viewingPO.SupplierID ?? viewingPO.supplierId;
    const compId = viewingPO.CompanyID ?? viewingPO.companyId;
    const projId = viewingPO.ProjectID ?? viewingPO.projectId;
    if (suppId)
      getSupplierDetails(suppId)
        .then(setViewingPOSupplier)
        .catch(() => {});
    if (compId)
      getCompanyDetails(compId)
        .then(setViewingPOCompany)
        .catch(() => {});
    if (projId)
      getCompanyDetails(projId)
        .then(setViewingPOProject)
        .catch(() => {});
  }, [viewingPO]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
    setSourceMR(null);
    setSourceWD(null);
    setSourceWO(null);
    setSourceSaleInvoice(null);
    setSaleInvoiceInput("");
    setSupplierDetails(null);
    setCompanyDetails(null);
    setProjectDetails(null);
    setMrDropdownValue("");
    setMrDropdownError(null);
  };

  const goToCreate = () => {
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
    setSourceMR(null);
    setSourceWD(null);
    setSourceWO(null);
    setSourceSaleInvoice(null);
    setSaleInvoiceInput("");
    setSupplierDetails(null);
    setCompanyDetails(null);
    setMrDropdownValue("");
    setMrDropdownError(null);
    setViewMode("create");
  };

  const goToEdit = async (item: POListItem) => {
    // Always fetch the full PO — list rows don't include POItems or DocTypeId
    let raw: any =
      dbItems.find((d) => String(d.PurchaseOrderID) === item._id) ?? {};
    try {
      const full = await getPurchaseOrderById(item._id);
      if (full) raw = full;
    } catch {
      // fall back to list-row data
    }

    const supplier = suppliers.find(
      (s) =>
        s.id === String(raw.SupplierID ?? "") || s.name === item.supplierName,
    );
    const company = companies.find(
      (c) =>
        c.id === String(raw.CompanyId ?? "") || c.name === item.companyName,
    );
    const project = allProjects.find(
      (p) =>
        p.id === String(raw.ProjectId ?? "") || p.name === item.projectName,
    );

    const docTypeId: number | null = raw.DocTypeId ?? null;
    const docNo: string = raw.DocNo ?? raw.PurchaseOrderNo ?? "";

    // Restore doc type + doc number state so DocNumberPreview renders correctly
    setPoDocTypeId(docTypeId);
    setPoDocNo(docNo);

    setForm({
      poNumber: raw.PurchaseOrderNo ?? "",
      poDate: raw.PODate ? raw.PODate.slice(0, 10) : "",
      expectedDate: raw.ExpectedDeliveryDate
        ? raw.ExpectedDeliveryDate.slice(0, 10)
        : "",
      supplierId: supplier?.id ?? String(raw.SupplierID ?? ""),
      companyId: company?.id ?? String(raw.CompanyId ?? ""),
      projectId: project?.id ?? String(raw.ProjectId ?? ""),
      paymentTerms: raw.PaymentTerms ?? "",
      remarks: raw.Remarks ?? "",
      docTypeId,
      docNo,
      status: raw.Status ?? "Draft",
      costCenterId: String(raw.CostCenterId ?? ""),
    });

    // Restore line items from POItems (full record) or legacy fields
    const poItems: any[] = Array.isArray(raw.POItems)
      ? raw.POItems
      : Array.isArray(raw.LineItems)
        ? raw.LineItems
        : [];

    // Snapshot items at call time — avoids stale closure issues
    const itemsSnapshot = items;

    if (poItems.length > 0) {
      setLineItems(
        poItems.map((pi: any) => {
          const qty = Number(pi.quantity ?? pi.Quantity ?? 0);
          const rate = Number(pi.rate ?? pi.Rate ?? 0);
          const totalTaxRate = Number(pi.tax ?? pi.Tax ?? 0);

          // Priority 1: use stored split fields (saved by toPayload)
          const storedCgst = Number(pi.cgstRate ?? 0);
          const storedSgst = Number(pi.sgstRate ?? 0);
          const storedIgst = Number(pi.igstRate ?? 0);

          let resolvedCgst = 0,
            resolvedSgst = 0,
            resolvedIgst = 0;

          if (storedCgst > 0 || storedSgst > 0) {
            resolvedCgst = storedCgst;
            resolvedSgst = storedSgst;
          } else if (storedIgst > 0) {
            resolvedIgst = storedIgst;
          } else {
            // Priority 2: legacy record — derive from item master
            const itemId = String(pi.itemId ?? pi.ItemId ?? "");
            const masterItem = itemId
              ? itemsSnapshot.find((it) => String(it.id) === itemId)
              : null;
            if (masterItem) {
              const mc = Number(masterItem.cgst ?? 0);
              const ms = Number(masterItem.sgst ?? 0);
              const mi = Number(masterItem.igst ?? 0);
              if (mc > 0 || ms > 0) {
                resolvedCgst = mc;
                resolvedSgst = ms;
              } else {
                resolvedIgst = mi;
              }
            } else {
              resolvedIgst = totalTaxRate;
            }
          }

          const gstRate =
            resolvedCgst > 0 || resolvedSgst > 0
              ? resolvedCgst + resolvedSgst
              : resolvedIgst;
          const taxAmount = (qty * rate * gstRate) / 100;
          const unitStr = (pi.unit ?? pi.UomName ?? "").trim().toLowerCase();
          const uomMatch = uoms.find(
            (u) =>
              u.code.toLowerCase() === unitStr ||
              u.name.toLowerCase() === unitStr,
          );
          return {
            id: uid(),
            itemId: pi.itemId ?? pi.ItemId ?? "",
            itemName: pi.itemDescription ?? pi.ItemName ?? pi.Description ?? "",
            itemDescription: pi.description ?? pi.ItemDescription ?? "",
            quantity: qty,
            uomId: uomMatch?.id ?? null,
            unit: uomMatch?.name ?? pi.unit ?? pi.UomName ?? "",
            rate,
            cgstRate: resolvedCgst,
            sgstRate: resolvedSgst,
            igstRate: resolvedIgst,
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
    setSelectedTCs([]);
    setViewMode("edit");
    // Explicitly fetch details here too, so view mode always has fresh data
    // regardless of whether supplierId/companyId changed from prior state.
    const resolvedSupplierId = supplier?.id ?? String(raw.SupplierID ?? "");
    const resolvedCompanyId = company?.id ?? String(raw.CompanyId ?? "");
    const resolvedProjectId = project?.id ?? String(raw.ProjectId ?? "");
    if (resolvedSupplierId)
      getSupplierDetails(resolvedSupplierId).then(setSupplierDetails);
    else setSupplierDetails(null);
    if (resolvedCompanyId)
      getCompanyDetails(resolvedCompanyId).then(setCompanyDetails);
    else setCompanyDetails(null);
    if (resolvedProjectId)
      getCompanyDetails(resolvedProjectId).then(setProjectDetails);
    else setProjectDetails(null);
  };

  const goToView = async (item: POListItem) => {
    await goToEdit(item);
    setViewMode("view");
  };

  // Deep-link support — Linked Documents panels navigate here as
  // /material/purchase-order?view=<PurchaseOrderID> to open this exact PO.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    goToView({ _id: viewId } as POListItem);
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToAmend = (item: POListItem) => {
    navigate("/material/amendment-menu", {
      state: {
        prefill: {
          tab: "PO",
          docId: item._id,
          docNo: item.poNumber || item.docNo,
          supplierName: item.supplierName,
          projectName: item.projectName,
          companyName: item.companyName,
          totalAmount: item.totalAmount,
        },
      },
    });
  };

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], PO_TEMPLATE_COLUMNS, "purchase-order-template");
  };
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };
  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast.error("CSV is empty");
        return;
      }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: LIST VIEW
  // ─────────────────────────────────────────────────────────────────────────

  if (viewMode === "list") {
    return (
      <>
        <Breadcrumbs
          items={["Dashboard", "Material", "Purchase Order Master"]}
        />
        <MaterialShell
          title="Purchase Orders"
          subtitle="Create and manage purchase orders"
          icon={ShoppingCart}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportFileChange}
                className="hidden"
              />
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV template"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2Icon size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing..." : "Import CSV"}
                </span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={goToCreate}
                  className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all"
                >
                  <Plus size={13} />
                  New Purchase Order
                </button>
              )}
            </div>
          }
        >
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Purchase Order Register
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {totalRecords} record{totalRecords !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search PO number, supplier…"
                      className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { value: "", label: "All POs" },
                    { value: "WO_PO", label: "WO-POs" },
                    { value: "Direct", label: "Direct" },
                    { value: "Normal", label: "From MR" },
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => {
                        setPoTypeFilter(tab.value);
                        setPage(1);
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        poTypeFilter === tab.value
                          ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm"
                          : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                data={filteredList}
                loading={isLoading}
                searchable={false}
                paginated={false}
                emptyMessage="No purchase orders found. Click 'New PO' to create one."
                columns={[
                  {
                    id: "poNumber",
                    accessorFn: (row: any) => row.poNumber || row.docNo,
                    header: "PO No",
                    size: 150,
                    cell: ({ row }: any) => {
                      const item = row.original;
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            {item.poNumber || item.docNo || "—"}
                          </span>
                          {item.poType === "WO_PO" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              WO-PO
                            </span>
                          )}
                          {item.poType === "Direct" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                              Direct
                            </span>
                          )}
                        </div>
                      );
                    },
                  },
                  {
                    id: "poDate",
                    accessorKey: "poDate",
                    header: "Date",
                    size: 110,
                    meta: { className: "hidden sm:table-cell" },
                    cell: ({ getValue }: any) => (
                      <span className="text-sm text-muted-foreground">{fmtDate(getValue() as string)}</span>
                    ),
                  },
                  {
                    id: "supplierName",
                    accessorKey: "supplierName",
                    header: "Supplier",
                    size: 160,
                    meta: { className: "hidden sm:table-cell" },
                    cell: ({ getValue }: any) => (
                      <span className="text-sm font-medium">{String(getValue() || "—")}</span>
                    ),
                  },
                  {
                    id: "companyName",
                    accessorKey: "companyName",
                    header: "Company",
                    size: 150,
                    meta: { className: "hidden md:table-cell" },
                    cell: ({ getValue }: any) => (
                      <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
                    ),
                  },
                  {
                    id: "projectName",
                    accessorKey: "projectName",
                    header: "Project / Site",
                    size: 150,
                    meta: { className: "hidden lg:table-cell" },
                    cell: ({ getValue }: any) => (
                      <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
                    ),
                  },
                  {
                    id: "totalAmount",
                    accessorKey: "totalAmount",
                    header: "Amount",
                    size: 110,
                    meta: { className: "hidden sm:table-cell" },
                    cell: ({ getValue }: any) => (
                      <span className="text-sm font-semibold">{fmt(getValue() as number)}</span>
                    ),
                  },
                  {
                    id: "status",
                    accessorKey: "status",
                    header: "Status",
                    size: 180,
                    meta: { className: "hidden sm:table-cell" },
                    cell: ({ row }: any) => (
                      <div className="flex flex-col items-start gap-1">
                        <ApprovalStatusChain table="PurchaseOrders" recordId={row.original._id} />
                      </div>
                    ),
                  },
                  {
                    id: "actions",
                    header: "Actions",
                    size: 120,
                    cell: ({ row }: any) => {
                      const item = row.original;
                      return (
                        <div className="flex items-center justify-end gap-1">
                          <ApprovalActions
                            status={item.status}
                            recordId={item._id}
                            endpoint="/api/purchase-orders"
                            submitOnly
                            onSuccess={(action) => handleApprovalSuccess(item._id, action)}
                          />
                          <button
                            onClick={async () => {
                              setViewingTab("details");
                              try {
                                const full = await getPurchaseOrderById(item._id);
                                setViewingPO(full);
                              } catch {
                                setViewingPO(item);
                              }
                            }}
                            className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
                            title="View details"
                          >
                            <Eye size={15} />
                          </button>
                          {rights.canDelete && (
                            <button
                              onClick={() => handleDelete(item._id)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete this order"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      );
                    },
                  },
                ] as ColumnDef<any, unknown>[]}
              />
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages} ({totalRecords} records)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 transition text-xs"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 transition text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── PO Delete Block Dialog ─────────────────────────────────────────── */}
          <Dialog
            open={!!deleteBlockInfo}
            onOpenChange={() => setDeleteBlockInfo(null)}
          >
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle size={18} className="shrink-0" />
                  Cannot Delete Purchase Order
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {deleteBlockInfo?.reason === "grn_expense_brs_cleared" && (
                  <div className="space-y-2">
                    <p className="font-medium text-destructive">
                      This PO has GRNs with expense bookings cleared in BRS.
                      Follow these steps to delete:
                    </p>
                    <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                      <li>
                        Go to <strong>BRS</strong> and <strong>unclear</strong>{" "}
                        the matched payment entries.
                      </li>
                      <li>
                        Go to <strong>Payment Management</strong> and{" "}
                        <strong>delete</strong> the payment records.
                      </li>
                      <li>
                        Go to <strong>Expense Booking</strong> and{" "}
                        <strong>delete</strong> the expense booking(s).
                      </li>
                      <li>
                        Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                        the GRN(s).
                      </li>
                      <li>Return here and delete this Purchase Order.</li>
                    </ol>
                    {deleteBlockInfo.clearedPayments &&
                      deleteBlockInfo.clearedPayments.length > 0 && (
                        <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                          <p className="font-semibold">
                            Cleared payments blocking deletion:
                          </p>
                          {deleteBlockInfo.clearedPayments.map((p) => (
                            <div
                              key={p.paymentId}
                              className="flex justify-between"
                            >
                              <span>
                                {p.paymentName || "Payment #" + p.paymentId}{" "}
                                (Exp: {p.expenseDocNo})
                              </span>
                              <span className="font-medium">
                                {Number(p.amount).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
                {deleteBlockInfo?.reason === "grn_expense_has_payments" && (
                  <div className="space-y-2">
                    <p className="font-medium text-amber-700">
                      This PO has GRNs with expense bookings that have linked
                      payment records.
                    </p>
                    <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                      <li>
                        Go to <strong>Payment Management</strong> and{" "}
                        <strong>delete</strong> the payment records.
                      </li>
                      <li>
                        Go to <strong>Expense Booking</strong> and{" "}
                        <strong>delete</strong> the expense booking(s).
                      </li>
                      <li>
                        Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                        the GRN(s).
                      </li>
                      <li>Return here and delete this Purchase Order.</li>
                    </ol>
                    {deleteBlockInfo.linkedPayments &&
                      deleteBlockInfo.linkedPayments.length > 0 && (
                        <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                          <p className="font-semibold">Linked payments:</p>
                          {deleteBlockInfo.linkedPayments.map((p) => (
                            <div
                              key={p.paymentId}
                              className="flex justify-between"
                            >
                              <span>
                                {p.paymentName || "Payment #" + p.paymentId}{" "}
                                (Exp: {p.expenseDocNo})
                              </span>
                              <span className="font-medium">
                                {Number(p.amount).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
                {deleteBlockInfo?.reason === "grn_has_expense" && (
                  <div className="space-y-2">
                    <p className="font-medium text-amber-700">
                      This PO has GRNs with linked expense bookings.
                    </p>
                    <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                      <li>
                        Go to <strong>Expense Booking</strong> and{" "}
                        <strong>delete</strong> the expense booking(s).
                      </li>
                      <li>
                        Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                        the GRN(s).
                      </li>
                      <li>Return here and delete this Purchase Order.</li>
                    </ol>
                    {deleteBlockInfo.expenseBookings &&
                      deleteBlockInfo.expenseBookings.length > 0 && (
                        <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                          {deleteBlockInfo.expenseBookings.map((e) => (
                            <div key={e.id} className="flex justify-between">
                              <span>{e.docNo || "Expense #" + e.id}</span>
                              <span className="text-muted-foreground">
                                {e.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
                {deleteBlockInfo?.reason === "has_grns" && (
                  <div className="space-y-2">
                    <p className="font-medium text-amber-700">
                      This PO has linked GRN(s). Delete the GRN(s) first, then
                      delete the PO.
                    </p>
                    <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                      <li>
                        Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                        each linked GRN.
                      </li>
                      <li>Return here and delete this Purchase Order.</li>
                    </ol>
                    {deleteBlockInfo.grns &&
                      deleteBlockInfo.grns.length > 0 && (
                        <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                          {deleteBlockInfo.grns.map((g) => (
                            <div key={g.grnId} className="flex justify-between">
                              <span>{g.grnNo || "GRN #" + g.grnId}</span>
                              <span className="text-muted-foreground">
                                {g.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
                {deleteBlockInfo?.reason === "has_expense" && (
                  <div className="space-y-2">
                    <p className="font-medium text-amber-700">
                      This PO has linked expense bookings. Delete them first.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteBlockInfo(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ── PO Delete Confirm Dialog ───────────────────────────────────────── */}
          <Dialog
            open={!!deleteConfirmId}
            onOpenChange={() => setDeleteConfirmId(null)}
          >
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Purchase Order?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This action cannot be undone.
              </p>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirmId(null)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={confirmDelete}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </MaterialShell>

        {/* ── PO Preview Modal ─────────────────────────────────────────────── */}
        {viewingPO && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">
              {/* Modal header */}
              <div className="sticky top-0 bg-card z-10 border-b border-border">
                <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                      <ShoppingCart size={13} className="text-emerald-500" />
                    </div>
                    <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[150px] sm:max-w-none">
                      {viewingPO.PurchaseOrderNo ?? viewingPO.poNumber ?? "—"}
                    </h2>
                    {viewingPO.Status && (
                      <StatusChip status={viewingPO.Status} />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">
                    Purchase Order
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handlePrintFromPreview}
                    className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                  >
                    <Printer size={13} /><span className="hidden sm:inline">Print</span>
                  </button>
                  {rights.canEdit && viewingPO.Status !== "Short Closed" && (
                    <button
                      onClick={() => {
                        const item = listData.find(
                          (r) =>
                            r._id ===
                            String(viewingPO.PurchaseOrderID ?? viewingPO._id),
                        );
                        setViewingPO(null);
                        if (item) goToAmend(item);
                      }}
                      className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-sm transition"
                    >
                      <FilePenLine size={13} /><span className="hidden sm:inline">Amend</span>
                    </button>
                  )}
                  <button
                    onClick={() => setViewingPO(null)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>
                </div>
              </div>

              {/* Tab strip */}
              <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-card">
                {(["details", "supplier"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setViewingTab(tab)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors
                        ${
                          viewingTab === tab
                            ? "border-primary text-primary bg-primary/5"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                  >
                    {tab === "details" ? <FileText size={12} /> : <MessageCircle size={12} />}
                    {tab === "details" ? "Details" : "Supplier"}
                  </button>
                ))}
              </div>

              {viewingTab === "details" && (
              <div className="p-5 space-y-5">
                {/* Order details grid */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <FileText size={10} className="text-emerald-500" /> Order
                    Details
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {(
                      [
                        {
                          label: "PO Number",
                          value:
                            viewingPO.PurchaseOrderNo ?? viewingPO.poNumber,
                          mono: true,
                        },
                        {
                          label: "PO Type",
                          value: viewingPO.POType ?? viewingPO.poType ?? "—",
                        },
                        {
                          label: "PO Date",
                          value: viewingPO.PODate
                            ? new Date(viewingPO.PODate).toLocaleDateString(
                                "en-IN",
                              )
                            : (viewingPO.poDate ?? "—"),
                        },
                        {
                          label: "Expected Delivery",
                          value: viewingPO.ExpectedDeliveryDate
                            ? new Date(
                                viewingPO.ExpectedDeliveryDate,
                              ).toLocaleDateString("en-IN")
                            : "—",
                        },
                        {
                          label: "Supplier",
                          value:
                            viewingPO.SupplierName ?? viewingPO.supplierName,
                        },
                        {
                          label: "Company",
                          value: viewingPO.CompanyName ?? viewingPO.companyName,
                        },
                        {
                          label: "Project / Site",
                          value: viewingPO.ProjectName ?? viewingPO.projectName,
                        },
                        {
                          label: "Cost Center",
                          value:
                            viewingPO.CostCenterName ??
                            viewingPO.costCenterName ??
                            "—",
                        },
                        {
                          label: "Total Amount",
                          value:
                            (viewingPO.TotalAmount ?? viewingPO.totalAmount) !=
                            null
                              ? `₹${Number(viewingPO.TotalAmount ?? viewingPO.totalAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                              : "—",
                        },
                        {
                          label: "Status",
                          value: viewingPO.Status ?? viewingPO.status ?? "—",
                        },
                      ] as { label: string; value: any; mono?: boolean }[]
                    ).map(({ label, value, mono }) => (
                      <div
                        key={label}
                        className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                      >
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                          {label}
                        </p>
                        <p
                          className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}
                        >
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Source document references */}
                  {(viewingPO.SourceMRDocNo ||
                    viewingPO.SourceWODocNo ||
                    viewingPO.SourceWDDocNo) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {viewingPO.SourceMRDocNo && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                          <Link2 size={9} /> MR: {viewingPO.SourceMRDocNo}
                        </span>
                      )}
                      {viewingPO.SourceWODocNo && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                          <Link2 size={9} /> WO: {viewingPO.SourceWODocNo}
                        </span>
                      )}
                      {viewingPO.SourceWDDocNo && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          <Link2 size={9} /> WD: {viewingPO.SourceWDDocNo}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Payment Terms */}
                  {(viewingPO.PaymentTerms ?? viewingPO.paymentTerms) && (
                    <div className="mt-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                        Payment Terms / T&C
                      </p>
                      <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                        {viewingPO.PaymentTerms ?? viewingPO.paymentTerms}
                      </p>
                    </div>
                  )}
                </div>

                {/* Supplier / Billing / Project panels */}
                {(viewingPOSupplier ||
                  viewingPOCompany ||
                  viewingPOProject) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Supplier Details */}
                    {viewingPOSupplier && (
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                          <Building2 size={11} className="text-emerald-500" />{" "}
                          Supplier Details
                        </p>
                        <dl className="space-y-1.5 text-xs">
                          {viewingPOSupplier.LHeadAddress && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Address
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5">
                                {viewingPOSupplier.LHeadAddress}
                              </dd>
                            </div>
                          )}
                          {viewingPOSupplier.LHeadContactPerson && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Contact
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5">
                                {viewingPOSupplier.LHeadContactPerson}
                              </dd>
                            </div>
                          )}
                          {viewingPOSupplier.LHeadPhone && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Phone
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                                <Phone
                                  size={10}
                                  className="text-muted-foreground"
                                />
                                {viewingPOSupplier.LHeadPhone}
                              </dd>
                            </div>
                          )}
                          {viewingPOSupplier.LHeadEmail && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Email
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                                <Mail
                                  size={10}
                                  className="text-muted-foreground"
                                />
                                {viewingPOSupplier.LHeadEmail}
                              </dd>
                            </div>
                          )}
                          {viewingPOSupplier.LGST && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                GSTIN
                              </dt>
                              <dd className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                {viewingPOSupplier.LGST}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}
                    {/* Billing Details */}
                    {viewingPOCompany && (
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                          <Building2 size={11} className="text-emerald-500" />{" "}
                          Billing Details
                        </p>
                        <dl className="space-y-1.5 text-xs">
                          {(viewingPOCompany.address ||
                            viewingPOCompany.city) && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Address
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5">
                                {[
                                  viewingPOCompany.address,
                                  viewingPOCompany.city,
                                  viewingPOCompany.state,
                                  viewingPOCompany.pincode,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </dd>
                            </div>
                          )}
                          {viewingPOCompany.phone_number && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Phone
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                                <Phone
                                  size={10}
                                  className="text-muted-foreground"
                                />
                                {viewingPOCompany.phone_number}
                              </dd>
                            </div>
                          )}
                          {viewingPOCompany.email && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Email
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                                <Mail
                                  size={10}
                                  className="text-muted-foreground"
                                />
                                {viewingPOCompany.email}
                              </dd>
                            </div>
                          )}
                          {viewingPOCompany.gst_no && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                GSTIN
                              </dt>
                              <dd className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                {viewingPOCompany.gst_no}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}
                    {/* Project / Delivery Address */}
                    {viewingPOProject && (
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                          <MapPin size={11} className="text-emerald-500" />{" "}
                          Project Details
                        </p>
                        <dl className="space-y-1.5 text-xs">
                          {(viewingPOProject.address ||
                            viewingPOProject.city) && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Delivery Address
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5">
                                {[
                                  viewingPOProject.address,
                                  viewingPOProject.address_line2,
                                  viewingPOProject.city,
                                  viewingPOProject.state,
                                  viewingPOProject.pincode,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </dd>
                            </div>
                          )}
                          {viewingPOProject.phone_number && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Phone
                              </dt>
                              <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1">
                                <Phone
                                  size={10}
                                  className="text-muted-foreground"
                                />
                                {viewingPOProject.phone_number}
                              </dd>
                            </div>
                          )}
                          {viewingPOProject.gst_no && (
                            <div>
                              <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                GSTIN
                              </dt>
                              <dd className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                {viewingPOProject.gst_no}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}
                  </div>
                )}

                {/* Line items */}
                {(() => {
                  const lineItems: any[] = Array.isArray(viewingPO.LineItems)
                    ? viewingPO.LineItems
                    : Array.isArray(viewingPO.POItems)
                      ? viewingPO.POItems
                      : [];
                  if (!lineItems.length) return null;
                  return (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Package size={10} className="text-emerald-500" /> Order
                        Items ({lineItems.length})
                      </p>
                      <div className="rounded-xl border border-border overflow-x-auto">
                        <table
                          className="w-full text-xs"
                          style={{ tableLayout: "auto" }}
                        >
                          <thead className="bg-muted/40 border-b border-border">
                            <tr>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-left">Item / Description</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Qty</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-left hidden sm:table-cell">Unit</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right hidden sm:table-cell">Rate</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right hidden sm:table-cell">GST%</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right">Amount</th>
                              <th className="px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground text-right hidden sm:table-cell">Received</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {lineItems.map((li: any, i: number) => {
                              const name =
                                li.ItemName ??
                                li.itemName ??
                                li.Description ??
                                li.itemDescription ??
                                "—";
                              const qty = Number(
                                li.Quantity ?? li.quantity ?? 0,
                              );
                              const unit =
                                li.UomName ?? li.UOMSymbol ?? li.unit ?? "—";
                              const rate = Number(li.Rate ?? li.rate ?? 0);
                              const tax = Number(li.TaxPct ?? li.tax ?? 0);
                              const amount = Number(
                                li.LineAmount ?? li.amount ?? qty * rate,
                              );
                              const received =
                                li.ReceivedQty != null
                                  ? Number(li.ReceivedQty)
                                  : null;
                              return (
                                <tr
                                  key={i}
                                  className="hover:bg-muted/20 transition-colors"
                                >
                                  <td className="px-3 py-2 font-medium">{name}</td>
                                  <td className="px-3 py-2 text-right">{qty}</td>
                                  <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{unit}</td>
                                  <td className="px-3 py-2 text-right hidden sm:table-cell">₹{rate.toLocaleString("en-IN")}</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">{tax ? `${tax}%` : "—"}</td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    ₹{amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className={`px-3 py-2 text-right hidden sm:table-cell ${received != null && received >= qty ? "text-emerald-500" : "text-muted-foreground"}`}>
                                    {received != null ? received : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Remarks */}
                {(viewingPO.Remarks ?? viewingPO.remarks) && (
                  <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      Remarks
                    </p>
                    <p className="text-xs text-foreground">
                      {viewingPO.Remarks ?? viewingPO.remarks}
                    </p>
                  </div>
                )}
              </div>
              )}

              {viewingTab === "supplier" && (
                <div className="p-5 space-y-5">
                  {/* Dispatch status */}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Truck size={10} className="text-emerald-500" /> Dispatch Status
                    </p>
                    {viewingPO.SupplierAcknowledged ? (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={15} className="text-emerald-500" />
                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Supplier marked this as supplied</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Supplied Date</p>
                            <p className="text-sm font-medium text-foreground mt-0.5">
                              {viewingPO.SuppliedDate ? new Date(viewingPO.SuppliedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Challan Number</p>
                            <p className="text-sm font-medium text-foreground mt-0.5 font-mono">
                              {viewingPO.ChallanNumber || <span className="text-muted-foreground/60 font-sans italic">Not provided</span>}
                            </p>
                          </div>
                          {viewingPO.ExpectedDeliveryDate && viewingPO.SuppliedDate && (() => {
                            const e = new Date(viewingPO.ExpectedDeliveryDate); e.setHours(0, 0, 0, 0);
                            const s = new Date(viewingPO.SuppliedDate); s.setHours(0, 0, 0, 0);
                            const delta = Math.round((e.getTime() - s.getTime()) / 86_400_000);
                            return (
                              <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Vs. Expected</p>
                                <p className={`text-sm font-medium mt-0.5 ${delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  {delta === 0 ? "On time" : delta > 0 ? `${delta}d early` : `${Math.abs(delta)}d late`}
                                </p>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center">
                        <p className="text-xs text-muted-foreground">Not yet marked as supplied by the supplier.</p>
                      </div>
                    )}
                  </div>

                  {/* Chat log */}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <MessageCircle size={10} className="text-emerald-500" /> Conversation
                    </p>
                    <div className="rounded-xl border border-border overflow-hidden h-[420px] flex flex-col">
                      {currentUser && (
                        <OrderChat
                          poId={viewingPO.PurchaseOrderID ?? Number(viewingPO._id)}
                          apiBase="/api/purchase-orders"
                          currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
                          className="flex-1 rounded-none border-0"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: CREATE / EDIT / VIEW FORM
  // ─────────────────────────────────────────────────────────────────────────

  const isReadOnly = viewMode === "view";

  return (
    <>
      <Breadcrumbs
        items={[
          "Dashboard",
          "Material",
          "Purchase Order Master",
          viewMode === "create" ? "New" : viewMode === "edit" ? "Edit" : "View",
        ]}
      />
      <MaterialShell
        title="Purchase Orders"
        subtitle="Create and manage purchase orders"
        icon={ShoppingCart}
      >
        {/* Form Header — Card matching Material Request style */}
        <Card className="border-border shadow-sm">
          <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={goToList}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
                <span className="hidden sm:inline">Back</span>
              </button>
              <span className="text-emerald-500/40">|</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                  <ShoppingCart size={12} className="text-emerald-400" />
                </div>
                <h2 className="text-sm font-heading font-bold text-foreground truncate flex items-center gap-2">
                  {viewMode === "create"
                    ? "New Purchase Order"
                    : viewMode === "edit"
                      ? "Edit Purchase Order"
                      : `Purchase Order — ${escapeHtml(form.poNumber || "—")}`}
                  {viewMode === "view" && form.status && (
                    <StatusChip status={form.status} />
                  )}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isReadOnly && (
                <>
                  <StatusChip
                    status={
                      listData.find((r) => r._id === editingId)?.status ??
                      "Draft"
                    }
                  />
                  {rights.canPrint && (
                    <button
                      onClick={handlePrint}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted transition"
                    >
                      <Printer size={14} /> Print
                    </button>
                  )}
                  {rights.canEdit && form.status !== "Short Closed" && (
                    <button
                      onClick={() => {
                        const item = listData.find((r) => r._id === editingId);
                        if (item) goToAmend(item);
                      }}
                      className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-semibold transition shadow-sm"
                    >
                      <FilePenLine size={14} /> Amend
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          {/* ── Document Type & Fin Year Card ─────────────────────────────────── */}
          {/* ── MR Doc Number Lookup (only shown in create mode, before any source is set) ── */}
          {viewMode === "create" &&
            !sourceMR &&
            !sourceWD &&
            !sourceWO &&
            !isReadOnly && (
              <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                <h3
                  className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2"
                  title="Filter by company and project, then select an approved Material Request to auto-fill items and details."
                >
                  <ClipboardList
                    size={11}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                  Load from Material Request
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="relative">
                    <select
                      value={mrFilterCompanyId}
                      onChange={(e) => {
                        setMrFilterCompanyId(e.target.value);
                        setMrFilterProjectId("");
                        setMrDropdownValue("");
                      }}
                      className={`${inputCls} pr-8 appearance-none`}
                    >
                      <option value="">Company —</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={mrFilterProjectId}
                      onChange={(e) => {
                        setMrFilterProjectId(e.target.value);
                        setMrDropdownValue("");
                      }}
                      disabled={filteredMRProjects.length === 0}
                      className={`${inputCls} pr-8 appearance-none`}
                    >
                      <option value="">Project —</option>
                      {filteredMRProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={mrDropdownValue}
                      onChange={(e) =>
                        void handleMRDropdownSelect(e.target.value)
                      }
                      disabled={approvedMRsLoading || mrDropdownLoading}
                      className={`${inputCls} pr-8 appearance-none ${mrDropdownError ? "border-red-400" : ""}`}
                    >
                      <option value="">
                        {approvedMRsLoading
                          ? "Loading MRs…"
                          : approvedMRs.length === 0
                            ? "No approved MRs"
                            : "Material Request —"}
                      </option>
                      {approvedMRs.map((mr) => (
                        <option key={mr.MRId} value={String(mr.MRId)}>
                          {mr.DocNo}
                          {mr.ProjectName ? ` · ${mr.ProjectName}` : ""}
                          {mr.FinYearName ? ` (${mr.FinYearName})` : ""}
                        </option>
                      ))}
                    </select>
                    {mrDropdownLoading ? (
                      <RefreshCw
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
                      />
                    ) : (
                      <ChevronDown
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    )}
                  </div>
                </div>
                {mrDropdownError && (
                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={11} />
                    {mrDropdownError}
                  </p>
                )}
              </div>
            )}

          {viewMode === "create" &&
            !sourceMR &&
            !sourceWD &&
            !sourceWO &&
            !isReadOnly && (
              <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-sm flex flex-wrap items-center gap-2">
                <span
                  className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 shrink-0"
                  title="Enter a paid Sale Invoice doc number to link this PO to a Sale Invoice. The backend will validate that the invoice is fully paid before saving."
                >
                  <Receipt size={11} className="text-blue-500" />
                  Link Sale Invoice
                </span>
                <input
                  type="number"
                  value={saleInvoiceInput}
                  onChange={(e) => setSaleInvoiceInput(e.target.value)}
                  placeholder="Sale Invoice ID (optional)"
                  className={`${inputCls} flex-1 min-w-[140px] !py-1.5`}
                  disabled={!!sourceSaleInvoice}
                  min={1}
                />
                {!sourceSaleInvoice ? (
                  <button
                    type="button"
                    onClick={() => {
                      const id = parseInt(saleInvoiceInput.trim(), 10);
                      if (!id || id <= 0) return;
                      setSourceSaleInvoice({ id, docNo: `SI-${id}` });
                    }}
                    disabled={!saleInvoiceInput.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
                  >
                    Link
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSourceSaleInvoice(null);
                      setSaleInvoiceInput("");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

          {sourceSaleInvoice && !isReadOnly && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 flex items-center gap-3 text-sm">
              <Receipt
                size={15}
                className="text-blue-600 dark:text-blue-400 shrink-0"
              />
              <span className="text-blue-700 dark:text-blue-300 flex-1">
                Linked to Sale Invoice{" "}
                <span className="font-mono font-bold">
                  {sourceSaleInvoice.docNo}
                </span>
                . The backend will validate that this invoice is fully paid
                before saving.
              </span>
              <button
                type="button"
                onClick={() => {
                  setSourceSaleInvoice(null);
                  setSaleInvoiceInput("");
                }}
                className="text-blue-400 hover:text-blue-600 transition-colors"
                title="Remove link"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {sourceMR && !isReadOnly && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3 text-sm">
              <ClipboardList
                size={15}
                className="text-emerald-600 dark:text-emerald-400 shrink-0"
              />
              <span className="text-emerald-700 dark:text-emerald-300">
                Creating <span className="font-semibold">Normal PO</span> from
                Material Request{" "}
                <span className="font-mono font-bold">{sourceMR.docNo}</span>.
                Items, company and project have been pre-filled.
              </span>
            </div>
          )}

          {sourceWD && !isReadOnly && (
            <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 flex items-center gap-3 text-sm">
              <ClipboardList
                size={15}
                className="text-orange-600 dark:text-orange-400 shrink-0"
              />
              <span className="text-orange-700 dark:text-orange-300">
                Creating <span className="font-semibold">Material PO</span> from
                Work Done{" "}
                <span className="font-mono font-bold">{sourceWD.docNo}</span>.
                Company, project and line items have been pre-filled.
              </span>
            </div>
          )}

          {sourceWO && !isReadOnly && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3 text-sm">
              <ClipboardList
                size={15}
                className="text-emerald-600 dark:text-emerald-400 shrink-0"
              />
              <span className="text-emerald-700 dark:text-emerald-300">
                Creating <span className="font-semibold">Material PO</span> from
                Work Order{" "}
                <span className="font-mono font-bold">{sourceWO.docNo}</span>.
                Company, project and material line items have been pre-filled.
              </span>
            </div>
          )}

          {!isReadOnly && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
                <Hash
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Document Configuration
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Financial Year</FieldLabel>
                  <div className="relative">
                    <select
                      value={selectedFinYear ?? ""}
                      onChange={(e) => {
                        const nextFinYear = e.target.value || undefined;
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
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>Document Type &amp; Number</FieldLabel>
                  {sourceWO ? (
                    // Locked to WO_PO type — no dropdown
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/30 text-foreground">
                        <Hash
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          WO_PO
                        </span>
                        <span className="text-xs opacity-40">·</span>
                        <span className="text-xs text-muted-foreground">
                          Work Order for Materials
                        </span>
                      </div>
                      {poDocNo && (
                        <div className="flex items-center gap-2 px-1">
                          <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
                            {poDocNo}
                          </span>
                          {selectedFinYear && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-heading">
                              FY {selectedFinYear}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <select
                          value={poDocTypeId ? String(poDocTypeId) : ""}
                          onChange={async (e) => {
                            const id = e.target.value
                              ? parseInt(e.target.value, 10)
                              : null;
                            if (!id) {
                              applyPoDocNumber(null, "");
                              return;
                            }
                            const docNo = await fetchNextDocNumber(
                              id,
                              selectedFinYear || undefined,
                            );
                            applyPoDocNumber(id, docNo);
                          }}
                          disabled={poDocTypesLoading || viewMode === "edit"}
                          className={selectCls}
                        >
                          {poDocTypesLoading ? (
                            <option value="">Loading…</option>
                          ) : poDocTypes.length === 0 ? (
                            <option value="">No document types found</option>
                          ) : (
                            poDocTypes.map((dt) => {
                              const label =
                                dt.ProjectCode && dt.ModuleCode
                                  ? `${dt.ProjectCode}-${dt.ModuleCode}`
                                  : (dt.DocNoPrefix ??
                                    dt.FullPrefix ??
                                    dt.Prefix);
                              return (
                                <option
                                  key={dt.TypeOfDocId}
                                  value={String(dt.TypeOfDocId)}
                                >
                                  {label} — {dt.Description}
                                </option>
                              );
                            })
                          )}
                        </select>
                        <ChevronDown
                          size={13}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                      {poDocNo && (
                        <div className="flex items-center gap-2 px-1">
                          <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
                            {poDocNo}
                          </span>
                          {selectedFinYear && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-heading">
                              FY {selectedFinYear}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Header Details Card ───────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
              <FileText
                size={11}
                className="text-emerald-600 dark:text-emerald-400"
              />
              Order Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Company */}
              <div>
                <FieldLabel>Company Name</FieldLabel>
                {isReadOnly ? (
                  <div className={`${inputCls} bg-muted/30`}>
                    {companies.find((c) => c.id === form.companyId)?.name ||
                      "—"}
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={form.companyId}
                      onChange={(e) => {
                        setField("companyId", e.target.value);
                        setField("projectId", "");
                      }}
                      className={`${selectCls} ${errors.companyId ? "border-red-400" : ""}`}
                    >
                      <option value="">— Select Company —</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                )}
                {errors.companyId && (
                  <p className="text-xs text-destructive mt-1">
                    Company is required
                  </p>
                )}
              </div>

              {/* Project */}
              <div>
                <FieldLabel required>Project / Site</FieldLabel>
                {isReadOnly ? (
                  <div className={`${inputCls} bg-muted/30`}>
                    {allProjects.find((p) => p.id === form.projectId)?.name ||
                      "—"}
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={form.projectId}
                      onChange={(e) => setField("projectId", e.target.value)}
                      className={`${selectCls} ${errors.projectId ? "border-red-400" : ""}`}
                    >
                      <option value="">— Select Project —</option>
                      {filteredFormProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                )}
                {errors.projectId && (
                  <p className="text-xs text-destructive mt-1">
                    Project is required
                  </p>
                )}
              </div>

              {/* Supplier */}
              <div>
                <FieldLabel required>Supplier</FieldLabel>
                {isReadOnly ? (
                  <div className={`${inputCls} bg-muted/30`}>
                    {suppliers.find((s) => s.id === form.supplierId)?.name ||
                      "—"}
                  </div>
                ) : (
                  <div className="relative">
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
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                )}
              </div>

              {/* PO Number */}
              <div>
                <FieldLabel required>PO Number</FieldLabel>
                <input
                  value={form.poNumber}
                  onChange={(e) =>
                    setField("poNumber", e.target.value.toUpperCase())
                  }
                  readOnly={
                    isReadOnly ||
                    (viewMode === "create" && !!(form.docTypeId ?? poDocTypeId))
                  }
                  className={`${inputCls} font-mono ${errors.poNumber ? "border-red-400" : ""} ${
                    isReadOnly ||
                    (viewMode === "create" && !!(form.docTypeId ?? poDocTypeId))
                      ? "bg-muted/30 cursor-not-allowed"
                      : ""
                  }`}
                  placeholder="Auto-generated"
                />
              </div>

              {/* PO Date */}
              <div>
                <FieldLabel required>PO Date</FieldLabel>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.poDate}
                    onChange={(e) => setField("poDate", e.target.value)}
                    readOnly={isReadOnly}
                    className={`${inputCls} pl-8 ${errors.poDate ? "border-red-400" : ""} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                  />
                </div>
              </div>

              {/* Expected Delivery */}
              <div>
                <FieldLabel>Expected Delivery</FieldLabel>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.expectedDate}
                    onChange={(e) => setField("expectedDate", e.target.value)}
                    readOnly={isReadOnly}
                    className={`${inputCls} pl-8 ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""} [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                  />
                </div>
              </div>

              {/* Cost Center */}
              <div>
                <FieldLabel required>Cost Center</FieldLabel>
                <select
                  value={form.costCenterId}
                  onChange={(e) => setField("costCenterId", e.target.value)}
                  disabled={isReadOnly}
                  className={`${inputCls} ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""} ${errors.costCenterId ? "border-red-400" : ""}`}
                >
                  <option value="">— Select Cost Center —</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.label}
                    </option>
                  ))}
                </select>
                {errors.costCenterId && (
                  <p className="text-xs text-destructive mt-1">
                    Cost Center is required
                  </p>
                )}
              </div>

            </div>
          </div>
          {/* ── Supplier, Company & Project Info Panels (auto-fetched on selection) ──── */}
          {(supplierDetails || companyDetails || projectDetails) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Supplier info */}
              {supplierDetails && (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                    <Truck
                      size={11}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                    Supplier Details
                  </h3>
                  <dl className="space-y-2 text-sm">
                    {supplierDetails.LHeadAddress && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Address
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5">
                          {supplierDetails.LHeadAddress}
                        </dd>
                      </div>
                    )}
                    {supplierDetails.LHeadContactPerson && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Contact Person
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <User size={12} className="text-muted-foreground" />
                          {supplierDetails.LHeadContactPerson}
                        </dd>
                      </div>
                    )}
                    {supplierDetails.LHeadPhone && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Phone
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Phone size={12} className="text-muted-foreground" />
                          {supplierDetails.LHeadPhone}
                        </dd>
                      </div>
                    )}
                    {supplierDetails.LHeadEmail && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Email
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Mail size={12} className="text-muted-foreground" />
                          {supplierDetails.LHeadEmail}
                        </dd>
                      </div>
                    )}
                    {supplierDetails.LGST && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          GSTIN
                        </dt>
                        <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                          {supplierDetails.LGST}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Billing details */}
              {companyDetails && (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                    <CircleDollarSign
                      size={11}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                    Billing Details
                  </h3>
                  <dl className="space-y-2 text-sm">
                    {(companyDetails.address || companyDetails.city) && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Billing Address
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5">
                          {[
                            companyDetails.address,
                            companyDetails.address_line2,
                            companyDetails.city,
                            companyDetails.state,
                            companyDetails.pincode,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </dd>
                      </div>
                    )}
                    {companyDetails.phone_number && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Phone
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Phone size={12} className="text-muted-foreground" />
                          {companyDetails.phone_number}
                        </dd>
                      </div>
                    )}
                    {companyDetails.email && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Email
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Mail size={12} className="text-muted-foreground" />
                          {companyDetails.email}
                        </dd>
                      </div>
                    )}
                    {companyDetails.gst_no && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          GSTIN
                        </dt>
                        <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                          {companyDetails.gst_no}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Project info — delivery address */}
              {projectDetails && (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                    <MapPin
                      size={11}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                    Project Details
                  </h3>
                  <dl className="space-y-2 text-sm">
                    {(projectDetails.address || projectDetails.city) && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Delivery Address
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5">
                          {[
                            projectDetails.address,
                            projectDetails.address_line2,
                            projectDetails.city,
                            projectDetails.state,
                            projectDetails.pincode,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </dd>
                      </div>
                    )}
                    {projectDetails.phone_number && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Phone
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Phone size={12} className="text-muted-foreground" />
                          {projectDetails.phone_number}
                        </dd>
                      </div>
                    )}
                    {projectDetails.email && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Email
                        </dt>
                        <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                          <Mail size={12} className="text-muted-foreground" />
                          {projectDetails.email}
                        </dd>
                      </div>
                    )}
                    {projectDetails.gst_no && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          GSTIN
                        </dt>
                        <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                          {projectDetails.gst_no}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          )}

          {/* ── Line Items Card ───────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Boxes
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Item Cart
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 min-w-[18px]">
                  {lineItems.length}
                </span>
              </h3>
              {!isReadOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Plus size={13} /> Add Item
                </Button>
              )}
            </div>

            {errors.lineItems && (
              <p className="px-5 pb-2 text-xs text-destructive">
                Add at least one line item
              </p>
            )}

            {/* Table header */}
            <div
              className={`overflow-x-auto ${errors.lineItems ? "border-t border-red-400" : ""}`}
            >
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
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-32">
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
                          <ItemPicker
                            items={items}
                            value={li.itemId}
                            onChange={(id) => handleItemSelect(idx, id)}
                          />
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
                              updateLine(idx, {
                                itemDescription: e.target.value,
                              })
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
                            {Number.isFinite(li.quantity)
                              ? li.quantity.toLocaleString("en-IN", {
                                  maximumFractionDigits: 4,
                                })
                              : "0"}
                          </span>
                        ) : (
                          <>
                            <input
                              type="number"
                              min={0}
                              max={li.mrPendingQty ?? undefined}
                              step="any"
                              value={li.quantity}
                              onChange={(e) =>
                                updateLine(idx, {
                                  quantity: parseFloat(e.target.value) || 0,
                                })
                              }
                              className={`${cellInput} text-right ${li.mrPendingQty != null && li.quantity - li.mrPendingQty > 0.0001 ? "border-red-400" : ""}`}
                            />
                            {li.mrPendingQty != null && (
                              <p
                                className={`mt-0.5 text-[10px] ${li.quantity - li.mrPendingQty > 0.0001 ? "text-red-500" : "text-muted-foreground"}`}
                              >
                                Pending on MR: {li.mrPendingQty}
                              </p>
                            )}
                            {/* Live equivalents in this item's other tagged UOMs */}
                            {li.quantity > 0 &&
                              (() => {
                                const lineItem = items.find((i) => i.id === li.itemId);
                                if (!lineItem) return null;
                                const itemAlternates = alternatesForItem(
                                  itemUomAlternates,
                                  lineItem.id,
                                );
                                if (itemAlternates.length === 0) return null;
                                const currentCode =
                                  uoms.find((u) => u.id === li.uomId)?.code ??
                                  lineItem.uom;
                                const fromFactor = getItemUomFactor(
                                  itemUomAlternates,
                                  lineItem.id,
                                  currentCode,
                                  lineItem.uom,
                                );
                                if (fromFactor == null) return null;
                                const others: { label: string; qty: number }[] = [];
                                if (lineItem.uom && lineItem.uom !== currentCode) {
                                  others.push({
                                    label: lineItem.uom,
                                    qty: convertItemQuantity(li.quantity, fromFactor, 1),
                                  });
                                }
                                for (const a of itemAlternates) {
                                  if (a.uomCode === currentCode) continue;
                                  others.push({
                                    label: a.symbol || a.uomName || a.uomCode,
                                    qty: convertItemQuantity(
                                      li.quantity,
                                      fromFactor,
                                      a.conversionFactor,
                                    ),
                                  });
                                }
                                if (others.length === 0) return null;
                                return (
                                  <p className="text-[10px] text-muted-foreground text-right mt-1">
                                    ≈{" "}
                                    {others
                                      .map(
                                        (o) =>
                                          `${o.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${o.label}`,
                                      )
                                      .join(" · ")}
                                  </p>
                                );
                              })()}
                          </>
                        )}
                      </td>

                      {/* UOM */}
                      <td className="px-3 py-2">
                        {isReadOnly ? (
                          <span className="text-sm text-muted-foreground">
                            {li.unit || "—"}
                          </span>
                        ) : li.uomLocked ? (
                          <span
                            className="flex items-center gap-1 text-sm text-muted-foreground"
                            title="UOM is locked to what was quoted — remove and re-add the item to change it"
                          >
                            <Lock size={11} className="shrink-0" />
                            {li.unit || "—"}
                          </span>
                        ) : (() => {
                          const currentUom = uoms.find(
                            (u) =>
                              u.id === li.uomId ||
                              u.name.toLowerCase() === li.unit.toLowerCase() ||
                              u.code.toLowerCase() === li.unit.toLowerCase(),
                          );
                          // Only offer UOMs relevant to the currently-selected
                          // one (same measurement category — e.g. Weight units
                          // for a Weight unit) so a liquid item can't be
                          // switched to "Running Meter". Units with no category
                          // (Bags, Box, Set, ...) fall back to the full list,
                          // same as before this feature existed.
                          const options = relevantUOMs(uoms, currentUom?.category);

                          // Item-tagged alternates (e.g. Cement in CFT) have no
                          // fixed physical category, so they're never in the
                          // category-based `options` above — merge them in.
                          const lineItem = items.find((i) => i.id === li.itemId);
                          const itemAlternates = lineItem
                            ? alternatesForItem(itemUomAlternates, lineItem.id)
                            : [];
                          const extraOptions = itemAlternates
                            .map((a) => uoms.find((u) => u.code === a.uomCode))
                            .filter(
                              (u): u is (typeof uoms)[number] =>
                                !!u && !options.some((o) => o.id === u.id) && u.id !== currentUom?.id,
                            );

                          return (
                          <div className="relative">
                            <select
                              value={currentUom?.id ?? ""}
                              onChange={(e) => {
                                const uom = uoms.find(
                                  (u) => u.id === Number(e.target.value),
                                );
                                if (!uom) return;

                                // Item-specific conversion (e.g. Cement Bag <->
                                // CFT) takes priority over the category-based
                                // one — it's the more precise, item-authored
                                // figure when both are available.
                                const itemFromFactor = lineItem
                                  ? getItemUomFactor(
                                      itemUomAlternates,
                                      lineItem.id,
                                      currentUom?.code ?? "",
                                      lineItem.uom,
                                    )
                                  : null;
                                const itemToFactor = lineItem
                                  ? getItemUomFactor(
                                      itemUomAlternates,
                                      lineItem.id,
                                      uom.code,
                                      lineItem.uom,
                                    )
                                  : null;

                                let nextRate = li.rate;
                                if (itemFromFactor != null && itemToFactor != null) {
                                  nextRate = convertItemRate(
                                    li.rate,
                                    itemFromFactor,
                                    itemToFactor,
                                  );
                                } else if (
                                  currentUom?.category &&
                                  uom.category === currentUom.category &&
                                  currentUom.baseFactor &&
                                  uom.baseFactor
                                ) {
                                  // Same-category switch (e.g. tonne -> kg):
                                  // re-price the rate so the line's total value
                                  // doesn't silently change under the user —
                                  // a supplier quote of ₹100/tonne becomes
                                  // ₹0.1/kg, not ₹100/kg.
                                  nextRate = convertRate(li.rate, currentUom.baseFactor, uom.baseFactor);
                                }
                                updateLine(idx, {
                                  uomId: uom.id,
                                  unit: uom.name,
                                  rate: nextRate,
                                });
                              }}
                              className={cellSelect}
                            >
                              <option value="">— UOM —</option>
                              {options.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                              {extraOptions.length > 0 && (
                                <optgroup label="Tagged for this item">
                                  {extraOptions.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                          );
                        })()}
                      </td>

                      {/* Rate */}
                      <td className="px-3 py-2">
                        {isReadOnly ? (
                          <span className="text-sm text-right block font-mono">
                            ₹
                            {Number.isFinite(li.rate)
                              ? li.rate.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              : "0.00"}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="any"
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

                      {/* GST % */}
                      <td className="px-3 py-2 text-center">
                        {li.gstRate > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
                              {li.gstRate}%
                            </span>
                            {li.igstRate > 0 ? (
                              <span className="text-[10px] text-muted-foreground font-medium">
                                IGST
                              </span>
                            ) : (
                              <>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  CGST {li.cgstRate}%
                                </span>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  SGST {li.sgstRate}%
                                </span>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>

                      {/* Amount (base + GST) */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-sm font-semibold font-mono text-foreground">
                          ₹
                          {(Number.isFinite(li.amount)
                            ? li.amount
                            : 0
                          ).toLocaleString("en-IN", {
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
                      <span>Total GST</span>
                      <span className="font-mono">{fmt(totalTax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold text-foreground border-t border-border pt-2">
                    <span>Grand Total</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
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
                <ClipboardList
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Terms &amp; Conditions
              </h3>
              {!isReadOnly && (
                <div className="relative">
                  <button
                    onClick={() => setTcDropdownOpen((o) => !o)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
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
                                  className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-emerald-500/[0.05]" : ""}`}
                                >
                                  <span
                                    className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-border"}`}
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
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center mt-0.5">
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
                <Link2
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
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
                        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                        : "border-border bg-muted/20"
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        poChainStatus?.isPaid
                          ? "bg-emerald-100 dark:bg-emerald-950/40"
                          : "bg-muted"
                      }`}
                    >
                      <CircleDollarSign
                        size={13}
                        className={
                          poChainStatus?.isPaid
                            ? "text-emerald-600 dark:text-emerald-400"
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
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
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
              <DocumentChainPanel
                docType="po"
                id={editingId ? Number(editingId) : null}
              />
            </div>
          )}

          {/* Bottom action bar */}
          {!isReadOnly &&
            (() => {
              const poCanSave = !!(
                form.supplierId &&
                form.companyId &&
                form.projectId &&
                lineItems.some((li) => li.itemName || li.rate > 0)
              );
              const poIsDirty = !!(
                form.supplierId ||
                form.companyId ||
                form.projectId ||
                form.remarks ||
                form.expectedDate ||
                lineItems.some((li) => li.itemName || li.rate > 0)
              );
              return (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
                  <p className="text-[11px] text-muted-foreground hidden sm:block">
                    {saved ? (
                      <span className="text-emerald-500 font-medium">
                        Saved!
                      </span>
                    ) : poCanSave ? (
                      <span className="text-emerald-500 font-medium">
                        Ready to save
                      </span>
                    ) : (
                      "Fill in the required fields to save"
                    )}
                  </p>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <button
                      onClick={goToCreate}
                      disabled={saving || saved || !poIsDirty}
                      className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || saved || !poCanSave}
                      className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                    >
                      {saved ? (
                        <Check size={14} />
                      ) : saving ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      {saved
                        ? "Saved!"
                        : saving
                          ? "Saving…"
                          : "Save Purchase Order"}
                    </button>
                  </div>
                </div>
              );
            })()}
        </div>
      </MaterialShell>
    </>
  );
};

export default PurchaseOrderMaster;
