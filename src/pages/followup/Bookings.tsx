import React, { useState, useEffect, useRef, useMemo } from "react";
import { AuditLogDrawer } from "@/components/AuditLogDrawer";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Plus,
  Search,
  X,
  RefreshCw,
  Phone,
  Mail,
  Building2,
  Home,
  Calendar,
  IndianRupee,
  ChevronRight,
  Edit2,
  Hash,
  Clock,
  User,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  MapPin,
  ChevronLeft,
  CreditCard,
  Users,
  ChevronDown,
  CalendarDays,
  Save,
  Banknote,
  Layers,
  ArrowUpRight,
  Percent,
  Minus,
  ReceiptText,
  Tag,
  Info,
  Check,
} from "lucide-react";
import { useLookup } from "@/hooks/useLookup";
import { usePageRights } from "@/hooks/usePageRights";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PaymentTerm {
  TermID: number;
  TermName: string;
  ValueType: "percent" | "fixed" | "deduction";
  TermValue: number;
  IsActive: boolean;
}

interface SelectedTerm extends PaymentTerm {
  computedAmount: number; // resolved ₹ amount for this booking
  docRef: string; // e.g. PMT-BKG000042-001
}

interface Booking {
  Id: number;
  BookingNo: string | null;
  ApplicantId: number;
  ApplicantName: string;
  PrimaryMobile: string | null;
  Email: string | null;
  UnitSelectionId: number | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  UnitNo: string;
  BlockName: string | null;
  FloorName: string | null;
  UnitType: string | null;
  AreaSqFt: number | null;
  RatePerSqFt: number | null;
  TotalValue: number | null;
  BookingAmount: number;
  BookingDate: string;
  PaymentMode: string | null;
  ChequeNo: string | null;
  BankName: string | null;
  LoanApproved: boolean;
  LoanBank: string | null;
  LoanAmount: number | null;
  AssignedTo: number | null;
  AssignedToName: string | null;
  Status: string;
  Notes: string | null;
  CreatedBy: string | null;
  CreatedAt: string | null;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

interface Applicant {
  Id: number;
  Name: string;
  Phone: string | null;
  Email: string | null;
}
interface Project {
  Id: number;
  Name: string;
}

const API = "/api/followup-bookings";
const TERMS_API = "/api/payment-plan-master";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { dot: string; pill: string }> = {
  Confirmed: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25",
  },
  Pending: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25",
  },
  Cancelled: {
    dot: "bg-red-500",
    pill: "bg-red-500/12 text-red-700 dark:text-red-300 ring-1 ring-red-500/25",
  },
};

const TYPE_CONFIG: Record<
  PaymentTerm["ValueType"],
  { label: string; icon: React.ReactNode; color: string; pill: string }
> = {
  percent: {
    label: "Percent",
    icon: <Percent size={10} />,
    color: "text-blue-600 dark:text-blue-400",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20",
  },
  fixed: {
    label: "Fixed",
    icon: <IndianRupee size={10} />,
    color: "text-violet-600 dark:text-violet-400",
    pill: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20",
  },
  deduction: {
    label: "Deduction",
    icon: <Minus size={10} />,
    color: "text-red-600 dark:text-red-400",
    pill: "bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-red-500/20",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_PALETTES = [
  {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
  },
  {
    bg: "bg-violet-100 dark:bg-violet-900/40",
    text: "text-violet-700 dark:text-violet-300",
  },
  {
    bg: "bg-cyan-100 dark:bg-cyan-900/40",
    text: "text-cyan-700 dark:text-cyan-300",
  },
  {
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  {
    bg: "bg-rose-100 dark:bg-rose-900/40",
    text: "text-rose-700 dark:text-rose-300",
  },
  {
    bg: "bg-pink-100 dark:bg-pink-900/40",
    text: "text-pink-700 dark:text-pink-300",
  },
  {
    bg: "bg-indigo-100 dark:bg-indigo-900/40",
    text: "text-indigo-700 dark:text-indigo-300",
  },
];

function avatarPalette(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length];
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtCurrency(v: number | null | undefined) {
  if (v == null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtCurrencyCompact(v: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

/** Resolve a term's ₹ amount given the booking total value */
function resolveTermAmount(term: PaymentTerm, totalValue: number): number {
  if (term.ValueType === "percent")
    return Math.round((term.TermValue / 100) * totalValue);
  if (term.ValueType === "fixed") return Math.round(term.TermValue);
  if (term.ValueType === "deduction")
    return -Math.round((term.TermValue / 100) * totalValue);
  return 0;
}

/** Generate a doc reference: PMT-{BookingNo}-{seqIndex} */
function makeDocRef(bookingNo: string | null, index: number): string {
  const base = bookingNo ?? `BKG${String(Date.now()).slice(-6)}`;
  return `PMT-${base}-${String(index + 1).padStart(3, "0")}`;
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    dot: "bg-muted-foreground",
    pill: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${cfg.pill}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0`} />
      {status}
    </span>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const palette = avatarPalette(name);
  const sizes = {
    sm: "w-7 h-7 text-[10px]",
    md: "w-9 h-9 text-[11px]",
    lg: "w-12 h-12 text-[14px]",
  };
  return (
    <div
      className={`${sizes[size]} rounded-xl flex items-center justify-center font-bold flex-shrink-0 ${palette.bg} ${palette.text}`}
    >
      {initials(name)}
    </div>
  );
}

// ── Combobox ──────────────────────────────────────────────────────────────────
function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder = "Select...",
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; sub?: string }[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q.toLowerCase()),
  );
  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setQ("");
        }}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all
          ${disabled ? "opacity-50 cursor-not-allowed bg-muted" : "bg-background hover:border-primary/50 cursor-pointer"}
          ${open ? "border-primary ring-2 ring-primary/10" : "border-border"}
          ${!selected ? "text-muted-foreground" : "text-foreground"}`}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1.5 w-full bg-popover border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm bg-muted rounded-lg outline-none"
              placeholder="Search..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              {placeholder}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                No results
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ("");
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors ${value === o.value ? "bg-primary/8 text-primary font-medium" : "text-foreground"}`}
                >
                  {o.label}
                  {o.sub && (
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {o.sub}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payment Term Selector ─────────────────────────────────────────────────────
function PaymentTermSelector({
  terms,
  selectedIds,
  totalValue,
  bookingNo,
  onChange,
}: {
  terms: PaymentTerm[];
  selectedIds: number[];
  totalValue: number;
  bookingNo: string | null;
  onChange: (ids: number[]) => void;
}) {
  const activeTerms = terms.filter((t) => t.IsActive);

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  const selectedTerms: SelectedTerm[] = useMemo(() => {
    return selectedIds
      .map((id, idx) => {
        const t = terms.find((x) => x.TermID === id);
        if (!t) return null;
        return {
          ...t,
          computedAmount: resolveTermAmount(t, totalValue),
          docRef: makeDocRef(bookingNo, idx),
        };
      })
      .filter(Boolean) as SelectedTerm[];
  }, [selectedIds, terms, totalValue, bookingNo]);

  const totalCharged = selectedTerms
    .filter((t) => t.ValueType !== "deduction")
    .reduce((s, t) => s + t.computedAmount, 0);
  const totalDeducted = selectedTerms
    .filter((t) => t.ValueType === "deduction")
    .reduce((s, t) => s + Math.abs(t.computedAmount), 0);
  const netPayable = totalValue - totalDeducted;
  const balance = totalValue - totalCharged + totalDeducted;

  return (
    <div className="space-y-4">
      {/* Term picker */}
      <div className="space-y-2">
        {activeTerms.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4 bg-muted/30 rounded-xl border border-dashed border-border">
            No active payment terms — add them in Payment Plan Master
          </p>
        ) : (
          <div className="grid gap-1.5">
            {activeTerms.map((term) => {
              const isSelected = selectedIds.includes(term.TermID);
              const tc = TYPE_CONFIG[term.ValueType];
              const amount = resolveTermAmount(term, totalValue);
              return (
                <button
                  key={term.TermID}
                  type="button"
                  onClick={() => toggle(term.TermID)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all group
                    ${
                      isSelected
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/15"
                        : "border-border bg-background hover:border-border/80 hover:bg-muted/30"
                    }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all
                      ${isSelected ? "border-primary bg-primary" : "border-border group-hover:border-primary/40"}`}
                    >
                      {isSelected && (
                        <Check
                          size={10}
                          className="text-primary-foreground"
                          strokeWidth={3}
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-foreground truncate">
                        {term.TermName}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${tc.pill}`}
                      >
                        {tc.icon}
                        {term.ValueType === "percent" ||
                        term.ValueType === "deduction"
                          ? `${term.TermValue}%`
                          : fmtCurrencyCompact(term.TermValue)}
                        {term.ValueType === "deduction" && " off"}
                      </span>
                    </div>
                  </div>
                  {totalValue > 0 && (
                    <p
                      className={`text-[12px] font-bold flex-shrink-0 ml-3 ${term.ValueType === "deduction" ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                    >
                      {term.ValueType === "deduction" ? "−" : ""}
                      {fmtCurrencyCompact(Math.abs(amount))}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Breakdown panel — only show when terms selected and totalValue known */}
      {selectedTerms.length > 0 && totalValue > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
            <ReceiptText size={12} className="text-muted-foreground" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Payment Breakdown
            </p>
          </div>

          {/* Line items */}
          <div className="px-4 divide-y divide-border/50">
            {/* Base */}
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[11px] text-muted-foreground">
                Total Property Value
              </span>
              <span className="text-[12px] font-semibold text-foreground">
                {fmtCurrencyCompact(totalValue)}
              </span>
            </div>

            {/* Each selected term */}
            {selectedTerms.map((t) => (
              <div key={t.TermID} className="py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {t.TermName}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <code className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground border border-border/60">
                        {t.docRef}
                      </code>
                      <span
                        className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded ${TYPE_CONFIG[t.ValueType].pill}`}
                      >
                        {TYPE_CONFIG[t.ValueType].icon}
                        {t.ValueType === "percent" ||
                        t.ValueType === "deduction"
                          ? `${t.TermValue}%`
                          : fmtCurrencyCompact(t.TermValue)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[12px] font-bold flex-shrink-0 text-foreground">
                    −{fmtCurrencyCompact(Math.abs(t.computedAmount))}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary footer */}
          <div className="border-t border-border bg-muted/40 px-4 py-3 space-y-2">
            {totalDeducted > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  After Deductions
                </span>
                <span className="text-[12px] font-semibold text-foreground">
                  {fmtCurrencyCompact(netPayable)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Total Charged (this schedule)
              </span>
              <span className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400">
                {fmtCurrencyCompact(totalCharged)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <span className="text-[11px] font-bold text-foreground">
                Balance Remaining
              </span>
              <span
                className={`text-[14px] font-extrabold ${balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
              >
                {fmtCurrencyCompact(Math.max(0, balance))}
              </span>
            </div>
          </div>
        </div>
      )}

      {selectedTerms.length > 0 && totalValue === 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px]">
          <Info size={12} className="flex-shrink-0" />
          Enter Total Value above to see ₹ breakdown
        </div>
      )}
    </div>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function FormSection({
  icon,
  label,
  color,
  children,
  fullWidth,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/60">
        <div className={`p-1.5 rounded-lg ${color}`}>{icon}</div>
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
          {label}
        </p>
      </div>
      <div
        className={`grid ${fullWidth ? "grid-cols-1" : "grid-cols-2"} gap-3`}
      >
        {children}
      </div>
    </div>
  );
}

// ── Booking Form ──────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  applicantId: "",
  unitNo: "",
  blockName: "",
  floorName: "",
  unitType: "",
  areaSqFt: "",
  ratePerSqFt: "",
  totalValue: "",
  bookingAmount: "",
  bookingDate: "",
  paymentMode: "",
  chequeNo: "",
  bankName: "",
  loanApproved: false,
  loanBank: "",
  loanAmount: "",
  projectId: "",
  status: "Confirmed",
  notes: "",
};
type FormData = typeof EMPTY_FORM;

function BookingForm({
  initial,
  onSave,
  onCancel,
  applicants,
  projects,
  statusOptions,
  paymentModes,
  unitTypes,
  editBookingNo,
  editBookingId,
}: {
  initial?: Partial<FormData>;
  onSave: (data: FormData, selectedTermIds: number[]) => Promise<void>;
  onCancel: () => void;
  applicants: Applicant[];
  projects: Project[];
  statusOptions: string[];
  paymentModes: string[];
  unitTypes: string[];
  editBookingNo?: string | null;
  editBookingId?: number | null;
}) {
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [selectedTermIds, setSelectedTermIds] = useState<number[]>([]);

  // When editing an existing booking, pre-load its saved payment term IDs
  const { data: existingTerms } = useQuery({
    queryKey: ["booking-payment-terms", editBookingId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${editBookingId}/payment-terms`);
      if (!res.ok) return [];
      return res.json().catch(() => ({})) as Promise<{ TermID: number }[]>;
    },
    enabled: !!editBookingId,
    staleTime: 0,
  });

  useEffect(() => {
    if (existingTerms && existingTerms.length > 0) {
      setSelectedTermIds(existingTerms.map((t) => t.TermID));
    }
  }, [existingTerms]);

  const set = (k: keyof FormData) => (v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Auto-compute total value
  useEffect(() => {
    const area = parseFloat(form.areaSqFt);
    const rate = parseFloat(form.ratePerSqFt);
    if (area > 0 && rate > 0)
      set("totalValue")(String(Math.round(area * rate)));
  }, [form.areaSqFt, form.ratePerSqFt]);

  // Fetch payment terms
  const { data: paymentTerms = [] } = useQuery<PaymentTerm[]>({
    queryKey: ["payment-terms"],
    queryFn: async () => {
      const res = await fetchWithAuth(TERMS_API);
      if (!res.ok) throw new Error("Failed to load payment terms");
      return res.json().catch(() => ({}));
    },
    staleTime: 300_000,
  });

  const totalValue = parseFloat(form.totalValue) || 0;

  const applicantOpts = applicants.map((a) => ({
    value: String(a.Id),
    label: a.Name,
    sub: [a.Phone, a.Email].filter(Boolean).join(" · "),
  }));
  const projectOpts = projects.map((p) => ({
    value: String(p.Id),
    label: p.Name,
  }));

  const handleSave = async () => {
    if (!form.applicantId) {
      toast.error("Applicant is required");
      return;
    }
    if (!form.unitNo.trim()) {
      toast.error("Unit No is required");
      return;
    }
    if (!form.bookingDate) {
      toast.error("Booking date is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(form, selectedTermIds);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-7">
        {/* Applicant */}
        <FormSection
          icon={<User size={12} className="text-blue-600 dark:text-blue-400" />}
          label="Applicant"
          color="bg-blue-50 dark:bg-blue-900/30"
        >
          <div className="col-span-2">
            <Combobox
              label="Applicant"
              required
              value={form.applicantId}
              onChange={set("applicantId")}
              options={applicantOpts}
              placeholder="Select applicant..."
            />
          </div>
          <FormField label="Booking Date" required>
            <div className="relative">
              <CalendarDays
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="date"
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                value={form.bookingDate}
                onChange={(e) => set("bookingDate")(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Status">
            <div className="relative">
              <select
                className="w-full appearance-none px-3 py-2.5 pr-9 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
                value={form.status}
                onChange={(e) => set("status")(e.target.value)}
              >
                {statusOptions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </FormField>
        </FormSection>

        {/* Property */}
        <FormSection
          icon={
            <Building2
              size={12}
              className="text-violet-600 dark:text-violet-400"
            />
          }
          label="Property"
          color="bg-violet-50 dark:bg-violet-900/30"
        >
          <div className="col-span-2">
            <Combobox
              label="Project"
              value={form.projectId}
              onChange={set("projectId")}
              options={projectOpts}
              placeholder="Select project..."
            />
          </div>
          <FormField label="Unit No" required>
            <input
              className={inputCls}
              placeholder="e.g. A-401"
              value={form.unitNo}
              onChange={(e) => set("unitNo")(e.target.value)}
            />
          </FormField>
          <FormField label="Unit Type">
            <div className="relative">
              <select
                className="w-full appearance-none px-3 py-2.5 pr-9 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
                value={form.unitType}
                onChange={(e) => set("unitType")(e.target.value)}
              >
                <option value="">Select type...</option>
                {unitTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </FormField>
          <FormField label="Block">
            <input
              className={inputCls}
              placeholder="e.g. A"
              value={form.blockName}
              onChange={(e) => set("blockName")(e.target.value)}
            />
          </FormField>
          <FormField label="Floor">
            <input
              className={inputCls}
              placeholder="e.g. 4th"
              value={form.floorName}
              onChange={(e) => set("floorName")(e.target.value)}
            />
          </FormField>
          <FormField label="Area (sq.ft)">
            <input
              type="number"
              className={inputCls}
              placeholder="0"
              value={form.areaSqFt}
              onChange={(e) => set("areaSqFt")(e.target.value)}
            />
          </FormField>
          <FormField label="Rate / sq.ft (₹)">
            <input
              type="number"
              className={inputCls}
              placeholder="0"
              value={form.ratePerSqFt}
              onChange={(e) => set("ratePerSqFt")(e.target.value)}
            />
          </FormField>
          <div className="col-span-2">
            <FormField label="Total Value (₹)">
              <div className="relative">
                <input
                  type="number"
                  className={`${inputCls} bg-muted/40 font-medium`}
                  placeholder="Auto-computed from area × rate"
                  value={form.totalValue}
                  onChange={(e) => set("totalValue")(e.target.value)}
                />
                {form.areaSqFt && form.ratePerSqFt && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    auto
                  </span>
                )}
              </div>
            </FormField>
          </div>
        </FormSection>

        {/* Payment Terms */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-border/60">
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
              <Tag
                size={12}
                className="text-emerald-600 dark:text-emerald-400"
              />
            </div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Payment Schedule
            </p>
            {selectedTermIds.length > 0 && (
              <span className="ml-auto text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {selectedTermIds.length} term
                {selectedTermIds.length !== 1 ? "s" : ""} selected
              </span>
            )}
          </div>
          <PaymentTermSelector
            terms={paymentTerms}
            selectedIds={selectedTermIds}
            totalValue={totalValue}
            bookingNo={editBookingNo ?? null}
            onChange={setSelectedTermIds}
          />
        </div>

        {/* Payment */}
        <FormSection
          icon={
            <CreditCard
              size={12}
              className="text-cyan-600 dark:text-cyan-400"
            />
          }
          label="Booking Payment"
          color="bg-cyan-50 dark:bg-cyan-900/30"
        >
          <FormField label="Payment Mode">
            <div className="relative">
              <select
                className="w-full appearance-none px-3 py-2.5 pr-9 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
                value={form.paymentMode}
                onChange={(e) => set("paymentMode")(e.target.value)}
              >
                <option value="">Select mode...</option>
                {paymentModes.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </FormField>
          {(form.paymentMode === "Cheque" || form.paymentMode === "DD") && (
            <>
              <FormField label="Cheque / DD No">
                <input
                  className={inputCls}
                  placeholder="XXXXXXXXXX"
                  value={form.chequeNo}
                  onChange={(e) => set("chequeNo")(e.target.value)}
                />
              </FormField>
              <FormField label="Bank Name">
                <input
                  className={inputCls}
                  placeholder="Bank name"
                  value={form.bankName}
                  onChange={(e) => set("bankName")(e.target.value)}
                />
              </FormField>
            </>
          )}
        </FormSection>

        {/* Loan */}
        <FormSection
          icon={
            <Banknote
              size={12}
              className="text-amber-600 dark:text-amber-400"
            />
          }
          label="Home Loan (Optional)"
          color="bg-amber-50 dark:bg-amber-900/30"
        >
          <div className="col-span-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.loanApproved as boolean}
                onChange={(e) => set("loanApproved")(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`relative w-9 h-5 rounded-full border transition-colors flex-shrink-0 ${form.loanApproved ? "bg-primary border-primary" : "bg-muted border-border"}`}
              >
                <div
                  className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all duration-200 shadow-sm ${form.loanApproved ? "left-[18px]" : "left-0.5"}`}
                />
              </div>
              <span className="text-sm text-foreground">Loan approved</span>
            </label>
          </div>
          {form.loanApproved && (
            <>
              <FormField label="Loan Bank">
                <input
                  className={inputCls}
                  placeholder="e.g. SBI Home Loans"
                  value={form.loanBank}
                  onChange={(e) => set("loanBank")(e.target.value)}
                />
              </FormField>
              <FormField label="Loan Amount (₹)">
                <input
                  type="number"
                  className={inputCls}
                  placeholder="0"
                  value={form.loanAmount}
                  onChange={(e) => set("loanAmount")(e.target.value)}
                />
              </FormField>
            </>
          )}
        </FormSection>

        {/* Notes */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-border/60">
            <div className="p-1.5 rounded-lg bg-muted">
              <FileText size={12} className="text-muted-foreground" />
            </div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Notes
            </p>
          </div>
          <textarea
            rows={3}
            className={inputCls}
            placeholder="Any additional notes..."
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto rounded-lg flex items-center disabled:opacity-60"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? "Saving…" : "Save Booking"}
        </button>
      </div>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
      {icon && (
        <span className="text-muted-foreground/60 mt-0.5 w-3.5 flex-shrink-0">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0 mt-0.5">
          {label}
        </p>
        <p className="text-[12px] text-foreground text-right break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

function InfoSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground/50">{icon}</span>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          {title}
        </p>
      </div>
      <div className="rounded-xl bg-muted/20 border border-border/50 px-4">
        {children}
      </div>
    </div>
  );
}

interface BookingPaymentTerm {
  Id: number;
  TermID: number;
  TermName: string;
  ValueType: "percent" | "fixed" | "deduction";
  TermValue: number;
  ComputedAmount: number;
  DocRef: string | null;
  SortOrder: number;
  DueDate: string | null;
  IsPaid: boolean;
}

function BookingDrawer({
  booking,
  onClose,
  onEdit,
  canEdit,
}: {
  booking: Booking;
  onClose: () => void;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const { data: paymentSchedule = [], isLoading: scheduleLoading } = useQuery<
    BookingPaymentTerm[]
  >({
    queryKey: ["booking-payment-terms", booking.Id],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${booking.Id}/payment-terms`);
      if (!res.ok) return [];
      return res.json().catch(() => ({}));
    },
    staleTime: 60_000,
  });

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[520px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <Avatar name={booking.ApplicantName} size="lg" />
              <div>
                <h2 className="text-[16px] font-bold text-foreground leading-tight">
                  {booking.ApplicantName}
                </h2>
                {booking.BookingNo && (
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    {booking.BookingNo}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {canEdit && (<button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors"
              >
                <Edit2 size={11} /> Edit
                </button>)}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <StatusBadge status={booking.Status} />
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 rounded-full px-2.5 py-1 border border-border/60">
              <Calendar size={10} /> {fmtDate(booking.BookingDate)}
            </span>
            {booking.TotalValue && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-full px-2.5 py-1">
                <IndianRupee size={10} /> {fmtCurrency(booking.TotalValue)}
              </span>
            )}
          </div>
          {(booking.PrimaryMobile || booking.Email) && (
            <div className="flex flex-wrap gap-3 mt-3">
              {booking.PrimaryMobile && (
                <a
                  href={`tel:${booking.PrimaryMobile}`}
                  className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                >
                  <Phone size={11} /> {booking.PrimaryMobile}
                </a>
              )}
              {booking.Email && (
                <a
                  href={`mailto:${booking.Email}`}
                  className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                >
                  <Mail size={11} /> {booking.Email}
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-1">
          <InfoSection title="Booking" icon={<BookOpen size={11} />}>
            <InfoRow
              label="Booking No"
              value={booking.BookingNo}
              icon={<Hash size={11} />}
            />
            <InfoRow
              label="Date"
              value={fmtDate(booking.BookingDate)}
              icon={<Calendar size={11} />}
            />
            <InfoRow
              label="Booking Amount"
              value={fmtCurrency(booking.BookingAmount)}
              icon={<IndianRupee size={11} />}
            />
            <InfoRow
              label="Total Value"
              value={fmtCurrency(booking.TotalValue)}
              icon={<IndianRupee size={11} />}
            />
            <InfoRow
              label="Payment Mode"
              value={booking.PaymentMode}
              icon={<CreditCard size={11} />}
            />
            {booking.ChequeNo && (
              <InfoRow
                label="Cheque / DD No"
                value={booking.ChequeNo}
                icon={<Hash size={11} />}
              />
            )}
            {booking.BankName && (
              <InfoRow
                label="Bank"
                value={booking.BankName}
                icon={<Building2 size={11} />}
              />
            )}
          </InfoSection>
          <InfoSection title="Property" icon={<Home size={11} />}>
            <InfoRow
              label="Project"
              value={booking.ProjectName}
              icon={<Building2 size={11} />}
            />
            <InfoRow
              label="Unit"
              value={[booking.BlockName, booking.UnitNo]
                .filter(Boolean)
                .join(" › ")}
              icon={<Home size={11} />}
            />
            <InfoRow
              label="Floor"
              value={booking.FloorName}
              icon={<Layers size={11} />}
            />
            <InfoRow
              label="Type"
              value={booking.UnitType}
              icon={<Home size={11} />}
            />
            <InfoRow
              label="Area"
              value={
                booking.AreaSqFt
                  ? `${booking.AreaSqFt.toLocaleString("en-IN")} sq.ft`
                  : null
              }
              icon={<MapPin size={11} />}
            />
            <InfoRow
              label="Rate/sqft"
              value={
                booking.RatePerSqFt ? fmtCurrency(booking.RatePerSqFt) : null
              }
              icon={<IndianRupee size={11} />}
            />
          </InfoSection>
          {booking.LoanApproved && (
            <InfoSection title="Home Loan" icon={<Banknote size={11} />}>
              <InfoRow
                label="Status"
                value={
                  <span className="text-emerald-600 font-semibold">
                    Approved
                  </span>
                }
                icon={<CheckCircle size={11} />}
              />
              <InfoRow
                label="Bank"
                value={booking.LoanBank}
                icon={<Building2 size={11} />}
              />
              <InfoRow
                label="Loan Amount"
                value={fmtCurrency(booking.LoanAmount)}
                icon={<IndianRupee size={11} />}
              />
            </InfoSection>
          )}
          {(booking.AssignedToName || booking.Notes) && (
            <InfoSection title="Other" icon={<FileText size={11} />}>
              <InfoRow
                label="Assigned To"
                value={booking.AssignedToName}
                icon={<Users size={11} />}
              />
              <InfoRow
                label="Notes"
                value={booking.Notes}
                icon={<FileText size={11} />}
              />
            </InfoSection>
          )}
          {/* Payment Schedule */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2 pb-2 border-b border-border/60">
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
                <Tag
                  size={12}
                  className="text-emerald-600 dark:text-emerald-400"
                />
              </div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                Payment Schedule
              </p>
              {paymentSchedule.length > 0 && (
                <span className="ml-auto text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {paymentSchedule.length} term
                  {paymentSchedule.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {scheduleLoading ? (
              <div className="flex items-center gap-2 py-3 text-[12px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading schedule…
              </div>
            ) : paymentSchedule.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-4 bg-muted/30 rounded-xl border border-dashed border-border">
                No payment schedule — attach terms while editing this booking.
              </p>
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                <div className="px-4 divide-y divide-border/50">
                  {paymentSchedule.map((t) => {
                    const tc = TYPE_CONFIG[t.ValueType] ?? TYPE_CONFIG["fixed"];
                    return (
                      <div
                        key={t.Id}
                        className="py-3 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-foreground truncate">
                            {t.TermName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {t.DocRef && (
                              <code className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground border border-border/60">
                                {t.DocRef}
                              </code>
                            )}
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${tc.pill}`}
                            >
                              {tc.icon}
                              {t.ValueType === "percent" ||
                              t.ValueType === "deduction"
                                ? `${t.TermValue}%`
                                : fmtCurrencyCompact(t.TermValue)}
                            </span>
                            {t.DueDate && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Calendar size={9} /> Due {fmtDate(t.DueDate)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p
                            className={`text-[13px] font-bold ${t.ValueType === "deduction" ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                          >
                            {t.ValueType === "deduction" ? "−" : ""}
                            {fmtCurrencyCompact(Math.abs(t.ComputedAmount))}
                          </p>
                          {t.IsPaid ? (
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 justify-end mt-0.5">
                              <CheckCircle size={9} /> Paid
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 justify-end mt-0.5">
                              <Clock size={9} /> Pending
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Total footer */}
                {(() => {
                  const totalCharged = paymentSchedule
                    .filter((t) => t.ValueType !== "deduction")
                    .reduce((s, t) => s + t.ComputedAmount, 0);
                  const totalDeducted = paymentSchedule
                    .filter((t) => t.ValueType === "deduction")
                    .reduce((s, t) => s + Math.abs(t.ComputedAmount), 0);
                  const balance =
                    (booking.TotalValue ?? 0) - totalCharged + totalDeducted;
                  return (
                    <div className="border-t border-border bg-muted/40 px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Total Scheduled
                        </span>
                        <span className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400">
                          {fmtCurrencyCompact(totalCharged)}
                        </span>
                      </div>
                      {booking.TotalValue != null && (
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/60">
                          <span className="text-[11px] font-bold text-foreground">
                            Balance Remaining
                          </span>
                          <span
                            className={`text-[14px] font-extrabold ${balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                          >
                            {fmtCurrencyCompact(Math.max(0, balance))}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <InfoSection title="Audit" icon={<Clock size={11} />}>
            <InfoRow
              label="Created"
              value={
                booking.CreatedBy
                  ? `${booking.CreatedBy} · ${fmtDate(booking.CreatedAt)}`
                  : fmtDate(booking.CreatedAt)
              }
              icon={<Clock size={11} />}
            />
            {booking.UpdatedBy && (
              <InfoRow
                label="Last Updated"
                value={`${booking.UpdatedBy} · ${fmtDate(booking.UpdatedAt)}`}
                icon={<Clock size={11} />}
              />
            )}
          </InfoSection>
        </div>
      </div>
    </>
  );
}

// ── Booking Card (grid view) ───────────────────────────────────────────────────
function BookingCard({
  booking,
  isSelected,
  onClick,
}: {
  booking: Booking;
  isSelected: boolean;
  onClick: () => void;
}) {
  const palette = avatarPalette(booking.ApplicantName);
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-2xl border cursor-pointer transition-all duration-200
        ${isSelected ? "border-primary/40 bg-primary/3 shadow-sm shadow-primary/10" : "border-border bg-card hover:border-border/80 hover:shadow-md hover:shadow-black/5 hover:-translate-y-0.5"}`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${palette.bg} ${palette.text}`}
            >
              {initials(booking.ApplicantName)}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                {booking.ApplicantName}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                {booking.BookingNo ?? "—"}
              </p>
            </div>
          </div>
          <StatusBadge status={booking.Status} />
        </div>
        <div className="flex items-center gap-1.5 mb-3">
          <div className="p-1 rounded-md bg-muted/60">
            <Building2 size={10} className="text-muted-foreground" />
          </div>
          <span className="text-[11px] text-muted-foreground truncate">
            {[booking.ProjectName, booking.BlockName, booking.UnitNo]
              .filter(Boolean)
              .join(" · ")}
            {booking.UnitType && (
              <span className="ml-1 font-medium text-foreground/70">
                {booking.UnitType}
              </span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
              Booking Amt
            </p>
            <p className="text-[12px] font-bold text-foreground">
              {fmtCurrency(booking.BookingAmount) ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-2">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
              Total Value
            </p>
            <p className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
              {booking.TotalValue ? fmtCurrency(booking.TotalValue) : "—"}
            </p>
          </div>
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar size={10} /> {fmtDate(booking.BookingDate)}
        </span>
        {booking.PaymentMode && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md">
            {booking.PaymentMode}
          </span>
        )}
      </div>
      <div
        className={`absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? "opacity-100" : ""}`}
      >
        <ArrowUpRight size={13} className="text-primary" />
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  icon,
  accent,
  bg,
  borderL,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  accent: string;
  bg: string;
  borderL: string;
}) {
  return (
    <div className={`relative rounded-2xl border border-border bg-card p-4 flex items-center gap-3 overflow-hidden border-l-2 ${borderL}`}>
      <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${bg}`} />
      <div className={`p-2.5 rounded-xl ${bg} flex-shrink-0`}>
        <span className={accent}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-lg font-bold font-heading text-foreground leading-tight mt-0.5 truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const rights = usePageRights("followup-bookings");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [projectFilter, setProjectFilter] = useState<string | undefined>(
    undefined,
  );
  const [showForm, setShowForm] = useState(false);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [auditTarget, setAuditTarget] = useState<{ id: number; no: string } | null>(null);

  const statusOptions = useLookup("BOOKING_STATUS", ["Confirmed", "Pending", "Cancelled"]);
  const paymentModes = useLookup("PAYMENT_MODE", ["Cheque", "NEFT", "RTGS", "DD", "Cash", "Online"]);
  const unitTypes = useLookup("UNIT_TYPE", ["1BHK", "2BHK", "3BHK", "4BHK", "Studio", "Duplex", "Villa", "Shop", "Office"]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [statusFilter, projectFilter]);

  const {
    data: bookingData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      "followup-bookings",
      debouncedSearch,
      statusFilter,
      projectFilter,
      page,
    ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (statusFilter) p.set("status", statusFilter);
      if (projectFilter) p.set("projectId", projectFilter);
      p.set("page", String(page));
      p.set("pageSize", String(PAGE_SIZE));
      const res = await fetchWithAuth(`${API}?${p}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json().catch(() => ({})) as Promise<{
        data: Booking[];
        pagination: { total: number; totalPages: number };
      }>;
    },
    staleTime: 60_000,
  });

  const { data: applicants = [] } = useQuery<Applicant[]>({
    queryKey: ["followup-booking-applicants"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/applicants`);
      if (!res.ok) throw new Error("Failed");
      return res.json().catch(() => ({}));
    },
    staleTime: 300_000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["followup-booking-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed");
      return res.json().catch(() => ({}));
    },
    staleTime: 600_000,
  });

  const bookings = bookingData?.data ?? [];
  const totalPages = bookingData?.pagination?.totalPages ?? 1;
  const total = bookingData?.pagination?.total ?? 0;
  const hasFilters = !!(search || statusFilter || projectFilter);
  const confirmed = bookings.filter((b) => b.Status === "Confirmed").length;
  const pending = bookings.filter((b) => b.Status === "Pending").length;
  // Note: confirmed/pending/totalValue are page-scoped (current page only)
  const totalValuePage = bookings
    .filter((b) => b.Status === "Confirmed")
    .reduce((s, b) => s + (b.TotalValue ?? 0), 0);

  const handleSave = async (form: FormData, selectedTermIds: number[]) => {
    const payload = {
      ApplicantId: form.applicantId ? parseInt(form.applicantId) : null,
      ProjectId: form.projectId ? parseInt(form.projectId) : null,
      UnitNo: form.unitNo,
      BlockName: form.blockName || null,
      FloorName: form.floorName || null,
      UnitType: form.unitType || null,
      AreaSqFt: form.areaSqFt ? parseFloat(form.areaSqFt) : null,
      RatePerSqFt: form.ratePerSqFt ? parseFloat(form.ratePerSqFt) : null,
      TotalValue: form.totalValue ? parseFloat(form.totalValue) : null,
      BookingAmount: form.bookingAmount ? parseFloat(form.bookingAmount) : null,
      BookingDate: form.bookingDate,
      PaymentMode: form.paymentMode || null,
      ChequeNo: form.chequeNo || null,
      BankName: form.bankName || null,
      LoanApproved: form.loanApproved,
      LoanBank: form.loanBank || null,
      LoanAmount: form.loanAmount ? parseFloat(form.loanAmount) : null,
      Status: form.status,
      Notes: form.notes || null,
      PaymentTermIds: selectedTermIds.length > 0 ? selectedTermIds : undefined,
    };

    if (editBooking) {
      const res = await fetchWithAuth(`${API}/${editBooking.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Update failed");
      }
      toast.success("Booking updated");
      const updated = await fetchWithAuth(`${API}/${editBooking.Id}`)
        .then((r) => r.json().catch(() => ({})))
        .catch(() => null);
      if (updated) setSelectedBooking(updated);
    } else {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Create failed");
      }
      const created = await res.json().catch(() => ({}));
      toast.success("Booking created");

      // Fetch full booking record so communicator has correct name/email/phone
      const fullCreated = await fetchWithAuth(`${API}/${created.Id ?? created.id}`)
        .then((r) => r.ok ? r.json().catch(() => ({})) : created)
        .catch(() => created);

      // Auto-create a Welcome Call record linked to this booking
      try {
        await fetchWithAuth("/api/followup-welcome-calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            BookingId: created.Id ?? created.id,
            ApplicantId: payload.ApplicantId,
            CallDate: new Date().toISOString().slice(0, 10),
            Outcome: "callback",
            Notes: `Auto-created on booking ${created.BookingNo ?? created.bookingNo ?? ""}`.trim(),
          }),
        });
        toast.info("Welcome Call scheduled — go to Sales → Welcome Calls to log the outcome.");
      } catch {
        // Non-fatal: booking was already created successfully
      }

      // Auto-send welcome Email / SMS / WhatsApp
      import("../../api/followupCommunicatorApi").then(({ followupCommunicatorApi }) => {
        followupCommunicatorApi.trigger({
          triggerType:   "booking",
          applicantId:   payload.ApplicantId,
          bookingId:     created.Id ?? created.id,
          applicantName: fullCreated.ApplicantName ?? "",
          email:         fullCreated.Email         ?? undefined,
          phone:         fullCreated.PrimaryMobile ?? undefined,
          projectName:   fullCreated.ProjectName   ?? undefined,
          unitNo:        fullCreated.UnitNo        ?? payload.UnitNo,
          bookingDate:   payload.BookingDate,
        }).catch(() => {});
      }).catch(() => {});
    }
    await queryClient.invalidateQueries({ queryKey: ["followup-bookings"] });
    setShowForm(false);
    setEditBooking(null);
  };

  const openNew = () => {
    setEditBooking(null);
    setSelectedBooking(null);
    setShowForm(true);
  };
  const openEdit = (b: Booking) => {
    setEditBooking(b);
    setSelectedBooking(null);
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditBooking(null);
  };

  const EmptyState = () => (
    <div className="flex flex-col items-center gap-4 py-24">
      <div className="p-5 rounded-2xl bg-muted/60 border border-border">
        <BookOpen size={28} className="text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">
          No bookings found
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {hasFilters
            ? "Try adjusting your filters"
            : "Get started by creating your first booking"}
        </p>
      </div>
      {!hasFilters && rights.canCreate && (
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-xl px-4 py-2 hover:bg-primary/90 transition-colors font-semibold"
        >
          <Plus size={13} /> New Booking
        </button>
      )}
    </div>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Sales" },
          { label: "Bookings", path: "/followup/sales/bookings" },
        ]}
      />
      <FollowupShell
        title="Bookings"
        icon={BookOpen}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isLoading ? "animate-spin" : ""}
              />
              Refresh
            </button>
            {rights.canCreate && (
              <Button
                onClick={openNew}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                <Plus size={13} />
                New Booking
              </Button>
            )}
          </div>
        }
      >

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Total Bookings"
            value={total}
            icon={<BookOpen size={16} />}
            accent="text-blue-600 dark:text-blue-400"
            bg="bg-blue-50 dark:bg-blue-900/30"
            borderL="border-l-blue-500"
          />
          <KpiCard
            label="Confirmed"
            value={confirmed}
            icon={<CheckCircle size={16} />}
            accent="text-emerald-600 dark:text-emerald-400"
            bg="bg-emerald-50 dark:bg-emerald-900/30"
            borderL="border-l-emerald-500"
          />
          <KpiCard
            label="Pending"
            value={pending}
            icon={<AlertCircle size={16} />}
            accent="text-amber-600 dark:text-amber-400"
            bg="bg-amber-50 dark:bg-amber-900/30"
            borderL="border-l-amber-500"
          />
          <KpiCard
            label="Confirmed Value"
            value={fmtCurrency(totalValuePage) ?? "—"}
            icon={<IndianRupee size={16} />}
            accent="text-violet-600 dark:text-violet-400"
            bg="bg-violet-50 dark:bg-violet-900/30"
            borderL="border-l-violet-500"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => {
                setStatusFilter(undefined);
                setPage(1);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${!statusFilter ? "bg-foreground text-background border-foreground shadow-sm" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"}`}
            >
              All <span className="font-mono ml-1">{total}</span>
            </button>
            {statusOptions.map((s) => {
              const cfg = STATUS_CONFIG[s];
              return cfg ? (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(statusFilter === s ? undefined : s);
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${statusFilter === s ? `${cfg.pill} border-current shadow-sm` : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> {s}
                </button>
              ) : (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(statusFilter === s ? undefined : s);
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                    ${statusFilter === s ? "bg-muted text-foreground border-current shadow-sm" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                className="pl-9 pr-9 py-2 border border-border rounded-xl text-sm bg-card text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all w-64"
                placeholder="Search name, unit, project…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="relative">
              <select
                className="appearance-none px-3 py-2 pr-9 border border-border rounded-xl text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60 min-w-[130px]"
                value={projectFilter ?? ""}
                onChange={(e) => setProjectFilter(e.target.value || undefined)}
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.Id} value={p.Id}>
                    {p.Name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            {hasFilters && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter(undefined);
                  setProjectFilter(undefined);
                  setPage(1);
                }}
                className="flex items-center gap-1 px-3 py-2 border border-red-400/30 bg-red-500/5 text-red-500 rounded-xl text-xs font-semibold hover:bg-red-500/10 transition-colors"
              >
                <X size={11} /> Clear
              </button>
            )}
            <div className="flex items-center border border-border rounded-xl overflow-hidden">
              {(["table", "grid"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-2 text-xs transition-colors ${viewMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mode === "table" ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="1" width="12" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
                      <rect x="1" y="5.5" width="12" height="2.5" rx="0.5" fill="currentColor" />
                      <rect x="1" y="10" width="12" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="1" width="5.5" height="5.5" rx="1" fill="currentColor" />
                      <rect x="7.5" y="1" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.4" />
                      <rect x="1" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.4" />
                      <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {viewMode === "grid" ? (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-border bg-card p-4 animate-pulse space-y-3"
                  >
                    <div className="flex gap-2">
                      <div className="w-9 h-9 rounded-xl bg-muted" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3.5 bg-muted rounded w-3/4" />
                        <div className="h-2.5 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                    <div className="h-2.5 bg-muted rounded w-full" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="h-12 bg-muted rounded-lg" />
                      <div className="h-12 bg-muted rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            ) : bookings.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bookings.map((b) => (
                  <BookingCard
                    key={b.Id}
                    booking={b}
                    isSelected={selectedBooking?.Id === b.Id}
                    onClick={() =>
                      setSelectedBooking((prev) =>
                        prev?.Id === b.Id ? null : b,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {[
                      "Applicant",
                      "Project / Unit",
                      "Booking Date",
                      "Booking Amt",
                      "Total Value",
                      "Payment",
                      "Status",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/40">
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div
                              className="h-3.5 bg-muted rounded animate-pulse"
                              style={{ width: `${55 + ((i * j * 7) % 35)}%` }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : bookings.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState />
                      </td>
                    </tr>
                  ) : (
                    bookings.map((b) => {
                      const palette = avatarPalette(b.ApplicantName);
                      const isSelected = selectedBooking?.Id === b.Id;
                      return (
                        <tr
                          key={b.Id}
                          onClick={() =>
                            setSelectedBooking((prev) =>
                              prev?.Id === b.Id ? null : b,
                            )
                          }
                          className={`group cursor-pointer border-b border-border/40 transition-all ${isSelected ? "bg-primary/4" : "hover:bg-muted/40"}`}
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${palette.bg} ${palette.text}`}
                              >
                                {initials(b.ApplicantName)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-foreground truncate">
                                  {b.ApplicantName}
                                </p>
                                <p className="text-[10px] font-mono text-muted-foreground">
                                  {b.BookingNo ?? "—"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-[12px] font-medium text-foreground">
                              {b.ProjectName ?? "—"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {[b.BlockName, b.UnitNo]
                                .filter(Boolean)
                                .join(" › ")}
                              {b.UnitType && (
                                <span className="ml-1 font-medium">
                                  {b.UnitType}
                                </span>
                              )}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-[12px] text-muted-foreground">
                              {fmtDate(b.BookingDate)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-[12px] font-semibold text-foreground">
                              {fmtCurrency(b.BookingAmount)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
                              {b.TotalValue ? (
                                fmtCurrency(b.TotalValue)
                              ) : (
                                <span className="text-muted-foreground font-normal">
                                  —
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            {b.PaymentMode ? (
                              <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md">
                                {b.PaymentMode}
                              </span>
                            ) : (
                              <span className="text-[12px] text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={b.Status} />
                          </td>
                          <td className="px-3 py-3.5 w-8">
                            <div className="flex items-center gap-1">
                              <button
                                title="History"
                                onClick={(e) => { e.stopPropagation(); setAuditTarget({ id: b.Id, no: b.BookingNo ?? `#${b.Id}` }); }}
                                className="p-1 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/8 transition-colors"
                              >
                                <Clock size={13} />
                              </button>
                              <ChevronRight
                              size={14}
                              className={`text-muted-foreground/30 transition-all group-hover:text-primary group-hover:translate-x-0.5 ${isSelected ? "text-primary" : ""}`}
                            />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {(totalPages > 1 || total > 0) && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  {total} booking{total !== 1 ? "s" : ""}
                  {totalPages > 1 && (
                    <>
                      {" "}
                      · Page {page} of {totalPages}
                    </>
                  )}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-xl text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                    >
                      <ChevronLeft size={12} /> Prev
                    </button>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page === totalPages}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-xl text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </FollowupShell>

      {/* Slide-over form */}
      {showForm && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[3px]"
            onClick={closeForm}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[620px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  {editBooking ? (
                    <Edit2 size={14} className="text-primary" />
                  ) : (
                    <Plus size={14} className="text-primary" />
                  )}
                </div>
                <h2 className="text-[14px] font-bold text-foreground">
                  {editBooking
                    ? `Edit — ${editBooking.BookingNo ?? `Booking #${editBooking.Id}`}`
                    : "New Booking"}
                </h2>
              </div>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <BookingForm
                key={editBooking?.Id ?? "new"}
                initial={
                  editBooking
                    ? {
                        applicantId: String(editBooking.ApplicantId),
                        projectId: String(editBooking.ProjectId ?? ""),
                        unitNo: editBooking.UnitNo,
                        blockName: editBooking.BlockName ?? "",
                        floorName: editBooking.FloorName ?? "",
                        unitType: editBooking.UnitType ?? "",
                        areaSqFt: String(editBooking.AreaSqFt ?? ""),
                        ratePerSqFt: String(editBooking.RatePerSqFt ?? ""),
                        totalValue: String(editBooking.TotalValue ?? ""),
                        bookingAmount: String(editBooking.BookingAmount),
                        bookingDate:
                          editBooking.BookingDate?.slice(0, 10) ?? "",
                        paymentMode: editBooking.PaymentMode ?? "",
                        chequeNo: editBooking.ChequeNo ?? "",
                        bankName: editBooking.BankName ?? "",
                        loanApproved: Boolean(editBooking.LoanApproved),
                        loanBank: editBooking.LoanBank ?? "",
                        loanAmount: String(editBooking.LoanAmount ?? ""),
                        status: editBooking.Status,
                        notes: editBooking.Notes ?? "",
                      }
                    : undefined
                }
                onSave={handleSave}
                onCancel={closeForm}
                applicants={applicants}
                projects={projects}
                statusOptions={statusOptions}
                paymentModes={paymentModes}
                unitTypes={unitTypes}
                editBookingNo={editBooking?.BookingNo}
                editBookingId={editBooking?.Id ?? null}
              />
            </div>
          </div>
        </>
      )}

      {/* Detail drawer */}
      {selectedBooking && !showForm && (
        <BookingDrawer
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onEdit={() => openEdit(selectedBooking)}
          canEdit={rights.canEdit}
        />
      )}

      {/* Audit log drawer */}
      <AuditLogDrawer
        open={!!auditTarget}
        onClose={() => setAuditTarget(null)}
        module="Booking"
        recordId={auditTarget?.id ?? null}
        recordNo={auditTarget?.no}
      />
    </>
  );
}
