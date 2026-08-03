import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  BellRing,
  CalendarDays,
  CheckCircle,
  Clock,
  Plus,
  Send,
  Search,
  Inbox,
  CalendarClock,
  Zap,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
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
  const data = await response.json().catch(() => ({}));
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

// Module badge uses semantic colours that look fine in both themes
function getModuleColor(module?: string | null): string {
  const colors: Record<string, string> = {
    followup: "bg-violet-500/10 text-violet-500 border border-violet-500/20",
    sales: "bg-blue-500/10 text-blue-500 border border-blue-500/20",
    agreement:
      "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
    construction: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    closure: "bg-rose-500/10 text-rose-500 border border-rose-500/20",
  };
  const key = (module || "").toLowerCase();
  return colors[key] || "bg-muted text-muted-foreground border border-border";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  iconClass,
  accent,
  borderL,
  sublabel,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClass: string;
  accent: string;
  borderL: string;
  sublabel?: string;
}) {
  return (
    <div className={`relative bg-card rounded-2xl border border-border p-5 overflow-hidden hover:border-border/80 hover:shadow-md transition-all duration-200 border-l-2 ${borderL}`}>
      <div
        className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3 ${iconClass}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-3xl font-bold text-foreground tracking-tight">
        {value}
      </div>
      <div className="text-sm font-medium text-muted-foreground mt-0.5">
        {label}
      </div>
      {sublabel && (
        <div className="text-xs text-muted-foreground/60 mt-1">{sublabel}</div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ReminderStatus }) {
  const styles: Record<
    ReminderStatus,
    { cls: string; dot: string; label: string }
  > = {
    overdue: {
      cls: "bg-red-500/10 text-red-500 border border-red-500/20",
      dot: "bg-red-500",
      label: "Overdue",
    },
    scheduled: {
      cls: "bg-primary/10 text-primary border border-primary/20",
      dot: "bg-primary",
      label: "Scheduled",
    },
    sent: {
      cls: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
      dot: "bg-emerald-500",
      label: "Sent",
    },
  };
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.cls}`}
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
  if (days === null)
    return <span className="text-muted-foreground text-sm">—</span>;

  if (status === "sent") {
    return (
      <span className="text-muted-foreground text-sm">
        {formatDate(dueDate)}
      </span>
    );
  }
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-500">
        <Zap className="w-3.5 h-3.5" />
        {Math.abs(days)}d ago
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-500">
        <CalendarClock className="w-3.5 h-3.5" />
        Today
      </span>
    );
  }
  return (
    <span className="text-foreground text-sm tabular-nums">
      {formatDate(dueDate)}
      <span className="text-muted-foreground text-xs ml-1">({days}d)</span>
    </span>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
        <Inbox className="w-8 h-8 text-muted-foreground" />
      </div>
      <p className="text-foreground font-medium">
        {search ? "No reminders match your search" : "No reminders yet"}
      </p>
      <p className="text-muted-foreground text-sm mt-1">
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
    <div className="group grid grid-cols-[1fr_96px] gap-3 items-center px-5 py-4 border-b border-border hover:bg-muted/40 transition-colors duration-100 last:border-b-0">
      {/* Left: main info */}
      <div className="grid grid-cols-[minmax(200px,2fr)_100px_130px_130px_90px] gap-4 items-center min-w-0">
        {/* Title + message */}
        <div className="min-w-0">
          <div className="font-semibold text-foreground text-sm truncate leading-5">
            {reminder.tenantName}
          </div>
          {reminder.message && (
            <div className="text-xs text-muted-foreground truncate mt-0.5 leading-4 max-w-xs">
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
        <div className="text-sm text-foreground tabular-nums">
          {typeof reminder.amountDue === "number" ? (
            `₹ ${reminder.amountDue.toLocaleString("en-IN")}`
          ) : (
            <span className="text-muted-foreground">—</span>
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
          <div className="flex items-center gap-1.5 text-emerald-500 text-xs font-medium px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5" />
            Sent
          </div>
        ) : (
          <button
            onClick={() => onSend(reminder.id)}
            disabled={isSending}
            className="flex items-center gap-1.5 text-sm font-medium text-primary px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
    <>
      <Breadcrumbs items={["Follow-Up", "Reminders"]} />
      <FollowupShell
        title="Reminders"
        icon={Bell}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <Button
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} />
              New Reminder
            </Button>
          </div>
        }
      >

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total"
            value={counts.total}
            icon={Bell}
            accent="bg-primary"
            borderL="border-l-primary"
            iconClass="bg-primary/10 text-primary"
            sublabel="All reminders"
          />
          <StatCard
            label="Overdue"
            value={counts.overdue}
            icon={AlertCircle}
            accent="bg-red-500"
            borderL="border-l-red-500"
            iconClass="bg-red-500/10 text-red-500"
            sublabel="Needs attention"
          />
          <StatCard
            label="Scheduled"
            value={counts.scheduled}
            icon={Clock}
            accent="bg-amber-500"
            borderL="border-l-amber-500"
            iconClass="bg-amber-500/10 text-amber-500"
            sublabel="Upcoming"
          />
          <StatCard
            label="Sent"
            value={counts.sent}
            icon={CheckCircle}
            accent="bg-emerald-500"
            borderL="border-l-emerald-500"
            iconClass="bg-emerald-500/10 text-emerald-500"
            sublabel="Completed"
          />
        </div>

        {/* ── Table Card ── */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Filter tabs */}
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                      activeFilter === tab.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                        activeFilter === tab.key
                          ? "bg-primary/15 text-primary"
                          : "bg-muted-foreground/15 text-muted-foreground"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reminders…"
                  className="pl-9 pr-4 py-2 w-64 text-sm bg-muted/50 border border-border rounded-xl outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_96px] gap-3 px-5 py-3 border-b border-border bg-muted/30">
            <div className="grid grid-cols-[minmax(200px,2fr)_100px_130px_130px_90px] gap-4">
              {["Tenant / Title", "Module", "Amount", "Due Date", "Status"].map(
                (h) => (
                  <span
                    key={h}
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {h}
                  </span>
                ),
              )}
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Action
            </span>
          </div>

          {/* Loading skeletons */}
          {isLoading && (
            <div className="flex flex-col gap-3 p-5">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-muted animate-pulse"
                  style={{ opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 bg-destructive/10 rounded-2xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-foreground font-medium">
                Failed to load reminders
              </p>
              <button
                onClick={() => refetch()}
                className="text-sm text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && filteredReminders.length === 0 && (
            <EmptyState search={search} />
          )}

          {/* Rows */}
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

          {/* Footer count */}
          {!isLoading && !isError && filteredReminders.length > 0 && (
            <div className="px-5 py-3 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-semibold text-foreground">
                  {filteredReminders.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-foreground">
                  {reminders.length}
                </span>{" "}
                reminders
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}
        </div>
      </FollowupShell>

      {/* ── New Reminder Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <BellRing className="w-5 h-5 text-primary" />
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
              <label className="text-sm font-medium text-foreground">
                Title <span className="text-destructive">*</span>
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
              <label className="text-sm font-medium text-foreground">
                Message
              </label>
              <textarea
                value={form.message}
                onChange={(e) =>
                  setForm((f) => ({ ...f, message: e.target.value }))
                }
                placeholder="Optional message body…"
                rows={3}
                className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
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
                <label className="text-sm font-medium text-foreground">
                  Due Date
                </label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className="w-full pl-8 pr-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
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
              className="rounded-xl flex-1"
            >
              {createMutation.isPending ? "Creating…" : "Create Reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
