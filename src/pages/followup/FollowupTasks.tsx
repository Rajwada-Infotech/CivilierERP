import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TaskStatus = "open" | "in_progress" | "closed" | "reviewed";
type TaskPriority = "low" | "medium" | "high";

interface FollowupTask {
  id: string;
  title: string;
  description: string;
  module?: string | null;
  priority: TaskPriority | null;
  status: TaskStatus;
  assignedTo: string;
  assignedToName: string;
  createdBy: string;
  createdByName: string;
  dueDate: string;
}

interface TaskFormState {
  title: string;
  description: string;
  priority: TaskPriority;
  assignedTo: string;
  dueDate: string;
}

const EMPTY_FORM: TaskFormState = {
  title: "",
  description: "",
  priority: "medium",
  assignedTo: "",
  dueDate: "",
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  open: "bg-slate-500/10 text-slate-700 border-slate-300",
  in_progress: "bg-blue-500/10 text-blue-700 border-blue-300",
  closed: "bg-green-500/10 text-green-700 border-green-300",
  reviewed: "bg-purple-500/10 text-purple-700 border-purple-300",
};

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-300",
  medium: "bg-amber-500/10 text-amber-700 border-amber-300",
  high: "bg-red-500/10 text-red-700 border-red-300",
};

async function fetchFollowupTasks(): Promise<FollowupTask[]> {
  const response = await fetchWithAuth("/api/tasks?module=followup");
  if (!response.ok) {
    throw new Error("Failed to load follow-up tasks");
  }

  return response.json();
}

async function createFollowupTask(payload: {
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedTo: string;
  dueDate: string;
  module: "followup";
}) {
  const response = await fetchWithAuth("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create task");
  }
}

async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const response = await fetchWithAuth(`/api/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to update task");
  }
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}

function isOverdue(task: FollowupTask) {
  if (!task.dueDate || task.status === "closed" || task.status === "reviewed") {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export default function FollowupTasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser, allUsers } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);

  const canCreate =
    currentUser?.role === "admin" ||
    currentUser?.role === "super_admin" ||
    currentUser?.role === "dba";

  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ["followup-tasks"],
    queryFn: fetchFollowupTasks,
  });

  const createMutation = useMutation({
    mutationFn: createFollowupTask,
    onSuccess: () => {
      toast.success("Task created");
      queryClient.invalidateQueries({ queryKey: ["followup-tasks"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      updateTaskStatus(taskId, status),
    onSuccess: () => {
      toast.success("Task updated");
      queryClient.invalidateQueries({ queryKey: ["followup-tasks"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = [task.title, task.description, task.assignedToName]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || task.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openCount = tasks.filter((task) => task.status === "open").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const completedCount = tasks.filter(
    (task) => task.status === "closed" || task.status === "reviewed",
  ).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Follow-up Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            Live task list filtered by `module=followup`.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/followup")}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Button>
          {canCreate ? (
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New Task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            label: "Open",
            value: openCount,
            icon: AlertCircle,
            color: "bg-slate-500/10 text-slate-700",
          },
          {
            label: "In Progress",
            value: inProgressCount,
            icon: Clock,
            color: "bg-blue-500/10 text-blue-700",
          },
          {
            label: "Completed",
            value: completedCount,
            icon: CheckCircle,
            color: "bg-green-500/10 text-green-700",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-5 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Task List ({filteredTasks.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Only follow-up module tasks are shown here.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, description, or assignee"
              className="sm:w-72"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as "all" | TaskStatus)}
            >
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Loading tasks...
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-red-600">
                      Failed to load tasks.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && filteredTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No follow-up tasks found.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  filteredTasks.map((task) => (
                    <TableRow
                      key={task.id}
                      className={isOverdue(task) ? "bg-red-500/5" : undefined}
                    >
                      <TableCell className="align-top">
                        <div className="font-medium">{task.title}</div>
                        {task.description ? (
                          <div className="text-xs text-muted-foreground max-w-md mt-1">
                            {task.description}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={PRIORITY_STYLES[task.priority || "medium"]}
                        >
                          {task.priority || "medium"}
                        </Badge>
                      </TableCell>
                      <TableCell>{task.assignedToName || "-"}</TableCell>
                      <TableCell>
                        <span className={isOverdue(task) ? "text-red-600 font-medium" : ""}>
                          {formatDate(task.dueDate)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[task.status]}>{task.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Select
                          value={task.status}
                          onValueChange={(value) =>
                            updateStatusMutation.mutate({
                              taskId: task.id,
                              status: value as TaskStatus,
                            })
                          }
                        >
                          <SelectTrigger className="ml-auto h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                            <SelectItem value="reviewed">Reviewed</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Follow-up Task</DialogTitle>
            <DialogDescription>
              This creates a task with `module=followup`.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Task title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional details"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={form.priority}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      priority: value as TaskPriority,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Due Date</label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assign To</label>
              <Select
                value={form.assignedTo}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, assignedTo: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {allUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  title: form.title.trim(),
                  description: form.description.trim() || undefined,
                  priority: form.priority,
                  assignedTo: form.assignedTo,
                  dueDate: form.dueDate,
                  module: "followup",
                })
              }
              disabled={
                !form.title.trim() ||
                !form.assignedTo ||
                !form.dueDate ||
                createMutation.isPending
              }
            >
              {createMutation.isPending ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
