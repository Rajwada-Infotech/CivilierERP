import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  FileText,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
  Sparkles,
  MapPin,
  Users,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";

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

// Status visual config — each status gets a unique look
const statusConfig: Record<
  ApplicationStatus,
  {
    pill: string;
    dot: string;
    label: string;
    track: string; // for the status pipeline bar
    glow: string; // row hover glow
  }
> = {
  New: {
    pill: "bg-sky-500/10 text-sky-400 ring-1 ring-sky-400/25",
    dot: "bg-sky-400",
    label: "New",
    track: "bg-sky-500",
    glow: "hover:shadow-[inset_3px_0_0_hsl(199_89%_48%)]",
  },
  Qualified: {
    pill: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400/25",
    dot: "bg-emerald-400",
    label: "Qualified",
    track: "bg-emerald-500",
    glow: "hover:shadow-[inset_3px_0_0_hsl(160_84%_39%)]",
  },
  Shortlisted: {
    pill: "bg-violet-500/10 text-violet-400 ring-1 ring-violet-400/25",
    dot: "bg-violet-400",
    label: "Shortlisted",
    track: "bg-violet-500",
    glow: "hover:shadow-[inset_3px_0_0_hsl(263_70%_58%)]",
  },
  "Document Pending": {
    pill: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-400/25",
    dot: "bg-amber-400",
    label: "Doc Pending",
    track: "bg-amber-500",
    glow: "hover:shadow-[inset_3px_0_0_hsl(38_92%_50%)]",
  },
  Rejected: {
    pill: "bg-red-500/10 text-red-400 ring-1 ring-red-400/25",
    dot: "bg-red-400",
    label: "Rejected",
    track: "bg-red-500",
    glow: "hover:shadow-[inset_3px_0_0_hsl(0_72%_51%)]",
  },
};

function toNullable(v: string) {
  return v.trim() === "" ? null : v.trim();
}
function toNullableNumber(v: string) {
  return v === "" ? null : Number(v);
}
function formatDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function formatCurrency(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: v >= 10000000 ? "compact" : "standard",
  }).format(v);
}
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
const PALETTE = [
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-teal-600",
  "from-emerald-500 to-green-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-red-600",
  "from-pink-500 to-fuchsia-600",
  "from-indigo-500 to-blue-600",
];
function grad(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ─── Status Pipeline Strip ────────────────────────────────────────────────────
// A thin horizontal bar at the top of the table showing status distribution
function StatusPipeline({ apps }: { apps: Application[] }) {
  const counts: Record<ApplicationStatus, number> = {
    New: 0,
    Qualified: 0,
    Shortlisted: 0,
    "Document Pending": 0,
    Rejected: 0,
  };
  apps.forEach((a) => {
    counts[a.Status] = (counts[a.Status] ?? 0) + 1;
  });
  const total = apps.length;
  if (total === 0) return null;
  const statuses: ApplicationStatus[] = [
    "New",
    "Qualified",
    "Shortlisted",
    "Document Pending",
    "Rejected",
  ];
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-border/50">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
        Pipeline
      </span>
      <div className="flex-1 flex rounded-full overflow-hidden h-1.5 gap-px">
        {statuses.map((s) => {
          const pct = total ? (counts[s] / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s}
              title={`${s}: ${counts[s]}`}
              className={`${statusConfig[s].track} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {statuses
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <div key={s} className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${statusConfig[s].track}`}
              />
              <span className="text-[10px] text-muted-foreground">
                {counts[s]} {statusConfig[s].label}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ApplicationStatus }) {
  const c = statusConfig[status] ?? statusConfig.New;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${c.pill}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ─── Drawer primitives ────────────────────────────────────────────────────────
function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
          {title}
        </p>
        <div className="flex-1 h-px bg-border/60" />
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
const inputCls =
  "h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/40";
const textareaCls =
  "min-h-[80px] w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 resize-none placeholder:text-muted-foreground/40";

// ─── Styled Select ────────────────────────────────────────────────────────────
function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/60 flex items-center justify-between gap-2 hover:border-border/80"
      >
        <span className={sel ? "text-foreground" : "text-muted-foreground/50"}>
          {sel?.label ?? placeholder ?? "Select…"}
        </span>
        <ChevronDown
          size={13}
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
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted flex items-center gap-2 ${value === o.value ? "text-primary bg-primary/5 font-medium" : "text-foreground"}`}
            >
              {value === o.value && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              )}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
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
  onChange: (p: Partial<FormState>) => void;
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const autoFilled = !!form.CustomerId;
  const selectedCustomer = customers.find(
    (c) => String(c.Id) === form.CustomerId,
  );
  const filtered = customers
    .filter(
      (c) =>
        c.Name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.Phone?.includes(customerSearch),
    )
    .slice(0, 8);

  function pickCustomer(c: Customer) {
    onChange({
      CustomerId: String(c.Id),
      ApplicantName: c.Name,
      PrimaryMobile: c.Phone ?? form.PrimaryMobile,
      Email: c.Email ?? form.Email,
      PanNumber: c.PanNumber ?? form.PanNumber,
    });
    setCustomerSearch(c.Name);
    setShowDrop(false);
  }
  function clearCustomer() {
    onChange({
      CustomerId: "",
      ApplicantName: "",
      PrimaryMobile: "",
      Email: "",
      PanNumber: "",
      ApplicantAddress: "",
    });
    setCustomerSearch("");
  }
  if (!open) {
    return null;
  }

  // Reset local search state each time drawer opens
  // (handled by key prop on parent, but belt-and-suspenders via effect)

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]">
      <div
        className="h-full w-full max-w-[700px] flex flex-col border-l border-border bg-card shadow-2xl"
        style={{ animation: "slideIn 0.22s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText size={14} className="text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-foreground leading-tight">
                {editing ? "Edit Application" : "New Application"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editing?.ApplicantNo ??
                  "Fill in applicant and project details"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Customer lookup */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                Customer Lookup
              </p>
              <div className="flex-1 h-px bg-border/60" />
              {autoFilled && (
                <button
                  onClick={clearCustomer}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X size={10} /> Clear
                </button>
              )}
            </div>
            {autoFilled ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-400/20 text-emerald-400 text-xs font-medium">
                <Sparkles size={12} /> Auto-filled from customer master ·{" "}
                <span className="font-bold">{selectedCustomer?.Name}</span>
              </div>
            ) : (
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  className={`${inputCls} pl-9 pr-9`}
                  placeholder="Search by name or phone to auto-fill…"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowDrop(true);
                  }}
                  onFocus={() => setShowDrop(true)}
                />
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                {showDrop && filtered.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {filtered.map((c) => (
                      <button
                        key={c.Id}
                        onClick={() => pickCustomer(c)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                      >
                        <div
                          className={`w-7 h-7 rounded-lg bg-gradient-to-br ${grad(c.Name)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}
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
                        Or fill in manually below for a walk-in
                      </p>
                    </div>
                  </div>
                )}
                {showDrop && customerSearch && filtered.length === 0 && (
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

          <DrawerSection title="Applicant Info">
            <Field label="Full Name">
              <input
                className={inputCls}
                value={form.ApplicantName}
                placeholder="Enter applicant name"
                onChange={(e) => onChange({ ApplicantName: e.target.value })}
              />
            </Field>
            <Field label="Mobile">
              <input
                className={inputCls}
                value={form.PrimaryMobile}
                placeholder="+91 00000 00000"
                onChange={(e) => onChange({ PrimaryMobile: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className={inputCls}
                type="email"
                value={form.Email}
                placeholder="applicant@email.com"
                onChange={(e) => onChange({ Email: e.target.value })}
              />
            </Field>
            <Field label="PAN">
              <input
                className={inputCls}
                value={form.PanNumber}
                placeholder="ABCDE1234F"
                onChange={(e) =>
                  onChange({ PanNumber: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="City">
              <input
                className={inputCls}
                value={form.City}
                placeholder="City"
                onChange={(e) => onChange({ City: e.target.value })}
              />
            </Field>
            <Field label="Application Date">
              <input
                className={inputCls}
                type="date"
                value={form.ApplicationDate}
                onChange={(e) => onChange({ ApplicationDate: e.target.value })}
              />
            </Field>
            <Field label="Applicant Address" span2>
              <textarea
                className={textareaCls}
                value={form.ApplicantAddress}
                placeholder="Residential address"
                onChange={(e) => onChange({ ApplicantAddress: e.target.value })}
              />
            </Field>
          </DrawerSection>

          <DrawerSection title="Co-Applicant">
            <Field label="Co-applicant Name">
              <input
                className={inputCls}
                value={form.CoApplicantName}
                placeholder="Co-applicant full name"
                onChange={(e) => onChange({ CoApplicantName: e.target.value })}
              />
            </Field>
            <Field label="Co-applicant Phone">
              <input
                className={inputCls}
                value={form.CoApplicantPhone}
                placeholder="+91 00000 00000"
                onChange={(e) => onChange({ CoApplicantPhone: e.target.value })}
              />
            </Field>
            <Field label="Correspondence Address" span2>
              <textarea
                className={textareaCls}
                value={form.CorrespondenceAddress}
                placeholder="Correspondence / mailing address"
                onChange={(e) =>
                  onChange({ CorrespondenceAddress: e.target.value })
                }
              />
            </Field>
          </DrawerSection>

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
                className={inputCls}
                placeholder="2 BHK, 3 BHK, Villa…"
                value={form.PreferredUnitType}
                onChange={(e) =>
                  onChange({ PreferredUnitType: e.target.value })
                }
              />
            </Field>
            <Field label="Budget (₹)">
              <input
                className={inputCls}
                type="number"
                min="0"
                value={form.BudgetAmount}
                placeholder="0"
                onChange={(e) => onChange({ BudgetAmount: e.target.value })}
              />
            </Field>
            <Field label="Source">
              <input
                className={inputCls}
                value={form.Source}
                placeholder="Referral, Website, Site Visit…"
                onChange={(e) => onChange({ Source: e.target.value })}
              />
            </Field>
          </DrawerSection>

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
                className={textareaCls}
                value={form.Notes}
                placeholder="Any additional notes or observations…"
                onChange={(e) => onChange({ Notes: e.target.value })}
              />
            </Field>
          </DrawerSection>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4 shrink-0">
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
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}


// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ApplicationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rights = usePageRights("followup-applicants");
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
    const t = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data: options } = useQuery<OptionsResponse>({
    queryKey: ["followup-applications-options"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/options`);
      if (!r.ok) throw new Error("Failed");
      return r.json().catch(() => ({}));
    },
  });
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["followup-application-customers"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/customers`);
      if (!r.ok) throw new Error("Failed");
      return r.json().catch(() => ({}));
    },
  });
  const { data: units = [] } = useQuery<UnitOption[]>({
    queryKey: ["followup-application-units", form.ProjectId],
    queryFn: async () => {
      const p = form.ProjectId ? `?projectId=${form.ProjectId}` : "";
      const r = await fetchWithAuth(`${API}/units${p}`);
      if (!r.ok) throw new Error("Failed");
      return r.json().catch(() => ({}));
    },
    enabled: drawerOpen,
  });

  const queryParams = useMemo(() => {
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("pageSize", "20");
    if (debouncedSearch) q.set("search", debouncedSearch);
    if (status) q.set("status", status);
    if (projectId) q.set("projectId", projectId);
    return q.toString();
  }, [debouncedSearch, page, projectId, status]);

  const { data, isLoading, isFetching, refetch } = useQuery<ListResponse>({
    queryKey: ["followup-applications", queryParams],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}?${queryParams}`);
      if (!r.ok) throw new Error("Failed");
      return r.json().catch(() => ({}));
    },
  });

  const applications = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const totals = useMemo(
    () => ({
      total: pagination?.total ?? 0,
      // active/pendingDocs/budget are page-scoped (current page only).
      // For accurate full-dataset counts the backend would need to return aggregates.
      active: applications.filter((a) => a.Status !== "Rejected").length,
      pendingDocs: applications.filter((a) => a.Status === "Document Pending").length,
      budget: applications.reduce((s, a) => s + Number(a.BudgetAmount ?? 0), 0),
      isPageScoped: (pagination?.totalPages ?? 1) > 1,
    }),
    [applications, pagination],
  );

  function resetAndOpen() {
    setEditing(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  }

  function editApplication(app: Application) {
    setEditing(app);
    setForm({
      CustomerId: app.CustomerId ? String(app.CustomerId) : "",
      ApplicantName: app.ApplicantName ?? "",
      PrimaryMobile: app.PrimaryMobile ?? "",
      Email: app.Email ?? "",
      PanNumber: app.PanNumber ?? "",
      ApplicantAddress: app.ApplicantAddress ?? "",
      CoApplicantName: app.CoApplicantName ?? "",
      CoApplicantPhone: app.CoApplicantPhone ?? "",
      CorrespondenceAddress: app.CorrespondenceAddress ?? "",
      ApplicationDate:
        app.ApplicationDate ?? new Date().toISOString().slice(0, 10),
      City: app.City ?? "",
      Source: app.Source ?? "",
      ProjectId: app.ProjectId ? String(app.ProjectId) : "",
      UnitId: app.UnitId ? String(app.UnitId) : "",
      CompanyId: app.CompanyId ? String(app.CompanyId) : "",
      PreferredUnitType: app.PreferredUnitType ?? "",
      BudgetAmount: app.BudgetAmount == null ? "" : String(app.BudgetAmount),
      Status: app.Status,
      AssignedTo: app.AssignedTo ? String(app.AssignedTo) : "",
      Notes: app.Notes ?? "",
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
      const r = await fetchWithAuth(editing ? `${API}/${editing.Id}` : API, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || "Failed");
      }
      toast.success(editing ? "Application updated" : "Application created");
      setDrawerOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["followup-applications"],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApplication(app: Application) {
    if (!window.confirm(`Delete application for ${app.ApplicantName}?`)) return;
    try {
      const r = await fetchWithAuth(`${API}/${app.Id}`, { method: "DELETE" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || "Failed");
      }
      toast.success("Application deleted");
      await queryClient.invalidateQueries({
        queryKey: ["followup-applications"],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
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

      <FollowupShell
        title="Applications"
        icon={Users}
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
            {rights.canCreate && (
              <Button
                onClick={resetAndOpen}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                <Plus size={14} /> New Application
              </Button>
            )}
          </div>
        }
      >

        {/* ── Stats ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Applications", value: totals.total, dot: "bg-blue-400", borderL: "border-l-blue-400" },
            { label: "Active on Page", value: totals.active, dot: "bg-emerald-500", borderL: "border-l-emerald-500" },
            { label: "Docs Pending", value: totals.pendingDocs, dot: "bg-amber-400", borderL: "border-l-amber-400" },
            { label: "Budget on Page", value: formatCurrency(totals.budget), dot: "bg-violet-500", borderL: "border-l-violet-500" },
          ].map(({ label, value, dot, borderL }) => (
            <div key={label} className={`relative rounded-xl border border-border bg-card p-4 overflow-hidden border-l-2 ${borderL}`}>
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${dot}`} />
              <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
              <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Table Card ───────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 px-4 py-3 border-b border-border sm:flex-row sm:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <input
                className="h-9 w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 focus:bg-background/60 placeholder:text-muted-foreground/40"
                placeholder="Search name, mobile, email, PAN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SlidersHorizontal
                size={13}
                className="text-muted-foreground/50"
              />
              <div className="relative">
                <select
                  className="h-9 appearance-none rounded-lg border border-border bg-muted/30 px-3 pr-7 text-sm text-foreground outline-none focus:border-primary/60 min-w-[140px] cursor-pointer"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Statuses</option>
                  {options?.statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={11}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
              </div>
              <div className="relative">
                <select
                  className="h-9 appearance-none rounded-lg border border-border bg-muted/30 px-3 pr-7 text-sm text-foreground outline-none focus:border-primary/60 min-w-[150px] cursor-pointer"
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
                  size={11}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
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
                  className="h-9 px-2.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-xs"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Status pipeline visualization */}
          {applications.length > 0 && <StatusPipeline apps={applications} />}

          {/* Table */}
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {/* Empty col for status accent bar */}
                  <th className="w-1 pl-0" />
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
                      className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap first:pl-4"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-16 text-center text-muted-foreground"
                    >
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      <p className="text-sm">Loading applications…</p>
                    </td>
                  </tr>
                ) : applications.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mb-1">
                          <FileText size={22} className="opacity-30" />
                        </div>
                        <p className="text-sm font-medium">
                          No applications found
                        </p>
                        <p className="text-xs text-muted-foreground/60">
                          {hasFilters
                            ? "Try adjusting your filters"
                            : "Create your first application to get started"}
                        </p>
                        {hasFilters && (
                          <button
                            onClick={() => {
                              setSearch("");
                              setStatus("");
                              setProjectId("");
                            }}
                            className="mt-1 text-xs text-primary hover:underline"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  applications.map((app, idx) => {
                    const cfg = statusConfig[app.Status] ?? statusConfig.New;
                    return (
                      <tr
                        key={app.Id}
                        className={`group cursor-pointer transition-colors border-b border-border/40 last:border-0 hover:bg-muted/20 ${idx % 2 === 1 ? "bg-muted/[0.025]" : ""}`}
                        onClick={() =>
                          navigate(`/followup/sales/applications/${app.Id}`)
                        }
                      >
                        {/* Status accent bar */}
                        <td className="w-1 p-0 relative">
                          <div
                            className={`absolute inset-y-0 left-0 w-[3px] ${cfg.track} opacity-0 group-hover:opacity-80 transition-opacity rounded-r-full`}
                          />
                        </td>

                        {/* Applicant */}
                        <td className="pl-3 pr-3 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br ${grad(app.ApplicantName)} flex items-center justify-center text-[10px] font-bold text-white shadow-sm`}
                            >
                              {initials(app.ApplicantName)}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground text-[13px] leading-tight group-hover:text-primary transition-colors">
                                {app.ApplicantName}
                              </p>
                              <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                                {app.ApplicantNo ?? `APP-${app.Id}`}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-3 py-3">
                          <div className="space-y-0.5">
                            {app.PrimaryMobile && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Phone size={10} className="shrink-0" />
                                {app.PrimaryMobile}
                              </div>
                            )}
                            {app.Email && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Mail size={10} className="shrink-0" />
                                <span className="truncate max-w-[130px]">
                                  {app.Email}
                                </span>
                              </div>
                            )}
                            {app.City && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MapPin size={10} className="shrink-0" />
                                {app.City}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Project / Unit */}
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2">
                            <Building2
                              size={11}
                              className="text-muted-foreground/50 mt-0.5 shrink-0"
                            />
                            <div>
                              <p className="text-[13px] font-medium text-foreground leading-tight">
                                {app.ProjectName ?? "—"}
                              </p>
                              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                                {app.UnitName
                                  ? `${app.BlockName ? `${app.BlockName} / ` : ""}${app.UnitName}`
                                  : (app.PreferredUnitType ?? "No preference")}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-3 py-3 text-[12px] text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDate(app.ApplicationDate)}
                        </td>

                        {/* Budget */}
                        <td className="px-3 py-3">
                          <span className="text-[13px] font-bold text-foreground whitespace-nowrap tabular-nums">
                            {formatCurrency(app.BudgetAmount)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3">
                          <StatusBadge status={app.Status} />
                        </td>

                        {/* Assigned */}
                        <td className="px-3 py-3 text-[12px] text-muted-foreground">
                          {app.AssignedToName ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary shrink-0">
                                {initials(app.AssignedToName)}
                              </div>
                              <span className="truncate max-w-[90px]">
                                {app.AssignedToName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/25 select-none">
                              —
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td
                          className="px-3 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                navigate(
                                  `/followup/sales/applications/${app.Id}`,
                                )
                              }
                              title="View"
                            >
                              <Eye size={13} />
                            </Button>
                            {rights.canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                                onClick={() => editApplication(app)}
                                title="Edit"
                              >
                                <Edit2 size={13} />
                              </Button>
                            )}
                            {rights.canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => deleteApplication(app)}
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="tabular-nums">
              Page{" "}
              <span className="text-foreground font-medium">
                {pagination?.page ?? 1}
              </span>{" "}
              of{" "}
              <span className="text-foreground font-medium">{totalPages}</span>
              <span className="mx-1.5 text-border">·</span>
              <span className="text-foreground font-medium">
                {pagination?.total ?? 0}
              </span>{" "}
              total
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((c) => Math.max(1, c - 1))}
                className="h-8 rounded-lg text-xs px-3"
              >
                <ChevronLeft size={12} className="mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((c) => c + 1)}
                className="h-8 rounded-lg text-xs px-3"
              >
                Next <ChevronRight size={12} className="ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </FollowupShell>

      <ApplicationDrawer
        key={editing ? `edit-${editing.Id}` : drawerOpen ? "new" : "closed"}
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