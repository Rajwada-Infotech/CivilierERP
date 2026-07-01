// src/pages/followup/Communicator.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  MessageSquare,
  Phone,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  followupCommunicatorApi,
  Channel,
  CommunicatorLog,
} from "../../api/followupCommunicatorApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";

// ─── helpers ──────────────────────────────────────────────────────────────────

const CHANNEL_META: Record<
  Channel,
  {
    label: string;
    Icon: React.FC<any>;
    color: string;
    inputLabel: string;
    placeholder: string;
  }
> = {
  email: {
    label: "Email",
    Icon: Mail,
    color: "text-blue-500",
    inputLabel: "To (Email Address)",
    placeholder: "customer@example.com",
  },
  sms: {
    label: "SMS",
    Icon: Phone,
    color: "text-emerald-500",
    inputLabel: "To (Mobile Number)",
    placeholder: "9876543210",
  },
  whatsapp: {
    label: "WhatsApp",
    Icon: MessageSquare,
    color: "text-green-500",
    inputLabel: "To (WhatsApp Number)",
    placeholder: "9876543210",
  },
};

function StatusBadge({ status }: { status: string }) {
  if (status === "Sent")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
        <CheckCircle2 size={11} /> Sent
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">
      <XCircle size={11} /> Failed
    </span>
  );
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const m = CHANNEL_META[channel];
  if (!m)
    return <span className="text-xs text-muted-foreground">{channel}</span>;
  const { Icon, color, label } = m;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}
    >
      <Icon size={12} /> {label}
    </span>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export default function Communicator() {
  const qc = useQueryClient();

  const [channel, setChannel] = useState<Channel>("email");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [filterChannel, setFilterChannel] = useState<Channel | "">("");
  const [filterStatus, setFilterStatus] = useState<"Sent" | "Failed" | "">("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const meta = CHANNEL_META[channel];

  // ─── queries ────────────────────────────────────────────────────────────────

  const logsQuery = useQuery({
    queryKey: ["followup-comm-logs", filterChannel, filterStatus, page],
    queryFn: () =>
      followupCommunicatorApi.getLogs({
        channel: filterChannel || undefined,
        status: filterStatus || undefined,
        page,
        limit: 30,
      }),
  });

  // ─── mutations ──────────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: followupCommunicatorApi.send,
    onSuccess: () => {
      setRecipient("");
      setSubject("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["followup-comm-logs"] });
    },
  });

  const handleSend = () => {
    if (!recipient.trim() || !body.trim()) return;
    sendMutation.mutate({
      channel,
      recipient: recipient.trim(),
      subject: subject.trim() || undefined,
      body: body.trim(),
      sentBy: "User",
    });
  };

  const logs: CommunicatorLog[] = logsQuery.data?.data ?? [];

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={[{ label: "Follow-Up", path: "/followup" }, { label: "Agreement" }, { label: "Communicator" }]} />
      <FollowupShell
        title="Communicator"
        icon={MessageSquare}
        action={
          <button
            onClick={() => logsQuery.refetch()}
            disabled={logsQuery.isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={13} className={logsQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      >

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Compose panel (2 cols) ── */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 h-fit">
          <h2 className="text-base font-semibold text-foreground">
            Compose Message
          </h2>

          {/* Channel tabs */}
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => {
              const { label, Icon } = CHANNEL_META[ch];
              return (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md transition-all
                    ${
                      channel === ch
                        ? "bg-card shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  <Icon size={13} /> {label}
                </button>
              );
            })}
          </div>

          {/* Recipient */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {meta.inputLabel}
            </label>
            <input
              type={channel === "email" ? "email" : "tel"}
              placeholder={meta.placeholder}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground
                         placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
            />
          </div>

          {/* Subject — email only */}
          {channel === "email" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Subject
              </label>
              <input
                type="text"
                placeholder="Email subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground
                           placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
              />
            </div>
          )}

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Message
            </label>
            <textarea
              rows={channel === "email" ? 8 : 5}
              placeholder={
                channel === "email"
                  ? "HTML or plain text…"
                  : "Type your message…"
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground
                         placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
                         resize-none font-mono transition-colors"
            />
          </div>

          {/* Error */}
          {sendMutation.isError && (
            <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {(sendMutation.error as Error)?.message ??
                "Send failed. Check channel configuration."}
            </p>
          )}

          {/* Success */}
          {sendMutation.isSuccess && (
            <p className="text-xs text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Message sent successfully.
            </p>
          )}

          <button
            onClick={handleSend}
            disabled={
              !recipient.trim() || !body.trim() || sendMutation.isPending
            }
            className="w-full flex items-center justify-center gap-2 gradient-accent
                       disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-opacity"
          >
            <Send size={14} />
            {sendMutation.isPending ? "Sending…" : `Send ${meta.label}`}
          </button>
        </div>

        {/* ── Log panel (3 cols) ── */}
        <div className="lg:col-span-3 bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
          {/* Log header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">
              Sent Log
            </h2>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-muted-foreground" />

              <div className="relative">
                <select
                  value={filterChannel}
                  onChange={(e) => {
                    setFilterChannel(e.target.value as any);
                    setPage(1);
                  }}
                  className="appearance-none text-xs border border-border rounded-md pl-2 pr-6 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">All channels</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value as any);
                    setPage(1);
                  }}
                  className="appearance-none text-xs border border-border rounded-md pl-2 pr-6 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                >
                  <option value="">All statuses</option>
                  <option value="Sent">Sent</option>
                  <option value="Failed">Failed</option>
                </select>
                <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>

            </div>
          </div>

          {/* Log list */}
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {logsQuery.isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Clock size={18} className="animate-spin mr-2 opacity-50" />{" "}
                Loading…
              </div>
            )}

            {!logsQuery.isLoading && logs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Send size={32} className="mb-3 opacity-20" />
                <p className="text-sm">No messages sent yet</p>
              </div>
            )}

            {logs.map((log) => (
              <div
                key={log.Id}
                className="px-5 py-3 hover:bg-muted/30 transition-colors"
              >
                <div
                  className="flex items-start justify-between cursor-pointer group"
                  onClick={() =>
                    setExpandedId(expandedId === log.Id ? null : log.Id)
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ChannelBadge channel={log.Channel} />
                      <StatusBadge status={log.Status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.SentAt).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground mt-0.5 truncate">
                      {log.Subject ?? log.Recipient}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {log.Recipient}
                    </p>
                  </div>
                  <div className="ml-2 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
                    {expandedId === log.Id ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </div>
                </div>

                {expandedId === log.Id && (
                  <div className="mt-3 bg-muted/50 border border-border rounded-lg p-3 space-y-2">
                    {log.Subject && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Subject:
                        </span>{" "}
                        {log.Subject}
                      </p>
                    )}
                    <div
                      className="text-xs text-foreground leading-relaxed max-h-40 overflow-y-auto
                                    whitespace-pre-wrap border border-border rounded-md p-2 bg-background"
                    >
                      {log.Body.replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()}
                    </div>
                    {log.ErrorMessage && (
                      <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-md">
                        <span className="font-medium">Error:</span>{" "}
                        {log.ErrorMessage}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Sent by: {log.SentBy ?? "—"} · ID: {log.Id}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {logs.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
              <span>Page {page}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={logs.length < 30}
                  className="px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </FollowupShell>
    </>
  );
}