import React, { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, Plus } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { API, authHeaders, fetchTickets, TICKET_CATEGORIES, fmtDate } from "./portalApi";
import {
  PageHeader, Card, StatusPill,
  PortalDialogContent as DialogContent, PortalDialogTitle as DialogTitle, PortalDialogDescription as DialogDescription,
  INK, GOLD, GOLD_SOFT, HAIRLINE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT,
} from "./portalTheme";

const FILTERS = ["All", "Open", "Resolved"] as const;

const PortalTickets: React.FC = () => {
  const qc = useQueryClient();
  const { applicationId } = useOutletContext<{ me: any; timeline: any; applicationId: number; applications: any[] }>();
  const { data: tickets = [], isLoading } = useQuery({ queryKey: ["portal-tickets", applicationId], queryFn: () => fetchTickets(applicationId) });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [form, setForm] = useState({ category: "ServiceRequest", subject: "", description: "" });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const list = tickets as any[];
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
      toast.success(`Ticket ${data.TicketNo} raised`);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader eyebrow="Support" title="Support" subtitle="Raise a request and track it through to resolution." />
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-white text-sm font-semibold rounded-lg h-fit" style={{ background: INK }}>
          <Plus size={14} /> Raise a Ticket
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={filter === f ? { background: INK, color: "#fff" } : { background: GOLD_SOFT, color: "#8A6D14" }}>
            {f}{f !== "All" ? ` (${(tickets as any[]).filter((t) => f === "Open" ? (t.Status !== "Resolved" && t.Status !== "Closed") : (t.Status === "Resolved" || t.Status === "Closed")).length})` : ` (${tickets.length})`}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: TEXT_FAINT }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm flex flex-col items-center gap-2" style={{ color: TEXT_MUTED }}>
            <LifeBuoy size={28} style={{ color: GOLD, opacity: 0.5 }} />
            {tickets.length === 0 ? "No support tickets yet — anything you raise will show up here." : `No ${filter.toLowerCase()} tickets.`}
          </div>
        ) : filtered.map((t) => (
          <div key={t.Id} className="px-5 py-4 border-b last:border-0" style={{ borderColor: HAIRLINE }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: TEXT }}>{t.Subject}</p>
                <p className="text-[11px] mt-0.5" style={{ color: TEXT_FAINT }}>{t.TicketNo} · {t.Category.replace(/([A-Z])/g, " $1").trim()} · {fmtDate(t.CreatedAt)}</p>
              </div>
              <StatusPill status={t.Status} />
            </div>
            {t.ResolutionNotes && (
              <p className="text-xs mt-2 rounded-lg p-2.5" style={{ color: TEXT_MUTED, background: SURFACE_ALT }}>Resolution: {t.ResolutionNotes}</p>
            )}
          </div>
        ))}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Raise a Ticket</DialogTitle>
            <DialogDescription>Tell us what's going on — your assigned team will follow up here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/([A-Z])/g, " $1").trim()}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Subject</label>
              <input type="text" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none" placeholder="Describe your request..." />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDialogOpen(false)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSubmit} disabled={saving}
              className="px-4 py-1.5 text-sm text-white rounded-lg font-medium disabled:opacity-40" style={{ background: INK }}>
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalTickets;
