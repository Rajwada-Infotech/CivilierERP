import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/department-master";

async function fetchDepartments(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch departments");
  return res.json().catch(() => ({}));
}

const fields: FieldDef[] = [
  {
    name: "departmentName",
    label: "Department Name",
    type: "text",
    required: true,
  },
  {
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "departmentName", label: "Department Name" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Department Name", accessor: "departmentName" },
  { header: "Status", accessor: "isActive" },
];

// Bulk-import template — Id/Status aren't included, same reasoning as Task
// Master's template: only the fields a person would actually type in a sheet.
const IMPORT_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: "Department Name", accessor: "DepartmentName" },
];

const DepartmentMaster: React.FC = () => {
  usePageRights("department-master");
  const queryClient = useQueryClient();

  const { data: departments, isLoading, error } = useQuery({
    queryKey: ["department-master"],
    queryFn: fetchDepartments,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(departments)) return [];
    return departments.map((item) => ({
      _id: String(item.Id),
      departmentName: item.DepartmentName ?? "",
      isActive: Boolean(item.IsActive),
    }));
  }, [departments]);

  const toPayload = (r: Record<string, any>) => ({
    DepartmentName: r.departmentName?.trim() || null,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add department");
        toast.success("Department added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update department");
        toast.success("Department updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete department");
        toast.success("Department deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["department-master"] });
      // Task Master's Department dropdown reads from this same list.
      await queryClient.invalidateQueries({ queryKey: ["task-master-departments"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const handleDownloadTemplate = () => {
    exportToCsv([], IMPORT_TEMPLATE_COLUMNS, "department-master-template");
    toast.success("Template downloaded — fill it in and use Import.");
  };

  const [importing, setImporting] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same filename
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file.");
      return;
    }

    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        toast.error("The CSV file has no data rows.");
        return;
      }

      let success = 0;
      let failed = 0;
      let duplicates = 0;
      // Sequential — keeps error rows attributable, and UQ_DepartmentMaster_Name
      // means a duplicate name in the sheet fails cleanly per-row instead of
      // silently overwriting anything.
      for (const row of rows) {
        const name = row["Department Name"]?.trim();
        if (!name) {
          failed++;
          continue;
        }
        try {
          const res = await fetchWithAuth(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ DepartmentName: name, IsActive: true }),
          });
          if (res.ok) success++;
          else if (res.status === 409) duplicates++;
          else failed++;
        } catch {
          failed++;
        }
      }

      const skipped = failed + duplicates;
      if (skipped === 0) toast.success(`Imported ${success} department${success === 1 ? "" : "s"} ✓`);
      else if (success === 0) toast.error(`Import failed for all ${rows.length} row${rows.length === 1 ? "" : "s"}${duplicates ? ` (${duplicates} already existed)` : ""}.`);
      else toast.warning(`Imported ${success} of ${rows.length} rows — ${duplicates} duplicate${duplicates === 1 ? "" : "s"}, ${failed} failed.`);

      await queryClient.invalidateQueries({ queryKey: ["department-master"] });
      await queryClient.invalidateQueries({ queryKey: ["task-master-departments"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to import CSV");
    } finally {
      setImporting(false);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading departments...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load departments.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Department Master"]} />
      <FollowupShell
        title="Department Master"
        action={
          <div className="flex items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              <Download size={13} /> Download Template
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={importing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
              style={{ background: "rgba(13,148,136,0.14)", border: "1px solid rgba(13,148,136,0.35)", color: "#0d9488" }}
            >
              <Upload size={13} /> {importing ? "Importing…" : "Import CSV"}
            </button>
          </div>
        }
      >
        <MasterPage
          title="Department"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Department Master",
            filename: "department-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Department Details",
            fields: [
              { key: "departmentName", label: "Department Name" },
              { key: "isActive", label: "Status" },
            ],
          }}
          onPrint={(row) => {
            const win = window.open("", "_blank", "width=600,height=400");
            if (!win) return;
            win.document.write(safeHtml`
              <html><head><title>Department — ${row.departmentName}</title>
              <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
              </head><body><h2>Department</h2><table>
                <tr><td>Department Name</td><td>${row.departmentName || "—"}</td></tr>
                <tr><td>Status</td><td>${row.isActive ? "Active" : "Inactive"}</td></tr>
              </table></body></html>
            `);
            win.document.close();
            win.print();
          }}
        />
      </FollowupShell>
    </>
  );
};

export default DepartmentMaster;
