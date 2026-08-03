// src/pages/admin/masters/ProjectMaster.tsx
import React, { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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
  MapPin,
  Shield,
  Users,
  Printer,
  CalendarDays,
  ChevronDown,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  deleteProjectCascade,
} from "@/api/projectMasterApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { useLookup } from "@/hooks/useLookup";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { friendlyErrorMessage } from "@/lib/friendlyError";

interface Project {
  Id?: number;
  code: string;
  name: string;
  shortName: string;
  type: string;
  enterpriseId: string; // id stored, name resolved via JOIN for display
  enterpriseName: string; // display-only, from GET join
  companyId: string;
  companyName: string; // display-only, from GET join
  // address
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  zipCode: string;
  latitude: string;
  longitude: string;
  // compliance — auto-fetched from Company Master, never saved on project
  gst: string;
  gstDate: string;
  pan: string;
  tan: string;
  tradeLicenseNo: string;
  // jv
  jvEnabled: boolean;
  jvCompanyName: string;
  // rest
  teamSize: string;
  startDate: string;
  endDate: string;
  currency: string;
  status: string;
  priority: string;
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

const emptyProject: Project = {
  code: "",
  name: "",
  shortName: "",
  type: "Construction",
  enterpriseId: "",
  enterpriseName: "",
  companyId: "",
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  zipCode: "",
  latitude: "",
  longitude: "",
  gst: "",
  gstDate: "",
  pan: "",
  tan: "",
  tradeLicenseNo: "",
  jvEnabled: false,
  jvCompanyName: "",
  teamSize: "",
  startDate: "",
  endDate: "",
  currency: "INR",
  status: "Planning",
  priority: "Medium",
  description: "",
  remarks: "",
  isActive: true,
  projectImage: null,
};

function rowToForm(row: any): Project {
  return {
    Id: row.Id,
    code: row.Code ?? "",
    name: row.Name ?? "",
    shortName: row.ShortName ?? "",
    type: row.Type ?? "Construction",
    enterpriseId: row.EnterpriseId != null ? String(row.EnterpriseId) : "",
    enterpriseName: row.EnterpriseName ?? "",
    companyId: row.CompanyId != null ? String(row.CompanyId) : "",
    companyName: row.CompanyName ?? "",
    addressLine1: row.AddressLine1 ?? "",
    addressLine2: row.AddressLine2 ?? "",
    addressLine3: row.AddressLine3 ?? "",
    zipCode: row.ZipCode ?? "",
    latitude: row.Latitude != null ? String(row.Latitude) : "",
    longitude: row.Longitude != null ? String(row.Longitude) : "",
    // compliance — display-only when editing; refetched on company change
    gst: row.CompanyGST ?? "",
    gstDate: row.CompanyGSTDate ? row.CompanyGSTDate.slice(0, 10) : "",
    pan: row.CompanyPAN ?? "",
    tan: row.CompanyTAN ?? "",
    tradeLicenseNo: row.CompanyTradeLicenseNo ?? "",
    jvEnabled: !!row.JvEnabled,
    jvCompanyName: row.JvCompanyName ?? "",
    teamSize: row.TeamSize != null ? String(row.TeamSize) : "",
    startDate: row.StartDate ? row.StartDate.slice(0, 10) : "",
    endDate: row.EndDate ? row.EndDate.slice(0, 10) : "",
    currency: row.Currency ?? "INR",
    status: row.Status ?? "Planning",
    priority: row.Priority ?? "Medium",
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

  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground break-words">
        {value || "—"}
      </span>
    </div>
  );

  const Section = ({
    title,
    icon,
  }: {
    title: string;
    icon?: React.ReactNode;
  }) => (
    <div className="col-span-full pt-2">
      <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest border-b border-border pb-1 mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </p>
    </div>
  );

  const fullAddress = [
    project.addressLine1,
    project.addressLine2,
    project.addressLine3,
    project.zipCode,
  ]
    .filter(Boolean)
    .join(", ");

  const projectLogo =
    typeof project.projectImage === "string" ? project.projectImage : null;

  const printPreview = () =>
    printMasterPreview({
      title: project.name || "Project",
      subtitle: "Project Master Preview",
      code: project.code,
      status: project.status || (project.isActive ? "Active" : "Inactive"),
      logo: projectLogo,
      sections: [
        {
          title: "General",
          fields: [
            { label: "Project Code", value: project.code },
            { label: "Project Name", value: project.name },
            { label: "Short Name", value: project.shortName },
            { label: "Type", value: project.type },
            { label: "Enterprise", value: project.enterpriseName },
            { label: "Company", value: project.companyName },
            { label: "Status", value: project.status },
            { label: "Priority", value: project.priority },
            { label: "Active", value: project.isActive },
            { label: "Description", value: project.description },
            { label: "Remarks", value: project.remarks },
          ],
        },
        {
          title: "Location & Address",
          fields: [
            { label: "Address Line 1", value: project.addressLine1 },
            { label: "Address Line 2", value: project.addressLine2 },
            { label: "City/District", value: project.addressLine3 },
            { label: "ZIP Code", value: project.zipCode },
            { label: "Full Address", value: fullAddress },
            { label: "Latitude", value: project.latitude },
            { label: "Longitude", value: project.longitude },
          ],
        },
        {
          title: "Compliance",
          fields: [
            { label: "GST Number", value: project.gst },
            { label: "GST Registration Date", value: project.gstDate },
            { label: "PAN Number", value: project.pan },
            { label: "TAN Number", value: project.tan },
            { label: "Trade License Number", value: project.tradeLicenseNo },
          ],
        },
        {
          title: "Timeline & Financial",
          fields: [
            { label: "Start Date", value: project.startDate },
            { label: "End Date", value: project.endDate },
            { label: "Team Size", value: project.teamSize },
            { label: "Currency", value: project.currency },
          ],
        },
        {
          title: "Joint Venture",
          fields: [
            { label: "JV Enabled", value: project.jvEnabled },
            { label: "JV Partner / Company", value: project.jvCompanyName },
          ],
        },
      ],
    });

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <ProjectAvatar
              imageUrl={projectLogo}
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
                {project.jvEnabled && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600">
                    JV
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
          <div className="flex items-center gap-2">
            <button
              onClick={printPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
              title="Print"
            >
              <Printer size={13} /> Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 flex-1">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Section title="General" />
            <Row label="Short Name" value={project.shortName} />
            <Row label="Type" value={project.type} />
            <Row label="Enterprise" value={project.enterpriseName} />
            <Row label="Company" value={project.companyName} />
            <Row label="Description" value={project.description} />
            <Row label="Remarks" value={project.remarks} />

            <Section title="Location & Address" icon={<MapPin size={11} />} />
            <div className="col-span-full">
              <Row label="Address" value={fullAddress || undefined} />
            </div>
            <Row label="Latitude" value={project.latitude} />
            <Row label="Longitude" value={project.longitude} />

            <Section title="Timeline" />
            <Row label="Start Date" value={project.startDate} />
            <Row label="End Date" value={project.endDate} />
            <Row label="Team Size" value={project.teamSize} />

            <Section title="Financial" />
            <Row label="Currency" value={project.currency} />
            <Row label="Priority" value={project.priority} />

            <Section title="Compliance" icon={<Shield size={11} />} />
            <Row label="GST Number" value={project.gst} />
            <Row label="GST Registration Date" value={project.gstDate} />
            <Row label="PAN Number" value={project.pan} />
            <Row label="TAN Number" value={project.tan} />
            <Row label="Trade License Number" value={project.tradeLicenseNo} />

            {project.jvEnabled && (
              <>
                <Section title="Joint Venture" icon={<Users size={11} />} />
                <Row
                  label="JV Partner / Company"
                  value={project.jvCompanyName}
                />
              </>
            )}
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
    </div>,
    document.body
  );
}

// ── Table columns ─────────────────────────────────────────────────────────────
function buildProjectColumns(
  openView: (row: any) => void,
  openEdit: (row: any) => void,
  setDeleteConfirm: (id: number) => void,
  rights: { canEdit: boolean; canDelete: boolean },
  isSuperAdmin: boolean,
  setCascadeTarget: (row: { Id: number; Name: string }) => void,
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
        const enterprise = row.original.EnterpriseName || "";
        const company = row.original.CompanyName || "";
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
      accessorKey: "JvEnabled",
      header: "JV",
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600">
            JV
          </span>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        ),
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
          {rights.canEdit && (
            <button
              onClick={() => openEdit(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {rights.canDelete && (
            <button
              onClick={() => setDeleteConfirm(row.original.Id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={() =>
                setCascadeTarget({ Id: row.original.Id, Name: row.original.Name })
              }
              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
              title="Super Admin: delete project and ALL its transactions"
            >
              <ShieldAlert size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ProjectMaster() {
  const qc = useQueryClient();
  const rights = usePageRights("project-master");
  const [form, setForm] = useState<Project>(emptyProject);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewTarget, setViewTarget] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<
    "general" | "location" | "compliance" | "timeline" | "financial"
  >("general");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<{ Id: number; Name: string } | null>(null);
  const [cascadeConfirmText, setCascadeConfirmText] = useState("");
  const [imagePreview, setImagePreview] = useState<string>("");
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [complianceLoading, setComplianceLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectTypes = useLookup("PROJECT_TYPE", [
    "Construction",
    "IT",
    "Infrastructure",
    "Manufacturing",
    "Consulting",
    "Research",
    "Maintenance",
  ]);
  const statuses = useLookup("PROJECT_STATUS", [
    "Planning",
    "Active",
    "On Hold",
    "Completed",
    "Cancelled",
  ]);
  const priorities = useLookup("PROJECT_PRIORITY", [
    "Low",
    "Medium",
    "High",
    "Critical",
  ]);
  const currencies = useLookup("CURRENCY", ["INR", "USD", "EUR", "GBP", "AED"]);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["project-master"],
    queryFn: getProjects,
    staleTime: 5 * 60 * 1000,
  });

  const { data: enterprises = [] } = useQuery({
    queryKey: ["enterprises-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/enterprises");
      if (!res.ok) throw new Error("Failed to load enterprises");
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data) ? data.filter((e: any) => !e.discontinue) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/company-master");
      if (!res.ok) throw new Error("Failed to load companies");
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data)
        ? data.filter((c: any) => c.IsActive !== 0)
        : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Companies filtered to those belonging to the selected enterprise
  const filteredCompanies = useMemo(() => {
    if (!form.enterpriseId) return companies as any[];
    return (companies as any[]).filter(
      (c) =>
        String(c.EnterpriseId ?? c.enterprise_id ?? "") === form.enterpriseId,
    );
  }, [companies, form.enterpriseId]);

  // Auto-fetch compliance fields when company selection changes
  const handleCompanyChange = async (
    companyId: string,
    companyName: string,
  ) => {
    setForm((p) => ({
      ...p,
      companyId,
      companyName,
      // reset compliance while fetching
      gst: "",
      gstDate: "",
      pan: "",
      tan: "",
      tradeLicenseNo: "",
    }));
    if (!companyId) return;
    setComplianceLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/project-master/company/${companyId}`,
      );
      if (!res.ok) throw new Error();
      const d = await res.json();
      setForm((p) => ({
        ...p,
        gst: d.GST ?? "",
        gstDate: d.GSTDate ? d.GSTDate.slice(0, 10) : "",
        pan: d.PAN ?? "",
        tan: d.TAN ?? "",
        tradeLicenseNo: d.TradeLicenseNo ?? "",
      }));
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err, "Couldn't fetch compliance details for this company."),
      );
    } finally {
      setComplianceLoading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        code: form.code,
        name: form.name,
        shortName: form.shortName,
        type: form.type,
        enterpriseId: form.enterpriseId ? parseInt(form.enterpriseId) : null,
        companyId: form.companyId ? parseInt(form.companyId) : null,
        // address
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        addressLine3: form.addressLine3 || null,
        zipCode: form.zipCode || null,
        latitude: form.latitude || null,
        longitude: form.longitude || null,
        // jv
        jvEnabled: form.jvEnabled,
        jvCompanyName: form.jvEnabled ? form.jvCompanyName || null : null,
        // rest
        teamSize: form.teamSize,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        currency: form.currency,
        status: form.status,
        priority: form.priority,
        description: form.description,
        remarks: form.remarks,
        isActive: form.isActive,
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

      return editId ? updateProject(editId, payload) : createProject(payload);
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
    onError: (e: any) =>
      toast.error(
        friendlyErrorMessage(e, "Couldn't save this project. Please check the details and try again."),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Project deleted successfully");
      qc.invalidateQueries({ queryKey: ["project-master"] });
      qc.invalidateQueries({ queryKey: ["enterprises"] });
      setDeleteConfirm(null);
    },
    onError: (e: any) =>
      toast.error(
        friendlyErrorMessage(e, "Couldn't delete this project. It may still be in use elsewhere."),
      ),
  });

  const cascadeDeleteMutation = useMutation({
    mutationFn: () => deleteProjectCascade(cascadeTarget!.Id, cascadeConfirmText),
    onSuccess: (res: any) => {
      const tableCount = Object.keys(res?.deleted || {}).length;
      toast.success(
        tableCount
          ? `Project and its transactions deleted (${tableCount} table${tableCount > 1 ? "s" : ""} affected).`
          : "Project deleted — it had no linked transactions.",
      );
      qc.invalidateQueries({ queryKey: ["project-master"] });
      qc.invalidateQueries({ queryKey: ["enterprises"] });
      setCascadeTarget(null);
      setCascadeConfirmText("");
    },
    onError: (e: any) =>
      toast.error(
        friendlyErrorMessage(e, "Couldn't delete this project and its linked data."),
      ),
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
      return toast.error("Please select an image file (PNG, JPG, etc.).");
    if (file.size > 5 * 1024 * 1024)
      return toast.error("That image is too large — please use a file under 5 MB.");
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
      (p.Code ?? "").toLowerCase().includes(search.toLowerCase()),
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

  const openView = (row: any) => setViewTarget(rowToForm(row));

  const columns = useMemo(
    () =>
      buildProjectColumns(
        openView,
        openEdit,
        setDeleteConfirm,
        rights,
        isSuperAdmin,
        setCascadeTarget,
      ),
    [rights, isSuperAdmin],
  );

  // Reusable text input
  const fi = (
    label: string,
    key: keyof Project,
    type = "text",
    ph = "",
    readOnly = false,
    required = false,
  ) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {type === "date" ? (
        <div className="relative">
          <CalendarDays
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="date"
            value={(form[key] as string) || ""}
            onChange={(e) =>
              !readOnly && setForm((p) => ({ ...p, [key]: e.target.value }))
            }
            readOnly={readOnly}
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${readOnly ? "opacity-60 cursor-not-allowed bg-muted/40" : ""}`}
          />
        </div>
      ) : (
        <input
          type={type}
          value={(form[key] as string) || ""}
          onChange={(e) =>
            !readOnly && setForm((p) => ({ ...p, [key]: e.target.value }))
          }
          placeholder={ph || label}
          readOnly={readOnly}
          className={`w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all ${readOnly ? "opacity-60 cursor-not-allowed bg-muted/40" : ""}`}
        />
      )}
    </div>
  );

  const se = (label: string, key: keyof Project, options: string[]) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <div className="relative">
        <select
          value={(form[key] as string) || ""}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );

  const TABS = [
    "general",
    "location",
    "compliance",
    "timeline",
    "financial",
  ] as const;

  return (
    <>
      <Breadcrumbs items={["Admin", "Masters", "Project Master"]} />

      <AdminShell
        title="Project Master"
        subtitle="Manage projects, timelines and location"
        icon={FolderKanban}
        action={
          !showForm &&
          rights.canCreate && (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
            >
              <Plus size={13} /> Add Project
            </button>
          )
        }
      >
        {/* Table */}
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
                  placeholder="Search by name or code…"
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
                  defaultPageSize={10}
                  emptyMessage="No projects found."
                />
              </div>
            )}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Form header */}
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

            {/* Tabs */}
            <div className="flex gap-1 p-3 border-b border-border bg-muted/20 overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-md text-xs font-heading font-semibold capitalize whitespace-nowrap transition-colors ${
                    activeTab === tab
                      ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tab === "compliance" ? (
                    <span className="flex items-center gap-1">
                      <Shield size={11} /> Compliance
                    </span>
                  ) : tab === "location" ? (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} /> Location
                    </span>
                  ) : (
                    tab
                  )}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* ── General ── */}
              {activeTab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Image */}
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

                  {fi("Project Code", "code", "text", "e.g. PRJ-001", false, true)}
                  {fi("Project Name", "name", "text", "", false, true)}
                  {fi("Short Name", "shortName")}
                  {se("Type", "type", projectTypes)}

                  {/* Enterprise Dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Enterprise
                    </label>
                    <div className="relative">
                      <select
                        value={form.enterpriseId}
                        onChange={(e) => {
                          const selected = enterprises.find(
                            (en: any) =>
                              String(en.id ?? en.Id) === e.target.value,
                          );
                          setForm((p) => ({
                            ...p,
                            enterpriseId: e.target.value,
                            enterpriseName: selected
                              ? (selected.name ?? selected.Name ?? "")
                              : "",
                            // Clear company when enterprise changes
                            companyId: "",
                            companyName: "",
                            gst: "",
                            gstDate: "",
                            pan: "",
                            tan: "",
                            tradeLicenseNo: "",
                          }));
                        }}
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
                      >
                        <option value="">— Select Enterprise —</option>
                        {enterprises.map((e: any) => {
                          const name = e.name ?? e.Name ?? "";
                          const id = String(e.id ?? e.Id);
                          return (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown
                        size={13}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                    </div>
                  </div>

                  {/* Company Dropdown — filtered by selected enterprise */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Company
                    </label>
                    <div className="relative">
                      <select
                        value={form.companyId}
                        onChange={(e) => {
                          const selected = filteredCompanies.find(
                            (c: any) => String(c.Id ?? c.id) === e.target.value,
                          );
                          handleCompanyChange(
                            e.target.value,
                            selected
                              ? (selected.Name ?? selected.name ?? "")
                              : "",
                          );
                        }}
                        disabled={!form.enterpriseId}
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {form.enterpriseId
                            ? "— Select Company —"
                            : "— Select Enterprise first —"}
                        </option>
                        {filteredCompanies.map((c: any) => {
                          const name = c.Name ?? c.name ?? "";
                          const id = String(c.Id ?? c.id ?? "");
                          return (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown
                        size={13}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                    </div>
                    {complianceLoading && (
                      <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" />
                        Fetching compliance data…
                      </p>
                    )}
                    {form.companyId && !complianceLoading && form.gst && (
                      <p className="text-[10px] text-emerald-600 mt-1">
                        ✓ Compliance data loaded from Company Master
                      </p>
                    )}
                  </div>

                  {/* Active toggle */}
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

                  {/* Joint Venture toggle */}
                  <div className="col-span-full border border-border rounded-lg p-4 bg-muted/10 space-y-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            jvEnabled: !p.jvEnabled,
                            jvCompanyName: !p.jvEnabled ? p.jvCompanyName : "",
                          }))
                        }
                        className="flex items-center gap-2 text-sm"
                      >
                        {form.jvEnabled ? (
                          <ToggleRight size={24} className="text-violet-500" />
                        ) : (
                          <ToggleLeft
                            size={24}
                            className="text-muted-foreground"
                          />
                        )}
                        <span
                          className={
                            form.jvEnabled
                              ? "text-violet-600 font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          Joint Venture (JV)
                        </span>
                      </button>
                      {form.jvEnabled && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-600 font-medium">
                          Enabled
                        </span>
                      )}
                    </div>

                    {form.jvEnabled && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          JV Partner / Company Name
                        </label>
                        <input
                          type="text"
                          value={form.jvCompanyName}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              jvCompanyName: e.target.value,
                            }))
                          }
                          placeholder="Enter JV partner or company name"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                        />
                      </div>
                    )}
                  </div>

                  <div className="col-span-full">
                    {fi("Description", "description")}
                  </div>
                  <div className="col-span-full">
                    {fi("Remarks", "remarks")}
                  </div>
                </div>
              )}

              {/* ── Location & Address ── */}
              {activeTab === "location" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="col-span-full">
                    <p className="text-xs text-muted-foreground mb-3">
                      Enter the project's structured address and optional GPS
                      coordinates.
                    </p>
                  </div>
                  <div className="col-span-full md:col-span-2">
                    {fi(
                      "Address Line 1",
                      "addressLine1",
                      "text",
                      "Street / Building / Plot",
                    )}
                  </div>
                  <div className="col-span-full md:col-span-2">
                    {fi(
                      "Address Line 2",
                      "addressLine2",
                      "text",
                      "Area / Locality",
                    )}
                  </div>
                  <div className="col-span-full md:col-span-2">
                    {fi(
                      "City/District",
                      "addressLine3",
                      "text",
                      "City / District",
                    )}
                  </div>
                  {fi("ZIP Code", "zipCode", "text", "e.g. 400001")}
                  {fi("Latitude", "latitude", "text", "e.g. 19.0760")}
                  {fi("Longitude", "longitude", "text", "e.g. 72.8777")}
                </div>
              )}

              {/* ── Compliance ── */}
              {activeTab === "compliance" && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                    <Shield
                      size={15}
                      className="text-blue-500 mt-0.5 shrink-0"
                    />
                    <p className="text-xs text-muted-foreground">
                      These fields are automatically fetched from the linked{" "}
                      <strong>Company Master</strong> when you select a company
                      on the General tab. They are <em>read-only</em> here —
                      update them in Company Master to reflect changes.
                    </p>
                  </div>

                  {!form.companyId ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Select a Company on the <strong>General</strong> tab to
                      auto-populate compliance data.
                    </div>
                  ) : complianceLoading ? (
                    <div className="py-10 flex justify-center">
                      <Loader2
                        size={20}
                        className="animate-spin text-muted-foreground"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {fi("GST Number", "gst", "text", "", true)}
                      {fi("GST Registration Date", "gstDate", "date", "", true)}
                      {fi("PAN Number", "pan", "text", "", true)}
                      {fi("TAN Number", "tan", "text", "", true)}
                      {fi(
                        "Trade License Number",
                        "tradeLicenseNo",
                        "text",
                        "",
                        true,
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Timeline ── */}
              {activeTab === "timeline" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fi("Start Date", "startDate", "date")}
                  {fi("End Date", "endDate", "date")}
                  {se("Status", "status", statuses)}
                  {se("Priority", "priority", priorities)}
                  {fi("Team Size", "teamSize", "number")}
                </div>
              )}

              {/* ── Financial ── */}
              {activeTab === "financial" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {se("Currency", "currency", currencies)}
                </div>
              )}
            </div>

            {/* Save / Cancel */}
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
                className="font-heading font-semibold text-white text-sm px-5 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
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
        {deleteConfirm !== null && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground">
                    Delete this project?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(deleteConfirm)}
                  className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Super Admin: Delete Project + ALL Transactions */}
        {cascadeTarget !== null && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="bg-card border border-red-500/40 rounded-xl p-6 w-[26rem] shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <ShieldAlert size={18} className="text-red-600" />
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground">
                    Delete "{cascadeTarget.Name}" and ALL its transactions?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Every purchase order, GRN, invoice, payment, journal
                    voucher, stock ledger entry, follow-up record and more
                    under this project will be permanently deleted. This
                    cannot be undone.
                  </p>
                </div>
              </div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Type the project name to confirm: <span className="font-mono text-foreground">{cascadeTarget.Name}</span>
              </label>
              <input
                autoFocus
                value={cascadeConfirmText}
                onChange={(e) => setCascadeConfirmText(e.target.value)}
                placeholder="Type project name exactly"
                className="w-full mb-4 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/40"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setCascadeTarget(null);
                    setCascadeConfirmText("");
                  }}
                  className="flex-1 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    cascadeConfirmText.trim() !== cascadeTarget.Name ||
                    cascadeDeleteMutation.isPending
                  }
                  onClick={() => cascadeDeleteMutation.mutate()}
                  className="flex-1 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {cascadeDeleteMutation.isPending ? "Deleting…" : "Delete Everything"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </AdminShell>
    </>
  );
}
