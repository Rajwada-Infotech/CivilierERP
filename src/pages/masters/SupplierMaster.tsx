import React, { useState, useMemo, useRef, useCallback } from "react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
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
  AlertCircle,
  Eye,
  XCircle,
  User,
  Building2,
  Phone,
  Mail,
  MapPin,
  FileText,
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

// ─── Constants ────────────────────────────────────────────────────────────────
const SUPPLIER_TYPE = "S";

const SUPPLIER_CATEGORIES = ["Goods", "Services", "Both"] as const;
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
  GroupName: string | null;
  // Auto-generated on create as <SupplierName>@civilier.in — this is the
  // supplier's login username for the Supplier Portal, distinct from
  // LHeadEmail (their own business contact address).
  SupplierLoginEmail: string | null;
}

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

interface TreeNode extends AccountGroup {
  children: TreeNode[];
}

function buildTree(items: AccountGroup[]): TreeNode[] {
  const map: Record<string, TreeNode> = {};
  items.forEach((i) => (map[i._id] = { ...i, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId])
      map[i.parentId].children.push(map[i._id]);
    else roots.push(map[i._id]);
  });
  return roots;
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
  // Mandatory on create; optional on edit (blank = keep existing password).
  SupplierPassword: string;
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
  SupplierPassword: "",
};

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Supplier Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST Number", accessor: "LGST" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "GST Type", accessor: "LGSTType" },
  { header: "GST State", accessor: "LGSTState" },
  { header: "Category", accessor: "supplierCategory" },
  {
    header: "Group",
    accessor: (r) => {
      // resolved in display — raw value is AGId
      return r.LBelongsTo != null ? String(r.LBelongsTo) : "—";
    },
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
];

// ─── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  name: "Supplier Name",
  contactPerson: "Contact Person",
  phone: "Phone",
  email: "Email",
  gst: "GST Number",
  pan: "PAN Number",
  category: "Category (Goods/Services/Both)",
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
      header: "Supplier Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "LHeadContactPerson",
      header: "Contact Person",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadPhone",
      header: "Phone",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LGST",
      header: "GST No. / Type",
      cell: ({ getValue, row }) => {
        const gst = getValue() as string | null;
        const gstType = (row.original as any).LGSTType as string | null;
        const badgeCls = gstType === "Registered"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          : gstType === "Unregistered"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
            : "bg-muted text-muted-foreground border-border";
        const badgeLabel = gstType === "Registered"
          ? "GST"
          : gstType === "Unregistered"
            ? "Non-GST"
            : "Unknown";
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs font-semibold text-primary">
              {gst || "—"}
            </span>
            <span className={`inline-flex w-fit items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${badgeCls}`}>
              {badgeLabel}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "LHeadStatus",
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
      accessorKey: "IsTdsApplicable",
      header: "TDS",
      cell: ({ getValue }) => {
        const tds = getValue() as boolean;
        return tds ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600">
            TDS
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
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
              <span className="text-[11px] text-muted-foreground mr-1">
                Delete?
              </span>
              <button
                onClick={() => deleteMut.mutate(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="p-1 rounded text-muted-foreground hover:bg-muted"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        const hasPhone = !!(row.original.LHeadPhone?.replace(/\D/g, ""));
        return (
          <div className="flex items-center justify-start gap-2 w-full min-w-[120px]">
            <button
              onClick={() => onView(row.original)}
              className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>
            {canPrint && (
              <button
                onClick={() => onPrint(row.original)}
                className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                title="Print"
              >
                <Printer size={15} />
              </button>
            )}
            <button
              onClick={() => onWhatsApp(row.original)}
              disabled={!hasPhone}
              className={`p-1 rounded transition-colors ${hasPhone ? "text-[#25D366] hover:bg-[#25D366]/10" : "text-muted-foreground/30 cursor-not-allowed"}`}
              title={hasPhone ? "Send portal link via WhatsApp" : "Add phone number to enable WhatsApp"}
            >
              {WA_SVG}
            </button>
            {canEdit && (
              <button
                onClick={() => startEdit(row.original)}
                className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteConfirm(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete"
              >
                <Trash2 size={15} />
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
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const rights = usePageRights("supplier-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof SupplierForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Supplier | null>(null);

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
    queryKey: ["account-head", SUPPLIER_TYPE],
    queryFn: () => getList(SUPPLIER_TYPE),
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

  const accountGroupTree = useMemo(
    () => buildTree(accountGroups),
    [accountGroups],
  );

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
      GroupName: item.GroupName ?? null,
      SupplierLoginEmail: item.SupplierLoginEmail ?? null,
    }));
  }, [rawData]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", SUPPLIER_TYPE] });

  const buildPayload = (f: SupplierForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: SUPPLIER_TYPE,
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
    LBranchName: null,
    LGSTState: f.LGSTState || null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
    // Omitted (not sent as an empty string) when blank — on create the
    // backend defaults the login password to "123456"; on edit, blank
    // leaves the existing password untouched (see accountHeadMaster.js).
    ...(f.SupplierPassword ? { SupplierPassword: f.SupplierPassword } : {}),
  });

  const createMut = useMutation({
    mutationFn: (f: SupplierForm) => addRecord(buildPayload(f), SUPPLIER_TYPE),
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
          ? `Supplier created — login email: ${res.SupplierLoginEmail}${passwordNote}`
          : "Supplier created",
      );
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierForm }) =>
      updateRecord(id, buildPayload(data), SUPPLIER_TYPE),
    onSuccess: () => {
      toast.success("Supplier updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Supplier deleted");
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
    exportToCsv([], SUPPLIER_CSV_TEMPLATE_COLUMNS, "supplier-master-template");
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

          if (!name) throw new Error("Supplier Name is required");
          if (!pan) throw new Error("PAN Number is required");
          // Password is optional on import — left blank, the backend defaults
          // the login to "123456" (changeable later from the Edit form).
          if (password && password.length < 6)
            throw new Error("Password must be at least 6 characters");

          // Category is optional — validate against the known list when given.
          const category = categoryRaw
            ? SUPPLIER_CATEGORIES.find(
                (c) => c.toLowerCase() === categoryRaw.toLowerCase(),
              )
            : "";
          if (categoryRaw && !category)
            throw new Error(
              `Category must be one of Goods, Services, Both (got "${categoryRaw}")`,
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
              "GST Number is required when GST Type is Registered",
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
            isTdsApplicable: false,
            SupplierPassword: password,
          };

          await addRecord(buildPayload(rowForm), SUPPLIER_TYPE);
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
          `Imported ${successCount} supplier${successCount === 1 ? "" : "s"} ✓`,
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
      // Never pre-filled from the existing (hashed) password — blank means
      // "keep current password" on save.
      SupplierPassword: "",
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
      <html><head><title>Supplier — ${s.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Supplier Card</h2>
      <table>
        <tr><td>Supplier Name</td><td>${s.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${s.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${s.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${s.LHeadEmail || "—"}</td></tr>
        <tr><td>GST Number</td><td>${s.LGST || "—"}</td></tr>
        <tr><td>PAN Number</td><td>${s.LHeadPan || "—"}</td></tr>
        <tr><td>GST Type</td><td>${s.LGSTType || "—"}</td></tr>
        <tr><td>GST State</td><td>${s.LGSTState || "—"}</td></tr>
        <tr><td>Category</td><td>${s.supplierCategory || "—"}</td></tr>
        <tr><td>Group</td><td>${s.LBelongsTo != null ? (accountGroups.find((g) => g._id === String(s.LBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${s.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${s.LHeadStatus ? "Active" : "Inactive"}</td></tr>
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
    "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "Supplier Master"]} />

      <FinanceShell
        title="Supplier Master"
        subtitle="Manage supplier accounts with contact, GST and category details"
        action={
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-heading px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.25)",
                color: "#818cf8",
              }}
            >
              {suppliers.length} Suppliers
            </span>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all supplier fields"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import suppliers from a filled-in CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {importing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Upload size={13} />
              )}
              <span className="hidden sm:inline">
                {importing ? "Importing..." : "Import CSV"}
              </span>
            </button>
          </div>
        }
      >
        {/* ── Form Card ── */}
        <div
          className="rounded-xl overflow-visible"
          style={{
            background: isDark
              ? "rgba(12,14,22,0.55)"
              : "rgba(255,255,255,0.82)",
            border: isDark
              ? "1px solid rgba(99,102,241,0.20)"
              : "1px solid rgba(99,102,241,0.16)",
            backdropFilter: "blur(18px) saturate(150%)",
            WebkitBackdropFilter: "blur(18px) saturate(150%)",
            boxShadow: isDark
              ? "0 8px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 8px 32px rgba(99,102,241,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
          }}
        >
          {/* Card header — title only */}
          <div
            className="flex items-center gap-3 px-5 sm:px-6 py-4 relative overflow-hidden rounded-t-xl"
            style={{
              background: isDark
                ? "rgba(99,102,241,0.09)"
                : "rgba(99,102,241,0.05)",
              borderBottom: isDark
                ? "1px solid rgba(99,102,241,0.18)"
                : "1px solid rgba(99,102,241,0.13)",
            }}
          >
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground">
                {editingId ? "Edit Supplier" : "Add Supplier"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are
                required
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            {/* ── Section: Basic Info ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Building2 size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Basic Information
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Supplier Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Supplier Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Acme Supplies Ltd."
                    className={`${inputCls} ${errors.LHeadName ? "border-red-400" : ""}`}
                  />
                  {errors.LHeadName && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* Contact Person */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Supplier Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Supplier Category
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.supplierCategory}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, supplierCategory: v }))
                    }
                    options={SUPPLIER_CATEGORIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                    placeholder="Select category…"
                  />
                </div>

                {/* Account Group — always Sundry Creditors for suppliers, never
                    picked manually (see accountHeadMaster.js's
                    getSundryCreditorsGroupId, applied server-side on every
                    create/update regardless of what's sent here). */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Group
                  </label>
                  <div className="h-9 px-3 flex items-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
                    Sundry Creditors
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: Contact Details ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Phone size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Contact Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-1.5 sm:col-span-3">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: GST & Tax ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <FileText size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  GST &amp; Tax Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-5">
                {/* PAN */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
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
                    className={`${inputCls} font-mono ${errors.LHeadPan ? "border-red-400" : ""} ${form.LHeadPan === "PANNOTAVBL" ? "opacity-40 cursor-not-allowed" : ""}`}
                  />
                  <label className="flex items-center gap-1.5 cursor-pointer select-none mt-1">
                    <input
                      type="checkbox"
                      checked={form.LHeadPan === "PANNOTAVBL"}
                      onChange={(e) => {
                        setForm((p) => ({ ...p, LHeadPan: e.target.checked ? "PANNOTAVBL" : "" }));
                        setErrors((p) => ({ ...p, LHeadPan: false }));
                      }}
                      className="h-3 w-3 rounded accent-primary"
                    />
                    <span className="text-[11px] text-muted-foreground">PAN not available</span>
                  </label>
                  {errors.LHeadPan && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* GST Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                    className={`${inputCls} appearance-none ${errors.LGSTType ? "border-red-400" : ""}`}
                  >
                    {GST_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {errors.LGSTType && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required — determines GST Bill vs Non-GST Bill on invoices
                    </p>
                  )}
                </div>

                {/* GST Number — only when Registered */}
                {form.LGSTType === "Registered" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      GST Number <span className="text-destructive">*</span>
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
                      className={`${inputCls} font-mono ${errors.LGST ? "border-red-400" : ""}`}
                    />
                    {errors.LGST && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={11} /> Required
                      </p>
                    )}
                  </div>
                )}

                {/* GST State */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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

            {/* ── Section: Supplier Portal Login ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <User size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Supplier Portal Login
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {/* Login email — auto-generated, read-only, only shown once it exists */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                    className={`${inputCls} bg-muted/40 text-muted-foreground cursor-not-allowed`}
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
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
                    className={`${inputCls} ${errors.SupplierPassword ? "border-red-400" : ""}`}
                  />
                  {errors.SupplierPassword && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required, min 6 characters
                    </p>
                  )}
                </div>
              </div>

            {/* ── Portal link (read-only display + copy) ── */}
            {(() => {
              const loginUrl = `${window.location.origin}/supplier-login`;
              return (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40">
                  <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground/60 shrink-0">Portal</span>
                  <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-0">{loginUrl}</span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(loginUrl); toast.success("Link copied"); }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors shrink-0 text-muted-foreground hover:text-foreground"
                    title="Copy portal link"
                  >
                    <Copy size={11} />
                    Copy
                  </button>
                </div>
              );
            })()}

            </div>

            {/* ── Toggles ── */}
            <div className="flex flex-wrap items-center gap-6 pt-1">
              {/* Status */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))
                  }
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${form.LHeadStatus ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                  Status —{" "}
                  <span
                    className={
                      form.LHeadStatus ? "text-emerald-600" : "text-foreground"
                    }
                  >
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
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/30 ${form.isTdsApplicable ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.isTdsApplicable ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                  TDS Applicable —{" "}
                  <span
                    className={
                      form.isTdsApplicable ? "text-amber-600" : "text-foreground"
                    }
                  >
                    {form.isTdsApplicable ? "Yes" : "No"}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Card footer — actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl">
            <p className="text-[11px] text-muted-foreground hidden sm:block">
              {canSave ? (
                <span className="text-emerald-500 font-medium">
                  Ready to save
                </span>
              ) : (
                "Fill in the required fields to save"
              )}
            </p>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                onClick={resetForm}
                disabled={!isDirty && !editingId}
                className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {saving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Update Supplier"
                    : "Save Supplier"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Table Section ── */}
        <div>
          {/* Toolbar */}
          <div className="mb-3 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 sm:flex-none">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, GST…"
                className="w-full sm:w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>

            <TreeDropdown
              variant="flat"
              value={filterCategory}
              onChange={(v) => setFilterCategory(v)}
              options={SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: c }))}
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
                className="text-xs font-heading text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden [&_th:last-child]:text-left [&_td:last-child]:text-left">
            <DataTable
              key={`${search}|${filterCategory}|${filterStatus}`}
              data={filtered}
              columns={columns}
              loading={isLoading}
              searchable={false}
              getRowId={(row) => String(row.LHeadId)}
              emptyMessage={
                isError
                  ? "Failed to load suppliers."
                  : suppliers.length === 0
                    ? "No suppliers yet."
                    : "No results match your search."
              }
              exportConfig={{
                title: "Supplier Master",
                filename: "supplier-master",
                columns: EXPORT_COLUMNS,
              }}
              rowClassName={(row) =>
                row.original.LHeadId === editingId ? "bg-primary/5" : ""
              }
            />
          </div>
        </div>
      </FinanceShell>

      {/* Import Results Modal */}
      <Dialog
        open={!!importResults}
        onOpenChange={(open) => !open && setImportResults(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              Import Results
            </DialogTitle>
          </DialogHeader>
          {importResults && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-green-600">
                  <Check size={14} />
                  {
                    importResults.filter((r) => r.status === "success").length
                  }{" "}
                  succeeded
                </span>
                {importResults.some((r) => r.status === "error") && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <X size={14} />
                    {
                      importResults.filter((r) => r.status === "error").length
                    }{" "}
                    failed
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {importResults.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-2 text-sm ${
                      r.status === "error" ? "bg-destructive/5" : ""
                    }`}
                  >
                    {r.status === "success" ? (
                      <Check
                        size={14}
                        className="text-green-600 shrink-0 mt-0.5"
                      />
                    ) : (
                      <X
                        size={14}
                        className="text-destructive shrink-0 mt-0.5"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        Row {r.row} — {r.name}
                      </p>
                      {r.message && (
                        <p className="text-xs text-destructive">{r.message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
            <button
              onClick={() => setImportResults(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Supplier Details
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                { label: "Supplier Name", value: viewRecord.LHeadName },
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
                  label: "GST Number",
                  value: viewRecord.LGST || "—",
                  mono: true,
                },
                {
                  label: "PAN Number",
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
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    {label}
                  </p>
                  <p
                    className={`text-sm text-foreground ${mono ? "font-mono font-semibold text-primary" : ""}`}
                  >
                    {value}
                  </p>
                </div>
              ))}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Status
                </p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${viewRecord.LHeadStatus ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {viewRecord.LHeadStatus ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-muted/20">
              <button
                onClick={() => handlePrint(viewRecord)}
                className="px-3 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <Printer size={13} /> Print
              </button>
              <button
                onClick={() => setViewRecord(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  startEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white shadow-sm flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit Supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SupplierMaster;
