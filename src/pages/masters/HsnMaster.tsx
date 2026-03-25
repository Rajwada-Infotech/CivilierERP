import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";
import { useHsn, HsnRecord } from "@/contexts/HsnContext";

const fields: FieldDef[] = [
  { name: "code",      label: "HSN Code",         type: "text",     required: true, uppercase: true },
  { name: "shortDesc", label: "Short Description", type: "text",     required: true },
  { name: "description", label: "Full Description", type: "textarea", fullWidth: true },
  { name: "igstRate",  label: "IGST Rate (%)",     type: "number" },
  { name: "cgstRate",  label: "CGST Rate (%)",     type: "number" },
  { name: "sgstRate",  label: "SGST Rate (%)",     type: "number" },
  { name: "status",    label: "Status",            type: "toggle",   defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "code",      label: "HSN Code" },
  { key: "shortDesc", label: "Short Desc" },
  { key: "igstRate",  label: "IGST %",  hideOnMobile: true },
  { key: "cgstRate",  label: "CGST %",  hideOnMobile: true },
  { key: "sgstRate",  label: "SGST %",  hideOnMobile: true },
  { key: "status",    label: "Status" },
];

const HsnMaster: React.FC = () => {
  const { hsnRecords, setHsnRecords } = useHsn();

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "HSN Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">HSN Master</h1>
      <MasterPage
        title="HSN"
        fields={fields}
        columns={columns}
        initialData={hsnRecords}
        onDataChange={(records) => setHsnRecords(records as unknown as HsnRecord[])}
      />
    </>
  );
};

export default HsnMaster;
