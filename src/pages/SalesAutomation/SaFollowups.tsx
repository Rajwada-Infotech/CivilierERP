import React, { useMemo, useState } from "react";
import { fmtIstIso } from "@/lib/istTime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Phone, MapPin, Clock, AlertTriangle, Search } from "lucide-react";
import { LEAD_CLASSIFICATIONS } from "@/components/sa/leadStages";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { StatusBadge, getStatusClasses, getStatusLabel } from "@/components/StatusBadge";
import { LeadInteractionForm } from "@/components/sa/LeadInteractionForm";
import { useLeadActivityHistory } from "@/hooks/useLeadActivities";

const ACTIVITIES_API = "/api/sa/lead-activities";
const LEADS_API = "/api/sa/leads";
const VISITS_API = "/api/sa/site-visits";

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => new Date(new Date().toDateString()).getTime();
/** Whole days from today to the reminder (negative = overdue), or null. */
const dueIn = (d: unknown) => (d ? Math.round((new Date(String(d).slice(0, 10)).setHours(0, 0, 0, 0) - startOfToday()) / DAY) : null);
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const QUEUE_FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "new", label: "Never contacted" },
] as const;
type QueueFilter = (typeof QUEUE_FILTERS)[number]["key"];

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

const EMPTY_VISIT_FORM = { ProjectName: "", PreferredDate: "", PreferredTime: "", CustomerNotes: "" };

const SaFollowups: React.FC = () => {
  usePageRights("sa-followups");
  const qc = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [visitDialogOpen, setVisitDialogOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({ ...EMPTY_VISIT_FORM });
  const [schedulingVisit, setSchedulingVisit] = useState(false);

  const { data: pending = [], isLoading: loadingPending, isFetching, dataUpdatedAt, refetch } = useQuery({
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
      const days = dueIn(p.NextFollowupDate);
      rows.push({ ...p, days, overdue: days !== null && days < 0, hasReminder: true });
    }
    for (const l of untouched as any[]) {
      if (seen.has(l.Id)) continue;
      seen.add(l.Id);
      rows.push({ LeadId: l.Id, LeadUid: l.LeadUid, CustomerName: l.CustomerName, Mobile: l.Mobile, Status: l.Status, Classification: l.Classification, days: null, overdue: true, hasReminder: false });
    }
    // Never-contacted first, then most overdue, then soonest due.
    const rank = (r: any) => (r.hasReminder ? r.days ?? 0 : -100000);
    return rows.sort((a, b) => rank(a) - rank(b));
  }, [pending, untouched]);

  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const matches: Record<QueueFilter, (r: any) => boolean> = {
    all: () => true,
    overdue: (r) => r.hasReminder && r.days !== null && r.days < 0,
    today: (r) => r.hasReminder && r.days === 0,
    new: (r) => !r.hasReminder,
  };
  const q = search.trim().toLowerCase();
  const shownQueue = queue.filter((r) => matches[filter](r)
    && (!q || [r.CustomerName, r.Mobile, r.LeadUid].some((v) => String(v ?? "").toLowerCase().includes(q))));

  const selected = queue.find((q) => q.LeadId === selectedLeadId);

  const { data: history = [] } = useLeadActivityHistory(selectedLeadId);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["sa-pending-followups"] });
    qc.invalidateQueries({ queryKey: ["sa-untouched-followup-leads"] });
    qc.invalidateQueries({ queryKey: ["sa-leads"] });
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
      toast.success(`Marked as ${getStatusLabel(classification)}`);
      invalidateAll();
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    } finally {
      setSchedulingVisit(false);
    }
  };

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Follow-Up"]} title="Follow-Up"
      subtitle={`${queue.length} lead${queue.length === 1 ? "" : "s"} need a call — ${queue.filter(matches.overdue).length} overdue, ${queue.filter(matches.today).length} due today, ${queue.filter(matches.new).length} never contacted`}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:h-[calc(100vh-200px)]">
        <div className={`flex flex-col gap-2 min-h-0 ${selected ? "hidden lg:flex" : ""}`}>
          <div className="flex flex-wrap gap-1">
            {QUEUE_FILTERS.map((f) => {
              const n = queue.filter(matches[f.key]).length;
              return (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${filter === f.key ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  {f.label} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 bg-background">
            <Search size={13} className="text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile or lead ID"
              className="flex-1 bg-transparent text-xs outline-none" />
          </label>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 max-h-[70vh] lg:max-h-none">
            {loadingPending ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading…</div>
            ) : queue.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No follow-ups due — you're all caught up.</div>
            ) : shownQueue.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No leads match.</div>
            ) : shownQueue.map((r) => {
              const when = !r.hasReminder ? "Never contacted"
                : r.days === null ? "No date set"
                : r.days < 0 ? `${-r.days} day${r.days === -1 ? "" : "s"} overdue`
                : r.days === 0 ? "Due today" : r.days === 1 ? "Due tomorrow" : `Due ${fmtDay(r.NextFollowupDate)}`;
              const tone = !r.hasReminder || (r.days ?? 0) < 0 ? "text-red-600" : r.days === 0 ? "text-amber-600" : "text-muted-foreground";
              return (
                <button key={r.LeadId} onClick={() => setSelectedLeadId(r.LeadId)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedLeadId === r.LeadId ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.CustomerName}</span>
                    {r.Classification && <StatusBadge status={r.Classification} />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.LeadUid} · {r.Mobile}</div>
                  <div className={`text-xs flex items-center gap-1 mt-0.5 font-medium ${tone}`}>
                    {(!r.hasReminder || (r.days ?? 0) < 0) ? <AlertTriangle size={11} /> : <Clock size={11} />} {when}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto space-y-4">
          {!selected ? (
            <div className="hidden lg:flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border">
              <Phone size={18} className="opacity-50" />
              Pick a lead on the left to call, log the conversation and set the next reminder.
            </div>
          ) : (
            <>
              <button onClick={() => setSelectedLeadId(null)} className="lg:hidden inline-flex items-center gap-1 text-xs text-primary">
                ← Back to the list
              </button>
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selected.CustomerName}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{selected.LeadUid} · {selected.Mobile}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.Classification && <StatusBadge status={selected.Classification} />}
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
                  <label className="text-xs text-muted-foreground block mb-1.5">How interested are they?</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {LEAD_CLASSIFICATIONS.map((c) => (
                      <button key={c} onClick={() => handleSetInterest(c)}
                        className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                          selected.Classification === c ? getStatusClasses(c) + " border-transparent" : "border-border text-muted-foreground hover:bg-muted"
                        }`}>
                        {getStatusLabel(c)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Log Follow-Up</h3>
                <LeadInteractionForm leadId={selectedLeadId} variant="compact" submitLabel="Log Follow-Up" />
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
                      <span className="text-xs text-muted-foreground">{h.CreatedAt ? fmtIstIso(h.CreatedAt) : "—"}</span>
                    </div>
                    {h.Summary && <p className="text-xs text-muted-foreground mt-1">{h.Summary}</p>}
                    {h.NextFollowupDate && <p className="text-xs text-amber-600 mt-0.5">Next reminder: {fmtDay(h.NextFollowupDate)}</p>}
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
              <DateInput value={visitForm.PreferredDate} onChange={(e) => setVisitForm((f) => ({ ...f, PreferredDate: e.target.value }))}
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
              className="px-4 py-1.5 rounded-lg text-xs font-semibold btn-module text-white disabled:opacity-40 transition-colors">
              {schedulingVisit ? "Scheduling..." : "Schedule Visit"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaFollowups;
