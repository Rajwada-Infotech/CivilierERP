import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Landmark,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Search,
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

// ─── Local form types ────────────────────────────────────────────────────────
interface FormState {
  companyName: string;
  bankName: string;
  branch: string;
  accountNo: string;
  ifsc: string;
  accountType: string;
  bankType: string;
  holderName: string;
  openingBalance: string;
  address: string;
  status: boolean;
}

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

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ─── Component ───────────────────────────────────────────────────────────────
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

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const setField = (k: keyof FormState, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.bankName.trim()) e.bankName = true;
    if (!form.ifsc.trim()) {
      e.ifsc = true;
    } else if (!IFSC_REGEX.test(form.ifsc.trim().toUpperCase())) {
      e.ifsc = true;
    }
    if (!form.accountNo.trim()) e.accountNo = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

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

  const handleSave = async () => {
    if (!validate()) return;

    // Extra IFSC guard with user-friendly toast (from ac97f7f branch)
    const ifsc = form.ifsc.trim().toUpperCase();
    if (!IFSC_REGEX.test(ifsc)) {
      toast.error(
        `Invalid IFSC Code "${ifsc || "empty"}". Format must be like SBIN0001234 (11 characters).`,
      );
      return;
    }

    try {
      if (editingId) {
        await updateBank(editingId, toPayload(form));
        toast.success("Bank updated!");
      } else {
        await addBank(toPayload(form));
        toast.success("Bank saved!");
      }
      await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      setForm(EMPTY);
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleEdit = (item: BankRecord) => {
    setForm({
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
      status: item.BStatus,
    });
    setEditingId(String(item.BId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBank(id);
      toast.success("Bank deleted!");
      await queryClient.invalidateQueries({ queryKey: ["bank-master"] });
      setDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
  };

  const filtered = dbBanks.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (b.BName || "").toLowerCase().includes(q) ||
      (b.BBranch || "").toLowerCase().includes(q) ||
      (b.BAccountNumber || "").toLowerCase().includes(q) ||
      (b.BIfscCode || "").toLowerCase().includes(q) ||
      (b.BCompanyName || "").toLowerCase().includes(q)
    );
  });

  const bankTypeBadge: Record<string, string> = {
    Nationalized: "bg-blue-500/10 border-blue-500/20 text-blue-600",
    Private: "bg-violet-500/10 border-violet-500/20 text-violet-600",
    "Co-operative": "bg-amber-500/10 border-amber-500/20 text-amber-600",
    Foreign: "bg-cyan-500/10 border-cyan-500/20 text-cyan-600",
    "Regional Rural": "bg-green-500/10 border-green-500/20 text-green-600",
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading banks...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load banks.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Bank Master
      </h1>

      <div className="space-y-5">
        {/* ── Form ── */}
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

          <div className="p-5">
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
                  <select
                    value={form.companyName}
                    onChange={(e) => setField("companyName", e.target.value)}
                    className={`${inp} pl-8`}
                  >
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
                    value={form.bankName}
                    onChange={(e) => setField("bankName", e.target.value)}
                    placeholder="e.g. State Bank of India"
                    className={`${inp} pl-8 ${errors.bankName ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.bankName && (
                  <p className="text-[11px] text-destructive mt-1">
                    Bank name is required
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
                  value={form.branch}
                  onChange={(e) => setField("branch", e.target.value)}
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
                    value={form.accountNo}
                    onChange={(e) => setField("accountNo", e.target.value)}
                    placeholder="Bank account number"
                    className={`${inp} pl-8 font-mono tracking-widest ${errors.accountNo ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.accountNo && (
                  <p className="text-[11px] text-destructive mt-1">
                    Account number is required
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
                    value={form.ifsc}
                    onChange={(e) =>
                      setField(
                        "ifsc",
                        e.target.value.toUpperCase().slice(0, 11),
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
                    {!form.ifsc.trim()
                      ? "IFSC code is required"
                      : "Invalid format — must be 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)"}
                  </p>
                )}
              </div>

              {/* Account Type */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Type
                </label>
                <select
                  value={form.accountType}
                  onChange={(e) => setField("accountType", e.target.value)}
                  className={inp}
                >
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
                <select
                  value={form.bankType}
                  onChange={(e) => setField("bankType", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Bank Type...</option>
                  {BANK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Holder Name */}
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
                    value={form.holderName}
                    onChange={(e) => setField("holderName", e.target.value)}
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
                    value={form.openingBalance}
                    onChange={(e) => setField("openingBalance", e.target.value)}
                    placeholder="0.00"
                    className={`${inp} pl-8 font-mono`}
                  />
                </div>
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
                    value={form.address}
                    onChange={(e) => setField("address", e.target.value)}
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
                  onClick={() => setField("status", !form.status)}
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
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                <Plus size={15} />
                {editingId ? "Update" : "Save"}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                Bank Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} bank{filtered.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary w-36 sm:w-44"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    "Company",
                    "Bank Name",
                    "Branch",
                    "Account No.",
                    "IFSC",
                    "Type",
                    "Opening Bal.",
                    "Status",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-10 text-center text-muted-foreground text-sm"
                    >
                      {search
                        ? "No banks match your search."
                        : "No banks yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((bank) => {
                    const id = String(bank.BId);
                    const btCls =
                      bankTypeBadge[bank.BBankType || ""] ??
                      "bg-muted border-border text-muted-foreground";
                    return (
                      <tr
                        key={id}
                        className={`hover:bg-muted/20 transition-colors ${
                          editingId === id
                            ? "bg-primary/5 border-l-2 border-l-primary"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-foreground font-body text-xs">
                          {bank.BCompanyName || "—"}
                        </td>
                        <td className="px-4 py-3 font-heading font-medium text-foreground">
                          {bank.BName || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {bank.BBranch || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                            {bank.BAccountNumber || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded tracking-widest">
                            {bank.BIfscCode || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {bank.BBankType ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${btCls}`}
                            >
                              {bank.BBankType}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-foreground text-sm">
                          ₹{" "}
                          {Number(bank.BOpeningBalance || 0).toLocaleString(
                            "en-IN",
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
                              bank.BStatus
                                ? "bg-green-500/10 border-green-500/20 text-green-600"
                                : "bg-red-500/10 border-red-500/20 text-red-600"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                bank.BStatus ? "bg-green-500" : "bg-red-500"
                              }`}
                            />
                            {bank.BStatus ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {deleteId === id ? (
                              <>
                                <span className="text-[11px] text-muted-foreground mr-1">
                                  Confirm?
                                </span>
                                <button
                                  onClick={() => handleDelete(id)}
                                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  onClick={() => setDeleteId(null)}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                                >
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(bank)}
                                  className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={() => setDeleteId(id)}
                                  className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default BankMaster;
