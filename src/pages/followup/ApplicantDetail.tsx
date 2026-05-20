import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
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

interface ApplicantRecord {
  Id: number;
  ApplicantNo?: string | null;
  ApplicantName?: string | null;
  PrimaryMobile?: string | null;
  Email?: string | null;
  City?: string | null;
  Source?: string | null;
  ProjectId?: number | null;
  ProjectName?: string | null;
  CompanyId?: number | null;
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
  RatePerSqFt?: number | null;
  TotalValue?: number | null;
  BookingAmount?: number | null;
  SelectionDate?: string | null;
  Status?: string | null;
  ProjectName?: string | null;
  Notes?: string | null;
  CreatedAt?: string | null;
}

interface AgreementRecord {
  Id: number;
  AgreementNo?: string | null;
  AgreementDate?: string | null;
  AgreementValue?: number | null;
  AdvanceAmount?: number | null;
  BalanceAmount?: number | null;
  RegistrationDate?: string | null;
  Status?: string | null;
  ProjectName?: string | null;
  UnitNo?: string | null;
  SelectionNo?: string | null;
  Notes?: string | null;
  CreatedAt?: string | null;
}

interface LogRecord {
  id: string;
  date: string;
  type: LogType;
  customer: string;
  amount: number | null;
  notes: string;
  user: string;
  createdAt: string;
}

interface ReminderRecord {
  id: number;
  tenantName: string;
  message?: string | null;
  module?: string | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v?: string | null) {
  return v || "—";
}
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
  return `₹${v.toLocaleString("en-IN")}`;
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
  "#2563EB",
  "#7C3AED",
  "#0891B2",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#4F46E5",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// ─── Status configs ───────────────────────────────────────────────────────────

const APPLICANT_STATUS: Record<string, { pill: string }> = {
  Active: {
    pill: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
  },
  Inactive: { pill: "bg-red-500/10 text-red-500 border border-red-400/20" },
  Interested: {
    pill: "bg-blue-500/10 text-blue-600 border border-blue-400/20",
  },
  Booked: {
    pill: "bg-violet-500/10 text-violet-600 border border-violet-400/20",
  },
  Closed: { pill: "bg-slate-500/10 text-slate-500 border border-slate-400/20" },
};

const LOG_TYPE_CONFIG: Record<
  LogType,
  { icon: typeof Phone; color: string; bg: string }
> = {
  call: {
    icon: Phone,
    color: "text-blue-600",
    bg: "bg-blue-500/10 border-blue-400/20",
  },
  email: {
    icon: Mail,
    color: "text-violet-600",
    bg: "bg-violet-500/10 border-violet-400/20",
  },
  sms: {
    icon: MessageSquare,
    color: "text-cyan-600",
    bg: "bg-cyan-500/10 border-cyan-400/20",
  },
  note: {
    icon: StickyNote,
    color: "text-amber-600",
    bg: "bg-amber-500/10 border-amber-400/20",
  },
  payment: {
    icon: IndianRupee,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10 border-emerald-400/20",
  },
};

const REMINDER_STATUS: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  overdue: "bg-red-500/10 text-red-500 border-red-400/20",
  scheduled: "bg-amber-500/10 text-amber-600 border-amber-400/20",
};

// ─── API fetchers ─────────────────────────────────────────────────────────────

async function fetchApplicant(id: string): Promise<ApplicantRecord> {
  const r = await fetchWithAuth(`/api/followup-applicants/${id}`);
  if (!r.ok) throw new Error("Failed to load applicant");
  return r.json();
}
async function fetchUnitSelections(id: string): Promise<UnitSelectionRecord[]> {
  const r = await fetchWithAuth(
    `/api/followup-unit-selections?applicantId=${id}`,
  );
  if (!r.ok) throw new Error("Failed to load unit selections");
  const d = await r.json();
  return Array.isArray(d?.data) ? d.data : d;
}
async function fetchAgreements(id: string): Promise<AgreementRecord[]> {
  const r = await fetchWithAuth(`/api/followup-agreements?applicantId=${id}`);
  if (!r.ok) throw new Error("Failed to load agreements");
  const d = await r.json();
  return Array.isArray(d?.data) ? d.data : d;
}
async function fetchLogs(id: string): Promise<LogRecord[]> {
  const r = await fetchWithAuth(`/api/followup-log?refId=${id}`);
  if (!r.ok) throw new Error("Failed to load logs");
  return r.json();
}
async function fetchReminders(id: string): Promise<ReminderRecord[]> {
  const r = await fetchWithAuth(
    `/api/tenant-reminders?module=applicant&refId=${id}`,
  );
  if (!r.ok) throw new Error("Failed to load reminders");
  return r.json();
}

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
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      {Icon && (
        <Icon
          size={14}
          className="text-muted-foreground mt-0.5 flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground leading-none mb-0.5">
          {label}
        </p>
        <p className="text-[13px] font-medium text-foreground truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
  badge,
}: {
  title: string;
  icon: typeof Phone;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/30">
        <Icon size={14} className="text-primary" />
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {badge !== undefined && (
          <span className="ml-auto text-[11px] font-semibold bg-primary/10 text-primary rounded-full px-2 py-0.5">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function UnitCard({ unit }: { unit: UnitSelectionRecord }) {
  return (
    <div className="border border-border rounded-lg p-3 mb-2 last:mb-0 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            Unit {fmt(unit.UnitNo)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fmt(unit.SelectionNo)}
          </p>
        </div>
        {unit.Status && (
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${APPLICANT_STATUS[unit.Status]?.pill ?? "bg-muted text-muted-foreground border-border"}`}
          >
            {unit.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {unit.BlockName && (
          <p className="text-[11px] text-muted-foreground">
            Block:{" "}
            <span className="text-foreground font-medium">
              {unit.BlockName}
            </span>
          </p>
        )}
        {unit.FloorName && (
          <p className="text-[11px] text-muted-foreground">
            Floor:{" "}
            <span className="text-foreground font-medium">
              {unit.FloorName}
            </span>
          </p>
        )}
        {unit.UnitType && (
          <p className="text-[11px] text-muted-foreground">
            Type:{" "}
            <span className="text-foreground font-medium">{unit.UnitType}</span>
          </p>
        )}
        {unit.AreaSqFt && (
          <p className="text-[11px] text-muted-foreground">
            Area:{" "}
            <span className="text-foreground font-medium">
              {unit.AreaSqFt} sqft
            </span>
          </p>
        )}
      </div>
      {unit.TotalValue && (
        <p className="text-[13px] font-bold text-primary mt-2">
          {fmtMoney(unit.TotalValue)}
        </p>
      )}
    </div>
  );
}

function AgreementCard({ agr }: { agr: AgreementRecord }) {
  return (
    <div className="border border-border rounded-lg p-3 mb-2 last:mb-0 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            {fmt(agr.AgreementNo)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fmtDate(agr.AgreementDate)}
          </p>
        </div>
        {agr.Status && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-400/20">
            {agr.Status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Value</p>
          <p className="text-[12px] font-bold text-foreground">
            {fmtMoney(agr.AgreementValue)}
          </p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Advance</p>
          <p className="text-[12px] font-bold text-emerald-600">
            {fmtMoney(agr.AdvanceAmount)}
          </p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Balance</p>
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
    <div className="flex gap-3 py-3 border-b border-border last:border-0">
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${cfg.bg}`}
      >
        <Icon size={14} className={cfg.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[12px] font-semibold text-foreground capitalize">
            {log.type}
          </span>
          {log.amount && (
            <span className="text-[11px] font-medium text-emerald-600">
              {fmtMoney(log.amount)}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {fmtDate(log.createdAt || log.date)}
          </span>
        </div>
        {log.notes && (
          <p className="text-[12px] text-muted-foreground leading-snug">
            {log.notes}
          </p>
        )}
        {log.customer && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            by {log.customer}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Quick Log Form ───────────────────────────────────────────────────────────

function QuickLogPanel({
  applicantId,
  applicantName,
}: {
  applicantId: number;
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
        const e = await r.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to save");
      }
    },
    onSuccess: () => {
      toast.success("Log entry saved");
      queryClient.invalidateQueries({
        queryKey: ["followup-logs", String(applicantId)],
      });
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
    <SectionCard title="Quick Log" icon={Plus}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/40 rounded-lg px-3 py-2.5 transition-colors"
        >
          <Plus size={13} />
          Add call, email, note or payment…
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] mb-1 block">Date</Label>
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
              <Label className="text-[11px] mb-1 block">Type</Label>
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
            <Label className="text-[11px] mb-1 block">Amount (optional)</Label>
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
            <Label className="text-[11px] mb-1 block">Notes</Label>
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
                  refId: applicantId,
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
    </SectionCard>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ApplicantDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const applicantId = id ?? "";

  const {
    data: applicant,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["followup-applicant", applicantId],
    queryFn: () => fetchApplicant(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: unitSelections = [] } = useQuery({
    queryKey: ["followup-unit-selections", applicantId],
    queryFn: () => fetchUnitSelections(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: agreements = [] } = useQuery({
    queryKey: ["followup-agreements", applicantId],
    queryFn: () => fetchAgreements(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["followup-logs", applicantId],
    queryFn: () => fetchLogs(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ["followup-reminders", applicantId],
    queryFn: () => fetchReminders(applicantId),
    enabled: Boolean(applicantId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["followup-applicant", applicantId],
    });
    queryClient.invalidateQueries({
      queryKey: ["followup-unit-selections", applicantId],
    });
    queryClient.invalidateQueries({
      queryKey: ["followup-agreements", applicantId],
    });
    queryClient.invalidateQueries({ queryKey: ["followup-logs", applicantId] });
    queryClient.invalidateQueries({
      queryKey: ["followup-reminders", applicantId],
    });
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const name = applicant?.ApplicantName || "Applicant";
  const statusCfg = applicant?.Status
    ? APPLICANT_STATUS[applicant.Status]
    : null;

  const totalDealValue = agreements.reduce(
    (s, a) => s + (a.AgreementValue ?? 0),
    0,
  );
  const totalBalance = agreements.reduce(
    (s, a) => s + (a.BalanceAmount ?? 0),
    0,
  );
  const overdueCount = reminders.filter((r) => r.status === "overdue").length;

  // ─── States ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <DashboardBackground />
        <div className="relative z-10 p-6 flex items-center justify-center min-h-[60vh]">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading applicant…</span>
          </div>
        </div>
      </>
    );
  }

  if (isError || !applicant) {
    return (
      <>
        <DashboardBackground />
        <div className="relative z-10 p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="p-3 rounded-2xl bg-red-500/10">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <p className="text-sm text-muted-foreground">
            Failed to load applicant details.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/followup/sales/applicants")}
          >
            <ArrowLeft size={14} className="mr-2" /> Back to Applicants
          </Button>
        </div>
      </>
    );
  }

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
                { label: "Applicants", path: "/followup/sales/applicants" },
                { label: name, path: "#" },
              ]}
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => navigate("/followup/sales/applicants")}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={16} />
              </button>
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-[15px] font-bold text-white flex-shrink-0"
                style={{ background: avatarColor(name) }}
              >
                {initials(name)}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-heading font-bold text-foreground leading-tight">
                    {name}
                  </h1>
                  {statusCfg && (
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusCfg.pill}`}
                    >
                      {applicant.Status}
                    </span>
                  )}
                  {overdueCount > 0 && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-400/20">
                      <Bell size={10} /> {overdueCount} overdue
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {fmt(applicant.ApplicantNo)} · {fmt(applicant.ProjectName)} ·
                  Assigned to {fmt(applicant.AssignedToName)}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors mt-1"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              icon: <FileText size={16} />,
              label: "Agreements",
              value: agreements.length,
              accent: "text-violet-600",
              bg: "bg-violet-500/10",
            },
            {
              icon: <Home size={16} />,
              label: "Unit Selections",
              value: unitSelections.length,
              accent: "text-blue-600",
              bg: "bg-blue-500/10",
            },
            {
              icon: <IndianRupee size={16} />,
              label: "Total Deal Value",
              value: totalDealValue > 0 ? fmtMoney(totalDealValue) : "—",
              accent: "text-emerald-600",
              bg: "bg-emerald-500/10",
              small: true,
            },
            {
              icon: <TrendingUp size={16} />,
              label: "Balance Due",
              value: totalBalance > 0 ? fmtMoney(totalBalance) : "—",
              accent:
                totalBalance > 0 ? "text-amber-500" : "text-muted-foreground",
              bg: totalBalance > 0 ? "bg-amber-500/10" : "bg-muted",
              small: true,
            },
          ].map((t) => (
            <div
              key={t.label}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className={`p-2 rounded-lg ${t.bg} w-fit mb-2.5`}>
                <span className={t.accent}>{t.icon}</span>
              </div>
              <p
                className={`font-bold font-heading text-foreground leading-none ${t.small ? "text-[18px]" : "text-2xl"}`}
              >
                {t.value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {t.label}
              </p>
            </div>
          ))}
        </div>

        {/* ── Three-column layout ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr_300px] gap-5">
          {/* ── LEFT: Profile ── */}
          <div className="space-y-4">
            <SectionCard title="Applicant Profile" icon={UserRound}>
              <div>
                {applicant.PrimaryMobile && (
                  <InfoRow
                    label="Mobile"
                    value={applicant.PrimaryMobile}
                    icon={Phone}
                  />
                )}
                {applicant.Email && (
                  <InfoRow label="Email" value={applicant.Email} icon={Mail} />
                )}
                {applicant.City && (
                  <InfoRow label="City" value={applicant.City} icon={MapPin} />
                )}
                {applicant.Source && (
                  <InfoRow
                    label="Source"
                    value={applicant.Source}
                    icon={Hash}
                  />
                )}
                {applicant.PreferredUnitType && (
                  <InfoRow
                    label="Preferred Unit"
                    value={applicant.PreferredUnitType}
                    icon={Home}
                  />
                )}
                {applicant.BudgetAmount && (
                  <InfoRow
                    label="Budget"
                    value={fmtMoney(applicant.BudgetAmount)}
                    icon={IndianRupee}
                  />
                )}
                <InfoRow
                  label="Company"
                  value={fmt(applicant.CompanyName)}
                  icon={Building2}
                />
                <InfoRow
                  label="Project"
                  value={fmt(applicant.ProjectName)}
                  icon={Layers}
                />
                <InfoRow
                  label="Created"
                  value={fmtDateTime(applicant.CreatedAt)}
                  icon={CalendarDays}
                />
                {applicant.UpdatedAt && (
                  <InfoRow
                    label="Last Updated"
                    value={fmtDateTime(applicant.UpdatedAt)}
                    icon={Clock}
                  />
                )}
                {applicant.CreatedBy && (
                  <InfoRow
                    label="Created By"
                    value={applicant.CreatedBy}
                    icon={UserRound}
                  />
                )}
              </div>
              {applicant.Notes && (
                <div className="mt-3 bg-muted/40 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Notes
                  </p>
                  <p className="text-[12px] text-foreground leading-snug">
                    {applicant.Notes}
                  </p>
                </div>
              )}
            </SectionCard>

            <QuickLogPanel applicantId={applicant.Id} applicantName={name} />
          </div>

          {/* ── CENTRE: Unit Selections + Agreements ── */}
          <div className="space-y-4">
            <SectionCard
              title="Unit Selections"
              icon={Home}
              badge={unitSelections.length}
            >
              {unitSelections.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-6">
                  No unit selections yet.
                </p>
              ) : (
                unitSelections.map((u) => <UnitCard key={u.Id} unit={u} />)
              )}
            </SectionCard>

            <SectionCard
              title="Agreements"
              icon={FileText}
              badge={agreements.length}
            >
              {agreements.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-6">
                  No agreements yet.
                </p>
              ) : (
                agreements.map((a) => <AgreementCard key={a.Id} agr={a} />)
              )}
            </SectionCard>
          </div>

          {/* ── RIGHT: Log + Reminders ── */}
          <div className="space-y-4">
            <SectionCard
              title="Follow-Up Log"
              icon={ClipboardList}
              badge={logs.length}
            >
              {logs.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-6">
                  No log entries yet.
                </p>
              ) : (
                <div className="max-h-[340px] overflow-y-auto pr-1">
                  {logs.map((l) => (
                    <LogEntry key={l.id} log={l} />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Reminders" icon={Bell} badge={reminders.length}>
              {reminders.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-6">
                  No reminders.
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-2.5 border border-border rounded-lg p-2.5 hover:border-primary/20 transition-colors"
                    >
                      <Bell
                        size={13}
                        className={
                          r.status === "overdue"
                            ? "text-red-500 mt-0.5"
                            : "text-muted-foreground mt-0.5"
                        }
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
            </SectionCard>

            {/* Milestone tracker */}
            <SectionCard title="Sales Journey" icon={BadgeCheck}>
              {[
                { label: "Lead Created", done: true },
                { label: "Unit Selected", done: unitSelections.length > 0 },
                {
                  label: "Agreement Signed",
                  done: agreements.some((a) => a.Status === "Signed"),
                },
                {
                  label: "Registration",
                  done: agreements.some((a) => !!a.RegistrationDate),
                },
                { label: "Handover", done: false },
              ].map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 py-2 border-b border-border last:border-0"
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${step.done ? "bg-emerald-500" : "bg-muted border border-border"}`}
                  >
                    {step.done && (
                      <CheckCircle2 size={12} className="text-white" />
                    )}
                  </div>
                  <span
                    className={`text-[12px] ${step.done ? "text-foreground font-medium" : "text-muted-foreground"}`}
                  >
                    {step.label}
                  </span>
                  {step.done && (
                    <span className="ml-auto text-[10px] text-emerald-600 font-semibold">
                      Done
                    </span>
                  )}
                </div>
              ))}
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
