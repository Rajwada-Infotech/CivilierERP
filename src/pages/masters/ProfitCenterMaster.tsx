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
      <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">
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
          <span className="font-heading font-semibold tabular-nums text-foreground">
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
    IsActive: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "none"} />,
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
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
  };

  return (
    <>
      <Breadcrumbs items={["Finance", "Setup", "Profit Center"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Profit centres"
        subtitle="Group ledger accounts under a profit centre to follow revenue by line of business or project."
      >
        {!loading && (
          <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Profit centres", value: rows.length, note: "in all" },
                { label: "Active", value: rows.filter((r) => r.IsActive).length, note: "open for tagging" },
                { label: "Ledgers grouped", value: rows.reduce((sum, r) => sum + Number(r.GLAccountCount ?? 0), 0), note: "across all centres" },
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
      </SheetShell>
    </>
  );
};

export default ProfitCenterMaster;
