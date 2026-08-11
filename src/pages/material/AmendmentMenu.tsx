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
  CheckCircle2,
  Clock,
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
  getAmendmentLineChanges,
  addAmendmentLineChanges,
  type AmendmentLineChangeInput,
} from "@/api/amendmentsApi";
import { getPurchaseOrders } from "@/api/purchaseOrdersApi";
import { getGRNs } from "@/api/grnApi";
import { getPayments } from "@/api/newPaymentApi";
import { getReceivedPayments } from "@/api/receivedPaymentApi";
import { getFundTransfers } from "@/api/fundTransferApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { MaterialShell } from "@/components/material/MaterialShell";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocTab =
  | "PO"
  | "GRN"
  | "EB"
  | "PAYMENT"
  | "RECEIVED_PAYMENT"
  | "FUND_TRANSFER";

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
  PAYMENT: "Payment",
  RECEIVED_PAYMENT: "ReceivedPayment",
  FUND_TRANSFER: "FundTransfer",
};

// RefDocType -> which module's shell colors the Amendment dialog should
// wrap itself in, since this one page now serves Material, Finance, and
// (via the same Amendments table/RefDocType convention) Engineering doc
// types. Mirrors MaterialShell (emerald/teal), FinanceShell
// (indigo/violet), EngineeringShell (orange) accent hues.
const MODULE_ACCENT: Record<
  string,
  { gradient: string; ring: string; glow: string; text: string; iconBg: string }
> = {
  PurchaseOrder: {
    gradient: "from-emerald-500 via-teal-400 to-cyan-500",
    ring: "ring-emerald-500/20",
    glow: "rgba(16,185,129,0.12)",
    text: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10",
  },
  GRN: {
    gradient: "from-teal-500 via-cyan-400 to-emerald-500",
    ring: "ring-teal-500/20",
    glow: "rgba(20,184,166,0.12)",
    text: "text-teal-600 dark:text-teal-400",
    iconBg: "bg-teal-500/10",
  },
  ExpenseBooking: {
    gradient: "from-purple-500 via-fuchsia-400 to-pink-500",
    ring: "ring-purple-500/20",
    glow: "rgba(168,85,247,0.12)",
    text: "text-purple-600 dark:text-purple-400",
    iconBg: "bg-purple-500/10",
  },
  Payment: {
    gradient: "from-indigo-500 via-violet-400 to-purple-500",
    ring: "ring-indigo-500/20",
    glow: "rgba(99,102,241,0.14)",
    text: "text-indigo-600 dark:text-indigo-400",
    iconBg: "bg-indigo-500/10",
  },
  ReceivedPayment: {
    gradient: "from-indigo-500 via-violet-400 to-purple-500",
    ring: "ring-indigo-500/20",
    glow: "rgba(99,102,241,0.14)",
    text: "text-indigo-600 dark:text-indigo-400",
    iconBg: "bg-indigo-500/10",
  },
  FundTransfer: {
    gradient: "from-indigo-500 via-violet-400 to-purple-500",
    ring: "ring-indigo-500/20",
    glow: "rgba(99,102,241,0.14)",
    text: "text-indigo-600 dark:text-indigo-400",
    iconBg: "bg-indigo-500/10",
  },
  WorkOrder: {
    gradient: "from-orange-500 via-amber-400 to-yellow-500",
    ring: "ring-orange-500/20",
    glow: "rgba(249,115,22,0.14)",
    text: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-500/10",
  },
  BOQ: {
    gradient: "from-orange-500 via-amber-400 to-yellow-500",
    ring: "ring-orange-500/20",
    glow: "rgba(249,115,22,0.14)",
    text: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-500/10",
  },
  WorkDone: {
    gradient: "from-orange-500 via-amber-400 to-yellow-500",
    ring: "ring-orange-500/20",
    glow: "rgba(249,115,22,0.14)",
    text: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-500/10",
  },
};
const DEFAULT_ACCENT = MODULE_ACCENT.PurchaseOrder;

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

// Each tab gets its own accent — active state uses that tab's own gradient
// (rather than one gradient for everything), inactive state uses a matching
// tinted chip instead of a flat, uniform gray pill, so the bar reads as a
// set of distinct document types rather than one undifferentiated row.
const TAB_CONFIG: {
  id: DocTab;
  label: string;
  icon: React.ElementType;
  color: string;
  chip: string;
  gradient: string;
  docType: string;
}[] = [
  {
    id: "PO",
    label: "Purchase Orders",
    icon: ShoppingCart,
    color: "text-emerald-500",
    chip: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15",
    gradient: "from-emerald-500 via-teal-400 to-cyan-500",
    docType: "PurchaseOrder",
  },
  {
    id: "GRN",
    label: "GRN",
    icon: Package,
    color: "text-teal-500",
    chip: "bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400 hover:bg-teal-500/15",
    gradient: "from-teal-500 via-cyan-400 to-emerald-500",
    docType: "GRN",
  },
  {
    id: "EB",
    label: "Expense Bookings",
    icon: Receipt,
    color: "text-purple-500",
    chip: "bg-purple-500/10 border-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500/15",
    gradient: "from-purple-500 via-fuchsia-400 to-pink-500",
    docType: "ExpenseBooking",
  },
  {
    id: "PAYMENT",
    label: "Payments",
    icon: Receipt,
    color: "text-rose-500",
    chip: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15",
    gradient: "from-rose-500 via-pink-400 to-red-500",
    docType: "Payment",
  },
  {
    id: "RECEIVED_PAYMENT",
    label: "Received Payments",
    icon: Receipt,
    color: "text-green-500",
    chip: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/15",
    gradient: "from-green-500 via-lime-400 to-emerald-500",
    docType: "ReceivedPayment",
  },
  {
    id: "FUND_TRANSFER",
    label: "Fund Transfers",
    icon: ArrowLeftRight,
    color: "text-indigo-500",
    chip: "bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/15",
    gradient: "from-indigo-500 via-violet-400 to-purple-500",
    docType: "FundTransfer",
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
  amendmentCount,
  pendingCount,
  approvedCount,
  rejectedCount,
}: {
  amendmentCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
      {[
        {
          label: "Total Amendments",
          value: amendmentCount,
          icon: FilePenLine,
          cls: "text-foreground",
          bg: "bg-muted",
        },
        {
          label: "Pending Review",
          value: pendingCount,
          icon: Clock,
          cls: "text-amber-600 dark:text-amber-400",
          bg: "bg-amber-500/10",
        },
        {
          label: "Approved",
          value: approvedCount,
          icon: CheckCircle2,
          cls: "text-emerald-600 dark:text-emerald-400",
          bg: "bg-emerald-500/10",
        },
        {
          label: "Rejected",
          value: rejectedCount,
          icon: XCircle,
          cls: "text-rose-600 dark:text-rose-400",
          bg: "bg-rose-500/10",
        },
      ].map(({ label, value, icon: Icon, cls, bg }) => (
        <div
          key={label}
          className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-center gap-2.5"
        >
          <div className={`shrink-0 rounded-md p-1.5 ${bg} ${cls}`}>
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-foreground leading-none tabular-nums">
              {value}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Amendment Form Dialog ────────────────────────────────────────────────────

interface FieldChangeRow {
  _key: string;
  FieldName: string;
  OldValue: string;
  NewValue: string;
  /** True for rows loaded from an already-saved amendment (read-only
   *  history) — the line-changes endpoint is append-only, so re-submitting
   *  these on every save would create duplicates. Only non-existing rows
   *  are POSTed. */
  isExisting?: boolean;
}

function blankFieldChange(): FieldChangeRow {
  return { _key: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, FieldName: "", OldValue: "", NewValue: "" };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  PurchaseOrder: "Purchase Order",
  GRN: "GRN",
  ExpenseBooking: "Expense Booking",
  Payment: "Payment",
  ReceivedPayment: "Received Payment",
  FundTransfer: "Fund Transfer",
  WorkOrder: "Work Order",
  BOQ: "BOQ",
  WorkDone: "Work Done",
};

// Common field suggestions per doc type — a starting point the user can
// still freely retype, not a hard constraint (FieldName is a plain text
// input either way).
const FIELD_SUGGESTIONS: Record<string, string[]> = {
  PurchaseOrder: ["Item Quantity", "Item Rate", "Delivery Date", "Payment Terms", "GST Rate"],
  GRN: ["Received Quantity", "Item Rate", "GRN Date"],
  ExpenseBooking: ["Basic Amount", "GST Rate", "Vendor Invoice Date", "Payment Term"],
  Payment: ["Amount", "Payment Date", "Mode", "Bank Account"],
  ReceivedPayment: ["Amount", "Received Date", "Mode", "Deposit Bank"],
  FundTransfer: ["Amount", "Transfer Date", "Source Bank", "Destination Bank"],
  WorkOrder: ["Activity Rate", "Activity Quantity", "Contract Value"],
  BOQ: ["Item Quantity", "Item Rate"],
  WorkDone: ["Quantity Done", "Rate Per Unit", "Certified Amount"],
};

interface AmendFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Amendment | null;
  initialForm: FormState;
  onSave: (payload: AmendmentPayload, fieldChanges: AmendmentLineChangeInput[]) => void;
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
  const [fieldChanges, setFieldChanges] = useState<FieldChangeRow[]>([]);

  const existingLineChangesQuery = useQuery({
    queryKey: ["amendment-line-changes", editing?.Id],
    queryFn: () => getAmendmentLineChanges(editing!.Id),
    enabled: open && !!editing,
  });

  React.useEffect(() => {
    setForm(initialForm);
    if (!editing) {
      setFieldChanges([]);
    }
  }, [initialForm, open, editing]);

  React.useEffect(() => {
    if (editing && existingLineChangesQuery.data) {
      setFieldChanges(
        existingLineChangesQuery.data.map((lc) => ({
          _key: `fc-${lc.Id}`,
          FieldName: lc.FieldLabel || lc.FieldName,
          OldValue: lc.OldValue ?? "",
          NewValue: lc.NewValue ?? "",
          isExisting: true,
        })),
      );
    }
  }, [editing, existingLineChangesQuery.data]);

  const set = (field: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const addFieldChange = () => setFieldChanges((rows) => [...rows, blankFieldChange()]);
  const removeFieldChange = (key: string) =>
    setFieldChanges((rows) => rows.filter((r) => r._key !== key));
  const patchFieldChange = (key: string, delta: Partial<FieldChangeRow>) =>
    setFieldChanges((rows) => rows.map((r) => (r._key === key ? { ...r, ...delta } : r)));

  const diff = useMemo(() => {
    const o = Number(form.OriginalValue);
    const r = Number(form.RevisedValue);
    if (!form.OriginalValue.trim() || !form.RevisedValue.trim()) return null;
    if (Number.isNaN(o) || Number.isNaN(r)) return null;
    return r - o;
  }, [form.OriginalValue, form.RevisedValue]);

  const accent = MODULE_ACCENT[form.RefDocType] ?? DEFAULT_ACCENT;
  const suggestions = FIELD_SUGGESTIONS[form.RefDocType] ?? [];

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
    // Only newly-added rows get POSTed — existing ones are already saved
    // (the line-changes endpoint is append-only, see isExisting above).
    const validFieldChanges = fieldChanges
      .filter((r) => !r.isExisting && r.FieldName.trim())
      .map((r) => ({
        FieldName: r.FieldName.trim(),
        FieldLabel: r.FieldName.trim(),
        OldValue: r.OldValue,
        NewValue: r.NewValue,
      }));
    onSave(toPayload(form), validFieldChanges);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isSaving) onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl p-0 gap-0">
        {/* Header — module-accent banner so the dialog visually matches
            whichever shell (Material/Finance/Engineering) the document
            being amended belongs to, instead of always being emerald. */}
        <div
          className="px-6 py-5 border-b border-border relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${accent.glow} 0%, transparent 70%)`,
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${accent.iconBg} ${accent.text} shrink-0`}>
                <FilePenLine size={17} />
              </span>
              <span>{editing ? "Edit Amendment" : "New Amendment"}</span>
              {form.RefDocType && (
                <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gradient-to-r ${accent.gradient} text-white`}>
                  {DOC_TYPE_LABELS[form.RefDocType] ?? form.RefDocType}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="mt-1">
              Capture every field that changed and the business reason for
              this amendment — full audit trail, nothing amended silently.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* ── Section: Document ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70 border-b border-border/60 pb-1.5">
              Document
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Document Type</Label>
                <Input
                  value={DOC_TYPE_LABELS[form.RefDocType] ?? form.RefDocType ?? "—"}
                  readOnly
                  className="bg-muted/40 cursor-default"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Document No.</Label>
                <Input
                  value={form.RefDocNo}
                  readOnly
                  className="bg-muted/40 cursor-default font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amendment Date</Label>
                <Input
                  type="date"
                  value={form.AmendmentDate}
                  onChange={(e) => set("AmendmentDate", e.target.value)}
                />
              </div>
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
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Company / Vendor</Label>
                <Input
                  value={form.CompanyName}
                  onChange={(e) => set("CompanyName", e.target.value)}
                  placeholder="Company or vendor"
                />
              </div>
            </div>
          </div>

          {/* ── Section: Headline Value Change ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70 border-b border-border/60 pb-1.5">
              Headline Value Change
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            {diff !== null && (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm flex items-center gap-2">
                <ArrowLeftRight size={14} className="text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Value difference: </span>
                <span
                  className={`font-semibold ${diff >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
                >
                  {diff >= 0 ? "+" : ""}
                  {formatMoney(diff)}
                </span>
              </div>
            )}
          </div>

          {/* ── Section: Field-Level Changes — amend ANY field (item qty,
              rate, dates, etc.), not just the single headline value above.
              Stored per-field in dbo.AmendmentLineChanges (migration 100),
              already built for exactly this. ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
              <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70">
                Field-Level Changes
              </p>
              {suggestions.length > 0 && (
                <p className="text-[10px] text-muted-foreground/50">
                  e.g. {suggestions.slice(0, 3).join(", ")}
                </p>
              )}
            </div>

            {fieldChanges.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-5 rounded-xl border border-dashed border-border/50 text-center">
                <ArrowLeftRight size={18} className="text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  No individual fields tagged yet — optional, on top of the
                  headline value above.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {fieldChanges.map((row, i) => (
                  <div
                    key={row._key}
                    className={`grid grid-cols-1 sm:grid-cols-[28px_1fr_1fr_1fr_28px] gap-2 items-center p-2 rounded-xl border ${
                      row.isExisting
                        ? "border-border/40 bg-muted/10"
                        : "border-border/60 bg-muted/20"
                    }`}
                  >
                    <span className="hidden sm:flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold font-mono">
                      {i + 1}
                    </span>
                    <Input
                      value={row.FieldName}
                      onChange={(e) => patchFieldChange(row._key, { FieldName: e.target.value })}
                      placeholder="Field (e.g. Item Rate)"
                      className="h-8 text-xs"
                      list="amend-field-suggestions"
                      readOnly={row.isExisting}
                    />
                    <Input
                      value={row.OldValue}
                      onChange={(e) => patchFieldChange(row._key, { OldValue: e.target.value })}
                      placeholder="Original value"
                      className="h-8 text-xs"
                      readOnly={row.isExisting}
                    />
                    <Input
                      value={row.NewValue}
                      onChange={(e) => patchFieldChange(row._key, { NewValue: e.target.value })}
                      placeholder="Revised value"
                      className="h-8 text-xs"
                      readOnly={row.isExisting}
                    />
                    {row.isExisting ? (
                      <span className="h-8 w-8 flex items-center justify-center text-muted-foreground/40" title="Already saved">
                        <CheckCircle2 size={13} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeFieldChange(row._key)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <datalist id="amend-field-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addFieldChange}
              className={`h-7 px-2.5 text-xs gap-1.5 ${accent.text}`}
            >
              <FilePenLine size={12} />
              Add Field Change
            </Button>
          </div>

          {/* ── Section: Justification ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/70 border-b border-border/60 pb-1.5">
              Justification
            </p>
            <div className="space-y-4">
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
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
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
          <Button
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className={`bg-gradient-to-r ${accent.gradient} text-white hover:opacity-90`}
          >
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
            <FilePenLine size={16} className="text-emerald-600 dark:text-emerald-400" />
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
  canEdit,
  canDelete,
}: {
  docType: string;
  docNo: string;
  docId: number | string;
  canApprove: boolean;
  onEdit: (a: Amendment) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  canEdit?: boolean;
  canDelete?: boolean;
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
                      className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline font-mono"
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
                          {canEdit !== false && (
                            <button
                              type="button"
                              onClick={() => onEdit(a)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => submitMutation.mutate(a.Id)}
                            disabled={submitMutation.isPending}
                            className="p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 transition"
                            title="Submit for approval"
                          >
                            <Send size={13} />
                          </button>
                          {canDelete !== false && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(a)}
                              className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
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

function normalisePaymentRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.PPaymentID ?? r.id,
    docNo: r.DocNo ?? `#${r.PPaymentID}`,
    date: r.PDate ?? r.CreatedAt ?? "",
    party: r.PPayeeName ?? r.PPaidTo ?? "—",
    project: r.PProject ?? r.ProjectName ?? "—",
    company: r.PCompany ?? r.CompanyName ?? "—",
    amount: r.PAmount ?? null,
    status: r.PStatus ?? r.Status ?? "—",
  }));
}

function normaliseReceivedPaymentRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.RPPaymentID,
    docNo: r.RPDocNo ?? `#${r.RPPaymentID}`,
    date: r.RPDocDate ?? "",
    party: r.RPReceivedFrom ?? "—",
    project: r.RPProjectName ?? "—",
    company: r.RPCompanyName ?? "—",
    amount: r.RPAmount ?? null,
    status: r.RPStatus ?? "—",
  }));
}

function normaliseFundTransferRows(data: any[]): DocRow[] {
  return data.map((r) => ({
    id: r.FTId,
    docNo: r.DocNo ?? `#${r.FTId}`,
    date: r.TransferDate ?? "",
    party: r.DestinationCompanyName ?? "—",
    project: "—",
    company: r.SourceCompanyName ?? "—",
    amount: r.Amount ?? null,
    status: r.Status ?? "—",
  }));
}

function DocTable({
  tab,
  search,
  page,
  onPageChange,
  onAmend,
  onEditAmendment,
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
  onEditAmendment: (a: Amendment) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  canApprove: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
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
      ).then((r) => r.json().catch(() => ({}))),
    enabled: tab === "EB",
  });

  const paymentQuery = useQuery({
    queryKey: ["amend-payment-list", page],
    queryFn: () => getPayments(page, PAGE_SIZE),
    enabled: tab === "PAYMENT",
  });

  const receivedPaymentQuery = useQuery({
    queryKey: ["amend-received-payment-list", page],
    queryFn: () => getReceivedPayments(page, PAGE_SIZE),
    enabled: tab === "RECEIVED_PAYMENT",
  });

  const fundTransferQuery = useQuery({
    queryKey: ["amend-fund-transfer-list", page],
    queryFn: () => getFundTransfers({}),
    enabled: tab === "FUND_TRANSFER",
  });

  const isLoading =
    (tab === "PO" && poQuery.isLoading) ||
    (tab === "GRN" && grnQuery.isLoading) ||
    (tab === "EB" && ebQuery.isLoading) ||
    (tab === "PAYMENT" && paymentQuery.isLoading) ||
    (tab === "RECEIVED_PAYMENT" && receivedPaymentQuery.isLoading) ||
    (tab === "FUND_TRANSFER" && fundTransferQuery.isLoading);

  const isError =
    (tab === "PO" && poQuery.isError) ||
    (tab === "GRN" && grnQuery.isError) ||
    (tab === "EB" && ebQuery.isError) ||
    (tab === "PAYMENT" && paymentQuery.isError) ||
    (tab === "RECEIVED_PAYMENT" && receivedPaymentQuery.isError) ||
    (tab === "FUND_TRANSFER" && fundTransferQuery.isError);

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
    if (tab === "PAYMENT") {
      const data = Array.isArray(paymentQuery.data?.data)
        ? paymentQuery.data.data
        : Array.isArray(paymentQuery.data)
          ? paymentQuery.data
          : [];
      return normalisePaymentRows(data);
    }
    if (tab === "RECEIVED_PAYMENT") {
      return normaliseReceivedPaymentRows(receivedPaymentQuery.data?.data ?? []);
    }
    if (tab === "FUND_TRANSFER") {
      // getFundTransfers has no server-side pagination — page client-side.
      const all = fundTransferQuery.data ?? [];
      const start = (page - 1) * PAGE_SIZE;
      return normaliseFundTransferRows(all.slice(start, start + PAGE_SIZE));
    }
    return [];
  }, [
    tab,
    page,
    poQuery.data,
    grnQuery.data,
    ebQuery.data,
    paymentQuery.data,
    receivedPaymentQuery.data,
    fundTransferQuery.data,
  ]);

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
        : tab === "EB"
          ? ((ebQuery.data as any)?.totalPages ?? 1)
          : tab === "PAYMENT"
            ? ((paymentQuery.data as any)?.totalPages ?? 1)
            : tab === "RECEIVED_PAYMENT"
              ? (receivedPaymentQuery.data?.totalPages ?? 1)
              : Math.max(1, Math.ceil((fundTransferQuery.data?.length ?? 0) / PAGE_SIZE));

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
            <TableHead className="hidden sm:table-cell">Party / Vendor</TableHead>
            <TableHead className="hidden sm:table-cell">Project</TableHead>
            <TableHead className="hidden md:table-cell">Amount</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
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
                    <div className="text-[10px] text-muted-foreground sm:hidden mt-0.5">
                      {row.party}{row.project && row.project !== "—" ? ` · ${row.project}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="text-sm font-medium">{row.party}</div>
                    {row.company && row.company !== "—" && (
                      <div className="text-xs text-muted-foreground">
                        {row.company}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">{row.project}</TableCell>
                  <TableCell className="text-sm font-medium hidden md:table-cell">
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        STATUS_STYLES[row.status] ??
                        "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => toggleExpand(row.id)}
                      >
                        <History size={12} />
                        <span className="hidden sm:inline">{expandedId === row.id ? "Hide" : "History"}</span>
                      </Button>
                      {canCreate !== false && (
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => onAmend(row)}
                        >
                          <FilePenLine size={12} />
                          <span className="hidden sm:inline">Amend</span>
                        </Button>
                      )}
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
                        onEdit={onEditAmendment}
                        queryClient={queryClient}
                        canEdit={canEdit}
                        canDelete={canDelete}
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
  const rights = usePageRights("amendments");

  const prefill =
    (location.state as { prefill?: PrefillState } | null)?.prefill ?? null;

  const [activeTab, setActiveTab] = useState<DocTab>(() => {
    if (prefill?.tab && prefill.tab in DOC_TYPE_MAP)
      return prefill.tab as DocTab;
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
    // Clear state so revisiting the page doesn't re-open the form
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats — amendment counts by status, tab-agnostic (scales to all 9 doc
  // types instead of hardcoding PO/GRN/EB, which is what the old per-doc-type
  // counts did — those went stale the moment Finance tabs were added).
  const amendTotalQuery = useQuery({
    queryKey: ["amendments-count", "total"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1 }),
  });
  const amendPendingQuery = useQuery({
    queryKey: ["amendments-count", "Pending"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1, status: "Pending" }),
  });
  const amendApprovedQuery = useQuery({
    queryKey: ["amendments-count", "Approved"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1, status: "Approved" }),
  });
  const amendRejectedQuery = useQuery({
    queryKey: ["amendments-count", "Rejected"],
    queryFn: () => getAmendments({ page: 1, pageSize: 1, status: "Rejected" }),
  });

  const stats = useMemo(
    () => ({
      amendmentCount: amendTotalQuery.data?.pagination?.total ?? 0,
      pendingCount: amendPendingQuery.data?.pagination?.total ?? 0,
      approvedCount: amendApprovedQuery.data?.pagination?.total ?? 0,
      rejectedCount: amendRejectedQuery.data?.pagination?.total ?? 0,
    }),
    [
      amendTotalQuery.data,
      amendPendingQuery.data,
      amendApprovedQuery.data,
      amendRejectedQuery.data,
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
    mutationFn: async ({
      payload,
      fieldChanges,
    }: {
      payload: AmendmentPayload;
      fieldChanges: AmendmentLineChangeInput[];
    }) => {
      const created = await createAmendment(payload);
      if (fieldChanges.length > 0) {
        await addAmendmentLineChanges(created.Id, fieldChanges);
      }
      return created;
    },
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
    mutationFn: async ({
      id,
      payload,
      fieldChanges,
    }: {
      id: number;
      payload: AmendmentPayload;
      fieldChanges: AmendmentLineChangeInput[];
    }) => {
      await updateAmendment(id, payload);
      // Line changes can only be POSTed for Draft amendments (server-side
      // rule) — re-adding the same rows on every save is harmless since
      // it's an append-only audit log; the dialog only shows this section
      // for amendments the user can still edit anyway.
      if (fieldChanges.length > 0) {
        await addAmendmentLineChanges(id, fieldChanges);
      }
    },
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


  const handleSave = (payload: AmendmentPayload, fieldChanges: AmendmentLineChangeInput[]) => {
    if (editing) {
      updateMutation.mutate({ id: editing.Id, payload, fieldChanges });
    } else {
      createMutation.mutate({ payload, fieldChanges });
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

      <MaterialShell
        title="Amendment Centre"
        subtitle="Select a Purchase Order, GRN, or Expense Booking to raise or review amendments — full audit trail"
        icon={FilePenLine}
      >

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <StatsRow
        amendmentCount={stats.amendmentCount}
        pendingCount={stats.pendingCount}
        approvedCount={stats.approvedCount}
        rejectedCount={stats.rejectedCount}
      />

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {TAB_CONFIG.map(({ id, label, icon: Icon, chip, gradient }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              activeTab === id
                ? `bg-gradient-to-r ${gradient} text-white shadow-sm shadow-black/10 border-transparent`
                : chip
            }`}
          >
            <Icon size={12} className={activeTab === id ? "text-white" : ""} />
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
            queryClient.invalidateQueries({
              queryKey: ["amendments-count"],
            });
          }}
          className="shrink-0 h-8 px-2.5 text-xs"
        >
          <RefreshCw size={12} className="mr-1.5" />
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
        onEditAmendment={(a) => {
          setInitialForm({
            RefDocType: a.RefDocType ?? "",
            RefDocId: a.RefDocId != null ? String(a.RefDocId) : "",
            RefDocNo: a.RefDocNo ?? "",
            ProjectName: a.ProjectName ?? "",
            CompanyName: a.CompanyName ?? "",
            Description: a.Description ?? "",
            Reason: a.Reason ?? "",
            AmendmentDate: a.AmendmentDate ?? today(),
            OriginalValue: a.OriginalValue != null ? String(a.OriginalValue) : "",
            RevisedValue: a.RevisedValue != null ? String(a.RevisedValue) : "",
          });
          setEditing(a);
          setFormOpen(true);
        }}
        queryClient={queryClient}
        canApprove={canApprove}
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
      />

      </MaterialShell>

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