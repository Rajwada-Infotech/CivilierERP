import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";

import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";

const CUSTOMER_TYPE = "A";

/* -------------------- FORM FIELDS (UI Friendly) -------------------- */
const fields = [
  { name: "name", label: "Customer Name", type: "text", required: true },
  { name: "contact", label: "Contact Person", type: "text" },
  { name: "phone", label: "Phone Number", type: "text" },
  { name: "email", label: "Email Address", type: "text" },
  { name: "gst", label: "GST Number", type: "text", uppercase: true },
  { name: "pan", label: "PAN Number", type: "text", uppercase: true },
  {
    name: "paymentTerms",
    label: "Payment Terms",
    type: "select",
    options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"],
  },
  { name: "address", label: "Address", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

/* -------------------- TABLE COLUMNS -------------------- */
const columns = [
  { key: "name", label: "Customer Name" },
  { key: "contact", label: "Contact Person" },
  { key: "phone", label: "Phone" },
  { key: "gst", label: "GST No." },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "status", label: "Status" },
];

const CustomerMaster: React.FC = () => {
  const queryClient = useQueryClient();

  /* -------------------- FETCH DATA -------------------- */
  const { data, isLoading, error } = useQuery({
    queryKey: ["account-head", CUSTOMER_TYPE],
    queryFn: () => getList(CUSTOMER_TYPE),
  });

  /* -------------------- MAP BACKEND → FRONTEND -------------------- */
  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(data)) return [];

    return data.map((item) => ({
      _id: String(item.LHeadId),
      name: item.LHeadName || "",
      contact: item.LHeadContactPerson || "",
      phone: item.LHeadPhone || "",
      email: item.LHeadEmail || "",
      gst: item.LGST || "",
      pan: item.LHeadPan || "",
      paymentTerms: item.LHeadPaymentTerms || "",
      address: item.LHeadAddress || "",
      status: Boolean(item.LHeadStatus),
    }));
  }, [data]);

  /* -------------------- FRONTEND → BACKEND PAYLOAD -------------------- */
  const toPayload = (r: Record<string, any>) => ({
    LHeadName: r.name || null,
    LHeadType: CUSTOMER_TYPE,
    LHeadContactPerson: r.contact || null,
    LHeadPhone: r.phone || null,
    LHeadEmail: r.email || null,
    LGST: r.gst || null,
    LHeadPan: r.pan || null,
    LHeadPaymentTerms: r.paymentTerms || null,
    LHeadAddress: r.address || null,
    LHeadStatus: r.status !== false,
    LBranchName: null,
    LGSTState: null,
    LCountry: "India",
    LBelongsTo: null,
    LDescription: null,
  });

  /* -------------------- CRUD HANDLER -------------------- */
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "delete") {
        await deleteRecord(Number(event.id));
        toast.success("Customer deleted!");
      }

      if (event.action === "add") {
        await addRecord(toPayload(event.record), CUSTOMER_TYPE);
        toast.success("Customer saved!");
      }

      if (event.action === "update") {
        await updateRecord(
          Number(event.id),
          toPayload(event.record),
          CUSTOMER_TYPE
        );
        toast.success("Customer updated!");
      }

      await queryClient.invalidateQueries({
        queryKey: ["account-head", CUSTOMER_TYPE],
      });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  /* -------------------- UI STATES -------------------- */
  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading customers...</div>;

  if (error)
    return <div className="p-6 text-red-500">Failed to load customers.</div>;

  /* -------------------- UI -------------------- */
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Customer Master"]} />

      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Customer Master
      </h1>

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
