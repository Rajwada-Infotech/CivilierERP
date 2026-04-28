import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CheckCircle,
  Clock,
  Plus,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReminderStatus = "sent" | "overdue" | "scheduled";

interface ReminderRecord {
  id: number;
  tenantName: string;
  message?: string | null;
  module?: string | null;
  refId?: number | null;
  dueDate?: string | null;
  lastSentOn?: string | null;
  IsSent?: boolean;
  CreatedBy?: string | null;
  CreatedAt?: string | null;
  status: ReminderStatus;
  amountDue?: number | null;
}

interface ReminderFormState {
  title: string;
  message: string;
  module: string;
  dueDate: string;
  refId: string;
}

const EMPTY_FORM: ReminderFormState = {
  title: "",
  message: "",
  module: "followup",
  dueDate: "",
  refId: "",
};

const STATUS_STYLES: Record<ReminderStatus, string> = {
  overdue: "bg-red-500/10 text-red-600 border-red-500/30",
  scheduled: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  sent: "bg-green-500/10 text-green-600 border-green-500/30",
};

async function fetchReminders(): Promise<ReminderRecord[]> {
  const response = await fetchWithAuth("/api/tenant-reminders");
  if (!response.ok) {
    throw new Error("Failed to load reminders");
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

async function createReminder(payload: {
  title: string;
  message?: string;
  module?: string;
  refId?: number;
  dueDate?: string;
  createdBy?: string;
}) {
  const response = await fetchWithAuth("/api/tenant-reminders", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create reminder");
  }
}

async function sendReminder(id: number) {
  const response = await fetchWithAuth(`/api/tenant-reminders/send/${id}`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to send reminder");
  }
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}

export default function FollowupReminders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<ReminderFormState>(EMPTY_FORM);

  const { data: reminders = [], isLoading, isError } = useQuery({
    queryKey: ["followup-reminders"],
    queryFn: fetchReminders,
  });

  const createMutation = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      toast.success("Reminder created");
      queryClient.invalidateQueries({ queryKey: ["followup-reminders"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const sendMutation = useMutation({
    mutationFn: sendReminder,
    onSuccess: () => {
      toast.success("Reminder marked as sent");
      queryClient.invalidateQueries({ queryKey: ["followup-reminders"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const filteredReminders = reminders.filter((reminder) => {
    const haystack = [
      reminder.tenantName,
      reminder.message || "",
      reminder.module || "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(search.toLowerCase());
  });

  const overdueCount = reminders.filter((reminder) => reminder.status === "overdue").length;
  const scheduledCount = reminders.filter(
    (reminder) => reminder.status === "scheduled",
  ).length;
  const sentCount = reminders.filter((reminder) => reminder.status === "sent").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Reminders Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Track and send follow-up reminders from the live `TenantReminders` table.
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
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Reminder
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Total",
            value: reminders.length,
            icon: Bell,
            color: "bg-indigo-500/10 text-indigo-600",
          },
          {
            label: "Overdue",
            value: overdueCount,
            icon: AlertCircle,
            color: "bg-red-500/10 text-red-600",
          },
          {
            label: "Scheduled",
            value: scheduledCount,
            icon: Clock,
            color: "bg-amber-500/10 text-amber-600",
          },
          {
            label: "Sent",
            value: sentCount,
            icon: CheckCircle,
            color: "bg-green-500/10 text-green-600",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <div
                className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-3`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-bold">{value}</CardTitle>
              <p className="text-sm text-muted-foreground">{label}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>All Reminders ({filteredReminders.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Backend fields are mapped directly from `/api/tenant-reminders`.
            </p>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, message, or module"
            className="sm:max-w-xs"
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Last Sent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Loading reminders...
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-red-600">
                      Failed to load reminders.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && filteredReminders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No reminders found.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  filteredReminders.map((reminder) => (
                    <TableRow key={reminder.id} className="hover:bg-muted/50">
                      <TableCell className="align-top">
                        <div className="font-medium">{reminder.tenantName}</div>
                        {reminder.message ? (
                          <div className="text-xs text-muted-foreground max-w-md mt-1">
                            {reminder.message}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{reminder.module || "-"}</TableCell>
                      <TableCell>
                        {typeof reminder.amountDue === "number"
                          ? `Rs ${reminder.amountDue.toLocaleString()}`
                          : "-"}
                      </TableCell>
                      <TableCell>{formatDate(reminder.dueDate)}</TableCell>
                      <TableCell>{formatDate(reminder.lastSentOn)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_STYLES[reminder.status]}>
                          {reminder.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {reminder.status === "sent" ? (
                          <span className="text-xs text-muted-foreground">Sent</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={sendMutation.isPending}
                            onClick={() => sendMutation.mutate(reminder.id)}
                          >
                            <Send className="w-3.5 h-3.5" />
                            Send
                          </Button>
                        )}
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
            <DialogTitle>New Reminder</DialogTitle>
            <DialogDescription>
              This creates a live row in `TenantReminders`.
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
                placeholder="Reminder title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Message</label>
              <textarea
                value={form.message}
                onChange={(event) =>
                  setForm((current) => ({ ...current, message: event.target.value }))
                }
                placeholder="Optional message"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Module</label>
                <Input
                  value={form.module}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, module: event.target.value }))
                  }
                  placeholder="followup"
                />
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
              <label className="text-sm font-medium">Reference Id</label>
              <Input
                value={form.refId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, refId: event.target.value }))
                }
                placeholder="Optional numeric reference"
              />
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
                  message: form.message.trim() || undefined,
                  module: form.module.trim() || undefined,
                  dueDate: form.dueDate || undefined,
                  refId: form.refId ? Number(form.refId) : undefined,
                  createdBy: currentUser?.name,
                })
              }
              disabled={!form.title.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
