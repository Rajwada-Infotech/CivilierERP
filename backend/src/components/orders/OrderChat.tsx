import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { connectSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
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

      // The live socket echo of this same comment can arrive before this REST
      // response resolves, inserting its own copy (matched by real Id, since
      // the server never learns our tempId). Drop both our optimistic
      // placeholder and any such echo, then insert exactly one authoritative
      // copy — regardless of which arrived first.
      setMessages((current) => {
        const savedId = savedComment.Id ?? savedComment.id;
        const withoutDupes = current.filter((m) => {
          if (m.tempId === tempId) return false;
          const mId = m.Id ?? m.id;
          if (savedId != null && mId === savedId) return false;
          return true;
        });
        return [...withoutDupes, { ...savedComment, pending: false }];
      });
    } catch (err) {
      setMessages((current) => current.filter((m) => m.tempId !== tempId));
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className={cn("flex flex-col min-h-0 rounded-2xl border border-border/60 bg-card overflow-hidden", className)}>
      {/* Header — plain text, no icon chip; message count folded in as a dot-separated suffix */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 shrink-0">
        <p className="text-xs font-semibold text-foreground">
          Conversation
          <span className="text-muted-foreground font-normal"> · {messages.length}</span>
        </p>
        {onClose && (
          <button onClick={onClose} className="p-1 -mr-1 rounded-md hover:bg-muted transition-colors text-muted-foreground">
            <X size={14} />
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
        className="flex-1 min-h-[160px] overflow-y-auto px-3 sm:px-4 py-4 space-y-4"
      >
        {(loading || isJoining) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Loading conversation…
          </div>
        )}

        {joinError && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">
            {joinError} — messages will still send, but live updates are paused.
          </div>
        )}

        {!loading && groupedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
              <MessageCircle size={16} />
            </div>
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Start the conversation about this order.</p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.label} className="space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="mx-auto rounded-full px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
                {group.label}
              </span>
            </div>

            <div className="space-y-2">
              {group.items.map((message) => {
                const isMine = message.author_id === currentUser.id;
                const textAlignment = isMine ? "items-end text-right" : "items-start text-left";

                return (
                  <Message
                    key={message.Id ?? message.id ?? message.tempId}
                    from={isMine ? "mine" : "theirs"}
                  >
                    <MessageAvatar
                      name={message.author_name || "U"}
                      tone={roleTone(message.author_role)}
                    />

                    <div className={cn("flex min-w-0 max-w-[80%] sm:max-w-[75%] flex-col gap-0.5", textAlignment)}>
                      <div className={cn("flex items-baseline gap-1.5", isMine ? "justify-end" : "justify-start")}>
                        <span className="text-[11px] font-medium text-muted-foreground truncate">{message.author_name}</span>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">{formatTime(message.created_at)}</span>
                      </div>

                      <MessageContent pending={message.pending}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.comment}</p>
                        {message.pending && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium opacity-70">
                            <Loader2 size={10} className="animate-spin" /> Sending
                          </span>
                        )}
                      </MessageContent>
                    </div>
                  </Message>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Input area — compact single-row pill */}
      <div className="border-t border-border/60 px-3 py-2.5 shrink-0">
        <div className="flex items-end gap-2">
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
            className="min-h-[40px] max-h-36 flex-1 resize-none rounded-2xl border-border/60 bg-muted/40 px-4 py-2.5 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          <Button
            onClick={handleSend}
            disabled={!draft.trim() || isSending}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
          >
            {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default OrderChat;
