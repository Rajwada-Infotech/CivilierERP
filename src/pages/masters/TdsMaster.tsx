import React from "react";
import { useTds } from "@/contexts/TdsContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "nature", label: "Nature", type: "text", required: true, uppercase: true },
  { name: "name", label: "Name", type: "text", required: true },
  { name: "percentage", label: "Percentage (%)", type: "number", prefix: "%", required: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "nature", label: "Nature" },
  { key: "name", label: "Name" },
  { key: "percentage", label: "Rate (%)" },
  { key: "status", label: "Status" },
];

const TdsMaster: React.FC = () => {
  const { tdsRecords, setTdsRecords } = useTds();

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "TDS Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">TDS Master</h1>
      <MasterPage title="TDS" fields={fields} columns={columns} initialData={tdsRecords as any} onDataChange={(records) => setTdsRecords(records as any)} />
    </>
  );
};

export default TdsMaster;

