import React, { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Search,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
  Eye,
  Printer,
  CalendarDays,
  ChevronDown,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getEnterprises,
  addEnterprise,
  updateEnterprise,
  deleteEnterprise,
  type Enterprise,
} from "@/api/enterpriseApi";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { usePageRights } from "@/hooks/usePageRights";

const ENTITY_TYPES = ["Enterprise", "Company", "Business Unit"];
const GST_TYPES = [
  "Regular",
  "Composition",
  "Unregistered",
  "SEZ",
  "Deemed Export",
];

// Indian states + major cities
const INDIA_STATE_CITIES: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajamahendravaram", "Tirupati", "Kadapa", "Kakinada", "Anantapur"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat", "Tezpur"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Bongaigaon"],
  "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Purnia", "Darbhanga", "Bihar Sharif", "Arrah", "Begusarai"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Korba", "Bilaspur", "Durg", "Rajnandgaon", "Jagdalpur"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Junagadh", "Anand", "Bharuch", "Morbi", "Nadiad"],
  "Haryana": ["Faridabad", "Gurgaon", "Panipat", "Ambala", "Yamunanagar", "Rohtak", "Hisar", "Karnal", "Sonipat", "Panchkula"],
  "Himachal Pradesh": ["Shimla", "Solan", "Dharamsala", "Mandi", "Palampur", "Baddi", "Kullu", "Hamirpur"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar", "Phusro", "Hazaribagh", "Giridih"],
  "Karnataka": ["Bengaluru", "Mysuru", "Hubli", "Mangaluru", "Belagavi", "Kalaburagi", "Davanagere", "Ballari", "Shivamogga", "Tumakuru", "Udupi"],
  "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Palakkad", "Alappuzha", "Kannur", "Kottayam", "Malappuram"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Dewas", "Satna", "Ratlam", "Rewa", "Murwara"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Aurangabad", "Solapur", "Kolhapur", "Amravati", "Navi Mumbai", "Vasai-Virar", "Mira-Bhayandar"],
  "Manipur": ["Imphal", "Thoubal", "Bishnupur", "Churachandpur"],
  "Meghalaya": ["Shillong", "Tura", "Jowai"],
  "Mizoram": ["Aizawl", "Lunglei", "Champhai"],
  "Nagaland": ["Kohima", "Dimapur", "Mokokchung"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Brahmapur", "Sambalpur", "Puri", "Balasore", "Bhadrak"],
  "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Batala"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Kota", "Bikaner", "Ajmer", "Udaipur", "Bhilwara", "Alwar", "Sikar", "Bharatpur", "Sri Ganganagar"],
  "Sikkim": ["Gangtok", "Namchi", "Gyalshing"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Vellore", "Erode", "Thoothukudi", "Ambattur"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Khammam", "Karimnagar", "Ramagundam", "Mahbubnagar", "Nalgonda", "Secunderabad"],
  "Tripura": ["Agartala", "Dharmanagar", "Udaipur"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Meerut", "Varanasi", "Prayagraj", "Bareilly", "Aligarh", "Moradabad", "Noida", "Gorakhpur", "Mathura"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rishikesh", "Kashipur", "Rudrapur"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Baharampur", "Habra"],
  "Delhi": ["New Delhi", "Dwarka", "Rohini", "Janakpuri", "Laxmi Nagar", "Saket", "Pitampura", "Vasant Kunj"],
  "Chandigarh": ["Chandigarh"],
  "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Sopore"],
  "Ladakh": ["Leh", "Kargil"],
  "Puducherry": ["Puducherry", "Karaikal", "Mahe", "Yanam"],
  "Andaman and Nicobar Islands": ["Port Blair"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Silvassa"],
  "Lakshadweep": ["Kavaratti"],
};

const INDIA_STATES = Object.keys(INDIA_STATE_CITIES).sort();

const empty: Partial<Enterprise> = {
  name: "",
  short_name: "",
  entity_type: "Enterprise",
  description: "",
  start_date: "",
  start_fin_year: "",
  address: "",
  address_line2: "",
  city: "",
  state: "",
  country: "India",
  pincode: "",
  phone_number: "",
  email: "",
  website: "",
  latitude: null,
  longitude: null,
  gst_type: "",
  gst_issue_date: "",
  tan: "",
  pan: "",
  cin: "",
  cr_code: "",
  rera_no: "",
  rera_date: "",
  trade_license: "",
  date_of_entry: "",
  date_of_establishment: "",
  status: "Active",
  discontinue: false,
  logo: null,
};

type Tab = "general" | "address" | "legal";

const ENTITY_COLORS: Record<string, string> = {
  Enterprise: "bg-purple-500/10 text-purple-600",
  Company: "bg-blue-500/10 text-blue-600",
  "Business Unit": "bg-amber-500/10 text-amber-600",
};

function LogoAvatar({
  logo,
  name,
  size = "sm",
}: {
  logo?: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "w-7 h-7 text-xs" : "w-10 h-10 text-sm";
  if (logo) {
    return (
      <img
        src={logo}
        alt={name}
        className={`${dim} rounded-lg object-contain border border-border bg-muted/30 flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-lg bg-blue-500/10 text-blue-600 font-heading font-bold flex items-center justify-center flex-shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── View Modal ───────────────────────────────────────────────────────────────
function EnterpriseViewModal({
  enterprise,
  onClose,
}: {
  enterprise: Enterprise;
  onClose: () => void;
}) {
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

  const printPreview = () =>
    printMasterPreview({
      title: enterprise.name || "Enterprise",
      subtitle: "Enterprise Master Preview",
      code: enterprise.short_name,
      status: enterprise.status || (enterprise.discontinue ? "Inactive" : null),
      logo: enterprise.logo,
      sections: [
        {
          title: "General",
          fields: [
            { label: "Name", value: enterprise.name },
            { label: "Short Name", value: enterprise.short_name },
            { label: "Entity Type", value: enterprise.entity_type },
            { label: "Description", value: enterprise.description },
            { label: "Start Date", value: enterprise.start_date?.slice(0, 10) },
            { label: "Start Fin Year", value: enterprise.start_fin_year },
            { label: "Status", value: enterprise.status },
            { label: "Discontinued", value: !!enterprise.discontinue },
          ],
        },
        {
          title: "Address",
          fields: [
            { label: "Address Line 1", value: enterprise.address },
            { label: "Address Line 2", value: enterprise.address_line2 },
            { label: "State", value: enterprise.state },
            { label: "City", value: enterprise.city },
            { label: "Country", value: enterprise.country },
            { label: "Pincode", value: enterprise.pincode },
            { label: "Phone", value: enterprise.phone_number },
            { label: "Email", value: enterprise.email },
            { label: "Website", value: enterprise.website },
            { label: "Latitude", value: enterprise.latitude },
            { label: "Longitude", value: enterprise.longitude },
          ],
        },
        {
          title: "Legal / Compliance",
          fields: [
            { label: "GST Type", value: enterprise.gst_type },
            {
              label: "GST Issue Date",
              value: enterprise.gst_issue_date?.slice(0, 10),
            },
            { label: "TAN", value: enterprise.tan },
            { label: "PAN", value: enterprise.pan },
            { label: "CIN", value: enterprise.cin },
            { label: "CR Code", value: enterprise.cr_code },
            { label: "RERA No.", value: enterprise.rera_no },
            { label: "RERA Date", value: enterprise.rera_date?.slice(0, 10) },
            { label: "Trade License", value: enterprise.trade_license },
            {
              label: "Date of Entry",
              value: enterprise.date_of_entry?.slice(0, 10),
            },
            {
              label: "Date of Establishment",
              value: enterprise.date_of_establishment?.slice(0, 10),
            },
          ],
        },
      ],
    });

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <LogoAvatar
              logo={enterprise.logo}
              name={enterprise.name || "?"}
              size="md"
            />
            <div>
              <h2 className="font-heading font-semibold text-foreground text-base">
                {enterprise.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                {enterprise.entity_type && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${ENTITY_COLORS[enterprise.entity_type] || "bg-muted text-muted-foreground"}`}
                  >
                    {enterprise.entity_type}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${enterprise.status === "Active" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {enterprise.status || "Inactive"}
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

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Section title="General" />
            <Row label="Short Name" value={enterprise.short_name} />
            <Row label="Description" value={enterprise.description} />
            <Row
              label="Start Date"
              value={enterprise.start_date?.slice(0, 10)}
            />
            <Row label="Start Fin Year" value={enterprise.start_fin_year} />
            <Row label="Status" value={enterprise.status} />
            {enterprise.discontinue && (
              <div className="col-span-full">
                <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-600">
                  Discontinued
                </span>
              </div>
            )}

            <Section title="Address" />
            <Row label="Address Line 1" value={enterprise.address} />
            <Row label="Address Line 2" value={enterprise.address_line2} />
            <Row label="State" value={enterprise.state} />
            <Row label="City" value={enterprise.city} />
            <Row label="Country" value={enterprise.country} />
            <Row label="Pincode" value={enterprise.pincode} />
            <Row label="Phone" value={enterprise.phone_number} />
            <Row label="Email" value={enterprise.email} />
            <Row label="Website" value={enterprise.website} />
            <Row
              label="Latitude"
              value={
                enterprise.latitude != null
                  ? String(enterprise.latitude)
                  : undefined
              }
            />
            <Row
              label="Longitude"
              value={
                enterprise.longitude != null
                  ? String(enterprise.longitude)
                  : undefined
              }
            />

            <Section title="Legal / Compliance" />
            <Row label="GST Type" value={enterprise.gst_type} />
            <Row
              label="GST Issue Date"
              value={enterprise.gst_issue_date?.slice(0, 10)}
            />
            <Row label="TAN" value={enterprise.tan} />
            <Row label="PAN" value={enterprise.pan} />
            <Row label="CIN" value={enterprise.cin} />
            <Row label="CR Code" value={enterprise.cr_code} />
            <Row label="RERA No." value={enterprise.rera_no} />
            <Row label="RERA Date" value={enterprise.rera_date?.slice(0, 10)} />
            <Row label="Trade License" value={enterprise.trade_license} />
            <Row
              label="Date of Entry"
              value={enterprise.date_of_entry?.slice(0, 10)}
            />
            <Row
              label="Date of Establishment"
              value={enterprise.date_of_establishment?.slice(0, 10)}
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

function buildEnterpriseColumns(
  openView: (r: Enterprise) => void,
  openEdit: (r: Enterprise) => void,
  setDeleteTarget: (id: number) => void,
  rights: { canEdit: boolean; canDelete: boolean },
): ColumnDef<Enterprise, unknown>[] {
  return [
    {
      id: "logo",
      header: "Logo",
      enableSorting: false,
      cell: ({ row }) => (
        <LogoAvatar logo={row.original.logo} name={row.original.name || "?"} />
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "short_name",
      header: "Short Name",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "entity_type",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${ENTITY_COLORS[v || ""] || "bg-muted text-muted-foreground"}`}
          >
            {v || "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "pan",
      header: "PAN",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "gst_type",
      header: "GST Type",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "phone_number",
      header: "Phone",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue() as string | null;
        const isActive = status === "Active";
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            {status || "Inactive"}
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
              onClick={() => setDeleteTarget(row.original.id)}
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

export default function EnterpriseMaster() {
  const queryClient = useQueryClient();
  const rights = usePageRights("enterprise-master");
  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
    staleTime: 5 * 60 * 1000,
  });

  const [form, setForm] = useState<Partial<Enterprise>>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewTarget, setViewTarget] = useState<Enterprise | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("general");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const safeRows: Enterprise[] = Array.isArray(rows)
    ? (rows as Enterprise[])
    : [];
  const filtered = safeRows.filter(
    (r) =>
      (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.short_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.entity_type || "").toLowerCase().includes(search.toLowerCase()),
  );

  const openNew = () => {
    setForm({ ...empty });
    setEditId(null);
    setLogoPreview("");
    setShowForm(true);
    setTab("general");
  };
  const openEdit = (r: Enterprise) => {
    setForm({
      ...r,
      start_date: r.start_date?.slice(0, 10) || "",
      gst_issue_date: r.gst_issue_date?.slice(0, 10) || "",
      rera_date: r.rera_date?.slice(0, 10) || "",
      date_of_entry: r.date_of_entry?.slice(0, 10) || "",
      date_of_establishment: r.date_of_establishment?.slice(0, 10) || "",
    });
    setLogoPreview(r.logo || "");
    setEditId(r.id);
    setShowForm(true);
    setTab("general");
  };

  const columns = useMemo(
    () =>
      buildEnterpriseColumns(
        (r) => setViewTarget(r),
        openEdit,
        setDeleteTarget,
        rights,
      ),

    [rights],
  );

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
      setForm((f) => ({ ...f, logo: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoPreview("");
    setForm((f) => ({ ...f, logo: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast.error("Name is required");
      return;
    }
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

  const set = (key: keyof Enterprise, val: unknown) =>
    setForm((f) => ({ ...f, [key]: val }));

  const field = (
    label: string,
    key: keyof Enterprise,
    type = "text",
    placeholder = "",
  ) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {type === "date" ? (
        <div className="relative">
          <CalendarDays
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="date"
            value={(form[key] as string) ?? ""}
            onChange={(e) => set(key, e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          />
        </div>
      ) : (
        <input
          type={type}
          value={(form[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value)}
          placeholder={placeholder || label}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
        />
      )}
    </div>
  );

  const sel = (label: string, key: keyof Enterprise, options: string[]) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <div className="relative">
        <select
          value={(form[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value)}
          className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
        >
          <option value="">— Select —</option>
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

  if (error)
    return <div className="p-6 text-red-500">Failed to load enterprises.</div>;

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Admin", "Masters", "Enterprise Master"]}
      />

      <AdminShell
        title="Enterprise Master"
        subtitle="Manage enterprises, companies and business units"
        icon={Building2}
        action={
          !showForm &&
          rights.canCreate && (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
            >
              <Plus size={13} /> Add Enterprise
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
                  placeholder="Search name, type…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} record{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
            {isLoading ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Loading…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  data={filtered}
                  columns={columns}
                  searchable={false}
                  paginated={true}
                  defaultPageSize={20}
                  emptyMessage="No records found."
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
                <LogoAvatar
                  logo={logoPreview || null}
                  name={form.name || "?"}
                  size="md"
                />
                <h2 className="font-heading font-semibold text-foreground">
                  {editId
                    ? `Edit — ${form.name || "Enterprise"}`
                    : "New Enterprise"}
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
              {(["general", "address", "legal"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-md text-xs font-heading font-semibold capitalize transition-colors ${tab === t ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {t === "legal" ? "Legal / Compliance" : t}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* General */}
              {tab === "general" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="col-span-full">
                    <label className="block text-xs font-medium text-muted-foreground mb-2">
                      Enterprise Logo
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
                          <Building2
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
                          id="enterprise-logo-input"
                        />
                        <label
                          htmlFor="enterprise-logo-input"
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

                  {field("Name *", "name", "text", "Full legal name")}
                  {field(
                    "Short Name",
                    "short_name",
                    "text",
                    "Abbreviated name",
                  )}
                  {sel("Type", "entity_type", ENTITY_TYPES)}
                  {field("Description", "description", "text")}
                  {field("Start Date", "start_date", "date")}
                  {field(
                    "Start Financial Year",
                    "start_fin_year",
                    "text",
                    "e.g. 2024-25",
                  )}
                  {sel("Status", "status", ["Active", "Inactive", "Suspended"])}
                  <div className="flex items-center gap-3 pt-5">
                    <button
                      onClick={() => set("discontinue", !form.discontinue)}
                      className="flex items-center gap-2 text-sm"
                    >
                      {form.discontinue ? (
                        <ToggleRight size={24} className="text-red-500" />
                      ) : (
                        <ToggleLeft
                          size={24}
                          className="text-muted-foreground"
                        />
                      )}
                      <span
                        className={
                          form.discontinue
                            ? "text-red-500"
                            : "text-muted-foreground"
                        }
                      >
                        {form.discontinue ? "Discontinued" : "Not Discontinued"}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Address */}
              {tab === "address" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="col-span-full">
                    {field("Address Line 1", "address")}
                  </div>
                  <div className="col-span-full">
                    {field("Address Line 2", "address_line2")}
                  </div>

                  {/* State dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">State</label>
                    <div className="relative">
                      <select
                        value={(form.state as string) ?? ""}
                        onChange={(e) => {
                          set("state", e.target.value);
                          set("city", ""); // reset city when state changes
                        }}
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
                      >
                        <option value="">— Select State —</option>
                        {INDIA_STATES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

                  {/* City dropdown — filtered by selected state */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">City</label>
                    <div className="relative">
                      <select
                        value={(form.city as string) ?? ""}
                        onChange={(e) => set("city", e.target.value)}
                        disabled={!form.state}
                        className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">{form.state ? "— Select City —" : "— Select State first —"}</option>
                        {(INDIA_STATE_CITIES[form.state as string] ?? []).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

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
                  {field(
                    "Date of Establishment",
                    "date_of_establishment",
                    "date",
                  )}
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
                onClick={handleSave}
                disabled={saving || !form.name?.trim()}
                className="font-heading font-semibold text-white text-sm px-5 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {saving ? "Saving…" : editId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* View Modal */}
        {viewTarget && (
          <EnterpriseViewModal
            enterprise={viewTarget}
            onClose={() => setViewTarget(null)}
          />
        )}

        {/* Delete Confirm */}
        {deleteTarget && createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground">
                    Delete Enterprise?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
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
