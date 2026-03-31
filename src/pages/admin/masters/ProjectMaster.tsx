import React, { useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2, Search, Calendar, DollarSign, Users, ToggleLeft, ToggleRight, Tag } from "lucide-react";

interface Project {
  id: string;
  code: string;
  name: string;
  shortName: string;
  type: string;
  businessUnit: string;
  clientName: string;
  clientCode: string;
  projectManager: string;
  teamSize: string;
  startDate: string;
  endDate: string;
  estimatedCost: string;
  approvedBudget: string;
  currency: string;
  billingType: string;
  contractValue: string;
  status: string;
  priority: string;
  location: string;
  description: string;
  remarks: string;
  isActive: boolean;
  costCenter: string;
  profitCenter: string;
  wbsCode: string;
  percentComplete: string;
}

const PROJECT_TYPES = ["Construction", "IT", "Infrastructure", "Manufacturing", "Consulting", "Research", "Maintenance"];
const BILLING_TYPES = ["Fixed Price", "Time & Material", "Cost Plus", "Milestone Based", "Retainer"];
const STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

const empty: Project = {
  id: "", code: "", name: "", shortName: "", type: "Construction", businessUnit: "",
  clientName: "", clientCode: "", projectManager: "", teamSize: "", startDate: "",
  endDate: "", estimatedCost: "", approvedBudget: "", currency: "INR", billingType: "Fixed Price",
  contractValue: "", status: "Planning", priority: "Medium", location: "", description: "",
  remarks: "", isActive: true, costCenter: "", profitCenter: "", wbsCode: "", percentComplete: "0",
};

export default function ProjectMaster() {
  const [projects, setProjects] = useState<Project[]>([
    { ...empty, id: "PRJ001", code: "P001", name: "ERP Implementation", shortName: "ERP-IMPL", type: "IT", businessUnit: "HO", clientName: "ABC Corp", status: "Active", priority: "High", isActive: true },
    { ...empty, id: "PRJ002", code: "P002", name: "Office Renovation", shortName: "OFF-REN", type: "Construction", businessUnit: "DEL", clientName: "Internal", status: "Planning", priority: "Medium", isActive: true },
  ]);
  const [form, setForm] = useState<Project>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "timeline" | "financial" | "team">("general");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.code.toLowerCase().includes(search.toLowerCase()) ||
    p.clientName.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setForm({ ...empty, id: `PRJ${String(projects.length + 1).padStart(3, "0")}` }); setEditId(null); setShowForm(true); setActiveTab("general"); };
  const openEdit = (p: Project) => { setForm({ ...p }); setEditId(p.id); setShowForm(true); setActiveTab("general"); };

  const handleSave = () => {
    if (!form.code || !form.name) return;
    if (editId) setProjects(prev => prev.map(p => p.id === editId ? form : p));
    else setProjects(prev => [...prev, form]);
    setShowForm(false);
  };

  const handleDelete = (id: string) => { setProjects(prev => prev.filter(p => p.id !== id)); setDeleteConfirm(null); };

  const f = (label: string, key: keyof Project, type = "text", placeholder = "") => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input type={type} value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
    </div>
  );

  const sel = (label: string, key: keyof Project, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <select value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  const statusColors: Record<string, string> = {
    "Planning": "bg-amber-500/10 text-amber-600",
    "Active": "bg-emerald-500/10 text-emerald-600",
    "On Hold": "bg-orange-500/10 text-orange-600",
    "Completed": "bg-blue-500/10 text-blue-600",
    "Cancelled": "bg-red-500/10 text-red-500",
  };

  const priorityColors: Record<string, string> = {
    "Low": "bg-muted text-muted-foreground",
    "Medium": "bg-blue-500/10 text-blue-600",
    "High": "bg-orange-500/10 text-orange-600",
    "Critical": "bg-red-500/10 text-red-500",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <FolderKanban size={20} className="text-violet-500" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold text-foreground">Project Master</h1>
            <p className="text-xs text-muted-foreground">Manage projects, contracts and tracking</p>
          </div>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={16} /> Add Project
        </button>
      </div>

      {!showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code, client…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} project{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Code", "Name", "Type", "Client", "Business Unit", "Status", "Priority", "Active", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-sm">No projects found</td></tr>
                ) : filtered.map(p => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{p.code}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.type}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.clientName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.businessUnit}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[p.status] || ""}`}>{p.status}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColors[p.priority] || ""}`}>{p.priority}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{p.isActive ? "Yes" : "No"}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(p)} className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteConfirm(p.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <h2 className="font-heading font-semibold text-foreground">{editId ? "Edit Project" : "New Project"}</h2>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          </div>
          <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
            {(["general", "timeline", "financial", "team"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {tab}
              </button>
            ))}
          </div>
          <div className="p-6">
            {activeTab === "general" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {f("Project Code *", "code", "text", "e.g. P001")}
                {f("Project Name *", "name")}
                {f("Short Name", "shortName")}
                {sel("Project Type", "type", PROJECT_TYPES)}
                {f("Business Unit", "businessUnit")}
                {f("WBS Code", "wbsCode")}
                {sel("Status", "status", STATUSES)}
                {sel("Priority", "priority", PRIORITIES)}
                {f("Location", "location")}
                <div className="flex items-center gap-3 pt-5">
                  <button onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))} className="flex items-center gap-2 text-sm">
                    {form.isActive ? <ToggleRight size={24} className="text-emerald-500" /> : <ToggleLeft size={24} className="text-muted-foreground" />}
                    <span className={form.isActive ? "text-emerald-600 text-sm" : "text-muted-foreground text-sm"}>{form.isActive ? "Active" : "Inactive"}</span>
                  </button>
                </div>
                <div className="col-span-full">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                </div>
              </div>
            )}
            {activeTab === "timeline" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {f("Start Date", "startDate", "date")}
                {f("End Date", "endDate", "date")}
                {f("% Complete", "percentComplete", "number")}
              </div>
            )}
            {activeTab === "financial" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {f("Client Name", "clientName")}
                {f("Client Code", "clientCode")}
                {sel("Billing Type", "billingType", BILLING_TYPES)}
                {sel("Currency", "currency", CURRENCIES)}
                {f("Contract Value", "contractValue", "number")}
                {f("Estimated Cost", "estimatedCost", "number")}
                {f("Approved Budget", "approvedBudget", "number")}
                {f("Cost Center", "costCenter")}
                {f("Profit Center", "profitCenter")}
              </div>
            )}
            {activeTab === "team" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {f("Project Manager", "projectManager")}
                {f("Team Size", "teamSize", "number")}
                <div className="col-span-full">{f("Remarks", "remarks")}</div>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.code || !form.name}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {editId ? "Update" : "Save"} Project
            </button>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center"><Trash2 size={18} className="text-red-500" /></div>
              <div><p className="font-heading font-semibold text-foreground">Delete Project?</p><p className="text-xs text-muted-foreground">This action cannot be undone.</p></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 text-sm rounded-lg border border-border hover:bg-muted">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
