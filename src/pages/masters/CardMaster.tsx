import React, { useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  ShieldAlert,
  Calendar,
  Bell,
  BellRing,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

const BANK_OPTIONS = [
  { bankName: "HDFC Bank", ifsc: "HDFC0001234" },
  { bankName: "State Bank of India", ifsc: "SBIN0001111" },
  { bankName: "ICICI Bank", ifsc: "ICIC0002222" },
];

const CARD_NETWORKS = ["Visa", "Mastercard", "RuPay", "Amex", "Diners Club"];
const CARD_TYPES = ["Debit", "Credit", "Prepaid", "Corporate"];
const DEFAULT_REMINDER_DAYS = 30;

interface CardRecord {
  _id: string;
  bankName: string;
  cardNumber: string;
  cvc: string;
  expiryDate: string;
  cardHolder: string;
  cardType: string;
  network: string;
  status: boolean;
  reminderEnabled: boolean;
  reminderDays: number;
  reminderDate: string;
  savedAt: string;
  reminderDismissed: boolean;
}

// Parse "MM/YY" expiry to full Date (last day of month)
function parseExpiryToDate(expiry: string): Date | null {
  if (!/^\d{2}\/\d{2}$/.test(expiry)) return null;
  const [monthStr, yearStr] = expiry.split("/");
  let month = parseInt(monthStr, 10) - 1;
  let year = 2000 + parseInt(yearStr, 10);

  const now = new Date();
  if (
    year < now.getFullYear() ||
    (year === now.getFullYear() && month < now.getMonth())
  ) {
    year += 100;
  }

  const lastDay = new Date(year, month + 1, 0);
  return lastDay;
}

// Calculate reminder date = Expiry Date - reminderDays
function calculateReminderDate(
  expiryStr: string,
  reminderDays: number,
): string {
  const expiryDate = parseExpiryToDate(expiryStr);
  if (!expiryDate) return "";
  const reminder = new Date(expiryDate);
  reminder.setDate(reminder.getDate() - reminderDays);
  return reminder.toISOString().split("T")[0];
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysFromNow(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function masked(num: string) {
  const clean = num.replace(/\D/g, "");
  const last4 = clean.slice(-4).padStart(4, "X");
  return `•••• •••• •••• ${last4}`;
}

function formatted(num: string) {
  const clean = num.replace(/\D/g, "").slice(0, 16);
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

// Seed Data
const SEED: CardRecord[] = [
  {
    _id: "card-seed-1",
    bankName: "HDFC Bank",
    cardNumber: "4111111111111234",
    cvc: "123",
    expiryDate: "12/27",
    cardHolder: "Civilier Infra Pvt Ltd",
    cardType: "Credit",
    network: "Visa",
    status: true,
    reminderEnabled: true,
    reminderDays: 45,
    reminderDate: calculateReminderDate("12/27", 45),
    savedAt: todayISO(),
    reminderDismissed: false,
  },
  {
    _id: "card-seed-2",
    bankName: "State Bank of India",
    cardNumber: "6200000000005678",
    cvc: "456",
    expiryDate: "08/26",
    cardHolder: "Civilier Infra Pvt Ltd",
    cardType: "Debit",
    network: "RuPay",
    status: true,
    reminderEnabled: true,
    reminderDays: 30,
    reminderDate: calculateReminderDate("08/26", 30),
    savedAt: todayISO(),
    reminderDismissed: false,
  },
];

type FormState = Omit<
  CardRecord,
  "_id" | "savedAt" | "reminderDate" | "reminderDismissed"
>;

const EMPTY: FormState = {
  bankName: "",
  cardNumber: "",
  cvc: "",
  expiryDate: "",
  cardHolder: "",
  cardType: "",
  network: "",
  status: true,
  reminderEnabled: true,
  reminderDays: DEFAULT_REMINDER_DAYS,
};

const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

interface ReminderBannerProps {
  cards: CardRecord[];
  onDismiss: (id: string) => void;
  onAddNew: () => void;
}

const ReminderBanner: React.FC<ReminderBannerProps> = ({
  cards,
  onDismiss,
  onAddNew,
}) => {
  const due = cards.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      daysFromNow(c.reminderDate) <= 0,
  );

  const upcoming = cards.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      daysFromNow(c.reminderDate) > 0 &&
      daysFromNow(c.reminderDate) <= 7,
  );

  if (due.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="space-y-3">
      {due.map((card) => {
        const overdueDays = Math.abs(daysFromNow(card.reminderDate));
        return (
          <div
            key={card._id}
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BellRing
                  size={16}
                  className="text-destructive animate-pulse"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-heading font-semibold text-destructive">
                  Card Renewal Reminder — Overdue by {overdueDays} day
                  {overdueDays !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    {card.bankName}
                  </span>
                  {" · "}
                  {masked(card.cardNumber)}
                  {card.cardHolder && ` · ${card.cardHolder}`}
                  {" — Was due on "}
                  <span className="font-medium">
                    {formatDisplayDate(card.reminderDate)}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-12 sm:ml-0">
              <button
                onClick={onAddNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
              >
                <Plus size={12} /> Add New Card
              </button>
              <button
                onClick={() => onDismiss(card._id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {upcoming.map((card) => {
        const inDays = daysFromNow(card.reminderDate);
        return (
          <div
            key={card._id}
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bell size={16} className="text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-heading font-semibold text-amber-600 dark:text-amber-400">
                  Card Renewal Reminder — Due in {inDays} day
                  {inDays !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    {card.bankName}
                  </span>
                  {" · "}
                  {masked(card.cardNumber)}
                  {card.cardHolder && ` · ${card.cardHolder}`}
                  {" — Reminder on "}
                  <span className="font-medium">
                    {formatDisplayDate(card.reminderDate)}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-12 sm:ml-0">
              <button
                onClick={onAddNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-all"
              >
                <Plus size={12} /> Add New Card
              </button>
              <button
                onClick={() => onDismiss(card._id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="Dismiss"
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

const CardMaster: React.FC = () => {
  const [data, setData] = useState<CardRecord[]>(SEED);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [revealedRows, setRevealedRows] = useState<Record<string, boolean>>({});
  const [showCvc, setShowCvc] = useState(false);
  const [showFormCard, setShowFormCard] = useState(false);
  const [showReminderPanel, setShowReminderPanel] = useState(true);

  const previewReminderDate = useMemo(() => {
    if (!form.reminderEnabled || !form.reminderDays || !form.expiryDate)
      return null;
    return calculateReminderDate(form.expiryDate, form.reminderDays);
  }, [form.reminderEnabled, form.reminderDays, form.expiryDate]);

  const setField = (k: keyof FormState, v: unknown) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k as string]) setErrors((p) => ({ ...p, [k as string]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.bankName) e.bankName = true;
    if (!form.cardNumber || form.cardNumber.replace(/\D/g, "").length < 13)
      e.cardNumber = true;
    if (!form.cvc || form.cvc.length < 3) e.cvc = true;
    if (!form.expiryDate || !/^\d{2}\/\d{2}$/.test(form.expiryDate))
      e.expiryDate = true;
    if (form.reminderEnabled && (!form.reminderDays || form.reminderDays < 1))
      e.reminderDays = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const now = todayISO();
    const reminderDate =
      form.reminderEnabled && form.expiryDate
        ? calculateReminderDate(form.expiryDate, form.reminderDays)
        : "";

    if (editingId) {
      setData((p) =>
        p.map((r) =>
          r._id === editingId
            ? {
                ...form,
                _id: editingId,
                savedAt: now,
                reminderDate,
                reminderDismissed: false,
              }
            : r,
        ),
      );
      setEditingId(null);
      toast.success("Card updated ✓");
    } else {
      const rec: CardRecord = {
        ...form,
        _id: `card-${Date.now()}`,
        savedAt: now,
        reminderDate,
        reminderDismissed: false,
      };
      setData((p) => [...p, rec]);
      toast.success(
        form.reminderEnabled
          ? `Card saved ✓ · Reminder set for ${formatDisplayDate(reminderDate)}`
          : "Card saved ✓",
      );
    }

    setForm(EMPTY);
    setShowFormCard(false);
    setShowCvc(false);
  };

  const handleEdit = (id: string) => {
    const r = data.find((x) => x._id === id);
    if (!r) return;
    setForm({
      bankName: r.bankName,
      cardNumber: r.cardNumber,
      cvc: r.cvc,
      expiryDate: r.expiryDate,
      cardHolder: r.cardHolder,
      cardType: r.cardType,
      network: r.network,
      status: r.status,
      reminderEnabled: r.reminderEnabled,
      reminderDays: r.reminderDays,
    });
    setEditingId(id);
    setShowFormCard(false);
    setShowCvc(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    setData((p) => p.filter((r) => r._id !== id));
    setDeleteId(null);
    if (editingId === id) {
      setEditingId(null);
      setForm(EMPTY);
    }
    toast.success("Card deleted");
  };

  const handleReset = () => {
    setForm(EMPTY);
    setEditingId(null);
    setErrors({});
    setShowFormCard(false);
    setShowCvc(false);
  };

  const handleDismissReminder = (id: string) => {
    setData((p) =>
      p.map((r) => (r._id === id ? { ...r, reminderDismissed: true } : r)),
    );
    toast.info("Reminder dismissed");
  };

  const handleAddNewFromReminder = () => {
    handleReset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleExpiry = (val: string) => {
    let v = val.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    setField("expiryDate", v);
  };

  const filtered = data.filter((r) => {
    if (!search) return true;
    return (
      r.bankName.toLowerCase().includes(search.toLowerCase()) ||
      r.cardHolder.toLowerCase().includes(search.toLowerCase()) ||
      r.network.toLowerCase().includes(search.toLowerCase()) ||
      r.cardNumber.slice(-4).includes(search)
    );
  });

  const overdueCount = data.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      daysFromNow(c.reminderDate) <= 0,
  ).length;

  const upcomingCount = data.filter(
    (c) =>
      c.reminderEnabled &&
      !c.reminderDismissed &&
      daysFromNow(c.reminderDate) > 0 &&
      daysFromNow(c.reminderDate) <= 7,
  ).length;

  const hasAlerts = overdueCount > 0 || upcomingCount > 0;

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
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-heading font-semibold transition-all ${
              overdueCount > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                : "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15"
            }`}
          >
            <BellRing
              size={13}
              className={overdueCount > 0 ? "animate-pulse" : ""}
            />
            {overdueCount > 0
              ? `${overdueCount} overdue reminder${overdueCount > 1 ? "s" : ""}`
              : `${upcomingCount} upcoming reminder${upcomingCount > 1 ? "s" : ""}`}
            {showReminderPanel ? (
              <ChevronUp size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Reminder Banners */}
        {showReminderPanel && (
          <ReminderBanner
            cards={data}
            onDismiss={handleDismissReminder}
            onAddNew={handleAddNewFromReminder}
          />
        )}

        {/* Form Card */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
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
            <div className="mb-5 rounded-2xl bg-gradient-to-br from-primary/80 via-primary to-primary/60 p-5 flex items-end justify-between shadow-lg shadow-primary/20 relative overflow-hidden min-h-[110px]">
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

            {/* Form Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    value={form.bankName}
                    onChange={(e) => setField("bankName", e.target.value)}
                    className={`${inp} pl-8 ${errors.bankName ? "border-destructive" : ""}`}
                  >
                    <option value="">Select Bank...</option>
                    {BANK_OPTIONS.map((b) => (
                      <option key={b.bankName} value={b.bankName}>
                        {b.bankName}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.bankName && (
                  <p className="text-[11px] text-destructive mt-1">
                    Bank is required
                  </p>
                )}
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

              <div>
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
                    value={form.cvc}
                    onChange={(e) =>
                      setField(
                        "cvc",
                        e.target.value.replace(/\D/g, "").slice(0, 4),
                      )
                    }
                    placeholder="3 or 4 digits"
                    className={`${inp} pl-8 pr-10 font-mono tracking-widest ${errors.cvc ? "border-destructive" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCvc((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCvc ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.cvc && (
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

              {/* Reminder Section */}
              <div className="sm:col-span-2">
                <div
                  className={`rounded-xl border p-4 transition-all ${form.reminderEnabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${form.reminderEnabled ? "bg-primary/15" : "bg-muted"}`}
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
                            : "No reminder set for this card"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setField("reminderEnabled", !form.reminderEnabled)
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${form.reminderEnabled ? "bg-primary" : "bg-muted border border-border"}`}
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
                          Remind Before Expiry (Days){" "}
                          <span className="text-destructive">*</span>
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
                            className={`${inp} pl-8 font-mono ${errors.reminderDays ? "border-destructive" : ""}`}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {[7, 14, 30, 45, 60, 90].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setField("reminderDays", d)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-heading border transition-all ${
                                form.reminderDays === d
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
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

        {/* Cards Table */}
        <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
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
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Bank
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Card Number
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">
                    Network
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden md:table-cell">
                    Expiry
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell">
                    Reminder
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-muted-foreground text-sm"
                    >
                      {search
                        ? "No cards match your search."
                        : "No cards yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const reminderDaysLeft = row.reminderDate
                      ? daysFromNow(row.reminderDate)
                      : null;
                    const isOverdue =
                      reminderDaysLeft !== null &&
                      reminderDaysLeft <= 0 &&
                      row.reminderEnabled &&
                      !row.reminderDismissed;
                    const isUpcoming =
                      reminderDaysLeft !== null &&
                      reminderDaysLeft > 0 &&
                      reminderDaysLeft <= 7 &&
                      row.reminderEnabled &&
                      !row.reminderDismissed;

                    return (
                      <tr
                        key={row._id}
                        className={`hover:bg-muted/20 transition-colors ${editingId === row._id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                      >
                        <td className="px-4 py-3 text-foreground font-body text-sm">
                          {row.bankName}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground tracking-widest">
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
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {row.network || "—"}
                        </td>
                        <td className="px-4 py-3 text-foreground text-sm hidden sm:table-cell">
                          {row.cardType || "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-foreground text-sm hidden md:table-cell">
                          {row.expiryDate}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
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
                              Overdue {Math.abs(reminderDaysLeft!)}d
                            </span>
                          ) : isUpcoming ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-heading border bg-amber-500/10 text-amber-600 border-amber-500/20">
                              <Bell size={10} /> In {reminderDaysLeft}d
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-heading">
                              <Bell size={10} />{" "}
                              {formatDisplayDate(row.reminderDate)}
                            </span>
                          )}
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
                              title="Edit"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteId(row._id)}
                              className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete"
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
      </div>
    </>
  );
};

export default CardMaster;
