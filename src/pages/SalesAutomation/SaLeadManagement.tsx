import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

let unitOptionsPromise: Promise<{ kinds: { Code: string; Name: string }[]; layouts: string[] }> | null = null;
const fetchUnitOptions = () => {
  unitOptionsPromise ??= fetchWithAuth("/api/project-master/unit-options")
    .then((r) => (r.ok ? r.json() : { kinds: [], layouts: [] }))
    .catch(() => ({ kinds: [], layouts: [] }));
  return unitOptionsPromise;
};
import { CheckCircle2, IndianRupee, Kanban, ArrowRightLeft, Clock, Printer, Filter, MessageSquarePlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { CrmSideDrawer } from "@/components/crm/CrmSideDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { Link } from "react-router-dom";
import { LeadInteractionForm } from "@/components/sa/LeadInteractionForm";
import { LeadMessageForm } from "@/components/sa/LeadMessageForm";
import { LEAD_CLASSIFICATIONS, LEAD_STAGES, LEAD_STATUS_KEYS } from "@/components/sa/leadStages";
import { MoneyView, StageCell, TitleCell } from "@/components/sa/saCells";
import { useLeadActivityHistory } from "@/hooks/useLeadActivities";

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

// Sections -> MasterPage shows the form as tabs instead of one long scroll.
const fields: FieldDef[] = [
  { name: "_customer", label: "Customer", type: "section" },
  { name: "CustomerName", label: "Customer Name", type: "text", required: true },
  { name: "Mobile", label: "Mobile Number", type: "text", required: true, placeholder: "10-digit mobile" },
  { name: "AltMobile", label: "Other Mobile", type: "text" },
  { name: "Email", label: "Email", type: "text" },
  { name: "DateGenerated", label: "Received On", type: "date" },
  { name: "CustomerRemarks", label: "What the customer said", type: "textarea", fullWidth: true },

  { name: "_need", label: "Requirement", type: "section" },
  { name: "BudgetMin", label: "Budget From", type: "number", prefix: "₹" },
  { name: "BudgetMax", label: "Budget To", type: "number", prefix: "₹" },
  // From the masters: unit kinds (Unit Master › Unit kinds) and layouts (Unit Composition).
  { name: "PropertyType", label: "Property Type", type: "select", asyncOptions: async () => (await fetchUnitOptions()).kinds.map((k) => ({ value: k.Name, label: k.Name })) },
  { name: "BhkPreference", label: "BHK", type: "select", asyncOptions: async () => (await fetchUnitOptions()).layouts.map((l) => ({ value: l, label: l })) },
  { name: "PreferredLocation", label: "Preferred Location", type: "text" },
  { name: "PurchaseTimeline", label: "Buying When", type: "select", options: ["Immediate","3Months","6Months","1Year","JustExploring"] },

  { name: "_owner", label: "Stage & Owner", type: "section" },
  { name: "Status", label: "Stage", type: "select", options: LEAD_STATUS_KEYS, defaultValue: "New" },
  { name: "Classification", label: "Interest", type: "select", options: LEAD_CLASSIFICATIONS },
  { name: "AssignedTeamLeadId", label: "Team Lead", type: "select", asyncOptions: fetchTeamLeadOptions },
  { name: "AssignedSalespersonId", label: "Salesperson", type: "select", asyncOptions: fetchSalespersonOptions },

  { name: "_source", label: "Source", type: "section" },
  { name: "SourceType", label: "How they came", type: "select", options: ["Ad","WalkIn","Referral","PortalInquiry","ColdCall","Website","EventLead","Other"] },
  { name: "PlatformId", label: "Platform", type: "select", asyncOptions: fetchPlatformOptions },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Ad", type: "select", asyncOptions: fetchAdOptions },
  { name: "ChannelPartnerId", label: "Channel Partner", type: "select", asyncOptions: fetchChannelPartnerOptions },

  { name: "_tracking", label: "Tracking", type: "section" },
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
];

const columns = [
  { key: "CustomerName", label: "Lead" },
  { key: "CampaignName", label: "Came from", hideOnMobile: true },
  { key: "Status", label: "Stage" },
  { key: "Classification", label: "Interest", hideOnMobile: true },
  { key: "SalespersonName", label: "With", hideOnMobile: true },
  { key: "LastActivityAt", label: "Last touch", hideOnMobile: true },
  { key: "LeadScore", label: "Score", hideOnMobile: true },
];

const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtWhen = (d: unknown) =>
  d ? new Date(String(d)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
const actionBtn = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

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
  const [auditLeadId, setAuditLeadId] = useState<string | null>(null);
  // Lets staff log a call/WhatsApp/etc straight from a row instead of
  // leaving this page for Lead Activities or Follow-Ups just to do that.
  const [interactionLead, setInteractionLead] = useState<{ id: string; uid: string; mobile?: string; email?: string } | null>(null);
  // Was a standalone "Tracking" tab with its own two hand-rolled tables —
  // same information, now a one-click filter on the grid itself instead of
  // a separate tab/page round-trip.
  const [quickFilter, setQuickFilter] = useState<"all" | "inFollowup" | "booked">("all");
  const [stageFilter, setStageFilter] = useState("All");
  const [transferSearch, setTransferSearch] = useState("");

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

  // Was invisible from this page entirely — a TL submitting a transfer here
  // had no way to see that its approval lives on a separate page/route.
  const { data: myTransferRequests = [] } = useQuery({
    queryKey: ["sa-my-transfer-requests"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/sa/lead-transfers");
      if (!r.ok) return [];
      return r.json().catch(() => []);
    },
    staleTime: 60_000,
    enabled: isTL,
  });
  const pendingTransferCount = (myTransferRequests as any[]).filter((t) => t.Status === "Pending").length;

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
  };

  const invalidateLeadFlow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sa-leads"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-dashboard"] }),
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

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Leads", "All Leads"]} title="All Leads">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load leads. Refresh the page to try again." : "Loading leads…"}
      </div>
    </SalesAutoShell>
  );

  const inFollowup = mappedData.filter((l) => l.FollowupCustomerId);
  const booked = mappedData.filter((l) => l.BookingId);
  const byQuick =
    quickFilter === "inFollowup" ? inFollowup :
    quickFilter === "booked" ? booked :
    mappedData;
  const displayedData = stageFilter === "All" ? byQuick : byQuick.filter((l) => l.Status === stageFilter);
  const stageCount = (k: string) => byQuick.filter((l) => l.Status === k).length;
  const unowned = mappedData.filter((l) => !l.AssignedSalespersonId && !l.AssignedTeamLeadId && l.Status === "New").length;
  const tq = transferSearch.trim().toLowerCase();
  const transferList = tq ? mappedData.filter((l) => [l.CustomerName, l.Mobile, l.LeadUid].some((v) => String(v ?? "").toLowerCase().includes(tq))) : mappedData;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Leads", "All Leads"]} title="All Leads"
      subtitle={`${mappedData.length} leads · ${unowned} new and not yet given to anyone · ${booked.length} booked`}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <style>{`@media print { nav, header, aside, .print\\:hidden { display: none !important; } }`}</style>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Transfer Leads — Team Lead only. Used to have zero visibility
                into its own approval status; now links straight to it. */}
            {isTL && (
              <>
                <button
                  onClick={() => { setTransferOpen(true); setTransferSelectedIds(new Set()); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
                >
                  <ArrowRightLeft size={13} /> Transfer Leads
                </button>
                <Link
                  to="/sales-automation/lead-transfers"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
                >
                  <Clock size={13} /> My Transfer Requests
                  {pendingTransferCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[0.625rem] font-semibold bg-amber-500/15 text-amber-600">{pendingTransferCount} pending</span>
                  )}
                </Link>
              </>
            )}
            {/* Was one of four tabs on this page — the Kanban board is its
                own page now so this page is CRUD-grid-only. */}
            <Link
              to="/sales-automation/pipeline"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              <Kanban size={13} /> View Pipeline
            </Link>
            {/* Was a standalone "Tracking" tab's two tables — same data,
                now a one-click filter on this grid instead of a separate
                tab round-trip. */}
            <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
              {([
                { key: "all", label: "All" },
                { key: "inFollowup", label: `In CRM App (${inFollowup.length})` },
                { key: "booked", label: `Booked (${booked.length})` },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setQuickFilter(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${quickFilter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {key === "all" && <Filter size={12} />} {label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors print:hidden"
            title="Print leads table"
          >
            <Printer size={13} /> Print
          </button>
        </div>

        {/* Stage chips — counts follow the quick filter above */}
        <div className="flex flex-wrap gap-1 print:hidden">
          <button onClick={() => setStageFilter("All")}
            className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${stageFilter === "All" ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
            All stages <span className="tabular-nums opacity-70">{byQuick.length}</span>
          </button>
          {LEAD_STAGES.filter((s) => stageCount(s.key) > 0).map((s) => (
            <button key={s.key} onClick={() => setStageFilter(s.key)} title={s.hint}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${stageFilter === s.key ? "bg-primary/10 border-primary/30 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: s.hex }} />
              {s.label} <span className="tabular-nums opacity-70">{stageCount(s.key)}</span>
            </button>
          ))}
        </div>

        <MasterPage
          title="Lead"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          columnRenderers={{
            CustomerName: (v, r) => TitleCell(v, [r.LeadUid, r.Mobile].filter(Boolean).join(" · ")),
            CampaignName: (v, r) => TitleCell(v || r.ChannelPartnerName || r.SourceType || "—", [r.AdName, r.PlatformName].filter(Boolean).join(" · ")),
            Status: StageCell,
            Classification: (v) => (v ? <StatusBadge status={String(v)} /> : <span className="text-muted-foreground text-xs">—</span>),
            SalespersonName: (v, r) => TitleCell(v || (r.TeamLeadName ? "Not yet given out" : "Unassigned"), r.TeamLeadName ? `TL ${r.TeamLeadName}` : ""),
            LastActivityAt: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{v ? fmtDay(v) : "Never"}</span>,
            LeadScore: (v) => <span className="tabular-nums text-sm">{Number(v) || "—"}</span>,
          }}
          canCreate={canDoAction("sa-leads", "create")}
          canEdit={canDoAction("sa-leads", "edit")}
          canDelete={false /* leads are a permanent record — can be edited, never deleted */}
          initialData={displayedData}
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
              <button type="button" onClick={() => setAuditLeadId(row._id)} className={actionBtn} title="Every change made to this lead">
                <Clock size={13} /> Changes
              </button>
            );
            const interactionBtn = (
              <button type="button" onClick={() => setInteractionLead({ id: row._id, uid: String(row.LeadUid), mobile: row.Mobile ? String(row.Mobile) : undefined, email: row.Email ? String(row.Email) : undefined })} className={actionBtn}
                title="Log a call, WhatsApp or meeting and see past ones">
                <MessageSquarePlus size={13} /> Log call
              </button>
            );
            if (hasBooking) {
              return (
                <>
                  {interactionBtn}
                  {auditBtn}
                  <span className="px-2 py-1 text-[0.625rem] font-medium rounded-full bg-emerald-500/10 text-emerald-600">
                    Booked
                  </span>
                </>
              );
            }
            return (
              <>
                {interactionBtn}
                {auditBtn}
                {!isConverted && !hasFollowup && (
                  <button
                    type="button"
                    onClick={() => promoteToFollowup(row)}
                    disabled={handoffLoading === `followup-${row._id}`}
                    className={`${actionBtn} text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 disabled:opacity-40`}
                    title="Hand to CRM — puts it in the CRM Leads pool"
                  >
                    <CheckCircle2 size={13} /> {handoffLoading === `followup-${row._id}` ? "Sending…" : "Send to CRM"}
                  </button>
                )}
                {isConverted && !hasFollowup && (
                  <span className="px-2 py-1 text-[0.625rem] font-medium rounded-full bg-sky-500/10 text-sky-600" title="Converted — waiting for CRM staff to start an application from it">
                    In CRM Leads Pool
                  </span>
                )}
                {hasFollowup && (
                  <button
                    type="button"
                    onClick={() => window.open("/crm/applications", "_blank")}
                    className={`${actionBtn} text-amber-600 hover:bg-amber-500/10 hover:text-amber-700`}
                    title="Unit, rate, payment plan and approval happen in the CRM application"
                  >
                    <IndianRupee size={13} /> Open in CRM
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
              { key: "Status", label: "Stage", render: (v) => StageCell(v) },
              { key: "Classification", label: "Interest", render: (v) => (v ? <StatusBadge status={String(v)} /> : <p className="text-sm">—</p>) },
              { key: "LeadScore", label: "Lead Score" },
              { key: "BudgetMin", label: "Budget From", render: MoneyView },
              { key: "BudgetMax", label: "Budget To", render: MoneyView },
              { key: "PropertyType", label: "Property Type" },
              { key: "BhkPreference", label: "BHK Preference" },
              { key: "PreferredLocation", label: "Preferred Location" },
              { key: "PurchaseTimeline", label: "Purchase Timeline" },
              { key: "LastActivityAt", label: "Last Activity" },
              { key: "TeamLeadName", label: "Team Lead" },
              { key: "SalespersonName", label: "Salesperson" },
              { key: "FollowupCustomerId", label: "CRM Application ID" },
              { key: "BookingId", label: "Booking ID" },
              { key: "CustomerRemarks", label: "Remarks" },
            ],
          }}
        />
      </div>

      {/* Audit trail — was a whole separate tab with its own lead-picker;
          now a per-row action opening a drawer, same data (GET /:id/audit). */}
      <CrmSideDrawer
        open={!!auditLeadId}
        onClose={() => setAuditLeadId(null)}
        title="Audit Trail"
        subtitle={mappedData.find((l) => l._id === auditLeadId)?.LeadUid ? String(mappedData.find((l) => l._id === auditLeadId)?.LeadUid) : undefined}
      >
        {auditLog.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No changes recorded yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                {["Field", "Old Value", "New Value", "Changed By", "When"].map((h) => (
                  <th key={h} className="p-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(auditLog as any[]).map((row: any) => (
                <tr key={row.Id} className="border-t border-border">
                  <td className="p-2 font-medium text-foreground text-xs">{row.Field}</td>
                  <td className="p-2 text-xs text-muted-foreground">{row.OldValue ?? <span className="italic opacity-50">—</span>}</td>
                  <td className="p-2 text-xs text-foreground">{row.NewValue ?? <span className="italic opacity-50">—</span>}</td>
                  <td className="p-2 text-xs text-muted-foreground">{row.ChangedByName ?? "System"}</td>
                  <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(row.ChangedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CrmSideDrawer>

      {/* Log interaction — same shared form/history Lead Activities and
          Follow-Ups use (see useLeadActivities.ts), reachable in one click
          from the row it's about instead of leaving this page. */}
      <CrmSideDrawer
        open={!!interactionLead}
        onClose={() => setInteractionLead(null)}
        title="Log or Send"
        subtitle={interactionLead?.uid}
      >
        {interactionLead && <LeadInteractionPanelContent leadId={parseInt(interactionLead.id)} mobile={interactionLead.mobile} email={interactionLead.email} />}
      </CrmSideDrawer>

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
                <SearchableNativeSelect
                  value={transferToTLId}
                  onChange={(e) => setTransferToTLId(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                >
                  <option value="">Select destination TL...</option>
                  {(tlOptions as any[]).map((tl: any) => (
                    <option key={tl.Id} value={tl.Id}>{tl.Name}</option>
                  ))}
                </SearchableNativeSelect>
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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="text-xs text-muted-foreground">Leads to move ({transferSelectedIds.size} ticked)</label>
                <div className="flex items-center gap-2">
                  <input value={transferSearch} onChange={(e) => setTransferSearch(e.target.value)} placeholder="Name, mobile or lead ID"
                    className="w-48 text-xs border border-border rounded-md px-2 py-1 bg-background" />
                  <button
                    onClick={() => {
                      const all = transferList.every((l) => transferSelectedIds.has(l._id));
                      setTransferSelectedIds((prev) => {
                        const next = new Set(prev);
                        transferList.forEach((l) => (all ? next.delete(l._id) : next.add(l._id)));
                        return next;
                      });
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {transferList.length && transferList.every((l) => transferSelectedIds.has(l._id)) ? "Untick shown" : "Tick shown"}
                  </button>
                </div>
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
                    {transferList.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-4 text-center text-muted-foreground text-xs">{tq ? "No leads match." : "No leads available"}</td></tr>
                    ) : transferList.map((l) => (
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
                        <td className="px-3 py-2 text-xs">{StageCell(l.Status)}</td>
                        <td className="px-3 py-2 text-xs">
                          {l.Classification && <StatusBadge status={String(l.Classification)} className="text-[0.625rem] px-1.5 py-0.5" />}
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
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold btn-module text-white disabled:opacity-40 transition-colors"
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

// Small history + form combo for the "Log Interaction" drawer above — not
// hoisted into useLeadActivities.ts/LeadInteractionForm.tsx since this is
// the only call site; if a second one shows up, promote it there instead
// of copying this.
const LeadInteractionPanelContent: React.FC<{ leadId: number; mobile?: string; email?: string }> = ({ leadId, mobile, email }) => {
  const { data: history = [] } = useLeadActivityHistory(leadId);
  return (
    <div className="space-y-4">
      <LeadInteractionForm leadId={leadId} variant="compact" />
      <div className="rounded-lg border border-border p-3 space-y-2">
        <h3 className="text-xs font-semibold text-foreground">Send message</h3>
        <LeadMessageForm leadId={leadId} mobile={mobile} email={email} />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border">
          <h3 className="text-xs font-semibold text-foreground">History ({history.length})</h3>
        </div>
        {history.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-xs">No activity logged yet</div>
        ) : (history as any[]).map((h) => (
          <div key={h.Id} className="px-3 py-2.5 border-b border-border last:border-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{h.ActivityType}</span>
              <span className="text-xs text-muted-foreground">{fmtWhen(h.CreatedAt)}</span>
            </div>
            {h.Summary && <p className="text-xs text-muted-foreground mt-1">{h.Summary}</p>}
            {h.NextFollowupDate && <p className="text-xs text-amber-600 mt-0.5">Next reminder: {fmtDay(h.NextFollowupDate)}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SaLeadManagement;
