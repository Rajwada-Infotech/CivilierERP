import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  Send,
  Undo2,
  X,
  Filter,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";

// ─── Types ────────────────────────────────────────────────────────────────────

type DemandStatus = "Pending" | "Demanded" | "Paid";

interface DemandRow {
  Id: number;
  BookingID: number;
  BookingNo: string;
  ApplicantId: number;
  ApplicantName: string;
  PrimaryMobile: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  UnitNo: string;
  BookingTotalValue: number | null;
  TermID: number;
  TermName: string;
  ComputedAmount: number;
  DocRef: string | null;
  DueDate: string | null;
  SortOrder: number;
  DemandStatus: DemandStatus;
  DemandNo: string | null;
  DemandRaisedOn: string | null;
  DemandNotes: string | null;
  IsPaid: boolean;
  PaidOn: string | null;
}

interface DemandSummary {
  PendingAmount: number;
  DemandedAmount: number;
  PaidAmount: number;
  PendingCount: number;
  DemandedCount: number;
  PaidCount: number;
}

interface ProjectOption {
  ProjectId: number;
  ProjectName: string;
}

interface RaiseForm {
  dueDate: string;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN");
}

function fmtMoney(v?: number | null) {
  if (v == null || v === 0) return "—";
  return `₹ ${Number(v).toLocaleString("en-IN")}`;
}

function isOverdue(date: string | null, status: DemandStatus) {
  return date && new Date(date) < new Date() && status !== "Paid";
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchDemands(params: {
  page: number;
  pageSize: number;
  search: string;
  projectId: string;
  status: string;
}) {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search ? { search: params.search } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-demands?${q}`);
  if (!res.ok) throw new Error("Failed to load demands");
  return res.json().catch(() => ({})) as Promise<{
    data: DemandRow[];
    pagination: { page: number; pageSize: number; total: number };
    summary: DemandSummary;
  }>;
}

async function fetchProjects() {
  const res = await fetchWithAuth("/api/followup-demands/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json().catch(() => ({})) as Promise<ProjectOption[]>;
}

async function raiseDemand(
  id: number,
  body: { dueDate?: string; notes?: string },
) {
  const res = await fetchWithAuth(`/api/followup-demands/${id}/raise`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to raise demand",
    );
  }
  return res.json().catch(() => ({}));
}

async function undoRaise(id: number) {
  const res = await fetchWithAuth(`/api/followup-demands/${id}/undo-raise`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to undo demand",
    );
  }
  return res.json().catch(() => ({}));
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: DemandStatus }) {
  if (status === "Pending")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  if (status === "Demanded")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
        <Send className="w-3 h-3" /> Demanded
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
      <CheckCircle2 className="w-3 h-3" /> Paid
    </span>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  count: number | undefined;
  amount: number | undefined;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  styles: { ring: string; bar: string; borderL: string; num: string; bg: string };
}

function SummaryCard({
  label,
  count,
  amount,
  icon,
  active,
  onClick,
  styles,
}: SummaryCardProps) {
  return (
    <button
      onClick={onClick}
      className={`relative text-left w-full rounded-xl border bg-card p-5 overflow-hidden transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 focus:outline-none border-l-2 ${styles.borderL} ${
        active
          ? `ring-2 ${styles.ring} shadow-md -translate-y-0.5`
          : "border-border"
      }`}
    >
      <div
        className={`absolute top-0 left-0 h-0.5 w-full rounded-t-xl ${active ? styles.bar : "bg-transparent"}`}
      />
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 -translate-y-6 translate-x-6 ${styles.bar}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {label}
          </p>
          <p className={`text-3xl font-bold tabular-nums ${styles.num}`}>
            {count ?? "—"}
          </p>
          <p className="text-sm text-muted-foreground mt-1 tabular-nums">
            {fmtMoney(amount)}
          </p>
        </div>
        <div className={`p-2 rounded-lg ${styles.bg}`}>{icon}</div>
      </div>
      {active && (
        <span className="absolute top-3 right-3 text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          FILTERED
        </span>
      )}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function FinanceDemandsPage() {
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");

  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseForm, setRaiseForm] = useState<RaiseForm>({
    dueDate: "",
    notes: "",
  });
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);

  const queryKey = ["followup-demands", page, search, projectId, status];

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchDemands({ page, pageSize: PAGE_SIZE, search, projectId, status }),
    placeholderData: (prev) => prev,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["followup-demand-projects"],
    queryFn: fetchProjects,
  });

  const raiseMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: { dueDate?: string; notes?: string };
    }) => raiseDemand(id, body),
    onSuccess: (result: { demandNo: string }) => {
      toast.success(`Demand raised — ${result.demandNo}`);
      queryClient.invalidateQueries({ queryKey: ["followup-demands"] });
      setRaiseRow(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const undoMutation = useMutation({
    mutationFn: (id: number) => undoRaise(id),
    onSuccess: () => {
      toast.success("Demand reverted to Pending");
      queryClient.invalidateQueries({ queryKey: ["followup-demands"] });
      setUndoRow(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = data?.data ?? [];
  const summary = data?.summary;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applySearch() {
    setSearch(searchInput.trim());
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setSearchInput("");
    setProjectId("");
    setStatus("");
    setPage(1);
  }

  const hasFilters = search || projectId || status;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Finance" },
          { label: "Demands" },
        ]}
      />
      <FollowupShell
        title="Payment Demands"
        icon={Send}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        }
      >

        {/* ── Summary cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            label="Pending"
            count={summary?.PendingCount}
            amount={summary?.PendingAmount}
            icon={
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            }
            active={status === "Pending"}
            onClick={() => {
              setStatus(status === "Pending" ? "" : "Pending");
              setPage(1);
            }}
            styles={{
              ring: "ring-amber-400/60",
              bar: "bg-amber-400",
              borderL: "border-l-amber-400",
              num: "text-amber-600 dark:text-amber-400",
              bg: "bg-amber-50 dark:bg-amber-950/30",
            }}
          />
          <SummaryCard
            label="Demanded"
            count={summary?.DemandedCount}
            amount={summary?.DemandedAmount}
            icon={<Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            active={status === "Demanded"}
            onClick={() => {
              setStatus(status === "Demanded" ? "" : "Demanded");
              setPage(1);
            }}
            styles={{
              ring: "ring-primary/40",
              bar: "bg-primary",
              borderL: "border-l-primary",
              num: "text-primary",
              bg: "bg-primary/10",
            }}
          />
          <SummaryCard
            label="Paid"
            count={summary?.PaidCount}
            amount={summary?.PaidAmount}
            icon={
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            }
            active={status === "Paid"}
            onClick={() => {
              setStatus(status === "Paid" ? "" : "Paid");
              setPage(1);
            }}
            styles={{
              ring: "ring-emerald-400/60",
              bar: "bg-emerald-500",
              borderL: "border-l-emerald-500",
              num: "text-emerald-600 dark:text-emerald-400",
              bg: "bg-emerald-50 dark:bg-emerald-950/30",
            }}
          />
        </div>

        {/* ── Filters + Table ──────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search applicant, booking, milestone…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Button
              onClick={applySearch}
              size="sm"
              variant="outline"
              className="h-8 px-3 text-sm"
            >
              Search
            </Button>

            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-40 text-sm">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.ProjectId} value={String(p.ProjectId)}>
                    {p.ProjectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-32 text-sm">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Demanded">Demanded</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </Button>
            )}

            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {total > 0 && `${total.toLocaleString("en-IN")} milestones`}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-4">
                    Booking
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Applicant
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Project / Unit
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Milestone
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">
                    Amount
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Due Date
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Demand No.
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Raised On
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center pr-4">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-16 text-center text-muted-foreground text-sm"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/50" />
                        Loading milestones…
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-16 text-center text-destructive text-sm"
                    >
                      Failed to load demands. Try refreshing.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Inbox className="w-8 h-8 text-muted-foreground/40" />
                        <p className="text-sm">No milestones found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  rows.map((row) => (
                    <TableRow
                      key={row.Id}
                      className="border-b last:border-0 transition-colors"
                    >
                      <TableCell className="py-3 pl-4">
                        <span className="font-mono text-xs font-semibold text-foreground tracking-wide">
                          {row.BookingNo}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        <p className="text-sm font-medium text-foreground leading-tight">
                          {row.ApplicantName}
                        </p>
                        {row.PrimaryMobile && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {row.PrimaryMobile}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <p className="text-sm text-foreground">
                          {row.ProjectName ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {row.UnitNo}
                        </p>
                      </TableCell>
                      <TableCell className="py-3">
                        <p className="text-sm font-medium text-foreground">
                          {row.TermName}
                        </p>
                        {row.DocRef && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {row.DocRef}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <span className="text-sm font-semibold text-foreground tabular-nums">
                          {fmtMoney(row.ComputedAmount)}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        {row.DueDate ? (
                          <span
                            className={`text-sm ${isOverdue(row.DueDate, row.DemandStatus) ? "text-destructive font-medium" : "text-foreground"}`}
                          >
                            {fmt(row.DueDate)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <StatusPill status={row.DemandStatus} />
                      </TableCell>
                      <TableCell className="py-3">
                        {row.DemandNo ? (
                          <span className="font-mono text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                            {row.DemandNo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-sm text-muted-foreground">
                        {fmt(row.DemandRaisedOn)}
                      </TableCell>
                      <TableCell className="py-3 text-center pr-4">
                        {row.DemandStatus === "Pending" && (
                          <Button
                            size="sm"
                            className="h-7 px-3 text-xs gap-1.5"
                            onClick={() => {
                              setRaiseRow(row);
                              setRaiseForm({
                                dueDate: row.DueDate?.slice(0, 10) ?? "",
                                notes: "",
                              });
                            }}
                          >
                            <Bell className="w-3 h-3" /> Raise
                          </Button>
                        )}
                        {row.DemandStatus === "Demanded" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-xs gap-1.5"
                            onClick={() => setUndoRow(row)}
                          >
                            <Undo2 className="w-3 h-3" /> Undo
                          </Button>
                        )}
                        {row.DemandStatus === "Paid" && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            {fmt(row.PaidOn)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <span className="text-sm text-muted-foreground">
                Page <span className="font-medium text-foreground">{page}</span>{" "}
                of{" "}
                <span className="font-medium text-foreground">
                  {totalPages}
                </span>
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </FollowupShell>

      {/* ── Raise Demand Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!raiseRow} onOpenChange={(o) => !o && setRaiseRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              Raise Demand
            </DialogTitle>
            <DialogDescription>
              This will mark the milestone as <strong>Demanded</strong> and
              generate a demand number.
            </DialogDescription>
          </DialogHeader>

          {raiseRow && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {[
                  { label: "Booking", value: raiseRow.BookingNo, mono: true },
                  { label: "Applicant", value: raiseRow.ApplicantName },
                  { label: "Milestone", value: raiseRow.TermName },
                ].map(({ label, value, mono }) => (
                  <div
                    key={label}
                    className="flex justify-between items-center px-3 py-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span
                      className={`text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="text-xs text-muted-foreground">Amount</span>
                  <span className="text-sm font-bold text-primary">
                    {fmtMoney(raiseRow.ComputedAmount)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Due Date</Label>
                <Input
                  type="date"
                  value={raiseForm.dueDate}
                  onChange={(e) =>
                    setRaiseForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to keep the existing due date.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">
                  Notes{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  value={raiseForm.notes}
                  onChange={(e) =>
                    setRaiseForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Any remarks for this demand…"
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRaiseRow(null)}>
              Cancel
            </Button>
            <Button
              disabled={raiseMutation.isPending}
              onClick={() => {
                if (!raiseRow) return;
                raiseMutation.mutate({
                  id: raiseRow.Id,
                  body: {
                    dueDate: raiseForm.dueDate || undefined,
                    notes: raiseForm.notes || undefined,
                  },
                });
              }}
              className="gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              {raiseMutation.isPending ? "Raising…" : "Raise Demand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Undo Confirm Dialog ───────────────────────────────────────────── */}
      <AlertDialog
        open={!!undoRow}
        onOpenChange={(o) => !o && setUndoRow(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Demand?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert <strong>{undoRow?.DemandNo}</strong> back to{" "}
              <strong>Pending</strong> and clear the demand number. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoMutation.isPending}
              onClick={() => undoRow && undoMutation.mutate(undoRow.Id)}
            >
              {undoMutation.isPending ? "Reverting…" : "Yes, Undo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default FinanceDemandsPage;
