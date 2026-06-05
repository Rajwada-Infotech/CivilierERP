import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  | "note";

interface CallEntry {
  id: string;
  date: string;
  type: CallOutcome;
  customer: string;
  amount: number | null;
  notes: string;
  user: string;
  createdAt: string;
}

interface FormState {
  date: string;
  outcome: CallOutcome;
  customer: string;
  duration: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  outcome: "connected",
  customer: "",
  duration: "",
  notes: "",
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
  note: {
    label: "Note",
    icon: <StickyNote className="w-4 h-4" />,
    color: "text-slate-500",
    dot: "bg-slate-400",
    bg: "bg-muted border-border text-muted-foreground",
    iconBg: "bg-muted text-muted-foreground",
  },
};

// Maps the UI outcome (rich) → backend LogType (email|call|sms|note|payment)
const OUTCOME_TO_LOG_TYPE: Record<CallOutcome, string> = {
  connected: "call",
  no_answer: "call",
  callback: "call",
  voicemail: "call",
  note: "note",
};

// Outcome tag embedded at the start of notes so we can recover it on read-back
// Format: "[outcome_key] user notes here"
const OUTCOME_TAG_RE = /^\[([a-z_]+)\] ?/;

function buildNotes(outcome: CallOutcome, userNotes: string): string {
  const body = userNotes.trim();
  return body ? `[${outcome}] ${body}` : `[${outcome}]`;
}

function parseNotes(rawNotes: string): { outcome: CallOutcome; notes: string } {
  const match = rawNotes?.match(OUTCOME_TAG_RE);
  if (match && match[1] in OUTCOME_CONFIG) {
    return {
      outcome: match[1] as CallOutcome,
      notes: rawNotes.replace(OUTCOME_TAG_RE, "").trim(),
    };
  }
  // Legacy entries that used human label prefix ("Connected — ...")
  for (const [key, cfg] of Object.entries(OUTCOME_CONFIG) as [
    CallOutcome,
    (typeof OUTCOME_CONFIG)[CallOutcome],
  ][]) {
    const legacyPrefix = cfg.label + " — ";
    if (rawNotes?.startsWith(legacyPrefix)) {
      return {
        outcome: key,
        notes: rawNotes.slice(legacyPrefix.length).trim(),
      };
    }
  }
  // Fallback: derive from DB type
  return { outcome: "note", notes: rawNotes ?? "" };
}

// Normalise a stored DB type back to a display CallOutcome (used as last-resort fallback)
function toDisplayOutcome(type: string): CallOutcome {
  if (type in OUTCOME_CONFIG) return type as CallOutcome;
  return "connected"; // "call" stored type default
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
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

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
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

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchCalls(): Promise<CallEntry[]> {
  const res = await fetchWithAuth("/api/followup-log?module=welcome_call");
  if (!res.ok) throw new Error("Failed to load welcome calls");
  return res.json();
}

async function createCall(payload: {
  date?: string;
  type: string;
  module: string;
  customer: string;
  amount?: number;
  notes?: string;
}) {
  const res = await fetchWithAuth("/api/followup-log", {
    method: "POST",
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

async function deleteCall(id: string) {
  const res = await fetchWithAuth(`/api/followup-log/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete entry");
}

interface Applicant {
  LHeadId: number;
  LHeadCode: string;
  LHeadName: string;
  LHeadPhone?: string;
}

async function fetchApplicants(): Promise<Applicant[]> {
  const res = await fetchWithAuth("/api/applicants");
  if (!res.ok) throw new Error("Failed to load applicants");
  const json = await res.json();
  return json.data ?? json;
}

// ─── Call Entry Card ──────────────────────────────────────────────────────────

function CallCard({
  entry,
  onDelete,
}: {
  entry: CallEntry;
  onDelete: () => void;
}) {
  const { outcome: displayOutcome, notes: cleanNotes } = parseNotes(
    entry.notes,
  );
  const cfg = OUTCOME_CONFIG[displayOutcome];
  const color = avatarColor(entry.customer);

  return (
    <div className="wc-card group">
      {/* Timeline dot + line */}
      <div className="wc-timeline">
        <div
          className="wc-tl-dot"
          style={{ background: cfg.dot.replace("bg-", "") }}
        >
          <span className={`wc-tl-dot-inner ${cfg.dot}`} />
        </div>
        <div className="wc-tl-line" />
      </div>

      {/* Card body */}
      <div className="wc-card-body">
        {/* Row 1: avatar + name + outcome + time */}
        <div className="wc-card-header">
          <div className="wc-avatar" style={{ background: color }}>
            {initials(entry.customer)}
          </div>
          <div className="wc-card-meta">
            <span className="wc-customer-name">{entry.customer}</span>
            <div className="wc-card-sub">
              {entry.date && (
                <span className="wc-meta-item">
                  <Calendar className="w-3 h-3" />
                  {fmtDate(entry.date)}
                </span>
              )}
              {entry.user && (
                <span className="wc-meta-item">
                  <User className="w-3 h-3" />
                  {entry.user}
                </span>
              )}
              {entry.amount && (
                <span className="wc-meta-item">
                  <Clock className="w-3 h-3" />
                  {entry.amount}m
                </span>
              )}
            </div>
          </div>
          <div className="wc-card-right">
            <span className={`wc-outcome-chip ${cfg.bg}`}>
              <span className={`wc-chip-icon ${cfg.iconBg}`}>{cfg.icon}</span>
              {cfg.label}
            </span>
            <span className="wc-time-ago">{relativeTime(entry.createdAt)}</span>
          </div>
        </div>

        {/* Notes */}
        {cleanNotes && <p className="wc-notes">{cleanNotes}</p>}

        {/* Delete (hover reveal) */}
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<CallOutcome | "all">(
    "all",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [applOpen, setApplOpen] = useState(false);
  const [applSearch, setApplSearch] = useState("");

  const { data: entries = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["welcome-calls"],
    queryFn: fetchCalls,
  });

  const { data: applicants = [] } = useQuery({
    queryKey: ["applicants"],
    queryFn: fetchApplicants,
    staleTime: 5 * 60 * 1000,
  });

  const filteredApplicants = useMemo(() => {
    const q = applSearch.toLowerCase();
    if (!q) return applicants;
    return applicants.filter(
      (a) =>
        a.LHeadName.toLowerCase().includes(q) ||
        a.LHeadCode.toLowerCase().includes(q) ||
        (a.LHeadPhone ?? "").toLowerCase().includes(q),
    );
  }, [applicants, applSearch]);

  const createMutation = useMutation({
    mutationFn: createCall,
    onSuccess: (data: any) => {
      toast.success("Call logged");
      if (data?.autoDraftNocNo) {
        toast.info(`Organisation NOC draft created: ${data.autoDraftNocNo}`, {
          description: "Go to Closure → NOC to fill in the details.",
          duration: 6000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["welcome-calls"] });
      setForm(EMPTY_FORM);
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCall,
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["welcome-calls"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stats = useMemo(() => {
    const total = entries.length;
    const connected = entries.filter(
      (e) => parseNotes(e.notes).outcome === "connected",
    ).length;
    const noAnswer = entries.filter(
      (e) => parseNotes(e.notes).outcome === "no_answer",
    ).length;
    const callback = entries.filter(
      (e) => parseNotes(e.notes).outcome === "callback",
    ).length;
    const rate = total > 0 ? Math.round((connected / total) * 100) : 0;
    return { total, connected, noAnswer, callback, rate };
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchOutcome =
        outcomeFilter === "all" ||
        parseNotes(e.notes).outcome === outcomeFilter;
      const q = search.toLowerCase();
      const matchSearch =
        !q || [e.customer, e.notes, e.user].join(" ").toLowerCase().includes(q);
      return matchOutcome && matchSearch;
    });
  }, [entries, outcomeFilter, search]);

  const set = (k: keyof FormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <style>{`
        /* ── Root ── */
        .wc-page {
          min-height: 100vh;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .wc-header {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          padding: 20px 28px 0;
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .wc-header-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 16px;
        }
        .wc-breadcrumb {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
          margin-bottom: 6px;
        }
        .wc-breadcrumb button {
          background: none;
          border: none;
          cursor: pointer;
          color: hsl(var(--muted-foreground));
          font-size: 12px;
          padding: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: color 0.15s;
        }
        .wc-breadcrumb button:hover { color: hsl(var(--foreground)); }
        .wc-breadcrumb-sep { font-size: 10px; }
        .wc-breadcrumb-cur { color: hsl(var(--foreground)); font-weight: 500; }

        .wc-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .wc-title-icon {
          width: 36px; height: 36px;
          background: hsl(var(--primary));
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          color: hsl(var(--primary-foreground));
          flex-shrink: 0;
        }
        .wc-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.4px;
          color: hsl(var(--foreground));
        }
        .wc-count {
          font-size: 13px;
          font-weight: 500;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--muted));
          border-radius: 20px;
          padding: 2px 10px;
        }
        .wc-log-btn {
          display: flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, #7c3aed, #2563eb);
          color: #fff;
          border: none;
          border-radius: 9px;
          padding: 9px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .wc-log-btn:hover { opacity: 0.9; }

        /* ── Stats strip ── */
        .wc-stats {
          display: flex;
          gap: 0;
          border-top: 1px solid hsl(var(--border));
          margin-top: 4px;
        }
        .wc-stat {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 8px;
          border-right: 1px solid hsl(var(--border));
          gap: 2px;
          min-width: 0;
        }
        .wc-stat:last-child { border-right: none; }
        .wc-stat-value {
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
          color: hsl(var(--foreground));
        }
        .wc-stat-label {
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }
        .wc-stat-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          margin-bottom: 2px;
        }

        /* ── Filter bar ── */
        .wc-filter-bar {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          padding: 10px 28px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .wc-search-wrap {
          position: relative;
          flex: 1;
          min-width: 200px;
        }
        .wc-search-wrap svg {
          position: absolute;
          left: 11px; top: 50%;
          transform: translateY(-50%);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          width: 14px; height: 14px;
        }
        .wc-search {
          width: 100%;
          padding: 8px 12px 8px 34px;
          border: 1.5px solid hsl(var(--border));
          border-radius: 9px;
          font-size: 13.5px;
          background: hsl(var(--muted));
          color: hsl(var(--foreground));
          outline: none;
          transition: border-color 0.15s, background 0.15s;
          box-sizing: border-box;
          font-family: inherit;
        }
        .wc-search:focus { border-color: hsl(var(--primary)); background: hsl(var(--card)); }
        .wc-search-clear {
          position: absolute;
          right: 10px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none;
          cursor: pointer;
          color: hsl(var(--muted-foreground));
          padding: 2px;
          display: flex;
        }
        .wc-search-clear:hover { color: hsl(var(--foreground)); }

        .wc-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .wc-pill {
          display: flex; align-items: center; justify-content: center; gap: 5px;
          padding: 7px 14px;
          border-radius: 9px;
          font-size: 12px;
          font-weight: 600;
          border: 1.5px solid hsl(var(--border));
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
          line-height: 1;
        }
        .wc-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .wc-pill.active {
          background: hsl(var(--primary));
          border-color: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
        }
        .wc-pill-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          display: inline-block;
        }

        /* ── Body ── */
        .wc-body {
          padding: 24px 28px;
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        /* ── Timeline feed ── */
        .wc-feed { display: flex; flex-direction: column; gap: 0; }

        .wc-card {
          display: flex;
          gap: 0;
          position: relative;
        }

        /* Timeline column */
        .wc-timeline {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 32px;
          flex-shrink: 0;
          padding-top: 18px;
        }
        .wc-tl-dot {
          width: 20px; height: 20px;
          border-radius: 50%;
          background: hsl(var(--muted));
          border: 2px solid hsl(var(--card));
          box-shadow: 0 0 0 2px hsl(var(--border));
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          z-index: 1;
        }
        .wc-tl-dot-inner {
          width: 8px; height: 8px;
          border-radius: 50%;
          display: block;
        }
        .wc-tl-line {
          flex: 1;
          width: 2px;
          background: hsl(var(--border));
          min-height: 16px;
        }
        .wc-card:last-child .wc-tl-line { display: none; }

        /* Card body */
        .wc-card-body {
          flex: 1;
          background: hsl(var(--card));
          border: 1.5px solid hsl(var(--border));
          border-radius: 12px;
          padding: 14px 16px;
          margin: 10px 0 10px 12px;
          position: relative;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .wc-card-body:hover {
          border-color: hsl(var(--primary) / 0.4);
          box-shadow: 0 2px 12px hsl(var(--primary) / 0.07);
        }

        .wc-card-header {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .wc-avatar {
          width: 36px; height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          letter-spacing: 0.3px;
        }
        .wc-card-meta { flex: 1; min-width: 0; }
        .wc-customer-name {
          font-size: 14.5px;
          font-weight: 600;
          color: hsl(var(--foreground));
          display: block;
          margin-bottom: 3px;
        }
        .wc-card-sub {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .wc-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }
        .wc-card-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          flex-shrink: 0;
          padding-right: 2px;
        }

        /* Outcome chip */
        .wc-outcome-chip {
          display: inline-flex;
          align-items: center;
          gap: 0;
          font-size: 11.5px;
          font-weight: 600;
          border-radius: 8px;
          border: 1.5px solid;
          line-height: 1;
        }
        .wc-chip-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px; height: 26px;
          flex-shrink: 0;
        }
        .wc-outcome-chip span.wc-chip-icon + * { padding: 0 12px 0 6px; }

        .wc-time-ago {
          font-size: 11px;
          color: hsl(var(--muted-foreground));
        }

        /* Notes */
        .wc-notes {
          margin: 10px 0 0 0;
          font-size: 13px;
          color: hsl(var(--muted-foreground));
          line-height: 1.55;
          background: hsl(var(--muted));
          border-radius: 8px;
          padding: 8px 12px;
          border-left: 3px solid hsl(var(--border));
        }

        /* Delete btn */
        .wc-delete-btn {
          position: absolute;
          bottom: 10px; right: 10px;
          background: none;
          border: none;
          cursor: pointer;
          color: hsl(var(--border));
          padding: 4px;
          border-radius: 6px;
          display: none;
          transition: color 0.15s, background 0.15s;
        }
        .wc-card-body:hover .wc-delete-btn { display: flex; }
        .wc-delete-btn:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.1); }

        /* ── Empty state ── */
        .wc-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 24px;
          color: hsl(var(--muted-foreground));
          gap: 12px;
        }
        .wc-empty-icon {
          width: 56px; height: 56px;
          background: hsl(var(--primary) / 0.1);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .wc-empty h3 {
          font-size: 15px;
          font-weight: 600;
          color: hsl(var(--foreground));
          margin: 0;
        }
        .wc-empty p {
          font-size: 13px;
          color: hsl(var(--muted-foreground));
          margin: 0;
          text-align: center;
        }

        /* ── Skeleton ── */
        .wc-skeleton-card {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 10px;
        }
        .wc-skel {
          background: hsl(var(--muted));
          border-radius: 6px;
          animation: wc-pulse 1.4s ease-in-out infinite;
        }
        @keyframes wc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

        /* ── Dialog form ── */
        .wc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .wc-outcome-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        .wc-outcome-option {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 10px 6px;
          border: 1.5px solid hsl(var(--border));
          border-radius: 10px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--muted));
          transition: all 0.15s;
          text-align: center;
          line-height: 1.2;
        }
        .wc-outcome-option:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); background: hsl(var(--primary) / 0.08); }
        .wc-outcome-option.selected {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
        }
        .wc-outcome-option .icon-wrap {
          width: 28px; height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        @media (max-width: 640px) {
          .wc-header { padding: 16px 16px 0; }
          .wc-filter-bar { padding: 10px 16px; }
          .wc-body { padding: 16px; }
          .wc-form-grid { grid-template-columns: 1fr; }
          .wc-outcome-grid { grid-template-columns: repeat(3, 1fr); }
          .wc-stats { flex-wrap: wrap; }
          .wc-stat { min-width: calc(50% - 1px); }
        }

        /* ── Applicant combobox ── */
        .wc-combobox { position: relative; width: 100%; }
        .wc-combobox-trigger {
          width: 100%; display: flex; align-items: center;
          justify-content: space-between; gap: 8px;
          padding: 8px 12px; border: 1.5px solid hsl(var(--border));
          border-radius: 9px; font-size: 14px; background: hsl(var(--card));
          color: hsl(var(--foreground)); cursor: pointer; text-align: left;
          transition: border-color 0.15s; font-family: inherit; min-height: 38px;
        }
        .wc-combobox-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .wc-combobox-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .wc-combobox-trigger.empty { color: hsl(var(--muted-foreground)); }
        .wc-combobox-trigger-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
        .wc-combobox-avatar {
          width: 24px; height: 24px; border-radius: 6px; font-size: 10px;
          font-weight: 700; color: #fff; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0; letter-spacing: 0.3px;
        }
        .wc-combobox-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wc-combobox-code { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .wc-combobox-chevron { color: hsl(var(--muted-foreground)); flex-shrink: 0; transition: transform 0.15s; }
        .wc-combobox-chevron.open { transform: rotate(180deg); }
        .wc-combobox-clear {
          background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground));
          padding: 2px; display: flex; flex-shrink: 0; border-radius: 4px;
        }
        .wc-combobox-clear:hover { color: hsl(var(--foreground)); background: hsl(var(--muted)); }
        .wc-combobox-dropdown {
          position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card));
          border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border));
          border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px hsl(var(--foreground) / 0.1);
          z-index: 100; overflow: hidden; max-height: 280px; display: flex; flex-direction: column;
        }
        .wc-combobox-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--border)); flex-shrink: 0; }
        .wc-combobox-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .wc-combobox-search {
          width: 100%; padding: 9px 12px 9px 36px; border: none; font-size: 13px;
          color: hsl(var(--foreground)); background: hsl(var(--muted)); outline: none; font-family: inherit; box-sizing: border-box;
        }
        .wc-combobox-list { overflow-y: auto; flex: 1; }
        .wc-combobox-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px;
          cursor: pointer; transition: background 0.1s; border: none; background: none;
          width: 100%; text-align: left; font-family: inherit;
        }
        .wc-combobox-item:hover { background: hsl(var(--primary) / 0.08); }
        .wc-combobox-item.selected { background: hsl(var(--primary) / 0.15); }
        .wc-combobox-item-name { font-size: 13.5px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wc-combobox-item-code { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .wc-combobox-item-phone { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .wc-combobox-empty { padding: 20px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Welcome Calls", path: "/followup/sales/welcome-calls" },
        ]}
      />
      <div className="relative space-y-8 mt-6">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Welcome Calls
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Log and track welcome call outcomes for applicants
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
              <Plus size={14} />
              Log Call
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total, dot: "bg-slate-400" },
            { label: "Connected", value: stats.connected, dot: "bg-emerald-500" },
            { label: "No Answer", value: stats.noAnswer, dot: "bg-red-400" },
            { label: "Callback", value: stats.callback, dot: "bg-blue-500" },
            { label: "Connect Rate", value: `${stats.rate}%`, dot: "bg-violet-500" },
          ].map(({ label, value, dot }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
              <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Filter bar ── */}
        <div className="wc-filter-bar">
          <div className="wc-search-wrap">
            <Search />
            <input
              className="wc-search"
              placeholder="Search by name or notes…"
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
                "note",
              ] as const
            ).map((o) => {
              const isAll = o === "all";
              const cfg = isAll ? null : OUTCOME_CONFIG[o];
              return (
                <button
                  key={o}
                  className={`wc-pill ${outcomeFilter === o ? "active" : ""}`}
                  onClick={() => setOutcomeFilter(o)}
                >
                  {isAll ? "All" : cfg!.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Body / Timeline feed ── */}
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
                  key={entry.id}
                  entry={entry}
                  onDelete={() => deleteMutation.mutate(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Log Call Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) setDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
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
            {/* Outcome selector */}
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
                    "note",
                  ] as CallOutcome[]
                ).map((o) => {
                  const cfg = OUTCOME_CONFIG[o];
                  return (
                    <button
                      key={o}
                      className={`wc-outcome-option ${form.outcome === o ? "selected" : ""}`}
                      onClick={() => set("outcome", o)}
                    >
                      <div
                        className="icon-wrap"
                        style={{
                          background:
                            form.outcome === o
                              ? "hsl(var(--primary) / 0.15)"
                              : "hsl(var(--muted))",
                          color:
                            form.outcome === o
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

            {/* Customer */}
            <div className="space-y-2">
              <Label>
                Customer / Applicant <span className="text-red-500">*</span>
              </Label>
              <div className="wc-combobox">
                <button
                  type="button"
                  className={`wc-combobox-trigger${applOpen ? " open" : ""}${!form.customer ? " empty" : ""}`}
                  onClick={() => {
                    setApplOpen((v) => !v);
                    setApplSearch("");
                  }}
                >
                  <span className="wc-combobox-trigger-left">
                    {form.customer ? (
                      <>
                        <span
                          className="wc-combobox-avatar"
                          style={{ background: avatarColor(form.customer) }}
                        >
                          {initials(form.customer)}
                        </span>
                        <span className="wc-combobox-name">
                          {form.customer}
                        </span>
                      </>
                    ) : (
                      <span>Select applicant…</span>
                    )}
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    {form.customer && (
                      <span
                        className="wc-combobox-clear"
                        onClick={(e) => {
                          e.stopPropagation();
                          set("customer", "");
                          setApplOpen(false);
                        }}
                      >
                        <X style={{ width: 13, height: 13 }} />
                      </span>
                    )}
                    <svg
                      className={`wc-combobox-chevron${applOpen ? " open" : ""}`}
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {applOpen && (
                  <div className="wc-combobox-dropdown">
                    <div className="wc-combobox-search-wrap">
                      <Search style={{ width: 14, height: 14 }} />
                      <input
                        className="wc-combobox-search"
                        placeholder="Search by name, code or phone…"
                        value={applSearch}
                        onChange={(e) => setApplSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="wc-combobox-list">
                      {filteredApplicants.length === 0 ? (
                        <div className="wc-combobox-empty">
                          No applicants found
                        </div>
                      ) : (
                        filteredApplicants.map((a) => (
                          <button
                            key={a.LHeadId}
                            type="button"
                            className={`wc-combobox-item${form.customer === a.LHeadName ? " selected" : ""}`}
                            onClick={() => {
                              set("customer", a.LHeadName);
                              setApplOpen(false);
                              setApplSearch("");
                            }}
                          >
                            <span
                              className="wc-combobox-avatar"
                              style={{ background: avatarColor(a.LHeadName) }}
                            >
                              {initials(a.LHeadName)}
                            </span>
                            <span className="wc-combobox-item-name">
                              {a.LHeadName}
                            </span>
                            {a.LHeadCode && (
                              <span className="wc-combobox-item-code">
                                {a.LHeadCode}
                              </span>
                            )}
                            {a.LHeadPhone && (
                              <span className="wc-combobox-item-phone">
                                {a.LHeadPhone}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Date + Duration */}
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
                    value={form.date}
                    onChange={(e) => set("date", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.duration}
                  onChange={(e) => set("duration", e.target.value)}
                  placeholder="e.g. 5"
                  className="rounded-[9px]"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
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
              disabled={!form.customer.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  date: form.date || undefined,
                  type: OUTCOME_TO_LOG_TYPE[form.outcome],
                  module: "welcome_call",
                  customer: form.customer.trim(),
                  amount: form.duration ? Number(form.duration) : undefined,
                  notes: buildNotes(form.outcome, form.notes),
                })
              }
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