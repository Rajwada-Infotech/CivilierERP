import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  User,
  X,
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
  attachment_path?: string | null;
}

type StatusFilter = "Open" | "Pending" | "InProgress" | "Resolved" | "Closed" | "All";

const STATUS_TABS: StatusFilter[] = [
  "Open",
  "Pending",
  "InProgress",
  "Resolved",
  "Closed",
  "All",
];

const STATUS_LABELS: Record<StatusFilter, string> = {
  Open: "Open",
  Pending: "Pending",
  InProgress: "In Progress",
  Resolved: "Resolved",
  Closed: "Closed",
  All: "All",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

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

const priorityConfig: Record<string, { cls: string; dot: string }> = {
  Urgent: {
    cls: "bg-red-500/10 text-red-600 border-red-400/20",
    dot: "bg-red-500",
  },
  High: {
    cls: "bg-orange-500/10 text-orange-600 border-orange-400/20",
    dot: "bg-orange-500",
  },
  Medium: {
    cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",
    dot: "bg-amber-500",
  },
  Low: {
    cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",
    dot: "bg-blue-500",
  },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? {
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
    Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
    InProgress: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  };
  const Icon = status === "Resolved" ? CheckCircle2 : Clock;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}
    >
      <Icon size={10} />
      {status}
    </span>
  );
}

function AuthenticatedAttachmentImage({
  url,
  alt,
  className,
  onClick,
}: {
  url: string;
  alt: string;
  className: string;
  onClick: () => void;
}) {
  const [src, setSrc] = useState(url.startsWith("data:") ? url : "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url.startsWith("data:")) {
      setSrc(url);
      setFailed(false);
      return;
    }

    let alive = true;
    const cachedSrc = attachmentBlobUrlCache.get(url);
    if (cachedSrc) {
      setSrc(cachedSrc);
      setFailed(false);
      return () => {
        alive = false;
      };
    }

    setSrc("");
    setFailed(false);

    fetchWithAuth(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        attachmentBlobUrlCache.set(url, objectUrl);
        registerAttachmentCacheCleanup();
        setSrc(objectUrl);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [url]);

  if (failed) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="h-24 min-w-24 rounded-lg border border-border bg-muted px-3 text-[11px] text-muted-foreground hover:bg-muted/80"
      >
        Preview unavailable
      </button>
    );
  }

  if (!src) {
    return (
      <div className="h-24 min-w-24 rounded-lg border border-border bg-muted animate-pulse" />
    );
  }

  return <img src={src} alt={alt} className={className} onClick={onClick} />;
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${priorityConfig[ticket.priority]?.dot ?? "bg-muted"}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-heading font-semibold text-foreground leading-snug">
                {ticket.subject}
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User size={10} />
                <span>{ticket.customer_name || "—"}</span>
              </div>
              {ticket.customer_phone && (
                <span className="text-[11px] text-muted-foreground">
                  {ticket.customer_phone}
                </span>
              )}
              {fmtDate(ticket.created_at) && (
                <span className="text-[11px] text-muted-foreground">
                  {fmtDate(ticket.created_at)}
                </span>
              )}
              <span className="text-[11px] font-mono text-muted-foreground/60">
                #{ticket.id}
              </span>
            </div>
            {ticket.issue_details && (
              <div className="mt-2">
                <p
                  className={`text-xs text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
                >
                  {ticket.issue_details}
                </p>
                {ticket.issue_details.length > 120 && (
                  <button
                    onClick={() => setExpanded((p) => !p)}
                    className="text-[11px] text-primary mt-0.5 hover:underline flex items-center gap-0.5"
                  >
                    {expanded ? "Show less" : "Show more"}
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
              </div>
            )}
            {ticket.attachment_path && (() => {
              let urls: string[] = [];
              try {
                const parsed = JSON.parse(ticket.attachment_path);
                urls = Array.isArray(parsed) ? parsed : [ticket.attachment_path];
              } catch {
                urls = [ticket.attachment_path];
              }

              const openViewer = (url: string, filename: string) => {
                const isPdf = url.toLowerCase().endsWith(".pdf");
                const isBase64 = url.startsWith("data:");

                const win = window.open();
                if (!win) return;

                // For base64 or public URLs — load directly into blob for download support
                const loadContent = async () => {
                  let blobUrl = url;
                  if (!isBase64) {
                    try {
                      const cachedBlobUrl = attachmentBlobUrlCache.get(url);
                      if (cachedBlobUrl) {
                        blobUrl = cachedBlobUrl;
                      } else {
                        const r = await fetchWithAuth(url);
                        if (!r.ok) throw new Error(`Attachment fetch failed: ${r.status}`);
                        const blob = await r.blob();
                        blobUrl = URL.createObjectURL(blob);
                        attachmentBlobUrlCache.set(url, blobUrl);
                        registerAttachmentCacheCleanup();
                      }
                    } catch {
                      win.document.body.innerHTML = "<p style=\"color:#ccc;font-family:sans-serif;padding:24px\">Unable to load attachment.</p>";
                      return;
                    }
                  }
                  const content = isPdf
                    ? `<iframe src="${blobUrl}" style="width:100%;height:90vh;border:none;border-radius:8px"></iframe>`
                    : `<img src="${blobUrl}" style="max-width:100%;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,.6)"/>`;
                  win.document.write(`<!DOCTYPE html><html><head><title>${filename}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#111;display:flex;flex-direction:column;align-items:center;min-height:100vh;font-family:sans-serif}header{width:100%;background:#1a1a1a;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;position:sticky;top:0;z-index:10}header span{color:#ccc;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%}a.dl{background:#6366f1;color:#fff;text-decoration:none;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;width:100%}</style></head><body><header><span>${filename}</span><a class="dl" href="${blobUrl}" download="${filename}">⬇ Download</a></header><main>${content}</main></body></html>`);
                  win.document.close();
                };
                loadContent();
              };

              return (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Paperclip size={10} />
                    {urls.length > 1 ? `${urls.length} Attachments` : "Attachment"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {urls.map((url, i) => {
                      const isPdf = url.toLowerCase().endsWith(".pdf");
                      const filename = url.split("/").pop() ?? `attachment-${i + 1}`;
                      if (isPdf) {
                        return (
                          <button
                            key={i}
                            onClick={() => openViewer(url, filename)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-primary hover:bg-muted transition-colors"
                          >
                            <Paperclip size={10} /> PDF {urls.length > 1 ? i + 1 : ""}
                          </button>
                        );
                      }
                      return (
                        <AuthenticatedAttachmentImage
                          key={i}
                          url={url}
                          alt={`Attachment ${i + 1}`}
                          className="h-24 w-auto rounded-lg border border-border object-cover cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary/40 transition-all"
                          onClick={() => openViewer(url, filename)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MyTickets page ───────────────────────────────────────────────────────────
// Shows only the logged-in user's own tickets. No resolve button — users cannot
// resolve tickets; only admin can.

const MyTickets: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const ADMIN_ROLES = ["super_admin", "admin", "dba"];
  const isAdmin = ADMIN_ROLES.includes(currentUser?.role ?? "");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const {
    data: allTickets = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<Ticket[]>({
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
  });

  useTicketSync(refetch);

  const tickets = useMemo(() => {
    let list = [...allTickets];
    if (statusFilter === "Open") {
      list = list.filter(
        (t) => t.status === "Pending" || t.status === "InProgress",
      );
    } else if (statusFilter !== "All") {
      list = list.filter((t) => t.status === statusFilter);
    }
    if (priorityFilter !== "all")
      list = list.filter((t) => t.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.customer_name?.toLowerCase().includes(q) ||
          t.issue_details?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allTickets, statusFilter, priorityFilter, search]);

  const openTickets = allTickets.filter(
    (t) => t.status === "Pending" || t.status === "InProgress",
  );
  const urgentCount = openTickets.filter((t) => t.priority === "Urgent").length;
  const tabCounts: Record<StatusFilter, number> = {
    Open: openTickets.length,
    Pending: allTickets.filter((t) => t.status === "Pending").length,
    InProgress: allTickets.filter((t) => t.status === "InProgress").length,
    Resolved: allTickets.filter((t) => t.status === "Resolved").length,
    Closed: allTickets.filter((t) => t.status === "Closed").length,
    All: allTickets.length,
  };
  const isFiltered =
    statusFilter !== "Open" || priorityFilter !== "all" || search.trim();

  return (
    <>
      <Breadcrumbs items={["Tickets", "My Tickets"]} />

      <div className="max-w-3xl mx-auto pb-10 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/ticket")}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              <ArrowLeft size={14} />
            </button>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                My Tickets
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {openTickets.length} open ticket{openTickets.length !== 1 ? "s" : ""}
                {allTickets.length !== openTickets.length && (
                  <span className="ml-1.5">- {allTickets.length} total</span>
                )}
                {urgentCount > 0 && (
                  <span className="text-red-500 ml-1.5 font-medium">
                    · {urgentCount} urgent
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/ticket/create")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus size={12} /> New
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>

        {/* Error */}
        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
          </div>
        )}

        {/* Status tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-all ${
                statusFilter === status
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {STATUS_LABELS[status]}
              <span className="ml-1 opacity-70">{tabCounts[status]}</span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-all ${
                  priorityFilter === p
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {p === "all" ? "All" : p}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-5 animate-pulse"
              >
                <div className="flex gap-3">
                  <div className="w-1 h-16 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 size={32} className="opacity-20" />
            <p className="text-sm">
              {isFiltered
                ? "No tickets match your filters"
                : "No open tickets"}
            </p>
            {!isFiltered && (
              <button
                onClick={() => navigate("/ticket/create")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-1"
              >
                <Plus size={12} /> Create first ticket
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <TicketCard key={t.id} ticket={t} />
            ))}
          </div>
        )}

        {!isLoading &&
          tickets.length > 0 &&
          isFiltered && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {tickets.length} of {allTickets.length} tickets
            </p>
          )}
      </div>
    </>
  );
};

export default MyTickets;
