import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
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
    Description: (value: unknown) => <span className="text-sm font-medium text-foreground">{String(value ?? "")}</span>,
    Days: (value: unknown) => <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{String(value ?? "")} days</span>,
    IsActive: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "waiting"} />,
  };

  // Due date = vendor invoice date + days, so days must be a whole number of days, none negative.
  // (The server rounds a fraction down and the old form turned a bad entry into 0.)
  const checkDays = (form: Record<string, unknown>) => {
    const raw = String(form.Days ?? "").trim();
    const days = Number(raw);
    if (raw === "" || !Number.isInteger(days) || days < 0 || days > 3650) {
      toast.error("Days must be a whole number from 0 to 3650.");
      return null;
    }
    return form;
  };

  // Purchase orders and the contractor master keep their own copy of the term list.
  const refreshElsewhere = () => {
    for (const key of ["payment-terms-po", "vendor-payment-term-options"]) queryClient.invalidateQueries({ queryKey: [key] });
  };


  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const record = event.record as Record<string, unknown>;
      await addVendorPaymentTerm({
        Description: String(record.Description ?? "").trim(),
        Days: Number(record.Days),
        IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
      });
      await refetch();
    } else if (event.action === "update") {
      const record = event.record as Record<string, unknown>;
      await updateVendorPaymentTerm(Number(event.id), {
        Description: String(record.Description ?? "").trim(),
        Days: Number(record.Days),
        IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
      });
      await refetch();
    } else if (event.action === "delete") {
      await deleteVendorPaymentTerm(Number(event.id));
      await refetch();
    }
    refreshElsewhere();
  };

  return (
    <>
      <Breadcrumbs items={["Masters", "Payment Terms"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Payment terms"
        subtitle="Net-day terms for purchase orders and invoices: the due date is the vendor invoice date plus the days."
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
            onCustomSave={checkDays}
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
      </SheetShell>
    </>
  );
};

export default PaymentTermMaster;
