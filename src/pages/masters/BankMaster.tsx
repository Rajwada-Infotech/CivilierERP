import React, { useState, useMemo, useRef, useEffect } from "react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
import { useDraftFormSync, preventEnterSubmit } from "@/hooks/useDraftForm";

import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import { BodyPortal } from "@/components/ui/body-portal";

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
// Group is built per-render (see buildExportColumns below) — it needs to
// resolve BLBelongsTo (an AccountGroup id) to its name via the accountGroups
// list, which only exists inside the component.
function buildExportColumns(accountGroups: AccountGroup[]): ExportColumn[] {
  const groupName = (id: unknown) =>
    id != null ? (accountGroups.find((g) => g._id === String(id))?.name ?? "—") : "—";
  return [
    { header: "Company", accessor: "BCompanyName" },
    { header: "Bank Name", accessor: "BName" },
    { header: "Branch", accessor: "BBranch" },
    { header: "Account No", accessor: "BAccountNumber" },
    { header: "IFSC", accessor: "BIfscCode" },
    { header: "Account Type", accessor: "BAccountType" },
    { header: "Bank Type", accessor: "BBankType" },
    { header: "Holder Name", accessor: "BAccountHolderName" },
    { header: "Opening Balance", accessor: "BOpeningBalance" },
    { header: "Group", accessor: (r) => groupName(r.BLBelongsTo) },
    { header: "Address", accessor: "BAddress" },
    { header: "Status", accessor: (r) => (r.BStatus ? "Active" : "Inactive") },
  ];
}

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

// ─── Shared classes ──────────────────────────────────────────────────────────
const inputCls =
  "w-full text-sm border border-foreground/40 focus:border-foreground px-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const FIG = "font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground";

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
      cell: ({ getValue }) => <span className="text-foreground text-xs">{(getValue() as string) || "—"}</span>,
    },
    {
      id: "bankName",
      accessorKey: "BName",
      header: "Bank Name",
      cell: ({ getValue }) => <span className="font-medium text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      id: "branch",
      accessorKey: "BBranch",
      header: "Branch",
      cell: ({ getValue }) => <span className="text-muted-foreground text-xs">{(getValue() as string) || "—"}</span>,
    },
    {
      id: "accountNo",
      accessorKey: "BAccountNumber",
      header: "Account No.",
      enableSorting: false,
      cell: ({ getValue }) => <span className={`${FIG} tracking-wide`}>{(getValue() as string) || "—"}</span>,
    },
    {
      id: "ifsc",
      accessorKey: "BIfscCode",
      header: "IFSC",
      enableSorting: false,
      cell: ({ getValue }) => <span className={`${FIG} tracking-wide`}>{(getValue() as string) || "—"}</span>,
    },
    {
      id: "bankType",
      accessorKey: "BBankType",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? <span className={LBL}>{v}</span> : <span className="text-muted-foreground/50">—</span>;
      },
    },
    {
      id: "openingBalance",
      accessorKey: "BOpeningBalance",
      header: "Opening Bal.",
      cell: ({ getValue }) => <span className={FIG}>₹ {Number(getValue() || 0).toLocaleString("en-IN")}</span>,
    },
    {
      id: "status",
      accessorKey: "BStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const active = Boolean(getValue());
        return <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "none"} />;
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
          <div className="flex items-center justify-start gap-1 w-full min-w-[120px]">
            {deleteId === id ? (
              <>
                <button
                  onClick={() => onDeleteConfirm(id)}
                  className="h-7 px-2 flex items-center gap-1 border border-destructive bg-destructive text-destructive-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]"
                  title="Confirm delete"
                >
                  <Check size={12} /> Delete
                </button>
                <button onClick={onDeleteCancel} className={ACT} title="Keep" aria-label="Keep">
                  <X size={13} />
                </button>
              </>
            ) : (
              <>
                <button data-row-view onClick={() => onView(bank)} className={ACT} title="View details" aria-label="View details">
                  <Eye size={13} />
                </button>
                {canPrint && (
                  <button onClick={() => onPrint(bank)} className={ACT} title="Print" aria-label="Print">
                    <Printer size={13} />
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => onEdit(bank)} className={ACT} title="Edit" aria-label="Edit">
                    <Edit2 size={13} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => onDeleteRequest(id)}
                    className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={13} />
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

  // A refresh used to wipe whatever was typed into the "Add" form —
  // nothing here persisted it. Restore an in-progress draft on mount, and
  // keep it synced as the form changes, same fix as SupplierMaster/
  // ContractorMaster's useDraftForm — this page just owns its form state
  // via react-hook-form instead of a plain useState, hence the *Sync
  // variant (reset() is the apply-draft callback).
  useDraftFormSync("bank-master", form, (draft) => reset(draft), EMPTY, {
    skip: editingId !== null,
  });

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
    return <div className="p-6 text-destructive">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />

      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Banks"
        subtitle="The company's bank accounts: branch, account number, IFSC, opening balance and the projects each is tagged to."
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
                title="Download a blank CSV with all bank fields"
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
                title="Import banks from a filled-in CSV"
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
              { label: "Bank accounts", value: dbBanks.length.toLocaleString("en-IN"), note: "in all" },
              { label: "Active", value: dbBanks.filter((b) => b.BStatus).length.toLocaleString("en-IN"), note: "open for payments" },
              { label: "Tagged to projects", value: dbBanks.filter((b) => b.ProjectNames).length.toLocaleString("en-IN"), note: "the rest are shared" },
              { label: "Opening balance", value: `₹ ${dbBanks.reduce((sum, b) => sum + Number(b.BOpeningBalance || 0), 0).toLocaleString("en-IN")}`, note: "across all accounts" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form ── */}
        {(rights.canCreate || rights.canEdit) && <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
            <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
              {editingId ? "Edit bank account" : "Add bank account"}
            </h2>
            <p className="text-[0.6875rem] text-muted-foreground">
              Fields marked <span className="text-destructive">*</span> are required
            </p>
          </div>

          <div className="px-4 py-5 space-y-7">
            {/* ── Section: Basic Information ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Basic Information
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Bank Name */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
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
                      className={`${inputCls} pl-8 ${errors.bankName ? "border-destructive" : ""}`}
                    />
                  </div>
                  {errors.bankName && (
                    <p className="text-xs text-destructive mt-1">{errors.bankName.message}
                    </p>
                  )}
                </div>

                {/* Branch */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
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
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Account Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Account Number */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
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
                      className={`${inputCls} pl-8 font-heading tabular-nums tracking-wide ${errors.accountNo ? "border-destructive" : ""}`}
                    />
                  </div>
                  {errors.accountNo && (
                    <p className="text-xs text-destructive mt-1">{errors.accountNo.message}
                    </p>
                  )}
                </div>

                {/* IFSC Code */}
                <div className="space-y-1.5">
                  <label className={`${LBL} flex items-center gap-1`}>
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
                      className={`${inputCls} pl-8 font-heading tabular-nums tracking-wide uppercase ${errors.ifsc ? "border-destructive" : ""}`}
                    />
                    {form.ifsc.length === 11 && IFSC_REGEX.test(form.ifsc) && (
                      <Check size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground" aria-label="Valid IFSC" />
                    )}
                  </div>
                  {errors.ifsc && (
                    <p className="text-xs text-destructive mt-1">{errors.ifsc.message}
                    </p>
                  )}
                </div>

                {/* Account Holder Name */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
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
                  <label className={`${LBL} block`}>
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
                  <label className={`${LBL} block`}>
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
                  <label className={`${LBL} block`}>
                    Account Group
                  </label>
                  <div className="h-[42px] px-3 flex items-center border border-dashed border-foreground/40 text-sm text-muted-foreground">
                    Banks
                  </div>
                </div>

                {/* Opening Balance */}
                <div className="space-y-1.5">
                  <label className={`${LBL} block`}>
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
                      className={`${inputCls} pl-8 font-heading tabular-nums ${errors.openingBalance ? "border-destructive" : ""}`}
                    />
                  </div>
                  {errors.openingBalance && (
                    <p className="text-xs text-destructive mt-1">{errors.openingBalance.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Section: Address ── */}
            <div className="space-y-3">
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Address
              </p>
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
              <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: RULE }}>
                Tag Project(s)
              </p>
              <p className="text-[0.6875rem] text-muted-foreground leading-relaxed max-w-[110ch]">
                Optional — leave empty and this bank stays in the shared pool every untagged Project draws from.
                Tag it to one or more Projects and it becomes the ONLY bank offered for those Projects' work — it
                disappears from every other Project's bank selection, including ones with no tags of their own.
                {" "}Pick a Company to narrow the Project list, or just pick a Project directly and its Company
                fills in on its own — either way works, and a bank can still keep (or be tagged to) Projects
                under a different Company than the one shown here.
              </p>

              <div className="border border-foreground/40 p-3 space-y-3">
                <div>
                  <label className={`${LBL} block mb-1.5`}>Company</label>
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
                    <label className={`${LBL} block mb-1.5`}>Project</label>
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
                    className={`${KEY} px-4 h-[42px] bg-foreground text-card border border-foreground`}
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
                      className="inline-flex items-center gap-2 pl-2.5 pr-1 py-1 text-xs text-foreground border border-foreground"
                    >
                      <span>
                        {p.name}
                        {p.companyName && <span className="text-muted-foreground font-normal"> — {p.companyName}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setProjectIds((prev) => prev.filter((x) => x !== p.id))}
                        title={`Remove ${p.name}`}
                        className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
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
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                  form.status ? "bg-foreground" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${
                    form.status ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className={LBL}>
                Status —{" "}
                <span className="text-foreground">
                  {form.status ? "Active" : "Inactive"}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3" style={{ borderTop: RULE }}>
            <div className="hidden sm:block">
              {canSave ? <SheetMark text="Ready to save" tone="done" /> : <span className="text-[0.6875rem] text-muted-foreground">Fill in the required fields to save</span>}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={handleReset}
                disabled={!isDirty && !editingId}
                className={`${KEY} flex-1 sm:flex-none h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
              >
                <RotateCcw size={12} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                type="button"
                onClick={handleSubmit(handleSave)}
                disabled={!canSave}
                className={`${KEY} flex-1 sm:flex-none h-9 px-5 bg-foreground text-card border border-foreground whitespace-nowrap`}
              >
                {editingId ? <Check size={13} /> : <Plus size={13} />}
                {editingId ? "Update bank" : "Save bank"}
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
                placeholder="Search name, account, IFSC…"
                className="w-full sm:w-56 h-9 text-sm border border-foreground/40 focus:border-foreground pl-9 pr-3 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
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
                className={`${KEY} h-9 px-3 border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground`}
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="[&_th:last-child]:text-left [&_td:last-child]:text-left">
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
                columns: buildExportColumns(accountGroups),
              } : undefined}
              rowClassName={(row) =>
                editingId === String(row.original.BId) ? "shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""
              }
            />
          </div>
        </div>
      </SheetShell>

      {/* ── Import Results Modal ── */}
      {importResults && (
        <Dialog
          open={!!importResults}
          onOpenChange={() => setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg max-h-[80vh] flex flex-col" style={{ margin: 0 }}>
            <DialogHeader>
              <div className="pb-3" style={{ borderBottom: RULE }}>
                <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Banks · CSV import</p>
                <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Import results</DialogTitle>
              </div>
            </DialogHeader>
            <div className="flex items-center gap-4 flex-wrap mb-3">
              <SheetMark text={`${importResults.filter((r) => r.status === "success").length} imported`} tone="done" />
              {importResults.some((r) => r.status === "error") && (
                <SheetMark text={`${importResults.filter((r) => r.status === "error").length} failed`} tone="stopped" />
              )}
            </div>
            <div className="overflow-y-auto flex-1" style={{ border: RULE }}>
              {importResults.map((r, i) => (
                <div key={r.row} className="flex items-start gap-3 px-3 py-2 text-sm" style={i ? { borderTop: "1px solid hsl(var(--border) / 0.7)" } : undefined}>
                  <span className="font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground shrink-0 mt-1 w-12">Row {r.row}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate text-foreground">{r.name}</p>
                    {r.status !== "success" && r.message && <p className="text-xs text-destructive mt-0.5">{r.message}</p>}
                  </div>
                  {r.status === "success" ? <Check size={14} className="text-foreground shrink-0 mt-0.5" /> : <X size={14} className="text-destructive shrink-0 mt-0.5" />}
                </div>
              ))}
            </div>
            <div className="pt-3 flex justify-end">
              <button onClick={() => setImportResults(null)} className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}>
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── View Detail Drawer ── */}
      {viewRow && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRow(null)}
          />
          <div
            className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200"
            style={{ margin: 0, borderLeft: RULE }}
          >
            <div className="flex items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="min-w-0">
                <p className={LBL}>Bank account{viewRow.BBankType ? ` · ${viewRow.BBankType}` : ""}</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 break-words">{viewRow.BName}</h3>
              </div>
              <button onClick={() => setViewRow(null)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                { label: "Company", value: viewRow.BCompanyName },
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
                  <p className={`${LBL} mb-1`}>{label}</p>
                  <p className={`text-sm text-foreground break-words ${mono ? "font-heading tabular-nums font-semibold" : ""}`}>
                    {value || "—"}
                  </p>
                </div>
              ))}
              <div>
                <p className={`${LBL} mb-1.5`}>Status</p>
                <SheetMark text={viewRow.BStatus ? "Active" : "Inactive"} tone={viewRow.BStatus ? "done" : "none"} />
              </div>
            </div>
            <div className="px-5 py-3 flex justify-end gap-2 flex-wrap" style={{ borderTop: RULE }}>
              {rights.canPrint && (
                <button onClick={() => handlePrint(viewRow)} className={`${KEY} h-9 px-3 border border-foreground text-foreground hover:bg-primary/10`}>
                  <Printer size={12} /> Print
                </button>
              )}
              <button onClick={() => setViewRow(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                Close
              </button>
              {rights.canEdit && (
                <button
                  onClick={() => {
                    handleEdit(viewRow);
                    setViewRow(null);
                  }}
                  className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}
                >
                  <Edit2 size={12} /> Edit
                </button>
              )}
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default BankMaster;
