import React, { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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
  Eye,
  Printer,
  CalendarDays,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { useLookup } from "@/hooks/useLookup";
import { usePageRights } from "@/hooks/usePageRights";
import { friendlyErrorMessage } from "@/lib/friendlyError";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

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
  enterpriseName: string;
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
  gstType: "Unregistered",
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
  enterpriseName: "",
};

function rowToForm(row: any): Company {
  const savedGstType = row.GSTType ?? "";
  const gstType =
    savedGstType === "Registered" || savedGstType === "Unregistered"
      ? savedGstType
      : savedGstType && savedGstType !== "Unregistered"
        ? "Registered"
        : row.GST || row.GSTDate
          ? "Registered"
          : "Unregistered";

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
    gstType,
    // GST number is stored in b_sub_identity_type → aliased as GST in backend
    gstNumber: row.GST ?? "",
    gstDate: row.GSTDate ? row.GSTDate.slice(0, 10) : "",
    tradeLicenseNo: row.TradeLicenseNo ?? "",
    // TradeLicenseDate stored in rera_date → aliased as TradeLicenseDate
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
    // AuthorizedCapital stored in cost_center → aliased as AuthorizedCapital
    authorizedCapital:
      row.AuthorizedCapital != null ? String(row.AuthorizedCapital) : "",
    // PaidUpCapital stored in profit_center → aliased as PaidUpCapital
    paidUpCapital: row.PaidUpCapital != null ? String(row.PaidUpCapital) : "",
    currency: row.currency ?? row.Currency ?? "INR",
    fiscalYearStart: row.FiscalYearStart ?? "April",
    // AuditorName stored in start_fin_year → aliased as AuditorName
    auditorName: row.AuditorName ?? "",
    isActive: row.IsActive !== 0,
    remarks: row.Remarks ?? "",
    logoUrl: row.LogoUrl ?? "",
    belongsTo:
      row.EnterpriseId != null
        ? String(row.EnterpriseId)
        : row.enterprise_id != null
          ? String(row.enterprise_id)
          : "",
    enterpriseName: row.belongs_to ?? "",
  };
}

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

// ── View Modal ───────────────────────────────────────────────────────────────
function printCompanyPreview(c: Company) {
  printMasterPreview({
    title: c.name || "Company",
    subtitle: "Company Master Preview",
    code: c.code,
    status: c.isActive ? "Active" : "Inactive",
    logo: c.logoUrl,
    sections: [
      {
        title: "General",
        fields: [
          { label: "Company Code", value: c.code },
          { label: "Company Name", value: c.name },
          { label: "Legal Name", value: c.legalName },
          { label: "Short Name", value: c.shortName },
          { label: "Company Type", value: c.type },
          { label: "Industry", value: c.industry },
          { label: "Incorporation Date", value: c.incorporationDate },
          { label: "Currency", value: c.currency },
          { label: "Fiscal Year Start", value: c.fiscalYearStart },
          { label: "Enterprise Parent", value: c.enterpriseName },
          { label: "Status", value: c.isActive ? "Active" : "Inactive" },
          { label: "Remarks", value: c.remarks },
        ],
      },
      {
        title: "Address",
        fields: [
          { label: "Registered Address", value: c.registeredAddress },
          { label: "State", value: c.state },
          { label: "City", value: c.city },
          { label: "Country", value: c.country },
          { label: "Pincode", value: c.pincode },
          { label: "Phone", value: c.phone },
          { label: "Fax", value: c.fax },
          { label: "Email", value: c.email },
          { label: "Website", value: c.website },
          { label: "Auditor Name", value: c.auditorName },
        ],
      },
      {
        title: "Legal / Compliance",
        fields: [
          { label: "CIN Number", value: c.cinNumber },
          { label: "PAN Number", value: c.panNumber },
          { label: "TAN Number", value: c.tanNumber },
          { label: "GST Status", value: c.gstType },
          { label: "GST Number", value: c.gstNumber },
          { label: "GST Registration Date", value: c.gstDate },
          { label: "Trade License No.", value: c.tradeLicenseNo },
          { label: "Trade License Date", value: c.tradeLicenseDate },
          { label: "Authorized Capital", value: c.authorizedCapital },
          { label: "Paid Up Capital", value: c.paidUpCapital },
        ],
      },
    ],
  });
}

function CompanyViewModal({ row, onClose }: { row: any; onClose: () => void }) {
  const c = rowToForm(row);

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

  const Section = ({ title }: { title: string }) => (
    <div className="col-span-full pt-2">
      <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-widest border-b border-border pb-1 mb-2">
        {title}
      </p>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <LogoAvatar logoUrl={c.logoUrl} name={c.name || "?"} size="md" />
            <div>
              <h2 className="font-heading font-semibold text-foreground text-base">
                {c.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                {c.code && (
                  <span className="font-mono text-xs text-primary">
                    {c.code}
                  </span>
                )}
                {c.type && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600">
                    {c.type}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {c.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => printCompanyPreview(c)}
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

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Section title="General" />
            <Row label="Legal Name" value={c.legalName} />
            <Row label="Short Name" value={c.shortName} />
            <Row label="Industry" value={c.industry} />
            <Row label="Incorporation Date" value={c.incorporationDate} />
            <Row label="Currency" value={c.currency} />
            <Row label="Fiscal Year Start" value={c.fiscalYearStart} />
            <Row label="Enterprise (Parent)" value={c.enterpriseName} />
            <Row label="Remarks" value={c.remarks} />

            <Section title="Address" />
            <Row label="Registered Address" value={c.registeredAddress} />
            <Row label="State" value={c.state} />
            <Row label="City" value={c.city} />
            <Row label="Country" value={c.country} />
            <Row label="Pincode" value={c.pincode} />
            <Row label="Phone" value={c.phone} />
            <Row label="Fax" value={c.fax} />
            <Row label="Email" value={c.email} />
            <Row label="Website" value={c.website} />
            <Row label="Auditor Name" value={c.auditorName} />

            <Section title="Legal / Compliance" />
            <Row label="CIN Number" value={c.cinNumber} />
            <Row label="PAN Number" value={c.panNumber} />
            <Row label="TAN Number" value={c.tanNumber} />
            <Row label="GST Status" value={c.gstType} />
            <Row label="GST Number" value={c.gstNumber} />
            <Row label="GST Date" value={c.gstDate} />
            <Row label="Trade License No." value={c.tradeLicenseNo} />
            <Row label="Trade License Date" value={c.tradeLicenseDate} />
            <Row
              label="Authorized Capital"
              value={
                c.authorizedCapital
                  ? `₹ ${Number(c.authorizedCapital).toLocaleString()}`
                  : undefined
              }
            />
            <Row
              label="Paid Up Capital"
              value={
                c.paidUpCapital
                  ? `₹ ${Number(c.paidUpCapital).toLocaleString()}`
                  : undefined
              }
            />
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

function buildCompanyColumns(
  openView: (row: any) => void,
  openEdit: (row: any) => void,
  setDeleteConfirm: (id: number) => void,
  canEdit: boolean,
  canDelete: boolean,
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
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "belongs_to",
      header: "Enterprise",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "Type",
      header: "Type",
      cell: ({ getValue }) => (
        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600 whitespace-nowrap">
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
      accessorKey: "GSTType",
      header: "GST Status",
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
            onClick={() => openView(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10"
            title="View details"
          >
            <Eye size={13} />
          </button>
          {canEdit && (
            <button
              onClick={() => openEdit(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteConfirm(row.original.Id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];
}

export default function CompanyMaster() {
  const rights = usePageRights("company-master");
  const qc = useQueryClient();
  const [form, setForm] = useState<Company>(empty);
  const [gstError, setGstError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewTarget, setViewTarget] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "address" | "legal">(
    "general",
  );
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coTypes = useLookup("CO_TYPE", [
    "Private Limited",
    "Public Limited",
    "LLP",
    "Partnership",
    "Proprietorship",
    "Section 8",
    "OPC",
  ]);
  const industries = useLookup("INDUSTRY", [
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
  ]);
  const currencies = useLookup("CURRENCY", ["INR", "USD", "EUR", "GBP", "AED"]);
  const gstStatuses = useLookup("GST_STATUS", ["Registered", "Unregistered"]);
  const fiscalYearStarts = useLookup("FISCAL_YEAR_START", [
    "January",
    "April",
    "July",
    "October",
  ]);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["company-master"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/company-master");
      if (!res.ok) throw new Error("Failed to load");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: enterprises = [] } = useQuery({
    queryKey: ["enterprises-options"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/enterprises");
      if (!res.ok) throw new Error("Failed to load enterprises");
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data) ? data.filter((e: any) => !e.discontinue) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (form.gstType === "Registered") {
        if (!form.gstNumber.trim()) {
          setGstError("GST Number is required for registered companies");
          throw new Error("GST Number is required for registered companies");
        }
        if (!GSTIN_REGEX.test(form.gstNumber.trim().toUpperCase())) {
          setGstError("Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)");
          throw new Error("Enter a valid GSTIN");
        }
        setGstError("");
        if (!form.gstDate) {
          throw new Error(
            "GST Registration Date is required for registered companies",
          );
        }
      }

      const url = editId
        ? `/api/company-master/${editId}`
        : "/api/company-master";
      const payload = {
        ...form,
        gstNumber:
          form.gstType === "Registered"
            ? form.gstNumber.trim().toUpperCase()
            : "",
        gstDate: form.gstType === "Registered" ? form.gstDate : "",
      };
      const res = await fetchWithAuth(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    onError: (e: Error) =>
      toast.error(
        friendlyErrorMessage(e, "Couldn't save this company. Please check the details and try again."),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/company-master/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.reason || err.error || "Delete failed");
      }
    },
    onSuccess: (_, id) => {
      toast.success("Company deleted");
      qc.setQueryData(["company-master"], (old: any[]) =>
        (old ?? []).filter((c: any) => c.Id !== id),
      );
      qc.invalidateQueries({ queryKey: ["company-master"] });
      setDeleteConfirm(null);
    },
    onError: (e: Error) =>
      toast.error(
        friendlyErrorMessage(e, "Couldn't delete this company. It may still be in use elsewhere."),
      ),
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
    setGstError("");
    setShowForm(true);
    setActiveTab("general");
  };
  const openEdit = (row: any) => {
    const f = rowToForm(row);
    setForm(f);
    setLogoPreview(f.logoUrl || "");
    setEditId(row.Id);
    setGstError("");
    setShowForm(true);
    setActiveTab("general");
  };

  const columns = useMemo(
    () =>
      buildCompanyColumns(
        (row) => setViewTarget(row),
        openEdit,
        setDeleteConfirm,
        rights.canEdit,
        rights.canDelete,
      ),

    [rights.canEdit, rights.canDelete],
  );

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That logo is too large — please use an image under 2 MB.");
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

  const setGstStatus = (value: string) => {
    setGstError("");
    setForm((c) => ({
      ...c,
      gstType: value,
      ...(value === "Unregistered" ? { gstNumber: "", gstDate: "" } : {}),
    }));
  };

  const fi = (
    label: string,
    key: keyof Company,
    type = "text",
    ph = "",
    options?: {
      disabled?: boolean;
      title?: string;
      required?: boolean;
      showAsterisk?: boolean;
    },
  ) => {
    // Strip any trailing " *" from label string (legacy) — asterisk is rendered separately
    const cleanLabel = label.replace(/\s*\*$/, "");
    const showStar = options?.showAsterisk || options?.required;
    return (
      <div key={key}>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          {cleanLabel}
          {showStar && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {type === "date" ? (
          <>
            <div className="relative">
              <CalendarDays
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="date"
                value={form[key] as string}
                onChange={(e) =>
                  setForm((c) => ({ ...c, [key]: e.target.value }))
                }
                disabled={options?.disabled}
                required={options?.required}
                title={options?.title}
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer disabled:bg-muted/60 disabled:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>
            {options?.disabled && options?.title && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {options.title}
              </p>
            )}
          </>
        ) : (
          <>
            <input
              type={type}
              value={form[key] as string}
              onChange={(e) => {
                if (key === "gstNumber") setGstError("");
                setForm((c) => ({ ...c, [key]: e.target.value }));
              }}
              placeholder={ph || label}
              disabled={options?.disabled}
              required={options?.required}
              title={options?.title}
              className={`w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:border-primary transition-all disabled:bg-muted/60 disabled:text-muted-foreground disabled:cursor-not-allowed ${
                key === "gstNumber" && gstError
                  ? "border-red-400 focus:ring-red-400/30"
                  : "border-border focus:ring-primary/30"
              }`}
            />
            {options?.disabled && options?.title && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {options.title}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  const se = (label: string, key: keyof Company, options: string[]) => (
    <div key={key}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <div className="relative">
        <select
          value={form[key] as string}
          onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value }))}
          className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
        >
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );

  const TABS = ["general", "address", "legal"] as const;

  return (
    <>
      <Breadcrumbs items={["Admin", "Masters", "Company Master"]} />
      <AdminShell
        title="Company Master"
        subtitle="Manage company profiles, legal and licensing details"
        icon={Landmark}
        action={
          rights.canCreate && (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
            >
              <Plus size={13} /> Add Company
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
              <div>
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
        {(rights.canCreate || rights.canEdit) && showForm && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
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
                  className={`px-4 py-1.5 rounded-md text-xs font-heading font-semibold capitalize transition-colors ${activeTab === tab ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* General tab */}
              {activeTab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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

                  {fi("Company Code", "code", "text", "e.g. MAIN", {
                    required: true,
                  })}
                  {fi("Company Name", "name", "text", "", { required: true })}
                  {fi("Legal Name", "legalName")}
                  {fi("Short Name", "shortName")}
                  {se("Company Type", "type", coTypes)}
                  {se("Industry", "industry", industries)}

                  {/* Enterprise dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Enterprise{" "}
                      <span className="text-xs text-muted-foreground/60">
                        (Parent)
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        value={form.belongsTo as string}
                        onChange={(e) =>
                          setForm((c) => ({ ...c, belongsTo: e.target.value }))
                        }
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
                      >
                        <option value="">— Select Enterprise —</option>
                        {enterprises.map((e: any) => {
                          const name = e.name ?? e.Name ?? "";
                          const id = String(e.id ?? e.Id ?? "");
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
                  {fi("Incorporation Date", "incorporationDate", "date")}
                  {se("Currency", "currency", currencies)}
                  {se("Fiscal Year Start", "fiscalYearStart", fiscalYearStarts)}
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
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      GST Status
                    </label>
                    <div className="relative">
                      <select
                        value={form.gstType}
                        onChange={(e) => setGstStatus(e.target.value)}
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
                      >
                        {gstStatuses.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      <ChevronDown
                        size={13}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                    </div>
                  </div>
                  <div>
                    {fi("GST Number", "gstNumber", "text", "Enter GSTIN (e.g. 27AAAAA0000A1Z5)", {
                      disabled: form.gstType !== "Registered",
                      title: "Available only for registered companies",
                      required: form.gstType === "Registered",
                      showAsterisk: form.gstType === "Registered",
                    })}
                    {gstError && (
                      <p className="mt-1 text-[11px] text-red-500 flex items-center gap-1">
                        <span>⚠</span> {gstError}
                      </p>
                    )}
                  </div>
                  {fi(
                    "GST Registration Date",
                    "gstDate",
                    "date",
                    "Select Registration Date",
                    {
                      disabled: form.gstType !== "Registered",
                      title: "Available only for registered companies",
                      required: form.gstType === "Registered",
                      showAsterisk: true,
                    },
                  )}

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
                className="font-heading font-semibold text-white text-sm px-5 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {saveMutation.isPending && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                {editId ? "Update" : "Save"} Company
              </button>
            </div>
          </div>
        )}

        {/* View Modal */}
        {viewTarget && (
          <CompanyViewModal
            row={viewTarget}
            onClose={() => setViewTarget(null)}
          />
        )}

        {/* Delete confirm modal */}
        {deleteConfirm !== null && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
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
          </div>,
          document.body
        )}
      </AdminShell>
    </>
  );
}
