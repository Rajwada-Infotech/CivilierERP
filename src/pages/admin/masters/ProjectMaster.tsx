import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
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
} from "lucide-react";
import { toast } from "sonner";

interface Project {
  Id?: number;
  code: string;
  name: string;
  shortName: string;
  type: string;
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

const empty: Project = {
  code: "",
  name: "",
  shortName: "",
  type: "Construction",
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
};

function rowToForm(row: any): Project {
  return {
    Id: row.Id,
    code: row.Code ?? "",
    name: row.Name ?? "",
    shortName: row.ShortName ?? "",
    type: row.Type ?? "Construction",
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
  };
}

export default function ProjectMaster() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Project>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "timeline" | "financial">("general");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["project-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/project-master");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  // Fetch Business Units from enterprise master
  const { data: businessUnits = [] } = useQuery({
    queryKey: ["enterprise-options", "Business Unit"],
    queryFn: () => getEnterpriseOptions("Business Unit"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editId
        ? `/api/project-master/${editId}`
        : "/api/project-master";
      const res = await fetchWithAuth(url, {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
    },
    onSuccess: () => {
      toast.success(editId ? "Project updated" : "Project created");
      qc.invalidateQueries({ queryKey: ["project-master"] });
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/project-master/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["project-master"] });
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = projects.filter(
    (p: any) =>
      (p.Name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.Code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.ClientName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const STATUS_COLORS: Record<string, string> = {
    Active: "bg-emerald-500/10 text-emerald-600",
    Planning: "bg-blue-500/10 text-blue-600",
    "On Hold": "bg-amber-500/10 text-amber-600",
    Completed: "bg-purple-500/10 text-purple-600",
    Cancelled: "bg-red-500/10 text-red-500",
  };
  const PRIORITY_COLORS: Record<string, string> = {
    Low: "bg-slate-500/10 text-slate-500",
    Medium: "bg-blue-500/10 text-blue-600",
    High: "bg-orange-500/10 text-orange-600",
    Critical: "bg-red-500/10 text-red-500",
  };

  const fi = (label: string, key: keyof Project, type = "text", ph = "") => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={ph || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );

  const se = (label: string, key: keyof Project, options: string[]) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <select
        value={form[key] as string}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
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
                Manage projects, budgets and timelines
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setForm({ ...empty });
              setEditId(null);
              setShowForm(true);
              setActiveTab("general");
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors"
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
                  placeholder="Search by name, code, client…"
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
                          className="px-4 py-3 text-left text-xs font-heading text-muted-foreground"
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
                          <td className="px-4 py-3 font-medium text-foreground max-w-[180px] truncate">
                            {p.Name}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {p.ClientName}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {p.Type}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.Status] ?? "bg-muted text-muted-foreground"}`}
                            >
                              {p.Status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLORS[p.Priority] ?? ""}`}
                            >
                              {p.Priority}
                            </span>
                          </td>
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
                                onClick={() => {
                                  setForm(rowToForm(p));
                                  setEditId(p.Id);
                                  setShowForm(true);
                                  setActiveTab("general");
                                }}
                                className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(p.Id)}
                                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
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
              <h2 className="font-heading font-semibold text-foreground">
                {editId ? "Edit Project" : "New Project"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
              {(["general", "timeline", "financial"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="p-6">
              {activeTab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fi("Project Code *", "code", "text", "e.g. PRJ-001")}
                  {fi("Project Name *", "name")}
                  {fi("Short Name", "shortName")}
                  {se("Type", "type", PROJECT_TYPES)}

                  {/* Business Unit — dropdown from enterprise master */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Business Unit
                    </label>
                    <select
                      value={form.businessUnit}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, businessUnit: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="">Select Business Unit</option>
                      {(businessUnits as any[]).map((bu: any) => (
                        <option key={bu.id ?? bu.Id ?? bu.name} value={bu.name ?? bu.Name}>
                          {bu.name ?? bu.Name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {fi("Client Name", "clientName")}
                  {fi("Client Code", "clientCode")}
                  {fi("Location", "location")}
                  <div className="flex items-center gap-3 pt-5">
                    <button
                      onClick={() =>
                        setForm((p) => ({ ...p, isActive: !p.isActive }))
                      }
                      className="flex items-center gap-2 text-sm"
                    >
                      {form.isActive ? (
                        <ToggleRight size={24} className="text-emerald-500" />
                      ) : (
                        <ToggleLeft size={24} className="text-muted-foreground" />
                      )}
                      <span
                        className={
                          form.isActive
                            ? "text-emerald-600 text-sm"
                            : "text-muted-foreground text-sm"
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
                onClick={() => setShowForm(false)}
                className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.code || !form.name || saveMutation.isPending}
                className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {saveMutation.isPending && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                {editId ? "Update" : "Save"} Project
              </button>
            </div>
          </div>
        )}

        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground">
                    Delete Project?
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
                  onClick={() => deleteMutation.mutate(deleteConfirm!)}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                >
                  {deleteMutation.isPending && (
                    <Loader2 size={13} className="animate-spin" />
                  )}
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