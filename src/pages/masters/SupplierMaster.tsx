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

const SUPPLIER_TYPE = "S";

const fields: FieldDef[] = [
  { name: "LHeadName", label: "Supplier Name", type: "text", required: true },
  { name: "LHeadContactPerson", label: "Contact Person", type: "text" },
  { name: "LHeadPhone", label: "Phone Number", type: "text" },
  { name: "LHeadEmail", label: "Email Address", type: "text" },
  { name: "LGST", label: "GST Number", type: "text", uppercase: true },
  { name: "LHeadPan", label: "PAN Number", type: "text", uppercase: true },
  {
    name: "supplierCategory",
    label: "Supplier Category",
    type: "select",
    options: ["Goods", "Services", "Both"],
  },
  {
    name: "LGSTType",
    label: "GST Type",
    type: "select",
    options: ["Regular", "Composition", "Unregistered", "SEZ", "Deemed Export"],
  },
  { name: "LGSTState", label: "GST State", type: "text" },
  { name: "LHeadAddress", label: "Address", type: "textarea", fullWidth: true },
  { name: "LHeadStatus", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "LHeadName", label: "Supplier Name" },
  { key: "LHeadContactPerson", label: "Contact Person" },
  { key: "LHeadPhone", label: "Phone" },
  { key: "LGST", label: "GST No." },
  { key: "LHeadStatus", label: "Status" },
];

const SupplierMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["account-head", SUPPLIER_TYPE],
    queryFn: () => getList(SUPPLIER_TYPE),
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
      LHeadPan: item.LHeadPan || "",
      supplierCategory: item.LHeadCatagory || "",
      LGSTType: item.LGSTType || "",
      LGSTState: item.LGSTState || "",
      LHeadAddress: item.LHeadAddress || "",
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [data]);

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "delete") {
        await deleteRecord(Number(event.id));
        toast.success("Supplier deleted!");
        await queryClient.invalidateQueries({
          queryKey: ["account-head", SUPPLIER_TYPE],
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
        LHeadType: SUPPLIER_TYPE,
        LHeadContactPerson: record.LHeadContactPerson,
        LHeadPhone: record.LHeadPhone,
        LHeadEmail: record.LHeadEmail,
        LGST: record.LGST,
        LHeadPan: record.LHeadPan,
        LHeadCatagory: record.supplierCategory,
        LGSTType: record.LGSTType,
        LHeadAddress: record.LHeadAddress,
        LHeadStatus: record.LHeadStatus,
        LBranchName: null,
        LGSTState: record.LGSTState || null,
        LCountry: "India",
        LBelongsTo: null,
        LDescription: null,
      };

      if (event.action === "add") {
        await addRecord(payload, SUPPLIER_TYPE);
        toast.success("Supplier saved!");
      } else if (event.action === "update") {
        await updateRecord(Number(event.id), payload, SUPPLIER_TYPE);
        toast.success("Supplier updated!");
      }

      await queryClient.invalidateQueries({
        queryKey: ["account-head", SUPPLIER_TYPE],
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Operation failed");
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load suppliers.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Supplier Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Supplier Master
      </h1>
      <MasterPage
        title="Supplier"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default SupplierMaster;
