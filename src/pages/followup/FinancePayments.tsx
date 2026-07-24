import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  History,
  IndianRupee,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  Trash2,
  X,
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

type DemandStatus = "Demanded" | "Paid";
type PaymentMode = "Cash" | "Cheque" | "NEFT" | "RTGS" | "UPI" | "DD";

interface PaymentRow {
  TermId: number;
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
  LastReceiptNo: string | null;
  LastReceiptAmount: number | null;
  LastPaymentDate: string | null;
  LastPaymentMode: string | null;
  TotalReceived: number | null;
  ReceiptCount: number;
  IsPaid: boolean;
  PaidOn: string | null;
}

interface PaymentSummary {
  OutstandingAmount: number;
  CollectedAmount: number;
  OverdueAmount: number;
  OutstandingCount: number;
  CollectedCount: number;
  OverdueCount: number;
}

interface ProjectOption {
  ProjectId: number;
  ProjectName: string;
}

interface Receipt {
  Id: number;
  ReceiptNo: string;
  AmountReceived: number;
  PaymentMode: string;
  PaymentDate: string;
  ReferenceNo: string | null;
  BankName: string | null;
  Notes: string | null;
  RecordedBy: string | null;
  CreatedAt: string;
}

interface RecordForm {
  amount: string;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNo: string;
  bankName: string;
  notes: string;
}

const PAYMENT_MODES: PaymentMode[] = [
  "Cash",
  "Cheque",
  "NEFT",
  "RTGS",
  "UPI",
  "DD",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN");
}

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹\u00A0${Number(v).toLocaleString("en-IN")}`;
}

function isOverdue(dueDate: string | null, status: DemandStatus) {
  if (!dueDate || status === "Paid") return false;
  return new Date(dueDate) < new Date();
}

function collectionPct(received: number | null, total: number): number {
  if (!received || !total) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchPayments(p: {
  page: number;
  pageSize: number;
  search: string;
  companyId: string;
  projectId: string;
  status: string;
}) {
  const q = new URLSearchParams({
    page: String(p.page),
    pageSize: String(p.pageSize),
    ...(p.search ? { search: p.search } : {}),
    ...(p.companyId ? { companyId: p.companyId } : {}),
    ...(p.projectId ? { projectId: p.projectId } : {}),
    ...(p.status ? { status: p.status } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-payments?${q}`);
  if (!res.ok) throw new Error("Failed to load payments");
  return res.json().catch(() => ({})) as Promise<{
    data: PaymentRow[];
    pagination: { page: number; pageSize: number; total: number };
    summary: PaymentSummary;
  }>;
}

async function fetchProjects() {
  const res = await fetchWithAuth("/api/followup-payments/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json().catch(() => ({})) as Promise<ProjectOption[]>;
}

async function fetchReceipts(termId: number) {
  const res = await fetchWithAuth(`/api/followup-payments/receipts/${termId}`);
  if (!res.ok) throw new Error("Failed to load receipts");
  return res.json().catch(() => ({})) as Promise<Receipt[]>;
}

async function recordPayment(termId: number, body: RecordForm) {
  const res = await fetchWithAuth(`/api/followup-payments/${termId}/record`, {
    method: "POST",
    body: JSON.stringify({
      amount: parseFloat(body.amount),
      paymentMode: body.paymentMode,
      paymentDate: body.paymentDate,
      referenceNo: body.referenceNo || undefined,
      bankName: body.bankName || undefined,
      notes: body.notes || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to record payment",
    );
  }
  return res.json().catch(() => ({})) as Promise<{
    success: boolean;
    receiptNo: string;
    markedPaid: boolean;
  }>;
}

async function deleteReceipt(receiptId: number) {
  const res = await fetchWithAuth(
    `/api/followup-payments/receipts/${receiptId}`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to delete receipt",
    );
  }
  return res.json().catch(() => ({}));
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ row }: { row: PaymentRow }) {
  const overdue = isOverdue(row.DueDate, row.DemandStatus);
  if (row.DemandStatus === "Paid")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
        <CheckCircle2 className="w-3 h-3" /> Paid
      </span>
    );
  if (overdue)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800">
        <AlertTriangle className="w-3 h-3" /> Overdue
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
      <Clock className="w-3 h-3" /> Demanded
    </span>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function CollectionBar({
  received,
  total,
  status,
}: {
  received: number | null;
  total: number;
  status: DemandStatus;
}) {
  const pct = collectionPct(received, total);
  const color =
    status === "Paid"
      ? "bg-emerald-500"
      : pct > 0
        ? "bg-blue-500"
        : "bg-muted-foreground/20";
  return (
    <div className="flex flex-col gap-1 min-w-[90px]">
      <div className="flex justify-between text-xs tabular-nums">
        <span className="text-muted-foreground">{fmtMoney(received)}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  amount,
  active,
  color,
  icon,
  onClick,
}: {
  label: string;
  count: number | undefined;
  amount: number | undefined;
  active: boolean;
  color: "red" | "blue" | "emerald";
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const styles = {
    red: {
      ring: "ring-red-400",
      bar: "bg-red-400",
      borderL: "border-l-red-400",
      num: "text-red-600 dark:text-red-400",
      bg: "bg-red-100 dark:bg-red-900/30",
    },
    blue: {
      ring: "ring-blue-400",
      bar: "bg-blue-400",
      borderL: "border-l-blue-400",
      num: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    emerald: {
      ring: "ring-emerald-400",
      bar: "bg-emerald-400",
      borderL: "border-l-emerald-400",
      num: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-100 dark:bg-emerald-900/30",
    },
  }[color];

  return (
    <button
      onClick={onClick}
      className={`relative text-left w-full rounded-xl border bg-card p-5 overflow-hidden transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 border-l-2 ${styles.borderL} ${active ? `ring-2 ${styles.ring} shadow-md -translate-y-0.5` : ""}`}
    >
      <div
        className={`absolute top-0 left-0 h-0.5 w-full rounded-t-xl ${active ? styles.bar : "bg-transparent"}`}
      />
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 -translate-y-6 translate-x-6 ${styles.bar}`} />
      <div className="flex items-start justify-between gap-3">
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
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const EMPTY_FORM: RecordForm = {
  amount: "",
  paymentMode: "NEFT",
  paymentDate: todayISO(),
  referenceNo: "",
  bankName: "",
  notes: "",
};

export function FinancePaymentsPage() {
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [recordRow, setRecordRow] = useState<PaymentRow | null>(null);
  const [recordForm, setRecordForm] = useState<RecordForm>(EMPTY_FORM);
  const [historyRow, setHistoryRow] = useState<PaymentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null);

  const { data: companiesRaw = [] } = useQuery({
    queryKey: ["followup-payment-companies"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/followup-payments/companies");
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json().catch(() => ({})) as Promise<{ id: number; label: string }[]>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const queryKey = [
    "followup-payments",
    page,
    search,
    companyId,
    projectId,
    status,
  ];

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchPayments({
        page,
        pageSize: PAGE_SIZE,
        search,
        companyId,
        projectId,
        status,
      }),
    placeholderData: (prev) => prev,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["followup-payment-projects"],
    queryFn: fetchProjects,
  });

  // Projects don't carry a CompanyId in the API response, so show all.
  // When the backend adds company linkage, filter here: projects.filter(p => !companyId || String(p.CompanyId) === companyId)
  const filteredProjects = projects;

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery({
    queryKey: ["followup-payment-receipts", historyRow?.TermId],
    queryFn: () => fetchReceipts(historyRow!.TermId),
    enabled: !!historyRow,
  });

  const recordMutation = useMutation({
    mutationFn: ({ termId, form }: { termId: number; form: RecordForm }) =>
      recordPayment(termId, form),
    onSuccess: (result) => {
      toast.success(
        result.markedPaid
          ? `Payment recorded — ${result.receiptNo} · Milestone marked Paid`
          : `Payment recorded — ${result.receiptNo}`,
      );
      queryClient.invalidateQueries({ queryKey: ["followup-payments"] });
      setRecordRow(null);
      setRecordForm(EMPTY_FORM);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteReceipt(id),
    onSuccess: () => {
      toast.success("Receipt removed");
      queryClient.invalidateQueries({ queryKey: ["followup-payments"] });
      queryClient.invalidateQueries({
        queryKey: ["followup-payment-receipts", historyRow?.TermId],
      });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = data?.data ?? [];
  const summary = data?.summary;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = search || projectId || status;

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
  function toggleStatus(s: string) {
    setStatus((prev) => (prev === s ? "" : s));
    setPage(1);
  }

  // Derived: outstanding amount for the record dialog
  const outstanding = recordRow
    ? Math.max(0, recordRow.ComputedAmount - (recordRow.TotalReceived ?? 0))
    : 0;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Finance" },
          { label: "Payments" },
        ]}
      />
      <FollowupShell
        title="Payment Collections"
        icon={IndianRupee}
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

        {/* ── Summary tiles ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            label="Overdue"
            count={summary?.OverdueCount}
            amount={summary?.OverdueAmount}
            active={status === "overdue"}
            color="red"
            icon={
              <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
            }
            onClick={() => toggleStatus(status === "overdue" ? "" : "overdue")}
          />
          <SummaryCard
            label="Outstanding"
            count={summary?.OutstandingCount}
            amount={summary?.OutstandingAmount}
            active={status === "Demanded"}
            color="blue"
            icon={
              <IndianRupee className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            }
            onClick={() => toggleStatus("Demanded")}
          />
          <SummaryCard
            label="Collected"
            count={summary?.CollectedCount}
            amount={summary?.CollectedAmount}
            active={status === "Paid"}
            color="emerald"
            icon={
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            }
            onClick={() => toggleStatus("Paid")}
          />
        </div>

        {/* ── Filters + Table ─────────────────────────────────────────────── */}
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
            <Button onClick={applySearch} size="sm" variant="outline" className="h-8 px-3 text-sm">
              Search
            </Button>

            <Select
              value={companyId || "all"}
              onValueChange={(v) => {
                setCompanyId(v === "all" ? "" : v);
                setProjectId("");
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-40 text-sm">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companiesRaw.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={projectId || "all"}
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
                {filteredProjects.map((p: any) => (
                  <SelectItem key={p.ProjectId} value={String(p.ProjectId)}>{p.ProjectName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status || "all"}
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
                <SelectItem value="Demanded">Outstanding</SelectItem>
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
                <X className="w-3.5 h-3.5" /> Clear filters
              </Button>
            )}

            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {total.toLocaleString("en-IN")} milestone{total !== 1 ? "s" : ""}
            </span>
          </div>

        {/* ── Table ── */}
        <div className="overflow-hidden">
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
                    Demanded
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Collection
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Due / Paid
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pr-4 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-16 text-center text-muted-foreground text-sm"
                    >
                      Loading payment milestones…
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-16 text-center text-destructive text-sm"
                    >
                      Failed to load payments. Try refreshing.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Filter className="w-8 h-8 opacity-30" />
                        <p className="text-sm">No demanded milestones found</p>
                        {hasFilters && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearFilters}
                            className="text-xs"
                          >
                            Clear filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  rows.map((row) => {
                    const overdue = isOverdue(row.DueDate, row.DemandStatus);
                    return (
                      <TableRow
                        key={row.TermId}
                        className={`border-b last:border-0 transition-colors ${
                          overdue
                            ? "bg-red-50/40 hover:bg-red-50/60 dark:bg-red-950/10 dark:hover:bg-red-950/20"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        {/* Booking */}
                        <TableCell className="pl-4 py-3">
                          <div>
                            <span className="font-mono text-xs font-semibold text-foreground tracking-wide">
                              {row.BookingNo}
                            </span>
                            {row.DemandNo && (
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {row.DemandNo}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        {/* Applicant */}
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

                        {/* Project / Unit */}
                        <TableCell className="py-3">
                          <p className="text-sm text-foreground">
                            {row.ProjectName ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {row.UnitNo}
                          </p>
                        </TableCell>

                        {/* Milestone */}
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

                        {/* Demanded amount */}
                        <TableCell className="py-3 text-right">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {fmtMoney(row.ComputedAmount)}
                          </span>
                        </TableCell>

                        {/* Collection progress */}
                        <TableCell className="py-3">
                          <CollectionBar
                            received={row.TotalReceived}
                            total={row.ComputedAmount}
                            status={row.DemandStatus}
                          />
                          {row.ReceiptCount > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {row.ReceiptCount} receipt
                              {row.ReceiptCount !== 1 ? "s" : ""}
                            </p>
                          )}
                        </TableCell>

                        {/* Due / Paid */}
                        <TableCell className="py-3">
                          {row.DemandStatus === "Paid" ? (
                            <div>
                              <p className="text-xs text-muted-foreground">
                                Paid on
                              </p>
                              <p className="text-sm tabular-nums text-emerald-700 dark:text-emerald-400 font-medium">
                                {fmt(row.PaidOn)}
                              </p>
                            </div>
                          ) : row.DueDate ? (
                            <div className="flex items-start gap-1.5">
                              {overdue && (
                                <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 flex-shrink-0" />
                              )}
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  Due
                                </p>
                                <p
                                  className={`text-sm tabular-nums ${overdue ? "text-destructive font-medium" : "text-foreground"}`}
                                >
                                  {fmt(row.DueDate)}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-3">
                          <StatusPill row={row} />
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="py-3 pr-4">
                          <div className="flex items-center justify-end gap-1.5">
                            {row.DemandStatus === "Demanded" && (
                              <Button
                                size="sm"
                                className="h-7 px-3 text-xs gap-1.5"
                                onClick={() => {
                                  setRecordRow(row);
                                  setRecordForm({
                                    ...EMPTY_FORM,
                                    amount: String(
                                      Math.max(
                                        0,
                                        row.ComputedAmount -
                                          (row.TotalReceived ?? 0),
                                      ),
                                    ),
                                    paymentDate: todayISO(),
                                  });
                                }}
                              >
                                <IndianRupee className="w-3 h-3" />
                                Record
                              </Button>
                            )}
                            {row.ReceiptCount > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={() => setHistoryRow(row)}
                              >
                                <History className="w-3.5 h-3.5" />
                              </Button>
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
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {total.toLocaleString("en-IN")}{" "}
                total
              </span>
              <div className="flex gap-1.5">
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
        </div> {/* end card: rounded-xl border bg-card */}
      </FollowupShell>

      {/* ── Record Payment Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!recordRow} onOpenChange={(o) => !o && setRecordRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment Receipt</DialogTitle>
            <DialogDescription>
              Log a payment against this milestone. The milestone is marked Paid
              when full amount is collected.
            </DialogDescription>
          </DialogHeader>

          {recordRow && (
            <div className="space-y-4">
              {/* Milestone summary */}
              <div className="rounded-lg border divide-y text-sm">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Booking</span>
                  <span className="font-mono font-semibold">
                    {recordRow.BookingNo}
                  </span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Applicant</span>
                  <span className="font-medium">{recordRow.ApplicantName}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Milestone</span>
                  <span className="font-medium">{recordRow.TermName}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">
                    Milestone Amount
                  </span>
                  <span className="font-semibold">
                    {fmtMoney(recordRow.ComputedAmount)}
                  </span>
                </div>
                {(recordRow.TotalReceived ?? 0) > 0 && (
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">
                      Already Collected
                    </span>
                    <span className="text-emerald-600 font-semibold">
                      {fmtMoney(recordRow.TotalReceived)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between px-3 py-2 bg-muted/30 rounded-b-lg">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="font-bold text-base text-foreground">
                    {fmtMoney(outstanding)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Amount <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="0.00"
                    value={recordForm.amount}
                    onChange={(e) =>
                      setRecordForm((f) => ({ ...f, amount: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Payment Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={recordForm.paymentDate}
                    onChange={(e) =>
                      setRecordForm((f) => ({
                        ...f,
                        paymentDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Mode <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={recordForm.paymentMode}
                    onValueChange={(v) =>
                      setRecordForm((f) => ({
                        ...f,
                        paymentMode: v as PaymentMode,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Reference No{" "}
                    <span className="text-muted-foreground font-normal">
                      (UTR / Cheque)
                    </span>
                  </Label>
                  <Input
                    placeholder="e.g. UTR123456"
                    value={recordForm.referenceNo}
                    onChange={(e) =>
                      setRecordForm((f) => ({
                        ...f,
                        referenceNo: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">
                  Bank Name{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  placeholder="e.g. HDFC Bank"
                  value={recordForm.bankName}
                  onChange={(e) =>
                    setRecordForm((f) => ({ ...f, bankName: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">
                  Notes{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  value={recordForm.notes}
                  onChange={(e) =>
                    setRecordForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Any remarks…"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRecordRow(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                recordMutation.isPending ||
                !recordForm.amount ||
                !recordForm.paymentDate
              }
              onClick={() => {
                if (!recordRow) return;
                recordMutation.mutate({
                  termId: recordRow.TermId,
                  form: recordForm,
                });
              }}
              className="gap-2"
            >
              <IndianRupee className="w-3.5 h-3.5" />
              {recordMutation.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receipt History Dialog ────────────────────────────────────────── */}
      <Dialog
        open={!!historyRow}
        onOpenChange={(o) => !o && setHistoryRow(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipt History</DialogTitle>
            <DialogDescription>
              {historyRow?.BookingNo} · {historyRow?.TermName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {receiptsLoading && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Loading receipts…
              </p>
            )}
            {!receiptsLoading && receipts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No receipts found.
              </p>
            )}
            {receipts.map((r) => (
              <div key={r.Id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {r.ReceiptNo}
                      </span>
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {r.PaymentMode}
                      </span>
                    </div>
                    <p className="font-bold text-foreground">
                      {fmtMoney(r.AmountReceived)}
                    </p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>{fmt(r.PaymentDate)}</span>
                      {r.ReferenceNo && <span>Ref: {r.ReferenceNo}</span>}
                      {r.BankName && <span>{r.BankName}</span>}
                    </div>
                    {r.Notes && (
                      <p className="text-xs text-muted-foreground italic">
                        {r.Notes}
                      </p>
                    )}
                    {r.RecordedBy && (
                      <p className="text-xs text-muted-foreground">
                        by {r.RecordedBy}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(r)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryRow(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Receipt Confirm ────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Receipt?</AlertDialogTitle>
            <AlertDialogDescription>
              Receipt <strong>{deleteTarget?.ReceiptNo}</strong> for{" "}
              <strong>{fmtMoney(deleteTarget?.AmountReceived)}</strong> will be
              permanently removed. If the milestone was marked Paid, it will
              revert to Outstanding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.Id)
              }
            >
              {deleteMutation.isPending ? "Removing…" : "Yes, Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default FinancePaymentsPage;
