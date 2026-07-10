import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API, authHeaders, fetchTickets, TICKET_CATEGORIES, fmtDate } from "./portalApi";

const STATUS_STYLE: Record<string, string> = {
  Resolved: "bg-emerald-100 text-emerald-700",
  Closed: "bg-emerald-100 text-emerald-700",
  InProgress: "bg-sky-100 text-sky-700",
  Open: "bg-amber-100 text-amber-700",
};

const PortalTickets: React.FC = () => {
  const qc = useQueryClient();
  const { data: tickets = [], isLoading } = useQuery({ queryKey: ["portal-tickets"], queryFn: fetchTickets });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ category: "ServiceRequest", subject: "", description: "" });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.subject.trim()) { toast.error("Subject is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/tickets`, { method: "POST", headers: authHeaders(), body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.TicketNo} raised`);
      setDialogOpen(false);
      setForm({ category: "ServiceRequest", subject: "", description: "" });
      qc.invalidateQueries({ queryKey: ["portal-tickets"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-slate-800">Support</h1>
          <p className="text-sm text-slate-500 mt-0.5">Raise a request and track it through to resolution.</p>
        </div>
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700">
          <Plus size={14} /> Raise a Ticket
        </button>
      </div>

      <div className="rounded-2xl border border-violet-100 bg-white overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <LifeBuoy size={28} className="text-violet-200" />
            No support tickets yet — anything you raise will show up here.
          </div>
        ) : (tickets as any[]).map((t) => (
          <div key={t.Id} className="px-5 py-4 border-b border-violet-50 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{t.Subject}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.TicketNo} · {t.Category.replace(/([A-Z])/g, " $1").trim()} · {fmtDate(t.CreatedAt)}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold shrink-0 ${STATUS_STYLE[t.Status] || "bg-slate-100 text-slate-600"}`}>{t.Status}</span>
            </div>
            {t.ResolutionNotes && (
              <p className="text-xs text-slate-500 mt-2 bg-slate-50 rounded-lg p-2.5">Resolution: {t.ResolutionNotes}</p>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Raise a Ticket</DialogTitle></DialogHeader>
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
              className="px-4 py-1.5 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-40">
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalTickets;
