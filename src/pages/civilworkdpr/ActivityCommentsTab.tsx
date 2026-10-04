import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Lock, RotateCcw, Send } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { connectSocket } from "@/lib/socket";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// Live discussion for one activity. Sends go over REST (validated, saved,
// idempotent); the server then fans each saved message out over socket.io to
// everyone with this thread open. If the socket drops we catch up by asking
// for "everything after the last id I have", and while it is down we poll
// slowly — so a flaky site connection delays messages but never loses them.

const BASE = "/api/activity-comments";
const MAX_LEN = 2000;
const POLL_MS = 15_000;

type Msg = {
  id: number | null; // null while a send is in flight / failed
  clientId: string | null;
  authorUserId: number;
  authorName: string;
  body: string;
  createdAt: string;
  state?: "sending" | "failed";
};

const newClientId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2, 10)}`).slice(0, 50);

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// Insert/replace by server id or clientId, keeping chronological order.
function merge(list: Msg[], incoming: Msg): Msg[] {
  const idx = list.findIndex(
    (m) => (incoming.id != null && m.id === incoming.id) || (incoming.clientId && m.clientId === incoming.clientId),
  );
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...incoming, state: undefined };
    return next;
  }
  return [...list, incoming];
}

export default function ActivityCommentsTab({ rungId }: { rungId: number }) {
  const { currentUser } = useAuth();
  const myId = Number(currentUser?.id);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreScrollFrom = useRef<number | null>(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    lastIdRef.current = messages.reduce((mx, m) => (m.id != null && m.id > mx ? m.id : mx), 0);
  }, [messages]);

  const fetchPage = useCallback(
    async (query: string) => {
      const res = await fetchWithAuth(`${BASE}/${rungId}${query}`);
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setDenied(body.error || "You don't have access to this thread.");
        return null;
      }
      if (!res.ok) throw new Error("Failed to load comments");
      return (await res.json()) as { messages: Msg[]; hasMore: boolean };
    },
    [rungId],
  );

  // Initial load: newest page.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDenied(null);
    setMessages([]);
    fetchPage("")
      .then((page) => {
        if (cancelled || !page) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  // Anything newer than what we hold (reconnect / slow-poll catch-up).
  const catchUp = useCallback(async () => {
    try {
      const page = await fetchPage(`?afterId=${lastIdRef.current}`);
      if (page?.messages.length) {
        setMessages((cur) => page.messages.reduce(merge, cur));
      }
    } catch {
      /* next tick retries */
    }
  }, [fetchPage]);

  // Live stream: join the thread room, merge pushed messages, re-sync on reconnect.
  useEffect(() => {
    if (denied) return;
    const socket = connectSocket();
    if (!socket) return;

    const join = () =>
      socket.emit("activity-thread:join", rungId, (ack?: { ok?: boolean; error?: string }) => {
        if (ack?.ok) {
          setLive(true);
          catchUp(); // closes the gap between the page load and the join
        } else {
          setLive(false);
        }
      });
    const onNew = (p: { rungId?: number; comment?: Msg }) => {
      if (p.rungId !== rungId || !p.comment) return;
      setMessages((cur) => merge(cur, p.comment as Msg));
    };
    const onRejoin = (p: { rungId?: number }) => {
      if (p.rungId === rungId) join();
    };
    const onDisconnect = () => setLive(false);

    socket.on("activity-comment:new", onNew);
    socket.on("activity-thread:rejoin", onRejoin);
    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) join();

    return () => {
      socket.emit("activity-thread:leave", rungId);
      socket.off("activity-comment:new", onNew);
      socket.off("activity-thread:rejoin", onRejoin);
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      setLive(false);
    };
  }, [rungId, denied, catchUp]);

  // While not live, poll slowly so messages still arrive.
  useEffect(() => {
    if (live || denied) return;
    const t = setInterval(catchUp, POLL_MS);
    return () => clearInterval(t);
  }, [live, denied, catchUp]);

  // Scroll handling: stay pinned to the bottom unless the reader scrolled up;
  // after loading older messages keep the viewport where it was.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restoreScrollFrom.current != null) {
      el.scrollTop = el.scrollHeight - restoreScrollFrom.current;
      restoreScrollFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    const firstId = messages.find((m) => m.id != null)?.id;
    if (firstId == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(`?beforeId=${firstId}`);
      if (page) {
        restoreScrollFrom.current = listRef.current?.scrollHeight ?? null;
        setMessages((cur) => [...page.messages, ...cur]);
        setHasMore(page.hasMore);
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  const post = useCallback(
    async (clientId: string, body: string) => {
      try {
        const res = await fetchWithAuth(`${BASE}/${rungId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, clientId }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Send failed");
        const { message } = (await res.json()) as { message: Msg };
        setMessages((cur) => merge(cur, message));
      } catch {
        setMessages((cur) => cur.map((m) => (m.clientId === clientId ? { ...m, state: "failed" } : m)));
      }
    },
    [rungId],
  );

  const send = () => {
    const body = draft.trim();
    if (!body || body.length > MAX_LEN) return;
    const clientId = newClientId();
    stickToBottom.current = true;
    setMessages((cur) => [
      ...cur,
      {
        id: null,
        clientId,
        authorUserId: myId,
        authorName: currentUser?.name ?? "You",
        body,
        createdAt: new Date().toISOString(),
        state: "sending",
      },
    ]);
    setDraft("");
    void post(clientId, body);
  };

  const retry = (m: Msg) => {
    if (!m.clientId) return;
    setMessages((cur) => cur.map((x) => (x.clientId === m.clientId ? { ...x, state: "sending" } : x)));
    void post(m.clientId, m.body);
  };

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
        <Lock size={20} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground max-w-sm">{denied}</p>
      </div>
    );
  }

  let lastDay = "";
  return (
    <div className="flex flex-col h-[22rem]">
      <div className="flex items-center justify-between pb-2 text-[0.6875rem] text-muted-foreground">
        <span>Only allocated engineers and approvers can see this thread.</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full", live ? "bg-emerald-500" : "bg-amber-500")} />
          {live ? "Live" : "Reconnecting…"}
        </span>
      </div>

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto rounded-xl border border-border bg-muted/10 p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="text-[0.6875rem] text-primary hover:underline disabled:opacity-60"
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}
            {messages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-10">No messages yet — start the conversation.</p>
            )}
            {messages.map((m) => {
              const mine = m.authorUserId === myId;
              const label = dayLabel(m.createdAt);
              const showDay = label !== lastDay;
              lastDay = label;
              return (
                <React.Fragment key={m.id ?? m.clientId}>
                  {showDay && (
                    <div className="flex justify-center py-1">
                      <span className="text-[0.625rem] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{label}</span>
                    </div>
                  )}
                  <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm",
                        mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card border border-border rounded-bl-sm",
                        m.state === "sending" && "opacity-60",
                      )}
                    >
                      {!mine && <p className="text-[0.6875rem] font-semibold text-primary mb-0.5">{m.authorName}</p>}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={cn("mt-0.5 text-[0.625rem] flex items-center justify-end gap-1.5", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {m.state === "failed" ? (
                          <button type="button" onClick={() => retry(m)} className="inline-flex items-center gap-1 text-red-200 hover:underline">
                            <AlertCircle size={10} /> Not sent — retry <RotateCcw size={10} />
                          </button>
                        ) : m.state === "sending" ? (
                          "Sending…"
                        ) : (
                          fmtTime(m.createdAt)
                        )}
                      </p>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      <div className="pt-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={MAX_LEN}
          placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          className="h-10 w-10 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
          title="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
