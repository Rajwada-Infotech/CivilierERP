import React, { useState } from "react";
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
} from "lucide-react";
import * as grnApi from "@/api/grnApi";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import type {
  GRNFormDataPayload,
  GRNItemLine,
  Supplier,
  PurchaseOrder,
  Item,
  UOM,
} from "@/api/grnApi";

const statusOptions = ["Draft", "Partially Received", "Fully Received"] as const;

const createEmptyItem = (): GRNItemLine => ({
  itemId: "",
  itemName: "",
  orderedQty: 0,
  receivedQty: 0,
  remainingQty: 0,
  uom: "",
});

const parseJsonArray = <T,>(val: unknown): T[] => {
  if (Array.isArray(val)) return val as T[];
  if (typeof val !== "string" || !val.trim()) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

export default function GRN() {
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;

  const buildEmptyForm = (
    overrides: Partial<{
      grnNo: string;
      grnDate: string;
      supplierId: string;
      supplierName: string;
      poId: string;
      poNumber: string;
      remarks: string;
      status: "Draft" | "Partially Received" | "Fully Received";
      items: GRNItemLine[];
      docTypeId: number | null;
      docNo: string;
    }> = {},
  ) => ({
    grnNo: "",
    grnDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    remarks: "",
    status: "Draft" as const,
    items: [createEmptyItem()],
    docTypeId: null as number | null,
    docNo: "",
    ...overrides,
  });

  const [formData, setFormData] = useState({
    ...buildEmptyForm(),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: grnsPage, isLoading: loadingGrns } = useQuery({
    queryKey: ["grns", page, limit],
    queryFn: () => grnApi.getGRNs({ page, limit }),
  });
  const grns = grnsPage?.data ?? [];
  const totalPages = Math.max(grnsPage?.totalPages ?? 1, 1);
  const totalRecords = grnsPage?.total ?? grns.length;

  const { data: suppliersData = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: grnApi.getSuppliers,
  });

  const { data: posData = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: grnApi.getPurchaseOrders,
  });

  const { data: itemsData = [] } = useQuery({
    queryKey: ["itemMaster"],
    queryFn: grnApi.getItems,
  });

  const { data: uomsData = [] } = useQuery({
    queryKey: ["uomMaster"],
    queryFn: grnApi.getUoms,
  });

  // ── Mapped Options ───────────────────────────────────────────────────────────
  const suppliers = suppliersData.map((s: Supplier) => ({
    value: String(s.LHeadId),
    label: s.LHeadName,
  }));

  const pos = posData.map((po: PurchaseOrder) => ({
    value: String(po.PurchaseOrderID),
    label: po.PurchaseOrderNo,
  }));

  const items = itemsData.map((item: Item) => ({
    value: String(item.M_Id),
    label: item.M_Name,
    group: item.ParentGroupName || "",
  }));

  const uoms = uomsData
    .filter((u: UOM) => u.IsActive !== false)
    .map((uom: UOM) => ({
      value: uom.UOMCode,
      label: uom.Symbol ? `${uom.UOMName} (${uom.Symbol})` : uom.UOMName,
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
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      await resetForm(true);
      toast.success("GRN created successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to create GRN"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: GRNFormDataPayload) => grnApi.updateGRN(editingId!, payload),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      await resetForm();
      toast.success("GRN updated successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update GRN"),
  });

  const deleteMutation = useMutation({
    mutationFn: grnApi.deleteGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setPage(1);
      toast.success("GRN deleted successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete GRN"),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const resetForm = async (keepDocType = false) => {
    const nextDocTypeId = keepDocType ? formData.docTypeId : null;
    const nextDocNo = nextDocTypeId
      ? await fetchNextDocNumber(nextDocTypeId, activeFinYear)
      : "";

    setFormData(
      buildEmptyForm({
        docTypeId: nextDocTypeId,
        docNo: nextDocNo,
        grnNo: nextDocNo,
      }),
    );
    setEditingId(null);
    setErrors({});
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.grnNo.trim()) newErrors.grnNo = "GRN Number is required";
    if (!formData.supplierId) newErrors.supplierId = "Supplier is required";
    if (!formData.poId) newErrors.poId = "Purchase Order is required";
    if (formData.items.some((i) => !i.itemId || !i.uom || i.receivedQty <= 0)) {
      newErrors.items = "Please complete all item details correctly";
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
      grnNo: formData.grnNo,
      grnDate: formData.grnDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId) || 0,
      grnItems: formData.items,
      status: formData.status,
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
      docTypeId: formData.docTypeId,
      docNo: formData.docNo,
      finYear: activeFinYear || null,
    };

    if (editingId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  // ── Field & Item Handlers ────────────────────────────────────────────────────
  const updateField = (field: keyof typeof formData, value: any) => {
    if (field === "supplierId") {
      const supplier = suppliersData.find((s: Supplier) => String(s.LHeadId) === value);
      setFormData((prev) => ({
        ...prev,
        supplierId: value,
        supplierName: supplier?.LHeadName || "",
      }));
      return;
    }

    if (field === "poId") {
      const po = posData.find((p: PurchaseOrder) => String(p.PurchaseOrderID) === String(value));
      if (!po) {
        setFormData((prev) => ({ ...prev, poId: String(value) }));
        return;
      }

      // Auto-populate logic (best from dev branch)
      let autoItemId = "";
      let autoItemName = po.ItemDescription || "";
      let autoUom = po.Unit || "";

      const matchedItem = itemsData.find(
        (it: Item) => it.M_Name.trim().toLowerCase() === po.ItemDescription?.trim().toLowerCase()
      );
      if (matchedItem) {
        autoItemId = String(matchedItem.M_Id);
        autoItemName = matchedItem.M_Name;
      }

      const matchedUom = uomsData.find(
        (u: UOM) =>
          u.UOMCode.trim().toLowerCase() === po.Unit?.trim().toLowerCase() ||
          u.UOMName.trim().toLowerCase() === po.Unit?.trim().toLowerCase()
      );
      if (matchedUom) autoUom = matchedUom.UOMCode;

      const mappedItems: GRNItemLine[] = po.ItemDescription
        ? [
            {
              itemId: autoItemId,
              itemName: autoItemName,
              orderedQty: Number(po.Quantity || 0),
              receivedQty: 0,
              remainingQty: Number(po.Quantity || 0),
              uom: autoUom,
            },
          ]
        : [createEmptyItem()];

      setFormData((prev) => ({
        ...prev,
        poId: String(value),
        poNumber: po.PurchaseOrderNo || "",
        supplierId: po.SupplierID ? String(po.SupplierID) : prev.supplierId,
        supplierName: po.SupplierName || prev.supplierName,
        items: mappedItems,
      }));
      return;
    }

    if (field === "grnNo") {
      const nextValue = String(value || "").toUpperCase();
      setFormData((prev) => ({ ...prev, grnNo: nextValue, docNo: nextValue }));
      return;
    }

    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    setFormData((prev) => ({ ...prev, items: [...prev.items, createEmptyItem()] }));
  };

  const removeItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : [createEmptyItem()],
    }));
  };

  const updateItemField = (index: number, field: keyof GRNItemLine, value: any) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const current = { ...nextItems[index], [field]: value };

      if (field === "itemId") {
        const matched = itemsData.find((it: Item) => String(it.M_Id) === String(value));
        current.itemName = matched?.M_Name || current.itemName || "";
      }

      current.orderedQty = Number(current.orderedQty) || 0;
      current.receivedQty = Number(current.receivedQty) || 0;
      current.remainingQty = current.orderedQty - current.receivedQty;

      nextItems[index] = current;
      return { ...prev, items: nextItems };
    });
  };

  const onEdit = (grn: any) => {
    const parsedItems = parseJsonArray<GRNItemLine>(grn.GRNItems).map((item) => ({
      ...createEmptyItem(),
      ...item,
      orderedQty: Number(item.orderedQty || 0),
      receivedQty: Number(item.receivedQty || 0),
      remainingQty: Number(item.remainingQty || 0),
    }));

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
    });

    setEditingId(String(grn.GRNID));
    window.scrollTo({ top: 0, behavior: "smooth" });
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
            {/* Document Type & Number */}
            <div>
              <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                Document Type &amp; Number
              </label>
              <DocNumberPreview
                finYear={activeFinYear}
                selectedDocTypeId={formData.docTypeId}
                preview={formData.docNo}
                onSelect={(id, preview) =>
                  setFormData((prev) => ({
                    ...prev,
                    docTypeId: id,
                    docNo: preview,
                    grnNo: preview,
                  }))
                }
              />
            </div>

            {/* Header Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  GRN Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <FileText size={15} className="absolute left-3 top-3 text-muted-foreground" />
                  <input
                    value={formData.grnNo}
                    onChange={(e) => updateField("grnNo", e.target.value.toUpperCase())}
                    className={`${inp} pl-10`}
                  />
                </div>
                {errors.grnNo && <p className="text-destructive text-sm mt-1">{errors.grnNo}</p>}
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  GRN Date
                </label>
                <div className="relative">
                  <Calendar size={15} className="absolute left-3 top-3 text-muted-foreground" />
                  <input
                    type="date"
                    value={formData.grnDate}
                    onChange={(e) => updateField("grnDate", e.target.value)}
                    className={`${inp} pl-10`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Supplier <span className="text-destructive">*</span>
                </label>
                <select
                  value={formData.supplierId}
                  onChange={(e) => updateField("supplierId", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {errors.supplierId && <p className="text-destructive text-sm mt-1">{errors.supplierId}</p>}
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Purchase Order <span className="text-destructive">*</span>
                </label>
                <select
                  value={formData.poId}
                  onChange={(e) => updateField("poId", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Purchase Order...</option>
                  {pos.map((po) => (
                    <option key={po.value} value={po.value}>
                      {po.label}
                    </option>
                  ))}
                </select>
                {formData.poNumber && <p className="text-xs text-muted-foreground mt-1">PO: {formData.poNumber}</p>}
                {errors.poId && <p className="text-destructive text-sm mt-1">{errors.poId}</p>}
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => updateField("status", e.target.value)}
                  className={inp}
                >
                  {statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Items Table */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
                  <Package size={17} /> Received Items
                </h3>
                <button
                  onClick={addItem}
                  className="flex items-center gap-1.5 text-primary hover:bg-primary/10 px-4 py-2 rounded-lg transition-colors text-sm"
                >
                  <Plus size={16} /> Add Item
                </button>
              </div>

              {errors.items && <p className="text-destructive text-sm mb-3">{errors.items}</p>}

              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Ordered</th>
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Received</th>
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Remaining</th>
                      <th className="px-4 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">UOM</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {formData.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-3">
                          <select
                            value={item.itemId}
                            onChange={(e) => updateItemField(idx, "itemId", e.target.value)}
                            className={inp}
                          >
                            <option value="">Select Item</option>
                            {items.map((it) => (
                              <option key={it.value} value={it.value}>
                                {it.label} {it.group && `(${it.group})`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            value={item.orderedQty}
                            onChange={(e) => updateItemField(idx, "orderedQty", Number(e.target.value))}
                            className={inp}
                          />
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            value={item.receivedQty}
                            onChange={(e) => updateItemField(idx, "receivedQty", Number(e.target.value))}
                            className={inp}
                          />
                        </td>
                        <td className="p-3 font-medium text-center">{item.remainingQty}</td>
                        <td className="p-3">
                          <select
                            value={item.uom}
                            onChange={(e) => updateItemField(idx, "uom", e.target.value)}
                            className={inp}
                          >
                            <option value="">Select UOM</option>
                            {uoms.map((u) => (
                              <option key={u.value} value={u.value}>
                                {u.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => removeItem(idx)}
                            disabled={formData.items.length === 1}
                            className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
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
                onChange={(e) => updateField("remarks", e.target.value)}
                rows={3}
                className={`${inp} resize-y`}
                placeholder="Additional notes, remarks, etc."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={onSubmit}
                className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <Save size={18} />
                {editingId ? "Update GRN" : "Create GRN"}
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
              <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search GRN, PO or Supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full py-2.5 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">GRN No</th>
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Doc No</th>
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">PO No</th>
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Supplier</th>
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredGrns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                      No GRNs found
                    </td>
                  </tr>
                ) : (
                  filteredGrns.map((grn: any) => (
                    <tr key={grn.GRNID} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 font-medium">{grn.GRNNo}</td>
                      <td className="px-6 py-4 font-mono text-xs">{grn.DocNo || "—"}</td>
                      <td className="px-6 py-4">{grn.PONumber || "—"}</td>
                      <td className="px-6 py-4">{grn.SupplierName || "—"}</td>
                      <td className="px-6 py-4">
                        {grn.GRNDate ? new Date(grn.GRNDate).toLocaleDateString("en-IN") : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={grn.Status || "Draft"} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <ApprovalActions
                            status={grn.Status || "Draft"}
                            recordId={Number(grn.GRNID)}
                            endpoint="/api/grns"
                            onSuccess={() => queryClient.invalidateQueries({ queryKey: ["grns"] })}
                          />
                          <button
                            onClick={() => onEdit(grn)}
                            className="text-primary hover:bg-primary/10 p-2 rounded transition-colors"
                          >
                            <Edit3 size={18} />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(String(grn.GRNID))}
                            className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
    </>
  );
}

