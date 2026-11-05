import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
      <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">
        {String(value ?? "")}
      </span>
    ),
    Description: (value: unknown) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
        {value ? String(value) : "—"}
      </span>
    ),
    IsActive: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "none"} />,
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
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
  };

  return (
    <>
      <Breadcrumbs items={["Finance", "Setup", "Cost Center"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Cost centres"
        subtitle="Tag purchase orders to a cost centre; the Trial Balance can then show their transactions centre by centre."
      >
        {!loading && (
          <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Cost centres", value: rows.length, note: "in all" },
                { label: "Active", value: rows.filter((r) => r.IsActive).length, note: "open for tagging" },
                { label: "Inactive", value: rows.filter((r) => !r.IsActive).length, note: "kept for past entries" },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
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
      </SheetShell>
    </>
  );
};

export default CostCenterMaster;
