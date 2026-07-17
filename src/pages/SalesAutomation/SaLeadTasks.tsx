import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Clock, Plus, Search } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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

const SaLeadTasks: React.FC = () => {
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ LeadId: "", Title: "", Description: "", AssignedTo: "", DueDate: "", Priority: "Normal" });
  const { data: tasks = [], isLoading, error } = useQuery({ queryKey: ["sa-lead-tasks"], queryFn: fetchTasks, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users-options"], queryFn: fetchUsers, staleTime: 60_000 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => [t.Title, t.CustomerName, t.LeadUid, t.Mobile, t.AssigneeName, t.Priority, t.Status]
      .some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [tasks, query]);

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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading lead tasks...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load lead tasks.</div>;

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "Title", header: "Task", size: 200,
      cell: (i) => (<><div className="font-medium">{i.row.original.Title}</div><div className="text-xs text-muted-foreground">{i.row.original.Description || ""}</div></>) },
    { accessorKey: "LeadUid", header: "Lead", size: 130,
      cell: (i) => (<><div className="font-mono text-xs text-muted-foreground">{i.row.original.LeadUid}</div><div>{i.row.original.CustomerName}</div></>) },
    { accessorKey: "AssigneeName", header: "Assignee", size: 110, cell: (i) => <span>{i.row.original.AssigneeName || "-"}</span> },
    { accessorKey: "DueDate", header: "Due", size: 130,
      cell: (i) => <span className="whitespace-nowrap">{i.row.original.DueDate ? new Date(i.row.original.DueDate).toLocaleString() : "-"}</span> },
    { accessorKey: "Priority", header: "Priority", size: 90, cell: (i) => <span>{i.row.original.Priority}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className="inline-flex items-center gap-1.5"><Clock size={13} />{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 100, enableSorting: false,
      cell: (i) => {
        const task = i.row.original;
        return canDoAction("sa-lead-tasks", "edit") && task.Status !== "Done" ? (
          <button onClick={() => updateStatus(task, "Done")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
            <CheckCircle2 size={13} /> Done
          </button>
        ) : null;
      } },
  ];

  return (
    <SalesAutoShell title="Lead Tasks" subtitle="Schedule follow-ups, reminders and sales actions for active leads">
      <div className="space-y-5">
        {canDoAction("sa-lead-tasks", "create") && (
          <form onSubmit={createTask} className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-lg border border-border p-4 bg-background">
            <select value={form.LeadId} onChange={(e) => setForm({ ...form, LeadId: e.target.value })} className="md:col-span-2 border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Select lead</option>
              {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
            </select>
            <input value={form.Title} onChange={(e) => setForm({ ...form, Title: e.target.value })} placeholder="Task title" className="md:col-span-2 border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <select value={form.AssignedTo} onChange={(e) => setForm({ ...form, AssignedTo: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Assign to me</option>
              {users.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
            </select>
            <input type="datetime-local" value={form.DueDate} onChange={(e) => setForm({ ...form, DueDate: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <select value={form.Priority} onChange={(e) => setForm({ ...form, Priority: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              {["Low", "Normal", "High", "Urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <textarea value={form.Description} onChange={(e) => setForm({ ...form, Description: e.target.value })} placeholder="Task notes" className="md:col-span-4 min-h-20 border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <button className="md:col-span-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
              <Plus size={15} /> Add
            </button>
          </form>
        )}

        <div className="flex items-center gap-2 max-w-md">
          <Search size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" className="w-full border border-border rounded-md bg-background px-3 py-2 text-sm" />
        </div>

        <DataTable
          data={filtered}
          columns={columns}
          searchable={false}
          emptyMessage="No tasks yet"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadTasks;
