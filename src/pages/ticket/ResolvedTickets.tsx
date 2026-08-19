import React, { useMemo, useState, useRef, useEffect } from "react";
import Webcam from "react-webcam";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TicketShell } from "@/components/ticket/TicketShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { escapeHtml } from "@/utils/escapeHtml";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { useTicketSync } from "@/hooks/useTicketSync";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MessageCircle,
  Paperclip,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  User,
  X,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketAttachment {
  id: number;
  ticket_id: number;
  comment_id: number | null;
  filename: string;
  mime_type: string;
  file_size: number;
  url: string;
}

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
}

interface TicketDetail {
  ticket: Ticket;
  comments: Comment[];
  attachments: TicketAttachment[];
}

// ─── Sentiment icons ──────────────────────────────────────────────────────────

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
  { value: 4, Icon: IconHappy, label: "Happy" },
  { value: 5, Icon: IconExcellent, label: "Excellent" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

const fmtTime = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

const fmtDateTime = (d?: string | null) => {
  if (!d) return "";
  return `${fmtDate(d)} ${fmtTime(d)}`;
};

// ─── Attachment blob URL cache ────────────────────────────────────────────────

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
  Urgent: { cls: "bg-red-500/10 text-red-600 border-red-400/20", dot: "bg-red-500", bar: "bg-red-500" },
  High: { cls: "bg-orange-500/10 text-orange-600 border-orange-400/20", dot: "bg-orange-500", bar: "bg-orange-500" },
  Medium: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20", dot: "bg-amber-400", bar: "bg-amber-400" },
  Low: { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20", dot: "bg-blue-400", bar: "bg-blue-400" },
};

const statusConfig: Record<string, { cls: string; label: string; icon: React.ElementType }> = {
  Pending: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20", label: "Pending", icon: Clock },
  InProgress: { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20", label: "In Progress", icon: RefreshCw },
  Resolved: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20", label: "Resolved", icon: CheckCircle2 },
  Closed: { cls: "bg-slate-500/10 text-slate-500 border-slate-400/20", label: "Closed", icon: XCircle },
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

// ─── Authenticated image component ───────────────────────────────────────────

function AuthenticatedAttachmentImage({ url, alt, className, onClick }: { url: string; alt: string; className: string; onClick: () => void }) {
  const [src, setSrc] = useState(url.startsWith("data:") ? url : "");
  const [failed, setFailed] = useState(false);
  const [isNonImage, setIsNonImage] = useState(false);

  useEffect(() => {
    if (url.startsWith("data:")) { setSrc(url); setFailed(false); setIsNonImage(false); return; }
    let alive = true;
    const cachedSrc = attachmentBlobUrlCache.get(url);
    if (cachedSrc) { setSrc(cachedSrc); setFailed(false); setIsNonImage(false); return () => { alive = false; }; }
    setSrc(""); setFailed(false); setIsNonImage(false);
    fetchWithAuth(url)
      .then((res) => {
        if (res.status === 410) { if (alive) setIsNonImage(true); return null; }
        if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!blob || !alive) return;
        if (blob.type && !blob.type.startsWith("image/")) { setIsNonImage(true); return; }
        const objectUrl = URL.createObjectURL(blob);
        attachmentBlobUrlCache.set(url, objectUrl);
        registerAttachmentCacheCleanup();
        setSrc(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);

  const filename = url.split("/").pop()?.split("?")[0] ?? "file";
  if (isNonImage) return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-primary hover:bg-muted transition-colors"><Paperclip size={10} /> {filename.length > 20 ? "File" : filename}</button>;
  if (failed) return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-[11px] text-muted-foreground hover:bg-muted/80 transition-colors"><Paperclip size={10} /> {filename.length > 20 ? "Attachment" : filename}</button>;
  if (!src) return <div className="h-24 min-w-24 rounded-lg border border-border bg-muted animate-pulse" />;
  return <img src={src} alt={alt} className={className} onClick={onClick} />;
}

function openAttachmentViewer(url: string, filename: string) {
  const isPdfByUrl = url.split("?")[0].toLowerCase().endsWith(".pdf");
  const win = window.open();
  if (!win) return;
  const loadContent = async () => {
    let blobUrl = url; let isPdf = isPdfByUrl;
    if (!url.startsWith("data:")) {
      try {
        const cachedBlobUrl = attachmentBlobUrlCache.get(url);
        if (cachedBlobUrl) { blobUrl = cachedBlobUrl; }
        else {
          const r = await fetchWithAuth(url);
          if (!r.ok) throw new Error(`Attachment fetch failed: ${r.status}`);
          const blob = await r.blob();
          if (blob.type === "application/pdf") isPdf = true;
          else if (blob.type.startsWith("image/")) isPdf = false;
          blobUrl = URL.createObjectURL(blob);
          attachmentBlobUrlCache.set(url, blobUrl);
          registerAttachmentCacheCleanup();
        }
      } catch { const p = win.document.createElement('p'); p.textContent = 'Unable to load attachment.'; p.style.cssText = 'color:#ccc;font-family:sans-serif;padding:24px'; win.document.body.appendChild(p); return; }
    }
    const content = isPdf
      ? `<iframe src="${blobUrl}" style="width:100%;height:90vh;border:none;border-radius:8px"></iframe>`
      : `<img src="${blobUrl}" style="max-width:100%;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,.6)"/>`;
    win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(filename)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#111;display:flex;flex-direction:column;align-items:center;min-height:100vh;font-family:sans-serif}header{width:100%;background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;position:sticky;top:0;z-index:10}header span{color:#ccc;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%}a.dl{background:#6366f1;color:#fff;text-decoration:none;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;width:100%}</style></head><body><header><span>${escapeHtml(filename)}</span><a class="dl" href="${blobUrl}" download="${escapeHtml(filename)}">⬇ Download</a></header><main>${content}</main></body></html>`);
    win.document.close();
  };
  loadContent();
}

function DbAttachmentList({ attachments }: { attachments: TicketAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {attachments.map((a) => {
        const isPdf = a.mime_type === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf");
        const isImage = a.mime_type.startsWith("image/");
        if (isPdf) return <button key={a.id} onClick={() => openAttachmentViewer(a.url, a.filename)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-primary hover:bg-muted transition-colors"><Paperclip size={10} /> {a.filename.length > 20 ? "PDF" : a.filename}</button>;
        if (isImage) return <AuthenticatedAttachmentImage key={a.id} url={a.url} alt={a.filename} className="h-20 w-auto rounded-lg border border-border object-cover cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary/40 transition-all" onClick={() => openAttachmentViewer(a.url, a.filename)} />;
        return <button key={a.id} onClick={() => openAttachmentViewer(a.url, a.filename)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-primary hover:bg-muted transition-colors"><Paperclip size={10} /> {a.filename.length > 24 ? a.filename.slice(0, 24) + "…" : a.filename}</button>;
      })}
    </div>
  );
}

// ─── Ticket List Card (clickable) ─────────────────────────────────────────────

function TicketListCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const bar = priorityConfig[ticket.priority]?.bar ?? "bg-muted";
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:bg-card/80 transition-all group overflow-hidden"
    >
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
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><User size={10} /><span>{ticket.customer_name || "—"}</span></div>
                {ticket.customer_phone && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Phone size={10} /><span>{ticket.customer_phone}</span></div>}
                {fmtDate(ticket.created_at) && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarDays size={10} /><span>{fmtDate(ticket.created_at)}</span></div>}
                {(ticket.comment_count ?? 0) > 0 && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><MessageCircle size={10} /><span>{ticket.comment_count}</span></div>}
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
  ticketId,
  onBack,
  isAdmin,
  currentUserName,
  onTicketUpdated,
}: {
  ticketId: number;
  onBack: () => void;
  isAdmin: boolean;
  currentUserName: string;
  onTicketUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [adminAttachFiles, setAdminAttachFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showResolveFlow, setShowResolveFlow] = useState(false);
  const [showReviewSection, setShowReviewSection] = useState(false);
  const [sentiment, setSentiment] = useState<number>(0);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const adminFileInputRef = useRef<HTMLInputElement>(null);
  const webcamRef = useRef<Webcam>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, isError, refetch } = useQuery<TicketDetail>({
    queryKey: ["ticket-detail", ticketId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/${ticketId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json().catch(() => ({}));
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const ticket = data?.ticket;
  const comments = data?.comments ?? [];
  const attachments = data?.attachments ?? [];

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  const uploadFiles = async (files: File[]): Promise<number[]> => {
    if (files.length === 0) return [];
    const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const allIds: number[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ticketId", String(ticketId));
      const res = await fetch("/api/tickets/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`Failed to upload ${file.name}`);
      const data = await res.json().catch(() => ({}));
      const firstId = data.attachments?.[0]?.id;
      if (firstId) allIds.push(firstId);
    }
    return allIds;
  };

  const capturePhoto = () => {
    const img = webcamRef.current?.getScreenshot();
    if (img) {
      fetch(img).then((r) => r.blob()).then((blob) => {
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
        setAdminAttachFiles((prev) => [...prev, file]);
      });
      setShowCamera(false);
    }
  };

  const handleSend = async () => {
    const text = commentText.trim();
    const files = adminAttachFiles;
    if (!text && files.length === 0) return;
    setIsSending(true);
    setCommentText("");
    setAdminAttachFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "36px";
    try {
      let attachmentIds: number[] = [];
      if (files.length > 0) attachmentIds = await uploadFiles(files);
      const res = await fetchWithAuth(`/api/tickets/comment/${ticketId}`, {
        method: "POST",
        body: JSON.stringify({ comment: text, attachmentIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (ticket?.status === "Pending") {
        try {
          await fetchWithAuth(`/api/tickets/status/${ticketId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "InProgress" }),
          });
        } catch { /* non-fatal */ }
      }
      refetch();
      onTicketUpdated();
      invalidateTicketQueries(queryClient);
    } catch {
      toast.error("Failed to send reply");
      setCommentText(text);
    } finally {
      setIsSending(false);
    }
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
      refetch();
      onTicketUpdated();
      invalidateTicketQueries(queryClient);
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
      refetch();
      onTicketUpdated();
      invalidateTicketQueries(queryClient);
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
      refetch();
      onTicketUpdated();
      invalidateTicketQueries(queryClient);
    },
    onError: () => toast.error("Failed to close ticket"),
  });

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
      refetch();
      onTicketUpdated();
      invalidateTicketQueries(queryClient);
    } catch {
      toast.error("Failed to submit review");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const autoExpand = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleAdminFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setAdminAttachFiles((prev) => [...prev, ...Array.from(files)]);
    setTimeout(() => { e.target.value = ""; }, 100);
  };

  const removeAdminFile = (i: number) => {
    setAdminAttachFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Loading ticket…</p>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
        <AlertCircle size={14} /> Failed to load ticket.{" "}
        <button onClick={() => refetch()} className="underline">Retry</button>
      </div>
    );
  }

  const isActive = ticket.status === "Pending" || ticket.status === "InProgress";
  const isResolved = ticket.status === "Resolved";
  const isClosed = ticket.status === "Closed";
  const canReply = isActive;
  const bar = priorityConfig[ticket.priority]?.bar ?? "bg-muted";
  const ticketAttachments = attachments.filter((a) => a.comment_id === null);
  const reviewComment = comments.find((c) => c.comment.startsWith("[Review:"));

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Back + header */}
      <div className="flex items-start gap-3 mb-5">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground shrink-0 mt-0.5">
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
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><User size={10} /><span>{ticket.customer_name}</span></div>
                {ticket.customer_phone && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Phone size={10} /><span>{ticket.customer_phone}</span></div>}
                {ticket.created_at && <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarDays size={10} /><span>{fmtDateTime(ticket.created_at)}</span></div>}
                {ticket.assigned_to && <span className="text-[11px] text-muted-foreground">→ {ticket.assigned_to}</span>}
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
            {ticketAttachments.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1.5"><Paperclip size={10} />{ticketAttachments.length > 1 ? `${ticketAttachments.length} Attachments` : "Attachment"}</p>
                <DbAttachmentList attachments={ticketAttachments} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resolved / Closed banner */}
      {(isResolved || isClosed) && (
        <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-3 ${isClosed ? "bg-slate-500/5 border-slate-400/20" : "bg-emerald-500/5 border-emerald-400/20"}`}>
          {isClosed ? <XCircle size={16} className="text-slate-500 shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
          <div className="flex-1">
            <p className={`text-xs font-semibold ${isClosed ? "text-slate-500" : "text-emerald-600"}`}>{isClosed ? "Ticket Closed" : "Ticket Resolved"}</p>
            {ticket.resolution_note && <p className="text-xs text-muted-foreground mt-0.5">{ticket.resolution_note}</p>}
            {reviewComment && <p className="text-xs text-muted-foreground mt-1 italic">{reviewComment.comment}</p>}
          </div>
          {(isAdmin || isResolved) && (
            <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-400/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 transition-colors disabled:opacity-50 shrink-0">
              {reopenMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
              Reopen
            </button>
          )}
        </div>
      )}

      {/* Conversation */}
      <div className="rounded-xl border border-border bg-card mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <MessageCircle size={13} className="text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">
            Conversation{comments.length > 0 && <span className="text-muted-foreground font-normal ml-1">({comments.length})</span>}
          </p>
        </div>
        {comments.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">
            <MessageCircle size={24} className="mx-auto mb-2 opacity-20" />
            <p className="text-xs">No messages yet.</p>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
            {comments.map((c) => {
              const isMe = c.author_name === currentUserName;
              const isReview = c.comment.startsWith("[Review:");
              const commentAttachments = attachments.filter((a) => a.comment_id === c.id);
              const textOnly = c.comment.replace(/\[attachment:[^\]]+\]/g, "").trim();
              if (isReview) {
                return (
                  <div key={c.id} className="flex justify-center">
                    <div className="bg-emerald-500/5 border border-emerald-400/15 rounded-xl px-4 py-2.5 max-w-sm text-center">
                      <p className="text-xs text-emerald-600 font-medium">{textOnly || c.comment}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{c.author_name} · {fmtDateTime(c.created_at)}</p>
                    </div>
                  </div>
                );
              }
              return (
                <div key={c.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5"><User size={12} className="text-muted-foreground" /></div>
                  <div className={`max-w-[75%] flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-medium">{c.author_name}</span>
                      <span className="text-[9px] text-muted-foreground/50 capitalize">{c.author_role}</span>
                      <span className="text-[10px] text-muted-foreground/40">{fmtDateTime(c.created_at)}</span>
                    </div>
                    {textOnly && (
                      <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}`}>
                        {textOnly}
                      </div>
                    )}
                    {commentAttachments.length > 0 && <DbAttachmentList attachments={commentAttachments} />}
                  </div>
                </div>
              );
            })}
            <div ref={chatBottomRef} />
          </div>
        )}

        {canReply && (
          <div className="px-4 py-3 border-t border-border">
            {adminAttachFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {adminAttachFiles.map((f, i) => {
                  const isImg = f.type.startsWith("image/");
                  const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
                  return (
                    <div key={`${f.name}-${i}`} className="relative group">
                      {isImg ? (
                        <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-auto rounded-lg border border-border object-cover" />
                      ) : (
                        <div className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-border bg-muted text-[11px] text-muted-foreground ${isPdf ? "text-primary border-primary/30 bg-primary/5" : ""}`}>
                          <Paperclip size={10} />{f.name.length > 18 ? f.name.slice(0, 18) + "…" : f.name}
                        </div>
                      )}
                      <button onClick={() => removeAdminFile(i)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={9} /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={adminFileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleAdminFileChange} />
              <button onClick={() => adminFileInputRef.current?.click()} title="Attach files" className="w-8 h-8 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors shrink-0"><Paperclip size={14} /></button>
              <button onClick={() => { setCameraError(null); setShowCamera(true); }} title="Take photo" className="w-8 h-8 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors shrink-0"><Camera size={14} /></button>
              <textarea
                ref={textareaRef}
                value={commentText}
                onChange={(e) => { setCommentText(e.target.value); autoExpand(e.target); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Write a reply… (Enter to send, Shift+Enter for new line)"
                rows={1}
                style={{ minHeight: "36px", maxHeight: "120px", height: "36px" }}
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all overflow-hidden"
              />
              <button onClick={handleSend} disabled={isSending || (!commentText.trim() && adminAttachFiles.length === 0)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0">
                {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        )}

        {!canReply && (
          <div className="px-4 py-3 border-t border-border flex items-center gap-2 text-muted-foreground">
            {isClosed ? (
              <><XCircle size={13} /><p className="text-xs">Ticket is closed — reopen to continue the conversation.</p></>
            ) : (
              <><CheckCircle2 size={13} className="text-emerald-500" /><p className="text-xs text-emerald-600">Ticket resolved — reopen to continue the conversation.</p></>
            )}
          </div>
        )}
      </div>

      {/* Admin action buttons */}
      {isAdmin && isActive && !showResolveFlow && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowResolveFlow(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-400/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 transition-colors">
            <CheckCircle2 size={12} /> Mark as Resolved
          </button>
          <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-400/20 bg-slate-500/5 text-slate-500 hover:bg-slate-500/10 transition-colors disabled:opacity-50">
            {closeMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            Close Ticket
          </button>
        </div>
      )}

      {showResolveFlow && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-5 py-4 space-y-3">
          <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /><p className="text-sm font-semibold text-emerald-700">Confirm Resolution</p></div>
          <p className="text-xs text-muted-foreground">This will mark the ticket as resolved. The customer will be able to leave a review.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50">
              {resolveMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              {resolveMutation.isPending ? "Resolving…" : "Confirm & Resolve"}
            </button>
            <button onClick={() => setShowResolveFlow(false)} className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {showReviewSection && !reviewDone && (
        <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div>
            <p className="text-sm font-semibold text-foreground">How was the resolution?</p>
            <p className="text-xs text-muted-foreground mt-0.5">Completely optional — feel free to skip.</p>
          </div>
          <div className="flex items-center gap-3">
            {SENTIMENTS.map((s) => (
              <button key={s.value} onClick={() => setSentiment(sentiment === s.value ? 0 : s.value)} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border text-center transition-all text-muted-foreground ${sentiment === s.value ? "border-primary bg-primary/5 scale-105" : "border-border hover:border-border/60 hover:bg-muted"}`}>
                <s.Icon active={sentiment === s.value} />
                <span className="text-[10px] font-medium">{s.label}</span>
              </button>
            ))}
          </div>
          <textarea value={reviewRemarks} onChange={(e) => { setReviewRemarks(e.target.value); autoExpand(e.target); }} placeholder="Add a comment about your experience… (optional)" rows={1} style={{ minHeight: "36px", maxHeight: "120px", height: "36px" }} className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all overflow-hidden" />
          <div className="flex items-center gap-2">
            <button onClick={submitReview} disabled={reviewSubmitting} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
              {reviewSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {reviewSubmitting ? "Submitting…" : "Submit Review"}
            </button>
            <button onClick={() => { setReviewDone(true); setShowReviewSection(false); }} className="px-4 py-2 rounded-xl text-sm border border-border text-muted-foreground hover:bg-muted transition-colors">Skip</button>
          </div>
        </div>
      )}

      {reviewDone && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <p className="text-xs text-emerald-600 font-medium">Thank you for your feedback!</p>
        </div>
      )}

      {/* Camera modal */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2"><Camera size={15} className="text-muted-foreground" /><h2 className="text-sm font-semibold text-foreground">Capture Photo</h2></div>
              <button onClick={() => setShowCamera(false)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"><XCircle size={15} /></button>
            </div>
            <div className="p-4">
              {cameraError ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                  <XCircle size={32} className="text-red-400" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <p className="text-xs text-muted-foreground/60">Please allow camera access in your browser settings and try again.</p>
                </div>
              ) : (
                <Webcam ref={webcamRef} screenshotFormat="image/jpeg" className="rounded-xl w-full" width={640} height={480} mirrored={true} videoConstraints={{ width: 640, height: 480, facingMode: { ideal: "environment" } }} onUserMediaError={(err) => { const msg = err instanceof Error ? err.message : String(err); setCameraError(msg.toLowerCase().includes("permission") ? "Camera permission denied." : "Could not access camera: " + msg); }} />
              )}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button onClick={capturePhoto} disabled={!!cameraError} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"><CheckCircle2 size={14} /> Capture</button>
              <button onClick={() => setShowCamera(false)} className="flex-1 px-4 py-2 rounded-xl text-sm border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ResolvedTickets page ─────────────────────────────────────────────────────

type ResolutionTab = "Resolved" | "Closed";

const ResolvedTickets: React.FC = () => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const rights = usePageRights("tickets");
  const ADMIN_ROLES = ["super_admin", "admin", "dba"];
  const isAdmin = ADMIN_ROLES.includes(currentUser?.role ?? "");
  const canSeeAllTickets = isAdmin || currentUser?.role === "engineer";
  const currentUserName = currentUser?.name ?? "Me";

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [activeTab, setActiveTab] = useState<ResolutionTab>("Resolved");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const { data: allTickets = [], isLoading, isError, refetch, isFetching } =
    useQuery<Ticket[]>({
      queryKey: ["tickets", "resolved", isAdmin ? "all" : "my"],
      queryFn: async () => {
        const endpoint = canSeeAllTickets ? "/api/tickets?limit=100&status=Resolved,Closed" : "/api/tickets/my";
        const res = await fetchWithAuth(endpoint);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json().catch(() => ({}));
        const raw: Ticket[] = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        return raw.filter((t) => t.status === "Resolved" || t.status === "Closed");
      },
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    });

  useTicketSync(refetch);

  const filteredTickets = useMemo(() => {
    let list = allTickets.filter((t) => t.status === activeTab);
    if (priorityFilter !== "All") list = list.filter((t) => t.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.subject.toLowerCase().includes(q) || t.customer_name?.toLowerCase().includes(q));
    }
    return list;
  }, [allTickets, activeTab, priorityFilter, search]);

  const resolvedCount = allTickets.filter((t) => t.status === "Resolved").length;
  const closedCount = allTickets.filter((t) => t.status === "Closed").length;

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedTicketId !== null) {
    return (
      <TicketShell title={`Ticket #${selectedTicketId}`} subtitle="Ticket details" icon={CheckCircle2}>
        <div className="max-w-3xl mx-auto">
          <TicketDetailView
            ticketId={selectedTicketId}
            onBack={() => setSelectedTicketId(null)}
            isAdmin={isAdmin}
            currentUserName={currentUserName}
            onTicketUpdated={() => {
              refetch();
              invalidateTicketQueries(queryClient);
            }}
          />
        </div>
      </TicketShell>
    );
  }

  return (
    <>
    <Breadcrumbs items={["Tickets", "Resolved Tickets"]} />
    <TicketShell
      title="Resolved Tickets"
      subtitle={`${resolvedCount} resolved · ${closedCount} closed`}
      icon={CheckCircle2}
      action={
        <button onClick={() => refetch()} disabled={isFetching} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50">
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
        </button>
      }
    >

        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
          </div>
        )}

        {/* Resolved / Closed tabs */}
        <div className="flex items-center gap-1.5">
          {(["Resolved", "Closed"] as ResolutionTab[]).map((tab) => {
            const count = tab === "Resolved" ? resolvedCount : closedCount;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === tab ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}
              >
                {tab}
                {!isLoading && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${activeTab === tab ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${activeTab.toLowerCase()} tickets…`}
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {(["All", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-all ${priorityFilter === p ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-1 h-16 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 size={32} className="opacity-20" />
            <p className="text-sm">{search || priorityFilter !== "All" ? "No tickets match your filters" : `No ${activeTab.toLowerCase()} tickets yet`}</p>
            {(search || priorityFilter !== "All") && (
              <button onClick={() => { setSearch(""); setPriorityFilter("All"); }} className="text-xs text-primary hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((t) => (
              <TicketListCard key={t.id} ticket={t} onClick={() => setSelectedTicketId(t.id)} />
            ))}
          </div>
        )}

        {!isLoading && filteredTickets.length > 0 && (search || priorityFilter !== "All") && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {filteredTickets.length} of {activeTab === "Resolved" ? resolvedCount : closedCount} {activeTab.toLowerCase()} tickets
          </p>
        )}
    </TicketShell>
    </>
  );
};

export default ResolvedTickets;
