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
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

const AVATAR_PALETTE = [
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-teal-600",
  "from-emerald-500 to-green-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-red-600",
  "from-pink-500 to-fuchsia-600",
  "from-indigo-500 to-blue-600",
];

function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

const APPLICATION_STATUS_CONFIG: Record<
  string,
  { color: string; dot: string }
> = {
  New: {
    color: "bg-sky-500/10 text-sky-500 border border-sky-400/20",
    dot: "bg-sky-500",
  },
  Qualified: {
    color: "bg-emerald-500/10 text-emerald-500 border border-emerald-400/20",
    dot: "bg-emerald-500",
  },
  Shortlisted: {
    color: "bg-violet-500/10 text-violet-500 border border-violet-400/20",
    dot: "bg-violet-500",
  },
  "Document Pending": {
    color: "bg-amber-500/10 text-amber-500 border border-amber-400/20",
    dot: "bg-amber-500",
  },
  Rejected: {
    color: "bg-red-500/10 text-red-500 border border-red-400/20",
    dot: "bg-red-500",
  },
};

const LOG_TYPE_CONFIG: Record<
  LogType,
  { icon: typeof Phone; color: string; bg: string; label: string }
> = {
  call: {
    icon: Phone,
    color: "text-blue-500",
    bg: "bg-blue-500/10 border-blue-400/20",
    label: "Call",
  },
  email: {
    icon: Mail,
    color: "text-violet-500",
    bg: "bg-violet-500/10 border-violet-400/20",
    label: "Email",
  },
  sms: {
    icon: MessageSquare,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10 border-cyan-400/20",
    label: "SMS",
  },
  note: {
    icon: StickyNote,
    color: "text-amber-500",
    bg: "bg-amber-500/10 border-amber-400/20",
    label: "Note",
  },
  payment: {
    icon: IndianRupee,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10 border-emerald-400/20",
    label: "Payment",
  },
};

const REMINDER_STATUS: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-500 border border-emerald-400/20",
  overdue: "bg-red-500/10 text-red-500 border border-red-400/20",
  scheduled: "bg-amber-500/10 text-amber-500 border border-amber-400/20",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      {Icon && (
        <Icon
          size={13}
          className="text-muted-foreground mt-0.5 flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none mb-1">
          {label}
        </p>
        <p className="text-[13px] font-medium text-foreground break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  badge,
  action,
}: {
  title: string;
  icon: typeof Phone;
  children: React.ReactNode;
  badge?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/20">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Icon size={13} className="text-primary" />
        </div>
        <h3 className="text-[13px] font-semibold text-foreground flex-1">
          {title}
        </h3>
        {badge !== undefined && (
          <span className="text-[11px] font-bold bg-primary/10 text-primary rounded-full px-2 py-0.5 min-w-[22px] text-center">
            {badge}
          </span>
        )}
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: typeof FileText;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
      <Icon size={28} className="opacity-20" />
      <p className="text-[12px]">{message}</p>
    </div>
  );
}

function UnitCard({ unit }: { unit: UnitSelectionRecord }) {
  return (
    <div className="border border-border rounded-xl p-3.5 mb-2 last:mb-0 hover:border-primary/30 hover:bg-muted/20 transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            Unit {fmt(unit.UnitNo)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {fmt(unit.SelectionNo)}
          </p>
        </div>
        {unit.Status && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-400/20">
            {unit.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {unit.BlockName && (
          <div className="text-[11px] text-muted-foreground">
            Block:{" "}
            <span className="text-foreground font-medium">
              {unit.BlockName}
            </span>
          </div>
        )}
        {unit.FloorName && (
          <div className="text-[11px] text-muted-foreground">
            Floor:{" "}
            <span className="text-foreground font-medium">
              {unit.FloorName}
            </span>
          </div>
        )}
        {unit.UnitType && (
          <div className="text-[11px] text-muted-foreground">
            Type:{" "}
            <span className="text-foreground font-medium">{unit.UnitType}</span>
          </div>
        )}
        {unit.AreaSqFt && (
          <div className="text-[11px] text-muted-foreground">
            Area:{" "}
            <span className="text-foreground font-medium">
              {unit.AreaSqFt} sqft
            </span>
          </div>
        )}
      </div>
      {unit.TotalValue && (
        <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Total Value</p>
          <p className="text-[14px] font-bold text-primary">
            {fmtMoney(unit.TotalValue)}
          </p>
        </div>
      )}
    </div>
  );
}

function AgreementCard({ agr }: { agr: AgreementRecord }) {
  return (
    <div className="border border-border rounded-xl p-3.5 mb-2 last:mb-0 hover:border-primary/30 hover:bg-muted/20 transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            {fmt(agr.AgreementNo)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {fmtDate(agr.AgreementDate)}
          </p>
        </div>
        {agr.Status && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 border border-violet-400/20">
            {agr.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-muted/40 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">
            Value
          </p>
          <p className="text-[12px] font-bold text-foreground">
            {fmtMoney(agr.AgreementValue)}
          </p>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-400/10 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">
            Advance
          </p>
          <p className="text-[12px] font-bold text-emerald-500">
            {fmtMoney(agr.AdvanceAmount)}
          </p>
        </div>
        <div className="bg-amber-500/5 border border-amber-400/10 rounded-xl p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">
            Balance
          </p>
          <p className="text-[12px] font-bold text-amber-500">
            {fmtMoney(agr.BalanceAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}

function LogEntry({ log }: { log: LogRecord }) {
  const cfg = LOG_TYPE_CONFIG[log.type] ?? LOG_TYPE_CONFIG.note;
  const Icon = cfg.icon;
  return (
    <div className="flex gap-3 py-3 border-b border-border/60 last:border-0">
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border ${cfg.bg}`}
      >
        <Icon size={13} className={cfg.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[12px] font-semibold text-foreground">
            {cfg.label}
          </span>
          {log.amount && (
            <span className="text-[11px] font-medium text-emerald-500 bg-emerald-500/10 rounded-full px-2 py-0.5">
              {fmtMoney(log.amount)}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {fmtDate(log.createdAt || log.date)}
          </span>
        </div>
        {log.notes && (
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            {log.notes}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  bg,
  color,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  bg: string;
  color: string;
  small?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
      <div className={`p-2 rounded-xl ${bg} w-fit mb-3`}>
        <span className={color}>{icon}</span>
      </div>
      <p
        className={`font-bold font-heading text-foreground leading-none ${small ? "text-[18px]" : "text-2xl"}`}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1.5">{label}</p>
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
    <Panel title="Quick Log" icon={Plus}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/40 rounded-xl px-4 py-3 transition-colors"
        >
          <Plus size={13} />
          Add call, email, note or payment…
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block text-muted-foreground">
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
              <Label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block text-muted-foreground">
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
            <Label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block text-muted-foreground">
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
            <Label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block text-muted-foreground">
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
              className="flex-1 h-8 text-[12px]"
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
    </Panel>
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
        throw new Error(e.error || "Failed to load applicant");
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

  // ─── Loading / Error states ───────────────────────────────────────────────

  if (!applicant && applicantLoading) {
    return (
      <>
        <DashboardBackground />
        <div className="relative z-10 p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3">
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
        <div className="relative z-10 p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4">
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
    ? APPLICATION_STATUS_CONFIG[followupRecord.Status]
    : {
        color: isActive
          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-400/20"
          : "bg-red-500/10 text-red-500 border border-red-400/20",
        dot: isActive ? "bg-emerald-500" : "bg-red-500",
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
    { label: "Lead Created", done: true },
    { label: "Unit Selected", done: unitSelections.length > 0 },
    {
      label: "Agreement Signed",
      done: agreements.some((a) => a.Status === "Signed"),
    },
    { label: "Registration", done: false },
    { label: "Handover", done: false },
  ];

  const journeyProgress = salesJourneySteps.filter((s) => s.done).length;

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-5 max-w-[1400px] mx-auto space-y-5">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Breadcrumbs
              items={[
                { label: "Follow-Up", path: "/followup" },
                { label: "Applications", path: "/followup/sales/applications" },
                { label: name, path: "#" },
              ]}
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => navigate("/followup/sales/applications")}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={16} />
              </button>
              <div
                className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${avatarGradient(name)} flex items-center justify-center text-[15px] font-bold text-white flex-shrink-0 shadow-lg`}
              >
                {initials(name)}
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-heading font-bold text-foreground leading-tight">
                    {name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusCfg?.color}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${statusCfg?.dot}`}
                    />
                    {statusLabel}
                  </span>
                  {overdueCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-400/20">
                      <Bell size={10} /> {overdueCount} overdue
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {fmt(followupRecord?.ApplicantNo ?? applicant?.LHeadCode)}
                  {followupRecord?.ProjectName
                    ? ` · ${followupRecord.ProjectName}`
                    : applicant?.LBranchName
                      ? ` · ${applicant.LBranchName}`
                      : ""}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-xl px-3 py-2 hover:bg-muted transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            icon={<FileText size={16} />}
            label="Agreements"
            value={agreements.length}
            bg="bg-violet-500/10"
            color="text-violet-500"
          />
          <KpiCard
            icon={<Home size={16} />}
            label="Unit Selections"
            value={unitSelections.length}
            bg="bg-blue-500/10"
            color="text-blue-500"
          />
          <KpiCard
            icon={<IndianRupee size={16} />}
            label="Total Deal Value"
            value={totalDealValue > 0 ? fmtMoney(totalDealValue) : "—"}
            bg="bg-emerald-500/10"
            color="text-emerald-500"
            small
          />
          <KpiCard
            icon={<TrendingUp size={16} />}
            label="Balance Due"
            value={totalBalance > 0 ? fmtMoney(totalBalance) : "—"}
            bg={totalBalance > 0 ? "bg-amber-500/10" : "bg-muted"}
            color={
              totalBalance > 0 ? "text-amber-500" : "text-muted-foreground"
            }
            small
          />
        </div>

        {/* ── Three-column layout ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_280px] gap-5">
          {/* LEFT: Profile */}
          <div className="space-y-4">
            <Panel title="Applicant Profile" icon={UserRound}>
              <div>
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
                  label="Contact Person"
                  value={fmt(
                    followupRecord?.CoApplicantName ??
                      applicant?.LHeadContactPerson,
                  )}
                  icon={UserRound}
                />
                <InfoRow
                  label="PAN / GST"
                  value={fmt(followupRecord?.PanNumber ?? applicant?.LGST)}
                  icon={Hash}
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
                  label="Belongs To"
                  value={fmt(applicant?.LBelongsTo)}
                  icon={Layers}
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
                <div className="mt-3 bg-muted/40 rounded-xl p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Description
                  </p>
                  <p className="text-[12px] text-foreground leading-relaxed">
                    {applicant.LDescription}
                  </p>
                </div>
              )}
              {followupRecord && (
                <div className="mt-3 pt-3 border-t border-border space-y-0">
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
                    label="Assigned To"
                    value={fmt(followupRecord.AssignedToName)}
                    icon={UserRound}
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
                    label="Created"
                    value={fmtDateTime(followupRecord.CreatedAt)}
                    icon={CalendarDays}
                  />
                </div>
              )}
            </Panel>

            <QuickLogPanel refId={refId} applicantName={name} />
          </div>

          {/* CENTRE: Unit Selections + Agreements */}
          <div className="space-y-4">
            <Panel
              title="Unit Selections"
              icon={Home}
              badge={unitSelections.length}
            >
              {unitSelections.length === 0 ? (
                <EmptyState icon={Home} message="No unit selections linked." />
              ) : (
                unitSelections.map((u) => <UnitCard key={u.Id} unit={u} />)
              )}
            </Panel>

            <Panel title="Agreements" icon={FileText} badge={agreements.length}>
              {agreements.length === 0 ? (
                <EmptyState icon={FileText} message="No agreements yet." />
              ) : (
                agreements.map((a) => <AgreementCard key={a.Id} agr={a} />)
              )}
            </Panel>
          </div>

          {/* RIGHT: Log + Reminders + Sales Journey */}
          <div className="space-y-4">
            {/* Sales Journey */}
            <Panel title="Sales Journey" icon={BadgeCheck}>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] text-muted-foreground">Progress</p>
                  <p className="text-[11px] font-semibold text-foreground">
                    {journeyProgress}/{salesJourneySteps.length}
                  </p>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                    style={{
                      width: `${(journeyProgress / salesJourneySteps.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="space-y-0">
                {salesJourneySteps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2.5 border-b border-border/60 last:border-0"
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${step.done ? "bg-emerald-500 shadow-sm shadow-emerald-500/30" : "bg-muted border border-border"}`}
                    >
                      {step.done ? (
                        <CheckCircle2 size={13} className="text-white" />
                      ) : (
                        <Circle
                          size={10}
                          className="text-muted-foreground/40"
                        />
                      )}
                    </div>
                    <span
                      className={`text-[12px] flex-1 ${step.done ? "text-foreground font-medium" : "text-muted-foreground"}`}
                    >
                      {step.label}
                    </span>
                    {step.done && (
                      <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 rounded-full px-2 py-0.5">
                        Done
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            {/* Follow-Up Log */}
            <Panel
              title="Follow-Up Log"
              icon={ClipboardList}
              badge={logs.length}
            >
              {logs.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  message="No log entries yet."
                />
              ) : (
                <div className="max-h-[300px] overflow-y-auto -mr-2 pr-2">
                  {logs.map((l) => (
                    <LogEntry key={l.id} log={l} />
                  ))}
                </div>
              )}
            </Panel>

            {/* Reminders */}
            <Panel title="Reminders" icon={Bell} badge={reminders.length}>
              {reminders.length === 0 ? (
                <EmptyState icon={Bell} message="No reminders set." />
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto">
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-2.5 border border-border rounded-xl p-3 hover:border-primary/20 transition-colors"
                    >
                      <Bell
                        size={12}
                        className={`mt-0.5 flex-shrink-0 ${r.status === "overdue" ? "text-red-500" : "text-muted-foreground"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground truncate">
                          {r.message || r.tenantName}
                        </p>
                        {r.dueDate && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Due: {fmtDate(r.dueDate)}
                            {r.amountDue ? ` · ${fmtMoney(r.amountDue)}` : ""}
                          </p>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${REMINDER_STATUS[r.status] ?? "bg-muted text-muted-foreground border-border"}`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
