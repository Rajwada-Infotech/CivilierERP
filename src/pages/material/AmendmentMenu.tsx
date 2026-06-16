import React, { useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  ShoppingCart,
  Package,
  Receipt,
  Search,
  Eye,
  Send,
  ShieldCheck,
  XCircle,
  Trash2,
  Loader2,
  ArrowLeftRight,
  FileSearch,
  User,
  RefreshCw,
  Pencil,
  History,
  ChevronDown,
  ChevronUp,
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
import { getPurchaseOrders } from "@/api/purchaseOrdersApi";
import { getGRNs } from "@/api/grnApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocTab = "PO" | "GRN" | "EB";

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
  PO: "PurchaseOrder",
  GRN: "GRN",
  EB: "ExpenseBooking",
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
    id: "PO",
    label: "Purchase Orders",
    icon: ShoppingCart,
    color: "text-blue-500",
    docType: "PurchaseOrder",
  },
  {
    id: "GRN",
    label: "GRN",
    icon: Package,
    color: "text-emerald-500",
    docType: "GRN",
  },
  {
    id: "EB",
    label: "Expense Bookings",
    icon: Receipt,
    color: "text-purple-500",
    docType: "ExpenseBooking",
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

function toFormState(a: Amendment): FormState {
  return {
    RefDocType: a.RefDocType ?? "",
    RefDocId: a.RefDocId != null ? String(a.RefDocId) : "",
    RefDocNo: a.RefDocNo ?? "",
    ProjectName: a.ProjectName ?? "",
    CompanyName: a.CompanyName ?? "",
    Description: a.Description ?? "",
    Reason: a.Reason ?? "",
    AmendmentDate: a.AmendmentDate ?? "",
    OriginalValue: a.OriginalValue != null ? String(a.OriginalValue) : "",
    RevisedValue: a.RevisedValue != null ? String(a.RevisedValue) : "",
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Stats Card ───────────────────────────────────────────────────────────────

function StatsRow({
  poCount,
  grnCount,
  ebCount,
  amendmentCount,
}: {
  poCount: number;
  grnCount: number;
  ebCount: number;
  amendmentCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {[
        {
          label: "Purchase Orders",
          value: poCount,
          icon: ShoppingCart,
          cls: "text-blue-500",
        },
        {
          label: "GRNs",
          value: grnCount,
          icon: Package,
          cls: "text-emerald-500",
        },
        {
          label: "Expense Bookings",
          value: ebCount,
          icon: Receipt,
          cls: "text-purple-500",
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
          className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 shadow-sm"
        >
          <div className={`shrink-0 ${cls}`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="text-xl font-bold text-foreground">{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Amendment Form Dialog ────────────────────────────────────────────────────

interface AmendFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Amendment | null;
  initialForm: FormState;
  onSave: (payload: AmendmentPayload) => void;
  isSaving: boolean;
}

function AmendFormDialog({
  open,
  onOpenChange,
  editing,
  initialForm,
  onSave,
  isSaving,
}: AmendFormDialogProps) {
  const [form, setForm] = useState<FormState>(initialForm);

  React.useEffect(() => {
    setForm(initialForm);
  }, [initialForm, open]);

  const set = (field: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const diff = useMemo(() => {
    const o = Number(form.OriginalValue);
    const r = Number(form.RevisedValue);
    if (!form.OriginalValue.trim() || !form.RevisedValue.trim()) return null;
    if (Number.isNaN(o) || Number.isNaN(r)) return null;
    return r - o;
  }, [form.OriginalValue, form.RevisedValue]);

  const handleSave = () => {
    if (!form.ProjectName.trim()) {
      toast.error("Project name is required");
      return;
    }
    if (!form.Description.trim()) {
      toast.error("Description of change is required");
      return;
    }
    if (!form.Reason.trim()) {
      toast.error("Amendment reason is required");
      return;
    }
    onSave(toPayload(form));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isSaving) onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine size={18} className="text-primary" />
            {editing ? "Edit Amendment" : "New Amendment"}
          </DialogTitle>
          <DialogDescription>
            Capture the proposed value change and business reason for this
            amendment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          {/* Doc Type — read-only when pre-filled */}
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Input
              value={
                form.RefDocType === "PurchaseOrder"
                  ? "Purchase Order"
                  : form.RefDocType === "GRN"
                    ? "GRN"
                    : form.RefDocType === "ExpenseBooking"
                      ? "Expense Booking"
                      : form.RefDocType || "—"
              }
              readOnly
              className="bg-muted/40 cursor-default"
            />
          </div>

          {/* Doc No — read-only when pre-filled */}
          <div className="space-y-1.5">
            <Label>Document No.</Label>
            <Input
              value={form.RefDocNo}
              readOnly
              className="bg-muted/40 cursor-default font-mono"
            />
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Amendment Date</Label>
            <Input
              type="date"
              value={form.AmendmentDate}
              onChange={(e) => set("AmendmentDate", e.target.value)}
            />
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <Label>
              Project Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.ProjectName}
              onChange={(e) => set("ProjectName", e.target.value)}
              placeholder="Project name"
            />
          </div>

          {/* Company */}
          <div className="space-y-1.5">
            <Label>Company / Vendor</Label>
            <Input
              value={form.CompanyName}
              onChange={(e) => set("CompanyName", e.target.value)}
              placeholder="Company or vendor"
            />
          </div>

          {/* Original Value */}
          <div className="space-y-1.5">
            <Label>Original Value (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.OriginalValue}
              onChange={(e) => set("OriginalValue", e.target.value)}
              placeholder="0.00"
            />
          </div>

          {/* Revised Value */}
          <div className="space-y-1.5">
            <Label>Revised Value (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.RevisedValue}
              onChange={(e) => set("RevisedValue", e.target.value)}
              placeholder="0.00"
            />
          </div>

          {/* Diff preview */}
          {diff !== null && (
            <div className="md:col-span-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm flex items-center gap-2">
              <ArrowLeftRight
                size={14}
                className="text-muted-foreground shrink-0"
              />
              <span className="text-muted-foreground">Value difference: </span>
              <span
                className={`font-semibold ${diff >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
              >
                {diff >= 0 ? "+" : ""}
                {formatMoney(diff)}
              </span>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5 md:col-span-2">
            <Label>
              Description of Change <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={form.Description}
              onChange={(e) => set("Description", e.target.value)}
              placeholder="What specifically changed — item quantities, rates, delivery date, etc."
            />
          </div>

          {/* Reason */}
          <div className="space-y-1.5 md:col-span-2">
            <Label>
              Business Reason <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.Reason || "__empty"}
              onValueChange={(v) => set("Reason", v === "__empty" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reason for amendment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty">Select reason...</SelectItem>
                {AMENDMENT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : editing ? (
              "Save Changes"
            ) : (
              "Create Amendment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Amendment Detail Dialog ──────────────────────────────────────────────────

function AmendmentDetailDialog({
  amendment,
  onClose,
}: {
  amendment: Amendment | null;
  onClose: () => void;
}) {
  if (!amendment) return null;
  return (
    <Dialog
      open={!!amendment}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine size={16} className="text-primary" />
            {amendment.AmendmentNo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={amendment.Status} />
            {amendment.RefDocNo && (
              <span className="text-sm font-mono text-muted-foreground">
                → {amendment.RefDocNo}
              </span>
            )}
          </div>

          {(amendment.OriginalValue != null ||
            amendment.RevisedValue != null) && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                  Original
                </div>
                <div className="text-base font-bold text-foreground">
                  {formatMoney(amendment.OriginalValue)}
                </div>
              </div>
              <div className="flex items-center justify-center">
                <ArrowLeftRight size={16} className="text-muted-foreground" />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                  Revised
                </div>
                <div className="text-base font-bold text-foreground">
                  {formatMoney(amendment.RevisedValue)}
                </div>
              </div>
            </div>
          )}
          {amendment.ValueDifference != null && (
            <div
              className={`text-center text-sm font-semibold ${amendment.ValueDifference >= 0 ? "text-emerald-600" : "text-rose-600"}`}
            >
              Net change: {amendment.ValueDifference >= 0 ? "+" : ""}
              {formatMoney(amendment.ValueDifference)}
            </div>
          )}

          {[
            { label: "Project", value: amendment.ProjectName },
            { label: "Company / Vendor", value: amendment.CompanyName },
            {
              label: "Amendment Date",
              value: formatDate(amendment.AmendmentDate),
            },
            { label: "Description", value: amendment.Description },
            { label: "Reason", value: amendment.Reason },
          ].map(({ label, value }) =>
            value ? (
              <div key={label} className="space-y-1">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {label}
                </div>
                <div className="text-sm text-foreground bg-muted/20 rounded-lg px-3 py-2 border border-border whitespace-pre-line">
                  {value}
                </div>
              </div>
            ) : null,
          )}

          {(amendment.ApprovedBy || amendment.RejectedBy) && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Approval Trail
              </div>
              {amendment.ApprovedBy && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>
                    Approved by <strong>{amendment.ApprovedBy}</strong> on{" "}
                    {formatDate(amendment.ApprovedAt)}
                  </span>
                </div>
              )}
              {amendment.RejectedBy && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
                    <XCircle size={13} />
                    <span>
                      Rejected by <strong>{amendment.RejectedBy}</strong> on{" "}
                      {formatDate(amendment.RejectedAt)}
                    </span>
                  </div>
                  {amendment.RejectionNote && (
                    <div className="text-xs text-muted-foreground pl-5">
                      Note: {amendment.RejectionNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border p-3 space-y-1">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Audit
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <User size={11} /> Created by{" "}
              <strong className="text-foreground">
                {amendment.CreatedBy ?? "—"}
              </strong>{" "}
              · {formatDate(amendment.CreatedAt)}
            </div>
            {amendment.UpdatedBy && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <RefreshCw size={11} /> Updated by{" "}
                <strong className="text-foreground">
                  {amendment.UpdatedBy}
                </strong>{" "}
                · {formatDate(amendment.UpdatedAt)}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Amendments History Panel (inline expand per doc row) ─────────────────────

function AmendmentsHistoryPanel({
  docType,
  docNo,
  docId,
  canApprove,
  onEdit,
  queryClient,
}: {
  docType: string;
  docNo: string;
  docId: number | string;
  canApprove: boolean;
  onEdit: (a: Amendment) => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [viewingAmendment, setViewingAmendment] = useState<Amendment | null>(
    null,
  );
  const [rejectTarget, setRejectTarget] = useState<Amendment | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Amendment | null>(null);

  const query = useQuery({
    queryKey: ["amendments-doc", docType, docNo],
    queryFn: () =>
      getAmendments({ refDocType: docType, search: docNo, pageSize: 50 }),
  });

  const rows = query.data?.data ?? [];

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["amendments"] }),
    [queryClient],
  );

  const submitMutation = useMutation({
    mutationFn: submitAmendment,
    onSuccess: () => {
      toast.success("Submitted for approval");
      invalidate();
      query.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: approveAmendment,
    onSuccess: () => {
      toast.success("Amendment approved");
      invalidate();
      query.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      rejectAmendment(id, note),
    onSuccess: () => {
      toast.success("Amendment rejected");
      setRejectTarget(null);
      setRejectNote("");
      invalidate();
      query.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAmendment,
    onSuccess: () => {
      toast.success("Amendment deleted");
      setDeleteTarget(null);
      invalidate();
      query.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 text-muted-foreground text-xs">
        <Loader2 size={13} className="animate-spin" />
        Loading amendments…
      </div>
    );
  }

  return (
    <div className="bg-muted/20 border-t border-border">
      {rows.length === 0 ? (
        <div className="py-3 px-6 text-xs text-muted-foreground italic">
          No amendments yet for this document.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                  Amendment No.
                </th>
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                  Reason
                </th>
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                  Value Change
                </th>
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                  Date
                </th>
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                  Status
                </th>
                <th className="text-right px-4 py-2 font-semibold text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.Id}
                  className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setViewingAmendment(a)}
                      className="font-semibold text-primary hover:underline font-mono"
                    >
                      {a.AmendmentNo}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate">
                    {a.Reason ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {a.OriginalValue != null || a.RevisedValue != null ? (
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">
                          {formatMoney(a.OriginalValue)}
                        </span>
                        <ArrowLeftRight
                          size={10}
                          className="text-muted-foreground"
                        />
                        <span className="font-medium">
                          {formatMoney(a.RevisedValue)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(a.AmendmentDate)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={a.Status} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setViewingAmendment(a)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                        title="View"
                      >
                        <Eye size={13} />
                      </button>
                      {a.Status === "Draft" && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit(a)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => submitMutation.mutate(a.Id)}
                            disabled={submitMutation.isPending}
                            className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 text-blue-600 transition"
                            title="Submit for approval"
                          >
                            <Send size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(a)}
                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                      {a.Status === "Pending" && canApprove && (
                        <>
                          <button
                            type="button"
                            onClick={() => approveMutation.mutate(a.Id)}
                            disabled={approveMutation.isPending}
                            className="p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 transition"
                            title="Approve"
                          >
                            <ShieldCheck size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectTarget(a);
                              setRejectNote("");
                            }}
                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition"
                            title="Reject"
                          >
                            <XCircle size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail / reject / delete dialogs reused inside the panel */}
      <AmendmentDetailDialog
        amendment={viewingAmendment}
        onClose={() => setViewingAmendment(null)}
      />

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!rejectMutation.isPending && !o) {
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
              disabled={rejectMutation.isPending}
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
                !rejectNote.trim() || rejectMutation.isPending || !rejectTarget
              }
              onClick={() => {
                if (rejectTarget)
                  rejectMutation.mutate({
                    id: rejectTarget.Id,
                    note: rejectNote.trim(),
                  });
              }}
            >
              {rejectMutation.isPending ? (
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Amendment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete <strong>{deleteTarget?.AmendmentNo}</strong>
              . Only Draft amendments can be deleted. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending || !deleteTarget}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.Id);
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Document Table (PO / GRN / EB) ──────────────────────────────────────────

interface DocRow {
  id: number | string;
  docNo: string;
  date: string;
  party: string;
  project: string;
  company: string;
  amount: number | null;
  status: string;
}

function normalisePoRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.PurchaseOrderID ?? r.Id,
    docNo: r.DocNo ?? r.PurchaseOrderNo ?? "—",
    date: r.PODate ?? r.CreatedAt ?? "",
    party: r.SupplierName ?? "—",
    project: r.ProjectName ?? "—",
    company: r.CompanyName ?? "—",
    amount: r.TotalAmount ?? null,
    status: r.Status ?? "—",
  }));
}

function normaliseGrnRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.GRNId ?? r.Id,
    docNo: r.DocNo ?? r.GRNNo ?? "—",
    date: r.GRNDate ?? r.CreatedAt ?? "",
    party: r.SupplierName ?? "—",
    project: r.ProjectName ?? "—",
    company: r.CompanyName ?? "—",
    amount: r.TotalAmount ?? null,
    status: r.Status ?? "—",
  }));
}

function normaliseEbRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.Eid ?? r.id,
    docNo: r.EDocNo ?? `Draft #${r.Eid}`,
    date: r.EDocDate ?? r.ECreatedAt ?? "",
    party: r.ESupplierName ?? r.EName ?? "—",
    project: r.EProjectDisplayName ?? r.EProjectName ?? "—",
    company: r.ECompanyName ?? "—",
    amount: r.ENetAmount ?? r.EAmount ?? null,
    status: r.EStatus ?? "—",
  }));
}

function DocTable({
  tab,
  search,
  page,
  onPageChange,
  onAmend,
  queryClient,
  canApprove,
}: {
  tab: DocTab;
  search: string;
  page: number;
  onPageChange: (p: number) => void;
  onAmend: (row: DocRow) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  canApprove: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  const docType = DOC_TYPE_MAP[tab];
  const PAGE_SIZE = 15;

  const poQuery = useQuery({
    queryKey: ["amend-po-list", page, search],
    queryFn: () => getPurchaseOrders({ page, limit: PAGE_SIZE }),
    enabled: tab === "PO",
  });

  const grnQuery = useQuery({
    queryKey: ["amend-grn-list", page, search],
    queryFn: () => getGRNs({ page, limit: PAGE_SIZE }),
    enabled: tab === "GRN",
  });

  const ebQuery = useQuery({
    queryKey: ["amend-eb-list", page],
    queryFn: () =>
      fetchWithAuth(
        `/api/expense-booking?page=${page}&limit=${PAGE_SIZE}`,
      ).then((r) => r.json()),
    enabled: tab === "EB",
  });

  const isLoading =
    (tab === "PO" && poQuery.isLoading) ||
    (tab === "GRN" && grnQuery.isLoading) ||
    (tab === "EB" && ebQuery.isLoading);

  const isError =
    (tab === "PO" && poQuery.isError) ||
    (tab === "GRN" && grnQuery.isError) ||
    (tab === "EB" && ebQuery.isError);

  const rawRows: DocRow[] = useMemo(() => {
    if (tab === "PO") {
      const data = poQuery.data?.data ?? [];
      return normalisePoRows(data);
    }
    if (tab === "GRN") {
      const data = grnQuery.data?.data ?? [];
      return normaliseGrnRows(data);
    }
    if (tab === "EB") {
      const data = Array.isArray(ebQuery.data?.data)
        ? ebQuery.data.data
        : Array.isArray(ebQuery.data)
          ? ebQuery.data
          : [];
      return normaliseEbRows(data);
    }
    return [];
  }, [tab, poQuery.data, grnQuery.data, ebQuery.data]);

  // Client-side search filter
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
    tab === "PO"
      ? ((poQuery.data as any)?.totalPages ?? 1)
      : tab === "GRN"
        ? ((grnQuery.data as any)?.totalPages ?? 1)
        : ((ebQuery.data as any)?.totalPages ?? 1);

  const toggleExpand = (id: string | number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-8" />
            <TableHead>Doc No.</TableHead>
            <TableHead>Party / Vendor</TableHead>
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
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                      title={
                        expandedId === row.id
                          ? "Hide amendments"
                          : "View amendments"
                      }
                    >
                      {expandedId === row.id ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold font-mono text-sm text-foreground">
                      {row.docNo}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{row.party}</div>
                    {row.company && row.company !== "—" && (
                      <div className="text-xs text-muted-foreground">
                        {row.company}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{row.project}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium"
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => toggleExpand(row.id)}
                      >
                        <History size={12} />
                        {expandedId === row.id ? "Hide" : "History"}
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => onAmend(row)}
                      >
                        <FilePenLine size={12} />
                        Amend
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                {/* Inline expanded amendments panel */}
                {expandedId === row.id && (
                  <TableRow>
                    <TableCell colSpan={8} className="p-0">
                      <AmendmentsHistoryPanel
                        docType={docType}
                        docNo={row.docNo}
                        docId={row.id}
                        canApprove={canApprove}
                        onEdit={(a) => {
                          /* bubble up handled by parent via state */
                        }}
                        queryClient={queryClient}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AmendmentMenu() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const canApprove = APPROVER_ROLES.includes(getCurrentRole() ?? "");

  const prefill =
    (location.state as { prefill?: PrefillState } | null)?.prefill ?? null;

  const [activeTab, setActiveTab] = useState<DocTab>(() => {
    if (prefill?.tab && ["PO", "GRN", "EB"].includes(prefill.tab))
      return prefill.tab;
    return "PO";
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Amendment | null>(null);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);

  // Auto-open amend form when navigated from PO/GRN/EB page with prefill state
  React.useEffect(() => {
    if (!prefill) return;
    const docTypeMap: Record<string, string> = {
      PO: "PurchaseOrder",
      GRN: "GRN",
      EB: "ExpenseBooking",
    };
    const form: FormState = {
      ...EMPTY_FORM,
      RefDocType: docTypeMap[prefill.tab ?? ""] ?? "",
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
    // Clear state so revisiting the page doesn't re-open the form
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats — document counts from list endpoints + total amendments raised
  const poStatsQuery = useQuery({
    queryKey: ["amend-po-list", 1, ""],
    queryFn: () => getPurchaseOrders({ page: 1, limit: 1 }),
  });
  const grnStatsQuery = useQuery({
    queryKey: ["amend-grn-list", 1, ""],
    queryFn: () => getGRNs({ page: 1, limit: 1 }),
  });
  const ebStatsQuery = useQuery({
    queryKey: ["amend-eb-list", 1],
    queryFn: () =>
      fetchWithAuth("/api/expense-booking?page=1&limit=1").then((r) =>
        r.json(),
      ),
  });
  const amendTotalQuery = useQuery({
    queryKey: ["amendments-count", "total"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1 }),
  });

  const stats = useMemo(
    () => ({
      poCount: (poStatsQuery.data as any)?.total ?? 0,
      grnCount: (grnStatsQuery.data as any)?.total ?? 0,
      ebCount: (ebStatsQuery.data as any)?.total ?? 0,
      amendmentCount: amendTotalQuery.data?.pagination?.total ?? 0,
    }),
    [
      poStatsQuery.data,
      grnStatsQuery.data,
      ebStatsQuery.data,
      amendTotalQuery.data,
    ],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["amendments"] });
    queryClient.invalidateQueries({ queryKey: ["amendments-count"] });
    queryClient.invalidateQueries({ queryKey: ["amend-po-list"] });
    queryClient.invalidateQueries({ queryKey: ["amend-grn-list"] });
    queryClient.invalidateQueries({ queryKey: ["amend-eb-list"] });
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
    // Open create form pre-filled from the document row
    const docTypeStr = DOC_TYPE_MAP[activeTab];
    const form: FormState = {
      ...EMPTY_FORM,
      RefDocType: docTypeStr,
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

  const openEdit = (a: Amendment) => {
    setEditing(a);
    setInitialForm(toFormState(a));
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
      <Breadcrumbs items={["Material", "Amendment"]} />

      <div className="p-6 space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-heading font-bold text-foreground">
            <FilePenLine size={20} className="text-primary" />
            Amendment Centre
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Select a Purchase Order, GRN, or Expense Booking to raise or review
            amendments — full audit trail.
          </p>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <StatsRow
        poCount={stats.poCount}
        grnCount={stats.grnCount}
        ebCount={stats.ebCount}
        amendmentCount={stats.amendmentCount}
      />

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {TAB_CONFIG.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
              activeTab === id
                ? "gradient-accent text-white shadow-sm border-transparent"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon
              size={14}
              className={activeTab === id ? "text-white" : color}
            />
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search doc no, party, project…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({
              queryKey: ["amend-po-list"],
            });
            queryClient.invalidateQueries({
              queryKey: ["amend-grn-list"],
            });
            queryClient.invalidateQueries({
              queryKey: ["amend-eb-list"],
            });
          }}
          className="shrink-0"
        >
          <RefreshCw size={13} className="mr-1.5" />
          Refresh
        </Button>
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
      />

      </div>

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
