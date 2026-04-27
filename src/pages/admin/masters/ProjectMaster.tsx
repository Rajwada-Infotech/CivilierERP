// src/pages/masters/ProjectMaster.tsx
import React, { useState, useRef } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
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
  enterpriseId?: number | string;
  businessUnit: string;
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

// ── Project avatar shown beside name in table + form header ──────────────────
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
  enterpriseId: "",
  businessUnit: "",
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

function rowToForm(row: any): Project {
  return {
    Id: row.Id,
    code: row.Code ?? "",
    name: row.Name ?? "",
    shortName: row.ShortName ?? "",
    type: row.Type ?? "Construction",
    enterpriseId: row.EnterpriseId,
    businessUnit: row.BusinessUnit ?? "",
    clientName: row.ClientName ?? "",
    clientCode: row.ClientCode ?? "",
    teamSize: row.TeamSize != null ? String(row.TeamSize) : "",
    startDate: row.StartDate ? row.StartDate.slice(0, 10) : "",
    endDate: row.EndDate ? row.EndDate.slice(0, 10) : "",
    currency: row.Currency ?? "INR",
    status: row.Status ?? "Planning",
    priority: row.Priority ?? "Medium",
    location: row.Location ?? "",
    description: row.Description ?? "",
    remarks: row.Remarks ?? "",
    isActive: row.IsActive !== 0,
    projectImage: row.ProjectImage || null,
  };
}

export default function ProjectMaster() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Project>(emptyProject);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
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

  // FIXED: Enterprise dropdown using reliable fetch
  const { data: enterprises = [], isLoading: enterprisesLoading } = useQuery({
    queryKey: ["enterprises"],
    queryFn: async () => {
      const endpoints = ["/api/enterprises"];

      for (const endpoint of endpoints) {
        try {
          const res = await fetchWithAuth(endpoint);
          if (res.ok) {
            const data = await res.json();

            return Array.isArray(data) ? data : [];
          }
        } catch (e) {
          console.log(`Failed endpoint: ${endpoint}`);
        }
      }
      throw new Error("Could not load enterprises from any endpoint");
    },
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build plain JSON payload — backend uses req.body (JSON), not FormData
      const payload: Record<string, any> = {};
      Object.entries(form).forEach(([key, value]) => {
        if (
          key !== "projectImage" &&
          value !== null &&
          value !== undefined &&
          value !== ""
        ) {
          payload[key] = value;
        }
      });
      // Convert File to base64 for NVARCHAR(MAX) storage
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
      resetForm();
    },
    onError: (e: any) => toast.error(e.message || "Something went wrong"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Project deleted successfully");
      qc.invalidateQueries({ queryKey: ["project-master"] });
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
    resetForm();
    setShowForm(true);
    setActiveTab("general");
  };

  const openEdit = (row: any) => {
    const f = rowToForm(row);
    setForm(f);
    setImagePreview(f.projectImage || "");
    setEditId(row.Id);
    setShowForm(true);
    setActiveTab("general");
  };

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
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {[
                        "Code",
                        "Project Name",
                        "Client",
                        "Type",
                        "Status",
                        "Priority",
                        "Active",
                        "Actions",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-heading text-muted-foreground whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-10 text-center text-muted-foreground text-sm"
                        >
                          No projects found
                        </td>
                      </tr>
                    ) : (
                      filtered.map((p: any) => (
                        <tr
                          key={p.Id}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs font-medium text-primary">
                            {p.Code}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <ProjectAvatar
                                imageUrl={p.ProjectImage}
                                name={p.Name || "?"}
                              />
                              <span className="font-medium text-foreground max-w-[160px] truncate">
                                {p.Name}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {p.ClientName}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {p.Type}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
                              {p.Status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">{p.Priority}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.IsActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}
                            >
                              {p.IsActive ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openEdit(p)}
                                className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(p.Id)}
                                className="p-1.5 rounded-md hover:bg-red-500/10 text-red-500"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
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

                  {/* Enterprise Dropdown - FIXED */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Enterprise <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.enterpriseId || ""}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          enterpriseId: e.target.value,
                          businessUnit: e.target.value,
                        }))
                      }
                      disabled={enterprisesLoading}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="">Select Enterprise</option>
                      {enterprises.map((ent: any) => (
                        <option key={ent.id || ent.Id} value={ent.id || ent.Id}>
                          {ent.label ||
                            ent.name ||
                            ent.Name ||
                            `Enterprise ${ent.id || ent.Id}`}
                        </option>
                      ))}
                    </select>
                    {enterprisesLoading && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Loading enterprises...
                      </p>
                    )}
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
                disabled={
                  !form.code ||
                  !form.name ||
                  !form.enterpriseId ||
                  saveMutation.isPending
                }
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

        {/* Delete Confirmation */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card border border-border rounded-xl p-6 w-80">
              <p className="font-semibold text-foreground">
                Delete this project?
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone.
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
