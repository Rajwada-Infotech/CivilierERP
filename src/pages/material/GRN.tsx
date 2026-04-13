import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Edit3, Save, X, Truck } from "lucide-react";
import * as grnApi from "@/api/grnApi";
import type {
  GRNFormDataPayload,
  GRNItemLine,
  Supplier,
  PurchaseOrder,
  Item,
  UOM,
} from "@/api/grnApi";

interface GRNFormData {
  grnNo: string;
  grnDate: string;
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
  remarks: string;
  status: "Draft" | "Partially Received" | "Fully Received";
  items: GRNItemLine[];
}

const statusOptions = ["Draft", "Partially Received", "Fully Received"] as const;

const emptyItem = (): GRNItemLine => ({
  itemId: "",
  itemName: "",
  orderedQty: 0,
  receivedQty: 0,
  remainingQty: 0,
  uom: "",
});

const genGrnNo = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GRN-MAT-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
};

const safeParseArray = <T,>(val: unknown): T[] => {
  if (Array.isArray(val)) return val as T[];
  if (typeof val !== "string" || !val.trim()) return [];
  try {
    const p = JSON.parse(val);
    return Array.isArray(p) ? (p as T[]) : [];
  } catch {
    return [];
  }
};

export default function GRN() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<GRNFormData>({
    grnNo: genGrnNo(),
    grnDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    remarks: "",
    status: "Draft",
    items: [emptyItem()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: grns = [], isLoading: loadingGrns } = useQuery({
    queryKey: ["grns"],
    queryFn: grnApi.getGRNs,
  });

  const { data: suppliersData = [], isLoading: loadingSuppliers } = useQuery<Supplier[]>({
    queryKey: ["suppliers-grn"],
    queryFn: grnApi.getSuppliers,
  });

  const { data: posData = [], isLoading: loadingPOs } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchaseOrders-grn"],
    queryFn: grnApi.getPurchaseOrders,
  });

  const { data: itemsData = [], isLoading: loadingItems } = useQuery<Item[]>({
    queryKey: ["itemMaster-grn"],
    queryFn: grnApi.getItems,
  });

  const { data: uomsData = [], isLoading: loadingUoms } = useQuery<UOM[]>({
    queryKey: ["uomMaster-grn"],
    queryFn: grnApi.getUoms,
  });

  // ── Derived option lists ──────────────────────────────────────────────────────

  const supplierOptions = suppliersData.map((s) => ({
    value: String(s.LHeadId),
    label: s.LHeadName,
  }));

  const poOptions = posData.map((po) => ({
    value: String(po.PurchaseOrderID),
    label: po.PurchaseOrderNo,
  }));

  // Items: M_Id (UUID) as value, M_Name as label
  const itemOptions = itemsData.map((i) => ({
    value: i.M_Id,
    label: i.ParentGroupName ? `${i.M_Name} (${i.ParentGroupName})` : i.M_Name,
  }));

  // UOMs: UOMCode as value, UOMName + Symbol as label
  const uomOptions = uomsData.map((u) => ({
    value: u.UOMCode,
    label: u.Symbol ? `${u.UOMName} (${u.Symbol})` : u.UOMName,
  }));

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: grnApi.addGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      resetForm();
      toast.success("GRN created successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Creation failed"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: GRNFormDataPayload) => grnApi.updateGRN(editingId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      resetForm();
      toast.success("GRN updated successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: grnApi.deleteGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      toast.success("GRN deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Delete failed"),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setFormData({
      grnNo: genGrnNo(),
      grnDate: new Date().toISOString().slice(0, 10),
      supplierId: "",
      supplierName: "",
      poId: "",
      poNumber: "",
      remarks: "",
      status: "Draft",
      items: [emptyItem()],
    });
    setEditingId(null);
    setErrors({});
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.grnNo) e.grnNo = "Required";
    if (!formData.supplierId) e.supplierId = "Select a supplier";
    if (
      formData.items.some(
        (item) => !item.itemId || item.receivedQty <= 0
      )
    ) {
      e.items = "Each row needs an item and received quantity > 0";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix errors before saving");
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
    };
    if (editingId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  // ── Field handlers ────────────────────────────────────────────────────────────

  const updateField = (field: keyof GRNFormData, value: string) => {
    // Supplier selected — resolve name
    if (field === "supplierId") {
      const found = suppliersData.find((s) => String(s.LHeadId) === value);
      setFormData((prev) => ({
        ...prev,
        supplierId: value,
        supplierName: found?.LHeadName || "",
      }));
      return;
    }

    // PO selected — auto-fill supplier + one item row from PO columns
    // dbo.PurchaseOrders has: ItemDescription, Quantity, Unit per row
    if (field === "poId") {
      const po = posData.find((p) => String(p.PurchaseOrderID) === value);
      if (!po) {
        setFormData((prev) => ({ ...prev, poId: value }));
        return;
      }

      // Resolve supplier from PO
      const supplier = suppliersData.find((s) => s.LHeadId === po.SupplierID);

      // Build one item row from PO's ItemDescription / Quantity / Unit
      const autoItem: GRNItemLine = {
        itemId: "",          // user must pick from item-master dropdown
        itemName: po.ItemDescription || "",
        orderedQty: Number(po.Quantity) || 0,
        receivedQty: 0,
        remainingQty: Number(po.Quantity) || 0,
        uom: po.Unit || "",  // pre-fill unit from PO.Unit column
      };

      setFormData((prev) => ({
        ...prev,
        poId: value,
        poNumber: po.PurchaseOrderNo,
        supplierId: String(po.SupplierID),
        supplierName: supplier?.LHeadName || po.SupplierName || "",
        items: [autoItem],
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    setFormData((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };

  const removeItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.length > 1
        ? prev.items.filter((_, i) => i !== index)
        : [emptyItem()],
    }));
  };

  const updateItemField = (index: number, field: keyof GRNItemLine, value: string | number) => {
    setFormData((prev) => {
      const next = [...prev.items];
      const row = { ...next[index], [field]: value };

      if (field === "itemId") {
        const found = itemsData.find((i) => i.M_Id === value);
        row.itemName = found?.M_Name || "";
      }

      row.orderedQty = Number(row.orderedQty) || 0;
      row.receivedQty = Number(row.receivedQty) || 0;
      row.remainingQty = row.orderedQty - row.receivedQty;
      next[index] = row;
      return { ...prev, items: next };
    });
  };

  const onEdit = (grn: any) => {
    const parsedItems = safeParseArray<GRNItemLine>(grn.GRNItems).map((item) => ({
      ...emptyItem(),
      ...item,
      orderedQty: Number(item.orderedQty || 0),
      receivedQty: Number(item.receivedQty || 0),
      remainingQty: Number(item.orderedQty || 0) - Number(item.receivedQty || 0),
    }));

    setFormData({
      grnNo: grn.GRNNo || "",
      grnDate: grn.GRNDate ? String(grn.GRNDate).slice(0, 10) : "",
      supplierId: String(grn.SupplierID || ""),
      supplierName: grn.SupplierName || "",
      poId: String(grn.POID || ""),
      poNumber: grn.PONumber || "",
      remarks: grn.Remarks || "",
      status: grn.Status || "Draft",
      items: parsedItems.length ? parsedItems : [emptyItem()],
    });
    setEditingId(String(grn.GRNID));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (loadingGrns || loadingSuppliers || loadingPOs || loadingItems || loadingUoms) {
    return <div className="p-8 text-center text-muted-foreground">Loading GRN data…</div>;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN Master"]} />

      <div className="space-y-6">
        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editingId ? <Edit3 className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
              {editingId ? "Edit GRN" : "New Goods Receipt Note"}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Header row */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

              {/* GRN Number */}
              <div>
                <Label>GRN Number</Label>
                <Input
                  value={formData.grnNo}
                  onChange={(e) => updateField("grnNo", e.target.value.toUpperCase())}
                  className={errors.grnNo ? "border-destructive" : ""}
                />
                {errors.grnNo && <p className="mt-1 text-sm text-destructive">{errors.grnNo}</p>}
              </div>

              {/* GRN Date */}
              <div>
                <Label>GRN Date</Label>
                <Input
                  type="date"
                  value={formData.grnDate}
                  onChange={(e) => updateField("grnDate", e.target.value)}
                />
              </div>

              {/* Supplier — from AccountHeadMaster WHERE LHeadType = 'S' */}
              <div>
                <Label>Supplier</Label>
                <Select value={formData.supplierId} onValueChange={(v) => updateField("supplierId", v)}>
                  <SelectTrigger className={errors.supplierId ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {supplierOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.supplierId && <p className="mt-1 text-sm text-destructive">{errors.supplierId}</p>}
                {formData.supplierName && (
                  <p className="mt-1 text-xs text-muted-foreground">{formData.supplierName}</p>
                )}
              </div>

              {/* Purchase Order — from dbo.PurchaseOrders */}
              <div>
                <Label>Purchase Order</Label>
                <Select value={formData.poId} onValueChange={(v) => updateField("poId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select purchase order" />
                  </SelectTrigger>
                  <SelectContent>
                    {poOptions.map((po) => (
                      <SelectItem key={po.value} value={po.value}>{po.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.poNumber && (
                  <p className="mt-1 text-xs text-muted-foreground">PO: {formData.poNumber}</p>
                )}
              </div>

              {/* Status */}
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => updateField("status", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Items table ───────────────────────────────────────────────── */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Truck className="h-5 w-5" />
                  Received Items
                </h3>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add Item
                </Button>
              </div>

              {errors.items && <p className="mb-3 text-sm text-destructive">{errors.items}</p>}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[240px]">Item (from Item Master)</TableHead>
                      <TableHead className="min-w-[110px]">Ordered Qty</TableHead>
                      <TableHead className="min-w-[120px]">Received Qty</TableHead>
                      <TableHead className="min-w-[100px]">Remaining</TableHead>
                      <TableHead className="min-w-[160px]">Unit (UOM)</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formData.items.map((item, index) => (
                      <TableRow key={index}>

                        {/* Item — from Item_Master_Group via /api/item-master */}
                        <TableCell>
                          <Select
                            value={item.itemId}
                            onValueChange={(v) => updateItemField(index, "itemId", v)}
                          >
                            <SelectTrigger className="w-[230px]">
                              <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                              {itemOptions.map((it) => (
                                <SelectItem key={it.value} value={it.value}>
                                  {it.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {/* Show PO item description hint if item not picked yet */}
                          {item.itemName && !item.itemId && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              PO item: {item.itemName}
                            </p>
                          )}
                          {item.itemId && item.itemName && (
                            <p className="mt-1 text-xs text-muted-foreground">{item.itemName}</p>
                          )}
                        </TableCell>

                        {/* Ordered Qty */}
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            className="w-24"
                            value={item.orderedQty || ""}
                            onChange={(e) =>
                              updateItemField(index, "orderedQty", Number(e.target.value) || 0)
                            }
                          />
                        </TableCell>

                        {/* Received Qty */}
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={item.orderedQty}
                            className="w-24"
                            value={item.receivedQty || ""}
                            onChange={(e) =>
                              updateItemField(index, "receivedQty", Number(e.target.value) || 0)
                            }
                          />
                        </TableCell>

                        {/* Remaining */}
                        <TableCell
                          className={item.remainingQty < 0 ? "font-semibold text-destructive" : "font-mono"}
                        >
                          {item.remainingQty}
                        </TableCell>

                        {/* UOM — from dbo.UOMMaster via /api/uom-master */}
                        <TableCell>
                          <Select
                            value={item.uom}
                            onValueChange={(v) => updateItemField(index, "uom", v)}
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {uomOptions.map((u) => (
                                <SelectItem key={u.value} value={u.value}>
                                  {u.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>

                        {/* Remove row */}
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(index)}
                            disabled={formData.items.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Remarks */}
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => updateField("remarks", e.target.value)}
                placeholder="GRN notes..."
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={onSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1"
              >
                <Save className="mr-2 h-4 w-4" />
                {editingId ? "Update" : "Create"} GRN
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                <X className="mr-2 h-4 w-4" />
                {editingId ? "Cancel" : "Reset"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── GRN List ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Goods Receipt Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>Purchase Order</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grns as any[]).map((grn: any) => {
                  const lineItems = safeParseArray(grn.GRNItems);
                  return (
                    <TableRow key={grn.GRNID}>
                      <TableCell className="font-semibold">{grn.GRNNo}</TableCell>
                      <TableCell>{grn.PONumber || grn.POID || "—"}</TableCell>
                      <TableCell>{grn.SupplierName || grn.SupplierID || "—"}</TableCell>
                      <TableCell>
                        {grn.GRNDate ? new Date(grn.GRNDate).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{grn.Status}</Badge>
                      </TableCell>
                      <TableCell>{lineItems.length}</TableCell>
                      <TableCell className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(grn)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(String(grn.GRNID))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(grns as any[]).length === 0 && (
              <p className="py-8 text-center text-muted-foreground">
                No GRNs yet. Create one above.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}