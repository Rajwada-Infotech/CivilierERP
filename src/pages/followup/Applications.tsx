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

const statusStyles: Record<ApplicationStatus, string> = {
  New: "bg-blue-500/10 text-blue-600 border border-blue-400/20",
  Qualified:
    "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  Shortlisted:
    "bg-violet-500/10 text-violet-600 border border-violet-400/20",
  "Document Pending":
    "bg-amber-500/10 text-amber-600 border border-amber-400/20",
  Rejected: "bg-red-500/10 text-red-600 border border-red-400/20",
};

function toNullable(value: string) {
  return value.trim() === "" ? null : value.trim();
}

function toNullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value: number | null) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10";

const textareaClass =
  "min-h-[84px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10";

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm">
      <div className="h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground">
              {editing ? "Edit Application" : "New Application"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {editing?.ApplicantNo ?? "Capture applicant and project details"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <Field label="Customer">
            <select
              className={inputClass}
              value={form.CustomerId}
              onChange={(event) => {
                const customer = customers.find(
                  (item) => String(item.Id) === event.target.value,
                );
                onChange({
                  CustomerId: event.target.value,
                  ApplicantName: customer?.Name ?? form.ApplicantName,
                  PrimaryMobile: customer?.Phone ?? form.PrimaryMobile,
                  Email: customer?.Email ?? form.Email,
                });
              }}
            >
              <option value="">Walk-in / new customer</option>
              {customers.map((customer) => (
                <option key={customer.Id} value={customer.Id}>
                  {customer.Name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Applicant Name">
            <input
              className={inputClass}
              value={form.ApplicantName}
              onChange={(event) => onChange({ ApplicantName: event.target.value })}
            />
          </Field>

          <Field label="Mobile">
            <input
              className={inputClass}
              value={form.PrimaryMobile}
              onChange={(event) => onChange({ PrimaryMobile: event.target.value })}
            />
          </Field>

          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={form.Email}
              onChange={(event) => onChange({ Email: event.target.value })}
            />
          </Field>

          <Field label="PAN">
            <input
              className={inputClass}
              value={form.PanNumber}
              onChange={(event) =>
                onChange({ PanNumber: event.target.value.toUpperCase() })
              }
            />
          </Field>

          <Field label="Application Date">
            <input
              className={inputClass}
              type="date"
              value={form.ApplicationDate}
              onChange={(event) => onChange({ ApplicationDate: event.target.value })}
            />
          </Field>

          <Field label="Project">
            <select
              className={inputClass}
              value={form.ProjectId}
              onChange={(event) =>
                onChange({ ProjectId: event.target.value, UnitId: "" })
              }
            >
              <option value="">Select project</option>
              {options?.projects.map((project) => (
                <option key={project.Id} value={project.Id}>
                  {project.Name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Preferred Unit">
            <select
              className={inputClass}
              value={form.UnitId}
              onChange={(event) => onChange({ UnitId: event.target.value })}
            >
              <option value="">No unit selected</option>
              {units.map((unit) => (
                <option key={unit.Id} value={unit.Id}>
                  {unit.BlockName ? `${unit.BlockName} - ` : ""}
                  {unit.Name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Company">
            <select
              className={inputClass}
              value={form.CompanyId}
              onChange={(event) => onChange({ CompanyId: event.target.value })}
            >
              <option value="">Select company</option>
              {options?.companies.map((company) => (
                <option key={company.Id} value={company.Id}>
                  {company.Name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Preferred Type">
            <input
              className={inputClass}
              placeholder="2 BHK, 3 BHK, Villa..."
              value={form.PreferredUnitType}
              onChange={(event) =>
                onChange({ PreferredUnitType: event.target.value })
              }
            />
          </Field>

          <Field label="Budget">
            <input
              className={inputClass}
              type="number"
              min="0"
              value={form.BudgetAmount}
              onChange={(event) => onChange({ BudgetAmount: event.target.value })}
            />
          </Field>

          <Field label="Status">
            <select
              className={inputClass}
              value={form.Status}
              onChange={(event) =>
                onChange({ Status: event.target.value as ApplicationStatus })
              }
            >
              {options?.statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assigned To">
            <select
              className={inputClass}
              value={form.AssignedTo}
              onChange={(event) => onChange({ AssignedTo: event.target.value })}
            >
              <option value="">Unassigned</option>
              {options?.users.map((user) => (
                <option key={user.Id} value={user.Id}>
                  {user.Name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Source">
            <input
              className={inputClass}
              value={form.Source}
              onChange={(event) => onChange({ Source: event.target.value })}
            />
          </Field>

          <Field label="City">
            <input
              className={inputClass}
              value={form.City}
              onChange={(event) => onChange({ City: event.target.value })}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Applicant Address">
              <textarea
                className={textareaClass}
                value={form.ApplicantAddress}
                onChange={(event) =>
                  onChange({ ApplicantAddress: event.target.value })
                }
              />
            </Field>
          </div>

          <Field label="Co-applicant Name">
            <input
              className={inputClass}
              value={form.CoApplicantName}
              onChange={(event) => onChange({ CoApplicantName: event.target.value })}
            />
          </Field>

          <Field label="Co-applicant Phone">
            <input
              className={inputClass}
              value={form.CoApplicantPhone}
              onChange={(event) => onChange({ CoApplicantPhone: event.target.value })}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Correspondence Address">
              <textarea
                className={textareaClass}
                value={form.CorrespondenceAddress}
                onChange={(event) =>
                  onChange({ CorrespondenceAddress: event.target.value })
                }
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                className={textareaClass}
                value={form.Notes}
                onChange={(event) => onChange({ Notes: event.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 px-6 py-4 backdrop-blur">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving} className="gradient-accent text-white">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

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

  const params = useMemo(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("pageSize", "20");
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (status) query.set("status", status);
    if (projectId) query.set("projectId", projectId);
    return query.toString();
  }, [debouncedSearch, page, projectId, status]);

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<ListResponse>({
    queryKey: ["followup-applications", params],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}?${params}`);
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
      pendingDocs: list.filter((item) => item.Status === "Document Pending").length,
      budget: list.reduce((sum, item) => sum + Number(item.BudgetAmount ?? 0), 0),
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
        application.BudgetAmount == null ? "" : String(application.BudgetAmount),
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
        throw new Error(err.error || "Failed to save application");
      }
      toast.success(editing ? "Application updated" : "Application created");
      setDrawerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["followup-applications"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApplication(application: Application) {
    if (
      !window.confirm(
        `Delete application ${application.ApplicantNo ?? application.ApplicantName}?`,
      )
    ) {
      return;
    }

    try {
      const res = await fetchWithAuth(`${API}/${application.Id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete application");
      }
      toast.success("Application deleted");
      await queryClient.invalidateQueries({ queryKey: ["followup-applications"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    }
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Sales" },
          { label: "Applications", path: "/followup/sales/applications" },
        ]}
      />
      <div className="relative space-y-8 mt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Applications
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage sales applications before unit selection and booking.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              onClick={resetAndOpen}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={13} />
              New Application
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="p-2 rounded-lg bg-blue-500/10 w-fit mb-3">
              <FileText size={16} className="text-blue-600" />
            </div>
            <p className="text-2xl font-bold font-heading text-foreground leading-none">
              {totals.total}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Total</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 w-fit mb-3">
              <User size={16} className="text-emerald-600" />
            </div>
            <p className="text-2xl font-bold font-heading text-foreground leading-none">
              {totals.active}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Active on page</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="p-2 rounded-lg bg-amber-500/10 w-fit mb-3">
              <CalendarDays size={16} className="text-amber-600" />
            </div>
            <p className="text-2xl font-bold font-heading text-foreground leading-none">
              {totals.pendingDocs}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Docs pending</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="p-2 rounded-lg bg-violet-500/10 w-fit mb-3">
              <IndianRupee size={16} className="text-violet-600" />
            </div>
            <p className="text-2xl font-bold font-heading text-foreground leading-none">
              {formatCurrency(totals.budget)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Budget on page</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[1fr_220px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={`${inputClass} pl-9`}
                placeholder="Search name, mobile, email, PAN, project"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              className={inputClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {options?.statusOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All projects</option>
              {options?.projects.map((project) => (
                <option key={project.Id} value={project.Id}>
                  {project.Name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    "Applicant",
                    "Project / Unit",
                    "Date",
                    "Budget",
                    "Status",
                    "Assigned",
                    "Actions",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className={`px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap ${heading === "Actions" ? "text-right" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Loading applications
                    </td>
                  </tr>
                ) : applications.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                      No applications found
                    </td>
                  </tr>
                ) : (
                  applications.map((application) => (
                    <tr
                      key={application.Id}
                      className="border-b border-border/40 align-top transition hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                            {initials(application.ApplicantName)}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">
                              {application.ApplicantName}
                            </div>
                            <div className="text-xs font-mono text-muted-foreground">
                              {application.ApplicantNo ?? `#${application.Id}`}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {application.PrimaryMobile && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {application.PrimaryMobile}
                                </span>
                              )}
                              {application.Email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {application.Email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-foreground">
                              {application.ProjectName ?? "-"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {application.UnitName
                                ? `${application.BlockName ? `${application.BlockName} / ` : ""}${application.UnitName}`
                                : application.PreferredUnitType ?? "No unit preference"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatDate(application.ApplicationDate)}</td>
                      <td className="px-4 py-3">{formatCurrency(application.BudgetAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={application.Status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {application.AssignedToName ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Open application"
                            onClick={() =>
                              navigate(`/followup/sales/applications/${application.Id}`)
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => editApplication(application)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => deleteApplication(application)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing page {pagination?.page ?? 1} of {totalPages} ·{" "}
              {pagination?.total ?? 0} applications
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-xl"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-xl"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
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
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
      />
    </>
  );
}
