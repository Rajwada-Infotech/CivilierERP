// src/pages/masters/ProjectMaster.tsx
import React, { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  FolderKanban,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
} from "@/api/projectMasterApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface Project {
  Id?: number;
  code: string;
  name: string;
  shortName: string;
  type: string;
  // enterpriseName stores the selected enterprise name (saved to belongs_to)
  enterpriseName: string;
  // companyName stores the selected company name (saved to b_sub_identity_type)
  companyName: string;
  clientName: string;
  clientCode: string;
  teamSize: string;
  startDate: string;
  endDate: string;
  currency: string;
  status: string;
  priority: string;
  location: string;
  description: string;
  remarks: string;
  isActive: boolean;
  projectImage?: string | File | null;
}

function ProjectAvatar({
  imageUrl,
  name,
  size = "sm",
}: {
  imageUrl?: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "w-10 h-10 text-base" : "w-8 h-8 text-xs";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${dim} rounded-lg object-contain border border-border bg-muted/30 shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-lg bg-primary/10 text-primary font-heading font-bold flex items-center justify-center shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const PROJECT_TYPES = [
  "Construction",
  "IT",
  "Infrastructure",
  "Manufacturing",
  "Consulting",
  "Research",
  "Maintenance",
];

const STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

const emptyProject: Project = {
  code: "",
  name: "",
  shortName: "",
  type: "Construction",
  enterpriseName: "",
  companyName: "",
  clientName: "",
  clientCode: "",
  teamSize: "",
  startDate: "",
  endDate: "",
  currency: "INR",
  status: "Planning",
  priority: "Medium",
  location: "",
  description: "",
  remarks: "",
  isActive: true,
  projectImage: null,
};

// Maps raw DB row → form shape.
// belongs_to → enterpriseName, b_sub_identity_type → companyName (fully independent)
function rowToForm(row: any): Project {
  return {
    Id: row.Id,
    code: row.Code ?? "",
    name: row.Name ?? "",
    shortName: row.ShortName ?? "",
    type: row.Type ?? "Construction",
    enterpriseName: row.belongs_to ?? "",
    companyName: row.b_sub_identity_type ?? "",
    clientName: row.ClientName ?? "",
    clientCode: row.ClientCode ?? "",
    teamSize: row.TeamSize != null ? String(row.TeamSize) : "",
    startDate: row.StartDate ? row.StartDate.slice(0, 10) : "",
    endDate: row.EndDate ? row.EndDate.slice(0, 10) : "",
    currency: row.Currency ?? row.currency ?? "INR",
    status: row.Status ?? "Planning",
    priority: row.Priority ?? "Medium",
    location: row.Location ?? "",
    description: row.Description ?? "",
    remarks: row.Remarks ?? "",
    isActive: row.IsActive !== 0,
    projectImage: row.ProjectImage || null,
  };
}

// ── View Modal ────────────────────────────────────────────────────────────────
function ProjectViewModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const STATUS_COLORS: Record<string, string> = {
    Active: "bg-emerald-500/10 text-emerald-600",
    Planning: "bg-blue-500/10 text-blue-600",
    "On Hold": "bg-amber-500/10 text-amber-600",
    Completed: "bg-purple-500/10 text-purple-600",
    Cancelled: "bg-muted text-muted-foreground",
  };
  const PRIORITY_COLORS: Record<string, string> = {
    Critical: "bg-red-500/10 text-red-600",
    High: "bg-orange-500/10 text-orange-600",
    Medium: "bg-amber-500/10 text-amber-600",
    Low: "bg-emerald-500/10 text-emerald-600",
  };

  const Row = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-sm text-foreground break-words">{value}</span>
      </div>
    ) : null;

  const Section = ({ title }: { title: string }) => (
    <div className="col-span-full pt-2">
      <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest border-b border-border pb-1 mb-2">
        {title}
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <ProjectAvatar
              imageUrl={
                typeof project.projectImage === "string"
                  ? project.projectImage
                  : null
              }
              name={project.name || "?"}
              size="md"
            />
            <div>
              <h2 className="font-heading font-semibold text-foreground text-base">
                {project.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {project.code && (
                  <span className="font-mono text-xs text-primary">
                    {project.code}
                  </span>
                )}
                {project.status && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[project.status] || "bg-muted text-muted-foreground"}`}
                  >
                    {project.status}
                  </span>
                )}
                {project.priority && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[project.priority] || "bg-muted text-muted-foreground"}`}
                  >
                    {project.priority}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${project.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {project.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Section title="General" />
            <Row label="Short Name" value={project.shortName} />
            <Row label="Type" value={project.type} />
            <Row label="Enterprise" value={project.enterpriseName} />
            <Row label="Company" value={project.companyName} />
            <Row label="Client Name" value={project.clientName} />
            <Row label="Client Code" value={project.clientCode} />
            <Row label="Location" value={project.location} />
            <Row label="Description" value={project.description} />
            <Row label="Remarks" value={project.remarks} />

            <Section title="Timeline" />
            <Row label="Start Date" value={project.startDate} />
            <Row label="End Date" value={project.endDate} />
            <Row label="Team Size" value={project.teamSize} />

            <Section title="Financial" />
            <Row label="Currency" value={project.currency} />
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function buildProjectColumns(
  openView: (row: any) => void,
  openEdit: (row: any) => void,
  setDeleteConfirm: (id: number) => void,
): ColumnDef<any, unknown>[] {
  return [
    {
      accessorKey: "Code",
      header: "Code",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-medium text-primary">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "Name",
      header: "Project Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <ProjectAvatar
            imageUrl={row.original.ProjectImage}
            name={row.original.Name || "?"}
          />
          <span className="font-medium text-foreground max-w-[160px] truncate">
            {row.original.Name}
          </span>
        </div>
      ),
    },
    {
      id: "belongs_to_combined",
      header: "Enterprise / Company",
      cell: ({ row }) => {
        const enterprise = row.original.belongs_to || "";
        const company = row.original.b_sub_identity_type || "";
        const display =
          [enterprise, company].filter(Boolean).join(" / ") || "—";
        return (
          <span className="text-xs text-muted-foreground max-w-[160px] truncate block">
            {display}
          </span>
        );
      },
    },
    {
      accessorKey: "ClientName",
      header: "Client",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "Type",
      header: "Type",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "Status",
      header: "Status",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${v === "Active" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            {v || "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "Priority",
      header: "Priority",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        const styles: Record<string, string> = {
          High: "text-red-500 bg-red-500/10",
          Medium: "text-amber-500 bg-amber-500/10",
          Low: "text-emerald-500 bg-emerald-500/10",
          Critical: "text-red-600 bg-red-600/10",
        };
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[v] || "bg-muted text-muted-foreground"}`}
          >
            {v || "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "IsActive",
      header: "Active",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return (
          <span
            className={`w-2 h-2 rounded-full inline-block ${active ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
          />
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => openView(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10"
            title="View details"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={() => openEdit(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setDeleteConfirm(row.original.Id)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];
}

export default function ProjectMaster() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Project>(emptyProject);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewTarget, setViewTarget] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<
    "general" | "timeline" | "financial"
  >("general");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Projects
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["project-master"],
    queryFn: getProjects,
  });

  // Enterprise dropdown
  const { data: enterprises = [] } = useQuery({
    queryKey: ["enterprises-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/enterprises");
      if (!res.ok) throw new Error("Failed to load enterprises");
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: any) => !e.discontinue) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Company dropdown
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/company-master");
      if (!res.ok) throw new Error("Failed to load companies");
      const data = await res.json();
      return Array.isArray(data)
        ? data.filter((c: any) => c.IsActive !== 0)
        : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        code: form.code,
        name: form.name,
        shortName: form.shortName,
        type: form.type,
        clientName: form.clientName,
        clientCode: form.clientCode,
        teamSize: form.teamSize,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        currency: form.currency,
        status: form.status,
        priority: form.priority,
        location: form.location,
        description: form.description,
        remarks: form.remarks,
        isActive: form.isActive,
        // Each field saved independently — no merging, no priority logic
        enterpriseName: form.enterpriseName || null,
        companyName: form.companyName || null,
      };

      if (form.projectImage instanceof File) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(form.projectImage as File);
        });
        payload.projectImage = base64;
      } else if (typeof form.projectImage === "string") {
        payload.projectImage = form.projectImage;
      }

      if (editId) {
        return updateProject(editId, payload);
      } else {
        return createProject(payload);
      }
    },
    onSuccess: () => {
      toast.success(
        editId
          ? "Project updated successfully"
          : "Project created successfully",
      );
      qc.invalidateQueries({ queryKey: ["project-master"] });
      qc.invalidateQueries({ queryKey: ["enterprises"] });
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || "Something went wrong"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Project deactivated successfully");
      qc.invalidateQueries({ queryKey: ["project-master"] });
      qc.invalidateQueries({ queryKey: ["enterprises"] });
      setDeleteConfirm(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setForm({ ...emptyProject });
    setImagePreview("");
    setEditId(null);
    setShowForm(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/"))
      return toast.error("Please select an image file");
    if (file.size > 5 * 1024 * 1024)
      return toast.error("Image must be under 5 MB");

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
      setForm((prev) => ({ ...prev, projectImage: file }));
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImagePreview("");
    setForm((prev) => ({ ...prev, projectImage: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const filtered = projects.filter(
    (p: any) =>
      (p.Name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.Code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.ClientName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const openNew = () => {
    setForm({ ...emptyProject });
    setImagePreview("");
    setEditId(null);
    setShowForm(true);
    setActiveTab("general");
  };

  const openEdit = (row: any) => {
    const f = rowToForm(row);
    setForm(f);
    setImagePreview(typeof f.projectImage === "string" ? f.projectImage : "");
    setEditId(row.Id);
    setShowForm(true);
    setActiveTab("general");
  };

  const openView = (row: any) => {
    setViewTarget(rowToForm(row));
  };

  const columns = useMemo(
    () => buildProjectColumns(openView, openEdit, setDeleteConfirm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fi = (label: string, key: keyof Project, type = "text", ph = "") => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <input
        type={type}
        value={(form[key] as string) || ""}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={ph || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );

  const se = (label: string, key: keyof Project, options: string[]) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <select
        value={(form[key] as string) || ""}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Admin", "Masters", "Project Master"]} />

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
              <FolderKanban size={20} className="text-indigo-500" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-semibold text-foreground">
                Project Master
              </h1>
              <p className="text-xs text-muted-foreground">
                Manage projects, timelines and clients
              </p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} /> Add Project
          </button>
        </div>

        {!showForm && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, code, client..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} project{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2
                  size={24}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  data={filtered}
                  columns={columns}
                  searchable={false}
                  paginated={true}
                  defaultPageSize={20}
                  emptyMessage="No projects found."
                />
              </div>
            )}
          </div>
        )}

        {showForm && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <ProjectAvatar
                  imageUrl={imagePreview || null}
                  name={form.name || "?"}
                  size="md"
                />
                <h2 className="font-heading font-semibold text-foreground">
                  {editId ? `Edit — ${form.name || "Project"}` : "New Project"}
                </h2>
              </div>
              <button
                onClick={resetForm}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted"
              >
                Cancel
              </button>
            </div>

            <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
              {(["general", "timeline", "financial"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="p-6">
              {activeTab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Image Upload */}
                  <div className="col-span-full">
                    <label className="block text-xs font-medium text-muted-foreground mb-2">
                      Project Image
                    </label>
                    <div className="flex items-center gap-4">
                      {imagePreview ? (
                        <div className="relative group">
                          <img
                            src={imagePreview}
                            alt="Preview"
                            className="w-16 h-16 rounded-xl object-contain border border-border bg-muted/30"
                          />
                          <button
                            onClick={removeImage}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border bg-muted/20 flex items-center justify-center">
                          <FolderKanban
                            size={20}
                            className="text-muted-foreground/40"
                          />
                        </div>
                      )}
                      <div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                          id="project-image-input"
                        />
                        <label
                          htmlFor="project-image-input"
                          className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted cursor-pointer"
                        >
                          <Upload size={13} />
                          {imagePreview ? "Change Image" : "Upload Image"}
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">
                          PNG, JPG • Max 5 MB
                        </p>
                      </div>
                    </div>
                  </div>

                  {fi("Project Code *", "code", "text", "e.g. PRJ-001")}
                  {fi("Project Name *", "name")}
                  {fi("Short Name", "shortName")}
                  {se("Type", "type", PROJECT_TYPES)}

                  {/* Enterprise Dropdown — fully independent */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Enterprise
                    </label>
                    <select
                      value={form.enterpriseName}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          enterpriseName: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="">— Select Enterprise —</option>
                      {enterprises.map((e: any) => {
                        const name = e.name ?? e.Name ?? "";
                        const id = String(e.id ?? e.Id ?? "");
                        return (
                          <option key={id} value={name}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Company Dropdown — fully independent */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Company
                    </label>
                    <select
                      value={form.companyName}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          companyName: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="">— Select Company —</option>
                      {companies.map((c: any) => {
                        const name = c.Name ?? c.name ?? "";
                        const id = String(c.Id ?? c.id ?? "");
                        return (
                          <option key={id} value={name}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {fi("Client Name", "clientName")}
                  {fi("Client Code", "clientCode")}
                  {fi("Location", "location")}

                  <div className="flex items-center gap-3 pt-5 col-span-full">
                    <button
                      onClick={() =>
                        setForm((p) => ({ ...p, isActive: !p.isActive }))
                      }
                      className="flex items-center gap-2 text-sm"
                    >
                      {form.isActive ? (
                        <ToggleRight size={24} className="text-emerald-500" />
                      ) : (
                        <ToggleLeft
                          size={24}
                          className="text-muted-foreground"
                        />
                      )}
                      <span
                        className={
                          form.isActive
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                        }
                      >
                        {form.isActive ? "Active" : "Inactive"}
                      </span>
                    </button>
                  </div>

                  <div className="col-span-full">
                    {fi("Description", "description")}
                  </div>
                  <div className="col-span-full">
                    {fi("Remarks", "remarks")}
                  </div>
                </div>
              )}

              {activeTab === "timeline" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fi("Start Date", "startDate", "date")}
                  {fi("End Date", "endDate", "date")}
                  {se("Status", "status", STATUSES)}
                  {se("Priority", "priority", PRIORITIES)}
                  {fi("Team Size", "teamSize", "number")}
                </div>
              )}

              {activeTab === "financial" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {se("Currency", "currency", CURRENCIES)}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-3">
              <button
                onClick={resetForm}
                className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.code || !form.name || saveMutation.isPending}
                className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {saveMutation.isPending && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                {editId ? "Update Project" : "Create Project"}
              </button>
            </div>
          </div>
        )}

        {/* View Modal */}
        {viewTarget && (
          <ProjectViewModal
            project={viewTarget}
            onClose={() => setViewTarget(null)}
          />
        )}

        {/* Delete Confirmation */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card border border-border rounded-xl p-6 w-80">
              <p className="font-semibold text-foreground">
                Deactivate this project?
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                The project will be deactivated and hidden from all dropdowns.
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 border border-border rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(deleteConfirm)}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
