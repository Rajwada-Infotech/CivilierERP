import React, { useEffect, useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
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
  getAllEnterprises,
  getUOMs,
} from "@/api/purchaseOrdersApi";

const PurchaseOrderMaster = () => {
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const [page, setPage] = useState(1);
  const limit = 10;

  // Tracks selected company id so we can filter the project dropdown client-side
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(
    null,
  );
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
    if (!selectedFinYear && activeFinYear) {
      setSelectedFinYear(activeFinYear);
    }
  }, [activeFinYear, selectedFinYear]);

  const applyPoDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
    setPoDocNo(docNo);
    setPoFormPatch({
      poNumber: docNo,
      docNo,
      docTypeId,
    });
    setPoFormPatchKey((current) => current + 1);
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
    setDocRefreshTrigger((current) => current + 1);
    return nextDocNo;
  };

  // ── Remote data ──────────────────────────────────────────────────────────────
  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["purchase-orders", page, limit],
    queryFn: () => getPurchaseOrders({ page, limit }),
  });

  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });

  // Single fetch for ALL enterprise rows — we split into companies/projects below
  const { data: enterprisesRaw = [] } = useQuery({
    queryKey: ["all-enterprises"],
    queryFn: getAllEnterprises,
  });

  // UOMMaster — fields: Id, UOMName (confirmed from uomMaster.js SELECT query)
  const { data: uomsRaw = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUOMs,
  });

  // ── Normalise raw data ───────────────────────────────────────────────────────
  const suppliers: Array<{ id: number; name: string }> = (
    suppliersRaw as any[]
  ).map((s) => ({ id: s.LHeadId, name: s.LHeadName }));

  // Split enterprises into companies (business_type = 'C') and projects (business_type = 'P')
  const allEnterprises: Array<{
    id: number;
    name: string;
    businessType: string;
    belongsTo: number | null;
  }> = (enterprisesRaw as any[]).map((e) => ({
    id: e.id,
    name: e.name ?? "",
    businessType: e.business_type ?? "",
    belongsTo: e.belongs_to ?? null,
  }));

  const companies = useMemo(
    () => allEnterprises.filter((e) => e.businessType === "C"),
    [allEnterprises],
  );

  // All projects (business_type = 'P') — filtered further by selected company below
  const allProjects = useMemo(
    () => allEnterprises.filter((e) => e.businessType === "P"),
    [allEnterprises],
  );

  // When a company is selected → show only its projects (belongs_to = company id)
  // When no company selected → show all projects
  const filteredProjects = useMemo(
    () =>
      selectedCompanyId
        ? allProjects.filter((p) => p.belongsTo === selectedCompanyId)
        : allProjects,
    [allProjects, selectedCompanyId],
  );

  // UOM: field names from DB are "Id" and "UOMName" (confirmed from uomMaster.js)
  // Only show active UOMs (IsActive = true/1)
  const uoms: Array<{ id: number; name: string }> = (uomsRaw as any[])
    .filter((u) => u.IsActive !== false && u.IsActive !== 0)
    .map((u) => ({ id: u.Id, name: u.UOMName ?? "" }))
    .filter((u) => u.name !== "");

  // ── Dropdown option string arrays ────────────────────────────────────────────
  const supplierOptions = suppliers.map((s) => s.name);
  const companyOptions = companies.map((c) => c.name);
  const projectOptions = filteredProjects.map((p) => p.name);
  const uomOptions = uoms.map((u) => u.name);

  // ── Pagination ───────────────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  // ── Map DB rows → UI records ─────────────────────────────────────────────────
  const mappedData: RecordWithId[] = dbItems.map((item) => {
    const supplierName =
      suppliers.find((s) => s.id === item.SupplierID)?.name ??
      item.SupplierName ??
      "";
    const companyName =
      companies.find((c) => c.id === item.CompanyId)?.name ??
      item.CompanyName ??
      "";
    const projectName =
      allProjects.find((p) => p.id === item.ProjectId)?.name ??
      item.ProjectName ??
      "";

    return {
      _id: String(item.PurchaseOrderID ?? ""),
      poNumber: item.PurchaseOrderNo ?? "",
      poDate: item.PODate ?? "",
      expectedDate: item.ExpectedDeliveryDate ?? "",
      supplierName,
      companyName,
      projectName,
      itemDescription: item.ItemDescription ?? "",
      quantity: Number(item.Quantity ?? 0),
      unit: item.Unit ?? "",
      rate: Number(item.Rate ?? 0),
      totalAmount: Number(item.TotalAmount ?? 0),
      paymentTerms: item.PaymentTerms ?? "",
      status: item.Status ?? "Draft",
      remarks: item.Remarks ?? "",
      docTypeId: item.DocTypeId ?? null,
      docNo: item.DocNo ?? "",
      docTypePrefix: item.DocTypePrefix ?? "",
    };
  });

  // ── Map UI record → DB payload ───────────────────────────────────────────────
  const toPayload = (r: Record<string, unknown>) => {
    const supplier = suppliers.find(
      (s) => s.name === (r.supplierName as string),
    );
    const company = companies.find((c) => c.name === (r.companyName as string));
    const project = allProjects.find(
      (p) => p.name === (r.projectName as string),
    );
    const finalNumber = (r.poNumber as string) || null;
    return {
      PurchaseOrderNo: finalNumber,
      PODate: (r.poDate as string) || null,
      ExpectedDeliveryDate: (r.expectedDate as string) || null,
      SupplierID: supplier?.id ?? null,
      CompanyId: company?.id ?? null,
      ProjectId: project?.id ?? null,
      ItemDescription: (r.itemDescription as string) || null,
      Quantity: Number(r.quantity) || 0,
      Unit: (r.unit as string) || null,
      Rate: Number(r.rate) || 0,
      TotalAmount: Number(r.totalAmount) || 0,
      PaymentTerms: (r.paymentTerms as string) || null,
      Status: (r.status as string) || "Draft",
      Remarks: (r.remarks as string) || null,
      DocTypeId: (r.docTypeId as number | null) ?? poDocTypeId,
      DocNo: finalNumber || (r.docNo as string) || poDocNo || null,
      finYear: selectedFinYear || null,
    };
  };

  // ── CRUD handler ─────────────────────────────────────────────────────────────
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addPurchaseOrder(toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order created successfully!");
        const savedDocTypeId =
          (event.record.docTypeId as number | null) ?? poDocTypeId;
        const nextDocNo = await refreshPoDocNumber(savedDocTypeId);
        return {
          poNumber: nextDocNo,
          docNo: nextDocNo,
          docTypeId: savedDocTypeId,
        };
      } else if (event.action === "update") {
        await updatePurchaseOrder(event.id, toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order updated successfully!");
      } else if (event.action === "delete") {
        await deletePurchaseOrder(event.id);
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        setPage(1);
        toast.success("Purchase Order deleted successfully!");
      }
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
      throw err;
    }
    return undefined;
  };

  // ── Reactive field logic ─────────────────────────────────────────────────────
  const handleFieldChange = (
    record: Record<string, any>,
    fieldName: string,
  ) => {
    let updated = { ...record };

    // Auto-calculate Total Amount
    if (fieldName === "quantity" || fieldName === "rate") {
      const qty = Number(updated.quantity) || 0;
      const rate = Number(updated.rate) || 0;
      updated = { ...updated, totalAmount: qty * rate };
    }

    // When Company changes:
    //  1. Update selectedCompanyId → filteredProjects recomputes via useMemo
    //  2. Clear projectName so stale value isn't carried forward
    if (fieldName === "companyName") {
      const matched = companies.find((c) => c.name === updated.companyName);
      setSelectedCompanyId(matched?.id ?? null);
      updated = { ...updated, projectName: "" };
    }

    return updated;
  };

  const refetchPOs = () =>
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });

  // ── Column renderers ─────────────────────────────────────────────────────────
  const columnRenderers = {
    poDate: (value: unknown) => {
      const d = new Date(String(value));
      return isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
    },
    totalAmount: (value: unknown) =>
      `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (_value: unknown, row: RecordWithId) => (
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={String(row.status ?? "")} />
        <ApprovalActions
          status={String(row.status ?? "")}
          recordId={row._id}
          endpoint="/api/purchase-orders"
          onSuccess={refetchPOs}
        />
      </div>
    ),
  };

  // ── Field definitions ────────────────────────────────────────────────────────
  // NOTE: projectOptions is derived from filteredProjects which updates automatically
  // when selectedCompanyId changes — MasterPage will re-render with fresh options.
  const FIELDS: FieldDef[] = [
    {
      name: "poNumber",
      label: "Purchase Order No",
      type: "text",
      required: true,
      uppercase: true,
    },
    { name: "poDate", label: "PO Date", type: "date", required: true },
    {
      name: "expectedDate",
      label: "Expected Delivery",
      type: "date",
      required: true,
    },
    {
      name: "supplierName",
      label: "Supplier",
      type: "select",
      required: true,
      options: supplierOptions,
    },
    {
      // Filtered client-side: only enterprise rows where business_type = 'C'
      name: "companyName",
      label: "Company Name",
      type: "select",
      options: companyOptions,
    },
    {
      // Filtered client-side: business_type = 'P', further narrowed by belongs_to
      // when a company is selected above
      name: "projectName",
      label: "Project / Site",
      type: "select",
      options: projectOptions,
    },
    {
      name: "itemDescription",
      label: "Item Description",
      type: "textarea",
      required: true,
      fullWidth: true,
    },
    { name: "quantity", label: "Quantity", type: "number", required: true },
    {
      // UOM dropdown — data from dbo.UOMMaster via GET /api/uom-master
      // DB fields used: Id (id), UOMName (name) — only IsActive records shown
      name: "unit",
      label: "Unit",
      type: "select",
      required: true,
      options: uomOptions,
    },
    { name: "rate", label: "Rate (₹)", type: "number", required: true },
    {
      name: "totalAmount",
      label: "Total Amount (₹)",
      type: "number",
      required: true,
      prefix: "₹",
    },
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

  // ── Column definitions ───────────────────────────────────────────────────────
  const COLUMNS: ColumnDef[] = [
    { key: "poNumber", label: "PO No" },
    { key: "docNo", label: "Doc No" },
    { key: "supplierName", label: "Supplier" },
    { key: "companyName", label: "Company", hideOnMobile: true },
    { key: "projectName", label: "Project / Site", hideOnMobile: true },
    { key: "itemDescription", label: "Item", hideOnMobile: true },
    { key: "quantity", label: "Qty", hideOnMobile: true },
    { key: "unit", label: "Unit", hideOnMobile: true },
    { key: "totalAmount", label: "Amount" },
    { key: "status", label: "Status" },
  ];

  const EXPORT_COLUMNS: ExportColumn[] = [
    { header: "PO No", accessor: "poNumber" },
    { header: "Doc No", accessor: "docNo" },
    { header: "Supplier", accessor: "supplierName" },
    { header: "Company", accessor: "companyName" },
    { header: "Project / Site", accessor: "projectName" },
    { header: "Item", accessor: "itemDescription" },
    { header: "Qty", accessor: "quantity" },
    { header: "Unit", accessor: "unit" },
    { header: "Amount", accessor: "totalAmount" },
    { header: "Status", accessor: "status" },
    { header: "Remarks", accessor: "remarks" },
  ];

  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground">
        Loading purchase orders...
      </div>
    );
  if (error)
    return (
      <div className="p-6 text-destructive">
        Failed to load purchase orders.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Purchase Order Master
      </h1>
      <div className="mb-4 rounded-xl bg-card border border-border p-4">
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
          Fin Year
        </label>
        <select
          value={selectedFinYear}
          onChange={(e) => {
            const nextFinYear = e.target.value;
            setSelectedFinYear(nextFinYear);
            if (poDocTypeId) void refreshPoDocNumber(poDocTypeId, nextFinYear);
          }}
          className="mb-4 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select Fin Year...</option>
          {finYearOptions.map((fy) => (
            <option key={fy.id} value={fy.year}>
              {fy.year}
            </option>
          ))}
        </select>
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
          Document Type &amp; Number
        </label>
        <DocNumberPreview
          finYear={selectedFinYear || undefined}
          selectedDocTypeId={poDocTypeId}
          preview={poDocNo}
          refreshTrigger={docRefreshTrigger}
          onSelect={applyPoDocNumber}
        />
      </div>
      <MasterPage
        title="Purchase Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={mappedData}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
        onFieldChange={handleFieldChange}
        externalFormPatch={poFormPatch}
        externalFormPatchKey={poFormPatchKey}
      />
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages} ({totalRecords} records)
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default PurchaseOrderMaster;
