import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, ShieldAlert, User, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { connectSocket } from "@/lib/socket";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
  if (normalized === "admin" || normalized === "super_admin" || normalized === "dba") {
    return "bg-indigo-500 text-white";
  }
  if (normalized === "engineer") {
    return "bg-emerald-500 text-white";
  }
  if (normalized === "customer" || normalized === "user") {
    return "bg-sky-500 text-white";
  }
  return "bg-slate-500 text-white";
}

function mergeMessages(
  current: TicketChatMessage[],
  incoming: TicketChatMessage,
): TicketChatMessage[] {
  const byIdIndex = current.findIndex((message) => message.id === incoming.id);
  if (byIdIndex >= 0) {
    const next = [...current];
    next[byIdIndex] = { ...next[byIdIndex], ...incoming, pending: false };
    return next;
  }

  const tempIndex = current.findIndex(
    (message) => message.tempId && incoming.tempId && message.tempId === incoming.tempId,
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
  if (isInternal) {
    return "border-amber-400/20 bg-amber-500/8 text-amber-950";
  }
  if (isMine) {
    return "border-indigo-500/20 bg-indigo-600 text-white";
  }
  return "border-border bg-background text-foreground";
}

function renderTypingLabel(users: TypingUser[]) {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0].name} is typing`;
  if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing`;
  return `${users[0].name} and ${users.length - 1} others are typing`;
}

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
        const filtered = current.filter(
          (item) => (item.userId ?? item.name) !== key,
        );
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
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      if (typingEmitTimerRef.current) {
        window.clearTimeout(typingEmitTimerRef.current);
        typingEmitTimerRef.current = null;
      }
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
    if (!socket) return;
    if (isClosed) return;

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

    if (!trimmed) {
      emitTyping();
      return;
    }

    emitTyping();
    typingEmitTimerRef.current = window.setTimeout(() => {
      emitTyping();
    }, 2500);

    return () => {
      if (typingEmitTimerRef.current) {
        window.clearTimeout(typingEmitTimerRef.current);
        typingEmitTimerRef.current = null;
      }
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

    return Array.from(groups.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [messages]);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  };

  const stopTyping = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("ticket:typing", {
      ticketId,
      isTyping: false,
      name: currentUser.name,
      role: currentUser.role,
      userId: currentUser.id,
    });
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    requestAnimationFrame(adjustHeight);
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
        body: JSON.stringify({
          comment: text,
          is_internal: isInternalNote,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }

      const savedComment = payload?.comment;
      if (!savedComment) {
        throw new Error("Invalid comment response");
      }
      setMessages((current) => {
        const next = current.map((message) =>
          message.tempId === tempId
            ? { ...savedComment, pending: false }
            : message,
        );
        return next.some((message) => message.id === savedComment.id)
          ? next.filter((message) => message.tempId !== tempId)
          : next;
      });
      onSent?.();
    } catch (err) {
      setMessages((current) => current.filter((message) => message.tempId !== tempId));
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setIsSending(false);
    }
  };

  const typingLabel = renderTypingLabel(typingUsers);

  return (
    <section className={cn("rounded-2xl border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MessageCircle size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Ticket Chat</p>
            <p className="text-xs text-muted-foreground">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
      </div>

      <div
        ref={listRef}
        onScroll={() => {
          const node = listRef.current;
          if (!node) return;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          autoScrollRef.current = distance < 80;
        }}
        className="max-h-[32rem] overflow-y-auto px-4 py-4 space-y-4"
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
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-3">
              {group.items.map((message) => {
                const isMine = message.author_id === currentUser.id;
                const internal = message.is_internal === 1 || message.is_internal === true;
                const bubbleClass = bubbleStyles(message, isMine);
                const alignmentClass = isMine ? "flex-row-reverse" : "flex-row";
                const textAlignment = isMine ? "items-end text-right" : "items-start text-left";

                return (
                  <div key={message.id ?? message.tempId} className={cn("flex gap-3", alignmentClass)}>
                    <Avatar className="h-10 w-10 shrink-0 border border-border">
                      <AvatarFallback className={cn("text-[10px] font-semibold", roleTone(message.author_role))}>
                        {getInitials(message.author_name || "U")}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", textAlignment)}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-foreground">
                          {message.author_name}
                        </span>
                        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] capitalize text-muted-foreground">
                          {(message.author_role || "user").replaceAll("_", " ")}
                        </Badge>
                        {internal && (
                          <Badge className="h-5 rounded-full bg-amber-500/10 px-2 text-[10px] text-amber-800 hover:bg-amber-500/10">
                            Internal
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground/60">
                          {formatTime(message.created_at)}
                        </span>
                      </div>

                      <div
                        className={cn(
                          "relative rounded-2xl border px-3 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap",
                          bubbleClass,
                          isMine && !internal && "rounded-tr-md",
                          !isMine && !internal && "rounded-tl-md",
                          internal && "rounded-tr-md border-amber-400/20 bg-amber-500/10",
                          message.pending && "opacity-70",
                        )}
                      >
                        {message.comment}
                        {message.pending && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            <Loader2 size={10} className="animate-spin" />
                            Sending
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

        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User size={14} />
            </span>
            <div>
              <p className="font-medium text-foreground">{typingLabel}</p>
              <div className="mt-1 flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={cn("border-t border-border px-4 py-4", isInternalNote && "bg-amber-500/5")}>
        {isClosed ? (
          <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            This ticket is closed. Reopen it to continue the conversation.
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isInternalNote
                  ? "Write an internal note for staff only…"
                  : "Write a reply…"
              }
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