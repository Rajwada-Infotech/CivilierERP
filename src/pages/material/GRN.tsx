import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Edit3, Save, X, Truck, CalendarDays } from "lucide-react";
import * as api from "@/api/grnApi";

interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadType?: string;
}

interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  SupplierID?: number;
  SupplierName?: string;
  Items?: string;
}

interface Item {
  ItemGroupId?: number;
  id?: number;
  ItemGroupName?: string;
  name?: string;
  ItemGroupDescription?: string;
}

interface GRNItemLine {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
}

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

const units = ["MT", "Bags", "Brass", "Nos", "Ltr", "Kg"];

export default function GRN() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<GRNFormData>({
    grnNo: "",
    grnDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    remarks: "",
    status: "Draft",
    items: [{ itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0 }],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedPO, setSelectedPO] = useState<any>(null);

  // Queries
  const { data: grns = [] as any[], isLoading: loadingGrns } = useQuery({
    queryKey: ["grns"],
    queryFn: api.getGRNs,
  });

  const { data: suppliersData = [] as Supplier[], isLoading: loadingSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: api.getSuppliers,
  });

  const { data: posData = [] as PurchaseOrder[], isLoading: loadingPOs } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: api.getPurchaseOrders,
  });

  const { data: itemsData = [] as Item[], isLoading: loadingItems } = useQuery({
    queryKey: ["items"],
    queryFn: api.getItems,
  });

  const suppliers = suppliersData.map((s: any) => ({
    value: String(s.LHeadId),
    label: s.LHeadName,
  }));

  const pos = posData.map((po: any) => ({
    value: String(po.PurchaseOrderID),
    label: po.PurchaseOrderNo,
    data: po,
  }));

  const items = itemsData.map((i: any) => ({
    value: String(i.ItemGroupId || i.id),
    label: i.ItemGroupName || i.name || i.ItemGroupDescription,
  }));

  // Mutations
  const createMutation = useMutation({
    mutationFn: api.addGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      resetForm();
      toast.success("GRN created");
    },
    onError: (err: any) => toast.error(err.message || "Creation failed"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: GRNFormData) => api.updateGRN(editingId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      setEditingId(null);
      toast.success("GRN updated");
    },
    onError: (err: any) => toast.error(err.message || "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteGRN,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grns"] });
      toast.success("GRN deleted");
    },
    onError: (err: any) => toast.error(err.message || "Delete failed"),
  });

  const resetForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    const grnNum = `GRN-MAT-${today.replace(/-/g,'')}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    setFormData({
      grnNo: grnNum,
      grnDate: today,
      supplierId: "",
      supplierName: "",
      poId: "",
      poNumber: "",
      remarks: "",
      status: "Draft",
      items: [{ itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0 }],
    });
    setEditingId(null);
    setSelectedPO(null);
    setErrors({});
  };

  useEffect(() => {
    // Auto calc remaining
    const newItems = formData.items.map(item => ({
      ...item,
      remainingQty: item.orderedQty - item.receivedQty
    }));
    setFormData(prev => ({ ...prev, items: newItems }));
  }, [formData.items]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.grnNo) newErrors.grnNo = "Required";
    if (!formData.supplierId) newErrors.supplierId = "Select supplier";
    if (!formData.poId) newErrors.poId = "Select PO";
    if (formData.items.some(item => 
      !item.itemId || 
      item.receivedQty <= 0 || 
      item.receivedQty > item.orderedQty
    )) {
      newErrors.items = "Enter valid received qty (1 to ordered qty) for all items";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix errors");
      return;
    }
    const payload = {
      grnNo: formData.grnNo,
      grnDate: formData.grnDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId),
      grnItems: formData.items,
      status: formData.status,
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
    } as any;
    if (editingId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const updateField = (field: keyof GRNFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === "supplierId") {
      const supplier = suppliersData.find((s: any) => String(s.LHeadId) === value);
      setFormData(prev => ({ ...prev, supplierName: supplier?.LHeadName || "" }));
    }
    if (field === "poId") {
      const po = posData.find((p: any) => String(p.PurchaseOrderID) === value);
      setFormData(prev => ({ 
        ...prev, 
        poNumber: po?.PurchaseOrderNo || "",
        supplierId: String(po?.SupplierID || ""),
        supplierName: po?.SupplierName || ""
      }));
      if (po?.Items) {
        try {
          const poItems = JSON.parse(po.Items);
          const grnItems: GRNItemLine[] = poItems.map((item: any) => ({
            itemId: item.itemId || "",
            itemName: item.itemName || "",
            orderedQty: item.qty || 0,
            receivedQty: 0,
            remainingQty: item.qty || 0
          }));
          setFormData(prev => ({ ...prev, items: grnItems.length ? grnItems : prev.items }));
          setSelectedPO(po);
        } catch {
          setFormData(prev => ({ ...prev, items: [{ itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0 }] }));
        }
      }
    }
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0 }],
    }));
  };

  const removeItem = (index: number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateItemField = (index: number, field: keyof GRNItemLine, value: string | number) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value as never };
    if (field === "itemId") {
      const item = itemsData.find((i: any) => String(i.ItemGroupId || i.id) === value);
      newItems[index].itemName = item?.ItemGroupName || item?.name || "";
    }
    // Auto calc remaining
    newItems[index].remainingQty = newItems[index].orderedQty - newItems[index].receivedQty;
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const onEdit = (grn: any) => {
    const parsedItems = grn.GRNItems ? JSON.parse(grn.GRNItems) : [];
    setFormData({
      grnNo: grn.GRNNo || "",
      grnDate: grn.GRNDate || "",
      supplierId: String(grn.SupplierID || ""),
      supplierName: grn.SupplierName || "",
      poId: String(grn.POID || ""),
      poNumber: grn.PONumber || "",
      remarks: grn.Remarks || "",
      status: grn.Status || "Draft",
      items: parsedItems.length ? parsedItems : [{ itemId: "", itemName: "", orderedQty: 0, receivedQty: 0, remainingQty: 0 }],
    });
    setEditingId(String(grn.GRNID));
  };

  if (loadingGrns || loadingSuppliers || loadingPOs || loadingItems) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "GRN"]} />

      <div className="space-y-6">
        {/* Form Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {editingId ? <Edit3 className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
              {editingId ? "Edit GRN" : "New Goods Receipt Note"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Header Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>GRN Number</Label>
                <Input
                  value={formData.grnNo}
                  onChange={(e) => updateField("grnNo", e.target.value.toUpperCase())}
                  className={errors.grnNo ? "border-destructive" : ""}
                />
                {errors.grnNo && <p className="text-sm text-destructive mt-1">{errors.grnNo}</p>}
              </div>
              <div>
                <Label>GRN Date</Label>
                <Input type="date" value={formData.grnDate} onChange={(e) => updateField("grnDate", e.target.value)} />
              </div>
              <div>
                <Label>Supplier</Label>
                <Select value={formData.supplierId} onValueChange={(v) => updateField("supplierId", v)}>
                  <SelectTrigger className={errors.supplierId ? "border-destructive" : ""}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.supplierId && <p className="text-sm text-destructive mt-1">{errors.supplierId}</p>}
              </div>
              <div>
                <Label>Purchase Order</Label>
                <Select value={formData.poId} onValueChange={(v) => updateField("poId", v)}>
                  <SelectTrigger className={errors.poId ? "ring-destructive ring-offset-destructive" : ""}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pos.map((poOpt) => (
                      <SelectItem key={poOpt.value} value={poOpt.value}>{poOpt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.poId && <p className="text-sm text-destructive mt-1">{errors.poId}</p>}
                {formData.poNumber && <p className="text-sm text-muted-foreground mt-1">{formData.poNumber}</p>}
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v: string) => updateField("status", v)}>
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

            {/* Items Table */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Received Items
                </h3>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>
              {errors.items && <p className="text-sm text-destructive mb-4">{errors.items}</p>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Ordered Qty</TableHead>
                    <TableHead>Received Qty</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formData.items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Select value={item.itemId} onValueChange={(v) => updateItemField(index, "itemId", v)}>
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((it) => (
                              <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="text-sm text-muted-foreground">{item.itemName}</div>
                      </TableCell>
                      <TableCell className="font-semibold">{item.orderedQty}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-20"
                          value={item.receivedQty || ""}
                          onChange={(e) => updateItemField(index, "receivedQty", Number(e.target.value) || 0)}
                          min={0}
                        />
                      </TableCell>
                      <TableCell className={item.remainingQty < 0 ? "text-destructive font-semibold" : "font-mono"}>
                        {item.remainingQty}
                      </TableCell>
                      <TableCell>{units[0]}</TableCell>
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
              <Button onClick={onSubmit} disabled={createMutation.isPending || updateMutation.isPending} className="flex-1">
                <Save className="h-4 w-4 mr-2" />
                {editingId ? "Update" : "Create"} GRN
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                <X className="h-4 w-4 mr-2" />
                {editingId ? "Cancel" : "Reset"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* List */}
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
                {grns.map((grn: any) => (
                  <TableRow key={grn.GRNID}>
                    <TableCell className="font-semibold">{grn.GRNNo}</TableCell>
                    <TableCell>{grn.PONumber || grn.POID}</TableCell>
                    <TableCell>{grn.SupplierName || grn.SupplierID}</TableCell>
                    <TableCell>{new Date(grn.GRNDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{grn.Status}</Badge>
                    </TableCell>
                    <TableCell>{JSON.parse(grn.GRNItems || '[]').length}</TableCell>
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
                        onClick={() => deleteMutation.mutate(String(grn.GRNID))}
                        className="ml-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {grns.length === 0 && (
              <p className="text-muted-foreground text-center py-8">No GRNs. Create one from a Purchase Order!</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
