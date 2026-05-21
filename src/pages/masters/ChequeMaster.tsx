import { useState, useMemo, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  FileText,
  Landmark,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Search,
  Hash,
  Calculator,
  BookOpen,
  Eye,
  Printer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCheques,
  getBanksForCheque,
  getCompanyOptions,
  addCheque,
  updateCheque,
  deleteCheque,
  type DbCheque,
  type BankOption,
  type CompanyOption,
} from "@/api/chequeMasterApi";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  companyId: string;
  bankId: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  lotNumber: string;
  chqStart: number | "";
  chqEnd: number | "";
  totalCheques: number;
  remarks: string;
  status: boolean;
}

const EMPTY: FormState = {
  companyId: "",
  bankId: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  lotNumber: "",
  chqStart: "",
  chqEnd: "",
  totalCheques: 0,
  remarks: "",
  status: true,
};

function calcTotal(start: number | "", end: number | ""): number {
  if (start === "" || end === "" || Number(end) < Number(start)) return 0;
  return Number(end) - Number(start) + 1;
}

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

// ─── Column builder ────────────────────────────────────────────────────────────
function buildChequeColumns(
  _editingId: string | null,
  deleteId: string | null,
  setDeleteId: (id: string | null) => void,
  handleEdit: (item: DbCheque) => void,
  handleDelete: (id: string) => void,
  dbBanks: BankOption[],
  onView: (item: DbCheque) => void,
  onPrint: (item: DbCheque) => void,
): ColumnDef<DbCheque, unknown>[] {
  return [
    {
      id: "bank",
      header: "Bank",
      cell: ({ row }) => {
        const bank = dbBanks.find((b) => b.id === row.original.BankId);
        return (
          <span className="font-medium text-foreground">
            {bank?.label || "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "AccountNumber",
      header: "Account Number",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "ChequeLotNumber",
      header: "Lot Number",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "range",
      header: "Range",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ChequeStartNumber ?? "—"} –{" "}
          {row.original.ChequeEndNumber ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "TotalCheques",
      header: "Total",
      cell: ({ getValue }) => (
        <span className="text-xs font-semibold text-foreground">
          {((getValue() as number) || 0).toLocaleString()}
        </span>
      ),
    },
    {
      accessorKey: "Status",
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
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const id = String(row.original.CId);
        if (deleteId === id) {
          return (
            <div className="flex items-center gap-1 justify-end">
              <span className="text-[11px] text-muted-foreground mr-1">
                Delete?
              </span>
              <button
                onClick={() => handleDelete(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className="p-1 rounded text-muted-foreground hover:bg-muted"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onView(row.original)}
              className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={13} />
            </button>
            <button
              onClick={() => onPrint(row.original)}
              className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
              title="Print"
            >
              <Printer size={13} />
            </button>
            <button
              onClick={() => handleEdit(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={() => setDeleteId(id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
const ChequeMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: chequeData, isLoading: loadingCheques } = useQuery({
    queryKey: ["cheques"],
    queryFn: getCheques,
    staleTime: 5 * 60 * 1000,
  });
  const { data: bankData, isLoading: loadingBanks } = useQuery<BankOption[]>({
    queryKey: ["account-head-bank-options"],
    queryFn: getBanksForCheque,
    staleTime: 5 * 60 * 1000,
  });
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["enterprise-options"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const dbCheques: DbCheque[] = Array.isArray(chequeData) ? chequeData : [];
  const dbBanks: BankOption[] = Array.isArray(bankData) ? bankData : [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<DbCheque | null>(null);

  const handlePrint = (cheque: DbCheque) => {
    const win = window.open("", "_blank", "width=700,height=580");
    if (!win) return;
    win.document.write(`
      <html><head><title>Cheque Lot — ${cheque.ChequeLotNumber || cheque.CId}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Cheque Lot Details</h2>
      <table>
        <tr><td>Company</td><td>${cheque.CompanyName || "—"}</td></tr>
        <tr><td>Bank</td><td>${cheque.BankName || "—"}</td></tr>
        <tr><td>Branch</td><td>${cheque.BankBranch || "—"}</td></tr>
        <tr><td>Account Number</td><td>${cheque.AccountNumber || "—"}</td></tr>
        <tr><td>IFSC Code</td><td>${cheque.IFSCCode || "—"}</td></tr>
        <tr><td>Account Type</td><td>${cheque.BankAccountType || "—"}</td></tr>
        <tr><td>Lot Number</td><td>${cheque.ChequeLotNumber || "—"}</td></tr>
        <tr><td>Cheque Range</td><td>${cheque.ChequeStartNumber ?? "—"} → ${cheque.ChequeEndNumber ?? "—"}</td></tr>
        <tr><td>Total Cheques</td><td>${cheque.TotalCheques ?? "—"}</td></tr>
        <tr><td>Remarks</td><td>${cheque.Remarks || "—"}</td></tr>
        <tr><td>Status</td><td>${cheque.Status ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const handleBankChange = (bankId: string) => {
    const bank = dbBanks.find((b) => String(b.id) === bankId);
    setForm((p) => ({
      ...p,
      bankId,
      bankName: bank?.label || "",
      accountNumber: bank?.accountNumber || "",
      ifscCode: bank?.ifscCode || "",
    }));
    if (errors.bankId) setErrors((e) => ({ ...e, bankId: false }));
  };

  const setField = (k: keyof FormState, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.bankId) e.bankId = true;
    if (!form.accountNumber.trim()) e.accountNumber = true;
    if (!form.lotNumber.trim()) e.lotNumber = true;
    if (form.chqStart === "" || isNaN(Number(form.chqStart))) e.chqStart = true;
    if (form.chqEnd === "" || isNaN(Number(form.chqEnd))) e.chqEnd = true;
    if (
      form.chqStart !== "" &&
      form.chqEnd !== "" &&
      Number(form.chqEnd) < Number(form.chqStart)
    )
      e.chqEnd = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const toPayload = (f: FormState) => ({
    CompanyId: f.companyId ? Number(f.companyId) : null,
    BankId: f.bankId ? Number(f.bankId) : null,
    AccountNumber: f.accountNumber || null,
    IFSCCode: f.ifscCode || null,
    ChequeLotNumber: f.lotNumber || null,
    ChequeStartNumber: f.chqStart !== "" ? Number(f.chqStart) : null,
    ChequeEndNumber: f.chqEnd !== "" ? Number(f.chqEnd) : null,
    TotalCheques: f.totalCheques || null,
    Remarks: f.remarks || null,
    Status: f.status,
  });

  const handleEdit = (item: DbCheque) => {
    const bank = dbBanks.find((b) => b.id === item.BankId);
    setForm({
      companyId: item.CompanyId ? String(item.CompanyId) : "",
      bankId: item.BankId ? String(item.BankId) : "",
      bankName: bank?.label || "",
      accountNumber: item.AccountNumber || "",
      ifscCode: item.IFSCCode || "",
      lotNumber: item.ChequeLotNumber || "",
      chqStart: item.ChequeStartNumber ?? "",
      chqEnd: item.ChequeEndNumber ?? "",
      totalCheques: item.TotalCheques ?? 0,
      remarks: item.Remarks || "",
      status: item.Status,
    });
    setEditingId(String(item.CId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCheque(id);
      toast.success("Cheque lot deleted!");
      await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      setDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      if (editingId) {
        await updateCheque(editingId, toPayload(form));
        toast.success("Cheque lot updated!");
      } else {
        await addCheque(toPayload(form));
        toast.success("Cheque lot saved!");
      }
      await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      setForm(EMPTY);
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
  };

  const columns = useMemo(
    () =>
      buildChequeColumns(
        editingId,
        deleteId,
        setDeleteId,
        handleEdit,
        handleDelete,
        dbBanks,
        setViewRow,
        handlePrint,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteId, dbBanks],
  );

  // Auto-recalculate total
  useEffect(() => {
    setForm((p) => ({ ...p, totalCheques: calcTotal(p.chqStart, p.chqEnd) }));
  }, [form.chqStart, form.chqEnd]);

  const filtered = dbCheques.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const bank = dbBanks.find((b) => b.id === r.BankId);
    return (
      (bank?.label || "").toLowerCase().includes(q) ||
      (r.AccountNumber || "").toLowerCase().includes(q) ||
      (r.ChequeLotNumber || "").toLowerCase().includes(q) ||
      String(r.ChequeStartNumber).includes(q) ||
      String(r.ChequeEndNumber).includes(q)
    );
  });

  const totalCheques = calcTotal(form.chqStart, form.chqEnd);
  const rangeValid =
    form.chqStart !== "" &&
    form.chqEnd !== "" &&
    Number(form.chqEnd) >= Number(form.chqStart);

  if (loadingCheques || loadingBanks)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Cheque Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Cheque Master
      </h1>

      <div className="space-y-5">
        {/* Form */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Cheque Lot" : "Add Cheque Lot"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId
                  ? "Modify cheque lot details below."
                  : "Register a new cheque book / lot."}
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
              {/* Company dropdown — live from DB */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Company <span className="text-destructive">*</span>
                </label>
                <select
                  value={form.companyId}
                  onChange={(e) => setField("companyId", e.target.value)}
                  className={`${inp} ${errors.companyId ? "border-destructive" : ""}`}
                >
                  <option value="">Select Company...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {errors.companyId && (
                  <p className="text-[11px] text-destructive mt-1">
                    Company is required
                  </p>
                )}
              </div>

              {/* Bank dropdown — live from DB */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Bank Name <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Landmark
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <select
                    value={form.bankId}
                    onChange={(e) => handleBankChange(e.target.value)}
                    className={`${inp} pl-8 ${errors.bankId ? "border-destructive" : ""}`}
                  >
                    <option value="">Select Bank...</option>
                    {dbBanks.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.label}
                        {b.branchName ? ` — ${b.branchName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.bankId && (
                  <p className="text-[11px] text-destructive mt-1">
                    Bank is required
                  </p>
                )}
              </div>

              {/* Account Number — auto-filled */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Number <span className="text-destructive">*</span>
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">
                    (auto-filled)
                  </span>
                </label>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={form.accountNumber}
                    onChange={(e) => setField("accountNumber", e.target.value)}
                    placeholder="Auto-filled on bank selection"
                    className={`${inp} pl-8 font-mono tracking-widest ${errors.accountNumber ? "border-destructive" : ""}`}
                  />
                  {form.accountNumber && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      AUTO
                    </span>
                  )}
                </div>
                {errors.accountNumber && (
                  <p className="text-[11px] text-destructive mt-1">
                    Account number is required
                  </p>
                )}
              </div>

              {/* IFSC — read-only */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  IFSC Code{" "}
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">
                    (auto-filled)
                  </span>
                </label>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={form.ifscCode}
                    readOnly
                    placeholder="Auto-filled on bank selection"
                    className={`${inp} pl-8 font-mono tracking-widest bg-muted/50 cursor-default text-muted-foreground`}
                  />
                  {form.ifscCode && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      AUTO
                    </span>
                  )}
                </div>
              </div>

              {/* Lot Number */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Cheque Lot Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <BookOpen
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={form.lotNumber}
                    onChange={(e) => setField("lotNumber", e.target.value)}
                    placeholder="e.g. LOT-2024-001"
                    className={`${inp} pl-8 ${errors.lotNumber ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.lotNumber && (
                  <p className="text-[11px] text-destructive mt-1">
                    Lot number is required
                  </p>
                )}
              </div>

              {/* Cheque Start */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Cheque Start Number{" "}
                  <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <FileText
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="number"
                    value={form.chqStart}
                    onChange={(e) =>
                      setField(
                        "chqStart",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g. 100001"
                    className={`${inp} pl-8 font-mono ${errors.chqStart ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.chqStart && (
                  <p className="text-[11px] text-destructive mt-1">
                    Start number is required
                  </p>
                )}
              </div>

              {/* Cheque End */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Cheque End Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <FileText
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="number"
                    value={form.chqEnd}
                    onChange={(e) =>
                      setField(
                        "chqEnd",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g. 100050"
                    className={`${inp} pl-8 font-mono ${errors.chqEnd ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.chqEnd && (
                  <p className="text-[11px] text-destructive mt-1">
                    {Number(form.chqEnd) < Number(form.chqStart)
                      ? "End must be ≥ start"
                      : "End number is required"}
                  </p>
                )}
              </div>

              {/* Total — calculated */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Total Cheques{" "}
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">
                    (auto-calculated)
                  </span>
                </label>
                <div
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-all ${rangeValid ? "bg-primary/5 border-primary/30" : "bg-muted/40 border-border"}`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${rangeValid ? "bg-primary/10" : "bg-muted"}`}
                  >
                    <Calculator
                      size={16}
                      className={
                        rangeValid ? "text-primary" : "text-muted-foreground"
                      }
                    />
                  </div>
                  <div>
                    <p
                      className={`text-2xl font-heading font-bold leading-none ${rangeValid ? "text-primary" : "text-muted-foreground/40"}`}
                    >
                      {rangeValid ? totalCheques.toLocaleString() : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {rangeValid
                        ? `Cheques from ${form.chqStart} to ${form.chqEnd}`
                        : "Enter start and end numbers above"}
                    </p>
                  </div>
                  {rangeValid && (
                    <div className="ml-auto text-right hidden sm:block">
                      <p className="text-[10px] font-heading text-muted-foreground uppercase tracking-widest">
                        Range
                      </p>
                      <p className="text-xs font-mono text-foreground">
                        {form.chqStart} – {form.chqEnd}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Remarks */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Remarks
                </label>
                <textarea
                  value={form.remarks}
                  onChange={(e) => setField("remarks", e.target.value)}
                  rows={2}
                  placeholder="Optional notes..."
                  className={inp}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Status
                </label>
                <button
                  type="button"
                  onClick={() => setField("status", !form.status)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.status ? "bg-primary" : "bg-muted border border-border"}`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${form.status ? "translate-x-6" : "translate-x-1"}`}
                  />
                </button>
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

        {/* Table */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                Cheque Lot Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} lot{filtered.length !== 1 ? "s" : ""}
                {filtered.length > 0 && (
                  <span className="ml-2 text-primary font-semibold">
                    ·{" "}
                    {filtered
                      .reduce((s, r) => s + (r.TotalCheques || 0), 0)
                      .toLocaleString()}{" "}
                    total cheques
                  </span>
                )}
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
            <DataTable
              data={filtered}
              columns={columns}
              searchable={false}
              paginated={true}
              defaultPageSize={20}
              emptyMessage={
                search
                  ? "No cheque lots match your search."
                  : "No cheque lots yet. Add one above."
              }
              rowClassName={(row) =>
                String(row.original.CId) === editingId
                  ? "bg-primary/5 border-l-2 border-l-primary"
                  : ""
              }
            />
          </div>
        </div>
      </div>

      {/* View Detail Modal */}
      <Dialog
        open={!!viewRow}
        onOpenChange={(open) => !open && setViewRow(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              Cheque Lot Details
            </DialogTitle>
          </DialogHeader>
          {viewRow && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
              {[
                { label: "Company", value: viewRow.CompanyName },
                { label: "Bank", value: viewRow.BankName },
                { label: "Branch", value: viewRow.BankBranch },
                {
                  label: "Account Number",
                  value: viewRow.AccountNumber,
                  mono: true,
                },
                { label: "IFSC Code", value: viewRow.IFSCCode, mono: true },
                { label: "Account Type", value: viewRow.BankAccountType },
                {
                  label: "Lot Number",
                  value: viewRow.ChequeLotNumber,
                  mono: true,
                },
                {
                  label: "Cheque Range",
                  value: `${viewRow.ChequeStartNumber ?? "—"} → ${viewRow.ChequeEndNumber ?? "—"}`,
                  mono: true,
                },
                {
                  label: "Total Cheques",
                  value: String(viewRow.TotalCheques ?? "—"),
                },
                { label: "Remarks", value: viewRow.Remarks },
                {
                  label: "Status",
                  value: viewRow.Status ? "Active" : "Inactive",
                },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-0.5">
                    {label}
                  </p>
                  <p
                    className={`text-sm text-foreground break-words ${mono ? "font-mono" : "font-body"}`}
                  >
                    {value || "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
            {viewRow && (
              <button
                onClick={() => handlePrint(viewRow)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-all"
              >
                <Printer size={13} /> Print
              </button>
            )}
            <button
              onClick={() => setViewRow(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ChequeMaster;
