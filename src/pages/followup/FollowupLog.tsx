import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/button";
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

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtAmount = (v: number | null) =>
  typeof v === "number" ? `Rs ${v.toLocaleString()}` : "—";

// ─── Type badge ───────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<LogType, string> = {
  email: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  call: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  sms: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  note: "bg-slate-500/10 text-slate-600 border-slate-400/20",
  payment: "bg-purple-500/10 text-purple-600 border-purple-400/20",
};

const TYPE_ICONS: Record<LogType, React.ElementType> = {
  email: Mail,
  call: Phone,
  sms: Clock,
  note: FileText,
  payment: CheckCircle2,
};

function TypeBadge({ type }: { type: LogType }) {
  const cls =
    TYPE_COLORS[type] ?? "bg-muted text-muted-foreground border-border";
  const Icon = TYPE_ICONS[type] ?? FileText;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${cls}`}
    >
      <Icon size={10} />
      {type}
    </span>
  );
}

// ─── API fns ──────────────────────────────────────────────────────────────────
async function fetchFollowupLog(
  search: string,
  type: string,
): Promise<FollowupLogRecord[]> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (type !== "all") params.set("type", type);
  const res = await fetchWithAuth(
    `/api/followup-log${params.toString() ? `?${params.toString()}` : ""}`,
  );
  if (!res.ok) throw new Error("Failed to load follow-up log");
  return res.json().catch(() => ({}));
}

async function createFollowupLog(payload: {
  date?: string;
  type: LogType;
  customer: string;
  amount?: number;
  refId?: number;
  notes?: string;
}) {
  const res = await fetchWithAuth("/api/followup-log", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create log entry");
  }
}

async function deleteFollowupLog(id: string) {
  const res = await fetchWithAuth(`/api/followup-log/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete log entry");
  }
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-indigo-600",
  iconBg = "bg-indigo-500/10",
  accent = "bg-indigo-500",
  borderL = "border-l-indigo-500",
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  accent?: string;
  borderL?: string;
}) {
  return (
    <div className={`relative rounded-xl border border-border bg-card p-5 flex flex-col gap-3 overflow-hidden border-l-2 ${borderL}`}>
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 -translate-y-6 translate-x-6 ${accent}`} />
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
      </div>
      <div>
        <p className="text-2xl font-heading font-bold text-foreground leading-none">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({
  icon: Icon,
  title,
  sub,
  action,
  onAction,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-indigo-600" />
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            {title}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          {action} <ArrowUpRight size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Type Breakdown ───────────────────────────────────────────────────────────
function TypeBreakdown({ logs }: { logs: FollowupLogRecord[] }) {
  const entries = (
    ["email", "call", "sms", "note", "payment"] as LogType[]
  ).map((t) => ({
    type: t,
    count: logs.filter((l) => l.type === t).length,
    color: {
      email: "bg-blue-500",
      call: "bg-emerald-500",
      sms: "bg-amber-500",
      note: "bg-slate-400",
      payment: "bg-purple-500",
    }[t],
  }));

  const total = logs.length || 1;

  return (
    <div className="space-y-2 mt-2">
      {entries.map(({ type, count, color }) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={type}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span className="capitalize">{type}</span>
              <span className="font-medium text-foreground">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Column defs ──────────────────────────────────────────────────────────────
function makeColumns(
  deleteMutation: ReturnType<typeof useMutation<void, Error, string>>,
): ColumnDef<FollowupLogRecord>[] {
  return [
    {
      id: "date",
      accessorKey: "date",
      header: "Date",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {fmtDate(getValue() as string)}
        </span>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      header: "Type",
      cell: ({ getValue }) => <TypeBadge type={getValue() as LogType} />,
    },
    {
      id: "customer",
      accessorKey: "customer",
      header: "Customer",
      cell: ({ getValue }) => (
        <span className="text-xs font-medium text-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "amount",
      accessorKey: "amount",
      header: "Amount",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {fmtAmount(getValue() as number | null)}
        </span>
      ),
    },
    {
      id: "user",
      accessorKey: "user",
      header: "By",
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <User size={11} />
          {(getValue() as string) || "—"}
        </div>
      ),
    },
    {
      id: "notes",
      accessorKey: "notes",
      header: "Notes",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground line-clamp-2 max-w-xs block">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={() => deleteMutation.mutate(row.original.id)}
          disabled={deleteMutation.isPending}
          className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FollowupLog() {
  const queryClient = useQueryClient();
  const [, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LogType>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<FollowupLogFormState>(EMPTY_FORM);

  const {
    data: logs = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["followup-log", search, typeFilter],
    queryFn: () => fetchFollowupLog(search, typeFilter),
    staleTime: 2 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: createFollowupLog,
    onSuccess: () => {
      toast.success("Log entry created");
      queryClient.invalidateQueries({ queryKey: ["followup-log"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFollowupLog,
    onSuccess: () => {
      toast.success("Log entry deleted");
      queryClient.invalidateQueries({ queryKey: ["followup-log"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = makeColumns(deleteMutation);

  const communicationCount = logs.filter((e) =>
    ["email", "call", "sms"].includes(e.type),
  ).length;
  const paymentCount = logs.filter((e) => e.type === "payment").length;
  const noteCount = logs.filter((e) => e.type === "note").length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Log", path: "/followup/follow-ups/log" },
        ]}
      />
      <FollowupShell
        title="Follow-Up Log"
        icon={FileText}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} />
              New Entry
            </Button>
          </div>
        }
      >

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Activities"
            value={fmtNum(logs.length)}
            sub="All log entries"
            icon={Activity}
            iconColor="text-indigo-600"
            iconBg="bg-indigo-500/10"
            accent="bg-indigo-500"
            borderL="border-l-indigo-500"
          />
          <StatCard
            label="Communications"
            value={fmtNum(communicationCount)}
            sub="Email, call & SMS"
            icon={Mail}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/10"
            accent="bg-blue-500"
            borderL="border-l-blue-500"
          />
          <StatCard
            label="Payments Logged"
            value={fmtNum(paymentCount)}
            sub="Payment records"
            icon={CheckCircle2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
            accent="bg-emerald-500"
            borderL="border-l-emerald-500"
          />
          <StatCard
            label="Notes"
            value={fmtNum(noteCount)}
            sub="Internal notes"
            icon={FileText}
            iconColor="text-purple-600"
            iconBg="bg-purple-500/10"
            accent="bg-purple-500"
            borderL="border-l-purple-500"
          />
        </div>

        {/* Main content: table + breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Log Table — 2/3 width */}
          <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <SectionHeader
                icon={FileText}
                title="Activity Stream"
                sub={`${logs.length} entries`}
              />
              <Select
                value={typeFilter}
                onValueChange={(v) => setTypeFilter(v as "all" | LogType)}
              >
                <SelectTrigger className="h-7 w-32 text-[10px]">
                  <SelectValue placeholder="All Types" />
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
            <DataTable
              data={logs}
              columns={columns}
              searchable
              searchPlaceholder="Search customer or notes…"
              paginated
              defaultPageSize={10}
              loading={isLoading}
              emptyMessage="No follow-up activity logged yet."
            />
          </div>

          {/* Breakdown — 1/3 width */}
          <div className="rounded-xl border border-border bg-card p-5 self-start">
            <SectionHeader
              icon={Activity}
              title="Activity by Type"
              sub="Log entry breakdown"
            />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <TypeBreakdown logs={logs} />
            )}
          </div>
        </div>
      </FollowupShell>

      {/* New Entry Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Follow-Up Log Entry</DialogTitle>
            <DialogDescription>
              Create a communication or payment audit record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Date</label>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, date: e.target.value }))
                    }
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm((c) => ({ ...c, type: v as LogType }))
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
                onChange={(e) =>
                  setForm((c) => ({ ...c, customer: e.target.value }))
                }
                placeholder="Customer name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Amount</label>
                <Input
                  value={form.amount}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, amount: e.target.value }))
                  }
                  placeholder="Optional amount"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reference ID</label>
                <Input
                  value={form.refId}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, refId: e.target.value }))
                  }
                  placeholder="Optional ref"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((c) => ({ ...c, notes: e.target.value }))
                }
                placeholder="Activity notes"
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMutation.isPending ? "Creating…" : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}