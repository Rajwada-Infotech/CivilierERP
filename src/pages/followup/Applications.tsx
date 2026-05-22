import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Search,
  Plus,
  X,
  RefreshCw,
  ChevronRight,
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
  TrendingUp,
  CheckCircle,
  Clock,
  ChevronDown,
  Save,
  Loader2,
} from "lucide-react";
import { DashboardBackground } from "@/components/DashboardBackground";

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
  Status: string;
  Notes: string | null;
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

const STATUS_STYLE: Record<string, string> = {
  New: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Qualified: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Shortlisted: "bg-violet-500/10 text-violet-600 border-violet-400/20",
  "Document Pending": "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Rejected: "bg-red-500/10 text-red-500 border-red-400/20",
};

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

// ── Searchable combobox ───────────────────────────────────────────────────────
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
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed bg-muted" : "bg-card hover:border-primary/50 cursor-pointer"}
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
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors
                  ${value === o.value ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
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

// ── Form ──────────────────────────────────────────────────────────────────────
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
      toast.error("Applicant Name is required");
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
    "w-full px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors placeholder:text-muted-foreground";
  const labelCls =
    "block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5";

  return (
    <div className="space-y-6">
      {/* Applicant */}
      <div>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <User size={12} /> Applicant Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Applicant Name"
            required
            value={form.customerId}
            onChange={set("customerId")}
            options={customerOpts}
            placeholder="Select applicant..."
          />
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
          <div className="sm:col-span-2">
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
      </div>

      {/* Property */}
      <div>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Building2 size={12} /> Property Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Project"
            required
            value={form.projectId}
            onChange={set("projectId")}
            options={projectOpts}
            placeholder="Select project..."
          />
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

      {/* Co-Applicant */}
      <div>
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Users size={12} /> Co-Applicant Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Co-Applicant Name</label>
            <input
              className={inputCls}
              placeholder="Full name"
              value={form.coApplicantName}
              onChange={(e) => set("coApplicantName")(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Co-Applicant Phone</label>
            <input
              className={inputCls}
              placeholder="+91 XXXXX XXXXX"
              value={form.coApplicantPhone}
              onChange={(e) => set("coApplicantPhone")(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
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
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
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

// ── Application card ──────────────────────────────────────────────────────────
function AppCard({ app, onClick }: { app: Application; onClick: () => void }) {
  const bg = avatarColor(app.ApplicantName);
  const statusCls =
    STATUS_STYLE[app.Status] ?? "bg-muted text-muted-foreground border-border";

  return (
    <div
      className="group flex items-start gap-3.5 bg-card border border-border rounded-xl px-4 py-3.5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-px"
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
        style={{ background: bg }}
      >
        {initials(app.ApplicantName)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-[15px] font-semibold text-foreground">
            {app.ApplicantName}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${statusCls}`}
          >
            {app.Status}
          </span>
        </div>
        {app.ApplicantNo && (
          <span className="block text-[12px] text-muted-foreground font-mono mb-1.5">
            {app.ApplicantNo}
          </span>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5">
          {app.PrimaryMobile && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Phone size={11} />
              {app.PrimaryMobile}
            </span>
          )}
          {app.Email && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Mail size={11} />
              <span className="max-w-[160px] truncate">{app.Email}</span>
            </span>
          )}
          {app.ApplicationDate && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Calendar size={11} />
              {app.ApplicationDate.slice(0, 10)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {app.ProjectName && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-500/10 text-blue-600 border border-blue-400/20 rounded-md px-2 py-0.5">
              <Building2 size={10} />
              {app.ProjectName}
            </span>
          )}
          {(app.BlockName || app.UnitName) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-violet-500/10 text-violet-600 border border-violet-400/20 rounded-md px-2 py-0.5">
              <Home size={10} />
              {app.BlockName && app.UnitName
                ? `${app.BlockName} › ${app.UnitName}`
                : (app.UnitName ?? app.BlockName)}
            </span>
          )}
          {app.PanNumber && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-500/10 text-amber-600 border border-amber-400/20 rounded-md px-2 py-0.5">
              <CreditCard size={10} />
              PAN: {app.PanNumber}
            </span>
          )}
          {app.CoApplicantName && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-muted text-muted-foreground border border-border rounded-md px-2 py-0.5">
              <Users size={10} />
              {app.CoApplicantName}
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        size={16}
        className="text-muted-foreground/40 mt-1 flex-shrink-0 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const Applications: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editApp, setEditApp] = useState<Application | null>(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Queries ─────────────────────────────────────────────────────────────────
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
    ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (statusFilter) p.set("status", statusFilter);
      if (projectFilter) p.set("projectId", projectFilter);
      const res = await fetchWithAuth(`${API}?${p}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<{ data: Application[]; total: number }>;
    },
    staleTime: 60_000,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["followup-app-customers"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/customers`);
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json();
    },
    staleTime: 300_000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["followup-app-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
    staleTime: 600_000,
  });

  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ["followup-app-units"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/units`);
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
    staleTime: 300_000,
  });

  const apps = appData?.data ?? [];
  const total = appData?.total ?? 0;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = [
    {
      label: "Total",
      value: total,
      icon: <FileText size={16} />,
      accent: "text-blue-600",
      bg: "bg-blue-500/10",
    },
    {
      label: "Qualified",
      value: apps.filter((a) => a.Status === "Qualified").length,
      icon: <CheckCircle size={16} />,
      accent: "text-emerald-600",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Shortlisted",
      value: apps.filter((a) => a.Status === "Shortlisted").length,
      icon: <TrendingUp size={16} />,
      accent: "text-violet-600",
      bg: "bg-violet-500/10",
    },
    {
      label: "Doc Pending",
      value: apps.filter((a) => a.Status === "Document Pending").length,
      icon: <Clock size={16} />,
      accent: "text-amber-600",
      bg: "bg-amber-500/10",
    },
  ];

  // ── Save ───────────────────────────────────────────────────────────────────
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
      toast.success("Application updated!");
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
      toast.success("Application created!");
    }

    await queryClient.invalidateQueries({
      queryKey: ["followup-applications"],
    });
    setShowForm(false);
    setEditApp(null);
  };

  const openEdit = (app: Application) => {
    setEditApp(app);
    setShowForm(true);
  };

  const initialForm: Partial<FormData> | undefined = editApp
    ? {
        customerId: String(editApp.CustomerId ?? ""),
        applicantName: editApp.ApplicantName,
        primaryMobile: editApp.PrimaryMobile ?? "",
        email: editApp.Email ?? "",
        panNumber: editApp.PanNumber ?? "",
        applicantAddress: editApp.ApplicantAddress ?? "",
        coApplicantName: editApp.CoApplicantName ?? "",
        coApplicantPhone: editApp.CoApplicantPhone ?? "",
        correspondenceAddress: editApp.CorrespondenceAddress ?? "",
        applicationDate: editApp.ApplicationDate?.slice(0, 10) ?? "",
        projectId: String(editApp.ProjectId ?? ""),
        unitId: String(editApp.UnitId ?? ""),
        status: editApp.Status,
        notes: editApp.Notes ?? "",
      }
    : undefined;

  const hasFilters = search || statusFilter || projectFilter;

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-5 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Breadcrumbs
              items={[
                { label: "Follow-Up", path: "/followup" },
                { label: "Applications", path: "/followup/sales/applicants" },
              ]}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className="p-2.5 rounded-xl bg-blue-500/10">
                <FileText size={20} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  Applications
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All property applications and leads
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
            >
              <RefreshCw
                size={13}
                className={isLoading ? "animate-spin" : ""}
              />{" "}
              Refresh
            </button>
            <button
              onClick={() => {
                setEditApp(null);
                setShowForm(true);
              }}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors font-medium"
            >
              <Plus size={13} /> New Application
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className={`p-2 rounded-lg ${k.bg} w-fit mb-3`}>
                <span className={k.accent}>{k.icon}</span>
              </div>
              <p className="text-2xl font-bold font-heading text-foreground leading-none">
                {k.value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {k.label}
              </p>
            </div>
          ))}
        </div>

        {/* Form panel */}
        {showForm && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
              <h2 className="text-sm font-semibold text-foreground">
                {editApp
                  ? `Edit Application — ${editApp.ApplicantNo}`
                  : "New Application"}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditApp(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <ApplicationForm
                key={editApp?.Id ?? "new"}
                initial={initialForm}
                onSave={handleSave}
                onCancel={() => {
                  setShowForm(false);
                  setEditApp(null);
                }}
                customers={customers}
                projects={projects}
                units={units}
              />
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2.5 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="w-full pl-9 pr-9 py-[9px] border border-border rounded-lg text-sm bg-card text-foreground outline-none focus:border-primary/60 transition-colors"
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
            className="px-3 py-[9px] border border-border rounded-lg text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="px-3 py-[9px] border border-border rounded-lg text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60"
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
              className="flex items-center gap-1.5 px-3 py-[9px] border border-red-400/30 bg-red-500/5 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/10 transition-colors"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setProjectFilter("");
              }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex gap-3.5 bg-card border border-border rounded-xl px-4 py-3.5 animate-pulse"
              >
                <div className="w-11 h-11 rounded-xl bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-muted rounded w-3/5" />
                  <div className="h-3 bg-muted rounded w-2/5" />
                  <div className="h-3 bg-muted rounded w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 rounded-2xl bg-muted mb-4">
              <FileText size={28} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No applications found
            </p>
            {hasFilters ? (
              <p className="text-xs text-muted-foreground mt-1">
                Try clearing filters
              </p>
            ) : (
              <button
                onClick={() => {
                  setEditApp(null);
                  setShowForm(true);
                }}
                className="mt-3 flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors"
              >
                <Plus size={13} /> Add First Application
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {apps.map((a) => (
              <AppCard key={a.Id} app={a} onClick={() => openEdit(a)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default Applications;
