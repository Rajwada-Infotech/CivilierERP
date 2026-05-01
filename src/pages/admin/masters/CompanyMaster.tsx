import React, { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Landmark,
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
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const GST_TYPES = [
  "Regular",
  "Composition",
  "Unregistered",
  "Consumer",
  "SEZ",
  "Overseas",
];

const CO_TYPES = [
  "Private Limited",
  "Public Limited",
  "LLP",
  "Partnership",
  "Proprietorship",
  "Section 8",
  "OPC",
];
const INDUSTRIES = [
  "Manufacturing",
  "IT & Technology",
  "Infrastructure",
  "Retail",
  "Finance",
  "Healthcare",
  "Education",
  "Logistics",
  "Real Estate",
  "Other",
];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

interface Company {
  Id?: number;
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
  gstType: string;
  gstNumber: string;
  gstDate: string;
  tradeLicenseNo: string;
  tradeLicenseDate: string;
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
  isActive: boolean;
  remarks: string;
  logoUrl: string;
  belongsTo: string | number;
}

const empty: Company = {
  code: "",
  name: "",
  legalName: "",
  shortName: "",
  type: "Private Limited",
  industry: "Manufacturing",
  incorporationDate: "",
  cinNumber: "",
  panNumber: "",
  tanNumber: "",
  gstType: "Regular",
  gstNumber: "",
  gstDate: "",
  tradeLicenseNo: "",
  tradeLicenseDate: "",
  registeredAddress: "",
  city: "",
  state: "",
  country: "India",
  pincode: "",
  phone: "",
  fax: "",
  email: "",
  website: "",
  authorizedCapital: "",
  paidUpCapital: "",
  currency: "INR",
  fiscalYearStart: "April",
  auditorName: "",
  isActive: true,
  remarks: "",
  logoUrl: "",
  belongsTo: "",
};

function rowToForm(row: any): Company {
  return {
    Id: row.Id,
    code: row.Code ?? "",
    name: row.Name ?? "",
    legalName: row.LegalName ?? "",
    shortName: row.ShortName ?? "",
    type: row.Type ?? "Private Limited",
    industry: row.Industry ?? "Manufacturing",
    incorporationDate: row.IncorporationDate
      ? row.IncorporationDate.slice(0, 10)
      : "",
    cinNumber: row.CIN ?? "",
    panNumber: row.PAN ?? "",
    tanNumber: row.TAN ?? "",
    gstType: row.GSTType ?? "Regular",
    gstNumber: row.GST ?? "",
    gstDate: row.GSTDate ? row.GSTDate.slice(0, 10) : "",
    tradeLicenseNo: row.TradeLicenseNo ?? "",
    tradeLicenseDate: row.TradeLicenseDate
      ? row.TradeLicenseDate.slice(0, 10)
      : "",
    registeredAddress: row.RegisteredAddress ?? "",
    city: row.City ?? "",
    state: row.State ?? "",
    country: row.Country ?? "India",
    pincode: row.Pincode ?? "",
    phone: row.Phone ?? "",
    fax: row.Fax ?? "",
    email: row.Email ?? "",
    website: row.Website ?? "",
    authorizedCapital:
      row.AuthorizedCapital != null ? String(row.AuthorizedCapital) : "",
    paidUpCapital: row.PaidUpCapital != null ? String(row.PaidUpCapital) : "",
    currency: row.Currency ?? "INR",
    fiscalYearStart: row.FiscalYearStart ?? "April",
    auditorName: row.AuditorName ?? "",
    isActive: row.IsActive !== 0,
    remarks: row.Remarks ?? "",
    logoUrl: row.LogoUrl ?? "",
    belongsTo: row.belongs_to ?? "",
  };
}

// Logo avatar shown in the table beside company name
function LogoAvatar({
  logoUrl,
  name,
  size = "sm",
}: {
  logoUrl?: string;
  name: string;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "w-7 h-7 text-xs" : "w-10 h-10 text-sm";
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${dim} rounded-lg object-contain border border-border bg-muted/30 flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-lg bg-emerald-500/10 text-emerald-600 font-heading font-bold flex items-center justify-center flex-shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function buildCompanyColumns(
  openEdit: (row: any) => void,
  setDeleteConfirm: (id: number) => void,
): ColumnDef<any, unknown>[] {
  return [
    {
      id: "logo",
      header: "Logo",
      enableSorting: false,
      cell: ({ row }) => (
        <LogoAvatar
          logoUrl={row.original.LogoUrl}
          name={row.original.Name || "?"}
        />
      ),
    },
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
      header: "Company Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground max-w-[180px] truncate block">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "belongs_to",
      header: "Enterprise",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground max-w-[140px] truncate block">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LegalName",
      header: "Legal Name",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs max-w-[160px] truncate block">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "Type",
      header: "Type",
      cell: ({ getValue }) => (
        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "Industry",
      header: "Industry",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "City",
      header: "City",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "PAN",
      header: "PAN",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "GSTN",
      header: "GST No.",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "GSTType",
      header: "GST Type",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "IsActive",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            {active ? "Active" : "Inactive"}
          </span>
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
            onClick={() => openEdit(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => setDeleteConfirm(row.original.Id)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];
}
export default function CompanyMaster() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Company>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "address" | "legal">(
    "general",
  );
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["company-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/company-master");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: enterprises = [] } = useQuery({
    queryKey: ["enterprises-options"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/enterprises");
      if (!res.ok) throw new Error("Failed to load enterprises");
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: any) => !e.discontinue) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editId
        ? `/api/company-master/${editId}`
        : "/api/company-master";
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
      toast.success(editId ? "Company updated" : "Company created");
      qc.invalidateQueries({ queryKey: ["company-master"] });
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/company-master/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast.success("Company deleted");
      qc.invalidateQueries({ queryKey: ["company-master"] });
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = companies.filter(
    (c: any) =>
      (c.Name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.Code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.City ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const openNew = () => {
    setForm({ ...empty });
    setEditId(null);
    setLogoPreview("");
    setShowForm(true);
    setActiveTab("general");
  };
  const openEdit = (row: any) => {
    const f = rowToForm(row);
    setForm(f);
    setLogoPreview(f.logoUrl || "");
    setEditId(row.Id);
    setShowForm(true);
    setActiveTab("general");
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setLogoPreview(base64);
      setForm((c) => ({ ...c, logoUrl: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoPreview("");
    setForm((c) => ({ ...c, logoUrl: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const fi = (label: string, key: keyof Company, type = "text", ph = "") => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value }))}
        placeholder={ph || label}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </div>
  );

  const se = (label: string, key: keyof Company, options: string[]) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <select
        value={form[key] as string}
        onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value }))}
        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );

  const TABS = ["general", "address", "legal"] as const;

  return (
    <>
      <Breadcrumbs items={["Admin", "Masters", "Company Master"]} />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Landmark size={20} className="text-emerald-500" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-semibold text-foreground">
                Company Master
              </h1>
              <p className="text-xs text-muted-foreground">
                Manage company profiles, legal and licensing details
              </p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-heading rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} /> Add Company
          </button>
        </div>

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
                  placeholder="Search by name, code, city…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} compan{filtered.length !== 1 ? "ies" : "y"}
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
                  emptyMessage="No companies found."
                />
              </div>
            )}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                {/* Live logo preview in form header */}
                <LogoAvatar
                  logoUrl={logoPreview}
                  name={form.name || "?"}
                  size="md"
                />
                <h2 className="font-heading font-semibold text-foreground">
                  {editId ? `Edit — ${form.name || "Company"}` : "New Company"}
                </h2>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-3 border-b border-border bg-muted/20">
              {TABS.map((tab) => (
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
              {/* General tab */}
              {activeTab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Logo upload — spans full width */}
                  <div className="col-span-full">
                    <label className="block text-xs font-medium text-muted-foreground mb-2">
                      Company Logo
                    </label>
                    <div className="flex items-center gap-4">
                      {logoPreview ? (
                        <div className="relative group">
                          <img
                            src={logoPreview}
                            alt="Logo preview"
                            className="w-16 h-16 rounded-xl object-contain border border-border bg-muted/30"
                          />
                          <button
                            onClick={removeLogo}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border bg-muted/20 flex items-center justify-center">
                          <Landmark
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
                          onChange={handleLogoChange}
                          className="hidden"
                          id="company-logo-input"
                        />
                        <label
                          htmlFor="company-logo-input"
                          className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-border hover:bg-muted cursor-pointer transition-colors"
                        >
                          <Upload size={13} />
                          {logoPreview ? "Change Logo" : "Upload Logo"}
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">
                          PNG, JPG, SVG · Max 2 MB
                        </p>
                      </div>
                    </div>
                  </div>

                  {fi("Company Code *", "code", "text", "e.g. MAIN")}
                  {fi("Company Name *", "name")}
                  {fi("Legal Name", "legalName")}
                  {fi("Short Name", "shortName")}
                  {se("Company Type", "type", CO_TYPES)}
                  {se("Industry", "industry", INDUSTRIES)}

                  {/* Enterprise dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Enterprise{" "}
                      <span className="text-xs text-muted-foreground/60">
                        (Parent)
                      </span>
                    </label>
                    <select
                      value={form.belongsTo as string}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, belongsTo: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="">— Select Enterprise —</option>
                      {enterprises.map((e: any) => {
                        const name = e.name ?? e.Name ?? "";
                        return (
                          <option key={e.id ?? e.Id} value={name}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {fi("Incorporation Date", "incorporationDate", "date")}
                  {se("Currency", "currency", CURRENCIES)}
                  {se("Fiscal Year Start", "fiscalYearStart", [
                    "January",
                    "April",
                    "July",
                    "October",
                  ])}
                  <div className="flex items-center gap-3 pt-5">
                    <button
                      onClick={() =>
                        setForm((c) => ({ ...c, isActive: !c.isActive }))
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
                            ? "text-emerald-600 text-sm"
                            : "text-muted-foreground text-sm"
                        }
                      >
                        {form.isActive ? "Active" : "Inactive"}
                      </span>
                    </button>
                  </div>
                  <div className="col-span-full">
                    {fi("Remarks", "remarks")}
                  </div>
                </div>
              )}

              {/* Address tab */}
              {activeTab === "address" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="col-span-full">
                    {fi("Registered Address", "registeredAddress")}
                  </div>
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

              {/* Legal tab */}
              {activeTab === "legal" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fi("CIN Number", "cinNumber")}
                  {fi("PAN Number", "panNumber", "text", "AAAAA0000A")}
                  {fi("TAN Number", "tanNumber")}

                  <div className="col-span-full pt-2">
                    <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b border-border pb-1">
                      GST Details
                    </p>
                  </div>
                  {se("GST Type", "gstType", GST_TYPES)}
                  {fi("GST Number", "gstNumber", "text", "22AAAAA0000A1Z5")}
                  {fi("GST Registration Date", "gstDate", "date")}

                  <div className="col-span-full pt-2">
                    <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b border-border pb-1">
                      Trade License
                    </p>
                  </div>
                  {fi("Trade License Number", "tradeLicenseNo")}
                  {fi("Trade License Date", "tradeLicenseDate", "date")}

                  <div className="col-span-full pt-2">
                    <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b border-border pb-1">
                      Capital
                    </p>
                  </div>
                  {fi("Authorized Capital (₹)", "authorizedCapital", "number")}
                  {fi("Paid Up Capital (₹)", "paidUpCapital", "number")}
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
                {editId ? "Update" : "Save"} Company
              </button>
            </div>
          </div>
        )}

        {/* Delete confirm modal */}
        {deleteConfirm !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground">
                    Deactivate Company?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The company will be deactivated and hidden from all
                    dropdowns.
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
