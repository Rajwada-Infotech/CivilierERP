import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Send, FileText, CalendarClock, Pause, Play, CheckCircle2, Trash2, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/task-master";
const TEAL = "#0d9488";

interface TaskDrawerProps {
  taskId: string | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}

interface TaskDetail {
  Id: number;
  TaskNo: string;
  Subject: string;
  Details: string | null;
  Department: string | null;
  DueDate: string | null;
  CaseNumber: string | null;
  Priority: string;
  Status: string;
  CaseCompanyName: string | null;
  CaseProjectName: string | null;
  AssigneeName: string | null;
  CreatedByName: string | null;
}

interface FollowUp {
  Id: number;
  Note: string;
  NextReminderAt: string | null;
  CreatedByName: string | null;
  CreatedAt: string;
  Attachments: Attachment[];
  IsDone: boolean;
  DoneAt: string | null;
  DoneByName: string | null;
}

interface Attachment {
  Id: number;
  FileName: string;
  MimeType: string | null;
  FileSize: number | null;
  UploadedBy: number | null;
  UploadedByName: string | null;
  UploadedAt: string;
}

interface ChatMessage {
  Id: number;
  Message: string;
  SenderId: number | null;
  SenderName: string | null;
  SenderAvatarUrl: string | null;
  CreatedAt: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Attachments are behind JWT auth, so a plain <a href> navigation can't carry
// the Authorization header (that's why it 404s/401s with "No token
// provided") — fetch it as an authenticated blob and open that instead.
async function openAttachment(id: number, fileName: string) {
  try {
    const res = await fetchWithAuth(`${API}/attachment/${id}`);
    if (!res.ok) throw new Error("Failed to load attachment");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      // Popup blocked — fall back to a same-tab download.
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    toast.error("Failed to open attachment");
  }
}

function initials(name: string | null): string {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const Avatar: React.FC<{ name: string | null; url?: string | null; size?: number }> = ({ name, url, size = 28 }) => {
  const px = `${size}px`;
  if (url) {
    return (
      <img
        src={url}
        alt={name || "User"}
        className="rounded-full object-cover shrink-0"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: px, height: px, fontSize: size * 0.36, background: "rgba(13,148,136,0.16)", color: TEAL }}
    >
      {initials(name)}
    </div>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2 py-4 text-left">
    <FileText size={13} className="text-muted-foreground shrink-0" />
    <p className="text-xs text-muted-foreground">{label}</p>
  </div>
);

export const TaskDrawer: React.FC<TaskDrawerProps> = ({ taskId, onClose, onStatusChange }) => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ? Number(currentUser.id) : null;

  // Standalone: the drawer fetches its own task record the moment a taskId
  // is plugged in — it never reads from Task Master's or the Follow-Up
  // board's list cache.
  const { data: task } = useQuery<TaskDetail>({
    queryKey: ["followup-task", taskId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${taskId}`);
      if (!res.ok) throw new Error("Failed to load task");
      return res.json();
    },
    enabled: !!taskId,
  });

  const { data: followUps = [] } = useQuery<FollowUp[]>({
    queryKey: ["task-followups", taskId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${taskId}/followups`);
      if (!res.ok) throw new Error("Failed to load follow-ups");
      return res.json().catch(() => []);
    },
    enabled: !!taskId,
  });

  const { data: chatMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: ["task-chat", taskId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${taskId}/chat`);
      if (!res.ok) throw new Error("Failed to load chat");
      return res.json().catch(() => []);
    },
    enabled: !!taskId,
  });

  const { data: files = [] } = useQuery<Attachment[]>({
    queryKey: ["task-attachments", taskId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/${taskId}/attachments`);
      if (!res.ok) throw new Error("Failed to load files");
      return res.json().catch(() => []);
    },
    enabled: !!taskId,
  });

  const [note, setNote] = React.useState("");
  const [nextReminder, setNextReminder] = React.useState("");
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [chatText, setChatText] = React.useState("");
  const [sendingChat, setSendingChat] = React.useState(false);
  const chatScrollRef = React.useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = React.useState("details");

  React.useEffect(() => {
    setNote("");
    setNextReminder("");
    setPendingFiles([]);
    setChatText("");
  }, [taskId]);

  // Jump to the latest message both when new ones arrive AND the moment the
  // Chat tab is opened — Radix keeps the panel mounted-but-hidden the rest
  // of the time, so message count alone doesn't fire when you just switch
  // tabs back to an already-loaded conversation.
  React.useEffect(() => {
    if (activeTab !== "chat" || !chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [activeTab, chatMessages.length]);

  // Live chat — the server broadcasts every new message over Socket.IO
  // (task:chat:new), so any open drawer for this task updates instantly
  // without polling.
  React.useEffect(() => {
    if (!taskId) return;
    const socket = getSocket();
    if (!socket) return;
    const handler = (payload: { taskId: number; message: ChatMessage }) => {
      if (String(payload.taskId) !== taskId) return;
      queryClient.setQueryData<ChatMessage[]>(["task-chat", taskId], (prev = []) =>
        prev.some((m) => m.Id === payload.message.Id) ? prev : [...prev, payload.message],
      );
    };
    socket.on("task:chat:new", handler);
    return () => {
      socket.off("task:chat:new", handler);
    };
  }, [taskId, queryClient]);

  if (!taskId) return null;

  const invalidateFollowUps = () =>
    queryClient.invalidateQueries({ queryKey: ["task-followups", taskId] });
  const invalidateFiles = () =>
    queryClient.invalidateQueries({ queryKey: ["task-attachments", taskId] });
  // The dashboard's "next upcoming follow-up" date is derived from these
  // rows server-side — bump it too so the board reflects the new/removed
  // reminder without waiting for its own staleTime to lapse.
  const invalidateBoard = () => queryClient.invalidateQueries({ queryKey: ["followup-board"] });

  const handleSaveFollowUp = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("Note", note.trim());
      if (nextReminder) form.append("NextReminderAt", nextReminder);
      pendingFiles.forEach((f) => form.append("files", f));
      const res = await fetchWithAuth(`${API}/${taskId}/followups`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save follow-up");
      toast.success("Follow-up added");
      setNote("");
      setNextReminder("");
      setPendingFiles([]);
      await Promise.all([invalidateFollowUps(), invalidateFiles(), invalidateBoard()]);
    } catch (err: any) {
      toast.error(err.message || "Failed to save follow-up");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkFollowUpDone = async (followUpId: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${taskId}/followups/${followUpId}/done`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to mark follow-up done");
      toast.success("Follow-up marked done");
      await Promise.all([invalidateFollowUps(), invalidateBoard()]);
    } catch (err: any) {
      toast.error(err.message || "Failed to mark follow-up done");
    }
  };

  const handleDeleteFollowUp = async (followUpId: number) => {
    if (!window.confirm("Delete this follow-up? This can't be undone.")) return;
    try {
      const res = await fetchWithAuth(`${API}/${taskId}/followups/${followUpId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete follow-up");
      toast.success("Follow-up deleted");
      await Promise.all([invalidateFollowUps(), invalidateFiles(), invalidateBoard()]);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete follow-up");
    }
  };

  const handleSendChat = async () => {
    if (!chatText.trim()) return;
    setSendingChat(true);
    try {
      const res = await fetchWithAuth(`${API}/${taskId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Message: chatText.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to send message");
      const body = await res.json().catch(() => ({}));
      setChatText("");
      // Belt-and-suspenders: the socket broadcast normally lands first, but
      // if it's not connected (e.g. socket still reconnecting) this still
      // shows the sender their own message immediately.
      if (body?.data) {
        queryClient.setQueryData<ChatMessage[]>(["task-chat", taskId], (prev = []) =>
          prev.some((m) => m.Id === body.data.Id) ? prev : [...prev, body.data],
        );
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
    } finally {
      setSendingChat(false);
    }
  };

  const canTransition = task?.Status !== "Closed" && task?.Status !== "Cancel";

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl h-full flex flex-col p-0 gap-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* ── Header ── */}
        <SheetHeader className="px-5 py-4 pr-12 border-b border-border text-left space-y-2 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
              {task?.TaskNo || "…"}
            </p>
            <SheetTitle className="truncate font-body">{task?.Subject || "Task"}</SheetTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {task?.Status && <StatusBadge status={task.Status} />}
            {task?.Priority && <StatusBadge status={task.Priority} />}
            {task?.CaseProjectName && (
              <span className="text-xs text-muted-foreground">{task.CaseProjectName}</span>
            )}
            {task?.AssigneeName && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Avatar name={task.AssigneeName} size={18} />
                {task.AssigneeName}
              </span>
            )}
          </div>
        </SheetHeader>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col" style={{ height: 0 }}>
          <TabsList className="mx-5 mt-3 w-fit shrink-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="followups">Follow-Ups</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          {/* ── Details ── */}
          <TabsContent value="details" className="flex-1 min-h-0 overflow-y-auto scrollbar-none mt-3" style={{ height: 0 }}>
            <div className="px-5 pb-5 space-y-4">
              {task?.Details && (
                <div
                  className="rounded-xl p-3.5 text-sm text-foreground leading-relaxed"
                  style={{ background: "rgba(13,148,136,0.06)", border: "1px solid rgba(13,148,136,0.15)" }}
                >
                  {task.Details}
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <DetailRow label="Department" value={task?.Department} />
                <DetailRow label="Due Date" value={task?.DueDate ? String(task.DueDate).slice(0, 10) : ""} />
                <DetailRow label="Case Number" value={task?.CaseNumber} mono />
                <DetailRow label="Assignee" value={task?.AssigneeName} />
                <DetailRow label="Company" value={task?.CaseCompanyName} />
                <DetailRow label="Project" value={task?.CaseProjectName} />
                <DetailRow label="Created By" value={task?.CreatedByName} />
              </div>

              {canTransition && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {task?.Status === "Active" ? (
                    <button
                      type="button"
                      onClick={() => onStatusChange(taskId, "Hold")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/25 hover:bg-amber-500/20 transition-colors"
                    >
                      <Pause size={12} /> Put on Hold
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStatusChange(taskId, "Active")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Play size={12} /> Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onStatusChange(taskId, "Closed")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-600 border border-red-500/25 hover:bg-red-500/20 transition-colors"
                  >
                    <CheckCircle2 size={12} /> Close Task
                  </button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Follow-Ups ── */}
          {/* TabsContent itself stays non-flex (Radix's hidden attribute vs.
              an unconditional .flex class fight each other otherwise — see
              the Chat panel history). The flex-column layout lives on this
              inner div instead, so the composer below is a plain sibling of
              the scroll area, never a `sticky` element stacking on top of it. */}
          <TabsContent value="followups" className="flex-1 min-h-0 mt-3" style={{ height: 0 }}>
            <div className="h-full flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto scrollbar-none px-5">
              {followUps.length === 0 && <EmptyState label="No follow-ups yet." />}
              {followUps.map((f, i) => {
                // Only the latest, not-yet-done follow-up is "current" — that's
                // the one a Done button makes sense on, mirroring the board's
                // NextFollowUpAt (which is sourced the same way).
                const isCurrent = !f.IsDone && i === followUps.length - 1;
                return (
                <div key={f.Id} className="relative pl-6 pb-5">
                  {i < followUps.length - 1 && (
                    <span className="absolute left-[5px] top-3 bottom-0 w-px" style={{ background: "rgba(13,148,136,0.25)" }} />
                  )}
                  <span
                    className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full"
                    style={
                      f.IsDone
                        ? { background: "#10b981", boxShadow: "0 0 0 3px rgba(16,185,129,0.15)" }
                        : { background: TEAL, boxShadow: `0 0 0 3px rgba(13,148,136,0.15)` }
                    }
                  />
                  <div className={`rounded-xl border p-3 ${f.IsDone ? "border-border/50 bg-muted/30" : "border-border/70 bg-card/50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm whitespace-pre-wrap flex-1 ${f.IsDone ? "text-muted-foreground" : "text-foreground"}`}>{f.Note}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleMarkFollowUpDone(f.Id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors"
                            title="Mark this follow-up as done"
                          >
                            <Check size={11} /> Done
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteFollowUp(f.Id)}
                          className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors"
                          title="Delete follow-up"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {f.CreatedByName || "—"} · {formatDateTime(f.CreatedAt)}
                      </span>
                      {f.NextReminderAt && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
                            f.IsDone
                              ? "bg-muted text-muted-foreground border-border/60 line-through"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/25"
                          }`}
                        >
                          <CalendarClock size={10} /> {formatDateTime(f.NextReminderAt)}
                        </span>
                      )}
                      {f.IsDone && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/25">
                          <Check size={10} /> Done{f.DoneByName ? ` · ${f.DoneByName}` : ""}
                        </span>
                      )}
                    </div>
                    {f.Attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {f.Attachments.map((a) => (
                          <button
                            key={a.Id}
                            type="button"
                            onClick={() => openAttachment(a.Id, a.FileName)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                            style={{ color: TEAL }}
                          >
                            <Paperclip size={11} /> {a.FileName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            {/* A plain sibling of the scroll area above, not `sticky` inside
                it — sticky-inside-scroll was overlapping the last entry. */}
            <div className="shrink-0 border-t border-border p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">New Follow Up</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened?"
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:ring-1 resize-none"
                style={{ ["--tw-ring-color" as any]: TEAL }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={nextReminder}
                  onChange={(e) => setNextReminder(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-muted border border-border focus:outline-none focus:ring-1"
                  title="Next reminder"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Paperclip size={12} /> Attach
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setPendingFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                />
                {pendingFiles.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">{pendingFiles.length} file(s) selected</span>
                )}
                <button
                  type="button"
                  onClick={handleSaveFollowUp}
                  disabled={submitting || !note.trim()}
                  className="ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity"
                  style={{ background: TEAL }}
                >
                  Save
                </button>
              </div>
            </div>
            </div>
          </TabsContent>

          {/* ── Chat ── */}
          <TabsContent value="chat" className="flex-1 min-h-0 mt-3" style={{ height: 0 }}>
            <div className="h-full flex flex-col min-h-0">
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto scrollbar-none px-5 pb-4 pt-1 space-y-3"
              style={{
                backgroundImage:
                  "radial-gradient(rgba(13,148,136,0.05) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
            >
              {chatMessages.length === 0 && <EmptyState label="No messages yet." />}
              {chatMessages.map((m, i) => {
                const isOwn = currentUserId != null && m.SenderId === currentUserId;
                // Group consecutive messages from the same sender — only the
                // first in a run shows the name/avatar, WhatsApp-style.
                const prev = chatMessages[i - 1];
                const showSender = !prev || prev.SenderId !== m.SenderId;
                return (
                  <div key={m.Id} className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                    <div className="w-7 shrink-0">
                      {!isOwn && showSender && <Avatar name={m.SenderName} url={m.SenderAvatarUrl} size={26} />}
                    </div>
                    <div className={`min-w-0 max-w-[75%] flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                      {!isOwn && showSender && (
                        <span className="text-[11px] font-semibold px-1 mb-0.5" style={{ color: TEAL }}>
                          {m.SenderName || "Unknown"}
                        </span>
                      )}
                      <div
                        className={`px-3 py-1.5 text-sm whitespace-pre-wrap break-words shadow-sm ${
                          isOwn
                            ? "rounded-2xl rounded-br-sm text-white"
                            : "rounded-2xl rounded-bl-sm text-foreground border border-border/60"
                        }`}
                        style={isOwn ? { background: TEAL } : { background: "var(--card)" }}
                      >
                        {m.Message}
                        <span className={`block text-[10px] mt-0.5 text-right ${isOwn ? "text-white/70" : "text-muted-foreground"}`}>
                          {formatDateTime(m.CreatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-border p-3 flex items-center gap-2">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                placeholder="Message…"
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:ring-1"
              />
              <button
                type="button"
                onClick={handleSendChat}
                disabled={sendingChat || !chatText.trim()}
                className="p-2 rounded-lg text-white disabled:opacity-40 transition-opacity shrink-0"
                style={{ background: TEAL }}
              >
                <Send size={15} />
              </button>
            </div>
            </div>
          </TabsContent>

          {/* ── Files ── */}
          <TabsContent value="files" className="flex-1 min-h-0 overflow-y-auto scrollbar-none mt-3" style={{ height: 0 }}>
            <div className="px-5 pb-5">
              {files.length === 0 && <EmptyState label="No files yet." />}
              <div className="space-y-2">
                {[...files]
                  .sort((a, b) => new Date(b.UploadedAt).getTime() - new Date(a.UploadedAt).getTime())
                  .map((f) => (
                    <button
                      key={f.Id}
                      type="button"
                      onClick={() => openAttachment(f.Id, f.FileName)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/70 bg-card/50 hover:border-teal-500/40 hover:bg-card transition-colors text-sm text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "rgba(13,148,136,0.12)" }}
                      >
                        <Paperclip size={14} style={{ color: TEAL }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{f.FileName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {f.UploadedByName || "Unknown"} · {formatDateTime(f.UploadedAt)}
                        </p>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

const DetailRow: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) =>
  value ? (
    <div>
      <p className="text-[9px] font-heading font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-xs font-semibold text-foreground mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  ) : null;
