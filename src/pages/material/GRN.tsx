import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Truck,
  Package,
  Trash2,
  Edit3,
  Save,
  X,
  Search,
  Calendar,
  FileText,
  Eye,
  Receipt,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import * as grnApi from "@/api/grnApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  GRNFormDataPayload,
  GRNItemLine,
  Supplier,
  PurchaseOrder,
  UOM,
} from "@/api/grnApi";

const createEmptyItem = (): GRNItemLine => ({
  itemId: "",
  itemName: "",
  orderedQty: 0,
  receivedQty: 0,
  remainingQty: 0,
  uom: "",
  rate: 0,
  quantity: 0,
  totalAmount: 0,
});

const parseJsonArray = <T,>(val: unknown): T[] => {
  if (Array.isArray(val)) return val as T[];
  if (typeof val !== "string" || !val.trim()) return [];
  try {
    let parsed = JSON.parse(val);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

// ─── GRN Chain Badge ──────────────────────────────────────────────────────────
function GRNChainBadge({ grnId }: { grnId: number }) {
  const [chain, setChain] = useState<{
    expenseCount: number;
    isPaid: boolean;
  } | null>(null);

  useEffect(() => {
    if (!grnId) return;
    fetchWithAuth(
      `/api/expense-booking/chain-status?sourceType=GRN&sourceId=${grnId}`,
    )
      .then((r) => r.json())
      .then(setChain)
      .catch(() => {});
  }, [grnId]);

  if (!chain || chain.expenseCount === 0) return null;

  return (
    <>
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
        ✓ Exp. Booked
      </span>
      {chain.isPaid && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
          ✓ Paid
        </span>
      )}
    </>
  );
}

// ─── Linked Expense Bookings (shown inside GRN view modal) ───────────────────
interface LinkedBooking {
  Eid: number;
  EDocNo: string | null;
  EStatus: string;
  ENetAmount: number;
  ERemarks: string | null;
  EDocDate: string | null;
  EName: string | null;
}

function LinkedExpenseBookings({ grnId }: { grnId: number }) {
  const [bookings, setBookings] = useState<LinkedBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(
      `/api/expense-booking/by-source?sourceType=GRN&sourceId=${grnId}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setBookings(Array.isArray(data) ? data : []))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [grnId]);

  const statusColor = (s: string) => {
    switch (s) {
      case "Approved":
        return "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400";
      case "Pending":
        return "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400";
      case "Rejected":
        return "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400";
      case "Booked":
        return "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400";
      case "Draft":
        return "bg-muted border-border text-muted-foreground";
      default:
        return "bg-muted border-border text-muted-foreground";
    }
  };

  const StatusIcon = (s: string) => {
    if (s === "Approved" || s === "Booked") return <CheckCircle2 size={10} />;
    if (s === "Pending") return <Clock size={10} />;
    if (s === "Rejected") return <AlertCircle size={10} />;
    return <Receipt size={10} />;
  };

  const isAutoSplit = (b: LinkedBooking) =>
    (b.ERemarks ?? "").startsWith("Auto-created for remaining items from GRN");

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        Loading linked bookings…
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No expense bookings linked to this GRN yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div
          key={b.Eid}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
            isAutoSplit(b)
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border bg-muted/20"
          }`}
        >
          <div
            className={`shrink-0 p-1.5 rounded-lg ${isAutoSplit(b) ? "bg-amber-500/10" : "bg-primary/10"}`}
          >
            <Receipt
              size={13}
              className={
                isAutoSplit(b)
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-primary"
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-foreground">
                {b.EDocNo ?? `Draft #${b.Eid}`}
              </span>
              {isAutoSplit(b) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                  Pending split
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${statusColor(b.EStatus)}`}
              >
                {StatusIcon(b.EStatus)}
                {b.EStatus}
              </span>
            </div>
            {b.EName && !isAutoSplit(b) && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {b.EName}
              </p>
            )}
            {isAutoSplit(b) && (
              <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                Remaining items — open Expense Booking to review &amp; submit
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {b.ENetAmount > 0 && (
              <p className="font-mono text-xs font-semibold text-foreground">
                ₹
                {Number(b.ENetAmount).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            )}
            {b.EDocDate && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(b.EDocDate).toLocaleDateString("en-IN")}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

let queryClient: ReturnType<typeof useQueryClient>;
let onEdit: (grn: any) => void;
let onView: (grn: any) => void;
let deleteMutation: { mutate: (id: string) => void };

const GRN_LIST_COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ row, getValue }) => {
      const docNo = (getValue() as string) || row.original.GRNNo;
      const grnNo = row.original.GRNNo as string;
      return (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">
            {docNo || "—"}
          </span>
          {grnNo && grnNo !== docNo && (
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {grnNo}
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "PONumber",
    header: "PO No",
    cell: ({ row }) => {
      const grn = row.original;
      const poType = grn.POType as string | undefined;
      const typeColor =
        poType === "Normal"
          ? "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800"
          : poType === "WO_PO"
            ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800"
            : "bg-muted text-muted-foreground border-border";
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs">{(grn.PONumber as string) || "—"}</span>
          {poType && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${typeColor}`}
            >
              {poType}
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "SupplierName",
    header: "Supplier",
    cell: ({ getValue }) => (
      <span className="text-xs hidden sm:inline">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "GRNDate",
    header: "Date",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <span className="text-xs text-muted-foreground">
          {v ? new Date(v).toLocaleDateString("en-IN") : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "SourceMRDocNo",
    header: "Source MR",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? (
        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
          {v}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );
    },
  },
  {
    accessorKey: "TotalAmount",
    header: "Total Amount",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return (
        <span className="text-xs font-semibold">
          {v != null
            ? `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—"}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    cell: ({ row }) => {
      const grn = row.original;
      return (
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={() => onView(grn)}
            className="text-muted-foreground hover:bg-muted p-1.5 rounded transition-colors"
            title="View GRN"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={() => onEdit(grn)}
            className="text-primary hover:bg-primary/10 p-1.5 rounded transition-colors"
            title="Edit GRN"
          >
            <Edit3 size={15} />
          </button>
          <button
            onClick={() => deleteMutation.mutate(String(grn.GRNID))}
            className="text-destructive hover:bg-destructive/10 p-1.5 rounded transition-colors"
            title="Delete GRN"
          >
            <Trash2 size={15} />
          </button>
        </div>
      );
    },
  },
];

export default function GRN() {
  queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingGrn, setViewingGrn] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadingPO, setLoadingPO] = useState(false);
  const [selectedFinYear, setSelectedFinYear] = useState<string>("");
  const limit = 10;

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;

  const buildEmptyForm = () => ({
    grnNo: "",
    grnDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    remarks: "",
    status: "Draft" as const,
    items: [createEmptyItem()] as GRNItemLine[],
    docTypeId: null as number | null,
    docNo: "",
    parentDocNo: "",
    rootExBDocNo: "",
    finYear: activeFinYear || "",
  });

  const [formData, setFormData] = useState(buildEmptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const didAutoSelectFinYear = React.useRef(false);
  useEffect(() => {
    if (activeFinYear && !didAutoSelectFinYear.current) {
      didAutoSelectFinYear.current = true;
      setSelectedFinYear(activeFinYear);
      setFormData((prev) => ({ ...prev, finYear: activeFinYear }));
    }
  }, [activeFinYear]);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: grnsPage, isLoading: loadingGrns } = useQuery({
    queryKey: ["grns", page, limit],
    queryFn: () => grnApi.getGRNs({ page, limit }),
  });
  const grns = grnsPage?.data ?? [];
  const totalPages = Math.max(grnsPage?.totalPages ?? 1, 1);
  const totalRecords = grnsPage?.total ?? grns.length;

  const { data: posData = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: grnApi.getPurchaseOrders,
  });

  const { data: uomsData = [] } = useQuery({
    queryKey: ["uomMaster"],
    queryFn: grnApi.getUoms,
  });

  const { data: grnNumberPreview, isFetching: loadingPreview } = useQuery({
    queryKey: ["grns", "next-number", formData.parentDocNo],
    queryFn: () => grnApi.previewNextGRNNumber(formData.parentDocNo || null),
    enabled: !editingId,
    staleTime: 15_000,
  });

  // Derive the calendar year embedded in PO DocNos from the fin-year string.
  // e.g. "2025-2026" → "2026"  (the second/end year, which appears in PO-2026-xxxxx)
  // Falls back to the raw string so "All Years" ("") still passes through.
  const finYearDocFragment = selectedFinYear
    ? (selectedFinYear.split("-").pop() ?? selectedFinYear)
    : "";

  const pos = posData
    .filter((po: PurchaseOrder) => {
      // When editing, always include the GRN's linked PO regardless of fin-year filter
      if (
        editingId &&
        formData.poId &&
        String(po.PurchaseOrderID) === formData.poId
      )
        return true;
      if (!finYearDocFragment) return true;
      const docNo = po.PurchaseOrderNo || "";
      return docNo.includes(finYearDocFragment);
    })
    .map((po: PurchaseOrder) => {
      const typeTag =
        po.POType === "Normal"
          ? " [Normal]"
          : po.POType === "WO_PO"
            ? " [WO_PO]"
            : "";
      return {
        value: String(po.PurchaseOrderID),
        label: `${po.PurchaseOrderNo}${typeTag}`,
      };
    });

  const filteredGrns = grns.filter((grn: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      grn.DocNo?.toLowerCase().includes(q) ||
      grn.GRNNo?.toLowerCase().includes(q) ||
      grn.PONumber?.toLowerCase().includes(q) ||
      grn.SupplierName?.toLowerCase().includes(q)
    );
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: grnApi.addGRN,
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      const generated = res?.grnNo || "";
      setFormData(buildEmptyForm());
      setEditingId(null);
      setErrors({});
      if (generated) {
        setFormData((p) => ({ ...p, grnNo: generated }));
      }
      toast.success(`GRN ${generated} created successfully`);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create GRN"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: GRNFormDataPayload) =>
      grnApi.updateGRN(editingId!, payload),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      setFormData(buildEmptyForm());
      setEditingId(null);
      setErrors({});
      toast.success("GRN updated successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update GRN"),
  });

  deleteMutation = useMutation({
    mutationFn: grnApi.deleteGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      toast.success("GRN deleted successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete GRN"),
  });

  // ── PO Selection — fetch full PO with line items ───────────────────────────
  const handlePOSelect = async (poId: string) => {
    if (!poId) {
      setFormData((prev) => ({
        ...prev,
        poId: "",
        poNumber: "",
        supplierId: "",
        supplierName: "",
        items: [createEmptyItem()],
        grnNo: "",
        docNo: "",
        docTypeId: null,
        parentDocNo: "",
        rootExBDocNo: "",
      }));
      return;
    }

    setLoadingPO(true);
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const po = await res.json();

      const lineItems: GRNItemLine[] = (po.LineItems ?? []).map((li: any) => {
        const rate = Number(li.Rate ?? 0);
        const quantity = Number(li.Quantity ?? 0);
        return {
          itemId: String(li.ItemId ?? ""),
          itemName: li.ItemName ?? li.Description ?? "",
          orderedQty: quantity,
          receivedQty: 0,
          remainingQty: quantity,
          uom: li.UomName ?? li.UomId ?? "",
          rate,
          quantity: 0,
          totalAmount: 0,
        };
      });

      setFormData((prev) => ({
        ...prev,
        poId,
        poNumber: po.PurchaseOrderNo ?? "",
        supplierId: String(po.SupplierID ?? ""),
        supplierName: po.SupplierName ?? "",
        items: lineItems.length ? lineItems : [createEmptyItem()],
        docTypeId: null,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "",
        rootExBDocNo: po.RootExBDocNo || "",
        finYear: prev.finYear || activeFinYear || "",
        grnNo: "",
        docNo: "",
      }));
    } catch (e: any) {
      toast.error(e.message || "Failed to load PO details");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────────
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.poId) newErrors.poId = "Purchase Order is required";
    if (!formData.supplierId)
      newErrors.supplierId = "Supplier could not be determined";
    if (formData.items.every((i) => i.receivedQty <= 0)) {
      newErrors.items = "Enter received quantity for at least one item";
    }
    const missingRate = formData.items.some(
      (i) => i.receivedQty > 0 && (!i.rate || i.rate <= 0),
    );
    if (missingRate) {
      newErrors.items =
        newErrors.items ||
        "Enter a rate (₹) for each item with a received quantity";
    }
    const missingQty = formData.items.some(
      (i) => i.receivedQty > 0 && (!i.quantity || i.quantity <= 0),
    );
    if (missingQty) {
      newErrors.items =
        newErrors.items ||
        "Enter a billing quantity for each item with a received quantity";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix the errors before saving");
      return;
    }

    const payload: GRNFormDataPayload = {
      grnNo: formData.grnNo || "",
      grnDate: formData.grnDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId) || 0,
      grnItems: formData.items,
      status: "Draft",
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
      docNo: "",
      finYear: selectedFinYear || formData.finYear || null,
      parentDocNo: formData.parentDocNo || null,
      rootExBDocNo: formData.rootExBDocNo || null,
    };

    if (editingId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  // ── Item field update handlers ───────────────────────────────────────────────
  const updateItemField = (
    index: number,
    field: "receivedQty" | "rate" | "quantity",
    value: number,
  ) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const current = { ...nextItems[index], [field]: value };
      if (field === "receivedQty") {
        current.remainingQty = current.orderedQty - value;
        if (nextItems[index].quantity === nextItems[index].receivedQty) {
          current.quantity = value;
        }
      }
      current.totalAmount =
        Number(current.rate || 0) * Number(current.quantity || 0);
      nextItems[index] = current;
      return { ...prev, items: nextItems };
    });
  };

  const updateReceivedQty = (index: number, value: number) =>
    updateItemField(index, "receivedQty", value);

  // ── View ─────────────────────────────────────────────────────────────────────
  onView = async (grn: any) => {
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`/api/grns/${grn.GRNID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch GRN details");
      setViewingGrn(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setViewingGrn(grn);
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────────
  onEdit = async (grn: any) => {
    // Always fetch the full GRN record — list rows strip GRNItems for performance
    let fullGrn = grn;
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`/api/grns/${grn.GRNID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fullGrn = await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      // fall back to list-row data
    }

    const parsedItems = parseJsonArray<GRNItemLine>(fullGrn.GRNItems).map(
      (item) => ({
        ...createEmptyItem(),
        ...item,
        orderedQty: Number(item.orderedQty || 0),
        receivedQty: Number(item.receivedQty || 0),
        remainingQty: Number(item.remainingQty || 0),
        rate: Number(item.rate || 0),
        quantity: Number(item.quantity || 0),
        totalAmount: Number(item.totalAmount || 0),
      }),
    );

    const grnFinYear = fullGrn.FinYear || activeFinYear || "";

    // Sync the fin-year filter so the PO dropdown includes the GRN's PO
    setSelectedFinYear(grnFinYear);

    setFormData({
      grnNo: fullGrn.GRNNo || "",
      grnDate: fullGrn.GRNDate ? String(fullGrn.GRNDate).slice(0, 10) : "",
      supplierId: String(fullGrn.SupplierID || ""),
      supplierName: fullGrn.SupplierName || "",
      poId: String(fullGrn.POID || ""),
      poNumber: fullGrn.PONumber || "",
      remarks: fullGrn.Remarks || "",
      status: (fullGrn.Status as any) || "Draft",
      items: parsedItems.length ? parsedItems : [createEmptyItem()],
      docTypeId: fullGrn.DocTypeId ?? null,
      docNo: fullGrn.DocNo || "",
      parentDocNo: fullGrn.ParentDocNo || "",
      rootExBDocNo: fullGrn.RootExBDocNo || "",
      finYear: grnFinYear,
    });

    setEditingId(String(fullGrn.GRNID));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setFormData(buildEmptyForm());
    setEditingId(null);
    setErrors({});
  };

  if (loadingGrns) {
    return <div className="text-muted-foreground mt-6">Loading GRNs...</div>;
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN"]} />
      <div className="relative space-y-8 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Goods Receipt Note
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Record and manage goods received against purchase orders.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Form Card */}
          <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/60">
              <h2 className="font-heading font-semibold flex items-center gap-2">
                {editingId ? <Edit3 size={18} /> : <Truck size={18} />}
                {editingId
                  ? "Edit Goods Receipt Note"
                  : "New Goods Receipt Note"}
              </h2>
              {editingId && (
                <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Editing Mode
                </span>
              )}
            </div>

            <div className="p-4 sm:p-6 space-y-8">
              {/* ── Row 1: Fin Year + Purchase Order ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Fin Year selector */}
                <div>
                  <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
                    Fin Year
                  </label>
                  <select
                    value={selectedFinYear}
                    onChange={(e) => {
                      setSelectedFinYear(e.target.value);
                      setFormData((prev) => ({
                        ...prev,
                        poId: "",
                        poNumber: "",
                        supplierId: "",
                        supplierName: "",
                        items: [createEmptyItem()],
                        grnNo: "",
                        docNo: "",
                        parentDocNo: "",
                        rootExBDocNo: "",
                        finYear: e.target.value,
                      }));
                    }}
                    className={inp}
                  >
                    <option value="">All Years</option>
                    {finYears.map((fy) => (
                      <option key={fy.id} value={fy.year}>
                        {fy.year}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Purchase Order — filtered by fin year */}
                <div className="md:col-span-2">
                  <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
                    Purchase Order <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={formData.poId}
                    onChange={(e) => handlePOSelect(e.target.value)}
                    disabled={!!editingId || loadingPO}
                    className={inp}
                  >
                    <option value="">Select Purchase Order...</option>
                    {pos.map((po) => (
                      <option key={po.value} value={po.value}>
                        {po.label}
                      </option>
                    ))}
                  </select>
                  {loadingPO && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <span className="animate-pulse">●</span> Loading PO
                      details…
                    </p>
                  )}
                  {formData.supplierName && !loadingPO && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Supplier:{" "}
                      <span className="text-foreground font-semibold">
                        {formData.supplierName}
                      </span>
                    </p>
                  )}
                  {errors.poId && (
                    <p className="text-destructive text-xs mt-1.5">
                      {errors.poId}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Row 2: GRN Date + GRN Number ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* GRN Date */}
                <div>
                  <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
                    GRN Date
                  </label>
                  <div className="relative">
                    <Calendar
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="date"
                      value={formData.grnDate}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, grnDate: e.target.value }))
                      }
                      className={`${inp} pl-10`}
                    />
                  </div>
                </div>

                {/* GRN Number — auto-generated preview */}
                <div>
                  <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
                    GRN Number
                  </label>
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/40 border border-dashed border-border h-[42px]">
                    <FileText
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                    {editingId && formData.grnNo ? (
                      <span className="font-mono text-sm text-primary font-semibold tracking-wide">
                        {formData.grnNo}
                      </span>
                    ) : grnNumberPreview?.nextDocNo ? (
                      <span className="font-mono text-sm text-primary font-semibold tracking-wide">
                        {grnNumberPreview.nextDocNo}
                      </span>
                    ) : loadingPreview ? (
                      <span className="text-sm text-muted-foreground/70 animate-pulse">
                        Generating…
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground/50 italic">
                        Auto-generated on save
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Items Table ── */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Package size={16} className="text-muted-foreground" />
                  <h3 className="font-heading font-semibold text-sm">
                    Received Items
                  </h3>
                  {!formData.poId && (
                    <span className="text-xs text-muted-foreground/60 ml-1">
                      — autofilled when a Purchase Order is selected
                    </span>
                  )}
                </div>

                {errors.items && (
                  <p className="text-destructive text-sm mb-3">
                    {errors.items}
                  </p>
                )}

                {/* ── Mobile card layout (< md) ── */}
                <div className="md:hidden space-y-3">
                  {!formData.poId ? (
                    <div className="border border-dashed border-border rounded-xl px-4 py-10 text-center text-muted-foreground/50 text-sm italic">
                      Select a Purchase Order above — items will be autofilled
                      from the PO
                    </div>
                  ) : (
                    formData.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="border border-border rounded-xl p-4 space-y-3 bg-muted/20"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm text-foreground truncate">
                            {item.itemName || "—"}
                          </span>
                          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {item.uom || "—"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div>
                            <p className="uppercase tracking-widest text-[10px] mb-0.5">
                              Ordered
                            </p>
                            <p className="font-semibold text-foreground">
                              {item.orderedQty}
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-widest text-[10px] mb-0.5">
                              Remaining
                            </p>
                            <p
                              className={`font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                            >
                              {item.remainingQty}
                            </p>
                          </div>
                          {item.totalAmount > 0 && (
                            <div className="text-right">
                              <p className="uppercase tracking-widest text-[10px] mb-0.5">
                                Total
                              </p>
                              <p className="font-bold text-primary">
                                ₹
                                {item.totalAmount.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                              Received{" "}
                              <span className="text-destructive">*</span>
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={item.orderedQty || undefined}
                              value={item.receivedQty}
                              onChange={(e) =>
                                updateReceivedQty(idx, Number(e.target.value))
                              }
                              className={`${inp} text-right`}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                              Rate (₹){" "}
                              <span className="text-destructive">*</span>
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.rate}
                              onChange={(e) =>
                                updateItemField(
                                  idx,
                                  "rate",
                                  Number(e.target.value),
                                )
                              }
                              className={`${inp} text-right`}
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                              Qty (Bill){" "}
                              <span className="text-destructive">*</span>
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItemField(
                                  idx,
                                  "quantity",
                                  Number(e.target.value),
                                )
                              }
                              className={`${inp} text-right`}
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {formData.poId &&
                    formData.items.some((i) => i.totalAmount > 0) && (
                      <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-muted/40 border border-border">
                        <span className="text-xs font-heading uppercase tracking-widest text-muted-foreground">
                          Grand Total
                        </span>
                        <span className="font-bold text-primary">
                          ₹
                          {formData.items
                            .reduce((sum, i) => sum + (i.totalAmount || 0), 0)
                            .toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                        </span>
                      </div>
                    )}
                </div>

                {/* ── Desktop table layout (≥ md) ── */}
                <div className="hidden md:block border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Item
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Ordered
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Received
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Remaining
                        </th>
                        <th className="px-2 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          UOM
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Rate (₹) <span className="text-destructive">*</span>
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Qty (Billing){" "}
                          <span className="text-destructive">*</span>
                        </th>
                        <th className="px-2 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          Total (₹)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {!formData.poId ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-10 text-center text-muted-foreground/50 text-sm italic"
                          >
                            Select a Purchase Order above — items will be
                            autofilled from the PO
                          </td>
                        </tr>
                      ) : (
                        formData.items.map((item, idx) => {
                          const fromPO = !!formData.poId;
                          return (
                            <tr key={idx}>
                              <td className="px-3 py-2.5">
                                {fromPO ? (
                                  <span className="text-foreground font-medium">
                                    {item.itemName || "—"}
                                  </span>
                                ) : (
                                  <input
                                    value={item.itemName}
                                    onChange={(e) => {
                                      const nextItems = [...formData.items];
                                      nextItems[idx] = {
                                        ...nextItems[idx],
                                        itemName: e.target.value,
                                      };
                                      setFormData((p) => ({
                                        ...p,
                                        items: nextItems,
                                      }));
                                    }}
                                    placeholder="Item name"
                                    className={inp}
                                  />
                                )}
                              </td>
                              <td className="px-2 py-2 text-right font-medium text-muted-foreground">
                                {item.orderedQty}
                              </td>
                              <td className="px-1.5 py-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={item.orderedQty || undefined}
                                  value={item.receivedQty}
                                  onChange={(e) =>
                                    updateReceivedQty(
                                      idx,
                                      Number(e.target.value),
                                    )
                                  }
                                  className={`${inp} text-right`}
                                />
                              </td>
                              <td
                                className={`px-2 py-2 text-right font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                              >
                                {item.remainingQty}
                              </td>
                              <td className="px-1.5 py-1.5">
                                {fromPO ? (
                                  <span className="text-foreground">
                                    {item.uom || "—"}
                                  </span>
                                ) : (
                                  <select
                                    value={item.uom}
                                    onChange={(e) => {
                                      const nextItems = [...formData.items];
                                      nextItems[idx] = {
                                        ...nextItems[idx],
                                        uom: e.target.value,
                                      };
                                      setFormData((p) => ({
                                        ...p,
                                        items: nextItems,
                                      }));
                                    }}
                                    className={inp}
                                  >
                                    <option value="">Select UOM</option>
                                    {uomsData
                                      .filter((u: UOM) => u.IsActive !== false)
                                      .map((u: UOM) => (
                                        <option
                                          key={u.UOMCode}
                                          value={u.UOMCode}
                                        >
                                          {u.UOMName}{" "}
                                          {u.Symbol ? `(${u.Symbol})` : ""}
                                        </option>
                                      ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-1.5 py-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.rate}
                                  onChange={(e) =>
                                    updateItemField(
                                      idx,
                                      "rate",
                                      Number(e.target.value),
                                    )
                                  }
                                  className={`${inp} text-right`}
                                  placeholder="0.00"
                                />
                              </td>
                              <td className="px-1.5 py-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateItemField(
                                      idx,
                                      "quantity",
                                      Number(e.target.value),
                                    )
                                  }
                                  className={`${inp} text-right`}
                                  placeholder="0"
                                />
                              </td>
                              <td className="px-2 py-2 text-right font-semibold text-primary">
                                {item.totalAmount > 0
                                  ? `₹${item.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {formData.poId &&
                      formData.items.some((i) => i.totalAmount > 0) && (
                        <tfoot>
                          <tr className="bg-muted/40 border-t-2 border-border">
                            <td
                              colSpan={7}
                              className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground"
                            >
                              Grand Total
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-primary">
                              ₹
                              {formData.items
                                .reduce(
                                  (sum, i) => sum + (i.totalAmount || 0),
                                  0,
                                )
                                .toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                  </table>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
                  Remarks
                </label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, remarks: e.target.value }))
                  }
                  rows={3}
                  className={`${inp} resize-y`}
                  placeholder="Additional notes, remarks, etc."
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 border-t border-border">
                <button
                  onClick={onSubmit}
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                  className="w-full sm:w-auto gradient-accent inline-flex items-center justify-center gap-2 px-8 py-2.5 rounded-xl text-white text-sm font-semibold shadow-sm transition disabled:opacity-60"
                >
                  <Save size={15} />
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving…"
                    : editingId
                      ? "Update GRN"
                      : "Save GRN"}
                </button>
                <button
                  onClick={resetForm}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl border border-border hover:bg-muted text-sm transition-colors"
                >
                  <X size={15} /> Cancel
                </button>
              </div>
            </div>
          </div>

          {/* GRN List */}
          <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
            <div className="flex flex-wrap gap-3 items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-card/60">
              <h3 className="font-heading font-semibold">GRN History</h3>
              <div className="relative w-full sm:w-72">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="Search GRN, PO or Supplier..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-full py-2 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <DataTable
                data={filteredGrns}
                columns={GRN_LIST_COLUMNS}
                searchable={false}
                paginated={true}
                defaultPageSize={20}
                emptyMessage="No GRNs found."
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 sm:px-6 py-3 text-sm">
              <span className="text-muted-foreground text-xs">
                Page {page} of {totalPages} ({totalRecords} records)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* View GRN Modal */}
        {viewingGrn &&
          (() => {
            const items = parseJsonArray<GRNItemLine>(viewingGrn.GRNItems);
            return (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
                <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                      <h2 className="font-heading font-bold text-lg">
                        {viewingGrn.GRNNo
                          ? viewingGrn.GRNNo.startsWith("GRN-")
                            ? viewingGrn.GRNNo
                            : `GRN-${viewingGrn.GRNNo}`
                          : "—"}
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Goods Receipt Note
                      </p>
                    </div>
                    <button
                      onClick={() => setViewingGrn(null)}
                      className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="p-4 sm:p-6 space-y-5">
                    {/* Meta row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                          Doc No
                        </p>
                        <p className="font-mono font-semibold">
                          {viewingGrn.DocNo || viewingGrn.GRNNo || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                          Purchase Order
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">
                            {viewingGrn.PONumber || "—"}
                          </p>
                          {viewingGrn.POType && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                viewingGrn.POType === "Normal"
                                  ? "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                                  : viewingGrn.POType === "WO_PO"
                                    ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                                    : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {viewingGrn.POType}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                          Supplier
                        </p>
                        <p className="font-medium">
                          {viewingGrn.SupplierName || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                          Date
                        </p>
                        <p className="font-medium">
                          {viewingGrn.GRNDate
                            ? new Date(viewingGrn.GRNDate).toLocaleDateString(
                                "en-IN",
                              )
                            : "—"}
                        </p>
                      </div>
                      {viewingGrn.SourceMRDocNo && (
                        <div>
                          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                            Source MR
                          </p>
                          <p className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {viewingGrn.SourceMRDocNo}
                          </p>
                        </div>
                      )}
                      {viewingGrn.SourceWODocNo && (
                        <div>
                          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                            Source Work Order
                          </p>
                          <p className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">
                            {viewingGrn.SourceWODocNo}
                          </p>
                        </div>
                      )}
                      {viewingGrn.SourceWDDocNo && (
                        <div>
                          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                            Source Work Done
                          </p>
                          <p className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">
                            {viewingGrn.SourceWDDocNo}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Items table */}
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                        Received Items
                      </p>
                      {/* Mobile cards */}
                      <div className="md:hidden space-y-3">
                        {items.length ? (
                          items.map((item, i) => (
                            <div
                              key={i}
                              className="border border-border rounded-xl p-4 space-y-2 bg-muted/20"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm text-foreground">
                                  {item.itemName || "—"}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {item.uom || "—"}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Ordered
                                  </p>
                                  <p className="font-semibold">
                                    {item.orderedQty}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Received
                                  </p>
                                  <p className="font-semibold">
                                    {item.receivedQty}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Remaining
                                  </p>
                                  <p
                                    className={`font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                                  >
                                    {item.remainingQty}
                                  </p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-border">
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Rate
                                  </p>
                                  <p className="font-medium">
                                    {item.rate
                                      ? `₹${Number(item.rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Qty (Bill)
                                  </p>
                                  <p className="font-medium">
                                    {item.quantity ?? "—"}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Total
                                  </p>
                                  <p className="font-bold text-primary">
                                    {item.totalAmount
                                      ? `₹${Number(item.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "—"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-muted-foreground text-sm py-6">
                            No items
                          </p>
                        )}
                        {items.some((i) => i.totalAmount > 0) && (
                          <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-muted/40 border border-border">
                            <span className="text-xs font-heading uppercase tracking-widest text-muted-foreground">
                              Grand Total
                            </span>
                            <span className="font-bold text-primary">
                              ₹
                              {items
                                .reduce(
                                  (sum, i) =>
                                    sum + (Number(i.totalAmount) || 0),
                                  0,
                                )
                                .toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Desktop table */}
                      <div className="hidden md:block border border-border rounded-xl overflow-x-auto">
                        <table className="w-full text-sm min-w-[700px]">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="px-4 py-2.5 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Item
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Ordered
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Received
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Remaining
                              </th>
                              <th className="px-4 py-2.5 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                UOM
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Rate (₹)
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Qty
                              </th>
                              <th className="px-4 py-2.5 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Total (₹)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {items.length ? (
                              items.map((item, i) => (
                                <tr key={i}>
                                  <td className="px-4 py-3 font-medium">
                                    {item.itemName || "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-muted-foreground">
                                    {item.orderedQty}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold">
                                    {item.receivedQty}
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                                  >
                                    {item.remainingQty}
                                  </td>
                                  <td className="px-4 py-3 text-muted-foreground">
                                    {item.uom || "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-muted-foreground">
                                    {item.rate
                                      ? `₹${Number(item.rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-muted-foreground">
                                    {item.quantity ?? "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-primary">
                                    {item.totalAmount
                                      ? `₹${Number(item.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "—"}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={8}
                                  className="px-4 py-4 text-center text-muted-foreground"
                                >
                                  No items
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {items.some((i) => i.totalAmount > 0) && (
                            <tfoot>
                              <tr className="bg-muted/40 border-t-2 border-border">
                                <td
                                  colSpan={7}
                                  className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground"
                                >
                                  Grand Total
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-primary">
                                  ₹
                                  {items
                                    .reduce(
                                      (sum, i) =>
                                        sum + (Number(i.totalAmount) || 0),
                                      0,
                                    )
                                    .toLocaleString("en-IN", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>

                    {/* GST Breakdown */}
                    {(() => {
                      const gst = viewingGrn.ParentGST;
                      if (!gst) return null;

                      // Normalise to array of { label, rate, amount } rows
                      const subtotal = items.reduce(
                        (sum, i) => sum + (Number(i.totalAmount) || 0),
                        0,
                      );

                      type GSTRow = {
                        label: string;
                        rate: number;
                        amount: number;
                      };
                      let rows: GSTRow[] = [];

                      if (Array.isArray(gst)) {
                        // Array form: [{ name, rate }, ...]
                        rows = gst
                          .filter((g: any) => Number(g.rate) > 0)
                          .map((g: any) => ({
                            label: g.name || g.label || `GST ${g.rate}%`,
                            rate: Number(g.rate),
                            amount: (subtotal * Number(g.rate)) / 100,
                          }));
                      } else if (typeof gst === "object") {
                        // Flat object: { cgst, sgst, igst } as rates
                        const push = (label: string, key: string) => {
                          const r = Number((gst as any)[key]);
                          if (r > 0)
                            rows.push({
                              label,
                              rate: r,
                              amount: (subtotal * r) / 100,
                            });
                        };
                        push("CGST", "cgst");
                        push("SGST", "sgst");
                        push("IGST", "igst");
                        // Fallback: single rate field
                        if (
                          rows.length === 0 &&
                          Number((gst as any).rate) > 0
                        ) {
                          const r = Number((gst as any).rate);
                          rows.push({
                            label: `GST ${r}%`,
                            rate: r,
                            amount: (subtotal * r) / 100,
                          });
                        }
                      }

                      if (rows.length === 0) return null;

                      const totalGST = rows.reduce((s, r) => s + r.amount, 0);
                      const grandTotal = subtotal + totalGST;

                      return (
                        <div>
                          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                            GST Breakdown
                          </p>
                          <div className="border border-border rounded-xl overflow-hidden text-sm">
                            {/* Subtotal row */}
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
                              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                                Subtotal (before GST)
                              </span>
                              <span className="font-medium">
                                ₹
                                {subtotal.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            {/* GST component rows */}
                            {rows.map((row, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-b-0"
                              >
                                <span className="text-muted-foreground text-xs">
                                  {row.label}{" "}
                                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                                    {row.rate}%
                                  </span>
                                </span>
                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                  +₹
                                  {row.amount.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            ))}
                            {/* Total GST row */}
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border">
                              <span className="text-xs font-heading uppercase tracking-widest text-muted-foreground">
                                Total GST
                              </span>
                              <span className="font-semibold text-amber-600 dark:text-amber-400">
                                ₹
                                {totalGST.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            {/* Grand Total with GST row */}
                            <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-t-2 border-primary/20">
                              <span className="text-xs font-heading uppercase tracking-widest font-semibold">
                                Grand Total (incl. GST)
                              </span>
                              <span className="font-bold text-primary text-base">
                                ₹
                                {grandTotal.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Linked Expense Bookings */}
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Receipt size={11} className="text-primary" />
                        Linked Expense Bookings
                      </p>
                      <LinkedExpenseBookings grnId={viewingGrn.GRNID} />
                    </div>

                    {/* Remarks */}
                    {viewingGrn.Remarks && (
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                          Remarks
                        </p>
                        <p className="text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2">
                          {viewingGrn.Remarks}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </>
  );
}
