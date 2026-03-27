import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
} from "lucide-react";
import { toast } from "sonner";

// ── Bank seed data (mirrors BankMaster, includes IFSC) ──────────────────────
const BANK_OPTIONS = [
  { bankName: "HDFC Bank", ifsc: "HDFC0001234", branch: "Andheri West" },
  { bankName: "State Bank of India", ifsc: "SBIN0001111", branch: "Main Branch" },
  { bankName: "ICICI Bank", ifsc: "ICIC0002222", branch: "Koregaon Park" },
];

// ── Types ────────────────────────────────────────────────────────────────────
interface ChequeRecord {
  _id: string;
  bankName: string;
  ifsc: string;
  lotNumber: string;
  chqStart: number | "";
  chqEnd: number | "";
  totalCheques: number;
  remarks: string;
  status: boolean;
}

function calcTotal(start: number | "", end: number | ""): number {
  if (start === "" || end === "" || Number(end) < Number(start)) return 0;
  return Number(end) - Number(start) + 1;
}

const SEED: ChequeRecord[] = [
  {
    _id: "chq-seed-1",
    bankName: "HDFC Bank",
    ifsc: "HDFC0001234",
    lotNumber: "LOT-2024-001",
    chqStart: 100001,
    chqEnd: 100050,
    totalCheques: 50,
    remarks: "First lot of cheques",
    status: true,
  },
  {
    _id: "chq-seed-2",
    bankName: "State Bank of India",
    ifsc: "SBIN0001111",
    lotNumber: "LOT-2024-002",
    chqStart: 200101,
    chqEnd: 200150,
    totalCheques: 50,
    remarks: "Vendor payments",
    status: true,
  },
];

const EMPTY: Omit<ChequeRecord, "_id"> = {
  bankName: "",
  ifsc: "",
  lotNumber: "",
  chqStart: "",
  chqEnd: "",
  totalCheques: 0,
  remarks: "",
  status: true,
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

// ── Component ────────────────────────────────────────────────────────────────
const ChequeMaster: React.FC = () => {
  const [data, setData] = useState<ChequeRecord[]>(SEED);
  const [form, setForm] = useState<Omit<ChequeRecord, "_id">>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Auto-recalculate total whenever start/end changes
  useEffect(() => {
    setForm((p) => ({ ...p, totalCheques: calcTotal(p.chqStart, p.chqEnd) }));
  }, [form.chqStart, form.chqEnd]);

  // Auto-fill IFSC when bank changes
  const handleBankChange = (bankName: string) => {
    const bank = BANK_OPTIONS.find((b) => b.bankName === bankName);
    setForm((p) => ({
      ...p,
      bankName,
      ifsc: bank?.ifsc ?? "",
    }));
    if (errors.bankName) setErrors((e) => ({ ...e, bankName: false }));
  };

  const setField = (k: keyof typeof EMPTY, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.bankName) e.bankName = true;
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

  const handleSave = () => {
    if (!validate()) return;
    const total = calcTotal(form.chqStart, form.chqEnd);
    if (editingId) {
      setData((p) =>
        p.map((r) =>
          r._id === editingId ? { ...form, totalCheques: total, _id: editingId } : r
        )
      );
      setEditingId(null);
      toast.success("Cheque lot updated ✓");
    } else {
      const rec: ChequeRecord = { ...form, totalCheques: total, _id: `chq-${Date.now()}` };
      setData((p) => [...p, rec]);
      toast.success("Cheque lot saved ✓");
    }
    setForm(EMPTY);
  };

  const handleEdit = (id: string) => {
    const r = data.find((x) => x._id === id);
    if (!r) return;
    const { _id, ...rest } = r;
    setForm(rest);
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    setData((p) => p.filter((r) => r._id !== id));
    setDeleteId(null);
    if (editingId === id) { setEditingId(null); setForm(EMPTY); }
    toast.success("Cheque lot deleted");
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.bankName.toLowerCase().includes(q) ||
      r.lotNumber.toLowerCase().includes(q) ||
      r.ifsc.toLowerCase().includes(q) ||
      String(r.chqStart).includes(q) ||
      String(r.chqEnd).includes(q)
    );
  });

  const totalCheques = calcTotal(form.chqStart, form.chqEnd);
  const rangeValid =
    form.chqStart !== "" &&
    form.chqEnd !== "" &&
    Number(form.chqEnd) >= Number(form.chqStart);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Cheque Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Cheque Master</h1>

      <div className="space-y-5">
        {/* ── FORM CARD ── */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Cheque Lot" : "Add Cheque Lot"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId ? "Modify cheque lot details below." : "Register a new cheque book / lot."}
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

              {/* Bank Name dropdown */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Bank Name <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Landmark size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={form.bankName}
                    onChange={(e) => handleBankChange(e.target.value)}
                    className={`${inp} pl-8 ${errors.bankName ? "border-destructive" : ""}`}
                  >
                    <option value="">Select Bank...</option>
                    {BANK_OPTIONS.map((b) => (
                      <option key={b.bankName} value={b.bankName}>{b.bankName}</option>
                    ))}
                  </select>
                </div>
                {errors.bankName && <p className="text-[11px] text-destructive mt-1">Bank is required</p>}
              </div>

              {/* IFSC — auto-filled, read-only with visual indicator */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  IFSC Code
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">(auto-filled from bank)</span>
                </label>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={form.ifsc}
                    readOnly
                    placeholder="Auto-filled on bank selection"
                    className={`${inp} pl-8 font-mono tracking-widest bg-muted/50 cursor-default text-muted-foreground`}
                  />
                  {form.ifsc && (
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
                  <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={form.lotNumber}
                    onChange={(e) => setField("lotNumber", e.target.value)}
                    placeholder="e.g. LOT-2024-001"
                    className={`${inp} pl-8 ${errors.lotNumber ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.lotNumber && <p className="text-[11px] text-destructive mt-1">Lot number is required</p>}
              </div>

              {/* Cheque Start Number */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Cheque Start Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="number"
                    value={form.chqStart}
                    onChange={(e) =>
                      setField("chqStart", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g. 100001"
                    className={`${inp} pl-8 font-mono ${errors.chqStart ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.chqStart && <p className="text-[11px] text-destructive mt-1">Start number is required</p>}
              </div>

              {/* Cheque End Number */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Cheque End Number <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="number"
                    value={form.chqEnd}
                    onChange={(e) =>
                      setField("chqEnd", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g. 100050"
                    className={`${inp} pl-8 font-mono ${errors.chqEnd ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.chqEnd && (
                  <p className="text-[11px] text-destructive mt-1">
                    {Number(form.chqEnd) < Number(form.chqStart)
                      ? "End number must be ≥ start number"
                      : "End number is required"}
                  </p>
                )}
              </div>

              {/* Total Cheques — calculated display, full width */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Total Cheques in Lot
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/60">(auto-calculated)</span>
                </label>
                <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-all ${
                  rangeValid
                    ? "bg-primary/5 border-primary/30"
                    : "bg-muted/40 border-border"
                }`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    rangeValid ? "bg-primary/10" : "bg-muted"
                  }`}>
                    <Calculator size={16} className={rangeValid ? "text-primary" : "text-muted-foreground"} />
                  </div>
                  <div>
                    <p className={`text-2xl font-heading font-bold leading-none ${
                      rangeValid ? "text-primary" : "text-muted-foreground/40"
                    }`}>
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
                      <p className="text-[10px] font-heading text-muted-foreground uppercase tracking-widest">Range</p>
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
                  placeholder="Optional notes about this cheque lot..."
                  className={inp}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Status</label>
                <button
                  type="button"
                  onClick={() => setField("status", !form.status)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.status ? "bg-primary" : "bg-muted border border-border"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${form.status ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border">
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all"
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

        {/* ── TABLE CARD ── */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">Cheque Lot Records</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} lot{filtered.length !== 1 ? "s" : ""}
                {filtered.length > 0 && (
                  <span className="ml-2 text-primary font-semibold">
                    · {filtered.reduce((s, r) => s + r.totalCheques, 0).toLocaleString()} total cheques
                  </span>
                )}
              </p>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">Bank</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap hidden sm:table-cell">IFSC</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">Lot No.</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap hidden md:table-cell">Chq Start</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap hidden md:table-cell">Chq End</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">Total Chqs</th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-sm">
                      {search ? "No cheque lots match your search." : "No cheque lots yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr
                      key={row._id}
                      className={`hover:bg-muted/20 transition-colors ${editingId === row._id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                    >
                      <td className="px-4 py-3 text-foreground text-sm font-body">{row.bankName}</td>

                      <td className="px-4 py-3 text-foreground text-sm font-mono hidden sm:table-cell">
                        {row.ifsc ? (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{row.ifsc}</span>
                        ) : "—"}
                      </td>

                      <td className="px-4 py-3 text-foreground text-sm font-heading font-medium">{row.lotNumber}</td>

                      <td className="px-4 py-3 text-foreground text-sm font-mono hidden md:table-cell">{row.chqStart}</td>
                      <td className="px-4 py-3 text-foreground text-sm font-mono hidden md:table-cell">{row.chqEnd}</td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary font-heading font-semibold text-sm">
                          <Calculator size={11} />
                          {row.totalCheques.toLocaleString()}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
                          row.status
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${row.status ? "bg-primary" : "bg-destructive"}`} />
                          {row.status ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {deleteId === row._id ? (
                            <>
                              <span className="text-[11px] text-muted-foreground mr-1">Confirm?</span>
                              <button onClick={() => handleDelete(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors" title="Confirm delete">
                                <Check size={13} />
                              </button>
                              <button onClick={() => setDeleteId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors" title="Cancel">
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleEdit(row._id)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors" title="Edit">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => setDeleteId(row._id)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default ChequeMaster;
