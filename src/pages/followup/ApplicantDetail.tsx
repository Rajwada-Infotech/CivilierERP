import { useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Home,
  IndianRupee,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  UserRound,
  Clock,
  AlertCircle,
  TrendingUp,
  Layers,
  ClipboardList,
  Hash,
  BadgeCheck,
  StickyNote,
  CreditCard,
  Globe,
  Circle,
  ChevronRight,
  Wallet,
  Sparkles,
  ArrowUpRight,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

type LogType = "email" | "call" | "sms" | "note" | "payment";

interface LegacyApplicant {
  LHeadId: number;
  LHeadCode: string | null;
  LHeadName: string;
  LHeadType: string;
  LHeadStatus: number;
  LHeadPhone?: string | null;
  LHeadEmail?: string | null;
  LHeadAddress?: string | null;
  LHeadContactPerson?: string | null;
  LHeadPaymentTerms?: string | null;
  LGST?: string | null;
  LGSTState?: string | null;
  LCountry?: string | null;
  LBelongsTo?: string | null;
  LDescription?: string | null;
  LBranchName?: string | null;
}

interface FollowupApplicant {
  Id: number;
  ApplicantNo?: string | null;
  CustomerId?: number | null;
  ApplicantName?: string | null;
  PrimaryMobile?: string | null;
  Email?: string | null;
  PanNumber?: string | null;
  ApplicantAddress?: string | null;
  CoApplicantName?: string | null;
  CoApplicantPhone?: string | null;
  CorrespondenceAddress?: string | null;
  ApplicationDate?: string | null;
  City?: string | null;
  Source?: string | null;
  UnitName?: string | null;
  BlockName?: string | null;
  ProjectName?: string | null;
  CompanyName?: string | null;
  PreferredUnitType?: string | null;
  BudgetAmount?: number | null;
  Status?: string | null;
  AssignedToName?: string | null;
  Notes?: string | null;
  CreatedBy?: string | null;
  CreatedAt?: string | null;
  UpdatedAt?: string | null;
}

interface UnitSelectionRecord {
  Id: number;
  SelectionNo?: string | null;
  UnitNo?: string | null;
  BlockName?: string | null;
  FloorName?: string | null;
  UnitType?: string | null;
  AreaSqFt?: number | null;
  TotalValue?: number | null;
  Status?: string | null;
  CreatedAt?: string | null;
}

interface AgreementRecord {
  Id: number;
  AgreementNo?: string | null;
  AgreementDate?: string | null;
  AgreementValue?: number | null;
  AdvanceAmount?: number | null;
  BalanceAmount?: number | null;
  Status?: string | null;
  UnitNo?: string | null;
  CreatedAt?: string | null;
}

interface LogRecord {
  id: string;
  date: string;
  type: LogType;
  customer: string;
  amount: number | null;
  notes: string;
  createdAt: string;
}

interface ReminderRecord {
  id: number;
  tenantName: string;
  message?: string | null;
  dueDate?: string | null;
  status: "sent" | "overdue" | "scheduled";
  amountDue?: number | null;
  CreatedAt?: string | null;
}

interface LogFormState {
  date: string;
  type: LogType;
  customer: string;
  amount: string;
  notes: string;
}

interface ApiErrorPayload {
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v?: string | null) => v || "—";

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtMoney(v?: number | null) {
  if (typeof v !== "number") return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const PALETTE = [
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-teal-600",
  "from-emerald-500 to-green-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-red-600",
  "from-pink-500 to-fuchsia-600",
  "from-indigo-500 to-blue-600",
];
function grad(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const STATUS_CFG: Record<string, { pill: string; dot: string; track: string }> =
  {
    New: {
      pill: "bg-sky-500/10 text-sky-400 border border-sky-400/20",
      dot: "bg-sky-500",
      track: "bg-sky-500",
    },
    Qualified: {
      pill: "bg-emerald-500/10 text-emerald-400 border border-emerald-400/20",
      dot: "bg-emerald-500",
      track: "bg-emerald-500",
    },
    Shortlisted: {
      pill: "bg-violet-500/10 text-violet-400 border border-violet-400/20",
      dot: "bg-violet-500",
      track: "bg-violet-500",
    },
    "Document Pending": {
      pill: "bg-amber-500/10 text-amber-400 border border-amber-400/20",
      dot: "bg-amber-500",
      track: "bg-amber-500",
    },
    Rejected: {
      pill: "bg-red-500/10 text-red-400 border border-red-400/20",
      dot: "bg-red-500",
      track: "bg-red-500",
    },
  };

const LOG_CFG: Record<
  LogType,
  {
    icon: typeof Phone;
    color: string;
    bg: string;
    label: string;
    trackColor: string;
  }
> = {
  call: {
    icon: Phone,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-400/20",
    label: "Call",
    trackColor: "bg-blue-500",
  },
  email: {
    icon: Mail,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-400/20",
    label: "Email",
    trackColor: "bg-violet-500",
  },
  sms: {
    icon: MessageSquare,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-400/20",
    label: "SMS",
    trackColor: "bg-cyan-500",
  },
  note: {
    icon: StickyNote,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-400/20",
    label: "Note",
    trackColor: "bg-amber-500",
  },
  payment: {
    icon: IndianRupee,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-400/20",
    label: "Payment",
    trackColor: "bg-emerald-500",
  },
};

const REMINDER_CFG: Record<string, { pill: string; dot: string }> = {
  sent: {
    pill: "bg-emerald-500/10 text-emerald-400 border border-emerald-400/20",
    dot: "bg-emerald-500",
  },
  overdue: {
    pill: "bg-red-500/10 text-red-400 border border-red-400/20",
    dot: "bg-red-500",
  },
  scheduled: {
    pill: "bg-amber-500/10 text-amber-400 border border-amber-400/20",
    dot: "bg-amber-500",
  },
};

// ─── Reusable primitives ──────────────────────────────────────────────────────

function SectionHeader({
  title,
  icon: Icon,
  count,
  action,
}: {
  title: string;
  icon: typeof Phone;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20 shrink-0">
      <div className="p-1.5 rounded-lg bg-primary/10">
        <Icon size={12} className="text-primary" />
      </div>
      <h3 className="text-[13px] font-semibold text-foreground flex-1">
        {title}
      </h3>
      {count !== undefined && (
        <span className="text-[10px] font-bold bg-primary/10 text-primary rounded-full px-2 py-0.5 min-w-[20px] text-center">
          {count}
        </span>
      )}
      {action}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border border-border rounded-2xl overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

function EmptySlate({
  icon: Icon,
  message,
  sub,
}: {
  icon: typeof FileText;
  message: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-1">
        <Icon size={18} className="opacity-30" />
      </div>
      <p className="text-[12px] font-medium">{message}</p>
      {sub && <p className="text-[11px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

// A single info row — used in the profile card
function InfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Phone;
}) {
  if (!value || value === "—") return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0 group">
      {Icon && (
        <Icon
          size={12}
          className="text-muted-foreground/50 mt-0.5 flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 leading-none mb-1">
          {label}
        </p>
        <p className="text-[13px] font-medium text-foreground break-words leading-snug">
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Hero KPI Card ────────────────────────────────────────────────────────────
function HeroKpi({
  icon,
  label,
  value,
  accent,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent: string;
  sub?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border border-border bg-card p-4 overflow-hidden group hover:-translate-y-0.5 transition-all duration-300 hover:shadow-lg`}
    >
      {/* subtle glow */}
      <div
        className={`absolute -top-4 -right-4 w-16 h-16 rounded-full blur-2xl opacity-20 ${accent}`}
      />
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${accent} bg-opacity-10 border border-current/10`}
        style={{ background: "transparent" }}
      >
        {icon}
      </div>
      <p className="text-[22px] font-bold font-heading text-foreground leading-none tracking-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">
          {sub}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

// ─── Unit Card ────────────────────────────────────────────────────────────────
function UnitCard({ unit }: { unit: UnitSelectionRecord }) {
  return (
    <div className="border border-border rounded-xl p-4 mb-2 last:mb-0 hover:border-primary/30 hover:bg-muted/20 transition-all group">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-bold text-foreground">
              Unit {fmt(unit.UnitNo)}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground/60 font-mono mt-0.5">
            {fmt(unit.SelectionNo)}
          </p>
        </div>
        {unit.Status && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-400/20">
            {unit.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {unit.BlockName && (
          <div className="text-muted-foreground">
            Block{" "}
            <span className="text-foreground font-medium">
              {unit.BlockName}
            </span>
          </div>
        )}
        {unit.FloorName && (
          <div className="text-muted-foreground">
            Floor{" "}
            <span className="text-foreground font-medium">
              {unit.FloorName}
            </span>
          </div>
        )}
        {unit.UnitType && (
          <div className="text-muted-foreground">
            Type{" "}
            <span className="text-foreground font-medium">{unit.UnitType}</span>
          </div>
        )}
        {unit.AreaSqFt && (
          <div className="text-muted-foreground">
            Area{" "}
            <span className="text-foreground font-medium">
              {unit.AreaSqFt} sqft
            </span>
          </div>
        )}
      </div>
      {unit.TotalValue && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Total Value</p>
          <p className="text-[15px] font-bold text-primary">
            {fmtMoney(unit.TotalValue)}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Agreement Card ───────────────────────────────────────────────────────────
function AgreementCard({ agr }: { agr: AgreementRecord }) {
  return (
    <div className="border border-border rounded-xl p-4 mb-2 last:mb-0 hover:border-primary/30 hover:bg-muted/20 transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[13px] font-bold text-foreground">
            {fmt(agr.AgreementNo)}
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            {fmtDate(agr.AgreementDate)}
          </p>
        </div>
        {agr.Status && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-400/20">
            {agr.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-muted/40 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
            Value
          </p>
          <p className="text-[12px] font-bold text-foreground">
            {fmtMoney(agr.AgreementValue)}
          </p>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-400/10 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
            Advance
          </p>
          <p className="text-[12px] font-bold text-emerald-400">
            {fmtMoney(agr.AdvanceAmount)}
          </p>
        </div>
        <div className="bg-amber-500/5 border border-amber-400/10 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
            Balance
          </p>
          <p className="text-[12px] font-bold text-amber-400">
            {fmtMoney(agr.BalanceAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Log Entry ───────────────────────────────────────────────────────
function LogEntry({ log, isLast }: { log: LogRecord; isLast: boolean }) {
  const cfg = LOG_CFG[log.type] ?? LOG_CFG.note;
  const Icon = cfg.icon;
  return (
    <div className="flex gap-3 relative">
      {/* vertical connector */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border/60" />
      )}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border z-10 ${cfg.bg}`}
      >
        <Icon size={12} className={cfg.color} />
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-[12px] font-semibold text-foreground">
            {cfg.label}
          </span>
          {log.amount != null && (
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
              {fmtMoney(log.amount)}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
            {fmtDate(log.createdAt || log.date)}
          </span>
        </div>
        {log.notes && (
          <p className="text-[12px] text-muted-foreground leading-relaxed bg-muted/30 rounded-lg px-2.5 py-2">
            {log.notes}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Quick Log Panel ──────────────────────────────────────────────────────────
function QuickLogPanel({
  refId,
  applicantName,
}: {
  refId: number;
  applicantName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LogFormState>({
    date: "",
    type: "note",
    customer: applicantName,
    amount: "",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: async (payload: object) => {
      const r = await fetchWithAuth("/api/followup-log", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as ApiErrorPayload;
        throw new Error(e.error || "Failed to save");
      }
    },
    onSuccess: () => {
      toast.success("Log entry saved");
      queryClient.invalidateQueries({ queryKey: ["detail-logs", refId] });
      setForm({
        date: "",
        type: "note",
        customer: applicantName,
        amount: "",
        notes: "",
      });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <SectionHeader title="Quick Log" icon={Plus} />
      <div className="p-4">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="w-full flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/40 rounded-xl px-4 py-3 transition-colors group"
          >
            <Plus
              size={13}
              className="group-hover:text-primary transition-colors"
            />
            Add call, email, note or payment…
          </button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block text-muted-foreground">
                  Date
                </Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                  className="h-8 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block text-muted-foreground">
                  Type
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, type: v as LogType }))
                  }
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block text-muted-foreground">
                Amount (optional)
              </Label>
              <Input
                type="number"
                placeholder="₹ 0"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block text-muted-foreground">
                Notes
              </Label>
              <Textarea
                rows={3}
                placeholder="Meeting outcome, next steps…"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                className="text-[13px] resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-8 text-[12px] gradient-accent text-white font-semibold"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    date: form.date || undefined,
                    type: form.type,
                    customer: form.customer.trim(),
                    amount: form.amount ? Number(form.amount) : undefined,
                    refId,
                    notes: form.notes.trim() || undefined,
                  })
                }
              >
                {mutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Save Entry"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[12px]"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ApplicantDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  const stateApplicant = location.state?.applicant as
    | LegacyApplicant
    | undefined;
  const numericId = Number(id);
  const stateName = stateApplicant?.LHeadName || "";

  const {
    data: directFollowupRecord,
    isLoading: applicantLoading,
    isError: applicantError,
  } = useQuery<FollowupApplicant | null>({
    queryKey: ["followup-application-detail", id],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/followup-applications/${id}`);
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as ApiErrorPayload;
        throw new Error(e.error || "Failed");
      }
      return r.json();
    },
    enabled: Boolean(id),
    retry: false,
  });

  const { data: matchedFollowupRecord } = useQuery<FollowupApplicant | null>({
    queryKey: ["followup-applicant-by-ref", stateApplicant?.LHeadId],
    queryFn: async () => {
      const r = await fetchWithAuth(
        `/api/followup-applications?search=${encodeURIComponent(stateName)}&pageSize=5`,
      );
      if (!r.ok) return null;
      const d = await r.json();
      const list: FollowupApplicant[] = d.data ?? [];
      return list.find((a) => a.ApplicantName === stateName) ?? null;
    },
    enabled: Boolean(stateName),
    retry: false,
  });

  const followupRecord = directFollowupRecord ?? matchedFollowupRecord ?? null;
  const applicant = stateApplicant ?? null;
  const name =
    followupRecord?.ApplicantName || stateApplicant?.LHeadName || "Applicant";
  const refId = followupRecord?.Id ?? stateApplicant?.LHeadId ?? numericId;
  const followupId =
    followupRecord?.Id ?? (Number.isFinite(numericId) ? numericId : undefined);

  const { data: unitSelections = [] } = useQuery<UnitSelectionRecord[]>({
    queryKey: ["detail-units", followupId],
    queryFn: async () => {
      const r = await fetchWithAuth(
        `/api/followup-unit-selections?applicantId=${followupId}`,
      );
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d?.data) ? d.data : d;
    },
    enabled: Boolean(followupId),
  });

  const { data: agreements = [] } = useQuery<AgreementRecord[]>({
    queryKey: ["detail-agreements", followupId],
    queryFn: async () => {
      const r = await fetchWithAuth(
        `/api/followup-agreements?applicantId=${followupId}`,
      );
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d?.data) ? d.data : d;
    },
    enabled: Boolean(followupId),
  });

  const { data: logs = [] } = useQuery<LogRecord[]>({
    queryKey: ["detail-logs", refId],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/followup-log?refId=${refId}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: Boolean(refId),
  });

  const { data: reminders = [] } = useQuery<ReminderRecord[]>({
    queryKey: ["detail-reminders", refId],
    queryFn: async () => {
      const r = await fetchWithAuth(
        `/api/tenant-reminders?module=applicant&refId=${refId}`,
      );
      if (!r.ok) return [];
      return r.json();
    },
    enabled: Boolean(refId),
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["followup-application-detail", id],
    });
    queryClient.invalidateQueries({ queryKey: ["detail-units", followupId] });
    queryClient.invalidateQueries({
      queryKey: ["detail-agreements", followupId],
    });
    queryClient.invalidateQueries({ queryKey: ["detail-logs", refId] });
    queryClient.invalidateQueries({ queryKey: ["detail-reminders", refId] });
  };

  // ─── Loading / Error ──────────────────────────────────────────────────────

  if (!applicant && applicantLoading) {
    return (
      <>
        <DashboardBackground />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Loading applicant details…
          </p>
        </div>
      </>
    );
  }

  if (!applicant && (!followupRecord || applicantError)) {
    return (
      <>
        <DashboardBackground />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="p-4 rounded-2xl bg-red-500/10">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <p className="text-sm text-muted-foreground">
            Failed to load applicant details.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/followup/sales/applications")}
          >
            <ArrowLeft size={14} className="mr-2" /> Back to Applications
          </Button>
        </div>
      </>
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isActive = followupRecord
    ? followupRecord.Status !== "Rejected"
    : applicant?.LHeadStatus === 1;
  const statusLabel =
    followupRecord?.Status ?? (isActive ? "Active" : "Inactive");
  const statusCfg = followupRecord?.Status
    ? STATUS_CFG[followupRecord.Status]
    : {
        pill: isActive
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-400/20"
          : "bg-red-500/10 text-red-400 border border-red-400/20",
        dot: isActive ? "bg-emerald-500" : "bg-red-500",
        track: isActive ? "bg-emerald-500" : "bg-red-500",
      };

  const totalDealValue = agreements.reduce(
    (s, a) => s + (a.AgreementValue ?? 0),
    0,
  );
  const totalBalance = agreements.reduce(
    (s, a) => s + (a.BalanceAmount ?? 0),
    0,
  );
  const overdueCount = reminders.filter((r) => r.status === "overdue").length;

  const salesJourneySteps = [
    { label: "Lead Created", sub: "Application registered", done: true },
    {
      label: "Unit Selected",
      sub: "Chose a preferred unit",
      done: unitSelections.length > 0,
    },
    {
      label: "Agreement Signed",
      sub: "Sale agreement executed",
      done: agreements.some((a) => a.Status === "Signed"),
    },
    { label: "Registration", sub: "Document registration done", done: false },
    { label: "Handover", sub: "Keys handed to applicant", done: false },
  ];
  const journeyProgress = salesJourneySteps.filter((s) => s.done).length;
  const journeyPct = (journeyProgress / salesJourneySteps.length) * 100;

  const avatarG = grad(name);

  return (
    <>
      <DashboardBackground />
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Applications", path: "/followup/sales/applications" },
          { label: name },
        ]}
      />
      <FollowupShell title="Applicant Details">
      <div className="relative z-10 max-w-[1400px] mx-auto px-5 py-5 space-y-5">

        {/* ── Hero Header ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Gradient banner */}
          <div
            className={`h-24 bg-gradient-to-r ${avatarG} opacity-[0.15] relative`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/80" />
          </div>

          <div className="px-5 pb-5 -mt-10 relative">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              {/* Avatar + name */}
              <div className="flex items-end gap-4">
                <div
                  className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarG} flex items-center justify-center text-xl font-bold text-white shadow-xl ring-4 ring-card flex-shrink-0`}
                >
                  {initials(name)}
                </div>
                <div className="pb-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-[22px] font-heading font-bold text-foreground leading-tight">
                      {name}
                    </h1>
                    {statusCfg && (
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusCfg.pill}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`}
                        />
                        {statusLabel}
                      </span>
                    )}
                    {overdueCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-400/20">
                        <Bell size={10} /> {overdueCount} overdue
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1 flex items-center gap-2">
                    <span className="font-mono">
                      {fmt(followupRecord?.ApplicantNo ?? applicant?.LHeadCode)}
                    </span>
                    {(followupRecord?.ProjectName ||
                      applicant?.LBranchName) && (
                      <>
                        <span className="text-border">·</span>
                        <span className="flex items-center gap-1">
                          <Building2 size={10} />
                          {followupRecord?.ProjectName ??
                            applicant?.LBranchName}
                        </span>
                      </>
                    )}
                    {followupRecord?.City && (
                      <>
                        <span className="text-border">·</span>
                        <span className="flex items-center gap-1">
                          <MapPin size={10} />
                          {followupRecord.City}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pb-1">
                <button
                  onClick={() => navigate("/followup/sales/applications")}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-xl px-3 py-2 hover:bg-muted transition-colors"
                >
                  <ArrowLeft size={12} /> Back
                </button>
                <button
                  onClick={refresh}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-xl px-3 py-2 hover:bg-muted transition-colors"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>

            {/* Quick contact strip */}
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-border/60">
              {(followupRecord?.PrimaryMobile ?? applicant?.LHeadPhone) && (
                <a
                  href={`tel:${followupRecord?.PrimaryMobile ?? applicant?.LHeadPhone}`}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted border border-border"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone size={11} className="text-blue-400" />
                  {followupRecord?.PrimaryMobile ?? applicant?.LHeadPhone}
                </a>
              )}
              {(followupRecord?.Email ?? applicant?.LHeadEmail) && (
                <a
                  href={`mailto:${followupRecord?.Email ?? applicant?.LHeadEmail}`}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted border border-border"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail size={11} className="text-violet-400" />
                  {followupRecord?.Email ?? applicant?.LHeadEmail}
                </a>
              )}
              {followupRecord?.Source && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                  <Sparkles size={11} className="text-amber-400" />
                  Source:{" "}
                  <span className="text-foreground font-medium ml-1">
                    {followupRecord.Source}
                  </span>
                </div>
              )}
              {followupRecord?.AssignedToName && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                  <UserRound size={11} className="text-emerald-400" />
                  Assigned:{" "}
                  <span className="text-foreground font-medium ml-1">
                    {followupRecord.AssignedToName}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── KPI Strip ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HeroKpi
            icon={<FileText size={15} className="text-violet-400" />}
            label="Agreements"
            value={agreements.length}
            accent="bg-violet-500/10"
          />
          <HeroKpi
            icon={<Home size={15} className="text-blue-400" />}
            label="Unit Selections"
            value={unitSelections.length}
            accent="bg-blue-500/10"
          />
          <HeroKpi
            icon={<IndianRupee size={15} className="text-emerald-400" />}
            label="Total Deal Value"
            value={totalDealValue > 0 ? fmtMoney(totalDealValue) : "—"}
            sub={totalDealValue > 0 ? "combined agreements" : undefined}
            accent="bg-emerald-500/10"
          />
          <HeroKpi
            icon={
              <Wallet
                size={15}
                className={
                  totalBalance > 0 ? "text-amber-400" : "text-muted-foreground"
                }
              />
            }
            label="Balance Due"
            value={totalBalance > 0 ? fmtMoney(totalBalance) : "—"}
            sub={totalBalance > 0 ? "outstanding" : undefined}
            accent={totalBalance > 0 ? "bg-amber-500/10" : "bg-muted"}
          />
        </div>

        {/* ── Three-column layout ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_300px] gap-5">
          {/* ── LEFT: Profile ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <Card>
              <SectionHeader title="Applicant Profile" icon={UserRound} />
              <div className="p-4 space-y-0">
                <InfoRow
                  label="Mobile"
                  value={fmt(
                    followupRecord?.PrimaryMobile ?? applicant?.LHeadPhone,
                  )}
                  icon={Phone}
                />
                <InfoRow
                  label="Email"
                  value={fmt(followupRecord?.Email ?? applicant?.LHeadEmail)}
                  icon={Mail}
                />
                <InfoRow
                  label="Address"
                  value={fmt(
                    followupRecord?.ApplicantAddress ?? applicant?.LHeadAddress,
                  )}
                  icon={MapPin}
                />
                <InfoRow
                  label="PAN / GST"
                  value={fmt(followupRecord?.PanNumber ?? applicant?.LGST)}
                  icon={Hash}
                />
                <InfoRow
                  label="Co-Applicant"
                  value={fmt(
                    followupRecord?.CoApplicantName ??
                      applicant?.LHeadContactPerson,
                  )}
                  icon={UserRound}
                />
                <InfoRow
                  label="Co-applicant Phone"
                  value={fmt(followupRecord?.CoApplicantPhone)}
                  icon={Phone}
                />
                <InfoRow
                  label="GST State"
                  value={fmt(applicant?.LGSTState)}
                  icon={Building2}
                />
                <InfoRow
                  label="Country"
                  value={fmt(applicant?.LCountry)}
                  icon={Globe}
                />
                <InfoRow
                  label="Payment Terms"
                  value={fmt(applicant?.LHeadPaymentTerms)}
                  icon={CreditCard}
                />
                <InfoRow
                  label="Branch"
                  value={fmt(applicant?.LBranchName)}
                  icon={Building2}
                />
              </div>

              {applicant?.LDescription && (
                <div className="mx-4 mb-4 bg-muted/40 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Description
                  </p>
                  <p className="text-[12px] text-foreground leading-relaxed">
                    {applicant.LDescription}
                  </p>
                </div>
              )}

              {followupRecord && (
                <>
                  <div className="h-px bg-border/60 mx-4" />
                  <div className="p-4 pt-3 space-y-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                      Application Details
                    </p>
                    <InfoRow
                      label="Application Date"
                      value={fmtDate(followupRecord.ApplicationDate)}
                      icon={CalendarDays}
                    />
                    <InfoRow
                      label="City"
                      value={fmt(followupRecord.City)}
                      icon={MapPin}
                    />
                    <InfoRow
                      label="Source"
                      value={fmt(followupRecord.Source)}
                      icon={Hash}
                    />
                    <InfoRow
                      label="Budget"
                      value={fmtMoney(followupRecord.BudgetAmount)}
                      icon={IndianRupee}
                    />
                    <InfoRow
                      label="Preferred Unit"
                      value={fmt(
                        followupRecord.UnitName
                          ? `${followupRecord.BlockName ? `${followupRecord.BlockName} / ` : ""}${followupRecord.UnitName}`
                          : followupRecord.PreferredUnitType,
                      )}
                      icon={Home}
                    />
                    <InfoRow
                      label="Project"
                      value={fmt(followupRecord.ProjectName)}
                      icon={Layers}
                    />
                    <InfoRow
                      label="Company"
                      value={fmt(followupRecord.CompanyName)}
                      icon={Building2}
                    />
                    <InfoRow
                      label="Assigned To"
                      value={fmt(followupRecord.AssignedToName)}
                      icon={UserRound}
                    />
                    <InfoRow
                      label="Created"
                      value={fmtDateTime(followupRecord.CreatedAt)}
                      icon={CalendarDays}
                    />
                  </div>
                </>
              )}
            </Card>

            <QuickLogPanel refId={refId} applicantName={name} />
          </div>

          {/* ── CENTRE: Units + Agreements ─────────────────────────────── */}
          <div className="space-y-4">
            <Card>
              <SectionHeader
                title="Unit Selections"
                icon={Home}
                count={unitSelections.length}
              />
              <div className="p-4">
                {unitSelections.length === 0 ? (
                  <EmptySlate
                    icon={Home}
                    message="No unit selections linked."
                    sub="Unit selections will appear here once created."
                  />
                ) : (
                  unitSelections.map((u) => <UnitCard key={u.Id} unit={u} />)
                )}
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="Agreements"
                icon={FileText}
                count={agreements.length}
              />
              <div className="p-4">
                {agreements.length === 0 ? (
                  <EmptySlate
                    icon={FileText}
                    message="No agreements yet."
                    sub="Agreements will appear once a unit is confirmed."
                  />
                ) : (
                  agreements.map((a) => <AgreementCard key={a.Id} agr={a} />)
                )}
              </div>
            </Card>

            {/* Follow-Up Log — timeline style */}
            <Card>
              <SectionHeader
                title="Follow-Up Log"
                icon={ClipboardList}
                count={logs.length}
              />
              <div className="p-4">
                {logs.length === 0 ? (
                  <EmptySlate
                    icon={ClipboardList}
                    message="No log entries yet."
                    sub="Log calls, emails and notes using Quick Log."
                  />
                ) : (
                  <div className="max-h-[360px] overflow-y-auto -mr-2 pr-2">
                    {logs.map((l, i) => (
                      <LogEntry
                        key={l.id}
                        log={l}
                        isLast={i === logs.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ── RIGHT: Journey + Notes + Reminders ────────────────────── */}
          <div className="space-y-4">
            {/* Sales Journey */}
            <Card>
              <SectionHeader title="Sales Journey" icon={Target} />
              <div className="p-4">
                {/* Progress bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-muted-foreground">
                      Progress
                    </p>
                    <p className="text-[11px] font-bold text-foreground tabular-nums">
                      {journeyProgress}/{salesJourneySteps.length} steps
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700 shadow-sm shadow-emerald-500/30"
                      style={{ width: `${journeyPct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
                    {Math.round(journeyPct)}% complete
                  </p>
                </div>

                {/* Steps */}
                <div className="space-y-0">
                  {salesJourneySteps.map((step, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 relative py-2.5 border-b border-border/50 last:border-0"
                    >
                      {/* connector line */}
                      {i < salesJourneySteps.length - 1 && (
                        <div
                          className={`absolute left-[11px] top-9 h-3 w-px ${step.done ? "bg-emerald-500/40" : "bg-border/60"}`}
                        />
                      )}
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all z-10 ${step.done ? "bg-emerald-500 shadow-sm shadow-emerald-500/30" : "bg-muted border border-border"}`}
                      >
                        {step.done ? (
                          <CheckCircle2 size={12} className="text-white" />
                        ) : (
                          <Circle
                            size={8}
                            className="text-muted-foreground/30"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[12px] leading-tight ${step.done ? "text-foreground font-semibold" : "text-muted-foreground"}`}
                        >
                          {step.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                          {step.sub}
                        </p>
                      </div>
                      {step.done && (
                        <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full px-1.5 py-0.5 shrink-0">
                          ✓
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Notes */}
            {followupRecord?.Notes && (
              <Card>
                <SectionHeader title="Notes" icon={StickyNote} />
                <div className="p-4">
                  <p className="text-[13px] text-foreground leading-relaxed bg-muted/30 rounded-xl p-3 border border-border/50">
                    {followupRecord.Notes}
                  </p>
                </div>
              </Card>
            )}

            {/* Reminders */}
            <Card>
              <SectionHeader
                title="Reminders"
                icon={Bell}
                count={reminders.length}
              />
              <div className="p-4">
                {reminders.length === 0 ? (
                  <EmptySlate icon={Bell} message="No reminders set." />
                ) : (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {reminders.map((r) => {
                      const rcfg = REMINDER_CFG[r.status] ?? {
                        pill: "bg-muted text-muted-foreground border border-border",
                        dot: "bg-muted-foreground",
                      };
                      return (
                        <div
                          key={r.id}
                          className={`flex items-start gap-2.5 border rounded-xl p-3 transition-colors ${r.status === "overdue" ? "border-red-400/20 bg-red-500/5" : "border-border hover:border-primary/20"}`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${rcfg.dot}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-foreground truncate">
                              {r.message || r.tenantName}
                            </p>
                            {r.dueDate && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Clock size={9} />
                                {fmtDate(r.dueDate)}
                                {r.amountDue
                                  ? ` · ${fmtMoney(r.amountDue)}`
                                  : ""}
                              </p>
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${rcfg.pill}`}
                          >
                            {r.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
      </FollowupShell>
    </>
  );
}
