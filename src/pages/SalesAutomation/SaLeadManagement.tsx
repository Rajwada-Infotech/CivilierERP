import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, IndianRupee, LayoutList, Kanban, GitMerge, ArrowRightLeft, Clock, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/sa/leads";

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json().catch(() => ({}));
}
async function fetchTeamLeadOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${API}/users`);
    if (!res.ok) return [];
    const data: { Id: number; Name: string; role: string }[] = await res.json();
    return data
      .filter((u) => u.role === "sales_team_lead")
      .map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}
async function fetchSalespersonOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${API}/users`);
    if (!res.ok) return [];
    const data: { Id: number; Name: string; role: string }[] = await res.json();
    return data
      .filter((u) => u.role === "sales_person")
      .map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}
async function fetchPlatformOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/social-media");
    if (!res.ok) return [];
    const data: { Id: number; Name: string }[] = await res.json();
    return data.map((p) => ({ value: String(p.Id), label: p.Name }));
  } catch { return []; }
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/campaigns/dropdown");
    if (!res.ok) return [];
    const data: { Id: number; Name: string; CampaignCode: string; PlatformId?: number }[] = await res.json();
    return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}${c.PlatformId ? ` (Platform ${c.PlatformId})` : ""}` }));
  } catch { return []; }
}
async function fetchAdOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/ads/dropdown");
    if (!res.ok) return [];
    const data: { Id: number; Name: string; CampaignName?: string; PlatformName?: string }[] = await res.json();
    return data.map((a) => ({ value: String(a.Id), label: `${a.Name}${a.CampaignName ? ` - ${a.CampaignName}` : ""}${a.PlatformName ? ` (${a.PlatformName})` : ""}` }));
  } catch { return []; }
}
async function fetchChannelPartnerOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/channel-partners");
    if (!res.ok) return [];
    const data: { Id: number; Name: string; PartnerCode?: string }[] = await res.json();
    return data.map((cp) => ({ value: String(cp.Id), label: cp.PartnerCode ? `${cp.PartnerCode} - ${cp.Name}` : cp.Name }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  { name: "CustomerName", label: "Customer Name", type: "text", required: true },
  { name: "Mobile", label: "Mobile Number", type: "text", required: true },
  { name: "AltMobile", label: "Alternate Mobile", type: "text" },
  { name: "Email", label: "Email", type: "text" },
  { name: "DateGenerated", label: "Date Generated", type: "date" },
  { name: "PlatformId", label: "Source Platform", type: "select", asyncOptions: fetchPlatformOptions },
  { name: "SourceType", label: "Lead Source Type", type: "select", options: ["Ad","WalkIn","Referral","PortalInquiry","ColdCall","Website","EventLead","Other"] },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Advertisement", type: "select", asyncOptions: fetchAdOptions },
  { name: "ChannelPartnerId", label: "Channel Partner", type: "select", asyncOptions: fetchChannelPartnerOptions },
  { name: "ExternalLeadId", label: "External Lead ID", type: "text" },
  { name: "LeadFormName", label: "Lead Form Name", type: "text" },
  { name: "SourceCampaignName", label: "Source Campaign Name", type: "text" },
  { name: "SourceAdName", label: "Source Ad Name", type: "text" },
  { name: "SourcePlacement", label: "Source Placement", type: "text" },
  { name: "LeadCaptureUrl", label: "Lead Capture URL", type: "text" },
  { name: "UtmSource", label: "UTM Source", type: "text" },
  { name: "UtmMedium", label: "UTM Medium", type: "text" },
  { name: "UtmCampaign", label: "UTM Campaign", type: "text" },
  { name: "UtmContent", label: "UTM Content", type: "text" },
  { name: "UtmTerm", label: "UTM Term", type: "text" },
  { name: "CapturedAt", label: "Captured At", type: "date" },
  { name: "AssignedTeamLeadId", label: "Assigned Team Lead", type: "select", asyncOptions: fetchTeamLeadOptions },
  { name: "AssignedSalespersonId", label: "Assigned Salesperson", type: "select", asyncOptions: fetchSalespersonOptions },
  { name: "Status", label: "Lead Status", type: "select", options: ["New","Assigned","Contacted","FollowUp","VisitScheduled","Visited","Booking","Lost"], defaultValue: "New" },
  { name: "Classification", label: "Classification", type: "select", options: ["Hot","Warm","Cold","NotInterested","CallBackLater"] },
  { name: "BudgetMin", label: "Budget Min", type: "number" },
  { name: "BudgetMax", label: "Budget Max", type: "number" },
  { name: "PropertyType", label: "Property Type", type: "select", options: ["Apartment","Villa","Commercial","Plot","Warehouse","Studio"] },
  { name: "BhkPreference", label: "BHK Preference", type: "select", options: ["Studio","1BHK","2BHK","3BHK","4BHK+"] },
  { name: "PreferredLocation", label: "Preferred Location", type: "text" },
  { name: "PurchaseTimeline", label: "Purchase Timeline", type: "select", options: ["Immediate","3Months","6Months","1Year","JustExploring"] },
  { name: "CustomerRemarks", label: "Customer Remarks", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "LeadUid", label: "Lead ID" },
  { key: "CustomerName", label: "Customer Name" },
  { key: "Mobile", label: "Mobile" },
  { key: "PlatformName", label: "Source", hideOnMobile: true },
  { key: "SourceType", label: "Type", hideOnMobile: true },
  { key: "CampaignName", label: "Campaign", hideOnMobile: true },
  { key: "AdName", label: "Ad", hideOnMobile: true },
  { key: "PreferredLocation", label: "Location", hideOnMobile: true },
  { key: "LeadScore", label: "Score", hideOnMobile: true },
  { key: "Status", label: "Status" },
  { key: "Classification", label: "Classification", hideOnMobile: true },
  { key: "SalespersonName", label: "Salesperson", hideOnMobile: true },
];

const exportColumns: ExportColumn[] = [
  { header: "Lead ID", accessor: "LeadUid" },
  { header: "Customer Name", accessor: "CustomerName" },
  { header: "Mobile", accessor: "Mobile" },
  { header: "Email", accessor: "Email" },
  { header: "Source", accessor: "PlatformName" },
  { header: "Source Type", accessor: "SourceType" },
  { header: "Channel Partner", accessor: "ChannelPartnerName" },
  { header: "Campaign", accessor: "CampaignName" },
  { header: "Ad", accessor: "AdName" },
  { header: "External Lead ID", accessor: "ExternalLeadId" },
  { header: "Lead Form", accessor: "LeadFormName" },
  { header: "Source Campaign Name", accessor: "SourceCampaignName" },
  { header: "Source Ad Name", accessor: "SourceAdName" },
  { header: "Source Placement", accessor: "SourcePlacement" },
  { header: "Lead Capture URL", accessor: "LeadCaptureUrl" },
  { header: "UTM Source", accessor: "UtmSource" },
  { header: "UTM Medium", accessor: "UtmMedium" },
  { header: "UTM Campaign", accessor: "UtmCampaign" },
  { header: "UTM Content", accessor: "UtmContent" },
  { header: "UTM Term", accessor: "UtmTerm" },
  { header: "Captured At", accessor: "CapturedAt" },
  { header: "Budget Min", accessor: "BudgetMin" },
  { header: "Budget Max", accessor: "BudgetMax" },
  { header: "Property Type", accessor: "PropertyType" },
  { header: "BHK Preference", accessor: "BhkPreference" },
  { header: "Preferred Location", accessor: "PreferredLocation" },
  { header: "Purchase Timeline", accessor: "PurchaseTimeline" },
  { header: "Lead Score", accessor: "LeadScore" },
  { header: "Date Generated", accessor: "DateGenerated" },
  { header: "Status", accessor: "Status" },
  { header: "Classification", accessor: "Classification" },
  { header: "Team Lead", accessor: "TeamLeadName" },
  { header: "Salesperson", accessor: "SalespersonName" },
];

const SaLeadManagement: React.FC = () => {
  usePageRights("sa-leads");
  const queryClient = useQueryClient();
  const [handoffLoading, setHandoffLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"list" | "pipeline" | "tracking" | "audit">("list");
  const [auditLeadId, setAuditLeadId] = useState<string | null>(null);

  // Transfer leads state
  const { currentUser, canDoAction } = useAuth();
  const isTL = currentUser?.role === "sales_team_lead";
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSelectedIds, setTransferSelectedIds] = useState<Set<string>>(new Set());
  const [transferToTLId, setTransferToTLId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const { data: tlOptions = [] } = useQuery({
    queryKey: ["sa-tl-options"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/sa/leads/users");
      if (!r.ok) return [];
      const data: any[] = await r.json().catch(() => ({}));
      return data.filter((u) => u.role === "sales_team_lead" && u.id !== currentUser?.id);
    },
    staleTime: 5 * 60_000,
    enabled: isTL,
  });

  const toggleTransferLead = (id: string) => {
    setTransferSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmitTransfer = async () => {
    if (!transferToTLId) return toast.error("Select a destination team lead");
    if (transferSelectedIds.size === 0) return toast.error("Select at least one lead");
    setTransferLoading(true);
    try {
      const r = await fetchWithAuth("/api/sa/lead-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ToTeamLeadId: parseInt(transferToTLId),
          LeadIds: Array.from(transferSelectedIds).map(Number),
          RequestNotes: transferNotes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      toast.success("Transfer request submitted! Waiting for admin approval.");
      setTransferOpen(false);
      setTransferSelectedIds(new Set());
      setTransferToTLId("");
      setTransferNotes("");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setTransferLoading(false);
    }
  };
  const { data: leads, isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-leads"], queryFn: fetchLeads, staleTime: 30_000 });

  const { data: auditLog = [] } = useQuery({
    queryKey: ["sa-lead-audit", auditLeadId],
    queryFn: async () => {
      if (!auditLeadId) return [];
      try {
        const res = await fetchWithAuth(`${API}/${auditLeadId}/audit`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!auditLeadId,
    staleTime: 0,
  });

  const mappedData: RecordWithId[] = useMemo(() => {
    if (!Array.isArray(leads)) return [];
    return leads.map((l) => ({
      _id: String(l.Id),
      LeadUid: l.LeadUid ?? "",
      CustomerName: l.CustomerName ?? "",
      Mobile: l.Mobile ?? "",
      AltMobile: l.AltMobile ?? "",
      Email: l.Email ?? "",
      DateGenerated: l.DateGenerated ? String(l.DateGenerated).slice(0, 10) : "",
      PlatformId: String(l.PlatformId ?? ""),
      PlatformName: l.PlatformName ?? "",
      SourceType: l.SourceType ?? "",
      ChannelPartnerId: String(l.ChannelPartnerId ?? ""),
      ChannelPartnerName: l.ChannelPartnerName ?? "",
      CampaignId: String(l.CampaignId ?? ""),
      CampaignName: l.CampaignName ?? "",
      AdId: String(l.AdId ?? ""),
      AdName: l.AdName ?? "",
      ExternalLeadId: l.ExternalLeadId ?? "",
      LeadFormName: l.LeadFormName ?? "",
      SourceCampaignName: l.SourceCampaignName ?? "",
      SourceAdName: l.SourceAdName ?? "",
      SourcePlacement: l.SourcePlacement ?? "",
      LeadCaptureUrl: l.LeadCaptureUrl ?? "",
      UtmSource: l.UtmSource ?? "",
      UtmMedium: l.UtmMedium ?? "",
      UtmCampaign: l.UtmCampaign ?? "",
      UtmContent: l.UtmContent ?? "",
      UtmTerm: l.UtmTerm ?? "",
      CapturedAt: l.CapturedAt ? String(l.CapturedAt).slice(0, 10) : "",
      SourcePayload: l.SourcePayload ?? "",
      Status: l.Status ?? "New",
      Classification: l.Classification ?? "",
      BudgetMin: l.BudgetMin ?? "",
      BudgetMax: l.BudgetMax ?? "",
      PropertyType: l.PropertyType ?? "",
      BhkPreference: l.BhkPreference ?? "",
      PreferredLocation: l.PreferredLocation ?? "",
      PurchaseTimeline: l.PurchaseTimeline ?? "",
      LastActivityAt: l.LastActivityAt ? String(l.LastActivityAt).slice(0, 10) : "",
      LeadScore: l.LeadScore ?? 0,
      CustomerRemarks: l.CustomerRemarks ?? "",
      AssignedTeamLeadId: String(l.AssignedTeamLeadId ?? ""),
      TeamLeadName: l.TeamLeadName ?? "",
      AssignedSalespersonId: String(l.AssignedSalespersonId ?? ""),
      SalespersonName: l.SalespersonName ?? "",
      FollowupCustomerId: l.CrmApplicationId ?? "",
      BookingId: l.CrmBookingId ?? "",
    }));
  }, [leads]);

  const toPayload = (r: Record<string, any>) => ({
    CustomerName: r.CustomerName?.trim() || null,
    Mobile: r.Mobile?.trim() || null,
    AltMobile: r.AltMobile || null,
    Email: r.Email || null,
    DateGenerated: r.DateGenerated || null,
    PlatformId: r.PlatformId ? parseInt(r.PlatformId) : null,
    SourceType: r.SourceType || null,
    ChannelPartnerId: r.ChannelPartnerId ? parseInt(r.ChannelPartnerId) : null,
    CampaignId: r.CampaignId ? parseInt(r.CampaignId) : null,
    AdId: r.AdId ? parseInt(r.AdId) : null,
    ExternalLeadId: r.ExternalLeadId || null,
    LeadFormName: r.LeadFormName || null,
    SourceCampaignName: r.SourceCampaignName || null,
    SourceAdName: r.SourceAdName || null,
    SourcePlacement: r.SourcePlacement || null,
    LeadCaptureUrl: r.LeadCaptureUrl || null,
    UtmSource: r.UtmSource || null,
    UtmMedium: r.UtmMedium || null,
    UtmCampaign: r.UtmCampaign || null,
    UtmContent: r.UtmContent || null,
    UtmTerm: r.UtmTerm || null,
    CapturedAt: r.CapturedAt || null,
    Status: r.Status || "New",
    Classification: r.Classification || null,
    BudgetMin: r.BudgetMin !== "" && r.BudgetMin != null ? parseFloat(r.BudgetMin) : null,
    BudgetMax: r.BudgetMax !== "" && r.BudgetMax != null ? parseFloat(r.BudgetMax) : null,
    PropertyType: r.PropertyType || null,
    BhkPreference: r.BhkPreference || null,
    PreferredLocation: r.PreferredLocation || null,
    PurchaseTimeline: r.PurchaseTimeline || null,
    CustomerRemarks: r.CustomerRemarks || null,
    AssignedTeamLeadId: r.AssignedTeamLeadId ? parseInt(r.AssignedTeamLeadId) : null,
    AssignedSalespersonId: r.AssignedSalespersonId ? parseInt(r.AssignedSalespersonId) : null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add lead");
        toast.success("Lead added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update lead");
        toast.success("Lead updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete lead");
        toast.success("Lead deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const invalidateLeadFlow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sa-leads"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-dashboard-sales"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-dashboard-marketing"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-report"] }),
    ]);
  };

  const promoteToFollowup = async (row: RecordWithId) => {
    setHandoffLoading(`followup-${row._id}`);
    try {
      const res = await fetchWithAuth(`${API}/${row._id}/promote-followup`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to promote lead to follow-up");
      toast.success(data.message || "Lead promoted to follow-up");
      await invalidateLeadFlow();
    } catch (err: any) {
      toast.error(err.message || "Failed to promote lead");
    } finally {
      setHandoffLoading(null);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading leads...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load leads.</div>;

  const PIPELINE_STAGES = [
    { key: "New", label: "New", color: "border-slate-400 bg-slate-50 dark:bg-slate-900/30" },
    { key: "Assigned", label: "Assigned", color: "border-blue-400 bg-blue-50 dark:bg-blue-900/20" },
    { key: "Contacted", label: "Contacted", color: "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" },
    { key: "FollowUp", label: "Follow Up", color: "border-orange-400 bg-orange-50 dark:bg-orange-900/20" },
    { key: "VisitScheduled", label: "Visit Scheduled", color: "border-purple-400 bg-purple-50 dark:bg-purple-900/20" },
    { key: "Visited", label: "Visited", color: "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20" },
    { key: "Booking", label: "Booking", color: "border-green-400 bg-green-50 dark:bg-green-900/20" },
    { key: "Lost", label: "Lost", color: "border-red-400 bg-red-50 dark:bg-red-900/20" },
  ];

  const stageMap: Record<string, RecordWithId[]> = {};
  PIPELINE_STAGES.forEach((s) => {
    stageMap[s.key] = mappedData.filter((l) => l.Status === s.key);
  });

  const inFollowup = mappedData.filter((l) => l.FollowupCustomerId);
  const booked = mappedData.filter((l) => l.BookingId);

  return (
    <SalesAutoShell title="Lead Management" subtitle="Track, assign and manage the complete lead lifecycle"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Lead Management"]} />
      <style>{`@media print { nav, header, aside, .print\\:hidden { display: none !important; } }`}</style>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Transfer Leads — Team Lead only */}
            {isTL && (
              <button
                onClick={() => { setTransferOpen(true); setTransferSelectedIds(new Set()); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                <ArrowRightLeft size={13} /> Transfer Leads
              </button>
            )}
            {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            {([
              { key: "list",     icon: LayoutList, label: "List" },
              { key: "pipeline", icon: Kanban,     label: "Pipeline" },
              { key: "tracking", icon: GitMerge,   label: "Tracking" },
              { key: "audit",    icon: Clock,     label: "Audit" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {activeTab === "list" && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors print:hidden"
              title="Print leads table"
            >
              <Printer size={13} /> Print
            </button>
          )}
          </div>
        </div>

        {/* ── PIPELINE TAB ── */}
        {activeTab === "pipeline" && (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max">
              {PIPELINE_STAGES.map((stage) => {
                const stageLeads = stageMap[stage.key] || [];
                return (
                  <div key={stage.key} className={`w-52 shrink-0 rounded-lg border-t-2 border border-border ${stage.color}`}>
                    <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{stage.label}</span>
                      <span className="text-xs font-bold text-muted-foreground bg-background rounded-full px-2 py-0.5 border border-border">{stageLeads.length}</span>
                    </div>
                    <div className="p-2 space-y-1.5 max-h-[calc(100vh-300px)] overflow-y-auto">
                      {stageLeads.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-4">No leads</p>
                      ) : stageLeads.map((l) => (
                        <div key={l._id} className="bg-background rounded-md border border-border p-2 space-y-1">
                          <p className="text-xs font-medium text-foreground truncate">{String(l.CustomerName)}</p>
                          <p className="text-[10px] text-muted-foreground">{String(l.Mobile)}</p>
                          {l.Classification && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full inline-block ${
                              l.Classification === "Hot" ? "bg-red-500/10 text-red-500" :
                              l.Classification === "Warm" ? "bg-orange-500/10 text-orange-500" :
                              "bg-blue-500/10 text-blue-500"
                            }`}>{String(l.Classification)}</span>
                          )}
                          {l.SalespersonName && <p className="text-[10px] text-muted-foreground truncate">{String(l.SalespersonName)}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TRACKING TAB ── */}
        {activeTab === "tracking" && (
          <div className="space-y-6">
            {/* In Follow-up */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Picked Into CRM Application ({inFollowup.length})</h3>
                <span className="text-xs text-muted-foreground">Converted leads a CRM Application has already been started from</span>
              </div>
              {inFollowup.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No leads picked into an application yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr>
                      {["Lead ID", "Customer", "Mobile", "Application ID", "Status", "Salesperson"].map((h) => (
                        <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inFollowup.map((l) => (
                      <tr key={l._id} className="border-t border-border hover:bg-muted/10 transition-colors">
                        <td className="p-3 text-xs font-mono text-muted-foreground">{String(l.LeadUid)}</td>
                        <td className="p-3 font-medium text-foreground">{String(l.CustomerName)}</td>
                        <td className="p-3 text-muted-foreground">{String(l.Mobile)}</td>
                        <td className="p-3 text-xs font-mono text-emerald-600">{String(l.FollowupCustomerId)}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">{String(l.Status)}</span>
                        </td>
                        <td className="p-3 text-muted-foreground">{(l.SalespersonName as string) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Booked */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Booked ({booked.length})</h3>
                <span className="text-xs text-muted-foreground">Leads confirmed into bookings</span>
              </div>
              {booked.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No bookings yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr>
                      {["Lead ID", "Customer", "Mobile", "Booking ID", "Campaign", "Salesperson"].map((h) => (
                        <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {booked.map((l) => (
                      <tr key={l._id} className="border-t border-border hover:bg-muted/10 transition-colors">
                        <td className="p-3 text-xs font-mono text-muted-foreground">{String(l.LeadUid)}</td>
                        <td className="p-3 font-medium text-foreground">{String(l.CustomerName)}</td>
                        <td className="p-3 text-muted-foreground">{String(l.Mobile)}</td>
                        <td className="p-3 text-xs font-mono text-amber-600">{String(l.BookingId)}</td>
                        <td className="p-3 text-muted-foreground">{(l.CampaignName as string) || "—"}</td>
                        <td className="p-3 text-muted-foreground">{(l.SalespersonName as string) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── AUDIT TAB ── */}
        {activeTab === "audit" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground shrink-0">Select Lead:</label>
              <select
                value={auditLeadId ?? ""}
                onChange={(e) => setAuditLeadId(e.target.value || null)}
                className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background flex-1 max-w-xs"
              >
                <option value="">— choose a lead —</option>
                {mappedData.map((l) => (
                  <option key={l._id} value={l._id}>
                    {String(l.LeadUid)} — {String(l.CustomerName)}
                  </option>
                ))}
              </select>
            </div>

            {auditLeadId && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Audit Trail — {String(mappedData.find((l) => l._id === auditLeadId)?.LeadUid ?? "")}
                  </h3>
                  <span className="text-xs text-muted-foreground">{auditLog.length} change{auditLog.length !== 1 ? "s" : ""}</span>
                </div>
                {auditLog.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No changes recorded yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr>
                        {["Field", "Old Value", "New Value", "Changed By", "When"].map((h) => (
                          <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(auditLog as any[]).map((row: any) => (
                        <tr key={row.Id} className="border-t border-border hover:bg-muted/10 transition-colors">
                          <td className="p-3 font-medium text-foreground text-xs">{row.Field}</td>
                          <td className="p-3 text-xs text-muted-foreground">{row.OldValue ?? <span className="italic opacity-50">—</span>}</td>
                          <td className="p-3 text-xs text-foreground">{row.NewValue ?? <span className="italic opacity-50">—</span>}</td>
                          <td className="p-3 text-xs text-muted-foreground">{row.ChangedByName ?? "System"}</td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(row.ChangedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {!auditLeadId && (
              <div className="p-10 text-center text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                Select a lead above to view its change history
              </div>
            )}
          </div>
        )}

        {/* ── LIST TAB ── */}
        {activeTab === "list" && <><MasterPage
          title="Lead"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-leads", "create")}
          canEdit={canDoAction("sa-leads", "edit")}
          canDelete={false /* leads are a permanent record — can be edited, never deleted */}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Lead Management", filename: "lead-management", columns: exportColumns }}
          rowActions={(row) => {
            // Three distinct states now that converting a lead no longer
            // auto-creates a CrmApplication (see saHandoff.js convertLead):
            //   1. Not yet converted -> "Convert Lead" action.
            //   2. Converted, sitting in the CRM Leads pool, not yet picked
            //      into an Application -> static badge (nothing to do here;
            //      CRM staff pick it up from src/pages/CRM/CrmLeads.tsx).
            //   3. CrmApplicationId set (picked up by CRM) -> the amber
            //      "Continue in CRM Application" button, unchanged.
            const isConverted = row.Status === "Converted";
            const hasFollowup = Boolean(row.FollowupCustomerId); // CrmApplicationId, aliased in mappedData above
            const hasBooking = Boolean(row.BookingId);
            const auditBtn = (
              <button
                type="button"
                onClick={() => { setAuditLeadId(row._id); setActiveTab("audit"); }}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                title="View audit trail"
              >
                <Clock size={13} />
              </button>
            );
            if (hasBooking) {
              return (
                <>
                  {auditBtn}
                  <span className="px-2 py-1 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-600">
                    Booked
                  </span>
                </>
              );
            }
            return (
              <>
                {auditBtn}
                {!isConverted && !hasFollowup && (
                  <button
                    type="button"
                    onClick={() => promoteToFollowup(row)}
                    disabled={handoffLoading === `followup-${row._id}`}
                    className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                    title="Convert Lead — puts it in the CRM Leads pool"
                  >
                    <CheckCircle2 size={13} />
                  </button>
                )}
                {isConverted && !hasFollowup && (
                  <span className="px-2 py-1 text-[10px] font-medium rounded-full bg-sky-500/10 text-sky-600" title="Converted — waiting for CRM staff to start an application from it">
                    In CRM Leads Pool
                  </span>
                )}
                {hasFollowup && (
                  <button
                    type="button"
                    onClick={() => window.open("/crm/applications", "_blank")}
                    className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
                    title="Continue in CRM Application — unit, rate, payment plan, and admin approval all happen there now"
                  >
                    <IndianRupee size={13} />
                  </button>
                )}
              </>
            );
          }}
          viewConfig={{
            title: "Lead Details",
            fields: [
              { key: "LeadUid", label: "Lead ID" },
              { key: "CustomerName", label: "Customer Name" },
              { key: "Mobile", label: "Mobile" },
              { key: "AltMobile", label: "Alternate Mobile" },
              { key: "Email", label: "Email" },
              { key: "PlatformName", label: "Source Platform" },
              { key: "SourceType", label: "Source Type" },
              { key: "ChannelPartnerName", label: "Channel Partner" },
              { key: "CampaignName", label: "Campaign" },
              { key: "AdName", label: "Advertisement" },
              { key: "ExternalLeadId", label: "External Lead ID" },
              { key: "LeadFormName", label: "Lead Form Name" },
              { key: "SourceCampaignName", label: "Source Campaign Name" },
              { key: "SourceAdName", label: "Source Ad Name" },
              { key: "SourcePlacement", label: "Source Placement" },
              { key: "LeadCaptureUrl", label: "Lead Capture URL" },
              { key: "UtmSource", label: "UTM Source" },
              { key: "UtmMedium", label: "UTM Medium" },
              { key: "UtmCampaign", label: "UTM Campaign" },
              { key: "UtmContent", label: "UTM Content" },
              { key: "UtmTerm", label: "UTM Term" },
              { key: "CapturedAt", label: "Captured At" },
              { key: "DateGenerated", label: "Date Generated" },
              { key: "Status", label: "Status" },
              { key: "Classification", label: "Classification" },
              { key: "LeadScore", label: "Lead Score" },
              { key: "BudgetMin", label: "Budget Min" },
              { key: "BudgetMax", label: "Budget Max" },
              { key: "PropertyType", label: "Property Type" },
              { key: "BhkPreference", label: "BHK Preference" },
              { key: "PreferredLocation", label: "Preferred Location" },
              { key: "PurchaseTimeline", label: "Purchase Timeline" },
              { key: "LastActivityAt", label: "Last Activity" },
              { key: "TeamLeadName", label: "Team Lead" },
              { key: "SalespersonName", label: "Salesperson" },
              { key: "FollowupCustomerId", label: "Follow-up Customer ID" },
              { key: "BookingId", label: "Booking ID" },
              { key: "CustomerRemarks", label: "Remarks" },
            ],
          }}
        />
        </>}
      </div>

      {/* Transfer Leads Dialog */}
      <Dialog open={transferOpen} onOpenChange={(o) => { if (!o) { setTransferOpen(false); setTransferSelectedIds(new Set()); setTransferToTLId(""); setTransferNotes(""); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Request Lead Transfer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto flex-1 pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Transfer To Team Lead <span className="text-destructive">*</span></label>
                <select
                  value={transferToTLId}
                  onChange={(e) => setTransferToTLId(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                >
                  <option value="">Select destination TL...</option>
                  {(tlOptions as any[]).map((tl: any) => (
                    <option key={tl.Id} value={tl.Id}>{tl.Name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Notes (optional)</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                  placeholder="Reason for transfer..."
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Select Leads to Transfer ({transferSelectedIds.size} selected)</label>
                <button
                  onClick={() => {
                    if (transferSelectedIds.size === mappedData.length) {
                      setTransferSelectedIds(new Set());
                    } else {
                      setTransferSelectedIds(new Set(mappedData.map((l) => l._id)));
                    }
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  {transferSelectedIds.size === mappedData.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr>
                      <th className="px-3 py-2 w-8"></th>
                      {["Lead ID", "Customer", "Mobile", "Status", "Classification"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedData.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-4 text-center text-muted-foreground text-xs">No leads available</td></tr>
                    ) : mappedData.map((l) => (
                      <tr
                        key={l._id}
                        onClick={() => toggleTransferLead(l._id)}
                        className={`border-t border-border cursor-pointer transition-colors ${transferSelectedIds.has(l._id) ? "bg-primary/5" : "hover:bg-muted/10"}`}
                      >
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={transferSelectedIds.has(l._id)} onChange={() => toggleTransferLead(l._id)} className="rounded" />
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{String(l.LeadUid)}</td>
                        <td className="px-3 py-2 font-medium text-foreground">{String(l.CustomerName)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{String(l.Mobile)}</td>
                        <td className="px-3 py-2 text-xs">{String(l.Status)}</td>
                        <td className="px-3 py-2 text-xs">
                          {l.Classification && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                              l.Classification === "Hot" ? "bg-red-500/10 text-red-500" :
                              l.Classification === "Warm" ? "bg-orange-500/10 text-orange-500" :
                              "bg-blue-500/10 text-blue-500"
                            }`}>{String(l.Classification)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border mt-2">
            <button
              onClick={() => { setTransferOpen(false); setTransferSelectedIds(new Set()); setTransferToTLId(""); setTransferNotes(""); }}
              className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
            >Cancel</button>
            <button
              onClick={handleSubmitTransfer}
              disabled={transferLoading || transferSelectedIds.size === 0 || !transferToTLId}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <ArrowRightLeft size={12} />
              {transferLoading ? "Submitting..." : `Submit Request (${transferSelectedIds.size} lead${transferSelectedIds.size !== 1 ? "s" : ""})`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaLeadManagement;
