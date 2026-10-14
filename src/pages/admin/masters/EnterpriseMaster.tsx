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
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  getEnterprises,
  addEnterprise,
  updateEnterprise,
  deleteEnterprise,
  type Enterprise,
} from "@/api/enterpriseApi";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { friendlyErrorMessage } from "@/lib/friendlyError";

const GST_TYPES = ["Registered", "Unregistered"];

import { INDIA_STATE_CITIES, INDIA_STATES } from "@/lib/indiaStateCities";
import { AutoInput, DateInput } from "@/components/ui/date-input";

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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const TAG = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground/40 px-1.5 py-0.5 whitespace-nowrap";
const INPUT = "w-full px-3 py-2 text-sm border border-foreground/40 focus:border-foreground bg-card text-foreground focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 disabled:cursor-not-allowed";

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
        className={`${dim} object-contain border border-foreground/30 bg-card flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dim} border border-foreground text-foreground font-heading font-bold flex items-center justify-center flex-shrink-0`}
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
      <span className={LBL}>
        {label}
      </span>
      <span className="text-sm text-foreground break-words">
        {value || "—"}
      </span>
    </div>
  );

  const Section = ({ title }: { title: string }) => (
    <div className="col-span-full pt-2">
      <div className="flex items-center gap-3 mb-1">
        <p className={`${HEAD} shrink-0`}>{title}</p>
        <span className="flex-1 h-px bg-foreground" />
      </div>
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
            { label: "TAN (Tax Deduction and Collection Account Number)", value: enterprise.tan },
            { label: "PAN (Permanent Account Number)", value: enterprise.pan },
            { label: "CIN (Corporate Identity Number)", value: enterprise.cin },
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
      <div className="sheet-frame bg-card w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" style={{ margin: 0, border: RULE, boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}>
        {/* Header */}
        <div className="p-5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: RULE }}>
          <div className="flex items-center gap-3">
            <LogoAvatar
              logo={enterprise.logo}
              name={enterprise.name || "?"}
              size="md"
            />
            <div>
              <p className={LBL}>Enterprise</p>
              <h2 className="font-heading font-bold tracking-tight text-foreground text-lg">
                {enterprise.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                {enterprise.entity_type && (
                  <span className={TAG}>{enterprise.entity_type}</span>
                )}
                {enterprise.status === "Active" ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>{enterprise.status || "Inactive"}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={printPreview}
              className={`${KEY_LINE} h-8 px-3`}
              title="Print"
            >
              <Printer size={13} /> Print
            </button>
            <button
              onClick={onClose}
              className={ACT}
              aria-label="Close"
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
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive border border-destructive px-1.5 py-0.5">
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
            <Row label="TAN (Tax Deduction and Collection Account Number)" value={enterprise.tan} />
            <Row label="PAN (Permanent Account Number)" value={enterprise.pan} />
            <Row label="CIN (Corporate Identity Number)" value={enterprise.cin} />
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

        <div className="p-4 flex justify-end flex-shrink-0" style={{ borderTop: RULE }}>
          <button
            onClick={onClose}
            className={`${KEY_LINE} h-9 px-5`}
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
        <span className="font-semibold text-foreground">
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
          v ? <span className={TAG}>{v}</span> : <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "pan",
      header: "PAN (Permanent Account Number)",
      cell: ({ getValue }) => (
        <span className="font-heading text-xs tabular-nums text-muted-foreground">
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
          isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>{status || "Inactive"}</span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button data-row-view
            onClick={() => openView(row.original)}
            className={ACT} aria-label="View details"
            title="View details"
          >
            <Eye size={13} />
          </button>
          {rights.canEdit && (
            <button
              onClick={() => openEdit(row.original)}
              className={ACT} aria-label="Edit"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {rights.canDelete && (
            <button
              onClick={() => setDeleteTarget(row.original.id)}
              className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors" aria-label="Delete"
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
  // Matches the grantable key registered in PageDefinitions/Menu Rights
  // ("business-unit-master" — the Admin > Enterprise > Enterprise sidebar
  // item's path is /admin/masters/business-unit). Using a different key
  // here meant nobody could ever actually be granted create/edit/delete on
  // this page — Menu Rights had no matching row to grant.
  const rights = usePageRights("business-unit-master");
  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
    staleTime: 5 * 60 * 1000,
  });

  // Start Financial Year is now picked from Financial Year Master instead of
  // free-typed, so it always matches a real FinYear row.
  const { data: finYears = [] } = useQuery<{ FId: number; FName: string }[]>({
    queryKey: ["fin-year"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/fin-year");
      if (!res.ok) throw new Error("Failed to fetch financial years");
      return res.json().catch(() => []);
    },
    staleTime: 5 * 60 * 1000,
  });
  const finYearNames = finYears.map((f) => f.FName);

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

  const exportColumns: ExportColumn[] = useMemo(
    () => [
      { header: "Name", accessor: "name" },
      { header: "Short Name", accessor: "short_name" },
      { header: "Type", accessor: "entity_type" },
      { header: "PAN (Permanent Account Number)", accessor: "pan" },
      { header: "GST Type", accessor: "gst_type" },
      { header: "Phone", accessor: "phone_number" },
      { header: "Status", accessor: "status" },
    ],
    [],
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
      toast.error("Please enter a name before saving.");
      return;
    }
    setSaving(true);
    try {
      if (editId != null) {
        await updateEnterprise(editId, form);
        toast.success("Enterprise updated");
      } else {
        await addEnterprise(form);
        toast.success("Enterprise created");
      }
      await queryClient.invalidateQueries({ queryKey: ["enterprises"] });
      setShowForm(false);
    } catch (err: any) {
      toast.error(
        friendlyErrorMessage(err, "Couldn't save this enterprise. Please check the details and try again."),
      );
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
      toast.error(
        friendlyErrorMessage(err, "Couldn't delete this enterprise. It may still be in use elsewhere."),
      );
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
    required = false,
  ) => (
    <div>
      <label className={`${LBL} block mb-1.5`}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {type === "date" ? (
        <div className="relative">
          <CalendarDays
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <DateInput
            value={(form[key] as string) ?? ""}
            onChange={(e) => set(key, e.target.value)}
            className={`${INPUT} pl-8`}
          />
        </div>
      ) : (
        <AutoInput
          type={type}
          value={(form[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value)}
          placeholder={placeholder || label}
          className={INPUT}
        />
      )}
    </div>
  );

  const sel = (label: string, key: keyof Enterprise, options: string[]) => (
    <div>
      <label className={`${LBL} block mb-1.5`}>
        {label}
      </label>
      <div className="relative">
        <select
          value={(form[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value)}
          className={`${INPUT} pr-8 appearance-none`}
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
    return <div className="p-6 text-sm text-destructive">Failed to load enterprises.</div>;

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Admin", "Masters", "Enterprise Master"]}
      />

      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Enterprises"
        subtitle="The enterprises that companies and projects sit under, with their address and legal registrations."
        action={
          !showForm &&
          rights.canCreate && (
            <button onClick={openNew} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus size={13} /> New enterprise
            </button>
          )
        }
      >
        {/* Table */}
        {!showForm && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Enterprises", value: safeRows.length, note: "on record" },
                { label: "Active", value: safeRows.filter((r) => r.status === "Active").length, note: "in use" },
                { label: "Discontinued", value: safeRows.filter((r) => r.discontinue).length, note: "kept for history" },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {!showForm && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <p className="flex items-baseline gap-2.5 mr-auto">
                <span className={HEAD}>Enterprises</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
              </p>
              <div className="relative w-full sm:w-72">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, type…"
                  className={`${INPUT} h-9 pl-9`}
                />
              </div>
              <ExportMenu
                data={filtered as unknown as Record<string, unknown>[]}
                columns={exportColumns}
                title="Enterprise Master"
                filename="enterprise-master"
                disabled={!rights.canExport || filtered.length === 0}
              />
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
                  defaultPageSize={10}
                  emptyMessage="No records found."
                />
              </div>
            )}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: RULE }}>
              <div className="flex items-center gap-3">
                <LogoAvatar
                  logo={logoPreview || null}
                  name={form.name || "?"}
                  size="md"
                />
                <div>
                  <p className={LBL}>Enterprise</p>
                  <h2 className="font-heading text-base font-bold tracking-tight text-foreground">
                    {editId != null
                      ? `Edit ${form.name || "enterprise"}`
                      : "New enterprise"}
                  </h2>
                </div>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className={`${KEY_LINE} h-8 px-3`}
              >
                Cancel
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 px-4" style={{ borderBottom: RULE }}>
              {(["general", "address", "legal"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-3 -mb-px border-b-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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
                    <label className={`${LBL} block mb-2`}>
                      Enterprise Logo
                    </label>
                    <div className="flex items-center gap-4">
                      {logoPreview ? (
                        <div className="relative group">
                          <img
                            src={logoPreview}
                            alt="Logo preview"
                            className="w-16 h-16 object-contain border border-foreground/40 bg-card"
                          />
                          <button
                            onClick={removeLogo}
                            aria-label="Remove logo" className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-16 h-16 border border-dashed border-foreground/50 flex items-center justify-center">
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
                          className={`${KEY_LINE} h-8 px-3 cursor-pointer`}
                        >
                          <Upload size={13} />
                          {logoPreview ? "Change logo" : "Upload logo"}
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">
                          PNG, JPG, SVG · Max 2 MB
                        </p>
                      </div>
                    </div>
                  </div>

                  {field("Name", "name", "text", "Full legal name", true)}
                  {field(
                    "Short Name",
                    "short_name",
                    "text",
                    "Abbreviated name",
                  )}
                  {/* Locked, not a dropdown — this page only ever manages
                      business_type='E' rows, so Type can only be Enterprise. */}
                  <div>
                    <label className={`${LBL} block mb-1.5`}>
                      Type
                    </label>
                    <div className="w-full px-3 py-2 text-sm border border-dashed border-foreground/40 text-muted-foreground cursor-not-allowed">
                      Enterprise
                    </div>
                  </div>
                  {field("Description", "description", "text")}
                  {field("Start Date", "start_date", "date")}
                  {sel("Start Financial Year", "start_fin_year", finYearNames)}
                  {sel("Status", "status", ["Active", "Inactive", "Suspended"])}
                  <div className="flex items-center gap-3 pt-5">
                    <button
                      onClick={() => set("discontinue", !form.discontinue)}
                      className="flex items-center gap-2 text-sm"
                    >
                      {form.discontinue ? (
                        <ToggleRight size={24} className="text-destructive" />
                      ) : (
                        <ToggleLeft
                          size={24}
                          className="text-muted-foreground"
                        />
                      )}
                      <span
                        className={
                          form.discontinue
                            ? "text-destructive"
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
                    <label className={`${LBL} block mb-1.5`}>State</label>
                    <div className="relative">
                      <select
                        value={(form.state as string) ?? ""}
                        onChange={(e) => {
                          set("state", e.target.value);
                          set("city", ""); // reset city when state changes
                        }}
                        className={`${INPUT} pr-8 appearance-none`}
                      >
                        <option value="">— Select State —</option>
                        {INDIA_STATES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>

                  {/* City — suggestions from selected state, but any city can be typed */}
                  <div>
                    <label className={`${LBL} block mb-1.5`}>City</label>
                    <input
                      list="enterprise-city-options"
                      type="text"
                      value={(form.city as string) ?? ""}
                      onChange={(e) => set("city", e.target.value)}
                      disabled={!form.state}
                      placeholder={form.state ? "Type or select a city" : "Select state first"}
                      className={INPUT}
                    />
                    <datalist id="enterprise-city-options">
                      {(INDIA_STATE_CITIES[form.state as string] ?? []).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
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
                  {field("TAN (Tax Deduction and Collection Account Number)", "tan", "text", "AAAA00000A")}
                  {field("PAN (Permanent Account Number)", "pan", "text", "AAAAA0000A")}
                  {field("CIN (Corporate Identity Number)", "cin", "text", "L00000AA0000AAA000000")}
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

            <div className="px-4 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
              <button
                onClick={() => setShowForm(false)}
                className={`${KEY_LINE} h-9 px-4`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name?.trim()}
                className={`${KEY_INK} h-9 px-5`}
              >
                {saving ? "Saving…" : editId != null ? "Update" : "Save"}
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
            <div className="sheet-frame bg-card p-6 w-80" style={{ margin: 0, border: RULE, boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}>
              <div className="pb-3 mb-4" style={{ borderBottom: RULE }}>
                <div>
                  <p className={LBL}>Enterprise</p>
                  <p className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">
                    Delete enterprise
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className={`${KEY_LINE} flex-1 h-9`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className={`${KEY} flex-1 h-9 bg-destructive text-destructive-foreground border border-destructive`}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </SheetShell>
    </>
  );
}
