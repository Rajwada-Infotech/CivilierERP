import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Phone, MapPin, Clock, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ACTIVITIES_API = "/api/sa/lead-activities";
const LEADS_API = "/api/sa/leads";
const VISITS_API = "/api/sa/site-visits";

const CLASSIFICATIONS = ["Hot", "Warm", "Cold", "NotInterested", "CallBackLater"];
const classColor = (c: string) => {
  if (c === "Hot") return "text-red-500 bg-red-500/10";
  if (c === "Warm") return "text-orange-500 bg-orange-500/10";
  if (c === "Cold") return "text-blue-500 bg-blue-500/10";
  return "text-muted-foreground bg-muted/30";
};

async function fetchPendingFollowups(): Promise<any[]> {
  const res = await fetchWithAuth(`${ACTIVITIES_API}/pending-followups`);
  if (!res.ok) throw new Error("Failed to fetch pending followups");
  return res.json().catch(() => []);
}
// Leads already in the FollowUp stage that have no activity logged yet at
// all (so they'd never appear in pending-followups, which only surfaces
// rows with a NextFollowupDate already set) — otherwise a lead could sit
// invisible in this stage forever with nothing prompting the first touch.
async function fetchUntouchedFollowupLeads(): Promise<any[]> {
  const res = await fetchWithAuth(LEADS_API);
  if (!res.ok) return [];
  const leads = await res.json().catch(() => []);
  // Only leads that have NEVER had any activity logged — once a follow-up
  // is logged, POST /lead-activities stamps LastActivityAt, and that lead
  // should drop out of this fallback (it'll resurface via pending-followups
  // once its NextFollowupDate is actually due, not before).
  return (leads as any[]).filter((l) => l.Status === "FollowUp" && !l.LastActivityAt);
}
async function fetchActivityHistory(leadId: number): Promise<any[]> {
  const res = await fetchWithAuth(`${ACTIVITIES_API}/lead/${leadId}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

const EMPTY_LOG_FORM = { ActivityType: "Call", Outcome: "", Summary: "", NextFollowupDate: "" };
const EMPTY_VISIT_FORM = { ProjectName: "", PreferredDate: "", PreferredTime: "", CustomerNotes: "" };

const SaFollowups: React.FC = () => {
  const qc = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [logForm, setLogForm] = useState({ ...EMPTY_LOG_FORM });
  const [saving, setSaving] = useState(false);
  const [visitDialogOpen, setVisitDialogOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({ ...EMPTY_VISIT_FORM });
  const [schedulingVisit, setSchedulingVisit] = useState(false);

  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ["sa-pending-followups"], queryFn: fetchPendingFollowups, staleTime: 30_000,
  });
  const { data: untouched = [] } = useQuery({
    queryKey: ["sa-untouched-followup-leads"], queryFn: fetchUntouchedFollowupLeads, staleTime: 30_000,
  });

  // Merge: pending (already has a reminder date) + untouched (never logged),
  // deduped by LeadId — a lead can only need attention once in this queue.
  const queue = useMemo(() => {
    const seen = new Set<number>();
    const rows: any[] = [];
    for (const p of pending as any[]) {
      if (seen.has(p.LeadId)) continue;
      seen.add(p.LeadId);
      const overdue = p.NextFollowupDate && new Date(p.NextFollowupDate) < new Date(new Date().toDateString());
      rows.push({ ...p, overdue, hasReminder: true });
    }
    for (const l of untouched as any[]) {
      if (seen.has(l.Id)) continue;
      seen.add(l.Id);
      rows.push({ LeadId: l.Id, LeadUid: l.LeadUid, CustomerName: l.CustomerName, Mobile: l.Mobile, Status: l.Status, Classification: l.Classification, overdue: true, hasReminder: false });
    }
    return rows.sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1));
  }, [pending, untouched]);

  const selected = queue.find((q) => q.LeadId === selectedLeadId);

  const { data: history = [] } = useQuery({
    queryKey: ["sa-followup-history", selectedLeadId],
    queryFn: () => fetchActivityHistory(selectedLeadId!),
    enabled: !!selectedLeadId,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["sa-pending-followups"] });
    qc.invalidateQueries({ queryKey: ["sa-untouched-followup-leads"] });
    qc.invalidateQueries({ queryKey: ["sa-followup-history", selectedLeadId] });
    qc.invalidateQueries({ queryKey: ["sa-leads"] });
  };

  const handleLogFollowup = async () => {
    if (!selectedLeadId) return;
    if (!logForm.Summary.trim()) { toast.error("Summary is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${ACTIVITIES_API}/lead/${selectedLeadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to log follow-up");
      toast.success(logForm.NextFollowupDate ? "Follow-up logged — next reminder set" : "Follow-up logged");
      setLogForm({ ...EMPTY_LOG_FORM });
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetInterest = async (classification: string) => {
    if (!selectedLeadId) return;
    try {
      const res = await fetchWithAuth(`${LEADS_API}/${selectedLeadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Classification: classification }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update interest");
      toast.success(`Marked as ${classification}`);
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleScheduleVisit = async () => {
    if (!selectedLeadId) return;
    setSchedulingVisit(true);
    try {
      const res = await fetchWithAuth(VISITS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          LeadId: selectedLeadId,
          ProjectName: visitForm.ProjectName || null,
          PreferredDate: visitForm.PreferredDate || null,
          PreferredTime: visitForm.PreferredTime || null,
          CustomerNotes: visitForm.CustomerNotes || null,
          Status: "Scheduled",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule visit");
      toast.success("Site visit scheduled — moved to Site Visits");
      setVisitDialogOpen(false);
      setVisitForm({ ...EMPTY_VISIT_FORM });
      invalidateAll();
      setSelectedLeadId(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSchedulingVisit(false);
    }
  };

  return (
    <SalesAutoShell title="Follow-Up" subtitle="Leads due for their next touch — reminders, interest, and the next step onward to a site visit">
      <div className="flex gap-4 h-[calc(100vh-200px)]">
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <div className="text-xs text-muted-foreground px-1">{queue.length} lead(s) need attention</div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {loadingPending ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : queue.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No follow-ups due — you're all caught up</div>
            ) : queue.map((q) => (
              <button key={q.LeadId} onClick={() => setSelectedLeadId(q.LeadId)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedLeadId === q.LeadId ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{q.CustomerName}</span>
                  {q.overdue && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{q.Mobile}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={10} />
                  {q.hasReminder ? (q.NextFollowupDate ? String(q.NextFollowupDate).slice(0, 10) : "—") : "Never followed up"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a lead to follow up</div>
          ) : (
            <>
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selected.CustomerName}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{selected.LeadUid} · {selected.Mobile}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.Classification && (
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${classColor(selected.Classification)}`}>{selected.Classification}</span>
                    )}
                    <a href={`tel:${selected.Mobile}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-colors">
                      <Phone size={12} /> Call
                    </a>
                    <button onClick={() => setVisitDialogOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors">
                      <MapPin size={12} /> Schedule Visit
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Interest Level</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {CLASSIFICATIONS.map((c) => (
                      <button key={c} onClick={() => handleSetInterest(c)}
                        className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                          selected.Classification === c ? classColor(c) + " border-transparent" : "border-border text-muted-foreground hover:bg-muted"
                        }`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Log Follow-Up</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Type</label>
                    <select value={logForm.ActivityType} onChange={(e) => setLogForm((f) => ({ ...f, ActivityType: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      {["Call", "WhatsApp", "Email", "Meeting", "Note", "SMS"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Next Reminder Date</label>
                    <input type="date" value={logForm.NextFollowupDate} onChange={(e) => setLogForm((f) => ({ ...f, NextFollowupDate: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Notes *</label>
                    <textarea value={logForm.Summary} onChange={(e) => setLogForm((f) => ({ ...f, Summary: e.target.value }))}
                      rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" placeholder="What was discussed, customer's response..." />
                  </div>
                </div>
                <button onClick={handleLogFollowup} disabled={saving}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-primary/90 transition-colors">
                  {saving ? "Logging..." : "Log Follow-Up"}
                </button>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">History ({history.length})</h3>
                </div>
                {history.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No follow-up activity logged yet</div>
                ) : (history as any[]).map((h) => (
                  <div key={h.Id} className="px-4 py-3 border-b border-border last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{h.ActivityType}</span>
                      <span className="text-xs text-muted-foreground">{h.CreatedAt ? String(h.CreatedAt).slice(0, 16).replace("T", " ") : "—"}</span>
                    </div>
                    {h.Summary && <p className="text-xs text-muted-foreground mt-1">{h.Summary}</p>}
                    {h.NextFollowupDate && <p className="text-xs text-amber-600 mt-0.5">Next reminder: {String(h.NextFollowupDate).slice(0, 10)}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={visitDialogOpen} onOpenChange={(o) => { if (!o) { setVisitDialogOpen(false); setVisitForm({ ...EMPTY_VISIT_FORM }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading text-base">Schedule Site Visit</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Project Name</label>
              <input type="text" value={visitForm.ProjectName} onChange={(e) => setVisitForm((f) => ({ ...f, ProjectName: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Preferred Date</label>
              <input type="date" value={visitForm.PreferredDate} onChange={(e) => setVisitForm((f) => ({ ...f, PreferredDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Preferred Time</label>
              <input type="time" value={visitForm.PreferredTime} onChange={(e) => setVisitForm((f) => ({ ...f, PreferredTime: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={visitForm.CustomerNotes} onChange={(e) => setVisitForm((f) => ({ ...f, CustomerNotes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={() => { setVisitDialogOpen(false); setVisitForm({ ...EMPTY_VISIT_FORM }); }}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleScheduleVisit} disabled={schedulingVisit}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {schedulingVisit ? "Scheduling..." : "Schedule Visit"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaFollowups;
