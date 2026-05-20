import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  CheckCircle,
  Clock,
  Plus,
  Send,
  Search,
  Filter,
  Inbox,
  CalendarClock,
  Zap,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM: ReminderFormState = {
  title: "",
  message: "",
  module: "followup",
  dueDate: "",
  refId: "",
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchReminders(): Promise<ReminderRecord[]> {
  const response = await fetchWithAuth("/api/tenant-reminders");
  if (!response.ok) throw new Error("Failed to load reminders");
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function getDaysUntilDue(dueDate?: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

function getModuleColor(module?: string | null): string {
  const colors: Record<string, string> = {
    followup: "bg-violet-100 text-violet-700",
    sales: "bg-blue-100 text-blue-700",
    agreement: "bg-emerald-100 text-emerald-700",
    construction: "bg-amber-100 text-amber-700",
    closure: "bg-rose-100 text-rose-700",
  };
  const key = (module || "").toLowerCase();
  return colors[key] || "bg-slate-100 text-slate-600";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  sublabel,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
  sublabel?: string;
}) {
  return (
    <div className="relative bg-white rounded-2xl border border-slate-100 p-5 overflow-hidden group hover:border-slate-200 hover:shadow-md transition-all duration-200">
      <div
        className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.06] -translate-y-6 translate-x-6 ${accent}`}
      />
      <div
        className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${accent} bg-opacity-10 mb-3`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-3xl font-bold text-slate-800 tracking-tight">
        {value}
      </div>
      <div className="text-sm font-medium text-slate-500 mt-0.5">{label}</div>
      {sublabel && (
        <div className="text-xs text-slate-400 mt-1">{sublabel}</div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ReminderStatus }) {
  const styles: Record<
    ReminderStatus,
    { bg: string; dot: string; label: string }
  > = {
    overdue: {
      bg: "bg-red-50 text-red-600 border border-red-200",
      dot: "bg-red-500",
      label: "Overdue",
    },
    scheduled: {
      bg: "bg-indigo-50 text-indigo-600 border border-indigo-200",
      dot: "bg-indigo-500",
      label: "Scheduled",
    },
    sent: {
      bg: "bg-emerald-50 text-emerald-600 border border-emerald-200",
      dot: "bg-emerald-500",
      label: "Sent",
    },
  };
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function DueDateChip({
  dueDate,
  status,
}: {
  dueDate?: string | null;
  status: ReminderStatus;
}) {
  const days = getDaysUntilDue(dueDate);
  if (days === null) return <span className="text-slate-400 text-sm">—</span>;

  if (status === "sent") {
    return (
      <span className="text-slate-500 text-sm">{formatDate(dueDate)}</span>
    );
  }

  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
        <Zap className="w-3.5 h-3.5" />
        {Math.abs(days)}d ago
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
        <CalendarClock className="w-3.5 h-3.5" />
        Today
      </span>
    );
  }
  return (
    <span className="text-slate-600 text-sm tabular-nums">
      {formatDate(dueDate)}
      <span className="text-slate-400 text-xs ml-1">({days}d)</span>
    </span>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
        <Inbox className="w-8 h-8 text-slate-400" />
      </div>
      <p className="text-slate-600 font-medium">
        {search ? "No reminders match your search" : "No reminders yet"}
      </p>
      <p className="text-slate-400 text-sm mt-1">
        {search
          ? "Try adjusting your search query"
          : "Create a reminder to get started"}
      </p>
    </div>
  );
}

function ReminderRow({
  reminder,
  onSend,
  isSending,
}: {
  reminder: ReminderRecord;
  onSend: (id: number) => void;
  isSending: boolean;
}) {
  const modColor = getModuleColor(reminder.module);

  return (
    <div className="group grid grid-cols-[1fr_auto] gap-3 items-center px-5 py-4 border-b border-slate-50 hover:bg-slate-50/70 transition-colors duration-100 last:border-b-0">
      {/* Left: main info */}
      <div className="grid grid-cols-[minmax(200px,2fr)_100px_130px_130px_90px] gap-4 items-center min-w-0">
        {/* Title + message */}
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 text-sm truncate leading-5">
            {reminder.tenantName}
          </div>
          {reminder.message && (
            <div className="text-xs text-slate-400 truncate mt-0.5 leading-4 max-w-xs">
              {reminder.message}
            </div>
          )}
        </div>

        {/* Module */}
        <div>
          <span
            className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${modColor}`}
          >
            {reminder.module || "—"}
          </span>
        </div>

        {/* Amount */}
        <div className="text-sm text-slate-700 tabular-nums">
          {typeof reminder.amountDue === "number" ? (
            `₹ ${reminder.amountDue.toLocaleString("en-IN")}`
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>

        {/* Due date */}
        <div>
          <DueDateChip dueDate={reminder.dueDate} status={reminder.status} />
        </div>

        {/* Status */}
        <div>
          <StatusPill status={reminder.status} />
        </div>
      </div>

      {/* Right: action */}
      <div className="flex items-center gap-2">
        {reminder.status === "sent" ? (
          <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium px-3 py-1.5 bg-emerald-50 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5" />
            Sent
          </div>
        ) : (
          <button
            onClick={() => onSend(reminder.id)}
            disabled={isSending}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 px-3 py-1.5 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FollowupReminders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | ReminderStatus>(
    "all",
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<ReminderFormState>(EMPTY_FORM);

  const {
    data: reminders = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["followup-reminders"],
    queryFn: fetchReminders,
  });

  const createMutation = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      toast.success("Reminder created successfully");
      queryClient.invalidateQueries({ queryKey: ["followup-reminders"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: sendReminder,
    onSuccess: () => {
      toast.success("Reminder sent");
      queryClient.invalidateQueries({ queryKey: ["followup-reminders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const counts = {
    total: reminders.length,
    overdue: reminders.filter((r) => r.status === "overdue").length,
    scheduled: reminders.filter((r) => r.status === "scheduled").length,
    sent: reminders.filter((r) => r.status === "sent").length,
  };

  const filteredReminders = reminders.filter((reminder) => {
    const matchesSearch = [
      reminder.tenantName,
      reminder.message || "",
      reminder.module || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesFilter =
      activeFilter === "all" || reminder.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const filterTabs: {
    key: "all" | ReminderStatus;
    label: string;
    count: number;
  }[] = [
    { key: "all", label: "All", count: counts.total },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "scheduled", label: "Scheduled", count: counts.scheduled },
    { key: "sent", label: "Sent", count: counts.sent },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8FC]">
      <div className="max-w-[1280px] mx-auto px-6 py-8 space-y-6">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-2 font-medium tracking-wide uppercase">
              <button
                onClick={() => navigate("/followup")}
                className="hover:text-indigo-600 transition-colors flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Follow-Up
              </button>
              <ChevronRight className="w-3 h-3" />
              <span className="text-slate-600">Reminders</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Reminders Management
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Track and dispatch follow-up reminders across all tenants and
              modules.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-all"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200 rounded-xl h-10 px-4"
            >
              <Plus className="w-4 h-4" />
              New Reminder
            </Button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total"
            value={counts.total}
            icon={Bell}
            accent="bg-indigo-500 text-indigo-600"
            sublabel="All reminders"
          />
          <StatCard
            label="Overdue"
            value={counts.overdue}
            icon={AlertCircle}
            accent="bg-red-500 text-red-600"
            sublabel="Needs attention"
          />
          <StatCard
            label="Scheduled"
            value={counts.scheduled}
            icon={Clock}
            accent="bg-amber-500 text-amber-600"
            sublabel="Upcoming"
          />
          <StatCard
            label="Sent"
            value={counts.sent}
            icon={CheckCircle}
            accent="bg-emerald-500 text-emerald-600"
            sublabel="Completed"
          />
        </div>

        {/* ── Table Card ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Table toolbar */}
          <div className="px-5 pt-5 pb-4 border-b border-slate-100">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                      activeFilter === tab.key
                        ? "bg-white text-slate-800 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                        activeFilter === tab.key
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reminders…"
                  className="pl-9 pr-4 py-2 w-64 text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-slate-400 text-slate-700"
                />
              </div>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto] gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="grid grid-cols-[minmax(200px,2fr)_100px_130px_130px_90px] gap-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Tenant / Title
              </span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Module
              </span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Amount
              </span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Due Date
              </span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Status
              </span>
            </div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Action
            </span>
          </div>

          {/* Rows */}
          {isLoading && (
            <div className="flex flex-col gap-3 p-5">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-slate-100 animate-pulse"
                  style={{ opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-slate-600 font-medium">
                Failed to load reminders
              </p>
              <button
                onClick={() => refetch()}
                className="text-sm text-indigo-600 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {!isLoading && !isError && filteredReminders.length === 0 && (
            <EmptyState search={search} />
          )}

          {!isLoading &&
            !isError &&
            filteredReminders.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                onSend={(id) => sendMutation.mutate(id)}
                isSending={sendMutation.isPending}
              />
            ))}

          {/* Footer */}
          {!isLoading && !isError && filteredReminders.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
              <p className="text-xs text-slate-400">
                Showing{" "}
                <span className="font-semibold text-slate-600">
                  {filteredReminders.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-600">
                  {reminders.length}
                </span>{" "}
                reminders
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── New Reminder Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <BellRing className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <DialogTitle className="text-lg">New Reminder</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Creates a record in the TenantReminders table.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Title <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Rent payment reminder"
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Message
              </label>
              <textarea
                value={form.message}
                onChange={(e) =>
                  setForm((f) => ({ ...f, message: e.target.value }))
                }
                placeholder="Optional message body…"
                rows={3}
                className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Module
                </label>
                <Input
                  value={form.module}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, module: e.target.value }))
                  }
                  placeholder="followup"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Due Date
                </label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Reference ID
              </label>
              <Input
                value={form.refId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, refId: e.target.value }))
                }
                placeholder="Optional numeric reference"
                className="rounded-xl"
              />
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="rounded-xl flex-1"
            >
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
              className="rounded-xl flex-1 bg-indigo-600 hover:bg-indigo-700"
            >
              {createMutation.isPending ? "Creating…" : "Create Reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
