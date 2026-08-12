import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, XCircle, Download, Upload, ListPlus, CornerDownRight, ChevronRight, ChevronDown, AlarmClock } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
  Prefix: string;
  Description: string | null;
  CompanyName: string;
  ProjectName: string;
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

function docTypeOptionLabel(d: TaskDocType): string {
  const scope =
    d.CompanyName && d.CompanyName !== "All Companies"
      ? d.ProjectName && d.ProjectName !== "All Projects"
        ? ` (${d.CompanyName} / ${d.ProjectName})`
        : ` (${d.CompanyName})`
      : "";
  return `${d.Prefix} — ${d.Description || "Untitled"}${scope}`;
}

// "Document Number" — a real dropdown of every Type of Doc registered for
// the Follow-Up/Task module (module=TASK, formData.__taskDocTypes), plus a
// live preview of the next number for whichever one is selected. Defaults
// to whichever doc type matches the selected Company/Project the first time
// nothing has been picked yet, but stays a normal manual dropdown after
// that — the real number is only locked on save (taskMaster.js's POST
// handler), this is just a preview.
const DocNumberPreview: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  formData: Record<string, unknown>;
}> = ({ value, onChange, formData }) => {
  const docTypes = (formData.__taskDocTypes as TaskDocType[]) ?? [];
  const companyId = (formData.caseCompanyId as string) || undefined;
  const projectId = (formData.caseProjectId as string) || undefined;
  const matched = resolveTaskDocType(docTypes, companyId, projectId);
  const nextFallbackTaskNo = (formData.__nextFallbackTaskNo as string) || "TSK000001";

  const selectedId = (value as string) || "";
  const effectiveId = selectedId || (matched ? String(matched.TypeOfDocId) : "");

  const { data: preview, isFetching } = useQuery({
    queryKey: ["task-master-doc-preview", effectiveId, currentFinYear()],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/document-type/${effectiveId}/next-number?finYear=${currentFinYear()}`,
      );
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.nextDocNo ?? null;
    },
    enabled: !!effectiveId,
    staleTime: 30 * 1000,
  });

  // Auto-default to the Company/Project match only until the user (or a
  // previously saved row) has a value of their own — never overrides a
  // manual pick.
  React.useEffect(() => {
    if (!selectedId && matched) onChange(String(matched.TypeOfDocId));
  }, [selectedId, matched?.TypeOfDocId]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <select
          value={selectedId}
          onChange={(e) => onChange(e.target.value)}
          disabled={!docTypes.length}
          className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground appearance-none pr-9 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {docTypes.length ? "Select…" : "No Type of Doc set up for Follow-Up"}
          </option>
          {docTypes.map((d) => (
            <option key={d.TypeOfDocId} value={String(d.TypeOfDocId)}>
              {docTypeOptionLabel(d)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground px-0.5">
        {!effectiveId
          ? `${nextFallbackTaskNo} (preview)`
          : isFetching
            ? "Loading…"
            : `${preview ?? "…"} (preview)`}
      </p>
    </div>
  );
};

// Reminder date/time — when to pop this task into the reminder bell /
// login-popup pipeline (src/hooks/useReminders.ts's fetchFollowUpReminders),
// same one Follow-Up notes' "Next follow-up" already feeds. A plain
// <input type="datetime-local"> since MasterPage's built-in "date" field
// type has no time component.
const ReminderDateTimeInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ value, onChange }) => (
  <div className="relative">
    <AlarmClock
      size={14}
      className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70"
    />
    <input
      type="datetime-local"
      value={(value as string) || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground pl-8 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
    />
  </div>
);

// Server sends ReminderAt as an ISO/UTC string; <input type="datetime-local">
// needs "YYYY-MM-DDTHH:mm" in the browser's local time — Date's local
// getters do that conversion, toISOString() would not (it stays UTC).
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fetchTasks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json().catch(() => ({}));
}

// Re-orders a flat task list into a collapsible tree — every subtask
// immediately follows its parent (recursively), each tagged with
// __treeDepth for indentation and __hasChildren so the Subject column can
// draw a toggle. A parent's children are only walked into (and thus only
// appear in the output) when its id is in `expandedIds` — collapsed by
// default, matching a normal file-tree/task-tree UX. MasterPage renders
// rows in the order it's given as long as no column header sort is active,
// so this ordering (and the collapsing) is purely a function of the row
// order we hand it — no MasterPage changes needed.
function toTreeOrder(rows: RecordWithId[], expandedIds: Set<string>): RecordWithId[] {
  const byParent = new Map<string, RecordWithId[]>();
  const roots: RecordWithId[] = [];
  const ids = new Set(rows.map((r) => r._id));
  for (const r of rows) {
    const pid = (r.parentTaskId as string) || "";
    // A subtask whose parent isn't in the list (deleted/filtered out) is
    // shown at the root level rather than silently dropped.
    if (pid && ids.has(pid)) {
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(r);
    } else {
      roots.push(r);
    }
  }
  const result: RecordWithId[] = [];
  const visit = (list: RecordWithId[], depth: number) => {
    for (const r of list) {
      const children = byParent.get(r._id);
      result.push({ ...r, __treeDepth: depth, __hasChildren: !!children });
      if (children && expandedIds.has(r._id)) visit(children, depth + 1);
    }
  };
  visit(roots, 0);
  return result;
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

// Entry Type — the same admin-setup master (Setup -> Entry Type Master)
// every module's document numbering is built on.
async function fetchEntryTypeOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/document-type/entrytypes");
  if (!res.ok) throw new Error("Failed to fetch entry types");
  const data: { EntryTypeId: string; EntryType: string }[] = await res.json().catch(() => ([]));
  return data.map((e) => ({ value: e.EntryTypeId, label: e.EntryType }));
}

interface AnyModuleDocType {
  TypeOfDocId: number;
  Prefix: string;
  Description: string | null;
  EntryTypeId: string | null;
  links_to: string | null;
}

// Every active Type of Doc across every module (no ?module= filter) — the
// "Type of Doc" field below narrows this down client-side to whichever
// Entry Type is selected, same optionsProvider + __xxx form-patch pattern
// used for Company -> Project elsewhere on this page.
async function fetchAllDocTypes(): Promise<AnyModuleDocType[]> {
  const res = await fetchWithAuth("/api/document-type");
  if (!res.ok) throw new Error("Failed to fetch document types");
  return res.json().catch(() => ([]));
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
    // Reference-only tagging — which admin-setup Entry Type this task
    // relates to. Independent of the Document Number preview above (which
    // drives the task's own TaskNo and is auto-matched to the TASK module).
    name: "entryTypeId",
    label: "Entry Type",
    type: "select",
    asyncOptions: fetchEntryTypeOptions,
  },
  {
    // Every Type of Doc under the selected Entry Type, from ANY module —
    // not just Task's own doc types. Options come from __allDocTypes
    // (formPatch-injected, see fetchAllDocTypes), filtered client-side.
    name: "linkedTypeOfDocId",
    label: "Type of Doc",
    type: "select",
    disabledWhen: (form) => !form?.entryTypeId,
    disabledPlaceholder: "Select an Entry Type first",
    optionsProvider: (_data, _currentId, form) => {
      const allDocTypes: AnyModuleDocType[] = (form?.__allDocTypes as any) ?? [];
      const entryTypeId = form?.entryTypeId as string | undefined;
      if (!entryTypeId) return [];
      return allDocTypes
        .filter((d) => d.EntryTypeId === entryTypeId)
        .map((d) => ({
          value: String(d.TypeOfDocId),
          label: `${d.Prefix} — ${d.Description || d.links_to || "Untitled"}`,
        }));
    },
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
  {
    name: "reminderAt",
    label: "Reminder Date & Time",
    type: "custom",
    render: (props) => <ReminderDateTimeInput {...props} />,
  },
  { name: "caseNumber", label: "Case Number", type: "text", placeholder: "Manual entry" },
  { name: "assignedTo", label: "Assignee", type: "select", asyncOptions: fetchAssigneeOptions },
  {
    // Optional self-reference — set this to make the task a subtask of
    // another task. Options come straight from the grid's already-loaded
    // data, excluding the record currently being edited.
    name: "parentTaskId",
    label: "Parent Task",
    type: "select",
    optionsProvider: (data, currentId) =>
      data
        .filter((r) => r._id !== currentId)
        .map((r) => ({ value: r._id, label: `${r.taskNo} — ${r.subject}` })),
  },
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
  { key: "parentTaskNo", label: "Parent Task" },
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

  // Which parent tasks currently have their subtasks expanded — collapsed
  // (i.e. absent from this set) by default, so the grid opens showing only
  // top-level tasks until a row's toggle is clicked.
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            Prefix: d.Prefix ?? "",
            Description: d.Description ?? null,
            CompanyName: d.CompanyName ?? "All Companies",
            ProjectName: d.ProjectName ?? "All Projects",
          }))
        : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: allDocTypes = [] } = useQuery<AnyModuleDocType[]>({
    queryKey: ["task-master-all-doctypes"],
    queryFn: fetchAllDocTypes,
    staleTime: 5 * 60 * 1000,
  });

  const flatMapped: RecordWithId[] = React.useMemo(() => {
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
      parentTaskId: t.ParentTaskId ? String(t.ParentTaskId) : "",
      parentTaskNo: t.ParentTaskNo ?? "",
      parentTaskSubject: t.ParentTaskSubject ?? "",
      reminderAt: toDatetimeLocalValue(t.ReminderAt),
      entryTypeId: t.EntryTypeId ?? "",
      entryTypeLabel: t.EntryTypeLabel ?? "",
      linkedTypeOfDocId: t.LinkedTypeOfDocId ? String(t.LinkedTypeOfDocId) : "",
      linkedTypeOfDocLabel:
        t.LinkedTypeOfDocPrefix || t.LinkedTypeOfDocLabel
          ? `${t.LinkedTypeOfDocPrefix ?? ""}${t.LinkedTypeOfDocPrefix && t.LinkedTypeOfDocLabel ? " — " : ""}${t.LinkedTypeOfDocLabel ?? ""}`
          : "",
    }));
  }, [tasks]);

  const mappedData: RecordWithId[] = React.useMemo(
    () => toTreeOrder(flatMapped, expandedIds),
    [flatMapped, expandedIds],
  );

  // Subtask count per task, purely a display aid for the grid/view — derived
  // from the full (uncollapsed) list so a collapsed parent still shows its
  // true count rather than 0.
  const subtaskCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of flatMapped) {
      if (!r.parentTaskId) continue;
      const key = String(r.parentTaskId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [flatMapped]);

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
      __allDocTypes: allDocTypes,
    }),
    [allProjects, taskDocTypes, nextFallbackTaskNo, allDocTypes],
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
    ParentTaskId: r.parentTaskId ? parseInt(r.parentTaskId) : null,
    // r.reminderAt is "YYYY-MM-DDTHH:mm" from <input type="datetime-local">,
    // parsed as local time — new Date() does that correctly with no "Z"
    // suffix; toISOString() then converts it to UTC for storage.
    ReminderAt: r.reminderAt ? new Date(r.reminderAt).toISOString() : null,
    EntryTypeId: r.entryTypeId || null,
    LinkedTypeOfDocId: r.linkedTypeOfDocId ? parseInt(r.linkedTypeOfDocId) : null,
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

  // Quick "+ Subtask" — a lightweight dialog off the grid row, separate from
  // the main Add/Edit form. Inherits Company/Project/Case Number/Department
  // from the parent so the subtask stays grouped under the same case; the
  // full field set (Company, Doc Number, etc.) can still be edited later via
  // the normal Edit action since a subtask is a full Task record.
  const [subtaskParent, setSubtaskParent] = React.useState<RecordWithId | null>(null);
  const [subtaskForm, setSubtaskForm] = React.useState({ subject: "", dueDate: "", assignedTo: "", priority: "Normal" });
  const [savingSubtask, setSavingSubtask] = React.useState(false);

  const { data: assigneeOptions = [] } = useQuery({
    queryKey: ["task-master-assignees"],
    queryFn: fetchAssigneeOptions,
    staleTime: 5 * 60 * 1000,
  });

  const openSubtaskDialog = (row: RecordWithId) => {
    setSubtaskParent(row);
    setSubtaskForm({ subject: "", dueDate: "", assignedTo: "", priority: "Normal" });
  };

  const handleCreateSubtask = async () => {
    if (!subtaskParent) return;
    if (!subtaskForm.subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    setSavingSubtask(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Subject: subtaskForm.subject.trim(),
          DueDate: subtaskForm.dueDate || null,
          AssignedTo: subtaskForm.assignedTo ? parseInt(subtaskForm.assignedTo) : null,
          Priority: subtaskForm.priority,
          Department: subtaskParent.department || null,
          CaseNumber: subtaskParent.caseNumber || null,
          CaseCompanyId: subtaskParent.caseCompanyId ? parseInt(String(subtaskParent.caseCompanyId)) : null,
          CaseProjectId: subtaskParent.caseProjectId ? parseInt(String(subtaskParent.caseProjectId)) : null,
          CaseFinYearId: subtaskParent.caseFinYearId ? parseInt(String(subtaskParent.caseFinYearId)) : null,
          ParentTaskId: parseInt(subtaskParent._id),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to add subtask");
      toast.success("Subtask added!");
      setSubtaskParent(null);
      await queryClient.invalidateQueries({ queryKey: ["task-master"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add subtask");
    } finally {
      setSavingSubtask(false);
    }
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
            subject: (value, row) => {
              const depth = (row.__treeDepth as number) ?? 0;
              const hasChildren = !!row.__hasChildren;
              const expanded = expandedIds.has(row._id);
              const count = subtaskCounts.get(row._id) ?? 0;

              return (
                <span className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
                  {depth > 0 && <CornerDownRight size={12} className="text-muted-foreground shrink-0" />}
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(row._id);
                      }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground shrink-0"
                      title={expanded ? "Collapse subtasks" : "Expand subtasks"}
                    >
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  ) : (
                    <span className="w-[18px] shrink-0" />
                  )}
                  <span>{value as string}</span>
                  {hasChildren && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      ({count})
                    </span>
                  )}
                </span>
              );
            },
            priority: (value) => <StatusBadge status={value as string} />,
            status: (value) => <StatusBadge status={value as string} />,
            parentTaskNo: (value, row) => {
              const subtaskCount = subtaskCounts.get(String(row._id)) ?? 0;
              if (value) {
                return <span className="text-xs text-muted-foreground">Sub of {value as string}</span>;
              }
              if (subtaskCount > 0) {
                return <span className="text-xs text-muted-foreground">{subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}</span>;
              }
              return <span className="text-xs text-muted-foreground">—</span>;
            },
          }}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          externalFormPatch={formPatch}
          externalFormPatchKey={`${allProjects.length}-${taskDocTypes.length}-${allDocTypes.length}`}
          rowActions={(row) => {
            const status = row.status as string;
            const lifecycleActionsDisabled = status === "Cancel" || status === "Closed";
            return (
              <>
                <button
                  type="button"
                  onClick={() => openSubtaskDialog(row)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title="Add subtask"
                >
                  <ListPlus size={14} />
                </button>
                {lifecycleActionsDisabled ? null : status === "Active" ? (
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
                {lifecycleActionsDisabled ? null : (
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
                )}
              </>
            );
          }}
          onFieldChange={(form, fieldName) => {
            if (fieldName === "caseCompanyId") {
              return { ...form, caseProjectId: "" };
            }
            if (fieldName === "entryTypeId") {
              return { ...form, linkedTypeOfDocId: "" };
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
              { key: "reminderAt", label: "Reminder Date & Time" },
              { key: "caseNumber", label: "Case Number" },
              { key: "priority", label: "Priority" },
              { key: "status", label: "Status" },
              { key: "caseCompanyName", label: "Case Company" },
              { key: "caseProjectName", label: "Case Project" },
              { key: "caseFinYearName", label: "Case Financial Year" },
              { key: "parentTaskNo", label: "Parent Task" },
              { key: "entryTypeLabel", label: "Entry Type" },
              { key: "linkedTypeOfDocLabel", label: "Type of Doc" },
              { key: "createdByName", label: "Created By" },
            ],
          }}
        />
      </FollowupShell>

      <Dialog open={!!subtaskParent} onOpenChange={(open) => !open && setSubtaskParent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add Subtask{subtaskParent ? ` — under ${subtaskParent.taskNo}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject *</label>
              <input
                type="text"
                autoFocus
                value={subtaskForm.subject}
                onChange={(e) => setSubtaskForm((f) => ({ ...f, subject: e.target.value }))}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="What needs to be done?"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due Date</label>
                <input
                  type="date"
                  value={subtaskForm.dueDate}
                  onChange={(e) => setSubtaskForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <select
                  value={subtaskForm.priority}
                  onChange={(e) => setSubtaskForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assignee</label>
              <select
                value={subtaskForm.assignedTo}
                onChange={(e) => setSubtaskForm((f) => ({ ...f, assignedTo: e.target.value }))}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Unassigned</option>
                {assigneeOptions.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSubtaskParent(null)}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateSubtask}
              disabled={savingSubtask}
              className="px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ background: "rgba(13,148,136,0.14)", border: "1px solid rgba(13,148,136,0.35)", color: "#0d9488" }}
            >
              {savingSubtask ? "Adding…" : "Add Subtask"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TaskMaster;
