import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  IndianRupee,
  RefreshCw,
  Search,
  Send,
  Undo2,
  X,
  FileText,
  CalendarDays,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const STATUS_CONFIG: Record<
  DemandStatus,
  {
    label: string;
    variant: "outline" | "secondary" | "default";
    icon: React.ReactNode;
  }
> = {
  Pending: {
    label: "Pending",
    variant: "outline",
    icon: <Clock className="w-3 h-3" />,
  },
  Demanded: {
    label: "Demanded",
    variant: "secondary",
    icon: <Send className="w-3 h-3" />,
  },
  Paid: {
    label: "Paid",
    variant: "default",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
};

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
  return res.json() as Promise<{
    data: DemandRow[];
    pagination: { page: number; pageSize: number; total: number };
    summary: DemandSummary;
  }>;
}

async function fetchProjects() {
  const res = await fetchWithAuth("/api/followup-demands/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json() as Promise<ProjectOption[]>;
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
  return res.json();
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
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function FinanceDemandsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filters
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");

  // Raise demand dialog
  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseForm, setRaiseForm] = useState<RaiseForm>({
    dueDate: "",
    notes: "",
  });

  // Undo dialog
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const queryKey = ["followup-demands", page, search, projectId, status];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      fetchDemands({ page, pageSize: PAGE_SIZE, search, projectId, status }),
    placeholderData: (prev) => prev,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["followup-demand-projects"],
    queryFn: fetchProjects,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

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

  // ── Derived ──────────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Breadcrumbs
            items={[
              { label: "Follow-Up", href: "/followup" },
              { label: "Finance" },
              { label: "Demands" },
            ]}
          />
          <h1 className="text-3xl font-heading font-bold text-foreground mt-1">
            Payment Demands
          </h1>
          <p className="text-muted-foreground mt-1">
            Raise and track milestone payment demand letters for all bookings.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/followup")}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Button>
          <Button variant="outline" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={`cursor-pointer transition-colors ${status === "Pending" ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : ""}`}
          onClick={() => {
            setStatus(status === "Pending" ? "" : "Pending");
            setPage(1);
          }}
        >
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {summary?.PendingCount ?? "—"}
              </div>
              <div className="text-sm text-muted-foreground">Pending</div>
              <div className="text-xs font-medium text-amber-600">
                {fmtMoney(summary?.PendingAmount)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${status === "Demanded" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : ""}`}
          onClick={() => {
            setStatus(status === "Demanded" ? "" : "Demanded");
            setPage(1);
          }}
        >
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Send className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {summary?.DemandedCount ?? "—"}
              </div>
              <div className="text-sm text-muted-foreground">Demanded</div>
              <div className="text-xs font-medium text-blue-600">
                {fmtMoney(summary?.DemandedAmount)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${status === "Paid" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20" : ""}`}
          onClick={() => {
            setStatus(status === "Paid" ? "" : "Paid");
            setPage(1);
          }}
        >
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {summary?.PaidCount ?? "—"}
              </div>
              <div className="text-sm text-muted-foreground">Paid</div>
              <div className="text-xs font-medium text-emerald-600">
                {fmtMoney(summary?.PaidAmount)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Search applicant, booking, milestone…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="flex-1"
              />
              <Button onClick={applySearch} variant="outline" size="icon">
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
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
              <SelectTrigger className="w-36">
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
                onClick={clearFilters}
                className="gap-1 text-muted-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Milestones
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total.toLocaleString("en-IN")} total)
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Project / Unit</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Demand No.</TableHead>
                  <TableHead>Raised On</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-12 text-center text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-12 text-center text-destructive"
                    >
                      Failed to load demands.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-12 text-center text-muted-foreground"
                    >
                      No milestones found.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  rows.map((row) => {
                    const cfg = STATUS_CONFIG[row.DemandStatus];
                    return (
                      <TableRow key={row.Id}>
                        <TableCell className="font-mono text-sm font-medium">
                          {row.BookingNo}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.ApplicantName}</div>
                          {row.PrimaryMobile && (
                            <div className="text-xs text-muted-foreground">
                              {row.PrimaryMobile}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>{row.ProjectName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.UnitNo}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.TermName}</div>
                          {row.DocRef && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {row.DocRef}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtMoney(row.ComputedAmount)}
                        </TableCell>
                        <TableCell>
                          {row.DueDate ? (
                            <span
                              className={
                                new Date(row.DueDate) < new Date() &&
                                row.DemandStatus !== "Paid"
                                  ? "text-destructive font-medium"
                                  : ""
                              }
                            >
                              {fmt(row.DueDate)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant} className="gap-1">
                            {cfg.icon}
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {row.DemandNo ?? "—"}
                        </TableCell>
                        <TableCell>{fmt(row.DemandRaisedOn)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1">
                            {row.DemandStatus === "Pending" && (
                              <Button
                                size="sm"
                                className="gap-1 h-7 px-2 text-xs"
                                onClick={() => {
                                  setRaiseRow(row);
                                  setRaiseForm({
                                    dueDate: row.DueDate?.slice(0, 10) ?? "",
                                    notes: "",
                                  });
                                }}
                              >
                                <Bell className="w-3 h-3" />
                                Raise
                              </Button>
                            )}
                            {row.DemandStatus === "Demanded" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-7 px-2 text-xs"
                                onClick={() => setUndoRow(row)}
                              >
                                <Undo2 className="w-3 h-3" />
                                Undo
                              </Button>
                            )}
                            {row.DemandStatus === "Paid" && (
                              <span className="text-xs text-muted-foreground">
                                {fmt(row.PaidOn)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Raise Demand Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!raiseRow} onOpenChange={(o) => !o && setRaiseRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise Demand</DialogTitle>
            <DialogDescription>
              This will mark the milestone as <strong>Demanded</strong> and
              generate a demand number.
            </DialogDescription>
          </DialogHeader>

          {raiseRow && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booking</span>
                  <span className="font-mono font-medium">
                    {raiseRow.BookingNo}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Applicant</span>
                  <span className="font-medium">{raiseRow.ApplicantName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Milestone</span>
                  <span className="font-medium">{raiseRow.TermName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold text-primary">
                    {fmtMoney(raiseRow.ComputedAmount)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
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

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  value={raiseForm.notes}
                  onChange={(e) =>
                    setRaiseForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Any remarks for this demand…"
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
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
              <Send className="w-4 h-4" />
              {raiseMutation.isPending ? "Raising…" : "Raise Demand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Undo Confirm Dialog ─────────────────────────────────────────── */}
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
    </div>
  );
}

export default FinanceDemandsPage;
