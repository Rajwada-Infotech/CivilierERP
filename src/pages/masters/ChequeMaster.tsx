import React, { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Landmark, Plus, Edit2, Trash2, RotateCcw, Check, X, Hash, Calculator, BookOpen } from "lucide-react";
import {
  getCheques, getBanksForCheque, getCompanyOptions, addCheque, updateCheque, deleteCheque,
  type DbCheque, type BankOption, type CompanyOption,
} from "@/api/chequeMasterApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

interface FormState {
  companyId: string; bankId: string; bankName: string; accountNumber: string; ifscCode: string;
  lotNumber: string; chqStart: number | ""; chqEnd: number | ""; totalCheques: number; remarks: string; status: boolean;
}

const EMPTY: FormState = {
  companyId: "", bankId: "", bankName: "", accountNumber: "", ifscCode: "",
  lotNumber: "", chqStart: "", chqEnd: "", totalCheques: 0, remarks: "", status: true,
};

function calcTotal(start: number | "", end: number | ""): number {
  if (start === "" || end === "" || Number(end) < Number(start)) return 0;
  return Number(end) - Number(start) + 1;
}

const inp = "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

function buildColumns(
  editingId: string | null, deleteId: string | null,
  dbBanks: BankOption[],
  onEdit: (item: DbCheque) => void,
  onDeleteRequest: (id: string) => void,
  onDeleteConfirm: (id: string) => void,
  onDeleteCancel: () => void,
): ColumnDef<DbCheque, unknown>[] {
  return [
    {
      id: "bank", header: "Bank", enableSorting: false,
      cell: ({ row }) => {
        const bank = dbBanks.find((b) => b.id === row.original.BankId);
        return <span className="text-foreground font-body">{bank?.label || "—"}</span>;
      },
    },
    {
      accessorKey: "AccountNumber", header: "Account No.", enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{v}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "IFSCCode", header: "IFSC", enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{v}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "ChequeLotNumber", header: "Lot No.",
      cell: ({ getValue }) => <span className="font-heading font-medium text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "ChequeStartNumber", header: "Chq Start",
      cell: ({ getValue }) => <span className="font-mono text-foreground">{getValue() as number}</span>,
    },
    {
      accessorKey: "ChequeEndNumber", header: "Chq End",
      cell: ({ getValue }) => <span className="font-mono text-foreground">{getValue() as number}</span>,
    },
    {
      accessorKey: "TotalCheques", header: "Total",
      cell: ({ getValue }) => (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary font-heading font-semibold text-sm">
          <Calculator size={11} />{((getValue() as number) || 0).toLocaleString()}
        </span>
      ),
    },
    {
      accessorKey: "Status", header: "Status",
      cell: ({ getValue }) => {
        const active = Boolean(getValue());
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${active ? "bg-primary/10 text-primary border-primary/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${active ? "bg-primary" : "bg-destructive"}`} />
            {active ? "Active" : "Inactive"}
          </span>
        );
      },
    },
    {
      id: "actions", header: "Actions", enableSorting: false,
      cell: ({ row }) => {
        const id = String(row.original.CId);
        return (
          <div className="flex items-center justify-end gap-1">
            {deleteId === id ? (
              <>
                <span className="text-[11px] text-muted-foreground mr-1">Confirm?</span>
                <button onClick={() => onDeleteConfirm(id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={13} /></button>
                <button onClick={onDeleteCancel} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={13} /></button>
              </>
            ) : (
              <>
                <button onClick={() => onEdit(row.original)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"><Edit2 size={13} /></button>
                <button onClick={() => onDeleteRequest(id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={13} /></button>
              </>
            )}
          </div>
        );
      },
    },
  ];
}

const ChequeMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: chequeData, isLoading: loadingCheques } = useQuery({ queryKey: ["cheques"], queryFn: getCheques, staleTime: 5 * 60 * 1000 });
  const { data: bankData, isLoading: loadingBanks } = useQuery<BankOption[]>({ queryKey: ["account-head-bank-options"], queryFn: getBanksForCheque, staleTime: 5 * 60 * 1000 });
  const { data: companies = [] } = useQuery<CompanyOption[]>({ queryKey: ["enterprise-options"], queryFn: getCompanyOptions, staleTime: 5 * 60 * 1000 });

  const dbCheques: DbCheque[] = Array.isArray(chequeData) ? chequeData : [];
  const dbBanks: BankOption[] = Array.isArray(bankData) ? bankData : [];

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { setForm((p) => ({ ...p, totalCheques: calcTotal(p.chqStart, p.chqEnd) })); }, [form.chqStart, form.chqEnd]);

  const handleBankChange = (bankId: string) => {
    const bank = dbBanks.find((b) => String(b.id) === bankId);
    setForm((p) => ({ ...p, bankId, bankName: bank?.label || "", accountNumber: bank?.accountNumber || "", ifscCode: bank?.ifscCode || "" }));
    if (errors.bankId) setErrors((e) => ({ ...e, bankId: false }));
  };

  const setField = (k: keyof FormState, v: unknown) => { setForm((p) => ({ ...p, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: false })); };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.bankId) e.bankId = true;
    if (!form.accountNumber.trim()) e.accountNumber = true;
    if (!form.lotNumber.trim()) e.lotNumber = true;
    if (form.chqStart === "" || isNaN(Number(form.chqStart))) e.chqStart = true;
    if (form.chqEnd === "" || isNaN(Number(form.chqEnd))) e.chqEnd = true;
    if (form.chqStart !== "" && form.chqEnd !== "" && Number(form.chqEnd) < Number(form.chqStart)) e.chqEnd = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const toPayload = (f: FormState) => ({
    CompanyId: f.companyId ? Number(f.companyId) : null, BankId: f.bankId ? Number(f.bankId) : null,
    AccountNumber: f.accountNumber || null, IFSCCode: f.ifscCode || null, ChequeLotNumber: f.lotNumber || null,
    ChequeStartNumber: f.chqStart !== "" ? Number(f.chqStart) : null, ChequeEndNumber: f.chqEnd !== "" ? Number(f.chqEnd) : null,
    TotalCheques: f.totalCheques || null, Remarks: f.remarks || null, Status: f.status,
  });

  const handleSave = async () => {
    if (!validate()) return;
    try {
      if (editingId) { await updateCheque(editingId, toPayload(form)); toast.success("Cheque lot updated!"); }
      else { await addCheque(toPayload(form)); toast.success("Cheque lot saved!"); }
      await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      setForm(EMPTY); setEditingId(null);
    } catch (err: any) { toast.error("Failed: " + err.message); }
  };

  const handleEdit = (item: DbCheque) => {
    const bank = dbBanks.find((b) => b.id === item.BankId);
    setForm({ companyId: item.CompanyId ? String(item.CompanyId) : "", bankId: item.BankId ? String(item.BankId) : "", bankName: bank?.label || "", accountNumber: item.AccountNumber || "", ifscCode: item.IFSCCode || "", lotNumber: item.ChequeLotNumber || "", chqStart: item.ChequeStartNumber ?? "", chqEnd: item.ChequeEndNumber ?? "", totalCheques: item.TotalCheques ?? 0, remarks: item.Remarks || "", status: item.Status });
    setEditingId(String(item.CId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCheque(id); toast.success("Cheque lot deleted!");
      await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      setDeleteId(null);
      if (editingId === id) { setEditingId(null); setForm(EMPTY); }
    } catch (err: any) { toast.error("Delete failed: " + err.message); }
  };

  const columns = useMemo(
    () => buildColumns(editingId, deleteId, dbBanks, handleEdit, setDeleteId, handleDelete, () => setDeleteId(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteId, dbBanks],
  );

  const totalCheques = calcTotal(form.chqStart, form.chqEnd);
  const rangeValid = form.chqStart !== "" && form.chqEnd !== "" && Number(form.chqEnd) >= Number(form.chqStart);

  if (loadingCheques || loadingBanks) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Cheque Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Cheque Master</h1>
      <div className="space-y-5">
        {/* Form */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">{editingId ? "Edit Cheque Lot" : "Add Cheque Lot"}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{editingId ? "Modify cheque lot details below." : "Register a new cheque book / lot."}</p>
            </div>
            {editingId && <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">Editing</span>}
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Company <span className="text-destructive">*</span></label>
                <select value={form.companyId} onChange={(e) => setField("companyId", e.target.value)} className={`${inp} ${errors.companyId ? "border-destructive" : ""}`}>
                  <option value="">Select Company...</option>
                  {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.label}</option>)}
                </select>
                {errors.companyId && <p className="text-[11px] text-destructive mt-1">Company is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Bank Name <span className="text-destructive">*</span></label>
                <div className="relative">
                  <Landmark size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <select value={form.bankId} onChange={(e) => handleBankChange(e.target.value)} className={`${inp} pl-8 ${errors.bankId ? "border-destructive" : ""}`}>
                    <option value="">Select Bank...</option>
                    {dbBanks.map((b) => <option key={b.id} value={String(b.id)}>{b.label}{b.BBranch ? ` — ${b.BBranch}` : ""}</option>)}
                  </select>
                </div>
                {errors.bankId && <p className="text-[11px] text-destructive mt-1">Bank is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Account Number <span className="text-destructive">*</span><span className="ml-2 normal-case text-[10px] text-muted-foreground/60">(auto-filled)</span></label>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={form.accountNumber} onChange={(e) => setField("accountNumber", e.target.value)} placeholder="Auto-filled on bank selection" className={`${inp} pl-8 font-mono tracking-widest ${errors.accountNumber ? "border-destructive" : ""}`} />
                  {form.accountNumber && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-primary bg-primary/10 px-1.5 py-0.5 rounded">AUTO</span>}
                </div>
                {errors.accountNumber && <p className="text-[11px] text-destructive mt-1">Account number is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">IFSC Code <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">(auto-filled)</span></label>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={form.ifscCode} readOnly placeholder="Auto-filled on bank selection" className={`${inp} pl-8 font-mono tracking-widest bg-muted/50 cursor-default text-muted-foreground`} />
                  {form.ifscCode && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-primary bg-primary/10 px-1.5 py-0.5 rounded">AUTO</span>}
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Cheque Lot Number <span className="text-destructive">*</span></label>
                <div className="relative">
                  <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={form.lotNumber} onChange={(e) => setField("lotNumber", e.target.value)} placeholder="e.g. LOT-2024-001" className={`${inp} pl-8 ${errors.lotNumber ? "border-destructive" : ""}`} />
                </div>
                {errors.lotNumber && <p className="text-[11px] text-destructive mt-1">Lot number is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Cheque Start Number <span className="text-destructive">*</span></label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="number" value={form.chqStart} onChange={(e) => setField("chqStart", e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g. 100001" className={`${inp} pl-8 font-mono ${errors.chqStart ? "border-destructive" : ""}`} />
                </div>
                {errors.chqStart && <p className="text-[11px] text-destructive mt-1">Start number is required</p>}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Cheque End Number <span className="text-destructive">*</span></label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="number" value={form.chqEnd} onChange={(e) => setField("chqEnd", e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g. 100050" className={`${inp} pl-8 font-mono ${errors.chqEnd ? "border-destructive" : ""}`} />
                </div>
                {errors.chqEnd && <p className="text-[11px] text-destructive mt-1">{Number(form.chqEnd) < Number(form.chqStart) ? "End must be ≥ start" : "End number is required"}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Total Cheques <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">(auto-calculated)</span></label>
                <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-all ${rangeValid ? "bg-primary/5 border-primary/30" : "bg-muted/40 border-border"}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${rangeValid ? "bg-primary/10" : "bg-muted"}`}>
                    <Calculator size={16} className={rangeValid ? "text-primary" : "text-muted-foreground"} />
                  </div>
                  <div>
                    <p className={`text-2xl font-heading font-bold leading-none ${rangeValid ? "text-primary" : "text-muted-foreground/40"}`}>{rangeValid ? totalCheques.toLocaleString() : "—"}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{rangeValid ? `Cheques from ${form.chqStart} to ${form.chqEnd}` : "Enter start and end numbers above"}</p>
                  </div>
                  {rangeValid && <div className="ml-auto text-right hidden sm:block"><p className="text-[10px] font-heading text-muted-foreground uppercase tracking-widest">Range</p><p className="text-xs font-mono text-foreground">{form.chqStart} – {form.chqEnd}</p></div>}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Remarks</label>
                <textarea value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} rows={2} placeholder="Optional notes..." className={inp} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Status</label>
                <button type="button" onClick={() => setField("status", !form.status)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.status ? "bg-primary" : "bg-muted border border-border"}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${form.status ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
              <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"><Plus size={15} />{editingId ? "Update" : "Save"}</button>
              <button onClick={() => { setForm(EMPTY); setEditingId(null); setErrors({}); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all"><RotateCcw size={14} />Reset</button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-card/60">
            <h3 className="font-heading font-semibold text-foreground text-sm">Cheque Lot Records</h3>
          </div>
          <DataTable
            data={dbCheques}
            columns={columns}
            loading={false}
            searchPlaceholder="Search cheque lots..."
            emptyMessage="No cheque lots yet. Add one above."
            rowClassName={(row) => editingId === String(row.original.CId) ? "bg-primary/5 border-l-2 border-l-primary" : ""}
          />
        </div>
      </div>
    </>
  );
};

export default ChequeMaster;
