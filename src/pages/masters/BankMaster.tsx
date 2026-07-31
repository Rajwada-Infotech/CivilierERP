import React, { useState, useMemo, useRef, useEffect } from "react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  Landmark,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Hash,
  Building2,
  MapPin,
  CreditCard,
  IndianRupee,
  Eye,
  Printer,
  Search,
  AlertCircle,
  XCircle,
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

import {
  getBanks,
  addBank,
  updateBank,
  deleteBank,
  getCompanyOptions,
  type BankRecord,
  type CompanyOption,
} from "@/api/bankMasterApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

import { getAccountGroups } from "@/api/accountApi";
import { usePageRights } from "@/hooks/usePageRights";

import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";

// ─── Types ───────────────────────────────────────────────────────────────────
interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

// ─── Zod Schema ─────────────────────────────────────────────────────────────
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const bankFormSchema = z.object({
  companyName: z.string(),
  bankName: z.string().trim().min(1, "Bank name is required"),
  branch: z.string(),
  accountNo: z.string().trim().min(1, "Account number is required"),
  ifsc: z
    .string()
    .trim()
    .min(1, "IFSC code is required")
    .transform((value) => value.toUpperCase())
    .refine((value) => IFSC_REGEX.test(value), {
      message:
        "Invalid format - must be 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)",
    }),
  accountType: z.string(),
  bankType: z.string(),
  holderName: z.string(),
  openingBalance: z
    .string()
    .refine(
      (value) =>
        value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0),
      "Opening balance must be 0 or greater",
    ),
  address: z.string(),
  groupId: z.number().nullable(),
  status: z.boolean(),
  accountGroupId: z.string(),
});

type FormState = z.infer<typeof bankFormSchema>;

// ─── Default Values ─────────────────────────────────────────────────────────
const EMPTY: FormState = {
  companyName: "",
  bankName: "",
  branch: "",
  accountNo: "",
  ifsc: "",
  accountType: "",
  bankType: "",
  holderName: "",
  openingBalance: "",
  address: "",
  groupId: null,
  status: true,
  accountGroupId: "",
};

// ─── Export Columns ─────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Company", accessor: "companyName" },
  { header: "Bank Name", accessor: "bankName" },
  { header: "Branch", accessor: "branch" },
  { header: "Account No", accessor: "accountNo" },
  { header: "IFSC", accessor: "ifsc" },
  { header: "Account Type", accessor: "accountType" },
  { header: "Bank Type", accessor: "bankType" },
  { header: "Holder Name", accessor: "holderName" },
  { header: "Opening Balance", accessor: "openingBalance" },
  {
    header: "Group",
    accessor: (r) => (r.BLBelongsTo != null ? String(r.BLBelongsTo) : "—"),
  },
  { header: "Address", accessor: "address" },
  { header: "Status", accessor: (r) => (r.BActive ? "Active" : "Inactive") },
];

// ─── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  company: "Company Name",
  bankName: "Bank Name",
  branch: "Branch",
  accountNo: "Account Number",
  ifsc: "IFSC Code",
  accountType: "Account Type",
  bankType: "Bank Type",
  holderName: "Account Holder Name",
  openingBalance: "Opening Balance",
  group: "Group Name",
  address: "Address",
  status: "Status (Active/Inactive)",
} as const;

const BANK_CSV_TEMPLATE_COLUMNS: CsvExportColumn[] = [
  { header: CSV_HEADERS.company, accessor: "companyName" },
  { header: CSV_HEADERS.bankName, accessor: "bankName" },
  { header: CSV_HEADERS.branch, accessor: "branch" },
  { header: CSV_HEADERS.accountNo, accessor: "accountNo" },
  { header: CSV_HEADERS.ifsc, accessor: "ifsc" },
  { header: CSV_HEADERS.accountType, accessor: "accountType" },
  { header: CSV_HEADERS.bankType, accessor: "bankType" },
  { header: CSV_HEADERS.holderName, accessor: "holderName" },
  { header: CSV_HEADERS.openingBalance, accessor: "openingBalance" },
  { header: CSV_HEADERS.group, accessor: "groupName" },
  { header: CSV_HEADERS.address, accessor: "address" },
  { header: CSV_HEADERS.status, accessor: "status" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// Company -> Project source for the Tag Project(s) picker below — same
// shared dropdown endpoint CrmApplication.tsx/CrmPaymentPlans.tsx already
// use for their own Company -> Project chains.
async function fetchCompanyProjectDropdown(): Promise<{
  companies: { id: number; name: string }[];
  projects: { id: number; name: string; company_id: number }[];
}> {
  try {
    const r = await fetchWithAuth("/api/business/dropdown");
    return r.ok ? r.json() : { companies: [], projects: [] };
  } catch {
    return { companies: [], projects: [] };
  }
}
const ACCOUNT_TYPES = ["Current", "Savings", "Overdraft (OD)", "Cash Credit"];
const BANK_TYPES = [
  "Nationalized",
  "Private",
  "Co-operative",
  "Foreign",
  "Regional Rural",
];

// ─── Shared input class (ContractorMaster style) ─────────────────────────────
const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
// ─── Bank Type Badges ───────────────────────────────────────────────────────
const bankTypeBadge: Record<string, string> = {
  Nationalized: "bg-blue-500/10 border-blue-500/20 text-blue-600",
  Private: "bg-violet-500/10 border-violet-500/20 text-violet-600",
  "Co-operative": "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Foreign: "bg-cyan-500/10 border-cyan-500/20 text-cyan-600",
  "Regional Rural": "bg-green-500/10 border-green-500/20 text-green-600",
};

// ─── Column Builder ─────────────────────────────────────────────────────────
function buildColumns(
  _editingId: string | null,
  deleteId: string | null,
  onEdit: (bank: BankRecord) => void,
  onDeleteRequest: (id: string) => void,
  onDeleteConfirm: (id: string) => void,
  onDeleteCancel: () => void,
  onView: (bank: BankRecord) => void,
  onPrint: (bank: BankRecord) => void,
  canEdit: boolean,
  canDelete: boolean,
  canPrint: boolean,
): ColumnDef<BankRecord, unknown>[] {
  return [
    {
      id: "company",
      accessorKey: "BCompanyName",
      header: "Company",
      cell: ({ getValue }) => (
        <span className="text-foreground font-body text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "bankName",
      accessorKey: "BName",
      header: "Bank Name",
      cell: ({ getValue }) => (
        <span className="font-heading font-medium text-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "branch",
      accessorKey: "BBranch",
      header: "Branch",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "accountNo",
      accessorKey: "BAccountNumber",
      header: "Account No.",
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "ifsc",
      accessorKey: "BIfscCode",
      header: "IFSC",
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded tracking-widest">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "bankType",
      accessorKey: "BBankType",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v) return <span className="text-muted-foreground">—</span>;
        const cls =
          bankTypeBadge[v] ?? "bg-muted border-border text-muted-foreground";
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${cls}`}
          >
            {v}
          </span>
        );
      },
    },
    {
      id: "openingBalance",
      accessorKey: "BOpeningBalance",
      header: "Opening Bal.",
      cell: ({ getValue }) => (
        <span className="font-mono text-foreground">
          ₹ {Number(getValue() || 0).toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "BStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const active = Boolean(getValue());
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              active
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-muted text-muted-foreground"
            }`}
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
      cell: ({ row }) => {
        const bank = row.original;
        const id = String(bank.BId);
        return (
          <div className="flex items-center justify-start gap-2 w-full min-w-[120px]">
            {deleteId === id ? (
              <>
                <span className="text-[11px] text-muted-foreground mr-1">
                  Confirm?
                </span>
                <button
                  onClick={() => onDeleteConfirm(id)}
                  className="p-1 rounded text-destructive hover:bg-destructive/10"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={onDeleteCancel}
                  className="p-1 rounded text-muted-foreground hover:bg-muted"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onView(bank)}
                  className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
                  title="View details"
                >
                  <Eye size={15} />
                </button>
                {canPrint && (
                  <button
                    onClick={() => onPrint(bank)}
                    className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                    title="Print"
                  >
                    <Printer size={15} />
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => onEdit(bank)}
                    className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={15} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => onDeleteRequest(id)}
                    className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Main Component ─────────────────────────────────────────────────────────
const BankMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const rights = usePageRights("bank-master");

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["bank-master"],
    queryFn: getBanks,
    staleTime: 5 * 60 * 1000,
  });

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["enterprise-options"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  // Project tagging — optional, not-mandatory (see the "Tag Project(s)"
  // section of the form below). Reuses the same Company -> Project dropdown
  // source as CrmApplication.tsx/CrmPaymentPlans.tsx; `projects` here is
  // keyed by `company_id` matching the `companies` list above (both trace
  // back to dbo.enterprise), so no second Company fetch is needed.
  const { data: projectDropdown } = useQuery({
    queryKey: ["business-dropdown"],
    queryFn: fetchCompanyProjectDropdown,
    staleTime: 5 * 60 * 1000,
  });
  const projects = projectDropdown?.projects ?? [];
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [tagProjectId, setTagProjectId] = useState("");
  const companiesById = useMemo(() => new Map(companies.map((c) => [String(c.id), c])), [companies]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);

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

  const dbBanks: BankRecord[] = Array.isArray(dbData) ? dbData : [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isValid, isDirty },
  } = useForm<FormState>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: EMPTY,
    mode: "onChange",
  });

  const form = watch();
  // Company now lives ONLY inside Tag Project(s), right above the Project
  // picker — one field doing double duty: it's still the bank's own
  // Company (form.companyName, saved as BCompanyName), and it narrows the
  // Project list right below it. It's a convenience filter, not a hard
  // rule: real banks are routinely tagged to Projects under a DIFFERENT
  // Company than their own (e.g. a shared group account funding a
  // subsidiary's project), and Company itself is optional on a bank — so
  // with no Company picked yet, every Project stays offered rather than
  // blocking tagging outright.
  // `companies` matches by label since that's all form.companyName (a
  // TreeDropdown value) actually stores.
  const selectedCompany = useMemo(
    () => companies.find((c) => c.label === form.companyName) || null,
    [companies, form.companyName],
  );
  const projectsForTagCompany = useMemo(
    () => projects.filter((p) =>
      (!selectedCompany || String(p.company_id) === String(selectedCompany.id)) && !projectIds.includes(String(p.id)),
    ),
    [projects, selectedCompany, projectIds],
  );
  const selectedTaggedProjects = useMemo(
    () => projectIds
      .map((id) => {
        const p = projectsById.get(id);
        if (!p) return null;
        const company = companiesById.get(String(p.company_id));
        return { id, name: p.name, companyName: company?.label ?? "" };
      })
      .filter((x): x is { id: string; name: string; companyName: string } => x !== null),
    [projectIds, projectsById, companiesById],
  );
  const handleAddTaggedProject = () => {
    if (!tagProjectId) return;
    setProjectIds((prev) => (prev.includes(tagProjectId) ? prev : [...prev, tagProjectId]));
    setTagProjectId("");
  };
  // Changing the Company clears an in-progress "Add" pick ONLY if that pick
  // no longer belongs to the new Company — a project half-picked under the
  // OLD Company shouldn't silently carry over once it no longer matches.
  // This must stay one-directional, not a blind "Company changed -> clear
  // Project": picking a Project directly auto-fills Company to match it
  // (see the Project <select>'s onChange below), and that fill-in is itself
  // a Company change — clearing tagProjectId unconditionally here would
  // immediately undo the very pick that caused it. Must also never touch
  // already-tagged projectIds — real production banks are routinely tagged
  // to Projects under a DIFFERENT Company than the bank's own Company field
  // (e.g. a shared group account funding a subsidiary's project), so
  // existing tags are never assumed to match Company.
  useEffect(() => {
    setTagProjectId((prev) => {
      if (!prev || !selectedCompany) return prev;
      const p = projectsById.get(prev);
      return p && String(p.company_id) === String(selectedCompany.id) ? prev : "";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  const canSave = isValid;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<BankRecord | null>(null);

  // ─── Table filter / pagination state ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterBankType, setFilterBankType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // ─── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dbBanks.filter((b) => {
      const matchSearch =
        !q ||
        (b.BName ?? "").toLowerCase().includes(q) ||
        (b.BBranch ?? "").toLowerCase().includes(q) ||
        (b.BAccountNumber ?? "").toLowerCase().includes(q) ||
        (b.BIfscCode ?? "").toLowerCase().includes(q) ||
        (b.BCompanyName ?? "").toLowerCase().includes(q);
      const matchType = !filterBankType || b.BBankType === filterBankType;
      const matchStatus =
        !filterStatus || (filterStatus === "active" ? b.BStatus : !b.BStatus);
      return matchSearch && matchType && matchStatus;
    });
  }, [dbBanks, search, filterBankType, filterStatus]);

  const toPayload = (f: FormState) => ({
    BName: f.bankName.trim() || null,
    BBranch: f.branch.trim() || null,
    BAccountNumber: f.accountNo.trim() || null,
    BIfscCode: f.ifsc.trim().toUpperCase() || null,
    BAccountType: f.accountType || null,
    BBankType: f.bankType || null,
    BAccountHolderName: f.holderName.trim() || null,
    BOpeningBalance: f.openingBalance !== "" ? Number(f.openingBalance) : 0,
    BAddress: f.address.trim() || null,
    BStatus: f.status,
    BCompanyName: f.companyName.trim() || null,
    LBelongsTo: f.accountGroupId ? Number(f.accountGroupId) : null,
  });

  const handleSave = async (values: FormState) => {
    try {
      const payload = { ...toPayload(values), ProjectIds: projectIds.map((x) => parseInt(x, 10)) };
      if (editingId) {
        await updateBank(editingId, payload);
        toast.success("Bank updated successfully!");
      } else {
        await addBank(payload);
        toast.success("Bank added successfully!");
      }
      await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      reset(EMPTY);
      setEditingId(null);
      setProjectIds([]);
    } catch (err: any) {
      toast.error("Failed: " + (err.message || "Unknown error"));
    }
  };

  const handleEdit = (item: BankRecord) => {
    reset({
      companyName: item.BCompanyName || "",
      bankName: item.BName || "",
      branch: item.BBranch || "",
      accountNo: item.BAccountNumber || "",
      ifsc: item.BIfscCode || "",
      accountType: item.BAccountType || "",
      bankType: item.BBankType || "",
      holderName: item.BAccountHolderName || "",
      openingBalance:
        item.BOpeningBalance != null ? String(item.BOpeningBalance) : "",
      address: item.BAddress || "",
      groupId: item.BLBelongsTo ?? null,
      status: Boolean(item.BStatus),
      accountGroupId:
        (item as any).LBelongsTo != null
          ? String((item as any).LBelongsTo)
          : "",
    });
    setEditingId(String(item.BId));
    // Tagged Projects already come back with the bank list itself
    // (bankMaster.js's GET / OUTER APPLYs CrmProjectBank) — no extra fetch.
    setProjectIds(item.ProjectIds ? String(item.ProjectIds).split(",") : []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBank(id);
      toast.success("Bank deleted successfully!");
      await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      setDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
        reset(EMPTY);
        setProjectIds([]);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  const handleReset = () => {
    reset(EMPTY);
    setEditingId(null);
    setProjectIds([]);
  };

  // ── CSV import/export state ─────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv([], BANK_CSV_TEMPLATE_COLUMNS, "bank-master-template");
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
        const nameForLog = raw[CSV_HEADERS.bankName] || "(blank)";

        try {
          const companyRaw = (raw[CSV_HEADERS.company] || "").trim();
          const bankName = (raw[CSV_HEADERS.bankName] || "").trim();
          const branch = (raw[CSV_HEADERS.branch] || "").trim();
          const accountNo = (raw[CSV_HEADERS.accountNo] || "").trim();
          const ifscRaw = (raw[CSV_HEADERS.ifsc] || "").trim().toUpperCase();
          const accountTypeRaw = (raw[CSV_HEADERS.accountType] || "").trim();
          const bankTypeRaw = (raw[CSV_HEADERS.bankType] || "").trim();
          const holderName = (raw[CSV_HEADERS.holderName] || "").trim();
          const openingBalanceRaw = (
            raw[CSV_HEADERS.openingBalance] || ""
          ).trim();
          const groupRaw = (raw[CSV_HEADERS.group] || "").trim();
          const address = (raw[CSV_HEADERS.address] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!bankName) throw new Error("Bank Name is required");
          if (!accountNo) throw new Error("Account Number is required");
          if (!ifscRaw) throw new Error("IFSC Code is required");
          if (!IFSC_REGEX.test(ifscRaw))
            throw new Error(
              `Invalid IFSC format — must be 4 letters + 0 + 6 alphanumeric (got "${ifscRaw}")`,
            );

          // Company Name is optional — when given, must match a known company
          // (mirrors the form's dropdown, which only offers existing companies).
          const companyMatch = companyRaw
            ? companies.find(
                (c) => c.label.toLowerCase() === companyRaw.toLowerCase(),
              )
            : null;
          if (companyRaw && !companyMatch)
            throw new Error(`Company not found: "${companyRaw}"`);

          // Account Type is optional — validate against the known list when given.
          const accountType = accountTypeRaw
            ? ACCOUNT_TYPES.find(
                (t) => t.toLowerCase() === accountTypeRaw.toLowerCase(),
              )
            : "";
          if (accountTypeRaw && !accountType)
            throw new Error(
              `Account Type must be one of ${ACCOUNT_TYPES.join(", ")} (got "${accountTypeRaw}")`,
            );

          // Bank Type is optional — validate against the known list when given.
          const bankType = bankTypeRaw
            ? BANK_TYPES.find(
                (t) => t.toLowerCase() === bankTypeRaw.toLowerCase(),
              )
            : "";
          if (bankTypeRaw && !bankType)
            throw new Error(
              `Bank Type must be one of ${BANK_TYPES.join(", ")} (got "${bankTypeRaw}")`,
            );

          // Opening Balance defaults to 0 when blank; must be a number ≥ 0 otherwise.
          let openingBalance = "0";
          if (openingBalanceRaw !== "") {
            const n = Number(openingBalanceRaw);
            if (Number.isNaN(n) || n < 0)
              throw new Error(
                `Opening Balance must be 0 or greater (got "${openingBalanceRaw}")`,
              );
            openingBalance = String(n);
          }

          // Group Name is optional — resolved to the account group's ID by name.
          let groupId = "";
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

          const rowForm: FormState = {
            companyName: companyMatch ? companyMatch.label : "",
            bankName,
            branch,
            accountNo,
            ifsc: ifscRaw,
            accountType: accountType || "",
            bankType: bankType || "",
            holderName,
            openingBalance,
            address,
            groupId: groupId ? Number(groupId) : null,
            status: isActive,
            accountGroupId: groupId,
          };

          await addBank(toPayload(rowForm));
          results.push({ row: rowNum, name: bankName, status: "success" });
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
        await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} bank${successCount === 1 ? "" : "s"} ✓`,
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

  const handlePrint = (bank: BankRecord) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(safeHtml`
      <html><head><title>Bank — ${bank.BName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Bank Details</h2>
      <table>
        <tr><td>Company</td><td>${bank.BCompanyName || "—"}</td></tr>
        <tr><td>Bank Name</td><td>${bank.BName || "—"}</td></tr>
        <tr><td>Branch</td><td>${bank.BBranch || "—"}</td></tr>
        <tr><td>Account Number</td><td>${bank.BAccountNumber || "—"}</td></tr>
        <tr><td>IFSC Code</td><td>${bank.BIfscCode || "—"}</td></tr>
        <tr><td>Account Type</td><td>${bank.BAccountType || "—"}</td></tr>
        <tr><td>Bank Type</td><td>${bank.BBankType || "—"}</td></tr>
        <tr><td>Account Holder</td><td>${bank.BAccountHolderName || "—"}</td></tr>
        <tr><td>Opening Balance</td><td>₹ ${Number(bank.BOpeningBalance || 0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Group</td><td>${bank.BLBelongsTo != null ? (accountGroups.find((g) => g._id === String(bank.BLBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${bank.BAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${bank.BStatus ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const columns = useMemo(
    () =>
      buildColumns(
        editingId,
        deleteId,
        handleEdit,
        setDeleteId,
        handleDelete,
        () => setDeleteId(null),
        setViewRow,
        handlePrint,
        rights.canEdit,
        rights.canDelete,
        rights.canPrint,
      ),
    [editingId, deleteId, rights.canEdit, rights.canDelete, rights.canPrint],
  );

  if (error)
    return <div className="p-6 text-red-500">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />

      <FinanceShell
        title="Bank Master"
        subtitle="Manage bank accounts with branch, IFSC and balance details"
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
              {dbBanks.length} Banks
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
                title="Download a blank CSV with all bank fields"
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
                title="Import banks from a filled-in CSV"
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
                {editingId ? "Edit Bank" : "Add Bank"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are
                required
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            {/* ── Section: Basic Information ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Landmark size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Basic Information
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Bank Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Bank Name <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <Landmark
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      {...register("bankName")}
                      placeholder="e.g. State Bank of India"
                      className={`${inputCls} pl-8 ${errors.bankName ? "border-red-400" : ""}`}
                    />
                  </div>
                  {errors.bankName && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {errors.bankName.message}
                    </p>
                  )}
                </div>

                {/* Branch */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    {...register("branch")}
                    placeholder="e.g. Park Street Branch"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* ── Section: Account Details ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <CreditCard size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Account Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Account Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Account Number <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <Hash
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      {...register("accountNo")}
                      placeholder="Bank account number"
                      className={`${inputCls} pl-8 font-mono tracking-widest ${errors.accountNo ? "border-red-400" : ""}`}
                    />
                  </div>
                  {errors.accountNo && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {errors.accountNo.message}
                    </p>
                  )}
                </div>

                {/* IFSC Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    IFSC Code <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <Hash
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      {...register("ifsc")}
                      value={form.ifsc}
                      onChange={(e) =>
                        setValue(
                          "ifsc",
                          e.target.value.toUpperCase().slice(0, 11),
                          { shouldValidate: true },
                        )
                      }
                      placeholder="e.g. SBIN0001234"
                      maxLength={11}
                      className={`${inputCls} pl-8 font-mono tracking-widest uppercase ${errors.ifsc ? "border-red-400" : ""}`}
                    />
                    {form.ifsc.length === 11 && IFSC_REGEX.test(form.ifsc) && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded">
                        ✓
                      </span>
                    )}
                  </div>
                  {errors.ifsc && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {errors.ifsc.message}
                    </p>
                  )}
                </div>

                {/* Account Holder Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Holder Name
                  </label>
                  <div className="relative">
                    <CreditCard
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      {...register("holderName")}
                      placeholder="Name on account"
                      className={`${inputCls} pl-8`}
                    />
                  </div>
                </div>

                {/* Account Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.accountType}
                    onChange={(v) =>
                      setValue("accountType", v, { shouldValidate: true })
                    }
                    options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))}
                    placeholder="Select Account Type…"
                  />
                </div>

                {/* Bank Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Bank Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.bankType}
                    onChange={(v) =>
                      setValue("bankType", v, { shouldValidate: true })
                    }
                    options={BANK_TYPES.map((t) => ({ value: t, label: t }))}
                    placeholder="Select Bank Type…"
                  />
                </div>

                {/* Account Group — always Banks (Assets > Current Assets >
                    Banks), never picked manually (see bankMaster.js's
                    getBanksGroupId, applied server-side on every
                    create/update regardless of what's sent here). */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Group
                  </label>
                  <div className="h-9 px-3 flex items-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
                    Banks
                  </div>
                </div>

                {/* Opening Balance */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Opening Balance (₹)
                  </label>
                  <div className="relative">
                    <IndianRupee
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      {...register("openingBalance")}
                      placeholder="0.00"
                      className={`${inputCls} pl-8 font-mono ${errors.openingBalance ? "border-red-400" : ""}`}
                    />
                  </div>
                  {errors.openingBalance && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {errors.openingBalance.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Section: Address ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <MapPin size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Address
                </p>
              </div>
              <div className="relative">
                <MapPin
                  size={13}
                  className="absolute left-3 top-3 text-muted-foreground pointer-events-none"
                />
                <textarea
                  rows={2}
                  {...register("address")}
                  placeholder="Branch address..."
                  className={`${inputCls} pl-8 resize-none`}
                />
              </div>
            </div>

            {/* ── Section: Tag Project(s) ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Building2 size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Tag Project(s)
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Optional — leave empty and this bank stays in the shared pool every untagged Project draws from.
                Tag it to one or more Projects and it becomes the ONLY bank offered for those Projects' work — it
                disappears from every other Project's bank selection, including ones with no tags of their own.
                {" "}Pick a Company to narrow the Project list, or just pick a Project directly and its Company
                fills in on its own — either way works, and a bank can still keep (or be tagged to) Projects
                under a different Company than the one shown here.
              </p>

              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Company</label>
                  <TreeDropdown
                    variant="flat"
                    value={form.companyName}
                    onChange={(v) => setValue("companyName", v, { shouldValidate: true })}
                    options={companies.map((c) => ({ value: c.label, label: c.label }))}
                    placeholder="Select Company… (optional)"
                    icon={<Building2 size={13} />}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Project</label>
                    <select
                      value={tagProjectId}
                      onChange={(e) => {
                        const projectId = e.target.value;
                        setTagProjectId(projectId);
                        // Picking a Project directly (without choosing a
                        // Company first) fills the Company in on its own,
                        // instead of leaving it blank/mismatched — same
                        // reasoning as why this field moved down here next
                        // to Project in the first place.
                        const picked = projectId ? projectsById.get(projectId) : null;
                        if (picked) {
                          const company = companiesById.get(String(picked.company_id));
                          if (company && company.label !== form.companyName) {
                            setValue("companyName", company.label, { shouldValidate: true });
                          }
                        }
                      }}
                      className={inputCls}
                    >
                      <option value="">
                        {projectsForTagCompany.length === 0 ? "All projects already tagged" : "Select project"}
                      </option>
                      {projectsForTagCompany.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddTaggedProject}
                    disabled={!tagProjectId}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed h-[34px]"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>

              {selectedTaggedProjects.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedTaggedProjects.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-heading bg-primary/10 text-foreground border border-primary/30"
                    >
                      <span>
                        {p.name}
                        {p.companyName && <span className="text-muted-foreground font-normal"> — {p.companyName}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setProjectIds((prev) => prev.filter((x) => x !== p.id))}
                        title={`Remove ${p.name}`}
                        className="p-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Status Toggle ── */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setValue("status", !form.status)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  form.status ? "bg-emerald-500" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    form.status ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                Status —{" "}
                <span
                  className={
                    form.status ? "text-emerald-600" : "text-foreground"
                  }
                >
                  {form.status ? "Active" : "Inactive"}
                </span>
              </span>
            </div>
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
                type="button"
                onClick={handleReset}
                disabled={!isDirty && !editingId}
                className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                type="button"
                onClick={handleSubmit(handleSave)}
                disabled={!canSave}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {editingId ? <Check size={14} /> : <Plus size={14} />}
                {editingId ? "Update Bank" : "Save Bank"}
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
                placeholder="Search name, account, IFSC…"
                className="w-full sm:w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>

            <TreeDropdown
              variant="flat"
              value={filterBankType}
              onChange={(v) => setFilterBankType(v)}
              options={BANK_TYPES.map((t) => ({ value: t, label: t }))}
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

            {(search || filterBankType || filterStatus) && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilterBankType("");
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
              key={`${search}-${filterBankType}-${filterStatus}`}
              data={filtered}
              columns={columns}
              loading={isLoading}
              searchable={false}
              emptyMessage="No banks yet. Add one above."
              exportConfig={rights.canExport ? {
                title: "Bank Master",
                filename: "bank-master",
                columns: EXPORT_COLUMNS,
              } : undefined}
              rowClassName={(row) =>
                editingId === String(row.original.BId) ? "bg-primary/5" : ""
              }
            />
          </div>
        </div>
      </FinanceShell>

      {/* ── Import Results Modal ── */}
      {importResults && (
        <Dialog
          open={!!importResults}
          onOpenChange={() => setImportResults(null)}
        >
          <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Import Results
              </DialogTitle>
            </DialogHeader>
            <div className="flex gap-3 text-sm mb-2">
              <span className="text-emerald-600 font-medium">
                ✓ {importResults.filter((r) => r.status === "success").length}{" "}
                imported
              </span>
              <span className="text-destructive font-medium">
                ✗ {importResults.filter((r) => r.status === "error").length}{" "}
                failed
              </span>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
              {importResults.map((r) => (
                <div
                  key={r.row}
                  className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs ${
                    r.status === "success"
                      ? "bg-emerald-500/8 text-emerald-700"
                      : "bg-destructive/8 text-destructive"
                  }`}
                >
                  <span className="font-mono shrink-0 text-muted-foreground">
                    Row {r.row}
                  </span>
                  <span className="font-medium shrink-0">{r.name}</span>
                  {r.status === "success" ? (
                    <span className="ml-auto text-emerald-600">✓</span>
                  ) : (
                    <span className="ml-2 text-destructive/80">
                      {r.message}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-3 flex justify-end">
              <button
                onClick={() => setImportResults(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── View Detail Drawer ── */}
      {viewRow && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRow(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Landmark size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Bank Details
                </h3>
              </div>
              <button
                onClick={() => setViewRow(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                { label: "Company", value: viewRow.BCompanyName },
                { label: "Bank Name", value: viewRow.BName },
                { label: "Branch", value: viewRow.BBranch },
                {
                  label: "Account Number",
                  value: viewRow.BAccountNumber,
                  mono: true,
                },
                { label: "IFSC Code", value: viewRow.BIfscCode, mono: true },
                { label: "Account Type", value: viewRow.BAccountType },
                { label: "Bank Type", value: viewRow.BBankType },
                { label: "Account Holder", value: viewRow.BAccountHolderName },
                {
                  label: "Opening Balance",
                  value: `₹ ${Number(viewRow.BOpeningBalance || 0).toLocaleString("en-IN")}`,
                  mono: true,
                },
                { label: "Address", value: viewRow.BAddress },
                {
                  label: "Group Name",
                  value:
                    viewRow.BLBelongsTo != null
                      ? (accountGroups.find(
                          (g) => g._id === String(viewRow.BLBelongsTo),
                        )?.name ?? "—")
                      : "—",
                },
                {
                  label: "Tagged Project(s)",
                  value: viewRow.ProjectNames || "Not tagged — available to every untagged Project",
                },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    {label}
                  </p>
                  <p
                    className={`text-sm text-foreground ${mono ? "font-mono font-semibold text-primary" : ""}`}
                  >
                    {value || "—"}
                  </p>
                </div>
              ))}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Status
                </p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${viewRow.BStatus ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {viewRow.BStatus ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-muted/20">
              <button
                onClick={() => handlePrint(viewRow)}
                className="px-3 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <Printer size={13} /> Print
              </button>
              <button
                onClick={() => setViewRow(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleEdit(viewRow);
                  setViewRow(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm flex items-center gap-1.5"
              >
                <Edit2 size={13} /> Edit Bank
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BankMaster;
