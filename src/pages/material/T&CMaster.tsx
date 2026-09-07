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
import { FileText } from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  name: (value: unknown) => (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <FileText size={13} />
      </div>
      <span className="font-heading font-semibold text-sm">
        {String(value ?? "")}
      </span>
    </div>
  ),
  terms: (value: unknown, row: Record<string, unknown>) => (
    <div className="max-w-xs">
      <p className="text-xs line-clamp-2 text-foreground">
        {String(value ?? "")}
      </p>
      {row.remarks && (
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
          {String(row.remarks)}
        </p>
      )}
    </div>
  ),
  status: (value: unknown) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-heading border ${
        value
          ? "border-emerald-200/60 bg-emerald-50/80 text-emerald-700"
          : "border-amber-200/60 bg-amber-50/80 text-amber-700"
      }`}
    >
      <span
        className={`mr-1 h-1.5 w-1.5 rounded-full ${value ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {value ? "Active" : "Inactive"}
    </span>
  ),
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function TCMaster() {
  const rights = usePageRights("t-c-master");
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
    staleTime: 0, // ← always treat as stale so invalidateQueries always refetches
    refetchOnMount: true, // ← always refetch when the page mounts
  });

  // Only pass real rows — never pass [] during a background refetch
  const rows: RecordWithId[] =
    Array.isArray(dbData) && !isFetching
      ? dbData.map(toRow)
      : Array.isArray(dbData)
        ? dbData.map(toRow)
        : [];

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addTCRecord(toPayload(event.record));
        toast.success("T&C record saved!");
        // Remove cached data entirely so MasterPage gets fresh array on refetch
        queryClient.removeQueries({ queryKey: ["tc-master"] });
        await queryClient.fetchQuery({
          queryKey: ["tc-master"],
          queryFn: getTCRecords,
        });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }

    if (event.action === "update") {
      try {
        await updateTCRecord(Number(event.id), toPayload(event.record));
        toast.success("T&C record updated!");
        queryClient.removeQueries({ queryKey: ["tc-master"] });
        await queryClient.fetchQuery({
          queryKey: ["tc-master"],
          queryFn: getTCRecords,
        });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }

    if (event.action === "delete") {
      try {
        await deleteTCRecord(Number(event.id));
        toast.success("T&C record deleted!");
        queryClient.removeQueries({ queryKey: ["tc-master"] });
        await queryClient.fetchQuery({
          queryKey: ["tc-master"],
          queryFn: getTCRecords,
        });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return (
      <div className="p-6 text-red-500">Failed to load T&amp;C records.</div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "T&C"]} />
      <MaterialShell
        title="T&C Master"
        subtitle="Manage terms and conditions for contracts and orders"
        icon={FileText}
      >
      <MasterPage
        saveButtonClass="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500"
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
            { header: "Terms Preview", accessor: "terms" },
            { header: "Status", accessor: "status" },
          ],
        }}
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        canExport={rights.canExport}
      />
      </MaterialShell>
    </>
  );
}
