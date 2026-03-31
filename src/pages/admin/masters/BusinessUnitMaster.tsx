import React, { useState } from "react";
import { Building2, Plus, Pencil, Trash2, Search, MapPin, Phone, Mail, Globe, FileText, Hash, ToggleLeft, ToggleRight } from "lucide-react";

interface BusinessUnit {
  id: string;
  code: string;
  name: string;
  shortName: string;
  type: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  gstNumber: string;
  panNumber: string;
  cinNumber: string;
  currencyCode: string;
  fiscalYearStart: string;
  isActive: boolean;
  parentUnit: string;
  costCenter: string;
  profitCenter: string;
  remarks: string;
}

const UNIT_TYPES = ["Head Office", "Branch", "Division", "Department", "Subsidiary", "Project Office"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

const emptyUnit: BusinessUnit = {
  id: "", code: "", name: "", shortName: "", type: "Branch", address: "",
  city: "", state: "", country: "India", pincode: "", phone: "", email: "",
  website: "", gstNumber: "", panNumber: "", cinNumber: "", currencyCode: "INR",
  fiscalYearStart: "April", isActive: true, parentUnit: "", costCenter: "",
  profitCenter: "", remarks: "",
};

export default function BusinessUnitMaster() {
  const [units, setUnits] = useState<BusinessUnit[]>([
    { ...emptyUnit, id: "BU001", code: "HO", name: "Head Office", shortName: "HO", type: "Head Office", city: "Mumbai", state: "Maharashtra", isActive: true },
    { ...emptyUnit, id: "BU002", code: "DEL", name: "Delhi Branch", shortName: "DEL", type: "Branch", city: "Delhi", state: "Delhi", isActive: true },
  ]);
  const [form, setForm] = useState<BusinessUnit>(emptyUnit);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "address" | "financial" | "accounting">("general");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = units.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.code.toLowerCase().includes(search.toLowerCase()) ||
    u.city.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setForm({ ...emptyUnit, id: `BU${String(units.length + 1).padStart(3, "0")}` }); setEditId(null); setShowForm(true); setActiveTab("general"); };
  const openEdit = (u: BusinessUnit) => { setForm({ ...u }); setEditId(u.id); setShowForm(true); setActiveTab("general"); };

  const handleSave = () => {
    if (!form.code || !form.name) return;
    if (editId) {
      setUnits(prev => prev.map(u => u.id === editId ? form : u));
    } else {
      setUnits(prev => [...prev, form]);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    setUnits(prev => prev.filter(u => u.id !== id));
    setDeleteConfirm(null);
  };

  const field = (label: string, key: keyof BusinessUnit, type = "text", placeholder = "") => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );

  const selectField = (label: string, key: keyof BusinessUnit, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <select
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Building2 size={20} className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold text-foreground">Business Unit Master</h1>
            <p className="text-xs text-muted-foreground">Manage all business units, branches and divisions</p>
          </div>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={16} /> Add Business Unit
        </button>
      </div>

      {/* Search + Table */}
      {!showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code, city…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} unit{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Code", "Name", "Short Name", "Type", "City", "State", "Status", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-sm">No business units found</td></tr>
                ) : filtered.map(u => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{u.code}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.shortName}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-600">{u.type}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{u.city}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.state}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(u)} className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteConfirm(u.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <h2 className="font-heading font-semibold text-foreground">{editId ? "Edit Business Unit" : "New Business Unit"}</h2>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
            {(["general", "address", "financial", "accounting"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === "general" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {field("Unit Code *", "code", "text", "e.g. HO, DEL")}
                {field("Unit Name *", "name")}
                {field("Short Name", "shortName")}
                {selectField("Unit Type", "type", UNIT_TYPES)}
                {field("Parent Unit", "parentUnit", "text", "Select parent unit")}
                <div className="flex items-center gap-3 pt-5">
                  <button onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))} className="flex items-center gap-2 text-sm text-foreground">
                    {form.isActive ? <ToggleRight size={24} className="text-emerald-500" /> : <ToggleLeft size={24} className="text-muted-foreground" />}
                    <span className={form.isActive ? "text-emerald-600" : "text-muted-foreground"}>
                      {form.isActive ? "Active" : "Inactive"}
                    </span>
                  </button>
                </div>
                <div className="col-span-full">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Remarks</label>
                  <textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={2}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                </div>
              </div>
            )}

            {activeTab === "address" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="col-span-full">{field("Address Line", "address")}</div>
                {field("City", "city")}
                {field("State", "state")}
                {field("Country", "country")}
                {field("Pin / Zip Code", "pincode")}
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-muted-foreground mt-5" />
                  {field("Phone", "phone")}
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-muted-foreground mt-5" />
                  {field("Email", "email", "email")}
                </div>
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-muted-foreground mt-5" />
                  {field("Website", "website")}
                </div>
              </div>
            )}

            {activeTab === "financial" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {field("GST Number", "gstNumber", "text", "22AAAAA0000A1Z5")}
                {field("PAN Number", "panNumber", "text", "AAAAA0000A")}
                {field("CIN Number", "cinNumber")}
                {selectField("Currency Code", "currencyCode", CURRENCIES)}
                {selectField("Fiscal Year Start", "fiscalYearStart", ["January", "April", "July", "October"])}
              </div>
            )}

            {activeTab === "accounting" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {field("Cost Center", "costCenter")}
                {field("Profit Center", "profitCenter")}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.code || !form.name}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {editId ? "Update" : "Save"} Business Unit
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center"><Trash2 size={18} className="text-red-500" /></div>
              <div><p className="font-heading font-semibold text-foreground">Delete Unit?</p><p className="text-xs text-muted-foreground">This action cannot be undone.</p></div>
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
