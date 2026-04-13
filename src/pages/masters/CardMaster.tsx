import React, { useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard,
  Eye,
  EyeOff,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  X,
  Search,
  Landmark,
  Hash,
  ShieldAlert,
  Calendar,
  Bell,
  BellRing,
  Clock,
  ChevronDown,
  ChevronUp,
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
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

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

  return (
    <div className="space-y-3">
      {due.map((card) => {
        const rd = reminderDate(card);
        const overdue = Math.abs(daysFromNow(rd));
        return (
          <div
            key={card._id}
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <BellRing
                  size={16}
                  className="text-destructive animate-pulse"
                />
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-destructive">
                  Overdue by {overdue} day{overdue !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    {card.bankName}
                  </span>
                  {" · "}
                  {masked(card.cardNumber)}
                  {" — Was due on "}
                  <span className="font-medium">{formatDisplayDate(rd)}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onAddNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
              >
                <Plus size={12} /> Add New Card
              </button>
              <button
                onClick={() => onDismiss(card._id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {upcoming.map((card) => {
        const rd = reminderDate(card);
        const inDays = daysFromNow(rd);
        return (
          <div
            key={card._id}
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Bell size={16} className="text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-amber-600">
                  Due in {inDays} day{inDays !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    {card.bankName}
                  </span>
                  {" · "}
                  {masked(card.cardNumber)}
                  {" — Reminder on "}
                  <span className="font-medium">{formatDisplayDate(rd)}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onAddNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-all"
              >
                <Plus size={12} /> Add New Card
              </button>
              <button
                onClick={() => onDismiss(card._id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────
const CardMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: dbData, isLoading: loadingCards } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
  });
  const { data: bankData, isLoading: loadingBanks } = useQuery<BankOption[]>({
    queryKey: ["banks"],
    queryFn: getBanksForCard,
  });
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["companyOptions"],
    queryFn: getCompanyOptions,
  });

  const dbItems: DbCard[] = Array.isArray(dbData) ? dbData : [];
  const dbBanks: BankOption[] = Array.isArray(bankData) ? bankData : [];

  const cards: CardRecord[] = dbItems.map((item) => {
    const mm = String(item.expiry_month ?? 0).padStart(2, "0");
    const yy = String(item.expiry_year ?? 0).slice(-2);
    // Try to match back to a bank record by name so bankId is consistent
    const matchedBank = dbBanks.find((b) => b.label === item.bank_name);
    return {
      _id: String(item.id),
      companyName: item.company_name || "",
      bankId: matchedBank ? String(matchedBank.id) : "",
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
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [revealedRows, setRevealedRows] = useState<Record<string, boolean>>({});
  const [showCvc, setShowCvc] = useState(false);
  const [showFormCard, setShowFormCard] = useState(false);
  const [showReminderPanel, setShowReminderPanel] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]);

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
    if (errors[k as string]) setErrors((p) => ({ ...p, [k as string]: false }));
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
    if (errors.bankId) setErrors((e) => ({ ...e, bankId: false }));
  };

  const handleExpiry = (val: string) => {
    let v = val.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    setField("expiryDate", v);
    if (v.length === 5) {
      const [m, y] = v.split("/");
      setForm((p) => ({
        ...p,
        expiryMonth: parseInt(m),
        expiryYear: 2000 + parseInt(y),
      }));
    }
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.bankId) e.bankId = true;
    if (!form.cardNumber || form.cardNumber.replace(/\D/g, "").length < 13)
      e.cardNumber = true;
    if (!form.cvv || form.cvv.length < 3) e.cvv = true;
    if (!form.expiryDate || !/^\d{2}\/\d{2}$/.test(form.expiryDate))
      e.expiryDate = true;
    if (form.reminderEnabled && (!form.reminderDays || form.reminderDays < 1))
      e.reminderDays = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const toPayload = (f: FormState) => ({
    company_name: f.companyName || null,
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

  const handleSave = async () => {
    if (!validate()) return;
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
      setEditingId(null);
      setShowCvc(false);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  const handleEdit = (id: string) => {
    const r = cards.find((x) => x._id === id);
    if (!r) return;
    setForm({
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
    });
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
      }
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
    setShowCvc(false);
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

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Card Master
        </h1>
        {hasAlerts && (
          <button
            onClick={() => setShowReminderPanel((p) => !p)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-heading font-semibold transition-all ${overdueCount > 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-500/40 bg-amber-500/10 text-amber-600"}`}
          >
            <BellRing
              size={13}
              className={overdueCount > 0 ? "animate-pulse" : ""}
            />
            {overdueCount > 0
              ? `${overdueCount} overdue`
              : `${upcomingCount} upcoming`}
            {showReminderPanel ? (
              <ChevronUp size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {showReminderPanel && (
          <ReminderBanner
            cards={cardsWithDismiss}
            onDismiss={(id) => setDismissed((p) => [...p, id])}
            onAddNew={handleReset}
          />
        )}

        {/* Form */}
        <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h2 className="font-heading font-semibold text-foreground text-sm">
                {editingId ? "Edit Card" : "Add Card"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editingId
                  ? "Modify card details below."
                  : "Register a new bank card."}
              </p>
            </div>
            {editingId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-primary/10 text-primary border border-primary/20">
                Editing
              </span>
            )}
          </div>

          <div className="p-5">
            {/* Card Preview */}
            <div className="mb-5 rounded-2xl bg-gradient-to-br from-primary/80 via-primary to-primary/60 p-5 flex items-end justify-between shadow-lg min-h-[110px] relative overflow-hidden">
              <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/5" />
              <div className="absolute -bottom-8 -left-4 w-40 h-40 rounded-full bg-white/5" />
              <div>
                <p className="text-[10px] text-primary-foreground/60 font-heading uppercase tracking-widest mb-1">
                  {form.network || "Network"} · {form.cardType || "Type"}
                </p>
                <p className="text-lg font-mono font-bold text-primary-foreground tracking-widest">
                  {form.cardNumber
                    ? showFormCard
                      ? formatted(form.cardNumber)
                      : masked(form.cardNumber)
                    : "•••• •••• •••• ••••"}
                </p>
                <p className="text-xs text-primary-foreground/70 mt-2 font-heading">
                  {form.cardHolder || "Card Holder Name"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-primary-foreground/60 font-heading uppercase tracking-widest">
                  Expires
                </p>
                <p className="text-sm font-mono text-primary-foreground font-semibold">
                  {form.expiryDate || "MM/YY"}
                </p>
                {form.reminderEnabled && previewReminderDate && (
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    <Bell size={9} className="text-primary-foreground/50" />
                    <p className="text-[10px] text-primary-foreground/50 font-heading">
                      {formatDisplayDate(previewReminderDate)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Bank dropdown — live from BankMaster DB */}
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
                        {b.BBranch ? ` — ${b.BBranch}` : ""}
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

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Company Name
                </label>
                <select
                  value={form.companyName}
                  onChange={(e) => setField("companyName", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Company...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Number — auto-filled from bank selection */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Account Number
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
                    className={`${inp} pl-8 font-mono tracking-widest`}
                  />
                  {form.accountNumber && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-heading text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      AUTO
                    </span>
                  )}
                </div>
              </div>

              {/* IFSC — auto-filled, read-only */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  IFSC Code
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

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Card Network
                </label>
                <select
                  value={form.network}
                  onChange={(e) => setField("network", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Network...</option>
                  {CARD_NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Card Type
                </label>
                <select
                  value={form.cardType}
                  onChange={(e) => setField("cardType", e.target.value)}
                  className={inp}
                >
                  <option value="">Select Type...</option>
                  {CARD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
                    className={`${inp} pl-8 pr-10 font-mono tracking-widest ${errors.cardNumber ? "border-destructive" : ""}`}
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
                  <p className="text-[11px] text-destructive mt-1">
                    Valid card number required (min 13 digits)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
                    className={`${inp} pl-8 pr-10 font-mono tracking-widest ${errors.cvv ? "border-destructive" : ""}`}
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
                  <p className="text-[11px] text-destructive mt-1">
                    CVC required (3–4 digits)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Expiry Date <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Calendar
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={form.expiryDate}
                    onChange={(e) => handleExpiry(e.target.value)}
                    placeholder="MM/YY"
                    maxLength={5}
                    className={`${inp} pl-8 font-mono tracking-widest ${errors.expiryDate ? "border-destructive" : ""}`}
                  />
                </div>
                {errors.expiryDate && (
                  <p className="text-[11px] text-destructive mt-1">
                    Valid expiry required (MM/YY)
                  </p>
                )}
              </div>

              {/* Reminder */}
              <div className="sm:col-span-2">
                <div
                  className={`rounded-xl border p-4 transition-all ${form.reminderEnabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${form.reminderEnabled ? "bg-primary/15" : "bg-muted"}`}
                      >
                        <Bell
                          size={15}
                          className={
                            form.reminderEnabled
                              ? "text-primary"
                              : "text-muted-foreground"
                          }
                        />
                      </div>
                      <div>
                        <p className="text-sm font-heading font-semibold text-foreground">
                          Card Renewal Reminder
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {form.reminderEnabled && previewReminderDate
                            ? `Will remind on ${formatDisplayDate(previewReminderDate)}`
                            : "No reminder set"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setField("reminderEnabled", !form.reminderEnabled)
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.reminderEnabled ? "bg-primary" : "bg-muted border border-border"}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform shadow-sm ${form.reminderEnabled ? "translate-x-6" : "translate-x-1"}`}
                      />
                    </button>
                  </div>

                  {form.reminderEnabled && (
                    <div className="mt-4 pt-4 border-t border-primary/15 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
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
                            className={`${inp} pl-8 font-mono`}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {[7, 14, 30, 45, 60, 90].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setField("reminderDays", d)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-heading border transition-all ${form.reminderDays === d ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                            >
                              {d}d
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                          Reminder Will Fire On
                        </label>
                        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/20">
                          <Calendar
                            size={14}
                            className="text-primary flex-shrink-0"
                          />
                          <div>
                            <p className="text-sm font-heading font-semibold text-primary">
                              {previewReminderDate
                                ? formatDisplayDate(previewReminderDate)
                                : "—"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {form.reminderDays} day
                              {form.reminderDays !== 1 ? "s" : ""} before expiry
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col justify-end">
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
        <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/60">
            <div>
              <h3 className="font-heading font-semibold text-foreground text-sm">
                Card Records
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {filtered.length} record{filtered.length !== 1 ? "s" : ""}
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
                    "Bank",
                    "Account No.",
                    "Card Number",
                    "Network",
                    "Type",
                    "Expiry",
                    "Reminder",
                    "Status",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground"
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
                        ? "No cards match your search."
                        : "No cards yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const rd =
                      row.reminderEnabled && row.expiryDate
                        ? calculateReminderDate(
                            row.expiryDate,
                            row.reminderDays,
                          )
                        : "";
                    const dfl = rd ? daysFromNow(rd) : null;
                    const isOverdue =
                      dfl !== null && dfl <= 0 && !row.reminderDismissed;
                    const isUpcoming =
                      dfl !== null &&
                      dfl > 0 &&
                      dfl <= 7 &&
                      !row.reminderDismissed;

                    return (
                      <tr
                        key={row._id}
                        className={`hover:bg-muted/20 transition-colors ${editingId === row._id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          {row.bankName || "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-foreground">
                          {row.accountNumber || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-foreground tracking-widest">
                              {revealedRows[row._id]
                                ? formatted(row.cardNumber)
                                : masked(row.cardNumber)}
                            </span>
                            <button
                              onClick={() =>
                                setRevealedRows((p) => ({
                                  ...p,
                                  [row._id]: !p[row._id],
                                }))
                              }
                              className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            >
                              {revealedRows[row._id] ? (
                                <EyeOff size={13} />
                              ) : (
                                <Eye size={13} />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {row.network || "—"}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {row.cardType || "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-foreground">
                          {row.expiryDate}
                        </td>
                        <td className="px-4 py-3">
                          {!row.reminderEnabled ? (
                            <span className="text-[11px] text-muted-foreground font-heading">
                              Off
                            </span>
                          ) : row.reminderDismissed ? (
                            <span className="text-[11px] text-muted-foreground font-heading">
                              Dismissed
                            </span>
                          ) : isOverdue ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-heading border bg-destructive/10 text-destructive border-destructive/20">
                              <BellRing size={10} className="animate-pulse" />{" "}
                              Overdue {Math.abs(dfl!)}d
                            </span>
                          ) : isUpcoming ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-heading border bg-amber-500/10 text-amber-600 border-amber-500/20">
                              <Bell size={10} /> In {dfl}d
                            </span>
                          ) : rd ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-heading">
                              <Bell size={10} /> {formatDisplayDate(rd)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${row.status ? "bg-primary/10 text-primary border-primary/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${row.status ? "bg-primary" : "bg-destructive"}`}
                            />
                            {row.status ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEdit(row._id)}
                              className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteId(row._id)}
                              className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
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

        {/* Delete Confirm */}
        {deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="rounded-xl bg-card border border-border shadow-xl p-6 max-w-sm w-full mx-4">
              <h3 className="font-heading font-semibold text-foreground mb-2">
                Delete Card?
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteId(null)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-heading text-muted-foreground hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteId)}
                  className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-heading hover:bg-destructive/90 transition-all"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default CardMaster;
