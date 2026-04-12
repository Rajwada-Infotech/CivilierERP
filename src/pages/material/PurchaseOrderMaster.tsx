import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getPurchaseOrders,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getSuppliers,
  getProjects,
} from "@/api/purchaseOrdersApi";

const PurchaseOrderMaster = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: getPurchaseOrders,
  });

  // Suppliers from AccountHeadMaster (type=Supplier) → { LHeadId, LHeadName }
  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });

  // Projects from enterprise table → { id, name }
  const { data: projectsRaw = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });

  const suppliers: Array<{ id: number; name: string }> = (
    suppliersRaw as any[]
  ).map((s) => ({ id: s.LHeadId, name: s.LHeadName }));

  const projects: Array<{ id: number; name: string }> = (
    projectsRaw as any[]
  ).map((p) => ({ id: p.id, name: p.name || p.Name || "" }));

  const supplierOptions = suppliers.map((s) => s.name);
  const projectOptions  = projects.map((p)  => p.name);

  const dbItems = Array.isArray(dbData) ? dbData : [];

  // Map DB rows → UI record
  // supplierID / projectId stored as integers in DB; display as names in UI
  const mappedData: RecordWithId[] = dbItems.map((item) => {
    const supplierName =
      suppliers.find((s) => s.id === item.SupplierID)?.name ??
      item.SupplierName ??
      "";
    const projectName =
      projects.find((p) => p.id === item.ProjectId)?.name ??
      item.ProjectName ??
      "";

    return {
      _id:             String(item.PurchaseOrderID ?? ""),
      poNumber:        item.PurchaseOrderNo        ?? "",
      poDate:          item.PODate                 ?? "",
      expectedDate:    item.ExpectedDeliveryDate   ?? "",
      supplierName,
      projectName,
      itemDescription: item.ItemDescription        ?? "",
      quantity:        Number(item.Quantity  ?? 0),
      unit:            item.Unit             ?? "",
      rate:            Number(item.Rate      ?? 0),
      totalAmount:     Number(item.TotalAmount ?? 0),
      paymentTerms:    item.PaymentTerms     ?? "",
      status:          item.Status           ?? "Draft",
      remarks:         item.Remarks          ?? "",
    };
  });

  // Map UI record → DB payload (resolve names back to integer FKs)
  const toPayload = (r: Record<string, unknown>) => {
    const supplier = suppliers.find((s) => s.name === (r.supplierName as string));
    const project  = projects.find((p)  => p.name === (r.projectName  as string));
    return {
      PurchaseOrderNo:     (r.poNumber        as string) || null,
      PODate:              (r.poDate          as string) || null,
      ExpectedDeliveryDate:(r.expectedDate    as string) || null,
      SupplierID:          supplier?.id ?? null,
      ProjectId:           project?.id  ?? null,
      ItemDescription:     (r.itemDescription as string) || null,
      Quantity:            Number(r.quantity)     || 0,
      Unit:                (r.unit as string)     || null,
      Rate:                Number(r.rate)         || 0,
      TotalAmount:         Number(r.totalAmount)  || 0,
      PaymentTerms:        (r.paymentTerms as string) || null,
      Status:              (r.status as string)   || "Draft",
      Remarks:             (r.remarks as string)  || null,
    };
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addPurchaseOrder(toPayload(event.record));
        toast.success("Purchase Order created successfully!");
      } else if (event.action === "update") {
        await updatePurchaseOrder(event.id, toPayload(event.record));
        toast.success("Purchase Order updated successfully!");
      } else if (event.action === "delete") {
        await deletePurchaseOrder(event.id);
        toast.success("Purchase Order deleted successfully!");
      }
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    }
  };

  // Auto-calculate Total Amount when quantity or rate changes
  const handleFieldChange = (
    record: Record<string, any>,
    fieldName: string,
  ) => {
    if (fieldName === "quantity" || fieldName === "rate") {
      const qty     = Number(record.quantity) || 0;
      const rateVal = Number(record.rate)     || 0;
      return { ...record, totalAmount: qty * rateVal };
    }
    return record;
  };

  const columnRenderers = {
    poDate: (value: unknown) => {
      const d = new Date(String(value));
      return isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-IN", {
            day:   "2-digit",
            month: "short",
            year:  "numeric",
          });
    },
    totalAmount: (value: unknown) =>
      `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (value: unknown) => {
      const s = String(value ?? "");
      const cls: Record<string, string> = {
        Draft:               "bg-slate-100 text-slate-500 border-slate-200",
        Issued:              "bg-blue-50 text-blue-600 border-blue-200",
        "Partially Received":"bg-amber-50 text-amber-600 border-amber-200",
        Received:            "bg-green-50 text-green-700 border-green-200",
        Closed:              "bg-muted text-muted-foreground border-border",
      };
      return (
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-heading ${cls[s] ?? "bg-muted text-muted-foreground border-border"}`}
        >
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
          {s}
        </span>
      );
    },
  };

  const FIELDS: FieldDef[] = [
    {
      name:      "poNumber",
      label:     "Purchase Order No",
      type:      "text",
      required:  true,
      uppercase: true,
    },
    { name: "poDate",       label: "PO Date",            type: "date", required: true },
    { name: "expectedDate", label: "Expected Delivery",  type: "date", required: true },
    {
      name:     "supplierName",
      label:    "Supplier",
      type:     "select",
      required: true,
      options:  supplierOptions,
    },
    {
      name:    "projectName",
      label:   "Project / Site",
      type:    "select",
      options: projectOptions,
    },
    {
      name:      "itemDescription",
      label:     "Item Description",
      type:      "textarea",
      required:  true,
      fullWidth: true,
    },
    { name: "quantity", label: "Quantity",     type: "number", required: true },
    { name: "unit",     label: "Unit",         type: "text",   required: true },
    { name: "rate",     label: "Rate (₹)",     type: "number", required: true },
    {
      name:      "totalAmount",
      label:     "Total Amount (₹)",
      type:      "number",
      required:  true,
      readOnly:  true,
      prefix:    "₹",
    },
    { name: "paymentTerms", label: "Payment Terms", type: "textarea" },
    {
      name:     "status",
      label:    "Status",
      type:     "select",
      required: true,
      options:  ["Draft", "Issued", "Partially Received", "Received", "Closed"],
    },
    { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  ];

  const COLUMNS: ColumnDef[] = [
    { key: "poNumber",        label: "PO No" },
    { key: "supplierName",    label: "Supplier" },
    { key: "projectName",     label: "Project / Site", hideOnMobile: true },
    { key: "itemDescription", label: "Item",           hideOnMobile: true },
    { key: "quantity",        label: "Qty",            hideOnMobile: true },
    { key: "totalAmount",     label: "Amount" },
    { key: "status",          label: "Status" },
  ];

  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground">Loading purchase orders...</div>
    );
  if (error)
    return (
      <div className="p-6 text-destructive">Failed to load purchase orders.</div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Purchase Order Master
      </h1>
      <MasterPage
        title="Purchase Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={mappedData}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
        onFieldChange={handleFieldChange}
      />
    </>
  );
};

export default PurchaseOrderMaster;
