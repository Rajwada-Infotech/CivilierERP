import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
  ShieldAlert,
  User,
  Users,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { connectSocket } from "@/lib/socket";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketChatUser = {
  id: number;
  name: string;
  role: string;
};

export type TicketChatMessage = {
  id: number;
  ticket_id: number;
  comment: string;
  author_name: string;
  author_id?: number | null;
  author_role: string | null;
  created_at: string;
  is_internal?: boolean | number;
  tempId?: string;
  pending?: boolean;
};

type TicketChatProps = {
  ticketId: number;
  currentUser: TicketChatUser;
  initialMessages: TicketChatMessage[];
  ticketStatus?: string;
  className?: string;
  onSent?: () => void;
};

type TypingUser = {
  userId: number | null;
  name: string;
  role: string;
};

type SocketTypingPayload = {
  ticketId?: number;
  userId?: number;
  name?: string;
  role?: string;
  isTyping?: boolean;
};

// ─── Attachment parsing ───────────────────────────────────────────────────────

/**
 * A comment can contain one or more attachment tokens:
 *   [attachment:/api/tickets/file/1779436898263-721161.pdf]
 *   [attachment:/api/tickets/file/1779437719077-515331.jpg]
 *
 * This parser splits the comment string into text segments and attachment
 * segments so they can be rendered as proper UI elements.
 */

type TextSegment = { type: "text"; value: string };
type AttachmentSegment = { type: "attachment"; url: string; filename: string; isImage: boolean };
type MessageSegment = TextSegment | AttachmentSegment;

// DB stores tokens WITHOUT a leading slash: [attachment:api/tickets/file/...]
// Regex makes the leading slash optional so old and new data both match.
// Capture group 1 = optional slash, group 2 = rest of path.
const ATTACHMENT_RE = /\[attachment:(\/?api\/tickets\/file\/[^\]]+)\]/g;
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp)$/i;

function parseComment(comment: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ATTACHMENT_RE.lastIndex = 0;
  while ((match = ATTACHMENT_RE.exec(comment)) !== null) {
    if (match.index > lastIndex) {
      const text = comment.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: "text", value: text });
    }

    // Normalise: always ensure leading slash for fetchWithAuth
    const url = match[1].startsWith("/") ? match[1] : "/" + match[1];
    const filename = url.split("/").pop() ?? "attachment";
    const isImage = IMAGE_EXTS.test(filename);
    segments.push({ type: "attachment", url, filename, isImage });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < comment.length) {
    const text = comment.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", value: text });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: comment }];
}

// ─── Attachment blob URL cache ────────────────────────────────────────────────

const blobCache = new Map<string, string>();
let cleanupRegistered = false;

function registerCleanup() {
  if (cleanupRegistered || typeof window === "undefined") return;
  cleanupRegistered = true;
  window.addEventListener("beforeunload", () => {
    blobCache.forEach((url) => URL.revokeObjectURL(url));
    blobCache.clear();
  });
}

// ─── useBlobUrl ───────────────────────────────────────────────────────────────
// Shared hook: fetches any auth-protected file URL and returns a blob URL.

function useBlobUrl(url: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(blobCache.get(url) ?? null);
  const [loading, setLoading] = useState(!blobCache.has(url));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (blobCache.has(url)) { setBlobUrl(blobCache.get(url)!); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(url)
      .then((res) => { if (!res.ok) throw new Error(`${res.status}`); return res.blob(); })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobCache.set(url, objectUrl);
        registerCleanup();
        setBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { blobUrl, loading, error };
}

// ─── AttachmentImage ──────────────────────────────────────────────────────────

function AttachmentImage({ url, filename, isMine }: { url: string; filename: string; isMine: boolean }) {
  const { blobUrl, loading, error } = useBlobUrl(url);
  const [lightbox, setLightbox] = useState(false);

  if (loading) {
    return (
      <div className="flex h-28 w-40 items-center justify-center rounded-2xl border border-border/60 bg-muted/20 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={16} className="animate-spin text-muted-foreground/60" />
          <span className="text-[10px] text-muted-foreground/50">Loading…</span>
        </div>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className={cn(
        "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs",
        isMine ? "border-white/20 bg-white/10 text-white" : "border-border bg-muted/30 text-muted-foreground"
      )}>
        <Paperclip size={12} />
        <span className="max-w-[140px] truncate">{filename}</span>
        <span className="text-[10px] opacity-60">Failed</span>
      </div>
    );
  }

  return (
    <>
      <div
        className="group relative cursor-zoom-in overflow-hidden rounded-2xl border border-border/60 shadow-sm transition-all hover:shadow-md hover:border-border"
        onClick={() => setLightbox(true)}
      >
        <img
          src={blobUrl}
          alt={filename}
          className="max-h-52 max-w-[240px] object-cover"
        />
        <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="rounded-full bg-black/60 p-1.5 backdrop-blur-sm">
            <ZoomIn size={12} className="text-white" />
          </div>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 transition-colors"
            onClick={() => setLightbox(false)}
          >
            <X size={16} />
          </button>
          <img
            src={blobUrl}
            alt={filename}
            className="max-h-[88vh] max-w-[88vw] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-4 py-1.5 text-[11px] text-white/70 backdrop-blur-sm">
            {filename}
          </p>
        </div>
      )}
    </>
  );
}

// ─── AttachmentPDF ────────────────────────────────────────────────────────────
// Uses fetchWithAuth + blob URL so the auth-protected endpoint is never
// accessed directly via browser navigation (which can't send JWT headers).

function AttachmentPDF({ url, filename, isMine }: { url: string; filename: string; isMine: boolean }) {
  const { blobUrl, loading, error } = useBlobUrl(url);
  const displayName = filename.replace(/^\d{13}-/, "").replace(/-\d+\.pdf$/i, ".pdf") || filename;

  const handleOpen = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  return (
    <button
      onClick={handleOpen}
      disabled={loading || error || !blobUrl}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all",
        "hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
        isMine
          ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
          : "border-border bg-muted/30 text-foreground hover:bg-muted/50",
      )}
    >
      {/* Icon */}
      <div className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
        loading ? "bg-muted/50" : "bg-red-500/15",
      )}>
        {loading
          ? <Loader2 size={15} className="animate-spin text-muted-foreground" />
          : error
          ? <Paperclip size={15} className="text-muted-foreground" />
          : <FileText size={15} className="text-red-500" />
        }
      </div>

      {/* Label */}
      <div className="min-w-0 flex-1">
        <p className="max-w-[160px] truncate text-xs font-medium leading-tight">
          {displayName}
        </p>
        <p className={cn(
          "mt-0.5 text-[10px]",
          isMine ? "text-white/50" : "text-muted-foreground/60",
        )}>
          {loading ? "Loading…" : error ? "Failed to load" : "Click to open PDF"}
        </p>
      </div>
    </button>
  );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

function MessageContent({
  comment,
  isMine,
  pending,
}: {
  comment: string;
  isMine: boolean;
  pending?: boolean;
}) {
  const segments = useMemo(() => parseComment(comment), [comment]);

  const attachments = segments.filter((s): s is AttachmentSegment => s.type === "attachment");
  const texts = segments.filter((s): s is TextSegment => s.type === "text");

  return (
    <div className="space-y-2">
      {/* Text portion */}
      {texts.map((seg, i) => (
        <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap">
          {seg.value}
        </p>
      ))}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className={cn("flex flex-wrap gap-2", isMine ? "justify-end" : "justify-start")}>
          {attachments.map((seg, i) =>
            seg.isImage ? (
              <AttachmentImage key={i} url={seg.url} filename={seg.filename} isMine={isMine} />
            ) : (
              <AttachmentPDF key={i} url={seg.url} filename={seg.filename} isMine={isMine} />
            ),
          )}
        </div>
      )}

      {/* Pending indicator */}
      {pending && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          <Loader2 size={10} className="animate-spin" />
          Sending
        </span>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(["admin", "super_admin", "dba"]);

function normalizeRole(role: string | null | undefined) {
  return String(role ?? "").trim().toLowerCase();
}

function isAdminRole(role: string | null | undefined) {
  return ADMIN_ROLES.has(normalizeRole(role));
}

function formatMessageDate(dateString: string) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function roleTone(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  if (["admin", "super_admin", "dba"].includes(normalized)) return "bg-indigo-500 text-white";
  if (normalized === "engineer") return "bg-emerald-500 text-white";
  if (["customer", "user"].includes(normalized)) return "bg-sky-500 text-white";
  return "bg-slate-500 text-white";
}

function mergeMessages(
  current: TicketChatMessage[],
  incoming: TicketChatMessage,
): TicketChatMessage[] {
  const byIdIndex = current.findIndex((m) => m.id === incoming.id);
  if (byIdIndex >= 0) {
    const next = [...current];
    next[byIdIndex] = { ...next[byIdIndex], ...incoming, pending: false };
    return next;
  }
  const tempIndex = current.findIndex(
    (m) => m.tempId && incoming.tempId && m.tempId === incoming.tempId,
  );
  if (tempIndex >= 0) {
    const next = [...current];
    next[tempIndex] = { ...incoming, pending: false };
    return next;
  }
  return [...current, { ...incoming, pending: false }];
}

function bubbleStyles(message: TicketChatMessage, isMine: boolean) {
  const isInternal = message.is_internal === 1 || message.is_internal === true;
  if (isInternal) return "border-amber-400/30 bg-amber-500/10 text-amber-950 dark:text-amber-100";
  if (isMine) return "border-indigo-500/30 bg-indigo-600 text-white shadow-indigo-500/20";
  return "border-border/60 bg-card text-foreground shadow-sm";
}

function renderTypingLabel(users: TypingUser[]) {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0].name} is typing`;
  if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing`;
  return `${users[0].name} and ${users.length - 1} others are typing`;
}

// ─── TicketChat ───────────────────────────────────────────────────────────────

export function TicketChat({
  ticketId,
  currentUser,
  initialMessages,
  ticketStatus,
  className,
  onSent,
}: TicketChatProps) {
  const [messages, setMessages] = useState<TicketChatMessage[]>(() =>
    [...initialMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
  );
  const [draft, setDraft] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isJoining, setIsJoining] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const typingEmitTimerRef = useRef<number | null>(null);
  const autoScrollRef = useRef(true);

  const canWriteInternal = isAdminRole(currentUser.role);
  const isClosed = ticketStatus === "Closed";

  useEffect(() => {
    setMessages(
      [...initialMessages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    );
  }, [initialMessages]);

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    if (!socket) {
      setIsJoining(false);
      setJoinError("Socket connection unavailable");
      return;
    }

    const handleMessage = (payload: { ticketId?: number; message?: TicketChatMessage }) => {
      if (payload.ticketId !== ticketId || !payload.message) return;
      setMessages((current) => mergeMessages(current, payload.message as TicketChatMessage));
    };

    const handleTyping = (payload: SocketTypingPayload) => {
      if (payload.ticketId !== ticketId) return;
      if (payload.userId === currentUser.id) return;
      const name = payload.name?.trim();
      if (!name) return;

      const typingUser: TypingUser = {
        userId: payload.userId ?? null,
        name,
        role: payload.role ?? "user",
      };

      setTypingUsers((current) => {
        const key = typingUser.userId ?? typingUser.name;
        const filtered = current.filter((item) => (item.userId ?? item.name) !== key);
        if (!payload.isTyping) return filtered;
        return [...filtered, typingUser];
      });

      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }

      if (payload.isTyping) {
        typingStopTimerRef.current = window.setTimeout(() => {
          setTypingUsers((current) =>
            current.filter(
              (item) => (item.userId ?? item.name) !== (typingUser.userId ?? typingUser.name),
            ),
          );
        }, 3000);
      }
    };

    const joinAck = (response?: { ok?: boolean; error?: string }) => {
      if (response?.ok === false) {
        setJoinError(response.error || "Unable to join ticket room");
      } else {
        setJoinError(null);
      }
      setIsJoining(false);
    };

    socket.emit("ticket:join", ticketId, joinAck);
    socket.on("ticket:message", handleMessage);
    socket.on("ticket:typing", handleTyping);

    return () => {
      socket.emit("ticket:leave", ticketId);
      socket.off("ticket:message", handleMessage);
      socket.off("ticket:typing", handleTyping);
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
      if (typingEmitTimerRef.current) window.clearTimeout(typingEmitTimerRef.current);
      setTypingUsers([]);
    };
  }, [currentUser.id, ticketId]);

  useEffect(() => {
    if (autoScrollRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, typingUsers.length]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || isClosed) return;

    const trimmed = draft.trim();
    const emitTyping = () => {
      socket.emit("ticket:typing", {
        ticketId,
        isTyping: Boolean(trimmed),
        name: currentUser.name,
        role: currentUser.role,
        userId: currentUser.id,
      });
    };

    if (typingEmitTimerRef.current) {
      window.clearTimeout(typingEmitTimerRef.current);
      typingEmitTimerRef.current = null;
    }

    emitTyping();
    if (trimmed) {
      typingEmitTimerRef.current = window.setTimeout(emitTyping, 2500);
    }

    return () => {
      if (typingEmitTimerRef.current) window.clearTimeout(typingEmitTimerRef.current);
    };
  }, [currentUser.id, currentUser.name, currentUser.role, draft, isClosed, ticketId]);

  const groupedMessages = useMemo(() => {
    const groups = new Map<string, TicketChatMessage[]>();
    messages.forEach((message) => {
      const key = formatMessageDate(message.created_at);
      const items = groups.get(key) ?? [];
      items.push(message);
      groups.set(key, items);
    });
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [messages]);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  };

  const stopTyping = () => {
    socketRef.current?.emit("ticket:typing", {
      ticketId,
      isTyping: false,
      name: currentUser.name,
      role: currentUser.role,
      userId: currentUser.id,
    });
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending || isClosed) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: TicketChatMessage = {
      id: -Date.now(),
      tempId,
      ticket_id: ticketId,
      comment: text,
      author_name: currentUser.name,
      author_id: currentUser.id,
      author_role: currentUser.role,
      created_at: new Date().toISOString(),
      is_internal: isInternalNote,
      pending: true,
    };

    setIsSending(true);
    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    setIsInternalNote(false);
    requestAnimationFrame(adjustHeight);
    stopTyping();

    try {
      const res = await fetchWithAuth(`/api/tickets/comment/${ticketId}`, {
        method: "POST",
        body: JSON.stringify({ comment: text, is_internal: isInternalNote }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);

      const savedComment = payload?.comment;
      if (!savedComment) throw new Error("Invalid comment response");

      setMessages((current) => {
        const next = current.map((m) =>
          m.tempId === tempId ? { ...savedComment, pending: false } : m,
        );
        return next.some((m) => m.id === savedComment.id)
          ? next.filter((m) => m.tempId !== tempId)
          : next;
      });
      onSent?.();
    } catch (err) {
      setMessages((current) => current.filter((m) => m.tempId !== tempId));
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className={cn("rounded-2xl border border-border bg-card overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/10">
            <MessageCircle size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Conversation</p>
            <p className="text-[11px] text-muted-foreground">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {canWriteInternal && (
          <div className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5">
            <ShieldAlert size={12} className="text-amber-700" />
            <span className="text-[11px] font-medium text-amber-800">Internal</span>
            <Switch
              checked={isInternalNote}
              onCheckedChange={setIsInternalNote}
              disabled={isClosed}
            />
          </div>
        )}
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={() => {
          const node = listRef.current;
          if (!node) return;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          autoScrollRef.current = distance < 80;
        }}
        className="max-h-[32rem] overflow-y-auto bg-muted/10 px-4 py-5 space-y-5"
      >
        {isJoining && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Joining ticket room…
          </div>
        )}

        {joinError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600">
            {joinError}
          </div>
        )}

        {!isJoining && !joinError && groupedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users size={18} />
            </div>
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Start the conversation with the customer or your team.
            </p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.label} className="space-y-3">
            {/* Date divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border/50" />
              <span className="rounded-full border border-border/50 bg-background/80 px-3 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70 backdrop-blur-sm">
                {group.label}
              </span>
              <div className="h-px flex-1 bg-border/50" />
            </div>

            <div className="space-y-3">
              {group.items.map((message) => {
                const isMine = message.author_id === currentUser.id;
                const internal = message.is_internal === 1 || message.is_internal === true;
                const bubbleClass = bubbleStyles(message, isMine);
                const alignmentClass = isMine ? "flex-row-reverse" : "flex-row";
                const textAlignment = isMine ? "items-end text-right" : "items-start text-left";

                return (
                  <div key={message.id ?? message.tempId} className={cn("flex gap-2.5", alignmentClass)}>
                    {/* Avatar */}
                    <Avatar className="h-8 w-8 shrink-0 border border-border/60 shadow-sm">
                      <AvatarFallback className={cn("text-[10px] font-bold", roleTone(message.author_role))}>
                        {getInitials(message.author_name || "U")}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn("flex min-w-0 max-w-[78%] flex-col gap-1", textAlignment)}>
                      {/* Author meta row */}
                      <div className={cn("flex flex-wrap items-center gap-1.5", isMine ? "justify-end" : "justify-start")}>
                        <span className="text-[11px] font-semibold text-foreground">
                          {message.author_name}
                        </span>
                        <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[9px] capitalize text-muted-foreground border-border/50">
                          {(message.author_role || "user").replaceAll("_", " ")}
                        </Badge>
                        {internal && (
                          <Badge className="h-4 rounded-full bg-amber-500/15 px-1.5 text-[9px] text-amber-700 hover:bg-amber-500/15 border-amber-400/20">
                            Internal
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground/50">
                          {formatTime(message.created_at)}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={cn(
                          "relative rounded-2xl border px-3.5 py-2.5 shadow-sm transition-opacity",
                          bubbleClass,
                          isMine ? "rounded-tr-sm" : "rounded-tl-sm",
                          internal && "border-amber-400/30 bg-amber-500/10 rounded-tr-sm",
                          message.pending && "opacity-60",
                        )}
                      >
                        <MessageContent
                          comment={message.comment}
                          isMine={isMine}
                          pending={message.pending}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User size={14} />
            </span>
            <div>
              <p className="font-medium text-foreground">{renderTypingLabel(typingUsers)}</p>
              <div className="mt-1 flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className={cn(
        "border-t border-border/60 px-4 py-4",
        isInternalNote ? "bg-amber-500/5" : "bg-muted/10"
      )}>
        {isClosed ? (
          <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            This ticket is closed. Reopen it to continue the conversation.
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                requestAnimationFrame(adjustHeight);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isInternalNote ? "Write an internal note for staff only…" : "Write a reply…"}
              rows={1}
              className={cn(
                "min-h-[52px] resize-none rounded-2xl border-border bg-background px-4 py-3 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/20",
                isInternalNote && "border-amber-400/30 bg-amber-500/5",
              )}
              style={{ height: 52 }}
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                Press Enter to send, Shift+Enter for a new line
              </p>
              <Button
                onClick={handleSend}
                disabled={!draft.trim() || isSending || isClosed}
                className={cn(
                  "min-w-24 rounded-xl px-4",
                  isInternalNote && "bg-amber-600 text-white hover:bg-amber-700",
                )}
              >
                {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {isSending ? "Sending" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default TicketChat;