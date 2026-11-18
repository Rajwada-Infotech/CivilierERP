import React, { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, Plus, MessageSquare, CheckCircle2, Clock, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { API, authHeaders, fetchTickets, TICKET_CATEGORIES, fmtDate } from "./portalApi";
import {
  HeroStrip, UrgencyBanner,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
  INK, GOLD, GOLD_SOFT, HAIRLINE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT, serif,
} from "./portalTheme";

const FILTERS = ["All", "Open", "Resolved"] as const;

// Status dot styling
function statusStyle(status: string): { bg: string; fg: string; dot: string } {
  if (status === "Resolved" || status === "Closed") return { bg: "rgba(5,150,105,0.08)", fg: "#065F46", dot: "#059669" };
  if (status === "Open" || status === "New") return { bg: "rgba(201,162,39,0.10)", fg: "#7A5C0A", dot: GOLD };
  if (status === "InProgress") return { bg: "rgba(76,29,149,0.08)", fg: "var(--portal-violet)", dot: "var(--portal-violet-light)" };
  return { bg: GOLD_SOFT, fg: TEXT_MUTED, dot: TEXT_FAINT };
}

function statusLabel(status: string): string {
  if (status === "Resolved" || status === "Closed") return "Resolved ✓";
  if (status === "InProgress") return "In progress";
  if (status === "New") return "Open";
  return status;
}

// Individual ticket card
function TicketCard({ t }: { t: any }) {
  const [expanded, setExpanded] = useState(false);
  const st = statusStyle(t.Status);
  const isResolved = t.Status === "Resolved" || t.Status === "Closed";

  return (
    <div
      className="relative rounded-2xl overflow-hidden transition-all"
      style={{
        background: "var(--portal-surface)",
        border: `1px solid var(--portal-hairline)`,
        boxShadow: "0 1px 3px rgba(30,11,66,0.07)",
      }}
    >
      {/* Left status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: st.dot }}
      />

      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full text-left px-5 py-4 pl-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: st.dot }} />
              <span
                className="text-[0.625rem] font-semibold uppercase tracking-wide"
                style={{ color: st.fg }}
              >
                {statusLabel(t.Status)}
              </span>
              <span className="text-[0.625rem]" style={{ color: TEXT_FAINT }}>· {t.TicketNo}</span>
            </div>
            <p className="text-sm font-semibold" style={{ color: TEXT }}>{t.Subject}</p>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: TEXT_FAINT }}>
              {t.Category.replace(/([A-Z])/g, " $1").trim()} · {fmtDate(t.CreatedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isResolved
              ? <CheckCircle2 size={16} style={{ color: "#059669" }} />
              : t.Status === "InProgress"
              ? <Clock size={16} style={{ color: "var(--portal-violet-light)" }} />
              : <Circle size={16} style={{ color: GOLD }} />
            }
            {expanded ? <ChevronUp size={15} style={{ color: TEXT_FAINT }} /> : <ChevronDown size={15} style={{ color: TEXT_FAINT }} />}
          </div>
        </div>
      </button>

      {expanded && t.ResolutionNotes && (
        <div className="px-6 pb-4 pt-0">
          <div
            className="rounded-xl p-3.5 text-sm"
            style={{ background: SURFACE_ALT, borderLeft: `3px solid ${st.dot}` }}
          >
            <p className="text-[0.625rem] font-semibold uppercase tracking-wide mb-1" style={{ color: st.fg }}>Resolution</p>
            <p style={{ color: TEXT_MUTED }}>{t.ResolutionNotes}</p>
          </div>
        </div>
      )}
      {expanded && !t.ResolutionNotes && (
        <div className="px-6 pb-4">
          <p className="text-xs" style={{ color: TEXT_FAINT }}>
            {isResolved ? "No resolution notes provided." : "Our team is working on this — we'll update you here."}
          </p>
        </div>
      )}
    </div>
  );
}

const PortalTickets: React.FC = () => {
  const qc = useQueryClient();
  const { applicationId } = useOutletContext<{ me: any; timeline: any; applicationId: number; applications: any[] }>();
  const { data: tickets = [], isLoading } = useQuery({ queryKey: ["portal-tickets", applicationId], queryFn: () => fetchTickets(applicationId) });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [form, setForm] = useState({ category: "ServiceRequest", subject: "", description: "" });
  const [saving, setSaving] = useState(false);

  const list = tickets as any[];
  const openCount = list.filter((t) => t.Status !== "Resolved" && t.Status !== "Closed").length;
  const resolvedCount = list.filter((t) => t.Status === "Resolved" || t.Status === "Closed").length;

  const filtered = useMemo(() => {
    if (filter === "Open") return list.filter((t) => t.Status !== "Resolved" && t.Status !== "Closed");
    if (filter === "Resolved") return list.filter((t) => t.Status === "Resolved" || t.Status === "Closed");
    return list;
  }, [tickets, filter]);

  const handleSubmit = async () => {
    if (!form.subject.trim()) { toast.error("Subject is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/tickets?applicationId=${applicationId}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.TicketNo} raised — we'll be in touch`);
      setDialogOpen(false);
      setForm({ category: "ServiceRequest", subject: "", description: "" });
      qc.invalidateQueries({ queryKey: ["portal-tickets", applicationId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Premium hero */}
      <HeroStrip
        eyebrow="Support"
        title="Support Centre"
        subtitle="Raise a request and track it right through to resolution."
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Total</p>
            <p className="text-xl font-semibold text-white tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>{list.length}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(201,162,39,0.18)", border: "1px solid rgba(201,162,39,0.4)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(201,162,39,0.9)" }}>Open</p>
            <p className="text-xl font-semibold text-white tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>{openCount}</p>
          </div>
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(5,150,105,0.18)", border: "1px solid rgba(5,150,105,0.4)" }}>
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(110,230,180,0.9)" }}>Resolved</p>
            <p className="text-xl font-semibold text-white tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>{resolvedCount}</p>
          </div>
        </div>
      </HeroStrip>

      {/* Big CTA + filter row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all"
              style={filter === f
                ? { background: INK, color: "#fff", boxShadow: "0 2px 8px rgba(30,11,66,0.25)" }
                : { background: GOLD_SOFT, color: "#8A6D14" }
              }
            >
              {f}
              {f === "Open" && openCount > 0 && <span className="ml-1.5 w-4 h-4 inline-flex items-center justify-center rounded-full text-[0.5625rem] font-bold" style={{ background: GOLD, color: INK }}>{openCount}</span>}
            </button>
          ))}
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl shadow-md hover:shadow-lg hover:opacity-90 transition-all active:scale-[0.98] shrink-0"
          style={{ background: `linear-gradient(135deg, var(--portal-ink), var(--portal-violet-deep))` }}
        >
          <Plus size={15} /> Raise a Ticket
        </button>
      </div>

      {/* Ticket list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl h-20 animate-pulse" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)` }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-12 flex flex-col items-center gap-4" style={{ background: "var(--portal-surface)", border: `1px solid var(--portal-hairline)` }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: GOLD_SOFT }}>
            <LifeBuoy size={28} style={{ color: GOLD }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: TEXT }}>
              {list.length === 0 ? "No tickets yet" : `No ${filter.toLowerCase()} tickets`}
            </p>
            <p className="text-sm mt-1 max-w-xs" style={{ color: TEXT_MUTED }}>
              {list.length === 0
                ? "Have a question or issue? Raise a ticket — our team typically responds within 24 hours."
                : `Switch to 'All' to see your ${list.length} ticket${list.length > 1 ? "s" : ""}.`
              }
            </p>
            {list.length === 0 && (
              <button
                onClick={() => setDialogOpen(true)}
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl"
                style={{ background: `linear-gradient(135deg, var(--portal-ink), var(--portal-violet-deep))` }}
              >
                <Plus size={15} /> Raise your first ticket
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => <TicketCard key={t.Id} t={t} />)}
        </div>
      )}

      {/* Raise ticket dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Raise a Support Ticket</DialogTitle>
            <DialogDescription>Tell us what's going on — your team will follow up within 24 hours.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: TEXT_MUTED }}>Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full text-sm rounded-xl px-3 py-2.5 outline-none"
                style={{ border: `1px solid ${HAIRLINE}`, background: SURFACE_ALT, color: TEXT }}
              >
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/([A-Z])/g, " $1").trim()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: TEXT_MUTED }}>Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Brief description of your request"
                className="w-full text-sm rounded-xl px-3 py-2.5 outline-none"
                style={{ border: `1px solid ${HAIRLINE}`, background: SURFACE_ALT, color: TEXT }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: TEXT_MUTED }}>Details <span style={{ color: TEXT_FAINT, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Any extra context that would help us…"
                className="w-full text-sm rounded-xl px-3 py-2.5 resize-none outline-none"
                style={{ border: `1px solid ${HAIRLINE}`, background: SURFACE_ALT, color: TEXT }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="px-4 py-2 text-sm rounded-xl hover:opacity-80"
              style={{ border: `1px solid ${HAIRLINE}`, color: TEXT_MUTED }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2 text-sm text-white rounded-xl font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: `linear-gradient(135deg, var(--portal-ink), var(--portal-violet-deep))` }}
            >
              <span className="flex items-center gap-2">
                <MessageSquare size={14} />
                {saving ? "Submitting…" : "Submit Ticket"}
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalTickets;
