import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  FileText,
  IndianRupee,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  User,
  X,
  Sparkles,
  SlidersHorizontal,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  MapPin,
  Hash,
  Users,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/followup-applications";

type ApplicationStatus =
  | "New"
  | "Qualified"
  | "Shortlisted"
  | "Document Pending"
  | "Rejected";

interface Application {
  Id: number;
  ApplicantNo: string | null;
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
  City: string | null;
  Source: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  UnitId: number | null;
  UnitName: string | null;
  BlockName: string | null;
  CompanyId: number | null;
  PreferredUnitType: string | null;
  BudgetAmount: number | null;
  Status: ApplicationStatus;
  AssignedTo: number | null;
  AssignedToName: string | null;
  Notes: string | null;
  CreatedAt: string | null;
}

interface Option {
  Id: number;
  Name: string;
}

interface Customer extends Option {
  Phone: string | null;
  Email: string | null;
  Address?: string | null;
  PanNumber?: string | null;
  ContactPerson?: string | null;
}

interface UnitOption extends Option {
  ProjectId: number | null;
  BlockId: number | null;
  BlockName: string | null;
}

interface ListResponse {
  data: Application[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface OptionsResponse {
  projects: Option[];
  companies: Option[];
  users: Option[];
  statusOptions: ApplicationStatus[];
}

interface FormState {
  CustomerId: string;
  ApplicantName: string;
  PrimaryMobile: string;
  Email: string;
  PanNumber: string;
  ApplicantAddress: string;
  CoApplicantName: string;
  CoApplicantPhone: string;
  CorrespondenceAddress: string;
  ApplicationDate: string;
  City: string;
  Source: string;
  ProjectId: string;
  UnitId: string;
  CompanyId: string;
  PreferredUnitType: string;
  BudgetAmount: string;
  Status: ApplicationStatus;
  AssignedTo: string;
  Notes: string;
}

const emptyForm: FormState = {
  CustomerId: "",
  ApplicantName: "",
  PrimaryMobile: "",
  Email: "",
  PanNumber: "",
  ApplicantAddress: "",
  CoApplicantName: "",
  CoApplicantPhone: "",
  CorrespondenceAddress: "",
  ApplicationDate: new Date().toISOString().slice(0, 10),
  City: "",
  Source: "",
  ProjectId: "",
  UnitId: "",
  CompanyId: "",
  PreferredUnitType: "",
  BudgetAmount: "",
  Status: "New",
  AssignedTo: "",
  Notes: "",
};

const statusConfig: Record<
  ApplicationStatus,
  { color: string; dot: string; label: string }
> = {
  New: {
    color: "bg-sky-500/10 text-sky-500 border border-sky-400/20",
    dot: "bg-sky-500",
    label: "New",
  },
  Qualified: {
    color: "bg-emerald-500/10 text-emerald-500 border border-emerald-400/20",
    dot: "bg-emerald-500",
    label: "Qualified",
  },
  Shortlisted: {
    color: "bg-violet-500/10 text-violet-500 border border-violet-400/20",
    dot: "bg-violet-500",
    label: "Shortlisted",
  },
  "Document Pending": {
    color: "bg-amber-500/10 text-amber-500 border border-amber-400/20",
    dot: "bg-amber-500",
    label: "Doc Pending",
  },
  Rejected: {
    color: "bg-red-500/10 text-red-500 border border-red-400/20",
    dot: "bg-red-500",
    label: "Rejected",
  },
};

function toNullable(value: string) {
  return value.trim() === "" ? null : value.trim();
}

function toNullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: value >= 10000000 ? "compact" : "standard",
  }).format(value);
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const AVATAR_PALETTE = [
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-teal-600",
  "from-emerald-500 to-green-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-red-600",
  "from-pink-500 to-fuchsia-600",
  "from-indigo-500 to-blue-600",
];

function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const cfg = statusConfig[status] ?? statusConfig.New;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Drawer Section Header ────────────────────────────────────────────────────
function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  span2,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={`space-y-1.5 text-sm ${span2 ? "sm:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50";

const textareaClass =
  "min-h-[80px] w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 resize-none";

// ─── Styled Select ────────────────────────────────────────────────────────────
// Replaces native <select> to avoid OS-native dropdown styling on dark backgrounds.
interface SelectOption {
  value: string;
  label: string;
}

function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 flex items-center justify-between gap-2 hover:border-border/80"
      >
        <span
          className={selected ? "text-foreground" : "text-muted-foreground/60"}
        >
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-[200] mt-1 rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
          {placeholder && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted ${value === "" ? "text-foreground bg-muted/60 font-medium" : "text-muted-foreground"}`}
            >
              {placeholder}
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted flex items-center gap-2 ${value === opt.value ? "text-primary bg-primary/5 font-medium" : "text-foreground"}`}
            >
              {value === opt.value && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Customer Auto-Fill Banner ────────────────────────────────────────────────
function AutoFilledBanner({ customerName }: { customerName: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-emerald-600 text-xs font-medium">
      <Sparkles size={12} />
      Details auto-filled from customer master for{" "}
      <span className="font-bold">{customerName}</span>
    </div>
  );
}

// ─── Application Drawer ────────────────────────────────────────────────────────
function ApplicationDrawer({
  open,
  editing,
  form,
  options,
  customers,
  units,
  saving,
  onClose,
  onSubmit,
  onChange,
}: {
  open: boolean;
  editing: Application | null;
  form: FormState;
  options: OptionsResponse | undefined;
  customers: Customer[];
  units: UnitOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: (patch: Partial<FormState>) => void;
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const autoFilled = !!form.CustomerId;
  const selectedCustomer = customers.find(
    (c) => String(c.Id) === form.CustomerId,
  );

  const filteredCustomers = customers
    .filter(
      (c) =>
        c.Name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.Phone?.includes(customerSearch),
    )
    .slice(0, 8);

  function handleCustomerSelect(customer: Customer) {
    onChange({
      CustomerId: String(customer.Id),
      ApplicantName: customer.Name,
      PrimaryMobile: customer.Phone ?? form.PrimaryMobile,
      Email: customer.Email ?? form.Email,
      PanNumber: customer.PanNumber ?? form.PanNumber,
    });
    setCustomerSearch(customer.Name);
    setShowCustomerDropdown(false);
  }

  function handleClearCustomer() {
    onChange({
      CustomerId: "",
      ApplicantName: "",
      PrimaryMobile: "",
      Email: "",
    });
    setCustomerSearch("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm">
      <div
        className="h-full w-full max-w-[720px] flex flex-col border-l border-border bg-card shadow-2xl"
        style={{ animation: "slideInRight 0.22s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText size={15} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-none">
                {editing ? "Edit Application" : "New Application"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {editing?.ApplicantNo ??
                  "Fill in applicant and project details"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Customer Lookup */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Customer Lookup
              </p>
              <div className="flex-1 h-px bg-border" />
              {autoFilled && (
                <button
                  onClick={handleClearCustomer}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <X size={10} /> Clear
                </button>
              )}
            </div>

            {autoFilled ? (
              <div className="space-y-2">
                <AutoFilledBanner customerName={selectedCustomer?.Name ?? ""} />
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    className={`${inputClass} pl-9 pr-9`}
                    placeholder="Search by name or phone to auto-fill details…"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                  />
                  <ChevronDown
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                </div>
                {showCustomerDropdown && filteredCustomers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.Id}
                        onClick={() => handleCustomerSelect(c)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                      >
                        <div
                          className={`w-7 h-7 rounded-lg bg-gradient-to-br ${avatarGradient(c.Name)} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}
                        >
                          {initials(c.Name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {c.Name}
                          </p>
                          {c.Phone && (
                            <p className="text-xs text-muted-foreground">
                              {c.Phone}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                    <div className="px-4 py-2 border-t border-border">
                      <p className="text-[11px] text-muted-foreground">
                        Or fill in manually below for a walk-in customer
                      </p>
                    </div>
                  </div>
                )}
                {showCustomerDropdown &&
                  customerSearch &&
                  filteredCustomers.length === 0 && (
                    <div
                      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        No matching customers — fill in manually below
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Applicant Info */}
          <DrawerSection title="Applicant Info">
            <Field label="Full Name">
              <input
                className={inputClass}
                value={form.ApplicantName}
                placeholder="Enter applicant name"
                onChange={(e) => onChange({ ApplicantName: e.target.value })}
              />
            </Field>
            <Field label="Mobile">
              <input
                className={inputClass}
                value={form.PrimaryMobile}
                placeholder="+91 00000 00000"
                onChange={(e) => onChange({ PrimaryMobile: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={form.Email}
                placeholder="applicant@email.com"
                onChange={(e) => onChange({ Email: e.target.value })}
              />
            </Field>
            <Field label="PAN">
              <input
                className={inputClass}
                value={form.PanNumber}
                placeholder="ABCDE1234F"
                onChange={(e) =>
                  onChange({ PanNumber: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="City">
              <input
                className={inputClass}
                value={form.City}
                placeholder="City"
                onChange={(e) => onChange({ City: e.target.value })}
              />
            </Field>
            <Field label="Application Date">
              <input
                className={inputClass}
                type="date"
                value={form.ApplicationDate}
                onChange={(e) => onChange({ ApplicationDate: e.target.value })}
              />
            </Field>
            <Field label="Applicant Address" span2>
              <textarea
                className={textareaClass}
                value={form.ApplicantAddress}
                placeholder="Residential address"
                onChange={(e) => onChange({ ApplicantAddress: e.target.value })}
              />
            </Field>
          </DrawerSection>

          {/* Co-applicant */}
          <DrawerSection title="Co-Applicant">
            <Field label="Co-applicant Name">
              <input
                className={inputClass}
                value={form.CoApplicantName}
                placeholder="Co-applicant full name"
                onChange={(e) => onChange({ CoApplicantName: e.target.value })}
              />
            </Field>
            <Field label="Co-applicant Phone">
              <input
                className={inputClass}
                value={form.CoApplicantPhone}
                placeholder="+91 00000 00000"
                onChange={(e) => onChange({ CoApplicantPhone: e.target.value })}
              />
            </Field>
            <Field label="Correspondence Address" span2>
              <textarea
                className={textareaClass}
                value={form.CorrespondenceAddress}
                placeholder="Correspondence / mailing address"
                onChange={(e) =>
                  onChange({ CorrespondenceAddress: e.target.value })
                }
              />
            </Field>
          </DrawerSection>

          {/* Project & Unit */}
          <DrawerSection title="Project & Preferences">
            <Field label="Project">
              <StyledSelect
                value={form.ProjectId}
                onChange={(v) => onChange({ ProjectId: v, UnitId: "" })}
                placeholder="Select project"
                options={(options?.projects ?? []).map((p) => ({
                  value: String(p.Id),
                  label: p.Name,
                }))}
              />
            </Field>
            <Field label="Preferred Unit">
              <StyledSelect
                value={form.UnitId}
                onChange={(v) => onChange({ UnitId: v })}
                placeholder="No unit selected"
                options={units.map((u) => ({
                  value: String(u.Id),
                  label: u.BlockName ? `${u.BlockName} – ${u.Name}` : u.Name,
                }))}
              />
            </Field>
            <Field label="Company">
              <StyledSelect
                value={form.CompanyId}
                onChange={(v) => onChange({ CompanyId: v })}
                placeholder="Select company"
                options={(options?.companies ?? []).map((c) => ({
                  value: String(c.Id),
                  label: c.Name,
                }))}
              />
            </Field>
            <Field label="Preferred Type">
              <input
                className={inputClass}
                placeholder="2 BHK, 3 BHK, Villa…"
                value={form.PreferredUnitType}
                onChange={(e) =>
                  onChange({ PreferredUnitType: e.target.value })
                }
              />
            </Field>
            <Field label="Budget (₹)">
              <input
                className={inputClass}
                type="number"
                min="0"
                value={form.BudgetAmount}
                placeholder="0"
                onChange={(e) => onChange({ BudgetAmount: e.target.value })}
              />
            </Field>
            <Field label="Source">
              <input
                className={inputClass}
                value={form.Source}
                placeholder="Referral, Website, Site Visit…"
                onChange={(e) => onChange({ Source: e.target.value })}
              />
            </Field>
          </DrawerSection>

          {/* Assignment */}
          <DrawerSection title="Status & Assignment">
            <Field label="Status">
              <StyledSelect
                value={form.Status}
                onChange={(v) => onChange({ Status: v as ApplicationStatus })}
                options={(options?.statusOptions ?? []).map((s) => ({
                  value: s,
                  label: s,
                }))}
              />
            </Field>
            <Field label="Assigned To">
              <StyledSelect
                value={form.AssignedTo}
                onChange={(v) => onChange({ AssignedTo: v })}
                placeholder="Unassigned"
                options={(options?.users ?? []).map((u) => ({
                  value: String(u.Id),
                  label: u.Name,
                }))}
              />
            </Field>
            <Field label="Notes" span2>
              <textarea
                className={textareaClass}
                value={form.Notes}
                placeholder="Any additional notes or observations…"
                onChange={(e) => onChange({ Notes: e.target.value })}
              />
            </Field>
          </DrawerSection>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border bg-card px-6 py-4 shrink-0">
          <Button variant="outline" onClick={onClose} className="h-9">
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving}
            className="gradient-accent text-white h-9 px-5 font-semibold"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {editing ? "Update" : "Create Application"}
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  iconBg,
  iconColor,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  iconBg: string;
  iconColor: string;
  trend?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 hover:border-border/80 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2 rounded-xl ${iconBg} group-hover:scale-105 transition-transform`}
        >
          <span className={iconColor}>{icon}</span>
        </div>
        {trend && (
          <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 rounded-full px-2 py-0.5">
            {trend}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold font-heading text-foreground leading-none tracking-tight">
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ApplicationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data: options } = useQuery<OptionsResponse>({
    queryKey: ["followup-applications-options"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/options`);
      if (!res.ok) throw new Error("Failed to load application options");
      return res.json();
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["followup-application-customers"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/customers`);
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json();
    },
  });

  const { data: units = [] } = useQuery<UnitOption[]>({
    queryKey: ["followup-application-units", form.ProjectId],
    queryFn: async () => {
      const params = form.ProjectId ? `?projectId=${form.ProjectId}` : "";
      const res = await fetchWithAuth(`${API}/units${params}`);
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
    enabled: drawerOpen,
  });

  const queryParams = useMemo(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("pageSize", "20");
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (status) query.set("status", status);
    if (projectId) query.set("projectId", projectId);
    return query.toString();
  }, [debouncedSearch, page, projectId, status]);

  const { data, isLoading, isFetching, refetch } = useQuery<ListResponse>({
    queryKey: ["followup-applications", queryParams],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}?${queryParams}`);
      if (!res.ok) throw new Error("Failed to load applications");
      return res.json();
    },
  });

  const applications = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const totals = useMemo(() => {
    const list = applications;
    return {
      total: pagination?.total ?? 0,
      active: list.filter((item) => item.Status !== "Rejected").length,
      pendingDocs: list.filter((item) => item.Status === "Document Pending")
        .length,
      budget: list.reduce(
        (sum, item) => sum + Number(item.BudgetAmount ?? 0),
        0,
      ),
    };
  }, [applications, pagination?.total]);

  function resetAndOpen() {
    setEditing(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function editApplication(application: Application) {
    setEditing(application);
    setForm({
      CustomerId: application.CustomerId ? String(application.CustomerId) : "",
      ApplicantName: application.ApplicantName ?? "",
      PrimaryMobile: application.PrimaryMobile ?? "",
      Email: application.Email ?? "",
      PanNumber: application.PanNumber ?? "",
      ApplicantAddress: application.ApplicantAddress ?? "",
      CoApplicantName: application.CoApplicantName ?? "",
      CoApplicantPhone: application.CoApplicantPhone ?? "",
      CorrespondenceAddress: application.CorrespondenceAddress ?? "",
      ApplicationDate:
        application.ApplicationDate ?? new Date().toISOString().slice(0, 10),
      City: application.City ?? "",
      Source: application.Source ?? "",
      ProjectId: application.ProjectId ? String(application.ProjectId) : "",
      UnitId: application.UnitId ? String(application.UnitId) : "",
      CompanyId: application.CompanyId ? String(application.CompanyId) : "",
      PreferredUnitType: application.PreferredUnitType ?? "",
      BudgetAmount:
        application.BudgetAmount == null
          ? ""
          : String(application.BudgetAmount),
      Status: application.Status,
      AssignedTo: application.AssignedTo ? String(application.AssignedTo) : "",
      Notes: application.Notes ?? "",
    });
    setDrawerOpen(true);
  }

  async function saveApplication() {
    if (!form.ApplicantName.trim()) {
      toast.error("Applicant name is required");
      return;
    }

    const payload = {
      CustomerId: toNullableNumber(form.CustomerId),
      ApplicantName: form.ApplicantName.trim(),
      PrimaryMobile: toNullable(form.PrimaryMobile),
      Email: toNullable(form.Email),
      PanNumber: toNullable(form.PanNumber),
      ApplicantAddress: toNullable(form.ApplicantAddress),
      CoApplicantName: toNullable(form.CoApplicantName),
      CoApplicantPhone: toNullable(form.CoApplicantPhone),
      CorrespondenceAddress: toNullable(form.CorrespondenceAddress),
      ApplicationDate: toNullable(form.ApplicationDate),
      City: toNullable(form.City),
      Source: toNullable(form.Source),
      ProjectId: toNullableNumber(form.ProjectId),
      UnitId: toNullableNumber(form.UnitId),
      CompanyId: toNullableNumber(form.CompanyId),
      PreferredUnitType: toNullable(form.PreferredUnitType),
      BudgetAmount: toNullableNumber(form.BudgetAmount),
      Status: form.Status,
      AssignedTo: toNullableNumber(form.AssignedTo),
      Notes: toNullable(form.Notes),
    };

    setSaving(true);
    try {
      const res = await fetchWithAuth(editing ? `${API}/${editing.Id}` : API, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Failed to save application",
        );
      }
      toast.success(editing ? "Application updated" : "Application created");
      setDrawerOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["followup-applications"],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApplication(application: Application) {
    if (!window.confirm(`Delete application for ${application.ApplicantName}?`))
      return;
    try {
      const res = await fetchWithAuth(`${API}/${application.Id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Failed to delete application",
        );
      }
      toast.success("Application deleted");
      await queryClient.invalidateQueries({
        queryKey: ["followup-applications"],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    }
  }

  const hasFilters = !!(search || status || projectId);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Sales" },
          { label: "Applications", path: "/followup/sales/applications" },
        ]}
      />

      <div className="relative space-y-6 mt-6">
        {/* Page Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Applications
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Track and manage sales applications before unit selection and
              booking.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                size={12}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              onClick={resetAndOpen}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm h-9 px-4"
            >
              <Plus size={14} />
              New Application
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<Users size={16} />}
            label="Total Applications"
            value={totals.total}
            iconBg="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            icon={<UserCheck size={16} />}
            label="Active on Page"
            value={totals.active}
            iconBg="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            icon={<AlertTriangle size={16} />}
            label="Docs Pending"
            value={totals.pendingDocs}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            icon={<TrendingUp size={16} />}
            label="Budget on Page"
            value={formatCurrency(totals.budget)}
            iconBg="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>

        {/* Table Card */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          {/* Filters */}
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-lg border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50"
                placeholder="Search name, mobile, email, PAN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SlidersHorizontal size={14} className="text-muted-foreground" />
              <div className="relative">
                <select
                  className="h-9 appearance-none rounded-lg border border-border bg-card px-3 pr-8 text-sm text-foreground outline-none focus:border-primary/60 min-w-[150px] cursor-pointer"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Statuses</option>
                  {options?.statusOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
              </div>
              <div className="relative">
                <select
                  className="h-9 appearance-none rounded-lg border border-border bg-card px-3 pr-8 text-sm text-foreground outline-none focus:border-primary/60 min-w-[160px] cursor-pointer"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Projects</option>
                  {options?.projects.map((p) => (
                    <option key={p.Id} value={p.Id}>
                      {p.Name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
              </div>
              {hasFilters && (
                <button
                  onClick={() => {
                    setSearch("");
                    setStatus("");
                    setProjectId("");
                    setPage(1);
                  }}
                  className="h-9 px-3 rounded-lg text-xs border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {[
                    "Applicant",
                    "Contact",
                    "Project / Unit",
                    "Date",
                    "Budget",
                    "Status",
                    "Assigned To",
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
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-16 text-center text-muted-foreground"
                    >
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      <p className="text-sm">Loading applications…</p>
                    </td>
                  </tr>
                ) : applications.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText size={32} className="opacity-20" />
                        <p className="text-sm">No applications found</p>
                        {hasFilters && (
                          <button
                            onClick={() => {
                              setSearch("");
                              setStatus("");
                              setProjectId("");
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  applications.map((app) => (
                    <tr
                      key={app.Id}
                      className="align-middle hover:bg-muted/30 transition-colors cursor-pointer group"
                      onClick={() =>
                        navigate(`/followup/sales/applications/${app.Id}`)
                      }
                    >
                      {/* Applicant */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br ${avatarGradient(app.ApplicantName)} flex items-center justify-center text-xs font-bold text-white`}
                          >
                            {initials(app.ApplicantName)}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground text-[13px]">
                              {app.ApplicantName}
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground">
                              {app.ApplicantNo ?? `APP-${app.Id}`}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Contact */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {app.PrimaryMobile && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Phone size={10} />
                              {app.PrimaryMobile}
                            </div>
                          )}
                          {app.Email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Mail size={10} />
                              <span className="truncate max-w-[140px]">
                                {app.Email}
                              </span>
                            </div>
                          )}
                          {app.City && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <MapPin size={10} />
                              {app.City}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Project / Unit */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Building2
                            size={13}
                            className="text-muted-foreground mt-0.5 shrink-0"
                          />
                          <div>
                            <div className="text-[13px] font-medium text-foreground">
                              {app.ProjectName ?? "—"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {app.UnitName
                                ? `${app.BlockName ? `${app.BlockName} / ` : ""}${app.UnitName}`
                                : (app.PreferredUnitType ?? "No preference")}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                        {formatDate(app.ApplicationDate)}
                      </td>
                      {/* Budget */}
                      <td className="px-4 py-3 text-[13px] font-semibold text-foreground whitespace-nowrap">
                        {formatCurrency(app.BudgetAmount)}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={app.Status} />
                      </td>
                      {/* Assigned */}
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {app.AssignedToName ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary">
                              {initials(app.AssignedToName)}
                            </div>
                            {app.AssignedToName}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              navigate(`/followup/sales/applications/${app.Id}`)
                            }
                            title="View"
                          >
                            <Eye size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => editApplication(app)}
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteApplication(app)}
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col gap-3 border-t border-border p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Page {pagination?.page ?? 1} of {totalPages} ·{" "}
              {pagination?.total ?? 0} total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((c) => Math.max(1, c - 1))}
                className="h-8 rounded-lg text-xs"
              >
                <ChevronLeft size={13} className="mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((c) => c + 1)}
                className="h-8 rounded-lg text-xs"
              >
                Next
                <ChevronRight size={13} className="ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ApplicationDrawer
        open={drawerOpen}
        editing={editing}
        form={form}
        options={options}
        customers={customers}
        units={units}
        saving={saving}
        onClose={() => setDrawerOpen(false)}
        onSubmit={saveApplication}
        onChange={(patch) => setForm((c) => ({ ...c, ...patch }))}
      />
    </>
  );
}
