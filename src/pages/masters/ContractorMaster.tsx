import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { getContractorCategoryOptions } from "@/api/contractorCategoryApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";

const CONTRACTOR_TYPE = "C";

const BASE_FIELDS: FieldDef[] = [
  { name: "LHeadName", label: "Contractor Name", type: "text", required: true },
  { name: "LHeadContactPerson", label: "Contact Person", type: "text" },
  { name: "LHeadPhone", label: "Phone Number", type: "text" },
  { name: "LHeadEmail", label: "Email Address", type: "text" },
  { name: "LGST", label: "GST Number", type: "text", uppercase: true },
  { name: "LHeadPan", label: "PAN Number", type: "text", uppercase: true },
  {
    name: "contractorType",
    label: "Contractor Type",
    type: "select",
    options: [],
  },
  { name: "LHeadPaymentTerms", label: "Payment Terms", type: "text" },
  { name: "LHeadAddress", label: "Address", type: "textarea", fullWidth: true },
  { name: "LHeadStatus", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "LHeadName", label: "Contractor Name" },
  { key: "LHeadContactPerson", label: "Contact Person" },
  { key: "LHeadPhone", label: "Phone" },
  { key: "LGST", label: "GST No." },
  { key: "LHeadPaymentTerms", label: "Payment Terms" },
  { key: "LHeadStatus", label: "Status" },
];

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Contractor Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST No.", accessor: "LGST" },
  { header: "PAN", accessor: "LHeadPan" },
  { header: "Contractor Type", accessor: "contractorType" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

const ContractorMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["account-head", CONTRACTOR_TYPE],
    queryFn: () => getList(CONTRACTOR_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const { data: categoryOptions } = useQuery({
    queryKey: ["contractor-category-options"],
    queryFn: async () => {
      const options = await getContractorCategoryOptions();
      return options.map((o) => o.name);
    },
    staleTime: 5 * 60 * 1000,
  });

  const fields = React.useMemo(() => {
    return BASE_FIELDS.map((f) =>
      f.name === "contractorType"
        ? {
            ...f,
            options: categoryOptions ?? [
              "Civil",
              "Electrical",
              "Mechanical",
              "Plumbing",
              "General",
            ],
          }
        : f,
    );
  }, [categoryOptions]);

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
      contractorType: item.LHeadCatagory || "Civil",
      LHeadPaymentTerms: item.LHeadPaymentTerms || "",
      LHeadAddress: item.LHeadAddress || "",
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [data]);

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "delete") {
        await deleteRecord(Number(event.id));
        toast.success("Contractor deleted!");
        await queryClient.invalidateQueries({
          queryKey: ["account-head", CONTRACTOR_TYPE],
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
        LHeadType: CONTRACTOR_TYPE,
        LHeadContactPerson: record.LHeadContactPerson,
        LHeadPhone: record.LHeadPhone,
        LHeadEmail: record.LHeadEmail,
        LGST: record.LGST,
        LHeadPan: record.LHeadPan,
        LHeadCatagory: record.contractorType,
        LHeadPaymentTerms: record.LHeadPaymentTerms,
        LHeadAddress: record.LHeadAddress,
        LHeadStatus: record.LHeadStatus,
        LBranchName: null,
        LGSTState: null,
        LCountry: "India",
        LBelongsTo: null,
        LDescription: null,
      };

      if (event.action === "add") {
        await addRecord(payload, CONTRACTOR_TYPE);
        toast.success("Contractor saved!");
      } else if (event.action === "update") {
        await updateRecord(Number(event.id), payload, CONTRACTOR_TYPE);
        toast.success("Contractor updated!");
      }

      await queryClient.invalidateQueries({
        queryKey: ["account-head", CONTRACTOR_TYPE],
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Operation failed");
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load contractors.</div>;

  // fields is now dynamic — built from API options above

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Contractor Master"]}
      />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Contractor Master
      </h1>
      <MasterPage
        title="Contractor"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        exportConfig={{
          columns: EXPORT_COLUMNS,
          filename: "contractor-master",
        }}
        viewConfig={{
          title: "Contractor Details",
          fields: [
            { key: "LHeadName", label: "Contractor Name" },
            { key: "LHeadContactPerson", label: "Contact Person" },
            { key: "LHeadPhone", label: "Phone" },
            { key: "LHeadEmail", label: "Email" },
            { key: "LGST", label: "GST Number", mono: true },
            { key: "LHeadPan", label: "PAN Number", mono: true },
            { key: "contractorType", label: "Contractor Type" },
            { key: "LHeadPaymentTerms", label: "Payment Terms" },
            { key: "LHeadAddress", label: "Address" },
            { key: "LHeadStatus", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=700,height=600");
          if (!win) return;
          win.document.write(`
            <html><head><title>Contractor — ${row.LHeadName}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body>
            <h2>Contractor Details</h2>
            <table>
              <tr><td>Name</td><td>${row.LHeadName || "—"}</td></tr>
              <tr><td>Contact Person</td><td>${row.LHeadContactPerson || "—"}</td></tr>
              <tr><td>Phone</td><td>${row.LHeadPhone || "—"}</td></tr>
              <tr><td>Email</td><td>${row.LHeadEmail || "—"}</td></tr>
              <tr><td>GST Number</td><td>${row.LGST || "—"}</td></tr>
              <tr><td>PAN Number</td><td>${row.LHeadPan || "—"}</td></tr>
              <tr><td>Contractor Type</td><td>${row.contractorType || "—"}</td></tr>
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
    </>
  );
};

export default ContractorMaster;
