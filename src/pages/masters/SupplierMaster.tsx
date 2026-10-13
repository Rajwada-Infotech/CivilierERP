import React, { useState, useMemo, useRef, useCallback } from "react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { getAccountGroups } from "@/api/accountApi";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import {
  Pencil,
  Trash2,
  X,
  Check,
  Plus,
  Search,
  Eye,
  User,
  Phone,
  Mail,
  MapPin,
  Printer,
  RotateCcw,
  Download,
  Upload,
  Loader2,
  Copy,
} from "lucide-react";
import TreeDropdown from "@/components/common/TreeDropdown";
import {
  exportToCsv,
  parseCsv,
  type ExportColumn as CsvExportColumn,
} from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Constants ────────────────────────────────────────────────────────────────
const SUPPLIER_TYPE = "S";
const VENDOR_TYPE = "V";
// The Vendor Master list/queries fetch both LHeadTypes together — Landlord
// entries are still stored as LHeadType='S' (only Vendor gets its own 'V'),
// see lheadTypeForVendorType below.
const LIST_TYPES = `${SUPPLIER_TYPE},${VENDOR_TYPE}`;

const SUPPLIER_CATEGORIES = ["Goods", "Services", "Both"] as const;

// Vendor Type — a layer above Category: Category (Goods/Services/Both) is
// only ever meaningful for a Supplier, so a Landlord or a generic Vendor
// picks a Type here instead and never sees the Category field at all.
// There's no dedicated DB column for this — it's derived from/written
// straight into the existing supplierCategory (LHeadCategory) value:
// Goods/Services/Both implies Type="Supplier" (with that as the
// sub-category); the literal values "Vendor"/"Landlord" ARE the Type,
// stored the same column, with no sub-category underneath them.
const VENDOR_TYPES = ["Vendor", "Supplier", "Landlord"] as const;
type VendorType = (typeof VENDOR_TYPES)[number] | "";

function vendorTypeFromCategory(category: string): VendorType {
  if ((SUPPLIER_CATEGORIES as readonly string[]).includes(category)) return "Supplier";
  // "Supplier" itself is stored as a placeholder when Type=Supplier has been
  // picked but no Goods/Services/Both sub-category has been chosen yet —
  // without this, the derived Type would snap back to "" on every render
  // and the Type dropdown would appear to do nothing.
  if (category === "Supplier" || category === "Vendor" || category === "Landlord") return category;
  return "";
}
// Every value the shared category/type column can actually hold — used for
// CSV import validation, which doesn't otherwise know about the Type/
// Category split.
const ALL_CATEGORY_VALUES = [...SUPPLIER_CATEGORIES, "Vendor", "Landlord"] as const;

// LHeadType to persist on save: Vendor gets its own 'V'; Supplier and
// Landlord both remain 'S' (Landlord is only distinguished via LHeadCategory).
function lheadTypeForVendorType(type: VendorType): string {
  return type === "Vendor" ? VENDOR_TYPE : SUPPLIER_TYPE;
}
const GST_TYPES = ["Registered", "Unregistered"] as const;
const GST_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  supplierCategory: string | null;
  LGSTType: string | null;
  LGSTState: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
  IsTdsApplicable: boolean;
  TdsLimitApplicable: boolean;
  GroupName: string | null;
  // Auto-generated on create as <SupplierName>@civilier.in — this is the
  // supplier's login username for the Supplier Portal, distinct from
  // LHeadEmail (their own business contact address).
  SupplierLoginEmail: string | null;
  // Bank Details — all optional
  bankAccountNo: string | null;
  bankIfscCode: string | null;
  bankName: string | null;
  bankBranchCode: string | null;
}

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

interface SupplierForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  supplierCategory: string;
  LGSTType: string;
  LGSTState: string;
  LHeadAddress: string;
  LHeadStatus: boolean;
  LBelongsTo: string;
  isTdsApplicable: boolean;
  // ON (default): ₹30k single-bill / ₹1L yearly-cumulative threshold gates
  // TDS deduction. OFF: TDS deducts on every eligible bill unconditionally.
  tdsLimitApplicable: boolean;
  // Mandatory on create; optional on edit (blank = keep existing password).
  SupplierPassword: string;
  // Bank Details — all optional
  bankAccountNo: string;
  bankIfscCode: string;
  bankName: string;
  bankBranchCode: string;
}

const EMPTY_FORM: SupplierForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LHeadPan: "",
  supplierCategory: "",
  LGSTType: "",
  LGSTState: "",
  LHeadAddress: "",
  LBelongsTo: "",
  LHeadStatus: true,
  isTdsApplicable: false,
  tdsLimitApplicable: true,
  SupplierPassword: "",
  bankAccountNo: "",
  bankIfscCode: "",
  bankName: "",
  bankBranchCode: "",
};

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Vendor Name", accessor: "LHeadName" },
  {
    header: "Type",
    accessor: (r) => vendorTypeFromCategory((r.supplierCategory as string) || "") || "—",
  },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GSTIN (GST Identification Number)", accessor: "LGST" },
  { header: "PAN (Permanent Account Number)", accessor: "LHeadPan" },
  { header: "GST Type", accessor: "LGSTType" },
  { header: "GST State", accessor: "LGSTState" },
  { header: "Category", accessor: "supplierCategory" },
  {
    header: "Group",
    accessor: (r) => (r.GroupName as string) || "—",
  },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
  {
    header: "TDS Applicable",
    accessor: (r) => (r.IsTdsApplicable ? "Yes" : "No"),
  },
  {
    header: "TDS Limit",
    accessor: (r) => (r.TdsLimitApplicable ? "Applied" : "Deduct on every bill"),
  },
  { header: "Bank Account No", accessor: "bankAccountNo" },
  { header: "Bank Name", accessor: "bankName" },
  { header: "Bank Branch Location", accessor: "bankBranchCode" },
  { header: "IFSC Code", accessor: "bankIfscCode" },
];

// ─── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  name: "Vendor Name",
  contactPerson: "Contact Person",
  phone: "Phone",
  email: "Email",
  gst: "GSTIN (GST Identification Number)",
  pan: "PAN (Permanent Account Number)",
  category: "Category/Type (Goods/Services/Both/Vendor/Landlord)",
  gstType: "GST Type (Registered/Unregistered)",
  gstState: "GST State",
  group: "Group Name",
  address: "Address",
  status: "Status (Active/Inactive)",
  password: "Password (min 6 characters)",
} as const;

const SUPPLIER_CSV_TEMPLATE_COLUMNS: CsvExportColumn[] = [
  { header: CSV_HEADERS.name, accessor: "LHeadName" },
  { header: CSV_HEADERS.contactPerson, accessor: "LHeadContactPerson" },
  { header: CSV_HEADERS.phone, accessor: "LHeadPhone" },
  { header: CSV_HEADERS.email, accessor: "LHeadEmail" },
  { header: CSV_HEADERS.gst, accessor: "LGST" },
  { header: CSV_HEADERS.pan, accessor: "LHeadPan" },
  { header: CSV_HEADERS.category, accessor: "supplierCategory" },
  { header: CSV_HEADERS.gstType, accessor: "LGSTType" },
  { header: CSV_HEADERS.gstState, accessor: "LGSTState" },
  { header: CSV_HEADERS.group, accessor: "GroupName" },
  { header: CSV_HEADERS.address, accessor: "LHeadAddress" },
  { header: CSV_HEADERS.status, accessor: "LHeadStatus" },
  { header: CSV_HEADERS.password, accessor: "SupplierPassword" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── Column builder ────────────────────────────────────────────────────────────
const WA_SVG = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

function buildSupplierColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (s: Supplier) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (s: Supplier) => void,
  onPrint: (s: Supplier) => void,
  onWhatsApp: (s: Supplier) => void,
  canEdit: boolean,
  canDelete: boolean,
  canPrint: boolean,
): ColumnDef<Supplier, unknown>[] {
  return [
    {
      accessorKey: "LHeadName",
      header: "Vendor Name",
      cell: ({ getValue, row }) => {
        const type = vendorTypeFromCategory(row.original.supplierCategory || "");
        return (
          <div className="min-w-0">
            <p className="font-medium text-foreground">{getValue() as string}</p>
            {type && <p className={`${LBL} mt-1`}>{type}{type === "Supplier" && row.original.supplierCategory !== "Supplier" ? ` · ${row.original.supplierCategory}` : ""}</p>}
          </div>
        );
      },
    },
    {
      accessorKey: "LHeadContactPerson",
      header: "Contact Person",
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "LHeadPhone",
      header: "Phone",
      cell: ({ getValue }) => <span className="font-heading text-xs tabular-nums text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "LGST",
      header: "GSTIN / GST Type",
      cell: ({ getValue, row }) => {
        const gst = getValue() as string | null;
        const gstType = (row.original as any).LGSTType as string | null;
        const label = gstType === "Registered" ? "Registered" : gstType === "Unregistered" ? "Unregistered" : "Not stated";
        return (
          <div className="flex flex-col gap-1">
            <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{gst || "—"}</span>
            <span className={LBL}>{label}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "LHeadStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "none"} />;
      },
    },
    {
      accessorKey: "IsTdsApplicable",
      header: "TDS",
      cell: ({ getValue }) =>
        (getValue() as boolean) ? <SheetMark text="TDS" tone="waiting" /> : <span className="text-xs text-muted-foreground/50">—</span>,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      meta: { align: "right", className: "text-right" },
      cell: ({ row }) => {
        const id = row.original.LHeadId;
        if (deleteConfirm === id) {
          return (
            <div className="flex items-center gap-1 justify-start">
              <button
                onClick={() => deleteMut.mutate(id)}
                className="h-7 px-2 flex items-center gap-1 border border-destructive bg-destructive text-destructive-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]"
                title="Confirm delete"
              >
                <Check size={12} /> Delete
              </button>
              <button onClick={() => setDeleteConfirm(null)} className={ACT} title="Keep" aria-label="Keep">
                <X size={13} />
              </button>
            </div>
          );
        }
        const hasPhone = !!(row.original.LHeadPhone?.replace(/\D/g, ""));
        return (
          <div className="flex items-center justify-start gap-1 w-full min-w-[150px]">
            <button data-row-view onClick={() => onView(row.original)} className={ACT} title="View details" aria-label="View details">
              <Eye size={13} />
            </button>
            {canPrint && (
              <button onClick={() => onPrint(row.original)} className={ACT} title="Print" aria-label="Print">
                <Printer size={13} />
              </button>
            )}
            <button
              onClick={() => onWhatsApp(row.original)}
              disabled={!hasPhone}
              className={hasPhone ? ACT : "w-7 h-7 flex items-center justify-center text-muted-foreground/30 cursor-not-allowed"}
              title={hasPhone ? "Send portal link via WhatsApp" : "Add phone number to enable WhatsApp"}
            >
              {WA_SVG}
            </button>
            {canEdit && (
              <button onClick={() => startEdit(row.original)} className={ACT} title="Edit" aria-label="Edit">
                <Pencil size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteConfirm(id)}
                className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
const SupplierMaster: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("supplier-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useDraftForm<SupplierForm>("supplier-master", EMPTY_FORM, {
    skip: editingId !== null,
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof SupplierForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Supplier | null>(null);

  // Vendor Type — derived from (and written back into) supplierCategory;
  // see vendorTypeFromCategory's comment. Drives the form's dynamic
  // heading and whether the Category sub-field is active.
  const vendorType = vendorTypeFromCategory(form.supplierCategory);
  const handleTypeChange = (next: VendorType) => {
    setForm((p) => ({
      ...p,
      supplierCategory:
        next === "Supplier"
          ? // Switching TO Supplier keeps an already-valid Goods/Services/
            // Both pick; otherwise stores the "Supplier" placeholder so
            // vendorTypeFromCategory still resolves back to "Supplier" on
            // the next render (an empty string would resolve to "" and the
            // Type dropdown would appear to revert/do nothing).
            ((SUPPLIER_CATEGORIES as readonly string[]).includes(p.supplierCategory)
              ? p.supplierCategory
              : "Supplier")
          : next, // "Vendor" / "Landlord" — the Type IS the stored value
      isTdsApplicable: next === "Supplier" ? p.isTdsApplicable : false,
      // Switching away from Supplier hides the login-password field — clear
      // any half-typed value so it can't linger in state and get submitted
      // if the user switches back and forth before saving.
      SupplierPassword: next === "Supplier" ? p.SupplierPassword : "",
    }));
  };

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortField] = useState<
    "LHeadName" | "LHeadContactPerson" | "LHeadPhone"
  >("LHeadName");
  const [sortAsc] = useState(true);

  // ── Remote data ────────────────────────────────────────────────────────────
  const {
    data: rawData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["account-head", LIST_TYPES],
    queryFn: () => getList(LIST_TYPES),
    staleTime: 5 * 60 * 1000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 10 * 60 * 1000,
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[])
      .filter((item) => item.AGId != null && item.Name)
      .map((item) => ({
        _id: String(item.AGId),
        name: item.Name as string,
        code: item.Code || "",
        parentId: item.ParentGroupId ? String(item.ParentGroupId) : null,
      }));
  }, [groupsData]);

  const suppliers: Supplier[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      supplierCategory: item.LHeadCategory || null,
      LGSTType: item.LGSTType || null,
      LGSTState: item.LGSTState || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
      IsTdsApplicable: Boolean(item.IsTdsApplicable),
      TdsLimitApplicable: item.TdsLimitApplicable == null ? true : Boolean(item.TdsLimitApplicable),
      GroupName: item.GroupName ?? null,
      SupplierLoginEmail: item.SupplierLoginEmail ?? null,
      bankAccountNo: item.LAccountNo || null,
      bankIfscCode: item.LIFSCCode || null,
      bankName: item.LBankName || null,
      bankBranchCode: item.LBranchCode || null,
    }));
  }, [rawData]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", LIST_TYPES] });

  const buildPayload = (f: SupplierForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: lheadTypeForVendorType(vendorTypeFromCategory(f.supplierCategory)),
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadCategory: f.supplierCategory || null,
    LGSTType: f.LGSTType || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    IsTdsApplicable: f.isTdsApplicable,
    TdsLimitApplicable: f.tdsLimitApplicable,
    LBranchName: null,
    LGSTState: f.LGSTState || null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
    // Omitted (not sent as an empty string) when blank — on create the
    // backend defaults the login password to "123456"; on edit, blank
    // leaves the existing password untouched (see accountHeadMaster.js).
    ...(f.SupplierPassword ? { SupplierPassword: f.SupplierPassword } : {}),
    LAccountNo: f.bankAccountNo || null,
    LIFSCCode: f.bankIfscCode || null,
    LBankName: f.bankName || null,
    LBranchCode: f.bankBranchCode || null,
  });

  const createMut = useMutation({
    mutationFn: (f: SupplierForm) =>
      addRecord(
        buildPayload(f),
        lheadTypeForVendorType(vendorTypeFromCategory(f.supplierCategory)),
      ),
    onSuccess: (res: {
      SupplierLoginEmail?: string;
      SupplierPasswordDefaulted?: boolean;
      SupplierDefaultPassword?: string;
    }) => {
      const passwordNote = res?.SupplierPasswordDefaulted
        ? ` — password defaulted to "${res.SupplierDefaultPassword}"`
        : "";
      toast.success(
        res?.SupplierLoginEmail
          ? `Vendor created — login email: ${res.SupplierLoginEmail}${passwordNote}`
          : "Vendor created",
      );
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierForm }) =>
      updateRecord(
        id,
        buildPayload(data),
        lheadTypeForVendorType(vendorTypeFromCategory(data.supplierCategory)),
      ),
    onSuccess: () => {
      toast.success("Vendor updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Vendor deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;

  // ── CSV import/export state ─────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv([], SUPPLIER_CSV_TEMPLATE_COLUMNS, "vendor-master-template");
    toast.success("Template downloaded — fill it in and use Import.");
  };

  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Allow picking the same filename again later.
    e.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file.");
      return;
    }

    setImporting(true);
    setImportResults(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        toast.error("The CSV file has no data rows.");
        setImporting(false);
        return;
      }

      const results: ImportRowResult[] = [];

      // Sequential, not Promise.all — keeps row order in the result list
      // predictable and avoids hammering the API with N parallel inserts.
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 2; // +1 for header row, +1 for 1-based numbering
        const nameForLog = raw[CSV_HEADERS.name] || "(blank)";

        try {
          const name = (raw[CSV_HEADERS.name] || "").trim();
          const pan = (raw[CSV_HEADERS.pan] || "").trim();
          const password = (raw[CSV_HEADERS.password] || "").trim();
          const contactPerson = (raw[CSV_HEADERS.contactPerson] || "").trim();
          const phone = (raw[CSV_HEADERS.phone] || "").trim();
          const email = (raw[CSV_HEADERS.email] || "").trim();
          const gst = (raw[CSV_HEADERS.gst] || "").trim();
          const address = (raw[CSV_HEADERS.address] || "").trim();
          const categoryRaw = (raw[CSV_HEADERS.category] || "").trim();
          const gstTypeRaw = (raw[CSV_HEADERS.gstType] || "").trim();
          const gstStateRaw = (raw[CSV_HEADERS.gstState] || "").trim();
          const groupRaw = (raw[CSV_HEADERS.group] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!name) throw new Error("Vendor Name is required");
          if (!pan) throw new Error("PAN is required");
          // Password is optional on import — left blank, the backend defaults
          // the login to "123456" (changeable later from the Edit form).
          if (password && password.length < 6)
            throw new Error("Password must be at least 6 characters");

          // Category is optional — validate against the known list when given.
          const category = categoryRaw
            ? ALL_CATEGORY_VALUES.find(
                (c) => c.toLowerCase() === categoryRaw.toLowerCase(),
              )
            : "";
          if (categoryRaw && !category)
            throw new Error(
              `Category must be one of ${ALL_CATEGORY_VALUES.join(", ")} (got "${categoryRaw}")`,
            );

          // GST Type is optional — when given must be Registered/Unregistered.
          const gstType = gstTypeRaw
            ? GST_TYPES.find(
                (t) => t.toLowerCase() === gstTypeRaw.toLowerCase(),
              )
            : "";
          if (gstTypeRaw && !gstType)
            throw new Error(
              `GST Type must be "Registered" or "Unregistered" (got "${gstTypeRaw}")`,
            );
          if (gstType === "Registered" && !gst)
            throw new Error(
              "GSTIN is required when GST Type is Registered",
            );

          // GST State is optional — validate against the known state list when given.
          const gstState = gstStateRaw
            ? GST_STATES.find(
                (s) => s.toLowerCase() === gstStateRaw.toLowerCase(),
              )
            : "";
          if (gstStateRaw && !gstState)
            throw new Error(`Unrecognized GST State "${gstStateRaw}"`);

          // Group Name is optional — resolved to the account group's ID by name.
          let groupId: string = "";
          if (groupRaw) {
            const match = accountGroups.find(
              (g) => g.name.toLowerCase() === groupRaw.toLowerCase(),
            );
            if (!match) throw new Error(`Group not found: "${groupRaw}"`);
            groupId = match._id;
          }

          // Status defaults to Active when left blank, matching the form's default.
          const isActive =
            statusRaw === "" || statusRaw === "active"
              ? true
              : statusRaw === "inactive"
                ? false
                : null;
          if (isActive === null)
            throw new Error(
              `Status must be "Active" or "Inactive" (got "${raw[CSV_HEADERS.status]}")`,
            );

          const rowForm: SupplierForm = {
            LHeadName: name,
            LHeadContactPerson: contactPerson,
            LHeadPhone: phone,
            LHeadEmail: email,
            LGST: gst,
            LHeadPan: pan,
            supplierCategory: category || "",
            LGSTType: gstType || "",
            LGSTState: gstState || "",
            LHeadAddress: address,
            LBelongsTo: groupId,
            LHeadStatus: isActive,
            // Same service-category rule as the form's dropdown — see its
            // onChange handler above.
            isTdsApplicable: category === "Services",
            tdsLimitApplicable: true,
            SupplierPassword: password,
            // CSV template has no bank-details columns — always blank on import.
            bankAccountNo: "",
            bankIfscCode: "",
            bankName: "",
            bankBranchCode: "",
          };

          await addRecord(
            buildPayload(rowForm),
            lheadTypeForVendorType(vendorTypeFromCategory(rowForm.supplierCategory)),
          );
          results.push({ row: rowNum, name, status: "success" });
        } catch (err: any) {
          results.push({
            row: rowNum,
            name: nameForLog,
            status: "error",
            message: err?.message || "Unknown error",
          });
        }
      }

      setImportResults(results);
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.length - successCount;

      if (successCount > 0) {
        invalidate();
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} vendor${successCount === 1 ? "" : "s"} ✓`,
        );
      } else if (successCount === 0) {
        toast.error(
          `Import failed for all ${errorCount} row${errorCount === 1 ? "" : "s"}.`,
        );
      } else {
        toast.warning(
          `Imported ${successCount} of ${results.length} rows — ${errorCount} failed. See details.`,
        );
      }
    } catch (err: any) {
      toast.error(
        "Could not read CSV file: " + (err?.message || "Unknown error"),
      );
    } finally {
      setImporting(false);
    }
  };

  const isDirty = Object.keys(form).some(
    (k) =>
      String((form as any)[k] ?? "") !==
      String((EMPTY_FORM as any)[k] ?? ""),
  );
  const canSave =
    form.LHeadName.trim() !== "" &&
    form.LHeadPan.trim() !== "" &&
    (form.LGSTType !== "Registered" || form.LGST.trim() !== "") &&
    // Password is optional — left blank on create, the backend defaults the
    // login to "123456" (changeable later from this form); on edit, blank
    // keeps the supplier's existing login credentials unchanged. Only
    // blocks save when something was typed but it's too short.
    (form.SupplierPassword.trim() === "" || form.SupplierPassword.trim().length >= 6);

  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Normalises a raw LGSTType value from the DB into one of the two canonical
   *  strings the form accepts.  When the DB value is NULL (supplier was created
   *  before the field was added) we infer the type from the GST number:
   *    - GST number present  → 'Registered'
   *    - No GST number       → 'Unregistered'
   *  This way the correct value is written back on the very next save, even
   *  before the backfill migration (196) has run on a given environment. */
  const normalizeGSTType = (t: string | null | undefined, lgst?: string | null): string => {
    if (t === "Unregistered") return "Unregistered";
    if (t) return "Registered"; // Registered / Regular / Composition / SEZ / etc.
    // t is null/undefined — infer from GST number
    return lgst?.trim() ? "Registered" : "Unregistered";
  };

  const startEdit = (s: Supplier) => {
    setEditingId(s.LHeadId);
    setForm({
      LHeadName: s.LHeadName ?? "",
      LHeadContactPerson: s.LHeadContactPerson ?? "",
      LHeadPhone: s.LHeadPhone ?? "",
      LHeadEmail: s.LHeadEmail ?? "",
      LGST: s.LGST ?? "",
      LHeadPan: s.LHeadPan ?? "",
      supplierCategory: s.supplierCategory ?? "",
      LGSTType: normalizeGSTType(s.LGSTType, s.LGST),
      LGSTState: s.LGSTState ?? "",
      LHeadAddress: s.LHeadAddress ?? "",
      LBelongsTo: s.LBelongsTo != null ? String(s.LBelongsTo) : "",
      LHeadStatus: s.LHeadStatus,
      isTdsApplicable: Boolean(s.IsTdsApplicable),
      tdsLimitApplicable: s.TdsLimitApplicable,
      // Never pre-filled from the existing (hashed) password — blank means
      // "keep current password" on save.
      SupplierPassword: "",
      bankAccountNo: s.bankAccountNo ?? "",
      bankIfscCode: s.bankIfscCode ?? "",
      bankName: s.bankName ?? "",
      bankBranchCode: s.bankBranchCode ?? "",
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const handleSave = () => {
    const e: Partial<Record<keyof SupplierForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
    if (!vendorType) e.supplierCategory = true;
    if (
      vendorType === "Supplier" &&
      !(SUPPLIER_CATEGORIES as readonly string[]).includes(form.supplierCategory)
    )
      e.supplierCategory = true;
    if (!form.LHeadPan.trim() && form.LHeadPan !== "PANNOTAVBL") e.LHeadPan = true;
    if (!form.LGSTType) e.LGSTType = true;
    if (form.LGSTType === "Registered" && !form.LGST.trim()) e.LGST = true;
    // Optional on both create (defaults to "123456" server-side) and edit
    // (blank keeps the current password) — only flagged when typed but short.
    if (form.SupplierPassword.trim() !== "" && form.SupplierPassword.trim().length < 6)
      e.SupplierPassword = true;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    if (editingId !== null) {
      updateMut.mutate({ id: editingId, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const handlePrint = useCallback((s: Supplier) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(safeHtml`
      <html><head><title>Vendor — ${s.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Vendor Card</h2>
      <table>
        <tr><td>Vendor Name</td><td>${s.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${s.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${s.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${s.LHeadEmail || "—"}</td></tr>
        <tr><td>GSTIN (GST Identification Number)</td><td>${s.LGST || "—"}</td></tr>
        <tr><td>PAN (Permanent Account Number)</td><td>${s.LHeadPan || "—"}</td></tr>
        <tr><td>GST Type</td><td>${s.LGSTType || "—"}</td></tr>
        <tr><td>GST State</td><td>${s.LGSTState || "—"}</td></tr>
        <tr><td>Category</td><td>${s.supplierCategory || "—"}</td></tr>
        <tr><td>Group</td><td>${s.LBelongsTo != null ? (accountGroups.find((g) => g._id === String(s.LBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${s.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${s.LHeadStatus ? "Active" : "Inactive"}</td></tr>
        <tr><td>Bank Account Number</td><td>${s.bankAccountNo || "—"}</td></tr>
        <tr><td>Bank Name</td><td>${s.bankName || "—"}</td></tr>
        <tr><td>Bank Branch Location</td><td>${s.bankBranchCode || "—"}</td></tr>
        <tr><td>IFSC Code</td><td>${s.bankIfscCode || "—"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  }, [accountGroups]);

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    const loginUrl = `${window.location.origin}/supplier-login`;
    const handleWhatsApp = (s: Supplier) => {
      const phone = (s.LHeadPhone ?? "").replace(/\D/g, "");
      if (!phone) return;
      const loginEmail = s.SupplierLoginEmail ?? "";
      const credLines = loginEmail ? `\n\nLogin Email: ${loginEmail}` : "";
      const waText = encodeURIComponent(
        `Hello,\n\nYou can access the supplier portal using the link below:\n${loginUrl}${credLines}\n\nFor login, use your registered email and password.`
      );
      const waUrl = `https://wa.me/${phone.startsWith("91") ? phone : `91${phone}`}?text=${waText}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
    };
    return buildSupplierColumns(
      editingId,
      deleteConfirm,
      setDeleteConfirm,
      startEdit,
      deleteMut,
      setViewRecord,
      handlePrint,
      handleWhatsApp,
      rights.canEdit,
      rights.canDelete,
      rights.canPrint,
    );
  },
    [editingId, deleteConfirm, startEdit, handlePrint, rights.canEdit, rights.canDelete, rights.canPrint],
  );

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = suppliers.filter((s) => {
      const matchSearch =
        !q ||
        s.LHeadName?.toLowerCase().includes(q) ||
        (s.LHeadPhone ?? "").toLowerCase().includes(q) ||
        (s.LGST ?? "").toLowerCase().includes(q) ||
        (s.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchCat = !filterCategory || s.supplierCategory === filterCategory;
      const matchStatus =
        !filterStatus ||
        (filterStatus === "active" ? s.LHeadStatus : !s.LHeadStatus);
      return matchSearch && matchCat && matchStatus;
    });

    return [...list].sort((a, b) => {
      const av =
        (sortField === "LHeadName"
          ? a.LHeadName
          : sortField === "LHeadContactPerson"
            ? a.LHeadContactPerson
            : a.LHeadPhone) ?? "";
      const bv =
        (sortField === "LHeadName"
          ? b.LHeadName
          : sortField === "LHeadContactPerson"
            ? b.LHeadContactPerson
            : b.LHeadPhone) ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [suppliers, search, filterCategory, filterStatus, sortField, sortAsc]);

  // ── Shared field class ─────────────────────────────────────────────────────
  const inputCls =
    "w-full text-sm border border-foreground/40 focus:border-foreground px-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "Vendor Master"]} />

      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Vendors"
        subtitle="Suppliers, vendors and landlords the business pays: their contact, tax and bank particulars."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all vendor fields"
              className={`${KEY} px-3 py-2 border border-foreground text-foreground hover:bg-primary/10`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import vendors from a filled-in CSV"
              className={`${KEY} px-3 py-2 border border-foreground bg-foreground text-card`}
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
            </button>
          </div>
        }
      >
        {/* ── Figures ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Vendors", value: suppliers.length, note: "in all" },
              { label: "Active", value: suppliers.filter((s) => s.LHeadStatus).length, note: "open for booking" },
              { label: "GST registered", value: suppliers.filter((s) => s.LGSTType === "Registered").length, note: "raise GST bills" },
              { label: "TDS applicable", value: suppliers.filter((s) => s.IsTdsApplicable).length, note: "tax deducted at source" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form ── */}
        <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
            <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
              {editingId ? `Edit ${(vendorType || "Vendor").toLowerCase()}` : `Add ${(vendorType || "Vendor").toLowerCase()}`}
            </h2>
            <p className="text-[0.6875rem] text-muted-foreground">
              Fields marked <span className="text-destructive">*</span> are required
            </p>
          </div>

          <div className="px-4 py-5 space-y-7">
            {/* ── Section: Basic Info ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Basic Information
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Vendor Name */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
                    Vendor Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Acme Supplies Ltd."
                    className={`${inputCls} ${errors.LHeadName ? "border-destructive" : ""}`}
                  />
                  {errors.LHeadName && (
                    <p className="text-xs text-destructive mt-1">Required
                    </p>
                  )}
                </div>

                {/* Contact Person */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Contact Person
                  </label>
                  <div className="relative">
                    <User
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadContactPerson}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadContactPerson: e.target.value,
                        }))
                      }
                      placeholder="e.g. Rahul Sharma"
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Type — Vendor / Supplier / Landlord. Only picking
                    "Supplier" activates the Category field below;
                    "Vendor"/"Landlord" have no sub-category. */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={vendorType}
                    onChange={(v) => {
                      handleTypeChange(v as VendorType);
                      setErrors((p) => ({ ...p, supplierCategory: false }));
                    }}
                    options={VENDOR_TYPES.map((t) => ({ value: t, label: t }))}
                    placeholder="Select type…"
                    error={errors.supplierCategory}
                  />
                </div>

                {/* Supplier Category — active only when Type = "Supplier" */}
                <div className="space-y-1.5">
                  <label
                    className={`${LBL} block ${vendorType === "Supplier" ? "" : "opacity-40"}`}
                  >
                    Supplier Category
                  </label>
                  <div className={vendorType !== "Supplier" ? "opacity-40 pointer-events-none" : ""}>
                    <TreeDropdown
                      variant="flat"
                      value={
                        (SUPPLIER_CATEGORIES as readonly string[]).includes(form.supplierCategory)
                          ? form.supplierCategory
                          : ""
                      }
                      onChange={(v) => {
                        setForm((p) => ({
                          ...p,
                          supplierCategory: v,
                          // TDS mainly attaches to service payments (194C/194J),
                          // not straight goods purchases — auto-set the toggle
                          // whenever the category changes to/from "Services".
                          // "Both" is deliberately excluded (goods+services is
                          // not auto-enabled). Still a normal toggle below, so
                          // it can be corrected by hand for any exception.
                          isTdsApplicable: v === "Services",
                        }));
                        setErrors((p) => ({ ...p, supplierCategory: false }));
                      }}
                      options={SUPPLIER_CATEGORIES.map((c) => ({
                        value: c,
                        label: c,
                      }))}
                      placeholder={vendorType === "Supplier" ? "Select category…" : "Select Supplier type first"}
                      error={vendorType === "Supplier" && errors.supplierCategory}
                    />
                  </div>
                </div>

                {/* Account Group — always Sundry Creditors for suppliers, never
                    picked manually (see accountHeadMaster.js's
                    getSundryCreditorsGroupId, applied server-side on every
                    create/update regardless of what's sent here). */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Account Group
                  </label>
                  <div className="h-[42px] px-3 flex items-center border border-dashed border-foreground/40 text-sm text-muted-foreground">
                    Sundry Creditors
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: Contact Details ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Contact Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Phone */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadPhone}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadPhone: e.target.value,
                        }))
                      }
                      placeholder="e.g. +91 98765 43210"
                      maxLength={15}
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground font-heading tabular-nums placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadEmail}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadEmail: e.target.value,
                        }))
                      }
                      placeholder="e.g. contact@acme.com"
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-1.5 sm:col-span-3">
                  <label className={`${LBL} block`}>
                    Address
                  </label>
                  <div className="relative">
                    <MapPin
                      size={13}
                      className="absolute left-3 top-3 text-muted-foreground pointer-events-none"
                    />
                    <textarea
                      value={form.LHeadAddress}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadAddress: e.target.value,
                        }))
                      }
                      placeholder="Full address…"
                      rows={2}
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: GST & Tax ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                GST &amp; Tax Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-5">
                {/* PAN */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
                    PAN <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadPan === "PANNOTAVBL" ? "" : form.LHeadPan}
                    disabled={form.LHeadPan === "PANNOTAVBL"}
                    onChange={(e) => {
                      setForm((p) => ({
                        ...p,
                        LHeadPan: e.target.value.toUpperCase(),
                      }));
                      setErrors((p) => ({ ...p, LHeadPan: false }));
                    }}
                    placeholder="e.g. AAPFU0939F"
                    maxLength={10}
                    className={`${inputCls} font-heading tabular-nums ${errors.LHeadPan ? "border-destructive" : ""} ${form.LHeadPan === "PANNOTAVBL" ? "opacity-40 cursor-not-allowed" : ""}`}
                  />
                  <label className="flex items-center gap-1.5 cursor-pointer select-none mt-1">
                    <input
                      type="checkbox"
                      checked={form.LHeadPan === "PANNOTAVBL"}
                      onChange={(e) => {
                        setForm((p) => ({ ...p, LHeadPan: e.target.checked ? "PANNOTAVBL" : "" }));
                        setErrors((p) => ({ ...p, LHeadPan: false }));
                      }}
                      className="h-3 w-3 accent-foreground"
                    />
                    <span className="text-[0.6875rem] text-muted-foreground">PAN not available</span>
                  </label>
                  {errors.LHeadPan && (
                    <p className="text-xs text-destructive mt-1">Required
                    </p>
                  )}
                </div>

                {/* GST Type */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    GST Type <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.LGSTType}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((p) => ({
                        ...p,
                        LGSTType: v,
                        LGST: v === "Registered" ? p.LGST : "",
                      }));
                      setErrors((p) => ({ ...p, LGST: false }));
                    }}
                    className={`${inputCls} appearance-none ${errors.LGSTType ? "border-destructive" : ""}`}
                  >
                    <option value="" disabled>Select…</option>
                    {GST_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {errors.LGSTType && (
                    <p className="text-xs text-destructive mt-1">Required — determines GST Bill vs Non-GST Bill on invoices
                    </p>
                  )}
                </div>

                {/* GSTIN (GST Identification Number) — only when Registered */}
                {form.LGSTType === "Registered" && (
                  <div className="space-y-1.5">
                    <label className={`${LBL} flex items-center gap-1`}>
                      GSTIN (GST Identification Number) <span className="text-destructive">*</span>
                    </label>
                    <input
                      value={form.LGST}
                      onChange={(e) => {
                        setForm((p) => ({
                          ...p,
                          LGST: e.target.value.toUpperCase(),
                        }));
                        setErrors((p) => ({ ...p, LGST: false }));
                      }}
                      placeholder="e.g. 27AAPFU0939F1ZV"
                      maxLength={15}
                      className={`${inputCls} font-heading tabular-nums ${errors.LGST ? "border-destructive" : ""}`}
                    />
                    {errors.LGST && (
                      <p className="text-xs text-destructive mt-1">Required
                      </p>
                    )}
                  </div>
                )}

                {/* GST State */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    GST State
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.LGSTState}
                    onChange={(v) => setForm((p) => ({ ...p, LGSTState: v }))}
                    options={GST_STATES.map((s) => ({ value: s, label: s }))}
                    placeholder="Select state…"
                  />
                </div>
              </div>
            </div>

            {/* ── Section: Bank Details — all fields optional ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Bank Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-5">
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Bank Account Number
                  </label>
                  <input
                    value={form.bankAccountNo}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, bankAccountNo: e.target.value }))
                    }
                    placeholder="e.g. 123456789012"
                    className={`${inputCls} font-heading tabular-nums`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Bank Name
                  </label>
                  <input
                    value={form.bankName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, bankName: e.target.value }))
                    }
                    placeholder="e.g. State Bank of India"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Bank Branch Location
                  </label>
                  <input
                    value={form.bankBranchCode}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, bankBranchCode: e.target.value }))
                    }
                    placeholder="e.g. Mumbai Main Branch"
                    className={`${inputCls} font-heading tabular-nums`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    IFSC Code
                  </label>
                  <input
                    value={form.bankIfscCode}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        bankIfscCode: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. SBIN0001234"
                    maxLength={11}
                    className={`${inputCls} font-heading tabular-nums`}
                  />
                </div>
              </div>
            </div>

            {/* ── Section: Supplier Portal Login — Supplier only. A Vendor or
                Landlord never gets portal credentials, so the whole section
                (and everything it would submit) simply doesn't exist for
                them, rather than being shown disabled/empty. ── */}
            {vendorType === "Supplier" && (
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Supplier Portal Login
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {/* Login email — auto-generated, read-only, only shown once it exists */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    Login Email
                  </label>
                  <input
                    value={
                      editingId
                        ? suppliers.find((s) => s.LHeadId === editingId)
                            ?.SupplierLoginEmail || "—"
                        : "Auto-generated on save (<name>@civilier.in)"
                    }
                    readOnly
                    disabled
                    className={`${inputCls} border-dashed text-muted-foreground cursor-not-allowed`}
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
                    Password
                  </label>
                  <input
                    type="password"
                    value={form.SupplierPassword}
                    onChange={(e) => {
                      setForm((p) => ({
                        ...p,
                        SupplierPassword: e.target.value,
                      }));
                      setErrors((p) => ({ ...p, SupplierPassword: false }));
                    }}
                    placeholder={
                      editingId
                        ? "Leave blank to keep current password"
                        : "Leave blank to default to 123456"
                    }
                    className={`${inputCls} ${errors.SupplierPassword ? "border-destructive" : ""}`}
                  />
                  {errors.SupplierPassword && (
                    <p className="text-xs text-destructive mt-1">Required, min 6 characters
                    </p>
                  )}
                </div>
              </div>

            {/* ── Portal link (read-only display + copy) ── */}
            {(() => {
              const loginUrl = `${window.location.origin}/supplier-login`;
              return (
                <div className="flex items-center gap-3 px-3 py-2 border border-foreground/40">
                  <span className={`${LBL} shrink-0`}>Portal</span>
                  <span className="font-heading tabular-nums text-xs text-muted-foreground truncate flex-1 min-w-0">{loginUrl}</span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(loginUrl); toast.success("Link copied"); }}
                    className={`${KEY} px-2.5 py-1.5 border border-foreground text-foreground hover:bg-primary/10 shrink-0`}
                    title="Copy portal link"
                  >
                    <Copy size={11} />
                    Copy
                  </button>
                </div>
              );
            })()}

            </div>
            )}

            {/* ── Toggles ── */}
            <div className="flex flex-wrap items-center gap-6 pt-1">
              {/* Status */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))
                  }
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.LHeadStatus ? "bg-foreground" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <span className={LBL}>
                  Status —{" "}
                  <span className="text-foreground">
                    {form.LHeadStatus ? "Active" : "Inactive"}
                  </span>
                </span>
              </div>

              {/* TDS Applicable */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setForm((p) => ({ ...p, isTdsApplicable: !p.isTdsApplicable }))
                  }
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.isTdsApplicable ? "bg-foreground" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${form.isTdsApplicable ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <span className={LBL}>
                  TDS Applicable —{" "}
                  <span className="text-foreground">
                    {form.isTdsApplicable ? "Yes" : "No"}
                  </span>
                </span>
              </div>

              {/* TDS Limit — only meaningful once TDS Applicable is on.
                  ON (default): the ₹30k single-bill / ₹1L yearly-cumulative
                  threshold gates TDS deduction. OFF: TDS deducts on every
                  eligible bill unconditionally, no threshold check. */}
              {form.isTdsApplicable && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({ ...p, tdsLimitApplicable: !p.tdsLimitApplicable }))
                    }
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.tdsLimitApplicable ? "bg-foreground" : "bg-muted-foreground/30"}`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${form.tdsLimitApplicable ? "translate-x-4" : "translate-x-0.5"}`}
                    />
                  </button>
                  <span className={LBL}>
                    TDS Limit (₹30k / ₹1L threshold) —{" "}
                    <span className="text-foreground">
                      {form.tdsLimitApplicable ? "Applied" : "Deduct on every bill"}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3" style={{ borderTop: RULE }}>
            <div className="hidden sm:block">
              {canSave ? <SheetMark text="Ready to save" tone="done" /> : <span className="text-[0.6875rem] text-muted-foreground">Fill in the required fields to save</span>}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                onClick={resetForm}
                disabled={!isDirty && !editingId}
                className={`${KEY} flex-1 sm:flex-none h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
              >
                <RotateCcw size={12} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className={`${KEY} flex-1 sm:flex-none h-9 px-5 bg-foreground text-card border border-foreground whitespace-nowrap`}
              >
                {saving ? (
                  <span className="w-3.5 h-3.5 border-2 border-card/30 border-t-card rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={13} />
                ) : (
                  <Plus size={13} />
                )}
                {saving
                  ? "Saving…"
                  : editingId
                    ? `Update ${(vendorType || "Vendor").toLowerCase()}`
                    : `Save ${(vendorType || "Vendor").toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>

        {/* ── Table Section ── */}
        <div className="bg-card" style={{ border: RULE }}>
          {/* Toolbar */}
          <div className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: RULE }}>
            <div className="relative flex-1 sm:flex-none">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, GST…"
                className="w-full sm:w-56 h-9 text-sm border border-foreground/40 focus:border-foreground pl-9 pr-3 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>

            <TreeDropdown
              variant="flat"
              value={filterCategory}
              onChange={(v) => setFilterCategory(v)}
              options={ALL_CATEGORY_VALUES.map((c) => ({ value: c, label: c }))}
              placeholder="All Categories"
            />

            <TreeDropdown
              variant="flat"
              value={filterStatus}
              onChange={(v) => setFilterStatus(v)}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              placeholder="All Status"
            />

            {(search || filterCategory || filterStatus) && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilterCategory("");
                  setFilterStatus("");
                }}
                className={`${KEY} h-9 px-3 border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground`}
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="[&_th:last-child]:text-left [&_td:last-child]:text-left">
            <DataTable
              key={`${search}|${filterCategory}|${filterStatus}`}
              data={filtered}
              columns={columns}
              loading={isLoading}
              searchable={false}
              getRowId={(row) => String(row.LHeadId)}
              emptyMessage={
                isError
                  ? "Failed to load vendors."
                  : suppliers.length === 0
                    ? "No vendors yet."
                    : "No results match your search."
              }
              exportConfig={{
                title: "Vendor Master",
                filename: "vendor-master",
                columns: EXPORT_COLUMNS,
              }}
              rowClassName={(row) =>
                row.original.LHeadId === editingId ? "shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""
              }
            />
          </div>
        </div>
      </SheetShell>

      {/* Import Results Modal */}
      <Dialog
        open={!!importResults}
        onOpenChange={(open) => !open && setImportResults(null)}
      >
        <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Vendors · CSV import</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Import results</DialogTitle>
            </div>
          </DialogHeader>
          {importResults && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-4 flex-wrap">
                <SheetMark text={`${importResults.filter((r) => r.status === "success").length} imported`} tone="done" />
                {importResults.some((r) => r.status === "error") && (
                  <SheetMark text={`${importResults.filter((r) => r.status === "error").length} failed`} tone="stopped" />
                )}
              </div>
              <div className="max-h-72 overflow-y-auto" style={{ border: RULE }}>
                {importResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 text-sm" style={i ? { borderTop: "1px solid hsl(var(--border) / 0.7)" } : undefined}>
                    <span className="font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground shrink-0 mt-1 w-12">Row {r.row}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-foreground">{r.name}</p>
                      {r.message && <p className="text-xs text-destructive mt-0.5">{r.message}</p>}
                    </div>
                    {r.status === "success" ? <Check size={14} className="text-foreground shrink-0 mt-0.5" /> : <X size={14} className="text-destructive shrink-0 mt-0.5" />}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 mt-2" style={{ borderTop: RULE }}>
            <button onClick={() => setImportResults(null)} className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}>
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div
            className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200"
            style={{ margin: 0, borderLeft: RULE }}
          >
            <div className="flex items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="min-w-0">
                <p className={LBL}>{vendorTypeFromCategory(viewRecord.supplierCategory || "") || "Vendor"}</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 break-words">{viewRecord.LHeadName}</h3>
              </div>
              <button onClick={() => setViewRecord(null)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                {
                  label: "Contact Person",
                  value: viewRecord.LHeadContactPerson || "—",
                },
                {
                  label: "Phone",
                  value: viewRecord.LHeadPhone || "—",
                  mono: true,
                },
                { label: "Email", value: viewRecord.LHeadEmail || "—" },
                {
                  label: "GSTIN (GST Identification Number)",
                  value: viewRecord.LGST || "—",
                  mono: true,
                },
                {
                  label: "PAN (Permanent Account Number)",
                  value: viewRecord.LHeadPan || "—",
                  mono: true,
                },
                { label: "GST Type", value: viewRecord.LGSTType || "—" },
                { label: "GST State", value: viewRecord.LGSTState || "—" },
                {
                  label: "Supplier Category",
                  value: viewRecord.supplierCategory || "—",
                },
                {
                  label: "Group Name",
                  value:
                    viewRecord.LBelongsTo != null
                      ? (accountGroups.find(
                          (g) => g._id === String(viewRecord.LBelongsTo),
                        )?.name ?? "—")
                      : "—",
                },
                { label: "Address", value: viewRecord.LHeadAddress || "—" },
                { label: "Bank Account Number", value: viewRecord.bankAccountNo || "—", mono: true },
                { label: "Bank Name", value: viewRecord.bankName || "—" },
                { label: "Bank Branch Location", value: viewRecord.bankBranchCode || "—", mono: true },
                { label: "IFSC Code", value: viewRecord.bankIfscCode || "—", mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className={`${LBL} mb-1`}>{label}</p>
                  <p className={`text-sm text-foreground break-words ${mono ? "font-heading tabular-nums font-semibold" : ""}`}>
                    {value}
                  </p>
                </div>
              ))}
              <div>
                <p className={`${LBL} mb-1.5`}>Status</p>
                <SheetMark text={viewRecord.LHeadStatus ? "Active" : "Inactive"} tone={viewRecord.LHeadStatus ? "done" : "none"} />
              </div>
            </div>
            <div className="px-5 py-3 flex justify-end gap-2 flex-wrap" style={{ borderTop: RULE }}>
              {rights.canPrint && (
                <button onClick={() => handlePrint(viewRecord)} className={`${KEY} h-9 px-3 border border-foreground text-foreground hover:bg-primary/10`}>
                  <Printer size={12} /> Print
                </button>
              )}
              <button onClick={() => setViewRecord(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                Close
              </button>
              {rights.canEdit && (
                <button
                  onClick={() => {
                    startEdit(viewRecord);
                    setViewRecord(null);
                  }}
                  className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}
                >
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default SupplierMaster;
