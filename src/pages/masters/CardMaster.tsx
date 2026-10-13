import React, { useState, useMemo, useRef } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftFormSync, preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  CreditCard,
  Eye,
  EyeOff,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  X,
  Search,
  Landmark,
  Hash,
  ShieldAlert,
  CalendarDays,
  Bell,
  BellRing,
  Clock,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  Loader2,
} from "lucide-react";
import {
  getCards,
  getBanksForCard,
  getCompanyOptions,
  addCard,
  updateCard,
  deleteCard,
  type DbCard,
  type BankOption,
  type CompanyOption,
} from "@/api/cardMasterApi";
import {
  cardMasterSchema,
  type CardMasterForm,
} from "@/schemas/cardMasterSchema";
import { exportToCsv, parseCsv } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BodyPortal } from "@/components/ui/body-portal";
import { MonthInput } from "@/components/ui/date-input";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CardRecord {
  _id: string;
  companyName: string;
  bankId: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  network: string;
  cardType: string;
  cardHolder: string;
  cardNumber: string;
  cvv: string;
  expiryDate: string; // MM/YY display format
  expiryMonth: number;
  expiryYear: number;
  reminderEnabled: boolean;
  reminderDays: number;
  status: boolean;
  reminderDismissed: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CARD_NETWORKS = ["Visa", "Mastercard", "RuPay", "Amex", "Diners Club"];
const CARD_TYPES = ["Debit", "Credit", "Prepaid", "Corporate"];
const DEFAULT_REMINDER_DAYS = 30;

function parseExpiryToDate(expiry: string): Date | null {
  if (!/^\d{2}\/\d{2}$/.test(expiry)) return null;
  const [m, y] = expiry.split("/");
  const month = parseInt(m) - 1;
  const year = 2000 + parseInt(y);
  return new Date(year, month + 1, 0);
}

function calculateReminderDate(expiry: string, days: number): string {
  const d = parseExpiryToDate(expiry);
  if (!d) return "";
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysFromNow(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso).getTime() - today.getTime()) / 86400000);
}

function masked(num: string) {
  const last4 = num.replace(/\D/g, "").slice(-4).padStart(4, "X");
  return `•••• •••• •••• ${last4}`;
}

function formatted(num: string) {
  return num
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

const inp =
  "w-full px-3 py-2.5 text-sm bg-card border border-foreground/40 focus:border-foreground focus:outline-none text-foreground placeholder:text-muted-foreground/50";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const FIG = "font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";

type FormState = Omit<CardRecord, "_id" | "reminderDismissed">;

const EMPTY: FormState = {
  companyName: "",
  bankId: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  network: "",
  cardType: "",
  cardHolder: "",
  cardNumber: "",
  cvv: "",
  expiryDate: "",
  expiryMonth: 0,
  expiryYear: 0,
  reminderEnabled: true,
  reminderDays: DEFAULT_REMINDER_DAYS,
  status: true,
};

// ─── CSV import ───────────────────────────────────────────────────────────────
const CSV_HEADERS = {
  company: "Company Name",
  bank: "Bank Name",
  cardHolder: "Card Holder Name",
  cardNumber: "Card Number",
  cvv: "CVV",
  expiry: "Expiry (MM/YY)",
  network: "Card Network",
  cardType: "Card Type",
  reminderEnabled: "Reminder Enabled (Yes/No)",
  reminderDays: "Reminder Days",
  status: "Status (Active/Inactive)",
} as const;

const CARD_CSV_TEMPLATE_COLUMNS = Object.values(CSV_HEADERS).map((h) => ({
  header: h,
  accessor: h,
}));

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── Reminder Banner ──────────────────────────────────────────────────────────
const ReminderBanner: React.FC<{
  cards: CardRecord[];
  onDismiss: (id: string) => void;
  onAddNew: () => void;
}> = ({ cards, onDismiss, onAddNew }) => {
  const reminderDate = (c: CardRecord) =>
    c.reminderEnabled && c.expiryDate
      ? calculateReminderDate(c.expiryDate, c.reminderDays)
      : "";

  const due = cards.filter(
    (c) =>
      !c.reminderDismissed &&
      c.reminderEnabled &&
      reminderDate(c) &&
      daysFromNow(reminderDate(c)) <= 0,
  );
  const upcoming = cards.filter(
    (c) =>
      !c.reminderDismissed &&
      c.reminderEnabled &&
      reminderDate(c) &&
      daysFromNow(reminderDate(c)) > 0 &&
      daysFromNow(reminderDate(c)) <= 7,
  );

  if (!due.length && !upcoming.length) return null;

  const notice = (card: CardRecord, rd: string, overdue: boolean, text: string, when: string) => (
    <div
      key={card._id}
      className="bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ border: `1px solid hsl(var(--${overdue ? "destructive" : "foreground"}))` }}
    >
      <div className="flex-1 min-w-0">
        <SheetMark text={text} tone={overdue ? "stopped" : "waiting"} />
        <p className="text-xs text-muted-foreground mt-1.5">
          <span className="font-medium text-foreground">{card.bankName}</span>
          {" · "}
          <span className="font-heading tabular-nums">{masked(card.cardNumber)}</span>
          {` · ${when} `}
          <span className="font-medium text-foreground tabular-nums">{formatDisplayDate(rd)}</span>
        </p>
      </div>
      <div className="flex items-center gap-2 sm:ml-auto">
        <button
          onClick={onAddNew}
          className={`${KEY} px-3 py-2 border ${overdue ? "border-destructive bg-destructive text-destructive-foreground" : "border-foreground text-foreground hover:bg-primary/10"}`}
        >
          <Plus size={12} /> Add new card
        </button>
        <button onClick={() => onDismiss(card._id)} className={ACT} title="Dismiss" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {due.map((card) => {
        const rd = reminderDate(card);
        const overdue = Math.abs(daysFromNow(rd));
        return notice(card, rd, true, `Overdue by ${overdue} day${overdue !== 1 ? "s" : ""}`, "was due on");
      })}
      {upcoming.map((card) => {
        const rd = reminderDate(card);
        const inDays = daysFromNow(rd);
        return notice(card, rd, false, `Due in ${inDays} day${inDays !== 1 ? "s" : ""}`, "reminder on");
      })}
    </div>
  );
};

// ─── Column builder ───────────────────────────────────────────────────────────
function buildCardColumns(
  editingId: string | null,
  deleteId: string | null,
  setDeleteId: (id: string | null) => void,
  handleEdit: (id: string) => void,
  handleDelete: (id: string) => void,
  revealedRows: Record<string, boolean>,
  setRevealedRows: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >,
  dismissed: string[],
  setDismissed: React.Dispatch<React.SetStateAction<string[]>>,
  calculateReminderDate: (expiry: string, days: number) => string,
  daysFromNow: (iso: string) => number,
  onView: (card: CardRecord) => void,
  canEdit: boolean,
  canDelete: boolean,
): ColumnDef<CardRecord, unknown>[] {
  return [
    {
      accessorKey: "companyName",
      header: "Company",
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "bankName",
      header: "Bank",
      cell: ({ getValue }) => <span className="font-medium text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "cardNumber",
      header: "Card Number",
      cell: ({ row }) => {
        const id = row.original._id;
        const num = row.original.cardNumber;
        const revealed = revealedRows[id];
        return (
          <div className="flex items-center gap-1.5">
            <span className={`${FIG} tracking-wide whitespace-nowrap`}>{revealed ? formatted(num) : masked(num)}</span>
            <button
              onClick={() => setRevealedRows((p) => ({ ...p, [id]: !p[id] }))}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title={revealed ? "Hide number" : "Show number"}
              aria-label={revealed ? "Hide number" : "Show number"}
            >
              {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        );
      },
    },
    {
      accessorKey: "cardHolder",
      header: "Card Holder",
      cell: ({ getValue }) => <span className="text-xs text-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "network",
      header: "Network",
      cell: ({ getValue }) => <span className={LBL}>{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "cardType",
      header: "Type",
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "expiryDate",
      header: "Expiry",
      cell: ({ getValue, row }) => {
        const val = getValue() as string;
        // A card past its reminder date (and not dismissed) is the one figure here that turns red.
        const c = row.original;
        const rd = c.reminderEnabled && val ? calculateReminderDate(val, c.reminderDays) : "";
        const late = !!rd && !dismissed.includes(c._id) && daysFromNow(rd) <= 0;
        return <span className={`font-heading text-[0.6875rem] font-semibold tabular-nums ${late ? "text-destructive" : "text-foreground"}`}>{val || "—"}</span>;
      },
    },
    {
      accessorKey: "status",
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
      cell: ({ row }) => {
        const id = row.original._id;
        return (
          <div className="flex items-center justify-end gap-1">
            <button data-row-view onClick={() => onView(row.original)} className={ACT} title="View details" aria-label="View details">
              <Eye size={13} />
            </button>
            {canEdit && (
              <button onClick={() => handleEdit(id)} className={ACT} title="Edit" aria-label="Edit">
                <Edit2 size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteId(id)}
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
const CardMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("card-master");
  const { data: dbData, isLoading: loadingCards } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
    staleTime: 5 * 60 * 1000,
  });
  const { data: bankData, isLoading: loadingBanks } = useQuery<BankOption[]>({
    queryKey: ["account-head-bank-options"],
    queryFn: getBanksForCard,
    staleTime: 5 * 60 * 1000,
  });
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["enterprise-options"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbCard[] = Array.isArray(dbData) ? dbData : [];
  const dbBanks: BankOption[] = Array.isArray(bankData) ? bankData : [];

  const cards: CardRecord[] = dbItems.map((item) => {
    const mm = String(item.expiry_month ?? 0).padStart(2, "0");
    const yy = String(item.expiry_year ?? 0).slice(-2);
    // Prefer the real bank_id FK; fall back to matching by name for
    // legacy rows saved before bank_id existed.
    const matchedBank = item.bank_id
      ? dbBanks.find((b) => b.id === item.bank_id)
      : dbBanks.find((b) => b.label === item.bank_name);
    return {
      _id: String(item.id),
      companyName: item.company_name || "",
      bankId: item.bank_id
        ? String(item.bank_id)
        : matchedBank
          ? String(matchedBank.id)
          : "",
      bankName: item.bank_name || "",
      accountNumber: item.account_number || "",
      ifscCode: item.ifsc_code || "",
      network: item.card_network || "",
      cardType: item.card_type || "",
      cardHolder: item.card_holder_name || "",
      cardNumber: item.card_number || "",
      cvv: item.cvv || "",
      expiryDate: item.expiry_month && item.expiry_year ? `${mm}/${yy}` : "",
      expiryMonth: item.expiry_month ?? 0,
      expiryYear: item.expiry_year ?? 0,
      reminderEnabled: item.reminder_enabled,
      reminderDays: item.reminder_days ?? DEFAULT_REMINDER_DAYS,
      status: item.status,
      reminderDismissed: false,
    };
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const {
    reset,
    setValue,
    trigger,
    clearErrors,
    formState: { errors },
  } = useForm<CardMasterForm>({
    resolver: zodResolver(cardMasterSchema),
    defaultValues: EMPTY,
  });
  const isDirty = (Object.keys(EMPTY) as (keyof FormState)[]).some(
    (k) => form[k] !== EMPTY[k],
  );

  // A refresh used to wipe whatever was typed into the "Add" form —
  // nothing here persisted it. `form` is the real source of truth for
  // field values (react-hook-form here is only used as a validation
  // side-channel), so rehydrating it also has to push the same values
  // into RHF via setValue, or `errors`/`trigger()` would validate
  // against stale (empty) RHF state instead.
  useDraftFormSync(
    "card-master",
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

  const [revealedRows, setRevealedRows] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showCvc, setShowCvc] = useState(false);
  const [showFormCard, setShowFormCard] = useState(false);
  const [showReminderPanel, setShowReminderPanel] = useState(true);
  const [viewRecord, setViewRecord] = useState<CardRecord | null>(null);
  const [drawerRevealed, setDrawerRevealed] = useState(false);

  const cardsWithDismiss = cards.map((c) => ({
    ...c,
    reminderDismissed: dismissed.includes(c._id),
  }));

  const previewReminderDate = useMemo(() => {
    if (!form.reminderEnabled || !form.reminderDays || !form.expiryDate)
      return null;
    return calculateReminderDate(form.expiryDate, form.reminderDays);
  }, [form.reminderEnabled, form.reminderDays, form.expiryDate]);

  const setField = (k: keyof FormState, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    setValue(k, v as never, { shouldValidate: !!errors[k] });
  };

  // ── Bank dropdown handler — auto-fills account number & IFSC ──────────────
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

  const handleExpiry = (val: string) => {
    let v = val.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    setField("expiryDate", v);
    if (v.length === 5) {
      const [m, y] = v.split("/");
      const expiryMonth = parseInt(m);
      const expiryYear = 2000 + parseInt(y);
      setForm((p) => ({
        ...p,
        expiryMonth,
        expiryYear,
      }));
      setValue("expiryMonth", expiryMonth);
      setValue("expiryYear", expiryYear);
    }
  };

  const validate = async () => {
    reset(form);
    return trigger();
  };

  const toPayload = (f: FormState) => ({
    company_name: f.companyName || null,
    bank_id: f.bankId ? Number(f.bankId) : null,
    bank_name: f.bankName || null,
    account_number: f.accountNumber || null,
    ifsc_code: f.ifscCode || null,
    card_network: f.network || null,
    card_type: f.cardType || null,
    card_holder_name: f.cardHolder || null,
    card_number: f.cardNumber || null,
    cvv: f.cvv || null,
    expiry_month: f.expiryMonth || null,
    expiry_year: f.expiryYear || null,
    reminder_enabled: f.reminderEnabled,
    reminder_days: f.reminderDays || null,
    status: f.status,
  });

  const canSave =
    !!form.bankId &&
    form.cardNumber.replace(/\D/g, "").length >= 13 &&
    form.cvv.length >= 3 &&
    form.expiryDate.length === 5;

  const handleSave = async () => {
    if (!(await validate())) return;
    try {
      if (editingId) {
        await updateCard(editingId, toPayload(form));
        toast.success("Card updated!");
      } else {
        await addCard(toPayload(form));
        toast.success(
          form.reminderEnabled && previewReminderDate
            ? `Card saved · Reminder set for ${formatDisplayDate(previewReminderDate)}`
            : "Card saved!",
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["cards"] });
      setForm(EMPTY);
      reset(EMPTY);
      setEditingId(null);
      setShowCvc(false);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleEdit = (id: string) => {
    const r = cards.find((x) => x._id === id);
    if (!r) return;
    const nextForm = {
      companyName: r.companyName,
      bankId: r.bankId,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      ifscCode: r.ifscCode,
      network: r.network,
      cardType: r.cardType,
      cardHolder: r.cardHolder,
      cardNumber: r.cardNumber,
      cvv: r.cvv,
      expiryDate: r.expiryDate,
      expiryMonth: r.expiryMonth,
      expiryYear: r.expiryYear,
      reminderEnabled: r.reminderEnabled,
      reminderDays: r.reminderDays,
      status: r.status,
    };
    setForm(nextForm);
    reset(nextForm);
    setEditingId(id);
    setShowCvc(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCard(id);
      toast.success("Card deleted!");
      await queryClient.invalidateQueries({ queryKey: ["cards"] });
      setDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY);
        reset(EMPTY);
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const columns = useMemo(
    () =>
      buildCardColumns(
        editingId,
        deleteId,
        setDeleteId,
        handleEdit,
        handleDelete,
        revealedRows,
        setRevealedRows,
        dismissed,
        setDismissed,
        calculateReminderDate,
        daysFromNow,
        setViewRecord,
        rights.canEdit,
        rights.canDelete,
      ),
    [editingId, deleteId, revealedRows, dismissed, rights.canEdit, rights.canDelete],
  );

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    reset(EMPTY);
    clearErrors();
    setShowCvc(false);
  };

  // ── CSV import/export ────────────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv([], CARD_CSV_TEMPLATE_COLUMNS, "card-master-template");
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
        const nameForLog = raw[CSV_HEADERS.cardHolder] || `Row ${rowNum}`;
        try {
          const companyRaw = (raw[CSV_HEADERS.company] || "").trim();
          const bankRaw = (raw[CSV_HEADERS.bank] || "").trim();
          const cardHolder = (raw[CSV_HEADERS.cardHolder] || "").trim();
          const cardNumberRaw = (raw[CSV_HEADERS.cardNumber] || "").replace(
            /\D/g,
            "",
          );
          const cvvRaw = (raw[CSV_HEADERS.cvv] || "").replace(/\D/g, "");
          const expiryRaw = (raw[CSV_HEADERS.expiry] || "").trim();
          const networkRaw = (raw[CSV_HEADERS.network] || "").trim();
          const cardTypeRaw = (raw[CSV_HEADERS.cardType] || "").trim();
          const reminderEnabledRaw = (raw[CSV_HEADERS.reminderEnabled] || "")
            .trim()
            .toLowerCase();
          const reminderDaysRaw = (raw[CSV_HEADERS.reminderDays] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!bankRaw) throw new Error("Bank Name is required");
          if (cardNumberRaw.length < 13)
            throw new Error(
              `Card Number must be at least 13 digits (got "${raw[CSV_HEADERS.cardNumber]}")`,
            );
          if (cvvRaw.length < 3 || cvvRaw.length > 4)
            throw new Error(
              `CVV must be 3–4 digits (got "${raw[CSV_HEADERS.cvv]}")`,
            );
          if (!/^\d{2}\/\d{2}$/.test(expiryRaw))
            throw new Error(`Expiry must be MM/YY format (got "${expiryRaw}")`);

          const bankMatch = dbBanks.find(
            (b) => b.label.toLowerCase() === bankRaw.toLowerCase(),
          );
          if (!bankMatch) throw new Error(`Bank not found: "${bankRaw}"`);

          const companyMatch = companyRaw
            ? companies.find(
                (c) => c.label.toLowerCase() === companyRaw.toLowerCase(),
              )
            : null;
          if (companyRaw && !companyMatch)
            throw new Error(`Company not found: "${companyRaw}"`);

          const network = networkRaw
            ? CARD_NETWORKS.find(
                (n) => n.toLowerCase() === networkRaw.toLowerCase(),
              )
            : undefined;
          if (networkRaw && !network)
            throw new Error(
              `Card Network must be one of ${CARD_NETWORKS.join(", ")} (got "${networkRaw}")`,
            );

          const cardType = cardTypeRaw
            ? CARD_TYPES.find(
                (t) => t.toLowerCase() === cardTypeRaw.toLowerCase(),
              )
            : undefined;
          if (cardTypeRaw && !cardType)
            throw new Error(
              `Card Type must be one of ${CARD_TYPES.join(", ")} (got "${cardTypeRaw}")`,
            );

          const [mm, yy] = expiryRaw.split("/");
          const expiryMonth = parseInt(mm);
          const expiryYear = 2000 + parseInt(yy);
          if (expiryMonth < 1 || expiryMonth > 12)
            throw new Error(`Expiry month must be 01–12 (got "${mm}")`);

          const reminderEnabled =
            reminderEnabledRaw === "" || reminderEnabledRaw === "yes"
              ? true
              : reminderEnabledRaw === "no"
                ? false
                : null;
          if (reminderEnabled === null)
            throw new Error(
              `Reminder Enabled must be "Yes" or "No" (got "${raw[CSV_HEADERS.reminderEnabled]}")`,
            );

          let reminderDays = DEFAULT_REMINDER_DAYS;
          if (reminderDaysRaw !== "") {
            const d = parseInt(reminderDaysRaw);
            if (isNaN(d) || d < 1)
              throw new Error(
                `Reminder Days must be a positive integer (got "${reminderDaysRaw}")`,
              );
            reminderDays = d;
          }

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

          await addCard({
            company_name: companyMatch ? companyMatch.label : null,
            bank_id: bankMatch.id,
            bank_name: bankMatch.label,
            account_number: bankMatch.accountNumber || null,
            ifsc_code: bankMatch.ifscCode || null,
            card_network: network || null,
            card_type: cardType || null,
            card_holder_name: cardHolder || null,
            card_number: cardNumberRaw,
            cvv: cvvRaw,
            expiry_month: expiryMonth,
            expiry_year: expiryYear,
            reminder_enabled: reminderEnabled,
            reminder_days: reminderDays,
            status: isActive,
          });
          results.push({
            row: rowNum,
            name: cardHolder || `****${cardNumberRaw.slice(-4)}`,
            status: "success",
          });
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
        await queryClient.invalidateQueries({ queryKey: ["cards"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} card${successCount === 1 ? "" : "s"} ✓`,
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

  const filtered = cardsWithDismiss.filter(
    (r) =>
      !search ||
      r.bankName.toLowerCase().includes(search.toLowerCase()) ||
      r.cardHolder.toLowerCase().includes(search.toLowerCase()) ||
      r.network.toLowerCase().includes(search.toLowerCase()) ||
      r.cardNumber.slice(-4).includes(search),
  );

  const overdueCount = cardsWithDismiss.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      c.expiryDate &&
      daysFromNow(calculateReminderDate(c.expiryDate, c.reminderDays)) <= 0,
  ).length;
  const upcomingCount = cardsWithDismiss.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      c.expiryDate &&
      daysFromNow(calculateReminderDate(c.expiryDate, c.reminderDays)) > 0 &&
      daysFromNow(calculateReminderDate(c.expiryDate, c.reminderDays)) <= 7,
  ).length;
  const hasAlerts = overdueCount > 0 || upcomingCount > 0;

  if (loadingCards || loadingBanks)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Card Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Bank cards"
        subtitle="The company's debit and credit cards: bank, network, holder and expiry, with a reminder before each one runs out."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {hasAlerts && (
              <button
                onClick={() => setShowReminderPanel((p) => !p)}
                aria-expanded={showReminderPanel}
                className={`${KEY} px-3 py-2 border ${overdueCount > 0 ? "border-destructive text-destructive" : "border-foreground text-foreground hover:bg-primary/10"}`}
              >
                <BellRing size={13} />
                {overdueCount > 0 ? `${overdueCount} overdue` : `${upcomingCount} upcoming`}
                {showReminderPanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
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
              className={`${KEY} px-3 py-2 border border-foreground text-foreground hover:bg-primary/10`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import cards from CSV"
              className={`${KEY} px-3 py-2 border border-foreground bg-foreground text-card`}
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* ── Figures ── */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Cards", value: cardsWithDismiss.length, note: "in all", red: false },
                { label: "Active", value: cardsWithDismiss.filter((c) => c.status).length, note: "in use", red: false },
                { label: "Renewal due soon", value: upcomingCount, note: "reminder within 7 days", red: false },
                { label: "Renewal overdue", value: overdueCount, note: "past the reminder date", red: overdueCount > 0 },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label" style={x.red ? { color: "var(--red)" } : undefined}>{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          {showReminderPanel && (
            <ReminderBanner
              cards={cardsWithDismiss}
              onDismiss={(id) => setDismissed((p) => [...p, id])}
              onAddNew={handleReset}
            />
          )}

          {/* Form */}
          {(rights.canCreate || (rights.canEdit && editingId !== null)) && (
          <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
              <h2 className={HEAD}>{editingId ? "Edit card" : "Add card"}</h2>
              <p className="text-[0.6875rem] text-muted-foreground">
                Fields marked <span className="text-destructive">*</span> are required
              </p>
            </div>

            <div className="px-4 py-5">
              {/* The card as it is being filled in: an outline drawing, not a coloured card */}
              <div className="mb-6 max-w-[420px] px-5 py-4 flex items-end justify-between gap-4 min-h-[124px]" style={{ border: "1.5px solid hsl(var(--foreground))" }}>
                <div className="min-w-0">
                  <p className={LBL}>
                    {form.network || "Network"} · {form.cardType || "Type"}
                  </p>
                  <p className="font-heading text-lg font-semibold tabular-nums tracking-[0.08em] text-foreground mt-3 whitespace-nowrap">
                    {form.cardNumber
                      ? showFormCard
                        ? formatted(form.cardNumber)
                        : masked(form.cardNumber)
                      : "•••• •••• •••• ••••"}
                  </p>
                  <p className={`text-xs mt-2 truncate ${form.cardHolder ? "text-foreground" : "text-muted-foreground"}`}>
                    {form.cardHolder || "Card holder name"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={LBL}>Expires</p>
                  <p className="font-heading text-sm font-semibold tabular-nums text-foreground mt-1">
                    {form.expiryDate || "MM/YY"}
                  </p>
                  {form.reminderEnabled && previewReminderDate && (
                    <p className="flex items-center justify-end gap-1 mt-2 text-[0.625rem] text-muted-foreground tabular-nums">
                      <Bell size={9} /> {formatDisplayDate(previewReminderDate)}
                    </p>
                  )}
                </div>
              </div>

              {/* Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {/* Bank dropdown — live from BankMaster DB */}
                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Bank Name <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <Landmark
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <select
                      value={form.bankId}
                      onChange={(e) => handleBankChange(e.target.value)}
                      className={`${inp} appearance-none pl-8 pr-9 ${errors.bankId ? "border-destructive" : ""}`}
                    >
                      <option value="">Select Bank...</option>
                      {dbBanks.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.label}
                          {b.branchName ? ` — ${b.branchName}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {errors.bankId && (
                    <p className="text-[0.6875rem] text-destructive mt-1">
                      Bank is required
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Company Name
                  </label>
                  <div className="relative">
                    <select
                      value={form.companyName}
                      onChange={(e) => setField("companyName", e.target.value)}
                      className={`${inp} appearance-none pr-9`}
                    >
                      <option value="">Select Company...</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.label}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>

                {/* Account Number — auto-filled from bank selection */}
                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Account Number
                    <span className="ml-2 normal-case tracking-normal font-body font-normal text-[0.625rem] text-muted-foreground">
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
                      onChange={(e) =>
                        setField("accountNumber", e.target.value)
                      }
                      placeholder="Auto-filled on bank selection"
                      className={`${inp} pl-8 font-heading tabular-nums tracking-wide`}
                    />
                    {form.accountNumber && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        Auto
                      </span>
                    )}
                  </div>
                </div>

                {/* IFSC — auto-filled, read-only */}
                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    IFSC Code
                    <span className="ml-2 normal-case tracking-normal font-body font-normal text-[0.625rem] text-muted-foreground">
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
                      className={`${inp} pl-8 font-heading tabular-nums tracking-wide border-dashed cursor-default text-muted-foreground`}
                    />
                    {form.ifscCode && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        Auto
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Card Network
                  </label>
                  <div className="relative">
                    <select
                      value={form.network}
                      onChange={(e) => setField("network", e.target.value)}
                      className={`${inp} appearance-none pr-9`}
                    >
                      <option value="">Select Network...</option>
                      {CARD_NETWORKS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>

                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Card Type
                  </label>
                  <div className="relative">
                    <select
                      value={form.cardType}
                      onChange={(e) => setField("cardType", e.target.value)}
                      className={`${inp} appearance-none pr-9`}
                    >
                      <option value="">Select Type...</option>
                      {CARD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className={`block ${LBL} mb-1.5`}>
                    Card Holder Name
                  </label>
                  <input
                    type="text"
                    value={form.cardHolder}
                    onChange={(e) => setField("cardHolder", e.target.value)}
                    placeholder="As printed on card"
                    className={inp}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className={`block ${LBL} mb-1.5`}>
                    Card Number <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <CreditCard
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      type={showFormCard ? "text" : "password"}
                      value={form.cardNumber}
                      onChange={(e) =>
                        setField(
                          "cardNumber",
                          e.target.value.replace(/\D/g, "").slice(0, 16),
                        )
                      }
                      placeholder="16-digit card number"
                      className={`${inp} pl-8 pr-10 font-heading tabular-nums tracking-wide ${errors.cardNumber ? "border-destructive" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowFormCard((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showFormCard ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.cardNumber && (
                    <p className="text-[0.6875rem] text-destructive mt-1">
                      Valid card number required (min 13 digits)
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    CVC / CVV <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <ShieldAlert
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      type={showCvc ? "text" : "password"}
                      value={form.cvv}
                      onChange={(e) =>
                        setField(
                          "cvv",
                          e.target.value.replace(/\D/g, "").slice(0, 4),
                        )
                      }
                      placeholder="3 or 4 digits"
                      className={`${inp} pl-8 pr-10 font-heading tabular-nums tracking-wide ${errors.cvv ? "border-destructive" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCvc((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showCvc ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.cvv && (
                    <p className="text-[0.6875rem] text-destructive mt-1">
                      CVC required (3–4 digits)
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block ${LBL} mb-1.5`}>
                    Expiry Date <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <CalendarDays
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <MonthInput
                      value={
                        form.expiryDate && form.expiryDate.length === 5
                          ? `20${form.expiryDate.slice(3)}-${form.expiryDate.slice(0, 2)}`
                          : ""
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) {
                          handleExpiry("");
                          return;
                        }
                        const [year, month] = val.split("-");
                        handleExpiry(`${month}${year.slice(-2)}`);
                      }}
                      className={`${inp} pl-8 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.expiryDate ? "border-destructive" : ""}`}
                    />
                  </div>
                  {errors.expiryDate && (
                    <p className="text-[0.6875rem] text-destructive mt-1">
                      Valid expiry required (MM/YY)
                    </p>
                  )}
                </div>

                {/* Reminder */}
                <div className="sm:col-span-2">
                  <div className="p-4" style={{ border: `1px solid hsl(var(--foreground) / ${form.reminderEnabled ? 1 : 0.4})` }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-heading text-[0.625rem] font-bold uppercase tracking-[0.14em] text-foreground">Card renewal reminder</p>
                        <p className="text-[0.6875rem] text-muted-foreground mt-1">
                          {form.reminderEnabled && previewReminderDate
                            ? `Will remind on ${formatDisplayDate(previewReminderDate)}`
                            : "No reminder set"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setField("reminderEnabled", !form.reminderEnabled)
                        }
                        aria-pressed={form.reminderEnabled}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none shrink-0 ${form.reminderEnabled ? "bg-foreground" : "bg-muted-foreground/30"}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${form.reminderEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                    </div>

                    {form.reminderEnabled && (
                      <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                        <div>
                          <label className={`block ${LBL} mb-1.5`}>
                            Remind Before Expiry (Days)
                          </label>
                          <div className="relative">
                            <Clock
                              size={14}
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            />
                            <input
                              type="number"
                              min={1}
                              max={3650}
                              value={form.reminderDays}
                              onChange={(e) =>
                                setField(
                                  "reminderDays",
                                  Math.max(1, parseInt(e.target.value) || 1),
                                )
                              }
                              className={`${inp} pl-8 font-heading tabular-nums`}
                            />
                          </div>
                          <div className="seg mt-2">
                            {[7, 14, 30, 45, 60, 90].map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setField("reminderDays", d)}
                                aria-pressed={form.reminderDays === d}
                                className={form.reminderDays === d ? "on" : undefined}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={`block ${LBL} mb-1.5`}>
                            Reminder Will Fire On
                          </label>
                          <div className="px-3 py-2.5 border border-dashed border-foreground/40">
                            <p className="font-heading text-sm font-semibold tabular-nums text-foreground">
                              {previewReminderDate ? formatDisplayDate(previewReminderDate) : "—"}
                            </p>
                            <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                              {form.reminderDays} day{form.reminderDays !== 1 ? "s" : ""} before expiry
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col justify-end">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setField("status", !form.status)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.status ? "bg-foreground" : "bg-muted-foreground/30"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${form.status ? "translate-x-4" : "translate-x-0.5"}`}
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
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`${KEY} flex-1 sm:flex-none h-9 px-5 bg-foreground text-card border border-foreground whitespace-nowrap`}
                >
                  {editingId ? <Check size={13} /> : <Plus size={13} />}
                  {editingId ? "Update card" : "Save card"}
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Table */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <p className="flex items-baseline gap-2.5">
                <span className={HEAD}>Cards</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
              </p>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 h-9 text-xs bg-card border border-foreground/40 focus:border-foreground text-foreground focus:outline-none w-40 sm:w-48"
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
                    ? "No cards match your search."
                    : "No cards yet. Add one above."
                }
                rowClassName={(row) =>
                  row.original._id === editingId
                    ? "shadow-[inset_3px_0_0_hsl(var(--primary))]"
                    : ""
                }
              />
            </div>
          </div>

          {/* Delete Confirm */}
          {deleteId && (
            <BodyPortal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="sheet-frame bg-card p-5 max-w-sm w-full mx-4" style={{ margin: "0 16px", border: "1.5px solid hsl(var(--destructive))" }}>
                <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-destructive">Delete card</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">Delete this card?</h3>
                <p className="text-sm text-muted-foreground mt-2 mb-5">This cannot be undone.</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setDeleteId(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                    Cancel
                  </button>
                  <button onClick={() => handleDelete(deleteId)} className={`${KEY} h-9 px-4 bg-destructive text-destructive-foreground border border-destructive`}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            </div></BodyPortal>
          )}
        </div>
      </SheetShell>

      {/* Import Results Modal */}
      {importResults && (
        <Dialog
          open={!!importResults}
          onOpenChange={() => setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg max-h-[80vh] flex flex-col" style={{ margin: 0 }}>
            <DialogHeader>
              <div className="pb-3" style={{ borderBottom: RULE }}>
                <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cards · CSV import</p>
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
      {viewRecord && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => {
              setViewRecord(null);
              setDrawerRevealed(false);
            }}
          />
          <div
            className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200"
            style={{ margin: 0, borderLeft: RULE }}
          >
            <div className="flex items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="min-w-0">
                <p className={LBL}>{[viewRecord.network, viewRecord.cardType].filter(Boolean).join(" · ") || "Card"}</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 break-words">{viewRecord.bankName || "Card"}</h3>
              </div>
              <button
                onClick={() => {
                  setViewRecord(null);
                  setDrawerRevealed(false);
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className={`${LBL} mb-1`}>Card number</p>
                <div className="flex items-center gap-2">
                  <span className="font-heading text-sm font-semibold tabular-nums tracking-wide text-foreground">
                    {drawerRevealed ? formatted(viewRecord.cardNumber) : masked(viewRecord.cardNumber)}
                  </span>
                  <button
                    onClick={() => setDrawerRevealed((p) => !p)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title={drawerRevealed ? "Hide" : "Reveal"}
                    aria-label={drawerRevealed ? "Hide number" : "Reveal number"}
                  >
                    {drawerRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                {!drawerRevealed && <p className="text-[0.625rem] text-muted-foreground mt-1">Hidden for security</p>}
              </div>
              {[
                { l: "Card holder", v: viewRecord.cardHolder || "—", fig: false },
                { l: "Company", v: viewRecord.companyName || "—", fig: false },
                { l: "Expiry", v: viewRecord.expiryDate || "—", fig: true },
              ].map((x) => (
                <div key={x.l}>
                  <p className={`${LBL} mb-1`}>{x.l}</p>
                  <p className={`text-sm text-foreground break-words ${x.fig ? "font-heading font-semibold tabular-nums" : ""}`}>{x.v}</p>
                </div>
              ))}
              <div>
                <p className={`${LBL} mb-1.5`}>Status</p>
                <SheetMark text={viewRecord.status ? "Active" : "Inactive"} tone={viewRecord.status ? "done" : "none"} />
              </div>
              {viewRecord.reminderEnabled && viewRecord.expiryDate && (() => {
                const rd = calculateReminderDate(viewRecord.expiryDate, viewRecord.reminderDays);
                return (
                  <div>
                    <p className={`${LBL} mb-1`}>Renewal reminder</p>
                    <p className="text-sm text-foreground">
                      {viewRecord.reminderDays} days before expiry
                      {rd ? <span className="text-muted-foreground tabular-nums"> · {formatDisplayDate(rd)}</span> : null}
                    </p>
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
              <button
                onClick={() => {
                  setViewRecord(null);
                  setDrawerRevealed(false);
                }}
                className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
              >
                Close
              </button>
              {rights.canEdit && (
                <button
                  onClick={() => {
                    handleEdit(viewRecord._id);
                    setViewRecord(null);
                    setDrawerRevealed(false);
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

export default CardMaster;
