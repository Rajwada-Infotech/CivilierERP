import React from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";

const CUSTOMER_TYPE = "A";

/* -------------------- FORM FIELDS -------------------- */
const fields: FieldDef[] = [
  { name: "LHeadName", label: "Customer Name", type: "text", required: true },
  { name: "LHeadContactPerson", label: "Contact Person", type: "text" },
  { name: "LHeadPhone", label: "Phone Number", type: "text" },
  { name: "LHeadEmail", label: "Email Address", type: "text" },
  { name: "LGST", label: "GST Number", type: "text", uppercase: true },
  { name: "LHeadPan", label: "PAN Number", type: "text", uppercase: true },
  {
    name: "LGSTType",
    label: "GST Type",
    type: "select",
    options: ["Regular", "Composition", "Unregistered", "SEZ", "Deemed Export"],
  },
  {
    name: "LGSTState",
    label: "GST State",
    type: "select",
    options: [
      "Andaman and Nicobar Islands",
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chandigarh",
      "Chhattisgarh",
      "Dadra and Nagar Haveli and Daman and Diu",
      "Delhi",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jammu and Kashmir",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Ladakh",
      "Lakshadweep",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Puducherry",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
    ],
  },
  {
    name: "LHeadPaymentTerms",
    label: "Payment Terms",
    type: "select",
    options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"],
  },
  { name: "LHeadAddress", label: "Address", type: "textarea", fullWidth: true },
  { name: "LHeadStatus", label: "Status", type: "toggle", defaultValue: true },
];

/* -------------------- TABLE COLUMNS -------------------- */
const columns: ColumnDef[] = [
  { key: "LHeadName", label: "Customer Name" },
  { key: "LHeadContactPerson", label: "Contact Person" },
  { key: "LHeadPhone", label: "Phone" },
  { key: "LGST", label: "GST No." },
  { key: "LHeadPaymentTerms", label: "Payment Terms" },
  { key: "LHeadStatus", label: "Status" },
];

/* -------------------- EXPORT COLUMNS -------------------- */
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Customer Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST No.", accessor: "LGST" },
  { header: "PAN", accessor: "LHeadPan" },
  { header: "GST Type", accessor: "LGSTType" },
  { header: "GST State", accessor: "LGSTState" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

/* -------------------- COMPONENT -------------------- */
const CustomerMaster: React.FC = () => {
  const queryClient = useQueryClient();

  /* -------------------- FETCH DATA -------------------- */
  const { data, isLoading, error } = useQuery({
    queryKey: ["account-head", CUSTOMER_TYPE],
    queryFn: () => getList(CUSTOMER_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  /* -------------------- MAP BACKEND → FRONTEND -------------------- */
  const mappedData = React.useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      _id: String(item.LHeadId),
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || "",
      LHeadPhone: item.LHeadPhone || "",
      LHeadEmail: item.LHeadEmail || "",
      LGST: item.LGST || "",
      LHeadPan: item.LHeadPan || "",
      LGSTType: item.LGSTType || "",
      LGSTState: item.LGSTState || "",
      LHeadPaymentTerms: item.LHeadPaymentTerms || "",
      LHeadAddress: item.LHeadAddress || "",
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [data]);

  /* -------------------- CRUD HANDLER -------------------- */
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "delete") {
        await deleteRecord(Number(event.id));
        toast.success("Customer deleted!");
        await queryClient.invalidateQueries({
          queryKey: ["account-head", CUSTOMER_TYPE],
        });
        return;
      }

      const record = event.record;
      if (!record) {
        toast.error("No record data found");
        return;
      }

      const payload = {
        LHeadName: record.LHeadName,
        LHeadType: CUSTOMER_TYPE,
        LHeadContactPerson: record.LHeadContactPerson,
        LHeadPhone: record.LHeadPhone,
        LHeadEmail: record.LHeadEmail,
        LGST: record.LGST,
        LHeadPan: record.LHeadPan,
        LGSTType: record.LGSTType || null,
        LGSTState: record.LGSTState || null,
        LHeadPaymentTerms: record.LHeadPaymentTerms,
        LHeadAddress: record.LHeadAddress,
        LHeadStatus: record.LHeadStatus,
        LBranchName: null,
        LCountry: "India",
        LBelongsTo: null,
        LDescription: null,
      };

      if (event.action === "add") {
        await addRecord(payload, CUSTOMER_TYPE);
        toast.success("Customer saved!");
      } else if (event.action === "update") {
        await updateRecord(Number(event.id), payload, CUSTOMER_TYPE);
        toast.success("Customer updated!");
      }

      await queryClient.invalidateQueries({
        queryKey: ["account-head", CUSTOMER_TYPE],
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Operation failed");
    }
  };

  /* -------------------- UI STATES -------------------- */
  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return <div className="p-6 text-red-500">Failed to load customers.</div>;

  /* -------------------- UI -------------------- */
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Customer Master"]} />
      <div className="space-y-8 mt-6">
      <div>
        <h1 className="text-xl font-heading font-bold text-foreground">Customer Master</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage customer records and contact information</p>
      </div>
      <MasterPage
        title="Customer"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        exportConfig={{
          title: "Customer Master",
          filename: "customer-master",
          columns: EXPORT_COLUMNS,
        }}
        viewConfig={{
          title: "Customer Details",
          fields: [
            { key: "LHeadName", label: "Customer Name" },
            { key: "LHeadContactPerson", label: "Contact Person" },
            { key: "LHeadPhone", label: "Phone" },
            { key: "LHeadEmail", label: "Email" },
            { key: "LGST", label: "GST Number", mono: true },
            { key: "LHeadPan", label: "PAN Number", mono: true },
            { key: "LGSTType", label: "GST Type" },
            { key: "LGSTState", label: "GST State" },
            { key: "LHeadPaymentTerms", label: "Payment Terms" },
            { key: "LHeadAddress", label: "Address" },
            { key: "LHeadStatus", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=700,height=600");
          if (!win) return;
          win.document.write(`
            <html><head><title>Customer — ${row.LHeadName}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body>
            <h2>Customer Card</h2>
            <table>
              <tr><td>Customer Name</td><td>${row.LHeadName || "—"}</td></tr>
              <tr><td>Contact Person</td><td>${row.LHeadContactPerson || "—"}</td></tr>
              <tr><td>Phone</td><td>${row.LHeadPhone || "—"}</td></tr>
              <tr><td>Email</td><td>${row.LHeadEmail || "—"}</td></tr>
              <tr><td>GST Number</td><td>${row.LGST || "—"}</td></tr>
              <tr><td>PAN Number</td><td>${row.LHeadPan || "—"}</td></tr>
              <tr><td>GST Type</td><td>${row.LGSTType || "—"}</td></tr>
              <tr><td>GST State</td><td>${row.LGSTState || "—"}</td></tr>
              <tr><td>Payment Terms</td><td>${row.LHeadPaymentTerms || "—"}</td></tr>
              <tr><td>Address</td><td>${row.LHeadAddress || "—"}</td></tr>
              <tr><td>Status</td><td>${row.LHeadStatus ? "Active" : "Inactive"}</td></tr>
            </table>
            </body></html>
          `);
          win.document.close();
          win.print();
        }}
      />
      </div>
    </>
  );
};

export default CustomerMaster;
