import React, { useState, useMemo } from "react";
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
  RotateCcw,
  Check,
  X,
  Hash,
  Building2,
  MapPin,
  CreditCard,
  IndianRupee,
} from "lucide-react";

import {
  getBanks,
  addBank,
  updateBank,
  deleteBank,
  getCompanyOptions,
  type BankRecord,
  type CompanyOption,
} from "@/api/bankMasterApi";

import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";

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
  openingBalance: z.string().refine(
    (value) =>
      value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0),
    "Opening balance must be 0 or greater",
  ),
  address: z.string(),
  status: z.boolean(),
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
  status: true,
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

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

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
  editingId: string | null,
  deleteId: string | null,
  onEdit: (bank: BankRecord) => void,
  onDeleteRequest: (id: string) => void,
  onDeleteConfirm: (id: string) => void,
  onDeleteCancel: () => void,
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
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
              active
                ? "bg-green-500/10 border-green-500/20 text-green-600"
                : "bg-red-500/10 border-red-500/20 text-red-600"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${active ? "bg-green-500" : "bg-red-500"}`}
            />
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
          <div className="flex items-center justify-end gap-1">
            {deleteId === id ? (
              <>
                <span className="text-[11px] text-muted-foreground mr-1">
                  Confirm?
                </span>
                <button
                  onClick={() => onDeleteConfirm(id)}
                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={onDeleteCancel}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onEdit(bank)}
                  className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => onDeleteRequest(id)}
                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={13} />
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

  const dbBanks: BankRecord[] = Array.isArray(dbData) ? dbData : [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormState>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: EMPTY,
    mode: "onChange", // Optional: real-time validation
  });

  const form = watch();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
      status: Boolean(item.BStatus),
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

  const columns = useMemo(
    () =>
      buildColumns(
        editingId,
        deleteId,
        handleEdit,
        setDeleteId,
        handleDelete,
        () => setDeleteId(null),
      ),
    [editingId, deleteId],
  );

  if (error)
    return <div className="p-6 text-red-500">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Bank Master
      </h1>

      <div className="space-y-5">
        {/* Form Section */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Bank" : "Add Bank"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId
                  ? "Modify bank details below."
                  : "Register a new bank account."}
              </p>
            </div>
            {editingId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">
                Editing
              </span>
            )}
          </div>

          <form className="p-5" onSubmit={handleSubmit(handleSave)}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Company Name */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Company Name
                </label>
                <div className="relative">
                  <Building2
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <select {...register("companyName")} className={`${inp} pl-8`}>
                    <option value="">Select Company...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.label}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bank Name */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Bank Name <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Landmark
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    {...register("bankName")}
                    placeholder="e.g. State Bank of India"
                    className={`${inp} pl-8 ${errors.bankName ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.bankName && (
                  <p className="text-[11px] text-destructive mt-1">
                    {errors.bankName.message}
                  </p>
                )}
              </div>

              {/* Branch */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Branch Name
                </label>
                <input
                  type="text"
                  {...register("branch")}
                  placeholder="e.g. Park Street Branch"
                  className={inp}
                />
              </div>

              {/* Account Number */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    {...register("accountNo")}
                    placeholder="Bank account number"
                    className={`${inp} pl-8 font-mono tracking-widest ${errors.accountNo ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.accountNo && (
                  <p className="text-[11px] text-destructive mt-1">
                    {errors.accountNo.message}
                  </p>
                )}
              </div>

              {/* IFSC Code */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  IFSC Code <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
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
                    className={`${inp} pl-8 font-mono tracking-widest uppercase ${errors.ifsc ? "border-destructive" : ""}`}
                  />
                  {form.ifsc.length === 11 && IFSC_REGEX.test(form.ifsc) && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded">
                      ✓
                    </span>
                  )}
                </div>
                {errors.ifsc && (
                  <p className="text-[11px] text-destructive mt-1">
                    {errors.ifsc.message}
                  </p>
                )}
              </div>

              {/* Account Type */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Type
                </label>
                <select {...register("accountType")} className={inp}>
                  <option value="">Select Account Type...</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bank Type */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Bank Type
                </label>
                <select {...register("bankType")} className={inp}>
                  <option value="">Select Bank Type...</option>
                  {BANK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Holder Name */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Holder Name
                </label>
                <div className="relative">
                  <CreditCard
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    {...register("holderName")}
                    placeholder="Name on account"
                    className={`${inp} pl-8`}
                  />
                </div>
              </div>

              {/* Opening Balance */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Opening Balance (₹)
                </label>
                <div className="relative">
                  <IndianRupee
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    {...register("openingBalance")}
                    placeholder="0.00"
                    className={`${inp} pl-8 font-mono ${errors.openingBalance ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.openingBalance && (
                  <p className="text-[11px] text-destructive mt-1">
                    {errors.openingBalance.message}
                  </p>
                )}
              </div>

              {/* Address */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Bank Address
                </label>
                <div className="relative">
                  <MapPin
                    size={14}
                    className="absolute left-3 top-3 text-muted-foreground"
                  />
                  <textarea
                    rows={2}
                    {...register("address")}
                    placeholder="Branch address..."
                    className={`${inp} pl-8 resize-none`}
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Status
                </label>
                <button
                  type="button"
                  onClick={() => setValue("status", !form.status)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.status ? "bg-primary" : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${
                      form.status ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="ml-2 text-xs text-muted-foreground font-body">
                  {form.status ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                <Plus size={15} />
                {editingId ? "Update" : "Save"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </form>
        </div>

        {/* Table Section */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-card/60">
            <h3 className="font-heading font-semibold text-foreground text-sm">
              Bank Records
            </h3>
          </div>
          <DataTable
            data={dbBanks}
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
              editingId === String(row.original.BId)
                ? "bg-primary/5 border-l-2 border-l-primary"
                : ""
            }
          />
        </div>
      </div>
    </>
  );
};

export default BankMaster;