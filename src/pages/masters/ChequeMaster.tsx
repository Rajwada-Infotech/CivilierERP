import { useState, useMemo, useEffect, useRef } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftFormSync, preventEnterSubmit } from "@/hooks/useDraftForm";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
  ChevronDown,
  Download,
  Upload,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportToCsv, parseCsv } from "@/lib/export";
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
import {
  chequeMasterSchema,
  type ChequeMasterForm,
} from "@/schemas/chequeMasterSchema";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  companyId: string;
  bankId: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  lotNumber: string;
  chqStart: string;
  chqEnd: string;
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

// Extract first 6 chars as the cheque sequence number
function micrSeq(micr: string): number {
  return parseInt(micr.slice(0, 6), 10) || 0;
}

// ChequeStartNumber/ChequeEndNumber are numeric columns, so leading zeros
// (e.g. "000223") are always stripped by the time they reach the DB. The
// full padded cheque number is preserved separately in ChequeStartMICR/
// ChequeEndMICR (stored as text). Display from the MICR string whenever it's
// present; only fall back to the numeric value for legacy rows saved before
// those columns existed, which have no way to recover their original padding.
function displayChequeNo(
  micr: string | null | undefined,
  num: number | null | undefined,
): string {
  if (micr && micr.length >= 6) return micr.slice(0, 6);
  return num != null ? String(num) : "—";
}

// Zero-pads a plain numeric cheque number ("61") to the required 6-digit
// sequence ("000061") on blur, so the user doesn't have to remember to type
// leading zeros every time. Left untouched if it's already 6+ chars (a full
// MICR string) or contains non-digits (a partial MICR paste, not a plain
// cheque number) — only the common "just typed the number" case is padded.
function autoPadChequeNo(v: string): string {
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length >= 6) return trimmed;
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.padStart(6, "0");
}

function calcTotal(start: string, end: string): number {
  if (start.length < 6 || end.length < 6) return 0;
  const s = micrSeq(start);
  const e = micrSeq(end);
  if (e < s) return 0;
  return e - s + 1;
}

// Parse MICR into labelled segments for display
function parseMicr(v: string) {
  const s = v.padEnd(15, " ");
  return {
    chequeNo: s.slice(0, 6),
    cityCode:  s.slice(6, 9),
    bankCode:  s.slice(9, 12),
    branchCode: s.slice(12, 15),
  };
}

// ─── CSV import ───────────────────────────────────────────────────────────────
const CSV_HEADERS = {
  company: "Company Name",
  bank: "Bank Name",
  lotNumber: "Cheque Book Number",
  startNumber: "First Cheque Number",
  endNumber: "Last Cheque Number",
  remarks: "Remarks",
  status: "Status (Active/Inactive)",
} as const;

const CHEQUE_CSV_TEMPLATE_COLUMNS = CSV_HEADERS
  ? Object.values(CSV_HEADERS).map((h) => ({ header: h, accessor: h }))
  : [];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── MICR segment breakdown display ──────────────────────────────────────────
function MicrBreakdown({ value }: { value: string }) {
  const p = parseMicr(value);
  const segments = [
    { label: "Cheque No", val: p.chequeNo, color: "text-primary" },
    { label: "City",      val: p.cityCode,   color: "text-amber-600 dark:text-amber-400" },
    { label: "Bank",      val: p.bankCode,   color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Branch",    val: p.branchCode, color: "text-sky-600 dark:text-sky-400" },
  ];
  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      {segments.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className={`font-mono text-[11px] font-semibold ${s.color}`}>{s.val.trim() || "···"}</span>
          <span className="text-[10px] text-muted-foreground">{s.label}</span>
          {i < segments.length - 1 && <span className="text-muted-foreground/40 text-[10px]">·</span>}
        </span>
      ))}
    </div>
  );
}

const inp =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
const sel =
  "w-full appearance-none pl-3 pr-9 py-2.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

// ─── Column builder ────────────────────────────────────────────────────────────
function buildChequeColumns(
  _editingId: string | null,
  deleteId: string | null,
  setDeleteId: (id: string | null) => void,
  handleEdit: (item: DbCheque) => void,
  handleDelete: (id: string) => void,
  onView: (item: DbCheque) => void,
  onPrint: (item: DbCheque) => void,
  canEdit: boolean,
  canDelete: boolean,
  canPrint: boolean,
): ColumnDef<DbCheque, unknown>[] {
  return [
    {
      id: "bank",
      header: "Bank",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.BankName || "—"}
        </span>
      ),
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
      header: "Cheque Book Number",
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
          {displayChequeNo(row.original.ChequeStartMICR, row.original.ChequeStartNumber)} –{" "}
          {displayChequeNo(row.original.ChequeEndMICR, row.original.ChequeEndNumber)}
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
      header: "Actions",
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
            {canPrint && (
              <button
                onClick={() => onPrint(row.original)}
                className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
                title="Print"
              >
                <Printer size={13} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => handleEdit(row.original)}
                className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-400/10"
              >
                <Edit2 size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteId(id)}
                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10"
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
const ChequeMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("cheque-master");
  const { theme } = useTheme();
  const isDark = theme !== "light";

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
  const {
    reset,
    setValue,
    trigger,
    clearErrors,
    formState: { errors },
  } = useForm<ChequeMasterForm>({
    resolver: zodResolver(chequeMasterSchema),
    defaultValues: EMPTY as ChequeMasterForm,
  });
  const isDirty = (Object.keys(EMPTY) as (keyof FormState)[]).some(
    (k) => form[k] !== EMPTY[k],
  );

  // A refresh used to wipe whatever was typed into the "Add" form —
  // nothing here persisted it. `form` is the real source of truth for
  // field values (react-hook-form here is only used as a validation
  // side-channel — see setValue calls throughout), so rehydrating it also
  // has to push the same values into RHF via setValue, or `errors`/
  // `trigger()` would validate against stale (empty) RHF state instead.
  useDraftFormSync(
    "cheque-master",
    form,
    (draft) => {
      setForm(draft);
      (Object.keys(draft) as (keyof FormState)[]).forEach((k) =>
        setValue(k as any, draft[k] as any),
      );
    },
    EMPTY,
    { skip: editingId !== null },
  );
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<DbCheque | null>(null);

  const handlePrint = (cheque: DbCheque) => {
    const win = window.open("", "_blank", "width=700,height=580");
    if (!win) return;
    win.document.write(safeHtml`
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
        <tr><td>Cheque Book Number</td><td>${cheque.ChequeLotNumber || "—"}</td></tr>
        <tr><td>Cheque Range</td><td>${displayChequeNo(cheque.ChequeStartMICR, cheque.ChequeStartNumber)} → ${displayChequeNo(cheque.ChequeEndMICR, cheque.ChequeEndNumber)}</td></tr>
        <tr><td>Total Cheques</td><td>${cheque.TotalCheques ?? "—"}</td></tr>
        <tr><td>Remarks</td><td>${cheque.Remarks || "—"}</td></tr>
        <tr><td>Status</td><td>${cheque.Status ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // Banks tagged (via BankMaster's Company field) to the currently selected
  // Company. A bank with no company tag at all is left out once a company is
  // chosen — same "explicit tag required" rule CrmProjectBank uses for banks.
  const selectedCompanyLabel = useMemo(
    () => companies.find((c) => String(c.id) === form.companyId)?.label ?? null,
    [companies, form.companyId],
  );
  const banksForCompany = useMemo(() => {
    if (!selectedCompanyLabel) return dbBanks;
    const matches = dbBanks.filter(
      (b) => (b.companyName || "").trim().toLowerCase() === selectedCompanyLabel.trim().toLowerCase(),
    );
    // Keep an already-selected bank visible even if it predates company
    // tagging (or its tag doesn't match) — editing shouldn't blank the field.
    if (form.bankId && !matches.some((b) => String(b.id) === form.bankId)) {
      const current = dbBanks.find((b) => String(b.id) === form.bankId);
      if (current) return [current, ...matches];
    }
    return matches;
  }, [dbBanks, selectedCompanyLabel, form.bankId]);

  const handleCompanyChange = (companyId: string) => {
    // A bank picked under the old company may not belong to the new one —
    // clear it rather than silently save a cheque lot under a mismatched bank.
    setForm((p) => ({
      ...p,
      companyId,
      bankId: "",
      bankName: "",
      accountNumber: "",
      ifscCode: "",
    }));
    setValue("companyId", companyId, { shouldValidate: !!errors.companyId });
    setValue("bankId", "");
    setValue("bankName", "");
    setValue("accountNumber", "");
    setValue("ifscCode", "");
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
    setValue("bankId", bankId, { shouldValidate: !!errors.bankId });
    setValue("bankName", bank?.label || "");
    setValue("accountNumber", bank?.accountNumber || "");
    setValue("ifscCode", bank?.ifscCode || "");
  };

  const setField = (k: keyof FormState, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    setValue(k, v as never, { shouldValidate: !!errors[k] });
  };

  const toPayload = (f: FormState) => ({
    CompanyId: f.companyId ? Number(f.companyId) : null,
    BankId: f.bankId ? Number(f.bankId) : null,
    AccountNumber: f.accountNumber || null,
    IFSCCode: f.ifscCode || null,
    ChequeLotNumber: f.lotNumber || null,
    // Store the full MICR string and also extract the 6-digit seq for DB computed column
    ChequeStartMICR: f.chqStart || null,
    ChequeEndMICR:   f.chqEnd   || null,
    ChequeStartNumber: f.chqStart.length >= 6 ? micrSeq(f.chqStart) : null,
    ChequeEndNumber:   f.chqEnd.length   >= 6 ? micrSeq(f.chqEnd)   : null,
    TotalCheques: f.totalCheques || null,
    Remarks: f.remarks || null,
    Status: f.status,
  });

  const handleEdit = (item: DbCheque) => {
    const bank = dbBanks.find((b) => b.id === item.BankId);
    const nextForm: FormState = {
      companyId: item.CompanyId ? String(item.CompanyId) : "",
      bankId: item.BankId ? String(item.BankId) : "",
      bankName: bank?.label || "",
      accountNumber: item.AccountNumber || "",
      ifscCode: item.IFSCCode || "",
      lotNumber: item.ChequeLotNumber || "",
      chqStart: item.ChequeStartMICR ?? String(item.ChequeStartNumber ?? ""),
      chqEnd:   item.ChequeEndMICR   ?? String(item.ChequeEndNumber   ?? ""),
      totalCheques: item.TotalCheques ?? 0,
      remarks: item.Remarks || "",
      status: item.Status,
    };
    setForm(nextForm);
    reset(nextForm as ChequeMasterForm);
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
        reset(EMPTY as ChequeMasterForm);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const canSave =
    !!form.companyId &&
    !!form.bankId &&
    !!form.lotNumber.trim() &&
    form.chqStart.length >= 6 &&
    form.chqEnd.length >= 6 &&
    micrSeq(form.chqEnd) >= micrSeq(form.chqStart);

  const handleSave = async () => {
    // Defensive re-pad in case Save was reached without a blur event on
    // either field (e.g. Enter-to-submit) — mirrors the onBlur handlers.
    const padded: FormState = {
      ...form,
      chqStart: autoPadChequeNo(form.chqStart),
      chqEnd: autoPadChequeNo(form.chqEnd),
    };
    if (padded.chqStart !== form.chqStart || padded.chqEnd !== form.chqEnd) {
      setForm(padded);
    }
    reset(padded as ChequeMasterForm);
    if (!(await trigger())) return;
    try {
      if (editingId) {
        await updateCheque(editingId, toPayload(padded));
        toast.success("Cheque lot updated!");
      } else {
        await addCheque(toPayload(padded));
        toast.success("Cheque lot saved!");
      }
      await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      setForm(EMPTY);
      reset(EMPTY as ChequeMasterForm);
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    reset(EMPTY as ChequeMasterForm);
    clearErrors();
  };

  // ── CSV import/export ────────────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv([], CHEQUE_CSV_TEMPLATE_COLUMNS, "cheque-master-template");
    toast.success("Template downloaded — fill it in and use Import.");
  };

  const handleImportClick = () => importFileInputRef.current?.click();

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
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
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 2;
        const nameForLog = raw[CSV_HEADERS.lotNumber] || `Row ${rowNum}`;
        try {
          const companyRaw = (raw[CSV_HEADERS.company] || "").trim();
          const bankRaw = (raw[CSV_HEADERS.bank] || "").trim();
          const lotNumber = (raw[CSV_HEADERS.lotNumber] || "").trim();
          const startRaw = (raw[CSV_HEADERS.startNumber] || "").trim();
          const endRaw = (raw[CSV_HEADERS.endNumber] || "").trim();
          const remarks = (raw[CSV_HEADERS.remarks] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!companyRaw) throw new Error("Company Name is required");
          if (!bankRaw) throw new Error("Bank Name is required");
          if (!lotNumber) throw new Error("Lot Number is required");
          if (!startRaw) throw new Error("First Cheque Number is required");
          if (!endRaw)   throw new Error("Last Cheque Number is required");
          if (!/^[A-Za-z0-9]{6}([A-Za-z0-9]{9})?$/.test(startRaw))
            throw new Error(`First Cheque Number must be at least 6 alphanumeric chars (MICR format) — got "${startRaw}"`);
          if (!/^[A-Za-z0-9]{6}([A-Za-z0-9]{9})?$/.test(endRaw))
            throw new Error(`Last Cheque Number must be at least 6 alphanumeric chars (MICR format) — got "${endRaw}"`);

          const companyMatch = companies.find(
            (c) => c.label.toLowerCase() === companyRaw.toLowerCase(),
          );
          if (!companyMatch)
            throw new Error(`Company not found: "${companyRaw}"`);

          const bankMatch = dbBanks.find(
            (b) => b.label.toLowerCase() === bankRaw.toLowerCase(),
          );
          if (!bankMatch) throw new Error(`Bank not found: "${bankRaw}"`);

          const startNum = micrSeq(startRaw);
          const endNum   = micrSeq(endRaw);
          if (endNum < startNum)
            throw new Error(`Last cheque number (${endNum}) must be ≥ first cheque number (${startNum})`);

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

          await addCheque({
            CompanyId: companyMatch.id,
            BankId: bankMatch.id,
            AccountNumber: bankMatch.accountNumber || null,
            IFSCCode: bankMatch.ifscCode || null,
            ChequeLotNumber: lotNumber,
            ChequeStartMICR: startRaw.toUpperCase(),
            ChequeEndMICR:   endRaw.toUpperCase(),
            ChequeStartNumber: startNum,
            ChequeEndNumber:   endNum,
            Remarks: remarks || null,
            Status: isActive,
          });
          results.push({ row: rowNum, name: lotNumber, status: "success" });
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
        await queryClient.invalidateQueries({ queryKey: ["cheques"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} cheque lot${successCount === 1 ? "" : "s"} ✓`,
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

  const columns = useMemo(
    () =>
      buildChequeColumns(
        editingId,
        deleteId,
        setDeleteId,
        handleEdit,
        handleDelete,
        setViewRow,
        handlePrint,
        rights.canEdit,
        rights.canDelete,
        rights.canPrint,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteId, dbBanks, rights.canEdit, rights.canDelete, rights.canPrint],
  );

  // Auto-recalculate total
  useEffect(() => {
    setForm((p) => {
      const totalCheques = calcTotal(p.chqStart, p.chqEnd);
      setValue("totalCheques", totalCheques);
      return { ...p, totalCheques };
    });
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
    form.chqStart.length >= 6 &&
    form.chqEnd.length >= 6 &&
    micrSeq(form.chqEnd) >= micrSeq(form.chqStart);

  if (loadingCheques || loadingBanks)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Cheque Master"]} />
      <FinanceShell
        title="Cheque Master"
        subtitle="Register and manage cheque books / lots with bank and lot details"
        icon={BookOpen}
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
              {dbCheques.length} Lots
            </span>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV template"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import cheque lots from CSV"
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
          </div>
        }
      >
        {/* Form */}
        {rights.canCreate && (
        <div
          className="rounded-xl overflow-hidden"
          onKeyDown={preventEnterSubmit}
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
                {editingId ? "Edit Cheque Lot" : "Add Cheque Lot"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are
                required
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            {/* ── Section: Bank Details ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Landmark size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Bank Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {/* Company */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Company <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={form.companyId}
                      onChange={(e) => handleCompanyChange(e.target.value)}
                      className={`${sel} ${errors.companyId ? "border-destructive" : ""}`}
                    >
                      <option value="">Select Company...</option>
                      {companies.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {errors.companyId && (
                    <p className="text-xs text-destructive mt-1">
                      Company is required
                    </p>
                  )}
                </div>

                {/* Bank */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Bank Name <span className="text-destructive">*</span>
                    {form.companyId && (
                      <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
                        ({selectedCompanyLabel} only)
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <Landmark
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <select
                      value={form.bankId}
                      onChange={(e) => handleBankChange(e.target.value)}
                      className={`${sel} pl-8 ${errors.bankId ? "border-destructive" : ""}`}
                    >
                      <option value="">Select Bank...</option>
                      {banksForCompany.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.label}
                          {b.branchName ? ` — ${b.branchName}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {errors.bankId && (
                    <p className="text-xs text-destructive mt-1">
                      Bank is required
                    </p>
                  )}
                  {!errors.bankId && form.companyId && banksForCompany.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No banks are tagged to {selectedCompanyLabel} yet — add one in Bank Master.
                    </p>
                  )}
                </div>

                {/* Account Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Account Number <span className="text-destructive">*</span>
                    <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
                      (auto-filled)
                    </span>
                  </label>
                  <div className="relative">
                    <Hash
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="text"
                      value={form.accountNumber}
                      onChange={(e) =>
                        setField("accountNumber", e.target.value)
                      }
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
                    <p className="text-xs text-destructive mt-1">
                      Account number is required
                    </p>
                  )}
                </div>

                {/* IFSC */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    IFSC Code
                    <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
                      (auto-filled)
                    </span>
                  </label>
                  <div className="relative">
                    <Hash
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
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
              </div>
            </div>

            {/* ── Section: Cheque Lot ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <BookOpen size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Cheque Lot
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Cheque Book Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Cheque Book Number <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <BookOpen
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
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
                    <p className="text-xs text-destructive mt-1">
                      Cheque book number is required
                    </p>
                  )}
                </div>

                {/* First Cheque Number (MICR) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    First Cheque Number <span className="text-destructive">*</span>
                    <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
                      (6 digits, or full 15-char MICR)
                    </span>
                  </label>
                  <div className="relative">
                    <FileText size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      maxLength={15}
                      value={form.chqStart}
                      onChange={(e) => setField("chqStart", e.target.value.toUpperCase())}
                      onBlur={(e) => setField("chqStart", autoPadChequeNo(e.target.value.toUpperCase()))}
                      placeholder="e.g. 600001"
                      className={`${inp} pl-8 font-mono tracking-widest ${errors.chqStart ? "border-destructive" : ""}`}
                    />
                  </div>
                  {form.chqStart.length > 0 && (
                    <MicrBreakdown value={form.chqStart} />
                  )}
                  {errors.chqStart && (
                    <p className="text-xs text-destructive mt-1">Enter at least the 6-digit cheque number</p>
                  )}
                </div>

                {/* Last Cheque Number (MICR) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Last Cheque Number <span className="text-destructive">*</span>
                    <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
                      (6 digits, or full 15-char MICR)
                    </span>
                  </label>
                  <div className="relative">
                    <FileText size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      maxLength={15}
                      value={form.chqEnd}
                      onChange={(e) => setField("chqEnd", e.target.value.toUpperCase())}
                      onBlur={(e) => setField("chqEnd", autoPadChequeNo(e.target.value.toUpperCase()))}
                      placeholder="e.g. 600050"
                      className={`${inp} pl-8 font-mono tracking-widest ${errors.chqEnd ? "border-destructive" : ""}`}
                    />
                  </div>
                  {form.chqEnd.length > 0 && (
                    <MicrBreakdown value={form.chqEnd} />
                  )}
                  {errors.chqEnd && (
                    <p className="text-xs text-destructive mt-1">
                      {micrSeq(form.chqEnd) < micrSeq(form.chqStart)
                        ? "Last cheque number must be ≥ first"
                        : "Enter at least the 6-digit cheque number"}
                    </p>
                  )}
                </div>

                {/* Total Cheques */}
                <div className="space-y-1.5 sm:col-span-3">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Total Cheques
                    <span className="normal-case text-[10px] text-muted-foreground/60 font-normal">
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
              </div>
            </div>

            {/* ── Section: Additional ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <FileText size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Additional
                </p>
              </div>
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
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
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setField("status", !form.status)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${form.status ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.status ? "translate-x-4" : "translate-x-0.5"}`}
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
            </div>
          </div>

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
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {editingId ? <Check size={14} /> : <Plus size={14} />}
                {editingId ? "Update Lot" : "Save Lot"}
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Table */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div className="min-w-0 flex-1 mr-3">
              <h3 className="font-heading font-semibold text-foreground text-sm">
                Cheque Lot Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} lot{filtered.length !== 1 ? "s" : ""}
                {filtered.length > 0 && (
                  <span className="ml-1 text-primary font-semibold">
                    ·{" "}
                    {filtered
                      .reduce((s, r) => s + Number(r.TotalCheques || 0), 0)
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
              defaultPageSize={10}
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
      </FinanceShell>

      {/* Import Results Modal */}
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
                  label: "Cheque Book Number",
                  value: viewRow.ChequeLotNumber,
                  mono: true,
                },
                {
                  label: "Cheque Range",
                  value: `${displayChequeNo(viewRow.ChequeStartMICR, viewRow.ChequeStartNumber)} → ${displayChequeNo(viewRow.ChequeEndMICR, viewRow.ChequeEndNumber)}`,
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