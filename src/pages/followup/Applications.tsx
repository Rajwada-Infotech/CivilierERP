import React, { useState, useEffect, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  X,
  RefreshCw,
  User,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Calendar,
  Building2,
  Home,
  FileText,
  Users,
  ChevronDown,
  Save,
  Loader2,
  Edit2,
  IndianRupee,
  Tag,
  UserCheck,
  Hash,
  Clock,
  Filter,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Trash2,
  MoreVertical,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Application {
  Id: number;
  ApplicantNo: string;
  CustomerId: number | null;
  ApplicantName: string;
  PrimaryMobile: string | null;
  Email: string | null;
  PanNumber: string | null;
  ApplicantAddress: string | null;
  CoApplicantName: string | null;
  CoApplicantPhone: string | null;
  CorrespondenceAddress: string | null;
  ApplicationDate: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  UnitId: number | null;
  UnitName: string | null;
  BlockName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  City: string | null;
  Source: string | null;
  PreferredUnitType: string | null;
  BudgetAmount: number | null;
  AssignedTo: number | null;
  AssignedToName: string | null;
  Status: string;
  Notes: string | null;
  CreatedBy: string | null;
  CreatedAt: string | null;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}
interface Customer {
  Id: number;
  Name: string;
  Phone: string | null;
  Email: string | null;
}
interface Project {
  Id: number;
  Name: string;
}
interface Unit {
  Id: number;
  Name: string;
  ProjectId: number;
  BlockId: number;
  BlockName: string | null;
}

const API = "/api/followup-applications";

const STATUS_OPTIONS = [
  "New",
  "Qualified",
  "Shortlisted",
  "Document Pending",
  "Rejected",
];

const STATUS_CONFIG: Record<string, { dot: string; text: string; bg: string }> =
  {
    New: {
      dot: "bg-blue-500",
      text: "text-blue-700 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20",
    },
    Qualified: {
      dot: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20",
    },
    Shortlisted: {
      dot: "bg-violet-500",
      text: "text-violet-700 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/20",
    },
    "Document Pending": {
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
    },
    Rejected: {
      dot: "bg-red-500",
      text: "text-red-700 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
    },
  };

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

// ── Searchable Combobox ───────────────────────────────────────────────────────
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
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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

// ── Application Form ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  customerId: "",
  applicantName: "",
  primaryMobile: "",
  email: "",
  panNumber: "",
  applicantAddress: "",
  coApplicantName: "",
  coApplicantPhone: "",
  correspondenceAddress: "",
  applicationDate: "",
  projectId: "",
  unitId: "",
  status: "New",
  notes: "",
};
type FormData = typeof EMPTY_FORM;

function ApplicationForm({
  initial,
  onSave,
  onCancel,
  customers,
  projects,
  units,
}: {
  initial?: Partial<FormData>;
  onSave: (data: FormData) => Promise<void>;
  onCancel: () => void;
  customers: Customer[];
  projects: Project[];
  units: Unit[];
}) {
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormData) => (v: string) =>
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "projectId") next.unitId = "";
      return next;
    });

  const customerOpts = customers.map((c) => ({
    value: String(c.Id),
    label: c.Name,
    sub: [c.Phone, c.Email].filter(Boolean).join(" · "),
  }));
  const projectOpts = projects.map((p) => ({
    value: String(p.Id),
    label: p.Name,
  }));
  const unitOpts = units
    .filter((u) => !form.projectId || String(u.ProjectId) === form.projectId)
    .map((u) => ({
      value: String(u.Id),
      label: u.BlockName ? `${u.BlockName} › ${u.Name}` : u.Name,
    }));

  const handleSave = async () => {
    if (!form.customerId) {
      toast.error("Applicant is required");
      return;
    }
    if (!form.projectId) {
      toast.error("Project is required");
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
            <User size={11} className="text-blue-500" /> Applicant Details
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Combobox
                label="Applicant Name"
                required
                value={form.customerId}
                onChange={set("customerId")}
                options={customerOpts}
                placeholder="Select applicant..."
              />
            </div>
            <div>
              <label className={labelCls}>Application Date</label>
              <input
                type="date"
                className={inputCls}
                value={form.applicationDate}
                onChange={(e) => set("applicationDate")(e.target.value)}
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
            <div>
              <label className={labelCls}>Phone Number</label>
              <input
                className={inputCls}
                placeholder="+91 XXXXX XXXXX"
                value={form.primaryMobile}
                onChange={(e) => set("primaryMobile")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Email Address</label>
              <input
                type="email"
                className={inputCls}
                placeholder="name@example.com"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>PAN Number</label>
              <input
                className={`${inputCls} uppercase`}
                placeholder="ABCDE1234F"
                maxLength={10}
                value={form.panNumber}
                onChange={(e) => set("panNumber")(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className={labelCls}>City</label>
              <input
                className={inputCls}
                placeholder="City"
                value={(form as any).city ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, city: e.target.value }))
                }
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Applicant Address</label>
              <textarea
                rows={2}
                className={inputCls}
                placeholder="Full address..."
                value={form.applicantAddress}
                onChange={(e) => set("applicantAddress")(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Property */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <Building2 size={11} className="text-violet-500" /> Property Details
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Combobox
                label="Project"
                required
                value={form.projectId}
                onChange={set("projectId")}
                options={projectOpts}
                placeholder="Select project..."
              />
            </div>
            <div>
              <Combobox
                label="Unit"
                value={form.unitId}
                onChange={set("unitId")}
                options={unitOpts}
                placeholder="Select unit..."
                disabled={!form.projectId}
              />
            </div>
          </div>
        </section>

        {/* Co-Applicant */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <Users size={11} className="text-amber-500" /> Co-Applicant
            (Optional)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name</label>
              <input
                className={inputCls}
                placeholder="Full name"
                value={form.coApplicantName}
                onChange={(e) => set("coApplicantName")(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input
                className={inputCls}
                placeholder="+91 XXXXX XXXXX"
                value={form.coApplicantPhone}
                onChange={(e) => set("coApplicantPhone")(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Correspondence Address</label>
              <textarea
                rows={2}
                className={inputCls}
                placeholder="If different from applicant address..."
                value={form.correspondenceAddress}
                onChange={(e) => set("correspondenceAddress")(e.target.value)}
              />
            </div>
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

      {/* Footer */}
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
          {saving ? "Saving…" : "Save Application"}
        </button>
      </div>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
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

function ApplicationDrawer({
  app,
  onClose,
  onEdit,
}: {
  app: Application;
  onClose: () => void;
  onEdit: () => void;
}) {
  const bg = avatarColor(app.ApplicantName);
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[600px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                style={{ background: bg }}
              >
                {initials(app.ApplicantName)}
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-foreground leading-tight">
                  {app.ApplicantName}
                </h2>
                {app.ApplicantNo && (
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {app.ApplicantNo}
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
            <StatusBadge status={app.Status} />
            {app.ApplicationDate && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted rounded-md px-2 py-0.5 border border-border">
                <Calendar size={10} /> {fmtDate(app.ApplicationDate)}
              </span>
            )}
            {app.BudgetAmount && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-md px-2 py-0.5">
                <IndianRupee size={10} /> {fmtCurrency(app.BudgetAmount)}
              </span>
            )}
          </div>
          {(app.PrimaryMobile || app.Email) && (
            <div className="flex flex-wrap gap-3 mt-2.5">
              {app.PrimaryMobile && (
                <a
                  href={`tel:${app.PrimaryMobile}`}
                  className="flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  <Phone size={11} /> {app.PrimaryMobile}
                </a>
              )}
              {app.Email && (
                <a
                  href={`mailto:${app.Email}`}
                  className="flex items-center gap-1 text-[12px] text-primary hover:underline truncate max-w-full"
                >
                  <Mail size={11} /> {app.Email}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <DetailSection title="Applicant">
            <DetailRow
              label="PAN Number"
              value={app.PanNumber}
              icon={<CreditCard size={12} />}
            />
            <DetailRow
              label="City"
              value={app.City}
              icon={<MapPin size={12} />}
            />
            <DetailRow
              label="Address"
              value={app.ApplicantAddress}
              icon={<MapPin size={12} />}
            />
          </DetailSection>

          {(app.ProjectName ||
            app.UnitName ||
            app.CompanyName ||
            app.PreferredUnitType) && (
            <DetailSection title="Property">
              <DetailRow
                label="Project"
                value={app.ProjectName}
                icon={<Building2 size={12} />}
              />
              {(app.BlockName || app.UnitName) && (
                <DetailRow
                  label="Unit"
                  value={[app.BlockName, app.UnitName]
                    .filter(Boolean)
                    .join(" › ")}
                  icon={<Home size={12} />}
                />
              )}
              <DetailRow
                label="Company"
                value={app.CompanyName}
                icon={<Building2 size={12} />}
              />
              <DetailRow
                label="Preferred Type"
                value={app.PreferredUnitType}
                icon={<Home size={12} />}
              />
            </DetailSection>
          )}

          {(app.CoApplicantName ||
            app.CoApplicantPhone ||
            app.CorrespondenceAddress) && (
            <DetailSection title="Co-Applicant">
              <DetailRow
                label="Name"
                value={app.CoApplicantName}
                icon={<User size={12} />}
              />
              <DetailRow
                label="Phone"
                value={app.CoApplicantPhone}
                icon={<Phone size={12} />}
              />
              <DetailRow
                label="Correspondence Address"
                value={app.CorrespondenceAddress}
                icon={<MapPin size={12} />}
              />
            </DetailSection>
          )}

          {(app.Source || app.AssignedToName) && (
            <DetailSection title="Lead Info">
              <DetailRow
                label="Source"
                value={app.Source}
                icon={<Tag size={12} />}
              />
              <DetailRow
                label="Assigned To"
                value={app.AssignedToName}
                icon={<UserCheck size={12} />}
              />
            </DetailSection>
          )}

          {app.Notes && (
            <DetailSection title="Notes">
              <div className="py-3">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {app.Notes}
                </p>
              </div>
            </DetailSection>
          )}

          <DetailSection title="Audit">
            <DetailRow
              label="Application No"
              value={app.ApplicantNo}
              icon={<Hash size={12} />}
            />
            <DetailRow
              label="Created"
              value={
                app.CreatedBy
                  ? `${app.CreatedBy} · ${fmtDate(app.CreatedAt)}`
                  : fmtDate(app.CreatedAt)
              }
              icon={<Clock size={12} />}
            />
            <DetailRow
              label="Last Updated"
              value={
                app.UpdatedBy
                  ? `${app.UpdatedBy} · ${fmtDate(app.UpdatedAt)}`
                  : fmtDate(app.UpdatedAt)
              }
              icon={<Clock size={12} />}
            />
          </DetailSection>
        </div>
      </div>
    </>
  );
}

// ── Table Row ─────────────────────────────────────────────────────────────────
function TableRow({
  app,
  onClick,
  isSelected,
}: {
  app: Application;
  onClick: () => void;
  isSelected: boolean;
}) {
  const bg = avatarColor(app.ApplicantName);
  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer border-b border-border/50 transition-colors
      ${isSelected ? "bg-primary/5" : "hover:bg-muted/40"}`}
    >
      {/* Applicant */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: bg }}
          >
            {initials(app.ApplicantName)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {app.ApplicantName}
            </p>
            {app.ApplicantNo && (
              <p className="text-[11px] font-mono text-muted-foreground">
                {app.ApplicantNo}
              </p>
            )}
          </div>
        </div>
      </td>
      {/* Contact */}
      <td className="px-4 py-3">
        <div className="space-y-0.5">
          {app.PrimaryMobile && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Phone size={11} className="flex-shrink-0" /> {app.PrimaryMobile}
            </p>
          )}
          {app.Email && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground truncate max-w-[160px]">
              <Mail size={11} className="flex-shrink-0" />{" "}
              <span className="truncate">{app.Email}</span>
            </p>
          )}
          {!app.PrimaryMobile && !app.Email && (
            <span className="text-[12px] text-muted-foreground/50">—</span>
          )}
        </div>
      </td>
      {/* Project / Unit */}
      <td className="px-4 py-3">
        {app.ProjectName ? (
          <div>
            <p className="text-[12px] font-medium text-foreground">
              {app.ProjectName}
            </p>
            {(app.BlockName || app.UnitName) && (
              <p className="text-[11px] text-muted-foreground">
                {[app.BlockName, app.UnitName].filter(Boolean).join(" › ")}
              </p>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground/50">—</span>
        )}
      </td>
      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={app.Status} />
      </td>
      {/* Date */}
      <td className="px-4 py-3">
        <span className="text-[12px] text-muted-foreground">
          {fmtDate(app.ApplicationDate)}
        </span>
      </td>
      {/* Budget */}
      <td className="px-4 py-3">
        {app.BudgetAmount ? (
          <span className="text-[12px] font-medium text-foreground">
            {fmtCurrency(app.BudgetAmount)}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/50">—</span>
        )}
      </td>
      {/* Arrow */}
      <td className="px-3 py-3 w-8">
        <ChevronRight
          size={15}
          className={`text-muted-foreground/30 transition-all ${isSelected ? "text-primary" : "group-hover:text-primary group-hover:translate-x-0.5"}`}
        />
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const Applications: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [projectFilter, setProjectFilter] = useState<string | undefined>(
    undefined,
  );
  const [showForm, setShowForm] = useState(false);
  const [editApp, setEditApp] = useState<Application | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

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

  // Queries
  const {
    data: appData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      "followup-applications",
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
      p.set("pageSize", String(pageSize));
      const res = await fetchWithAuth(`${API}?${p}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<{
        data: Application[];
        pagination: { total: number; totalPages: number };
      }>;
    },
    staleTime: 60_000,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["followup-app-customers"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/customers`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 300_000,
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["followup-app-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 600_000,
  });
  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ["followup-app-units"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/units`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 300_000,
  });

  const apps = appData?.data ?? [];
  const totalPages = appData?.pagination?.totalPages ?? 1;
  const total = appData?.pagination?.total ?? 0;
  const hasFilters = !!(search || statusFilter || projectFilter);

  const statusCounts = {
    New: apps.filter((a) => a.Status === "New").length,
    Qualified: apps.filter((a) => a.Status === "Qualified").length,
    Shortlisted: apps.filter((a) => a.Status === "Shortlisted").length,
    "Document Pending": apps.filter((a) => a.Status === "Document Pending")
      .length,
  };

  // Save
  const handleSave = async (form: FormData) => {
    const customerName =
      customers.find((c) => String(c.Id) === form.customerId)?.Name ?? "";
    const payload = {
      CustomerId: form.customerId ? parseInt(form.customerId) : null,
      ApplicantName: customerName || form.customerId,
      PrimaryMobile: form.primaryMobile || null,
      Email: form.email || null,
      PanNumber: form.panNumber || null,
      ApplicantAddress: form.applicantAddress || null,
      CoApplicantName: form.coApplicantName || null,
      CoApplicantPhone: form.coApplicantPhone || null,
      CorrespondenceAddress: form.correspondenceAddress || null,
      ApplicationDate: form.applicationDate || null,
      ProjectId: form.projectId ? parseInt(form.projectId) : null,
      UnitId: form.unitId ? parseInt(form.unitId) : null,
      Status: form.status,
      Notes: form.notes || null,
    };
    if (editApp) {
      const res = await fetchWithAuth(`${API}/${editApp.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Update failed");
      }
      toast.success("Application updated");
      const updated = await fetchWithAuth(`${API}/${editApp.Id}`)
        .then((r) => r.json())
        .catch(() => null);
      if (updated) setSelectedApp(updated);
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
      toast.success("Application created");
    }
    await queryClient.invalidateQueries({
      queryKey: ["followup-applications"],
    });
    setShowForm(false);
    setEditApp(null);
  };

  const openNew = () => {
    setEditApp(null);
    setSelectedApp(null);
    setShowForm(true);
  };
  const openEdit = (app: Application) => {
    setEditApp(app);
    setSelectedApp(null);
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditApp(null);
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Applications", path: "/followup/sales/applicants" },
        ]}
      />
      <div className="relative space-y-8 mt-6">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Applications
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Property applications and leads
            </p>
          </div>
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
            <Button
              size="sm"
              onClick={openNew}
              className="shrink-0 gradient-accent text-white shadow-sm font-heading font-semibold gap-1.5"
            >
              <Plus size={14} />
              New Application
            </Button>
          </div>
        </div>

        {/* ── Status pill filters ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter(undefined)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors
              ${!statusFilter ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
          >
            All <span className="font-mono">{total}</span>
          </button>
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <button
              key={s}
              onClick={() =>
                setStatusFilter(statusFilter === s ? undefined : s)
              }
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors
                ${statusFilter === s ? `${cfg.bg} ${cfg.text} border-current` : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {s}
            </button>
          ))}
        </div>

        {/* ── Search + filters bar ── */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="w-full pl-9 pr-9 py-2 border border-border rounded-lg text-sm bg-card text-foreground outline-none focus:border-primary/60 transition-colors"
              placeholder="Search name, mobile, email, PAN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            className="px-3 py-2 border border-border rounded-lg text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60 min-w-[140px]"
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
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter(undefined);
                setProjectFilter(undefined);
              }}
              className="flex items-center gap-1.5 px-3 py-2 border border-red-400/30 bg-red-500/5 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/10 transition-colors"
            >
              <X size={12} /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {total} application{total !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Applicant
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Project / Unit
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Date
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Budget
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div
                            className="h-4 bg-muted rounded animate-pulse"
                            style={{ width: `${60 + Math.random() * 30}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : apps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-4 rounded-2xl bg-muted">
                          <FileText
                            size={24}
                            className="text-muted-foreground"
                          />
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          No applications found
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
                            <Plus size={13} /> Add First Application
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  apps.map((a) => (
                    <TableRow
                      key={a.Id}
                      app={a}
                      onClick={() =>
                        setSelectedApp((prev) => (prev?.Id === a.Id ? null : a))
                      }
                      isSelected={selectedApp?.Id === a.Id}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
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

      {/* ── Slide-over Form ── */}
      {showForm && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={closeForm}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[600px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                {editApp ? `Edit — ${editApp.ApplicantNo}` : "New Application"}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ApplicationForm
                key={editApp?.Id ?? "new"}
                initial={
                  editApp
                    ? {
                        customerId: String(editApp.CustomerId ?? ""),
                        applicantName: editApp.ApplicantName,
                        primaryMobile: editApp.PrimaryMobile ?? "",
                        email: editApp.Email ?? "",
                        panNumber: editApp.PanNumber ?? "",
                        applicantAddress: editApp.ApplicantAddress ?? "",
                        coApplicantName: editApp.CoApplicantName ?? "",
                        coApplicantPhone: editApp.CoApplicantPhone ?? "",
                        correspondenceAddress:
                          editApp.CorrespondenceAddress ?? "",
                        applicationDate:
                          editApp.ApplicationDate?.slice(0, 10) ?? "",
                        projectId: String(editApp.ProjectId ?? ""),
                        unitId: String(editApp.UnitId ?? ""),
                        status: editApp.Status,
                        notes: editApp.Notes ?? "",
                      }
                    : undefined
                }
                onSave={handleSave}
                onCancel={closeForm}
                customers={customers}
                projects={projects}
                units={units}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Detail Drawer ── */}
      {selectedApp && !showForm && (
        <ApplicationDrawer
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onEdit={() => openEdit(selectedApp)}
        />
      )}
    </>
  );
};

export default Applications;
