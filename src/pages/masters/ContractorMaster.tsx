import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getList, addRecord, updateRecord, deleteRecord } from "@/api/accountHeadApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent } from "@/components/MasterPage";

const CONTRACTOR_TYPE = "C";

const BASE_FIELDS: FieldDef[] = [
  { name: "LHeadName",          label: "Contractor Name",  type: "text",     required: true },
  { name: "LHeadContactPerson", label: "Contact Person",   type: "text" },
  { name: "LHeadPhone",         label: "Phone Number",     type: "text" },
  { name: "LHeadEmail",         label: "Email Address",    type: "text" },
  { name: "LGST",               label: "GST Number",       type: "text",     uppercase: true },
  { name: "LHeadPan",           label: "PAN Number",       type: "text",     uppercase: true },
  { name: "contractorType",     label: "Contractor Type",  type: "select",   options: [] },
  { name: "LHeadPaymentTerms",  label: "Payment Terms",    type: "text" },
  { name: "LHeadAddress",       label: "Address",          type: "textarea", fullWidth: true },
  { name: "LHeadStatus",        label: "Status",           type: "toggle",   defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "LHeadName",          label: "Contractor Name" },
  { key: "LHeadContactPerson", label: "Contact Person" },
  { key: "LHeadPhone",         label: "Phone" },
  { key: "LGST",               label: "GST No." },
  { key: "LHeadPaymentTerms",  label: "Payment Terms" },
  { key: "LHeadStatus",        label: "Status" },
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
      const res = await fetchWithAuth("/api/contractor-category/options");
      const json = await res.json();
      return (json as { label: string }[]).map((o) => o.label);
    },
    staleTime: 5 * 60 * 1000,
  });

  const fields = React.useMemo(() => {
    return BASE_FIELDS.map((f) =>
      f.name === "contractorType"
        ? { ...f, options: categoryOptions ?? ["Civil", "Electrical", "Mechanical", "Plumbing", "General"] }
        : f
    );
  }, [categoryOptions]);

  const mappedData = React.useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      _id:                String(item.LHeadId),
      LHeadName:          item.LHeadName          || "",
      LHeadContactPerson: item.LHeadContactPerson || "",
      LHeadPhone:         item.LHeadPhone         || "",
      LHeadEmail:         item.LHeadEmail         || "",
      LGST:               item.LGST               || "",
      LHeadPan:           item.LHeadPan           || "",
      contractorType:     item.LHeadCatagory      || "Civil",
      LHeadPaymentTerms:  item.LHeadPaymentTerms  || "",
      LHeadAddress:       item.LHeadAddress       || "",
      LHeadStatus:        Boolean(item.LHeadStatus),
    }));
  }, [data]);

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "delete") {
        await deleteRecord(Number(event.id));
        toast.success("Contractor deleted!");
        await queryClient.invalidateQueries({ queryKey: ["account-head", CONTRACTOR_TYPE] });
        return;
      }

      const record = event.record;

      if (!record) {
        toast.error("No record data found");
        return;
      }

      const payload = {
        LHeadName:          record.LHeadName,
        LHeadType:          CONTRACTOR_TYPE,
        LHeadContactPerson: record.LHeadContactPerson,
        LHeadPhone:         record.LHeadPhone,
        LHeadEmail:         record.LHeadEmail,
        LGST:               record.LGST,
        LHeadPan:           record.LHeadPan,
        LHeadCatagory:      record.contractorType,
        LHeadPaymentTerms:  record.LHeadPaymentTerms,
        LHeadAddress:       record.LHeadAddress,
        LHeadStatus:        record.LHeadStatus,
        LBranchName:        null,
        LGSTState:          null,
        LCountry:           "India",
        LBelongsTo:         null,
        LDescription:       null,
      };

      if (event.action === "add") {
        await addRecord(payload, CONTRACTOR_TYPE);
        toast.success("Contractor saved!");
      } else if (event.action === "update") {
        await updateRecord(Number(event.id), payload, CONTRACTOR_TYPE);
        toast.success("Contractor updated!");
      }

      await queryClient.invalidateQueries({ queryKey: ["account-head", CONTRACTOR_TYPE] });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)     return <div className="p-6 text-red-500">Failed to load contractors.</div>;

  // fields is now dynamic — built from API options above

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Contractor Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Contractor Master</h1>
      <MasterPage
        title="Contractor"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default ContractorMaster;
