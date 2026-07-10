import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { connectSocket } from "@/lib/socket";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
// Generic PO<->supplier chat thread, modeled on src/pages/ticket/TicketChat.tsx
// but pointed at whichever comment API base the caller supplies — so it works
// unmodified from both the Supplier Portal ("/api/supplier-portal/orders/:id")
// and the staff-facing Purchase Order pages ("/api/purchase-orders/:id").

export type OrderChatUser = {
  id: number;
  name: string;
  role: string;
};

export type OrderChatMessage = {
  Id?: number;
  id?: number;
  PurchaseOrderId?: number;
  comment: string;
  author_name: string;
  author_id?: number | null;
  author_role: string | null;
  created_at: string;
  tempId?: string;
  pending?: boolean;
};

type OrderChatProps = {
  poId: number;
  apiBase: string; // e.g. "/api/supplier-portal/orders" or "/api/purchase-orders"
  currentUser: OrderChatUser;
  className?: string;
  onClose?: () => void;
};

function normalizeRole(role: string | null | undefined) {
  return String(role ?? "").trim().toLowerCase();
}

function roleTone(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  if (normalized === "supplier") return "bg-emerald-500 text-white";
  if (["admin", "super_admin", "dba"].includes(normalized)) return "bg-indigo-500 text-white";
  if (normalized === "engineer") return "bg-sky-500 text-white";
  return "bg-slate-500 text-white";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatMessageDate(dateString: string) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function mergeMessages(current: OrderChatMessage[], incoming: OrderChatMessage): OrderChatMessage[] {
  const incomingId = incoming.Id ?? incoming.id;
  const byIdIndex = current.findIndex((m) => (m.Id ?? m.id) === incomingId);
  if (byIdIndex >= 0) {
    const next = [...current];
    next[byIdIndex] = { ...next[byIdIndex], ...incoming, pending: false };
    return next;
  }
  const tempIndex = current.findIndex((m) => m.tempId && incoming.tempId && m.tempId === incoming.tempId);
  if (tempIndex >= 0) {
    const next = [...current];
    next[tempIndex] = { ...incoming, pending: false };
    return next;
  }
  return [...current, { ...incoming, pending: false }];
}

export function OrderChat({ poId, apiBase, currentUser, className, onClose }: OrderChatProps) {
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isJoining, setIsJoining] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);
  const autoScrollRef = useRef(true);

  // Initial history load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWithAuth(`${apiBase}/${poId}/comments`)
      .then((r) => (r.ok ? r.json().catch(() => []) : []))
      .then((data) => {
        if (cancelled) return;
        const rows: OrderChatMessage[] = Array.isArray(data) ? data : [];
        setMessages(
          [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        );
      })
      .catch(() => { if (!cancelled) toast.error("Could not load conversation"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, poId]);

  // Socket room join + live message stream
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    if (!socket) {
      setIsJoining(false);
      setJoinError("Socket connection unavailable");
      return;
    }

    const handleMessage = (payload: { poId?: number; comment?: OrderChatMessage }) => {
      if (payload.poId !== poId || !payload.comment) return;
      setMessages((current) => mergeMessages(current, payload.comment as OrderChatMessage));
    };

    const joinAck = (response?: { ok?: boolean; error?: string }) => {
      if (response?.ok === false) setJoinError(response.error || "Unable to join order room");
      else setJoinError(null);
      setIsJoining(false);
    };

    socket.emit("po:join", poId, joinAck);
    socket.on("po:message", handleMessage);

    return () => {
      socket.emit("po:leave", poId);
      socket.off("po:message", handleMessage);
    };
  }, [poId]);

  useEffect(() => {
    if (autoScrollRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const groupedMessages = useMemo(() => {
    const groups = new Map<string, OrderChatMessage[]>();
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

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage: OrderChatMessage = {
      id: -Date.now(),
      tempId,
      comment: text,
      author_name: currentUser.name,
      author_id: currentUser.id,
      author_role: currentUser.role,
      created_at: new Date().toISOString(),
      pending: true,
    };

    setIsSending(true);
    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    requestAnimationFrame(adjustHeight);

    try {
      const res = await fetchWithAuth(`${apiBase}/${poId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: text }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);

      const savedComment = payload?.comment;
      if (!savedComment) throw new Error("Invalid comment response");

      setMessages((current) => {
        const next = current.map((m) => (m.tempId === tempId ? { ...savedComment, pending: false } : m));
        return next.some((m) => (m.Id ?? m.id) === (savedComment.Id ?? savedComment.id))
          ? next.filter((m) => m.tempId !== tempId || (m.Id ?? m.id) === (savedComment.Id ?? savedComment.id))
          : next;
      });
    } catch (err) {
      setMessages((current) => current.filter((m) => m.tempId !== tempId));
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className={cn("flex flex-col rounded-2xl border border-border bg-card overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/10">
            <MessageCircle size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Order Conversation</p>
            <p className="text-[11px] text-muted-foreground">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X size={16} />
          </button>
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
        className="flex-1 min-h-[240px] max-h-[26rem] overflow-y-auto bg-muted/10 px-4 py-5 space-y-5"
      >
        {(loading || isJoining) && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Loading conversation…
          </div>
        )}

        {joinError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600">
            {joinError} — messages will still send, but live updates are paused.
          </div>
        )}

        {!loading && groupedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users size={18} />
            </div>
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Start the conversation about this order.</p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.label} className="space-y-3">
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
                const alignmentClass = isMine ? "flex-row-reverse" : "flex-row";
                const textAlignment = isMine ? "items-end text-right" : "items-start text-left";

                return (
                  <div key={message.Id ?? message.id ?? message.tempId} className={cn("flex gap-2.5", alignmentClass)}>
                    <Avatar className="h-8 w-8 shrink-0 border border-border/60 shadow-sm">
                      <AvatarFallback className={cn("text-[10px] font-bold", roleTone(message.author_role))}>
                        {getInitials(message.author_name || "U")}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn("flex min-w-0 max-w-[78%] flex-col gap-1", textAlignment)}>
                      <div className={cn("flex flex-wrap items-center gap-1.5", isMine ? "justify-end" : "justify-start")}>
                        <span className="text-[11px] font-semibold text-foreground">{message.author_name}</span>
                        <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[9px] capitalize text-muted-foreground border-border/50">
                          {(message.author_role || "user").replaceAll("_", " ")}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground/50">{formatTime(message.created_at)}</span>
                      </div>

                      <div
                        className={cn(
                          "relative rounded-2xl border px-3.5 py-2.5 shadow-sm transition-opacity",
                          isMine ? "border-indigo-500/30 bg-indigo-600 text-white shadow-indigo-500/20 rounded-tr-sm" : "border-border/60 bg-card text-foreground shadow-sm rounded-tl-sm",
                          message.pending && "opacity-60",
                        )}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.comment}</p>
                        {message.pending && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest opacity-70">
                            <Loader2 size={10} className="animate-spin" /> Sending
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="border-t border-border/60 bg-muted/10 px-4 py-4 shrink-0">
        <div className="space-y-3">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); requestAnimationFrame(adjustHeight); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Write a reply…"
            rows={1}
            className="min-h-[52px] max-h-36 w-full resize-none rounded-2xl border-border bg-background px-4 py-3 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Press Enter to send, Shift+Enter for a new line</p>
            <Button onClick={handleSend} disabled={!draft.trim() || isSending} className="min-w-24 rounded-xl px-4">
              {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {isSending ? "Sending" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default OrderChat;
