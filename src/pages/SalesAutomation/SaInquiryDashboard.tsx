import React, { useState, useMemo } from "react";
import { AutoInput } from "@/components/ui/date-input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { MapPin, Phone, Search } from "lucide-react";
import { StatusBadge, getStatusLabel } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEAD_CLASSIFICATIONS, LEAD_STAGES, LEAD_STATUS_KEYS } from "@/components/sa/leadStages";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const API = "/api/sa/inquiry";
const LEADS_API = "/api/sa/leads";
const VISITS_API = "/api/sa/site-visits";

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth(LEADS_API);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json().catch(() => ({}));
}
async function fetchLeadDetail(leadId: number): Promise<any> {
  const res = await fetchWithAuth(`${API}/lead/${leadId}`);
  if (!res.ok) throw new Error("Failed to fetch lead detail");
  return res.json().catch(() => ({}));
}
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${LEADS_API}/users`);
    if (!res.ok) return [];
    const data: { Id: number; Name: string; role: string }[] = await res.json();
    return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role.replace(/_/g, " ")})` }));
  } catch { return []; }
}

const OUTCOMES = ["Answered", "Not Answered", "Busy", "Switched Off", "Call Back Later", "Not Interested", "Interested"];
const CLASSIFICATIONS = LEAD_CLASSIFICATIONS;
const STATUSES = LEAD_STATUS_KEYS;

const stageLabel = (s: unknown) => LEAD_STAGES.find((x) => x.key === s)?.label ?? String(s ?? "—");
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtWhen = (d: unknown) =>
  d ? new Date(String(d)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

const EMPTY_VISIT_FORM = {
  ProjectName: "",
  PreferredDate: "",
  PreferredTime: "",
  ExecutiveId: "",
  PickupRequired: "No",
  CustomerNotes: "",
  Status: "Scheduled",
};

const SaInquiryDashboard: React.FC = () => {
  usePageRights("sa-inquiry");
  const queryClient = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [callForm, setCallForm] = useState({ Outcome: "", Remarks: "", Classification: "", DurationSeconds: "" });
  const [submitting, setSubmitting] = useState(false);

  // Schedule visit dialog
  const [visitDialogOpen, setVisitDialogOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({ ...EMPTY_VISIT_FORM });
  const [schedulingVisit, setSchedulingVisit] = useState(false);
  const { data: userOptions = [] } = useQuery({
    queryKey: ["sa-exec-options"],
    queryFn: fetchUserOptions,
    staleTime: 5 * 60_000,
  });

  const { data: leads = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-leads"], queryFn: fetchLeads, staleTime: 30_000 });
  const { data: detail, isLoading: loadingDetail, error: detailError } = useQuery({
    queryKey: ["sa-inquiry-detail", selectedLeadId],
    queryFn: () => fetchLeadDetail(selectedLeadId!),
    enabled: !!selectedLeadId,
    staleTime: 30_000,
  });

  const filteredLeads = useMemo(() => {
    return (leads as any[]).filter((l: any) => {
      const q = search.trim().toLowerCase();
      const matchSearch = !q || [l.CustomerName, l.Mobile, l.LeadUid].some((v) => String(v ?? "").toLowerCase().includes(q));
      const matchStatus = statusFilter === "All" || l.Status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [leads, search, statusFilter]);

  const selectedLead = useMemo(() =>
    (leads as any[]).find((l: any) => l.Id === selectedLeadId || parseInt(l._id) === selectedLeadId),
    [leads, selectedLeadId]
  );

  const handleLogCall = async () => {
    if (!selectedLeadId) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedLeadId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Outcome: callForm.Outcome || null,
          Remarks: callForm.Remarks || null,
          Classification: callForm.Classification || null,
          DurationSeconds: callForm.DurationSeconds ? parseInt(callForm.DurationSeconds) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to log call");
      toast.success("Call logged!");
      setCallForm({ Outcome: "", Remarks: "", Classification: "", DurationSeconds: "" });
      await queryClient.invalidateQueries({ queryKey: ["sa-inquiry-detail", selectedLeadId] });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to log call");
    } finally {
      setSubmitting(false);
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
          ExecutiveId: visitForm.ExecutiveId ? parseInt(visitForm.ExecutiveId) : null,
          PickupRequired: visitForm.PickupRequired === "Yes",
          CustomerNotes: visitForm.CustomerNotes || null,
          Status: "Scheduled",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule visit");
      toast.success("Site visit scheduled!");
      setVisitDialogOpen(false);
      setVisitForm({ ...EMPTY_VISIT_FORM });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-inquiry-detail", selectedLeadId] });
      await queryClient.invalidateQueries({ queryKey: ["sa-site-visits"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to schedule visit");
    } finally {
      setSchedulingVisit(false);
    }
  };

  const alreadyScheduled = selectedLead?.Status === "VisitScheduled" || selectedLead?.Status === "Visited";
  const countFor = (s: string) => (leads as any[]).filter((l: any) => s === "All" || l.Status === s).length;
  const newCount = countFor("New") + countFor("Assigned");
  const callEmpty = !callForm.Outcome && !callForm.Remarks.trim() && !callForm.Classification;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Leads", "Inquiries"]} title="Inquiries"
      subtitle={`${(leads as any[]).length} leads · ${newCount} not called yet. Pick one to call, log what they said and book a visit.`}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:h-[calc(100vh-200px)]">

        {/* Lead list panel */}
        <div className={`flex flex-col gap-2 min-h-0 ${selectedLeadId ? "hidden lg:flex" : ""}`}>
          <label className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 bg-background">
            <Search size={14} className="text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile or lead ID"
              className="flex-1 bg-transparent text-sm outline-none" />
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background">
            <option value="All">All stages ({countFor("All")})</option>
            {STATUSES.map((s) => <option key={s} value={s}>{stageLabel(s)} ({countFor(s)})</option>)}
          </select>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 max-h-[70vh] lg:max-h-none">
            {isLoading ? <div className="p-4 text-center text-muted-foreground text-sm">Loading…</div> :
              filteredLeads.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">{search || statusFilter !== "All" ? "No leads match." : "No inquiries yet."}</div> :
              filteredLeads.map((l: any) => (
                <button key={l._id || l.Id} onClick={() => setSelectedLeadId(l.Id || parseInt(l._id))}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedLeadId === (l.Id || parseInt(l._id)) ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{l.CustomerName}</span>
                    {l.Classification && <StatusBadge status={l.Classification} />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{l.LeadUid} · {l.Mobile}</div>
                  <div className="text-xs text-muted-foreground">{stageLabel(l.Status)} · {l.CampaignName || l.PlatformName || "no source"}</div>
                </button>
              ))
            }
          </div>
        </div>

        {/* Detail panel */}
        <div className="min-h-0 overflow-y-auto space-y-4">
          {!selectedLeadId ? (
            <div className="hidden lg:flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border">
              <Phone size={18} className="opacity-50" />
              Pick a lead on the left to see their details and call history.
            </div>
          ) : loadingDetail ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : detailError || !detail ? (
            <div className="p-8 text-center text-red-500 text-sm">
              Couldn't load this lead. <button onClick={() => setSelectedLeadId(null)} className="underline">Back to the list</button>
            </div>
          ) : (
            <>
              <button onClick={() => setSelectedLeadId(null)} className="lg:hidden inline-flex items-center gap-1 text-xs text-primary">
                ← Back to the list
              </button>
              {/* Customer info card */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{detail.lead?.CustomerName}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{detail.lead?.LeadUid}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {detail.lead?.Classification && <StatusBadge status={detail.lead.Classification} />}
                    {detail.lead?.Mobile && (
                      <a href={`tel:${detail.lead.Mobile}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-colors">
                        <Phone size={12} /> Call
                      </a>
                    )}
                    {/* Schedule Visit button */}
                    {!alreadyScheduled ? (
                      <button
                        onClick={() => setVisitDialogOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
                      >
                        <MapPin size={12} /> Schedule Visit
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground border border-border">
                        <MapPin size={12} /> {detail.lead?.Status === "Visited" ? "Visited" : "Visit Scheduled"}
                      </span>
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {[
                    ["Mobile", detail.lead?.Mobile || "—"],
                    ["Other mobile", detail.lead?.AltMobile || "—"],
                    ["Email", detail.lead?.Email || "—"],
                    ["Stage", stageLabel(detail.lead?.LeadStatus || detail.lead?.Status)],
                    ["Came from", [detail.lead?.CampaignName, detail.lead?.PlatformName].filter(Boolean).join(" · ") || "—"],
                    ["Received", fmtDay(detail.lead?.DateGenerated)],
                    ["Salesperson", detail.lead?.SalespersonName || "Not assigned"],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">{k}</dt>
                      <dd className="text-foreground font-medium break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
                {detail.lead?.CustomerRemarks && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{detail.lead.CustomerRemarks}</div>
                )}
              </div>

              {/* Log call form */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Log a call</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                    <select value={callForm.Outcome} onChange={(e) => setCallForm((f) => ({ ...f, Outcome: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">Select outcome</option>
                      {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">How interested?</label>
                    <select value={callForm.Classification} onChange={(e) => setCallForm((f) => ({ ...f, Classification: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">No change</option>
                      {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{getStatusLabel(c)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Duration (seconds)</label>
                    <input type="number" value={callForm.DurationSeconds} onChange={(e) => setCallForm((f) => ({ ...f, DurationSeconds: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="e.g. 120" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">What they said</label>
                    <textarea value={callForm.Remarks} onChange={(e) => setCallForm((f) => ({ ...f, Remarks: e.target.value }))}
                      rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" placeholder="Customer response..." />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handleLogCall} disabled={submitting || callEmpty}
                    className="px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors">
                    {submitting ? "Saving…" : "Log call"}
                  </button>
                  {callEmpty && <span className="text-xs text-muted-foreground">Choose an outcome or add a note first.</span>}
                </div>
              </div>

              {/* Call history */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Call History ({detail.calls?.length || 0})</h3>
                </div>
                {!detail.calls?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No calls logged yet</div>
                ) : detail.calls.map((c: any) => (
                  <div key={c.Id} className="px-4 py-3 border-b border-border last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{c.Outcome || "No outcome"}</span>
                        {c.Classification && <StatusBadge status={c.Classification} />}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtWhen(c.CallTime)}</span>
                    </div>
                    {c.Remarks && <p className="text-xs text-muted-foreground mt-1">{c.Remarks}</p>}
                    <p className="text-xs text-muted-foreground">
                      {c.DurationSeconds ? `${Math.floor(c.DurationSeconds / 60)}m ${c.DurationSeconds % 60}s · ` : ""}{c.SalespersonName || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Schedule Visit Dialog */}
      <Dialog open={visitDialogOpen} onOpenChange={(o) => { if (!o) { setVisitDialogOpen(false); setVisitForm({ ...EMPTY_VISIT_FORM }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Schedule Site Visit</DialogTitle>
          </DialogHeader>
          {selectedLead && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 mb-2">
              <p className="text-sm font-medium text-foreground">{selectedLead.CustomerName}</p>
              <p className="text-xs text-muted-foreground">{selectedLead.LeadUid} · {selectedLead.Mobile}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "ProjectName", label: "Project Name", type: "text" },
              { key: "PreferredDate", label: "Preferred Date", type: "date" },
              { key: "PreferredTime", label: "Preferred Time", type: "time" },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <AutoInput
                  type={type}
                  value={visitForm[key as keyof typeof visitForm]}
                  onChange={(e) => setVisitForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assigned Executive</label>
              <SearchableNativeSelect
                value={visitForm.ExecutiveId}
                onChange={(e) => setVisitForm((f) => ({ ...f, ExecutiveId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select executive</option>
                {userOptions.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </SearchableNativeSelect>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Pickup Required</label>
              <select
                value={visitForm.PickupRequired}
                onChange={(e) => setVisitForm((f) => ({ ...f, PickupRequired: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Customer Notes</label>
              <textarea
                value={visitForm.CustomerNotes}
                onChange={(e) => setVisitForm((f) => ({ ...f, CustomerNotes: e.target.value }))}
                rows={2}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none"
                placeholder="Any notes for the visit..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={() => { setVisitDialogOpen(false); setVisitForm({ ...EMPTY_VISIT_FORM }); }}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
            >Cancel</button>
            <button
              onClick={handleScheduleVisit}
              disabled={schedulingVisit}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold btn-module text-white disabled:opacity-40 transition-colors"
            >{schedulingVisit ? "Scheduling..." : "Schedule Visit"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaInquiryDashboard;
