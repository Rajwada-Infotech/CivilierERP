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
  Item,
  UOM,
  GRNItemLine,
  Supplier,
  PurchaseOrder,
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

const createEmptyItem = (): GRNItemLine => ({
  itemId: "",
  itemName: "",
  orderedQty: 0,
  receivedQty: 0,
  remainingQty: 0,
  uom: "",
});

const generateGrnNo = () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GRN-MAT-${today}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
};

const parseJsonArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

export default function GRN() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<GRNFormData>({
    grnNo: generateGrnNo(),
    grnDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    remarks: "",
    status: "Draft",
    items: [createEmptyItem()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: grns = [], isLoading: loadingGrns } = useQuery({
    queryKey: ["grns"],
    queryFn: grnApi.getGRNs,
  });

  const { data: suppliersData = [], isLoading: loadingSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: grnApi.getSuppliers,
  });

  const { data: posData = [], isLoading: loadingPOs } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: grnApi.getPurchaseOrders,
  });

  const { data: itemsData = [], isLoading: loadingItems } = useQuery({
    queryKey: ["itemMaster"],
    queryFn: grnApi.getItems,
  });

  const { data: uomsData = [], isLoading: loadingUoms } = useQuery({
    queryKey: ["uomMaster"],
    queryFn: grnApi.getUoms,
  });

  const suppliers = suppliersData.map((supplier: Supplier) => ({
    value: String(supplier.LHeadId),
    label: supplier.LHeadName,
  }));

  const pos = posData.map((po: PurchaseOrder) => ({
    value: String(po.PurchaseOrderID),
    label: po.PurchaseOrderNo,
    data: po,
  }));

  const items = itemsData.map((item: Item) => ({
    value: item.M_Id,
    label: item.M_Name,
    group: item.ParentGroupName || "",
  }));

  const uoms = uomsData.map((uom: UOM) => ({
    value: uom.UOMCode,
    label: uom.Symbol || uom.UOMSymbol
      ? `${uom.UOMName} (${uom.Symbol || uom.UOMSymbol})`
      : uom.UOMName,
  }));

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
    mutationFn: (payload: GRNFormDataPayload) =>
      grnApi.updateGRN(editingId!, payload),
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
      toast.success("GRN deleted successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Delete failed"),
  });

  const resetForm = () => {
    setFormData({
      grnNo: generateGrnNo(),
      grnDate: new Date().toISOString().slice(0, 10),
      supplierId: "",
      supplierName: "",
      poId: "",
      poNumber: "",
      remarks: "",
      status: "Draft",
      items: [createEmptyItem()],
    });
    setEditingId(null);
    setErrors({});
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.grnNo) newErrors.grnNo = "Required";
    if (!formData.supplierId) newErrors.supplierId = "Select supplier";
    if (!formData.poId) newErrors.poId = "Select purchase order";

    if (
      formData.items.some(
        (item) =>
          !item.itemId ||
          !item.uom ||
          item.receivedQty <= 0 ||
          item.receivedQty > item.orderedQty
      )
    ) {
      newErrors.items =
        "Each row must have an item, unit, and received quantity within ordered quantity";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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
      poId: Number(formData.poId),
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

  const updateField = (field: keyof GRNFormData, value: string) => {
    if (field === "supplierId") {
      const supplier = suppliersData.find(
        (entry: Supplier) => String(entry.LHeadId) === value
      );

      setFormData((prev) => ({
        ...prev,
        supplierId: value,
        supplierName: supplier?.LHeadName || "",
      }));
      return;
    }

    if (field === "poId") {
      const po = posData.find(
        (entry: PurchaseOrder) => String(entry.PurchaseOrderID) === value
      );

      const poItems = parseJsonArray<any>(po?.Items);
      const mappedPoItems: GRNItemLine[] =
        poItems.length > 0
          ? poItems.map((item) => {
              const orderedQty = Number(
                item.orderedQty ?? item.qty ?? item.Quantity ?? 0
              );
              const itemId = String(item.itemId ?? item.M_Id ?? item.ItemID ?? "");
              const matchedItem = itemsData.find(
                (entry: Item) => entry.M_Id === itemId
              );

              return {
                itemId,
                itemName:
                  item.itemName ??
                  item.M_Name ??
                  matchedItem?.M_Name ??
                  "",
                orderedQty,
                receivedQty: 0,
                remainingQty: orderedQty,
                uom: String(item.uom ?? item.Unit ?? item.unit ?? po?.Unit ?? ""),
              };
            })
          : [
              {
                itemId: "",
                itemName: po?.ItemDescription || "",
                orderedQty: Number(po?.Quantity || 0),
                receivedQty: 0,
                remainingQty: Number(po?.Quantity || 0),
                uom: po?.Unit || "",
              },
            ];

      setFormData((prev) => ({
        ...prev,
        poId: value,
        poNumber: po?.PurchaseOrderNo || "",
        supplierId: po?.SupplierID ? String(po.SupplierID) : prev.supplierId,
        supplierName: po?.SupplierName || prev.supplierName,
        items: mappedPoItems.length ? mappedPoItems : [createEmptyItem()],
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyItem()],
    }));
  };

  const removeItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      items:
        prev.items.length > 1
          ? prev.items.filter((_, itemIndex) => itemIndex !== index)
          : [createEmptyItem()],
    }));
  };

  const updateItemField = (
    index: number,
    field: keyof GRNItemLine,
    value: string | number
  ) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const currentItem = { ...nextItems[index], [field]: value };

      if (field === "itemId") {
        const matchedItem = itemsData.find((item: Item) => item.M_Id === value);
        currentItem.itemName = matchedItem?.M_Name || "";
      }

      currentItem.orderedQty = Number(currentItem.orderedQty) || 0;
      currentItem.receivedQty = Number(currentItem.receivedQty) || 0;
      currentItem.remainingQty =
        currentItem.orderedQty - currentItem.receivedQty;

      nextItems[index] = currentItem;

      return {
        ...prev,
        items: nextItems,
      };
    });
  };

  const onEdit = (grn: any) => {
    const parsedItems = parseJsonArray<GRNItemLine>(grn.GRNItems).map((item) => ({
      ...createEmptyItem(),
      ...item,
      orderedQty: Number(item.orderedQty || 0),
      receivedQty: Number(item.receivedQty || 0),
      remainingQty:
        Number(item.remainingQty ?? Number(item.orderedQty || 0) - Number(item.receivedQty || 0)),
      uom: item.uom || "",
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
      items: parsedItems.length ? parsedItems : [createEmptyItem()],
    });

    setEditingId(String(grn.GRNID));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (
    loadingGrns ||
    loadingSuppliers ||
    loadingPOs ||
    loadingItems ||
    loadingUoms
  ) {
    return <div className="p-8 text-center">Loading GRN data...</div>;
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN Master"]} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editingId ? <Edit3 className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
              {editingId ? "Edit GRN" : "New Goods Receipt Note"}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>GRN Number</Label>
                <Input
                  value={formData.grnNo}
                  onChange={(e) => updateField("grnNo", e.target.value.toUpperCase())}
                  className={errors.grnNo ? "border-destructive" : ""}
                />
                {errors.grnNo && (
                  <p className="mt-1 text-sm text-destructive">{errors.grnNo}</p>
                )}
              </div>

              <div>
                <Label>GRN Date</Label>
                <Input
                  type="date"
                  value={formData.grnDate}
                  onChange={(e) => updateField("grnDate", e.target.value)}
                />
              </div>

              <div>
                <Label>Supplier</Label>
                <Select
                  value={formData.supplierId}
                  onValueChange={(value) => updateField("supplierId", value)}
                >
                  <SelectTrigger className={errors.supplierId ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.value} value={supplier.value}>
                        {supplier.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.supplierId && (
                  <p className="mt-1 text-sm text-destructive">{errors.supplierId}</p>
                )}
              </div>

              <div>
                <Label>Purchase Order</Label>
                <Select
                  value={formData.poId}
                  onValueChange={(value) => updateField("poId", value)}
                >
                  <SelectTrigger className={errors.poId ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select purchase order" />
                  </SelectTrigger>
                  <SelectContent>
                    {pos.map((poOption) => (
                      <SelectItem key={poOption.value} value={poOption.value}>
                        {poOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.poId && (
                  <p className="mt-1 text-sm text-destructive">{errors.poId}</p>
                )}
                {formData.poNumber && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    PO: {formData.poNumber}
                  </p>
                )}
              </div>

              <div>
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => updateField("status", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

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

              {errors.items && (
                <p className="mb-4 text-sm text-destructive">{errors.items}</p>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Item</TableHead>
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
                        <TableCell>
                          <Select
                            value={item.itemId}
                            onValueChange={(value) =>
                              updateItemField(index, "itemId", value)
                            }
                          >
                            <SelectTrigger className="w-[220px]">
                              <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                              {items.map((entry) => (
                                <SelectItem key={entry.value} value={entry.value}>
                                  {entry.group
                                    ? `${entry.label} (${entry.group})`
                                    : entry.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {item.itemName && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.itemName}
                            </p>
                          )}
                        </TableCell>

                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            className="w-24"
                            value={item.orderedQty || ""}
                            onChange={(e) =>
                              updateItemField(
                                index,
                                "orderedQty",
                                Number(e.target.value) || 0
                              )
                            }
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={item.orderedQty}
                            className="w-24"
                            value={item.receivedQty || ""}
                            onChange={(e) =>
                              updateItemField(
                                index,
                                "receivedQty",
                                Number(e.target.value) || 0
                              )
                            }
                          />
                        </TableCell>

                        <TableCell
                          className={
                            item.remainingQty < 0
                              ? "font-semibold text-destructive"
                              : "font-mono"
                          }
                        >
                          {item.remainingQty}
                        </TableCell>

                        <TableCell>
                          <Select
                            value={item.uom}
                            onValueChange={(value) =>
                              updateItemField(index, "uom", value)
                            }
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {uoms.map((uom) => (
                                <SelectItem key={uom.value} value={uom.value}>
                                  {uom.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>

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

            <div>
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => updateField("remarks", e.target.value)}
                placeholder="GRN notes..."
                rows={3}
              />
            </div>

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

        <Card>
          <CardHeader>
            <CardTitle>Goods Receipt Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {grns.map((grn: any) => {
                  const lineItems = parseJsonArray(grn.GRNItems);
                  return (
                    <TableRow key={grn.GRNID}>
                      <TableCell className="font-semibold">{grn.GRNNo}</TableCell>
                      <TableCell>{grn.PONumber || grn.POID || "—"}</TableCell>
                      <TableCell>{grn.SupplierName || grn.SupplierID || "—"}</TableCell>
                      <TableCell>
                        {grn.GRNDate
                          ? new Date(grn.GRNDate).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{grn.Status}</Badge>
                      </TableCell>
                      <TableCell>{lineItems.length}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(grn)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-1"
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

            {grns.length === 0 && (
              <p className="py-8 text-center text-muted-foreground">
                No GRNs yet. Create one from a Purchase Order.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
