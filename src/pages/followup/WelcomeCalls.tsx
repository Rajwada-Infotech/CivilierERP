import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  PhoneMissed,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  X,
  Clock,
  Calendar,
  User,
  StickyNote,
  CheckCircle2,
  Voicemail,
  Building2,
  IndianRupee,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

type CallOutcome =
  | "connected"
  | "no_answer"
  | "callback"
  | "voicemail"
  | "completed";

interface WelcomeCall {
  Id: number;
  CallNo: string;
  BookingId: number | null;
  BookingNo: string | null;
  ApplicantId: number;
  ApplicantName: string;
  ApplicantNo: string;
  CallDate: string;
  CallTime: string | null;
  Duration: string | null;
  Outcome: string | null;
  BankSelected: string | null;
  LoanRequired: boolean;
  ExpectedLoanAmount: number | null;
  PreferredBanker: string | null;
  AssignedTo: number | null;
  AssignedToName: string | null;
  Notes: string | null;
  Status: string;
  CreatedBy: string;
  CreatedAt: string;
}

interface FormState {
  BookingId: string;
  ApplicantId: string;
  ApplicantName: string;
  CallDate: string;
  CallTime: string;
  Duration: string;
  Outcome: CallOutcome;
  BankSelected: string;
  LoanRequired: boolean;
  ExpectedLoanAmount: string;
  PreferredBanker: string;
  AssignedTo: string;
  Notes: string;
  Status: string;
}

const EMPTY_FORM: FormState = {
  BookingId: "",
  ApplicantId: "",
  ApplicantName: "",
  CallDate: new Date().toISOString().slice(0, 10),
  CallTime: "",
  Duration: "",
  Outcome: "connected",
  BankSelected: "",
  LoanRequired: false,
  ExpectedLoanAmount: "",
  PreferredBanker: "",
  AssignedTo: "",
  Notes: "",
  Status: "Scheduled",
};

// ─── Outcome config ───────────────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<
  CallOutcome,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    dot: string;
    bg: string;
    iconBg: string;
  }
> = {
  connected: {
    label: "Connected",
    icon: <PhoneCall className="w-4 h-4" />,
    color: "text-emerald-700",
    dot: "bg-emerald-500",
    bg: "bg-emerald-500/10 border-emerald-400/30 text-emerald-600",
    iconBg: "bg-emerald-500/15 text-emerald-600",
  },
  no_answer: {
    label: "No Answer",
    icon: <PhoneMissed className="w-4 h-4" />,
    color: "text-red-600",
    dot: "bg-red-400",
    bg: "bg-red-500/10 border-red-400/30 text-red-500",
    iconBg: "bg-red-500/15 text-red-500",
  },
  callback: {
    label: "Callback",
    icon: <Phone className="w-4 h-4" />,
    color: "text-blue-600",
    dot: "bg-blue-500",
    bg: "bg-blue-500/10 border-blue-400/30 text-blue-600",
    iconBg: "bg-blue-500/15 text-blue-600",
  },
  voicemail: {
    label: "Voicemail",
    icon: <Voicemail className="w-4 h-4" />,
    color: "text-amber-600",
    dot: "bg-amber-400",
    bg: "bg-amber-500/10 border-amber-400/30 text-amber-600",
    iconBg: "bg-amber-500/15 text-amber-600",
  },
  completed: {
    label: "Completed",
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: "text-violet-600",
    dot: "bg-violet-500",
    bg: "bg-violet-500/10 border-violet-400/30 text-violet-600",
    iconBg: "bg-violet-500/15 text-violet-600",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined) {
  const n = (name ?? "").trim();
  if (!n) return "–";
  return n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#db2777",
  "#4f46e5",
];
function avatarColor(name: string | null | undefined) {
  const n = name ?? "?";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function relativeTime(isoStr: string) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function fmtDate(str: string) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtAmount(n: number | null) {
  if (!n) return "";
  return "₹" + n.toLocaleString("en-IN");
}

// ─── API ──────────────────────────────────────────────────────────────────────

const API = "/api/followup-welcome-calls";

async function fetchCalls(): Promise<WelcomeCall[]> {
  const res = await fetchWithAuth(`${API}?pageSize=200`);
  if (!res.ok) throw new Error("Failed to load welcome calls");
  const json = await res.json();
  return json.data ?? json;
}

async function createCall(payload: Record<string, unknown>) {
  const res = await fetchWithAuth(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create entry",
    );
  }
  return res.json();
}

async function deleteCall(id: number) {
  const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete entry");
}

interface Booking {
  Id: number;
  BookingNo: string;
  ApplicantName: string;
}

interface MetaOptions {
  outcomes: string[];
  statuses: string[];
  bookings: Booking[];
  assignees: { Id: number; Name: string }[];
}

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth(`${API}/meta/options`);
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

// ─── Call Card ────────────────────────────────────────────────────────────────

function CallCard({
  entry,
  onDelete,
}: {
  entry: WelcomeCall;
  onDelete: () => void;
}) {
  const outcome = (entry.Outcome as CallOutcome) || "connected";
  const cfg = OUTCOME_CONFIG[outcome] ?? OUTCOME_CONFIG.connected;
  const displayName =
    entry.ApplicantName || entry.BookingNo || `Applicant #${entry.ApplicantId}`;
  const color = avatarColor(displayName);

  return (
    <div className="wc-card group">
      <div className="wc-timeline">
        <div className="wc-tl-dot">
          <span className={`wc-tl-dot-inner ${cfg.dot}`} />
        </div>
        <div className="wc-tl-line" />
      </div>

      <div className="wc-card-body">
        <div className="wc-card-header">
          <div className="wc-avatar" style={{ background: color }}>
            {initials(displayName)}
          </div>
          <div className="wc-card-meta">
            <span className="wc-customer-name">{displayName}</span>
            <div className="wc-card-sub">
              {entry.CallDate && (
                <span className="wc-meta-item">
                  <Calendar className="w-3 h-3" />
                  {fmtDate(entry.CallDate)}
                </span>
              )}
              {entry.AssignedToName && (
                <span className="wc-meta-item">
                  <User className="w-3 h-3" />
                  {entry.AssignedToName}
                </span>
              )}
              {entry.Duration && (
                <span className="wc-meta-item">
                  <Clock className="w-3 h-3" />
                  {entry.Duration}m
                </span>
              )}
              {entry.BookingNo && (
                <span className="wc-meta-item">
                  <StickyNote className="w-3 h-3" />
                  {entry.BookingNo}
                </span>
              )}
            </div>
            {/* Bank / Loan info row */}
            {(entry.BankSelected || entry.LoanRequired) && (
              <div className="wc-card-sub mt-1">
                {entry.BankSelected && (
                  <span className="wc-meta-item">
                    <Building2 className="w-3 h-3" />
                    {entry.BankSelected}
                  </span>
                )}
                {entry.LoanRequired && entry.ExpectedLoanAmount && (
                  <span className="wc-meta-item">
                    <IndianRupee className="w-3 h-3" />
                    Loan: {fmtAmount(entry.ExpectedLoanAmount)}
                  </span>
                )}
                {entry.PreferredBanker && (
                  <span className="wc-meta-item">
                    <User className="w-3 h-3" />
                    {entry.PreferredBanker}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="wc-card-right">
            <span className={`wc-outcome-chip ${cfg.bg}`}>
              <span className={`wc-chip-icon ${cfg.iconBg}`}>{cfg.icon}</span>
              <span className="wc-chip-label">{cfg.label}</span>
            </span>
            <span className="wc-time-ago">
              {entry.CallTime
                ? entry.CallTime.slice(0, 5)
                : fmtDate(entry.CallDate)}
            </span>
            <span className="wc-call-no">{entry.CallNo}</span>
          </div>
        </div>
        {entry.Notes && <p className="wc-notes">{entry.Notes}</p>}
        <button
          className="wc-delete-btn"
          onClick={onDelete}
          title="Delete entry"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function WelcomeCallsPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<CallOutcome | "all">(
    "all",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingSearch, setBookingSearch] = useState("");
  const bookingRef = useRef<HTMLDivElement>(null);

  // Bug 2 — close booking dropdown on outside click
  useEffect(() => {
    if (!bookingOpen) return;
    function handleClick(e: MouseEvent) {
      if (bookingRef.current && !bookingRef.current.contains(e.target as Node)) {
        setBookingOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bookingOpen]);

  const {
    data: calls = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["followup-welcome-calls"],
    queryFn: fetchCalls,
  });

  const { data: meta } = useQuery({
    queryKey: ["followup-welcome-calls-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const filteredBookings = useMemo(() => {
    const q = bookingSearch.toLowerCase();
    if (!q) return meta?.bookings ?? [];
    return (meta?.bookings ?? []).filter(
      (b) =>
        b.BookingNo.toLowerCase().includes(q) ||
        b.ApplicantName.toLowerCase().includes(q),
    );
  }, [meta?.bookings, bookingSearch]);

  const createMutation = useMutation({
    mutationFn: createCall,
    onSuccess: (data: any) => {
      toast.success(`Welcome call logged — ${data.callNo}`);
      if (data?.autoDraftNocNo) {
        toast.info(`Organisation NOC draft created: ${data.autoDraftNocNo}`, {
          description: "Go to Closure → NOC to fill in the details.",
          duration: 6000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["followup-welcome-calls"] });
      setForm(EMPTY_FORM);
      setBookingOpen(false);
      setBookingSearch("");
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCall,
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["followup-welcome-calls"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stats = useMemo(() => {
    const total = calls.length;
    const connected = calls.filter(
      (c) => c.Outcome === "connected" || c.Outcome === "completed",
    ).length;
    const noAnswer = calls.filter((c) => c.Outcome === "no_answer").length;
    const callback = calls.filter((c) => c.Outcome === "callback").length;
    const rate = total > 0 ? Math.round((connected / total) * 100) : 0;
    return { total, connected, noAnswer, callback, rate };
  }, [calls]);

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      const matchOutcome =
        outcomeFilter === "all" || c.Outcome === outcomeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        [c.ApplicantName, c.Notes, c.BankSelected, c.CallNo]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchOutcome && matchSearch;
    });
  }, [calls, outcomeFilter, search]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.ApplicantId) {
      toast.error("Please select a booking first — ApplicantId is required");
      return;
    }
    createMutation.mutate({
      BookingId: form.BookingId ? Number(form.BookingId) : null,
      ApplicantId: Number(form.ApplicantId),
      CallDate: form.CallDate || undefined,
      CallTime: form.CallTime || undefined,
      Duration: form.Duration || undefined,
      Outcome: form.Outcome,
      BankSelected: form.BankSelected || undefined,
      LoanRequired: form.LoanRequired,
      ExpectedLoanAmount: form.ExpectedLoanAmount
        ? Number(form.ExpectedLoanAmount)
        : undefined,
      PreferredBanker: form.PreferredBanker || undefined,
      AssignedTo: form.AssignedTo ? Number(form.AssignedTo) : undefined,
      Notes: form.Notes || undefined,
      Status: form.Status || "Scheduled",
    });
  };

  return (
    <>
      <style>{`
        .wc-page { min-height: 100vh; font-family: 'DM Sans','Segoe UI',sans-serif; color: hsl(var(--foreground)); }
        .wc-filter-bar { background: hsl(var(--card)); border-bottom: 1px solid hsl(var(--border)); padding: 10px 28px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .wc-search-wrap { position: relative; flex: 1; min-width: 200px; }
        .wc-search-wrap svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; width: 14px; height: 14px; }
        .wc-search { width: 100%; padding: 8px 12px 8px 34px; border: 1.5px solid hsl(var(--border)); border-radius: 9px; font-size: 13.5px; background: hsl(var(--muted)); color: hsl(var(--foreground)); outline: none; transition: border-color .15s,background .15s; box-sizing: border-box; font-family: inherit; }
        .wc-search:focus { border-color: hsl(var(--primary)); background: hsl(var(--card)); }
        .wc-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; }
        .wc-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .wc-pill { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 600; border: 1.5px solid hsl(var(--border)); background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all .15s; white-space: nowrap; line-height: 1; }
        .wc-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .wc-pill.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .wc-body { padding: 24px 28px; width: 100%; display: flex; flex-direction: column; }
        .wc-feed { display: flex; flex-direction: column; gap: 0; }
        .wc-card { display: flex; gap: 0; position: relative; }
        .wc-timeline { display: flex; flex-direction: column; align-items: center; width: 32px; flex-shrink: 0; padding-top: 18px; }
        .wc-tl-dot { width: 20px; height: 20px; border-radius: 50%; background: hsl(var(--muted)); border: 2px solid hsl(var(--card)); box-shadow: 0 0 0 2px hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; z-index: 1; }
        .wc-tl-dot-inner { width: 8px; height: 8px; border-radius: 50%; display: block; }
        .wc-tl-line { flex: 1; width: 2px; background: hsl(var(--border)); min-height: 16px; }
        .wc-card:last-child .wc-tl-line { display: none; }
        .wc-card-body { flex: 1; background: hsl(var(--card)); border: 1.5px solid hsl(var(--border)); border-radius: 12px; padding: 14px 16px; margin: 10px 0 10px 12px; position: relative; transition: border-color .15s,box-shadow .15s; }
        .wc-card-body:hover { border-color: hsl(var(--primary)/.4); box-shadow: 0 2px 12px hsl(var(--primary)/.07); }
        .wc-card-header { display: flex; align-items: flex-start; gap: 10px; }
        .wc-avatar { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; letter-spacing: .3px; }
        .wc-card-meta { flex: 1; min-width: 0; }
        .wc-customer-name { font-size: 14.5px; font-weight: 600; color: hsl(var(--foreground)); display: block; margin-bottom: 3px; }
        .wc-card-sub { display: flex; flex-wrap: wrap; gap: 10px; }
        .wc-meta-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: hsl(var(--muted-foreground)); }
        .wc-card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; padding-right: 2px; }
        .wc-outcome-chip { display: inline-flex; align-items: center; gap: 0; font-size: 11.5px; font-weight: 600; border-radius: 8px; border: 1.5px solid; line-height: 1; overflow: hidden; }
        .wc-chip-icon { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0; }
        .wc-chip-label { padding: 0 10px 0 5px; white-space: nowrap; }
        .wc-time-ago { font-size: 11px; color: hsl(var(--muted-foreground)); }
        .wc-call-no { font-size: 10px; color: hsl(var(--muted-foreground)); font-family: monospace; }
        .wc-notes { margin: 10px 0 0 0; font-size: 13px; color: hsl(var(--muted-foreground)); line-height: 1.55; background: hsl(var(--muted)); border-radius: 8px; padding: 8px 12px; border-left: 3px solid hsl(var(--border)); }
        .wc-delete-btn { position: absolute; bottom: 10px; right: 10px; background: none; border: none; cursor: pointer; color: hsl(var(--border)); padding: 4px; border-radius: 6px; display: none; transition: color .15s,background .15s; }
        .wc-card-body:hover .wc-delete-btn { display: flex; }
        .wc-delete-btn:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive)/.1); }
        .wc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; color: hsl(var(--muted-foreground)); gap: 12px; }
        .wc-empty-icon { width: 56px; height: 56px; background: hsl(var(--primary)/.1); border-radius: 14px; display: flex; align-items: center; justify-content: center; }
        .wc-empty h3 { font-size: 15px; font-weight: 600; color: hsl(var(--foreground)); margin: 0; }
        .wc-empty p { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0; text-align: center; }
        .wc-skeleton-card { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
        .wc-skel { background: hsl(var(--muted)); border-radius: 6px; animation: wc-pulse 1.4s ease-in-out infinite; }
        @keyframes wc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .wc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .wc-outcome-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 8px; }
        .wc-outcome-option { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 6px; border: 1.5px solid hsl(var(--border)); border-radius: 10px; cursor: pointer; font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); transition: all .15s; text-align: center; line-height: 1.2; }
        .wc-outcome-option:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); background: hsl(var(--primary)/.08); }
        .wc-outcome-option.selected { border-color: hsl(var(--primary)); background: hsl(var(--primary)/.1); color: hsl(var(--primary)); }
        .wc-outcome-option .icon-wrap { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .wc-booking-select { width: 100%; position: relative; }
        .wc-booking-trigger { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px; font-size: 14px; background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer; text-align: left; font-family: inherit; min-height: 38px; transition: border-color .15s; }
        .wc-booking-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .wc-booking-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .wc-booking-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card)); border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border)); border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px hsl(var(--foreground)/.1); z-index: 100; overflow: hidden; max-height: 220px; display: flex; flex-direction: column; }
        .wc-booking-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--border)); flex-shrink: 0; }
        .wc-booking-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .wc-booking-search { width: 100%; padding: 9px 12px 9px 36px; border: none; font-size: 13px; color: hsl(var(--foreground)); background: hsl(var(--muted)); outline: none; font-family: inherit; box-sizing: border-box; }
        .wc-booking-list { overflow-y: auto; flex: 1; }
        .wc-booking-item { display: flex; flex-direction: column; padding: 9px 12px; cursor: pointer; border: none; background: none; width: 100%; text-align: left; font-family: inherit; transition: background .1s; }
        .wc-booking-item:hover { background: hsl(var(--primary)/.08); }
        .wc-booking-item.selected { background: hsl(var(--primary)/.15); }
        .wc-booking-item-no { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
        .wc-booking-item-name { font-size: 11px; color: hsl(var(--muted-foreground)); }
        .wc-booking-empty { padding: 16px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }
        @media (max-width:640px) {
          .wc-filter-bar { padding: 10px 16px; }
          .wc-body { padding: 16px; }
          .wc-form-grid { grid-template-columns: 1fr; }
          .wc-outcome-grid { grid-template-columns: repeat(3,1fr); }
        }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Welcome Calls", path: "/followup/sales/welcome-calls" },
        ]}
      />

      <div className="relative space-y-8 mt-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Welcome Calls
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Log and track welcome call outcomes, bank selection and loan
              details
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} /> Log Call
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total, dot: "bg-slate-400", borderL: "border-l-slate-400" },
            {
              label: "Connected",
              value: stats.connected,
              dot: "bg-emerald-500",
              borderL: "border-l-emerald-500",
            },
            { label: "No Answer", value: stats.noAnswer, dot: "bg-red-400", borderL: "border-l-red-400" },
            { label: "Callback", value: stats.callback, dot: "bg-blue-500", borderL: "border-l-blue-500" },
            {
              label: "Connect Rate",
              value: `${stats.rate}%`,
              dot: "bg-violet-500",
              borderL: "border-l-violet-500",
            },
          ].map(({ label, value, dot, borderL }) => (
            <div
              key={label}
              className={`relative rounded-xl border border-border bg-card p-4 overflow-hidden border-l-2 ${borderL}`}
            >
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${dot}`} />
              <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
              <p className="text-2xl font-bold font-heading text-foreground leading-none">
                {value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="wc-filter-bar">
          <div className="wc-search-wrap">
            <Search />
            <input
              className="wc-search"
              placeholder="Search by name, bank, call no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="wc-search-clear" onClick={() => setSearch("")}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
          <div className="wc-pills">
            {(
              [
                "all",
                "connected",
                "no_answer",
                "callback",
                "voicemail",
                "completed",
              ] as const
            ).map((o) => (
              <button
                key={o}
                className={`wc-pill ${outcomeFilter === o ? "active" : ""}`}
                onClick={() => setOutcomeFilter(o)}
              >
                {o === "all" ? "All" : (OUTCOME_CONFIG[o]?.label ?? o)}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline feed */}
        <div className="wc-body">
          {isLoading ? (
            <div className="wc-feed">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="wc-skeleton-card">
                  <div
                    className="wc-skel"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      marginTop: 18,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      className="wc-skel"
                      style={{ height: 80, borderRadius: 12, marginBottom: 10 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="wc-empty">
              <div className="wc-empty-icon">
                <PhoneCall
                  style={{ width: 26, height: 26 }}
                  className="text-primary"
                />
              </div>
              <h3>
                {search || outcomeFilter !== "all"
                  ? "No matching calls"
                  : "No welcome calls yet"}
              </h3>
              <p>
                {search || outcomeFilter !== "all"
                  ? "Try changing your search or filter"
                  : "Log the first welcome call to get started"}
              </p>
              {!search && outcomeFilter === "all" && (
                <Button
                  onClick={() => setDialogOpen(true)}
                  className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto mt-1"
                >
                  <Plus style={{ width: 14, height: 14 }} /> Log Call
                </Button>
              )}
            </div>
          ) : (
            <div className="wc-feed">
              {filtered.map((entry) => (
                <CallCard
                  key={entry.Id}
                  entry={entry}
                  onDelete={() => deleteMutation.mutate(entry.Id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log Call Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) { setForm(EMPTY_FORM); setBookingOpen(false); setBookingSearch(""); setDialogOpen(false); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <div
                style={{
                  width: 28,
                  height: 28,
                  background: "#2563eb",
                  borderRadius: 7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Phone
                  style={{
                    width: 14,
                    height: 14,
                    color: "hsl(var(--primary-foreground))",
                  }}
                />
              </div>
              Log Welcome Call
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Outcome */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Call Outcome
              </Label>
              <div className="wc-outcome-grid">
                {(
                  [
                    "connected",
                    "no_answer",
                    "callback",
                    "voicemail",
                    "completed",
                  ] as CallOutcome[]
                ).map((o) => {
                  const cfg = OUTCOME_CONFIG[o];
                  return (
                    <button
                      key={o}
                      className={`wc-outcome-option ${form.Outcome === o ? "selected" : ""}`}
                      onClick={() => set("Outcome", o)}
                    >
                      <div
                        className="icon-wrap"
                        style={{
                          background:
                            form.Outcome === o
                              ? "hsl(var(--primary) / 0.15)"
                              : "hsl(var(--muted))",
                          color:
                            form.Outcome === o
                              ? "hsl(var(--primary))"
                              : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {cfg.icon}
                      </div>
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Booking selector (carries ApplicantId) */}
            <div className="space-y-2">
              <Label>Booking <span className="text-red-500">*</span></Label>
              <div className="wc-booking-select relative" ref={bookingRef}>
                <button
                  type="button"
                  className={`wc-booking-trigger${bookingOpen ? " open" : ""}${!form.BookingId ? " text-muted-foreground" : ""}`}
                  onClick={() => {
                    setBookingOpen((v) => !v);
                    setBookingSearch("");
                  }}
                >
                  <span>
                    {form.BookingId
                      ? `${meta?.bookings.find((b) => String(b.Id) === form.BookingId)?.BookingNo ?? form.BookingId} — ${form.ApplicantName}`
                      : "Select booking…"}
                  </span>
                  {form.BookingId && (
                    <span
                      className="text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        set("BookingId", "");
                        set("ApplicantId", "");
                        set("ApplicantName", "");
                      }}
                    >
                      <X style={{ width: 13, height: 13 }} />
                    </span>
                  )}
                </button>
                {bookingOpen && (
                  <div className="wc-booking-dropdown">
                    <div className="wc-booking-search-wrap">
                      <Search style={{ width: 14, height: 14 }} />
                      <input
                        className="wc-booking-search"
                        placeholder="Search booking or applicant…"
                        value={bookingSearch}
                        onChange={(e) => setBookingSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="wc-booking-list">
                      {filteredBookings.length === 0 ? (
                        <div className="wc-booking-empty">
                          No bookings found
                        </div>
                      ) : (
                        filteredBookings.map((b) => (
                          <button
                            key={b.Id}
                            type="button"
                            className={`wc-booking-item${String(b.Id) === form.BookingId ? " selected" : ""}`}
                            onClick={() => {
                              set("BookingId", String(b.Id));
                              // We need ApplicantId — stored on booking; fetch it
                              fetchWithAuth(`/api/followup-bookings/${b.Id}`)
                                .then((r) => r.json())
                                .then((data) => {
                                  if (data?.ApplicantId) {
                                    setForm((f) => ({
                                      ...f,
                                      BookingId: String(b.Id),
                                      ApplicantId: String(data.ApplicantId),
                                      ApplicantName:
                                        data.ApplicantName ?? b.ApplicantName,
                                    }));
                                  }
                                })
                                .catch(() => {
                                  setForm((f) => ({
                                    ...f,
                                    BookingId: String(b.Id),
                                    ApplicantName: b.ApplicantName,
                                  }));
                                });
                              setBookingOpen(false);
                            }}
                          >
                            <span className="wc-booking-item-no">
                              {b.BookingNo}
                            </span>
                            <span className="wc-booking-item-name">
                              {b.ApplicantName}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Date + Time + Duration */}
            <div className="wc-form-grid">
              <div className="space-y-2">
                <Label>Call Date</Label>
                <div className="relative">
                  <Calendar
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.CallDate}
                    onChange={(e) => set("CallDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Call Time</Label>
                <Input
                  type="time"
                  value={form.CallTime}
                  onChange={(e) => set("CallTime", e.target.value)}
                  className="rounded-[9px]"
                />
              </div>
            </div>

            <div className="wc-form-grid">
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.Duration}
                  onChange={(e) => set("Duration", e.target.value)}
                  placeholder="e.g. 10"
                  className="rounded-[9px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <select
                  value={form.Status}
                  onChange={(e) => set("Status", e.target.value)}
                  className="w-full h-10 px-3 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {(
                    meta?.statuses ?? ["Scheduled", "Completed", "Cancelled"]
                  ).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Bank / Loan section */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Building2 size={12} /> Bank & Loan Details
              </p>

              <div className="space-y-2">
                <Label>Bank Selected</Label>
                <Input
                  value={form.BankSelected}
                  onChange={(e) => set("BankSelected", e.target.value)}
                  placeholder="e.g. HDFC Bank, SBI…"
                  className="rounded-[9px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Selecting a bank will auto-create an Organisation NOC draft in
                  Closure → NOC.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="loan-req"
                  checked={form.LoanRequired}
                  onChange={(e) => set("LoanRequired", e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="loan-req" className="text-sm cursor-pointer">
                  Loan Required
                </label>
              </div>

              {form.LoanRequired && (
                <div className="wc-form-grid">
                  <div className="space-y-2">
                    <Label>Expected Loan Amount (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.ExpectedLoanAmount}
                      onChange={(e) =>
                        set("ExpectedLoanAmount", e.target.value)
                      }
                      placeholder="e.g. 5000000"
                      className="rounded-[9px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Preferred Banker</Label>
                    <Input
                      value={form.PreferredBanker}
                      onChange={(e) => set("PreferredBanker", e.target.value)}
                      placeholder="Contact name"
                      className="rounded-[9px]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Assigned To */}
            {meta?.assignees && meta.assignees.length > 0 && (
              <div className="space-y-2">
                <Label>Assigned To</Label>
                <select
                  value={form.AssignedTo}
                  onChange={(e) => set("AssignedTo", e.target.value)}
                  className="w-full h-10 px-3 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">— Not assigned —</option>
                  {meta.assignees.map((u) => (
                    <option key={u.Id} value={u.Id}>
                      {u.Name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.Notes}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="What was discussed? Any follow-up needed?"
                rows={3}
                className="rounded-[9px] resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="rounded-[9px]"
            >
              Cancel
            </Button>
            <Button
              disabled={!form.ApplicantId || createMutation.isPending}
              onClick={handleSubmit}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMutation.isPending ? (
                "Saving…"
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Save Call
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default WelcomeCallsPage;