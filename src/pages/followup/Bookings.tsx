import React, { useState, useEffect, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  Save,
  Banknote,
  Trash2,
  Layers,
} from "lucide-react";
import { DashboardBackground } from "@/components/DashboardBackground";

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = ["Confirmed", "Pending", "Cancelled"];
const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "DD", "Cash", "Online"];
const UNIT_TYPES = [
  "1BHK",
  "2BHK",
  "3BHK",
  "4BHK",
  "Studio",
  "Duplex",
  "Villa",
  "Shop",
  "Office",
];

const STATUS_CONFIG: Record<string, { dot: string; text: string; bg: string }> =
  {
    Confirmed: {
      dot: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20",
    },
    Pending: {
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
    },
    Cancelled: {
      dot: "bg-red-500",
      text: "text-red-700 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
    },
  };

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#0891B2",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#4F46E5",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
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
function fmtCurrency(v: number | null) {
  if (v == null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted border-border",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${cfg.bg} ${cfg.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

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
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed bg-muted" : "bg-background hover:border-primary/50 cursor-pointer"}
          ${open ? "border-primary ring-1 ring-primary/20" : "border-border"}
          ${!selected ? "text-muted-foreground" : "text-foreground"}`}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm bg-muted rounded-md outline-none"
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
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${value === o.value ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
                >
                  {o.label}
                  {o.sub && (
                    <span className="block text-[11px] text-muted-foreground">
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
}: {
  initial?: Partial<FormData>;
  onSave: (data: FormData) => Promise<void>;
  onCancel: () => void;
  applicants: Applicant[];
  projects: Project[];
}) {
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormData) => (v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Auto-compute total value from area × rate
  useEffect(() => {
    const area = parseFloat(form.areaSqFt);
    const rate = parseFloat(form.ratePerSqFt);
    if (area > 0 && rate > 0)
      set("totalValue")(String(Math.round(area * rate)));
  }, [form.areaSqFt, form.ratePerSqFt]);

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
    if (!form.bookingAmount) {
      toast.error("Booking amount is required");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors placeholder:text-muted-foreground";
  const labelCls =
    "block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Applicant */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <User size={11} className="text-blue-500" /> Applicant
          </p>
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className={labelCls}>
                Booking Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className={inputCls}
                value={form.bookingDate}
                onChange={(e) => set("bookingDate")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => set("status")(e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Property */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <Building2 size={11} className="text-violet-500" /> Property
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Combobox
                label="Project"
                value={form.projectId}
                onChange={set("projectId")}
                options={projectOpts}
                placeholder="Select project..."
              />
            </div>
            <div>
              <label className={labelCls}>
                Unit No <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="e.g. A-401"
                value={form.unitNo}
                onChange={(e) => set("unitNo")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Block</label>
              <input
                className={inputCls}
                placeholder="e.g. A"
                value={form.blockName}
                onChange={(e) => set("blockName")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Floor</label>
              <input
                className={inputCls}
                placeholder="e.g. 4th"
                value={form.floorName}
                onChange={(e) => set("floorName")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Unit Type</label>
              <select
                className={inputCls}
                value={form.unitType}
                onChange={(e) => set("unitType")(e.target.value)}
              >
                <option value="">Select type...</option>
                {UNIT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Area (sq.ft)</label>
              <input
                type="number"
                className={inputCls}
                placeholder="0"
                value={form.areaSqFt}
                onChange={(e) => set("areaSqFt")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Rate / sq.ft (₹)</label>
              <input
                type="number"
                className={inputCls}
                placeholder="0"
                value={form.ratePerSqFt}
                onChange={(e) => set("ratePerSqFt")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Total Value (₹)</label>
              <input
                type="number"
                className={inputCls}
                placeholder="Auto-computed"
                value={form.totalValue}
                onChange={(e) => set("totalValue")(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Payment */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <CreditCard size={11} className="text-emerald-500" /> Payment
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Booking Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                className={inputCls}
                placeholder="0"
                value={form.bookingAmount}
                onChange={(e) => set("bookingAmount")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Payment Mode</label>
              <select
                className={inputCls}
                value={form.paymentMode}
                onChange={(e) => set("paymentMode")(e.target.value)}
              >
                <option value="">Select mode...</option>
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            {(form.paymentMode === "Cheque" || form.paymentMode === "DD") && (
              <>
                <div>
                  <label className={labelCls}>Cheque / DD No</label>
                  <input
                    className={inputCls}
                    placeholder="XXXXXXXXXX"
                    value={form.chequeNo}
                    onChange={(e) => set("chequeNo")(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Bank Name</label>
                  <input
                    className={inputCls}
                    placeholder="Bank name"
                    value={form.bankName}
                    onChange={(e) => set("bankName")(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Loan */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <Banknote size={11} className="text-amber-500" /> Home Loan
            (Optional)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center gap-2.5">
              <input
                type="checkbox"
                id="loanApproved"
                checked={form.loanApproved as boolean}
                onChange={(e) => set("loanApproved")(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <label
                htmlFor="loanApproved"
                className="text-sm text-foreground cursor-pointer select-none"
              >
                Loan approved
              </label>
            </div>
            {form.loanApproved && (
              <>
                <div>
                  <label className={labelCls}>Loan Bank</label>
                  <input
                    className={inputCls}
                    placeholder="e.g. SBI Home Loans"
                    value={form.loanBank}
                    onChange={(e) => set("loanBank")(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Loan Amount (₹)</label>
                  <input
                    type="number"
                    className={inputCls}
                    placeholder="0"
                    value={form.loanAmount}
                    onChange={(e) => set("loanAmount")(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Notes */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <FileText size={11} className="text-muted-foreground" /> Notes
          </p>
          <textarea
            rows={3}
            className={inputCls}
            placeholder="Any additional notes..."
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </section>
      </div>

      <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
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

// ── Detail Drawer helpers ─────────────────────────────────────────────────────
function DetailRow({
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
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      {icon && (
        <span className="text-muted-foreground mt-0.5 w-4 flex-shrink-0">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
          {label}
        </p>
        <p className="text-sm text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
        {title}
      </p>
      <div className="bg-muted/30 rounded-xl px-4">{children}</div>
    </div>
  );
}

// ── Booking Drawer ────────────────────────────────────────────────────────────
function BookingDrawer({
  booking,
  onClose,
  onEdit,
}: {
  booking: Booking;
  onClose: () => void;
  onEdit: () => void;
}) {
  const bg = avatarColor(booking.ApplicantName);
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[600px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                style={{ background: bg }}
              >
                {initials(booking.ApplicantName)}
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-foreground leading-tight">
                  {booking.ApplicantName}
                </h2>
                {booking.BookingNo && (
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {booking.BookingNo}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Edit2 size={12} /> Edit
              </button>
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
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted rounded-md px-2 py-0.5 border border-border">
              <Calendar size={10} /> {fmtDate(booking.BookingDate)}
            </span>
            {booking.TotalValue && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-md px-2 py-0.5">
                <IndianRupee size={10} /> {fmtCurrency(booking.TotalValue)}
              </span>
            )}
          </div>
          {(booking.PrimaryMobile || booking.Email) && (
            <div className="flex flex-wrap gap-3 mt-2.5">
              {booking.PrimaryMobile && (
                <a
                  href={`tel:${booking.PrimaryMobile}`}
                  className="flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  <Phone size={11} /> {booking.PrimaryMobile}
                </a>
              )}
              {booking.Email && (
                <a
                  href={`mailto:${booking.Email}`}
                  className="flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  <Mail size={11} /> {booking.Email}
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <DetailSection title="Booking">
            <DetailRow
              label="Booking No"
              value={booking.BookingNo}
              icon={<Hash size={12} />}
            />
            <DetailRow
              label="Booking Date"
              value={fmtDate(booking.BookingDate)}
              icon={<Calendar size={12} />}
            />
            <DetailRow
              label="Booking Amount"
              value={fmtCurrency(booking.BookingAmount)}
              icon={<IndianRupee size={12} />}
            />
            <DetailRow
              label="Total Value"
              value={fmtCurrency(booking.TotalValue)}
              icon={<IndianRupee size={12} />}
            />
            <DetailRow
              label="Payment Mode"
              value={booking.PaymentMode}
              icon={<CreditCard size={12} />}
            />
            {booking.ChequeNo && (
              <DetailRow
                label="Cheque / DD No"
                value={booking.ChequeNo}
                icon={<Hash size={12} />}
              />
            )}
            {booking.BankName && (
              <DetailRow
                label="Bank"
                value={booking.BankName}
                icon={<Building2 size={12} />}
              />
            )}
          </DetailSection>

          <DetailSection title="Property">
            <DetailRow
              label="Project"
              value={booking.ProjectName}
              icon={<Building2 size={12} />}
            />
            <DetailRow
              label="Unit"
              value={[booking.BlockName, booking.UnitNo]
                .filter(Boolean)
                .join(" › ")}
              icon={<Home size={12} />}
            />
            <DetailRow
              label="Floor"
              value={booking.FloorName}
              icon={<Layers size={12} />}
            />
            <DetailRow
              label="Type"
              value={booking.UnitType}
              icon={<Home size={12} />}
            />
            <DetailRow
              label="Area"
              value={
                booking.AreaSqFt
                  ? `${booking.AreaSqFt.toLocaleString("en-IN")} sq.ft`
                  : null
              }
              icon={<MapPin size={12} />}
            />
            <DetailRow
              label="Rate/sqft"
              value={
                booking.RatePerSqFt ? fmtCurrency(booking.RatePerSqFt) : null
              }
              icon={<IndianRupee size={12} />}
            />
          </DetailSection>

          {booking.LoanApproved && (
            <DetailSection title="Home Loan">
              <DetailRow
                label="Status"
                value="Approved"
                icon={<CheckCircle size={12} />}
              />
              <DetailRow
                label="Bank"
                value={booking.LoanBank}
                icon={<Building2 size={12} />}
              />
              <DetailRow
                label="Loan Amount"
                value={fmtCurrency(booking.LoanAmount)}
                icon={<IndianRupee size={12} />}
              />
            </DetailSection>
          )}

          {(booking.AssignedToName || booking.Notes) && (
            <DetailSection title="Other">
              <DetailRow
                label="Assigned To"
                value={booking.AssignedToName}
                icon={<Users size={12} />}
              />
              <DetailRow
                label="Notes"
                value={booking.Notes}
                icon={<FileText size={12} />}
              />
            </DetailSection>
          )}

          <DetailSection title="Audit">
            <DetailRow
              label="Created"
              value={
                booking.CreatedBy
                  ? `${booking.CreatedBy} · ${fmtDate(booking.CreatedAt)}`
                  : fmtDate(booking.CreatedAt)
              }
              icon={<Clock size={12} />}
            />
            {booking.UpdatedBy && (
              <DetailRow
                label="Last Updated"
                value={`${booking.UpdatedBy} · ${fmtDate(booking.UpdatedAt)}`}
                icon={<Clock size={12} />}
              />
            )}
          </DetailSection>
        </div>
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

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

  // ── Queries ────────────────────────────────────────────────────────────────
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
      return res.json() as Promise<{
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
      return res.json();
    },
    staleTime: 300_000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["followup-booking-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 600_000,
  });

  const bookings = bookingData?.data ?? [];
  const totalPages = bookingData?.pagination?.totalPages ?? 1;
  const total = bookingData?.pagination?.total ?? 0;
  const hasFilters = !!(search || statusFilter || projectFilter);

  // ── KPI counters from current page — live when no filter ──────────────────
  const confirmed = bookings.filter((b) => b.Status === "Confirmed").length;
  const pending = bookings.filter((b) => b.Status === "Pending").length;
  const totalValue = bookings
    .filter((b) => b.Status === "Confirmed")
    .reduce((s, b) => s + (b.TotalValue ?? 0), 0);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async (form: FormData) => {
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
    };

    if (editBooking) {
      const res = await fetchWithAuth(`${API}/${editBooking.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Update failed");
      }
      toast.success("Booking updated");
      const updated = await fetchWithAuth(`${API}/${editBooking.Id}`)
        .then((r) => r.json())
        .catch(() => null);
      if (updated) setSelectedBooking(updated);
    } else {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Create failed");
      }
      toast.success("Booking created");
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

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 max-w-[1400px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Breadcrumbs
              items={[
                { label: "Follow-Up", path: "/followup" },
                { label: "Sales" },
                { label: "Bookings", path: "/followup/sales/bookings" },
              ]}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className="p-2 rounded-xl bg-emerald-500/10">
                <BookOpen size={18} className="text-emerald-600" />
              </div>
              <div>
                <h1 className="text-xl font-heading font-bold text-foreground">
                  Bookings
                </h1>
                <p className="text-xs text-muted-foreground">
                  Unit bookings and agreements
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
            >
              <RefreshCw
                size={12}
                className={isLoading ? "animate-spin" : ""}
              />{" "}
              Refresh
            </button>
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors font-medium"
            >
              <Plus size={13} /> New Booking
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Total Bookings",
              value: total,
              icon: <BookOpen size={15} />,
              accent: "text-blue-600",
              bg: "bg-blue-500/10",
            },
            {
              label: "Confirmed",
              value: confirmed,
              icon: <CheckCircle size={15} />,
              accent: "text-emerald-600",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Pending",
              value: pending,
              icon: <AlertCircle size={15} />,
              accent: "text-amber-600",
              bg: "bg-amber-500/10",
            },
            {
              label: "Confirmed Value",
              value: fmtCurrency(totalValue) ?? "—",
              icon: <IndianRupee size={15} />,
              accent: "text-violet-600",
              bg: "bg-violet-500/10",
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className={`p-2 rounded-lg ${k.bg} w-fit mb-3`}>
                <span className={k.accent}>{k.icon}</span>
              </div>
              <p className="text-xl font-bold font-heading text-foreground leading-none">
                {k.value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {k.label}
              </p>
            </div>
          ))}
        </div>

        {/* Status pill filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setStatusFilter("");
              setPage(1);
            }}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors
              ${!statusFilter ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
          >
            All <span className="font-mono">{total}</span>
          </button>
          {STATUS_OPTIONS.map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(statusFilter === s ? "" : s);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors
                  ${statusFilter === s ? `${cfg.bg} ${cfg.text} border-current` : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> {s}
              </button>
            );
          })}
        </div>

        {/* Search + project filter */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="w-full pl-9 pr-9 py-2 border border-border rounded-lg text-sm bg-card text-foreground outline-none focus:border-primary/60 transition-colors"
              placeholder="Search name, booking no, unit, project…"
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            className="px-3 py-2 border border-border rounded-lg text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60 min-w-[140px]"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.Id} value={p.Id}>
                {p.Name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setProjectFilter("");
                setPage(1);
              }}
              className="flex items-center gap-1.5 px-3 py-2 border border-red-400/30 bg-red-500/5 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/10 transition-colors"
            >
              <X size={12} /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {total} booking{total !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
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
                      className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div
                            className="h-4 bg-muted rounded animate-pulse"
                            style={{ width: `${55 + Math.random() * 35}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : bookings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-4 rounded-2xl bg-muted">
                          <BookOpen
                            size={24}
                            className="text-muted-foreground"
                          />
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          No bookings found
                        </p>
                        {hasFilters ? (
                          <p className="text-xs text-muted-foreground">
                            Try clearing your filters
                          </p>
                        ) : (
                          <button
                            onClick={openNew}
                            className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors mt-1"
                          >
                            <Plus size={13} /> Add First Booking
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  bookings.map((b) => {
                    const bg = avatarColor(b.ApplicantName);
                    const isSelected = selectedBooking?.Id === b.Id;
                    return (
                      <tr
                        key={b.Id}
                        onClick={() =>
                          setSelectedBooking((prev) =>
                            prev?.Id === b.Id ? null : b,
                          )
                        }
                        className={`group cursor-pointer border-b border-border/50 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/40"}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                              style={{ background: bg }}
                            >
                              {initials(b.ApplicantName)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {b.ApplicantName}
                              </p>
                              <p className="text-[11px] font-mono text-muted-foreground">
                                {b.BookingNo ?? "—"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[12px] font-medium text-foreground">
                            {b.ProjectName ?? "—"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {[b.BlockName, b.UnitNo]
                              .filter(Boolean)
                              .join(" › ")}
                            {b.UnitType && ` · ${b.UnitType}`}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[12px] text-muted-foreground">
                            {fmtDate(b.BookingDate)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[12px] font-medium text-foreground">
                            {fmtCurrency(b.BookingAmount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[12px] font-semibold text-foreground">
                            {b.TotalValue ? fmtCurrency(b.TotalValue) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-muted-foreground">
                            {b.PaymentMode ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={b.Status} />
                        </td>
                        <td className="px-3 py-3 w-8">
                          <ChevronRight
                            size={15}
                            className={`text-muted-foreground/30 transition-all ${isSelected ? "text-primary" : "group-hover:text-primary group-hover:translate-x-0.5"}`}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-over form */}
      {showForm && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={closeForm}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[600px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                {editBooking
                  ? `Edit — ${editBooking.BookingNo ?? `Booking #${editBooking.Id}`}`
                  : "New Booking"}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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
        />
      )}
    </>
  );
}
