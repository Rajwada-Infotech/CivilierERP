import React, { useState, useMemo, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
} from "lucide-react";
import TreeDropdown from "@/components/common/TreeDropdown";

import {
  getBanks,
  addBank,
  updateBank,
  deleteBank,
  getCompanyOptions,
  type BankRecord,
  type CompanyOption,
} from "@/api/bankMasterApi";

import { getAccountGroups } from "@/api/accountApi";

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
const selectCls =
  "w-full appearance-none pl-3 pr-9 py-2.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

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
                <button
                  onClick={() => onPrint(bank)}
                  className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                  title="Print"
                >
                  <Printer size={15} />
                </button>
                <button
                  onClick={() => onEdit(bank)}
                  className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                  title="Edit"
                >
                  <Edit2 size={15} />
                </button>
                <button
                  onClick={() => onDeleteRequest(id)}
                  className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
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

  const dbBanks: BankRecord[] = Array.isArray(dbData) ? dbData : [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<FormState>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: EMPTY,
    mode: "onChange",
  });

  const form = watch();
  const canSave = isValid;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<BankRecord | null>(null);

  // ─── Table filter / pagination state ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterBankType, setFilterBankType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

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

  useEffect(() => {
    setPage(1);
  }, [search, filterBankType, filterStatus]);

  const totalPages = Math.max(Math.ceil(filtered.length / limit), 1);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

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
      if (editingId) {
        await updateBank(editingId, toPayload(values));
        toast.success("Bank updated successfully!");
      } else {
        await addBank(toPayload(values));
        toast.success("Bank added successfully!");
      }
      await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      reset(EMPTY);
      setEditingId(null);
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
      }
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  const handleReset = () => {
    reset(EMPTY);
    setEditingId(null);
  };

  const handlePrint = (bank: BankRecord) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(`
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
      ),
    [editingId, deleteId],
  );

  if (error)
    return <div className="p-6 text-red-500">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />

      <div className="relative space-y-8 mt-6">
        {/* ── Page Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Bank Master
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage bank accounts with branch, IFSC and balance details
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
              {dbBanks.length} Banks
            </span>
          </div>
        </div>

        {/* ── Form Card ── */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Card header — title only */}
          <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20">
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
                {/* Company Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Company Name
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.companyName}
                    onChange={(v) =>
                      setValue("companyName", v, { shouldValidate: true })
                    }
                    options={companies.map((c) => ({
                      value: c.label,
                      label: c.label,
                    }))}
                    placeholder="Select Company…"
                    icon={<Building2 size={13} />}
                  />
                </div>

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

                {/* Account Group */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Group
                  </label>
                  <TreeDropdown
                    variant="tree"
                    value={form.accountGroupId}
                    onChange={(v) =>
                      setValue("accountGroupId", v, { shouldValidate: true })
                    }
                    items={accountGroupTree}
                    allGroups={accountGroups}
                  />
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
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground">
              {canSave ? (
                <span className="text-emerald-500 font-medium">
                  Ready to save
                </span>
              ) : (
                "Fill in the required fields to save"
              )}
            </p>
            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit(handleSave)}
                disabled={!canSave}
                className="px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity"
              >
                {editingId ? <Check size={14} /> : <Plus size={14} />}
                {editingId ? "Update Bank" : "Save Bank"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Table Section ── */}
        <div>
          {/* Toolbar */}
          <div className="mb-3 flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, account, IFSC…"
                className="w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
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
              data={paginated}
              columns={columns}
              loading={isLoading}
              searchPlaceholder="Search banks..."
              emptyMessage="No banks yet. Add one above."
              exportConfig={{
                title: "Bank Master",
                filename: "bank-master",
                columns: EXPORT_COLUMNS,
              }}
              rowClassName={(row) =>
                editingId === String(row.original.BId) ? "bg-primary/5" : ""
              }
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-heading text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-heading text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── View Detail Drawer ── */}
      {viewRow && (
        <div className="fixed inset-0 z-50 flex justify-end">
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
