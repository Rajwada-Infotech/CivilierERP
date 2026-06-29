import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { GLAccountMultiSelect } from "@/components/finance/GLAccountMultiSelect";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { TrendingUp, Loader2 } from "lucide-react";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getProfitCenters,
  addProfitCenter,
  updateProfitCenter,
  deleteProfitCenter,
  type ProfitCenterRow,
} from "@/api/profitCenterApi";

const mapRow = (row: ProfitCenterRow): Record<string, unknown> => ({
  _id: String(row.ProfitCenterId),
  Code: row.Code,
  Name: row.Name,
  Description: row.Description ?? "",
  IsActive: Boolean(row.IsActive),
  ProjectId: row.ProjectId ? String(row.ProjectId) : "",
  ProjectName: row.ProjectName ?? "",
  GLAccountIds: row.GLAccountIds ? row.GLAccountIds.split(",") : [],
  GLAccountNames: row.GLAccountNames ?? "",
  GLAccountCount: row.GLAccountCount ?? 0,
});

const fetchProjectOptions = async () => {
  const opts = await getEnterpriseOptions(undefined, "P");
  return opts.map((o) => ({ value: String(o.id), label: o.label }));
};

const ProfitCenterMaster: React.FC = () => {
  const rights = usePageRights("profit-center");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    const fresh = await getProfitCenters();
    setRows(fresh.map(mapRow));
  };

  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load profit centers"))
      .finally(() => setLoading(false));
  }, []);

  const fields: FieldDef[] = [
    { name: "Code", label: "Code", type: "text", required: true, uppercase: true },
    { name: "Name", label: "Name", type: "text", required: true },
    {
      name: "ProjectId",
      label: "Project",
      type: "select",
      asyncOptions: fetchProjectOptions,
      placeholder: "Company-wide (no project)",
    },
    {
      name: "Description",
      label: "Description",
      type: "textarea",
      fullWidth: true,
    },
    {
      name: "GLAccountIds",
      label: "GL Accounts",
      type: "custom",
      fullWidth: true,
      defaultValue: [],
      render: ({ value, onChange }) => (
        <GLAccountMultiSelect value={value} onChange={onChange} />
      ),
    },
    { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "Code", label: "Code" },
    { key: "Name", label: "Name" },
    { key: "ProjectName", label: "Project", hideOnMobile: true },
    { key: "GLAccountNames", label: "GL Accounts" },
    { key: "Description", label: "Description", hideOnMobile: true },
    { key: "IsActive", label: "Status" },
  ];

  const columnRenderers = {
    Code: (value: unknown) => (
      <span className="font-mono text-xs font-semibold text-foreground">
        {String(value ?? "")}
      </span>
    ),
    GLAccountNames: (value: unknown, row: Record<string, unknown>) => {
      const count = Number(row.GLAccountCount ?? 0);
      if (!count)
        return <span className="text-xs text-muted-foreground/60">—</span>;
      return (
        <span
          className="text-xs text-muted-foreground truncate max-w-[220px] block"
          title={String(value ?? "")}
        >
          {String(value ?? "")}{" "}
          <span className="text-primary font-medium">
            ({count})
          </span>
        </span>
      );
    },
    Description: (value: unknown) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
        {value ? String(value) : "—"}
      </span>
    ),
    ProjectName: (value: unknown) => (
      <span className="text-xs text-muted-foreground">
        {value ? String(value) : <span className="text-muted-foreground/50">Company-wide</span>}
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
        await addProfitCenter({
          Code: String(record.Code ?? "").trim(),
          Name: String(record.Name ?? "").trim(),
          Description: String(record.Description ?? ""),
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
          ProjectId: record.ProjectId ? Number(record.ProjectId) : null,
          GLAccountIds: (record.GLAccountIds as string[]) ?? [],
        });
        toast.success("Profit center added!");
        await refetch();
      } else if (event.action === "update") {
        const record = event.record as Record<string, unknown>;
        await updateProfitCenter(Number(event.id), {
          Code: String(record.Code ?? "").trim(),
          Name: String(record.Name ?? "").trim(),
          Description: String(record.Description ?? ""),
          IsActive: record.IsActive !== undefined ? Boolean(record.IsActive) : true,
          ProjectId: record.ProjectId ? Number(record.ProjectId) : null,
          GLAccountIds: (record.GLAccountIds as string[]) ?? [],
        });
        toast.success("Profit center updated!");
        await refetch();
      } else if (event.action === "delete") {
        await deleteProfitCenter(Number(event.id));
        toast.success("Profit center deleted!");
        await refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Finance", "Setup", "Profit Center"]} />
      <FinanceShell
        title="Profit Center"
        subtitle="Group GL accounts by profit center for revenue tracking"
        icon={TrendingUp}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading profit centers…</span>
          </div>
        ) : (
          <MasterPage
            title="Profit Center"
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
                    title: "Profit Center Master",
                    filename: "profit-center-master",
                    columns: [
                      { header: "Code", accessor: "Code" },
                      { header: "Name", accessor: "Name" },
                      { header: "Project", accessor: (r) => String(r.ProjectName || "Company-wide") },
                      { header: "GL Accounts", accessor: "GLAccountNames" },
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

export default ProfitCenterMaster;
