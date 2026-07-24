import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  getVendorPaymentTerms,
  addVendorPaymentTerm,
  updateVendorPaymentTerm,
  deleteVendorPaymentTerm,
  type VendorPaymentTermRow,
} from "@/api/vendorPaymentTermApi";

const mapRow = (row: VendorPaymentTermRow): Record<string, unknown> => ({
  _id: String(row.PaymentTermId),
  Description: row.Description,
  Days: row.Days,
  IsActive: Boolean(row.IsActive),
});

const PaymentTermMaster: React.FC = () => {
  const rights = usePageRights("payment-terms");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    const fresh = await getVendorPaymentTerms();
    setRows(fresh.map(mapRow));
  };

  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load payment terms"))
      .finally(() => setLoading(false));
  }, []);

  const fields: FieldDef[] = [
    {
      name: "Description",
      label: "Description",
      type: "text",
      required: true,
      fullWidth: true,
      placeholder: "e.g. Net 30",
    },
    {
      name: "Days",
      label: "Days (from Vendor Invoice Date to Due Date)",
      type: "number",
      required: true,
      placeholder: "e.g. 30",
    },
    { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "Description", label: "Description" },
    { key: "Days", label: "Days" },
    { key: "IsActive", label: "Status" },
  ];

  const columnRenderers = {
    Days: (value: unknown) => (
      <span className="font-mono text-xs font-semibold text-foreground">
        {String(value ?? "")} days
      </span>
    ),
    IsActive: (value: unknown) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value
            ? "bg-primary/10 text-primary border-primary/20"
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
            value ? "bg-primary" : "bg-destructive"
          }`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const record = event.record as Record<string, unknown>;
        await addVendorPaymentTerm({
          Description: String(record.Description ?? "").trim(),
          Days: Number(record.Days) || 0,
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
        });
        toast.success("Payment term added!");
        await refetch();
      } else if (event.action === "update") {
        const record = event.record as Record<string, unknown>;
        await updateVendorPaymentTerm(Number(event.id), {
          Description: String(record.Description ?? "").trim(),
          Days: Number(record.Days) || 0,
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
        });
        toast.success("Payment term updated!");
        await refetch();
      } else if (event.action === "delete") {
        await deleteVendorPaymentTerm(Number(event.id));
        toast.success("Payment term deleted!");
        await refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Masters", "Payment Terms"]} />
      <MaterialShell
        title="Payment Terms"
        subtitle="Net-day terms for POs and invoices — due date = vendor invoice date + days"
        icon={CalendarClock}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading payment terms…</span>
          </div>
        ) : (
          <MasterPage
            title="Payment Term"
            fields={fields}
            columns={columns}
            columnRenderers={columnRenderers}
            initialData={rows}
            onDataEvent={handleDataEvent}
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            exportConfig={
              rights.canExport
                ? {
                    title: "Payment Terms Master",
                    filename: "payment-terms-master",
                    columns: [
                      { header: "Description", accessor: "Description" },
                      { header: "Days", accessor: "Days" },
                      {
                        header: "Status",
                        accessor: (r) => (r.IsActive ? "Active" : "Inactive"),
                      },
                    ],
                  }
                : undefined
            }
          />
        )}
      </MaterialShell>
    </>
  );
};

export default PaymentTermMaster;
