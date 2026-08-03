import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, XCircle, Download, Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { StatusBadge } from "@/components/StatusBadge";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/task-master";
const PRIORITIES = ["Very Important", "Important", "Normal"];
const STATUSES = ["Active", "Hold", "Cancel", "Closed"];

async function fetchAssigneeOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth(`${API}/assignable-users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  const data: { id: number; name: string }[] = await res.json().catch(() => ([]));
  return data.map((u) => ({ value: String(u.id), label: u.name }));
}

// Department is sourced from Department Master (Setup -> Department Master)
// — no more free text here, so every task's Department always matches a
// real, de-duplicated master record.
async function fetchDepartmentOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/department-master");
  if (!res.ok) throw new Error("Failed to fetch departments");
  const data: { Id: number; DepartmentName: string; IsActive: boolean }[] = await res.json().catch(() => ([]));
  return data.filter((d) => d.IsActive).map((d) => ({ value: d.DepartmentName, label: d.DepartmentName }));
}

// April–March cycle, matching backend/utils/docNumberLock.js's currentFinYear().
function currentFinYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

interface TaskDocType {
  TypeOfDocId: number;
  CompanyId: number | null;
  ProjectId: number | null;
}

function resolveTaskDocType(
  docTypes: TaskDocType[],
  companyId?: string,
  projectId?: string,
): TaskDocType | null {
  if (!docTypes.length) return null;
  const exact = docTypes.find(
    (d) =>
      (companyId ? String(d.CompanyId) === companyId : d.CompanyId == null) &&
      (projectId ? String(d.ProjectId) === projectId : d.ProjectId == null),
  );
  if (exact) return exact;
  const companyOnly = docTypes.find(
    (d) => companyId && String(d.CompanyId) === companyId && d.ProjectId == null,
  );
  if (companyOnly) return companyOnly;
  const global = docTypes.find((d) => d.CompanyId == null && d.ProjectId == null);
  return global ?? null;
}

// Read-only preview of the next Task number for the doc type that matches
// the selected Company/Project — the real number is only locked on save
// (taskMaster.js's POST handler), this is just a live preview.
const DocNumberPreview: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  formData: Record<string, unknown>;
}> = ({ onChange, formData }) => {
  const docTypes = (formData.__taskDocTypes as TaskDocType[]) ?? [];
  const companyId = (formData.caseCompanyId as string) || undefined;
  const projectId = (formData.caseProjectId as string) || undefined;
  const matched = resolveTaskDocType(docTypes, companyId, projectId);
  const nextFallbackTaskNo = (formData.__nextFallbackTaskNo as string) || "TSK000001";

  const { data: preview, isFetching } = useQuery({
    queryKey: ["task-master-doc-preview", matched?.TypeOfDocId, currentFinYear()],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/document-type/${matched!.TypeOfDocId}/next-number?finYear=${currentFinYear()}`,
      );
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.nextDocNo ?? null;
    },
    enabled: !!matched,
    staleTime: 30 * 1000,
  });

  React.useEffect(() => {
    onChange(matched?.TypeOfDocId ?? null);
  }, [matched?.TypeOfDocId]);

  return (
    <input
      type="text"
      readOnly
      value={
        !docTypes.length
          ? `${nextFallbackTaskNo} (preview)`
          : isFetching
            ? "Loading…"
            : matched
              ? `${preview ?? "…"} (preview)`
              : `${nextFallbackTaskNo} (preview)`
      }
      className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted/60 border border-border text-muted-foreground cursor-not-allowed"
    />
  );
};

async function fetchTasks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json().catch(() => ({}));
}

async function fetchCompanyOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/company-master");
  if (!res.ok) throw new Error("Failed to fetch companies");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => ({}));
  return data.map((c) => ({ value: String(c.Id), label: c.Name }));
}

async function fetchFinYearOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) throw new Error("Failed to fetch financial years");
  const data: { FId: number; FName: string }[] = await res.json().catch(() => ({}));
  return data.map((f) => ({ value: String(f.FId), label: f.FName }));
}

const fields: FieldDef[] = [
  {
    name: "typeOfDocId",
    label: "Document Number",
    type: "custom",
    fullWidth: true,
    render: (props) => <DocNumberPreview {...props} />,
  },
  {
    name: "caseCompanyId",
    label: "Company",
    type: "select",
    asyncOptions: fetchCompanyOptions,
  },
  {
    name: "caseProjectId",
    label: "Project",
    type: "select",
    optionsProvider: (_data, _currentId, form) => {
      const projects: { Id: number; Name: string; CompanyId: number | null }[] =
        (form?.__projects as any) ?? [];
      const selectedCompany = form?.caseCompanyId as string | undefined;
      return projects
        .filter((p) => (selectedCompany ? String(p.CompanyId) === selectedCompany : true))
        .map((p) => ({ value: String(p.Id), label: p.Name }));
    },
  },
  {
    name: "caseFinYearId",
    label: "Financial Year",
    type: "select",
    asyncOptions: fetchFinYearOptions,
    defaultToFirstOption: true,
  },

  { name: "section-task", label: "Task Details", type: "section" },
  { name: "subject", label: "Subject", type: "text", required: true },
  { name: "details", label: "Details", type: "textarea", fullWidth: true },
  { name: "department", label: "Department", type: "select", asyncOptions: fetchDepartmentOptions },
  { name: "dueDate", label: "Due Date", type: "date" },
  { name: "caseNumber", label: "Case Number", type: "text", placeholder: "Manual entry" },
  { name: "assignedTo", label: "Assignee", type: "select", asyncOptions: fetchAssigneeOptions },
  {
    name: "priority",
    label: "Priority",
    type: "select",
    required: true,
    defaultValue: "Normal",
    options: PRIORITIES,
  },
  {
    // Hold/Cancel are lifecycle transitions applied from the grid's row
    // actions (see rowActions below), not choices in the create/edit form —
    // the form only ever sets a new task Active or Inactive (mapped to Hold,
    // the closest existing Status value) at creation time.
    name: "isActiveToggle",
    label: "Active",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "taskNo", label: "Task No." },
  { key: "subject", label: "Subject" },
  { key: "department", label: "Department" },
  { key: "assigneeName", label: "Assignee" },
  { key: "dueDate", label: "Due Date" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Task No.", accessor: "taskNo" },
  { header: "Subject", accessor: "subject" },
  { header: "Department", accessor: "department" },
  { header: "Due Date", accessor: "dueDate" },
  { header: "Case Number", accessor: "caseNumber" },
  { header: "Priority", accessor: "priority" },
  { header: "Status", accessor: "status" },
];

// Bulk-import template — TaskNo is deliberately excluded since it's always
// auto-generated (trg_TaskMaster_TaskNo / the doc-numbering scheme), never
// something you'd type into a spreadsheet.
const IMPORT_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: "Subject", accessor: "Subject" },
  { header: "Details", accessor: "Details" },
  { header: "Department", accessor: "Department" },
  { header: "Due Date (YYYY-MM-DD)", accessor: "DueDate" },
  { header: "Case Number", accessor: "CaseNumber" },
  { header: "Priority (Very Important/Important/Normal)", accessor: "Priority" },
  { header: "Status (Active/Hold/Cancel/Closed)", accessor: "Status" },
];

const TaskMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: tasks, isLoading, error } = useQuery({
    queryKey: ["task-master"],
    queryFn: fetchTasks,
    staleTime: 2 * 60 * 1000,
  });

  const { data: allProjects = [] } = useQuery<{ Id: number; Name: string; CompanyId: number | null }[]>({
    queryKey: ["task-master-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/project-master");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: taskDocTypes = [] } = useQuery<TaskDocType[]>({
    queryKey: ["task-master-doctypes"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/document-type?module=TASK");
      if (!res.ok) throw new Error("Failed to fetch task document types");
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data)
        ? data.map((d: any) => ({
            TypeOfDocId: d.TypeOfDocId,
            CompanyId: d.CompanyId ?? null,
            ProjectId: d.ProjectId ?? null,
          }))
        : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    return tasks.map((t) => ({
      _id: String(t.Id),
      taskNo: t.TaskNo ?? "",
      subject: t.Subject ?? "",
      details: t.Details ?? "",
      department: t.Department ?? "",
      dueDate: t.DueDate ? String(t.DueDate).slice(0, 10) : "",
      caseNumber: t.CaseNumber ?? "",
      assignedTo: t.AssignedTo ? String(t.AssignedTo) : "",
      assigneeName: t.AssigneeName ?? "",
      priority: t.Priority ?? "Normal",
      status: t.Status ?? "Active",
      isActiveToggle: (t.Status ?? "Active") === "Active",
      caseCompanyId: t.CaseCompanyId ? String(t.CaseCompanyId) : "",
      caseCompanyName: t.CaseCompanyName ?? "",
      caseProjectId: t.CaseProjectId ? String(t.CaseProjectId) : "",
      caseProjectName: t.CaseProjectName ?? "",
      caseFinYearId: t.CaseFinYearId ? String(t.CaseFinYearId) : "",
      caseFinYearName: t.CaseFinYearName ?? "",
      typeOfDocId: t.TypeOfDocId ? String(t.TypeOfDocId) : "",
      typeOfDocLabel: t.TypeOfDocLabel ?? "",
      createdByName: t.CreatedByName ?? "",
      createdAt: t.CreatedAt ?? "",
    }));
  }, [tasks]);

  // Preview of the TSK000001-style fallback number the trigger would assign
  // if no doc type is selected — derived from the highest existing TaskNo
  // already loaded, purely a display preview (the real value is assigned by
  // trg_TaskMaster_TaskNo at insert time).
  const nextFallbackTaskNo = React.useMemo(() => {
    if (!Array.isArray(tasks)) return "TSK000001";
    let maxSeq = 0;
    for (const t of tasks) {
      const m = /^TSK(\d+)$/.exec(t.TaskNo || "");
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    return `TSK${String(maxSeq + 1).padStart(6, "0")}`;
  }, [tasks]);

  const formPatch = React.useMemo(
    () => ({
      __projects: allProjects,
      __taskDocTypes: taskDocTypes,
      __nextFallbackTaskNo: nextFallbackTaskNo,
    }),
    [allProjects, taskDocTypes, nextFallbackTaskNo],
  );

  const toPayload = (r: Record<string, any>) => ({
    Subject: r.subject?.trim() || null,
    Details: r.details?.trim() || null,
    Department: r.department?.trim() || null,
    DueDate: r.dueDate || null,
    CaseNumber: r.caseNumber?.trim() || null,
    Priority: r.priority || "Normal",
    // A Cancelled/Closed task stays that way through the form — the Active
    // toggle only ever moves a task between Active/Hold. Un-cancelling or
    // reopening is a deliberate row/drawer action, not a form edit.
    Status:
      r.status === "Cancel" || r.status === "Closed"
        ? r.status
        : r.isActiveToggle === false
          ? "Hold"
          : "Active",
    CaseCompanyId: r.caseCompanyId ? parseInt(r.caseCompanyId) : null,
    CaseProjectId: r.caseProjectId ? parseInt(r.caseProjectId) : null,
    CaseFinYearId: r.caseFinYearId ? parseInt(r.caseFinYearId) : null,
    TypeOfDocId: r.typeOfDocId ? parseInt(r.typeOfDocId) : null,
    AssignedTo: r.assignedTo ? parseInt(r.assignedTo) : null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add task");
      toast.success("Task added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update task");
      toast.success("Task updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete task");
      toast.success("Task deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["task-master"] });
  };

  const updateStatus = async (id: string, status: string) => {
    const res = await fetchWithAuth(`${API}/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Status: status }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Failed to update status");
      return;
    }
    toast.success(`Task marked ${status}`);
    await queryClient.invalidateQueries({ queryKey: ["task-master"] });
  };

  const handleDownloadTemplate = () => {
    exportToCsv([], IMPORT_TEMPLATE_COLUMNS, "task-master-template");
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
      // Sequential — keeps error rows attributable and avoids hammering the
      // API with N parallel inserts (each one also locks a doc number if a
      // Type of Doc were ever wired into the template).
      for (const row of rows) {
        const subject = row["Subject"]?.trim();
        if (!subject) {
          failed++;
          continue;
        }
        const priority = row["Priority (Very Important/Important/Normal)"]?.trim() || "Normal";
        const status = row["Status (Active/Hold/Cancel/Closed)"]?.trim() || "Active";
        try {
          const res = await fetchWithAuth(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              Subject: subject,
              Details: row["Details"]?.trim() || null,
              Department: row["Department"]?.trim() || null,
              DueDate: row["Due Date (YYYY-MM-DD)"]?.trim() || null,
              CaseNumber: row["Case Number"]?.trim() || null,
              Priority: PRIORITIES.includes(priority) ? priority : "Normal",
              Status: STATUSES.includes(status) ? status : "Active",
            }),
          });
          if (res.ok) success++;
          else failed++;
        } catch {
          failed++;
        }
      }

      if (failed === 0) toast.success(`Imported ${success} task${success === 1 ? "" : "s"} ✓`);
      else if (success === 0) toast.error(`Import failed for all ${failed} row${failed === 1 ? "" : "s"}.`);
      else toast.warning(`Imported ${success} of ${rows.length} rows — ${failed} failed.`);

      await queryClient.invalidateQueries({ queryKey: ["task-master"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to import CSV");
    } finally {
      setImporting(false);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading tasks...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load tasks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Task Master"]} />
      <FollowupShell
        title="Task Master"
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
          title="Task"
          gridCols={3}
          fields={fields}
          columns={columns}
          columnRenderers={{
            priority: (value) => <StatusBadge status={value as string} />,
            status: (value) => <StatusBadge status={value as string} />,
          }}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          externalFormPatch={formPatch}
          externalFormPatchKey={`${allProjects.length}-${taskDocTypes.length}`}
          rowActions={(row) => {
            const status = row.status as string;
            if (status === "Cancel" || status === "Closed") return null;
            return (
              <>
                {status === "Active" ? (
                  <button
                    type="button"
                    onClick={() => updateStatus(row._id, "Hold")}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                    title="Put on hold"
                  >
                    <PauseCircle size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateStatus(row._id, "Active")}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                    title="Resume (set Active)"
                  >
                    <PlayCircle size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Cancel this task? It will be kept for audit but cannot be processed further.")) {
                      updateStatus(row._id, "Cancel");
                    }
                  }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Cancel task"
                >
                  <XCircle size={14} />
                </button>
              </>
            );
          }}
          onFieldChange={(form, fieldName) => {
            if (fieldName === "caseCompanyId") {
              return { ...form, caseProjectId: "" };
            }
            return form;
          }}
          exportConfig={{
            title: "Task Master",
            filename: "task-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Task Details",
            fields: [
              { key: "taskNo", label: "Task No." },
              { key: "subject", label: "Subject" },
              { key: "details", label: "Details" },
              { key: "department", label: "Department" },
              { key: "assigneeName", label: "Assignee" },
              { key: "dueDate", label: "Due Date" },
              { key: "caseNumber", label: "Case Number" },
              { key: "priority", label: "Priority" },
              { key: "status", label: "Status" },
              { key: "caseCompanyName", label: "Case Company" },
              { key: "caseProjectName", label: "Case Project" },
              { key: "caseFinYearName", label: "Case Financial Year" },
              { key: "createdByName", label: "Created By" },
            ],
          }}
        />
      </FollowupShell>
    </>
  );
};

export default TaskMaster;
