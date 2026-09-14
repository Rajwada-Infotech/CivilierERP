import { useEffect, useState } from "react";
import { X, Clock, ChevronRight, Loader2, AlertCircle, History } from "lucide-react";
import { fetchAuditLog, AuditEntry } from "@/api/auditLogApi";

// ── Props ─────────────────────────────────────────────────────────────────────
interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  module: string;
  recordId: number | null;
  recordNo?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const ACTION_STYLES: Record<string, { dot: string; pill: string }> = {
  Created: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  },
  Updated: {
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20",
  },
  StepUpdate: {
    dot: "bg-violet-500",
    pill: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20",
  },
  Escalated: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20",
  },
  Deleted: {
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-red-500/20",
  },
};

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLES[action] ?? {
    dot: "bg-muted-foreground",
    pill: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.pill}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {action}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function AuditLogDrawer({
  open,
  onClose,
  module,
  recordId,
  recordNo,
}: AuditLogDrawerProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !recordId) return;
    setLoading(true);
    setError(null);
    fetchAuditLog(module, recordId)
      .then(setEntries)
      .catch((e) => setError(e.message ?? "Failed to load history"))
      .finally(() => setLoading(false));
  }, [open, module, recordId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[420px] max-w-[95vw] bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <History size={14} className="text-primary" />
            </div>
            <div>
              <h2 className="text-[13px] font-bold text-foreground leading-tight">
                Change History
              </h2>
              {recordNo && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {recordNo}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2 m-4 p-3 rounded-xl bg-red-500/8 text-red-600 dark:text-red-400 text-sm border border-red-500/15">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="p-3 rounded-2xl bg-muted/60 mb-3">
                <Clock size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">No history yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Changes to this record will appear here.
              </p>
            </div>
          )}

          {!loading && !error && entries.length > 0 && (
            <div className="px-4 py-3 space-y-0">
              {/* Timeline */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[19px] top-5 bottom-4 w-px bg-border" />

                {entries.map((entry, idx) => (
                  <div key={entry.Id} className="relative flex gap-3 pb-4">
                    {/* Dot */}
                    <div className="flex-shrink-0 w-10 flex justify-center pt-0.5">
                      <div
                        className={`w-2.5 h-2.5 rounded-full mt-1 ring-2 ring-card z-10 ${
                          ACTION_STYLES[entry.Action]?.dot ?? "bg-muted-foreground"
                        }`}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 bg-muted/30 rounded-xl p-3 border border-border/50">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <ActionBadge action={entry.Action} />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                          {fmtDateTime(entry.ChangedAt)}
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground mb-2">
                        by{" "}
                        <span className="font-semibold text-foreground">
                          {entry.ChangedBy}
                        </span>
                      </p>

                      {/* Field changes */}
                      {entry.Changes && entry.Changes.length > 0 && (
                        <div className="space-y-1">
                          {entry.Changes.map((c, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1.5 text-[11px] flex-wrap"
                            >
                              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                {c.field}
                              </span>
                              {c.oldValue !== null && c.oldValue !== undefined && (
                                <>
                                  <span className="text-red-500/80 line-through max-w-[100px] truncate">
                                    {String(c.oldValue)}
                                  </span>
                                  <ChevronRight size={10} className="text-muted-foreground flex-shrink-0" />
                                </>
                              )}
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium max-w-[100px] truncate">
                                {c.newValue !== null && c.newValue !== undefined
                                  ? String(c.newValue)
                                  : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && entries.length > 0 && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center">
              {entries.length} event{entries.length !== 1 ? "s" : ""} recorded
            </p>
          </div>
        )}
      </div>
    </>
  );
}