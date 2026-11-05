import React from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTCRecords,
  addTCRecord,
  updateTCRecord,
  deleteTCRecord,
} from "@/api/tcMasterApi";

// ─── DB shape ────────────────────────────────────────────────────────────────
interface DbTC {
  Id: number;
  Name: string;
  TermsAndCondition: string;
  Remarks: string | null;
  isActive: boolean;
}

// ─── Map DB → UI row ─────────────────────────────────────────────────────────
const toRow = (item: DbTC): RecordWithId => ({
  _id: String(item.Id),
  name: item.Name || "",
  terms: item.TermsAndCondition || "",
  remarks: item.Remarks || "",
  status: item.isActive,
});

// ─── Map UI row → DB payload ──────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  Name: (r.name as string) || null,
  TermsAndCondition: (r.terms as string) || null,
  Remarks: (r.remarks as string) || null,
  isActive: r.status !== false,
});

// ─── Field & Column definitions ───────────────────────────────────────────────
const FIELDS: FieldDef[] = [
  {
    name: "name",
    label: "Name",
    type: "text",
    required: true,
  },
  {
    name: "terms",
    label: "Terms & Condition",
    type: "textarea",
    fullWidth: true,
    required: true,
  },
  {
    name: "remarks",
    label: "Remarks",
    type: "textarea",
    fullWidth: true,
  },
  {
    name: "status",
    label: "Active",
    type: "toggle",
    defaultValue: true,
  },
];

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "terms", label: "Terms Preview" },
  { key: "status", label: "Status" },
];

// ─── Column renderers ─────────────────────────────────────────────────────────
const columnRenderers = {
  name: (value: unknown) => <span className="font-heading text-sm font-semibold text-foreground">{String(value ?? "")}</span>,
  terms: (value: unknown, row: Record<string, unknown>) => (
    <div className="max-w-xs">
      <p className="text-xs line-clamp-2 text-foreground">{String(value ?? "")}</p>
      {row.remarks && <p className="text-[0.625rem] text-muted-foreground mt-0.5 line-clamp-1">{String(row.remarks)}</p>}
    </div>
  ),
  status: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "waiting"} />,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function TCMaster() {
  const rights = usePageRights("t-c-master");
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
    staleTime: 0, // ← always treat as stale so invalidateQueries always refetches
    refetchOnMount: true, // ← always refetch when the page mounts
  });

  const rows: RecordWithId[] = Array.isArray(dbData) ? dbData.map(toRow) : [];

  // Purchase orders, contracts and work orders read the same list (key "tc-master").
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tc-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") await addTCRecord(toPayload(event.record));
    if (event.action === "update") await updateTCRecord(Number(event.id), toPayload(event.record));
    if (event.action === "delete") await deleteTCRecord(Number(event.id));
    await refresh();
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return (
      <div className="p-6 text-sm text-destructive">Failed to load terms and conditions.</div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "T&C"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Terms and conditions"
        subtitle="The clauses picked onto purchase orders, contracts and work orders; inactive ones are not offered."
      >
      <MasterPage
        title="T&C Master"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={rows}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
        exportConfig={{
          title: "T&C Master",
          filename: "tc-master",
          columns: [
            { header: "Name", accessor: "name" },
            { header: "Terms & Conditions", accessor: "terms" },
            { header: "Remarks", accessor: "remarks" },
            { header: "Status", accessor: (r) => (r.status ? "Active" : "Inactive") },
          ],
        }}
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        canExport={rights.canExport}
      />
      </SheetShell>
    </>
  );
}
