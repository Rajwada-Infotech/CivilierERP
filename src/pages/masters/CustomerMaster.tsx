

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getList, addRecord, updateRecord, deleteRecord } from "@/api/accountHeadApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent } from "@/components/MasterPage";

const CUSTOMER_TYPE = "A"; // Customer

const fields: FieldDef[] = [
  { name: "LHeadName", label: "Customer Name", type: "text", required: true },
  { name: "LHeadContactPerson", label: "Contact Person", type: "text" },
  { name: "LHeadPhone", label: "Phone Number", type: "text" },
  { name: "LHeadEmail", label: "Email Address", type: "text" },
  { name: "LGST", label: "GST Number", type: "text", uppercase: true },
  { name: "pan", label: "PAN Number", type: "text", uppercase: true }, // Note: table may need pan field or map to LDescription
  { name: "customerType", label: "Customer Type", type: "select", options: ["Individual", "Company", "Government", "NGO", "Other"] }, // UI only, not saved
  { name: "LHeadPaymentTerms", label: "Payment Terms", type: "text" },
  { name: "creditLimit", label: "Credit Limit (₹)", type: "number", prefix: "₹" }, // Map to custom field or LDescription
  { name: "LHeadAddress", label: "Address", type: "textarea", fullWidth: true },
  { name: "LHeadStatus", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "LHeadName", label: "Customer Name" },
  { key: "LHeadContactPerson", label: "Contact Person" },
  { key: "LHeadPhone", label: "Phone" },
  { key: "LGST", label: "GST No." },
  { key: "LHeadPaymentTerms", label: "Payment Terms" },
  { key: "LHeadStatus", label: "Status" },
];

const CustomerMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["account-head", CUSTOMER_TYPE],
    queryFn: () => getList(CUSTOMER_TYPE),
  });

  const mappedData = React.useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      _id: String(item.LHeadId),
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || "",
      LHeadPhone: item.LHeadPhone || "",
      LHeadEmail: item.LHeadEmail || "",
      LGST: item.LGST || "",
      pan: item.pan || "", // custom
      customerType: "Company", // UI static
      LHeadPaymentTerms: item.LHeadPaymentTerms || "",
      creditLimit: item.creditLimit || 0, // custom
      LHeadAddress: item.LHeadAddress || "",
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [data]);

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === 'delete') {
        await deleteRecord(Number(event.id));
        toast.success("Customer deleted!");
        await queryClient.invalidateQueries({ queryKey: ["account-head", CUSTOMER_TYPE] });
        return;
      }

      const record = event.records[0];
      const payload = {
        LHeadName: record.LHeadName,
        LHeadContactPerson: record.LHeadContactPerson,
        LHeadPhone: record.LHeadPhone,
        LHeadEmail: record.LHeadEmail,
        LGST: record.LGST,
        LHeadPaymentTerms: record.LHeadPaymentTerms,
        LHeadAddress: record.LHeadAddress,
        LHeadStatus: record.LHeadStatus,
      };

      if (event.action === "add") {
        await addRecord(payload, CUSTOMER_TYPE);
        toast.success("Customer saved!");
      } else if (event.action === "update") {
        await updateRecord(Number(event.id), payload, CUSTOMER_TYPE);
        toast.success("Customer updated!");
      }

      await queryClient.invalidateQueries({ queryKey: ["account-head", CUSTOMER_TYPE] });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Operation failed");
    }
  };



  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load customers.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Customer Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Customer Master</h1>
      <MasterPage
        title="Customer"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default CustomerMaster;

