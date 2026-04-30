import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { Ruler, Hash } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUomList, addUom, updateUom, deleteUom } from "@/api/uomApi";
import { toast } from "sonner";

interface DbUOM {
  Id: number;
  UOMName: string;
  UOMCode: string;
  Symbol: string | null;
  Remarks: string | null;
  IsActive: boolean;
  CreatedAt: string | null;
}

const FIELDS: FieldDef[] = [
  {
    name: "code",
    label: "Unit Code",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "name",
    label: "Unit Name",
    type: "text",
    required: true,
  },
  {
    name: "symbol",
    label: "Symbol",
    type: "text",
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
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "symbol", label: "Symbol" },
  { key: "status", label: "Status" },
];

const toPayload = (record: Record<string, unknown>) => ({
  UOMCode: record.code as string,
  UOMName: record.name as string,
  Symbol: record.symbol as string,
  Remarks: (record.remarks as string) || null,
  IsActive: record.status !== false,
});

const columnRenderers = {
  code: (value: unknown) => (
    <div className="flex items-center gap-2 min-w-[100px]">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Hash size={15} />
      </span>
      <span className="font-heading font-semibold text-foreground">
        {String(value ?? "")}
      </span>
    </div>
  ),
  symbol: (value: unknown) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-heading text-foreground">
      <Ruler size={11} className="text-primary" />
      {String(value ?? "")}
    </span>
  ),
  status: (value: unknown) => (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-heading ${
        value
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      <span
        className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
          value ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {value ? "Active" : "Inactive"}
    </span>
  ),
};

export default function UnitOfMeasurementMaster() {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUomList,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbUOM[] = Array.isArray(dbData) ? dbData : [];

  const mappedData = dbItems.map((item) => ({
    _id: String(item.Id),
    code: item.UOMCode || "",
    name: item.UOMName || "",
    symbol: item.Symbol || "",
    remarks: item.Remarks || "",
    status: Boolean(item.IsActive),
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addUom(toPayload(event.record));
        toast.success("UOM saved!");
        await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }

    if (event.action === "update") {
      try {
        await updateUom(Number(event.id), toPayload(event.record));
        toast.success("UOM updated!");
        await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }

    if (event.action === "delete") {
      try {
        await deleteUom(Number(event.id));
        toast.success("UOM deleted!");
        await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load UOM data. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Material Module", "Unit of Measurement"]}
      />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Unit of Measurement Master
      </h1>
      <MasterPage
        title="Unit of Measurement"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={mappedData}
        columnRenderers={columnRenderers}
        onDataEvent={handleDataEvent}
        exportConfig={{
          title: "Unit of Measurement Master",
          filename: "uom-master",
          columns: [
            { header: "Code",   accessor: "code" },
            { header: "Name",   accessor: "name" },
            { header: "Symbol", accessor: "symbol" },
            { header: "Status", accessor: "status" },
          ],
        }}
      />
    </>
  );
}
