import React, { useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FilePenLine,
  ClipboardList,
  CheckSquare,
  LayoutList,
  Search,
  Send,
  ShieldCheck,
  XCircle,
  Trash2,
  Loader2,
  FileSearch,
  RefreshCw,
  Pencil,
  History,
  ChevronDown,
  ChevronUp,
  User,
  ArrowLeftRight,
} from "lucide-react";
import {
  Amendment,
  AmendmentPayload,
  createAmendment,
  deleteAmendment,
  getAmendments,
  rejectAmendment,
  approveAmendment,
  submitAmendment,
  updateAmendment,
} from "@/api/amendmentsApi";
import { getWorkOrders } from "@/api/workOrderApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocTab = "WO" | "WORK_DONE" | "BOQ";

interface PrefillState {
  tab?: DocTab;
  docId?: string | number;
  docNo?: string;
  supplierName?: string;
  projectName?: string;
  companyName?: string;
  totalAmount?: number;
}

interface FormState {
  RefDocType: string;
  RefDocId: string;
  RefDocNo: string;
  ProjectName: string;
  CompanyName: string;
  Description: string;
  Reason: string;
  AmendmentDate: string;
  OriginalValue: string;
  RevisedValue: string;
}

interface DocRow {
  id: string | number;
  docNo: string;
  party: string;
  company: string;
  project: string;
  amount: number | null;
  date: string;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormState = {
  RefDocType: "",
  RefDocId: "",
  RefDocNo: "",
  ProjectName: "",
  CompanyName: "",
  Description: "",
  Reason: "",
  AmendmentDate: "",
  OriginalValue: "",
  RevisedValue: "",
};

const AMENDMENT_REASONS = [
  "Data Entry Error",
  "Vendor / Supplier Correction",
  "Quantity Revision",
  "Rate Revision",
  "Date Correction",
  "Tax Rate Correction",
  "Description Update",
  "Status Correction",
  "Management Instruction",
  "Other",
];

const DOC_TYPE_MAP: Record<DocTab, string> = {
  WO: "WorkOrder",
  WORK_DONE: "WorkDone",
  BOQ: "BOQ",
};

const APPROVER_ROLES = ["admin", "director", "manager"];

const STATUS_STYLES: Record<string, string> = {
  Draft:
    "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  Pending:
    "border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Approved:
    "border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Rejected:
    "border-rose-300 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

const TAB_CONFIG: {
  id: DocTab;
  label: string;
  icon: React.ElementType;
  color: string;
  docType: string;
}[] = [
  {
    id: "WO",
    label: "Work Orders",
    icon: ClipboardList,
    color: "text-orange-500",
    docType: "WorkOrder",
  },
  {
    id: "WORK_DONE",
    label: "Work Done",
    icon: CheckSquare,
    color: "text-teal-500",
    docType: "WorkDone",
  },
  {
    id: "BOQ",
    label: "BOQ",
    icon: LayoutList,
    color: "text-indigo-500",
    docType: "BOQ",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentRole(): string | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.role === "string" ? parsed.role.toLowerCase() : null;
  } catch {
    return null;
  }
}

function formatMoney(val: number | null | undefined) {
  if (val == null || Number.isNaN(Number(val))) return "—";
  return `₹${Number(val).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? val : d.toLocaleDateString("en-IN");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toPayload(form: FormState): AmendmentPayload {
  return {
    RefDocType: form.RefDocType || undefined,
    RefDocId: form.RefDocId ? Number(form.RefDocId) : undefined,
    RefDocNo: form.RefDocNo.trim() || undefined,
    ProjectName: form.ProjectName.trim() || undefined,
    CompanyName: form.CompanyName.trim() || undefined,
    Description: form.Description.trim() || undefined,
    Reason: form.Reason.trim() || undefined,
    AmendmentDate: form.AmendmentDate || undefined,
    OriginalValue: form.OriginalValue ? Number(form.OriginalValue) : undefined,
    RevisedValue: form.RevisedValue ? Number(form.RevisedValue) : undefined,
  };
}

// ─── Normalise helpers ────────────────────────────────────────────────────────

function normaliseWoRows(rows: any[]): DocRow[] {
  return rows.map((r) => ({
    id: r.Id ?? r.ID ?? "",
    docNo: r.DocumentNumber ?? r.DocNo ?? "—",
    party: r.ContractorName ?? r.SupplierName ?? "—",
    company: r.CompanyName ?? "—",
    project: r.ProjectName ?? "—",
    amount: r.TotalAmount ?? null,
    date: r.DocumentDate ?? r.CreatedAt ?? "",
    status: r.Status ?? "—",
  }));
}

function normaliseWorkDoneRows(rows: any[]): DocRow[] {
  return rows.map((r) => ({
    id: r.ID ?? r.Id ?? "",
    docNo: r.DocNo ?? "—",
    party: r.ContractorName ?? r.SupplierName ?? "—",
    company: r.CompanyName ?? "—",
    project: r.ProjectName ?? "—",
    amount: r.CertifiedAmount ?? r.GrossAmount ?? null,
    date: r.DocDate ?? r.CreatedAt ?? "",
    status: r.Status ?? "—",
  }));
}

function normaliseBoqRows(rows: any[]): DocRow[] {
  return rows.map((r) => ({
    id: r.BoqID ?? r.ID ?? "",
    docNo: r.DocNo ?? r.BoqNo ?? "—",
    party: r.CompanyName ?? "—",
    company: r.CompanyName ?? "—",
    project: r.ProjectName ?? "—",
    amount: r.TotalAmount ?? null,
    date: r.BoqDate ?? r.CreatedAt ?? "",
    status: r.Status ?? "—",
  }));
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={STATUS_STYLES[status] ?? STATUS_STYLES.Draft}
    >
      {status}
    </Badge>
  );
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function StatsRow({
  woCount,
  workDoneCount,
  boqCount,
  amendmentCount,
}: {
  woCount: number;
  workDoneCount: number;
  boqCount: number;
  amendmentCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {[
        {
          label: "Work Orders",
          value: woCount,
          icon: ClipboardList,
          cls: "text-orange-500",
        },
        {
          label: "Work Done",
          value: workDoneCount,
          icon: CheckSquare,
          cls: "text-teal-500",
        },
        {
          label: "BOQs",
          value: boqCount,
          icon: LayoutList,
          cls: "text-indigo-500",
        },
        {
          label: "Amendments Raised",
          value: amendmentCount,
          icon: FilePenLine,
          cls: "text-primary",
        },
      ].map(({ label, value, icon: Icon, cls }) => (
        <div
          key={label}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm"
        >
          <div className={`rounded-lg p-2 bg-muted ${cls}`}>
            <Icon size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-bold text-foreground leading-tight">
              {value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Amendment sub-row (history inline) ──────────────────────────────────────

function AmendmentSubRows({
  docType,
  docId,
  onEdit,
  canApprove,
  queryClient,
  canEdit,
  canDelete,
}: {
  docType: string;
  docId: string | number;
  onEdit: (a: Amendment) => void;
  canApprove: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Amendment | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: ["amendments", docType, String(docId)],
    queryFn: () =>
      getAmendments({ page: 1, pageSize: 50, refDocType: docType }),
    select: (d) =>
      (d.data ?? []).filter((a) => String(a.RefDocId) === String(docId)),
  });

  const submitMut = useMutation({
    mutationFn: submitAmendment,
    onSuccess: () => {
      toast.success("Submitted for approval");
      queryClient.invalidateQueries({
        queryKey: ["amendments", docType, String(docId)],
      });
      queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: approveAmendment,
    onSuccess: () => {
      toast.success("Amendment approved");
      queryClient.invalidateQueries({
        queryKey: ["amendments", docType, String(docId)],
      });
      queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      rejectAmendment(id, note),
    onSuccess: () => {
      toast.warning("Amendment rejected");
      setRejectTarget(null);
      setRejectNote("");
      queryClient.invalidateQueries({
        queryKey: ["amendments", docType, String(docId)],
      });
      queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAmendment,
    onSuccess: () => {
      toast.success("Amendment deleted");
      queryClient.invalidateQueries({
        queryKey: ["amendments", docType, String(docId)],
      });
      queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (query.isLoading)
    return (
      <TableRow>
        <TableCell colSpan={8} className="bg-muted/20 py-3 text-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin inline text-muted-foreground" />
        </TableCell>
      </TableRow>
    );

  if (!query.data?.length)
    return (
      <TableRow>
        <TableCell
          colSpan={8}
          className="bg-muted/20 py-3 text-center text-xs text-muted-foreground"
        >
          No amendments raised for this document yet.
        </TableCell>
      </TableRow>
    );

  return (
    <>
      {query.data.map((a) => (
        <TableRow key={a.Id} className="bg-muted/10 text-xs">
          <TableCell />
          <TableCell className="font-mono text-[11px] text-muted-foreground">
            #{a.Id}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1.5">
              <User size={11} className="text-muted-foreground" />
              {a.CreatedBy ?? "—"}
            </div>
          </TableCell>
          <TableCell className="max-w-[180px] truncate" title={a.Description}>
            {a.Description ?? "—"}
          </TableCell>
          <TableCell>
            {a.OriginalValue != null && a.RevisedValue != null ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-muted-foreground">
                  {formatMoney(a.OriginalValue)}
                </span>
                <ArrowLeftRight size={10} />
                <span className="text-foreground font-semibold">
                  {formatMoney(a.RevisedValue)}
                </span>
              </span>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell>{formatDate(a.AmendmentDate)}</TableCell>
          <TableCell>
            <StatusBadge status={a.Status ?? "Draft"} />
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              {a.Status === "Draft" && (
                <>
                  {canEdit !== false && (
                    <button
                      type="button"
                      onClick={() => onEdit(a)}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => submitMut.mutate(a.Id)}
                    className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 text-blue-500 transition"
                    title="Submit"
                  >
                    <Send size={12} />
                  </button>
                  {canDelete !== false && (
                  <button
                    type="button"
                    onClick={() => setDeleteId(a.Id)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                  )}
                </>
              )}
              {a.Status === "Pending" && canApprove && (
                <>
                  <button
                    type="button"
                    onClick={() => approveMut.mutate(a.Id)}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 transition"
                    title="Approve"
                  >
                    <ShieldCheck size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectTarget(a);
                      setRejectNote("");
                    }}
                    className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition"
                    title="Reject"
                  >
                    <XCircle size={12} />
                  </button>
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      ))}

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Amendment?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The amendment record will be permanently
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleteId != null) deleteMut.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!rejectMut.isPending && !o) {
            setRejectTarget(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Amendment</DialogTitle>
            <DialogDescription>
              Provide a reason before rejecting this amendment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>
              Rejection Note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (required)"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={rejectMut.isPending}
              onClick={() => {
                setRejectTarget(null);
                setRejectNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                !rejectNote.trim() || rejectMut.isPending || !rejectTarget
              }
              onClick={() => {
                if (rejectTarget)
                  rejectMut.mutate({
                    id: rejectTarget.Id,
                    note: rejectNote.trim(),
                  });
              }}
            >
              {rejectMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting…
                </>
              ) : (
                "Confirm Reject"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Document Table ───────────────────────────────────────────────────────────

function DocTable({
  tab,
  search,
  page,
  onPageChange,
  onAmend,
  queryClient,
  canApprove,
  canCreate,
  canEdit,
  canDelete,
}: {
  tab: DocTab;
  search: string;
  page: number;
  onPageChange: (p: number) => void;
  onAmend: (row: DocRow) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  canApprove: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const PAGE_SIZE = 15;

  const woQuery = useQuery({
    queryKey: ["eng-amend-wo-list", page, search],
    queryFn: async () => {
      const res = await getWorkOrders();
      const arr = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.recordset)
            ? res.recordset
            : [];
      return { data: arr, total: arr.length, totalPages: 1 };
    },
    enabled: tab === "WO",
  });

  const workDoneQuery = useQuery({
    queryKey: ["eng-amend-workdone-list", page, search],
    queryFn: () =>
      fetchWithAuth(`/api/engineering/work-done`).then(async (r) => {
        const json = await r.json().catch(() => ({}));
        const arr = Array.isArray(json)
          ? json
          : Array.isArray(json?.data)
            ? json.data
            : [];
        return { data: arr, total: arr.length, totalPages: 1 };
      }),
    enabled: tab === "WORK_DONE",
  });

  const boqQuery = useQuery({
    queryKey: ["eng-amend-boq-list", page, search],
    queryFn: () =>
      fetchWithAuth(`/api/boq?page=${page}&limit=${PAGE_SIZE}`).then((r) =>
        r.json().catch(() => ({})),
      ),
    enabled: tab === "BOQ",
  });

  const isLoading =
    (tab === "WO" && woQuery.isLoading) ||
    (tab === "WORK_DONE" && workDoneQuery.isLoading) ||
    (tab === "BOQ" && boqQuery.isLoading);

  const isError =
    (tab === "WO" && woQuery.isError) ||
    (tab === "WORK_DONE" && workDoneQuery.isError) ||
    (tab === "BOQ" && boqQuery.isError);

  const rawRows: DocRow[] = useMemo(() => {
    if (tab === "WO") return normaliseWoRows(woQuery.data?.data ?? []);
    if (tab === "WORK_DONE")
      return normaliseWorkDoneRows(workDoneQuery.data?.data ?? []);
    if (tab === "BOQ") {
      const d = boqQuery.data;
      const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
      return normaliseBoqRows(arr);
    }
    return [];
  }, [tab, woQuery.data, workDoneQuery.data, boqQuery.data]);

  const rows = useMemo(() => {
    if (!search.trim()) return rawRows;
    const s = search.trim().toLowerCase();
    return rawRows.filter(
      (r) =>
        r.docNo.toLowerCase().includes(s) ||
        r.party.toLowerCase().includes(s) ||
        r.project.toLowerCase().includes(s),
    );
  }, [rawRows, search]);

  const totalPages =
    tab === "WO"
      ? (woQuery.data?.totalPages ?? 1)
      : tab === "WORK_DONE"
        ? (workDoneQuery.data?.totalPages ?? 1)
        : ((boqQuery.data as any)?.totalPages ?? 1);

  const docType = DOC_TYPE_MAP[tab];

  const toggleExpand = (id: string | number) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const partyHeader = tab === "BOQ" ? "Company" : "Contractor / Supplier";

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-8" />
            <TableHead>Doc No.</TableHead>
            <TableHead>{partyHeader}</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center">
                <div className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading documents…
                </div>
              </TableCell>
            </TableRow>
          ) : isError ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-32 text-center text-destructive text-sm"
              >
                Failed to load. Try refreshing.
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Search size={28} className="opacity-30" />
                  <span className="text-sm">No documents found.</span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow className="hover:bg-muted/20">
                  {/* Expand toggle */}
                  <TableCell className="w-8 pl-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(row.id)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition"
                      title="Toggle amendment history"
                    >
                      {expandedId === row.id ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">
                    {row.docNo}
                  </TableCell>
                  <TableCell className="text-sm">{row.party}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.project}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.id)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
                        title="View amendments"
                      >
                        <History size={14} />
                      </button>
                      {canCreate !== false && (
                        <button
                          type="button"
                          onClick={() => onAmend(row)}
                          className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950/30 text-orange-500 hover:text-orange-600 transition"
                          title="Amend"
                        >
                          <FilePenLine size={14} />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>

                {/* Inline amendment history */}
                {expandedId === row.id && (
                  <>
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="bg-muted/10 px-6 pt-2 pb-0"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <History size={11} />
                          Amendment History
                        </div>
                      </TableCell>
                    </TableRow>
                    <AmendmentSubRows
                      docType={docType}
                      docId={row.id}
                      onEdit={(a) => {
                        /* parent handles via onAmend callback */
                        void a;
                      }}
                      canApprove={canApprove}
                      queryClient={queryClient}
                      canEdit={canEdit}
                      canDelete={canDelete}
                    />
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/10 pb-2" />
                    </TableRow>
                  </>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Amendment Form Dialog ────────────────────────────────────────────────────

function AmendFormDialog({
  open,
  onOpenChange,
  editing,
  initialForm,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Amendment | null;
  initialForm: FormState;
  onSave: (payload: AmendmentPayload) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initialForm);

  React.useEffect(() => {
    setForm(initialForm);
  }, [initialForm, open]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const valid =
    form.Description.trim().length > 0 && form.AmendmentDate.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine size={18} className="text-orange-500" />
            {editing ? "Edit Amendment" : "Raise Amendment"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this amendment record."
              : "Describe the change you want to raise against this document."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Read-only doc fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Doc Type</Label>
              <Input
                value={form.RefDocType}
                readOnly
                className="bg-muted/50 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Doc No.</Label>
              <Input
                value={form.RefDocNo}
                readOnly
                className="bg-muted/50 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              placeholder="Describe what needs to be changed…"
              value={form.Description}
              onChange={(e) => set("Description", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Reason</Label>
              <Select
                value={form.Reason}
                onValueChange={(v) => set("Reason", v)}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select reason…" />
                </SelectTrigger>
                <SelectContent>
                  {AMENDMENT_REASONS.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Amendment Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={form.AmendmentDate}
                onChange={(e) => set("AmendmentDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Original Value (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.OriginalValue}
                onChange={(e) => set("OriginalValue", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Revised Value (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.RevisedValue}
                onChange={(e) => set("RevisedValue", e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            disabled={!valid || isSaving}
            onClick={() => onSave(toPayload(form))}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : null}
            {editing ? "Save Changes" : "Raise Amendment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EngineeringAmendmentMenu() {
  const rights = usePageRights("engineering-amendments");
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const canApprove = APPROVER_ROLES.includes(getCurrentRole() ?? "");

  const prefill =
    (location.state as { prefill?: PrefillState } | null)?.prefill ?? null;

  const [activeTab, setActiveTab] = useState<DocTab>(() => {
    if (prefill?.tab && ["WO", "WORK_DONE", "BOQ"].includes(prefill.tab))
      return prefill.tab as DocTab;
    return "WO";
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Amendment | null>(null);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);

  // Auto-open amend form when navigated from WO/WorkDone/BOQ page with prefill
  React.useEffect(() => {
    if (!prefill) return;
    const form: FormState = {
      ...EMPTY_FORM,
      RefDocType: DOC_TYPE_MAP[prefill.tab as DocTab] ?? "",
      RefDocId: String(prefill.docId ?? ""),
      RefDocNo: prefill.docNo ?? "",
      ProjectName: prefill.projectName ?? "",
      CompanyName: prefill.supplierName ?? prefill.companyName ?? "",
      OriginalValue:
        prefill.totalAmount != null ? String(prefill.totalAmount) : "",
      AmendmentDate: today(),
    };
    setInitialForm(form);
    setEditing(null);
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats
  const woStatsQuery = useQuery({
    queryKey: ["eng-amend-wo-list", 1, ""],
    queryFn: async () => {
      const res = await getWorkOrders();
      const arr = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.recordset)
            ? res.recordset
            : [];
      return { total: arr.length };
    },
  });

  const workDoneStatsQuery = useQuery({
    queryKey: ["eng-amend-workdone-list", 1, ""],
    queryFn: () =>
      fetchWithAuth("/api/engineering/work-done").then(async (r) => {
        const json = await r.json().catch(() => ({}));
        const arr = Array.isArray(json)
          ? json
          : Array.isArray(json?.data)
            ? json.data
            : [];
        return { total: arr.length };
      }),
  });

  const boqStatsQuery = useQuery({
    queryKey: ["eng-amend-boq-list", 1, ""],
    queryFn: () =>
      fetchWithAuth("/api/boq?page=1&limit=1").then((r) => r.json().catch(() => ({}))),
  });

  const amendTotalQuery = useQuery({
    queryKey: ["amendments-count", "total"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1 }),
  });

  const stats = useMemo(
    () => ({
      woCount: woStatsQuery.data?.total ?? 0,
      workDoneCount: workDoneStatsQuery.data?.total ?? 0,
      boqCount:
        (boqStatsQuery.data as any)?.total ??
        (Array.isArray(boqStatsQuery.data) ? boqStatsQuery.data.length : 0),
      amendmentCount: amendTotalQuery.data?.pagination?.total ?? 0,
    }),
    [
      woStatsQuery.data,
      workDoneStatsQuery.data,
      boqStatsQuery.data,
      amendTotalQuery.data,
    ],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["amendments"] });
    queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    queryClient.invalidateQueries({ queryKey: ["eng-amend-wo-list"] });
    queryClient.invalidateQueries({ queryKey: ["eng-amend-workdone-list"] });
    queryClient.invalidateQueries({ queryKey: ["eng-amend-boq-list"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: createAmendment,
    onSuccess: () => {
      toast.success("Amendment created");
      setFormOpen(false);
      setEditing(null);
      setInitialForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AmendmentPayload }) =>
      updateAmendment(id, payload),
    onSuccess: () => {
      toast.success("Amendment updated");
      setFormOpen(false);
      setEditing(null);
      setInitialForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const openAmendFromDoc = (row: DocRow) => {
    const form: FormState = {
      ...EMPTY_FORM,
      RefDocType: DOC_TYPE_MAP[activeTab],
      RefDocId: String(row.id),
      RefDocNo: row.docNo,
      ProjectName: row.project !== "—" ? row.project : "",
      CompanyName:
        row.party !== "—" ? row.party : row.company !== "—" ? row.company : "",
      OriginalValue: row.amount != null ? String(row.amount) : "",
      AmendmentDate: today(),
    };
    setEditing(null);
    setInitialForm(form);
    setFormOpen(true);
  };

  const handleSave = (payload: AmendmentPayload) => {
    if (editing) {
      updateMutation.mutate({ id: editing.Id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const switchTab = (tab: DocTab) => {
    setActiveTab(tab);
    setPage(1);
    setSearch("");
  };

  return (
    <>
      <Breadcrumbs items={["Engineering", "Amendment"]} />

      <EngineeringShell
        title="Engineering Amendment Centre"
        subtitle="Select a Work Order, Work Done entry, or BOQ to raise or review amendments — full audit trail."
        icon={FilePenLine}
      >
      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <StatsRow
        woCount={stats.woCount}
        workDoneCount={stats.workDoneCount}
        boqCount={stats.boqCount}
        amendmentCount={stats.amendmentCount}
      />

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {TAB_CONFIG.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-heading font-semibold transition-all border ${
              activeTab === id
                ? "gradient-engineering text-white shadow-sm border-transparent"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon
              size={13}
              className={activeTab === id ? "text-white" : color}
            />
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search doc no, contractor, project…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <button
          onClick={invalidate}
          className="group shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 font-heading font-medium"
        >
          <RefreshCw size={13} className="transition-transform duration-500 group-hover:rotate-180" />
          Refresh
        </button>
      </div>

      {/* ── Document Table ───────────────────────────────────────────────────── */}
      <DocTable
        tab={activeTab}
        search={search}
        page={page}
        onPageChange={setPage}
        onAmend={openAmendFromDoc}
        queryClient={queryClient}
        canApprove={canApprove}
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
      />
      </EngineeringShell>

      {/* ── Amendment Form Dialog ────────────────────────────────────────────── */}
      <AmendFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        initialForm={initialForm}
        onSave={handleSave}
        isSaving={isSaving}
      />
    </>
  );
}