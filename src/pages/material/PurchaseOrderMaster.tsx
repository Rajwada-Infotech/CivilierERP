import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useFinYear } from "@/contexts/FinYearContext";
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
  getItemsWithGST,
  type POLineItem,
  type CreatePOPayload,
  type PurchaseOrder,
} from "@/api/purchaseOrdersApi";

export default function PurchaseOrderMaster() {
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const [page, setPage] = useState(1);
  const limit = 10;

  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | number | null>(null);

  // Fin year
  const activeFinYear = finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter((fy) => fy.status === "Active");
  const [selectedFinYear, setSelectedFinYear] = useState("");

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) {
      setSelectedFinYear(activeFinYear);
    }
  }, [activeFinYear, selectedFinYear]);

  // Document Numbering
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);

  // Form State
  const defaultForm: CreatePOPayload = {
    PurchaseOrderNo: "",
    PODate: new Date().toISOString().split("T")[0],
    ExpectedDeliveryDate: "",
    SupplierID: "",
    CompanyId: "",
    ProjectId: "",
    POItems: [],
    PaymentTerms: "",
    Status: "Draft",
    Remarks: "",
    DocTypeId: null,
    DocNo: "",
    finYear: "",
  };
  const [formData, setFormData] = useState<CreatePOPayload>(defaultForm);

  // Queries
  const { data: dbData, isLoading, error } = useQuery({
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
    queryKey: ["items-with-gst"],
    queryFn: getItemsWithGST,
  });

  const uoms = (uomsRaw as any[]).filter((u) => u.IsActive !== false && u.IsActive !== 0);

  // Helper arrays
  const dbItems: PurchaseOrder[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  const handleEdit = (po: PurchaseOrder) => {
    setEditingId(po.PurchaseOrderID);
    setPoDocTypeId(po.DocTypeId ?? null);
    setPoDocNo(po.DocNo ?? "");
    setFormData({
      PurchaseOrderNo: po.PurchaseOrderNo ?? "",
      PODate: po.PODate ? new Date(po.PODate).toISOString().split("T")[0] : "",
      ExpectedDeliveryDate: po.ExpectedDeliveryDate ? new Date(po.ExpectedDeliveryDate).toISOString().split("T")[0] : "",
      SupplierID: po.SupplierID ?? "",
      CompanyId: po.CompanyId ?? "",
      ProjectId: po.ProjectId ?? "",
      POItems: po.POItems ?? [],
      PaymentTerms: po.PaymentTerms ?? "",
      Status: po.Status ?? "Draft",
      Remarks: po.Remarks ?? "",
      DocTypeId: po.DocTypeId ?? null,
      DocNo: po.DocNo ?? "",
      finYear: selectedFinYear,
    });
    setView("form");
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this Purchase Order?")) return;
    try {
      await deletePurchaseOrder(id);
      toast.success("Purchase Order deleted!");
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const handleSave = async () => {
    try {
      // Basic validation
      if (!formData.SupplierID) return toast.error("Supplier is required");
      if (!formData.POItems || formData.POItems.length === 0) return toast.error("At least one item is required");

      // Calculate TotalAmount on the fly to ensure accuracy
      let total = 0;
      const enrichedItems = formData.POItems.map(item => {
        const amt = item.quantity * item.rate * (1 + item.tax / 100);
        total += amt;
        return { ...item, amount: amt };
      });

      const payload = {
        ...formData,
        POItems: enrichedItems,
        TotalAmount: total,
        DocTypeId: poDocTypeId,
        DocNo: poDocNo,
        PurchaseOrderNo: poDocNo || formData.PurchaseOrderNo,
        finYear: selectedFinYear,
      };

      if (editingId) {
        await updatePurchaseOrder(editingId, payload);
        toast.success("Purchase Order updated successfully!");
      } else {
        await addPurchaseOrder(payload);
        toast.success("Purchase Order created successfully!");
      }
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setView("list");
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    }
  };

  // PO Items management
  const addPoItem = () => {
    setFormData(prev => ({
      ...prev,
      POItems: [
        ...(prev.POItems || []),
        { itemId: "", itemName: "", itemDescription: "", unit: "", quantity: 1, rate: 0, tax: 0, amount: 0 }
      ]
    }));
  };

  const updatePoItem = (index: number, field: keyof POLineItem, value: any) => {
    setFormData(prev => {
      const newItems = [...(prev.POItems || [])];
      newItems[index] = { ...newItems[index], [field]: value };
      
      // Auto calc amount
      const item = newItems[index];
      item.amount = item.quantity * item.rate * (1 + item.tax / 100);

      return { ...prev, POItems: newItems };
    });
  };

  const handleItemSelect = (index: number, itemId: string) => {
    const selectedItem = itemsRaw.find((i: any) => i.id === itemId);
    setFormData(prev => {
      const newItems = [...(prev.POItems || [])];
      newItems[index] = {
        ...newItems[index],
        itemId,
        itemName: selectedItem?.name || "",
        itemDescription: selectedItem?.name || "",
        tax: selectedItem?.gstRate || 0,
      };
      const item = newItems[index];
      item.amount = item.quantity * item.rate * (1 + item.tax / 100);
      return { ...prev, POItems: newItems };
    });
  };

  const removePoItem = (index: number) => {
    setFormData(prev => {
      const newItems = [...(prev.POItems || [])];
      newItems.splice(index, 1);
      return { ...prev, POItems: newItems };
    });
  };

  const grandTotal = formData.POItems?.reduce((sum, item) => sum + (item.quantity * item.rate * (1 + item.tax / 100)), 0) || 0;

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading purchase orders...</div>;
  if (error) return <div className="p-6 text-destructive">Failed to load purchase orders.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order Master"]} />
      
      {view === "list" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-heading font-bold text-foreground">Purchase Order Master</h1>
            <button
              onClick={() => {
                setEditingId(null);
                setFormData(defaultForm);
                setPoDocTypeId(null);
                setPoDocNo("");
                setView("form");
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              + Create PO
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="p-3 font-heading font-semibold">PO No</th>
                  <th className="p-3 font-heading font-semibold">Date</th>
                  <th className="p-3 font-heading font-semibold">Supplier</th>
                  <th className="p-3 font-heading font-semibold">Amount</th>
                  <th className="p-3 font-heading font-semibold">Status</th>
                  <th className="p-3 font-heading font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dbItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      No purchase orders found.
                    </td>
                  </tr>
                ) : (
                  dbItems.map((po) => (
                    <tr key={po.PurchaseOrderID} className="hover:bg-muted/50 transition-colors">
                      <td className="p-3">{po.PurchaseOrderNo}</td>
                      <td className="p-3">{po.PODate ? new Date(po.PODate).toLocaleDateString() : ""}</td>
                      <td className="p-3">{po.SupplierName}</td>
                      <td className="p-3">₹{Number(po.TotalAmount || 0).toLocaleString("en-IN")}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={po.Status ?? ""} />
                          <ApprovalActions
                            status={po.Status ?? ""}
                            recordId={String(po.PurchaseOrderID)}
                            endpoint="/api/purchase-orders"
                            onSuccess={() => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })}
                          />
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleEdit(po)}
                          className="text-primary hover:underline mr-3 font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(po.PurchaseOrderID)}
                          className="text-destructive hover:underline font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {totalPages} ({totalRecords} records)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-muted"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "form" && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
            <h2 className="text-xl font-heading font-bold text-foreground">
              {editingId ? "Edit Purchase Order" : "Create Purchase Order"}
            </h2>
            <button
              onClick={() => setView("list")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to List
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4 border border-border">
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1">
                  Fin Year
                </label>
                <select
                  value={selectedFinYear}
                  onChange={(e) => {
                    const nextFinYear = e.target.value;
                    setSelectedFinYear(nextFinYear);
                    setDocRefreshTrigger(t => t + 1);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Fin Year...</option>
                  {finYearOptions.map((fy) => (
                    <option key={fy.id} value={fy.year}>{fy.year}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-1">
                  Document Type & Number
                </label>
                <DocNumberPreview
                  module="PO"
                  finYear={selectedFinYear || undefined}
                  selectedDocTypeId={poDocTypeId}
                  preview={poDocNo}
                  refreshTrigger={docRefreshTrigger}
                  onSelect={(docTypeId, docNo) => {
                    setPoDocTypeId(docTypeId);
                    setPoDocNo(docNo);
                    setFormData(prev => ({ ...prev, DocTypeId: docTypeId, DocNo: docNo, PurchaseOrderNo: docNo }));
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">PO Date</label>
              <input
                type="date"
                value={formData.PODate || ""}
                onChange={(e) => setFormData({ ...formData, PODate: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Expected Delivery</label>
              <input
                type="date"
                value={formData.ExpectedDeliveryDate || ""}
                onChange={(e) => setFormData({ ...formData, ExpectedDeliveryDate: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Status</label>
              <select
                value={formData.Status}
                onChange={(e) => setFormData({ ...formData, Status: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="Draft">Draft</option>
                <option value="Issued">Issued</option>
                <option value="Partially Received">Partially Received</option>
                <option value="Received">Received</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Supplier *</label>
              <select
                value={formData.SupplierID || ""}
                onChange={(e) => setFormData({ ...formData, SupplierID: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select Supplier...</option>
                {suppliersRaw.map((s: any) => (
                  <option key={s.LHeadId} value={s.LHeadId}>{s.LHeadName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Company</label>
              <select
                value={formData.CompanyId || ""}
                onChange={(e) => {
                  setFormData({ ...formData, CompanyId: e.target.value, ProjectId: "" });
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Company...</option>
                {companiesRaw.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Project / Site</label>
              <select
                value={formData.ProjectId || ""}
                onChange={(e) => setFormData({ ...formData, ProjectId: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Project...</option>
                {projectsRaw.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Line Items Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-heading font-semibold text-foreground">Line Items</h3>
              <button
                onClick={addPoItem}
                className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                + Add Item
              </button>
            </div>
            
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="p-2 font-medium w-48">Item</th>
                    <th className="p-2 font-medium w-48">Description</th>
                    <th className="p-2 font-medium w-24">Qty</th>
                    <th className="p-2 font-medium w-32">Unit</th>
                    <th className="p-2 font-medium w-24">Rate (₹)</th>
                    <th className="p-2 font-medium w-24">GST (%)</th>
                    <th className="p-2 font-medium w-32">Amount (₹)</th>
                    <th className="p-2 font-medium w-16 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {formData.POItems?.map((item, idx) => (
                    <tr key={idx} className="group">
                      <td className="p-2">
                        <select
                          value={item.itemId || ""}
                          onChange={(e) => handleItemSelect(idx, e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">Select Item...</option>
                          {itemsRaw.map((i: any) => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.itemDescription}
                          onChange={(e) => updatePoItem(idx, "itemDescription", e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          value={item.quantity || ""}
                          onChange={(e) => updatePoItem(idx, "quantity", Number(e.target.value))}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={item.unit}
                          onChange={(e) => updatePoItem(idx, "unit", e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">Select Unit...</option>
                          {uoms.map((u: any) => (
                            <option key={u.Id} value={u.UOMName}>{u.UOMName}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          value={item.rate || ""}
                          onChange={(e) => updatePoItem(idx, "rate", Number(e.target.value))}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          value={item.tax ?? ""}
                          onChange={(e) => updatePoItem(idx, "tax", Number(e.target.value))}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>
                      <td className="p-2 font-medium">
                        ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => removePoItem(idx)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!formData.POItems || formData.POItems.length === 0) && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground bg-muted/20">
                        No items added yet. Click "+ Add Item" to begin.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t border-border bg-muted/30">
                  <tr>
                    <td colSpan={6} className="p-3 text-right font-medium text-foreground">Grand Total:</td>
                    <td colSpan={2} className="p-3 font-bold text-primary text-base">
                      ₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Payment Terms</label>
              <textarea
                value={formData.PaymentTerms || ""}
                onChange={(e) => setFormData({ ...formData, PaymentTerms: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Remarks</label>
              <textarea
                value={formData.Remarks || ""}
                onChange={(e) => setFormData({ ...formData, Remarks: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button
              onClick={() => setView("list")}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {editingId ? "Update PO" : "Save PO"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}