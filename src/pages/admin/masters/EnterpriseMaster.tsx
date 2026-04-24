import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Pencil, Trash2, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getEnterprises, addEnterprise, updateEnterprise, deleteEnterprise, type Enterprise } from "@/api/enterpriseApi";
import { toast } from "sonner";

const ENTITY_TYPES = ["Enterprise", "Company", "Business Unit"];
const GST_TYPES = ["Regular", "Composition", "Unregistered", "SEZ", "Deemed Export"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];
const FIN_YEARS = ["April", "January", "July", "October"];

const empty: Partial<Enterprise> = {
  name: "", short_name: "", entity_type: "Enterprise", description: "",
  start_date: "", start_fin_year: "",
  address: "", address_line2: "", city: "", state: "", country: "India", pincode: "",
  phone_number: "", email: "", website: "",
  latitude: null, longitude: null,
  gst_type: "", gst_issue_date: "", tan: "", pan: "", cin: "", cr_code: "",
  rera_no: "", rera_date: "", trade_license: "",
  date_of_entry: "", date_of_establishment: "",
  currency: "INR", fiscal_year_start: "April", tds_limit: null,
  cost_center: "", profit_center: "",
  status: "Active", discontinue: false,
};

type Tab = "general" | "address" | "legal" | "accounting";

const ENTITY_COLORS: Record<string, string> = {
  Enterprise: "bg-purple-500/10 text-purple-600",
  Company: "bg-blue-500/10 text-blue-600",
  "Business Unit": "bg-amber-500/10 text-amber-600",
};

export default function EnterpriseMaster() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
    staleTime: 5 * 60 * 1000,
  });

  const [form, setForm] = useState<Partial<Enterprise>>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("general");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = rows.filter(r =>
    (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.short_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.entity_type || "").toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setForm({ ...empty }); setEditId(null); setShowForm(true); setTab("general"); };
  const openEdit = (r: Enterprise) => {
    setForm({
      ...r,
      start_date: r.start_date?.slice(0, 10) || "",
      gst_issue_date: r.gst_issue_date?.slice(0, 10) || "",
      rera_date: r.rera_date?.slice(0, 10) || "",
      date_of_entry: r.date_of_entry?.slice(0, 10) || "",
      date_of_establishment: r.date_of_establishment?.slice(0, 10) || "",
    });
    setEditId(r.id);
    setShowForm(true);
    setTab("general");
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editId) {
        await updateEnterprise(editId, form);
        toast.success("Enterprise updated");
      } else {
        await addEnterprise(form);
        toast.success("Enterprise created");
      }
      await queryClient.invalidateQueries({ queryKey: ["enterprises"] });
      setShowForm(false);
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEnterprise(deleteTarget);
      toast.success("Enterprise deleted");
      await queryClient.invalidateQueries({ queryKey: ["enterprises"] });
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  const set = (key: keyof Enterprise, val: unknown) => setForm(f => ({ ...f, [key]: val }));

  const field = (label: string, key: keyof Enterprise, type = "text", placeholder = "") => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        value={(form[key] as string) ?? ""}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );

  const sel = (label: string, key: keyof Enterprise, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <select
        value={(form[key] as string) ?? ""}
        onChange={e => set(key, e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        <option value="">— Select —</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={["Dashboard", "Admin", "Masters", "Enterprise Master"]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Building2 size={20} className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-semibold text-foreground">Enterprise Master</h1>
            <p className="text-xs text-muted-foreground">Manage enterprises, companies and business units</p>
          </div>
        </div>
        {!showForm && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors">
            <Plus size={16} /> Add Enterprise
          </button>
        )}
      </div>

      {/* Table */}
      {!showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, type…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["Name", "Short Name", "Type", "PAN", "GST Type", "Phone", "Status", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-sm">No records found</td></tr>
                  ) : filtered.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.short_name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ENTITY_COLORS[r.entity_type || ""] || "bg-muted text-muted-foreground"}`}>
                          {r.entity_type || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.pan || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.gst_type || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.phone_number || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.discontinue ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-600"}`}>
                          {r.discontinue ? "Discontinued" : (r.status || "Active")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => setDeleteTarget(r.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
            <h2 className="font-heading font-semibold text-foreground">{editId ? "Edit Enterprise" : "New Enterprise"}</h2>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors">Cancel</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
            {(["general", "address", "legal", "accounting"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-xs font-heading capitalize transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {t === "legal" ? "Legal / Compliance" : t}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* General */}
            {tab === "general" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {field("Name *", "name", "text", "Full legal name")}
                {field("Short Name", "short_name", "text", "Abbreviated name")}
                {sel("Type", "entity_type", ENTITY_TYPES)}
                {field("Description", "description", "text")}
                {field("Start Date", "start_date", "date")}
                {field("Start Financial Year", "start_fin_year", "text", "e.g. 2024-25")}
                {sel("Status", "status", ["Active", "Inactive", "Suspended"])}
                <div className="flex items-center gap-3 pt-5">
                  <button onClick={() => set("discontinue", !form.discontinue)} className="flex items-center gap-2 text-sm">
                    {form.discontinue
                      ? <ToggleRight size={24} className="text-red-500" />
                      : <ToggleLeft size={24} className="text-muted-foreground" />}
                    <span className={form.discontinue ? "text-red-500" : "text-muted-foreground"}>
                      {form.discontinue ? "Discontinued" : "Not Discontinued"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Address */}
            {tab === "address" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="col-span-full">{field("Address Line 1", "address")}</div>
                <div className="col-span-full">{field("Address Line 2", "address_line2")}</div>
                {field("City", "city")}
                {field("State", "state")}
                {field("Country", "country")}
                {field("Pincode", "pincode")}
                {field("Phone", "phone_number", "tel")}
                {field("Email", "email", "email")}
                {field("Website", "website", "url")}
                {field("Latitude", "latitude", "number")}
                {field("Longitude", "longitude", "number")}
              </div>
            )}

            {/* Legal / Compliance */}
            {tab === "legal" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {sel("GST Type", "gst_type", GST_TYPES)}
                {field("GST Issue Date", "gst_issue_date", "date")}
                {field("TAN", "tan", "text", "Tax Deduction Account Number")}
                {field("PAN", "pan", "text", "AAAAA0000A")}
                {field("CIN", "cin", "text", "Company Identification Number")}
                {field("CR Code", "cr_code")}
                {field("RERA No.", "rera_no")}
                {field("RERA Date", "rera_date", "date")}
                {field("Trade License", "trade_license")}
                {field("Date of Entry", "date_of_entry", "date")}
                {field("Date of Establishment", "date_of_establishment", "date")}
              </div>
            )}

            {/* Accounting */}
            {tab === "accounting" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {sel("Currency", "currency", CURRENCIES)}
                {sel("Fiscal Year Start", "fiscal_year_start", FIN_YEARS)}
                {field("TDS Limit", "tds_limit", "number")}
                {field("Cost Center", "cost_center")}
                {field("Profit Center", "profit_center")}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.name?.trim()}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {saving ? "Saving…" : editId ? "Update" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center"><Trash2 size={18} className="text-red-500" /></div>
              <div><p className="font-heading font-semibold text-foreground">Delete Enterprise?</p><p className="text-xs text-muted-foreground">This action cannot be undone.</p></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 text-sm rounded-lg border border-border hover:bg-muted">Cancel</button>
              <button onClick={handleDelete} className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
