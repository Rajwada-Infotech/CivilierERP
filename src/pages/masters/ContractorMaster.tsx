import React, { useState, useMemo, useRef } from "react";
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
import { getContractorCategoryOptions } from "@/api/contractorCategoryApi";
import { getVendorPaymentTermOptions } from "@/api/vendorPaymentTermApi";
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
  HardHat,
  CreditCard,
  RotateCcw,
  Download,
  Upload,
  Loader2,
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
const CONTRACTOR_TYPE = "C";

const DEFAULT_CONTRACTOR_CATEGORIES = [
  "Civil",
  "Electrical",
  "Mechanical",
  "Plumbing",
  "General",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Contractor {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  contractorType: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
  GroupName: string | null;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
}

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}


interface ContractorForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  contractorType: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LBelongsTo: number | "";
  LHeadStatus: boolean;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
}

const EMPTY_FORM: ContractorForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LHeadPan: "",
  contractorType: "",
  LHeadPaymentTerms: "",
  LHeadAddress: "",
  LBelongsTo: "",
  LHeadStatus: true,
  isTdsApplicable: false,
  tdsLimitApplicable: true,
};

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Contractor Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST Number", accessor: "LGST" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "Contractor Type", accessor: "contractorType" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  {
    header: "Group",
    accessor: (r) => (r.LBelongsTo != null ? String(r.LBelongsTo) : "—"),
  },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

// ─── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  name: "Contractor Name",
  contactPerson: "Contact Person",
  phone: "Phone",
  email: "Email",
  gst: "GST Number",
  pan: "PAN Number",
  contractorType: "Contractor Type",
  paymentTerms: "Payment Terms",
  group: "Group Name",
  address: "Address",
  status: "Status (Active/Inactive)",
} as const;

const CONTRACTOR_CSV_TEMPLATE_COLUMNS: CsvExportColumn[] = [
  { header: CSV_HEADERS.name, accessor: "LHeadName" },
  { header: CSV_HEADERS.contactPerson, accessor: "LHeadContactPerson" },
  { header: CSV_HEADERS.phone, accessor: "LHeadPhone" },
  { header: CSV_HEADERS.email, accessor: "LHeadEmail" },
  { header: CSV_HEADERS.gst, accessor: "LGST" },
  { header: CSV_HEADERS.pan, accessor: "LHeadPan" },
  { header: CSV_HEADERS.contractorType, accessor: "contractorType" },
  { header: CSV_HEADERS.paymentTerms, accessor: "LHeadPaymentTerms" },
  { header: CSV_HEADERS.group, accessor: "GroupName" },
  { header: CSV_HEADERS.address, accessor: "LHeadAddress" },
  { header: CSV_HEADERS.status, accessor: "LHeadStatus" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── Column builder ────────────────────────────────────────────────────────────
function buildContractorColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (c: Contractor) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (c: Contractor) => void,
  onPrint: (c: Contractor) => void,
  canEdit: boolean,
  canDelete: boolean,
  canPrint: boolean,
): ColumnDef<Contractor, unknown>[] {
  return [
    {
      accessorKey: "LHeadName",
      header: "Contractor Name",
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
      header: "GST No.",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadPaymentTerms",
      header: "Payment Terms",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
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
const ContractorMaster: React.FC = () => {
  const qc = useQueryClient();
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const rights = usePageRights("contractor-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ContractorForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof ContractorForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Contractor | null>(null);

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
    queryKey: ["account-head", CONTRACTOR_TYPE],
    queryFn: () => getList(CONTRACTOR_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const { data: categoryOptions } = useQuery({
    queryKey: ["contractor-category-options"],
    queryFn: async () => {
      const options = await getContractorCategoryOptions();
      return options.map((o: { name: string }) => o.name);
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 10 * 60 * 1000,
  });

  // Sourced from Payment Term Master so the value stored here exactly
  // matches a VendorPaymentTerm.Description — the invoice page auto-fills
  // its Payment Terms field by matching this text against that master.
  const { data: paymentTermOptions } = useQuery({
    queryKey: ["vendor-payment-term-options"],
    queryFn: getVendorPaymentTermOptions,
    staleTime: 5 * 60 * 1000,
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

  const contractorCategories: string[] = useMemo(
    () =>
      categoryOptions && categoryOptions.length > 0
        ? categoryOptions
        : [...DEFAULT_CONTRACTOR_CATEGORIES],
    [categoryOptions],
  );

  const contractors: Contractor[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      contractorType: item.LHeadCategory || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
      GroupName: item.GroupName ?? null,
      isTdsApplicable: Boolean(item.IsTdsApplicable),
      tdsLimitApplicable: item.TdsLimitApplicable == null ? true : Boolean(item.TdsLimitApplicable),
    }));
  }, [rawData]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", CONTRACTOR_TYPE] });

  const buildPayload = (f: ContractorForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: CONTRACTOR_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadCategory: f.contractorType || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LGSTState: null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
    IsTdsApplicable: f.isTdsApplicable,
    TdsLimitApplicable: f.tdsLimitApplicable,
  });

  const createMut = useMutation({
    mutationFn: (f: ContractorForm) =>
      addRecord(buildPayload(f), CONTRACTOR_TYPE),
    onSuccess: () => {
      toast.success("Contractor created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ContractorForm }) =>
      updateRecord(id, buildPayload(data), CONTRACTOR_TYPE),
    onSuccess: () => {
      toast.success("Contractor updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Contractor deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;
  const isDirty = Object.keys(form).some(
    (k) =>
      String((form as unknown as Record<string, unknown>)[k] ?? "") !==
      String((EMPTY_FORM as unknown as Record<string, unknown>)[k] ?? ""),
  );
  const canSave = form.LHeadName.trim() !== "";

  // ── CSV import/export state ─────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv(
      [],
      CONTRACTOR_CSV_TEMPLATE_COLUMNS,
      "contractor-master-template",
    );
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
          const contactPerson = (raw[CSV_HEADERS.contactPerson] || "").trim();
          const phone = (raw[CSV_HEADERS.phone] || "").trim();
          const email = (raw[CSV_HEADERS.email] || "").trim();
          const gst = (raw[CSV_HEADERS.gst] || "").trim();
          const pan = (raw[CSV_HEADERS.pan] || "").trim();
          const paymentTerms = (raw[CSV_HEADERS.paymentTerms] || "").trim();
          const address = (raw[CSV_HEADERS.address] || "").trim();
          const typeRaw = (raw[CSV_HEADERS.contractorType] || "").trim();
          const groupRaw = (raw[CSV_HEADERS.group] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!name) throw new Error("Contractor Name is required");

          // Contractor Type is optional — validated against the live category
          // list (Admin > Contractor Categories), not a hardcoded set, since
          // that list is admin-configurable.
          const contractorType = typeRaw
            ? contractorCategories.find(
                (c) => c.toLowerCase() === typeRaw.toLowerCase(),
              )
            : "";
          if (typeRaw && !contractorType)
            throw new Error(
              `Contractor Type must be one of ${contractorCategories.join(", ")} (got "${typeRaw}")`,
            );

          // Group Name is optional — resolved to the account group's ID by name.
          let groupId: number | "" = "";
          if (groupRaw) {
            const match = accountGroups.find(
              (g) => g.name.toLowerCase() === groupRaw.toLowerCase(),
            );
            if (!match) throw new Error(`Group not found: "${groupRaw}"`);
            groupId = Number(match._id);
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

          const rowForm: ContractorForm = {
            LHeadName: name,
            LHeadContactPerson: contactPerson,
            LHeadPhone: phone,
            LHeadEmail: email,
            LGST: gst,
            LHeadPan: pan,
            contractorType: contractorType || "",
            LHeadPaymentTerms: paymentTerms,
            LHeadAddress: address,
            LBelongsTo: groupId,
            LHeadStatus: isActive,
            isTdsApplicable: false,
            tdsLimitApplicable: true,
          };

          await addRecord(buildPayload(rowForm), CONTRACTOR_TYPE);
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
          `Imported ${successCount} contractor${successCount === 1 ? "" : "s"} ✓`,
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const startEdit = (c: Contractor) => {
    setEditingId(c.LHeadId);
    setForm({
      LHeadName: c.LHeadName ?? "",
      LHeadContactPerson: c.LHeadContactPerson ?? "",
      LHeadPhone: c.LHeadPhone ?? "",
      LHeadEmail: c.LHeadEmail ?? "",
      LGST: c.LGST ?? "",
      LHeadPan: c.LHeadPan ?? "",
      contractorType: c.contractorType ?? "",
      LHeadPaymentTerms: c.LHeadPaymentTerms ?? "",
      LHeadAddress: c.LHeadAddress ?? "",
      LBelongsTo: c.LBelongsTo ?? "",
      LHeadStatus: c.LHeadStatus,
      isTdsApplicable: c.isTdsApplicable,
      tdsLimitApplicable: c.tdsLimitApplicable,
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
    const e: Partial<Record<keyof ContractorForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
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

  const handlePrint = (c: Contractor) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(safeHtml`
      <html><head><title>Contractor — ${c.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Contractor Card</h2>
      <table>
        <tr><td>Contractor Name</td><td>${c.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${c.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${c.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${c.LHeadEmail || "—"}</td></tr>
        <tr><td>GST Number</td><td>${c.LGST || "—"}</td></tr>
        <tr><td>PAN Number</td><td>${c.LHeadPan || "—"}</td></tr>
        <tr><td>Contractor Type</td><td>${c.contractorType || "—"}</td></tr>
        <tr><td>Payment Terms</td><td>${c.LHeadPaymentTerms || "—"}</td></tr>
        <tr><td>Group</td><td>${c.LBelongsTo != null ? (accountGroups.find((g) => g._id === String(c.LBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${c.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${c.LHeadStatus ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = useMemo(
    () =>
      buildContractorColumns(
        editingId,
        deleteConfirm,
        setDeleteConfirm,
        startEdit,
        deleteMut,
        setViewRecord,
        handlePrint,
        rights.canEdit,
        rights.canDelete,
        rights.canPrint,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm, rights.canEdit, rights.canDelete, rights.canPrint],
  );

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = contractors.filter((c) => {
      const matchSearch =
        !q ||
        c.LHeadName?.toLowerCase().includes(q) ||
        (c.LHeadPhone ?? "").toLowerCase().includes(q) ||
        (c.LGST ?? "").toLowerCase().includes(q) ||
        (c.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchCat = !filterCategory || c.contractorType === filterCategory;
      const matchStatus =
        !filterStatus ||
        (filterStatus === "active" ? c.LHeadStatus : !c.LHeadStatus);
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
  }, [contractors, search, filterCategory, filterStatus, sortField, sortAsc]);

  // ── Shared field classes ───────────────────────────────────────────────────
  const inputCls =
    "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Contractor Master"]}
      />

      <FinanceShell
        title="Contractor Master"
        subtitle="Manage contractor accounts with contact, GST and type details"
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
              {contractors.length} Contractors
            </span>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            {rights.canCreate && (
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV with all contractor fields"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
            )}
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import contractors from a filled-in CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
            )}
          </div>
        }
      >
        {/* ── Form Card ── */}
        {(rights.canCreate || rights.canEdit) && <div
          className="rounded-xl overflow-hidden"
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
            className="flex items-center gap-3 px-5 sm:px-6 py-4 relative overflow-hidden"
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
                {editingId ? "Edit Contractor" : "Add Contractor"}
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
                  <HardHat size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Basic Information
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Contractor Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Contractor Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Buildmax Contractors Pvt. Ltd."
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
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Contractor Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Contractor Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.contractorType}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, contractorType: v }))
                    }
                    options={contractorCategories.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                    placeholder="Select type…"
                  />
                </div>

                {/* Account Group — always Sundry Creditors for contractors,
                    never picked manually (see accountHeadMaster.js's
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
                      placeholder="e.g. contact@buildmax.com"
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

            {/* ── Section: Tax & Payment ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <FileText size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Tax &amp; Payment Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* GST Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    GST Number
                  </label>
                  <input
                    value={form.LGST}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        LGST: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. 27AAPFU0939F1ZV"
                    maxLength={15}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                {/* PAN */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    PAN Number
                  </label>
                  <input
                    value={form.LHeadPan}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        LHeadPan: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. AAPFU0939F"
                    maxLength={10}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                {/* Payment Terms — sourced from Payment Term Master so the
                    invoice page can auto-fill by an exact text match */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Payment Terms
                  </label>
                  <div className="relative">
                    <CreditCard
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10"
                    />
                    <select
                      value={form.LHeadPaymentTerms}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadPaymentTerms: e.target.value,
                        }))
                      }
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
                    >
                      <option value="">— No payment term —</option>
                      {(paymentTermOptions ?? []).map((t) => (
                        <option key={t.id} value={t.label}>
                          {t.label} ({t.days} days)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Status toggle ── */}
            <div className="flex items-center gap-3 pt-1">
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
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/30 ${form.tdsLimitApplicable ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.tdsLimitApplicable ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                  TDS Limit (₹30k / ₹1L threshold) —{" "}
                  <span
                    className={
                      form.tdsLimitApplicable ? "text-amber-600" : "text-foreground"
                    }
                  >
                    {form.tdsLimitApplicable ? "Applied" : "Deduct on every bill"}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Card footer — actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20">
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
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
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
                    ? "Update Contractor"
                    : "Save Contractor"}
              </button>
            </div>
          </div>
        </div>}

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
              options={contractorCategories.map((c) => ({
                value: c,
                label: c,
              }))}
              placeholder="All Types"
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
                  ? "Failed to load contractors."
                  : contractors.length === 0
                    ? "No contractors yet."
                    : "No results match your search."
              }
              exportConfig={rights.canExport ? {
                title: "Contractor Master",
                filename: "contractor-master",
                columns: EXPORT_COLUMNS,
              } : undefined}
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
                  Contractor Details
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
                { label: "Contractor Name", value: viewRecord.LHeadName },
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
                {
                  label: "Contractor Type",
                  value: viewRecord.contractorType || "—",
                },
                {
                  label: "Payment Terms",
                  value: viewRecord.LHeadPaymentTerms || "—",
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
                { label: "TDS Applicable", value: viewRecord.isTdsApplicable ? "Yes" : "No" },
                { label: "TDS Limit", value: viewRecord.isTdsApplicable ? (viewRecord.tdsLimitApplicable ? "Applied" : "Deduct on every bill") : "—" },
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
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit Contractor
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ContractorMaster;
