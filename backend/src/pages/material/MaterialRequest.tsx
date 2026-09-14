import { generateUUID } from "../../utils/cryptoPolyfill";
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import * as mrApi from "@/api/materialRequestApi";
import { ItemPicker } from "./ItemPicker";
import {
  CalendarDays,
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Plus,
  RefreshCw,
  X,
  ClipboardList,
  Edit3,
  Hash,
  AlertTriangle,
  CheckCircle2,
  Send,
  ShoppingCart,
  Package,
  ArrowLeft,
  RotateCcw,
  Check,
  ChevronDown,
  Download,
  Upload,
  Loader2,
  Printer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { isPrivilegedRole } from "@/contexts/auth.utils";
import {
  fetchNextDocNumber,
  fetchDocTypes,
  type DocType,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { useFinYear } from "@/contexts/FinYearContext";
import { toShortFinYear } from "@/utils/finYear";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { relevantUOMs, convertQuantity } from "@/lib/uomConversion";
import {
  alternatesForItem,
  getItemUomFactor,
  convertItemQuantity,
} from "@/lib/itemUomAlternates";
import { getAllItemUomAlternates } from "@/api/itemUomAlternatesApi";
import { printMasterPreview } from "@/utils/masterPreviewPrint";

// ─── Template columns ─────────────────────────────────────────────────────────
const MR_TEMPLATE_COLUMNS = [
  { header: "Document Type", accessor: "Document Type" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Financial Year", accessor: "Financial Year" },
  { header: "Priority (Normal/High/Critical/Low)", accessor: "Priority (Normal/High/Critical/Low)" },
  { header: "Required By Date (YYYY-MM-DD)", accessor: "Required By Date (YYYY-MM-DD)" },
  { header: "Reason", accessor: "Reason" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
  { header: "Item Remarks", accessor: "Item Remarks" },
];

// ─── Shared styles (matching PurchaseOrderMaster) ────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CartItem {
  _key: string;
  ItemId: string;
  ItemName?: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  AvailableStock?: number;
  DefaultUOM?: string;
}

interface FormHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  requestDate: string;
  requiredByDate: string;
  priority: string;
  reason: string;
  remarks: string;
  docTypeId: number | null;
  docNoPreview: string;
}

const defaultHeader: FormHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  requestDate: new Date().toISOString().slice(0, 10),
  requiredByDate: "",
  priority: "Normal",
  reason: "",
  remarks: "",
  docTypeId: null,
  docNoPreview: "",
};

const blankCartItem = (): CartItem => ({
  _key: generateUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"];

const PRIORITY_COLOR: Record<string, string> = {
  Low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  Normal:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const Field = ({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Priority", accessor: "Priority" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Item Count", accessor: (r) => Number(r.ItemCount) || 0 },
  { header: "Total Qty", accessor: (r) => Number(r.TotalQty) || 0 },
  { header: "Requested", accessor: (r) => fmtDate(r.RequestDate as string) },
  { header: "Required By", accessor: (r) => fmtDate(r.RequiredByDate as string) },
  { header: "Status", accessor: "Status" },
];

// ─── Main component ────────────────────────────────────────────────────────────

export default function MaterialRequest() {
  const rights = usePageRights("material-request");
  const { currentUser } = useAuth();
  const isAdmin = !!currentUser && isPrivilegedRole(currentUser.role);
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") ?? "",
  );
  const limit = 10;

  const [header, setHeader] = useState<FormHeader>(defaultHeader);
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);

  const setH = <K extends keyof FormHeader>(k: K, v: FormHeader[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));

  // ── Master data ──────────────────────────────────────────────────────────────

  const { finYears: ctxFinYears } = useFinYear();
  const activeYear = ctxFinYears.find((y) => y.status === "Active") ?? null;

  const { data: companies = [] } = useQuery({
    queryKey: ["mr-companies"],
    queryFn: mrApi.getMRCompanies,
    staleTime: 5 * 60_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["mr-projects"],
    queryFn: mrApi.getMRProjects,
    staleTime: 5 * 60_000,
  });

  const filteredProjects = (projects as any[]).filter(
    (p) =>
      !header.companyId || String(p.company_id) === String(header.companyId),
  );

  const { data: finYears = [] } = useQuery({
    queryKey: ["mr-finyears"],
    queryFn: mrApi.getMRFinYears,
    staleTime: 5 * 60_000,
  });
  // Prefer the fin year the user has selected in the form; fall back to context active year
  const selectedFY = (finYears as any[]).find(
    (fy) => String(fy.id) === String(header.finYearId),
  );
  const finYearStr = selectedFY
    ? toShortFinYear(String(selectedFY.name))
    : activeYear
      ? `${String(activeYear.startDate).slice(2, 4)}-${String(activeYear.endDate).slice(2, 4)}`
      : undefined;

  const { data: itemOptions = [] } = useQuery({
    queryKey: ["mr-items", header.projectId],
    queryFn: () => mrApi.getMRItemOptions(header.projectId || null),
    staleTime: 60_000,
    enabled: true,
  });

  const { data: uoms = [] } = useQuery({
    queryKey: ["mr-uoms"],
    queryFn: async () => {
      const data = await mrApi.getMRUomOptions();
      return (Array.isArray(data) ? data : []).filter(
        (u: any) => u.IsActive === true || u.IsActive === 1,
      );
    },
    staleTime: 5 * 60_000,
  });

  const { data: itemUomAlternates = [] } = useQuery({
    queryKey: ["item-uom-alternates"],
    queryFn: getAllItemUomAlternates,
    staleTime: 60_000,
  });

  // ── MR doc types (for the plain Request No select) ──────────────────────────

  const [mrDocTypes, setMrDocTypes] = useState<DocType[]>([]);
  const [mrDocTypesLoading, setMrDocTypesLoading] = useState(true);

  useEffect(() => {
    setMrDocTypesLoading(true);
    fetchDocTypes("MR")
      .then(setMrDocTypes)
      .finally(() => setMrDocTypesLoading(false));
  }, []);

  // Auto-select first doc type and fetch preview when list loads or finYear changes
  useEffect(() => {
    if (mrDocTypesLoading || editingId) return;
    if (mrDocTypes.length === 0) return;
    const firstId = mrDocTypes[0].TypeOfDocId;
    if (!header.docTypeId) {
      fetchNextDocNumber(firstId, finYearStr).then((preview) =>
        setHeader((p) => ({ ...p, docTypeId: firstId, docNoPreview: preview })),
      );
    }
  }, [mrDocTypes, mrDocTypesLoading]);

  // Refresh preview whenever finYear or selected doc type changes (create mode only)
  useEffect(() => {
    if (!header.docTypeId || editingId) return;
    fetchNextDocNumber(header.docTypeId, finYearStr).then((preview) =>
      setHeader((p) => ({ ...p, docNoPreview: preview })),
    );
  }, [header.docTypeId, finYearStr]);

  const { data: listData, isLoading: loadingList } = useQuery({
    queryKey: ["mr-list", page, search, statusFilter],
    queryFn: () =>
      mrApi.getMaterialRequests({ page, limit, search, status: statusFilter }),
  });

  // Bulk pending-qty totals for every MR that's reached the fulfillment
  // lifecycle (Approved/Partially Fulfilled/Completed) — powers the
  // "Pending - N Qty" / "Completed" pill without an N+1 fetch per row.
  const { data: pendingSummaryList = [] } = useQuery({
    queryKey: ["mr-pending-summary"],
    queryFn: mrApi.getBulkMRPendingSummary,
    staleTime: 30_000,
  });
  const pendingSummaryByMRId = useMemo(() => {
    const m = new Map<number, mrApi.MRPendingSummaryTotals>();
    for (const row of pendingSummaryList) m.set(row.MRId, row);
    return m;
  }, [pendingSummaryList]);

  // ── Auto-select active fin year ──────────────────────────────────────────────

  useEffect(() => {
    if (
      finYears.length > 0 &&
      !header.finYearId &&
      viewMode === "form" &&
      !editingId
    ) {
      const today = new Date().toISOString().slice(0, 10);
      const current = (finYears as any[]).find(
        (f) => f.isActive && f.startDate <= today && f.endDate >= today,
      );
      const fallback = (finYears as any[]).find((f) => f.isActive);
      const active = current ?? fallback;
      if (active) setH("finYearId", String(active.id));
    }
  }, [finYears, viewMode, editingId]);

  // ── Item & UOM lookup ────────────────────────────────────────────────────────

  const itemMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const item of itemOptions as any[]) m[String(item.M_Id)] = item;
    return m;
  }, [itemOptions]);

  const pickableItems = useMemo(
    () =>
      (itemOptions as any[]).map((item) => ({
        id: String(item.M_Id),
        name: `${item.M_Name} — Stock: ${Number(item.AvailableStock).toFixed(2)}${item.M_Group ? ` · ${item.M_Group}` : ""}`,
        itemType: item.M_Type ?? "",
      })),
    [itemOptions],
  );

  const uomMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of uoms as any[]) m[u.UOMCode] = u;
    return m;
  }, [uoms]);

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const updateCartItem = useCallback(
    <K extends keyof CartItem>(key: string, field: K, value: CartItem[K]) => {
      setCart((prev) =>
        prev.map((ci) => (ci._key === key ? { ...ci, [field]: value } : ci)),
      );
    },
    [],
  );

  const pickItem = useCallback(
    (cartKey: string, itemId: string) => {
      const found = itemMap[itemId];
      const defaultUom =
        found?.DefaultUOM || (uoms as any[]).find(Boolean)?.UOMCode || "";
      setCart((prev) =>
        prev.map((ci) =>
          ci._key === cartKey
            ? {
                ...ci,
                ItemId: itemId,
                ItemName: found?.M_Name,
                AvailableStock: Number(found?.AvailableStock ?? 0),
                DefaultUOM: defaultUom,
                UOMCode: defaultUom,
              }
            : ci,
        ),
      );
    },
    [itemMap, uoms],
  );

  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (key: string) =>
    setCart((p) => (p.length > 1 ? p.filter((ci) => ci._key !== key) : p));

  // ── Validation ───────────────────────────────────────────────────────────────

  const cartIsValid = useMemo(
    () =>
      cart.length > 0 &&
      cart.every(
        (ci) =>
          ci.ItemId && ci.UOMCode && ci.Quantity && Number(ci.Quantity) > 0,
      ),
    [cart],
  );

  const headerIsValid = useMemo(
    () =>
      Boolean(
        header.companyId &&
        header.projectId &&
        header.requestDate &&
        header.reason.trim(),
      ),
    [header],
  );

  const canSave = headerIsValid && cartIsValid;

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["mr-list"] });
  };

  const createMutation = useMutation({
    mutationFn: mrApi.createMaterialRequest,
    onSuccess: (rec: any) => {
      toast.success(
        `Material Request ${rec?.DocNo || ""} created and sent for approval`,
      );
      invalidate();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create request"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: any) => mrApi.updateMaterialRequest(editingId!, p),
    onSuccess: () => {
      toast.success("Material Request updated");
      invalidate();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to update request"),
  });

  const deleteMutation = useMutation({
    mutationFn: mrApi.deleteMaterialRequest,
    onSuccess: () => {
      toast.success("Material Request deleted");
      invalidate();
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to delete request"),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const [saved, setSaved] = useState(false);

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
  };

  const resetFields = () => {
    setEditingId(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
    setSaved(false);
  };

  const handleEdit = (record: any) => {
    setHeader({
      companyId: String(record.CompanyId ?? ""),
      projectId: String(record.ProjectId ?? ""),
      finYearId: String(record.FinYearId ?? ""),
      docTypeId: record.DocTypeId ?? null,
      docNoPreview: "",
      requestDate: record.RequestDate
        ? String(record.RequestDate).slice(0, 10)
        : defaultHeader.requestDate,
      requiredByDate: record.RequiredByDate
        ? String(record.RequiredByDate).slice(0, 10)
        : "",
      priority: record.Priority ?? "Normal",
      reason: record.Reason ?? "",
      remarks: record.Remarks ?? "",
    });
    const items: CartItem[] = (record.items || []).map((it: any) => ({
      _key: generateUUID(),
      ItemId: String(it.ItemId ?? ""),
      ItemName: it.ItemName,
      UOMCode: String(it.UOMCode ?? ""),
      Quantity: String(it.Quantity ?? ""),
      Remarks: it.Remarks ?? "",
      AvailableStock: Number(itemMap[it.ItemId]?.AvailableStock ?? 0),
    }));
    setCart(items.length > 0 ? items : [blankCartItem()]);
    setEditingId(record.MRId);
    setViewMode("form");
  };

  const handleView = async (record: any) => {
    try {
      const full = await mrApi.getMaterialRequestById(record.MRId);
      setViewingRecord(full);
    } catch {
      setViewingRecord(record);
    }
  };

  // Deep-link support — Linked Documents panels elsewhere navigate here as
  // /material/material-request?view=<MRId> to open this exact MR.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    handleView({ MRId: Number(viewId) });
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = () => {
    if (!canSave) {
      if (!headerIsValid) toast.error("Fill all required header fields");
      else toast.error("Each item needs item, UOM, and a valid quantity");
      return;
    }
    const payload = {
      CompanyId: Number(header.companyId) || null,
      ProjectId: Number(header.projectId) || null,
      FinYearId: Number(header.finYearId) || null,
      RequestDate: header.requestDate,
      RequiredByDate: header.requiredByDate || null,
      Priority: header.priority,
      Reason: header.reason,
      Remarks: header.remarks || null,
      DocTypeId: header.docTypeId || null,
      items: cart.map((ci) => ({
        ItemId: ci.ItemId,
        ItemName: ci.ItemName || itemMap[ci.ItemId]?.M_Name || null,
        UOMCode: ci.UOMCode,
        Quantity: Number(ci.Quantity),
        Remarks: ci.Remarks || null,
      })),
    };
    if (editingId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ColumnDef<any, unknown>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      size: 130,
      cell: ({ getValue }) => (
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "Priority",
      accessorKey: "Priority",
      header: "Priority",
      size: 90,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => {
        const v = (getValue() as string) || "Normal";
        return (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[v] ?? PRIORITY_COLOR.Normal}`}
          >
            {v}
          </span>
        );
      },
    },
    {
      id: "CompanyName",
      accessorKey: "CompanyName",
      header: "Company",
      size: 200,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="block text-sm truncate" title={String(getValue() || "")}>{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Project",
      size: 180,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="block text-sm text-muted-foreground truncate" title={String(getValue() || "")}>{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "ItemCount",
      accessorKey: "ItemCount",
      header: "Items",
      size: 140,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          <span className="font-semibold">{row.original.ItemCount || 0}</span>
          <span className="text-muted-foreground ml-1">({(row.original.TotalQty || 0).toFixed(2)} units)</span>
        </span>
      ),
    },
    {
      id: "RequestDate",
      accessorKey: "RequestDate",
      header: "Requested",
      size: 110,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {fmtDate(getValue() as string)}
        </span>
      ),
    },
    {
      id: "RequiredByDate",
      accessorKey: "RequiredByDate",
      header: "Required By",
      size: 110,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        const isUrgent = v && new Date(v) < new Date();
        return (
          <span
            className={`text-sm ${isUrgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}
          >
            {fmtDate(v)}
          </span>
        );
      },
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      size: 180,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const pending = pendingSummaryByMRId.get(row.original.MRId);
        return (
          <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
            <ApprovalStatusChain
              table="MaterialRequests"
              recordId={row.original.MRId}
            />
            {pending &&
              (pending.totalPending > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Pending &middot; {pending.totalPending} Qty
                </span>
              ) : pending.totalOrdered > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Completed
                </span>
              ) : null)}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      size: 160,
      cell: ({ row }) => {
        const status = row.original.Status as string;
        const isDeleting = deleteMutation.isPending;
        return (
          <div className="flex items-center justify-end gap-2">
            {/* View — always visible */}
            <button
              type="button"
              onClick={() => handleView(row.original)}
              className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>

            {/* Update — Draft or Approved (post-approval edits get logged
                as amendments), or any status for admins */}
            {rights.canEdit && status !== "Short Closed" && (status === "Draft" || status === "Approved" || isAdmin) && (
              <button
                type="button"
                onClick={() => handleEdit(row.original)}
                className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                title={
                  status === "Draft"
                    ? "Edit this request"
                    : status === "Approved"
                      ? "Edit (will be logged as an amendment)"
                      : "Edit (admin override)"
                }
              >
                <Edit3 size={15} />
              </button>
            )}

            {/* Delete */}
            {rights.canDelete && (
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  if (confirm("Delete this material request?"))
                    deleteMutation.mutate(row.original.MRId);
                }}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title="Delete this request"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // ── List view ─────────────────────────────────────────────────────────────────

  const ListView = () => {
    const totalPages = listData?.totalPages || 1;
    const rows: any[] = listData?.data || [];
    const totalCount = listData?.total || 0;

    return (
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Request Register
                </CardTitle>
                {!loadingList && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalCount} record{totalCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <div className="relative w-full sm:w-64">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search doc no, company…"
                  className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                "",
                "Pending",
                "Approved",
              ].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                    if (s) setSearchParams({ status: s });
                    else setSearchParams({});
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    statusFilter === s
                      ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm"
                      : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"
                  }`}
                >
                  {s || "All"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingList ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <DataTable
                data={rows}
                columns={columns}
                searchable={false}
                paginated={false}
                emptyMessage="No material requests found. Click 'New Request' to create one."
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(p + 1, totalPages))
                      }
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  // ── Form view ─────────────────────────────────────────────────────────────────

  const FormView = () => (
    <div className="space-y-5">
      {/* Header card */}
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
                <ClipboardList size={12} className="text-emerald-400" />
              </div>
              <h2 className="text-sm font-heading font-bold text-foreground truncate">
                {editingId ? "Edit Material Request" : "New Material Request"}
              </h2>
            </div>
          </div>
        </div>

        <CardContent className="p-5 space-y-4">
          {/* Doc number / Type of Doc */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
            <FileText size={13} className="text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest mr-2 whitespace-nowrap">
              Request No:
            </span>
            {editingId ? (
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm break-all">
                {viewingRecord?.DocNo ?? "Immutable after creation"}
              </span>
            ) : (
              <div className="flex-1 flex flex-wrap items-center gap-3 min-w-0">
                <div className="relative flex-1 min-w-[200px]">
                  <select
                    value={header.docTypeId ? String(header.docTypeId) : ""}
                    onChange={async (e) => {
                      const id = e.target.value
                        ? parseInt(e.target.value, 10)
                        : null;
                      if (!id) {
                        setHeader((p) => ({
                          ...p,
                          docTypeId: null,
                          docNoPreview: "",
                        }));
                        return;
                      }
                      const preview = await fetchNextDocNumber(id, finYearStr);
                      setHeader((p) => ({
                        ...p,
                        docTypeId: id,
                        docNoPreview: preview,
                      }));
                    }}
                    disabled={mrDocTypesLoading}
                    className={selectCls}
                  >
                    {mrDocTypesLoading ? (
                      <option value="">Loading…</option>
                    ) : mrDocTypes.length === 0 ? (
                      <option value="">No doc types found</option>
                    ) : (
                      mrDocTypes.map((dt) => {
                        const label =
                          dt.ProjectCode && dt.ModuleCode
                            ? `${dt.ProjectCode}-${dt.ModuleCode}`
                            : (dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix);
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
                {header.docNoPreview && (
                  <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider whitespace-nowrap">
                    {header.docNoPreview}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Row 1: Company | Project | Fin Year | Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="Company" required>
              <div className="relative">
                <select
                  value={header.companyId}
                  onChange={(e) => {
                    setH("companyId", e.target.value);
                    setH("projectId", "");
                    setCart([blankCartItem()]);
                  }}
                  className={selectCls}
                >
                  <option value="">Select company</option>
                  {(companies as any[]).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.label ?? c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Project" required>
              <div className="relative">
                <select
                  value={header.projectId}
                  onChange={(e) => {
                    setH("projectId", e.target.value);
                    setCart([blankCartItem()]);
                  }}
                  className={selectCls}
                >
                  <option value="">Select project</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Financial Year">
              <div className="relative">
                <select
                  value={header.finYearId}
                  onChange={(e) => setH("finYearId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select fin year</option>
                  {(finYears as any[]).map((fy) => (
                    <option
                      key={fy.id}
                      value={String(fy.id)}
                      disabled={fy.isLocked}
                    >
                      {fy.name}
                      {fy.isLocked ? " (locked)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Priority">
              <div className="relative">
                <select
                  value={header.priority}
                  onChange={(e) => setH("priority", e.target.value)}
                  className={selectCls}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>
          </div>

          {/* Row 2: Request Date | Required By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Request Date" required>
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={header.requestDate}
                  onChange={(e) => setH("requestDate", e.target.value)}
                  className={`${inputCls} pl-8`}
                />
              </div>
            </Field>
            <Field label="Required By Date">
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={header.requiredByDate}
                  onChange={(e) => setH("requiredByDate", e.target.value)}
                  className={`${inputCls} pl-8`}
                />
              </div>
            </Field>
          </div>

          {/* Row 3: Reason | Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Reason for Request" required>
              <Textarea
                value={header.reason}
                onChange={(e) => setH("reason", e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="State the reason for this material request…"
              />
            </Field>
            <Field label="Remarks">
              <Textarea
                value={header.remarks}
                onChange={(e) => setH("remarks", e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="Optional notes…"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Items card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="px-4 sm:px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <ShoppingCart
                size={15}
                className="text-emerald-600 dark:text-emerald-400"
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">
                Requested Items
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {cart.length} line item{cart.length !== 1 ? "s" : ""}
                {header.projectId && (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                    · Stock from project godown
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCartRow}
            className="gap-1.5 h-8 text-xs self-start sm:self-auto"
          >
            <Plus size={13} /> Add Item
          </Button>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {/* Column headers — visible on md+ */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_auto] gap-4 px-1 pb-1 border-b border-border/50">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Item
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Unit (UOM)
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Quantity
            </span>
            <span className="w-8" />
          </div>

          {cart.map((ci, idx) => (
            <div
              key={ci._key}
              className="group relative rounded-xl border border-border bg-card hover:border-emerald-500/30 hover:shadow-sm transition-all duration-150"
            >
              {/* Row number pill */}
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm">
                {idx + 1}
              </div>

              <div className="p-4 pl-5">
                {/* Main row: item | uom | qty | remove — all on one line on desktop */}
                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-start">
                  {/* Item selector */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Item *
                    </label>
                    <ItemPicker
                      items={pickableItems}
                      value={ci.ItemId}
                      onChange={(id) => pickItem(ci._key, id)}
                    />
                  </div>

                  {/* UOM selector */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Unit (UOM) *
                    </label>
                    <div className="relative">
                      {(() => {
                        const defaultCategory = ci.DefaultUOM
                          ? uomMap[ci.DefaultUOM]?.UOMCategory ?? null
                          : null;
                        // Only offer UOMs relevant to the item's own default
                        // unit (same measurement category, e.g. Weight units
                        // for a Weight item) — a water/liquid item no longer
                        // gets offered something like "Running Meter", and a
                        // packaging item (Box) only sees other packaging
                        // units (Pieces, Bags, ...) instead of the full list.
                        const relevant = relevantUOMs(
                          (uoms as any[]).map((u) => ({
                            ...u,
                            category: u.UOMCategory ?? null,
                          })),
                          defaultCategory,
                        ).filter((u: any) => u.UOMCode !== ci.DefaultUOM);

                        // Item-tagged alternates (e.g. Cement in CFT) have no
                        // fixed physical category, so they're never in the
                        // category-based `relevant` list above — merge them
                        // in separately, deduped against it.
                        const itemAlternates = ci.ItemId
                          ? alternatesForItem(itemUomAlternates, ci.ItemId)
                          : [];
                        const extraAlternates = itemAlternates
                          .filter(
                            (a) =>
                              a.uomCode !== ci.DefaultUOM &&
                              !relevant.some((u: any) => u.UOMCode === a.uomCode),
                          )
                          .map((a) => ({
                            UOMCode: a.uomCode,
                            UOMName: a.uomName || a.uomCode,
                            Symbol: a.symbol,
                          }));

                        return (
                          <select
                            value={ci.UOMCode}
                            onChange={(e) => {
                              const nextCode = e.target.value;
                              const nextUom = uomMap[nextCode];
                              const currentUom = uomMap[ci.UOMCode];

                              // Item-specific conversion (e.g. Cement Bag <->
                              // CFT) takes priority over the category-based
                              // one — it's the more precise, item-authored
                              // figure when both are available.
                              const itemFromFactor = ci.ItemId
                                ? getItemUomFactor(
                                    itemUomAlternates,
                                    ci.ItemId,
                                    ci.UOMCode,
                                    ci.DefaultUOM,
                                  )
                                : null;
                              const itemToFactor = ci.ItemId
                                ? getItemUomFactor(
                                    itemUomAlternates,
                                    ci.ItemId,
                                    nextCode,
                                    ci.DefaultUOM,
                                  )
                                : null;

                              let nextQty = ci.Quantity;
                              if (itemFromFactor != null && itemToFactor != null) {
                                nextQty = String(
                                  convertItemQuantity(
                                    parseFloat(ci.Quantity) || 0,
                                    itemFromFactor,
                                    itemToFactor,
                                  ),
                                );
                              } else if (
                                currentUom?.UOMCategory &&
                                nextUom?.UOMCategory === currentUom.UOMCategory &&
                                currentUom.BaseFactor &&
                                nextUom.BaseFactor
                              ) {
                                // Same-category switch (e.g. tonne -> kg): convert
                                // the already-entered quantity so it still means
                                // the same physical amount in the new unit.
                                nextQty = String(
                                  convertQuantity(
                                    parseFloat(ci.Quantity) || 0,
                                    Number(currentUom.BaseFactor),
                                    Number(nextUom.BaseFactor),
                                  ),
                                );
                              }

                              setCart((prev) =>
                                prev.map((c) =>
                                  c._key === ci._key
                                    ? { ...c, UOMCode: nextCode, Quantity: nextQty }
                                    : c,
                                ),
                              );
                            }}
                            className={selectCls}
                          >
                            <option value="">UOM…</option>
                            {ci.DefaultUOM && uomMap[ci.DefaultUOM] && (
                              <option
                                key={"default-" + ci.DefaultUOM}
                                value={ci.DefaultUOM}
                              >
                                {uomMap[ci.DefaultUOM].UOMName}
                                {uomMap[ci.DefaultUOM].Symbol
                                  ? ` (${uomMap[ci.DefaultUOM].Symbol}) · default`
                                  : " · default"}
                              </option>
                            )}
                            {relevant.map((u: any) => (
                              <option key={u.UOMCode} value={u.UOMCode}>
                                {u.UOMName}
                                {u.Symbol ? ` (${u.Symbol})` : ""}
                              </option>
                            ))}
                            {extraAlternates.length > 0 && (
                              <optgroup label="Tagged for this item">
                                {extraAlternates.map((u) => (
                                  <option key={u.UOMCode} value={u.UOMCode}>
                                    {u.UOMName}
                                    {u.Symbol ? ` (${u.Symbol})` : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        );
                      })()}
                      <ChevronDown
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Quantity *
                    </label>
                    <div className="relative">
                      <Hash
                        size={12}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={ci.Quantity}
                        onChange={(e) =>
                          updateCartItem(ci._key, "Quantity", e.target.value)
                        }
                        className="pl-8 h-10 font-mono"
                        placeholder="0.00"
                      />
                    </div>
                    {/* Live equivalents in this item's other tagged UOMs */}
                    {ci.ItemId &&
                      ci.UOMCode &&
                      parseFloat(ci.Quantity) > 0 &&
                      (() => {
                        const itemAlternates = alternatesForItem(
                          itemUomAlternates,
                          ci.ItemId,
                        );
                        const fromFactor = getItemUomFactor(
                          itemUomAlternates,
                          ci.ItemId,
                          ci.UOMCode,
                          ci.DefaultUOM,
                        );
                        if (fromFactor == null || itemAlternates.length === 0)
                          return null;
                        const others: { label: string; qty: number }[] = [];
                        if (ci.DefaultUOM && ci.DefaultUOM !== ci.UOMCode) {
                          others.push({
                            label:
                              uomMap[ci.DefaultUOM]?.Symbol ||
                              uomMap[ci.DefaultUOM]?.UOMName ||
                              ci.DefaultUOM,
                            qty: convertItemQuantity(
                              parseFloat(ci.Quantity) || 0,
                              fromFactor,
                              1,
                            ),
                          });
                        }
                        for (const a of itemAlternates) {
                          if (a.uomCode === ci.UOMCode) continue;
                          others.push({
                            label: a.symbol || a.uomName || a.uomCode,
                            qty: convertItemQuantity(
                              parseFloat(ci.Quantity) || 0,
                              fromFactor,
                              a.conversionFactor,
                            ),
                          });
                        }
                        if (others.length === 0) return null;
                        return (
                          <p className="text-[10px] text-muted-foreground mt-1">
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
                  </div>

                  {/* Remove */}
                  <div className="flex items-start pt-0 md:pt-0">
                    <button
                      type="button"
                      onClick={() => removeCartRow(ci._key)}
                      disabled={cart.length === 1}
                      title="Remove row"
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-25"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Remarks — always full width below, only shown when item picked */}
                {ci.ItemId && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <Input
                      value={ci.Remarks}
                      onChange={(e) =>
                        updateCartItem(ci._key, "Remarks", e.target.value)
                      }
                      placeholder="Line remarks (optional)"
                      className="h-9 text-sm text-muted-foreground placeholder:text-muted-foreground/50"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Cart summary */}
          {cart.some((ci) => ci.ItemId && ci.Quantity) && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-5 py-3.5 text-sm mt-2">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Package size={14} />
                <span>
                  <span className="font-semibold text-foreground">
                    {cart.filter((ci) => ci.ItemId).length}
                  </span>{" "}
                  item{cart.filter((ci) => ci.ItemId).length !== 1 ? "s" : ""} ·{" "}
                  <span className="font-semibold text-foreground font-mono">
                    {cart
                      .reduce((s, ci) => s + (Number(ci.Quantity) || 0), 0)
                      .toFixed(2)}
                  </span>{" "}
                  units total
                </span>
              </div>
              {cartIsValid ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 size={13} /> Ready to save
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                  <AlertTriangle size={13} /> Complete all items
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
        <p className="text-[11px] text-muted-foreground hidden sm:block">
          {canSave ? (
            <span className="text-emerald-500 font-medium">Ready to save</span>
          ) : (
            "Fill in the required fields to save"
          )}
        </p>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={resetFields}
            disabled={
              isSaving ||
              (!header.companyId &&
                !header.projectId &&
                !header.reason.trim() &&
                !header.remarks.trim() &&
                cart.every((ci) => !ci.ItemId && !ci.Quantity))
            }
            className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={onSave}
            disabled={!canSave || isSaving || saved}
            className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
          >
            {saved ? (
              <Check size={14} />
            ) : isSaving ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saved
              ? "Saved!"
              : isSaving
                ? "Saving…"
                : editingId
                  ? "Update Request"
                  : "Save Request"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── View mode — portal overlay ────────────────────────────────────────────────

  const ViewModal = () => {
    if (!viewingRecord) return null;
    const items: any[] = viewingRecord.items || [];
    const priority = viewingRecord.Priority || "Normal";
    const closeOverlay = () => setViewingRecord(null);

    return createPortal(
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
        onClick={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}
      >
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

        {/* ── Sticky header ── */}
        <div className="sticky top-0 bg-card z-10 border-b border-border">
          <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                <ClipboardList size={13} className="text-emerald-500" />
              </div>
              <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
                {viewingRecord.DocNo || `MR-${viewingRecord.MRId}`}
              </h2>
              <StatusBadge status={viewingRecord.Status || "Draft"} />
              {(() => {
                const pending = pendingSummaryByMRId.get(viewingRecord.MRId);
                if (!pending) return null;
                return pending.totalPending > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Pending &middot; {pending.totalPending} Qty
                  </span>
                ) : pending.totalOrdered > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Completed
                  </span>
                ) : null;
              })()}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.Normal}`}>
                {priority}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Material Request</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  const rec = viewingRecord;
                  const itms: any[] = rec.items || [];
                  printMasterPreview({
                    title: rec.DocNo || `MR-${rec.MRId}`,
                    subtitle: "Material Request",
                    code: rec.DocNo,
                    status: rec.Status,
                    sections: [
                      {
                        title: "Request Details",
                        fields: [
                          { label: "Doc No", value: rec.DocNo },
                          { label: "Financial Year", value: rec.FinYearName },
                          { label: "Request Date", value: fmtDate(rec.RequestDate) },
                          { label: "Required By", value: fmtDate(rec.RequiredByDate) },
                          { label: "Company", value: rec.CompanyName },
                          { label: "Project / Site", value: rec.ProjectName },
                          { label: "Priority", value: rec.Priority || "Normal" },
                          { label: "Reason", value: rec.Reason },
                          { label: "Remarks", value: rec.Remarks },
                        ],
                      },
                      {
                        title: `Requested Items (${itms.length})`,
                        fields: itms.map((it, i) => ({
                          label: `${i + 1}. ${it.ItemName || it.ItemId}`,
                          value: `${Number(it.Quantity).toFixed(2)} ${it.UOMName || it.UOMCode || ""}${it.Remarks ? ` — ${it.Remarks}` : ""}`,
                        })),
                      },
                    ],
                  });
                }}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                <Printer size={13} /><span className="hidden sm:inline">Print</span>
              </button>
            {rights.canEdit && viewingRecord.Status !== "Short Closed" && (viewingRecord.Status === "Draft" || viewingRecord.Status === "Approved" || isAdmin) && (
              <button
                onClick={() => { closeOverlay(); handleEdit(viewingRecord); }}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-sm transition"
              >
                <Edit3 size={13} /><span className="hidden sm:inline">Edit</span>
              </button>
            )}
            {rights.canDelete && (
              <button
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm("Delete this material request?")) {
                    deleteMutation.mutate(viewingRecord.MRId);
                    closeOverlay();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
              >
                <Trash2 size={13} /><span className="hidden sm:inline">{deleteMutation.isPending ? "Deleting…" : "Delete"}</span>
              </button>
            )}
            <button
              onClick={closeOverlay}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              <X size={16} />
            </button>
          </div>
          </div>
        </div>

        <div className="p-5 space-y-6">

          {/* ── Request Details ── */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
              <FileText size={10} className="text-emerald-500" /> Request Details
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {([
                { label: "Doc No", value: viewingRecord.DocNo, mono: true },
                { label: "Financial Year", value: viewingRecord.FinYearName },
                { label: "Request Date", value: fmtDate(viewingRecord.RequestDate) },
                { label: "Required By", value: fmtDate(viewingRecord.RequiredByDate) },
                { label: "Company", value: viewingRecord.CompanyName },
                { label: "Project / Site", value: viewingRecord.ProjectName },
              ] as { label: string; value: any; mono?: boolean }[]).map(({ label, value, mono }) => (
                <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                  <p className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Reason & Remarks ── */}
          {(viewingRecord.Reason || viewingRecord.Remarks) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {viewingRecord.Reason && (
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Reason for Request</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Reason}</p>
                </div>
              )}
              {viewingRecord.Remarks && (
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Remarks</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Remarks}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Requested Items ── */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
              <ShoppingCart size={10} className="text-emerald-500" /> Requested Items
              <span className="ml-1 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">{items.length}</span>
            </p>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">UOM</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Qty</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                  ) : (
                    items.map((it, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{it.ItemName || it.ItemId}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.UOMName || it.UOMCode || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{Number(it.Quantity).toFixed(2)}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.Remarks || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {items.length > 0 && (
                  <tfoot className="bg-muted/20 border-t border-border">
                    <tr>
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</td>
                      <td className="hidden sm:table-cell" />
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {items.reduce((s, it) => s + Number(it.Quantity), 0).toFixed(2)}
                      </td>
                      <td className="hidden sm:table-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Document chain — tagged PO doc ref is enough here, the full
              Linked Purchase Orders table was redundant with this ── */}
          <DocumentChainPanel docType="mr" id={viewingRecord.MRId} />

        </div>
      </div>
      </div>,
      document.body,
    );
  };

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], MR_TEMPLATE_COLUMNS, "material-request-template");
  };
  const handleImportClick = () => { importFileInputRef.current?.click(); };
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) { toast.error("CSV is empty"); return; }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  // ── Page render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Material Request"]} />
      <MaterialShell
        title="Material Requests"
        subtitle="Request materials for projects"
        icon={Send}
        action={
          viewMode === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={(listData?.data || []) as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Material Requests"
                filename="material-requests"
                disabled={loadingList || !listData?.data?.length || !rights.canExport}
              />
              <input ref={importFileInputRef} type="file" accept=".csv" onChange={handleImportFileChange} className="hidden" />
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
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <Button
                  onClick={() => setViewMode("form")}
                  className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all"
                >
                  <Plus size={13} /> New Request
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && ListView()}
        {viewMode === "form" && FormView()}
        {ViewModal()}
      </MaterialShell>
    </>
  );
}
