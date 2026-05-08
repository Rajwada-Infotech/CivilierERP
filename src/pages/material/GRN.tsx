import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Truck,
  Package,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Search,
  Calendar,
  FileText,
  Eye,
} from "lucide-react";
import * as grnApi from "@/api/grnApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
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
    // Handle double-encoded: stored as JSON string of a JSON string
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
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
        ✓ Exp. Booked
      </span>
      {chain.isPaid && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
          ✓ Paid
        </span>
      )}
    </div>
  );
}

// queryClient is hoisted so column cell closures can reference it
let queryClient: ReturnType<typeof useQueryClient>;
let onEdit: (grn: any) => void;
let onView: (grn: any) => void;
let deleteMutation: { mutate: (id: string) => void };

const GRN_LIST_COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "GRNNo",
    header: "GRN No",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <span className="font-medium">
          {v ? (v.startsWith("GRN-") ? v : `GRN-${v}`) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "PONumber",
    header: "PO No",
    cell: ({ getValue }) => <span>{(getValue() as string) || "—"}</span>,
  },
  {
    accessorKey: "SupplierName",
    header: "Supplier",
    cell: ({ getValue }) => <span>{(getValue() as string) || "—"}</span>,
  },
  {
    accessorKey: "GRNDate",
    header: "Date",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return <span>{v ? new Date(v).toLocaleDateString("en-IN") : "—"}</span>;
    },
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ row }) => {
      const grn = row.original;
      return (
        <div>
          <StatusBadge status={(grn.Status as string) || "Draft"} />
          <GRNChainBadge grnId={Number(grn.GRNID)} />
        </div>
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
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => onView(grn)}
            className="text-muted-foreground hover:bg-muted p-2 rounded transition-colors"
            title="View GRN"
          >
            <Eye size={18} />
          </button>
          <button
            onClick={() => onEdit(grn)}
            className="text-primary hover:bg-primary/10 p-2 rounded transition-colors"
            title="Edit GRN"
          >
            <Edit3 size={18} />
          </button>
          <button
            onClick={() => deleteMutation.mutate(String(grn.GRNID))}
            className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors"
            title="Delete GRN"
          >
            <Trash2 size={18} />
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
    finYear: activeFinYear || "",
  });

  const [formData, setFormData] = useState(buildEmptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!formData.finYear && activeFinYear) {
      setFormData((prev) => ({ ...prev, finYear: activeFinYear }));
    }
    if (!selectedFinYear && activeFinYear) {
      setSelectedFinYear(activeFinYear);
    }
  }, [activeFinYear, formData.finYear, selectedFinYear]);

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

  const pos = posData
    .filter((po: PurchaseOrder) => {
      if (!selectedFinYear) return true;
      // PO number format: CI/PUR/000001/2025-2026 — fin year is the last segment
      const docNo = po.PurchaseOrderNo || "";
      return docNo.includes(selectedFinYear);
    })
    .map((po: PurchaseOrder) => ({
      value: String(po.PurchaseOrderID),
      label: po.PurchaseOrderNo,
    }));

  const filteredGrns = grns.filter((grn: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
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

      // Map PO line items → GRN item lines
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
        docTypeId: po.DocTypeId ?? null,
        finYear: prev.finYear || activeFinYear || "",
        // grnNo will be assigned by backend on save
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
      grnNo: formData.grnNo || "", // empty = backend auto-generates
      grnDate: formData.grnDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId) || 0,
      grnItems: formData.items,
      status: "Draft",
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
      docTypeId: null, // GRN prefix resolved automatically by backend from parentDocNo
      docNo: "",
      finYear: selectedFinYear || formData.finYear || null,
      // Pass the parent PO's DocNo so the backend can resolve the correct GRN
      // prefix: GRN (normal PO), ExB-PO-GRN (ExB-PO parent), etc.
      parentDocNo: formData.poNumber || null,
      rootExBDocNo: null, // set when GRN is raised from within an Expense Booking
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
      // Keep receivedQty and quantity in sync when user edits receivedQty
      if (field === "receivedQty") {
        current.remainingQty = current.orderedQty - value;
        // Only auto-sync quantity if user hasn't manually set it yet
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

  // Legacy alias kept so existing call-sites compile without change
  const updateReceivedQty = (index: number, value: number) =>
    updateItemField(index, "receivedQty", value);

  // ── Edit ─────────────────────────────────────────────────────────────────────
  onView = async (grn: any) => {
    // The list row no longer carries GRNItems (removed for perf).
    // Fetch the full record so the view modal has item data.
    try {
      const token = localStorage.getItem("token") ?? "";
      const res = await fetch(`/api/grns/${grn.GRNID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch GRN details");
      setViewingGrn(await res.json());
    } catch {
      setViewingGrn(grn);
    }
  };

  onEdit = (grn: any) => {
    const parsedItems = parseJsonArray<GRNItemLine>(grn.GRNItems).map(
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

    setFormData({
      grnNo: grn.GRNNo || "",
      grnDate: grn.GRNDate ? String(grn.GRNDate).slice(0, 10) : "",
      supplierId: String(grn.SupplierID || ""),
      supplierName: grn.SupplierName || "",
      poId: String(grn.POID || ""),
      poNumber: grn.PONumber || "",
      remarks: grn.Remarks || "",
      status: (grn.Status as any) || "Draft",
      items: parsedItems.length ? parsedItems : [createEmptyItem()],
      docTypeId: grn.DocTypeId ?? null,
      docNo: grn.DocNo || "",
      finYear: grn.FinYear || activeFinYear || "",
    });

    setEditingId(String(grn.GRNID));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setFormData(buildEmptyForm());
    setEditingId(null);
    setErrors({});
  };

  if (loadingGrns) {
    return <div className="p-6 text-muted-foreground">Loading GRNs...</div>;
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-6">
        Goods Receipt Note (GRN)
      </h1>

      <div className="space-y-6">
        {/* Form Card */}
        <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/60">
            <h2 className="font-heading font-semibold flex items-center gap-2">
              {editingId ? <Edit3 size={18} /> : <Truck size={18} />}
              {editingId ? "Edit Goods Receipt Note" : "New Goods Receipt Note"}
            </h2>
            {editingId && (
              <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                Editing Mode
              </span>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Header Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Fin Year selector */}
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Fin Year
                </label>
                <select
                  value={selectedFinYear}
                  onChange={(e) => {
                    setSelectedFinYear(e.target.value);
                    // Clear PO selection when fin year changes
                    setFormData((prev) => ({
                      ...prev,
                      poId: "",
                      poNumber: "",
                      supplierId: "",
                      supplierName: "",
                      items: [createEmptyItem()],
                      grnNo: "",
                      docNo: "",
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
              <div className="lg:col-span-2">
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Loading PO details…
                  </p>
                )}
                {formData.supplierName && !loadingPO && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Supplier:{" "}
                    <span className="text-foreground font-medium">
                      {formData.supplierName}
                    </span>
                  </p>
                )}
                {errors.poId && (
                  <p className="text-destructive text-sm mt-1">{errors.poId}</p>
                )}
              </div>

              {/* GRN Date */}
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  GRN Date
                </label>
                <div className="relative">
                  <Calendar
                    size={15}
                    className="absolute left-3 top-3 text-muted-foreground"
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
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  GRN Number
                </label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/40 border border-dashed border-border">
                  <FileText
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                  {formData.grnNo ? (
                    <span className="font-mono text-sm text-primary font-semibold tracking-wide">
                      {formData.grnNo}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground/50 italic">
                      Auto-generated on save
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
                  <Package size={17} /> Received Items
                </h3>
                {/* Add Item only when no PO is selected (manual entry fallback) */}
                {!formData.poId && (
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        items: [...prev.items, createEmptyItem()],
                      }))
                    }
                    className="flex items-center gap-1.5 text-primary hover:bg-primary/10 px-4 py-2 rounded-lg transition-colors text-sm"
                  >
                    <Plus size={16} /> Add Item
                  </button>
                )}
              </div>

              {errors.items && (
                <p className="text-destructive text-sm mb-3">{errors.items}</p>
              )}

              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Item
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Ordered
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Received
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Remaining
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        UOM
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Rate (₹) <span className="text-destructive">*</span>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Qty (Billing){" "}
                        <span className="text-destructive">*</span>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                        Total (₹)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {formData.items.map((item, idx) => {
                      const fromPO = !!formData.poId;
                      return (
                        <tr key={idx}>
                          {/* Item name — locked if from PO */}
                          <td className="p-3">
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
                          {/* Ordered qty — locked, comes from PO */}
                          <td className="p-3 text-right font-medium text-muted-foreground">
                            {item.orderedQty}
                          </td>
                          {/* Received qty — always editable */}
                          <td className="p-3">
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
                          </td>
                          {/* Remaining — computed */}
                          <td
                            className={`p-3 text-right font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                          >
                            {item.remainingQty}
                          </td>
                          {/* UOM — locked if from PO */}
                          <td className="p-3">
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
                                    <option key={u.UOMCode} value={u.UOMCode}>
                                      {u.UOMName}{" "}
                                      {u.Symbol ? `(${u.Symbol})` : ""}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </td>
                          {/* Rate */}
                          <td className="p-3">
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
                          {/* Billing Quantity */}
                          <td className="p-3">
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
                          {/* Total Amount — computed, read-only */}
                          <td className="p-3 text-right font-semibold text-primary">
                            {item.totalAmount > 0
                              ? `₹${item.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Grand total footer */}
                  {formData.items.some((i) => i.totalAmount > 0) && (
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
                            .reduce((sum, i) => sum + (i.totalAmount || 0), 0)
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
              <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
            <div className="flex gap-3 pt-4">
              <button
                onClick={onSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Save size={18} />
                {editingId ? "Update GRN" : "Save GRN"}
              </button>
              <button
                onClick={resetForm}
                className="px-8 border border-border hover:bg-muted py-3 rounded-lg flex items-center gap-2 transition-colors"
              >
                <X size={18} /> Cancel
              </button>
            </div>
          </div>
        </div>

        {/* GRN List */}
        <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
          <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-card/60">
            <h3 className="font-heading font-semibold">GRN History</h3>
            <div className="relative w-80">
              <Search
                size={15}
                className="absolute left-3 top-3 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search GRN, PO or Supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full py-2.5 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <DataTable
            data={filteredGrns}
            columns={GRN_LIST_COLUMNS}
            searchable={false}
            paginated={true}
            defaultPageSize={20}
            emptyMessage="No GRNs found."
          />
          <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {totalPages} ({totalRecords} records)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
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

                <div className="p-6 space-y-5">
                  {/* Meta row */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                        Purchase Order
                      </p>
                      <p className="font-medium">
                        {viewingGrn.PONumber || "—"}
                      </p>
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
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                        Status
                      </p>
                      <StatusBadge status={viewingGrn.Status || "Draft"} />
                    </div>
                  </div>

                  {/* Items table */}
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                      Received Items
                    </p>
                    <div className="border border-border rounded-xl overflow-x-auto">
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
    </>
  );
}
