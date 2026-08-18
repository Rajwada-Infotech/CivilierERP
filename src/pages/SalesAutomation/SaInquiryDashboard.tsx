import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { MapPin, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
const CLASSIFICATIONS = ["Hot", "Warm", "Cold", "NotInterested", "CallBackLater"];
const STATUSES = ["New", "Assigned", "Contacted", "FollowUp", "VisitScheduled", "Visited", "Booking", "Lost"];

const classColor = (c: string) => {
  if (c === "Hot") return "text-red-500 bg-red-500/10";
  if (c === "Warm") return "text-orange-500 bg-orange-500/10";
  if (c === "Cold") return "text-blue-500 bg-blue-500/10";
  return "text-muted-foreground bg-muted/30";
};

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
  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["sa-inquiry-detail", selectedLeadId],
    queryFn: () => fetchLeadDetail(selectedLeadId!),
    enabled: !!selectedLeadId,
    staleTime: 30_000,
  });

  const filteredLeads = useMemo(() => {
    return (leads as any[]).filter((l: any) => {
      const matchSearch = !search || l.CustomerName?.toLowerCase().includes(search.toLowerCase()) || l.Mobile?.includes(search) || l.LeadUid?.includes(search);
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

  return (
    <SalesAutoShell title="Inquiry Dashboard" subtitle="Review and manage all incoming lead inquiries"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Inquiry Dashboard"]} />
      <div className="flex gap-4 h-[calc(100vh-200px)]">

        {/* Lead list panel */}
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, mobile, ID..."
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background">
            <option value="All">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {isLoading ? <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div> :
              filteredLeads.length === 0 ? <div className="p-4 text-center text-muted-foreground text-sm">No leads found</div> :
              filteredLeads.map((l: any) => (
                <button key={l._id || l.Id} onClick={() => setSelectedLeadId(l.Id || parseInt(l._id))}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedLeadId === (l.Id || parseInt(l._id)) ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{l.CustomerName}</span>
                    {l.Classification && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${classColor(l.Classification)}`}>{l.Classification}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{l.Mobile}</div>
                  <div className="text-xs text-muted-foreground">{l.Status} · {l.CampaignName || l.PlatformName || "—"}</div>
                </button>
              ))
            }
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {!selectedLeadId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a lead to view inquiry details</div>
          ) : loadingDetail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : detail ? (
            <>
              {/* Customer info card */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{detail.lead?.CustomerName}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{detail.lead?.LeadUid}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {detail.lead?.Classification && (
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${classColor(detail.lead.Classification)}`}>{detail.lead.Classification}</span>
                    )}
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ["Mobile", detail.lead?.Mobile],
                    ["Alt Mobile", detail.lead?.AltMobile || "—"],
                    ["Email", detail.lead?.Email || "—"],
                    ["Source", detail.lead?.PlatformName || "—"],
                    ["Campaign", detail.lead?.CampaignName || "—"],
                    ["Status", detail.lead?.LeadStatus || detail.lead?.Status],
                    ["Date Generated", detail.lead?.DateGenerated ? String(detail.lead.DateGenerated).slice(0, 10) : "—"],
                    ["Salesperson", detail.lead?.SalespersonName || "—"],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-muted-foreground text-xs">{k}: </span><span className="text-foreground font-medium">{v}</span></div>
                  ))}
                </div>
                {detail.lead?.CustomerRemarks && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{detail.lead.CustomerRemarks}</div>
                )}
              </div>

              {/* Log call form */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Log Call</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                    <select value={callForm.Outcome} onChange={(e) => setCallForm((f) => ({ ...f, Outcome: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">Select outcome</option>
                      {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Classification</label>
                    <select value={callForm.Classification} onChange={(e) => setCallForm((f) => ({ ...f, Classification: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value="">No change</option>
                      {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Duration (seconds)</label>
                    <input type="number" value={callForm.DurationSeconds} onChange={(e) => setCallForm((f) => ({ ...f, DurationSeconds: e.target.value }))}
                      className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="e.g. 120" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
                    <textarea value={callForm.Remarks} onChange={(e) => setCallForm((f) => ({ ...f, Remarks: e.target.value }))}
                      rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" placeholder="Customer response..." />
                  </div>
                </div>
                <button onClick={handleLogCall} disabled={submitting}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-primary/90 transition-colors">
                  {submitting ? "Logging..." : "Log Call"}
                </button>
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
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{c.Outcome || "—"}</span>
                      {c.Classification && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${classColor(c.Classification)}`}>{c.Classification}</span>}
                      <span className="text-xs text-muted-foreground">{c.CallTime ? String(c.CallTime).slice(0, 16).replace("T", " ") : "—"}</span>
                    </div>
                    {c.Remarks && <p className="text-xs text-muted-foreground mt-1">{c.Remarks}</p>}
                    {c.DurationSeconds && <p className="text-xs text-muted-foreground">{Math.floor(c.DurationSeconds / 60)}m {c.DurationSeconds % 60}s · {c.SalespersonName || "—"}</p>}
                  </div>
                ))}
              </div>
            </>
          ) : null}
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
                <input
                  type={type}
                  value={visitForm[key as keyof typeof visitForm]}
                  onChange={(e) => setVisitForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assigned Executive</label>
              <select
                value={visitForm.ExecutiveId}
                onChange={(e) => setVisitForm((f) => ({ ...f, ExecutiveId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select executive</option>
                {userOptions.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
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
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >{schedulingVisit ? "Scheduling..." : "Schedule Visit"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaInquiryDashboard;
