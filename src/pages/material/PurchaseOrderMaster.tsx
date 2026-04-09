import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getPurchaseOrders,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
} from '@/api/purchaseOrdersApi'

const FIELDS: FieldDef[] = [
  { name: "poNumber", label: "Purchase Order No", type: "text", required: true, uppercase: true },
  { name: "poDate", label: "PO Date", type: "text", required: true },
  { name: "expectedDate", label: "Expected Delivery", type: "text", required: true },
  {
    name: "supplier",
    label: "Supplier",
    type: "select",
    required: true,
    options: [
      "Shree Cement Distributors",
      "Metro Steel Traders",
      "Prime Electricals",
      "Apex Plumbing Supplies",
      "BuildWell Aggregates",
    ],
  },
  {
    name: "projectSite",
    label: "Project / Site",
    type: "select",
    required: true,
    options: [
      "Riverfront Residency",
      "Skyline Tower A",
      "Industrial Shed Phase 2",
      "Green Valley Villas",
      "Highway Utility Block",
    ],
  },
  { name: "itemDescription", label: "Item Description", type: "textarea", required: true, fullWidth: true },
  { name: "quantity", label: "Quantity", type: "number", required: true },
  { name: "unit", label: "Unit", type: "text", required: true },
  { name: "rate", label: "Rate", type: "number", required: true, prefix: "₹" },
  { name: "totalAmount", label: "Total Amount", type: "number", required: true, prefix: "₹" },
  { name: "paymentTerms", label: "Payment Terms", type: "textarea" },
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: ["Draft", "Issued", "Partially Received", "Received", "Closed"],
  },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
];

const COLUMNS: ColumnDef[] = [
  { key: "poNumber", label: "PO No" },
  { key: "supplier", label: "Supplier" },
  { key: "projectSite", label: "Project / Site", hideOnMobile: true },
  { key: "itemDescription", label: "Item", hideOnMobile: true },
  { key: "quantity", label: "Qty" },
  { key: "totalAmount", label: "Amount" },
  { key: "status", label: "Status" },
];



const PurchaseOrderMaster = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: getPurchaseOrders,
  })

  const dbItems = Array.isArray(dbData) ? dbData : []

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id: String(item.POId || item.id || item._id),
    poNumber: item.PONumber || item.poNumber || '',
    poDate: item.PODate || item.poDate || '',
    expectedDate: item.ExpectedDate || item.expectedDate || '',
    supplier: item.Supplier || item.supplier || '',
    projectSite: item.ProjectSite || item.projectSite || '',
    itemDescription: item.ItemDescription || item.itemDescription || '',
    quantity: item.Quantity || item.quantity || 0,
    unit: item.Unit || item.unit || '',
    rate: item.Rate || item.rate || 0,
    totalAmount: item.TotalAmount || item.totalAmount || 0,
    paymentTerms: item.PaymentTerms || item.paymentTerms || '',
    status: item.Status || item.status || 'Draft',
    remarks: item.Remarks || item.remarks || '',
  }))

  const toPayload = (r: Record<string, unknown>) => ({
    PONumber: (r.poNumber as string) || null,
    PODate: (r.poDate as string) || null,
    ExpectedDate: (r.expectedDate as string) || null,
    Supplier: (r.supplier as string) || null,
    ProjectSite: (r.projectSite as string) || null,
    ItemDescription: (r.itemDescription as string) || null,
    Quantity: Number(r.quantity) || 0,
    Unit: (r.unit as string) || null,
    Rate: Number(r.rate) || 0,
    TotalAmount: Number(r.totalAmount) || 0,
    PaymentTerms: (r.paymentTerms as string) || null,
    Status: (r.status as string) || 'Draft',
    Remarks: (r.remarks as string) || null,
  })

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addPurchaseOrder(toPayload(event.record))
        toast.success('Purchase Order saved!')
        await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updatePurchaseOrder(event.id, toPayload(event.record))
        toast.success('Purchase Order updated!')
        await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deletePurchaseOrder(event.id)
        toast.success('Purchase Order deleted!')
        await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  const columnRenderers = {
    poDate: (value: unknown) => {
      const date = new Date(String(value));
      return isNaN(date.getTime())
        ? String(value ?? "")
        : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    },
    totalAmount: (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (value: unknown) => {
      const status = String(value ?? "");
      const statusClasses: Record<string, string> = {
        Draft: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700",
        Issued: "bg-blue-50/70 text-blue-600/90 border-blue-200/70 dark:bg-blue-900/10 dark:text-blue-400/80 dark:border-blue-800/60",
        "Partially Received": "bg-amber-50/70 text-amber-600/90 border-amber-200/70 dark:bg-amber-900/10 dark:text-amber-400/80 dark:border-amber-800/60",
        Received: "bg-green-50/70 text-green-700/80 border-green-200/70 dark:bg-green-900/10 dark:text-green-400/70 dark:border-green-800/60",
        Closed: "bg-muted/60 text-muted-foreground/70 border-border/60",
      };
      return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-heading ${statusClasses[status] || "bg-muted text-muted-foreground border-border"}`}>
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      );
    },
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading purchase orders...</div>
  if (error) return <div className="p-6 text-destructive">Failed to load purchase orders.</div>

  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Material', 'Purchase Order Master']} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Purchase Order Master</h1>
      <MasterPage
        title="Purchase Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={mappedData}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default PurchaseOrderMaster

