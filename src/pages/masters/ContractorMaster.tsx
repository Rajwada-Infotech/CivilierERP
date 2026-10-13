import React, { useState, useMemo, useRef } from "react";
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
import { getContractorCategoryOptions } from "@/api/contractorCategoryApi";
import { getVendorPaymentTermOptions } from "@/api/vendorPaymentTermApi";
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
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTRACTOR_TYPE = "C";
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
  LGSTType: string | null;
  LGSTState: string | null;
  LHeadPan: string | null;
  contractorType: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
  GroupName: string | null;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
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


interface ContractorForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LGSTType: string;
  LGSTState: string;
  LHeadPan: string;
  contractorType: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LBelongsTo: number | "";
  LHeadStatus: boolean;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
  // Bank Details — all optional
  bankAccountNo: string;
  bankIfscCode: string;
  bankName: string;
  bankBranchCode: string;
}

const EMPTY_FORM: ContractorForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LGSTType: "",
  LGSTState: "",
  LHeadPan: "",
  contractorType: "",
  LHeadPaymentTerms: "",
  LHeadAddress: "",
  LBelongsTo: "",
  LHeadStatus: true,
  // Contractor payments almost always fall under Section 194C — default a
  // new contractor to TDS-applicable rather than making every contractor
  // opt in by hand. Still a normal toggle, so it can be switched off for
  // the rare contractor this doesn't apply to.
  isTdsApplicable: true,
  tdsLimitApplicable: true,
  bankAccountNo: "",
  bankIfscCode: "",
  bankName: "",
  bankBranchCode: "",
};

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Contractor Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GSTIN (GST Identification Number)", accessor: "LGST" },
  { header: "PAN (Permanent Account Number)", accessor: "LHeadPan" },
  { header: "Contractor Type", accessor: "contractorType" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  {
    header: "Group",
    accessor: (r) => (r.GroupName as string) || "—",
  },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
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
  name: "Contractor Name",
  contactPerson: "Contact Person",
  phone: "Phone",
  email: "Email",
  gst: "GSTIN (GST Identification Number)",
  pan: "PAN (Permanent Account Number)",
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
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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
      cell: ({ getValue, row }) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{getValue() as string}</p>
          {row.original.contractorType && <p className={`${LBL} mt-1`}>{row.original.contractorType}</p>}
        </div>
      ),
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
      header: "GSTIN (GST Identification Number)",
      cell: ({ getValue }) => <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "LHeadPaymentTerms",
      header: "Payment Terms",
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{(getValue() as string) || "—"}</span>,
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
        return (
          <div className="flex items-center justify-start gap-1 w-full min-w-[120px]">
            <button data-row-view onClick={() => onView(row.original)} className={ACT} title="View details" aria-label="View details">
              <Eye size={13} />
            </button>
            {canPrint && (
              <button onClick={() => onPrint(row.original)} className={ACT} title="Print" aria-label="Print">
                <Printer size={13} />
              </button>
            )}
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
const ContractorMaster: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("contractor-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useDraftForm<ContractorForm>("contractor-master", EMPTY_FORM, {
    skip: editingId !== null,
  });
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
      LGSTType: item.LGSTType || null,
      LGSTState: item.LGSTState || null,
      LHeadPan: item.LHeadPan || null,
      contractorType: item.LHeadCategory || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
      GroupName: item.GroupName ?? null,
      isTdsApplicable: Boolean(item.IsTdsApplicable),
      tdsLimitApplicable: item.TdsLimitApplicable == null ? true : Boolean(item.TdsLimitApplicable),
      bankAccountNo: item.LAccountNo || null,
      bankIfscCode: item.LIFSCCode || null,
      bankName: item.LBankName || null,
      bankBranchCode: item.LBranchCode || null,
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
    LGSTType: f.LGSTType || null,
    LHeadPan: f.LHeadPan || null,
    LHeadCategory: f.contractorType || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LGSTState: f.LGSTState || null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
    IsTdsApplicable: f.isTdsApplicable,
    TdsLimitApplicable: f.tdsLimitApplicable,
    LAccountNo: f.bankAccountNo || null,
    LIFSCCode: f.bankIfscCode || null,
    LBankName: f.bankName || null,
    LBranchCode: f.bankBranchCode || null,
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
            // CSV template has no GST Type column — infer the same way
            // normalizeGSTType() does elsewhere: a GST number on the row
            // implies Registered, otherwise Unregistered.
            LGSTType: gst.trim() ? "Registered" : "Unregistered",
            LGSTState: "",
            LHeadPan: pan,
            contractorType: contractorType || "",
            LHeadPaymentTerms: paymentTerms,
            LHeadAddress: address,
            LBelongsTo: groupId,
            LHeadStatus: isActive,
            isTdsApplicable: true,
            tdsLimitApplicable: true,
            // CSV template has no bank-details columns — always blank on import.
            bankAccountNo: "",
            bankIfscCode: "",
            bankName: "",
            bankBranchCode: "",
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
  /** Same inference SupplierMaster.tsx uses: a NULL LGSTType (row predates
   *  this field, or was created via the old contractor form with no GST
   *  Type selector) infers Registered/Unregistered from whether a GST
   *  number is on file, so editing writes back a real value immediately. */
  const normalizeGSTType = (t: string | null | undefined, lgst?: string | null): string => {
    if (t === "Unregistered") return "Unregistered";
    if (t) return "Registered";
    return lgst?.trim() ? "Registered" : "Unregistered";
  };

  const startEdit = (c: Contractor) => {
    setEditingId(c.LHeadId);
    setForm({
      LHeadName: c.LHeadName ?? "",
      LHeadContactPerson: c.LHeadContactPerson ?? "",
      LHeadPhone: c.LHeadPhone ?? "",
      LHeadEmail: c.LHeadEmail ?? "",
      LGST: c.LGST ?? "",
      LGSTType: normalizeGSTType(c.LGSTType, c.LGST),
      LGSTState: c.LGSTState ?? "",
      LHeadPan: c.LHeadPan ?? "",
      contractorType: c.contractorType ?? "",
      LHeadPaymentTerms: c.LHeadPaymentTerms ?? "",
      LHeadAddress: c.LHeadAddress ?? "",
      LBelongsTo: c.LBelongsTo ?? "",
      LHeadStatus: c.LHeadStatus,
      isTdsApplicable: c.isTdsApplicable,
      tdsLimitApplicable: c.tdsLimitApplicable,
      bankAccountNo: c.bankAccountNo ?? "",
      bankIfscCode: c.bankIfscCode ?? "",
      bankName: c.bankName ?? "",
      bankBranchCode: c.bankBranchCode ?? "",
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
    if (!form.LGSTType) e.LGSTType = true;
    if (form.LGSTType === "Registered" && !form.LGST.trim()) e.LGST = true;
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
        <tr><td>GST Type</td><td>${c.LGSTType || "—"}</td></tr>
        <tr><td>GSTIN (GST Identification Number)</td><td>${c.LGST || "—"}</td></tr>
        <tr><td>GST State</td><td>${c.LGSTState || "—"}</td></tr>
        <tr><td>PAN (Permanent Account Number)</td><td>${c.LHeadPan || "—"}</td></tr>
        <tr><td>Contractor Type</td><td>${c.contractorType || "—"}</td></tr>
        <tr><td>Payment Terms</td><td>${c.LHeadPaymentTerms || "—"}</td></tr>
        <tr><td>Group</td><td>${c.LBelongsTo != null ? (accountGroups.find((g) => g._id === String(c.LBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${c.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${c.LHeadStatus ? "Active" : "Inactive"}</td></tr>
        <tr><td>Bank Account Number</td><td>${c.bankAccountNo || "—"}</td></tr>
        <tr><td>Bank Name</td><td>${c.bankName || "—"}</td></tr>
        <tr><td>Bank Branch Location</td><td>${c.bankBranchCode || "—"}</td></tr>
        <tr><td>IFSC Code</td><td>${c.bankIfscCode || "—"}</td></tr>
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
    "w-full text-sm border border-foreground/40 focus:border-foreground px-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Contractor Master"]}
      />

      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Contractors"
        subtitle="The contractors the business engages: their contact, tax, payment and bank particulars."
        action={
          <div className="flex items-center gap-2 flex-wrap">
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
                className={`${KEY} px-3 py-2 border border-foreground text-foreground hover:bg-primary/10`}
              >
                <Download size={13} />
                <span className="hidden sm:inline">Template</span>
              </button>
            )}
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import contractors from a filled-in CSV"
                className={`${KEY} px-3 py-2 border border-foreground bg-foreground text-card`}
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
              </button>
            )}
          </div>
        }
      >
        {/* ── Figures ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Contractors", value: contractors.length, note: "in all" },
              { label: "Active", value: contractors.filter((c) => c.LHeadStatus).length, note: "open for work orders" },
              { label: "GST registered", value: contractors.filter((c) => c.LGSTType === "Registered").length, note: "raise GST bills" },
              { label: "TDS applicable", value: contractors.filter((c) => c.isTdsApplicable).length, note: "tax deducted at source" },
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
        {(rights.canCreate || rights.canEdit) && <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
            <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
              {editingId ? "Edit contractor" : "Add contractor"}
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
                {/* Contractor Name */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
                    Contractor Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Buildmax Contractors Pvt. Ltd."
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
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Contractor Type */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
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
                      placeholder="e.g. contact@buildmax.com"
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

            {/* ── Section: Tax & Payment ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Tax &amp; Payment Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-5">
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
                      setErrors((p) => ({ ...p, LGSTType: false, LGST: false }));
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

                {/* PAN */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
                    PAN (Permanent Account Number)
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
                    className={`${inputCls} font-heading tabular-nums`}
                  />
                </div>

                {/* Payment Terms — sourced from Payment Term Master so the
                    invoice page can auto-fill by an exact text match */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
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
                      className="w-full text-sm border border-foreground/40 focus:border-foreground pl-8 pr-3 py-2.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
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

            {/* ── Status toggle ── */}
            <div className="flex items-center gap-3 pt-1">
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
                {saving ? "Saving…" : editingId ? "Update contractor" : "Save contractor"}
              </button>
            </div>
          </div>
        </div>}

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
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contractors · CSV import</p>
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
                <p className={LBL}>Contractor{viewRecord.contractorType ? ` · ${viewRecord.contractorType}` : ""}</p>
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
                { label: "GST Type", value: viewRecord.LGSTType || "—" },
                {
                  label: "GSTIN (GST Identification Number)",
                  value: viewRecord.LGST || "—",
                  mono: true,
                },
                { label: "GST State", value: viewRecord.LGSTState || "—" },
                {
                  label: "PAN (Permanent Account Number)",
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

export default ContractorMaster;
