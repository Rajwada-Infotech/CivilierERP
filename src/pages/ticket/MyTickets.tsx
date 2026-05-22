import React, { useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TicketChat } from "@/components/tickets/TicketChat";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  User,
  X,
  XCircle,
  MessageCircle,
  CalendarDays,
  Phone,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  issue_details: string;
  customer_name: string;
  customer_phone: string;
  status: "Pending" | "Resolved" | "InProgress" | "Closed";
  created_at?: string;
  updated_at?: string;
  attachment_path?: string | null;
  assigned_to?: string | null;
  resolution_note?: string | null;
  comment_count?: number;
}

interface Comment {
  id: number;
  ticket_id: number;
  comment: string;
  author_name: string;
  author_role: string;
  created_at: string;
  is_internal?: boolean | number;
}

interface TicketDetail {
  ticket: Ticket;
  comments: Comment[];
}

type StatusFilter =
  | "Open"
  | "Pending"
  | "InProgress"
  | "Resolved"
  | "Closed"
  | "All";

// ─── Sentiment options ────────────────────────────────────────────────────────

function IconUnhappy({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
      <circle cx="18" cy="18" r="17" fill={active ? "#fee2e2" : "currentColor"} fillOpacity={active ? 1 : 0.06} stroke={active ? "#ef4444" : "currentColor"} strokeOpacity={active ? 1 : 0.2} strokeWidth="1.5" />
      <circle cx="13" cy="14" r="1.8" fill={active ? "#ef4444" : "currentColor"} fillOpacity={active ? 1 : 0.5} />
      <circle cx="23" cy="14" r="1.8" fill={active ? "#ef4444" : "currentColor"} fillOpacity={active ? 1 : 0.5} />
      <path d="M12 24c1.5-2.5 4-4 6-4s4.5 1.5 6 4" stroke={active ? "#ef4444" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 11.5 L13.5 13" stroke={active ? "#ef4444" : "currentColor"} strokeOpacity={active ? 1 : 0.4} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M26 11.5 L22.5 13" stroke={active ? "#ef4444" : "currentColor"} strokeOpacity={active ? 1 : 0.4} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconHappy({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
      <circle cx="18" cy="18" r="17" fill={active ? "#dcfce7" : "currentColor"} fillOpacity={active ? 1 : 0.06} stroke={active ? "#22c55e" : "currentColor"} strokeOpacity={active ? 1 : 0.2} strokeWidth="1.5" />
      <circle cx="13" cy="15" r="1.8" fill={active ? "#22c55e" : "currentColor"} fillOpacity={active ? 1 : 0.5} />
      <circle cx="23" cy="15" r="1.8" fill={active ? "#22c55e" : "currentColor"} fillOpacity={active ? 1 : 0.5} />
      <path d="M12 21c1.5 2.8 4 4.5 6 4.5s4.5-1.7 6-4.5" stroke={active ? "#22c55e" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconExcellent({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
      <circle cx="18" cy="18" r="17" fill={active ? "#fef9c3" : "currentColor"} fillOpacity={active ? 1 : 0.06} stroke={active ? "#eab308" : "currentColor"} strokeOpacity={active ? 1 : 0.2} strokeWidth="1.5" />
      <path d="M11 14c.5-1 1.5-1.5 2.5-1s1.5 1.5 1 2.5" stroke={active ? "#eab308" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M25 14c-.5-1-1.5-1.5-2.5-1s-1.5 1.5-1 2.5" stroke={active ? "#eab308" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.5 21.5c1.5 4 4.5 6 7.5 6s6-2 7.5-6" stroke={active ? "#eab308" : "currentColor"} strokeOpacity={active ? 1 : 0.5} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13 21.5h10" stroke={active ? "#eab308" : "currentColor"} strokeOpacity={active ? 1 : 0.4} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const SENTIMENTS = [
  { value: 1, Icon: IconUnhappy, label: "Unhappy" },
  { value: 4, Icon: IconHappy,   label: "Happy" },
  { value: 5, Icon: IconExcellent, label: "Excellent" },
];

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<StatusFilter, string> = {
  Open:       "Open",
  Pending:    "Pending",
  InProgress: "Resolving",
  Resolved:   "Resolved",
  Closed:     "Closed",
  All:        "All",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

const fmtTime = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

const fmtDateTime = (d?: string | null) => {
  if (!d) return "";
  return `${fmtDate(d)} ${fmtTime(d)}`;
};

// ─── Attachment blob URL cache (for initial ticket attachments) ───────────────

const attachmentBlobUrlCache = new Map<string, string>();
let attachmentCacheCleanupRegistered = false;

const registerAttachmentCacheCleanup = () => {
  if (attachmentCacheCleanupRegistered || typeof window === "undefined") return;
  attachmentCacheCleanupRegistered = true;
  window.addEventListener("pagehide", () => {
    attachmentBlobUrlCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    attachmentBlobUrlCache.clear();
  });
};

// ─── Priority / Status config ─────────────────────────────────────────────────

const priorityConfig: Record<string, { cls: string; dot: string; bar: string }> = {
  Urgent: { cls: "bg-red-500/10 text-red-600 border-red-400/20",       dot: "bg-red-500",    bar: "bg-red-500" },
  High:   { cls: "bg-orange-500/10 text-orange-600 border-orange-400/20", dot: "bg-orange-500", bar: "bg-orange-500" },
  Medium: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",  dot: "bg-amber-400",  bar: "bg-amber-400" },
  Low:    { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",     dot: "bg-blue-400",   bar: "bg-blue-400" },
};

const statusConfig: Record<string, { cls: string; label: string; icon: React.ElementType }> = {
  Pending:    { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",     label: "Pending",     icon: Clock },
  InProgress: { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",        label: "In Progress", icon: RefreshCw },
  Resolved:   { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20", label: "Resolved",  icon: CheckCircle2 },
  Closed:     { cls: "bg-slate-500/10 text-slate-500 border-slate-400/20",     label: "Closed",      icon: XCircle },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? { cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { cls: "bg-muted text-muted-foreground border-border", label: status, icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

// ─── AuthenticatedAttachmentImage (initial ticket attachments only) ───────────

function AuthenticatedAttachmentImage({
  url, alt, className, onClick,
}: { url: string; alt: string; className: string; onClick: () => void }) {
  const [src, setSrc] = useState(url.startsWith("data:") ? url : "");
  const [failed, setFailed] = useState(false);

  React.useEffect(() => {
    if (url.startsWith("data:")) { setSrc(url); return; }
    let alive = true;
    const cached = attachmentBlobUrlCache.get(url);
    if (cached) { setSrc(cached); return; }
    setSrc(""); setFailed(false);
    fetchWithAuth(url)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); })
      .then((blob) => {
        if (!alive) return;
        const objectUrl = URL.createObjectURL(blob);
        attachmentBlobUrlCache.set(url, objectUrl);
        registerAttachmentCacheCleanup();
        setSrc(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);

  if (failed) return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-[11px] text-muted-foreground">
      <Paperclip size={10} /> Attachment
    </button>
  );
  if (!src) return <div className="h-24 min-w-24 rounded-lg border border-border bg-muted animate-pulse" />;
  return <img src={src} alt={alt} className={className} onClick={onClick} />;
}

// ─── Attachment viewer (for initial ticket attachments) ───────────────────────

function openAttachmentViewer(url: string, filename: string) {
  const isPdf = url.split("?")[0].toLowerCase().endsWith(".pdf");
  const win = window.open();
  if (!win) return;
  const load = async () => {
    let blobUrl = url;
    let pdf = isPdf;
    if (!url.startsWith("data:")) {
      try {
        const cached = attachmentBlobUrlCache.get(url);
        if (cached) { blobUrl = cached; }
        else {
          const r = await fetchWithAuth(url);
          if (!r.ok) throw new Error();
          const blob = await r.blob();
          if (blob.type === "application/pdf") pdf = true;
          blobUrl = URL.createObjectURL(blob);
          attachmentBlobUrlCache.set(url, blobUrl);
          registerAttachmentCacheCleanup();
        }
      } catch {
        win.document.body.innerHTML = '<p style="color:#ccc;font-family:sans-serif;padding:24px">Unable to load attachment.</p>';
        return;
      }
    }
    const content = pdf
      ? `<iframe src="${blobUrl}" style="width:100%;height:90vh;border:none;border-radius:8px"></iframe>`
      : `<img src="${blobUrl}" style="max-width:100%;max-height:90vh;border-radius:8px"/>`;
    win.document.write(`<!DOCTYPE html><html><head><title>${filename}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#111;display:flex;flex-direction:column;align-items:center;min-height:100vh}header{width:100%;background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;position:sticky;top:0}header span{color:#ccc;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%}a.dl{background:#6366f1;color:#fff;text-decoration:none;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600}main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;width:100%}</style></head><body><header><span>${filename}</span><a class="dl" href="${blobUrl}" download="${filename}">⬇ Download</a></header><main>${content}</main></body></html>`);
    win.document.close();
  };
  load();
}

function AttachmentList({ path: attachmentPath }: { path: string }) {
  let urls: string[] = [];
  try {
    const parsed = JSON.parse(attachmentPath);
    urls = Array.isArray(parsed) ? parsed : [attachmentPath];
  } catch { urls = [attachmentPath]; }

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {urls.map((url, i) => {
        const filename = url.split("/").pop()?.split("?")[0] ?? `attachment-${i + 1}`;
        const isPdf = url.split("?")[0].toLowerCase().endsWith(".pdf");
        if (isPdf) return (
          <button key={i} onClick={() => openAttachmentViewer(url, filename)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-primary hover:bg-muted transition-colors">
            <Paperclip size={10} /> {filename.length > 20 ? `PDF ${i + 1}` : filename}
          </button>
        );
        return (
          <AuthenticatedAttachmentImage key={i} url={url} alt={`Attachment ${i + 1}`}
            className="h-20 w-auto rounded-lg border border-border object-cover cursor-pointer hover:opacity-90 transition-all"
            onClick={() => openAttachmentViewer(url, filename)} />
        );
      })}
    </div>
  );
}

// ─── Ticket List Card ─────────────────────────────────────────────────────────

function TicketListCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const bar = priorityConfig[ticket.priority]?.bar ?? "bg-muted";
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:bg-card/80 transition-all group overflow-hidden">
      <div className="flex items-stretch">
        <div className={`w-1 shrink-0 ${bar}`} />
        <div className="flex-1 px-4 py-3.5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground/50">#{ticket.id}</span>
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate">{ticket.subject}</h3>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User size={10} /><span>{ticket.customer_name || "—"}</span>
                </div>
                {ticket.customer_phone && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Phone size={10} /><span>{ticket.customer_phone}</span>
                  </div>
                )}
                {fmtDate(ticket.created_at) && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays size={10} /><span>{fmtDate(ticket.created_at)}</span>
                  </div>
                )}
                {(ticket.comment_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MessageCircle size={10} /><span>{ticket.comment_count}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
              <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-1" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Ticket Detail View ───────────────────────────────────────────────────────

function TicketDetailView({
  ticketId, onBack, isAdmin, currentUser, onTicketUpdated,
}: {
  ticketId: number;
  onBack: () => void;
  isAdmin: boolean;
  currentUser: { id: number; name: string; role: string };
  onTicketUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const [showResolveFlow, setShowResolveFlow] = useState(false);
  const [showReviewSection, setShowReviewSection] = useState(false);
  const [sentiment, setSentiment] = useState<number>(0);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<TicketDetail>({
    queryKey: ["ticket-detail", ticketId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/${ticketId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  useTicketSync(refetch, ticketId);

  const ticket = data?.ticket;
  const comments = data?.comments ?? [];

  const invalidate = () => {
    refetch();
    onTicketUpdated();
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${ticketId}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket resolved!");
      setShowResolveFlow(false);
      setShowReviewSection(true);
      invalidate();
    },
    onError: () => toast.error("Failed to resolve ticket"),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/reopen/${ticketId}`, { method: "PUT" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket reopened");
      setReviewDone(false);
      setShowReviewSection(false);
      invalidate();
    },
    onError: () => toast.error("Failed to reopen ticket"),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/close/${ticketId}`, { method: "PUT" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket closed");
      setReviewDone(false);
      setShowReviewSection(false);
      invalidate();
    },
    onError: () => toast.error("Failed to close ticket"),
  });

  const autoExpand = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const submitReview = async () => {
    if (!sentiment && !reviewRemarks.trim()) { setReviewDone(true); setShowReviewSection(false); return; }
    setReviewSubmitting(true);
    try {
      const sentimentLabel = SENTIMENTS.find((s) => s.value === sentiment);
      const parts: string[] = [];
      if (sentimentLabel) parts.push(`[Review: ${sentimentLabel.label}]`);
      if (reviewRemarks.trim()) parts.push(reviewRemarks.trim());
      if (parts.length > 0) {
        const res = await fetchWithAuth(`/api/tickets/comment/${ticketId}`, {
          method: "POST",
          body: JSON.stringify({ comment: parts.join(" — ") }),
        });
        if (!res.ok) throw new Error();
      }
      toast.success("Review submitted, thank you!");
      setReviewDone(true);
      setShowReviewSection(false);
      invalidate();
    } catch { toast.error("Failed to submit review"); }
    finally { setReviewSubmitting(false); }
  };

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 size={24} className="animate-spin" />
      <p className="text-sm">Loading ticket…</p>
    </div>
  );

  if (isError || !ticket) return (
    <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
      <AlertCircle size={14} /> Failed to load ticket.{" "}
      <button onClick={() => refetch()} className="underline">Retry</button>
    </div>
  );

  const isActive   = ticket.status === "Pending" || ticket.status === "InProgress";
  const isResolved = ticket.status === "Resolved";
  const isClosed   = ticket.status === "Closed";
  const bar = priorityConfig[ticket.priority]?.bar ?? "bg-muted";

  let attachUrls: string[] = [];
  if (ticket.attachment_path) {
    try {
      const p = JSON.parse(ticket.attachment_path);
      attachUrls = Array.isArray(p) ? p : [ticket.attachment_path];
    } catch { attachUrls = [ticket.attachment_path]; }
  }

  const reviewComment = comments.find((c) => c.comment.startsWith("[Review:"));

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Back + header */}
      <div className="flex items-start gap-3 mb-5">
        <button onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground shrink-0 mt-0.5">
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground/50">#{ticket.id}</span>
                <h1 className="text-lg font-bold text-foreground leading-tight">{ticket.subject}</h1>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User size={10} /><span>{ticket.customer_name}</span>
                </div>
                {ticket.customer_phone && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Phone size={10} /><span>{ticket.customer_phone}</span>
                  </div>
                )}
                {ticket.created_at && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays size={10} /><span>{fmtDateTime(ticket.created_at)}</span>
                  </div>
                )}
                {ticket.assigned_to && (
                  <span className="text-[11px] text-muted-foreground">→ {ticket.assigned_to}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
          </div>
        </div>
      </div>

      {/* Issue description */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
        <div className="flex items-stretch">
          <div className={`w-1 shrink-0 ${bar}`} />
          <div className="flex-1 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Issue Description</p>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.issue_details}</p>
            {attachUrls.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1.5">
                  <Paperclip size={10} />
                  {attachUrls.length > 1 ? `${attachUrls.length} Attachments` : "Attachment"}
                </p>
                <AttachmentList path={ticket.attachment_path!} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resolved / Closed banner */}
      {(isResolved || isClosed) && (
        <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-3 ${
          isClosed ? "bg-slate-500/5 border-slate-400/20" : "bg-emerald-500/5 border-emerald-400/20"
        }`}>
          {isClosed
            ? <XCircle size={16} className="text-slate-500 shrink-0" />
            : <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
          <div className="flex-1">
            <p className={`text-xs font-semibold ${isClosed ? "text-slate-500" : "text-emerald-600"}`}>
              {isClosed ? "Ticket Closed" : "Ticket Resolved"}
            </p>
            {ticket.resolution_note && (
              <p className="text-xs text-muted-foreground mt-0.5">{ticket.resolution_note}</p>
            )}
            {reviewComment && (
              <p className="text-xs text-muted-foreground mt-1 italic">{reviewComment.comment}</p>
            )}
          </div>
          {(isAdmin || isResolved) && (
            <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 transition-colors disabled:opacity-50 shrink-0">
              {reopenMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
              Reopen
            </button>
          )}
        </div>
      )}

      {/* ── Chat ── TicketChat owns send, upload, socket, and attachment rendering */}
      <TicketChat
        ticketId={ticketId}
        currentUser={currentUser}
        initialMessages={comments
          .filter((c) => !c.comment.startsWith("[Review:"))
          .map((c) => ({
            id:          c.id,
            ticket_id:   c.ticket_id,
            comment:     c.comment,
            author_name: c.author_name,
            author_role: c.author_role,
            created_at:  c.created_at,
            is_internal: c.is_internal,
          }))}
        ticketStatus={ticket.status}
        onSent={invalidate}
        className="mb-4"
      />

      {/* Admin action buttons */}
      {isAdmin && isActive && !showResolveFlow && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button onClick={() => setShowResolveFlow(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-400/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 transition-colors">
            <CheckCircle2 size={12} /> Mark as Resolved
          </button>
          <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-400/20 bg-slate-500/5 text-slate-500 hover:bg-slate-500/10 transition-colors disabled:opacity-50">
            {closeMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            Close Ticket
          </button>
        </div>
      )}

      {/* Resolve confirmation */}
      {showResolveFlow && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-5 py-4 space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-700">Confirm Resolution</p>
          </div>
          <p className="text-xs text-muted-foreground">
            This will mark the ticket as resolved. The customer will be able to leave a review.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50">
              {resolveMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              {resolveMutation.isPending ? "Resolving…" : "Confirm & Resolve"}
            </button>
            <button onClick={() => setShowResolveFlow(false)}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Review section */}
      {showReviewSection && !reviewDone && (
        <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-300 mb-4">
          <div>
            <p className="text-sm font-semibold text-foreground">How was the resolution?</p>
            <p className="text-xs text-muted-foreground mt-0.5">Completely optional — feel free to skip.</p>
          </div>
          <div className="flex items-center gap-3">
            {SENTIMENTS.map((s) => (
              <button key={s.value} onClick={() => setSentiment(sentiment === s.value ? 0 : s.value)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border text-center transition-all text-muted-foreground ${
                  sentiment === s.value ? "border-primary bg-primary/5 scale-105" : "border-border hover:border-border/60 hover:bg-muted"
                }`}>
                <s.Icon active={sentiment === s.value} />
                <span className="text-[10px] font-medium">{s.label}</span>
              </button>
            ))}
          </div>
          <textarea
            value={reviewRemarks}
            onChange={(e) => { setReviewRemarks(e.target.value); autoExpand(e.target); }}
            placeholder="Add a comment about your experience… (optional)"
            rows={1}
            style={{ minHeight: "36px", maxHeight: "120px", height: "36px" }}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all overflow-hidden"
          />
          <div className="flex items-center gap-2">
            <button onClick={submitReview} disabled={reviewSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
              {reviewSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {reviewSubmitting ? "Submitting…" : "Submit Review"}
            </button>
            <button onClick={() => { setReviewDone(true); setShowReviewSection(false); }}
              className="px-4 py-2 rounded-xl text-sm border border-border text-muted-foreground hover:bg-muted transition-colors">
              Skip
            </button>
          </div>
        </div>
      )}

      {reviewDone && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <p className="text-xs text-emerald-600 font-medium">Thank you for your feedback!</p>
        </div>
      )}
    </div>
  );
}

// ─── MyTickets main page ──────────────────────────────────────────────────────

const STATUS_TABS: StatusFilter[] = ["Open", "Pending", "InProgress", "Resolved", "Closed", "All"];

const MyTickets: React.FC = () => {
  const navigate     = useNavigate();
  const { currentUser } = useAuth();
  const queryClient  = useQueryClient();
  const ADMIN_ROLES  = ["super_admin", "admin", "dba"];
  const isAdmin      = ADMIN_ROLES.includes(currentUser?.role ?? "");
  const currentUserName = currentUser?.name ?? "Me";

  const [search,         setSearch]         = useState("");
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const { data: allTickets = [], isLoading, isError, refetch, isFetching } = useQuery<Ticket[]>({
    queryKey: ["tickets", isAdmin ? "all" : "my"],
    queryFn: async () => {
      const endpoint = isAdmin ? "/api/tickets?limit=100" : "/api/tickets/my";
      const res = await fetchWithAuth(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      return unwrapTicketList<Ticket>(payload).data;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 20_000,
  });

  useTicketSync(refetch);

  const tickets = useMemo(() => {
    let list = [...allTickets];
    if (statusFilter === "Open") {
      list = list.filter((t) => t.status === "Pending" || t.status === "InProgress");
    } else if (statusFilter !== "All") {
      list = list.filter((t) => t.status === statusFilter);
    }
    if (priorityFilter !== "all") list = list.filter((t) => t.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.subject.toLowerCase().includes(q) ||
        t.customer_name?.toLowerCase().includes(q) ||
        t.issue_details?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allTickets, statusFilter, priorityFilter, search]);

  const openTickets  = allTickets.filter((t) => t.status === "Pending" || t.status === "InProgress");
  const urgentCount  = openTickets.filter((t) => t.priority === "Urgent").length;
  const tabCounts: Record<StatusFilter, number> = {
    Open:       openTickets.length,
    Pending:    allTickets.filter((t) => t.status === "Pending").length,
    InProgress: allTickets.filter((t) => t.status === "InProgress").length,
    Resolved:   allTickets.filter((t) => t.status === "Resolved").length,
    Closed:     allTickets.filter((t) => t.status === "Closed").length,
    All:        allTickets.length,
  };
  const isFiltered = statusFilter !== "All" || priorityFilter !== "all" || !!search.trim();

  if (selectedTicketId !== null) {
    return (
      <>
        <Breadcrumbs items={["Tickets", "My Tickets", `#${selectedTicketId}`]} />
        <div className="max-w-3xl mx-auto pb-10">
          <TicketDetailView
            ticketId={selectedTicketId}
            onBack={() => setSelectedTicketId(null)}
            isAdmin={isAdmin}
            currentUser={{ id: Number(currentUser?.id ?? 0), name: currentUserName, role: currentUser?.role ?? "user" }}
            onTicketUpdated={() => {
              refetch();
              queryClient.invalidateQueries({ queryKey: ["tickets"] });
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Tickets", "My Tickets"]} />
      <div className="max-w-3xl mx-auto pb-10 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/ticket")}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground">
              <ArrowLeft size={14} />
            </button>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">My Tickets</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {openTickets.length} open
                {allTickets.length !== openTickets.length && ` · ${allTickets.length} total`}
                {urgentCount > 0 && <span className="text-red-500 ml-1.5 font-medium">· {urgentCount} urgent</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/ticket/create")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              <Plus size={12} /> New
            </button>
            <button onClick={() => refetch()} disabled={isFetching}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
          </div>
        )}

        {/* Status tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button key={tab} onClick={() => setStatusFilter(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === tab
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}>
              {STATUS_LABELS[tab]}
              {!isLoading && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                  statusFilter === tab ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search + Priority */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by subject, customer, or issue…"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium">Priority:</span>
            {(["all", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
              <button key={p} onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  priorityFilter === p ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
                }`}>
                {p === "all" ? "All" : p}
              </button>
            ))}
          </div>
        </div>

        {/* Ticket list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="flex"><div className="w-1 bg-muted" /><div className="flex-1 px-4 py-4 space-y-2"><div className="h-4 bg-muted rounded w-2/3" /><div className="h-3 bg-muted rounded w-1/3" /></div></div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 size={32} className="opacity-20" />
            <p className="text-sm">{isFiltered ? "No tickets match your filters" : "No tickets found"}</p>
            {!isFiltered && (
              <button onClick={() => navigate("/ticket/create")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-1">
                <Plus size={12} /> Create first ticket
              </button>
            )}
            {isFiltered && (
              <button onClick={() => { setSearch(""); setPriorityFilter("all"); setStatusFilter("All"); }}
                className="text-xs text-primary hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {tickets.map((t) => (
              <TicketListCard key={t.id} ticket={t} onClick={() => setSelectedTicketId(t.id)} />
            ))}
          </div>
        )}

        {!isLoading && tickets.length > 0 && isFiltered && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {tickets.length} of {allTickets.length} tickets
          </p>
        )}
      </div>
    </>
  );
};

export default MyTickets;