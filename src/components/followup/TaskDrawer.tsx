import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Send } from "lucide-react";
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

const API = "/api/task-master";

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
  CreatedByName: string | null;
}

interface FollowUp {
  Id: number;
  Note: string;
  NextReminderAt: string | null;
  CreatedByName: string | null;
  CreatedAt: string;
  Attachments: Attachment[];
}

interface Attachment {
  Id: number;
  FileName: string;
  MimeType: string | null;
  FileSize: number | null;
  UploadedAt: string;
}

interface ChatMessage {
  Id: number;
  Message: string;
  SenderName: string | null;
  CreatedAt: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const TaskDrawer: React.FC<TaskDrawerProps> = ({ taskId, onClose, onStatusChange }) => {
  const queryClient = useQueryClient();

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
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setNote("");
    setNextReminder("");
    setPendingFiles([]);
    setChatText("");
  }, [taskId]);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages.length]);

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
      await Promise.all([invalidateFollowUps(), invalidateFiles()]);
    } catch (err: any) {
      toast.error(err.message || "Failed to save follow-up");
    } finally {
      setSubmitting(false);
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

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col p-0 gap-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-5 py-4 pr-12 border-b border-border text-left space-y-2">
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
              {task?.TaskNo || "…"}
            </p>
            <SheetTitle className="truncate">{task?.Subject || "Task"}</SheetTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {task?.Status && <StatusBadge status={task.Status} />}
            {task?.Priority && <StatusBadge status={task.Priority} />}
            {task?.CaseProjectName && (
              <span className="text-xs text-muted-foreground">{task.CaseProjectName}</span>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 w-fit">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="followups">Follow-Ups</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          {/* ── Details ── */}
          <TabsContent value="details" className="overflow-y-auto max-h-[50vh] px-5 py-4 space-y-3 mt-0">
            <DetailRow label="Subject" value={task?.Subject} />
            <DetailRow label="Details" value={task?.Details} />
            <DetailRow label="Department" value={task?.Department} />
            <DetailRow label="Due Date" value={task?.DueDate ? String(task.DueDate).slice(0, 10) : ""} />
            <DetailRow label="Case Number" value={task?.CaseNumber} />
            <DetailRow label="Company" value={task?.CaseCompanyName} />
            <DetailRow label="Project" value={task?.CaseProjectName} />
            <DetailRow label="Created By" value={task?.CreatedByName} />

            {task?.Status !== "Closed" && task?.Status !== "Cancel" && (
              <div className="pt-3 flex flex-wrap gap-2">
                {task?.Status === "Active" ? (
                  <button
                    type="button"
                    onClick={() => onStatusChange(taskId, "Hold")}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Put on Hold
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStatusChange(taskId, "Active")}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStatusChange(taskId, "Closed")}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors"
                >
                  Close Task
                </button>
              </div>
            )}
          </TabsContent>

          {/* ── Follow-Ups ── */}
          <TabsContent value="followups" className="flex-1 flex flex-col min-h-0 mt-0">
            <div className="overflow-y-auto max-h-[45vh] px-5 py-4">
              {followUps.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">No follow-ups yet.</p>
              )}
              {followUps.map((f, i) => (
                <div key={f.Id} className="relative pl-6 pb-5">
                  {i < followUps.length - 1 && (
                    <span className="absolute left-[5px] top-3 bottom-0 w-px bg-border" />
                  )}
                  <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
                  <p className="text-sm text-foreground whitespace-pre-wrap">{f.Note}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-[11px] text-muted-foreground">
                      {f.CreatedByName || "—"} · {formatDateTime(f.CreatedAt)}
                    </span>
                    {f.NextReminderAt && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/25">
                        Reminder {formatDateTime(f.NextReminderAt)}
                      </span>
                    )}
                  </div>
                  {f.Attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {f.Attachments.map((a) => (
                        <a
                          key={a.Id}
                          href={`${API}/attachment/${a.Id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          <Paperclip size={11} /> {a.FileName}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <FollowUpComposer
              note={note}
              setNote={setNote}
              nextReminder={nextReminder}
              setNextReminder={setNextReminder}
              pendingFiles={pendingFiles}
              setPendingFiles={setPendingFiles}
              fileInputRef={fileInputRef}
              submitting={submitting}
              onSave={handleSaveFollowUp}
            />
          </TabsContent>

          {/* ── Chat ── */}
          <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">No messages yet.</p>
              )}
              {chatMessages.map((m) => (
                <div key={m.Id}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-foreground">{m.SenderName || "Unknown"}</span>
                    <span className="text-[10px] text-muted-foreground">{formatDateTime(m.CreatedAt)}</span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{m.Message}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-border p-3 flex items-center gap-2">
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
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleSendChat}
                disabled={sendingChat || !chatText.trim()}
                className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
              >
                <Send size={15} />
              </button>
            </div>
          </TabsContent>

          {/* ── Files ── */}
          <TabsContent value="files" className="overflow-y-auto max-h-[50vh] px-5 py-4 mt-0">
            {files.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">No files yet.</p>
            )}
            <div className="space-y-2">
              {files.map((f) => (
                <a
                  key={f.Id}
                  href={`${API}/attachment/${f.Id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
                >
                  <Paperclip size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate">{f.FileName}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                    {formatDateTime(f.UploadedAt)}
                  </span>
                </a>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Follow-up composer stays visible under the Follow-Ups tab only */}
        <FollowUpComposer
          note={note}
          setNote={setNote}
          nextReminder={nextReminder}
          setNextReminder={setNextReminder}
          pendingFiles={pendingFiles}
          setPendingFiles={setPendingFiles}
          fileInputRef={fileInputRef}
          submitting={submitting}
          onSave={handleSaveFollowUp}
        />
      </SheetContent>
    </Sheet>
  );
};

const DetailRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) =>
  value ? (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  ) : null;

const FollowUpComposer: React.FC<{
  note: string;
  setNote: (v: string) => void;
  nextReminder: string;
  setNextReminder: (v: string) => void;
  pendingFiles: File[];
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  submitting: boolean;
  onSave: () => void;
}> = ({ note, setNote, nextReminder, setNextReminder, pendingFiles, setPendingFiles, fileInputRef, submitting, onSave }) => (
  <div className="border-t border-border p-4 space-y-2 shrink-0">
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">New Follow Up</p>
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      placeholder="What happened?"
      rows={2}
      className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-none"
    />
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        value={nextReminder}
        onChange={(e) => setNextReminder(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
        onClick={onSave}
        disabled={submitting || !note.trim()}
        className="ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
      >
        Save
      </button>
    </div>
  </div>
);
