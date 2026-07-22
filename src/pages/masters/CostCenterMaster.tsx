import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Target, Loader2 } from "lucide-react";
import {
  getCostCenters,
  addCostCenter,
  updateCostCenter,
  deleteCostCenter,
  type CostCenterRow,
} from "@/api/costCenterApi";

const mapRow = (row: CostCenterRow): Record<string, unknown> => ({
  _id: String(row.CostCenterId),
  Code: row.Code,
  Name: row.Name,
  Description: row.Description ?? "",
  IsActive: Boolean(row.IsActive),
});

const CostCenterMaster: React.FC = () => {
  const rights = usePageRights("cost-center");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    const fresh = await getCostCenters();
    setRows(fresh.map(mapRow));
  };

  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load cost centers"))
      .finally(() => setLoading(false));
  }, []);

  const fields: FieldDef[] = [
    { name: "Code", label: "Code", type: "text", required: true, uppercase: true },
    { name: "Name", label: "Name", type: "text", required: true },
    {
      name: "Description",
      label: "Description",
      type: "textarea",
      fullWidth: true,
    },
    { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "Code", label: "Code" },
    { key: "Name", label: "Name" },
    { key: "Description", label: "Description", hideOnMobile: true },
    { key: "IsActive", label: "Status" },
  ];

  const columnRenderers = {
    Code: (value: unknown) => (
      <span className="font-mono text-xs font-semibold text-foreground">
        {String(value ?? "")}
      </span>
    ),
    Description: (value: unknown) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
        {value ? String(value) : "—"}
      </span>
    ),
    IsActive: (value: unknown) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value
            ? "bg-primary/10 text-primary border-primary/20"
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
            value ? "bg-primary" : "bg-destructive"
          }`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const record = event.record as Record<string, unknown>;
        await addCostCenter({
          Code: String(record.Code ?? "").trim(),
          Name: String(record.Name ?? "").trim(),
          Description: String(record.Description ?? ""),
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
          ProjectId: null,
        });
        toast.success("Cost center added!");
        await refetch();
      } else if (event.action === "update") {
        const record = event.record as Record<string, unknown>;
        await updateCostCenter(Number(event.id), {
          Code: String(record.Code ?? "").trim(),
          Name: String(record.Name ?? "").trim(),
          Description: String(record.Description ?? ""),
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
          ProjectId: null,
        });
        toast.success("Cost center updated!");
        await refetch();
      } else if (event.action === "delete") {
        await deleteCostCenter(Number(event.id));
        toast.success("Cost center deleted!");
        await refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Finance", "Setup", "Cost Center"]} />
      <FinanceShell
        title="Cost Center"
        subtitle="Tag POs to a cost center — the Trial Balance reflects their transactions per center"
        icon={Target}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading cost centers…</span>
          </div>
        ) : (
          <MasterPage
            title="Cost Center"
            fields={fields}
            columns={columns}
            columnRenderers={columnRenderers}
            initialData={rows}
            onDataEvent={handleDataEvent}
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            exportConfig={
              rights.canExport
                ? {
                    title: "Cost Center Master",
                    filename: "cost-center-master",
                    columns: [
                      { header: "Code", accessor: "Code" },
                      { header: "Name", accessor: "Name" },
                      { header: "Description", accessor: "Description" },
                      {
                        header: "Status",
                        accessor: (r) => (r.IsActive ? "Active" : "Inactive"),
                      },
                    ],
                  }
                : undefined
            }
          />
        )}
      </FinanceShell>
    </>
  );
};

export default CostCenterMaster;
