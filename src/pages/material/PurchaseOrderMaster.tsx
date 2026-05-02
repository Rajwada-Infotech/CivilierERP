import React, { useEffect, useState, useMemo, useCallback } from "react";
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
  type GSTConfig,
  type GSTType,
  type PurchaseOrder,
} from "@/api/purchaseOrdersApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getHsn } from "@/api/hsnApi";
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
  Receipt,
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
} from "lucide-react";

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
  amount: number;
}

interface POForm {
  poNumber: string;
  poDate: string;
  expectedDate: string;
  supplierId: string;
  companyId: string;
  projectId: string;
  status: string;
  hsnCode: string;
  gstType: GSTType;
  gstRate: number;
  paymentTerms: string;
  remarks: string;
  docTypeId: number | null;
  docNo: string;
}

interface HsnRecord {
  code: string;
  shortDesc: string;
  description: string;
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
  status: boolean;
}

interface DropdownOption {
  id: number | string;
  name: string;
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
  amount: 0,
});

const EMPTY_FORM = (): POForm => ({
  poNumber: "",
  poDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  supplierId: "",
  companyId: "",
  projectId: "",
  status: "Draft",
  hsnCode: "",
  gstType: "cgst_sgst",
  gstRate: 0,
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
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 10;

  // ── Doc number state ──────────────────────────────────────────────────────
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

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState<POForm>(EMPTY_FORM());
  const [lineItems, setLineItems] = useState<POLineItem[]>([EMPTY_LINE()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
  const { data: hsnRaw = [] } = useQuery({
    queryKey: ["hsn-master"],
    queryFn: getHsn,
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
        .map((u) => ({ id: Number(u.Id), name: u.UOMName ?? "" }))
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
      })),
    [itemsRaw],
  );

  const hsnRecords = useMemo(
    () =>
      ensureArray<any>(hsnRaw).map((h) => ({
        code: String(h.HCode ?? h.code ?? ""),
        shortDesc: String(h.HShortDesc ?? h.shortDesc ?? ""),
        description: String(h.HDescription ?? h.description ?? ""),
        igstRate: Number(h.HIGST ?? h.igstRate ?? 0),
        cgstRate: Number(h.HCGST ?? h.cgstRate ?? 0),
        sgstRate: Number(h.HSGST ?? h.sgstRate ?? 0),
        status: Boolean(h.HStatus ?? h.status ?? true),
      })),
    [hsnRaw],
  );

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
  const { subtotal, gstAmount, grandTotal } = useMemo(() => {
    const sub = lineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
    const gst = form.gstRate > 0 ? (sub * form.gstRate) / 100 : 0;
    return { subtotal: sub, gstAmount: gst, grandTotal: sub + gst };
  }, [lineItems, form.gstRate]);

  // ── Doc number helpers ────────────────────────────────────────────────────
  const applyPoDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
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

  // ── Line item helpers ─────────────────────────────────────────────────────
  const updateLine = (idx: number, patch: Partial<POLineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const updated = { ...li, ...patch };
        updated.amount = updated.quantity * updated.rate;
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
    const uomMatch = uoms.find((u) => u.name === item.uom);
    updateLine(idx, {
      itemId,
      itemName: item.name,
      itemDescription: item.description,
      uomId: uomMatch?.id ?? null,
      unit: uomMatch?.name ?? item.uom,
    });
  };

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setField = <K extends keyof POForm>(key: K, value: POForm[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

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
        tax: 0,
        amount: li.amount,
      })),
      PaymentTerms: form.paymentTerms || null,
      Status: form.status || "Draft",
      Remarks: form.remarks || null,
      DocTypeId: form.docTypeId ?? poDocTypeId,
      DocNo: form.poNumber || form.docNo || poDocNo || null,
      finYear: selectedFinYear || null,
      GST: {
        applicable: form.gstRate > 0,
        type: form.gstType as GSTType,
        rate: form.gstRate,
      } as GSTConfig,
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
        await addPurchaseOrder(toPayload());
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        toast.success("Purchase Order created successfully!");
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
    if (!confirm("Delete this purchase order?")) return;
    try {
      await deletePurchaseOrder(id);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase Order deleted.");
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setErrors({});
  };

  const goToCreate = () => {
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
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
      status: raw.Status ?? "Draft",
      hsnCode: raw.GST?.hsnCode ?? "",
      gstType: (raw.GST?.type as GSTType) ?? "cgst_sgst",
      gstRate: raw.GST?.rate ?? 0,
      paymentTerms: raw.PaymentTerms ?? "",
      remarks: raw.Remarks ?? "",
      docTypeId: raw.DocTypeId ?? null,
      docNo: raw.DocNo ?? "",
    });

    // Restore line items from POItems or legacy fields
    const poItems = raw.POItems ?? [];
    if (poItems.length > 0) {
      setLineItems(
        poItems.map((pi: any) => ({
          id: uid(),
          itemId: "",
          itemName: pi.itemDescription ?? "",
          itemDescription: "",
          quantity: Number(pi.quantity ?? 0),
          uomId: null,
          unit: pi.unit ?? "",
          rate: Number(pi.rate ?? 0),
          amount: Number(pi.amount ?? pi.quantity * pi.rate ?? 0),
        })),
      );
    } else {
      setLineItems([
        {
          id: uid(),
          itemId: "",
          itemName: raw.ItemDescription ?? "",
          itemDescription: "",
          quantity: Number(raw.Quantity ?? 0),
          uomId: null,
          unit: raw.Unit ?? "",
          rate: Number(raw.Rate ?? 0),
          amount: Number(raw.TotalAmount ?? 0),
        },
      ]);
    }
    setEditingId(item._id);
    setViewMode("edit");
  };

  const goToView = (item: POListItem) => {
    goToEdit(item);
    setViewMode("view");
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

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShoppingCart size={22} className="text-primary" />
              Purchase Orders
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalRecords} orders total
            </p>
          </div>
          <button
            onClick={goToCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition"
          >
            <Plus size={16} />
            New Purchase Order
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by PO number, supplier, company…"
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    PO No
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Company
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Project / Site
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted/50 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filteredList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-muted-foreground"
                    >
                      <ShoppingCart
                        size={32}
                        className="mx-auto mb-2 opacity-30"
                      />
                      <p>No purchase orders found</p>
                    </td>
                  </tr>
                ) : (
                  filteredList.map((item) => (
                    <tr
                      key={item._id}
                      className="hover:bg-muted/20 transition-colors group"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                        {item.poNumber || item.docNo || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {fmtDate(item.poDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {item.supplierName || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {item.companyName || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                        {item.projectName || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {fmt(item.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusChip status={item.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => goToView(item)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title="View"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => goToEdit(item)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title="Edit"
                          >
                            <PenSquare size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item._id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
        </div>
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
            {viewMode !== "create" && form.status && (
              <div className="mt-1">
                <StatusChip status={form.status} />
              </div>
            )}
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
          <button
            onClick={() => setViewMode("edit")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition shadow-sm"
          >
            <PenSquare size={14} />
            Edit
          </button>
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

            {/* Status */}
            <div>
              <FieldLabel>Status</FieldLabel>
              {isReadOnly ? (
                <div className="mt-1">
                  <StatusChip status={form.status} />
                </div>
              ) : (
                <select
                  value={form.status}
                  onChange={(e) => setField("status", e.target.value)}
                  className={selectCls}
                >
                  {[
                    "Draft",
                    "Issued",
                    "Partially Received",
                    "Received",
                    "Closed",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* ── GST Details Card ──────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
            <Receipt size={11} className="text-primary" />
            GST Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* HSN Code */}
            <div>
              <FieldLabel>HSN Code</FieldLabel>
              {isReadOnly ? (
                <div className={`${inputCls} bg-muted/30`}>
                  {form.hsnCode || "—"}
                </div>
              ) : (
                <select
                  value={form.hsnCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const hsn = hsnRecords.find((h) => h.code === code);
                    const rate = hsn
                      ? hsn.igstRate || hsn.cgstRate + hsn.sgstRate
                      : 0;
                    setForm((p) => ({ ...p, hsnCode: code, gstRate: rate }));
                  }}
                  className={selectCls}
                >
                  <option value="">— Select HSN Code —</option>
                  {hsnRecords
                    .filter((h) => h.status)
                    .map((h) => (
                      <option key={h.code} value={h.code}>
                        {h.code} — {h.shortDesc}
                      </option>
                    ))}
                </select>
              )}
              {form.hsnCode &&
                hsnRecords.find((h) => h.code === form.hsnCode) && (
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">
                    {
                      hsnRecords.find((h) => h.code === form.hsnCode)!
                        .description
                    }
                  </p>
                )}
            </div>

            {/* GST Type */}
            <div>
              <FieldLabel>GST Type</FieldLabel>
              {isReadOnly ? (
                <div className={`${inputCls} bg-muted/30`}>
                  {form.gstType === "cgst_sgst"
                    ? "CGST + SGST"
                    : form.gstType === "igst"
                      ? "IGST"
                      : "—"}
                </div>
              ) : (
                <select
                  value={form.gstType}
                  onChange={(e) =>
                    setField("gstType", e.target.value as GSTType)
                  }
                  className={selectCls}
                >
                  <option value="cgst_sgst">CGST + SGST</option>
                  <option value="igst">IGST</option>
                </select>
              )}
            </div>

            {/* GST Rate */}
            <div>
              <FieldLabel>GST Rate (%)</FieldLabel>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.gstRate}
                readOnly={!!form.hsnCode || isReadOnly}
                onChange={(e) =>
                  !form.hsnCode &&
                  setField("gstRate", parseFloat(e.target.value) || 0)
                }
                className={`${inputCls} ${form.hsnCode || isReadOnly ? "bg-muted/50 text-muted-foreground cursor-not-allowed" : ""}`}
              />
              {form.gstRate > 0 && form.gstType === "cgst_sgst" && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  CGST {(form.gstRate / 2).toFixed(2)}% + SGST{" "}
                  {(form.gstRate / 2).toFixed(2)}%
                </p>
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

                    {/* Amount (computed) */}
                    <td className="px-3 py-2 text-right">
                      <span className="text-sm font-semibold font-mono text-foreground">
                        ₹
                        {(li.quantity * li.rate).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
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
          <div className="border-t border-border bg-muted/10 px-5 py-4">
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{fmt(subtotal)}</span>
                </div>
                {form.gstRate > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      GST ({form.gstRate}%
                      {form.gstType === "cgst_sgst"
                        ? ` — CGST ${form.gstRate / 2}% + SGST ${form.gstRate / 2}%`
                        : " — IGST"}
                      )
                    </span>
                    <span className="font-mono">{fmt(gstAmount)}</span>
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

        {/* ── Terms & Remarks Card ──────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
            <ClipboardList size={11} className="text-primary" />
            Terms &amp; Remarks
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Payment Terms</FieldLabel>
              <textarea
                value={form.paymentTerms}
                onChange={(e) => setField("paymentTerms", e.target.value)}
                readOnly={isReadOnly}
                rows={3}
                placeholder="e.g. Net 30 days, 50% advance…"
                className={`${inputCls} resize-none ${isReadOnly ? "bg-muted/30 cursor-not-allowed" : ""}`}
              />
            </div>
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
        </div>

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
      </div>
    </>
  );
};

export default PurchaseOrderMaster;
