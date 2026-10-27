import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CheckCircle2, Plus, Search, X, RotateCcw } from "lucide-react";
import { SaTabs } from "@/components/sa/SaTabs";
import { StatusCell, TitleCell } from "@/components/sa/saCells";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DateTimeInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const API = "/api/sa/lead-tasks";

async function fetchTasks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch lead tasks");
  return res.json().catch(() => []);
}

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchUsers(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
// Matches the backend's own "finished" set (saLeadTasks.js overdue filter).
const FINISHED = ["Done", "Cancelled"];
const isOpen = (t: any) => !FINISHED.includes(t.Status);
const isOverdue = (t: any) => isOpen(t) && !!t.DueDate && new Date(t.DueDate).getTime() < Date.now();
const isToday = (t: any) => isOpen(t) && !!t.DueDate && new Date(t.DueDate).toDateString() === new Date().toDateString();

const VIEWS = [
  { key: "open", label: "Open", test: isOpen },
  { key: "overdue", label: "Overdue", test: isOverdue },
  { key: "today", label: "Due today", test: isToday },
  { key: "done", label: "Done", test: (t: any) => t.Status === "Done" },
  { key: "all", label: "All", test: () => true },
] as const;
type TaskView = (typeof VIEWS)[number]["key"];

const fmtDue = (d: unknown) =>
  d ? new Date(String(d)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "No due date";

const inputCls = "w-full border border-border rounded-md bg-background px-3 py-2 text-sm";
const Label: React.FC<{ text: string; required?: boolean; children: React.ReactNode; className?: string }> = ({ text, required, children, className }) => (
  <label className={`block space-y-1 ${className ?? ""}`}>
    <span className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">{text}{required && <span className="text-destructive ml-0.5">*</span>}</span>
    {children}
  </label>
);

const SaLeadTasks: React.FC = () => {
  usePageRights("sa-lead-tasks");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ LeadId: "", Title: "", Description: "", AssignedTo: "", DueDate: "", Priority: "Normal" });
  const { data: tasks = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-lead-tasks"], queryFn: fetchTasks, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users-options"], queryFn: fetchUsers, staleTime: 60_000 });

  const [view, setView] = useState<TaskView>("open");
  const [formOpen, setFormOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => VIEWS.find((v) => v.key === view)!.test(t)
      && (!q || [t.Title, t.CustomerName, t.LeadUid, t.Mobile, t.AssigneeName, t.Priority, t.Status]
        .some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [tasks, query, view]);

  const createTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.LeadId) return toast.error("Select a lead");
    if (!form.Title.trim()) return toast.error("Task title is required");
    try {
      const res = await fetchWithAuth(`${API}/lead/${form.LeadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Title: form.Title,
          Description: form.Description || null,
          AssignedTo: form.AssignedTo || null,
          DueDate: form.DueDate || null,
          Priority: form.Priority,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to create task");
      toast.success("Task created");
      setForm({ LeadId: "", Title: "", Description: "", AssignedTo: "", DueDate: "", Priority: "Normal" });
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["sa-lead-tasks"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    }
  };

  const updateStatus = async (task: any, Status: string) => {
    try {
      const res = await fetchWithAuth(`${API}/${task.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update task");
      toast.success(Status === "Done" ? "Task completed" : "Task updated");
      await queryClient.invalidateQueries({ queryKey: ["sa-lead-tasks"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to update task");
    }
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Tasks"]} title="Lead Tasks">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load tasks. Refresh the page to try again." : "Loading tasks…"}
      </div>
    </SalesAutoShell>
  );

  const canEdit = canDoAction("sa-lead-tasks", "edit");
  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "Title", header: "Task", size: 220,
      cell: (i) => TitleCell(i.row.original.Title, i.row.original.Description) },
    { accessorKey: "CustomerName", header: "Lead", size: 150,
      cell: (i) => TitleCell(i.row.original.CustomerName, [i.row.original.LeadUid, i.row.original.Mobile].filter(Boolean).join(" · ")) },
    { accessorKey: "AssigneeName", header: "Assigned to", size: 110, cell: (i) => <span>{i.row.original.AssigneeName || "—"}</span> },
    { accessorKey: "DueDate", header: "Due", size: 130,
      cell: (i) => {
        const t = i.row.original;
        return <span className={`whitespace-nowrap ${isOverdue(t) ? "text-red-600 font-medium" : isToday(t) ? "text-amber-600 font-medium" : ""}`}>
          {fmtDue(t.DueDate)}{isOverdue(t) ? " · overdue" : ""}
        </span>;
      } },
    { accessorKey: "Priority", header: "Priority", size: 90, cell: (i) => StatusCell(i.row.original.Priority) },
    { accessorKey: "Status", header: "Status", size: 100, cell: (i) => StatusCell(i.row.original.Status) },
    { id: "actions", header: "", size: 100, enableSorting: false,
      cell: (i) => {
        const task = i.row.original;
        if (!canEdit) return null;
        return task.Status === "Done" ? (
          <button onClick={() => updateStatus(task, "Pending")} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
            <RotateCcw size={13} /> Reopen
          </button>
        ) : (
          <button onClick={() => updateStatus(task, "Done")} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 text-emerald-700 px-2 py-1 text-xs hover:bg-emerald-50">
            <CheckCircle2 size={13} /> Mark done
          </button>
        );
      } },
  ];
  const count = (k: TaskView) => tasks.filter(VIEWS.find((v) => v.key === k)!.test).length;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Tasks"]} title="Lead Tasks"
      subtitle={`${count("open")} open · ${count("overdue")} overdue · ${count("today")} due today`}
      action={<div className="flex items-center gap-2">
        {canDoAction("sa-lead-tasks", "create") && (
          <button onClick={() => setFormOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 rounded-md px-3 text-sm font-medium ${formOpen ? "border border-border text-muted-foreground hover:bg-muted" : "btn-module text-white shadow-sm"}`}>
            {formOpen ? <><X size={14} /> Close</> : <><Plus size={14} /> New task</>}
          </button>
        )}
        <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
      </div>}>
      <div className="space-y-5">
        {formOpen && canDoAction("sa-lead-tasks", "create") && (
          <form onSubmit={createTask} className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-border p-4 bg-card">
            <Label text="Lead" required>
              <SearchableNativeSelect value={form.LeadId} onChange={(e) => setForm({ ...form, LeadId: e.target.value })} className={inputCls}>
                <option value="">Select a lead</option>
                {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
              </SearchableNativeSelect>
            </Label>
            <Label text="Task" required className="md:col-span-2">
              <input value={form.Title} onChange={(e) => setForm({ ...form, Title: e.target.value })} placeholder="e.g. Send price sheet for 3BHK" className={inputCls} />
            </Label>
            <Label text="Assign to">
              <SearchableNativeSelect value={form.AssignedTo} onChange={(e) => setForm({ ...form, AssignedTo: e.target.value })} className={inputCls}>
                <option value="">Me</option>
                {users.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
              </SearchableNativeSelect>
            </Label>
            <Label text="Due">
              <DateTimeInput value={form.DueDate} onChange={(e) => setForm({ ...form, DueDate: e.target.value })} className={inputCls} />
            </Label>
            <Label text="Priority">
              <select value={form.Priority} onChange={(e) => setForm({ ...form, Priority: e.target.value })} className={`${inputCls} h-10`}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Label>
            <Label text="Notes" className="md:col-span-3">
              <textarea value={form.Description} onChange={(e) => setForm({ ...form, Description: e.target.value })} placeholder="Anything the assignee should know" className={`${inputCls} min-h-20`} />
            </Label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="h-9 px-3 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted">Cancel</button>
              <button className="inline-flex items-center gap-1.5 h-9 rounded-md btn-module text-white px-4 text-sm font-medium shadow-sm">
                <Plus size={14} /> Add task
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SaTabs
            tabs={VIEWS.map((v) => ({ key: v.key, label: `${v.label} (${count(v.key)})` }))}
            active={view}
            onChange={(key) => setView(key as TaskView)}
          />
          <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 bg-background w-full sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Task, lead, mobile or assignee" className="flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>

        <DataTable
          data={filtered}
          columns={columns}
          searchable={false}
          emptyMessage={query ? "No tasks match your search." : view === "overdue" ? "Nothing overdue." : view === "open" ? "No open tasks — all done." : "No tasks here."}
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadTasks;
