import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "description", label: "Description", type: "text", required: true },
  { name: "code",        label: "Code",        type: "text", required: true, uppercase: true },
  { name: "shortCode",   label: "Short Code",  type: "text", required: true, uppercase: true },
];

const columns: ColumnDef[] = [
  { key: "description", label: "Description" },
  { key: "code",        label: "Code" },
  { key: "shortCode",   label: "Short Code" },
];

const initialData = [
  { description: "Raw Materials",    code: "RM",  shortCode: "RAW" },
  { description: "Finished Goods",   code: "FG",  shortCode: "FIN" },
  { description: "Services",         code: "SVC", shortCode: "SRV" },
  { description: "Capital Goods",    code: "CG",  shortCode: "CAP" },
];

const ItemGroupMaster: React.FC = () => (
  <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Item Group Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Item Group Master</h1>
    <MasterPage title="Item Group" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default ItemGroupMaster;
