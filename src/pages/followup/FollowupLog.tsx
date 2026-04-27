import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  FileText,
  Mail,
  Phone,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";

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

type LogType = "email" | "call" | "sms" | "note" | "payment";

interface FollowupLogRecord {
  id: string;
  date: string;
  type: LogType;
  customer: string;
  amount: number | null;
  refId: number | null;
  notes: string;
  user: string;
  createdAt: string;
}

interface FollowupLogFormState {
  date: string;
  type: LogType;
  customer: string;
  amount: string;
  refId: string;
  notes: string;
}

const EMPTY_FORM: FollowupLogFormState = {
  date: "",
  type: "note",
  customer: "",
  amount: "",
  refId: "",
  notes: "",
};

function getTypeIcon(type: LogType) {
  switch (type) {
    case "email":
      return Mail;
    case "call":
      return Phone;
    case "sms":
      return Clock;
    case "payment":
      return CheckCircle;
    default:
      return FileText;
  }
}

async function fetchFollowupLog(
  search: string,
  type: string,
): Promise<FollowupLogRecord[]> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (type !== "all") params.set("type", type);

  const response = await fetchWithAuth(
    `/api/followup-log${params.toString() ? `?${params.toString()}` : ""}`,
  );

  if (!response.ok) {
    throw new Error("Failed to load follow-up log");
  }

  return response.json();
}

async function createFollowupLog(payload: {
  date?: string;
  type: LogType;
  customer: string;
  amount?: number;
  refId?: number;
  notes?: string;
}) {
  const response = await fetchWithAuth("/api/followup-log", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create log entry");
  }
}

async function deleteFollowupLog(id: string) {
  const response = await fetchWithAuth(`/api/followup-log/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to delete log entry");
  }
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}

function formatAmount(value: number | null) {
  return typeof value === "number" ? `Rs ${value.toLocaleString()}` : "-";
}

export default function FollowupLog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LogType>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<FollowupLogFormState>(EMPTY_FORM);

  const { data: logs = [], isLoading, isError } = useQuery({
    queryKey: ["followup-log", search, typeFilter],
    queryFn: () => fetchFollowupLog(search, typeFilter),
  });

  const createMutation = useMutation({
    mutationFn: createFollowupLog,
    onSuccess: () => {
      toast.success("Log entry created");
      queryClient.invalidateQueries({ queryKey: ["followup-log"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFollowupLog,
    onSuccess: () => {
      toast.success("Log entry deleted");
      queryClient.invalidateQueries({ queryKey: ["followup-log"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const paymentCount = logs.filter((entry) => entry.type === "payment").length;
  const communicationCount = logs.filter((entry) =>
    ["email", "call", "sms"].includes(entry.type),
  ).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Follow-up Log
          </h1>
          <p className="text-muted-foreground mt-1">
            Communication audit trail backed by the new `FollowupLog` table.
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
            New Entry
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            label: "Total Activities",
            value: logs.length,
            icon: FileText,
            color: "text-primary",
          },
          {
            label: "Communications",
            value: communicationCount,
            icon: Mail,
            color: "text-blue-600",
          },
          {
            label: "Payments Logged",
            value: paymentCount,
            icon: CheckCircle,
            color: "text-green-600",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Icon className={`w-6 h-6 ${color}`} />
                <div>
                  <CardTitle className="text-2xl font-bold">{value}</CardTitle>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Activity Stream ({logs.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Search by customer or notes, and filter by log type.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer or notes"
              className="sm:w-72"
            />
            <Select
              value={typeFilter}
              onValueChange={(value) => setTypeFilter(value as "all" | LogType)}
            >
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="Filter type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Loading log entries...
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-red-600">
                      Failed to load log entries.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No follow-up activity logged yet.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  logs.map((entry) => {
                    const TypeIcon = getTypeIcon(entry.type);

                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-sm">
                          {formatDate(entry.date)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1 capitalize">
                            <TypeIcon className="w-3.5 h-3.5" />
                            {entry.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{entry.customer}</TableCell>
                        <TableCell>{formatAmount(entry.amount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <User className="w-3.5 h-3.5" />
                            {entry.user || "-"}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <span className="text-sm line-clamp-2">{entry.notes || "-"}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(entry.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Follow-up Log Entry</DialogTitle>
            <DialogDescription>
              Create a communication or payment audit record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Date</label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, date: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, type: value as LogType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Customer</label>
              <Input
                value={form.customer}
                onChange={(event) =>
                  setForm((current) => ({ ...current, customer: event.target.value }))
                }
                placeholder="Customer name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount</label>
                <Input
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  placeholder="Optional amount"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reference Id</label>
                <Input
                  value={form.refId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, refId: event.target.value }))
                  }
                  placeholder="Optional reminder ref"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Activity notes"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  date: form.date || undefined,
                  type: form.type,
                  customer: form.customer.trim(),
                  amount: form.amount ? Number(form.amount) : undefined,
                  refId: form.refId ? Number(form.refId) : undefined,
                  notes: form.notes.trim() || undefined,
                })
              }
              disabled={!form.customer.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
