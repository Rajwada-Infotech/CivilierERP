import React, { useState } from "react";
import { Landmark, Plus, Pencil, Trash2, Search, Globe, Phone, Mail, FileText, ToggleLeft, ToggleRight } from "lucide-react";

interface Company {
  id: string;
  code: string;
  name: string;
  legalName: string;
  shortName: string;
  type: string;
  industry: string;
  incorporationDate: string;
  cinNumber: string;
  panNumber: string;
  tanNumber: string;
  gstNumber: string;
  registeredAddress: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
  authorizedCapital: string;
  paidUpCapital: string;
  currency: string;
  fiscalYearStart: string;
  auditorName: string;
  bankName: string;
  bankAccountNo: string;
  bankIfscCode: string;
  isActive: boolean;
  remarks: string;
  logoUrl: string;
}

const CO_TYPES = ["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Section 8", "OPC"];
const INDUSTRIES = ["Manufacturing", "IT & Technology", "Infrastructure", "Retail", "Finance", "Healthcare", "Education", "Logistics", "Real Estate", "Other"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

const empty: Company = {
  id: "", code: "", name: "", legalName: "", shortName: "", type: "Private Limited",
  industry: "Manufacturing", incorporationDate: "", cinNumber: "", panNumber: "",
  tanNumber: "", gstNumber: "", registeredAddress: "", city: "", state: "",
  country: "India", pincode: "", phone: "", fax: "", email: "", website: "",
  authorizedCapital: "", paidUpCapital: "", currency: "INR", fiscalYearStart: "April",
  auditorName: "", bankName: "", bankAccountNo: "", bankIfscCode: "",
  isActive: true, remarks: "", logoUrl: "",
};

export default function CompanyMaster() {
  const [companies, setCompanies] = useState<Company[]>([
    { ...empty, id: "CO001", code: "MAIN", name: "Civilier ERP Pvt. Ltd.", legalName: "Civilier Enterprise Resource Planning Private Limited", shortName: "CERP", type: "Private Limited", industry: "IT & Technology", city: "Mumbai", state: "Maharashtra", isActive: true },
  ]);
  const [form, setForm] = useState<Company>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "address" | "legal" | "banking">("general");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.city.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setForm({ ...empty, id: `CO${String(companies.length + 1).padStart(3, "0")}` }); setEditId(null); setShowForm(true); setActiveTab("general"); };
  const openEdit = (c: Company) => { setForm({ ...c }); setEditId(c.id); setShowForm(true); setActiveTab("general"); };
  const handleSave = () => {
    if (!form.code || !form.name) return;
    if (editId) setCompanies(prev => prev.map(c => c.id === editId ? form : c));
    else setCompanies(prev => [...prev, form]);
    setShowForm(false);
  };
  const handleDelete = (id: string) => { setCompanies(prev => prev.filter(c => c.id !== id)); setDeleteConfirm(null); };

  const fi = (label: string, key: keyof Company, type = "text", placeholder = "") => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input type={type} value={form[key] as string} onChange={e => setForm(c => ({ ...c, [key]: e.target.value }))}
        placeholder={placeholder || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
    </div>
  );
  const se = (label: string, key: keyof Company, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <select value={form[key] as string} onChange={e => setForm(c => ({ ...c, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Landmark size={20} className="text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold text-foreground">Company Master</h1>
            <p className="text-xs text-muted-foreground">Manage company profiles, legal and banking details</p>
          </div>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors">
          <Plus size={16} /> Add Company
        </button>
      </div>

      {!showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code, city…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} compan{filtered.length !== 1 ? "ies" : "y"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Code", "Company Name", "Legal Name", "Type", "Industry", "City", "PAN", "GST", "Status", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground text-sm">No companies found</td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{c.code}</td>
                    <td className="px-4 py-3 font-medium text-foreground max-w-[180px] truncate">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate">{c.legalName}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600">{c.type}</span></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{c.industry}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.city}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.panNumber}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.gstNumber}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{c.isActive ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteConfirm(c.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
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
            <h2 className="font-heading font-semibold text-foreground">{editId ? "Edit Company" : "New Company"}</h2>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          </div>
          <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
            {(["general", "address", "legal", "banking"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {tab}
              </button>
            ))}
          </div>
          <div className="p-6">
            {activeTab === "general" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {fi("Company Code *", "code", "text", "e.g. MAIN")}
                {fi("Company Name *", "name")}
                {fi("Legal Name", "legalName")}
                {fi("Short Name", "shortName")}
                {se("Company Type", "type", CO_TYPES)}
                {se("Industry", "industry", INDUSTRIES)}
                {fi("Incorporation Date", "incorporationDate", "date")}
                {se("Currency", "currency", CURRENCIES)}
                {se("Fiscal Year Start", "fiscalYearStart", ["January", "April", "July", "October"])}
                <div className="flex items-center gap-3 pt-5">
                  <button onClick={() => setForm(c => ({ ...c, isActive: !c.isActive }))} className="flex items-center gap-2 text-sm">
                    {form.isActive ? <ToggleRight size={24} className="text-emerald-500" /> : <ToggleLeft size={24} className="text-muted-foreground" />}
                    <span className={form.isActive ? "text-emerald-600 text-sm" : "text-muted-foreground text-sm"}>{form.isActive ? "Active" : "Inactive"}</span>
                  </button>
                </div>
                <div className="col-span-full">{fi("Remarks", "remarks")}</div>
              </div>
            )}
            {activeTab === "address" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="col-span-full">{fi("Registered Address", "registeredAddress")}</div>
                {fi("City", "city")}
                {fi("State", "state")}
                {fi("Country", "country")}
                {fi("Pincode", "pincode")}
                {fi("Phone", "phone")}
                {fi("Fax", "fax")}
                {fi("Email", "email", "email")}
                {fi("Website", "website")}
                {fi("Auditor Name", "auditorName")}
              </div>
            )}
            {activeTab === "legal" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {fi("CIN Number", "cinNumber")}
                {fi("PAN Number", "panNumber", "text", "AAAAA0000A")}
                {fi("TAN Number", "tanNumber")}
                {fi("GST Number", "gstNumber", "text", "22AAAAA0000A1Z5")}
                {fi("Authorized Capital (₹)", "authorizedCapital", "number")}
                {fi("Paid Up Capital (₹)", "paidUpCapital", "number")}
              </div>
            )}
            {activeTab === "banking" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {fi("Bank Name", "bankName")}
                {fi("Account Number", "bankAccountNo")}
                {fi("IFSC Code", "bankIfscCode", "text", "e.g. HDFC0001234")}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.code || !form.name}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {editId ? "Update" : "Save"} Company
            </button>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center"><Trash2 size={18} className="text-red-500" /></div>
              <div><p className="font-heading font-semibold text-foreground">Delete Company?</p><p className="text-xs text-muted-foreground">This action cannot be undone.</p></div>
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
